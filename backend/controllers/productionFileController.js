const { sql, getPool } = require('../config/db');
const PricingService = require('../services/pricingService');
const LabelGenerationService = require('../services/LabelGenerationService');

// [PRENDAS] ¿La orden es trabajo interno de un pedido con orden madre PRO (el Bordado, DTF,
// TPU, Estampado, Corte o Costura de una prenda comprada o fabricada)? Esas órdenes NO tienen
// línea de cotización propia a propósito — el precio viaja en la PRO, o la personalización
// directamente no se cobra — así que el chequeo "sin cantidad cotizada no hay etiquetas" las
// dejaba SIN etiqueta ni bulto, y sin bulto no se puede mandar al área siguiente (caso
// DTF-20947: pronta para Estampado y sin etiqueta; cargarle metros a la orden no alcanzaba,
// porque lo que se mira es la cotización). LabelGenerationService ya las acepta (mismo
// criterio, esHermanaPrendaLbl); lo que cortaba antes era este chequeo previo.
async function esTrabajoInternoDePedidoConPro(pool, ordenId) {
    const r = await pool.request().input('OID', sql.Int, ordenId).query(`
        SELECT TOP 1 1 AS X
        FROM Ordenes o
        JOIN Ordenes pro ON LTRIM(RTRIM(pro.NoDocERP)) = LTRIM(RTRIM(o.NoDocERP)) AND pro.AreaID = 'PRO'
        WHERE o.OrdenID = @OID
          AND UPPER(LTRIM(RTRIM(o.AreaID))) IN ('EMB', 'DF', 'TPU', 'EST', 'TWC', 'TWT', 'SB', 'DIRECTA', 'ECOUV')   -- [F1] misma lista que erpSync/LabelGenerationService
    `);
    return r.recordset.length > 0;
}

// Aviso al completar una orden SIN cantidad cotizada (no se genera etiqueta). Dice la causa
// cuando es la más común — el artículo no tiene precio base, el sync cotizó $0 y desde el
// 17-sep una línea en $0 no se guarda (EUV-30014, Back pet) — y qué hacer: al guardar la
// cotización la etiqueta se genera sola (quotationController.sincronizarEtiquetasDelPedido).
async function mensajeSinCantidadCotizada(pool, ordenId) {
    const base = 'La orden no tiene cantidad cotizada, así que NO se generó su etiqueta.';
    const pasos = 'Cotizala en "Cotizar Productos": al guardar la cotización la etiqueta se genera sola.';
    try {
        const r = await pool.request().input('OID', sql.Int, ordenId).query(`
            SELECT TOP 1 A.Descripcion, O.ProIdProducto,
                   (SELECT COUNT(*) FROM PreciosBase PB WHERE PB.ProIdProducto = O.ProIdProducto) AS Precios
            FROM Ordenes O LEFT JOIN Articulos A ON A.ProIdProducto = O.ProIdProducto
            WHERE O.OrdenID = @OID`);
        const o = r.recordset[0];
        if (o && o.ProIdProducto && o.Precios === 0) {
            const art = String(o.Descripcion || '').trim() || `producto ${o.ProIdProducto}`;
            return `${base} Causa: el artículo "${art}" (ProIdProducto ${o.ProIdProducto}) no tiene precio base cargado. Cargalo en la lista de precios y después ${pasos.charAt(0).toLowerCase()}${pasos.slice(1)}`;
        }
    } catch (e) {
        logger.warn(`[mensajeSinCantidadCotizada] ${ordenId}: ${e.message}`);
    }
    return `${base} ${pasos}`;
}
const driveService = require('../services/driveService');
const logger = require('../utils/logger');
const { changeOrderState } = require('../services/stateManagerService');
const { saveFallaImage } = require('../utils/thumbnailGenerator');
const { devolverMetrosTelaCliente } = require('../utils/telaClienteDevolucion');
const { heredarRequisitosCumplidos } = require('../utils/requisitosAutoCumplimiento');

// Asegura la columna para la imagen anotada de falla (una sola vez por proceso).
let _fallaColEnsured = false;
async function ensureFallaColumn(pool) {
    if (_fallaColEnsured) return;
    await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'ImagenFalla' AND Object_ID = Object_ID('dbo.FallasProduccion'))
            ALTER TABLE dbo.FallasProduccion ADD ImagenFalla NVARCHAR(300) NULL;
        -- Falla POR COPIAS: cuántas copias del archivo están "en reposición" (falladas y aún no
        -- repuestas). 0 = sin fallas parciales (whole-file legacy). Ver docs/falla-por-copias-propuesta.md
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'CopiasFalladas' AND Object_ID = Object_ID('dbo.ArchivosOrden'))
            ALTER TABLE dbo.ArchivosOrden ADD CopiasFalladas INT NOT NULL CONSTRAINT DF_ArchivosOrden_CopiasFalladas DEFAULT 0;
        -- Copias falladas del reporte (CantidadFalla sigue siendo METROS: la consumen los informes)
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'CopiasFalla' AND Object_ID = Object_ID('dbo.FallasProduccion'))
            ALTER TABLE dbo.FallasProduccion ADD CopiasFalla INT NULL;
        -- Número de la PRIMERA copia reportada en esta falla (contadas + falladas previas + 1):
        -- el operario controla en orden, así que identifica qué copia salió mala. La etiqueta
        -- muestra "COPIA N" (o "COPIAS N-M" si CopiasFalla > 1).
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'CopiaDesde' AND Object_ID = Object_ID('dbo.FallasProduccion'))
            ALTER TABLE dbo.FallasProduccion ADD CopiaDesde INT NULL;
    `);
    _fallaColEnsured = true;
}
const { isPedidoCompletoEnArea } = require('../services/pedidoCompletoService');
const { cerrarLoteSiResuelto } = require('../services/loteCleanupService');
const { sqlSinImprimir } = require('../utils/controlSoloImpresas');

/**
 * ECOUV (utils/controlSoloImpresas): una orden que todavía no se tildó como impresa se ve en Control
 * pero no se controla. Corre ANTES de cada acción de control (archivo, copias, finalizar orden), por
 * la orden o por el archivo/servicio. Devuelve el motivo del rechazo, o null si se puede controlar.
 */
async function rechazoSinImprimir(db, { ordenId = null, archivoId = null, isService = false }) {
    const ordenDelItem = isService
        ? '(SELECT OrdenID FROM dbo.ServiciosExtraOrden WITH (NOLOCK) WHERE ServicioID = @AID)'
        : '(SELECT OrdenID FROM dbo.ArchivosOrden WITH (NOLOCK) WHERE ArchivoID = @AID)';
    const r = await new sql.Request(db)
        .input('OID', sql.Int, ordenId ? Number(ordenId) : null)
        .input('AID', sql.Int, archivoId ? Number(archivoId) : null)
        .query(`
            SELECT TOP 1 O.CodigoOrden, ${sqlSinImprimir('O')} AS SinImprimir
            FROM dbo.Ordenes O WITH (NOLOCK)
            WHERE O.OrdenID = COALESCE(@OID, ${ordenDelItem})`);
    const o = r.recordset[0];
    return o && o.SinImprimir === 1
        ? `La orden ${o.CodigoOrden} todavía no está marcada como impresa. Tildala como impresa en el detalle del lote para poder controlarla.`
        : null;
}

/**
 * CIERRA EL CIRCUITO DE IMPRESIÓN al quedar la orden Pronta.
 *
 * Si Control aprobó todos los archivos de la orden, el material existe y está impreso: no puede
 * quedar "lista para despachar" y "pendiente de imprimir" a la vez. Sin esto, Control y Planeación
 * sostenían dos verdades distintas sobre lo mismo y el lote rebotaba al finalizar con "faltan N
 * orden(es) sin marcar como impreso", obligando a ir a tildarla a mano en el detalle del lote.
 *
 * El contador parcial se sincroniza con el MISMO criterio que el tick manual
 * (rollsController.setOrderPrinted): solo aplica a DIRECTA, lotes en MIMAKI y UM='U' (TPU); en el
 * resto de las áreas CantidadImpresa no se usa y se deja como está.
 *
 * Idempotente (`ISNULL(Impreso,0) = 0`): no pisa lo ya marcado ni el avance parcial de quien
 * venía contando copias a mano.
 */
async function marcarImpresaAlCompletar(transaction, ordenId) {
    await new sql.Request(transaction)
        .input('OID', sql.Int, ordenId)
        .query(`
            DECLARE @TotalParcial DECIMAL(10,2) = (
                SELECT CASE
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(o.AreaID,'')))) = 'DIRECTA'
                      OR LOWER(LTRIM(ISNULL(ce.Nombre,''))) LIKE 'mimaki%'
                        THEN (SELECT ISNULL(SUM(ISNULL(Copias,1)),0) FROM dbo.ArchivosOrden WITH(NOLOCK)
                               WHERE OrdenID = o.OrdenID AND ISNULL(EstadoArchivo,'') <> 'CANCELADO')
                    WHEN UPPER(LTRIM(RTRIM(ISNULL(o.UM,'')))) = 'U'
                        THEN ISNULL(TRY_CONVERT(DECIMAL(10,2), TRY_CONVERT(FLOAT, o.Magnitud)), 0)
                    ELSE NULL END
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.Rollos r WITH(NOLOCK) ON r.RolloID = o.RolloID
                LEFT JOIN dbo.ConfigEquipos ce WITH(NOLOCK) ON ce.EquipoID = ISNULL(o.MaquinaID, r.MaquinaID)
                WHERE o.OrdenID = @OID
            );
            UPDATE dbo.Ordenes
            SET Impreso = 1,
                CantidadImpresa = CASE WHEN @TotalParcial IS NOT NULL THEN @TotalParcial ELSE CantidadImpresa END,
                -- Orden REAL de impresión (ver rollsController.ensureOrderColumns): el WHERE de abajo
                -- ya garantiza que esto solo corre en la transición 0→1, así que siempre es la fecha
                -- correcta y nunca se pisa un valor previo.
                FechaImpreso = GETDATE()
            WHERE OrdenID = @OID AND ISNULL(Impreso, 0) = 0
        `);
}

// Todas las fallas registradas de un ítem (archivo o servicio), para la etiqueta.
// La etiqueta de falla sale UNA vez por archivo — cuando queda resuelto (contadas +
// falladas = total) — y lista todo lo acumulado; antes salía una por cada reporte.
async function getFallasDeArchivo(db, archivoId) {
    const r = await new sql.Request(db)
        .input('AID', sql.Int, archivoId)
        .query(`
            SELECT FP.FechaFalla, FP.CantidadFalla, FP.CopiasFalla, FP.CopiaDesde,
                   CAST(FP.Observaciones AS NVARCHAR(500)) AS Observaciones,
                   ISNULL(TF.Titulo, CONCAT('Tipo #', FP.TipoFalla)) AS TipoFalla
            FROM FallasProduccion FP WITH (NOLOCK)
            LEFT JOIN TiposFallas TF WITH (NOLOCK) ON TF.FallaID = FP.TipoFalla
            WHERE FP.ArchivoID = @AID
            ORDER BY FP.FechaFalla ASC
        `);
    return r.recordset;
}

/**
 * Cura la familia tras cerrar una reposición (-F) sin fallas.
 *
 * Pone en OK los archivos/servicios en FALLA del MISMO nombre en TODAS las órdenes de la familia
 * (mismo NoDocERP + área; sin NoDocERP, por código raíz + sus eslabones -F) y limpia la marca
 * "[Esperando Reposición]" de las que ya no tengan ninguna falla pendiente.
 *
 * Vive acá —y no dentro de un handler— porque hay DOS caminos para cerrar una reposición y los dos
 * tienen que curar igual:
 *   · postControlArchivo → marcar los archivos uno por uno en Control.
 *   · completarOrden     → el botón "CORREGIR FALLA" / "Completar orden", que es el flujo NATURAL.
 * Estaba escrito solo dentro del primero, así que en la práctica casi nunca se ejecutaba: al corregir
 * una falla con el botón, los eslabones previos de la cadena quedaban con su archivo en FALLA para
 * siempre y el pedido no se resolvía.
 *
 * @param db  pool o transacción activa
 */
async function sanarFamiliaTrasReposicion(db, { ordenId, codigoOrden, noDocERP, areaId, soloNombreArchivo = null }) {
    const codigoRaiz = (codigoOrden || '').split('-F')[0];
    // "Misma familia": por NoDocERP si existe; si no, por código raíz (madre y sus -F). Excluye la propia.
    const filtroFamilia = (alias) => `
        ${alias}.AreaID = @AreaID
        AND ${alias}.OrdenID <> @CurrentOrderID
        AND (
            (@NoDoc IS NOT NULL AND ${alias}.NoDocERP = @NoDoc)
            OR (@NoDoc IS NULL AND (${alias}.CodigoOrden = @CodigoRaiz OR ${alias}.CodigoOrden LIKE @CodigoRaiz + '-F%'))
        )`;

    await new sql.Request(db)
        .input('NoDoc', sql.VarChar(50), noDocERP)
        .input('CodigoRaiz', sql.NVarChar, codigoRaiz)
        .input('AreaID', sql.VarChar(50), areaId)
        .input('CurrentOrderID', sql.Int, ordenId)
        .input('SoloNombre', sql.NVarChar, soloNombreArchivo)
        .query(`
            -- Cura por archivo, en DOS modos según cómo se reportó la falla:
            --  · WHOLE-FILE (legacy, CopiasFalladas=0 y estado FALLA): como siempre — OK + [Repuesto]
            --    y el contador al total.
            --  · PARCIAL (CopiasFalladas>0): la -F repuso CurF.Copias copias de ese archivo; se
            --    acreditan a la madre con tope en su pendiente (min(f, CopiasFalladas)) — así la
            --    suma es acotada y repetir la cura no duplica crédito (idempotente). Si con eso el
            --    archivo llega al total queda OK; si no, sigue en su estado (Pendiente: se siguen
            --    contando buenas / FALLA: espera otra reposición del resto).
            -- @SoloNombre acota la cura a UN archivo (updateFileCopyCount cura al completarse cada
            -- archivo de la -F, no la -F entera — una -F reutilizada puede tener varios).
            UPDATE PF
            SET Controlcopias  = nuevo.Ctl,
                CopiasFalladas = nuevo.Fall,
                EstadoArchivo  = CASE WHEN nuevo.Ctl >= PF.Copias THEN 'OK' ELSE PF.EstadoArchivo END,
                FechaControl   = GETDATE(),
                Observaciones  = CONCAT(ISNULL(PF.Observaciones, ''),
                    CASE WHEN nuevo.Ctl >= PF.Copias THEN ' [Repuesto]'
                         ELSE CONCAT(' [Repuesta parcial x', nuevo.Rep, ']') END)
            FROM dbo.ArchivosOrden AS PF
            INNER JOIN dbo.Ordenes AS ParentOrder ON PF.OrdenID = ParentOrder.OrdenID
            INNER JOIN dbo.ArchivosOrden AS CurF
                ON CurF.OrdenID = @CurrentOrderID AND CurF.NombreArchivo = PF.NombreArchivo
            CROSS APPLY (SELECT Rep = CASE
                    WHEN ISNULL(PF.CopiasFalladas, 0) = 0 THEN NULL  -- whole-file legacy
                    WHEN ISNULL(CurF.Copias, 1) <= PF.CopiasFalladas THEN ISNULL(CurF.Copias, 1)
                    ELSE PF.CopiasFalladas END) rep0
            CROSS APPLY (SELECT
                    Ctl  = CASE WHEN rep0.Rep IS NULL THEN PF.Copias ELSE ISNULL(PF.Controlcopias, 0) + rep0.Rep END,
                    Fall = CASE WHEN rep0.Rep IS NULL THEN 0 ELSE ISNULL(PF.CopiasFalladas, 0) - rep0.Rep END,
                    Rep  = rep0.Rep) nuevo
            WHERE ${filtroFamilia('ParentOrder')}
              AND (PF.EstadoArchivo = 'FALLA' OR ISNULL(PF.CopiasFalladas, 0) > 0)
              AND (@SoloNombre IS NULL OR PF.NombreArchivo = @SoloNombre);

            -- Servicios: siempre whole-file (no tienen parciales). No corre en curas por-archivo.
            UPDATE ParentServices
            SET Estado = 'OK', Observaciones = CONCAT(ISNULL(ParentServices.Observaciones, ''), ' [Repuesto]')
            FROM dbo.ServiciosExtraOrden AS ParentServices
            INNER JOIN dbo.Ordenes AS ParentOrder ON ParentServices.OrdenID = ParentOrder.OrdenID
            WHERE @SoloNombre IS NULL
              AND ${filtroFamilia('ParentOrder')}
              AND ParentServices.Estado = 'FALLA'
              AND ParentServices.Descripcion IN (SELECT Descripcion FROM dbo.ServiciosExtraOrden WHERE OrdenID = @CurrentOrderID);

            -- Limpiar "[Esperando Reposición]" de las órdenes de la familia que ya no tengan NINGUNA
            -- falla pendiente (estado FALLA o copias falladas sin reponer). Todas las ocurrencias.
            UPDATE ParentOrder
            SET Observaciones = NULLIF(LTRIM(RTRIM(
                    REPLACE(ISNULL(ParentOrder.Observaciones, ''), ' [Esperando Reposición]', '')
                )), '')
            FROM dbo.Ordenes AS ParentOrder
            WHERE ${filtroFamilia('ParentOrder')}
              AND ParentOrder.Observaciones LIKE '%[[]Esperando Reposición]%'
              AND NOT EXISTS (SELECT 1 FROM dbo.ArchivosOrden AF
                              WHERE AF.OrdenID = ParentOrder.OrdenID
                                AND (AF.EstadoArchivo = 'FALLA' OR ISNULL(AF.CopiasFalladas, 0) > 0))
              AND NOT EXISTS (SELECT 1 FROM dbo.ServiciosExtraOrden SF
                              WHERE SF.OrdenID = ParentOrder.OrdenID AND SF.Estado = 'FALLA');
        `);
}

/**
 * 1. Obtiene las Órdenes de un Rollo (o todas, o filtradas)
 */
const getOrdenes = async (req, res) => {
    try {
        const { search, rolloId, area, mode } = req.query;
        const pool = await getPool();

        // Limpieza de Parametros
        const cleanRoll = (!rolloId || rolloId === 'undefined' || rolloId === 'null' || rolloId === 'todo')
            ? ''
            : rolloId.toString();

        const cleanArea = (!area || area === 'undefined' || area === 'null')
            ? ''
            : area;

        // DETECCIÓN DE CONTEXTO: VISTA DE CONTROL
        const isControlView = req.baseUrl && req.baseUrl.includes('production-file-control');

        const searchTerm = (search && search !== 'undefined' && search.trim() !== '') ? `%${search.trim()}%` : null;

        // Si estamos en Control View y NO se seleccionó un rollo específico (Todos),
        // devolvemos VACÍO para obligar al usuario a seleccionar un rollo —
        // SALVO que haya término de búsqueda: "Todos los lotes" permite buscar
        // una orden en cualquier lote activo del área (filtro estricto abajo).
        if (isControlView && cleanRoll === '' && !searchTerm) {
            return res.json([]);
        }

        // Control View sin rollo específico (búsqueda en todos): filtro estricto por lotes activos.
        const applyControlFilter = (isControlView && cleanRoll === '') ? 1 : 0;

        // Log suprimido — alta frecuencia de polling

        const query = `
        SELECT
        O.OrdenID,
            O.AreaID,
            O.CodigoOrden,
            O.Cliente AS Cliente,
                c.IDCliente AS IDCliente,
                O.Material,
                O.Estado,
                O.Prioridad,
                O.ProximoServicio,
                O.DescripcionTrabajo AS Descripcion,
                    O.FechaIngreso,
                    O.Secuencia,
                    (SELECT COUNT(*) FROM Etiquetas E WITH(NOLOCK) WHERE E.OrdenID = O.OrdenID) as CantidadEtiquetas,
                        (SELECT COUNT(*) FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID AND AO.EstadoArchivo IN('FALLA', 'Falla')) as CantidadFallas,
                            (SELECT COUNT(*) FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID AND AO.EstadoArchivo = 'CANCELADO') as CantidadCancelados,
                                (CASE WHEN(SELECT COUNT(*) FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID AND AO.EstadoArchivo = 'Pendiente') = 0 THEN 1 ELSE 0 END) as Controlada,
                                O.Magnitud,
                                O.EstadoenArea,
                                -- Forma de envío elegida en el pedido: el área necesita saber
                                -- si el trabajo se retira, va por encomienda o a domicilio.
                                LTRIM(RTRIM(ISNULL(O.ModoRetiro, ''))) AS ModoRetiro,
                                -- ECOUV: se ve en el lote pero no se controla hasta tildarla como
                                -- impresa (utils/controlSoloImpresas). En el resto de las áreas, siempre 0.
                                ${sqlSinImprimir('O')} AS SinImprimir,
                                -- [23/10/2026] Orden de falla de una reposición reportada desde OTRA área: en Control
                                -- se cierra con FINALIZAR ORDEN (Pronto + etiqueta + viaja), no con "CORREGIR FALLA"
                                -- (que la manda al canasto y lleva a la original). Las fallas de Control dan 0.
                                CASE WHEN EXISTS (SELECT 1 FROM dbo.Reposiciones RP WITH(NOLOCK)
                                                  WHERE RP.OrdenFallaID = O.OrdenID
                                                    AND UPPER(LTRIM(RTRIM(RP.AreaReporta))) <> UPPER(LTRIM(RTRIM(RP.AreaProduce))))
                                     THEN 1 ELSE 0 END AS FallaDeOtraArea
            FROM Ordenes O WITH(NOLOCK)
            LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON O.CliIdCliente = c.CliIdCliente
        WHERE
            (@RolloID = '' OR CAST(O.RolloID AS NVARCHAR(50)) = @RolloID OR @RolloID IS NULL)

        /* Si tenemos un RolloID especifico, ignoramos el filtro de Area exacta para evitar problemas SB vs Sublimacion */
        AND(
            (@RolloID IS NOT NULL AND @RolloID <> '' AND @RolloID <> 'todo')
        OR
            (@Area = '' OR O.AreaID = @Area)
                )

/* FILTRO DE CONTEXTO CONTROL DE CALIDAD (SI NO HAY ROLLO SELECCIONADO) */
AND(
    @ApplyControlFilter = 0
                    OR
                    O.RolloID IN(SELECT RolloID FROM Rollos WITH(NOLOCK) WHERE Estado IN ('Finalizado', 'En maquina', 'Produccion', 'Imprimiendo', 'Pausado', 'En Cola'))
)

                AND O.Estado != 'CANCELADO'
AND(
    @IsLabelMode = 1
    OR(
        -- En la vista de CONTROL: la orden desaparece solo cuando fue finalizada (Pronto),
        -- pero si está Retenida con una reposición (-F) activa, debe seguir visible para poder corregirla.
        -- EXCEPCIÓN: si se seleccionó un lote específico, las 'Pronto' de ESE lote siguen visibles
        -- para que al corregir una falla la orden madre no desaparezca.
        (${isControlView ? 1 : 0} = 1 AND (
            ISNULL(O.EstadoenArea,'') NOT IN ('Pronto', 'PRONTO', 'Retenido', 'RETENIDO', 'En Terminaciones')
            OR (
                ISNULL(O.EstadoenArea,'') IN ('Pronto', 'PRONTO')
                AND (
                    (@RolloID IS NOT NULL AND @RolloID <> '' AND @RolloID <> 'todo'
                     AND CAST(O.RolloID AS NVARCHAR(50)) = @RolloID)
                    -- Buscando en todos los lotes: las Pronto también aparecen (si no, "desaparecen" del buscador)
                    OR @Search IS NOT NULL
                )
            )
            OR (
                ISNULL(O.EstadoenArea,'') IN ('Retenido', 'RETENIDO')
                AND EXISTS (
                    SELECT 1 FROM dbo.Ordenes Repo
                    WHERE Repo.CodigoOrden LIKE O.CodigoOrden + '-F%'
                      AND ISNULL(Repo.EstadoenArea,'') NOT IN ('Pronto', 'PRONTO') AND Repo.Estado NOT IN ('Finalizado', 'CANCELADO')
                )
            )
        ))
        OR
        -- En otras vistas: comportamiento original (ocultar si no hay archivos pendientes)
        (${isControlView ? 0 : 1} = 1 AND
            LTRIM(RTRIM(ISNULL(O.EstadoenArea,''))) != 'PRONTO'
            AND(
                EXISTS(SELECT 1 FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID AND(AO.EstadoArchivo = 'Pendiente' OR AO.EstadoArchivo IS NULL))
                OR 
                NOT EXISTS(SELECT 1 FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID)
            )
        )
    )
)
AND(
    @Search IS NULL 
                    OR O.NoDocERP LIKE @Search 
                    OR O.Cliente LIKE @Search 
                    OR O.Material LIKE @Search
                    OR O.CodigoOrden LIKE @Search
                    OR EXISTS(SELECT 1 FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID AND AO.NombreArchivo LIKE @Search)
)
            ORDER BY
O.RolloID ASC,
    O.Secuencia ASC
        `;

        const result = await pool.request()
            .input('Search', sql.NVarChar, searchTerm)
            .input('RolloID', sql.NVarChar, cleanRoll)
            .input('Area', sql.NVarChar, cleanArea)
            .input('IsLabelMode', sql.Bit, mode === 'labels' ? 1 : 0)
            .input('ApplyControlFilter', sql.Bit, applyControlFilter)
            .query(query);

        res.json(result.recordset);
    } catch (err) {
        logger.error("Error en getOrdenes:", err);
        res.status(500).json({ error: 'Error al obtener órdenes', message: err.message, details: err.toString() });
    }
};

/**
 * 2. Obtiene los archivos específicos de una orden y datos de métricas.
 */
const getArchivosPorOrden = async (req, res) => {
    try {
        const { ordenId } = req.params;

        // Validación de ID
        if (!ordenId || ordenId === 'undefined' || ordenId === 'null') {
            return res.status(400).json({ error: 'ID de orden inválido' });
        }

        const pool = await getPool();
        await ensureFallaColumn(pool); // CopiasFalladas puede no existir aún en instalaciones viejas

        // logger.info(`Getting Archivos for OrdenID: ${ordenId} `);

        // 1. Obtener Archivos y Servicios (UNION)
        let queryStr = `
            SELECT
                AO.ArchivoID, AO.OrdenID, AO.NombreArchivo, AO.RutaAlmacenamiento, AO.Metros, AO.Copias,
                AO.Controlcopias, AO.EstadoArchivo, AO.UsuarioControl, AO.FechaControl, AO.Observaciones, AO.TipoArchivo,
                AO.Ancho, AO.Alto, AO.CodigoArticulo, AO.FechaSubida,
                AO.PreflightVeredicto, AO.PreflightReporte,
                ISNULL(AO.CopiasFalladas, 0) as CopiasFalladas,
                O.Material as Material, O.Cliente as Cliente, O.AreaID as AreaActual, O.NoDocERP, 0 as isService,
                -- TPU: el control es por PARCHE, no por capa del arte. La vista arma una sola línea
                -- por orden con estos datos (código_trabajo y la cantidad pedida como copias).
                O.CodigoOrden as OrdenCodigo, O.DescripcionTrabajo as OrdenTrabajo, O.Magnitud as OrdenMagnitud
            FROM ArchivosOrden AO WITH (NOLOCK)
            LEFT JOIN Ordenes O WITH (NOLOCK) ON AO.OrdenID = O.OrdenID
            WHERE AO.OrdenID = @OrdenID

            UNION ALL

            SELECT
                SEO.ServicioID as ArchivoID, SEO.OrdenID, SEO.Descripcion as NombreArchivo, NULL as RutaAlmacenamiento, NULL as Metros, SEO.Cantidad as Copias,
                ISNULL(SEO.Controlcopias, 0) as Controlcopias, SEO.Estado as EstadoArchivo, SEO.UsuarioControl, SEO.FechaControl, SEO.Observaciones as Observaciones, 'Servicio' as TipoArchivo,
                0 as Ancho, 0 as Alto, SEO.CodArt as CodigoArticulo, SEO.FechaRegistro as FechaSubida,
                NULL as PreflightVeredicto, NULL as PreflightReporte,
                0 as CopiasFalladas,
                O.Material as Material, O.Cliente as Cliente, O.AreaID as AreaActual, O.NoDocERP, 1 as isService,
                O.CodigoOrden as OrdenCodigo, O.DescripcionTrabajo as OrdenTrabajo, O.Magnitud as OrdenMagnitud
            FROM ServiciosExtraOrden SEO WITH (NOLOCK)
            LEFT JOIN Ordenes O WITH (NOLOCK) ON SEO.OrdenID = O.OrdenID
            WHERE SEO.OrdenID = @OrdenID
              -- Las terminaciones NO se controlan acá: en esta área solo se controla la
              -- impresión. Su línea existe para facturar y su trabajo se controla en el
              -- área de Terminaciones. Igual se ven, como dato, en los chips del archivo.
              AND ISNULL(SEO.Observacion, '') NOT LIKE N'%rminaci%por archivo%'
            ORDER BY NombreArchivo ASC
        `;

        const archivosResult = await pool.request()
            .input('OrdenID', sql.Int, ordenId)
            .query(queryStr);

        let docs = archivosResult.recordset;

        // Si es COSTURA, anexar referencias de CORTE (mismo NoDocERP)
        if (docs.length > 0) {
            const area = (docs[0].AreaActual || '').toUpperCase();
            const nodoc = docs[0].NoDocERP;

            if (area.includes('COSTURA') && nodoc) {
                const reqCorte = await pool.request()
                    .input('Doc', sql.VarChar, nodoc)
                    .query(`
                        SELECT 
                            AO.ArchivoID, AO.OrdenID, AO.NombreArchivo, AO.RutaAlmacenamiento, AO.Metros, AO.Copias, 
                            AO.Controlcopias, AO.EstadoArchivo, AO.UsuarioControl, AO.FechaControl, AO.Observaciones, AO.TipoArchivo,
                            AO.Ancho, AO.Alto, AO.CodigoArticulo, AO.FechaSubida,
                            AO.PreflightVeredicto, AO.PreflightReporte,
                            O.Material as Material, O.Cliente as Cliente, O.AreaID as AreaActual, O.NoDocERP, 0 as isService
                        FROM ArchivosOrden AO WITH (NOLOCK)
                        INNER JOIN Ordenes O WITH (NOLOCK) ON AO.OrdenID = O.OrdenID
                        WHERE O.NoDocERP = @Doc 
                          AND (O.AreaID = 'Corte' OR O.AreaID = 'TWC')
                          AND ISNULL(AO.TipoArchivo, '') != 'Servicio'
                        
                        UNION ALL

                        SELECT 
                            SEO.ServicioID as ArchivoID, SEO.OrdenID, SEO.Descripcion as NombreArchivo, NULL as RutaAlmacenamiento, NULL as Metros, SEO.Cantidad as Copias, 
                            ISNULL(SEO.Controlcopias, 0) as Controlcopias, SEO.Estado as EstadoArchivo, SEO.UsuarioControl, SEO.FechaControl, SEO.Observaciones as Observaciones, 'Servicio' as TipoArchivo,
                            0 as Ancho, 0 as Alto, SEO.CodArt as CodigoArticulo, SEO.FechaRegistro as FechaSubida,
                            NULL as PreflightVeredicto, NULL as PreflightReporte,
                            O.Material as Material, O.Cliente as Cliente, O.AreaID as AreaActual, O.NoDocERP, 1 as isService
                        FROM ServiciosExtraOrden SEO WITH (NOLOCK)
                        INNER JOIN Ordenes O WITH (NOLOCK) ON SEO.OrdenID = O.OrdenID
                        WHERE O.NoDocERP = @Doc AND (O.AreaID = 'Corte' OR O.AreaID = 'TWC')
                          AND ISNULL(SEO.Observacion, '') NOT LIKE N'%rminaci%por archivo%'
                    `);

                const corteDocs = reqCorte.recordset.map(d => ({
                    ...d,
                    TipoArchivo: 'REF_CORTE', // Forzar a caer en la pestaña de Referencias
                    NombreArchivo: d.NombreArchivo + ' (Corte)'
                }));

                docs = [...docs, ...corteDocs];
            }
        }

        // 2. Mapear URLs de Drive a Proxy de Backend si es necesario
        const mappedArchivos = docs.map(archivo => {
            if (archivo.RutaAlmacenamiento && archivo.RutaAlmacenamiento.includes('drive.google.com')) {
                // Si es un link de Drive, enviamos un link al proxy del backend
                // El link suele ser https://drive.google.com/open?id=XXXX o https://drive.google.com/file/d/XXXX/view
                return {
                    ...archivo,
                    urlProxy: `/api/production-file-control/view-drive-file?url=${encodeURIComponent(archivo.RutaAlmacenamiento)}`
                };
            }
            return archivo;
        });

        // TERMINACIONES POR ARCHIVO + PRODUCTO TERMINADO (ECOUV): en control cada archivo
        // muestra sus terminaciones y, si la orden es de un producto terminado, la ficha
        // del producto que viaja en la nota como [PRODUCTO: ... | Medidas ... | Incluye ...].
        try {
            const [termRes, notaRes] = await Promise.all([
                pool.request().input('OrdenID', sql.Int, ordenId).query(`
                    SELECT OT.ArchivoID, LTRIM(RTRIM(T.Nombre)) AS Nombre, OT.Cantidad, OT.Ubicacion, OT.Estado,
                           ISNULL(OT.ParamCliente, T.ParamCantidad) AS Param, T.ReglaCantidad
                    FROM OrdenTerminaciones OT WITH (NOLOCK)
                    INNER JOIN Terminaciones T WITH (NOLOCK) ON T.TerminacionID = OT.TerminacionID
                    WHERE OT.OrdenID = @OrdenID
                       OR OT.ArchivoID IN (SELECT ArchivoID FROM ArchivosOrden WITH (NOLOCK) WHERE OrdenID = @OrdenID)`),
                pool.request().input('OrdenID', sql.Int, ordenId)
                    .query(`SELECT Nota FROM Ordenes WITH (NOLOCK) WHERE OrdenID = @OrdenID`)
            ]);
            const nota = notaRes.recordset[0]?.Nota || '';
            const productoMatch = nota.match(/\[PRODUCTO:[^\]]*\]/);
            const productoInfo = productoMatch ? productoMatch[0].slice(1, -1) : null; // sin corchetes
            for (const a of mappedArchivos) {
                if (a.isService) continue;
                const terms = termRes.recordset.filter(t => t.ArchivoID === a.ArchivoID);
                if (terms.length > 0) a.Terminaciones = terms;
                if (productoInfo) a.ProductoInfo = productoInfo;
            }
        } catch (eTerm) {
            // Tablas de terminaciones ausentes (entorno sin la migración ECOUV): seguir sin adornos.
        }

        res.json(mappedArchivos);

    } catch (err) {
        logger.error("Error en getArchivosPorOrden:", err);
        res.status(500).json({ error: 'Error al obtener archivos', message: err.message });
    }
};

/**
 * 3. Controlar Archivo (OK, FALLA, CANCELADO)
 */
const postControlArchivo = async (req, res) => {
    const { archivoId, estado, motivo, tipoFalla, usuario, isService, annotatedImage } = req.body;
    let transaction;
    try {
        const pool = await getPool();
        await ensureFallaColumn(pool);
        if (archivoId) {
            const rechazo = await rechazoSinImprimir(pool, { archivoId, isService });
            if (rechazo) return res.status(400).json({ error: rechazo });
        }
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        if (!archivoId) return res.status(400).json({ error: 'Falta ID del ítem (archivoId/servicioId)' });

        let ordenId, codigoOrden, existeOrden, areaId, noDocERP, proximoServicio;
        let rolloId = null;
        let fileData = null;

        if (isService) {
            // CONTROL DE SERVICIO EXTRA
            const sData = await new sql.Request(transaction)
                .input('ID', sql.Int, archivoId)
                .query(`
                    SELECT S.OrdenID, O.AreaID, O.CodigoOrden, O.NoDocERP, O.ProximoServicio
                    FROM ServiciosExtraOrden S WITH (NOLOCK)
                    LEFT JOIN Ordenes O WITH (NOLOCK) ON S.OrdenID = O.OrdenID
                    WHERE S.ServicioID = @ID
                `);

            if (sData.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Servicio no encontrado' });
            }

            const row = sData.recordset[0];
            ordenId = row.OrdenID;
            codigoOrden = row.CodigoOrden;
            areaId = row.AreaID;
            noDocERP = row.NoDocERP;
            proximoServicio = row.ProximoServicio;

            await new sql.Request(transaction)
                .input('Estado', sql.NVarChar, estado)
                .input('Usuario', sql.NVarChar, usuario || 'System')
                .input('Motivo', sql.NVarChar, motivo || '')
                .input('ID', sql.Int, archivoId)
                .query(`
                    UPDATE ServiciosExtraOrden
                    SET Estado = @Estado,
                        FechaControl = GETDATE(),
                        UsuarioControl = @Usuario,
                        Observaciones = @Motivo,
                        Controlcopias = CASE WHEN @Estado IN ('OK', 'Finalizado') THEN Cantidad ELSE 0 END
                    WHERE ServicioID = @ID
                `);
        } else {
            // CONTROL DE ARCHIVO ESTÁNDAR
            fileData = await new sql.Request(transaction)
                .input('ArchivoID', sql.Int, archivoId)
                .query(`
                    SELECT AO.OrdenID, AO.NombreArchivo, AO.Metros as MetrosArchivo,
                           AO.Observaciones as ObsActual,
                           AO.Copias, ISNULL(AO.Controlcopias, 0) as Controlcopias,
                           ISNULL(AO.CopiasFalladas, 0) as CopiasFalladas,
                           O.AreaID, O.CodigoOrden, O.NoDocERP, O.ProximoServicio,
                           O.CliIdCliente, O.ProIdProducto, O.IdClienteReact, O.IdProductoReact,
                           O.CodCliente, O.CodArticulo, O.Nota as NotaOriginal,
                           O.RolloID, O.MaquinaID,
                           R.Nombre as NombreLote,
                           CE.Nombre as NombreMaquina
                    FROM ArchivosOrden AO WITH (NOLOCK)
                    LEFT JOIN Ordenes O WITH (NOLOCK) ON AO.OrdenID = O.OrdenID
                    LEFT JOIN Rollos R WITH (NOLOCK) ON O.RolloID = R.RolloID
                    LEFT JOIN ConfigEquipos CE WITH (NOLOCK) ON ISNULL(O.MaquinaID, R.MaquinaID) = CE.EquipoID
                    WHERE AO.ArchivoID = @ArchivoID
                `);

            if (fileData.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Archivo no encontrado' });
            }

            const row = fileData.recordset[0];
            ordenId      = row.OrdenID;
            codigoOrden  = row.CodigoOrden;
            areaId       = row.AreaID;
            noDocERP     = row.NoDocERP;
            proximoServicio = row.ProximoServicio;
            rolloId      = row.RolloID;  // para auto-cleanup post-commit

            // ── FALLA POR COPIAS (docs/falla-por-copias-propuesta.md) ──────────────────────
            // Si el front manda `copiasFalladas` (f) en un archivo multi-copia, la falla es POR
            // CANTIDAD: se acumula en ArchivosOrden.CopiasFalladas y la -F repone SOLO f copias.
            // Mientras queden copias buenas por contar, el archivo NO pasa a FALLA (el operario
            // sigue controlando); pasa a FALLA recién cuando no queda nada contable (todas las
            // buenas contadas + falladas registradas), y ahí el flujo aguas abajo es el de siempre.
            // TPU queda EXCLUIDO (su control es por parches/Magnitud, no por copias del archivo);
            // sin f (front viejo / archivos de 1 copia) el comportamiento es el whole-file actual.
            const esTPUFalla   = String(row.AreaID || '').trim().toUpperCase() === 'TPU';
            const copiasTotal  = parseInt(row.Copias) || 1;
            const restantes    = Math.max(0, copiasTotal - (row.Controlcopias || 0) - (row.CopiasFalladas || 0));
            const fPedidas     = parseInt(req.body.copiasFalladas);
            const aplicaPorCopias = estado === 'FALLA' && !esTPUFalla && copiasTotal > 1
                && Number.isFinite(fPedidas) && fPedidas >= 1 && restantes > 0;
            req._fallaCopias = aplicaPorCopias ? {
                f: Math.min(fPedidas, restantes),                    // copias que repone la -F
                quedanBuenas: restantes - Math.min(fPedidas, restantes) > 0,  // ¿sigue contando?
                // Qué copia salió mala: el operario controla en orden, así que la reportada es
                // la siguiente a todo lo ya resuelto (contadas + falladas previas + 1).
                copiaDesde: (row.Controlcopias || 0) + (row.CopiasFalladas || 0) + 1,
            } : null;

            // La info TÉCNICA de impresión ([RAPORT]/[ESCALA] + Modo/AnchoFinal) describe al ARCHIVO
            // y no debe perderse al controlarlo. Antes este UPDATE hacía `Observaciones = @Motivo`:
            // pisaba el campo, y un control SIN motivo lo dejaba vacío → toda orden que pasaba por
            // Control perdía el dato de rapport/escala (no se podía saber cómo se había impreso).
            // Ahora se conserva la parte técnica y el motivo del control se anexa después.
            const obsPrevia = String(row.ObsActual || '');
            const mTecnica  = obsPrevia.match(/\[(?:RAPORT|ESCALA)\][^|]*(?:\|\s*Modo:[^|]*)?/i);
            const tecnica   = mTecnica ? mTecnica[0].trim() : '';
            const obsFinal  = [tecnica, String(motivo || '').trim()].filter(Boolean).join(' | ');

            await new sql.Request(transaction)
                .input('Estado', sql.NVarChar, estado)
                .input('Usuario', sql.NVarChar, usuario || 'System')
                .input('Obs', sql.NVarChar(sql.MAX), obsFinal)
                .input('ID', sql.Int, archivoId)
                // Falla por copias: acumular f; y si quedan buenas por contar, NO pisar el estado
                // (el archivo sigue contable — pasa a FALLA recién sin nada pendiente de contar).
                .input('FNuevas', sql.Int, req._fallaCopias ? req._fallaCopias.f : 0)
                .input('MantenerEstado', sql.Bit, (req._fallaCopias && req._fallaCopias.quedanBuenas) ? 1 : 0)
                .query(`
                    UPDATE ArchivosOrden
                    SET EstadoArchivo = CASE WHEN @MantenerEstado = 1 THEN EstadoArchivo ELSE @Estado END,
                        FechaControl = GETDATE(),
                        UsuarioControl = @Usuario,
                        Observaciones = @Obs,
                        CopiasFalladas = ISNULL(CopiasFalladas, 0) + @FNuevas
                    WHERE ArchivoID = @ID
                `);
        }

        // 3. Manejo de FALLA: Clonación de Orden
        if (estado === 'FALLA') {
            const fallaIDClean = parseInt(tipoFalla);
            if (!fallaIDClean || isNaN(fallaIDClean)) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Debe seleccionar un tipo de falla válido.' });
            }

            // Metros reales a reponer (si viene del front)
            const metrosReponer = req.body.metrosReponer ? parseFloat(req.body.metrosReponer) : null;
            const equipoId = req.body.equipoId ? parseInt(req.body.equipoId) : null;

            // Imagen anotada de la falla (recuadro dibujado en el control), si vino.
            const fallaImgPath = annotatedImage ? await saveFallaImage(annotatedImage, codigoOrden, archivoId) : null;
            // En SB la -F arranca en 0m (no se piden metros a reponer); en el resto se clona la magnitud de la orden madre.
            const esFallaSB = String(areaId || '').toUpperCase() === 'SB';

            // Construir Nota compuesta para la nueva orden de falla
            const row = !isService ? fileData.recordset[0] : null;
            const notaOriginal  = (row?.NotaOriginal || '').trim();
            const nombreMaquina = row?.NombreMaquina || '';
            const nombreLote    = row?.NombreLote    || '';
            // Nombre del tipo de falla elegido (obligatorio en el control). Va en la nota de la -F: antes
            // la línea llevaba solo lo escrito en "Observaciones" y, si el operario no escribía nada,
            // decía "Motivo: (sin especificar)" aunque el tipo estuviera elegido (SUB-34096-F57092, 15/10).
            const rTipoFalla = await new sql.Request(transaction)
                .input('TF', sql.Int, fallaIDClean)
                .query('SELECT Titulo FROM TiposFallas WITH (NOLOCK) WHERE FallaID = @TF');
            const tituloFalla = String(rTipoFalla.recordset[0]?.Titulo || '').trim();
            const safeMotivo    = (motivo || '').toString().trim();

            // Archivo al que corresponde ESTA falla. Una orden -F acumula una línea por cada falla
            // del pedido (se reutiliza la misma -F), así que sin esto no se sabe qué archivo falló
            // en cada línea. Del nombre estándar ("SUB-8814_ELEA_18 DE JULIO_Archivo 4 de 4 (x1).pdf")
            // se extrae "Archivo 4 de 4"; si no matchea, se usa el nombre sin extensión.
            const nombreArchivo   = (row?.NombreArchivo || '').trim();
            const archivoEtiqueta = (nombreArchivo.match(/Archivo\s+\d+\s+de\s+\d+/i) || [])[0]
                || nombreArchivo.replace(/\.[^.]+$/, '');

            // Partes de la nota
            const partesFalla = [];
            // Motivo SIEMPRE presente: el tipo de falla y, si escribió algo, el texto del operario
            // ("Motivo: Tela mal cortada — la tela vino corrida"). Sin ninguno de los dos, la línea
            // quedaba muda ("Máquina: X | Lote: Y") sin decir por qué falló.
            const motivoNota = [tituloFalla, safeMotivo].filter(Boolean).join(' — ');
            partesFalla.push(`Motivo: ${motivoNota || '(sin especificar)'}`);
            if (archivoEtiqueta) partesFalla.push(`Archivo: ${archivoEtiqueta}`);
            if (metrosReponer)  partesFalla.push(`Reponer: ${metrosReponer}m`);
            if (nombreMaquina)  partesFalla.push(`Máquina: ${nombreMaquina}`);
            if (nombreLote)     partesFalla.push(`Lote: ${nombreLote}`);
            const notaFallaDetalle = partesFalla.join(' | ');
            // Nota final = nota original + detalle de la falla.
            // El prefijo 'FALLA:' va SIEMPRE: el detalle de la orden lo usa para separar las notas
            // del cliente (caja azul "Notas de Producción") de las fallas (caja ámbar). Sin él —
            // cuando la orden madre no tenía nota — la primera falla aparecía como nota de
            // producción y las siguientes como falla: la misma info en dos cajas distintas.
            const notaConPrefijo = `FALLA: ${notaFallaDetalle || 'Reposición por Falla'}`;
            const notaFinal = notaOriginal
                ? `${notaOriginal} || ${notaConPrefijo}`
                : notaConPrefijo;

            const obsFalla = metrosReponer
                ? `${safeMotivo} (Reponer: ${metrosReponer}m)`
                : safeMotivo;

            // ¿Lo que está fallando es una reposición (-F) o la orden madre? Define tanto el código
            // de la nueva falla como si se puede reutilizar una -F existente (ver más abajo).
            const controlandoUnaFalla = /-F\d+(-\d+)?$/i.test(codigoOrden || '');

            // Raíz sin sufijos de falla (SUB-9471-F13858-2 → SUB-9471): evita apilar -F-F.
            const codigoRaizFalla = (codigoOrden || '').replace(/(-F\d+(-\d+)?)+$/i, '');

            // Base del código de la reposición:
            //  · Falla sobre la MADRE  → `{raíz}-F{archivoId}` (el archivo que falló identifica la falla).
            //  · Falla sobre una -F    → se CONSERVA el linaje de esa -F y el sufijo numera el eslabón:
            //    SUB-9471-F13858 → SUB-9471-F13858-2 → SUB-9471-F13858-3. Antes cada eslabón tomaba el
            //    ID de su propio archivo (F13858 → F13916 → F13917) y por el código parecían todas
            //    hermanas de la madre: no se veía que una salía de la otra.
            // El sufijo -N es el mismo mecanismo que rompe empates cuando un archivo vuelve a fallar:
            // en ambos casos significa "el siguiente número libre de este linaje".
            const baseCodigoFalla = controlandoUnaFalla
                ? String(codigoOrden || '').replace(/-\d+$/, '')
                : `${codigoRaizFalla}-F${archivoId}`;
            let nuevoCodigo = baseCodigoFalla;

            // ── Buscar si ya existe una orden -F activa para esta madre ──
            // La reutilización existe para que varias fallas de LA MISMA madre se junten en una sola
            // reposición. NO aplica cuando lo que falla es una -F: una reposición que falla necesita
            // SU PROPIA reposición. Como la búsqueda es por RAÍZ (SUB-9471), encontraba a las -F
            // HERMANAS y absorbía la falla en una de ellas sin crear nada: la cadena
            // SUB-9471 → -F13858 → -F13916 → (nada) moría en el tercer eslabón y la falla se perdía.
            // Excluir solo `OrdenID <> ordenId` no alcanzaba: evitaba encontrarse a sí misma, no a las hermanas.
            const existingFallaRes = controlandoUnaFalla
                ? { recordset: [] }
                : await new sql.Request(transaction)
                    .input('BaseCode', sql.NVarChar, codigoRaizFalla)
                    .input('OrdenActual', sql.Int, ordenId)
                    .query(`
                        SELECT TOP 1 OrdenID, CodigoOrden, ArchivosCount
                        FROM dbo.Ordenes
                        WHERE CodigoOrden LIKE @BaseCode + '-F%'
                          AND OrdenID <> @OrdenActual
                          AND Estado NOT IN ('CANCELADO', 'Finalizado') AND ISNULL(EstadoenArea,'') NOT IN ('Pronto', 'PRONTO')
                        ORDER BY OrdenID DESC
                    `);

            const existingFallaOrder = existingFallaRes.recordset[0] || null;
            let newOrderId;

            if (existingFallaOrder) {
                // ── REUTILIZAR orden -F existente ──
                newOrderId = existingFallaOrder.OrdenID;
                logger.info(`[postControlArchivo] Reutilizando orden falla existente ${existingFallaOrder.CodigoOrden} (ID: ${newOrderId}) para archivo ${archivoId}`);

                // Actualizar nota de la orden original y de la orden de falla existente
                await new sql.Request(transaction)
                    .input('OldID',      sql.Int,               ordenId)
                    .input('NewFallaID', sql.Int,               newOrderId)
                    .input('TipoFallaID',sql.Int,               fallaIDClean)
                    .input('SafeMotivo', sql.NVarChar(sql.MAX),  obsFalla)
                    .input('EquipoID',   sql.Int,               equipoId)
                    .input('CantidadFalla', sql.Decimal(10, 2), metrosReponer)
                    .input('ArchivoID',  sql.Int,               archivoId)
                    .input('AreaID',     sql.NVarChar,          areaId)
                    .input('NotaAdd',    sql.NVarChar(sql.MAX), ` || FALLA: ${notaFallaDetalle}`)
                    .input('ImagenFalla', sql.NVarChar(300), fallaImgPath)
                    .input('CopiasFallaReg', sql.Int, req._fallaCopias ? req._fallaCopias.f : null)
                    .input('CopiaDesde', sql.Int, req._fallaCopias ? req._fallaCopias.copiaDesde : null)
                    .query(`
                        -- Actualizamos la orden original
                        UPDATE dbo.Ordenes
                        SET Observaciones = CONCAT(ISNULL(Observaciones,''), ' [Esperando Reposición]')
                        WHERE OrdenID = @OldID;

                        -- Actualizamos la orden de falla para concatenar la nueva nota
                        UPDATE dbo.Ordenes
                        SET Nota = CONCAT(ISNULL(Nota,''), @NotaAdd)
                        WHERE OrdenID = @NewFallaID;

                        INSERT INTO FallasProduccion(OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones, ImagenFalla, CopiasFalla, CopiaDesde)
                        VALUES(@OldID, @ArchivoID, @AreaID, GETDATE(), @TipoFallaID, @CantidadFalla, @EquipoID, @SafeMotivo, @ImagenFalla, @CopiasFallaReg, @CopiaDesde);
                    `);
            } else {
                // ── CREAR nueva orden -F ──
                // Sufijo incremental -2, -3…: "siguiente número libre de este linaje". Cubre los dos
                // casos, que son el mismo problema: la falla de una falla (el linaje avanza un eslabón)
                // y el mismo archivo fallando de nuevo tras cerrarse su reposición (el código ya existe).
                const dupRes = await new sql.Request(transaction)
                    .input('Code', sql.NVarChar, nuevoCodigo)
                    .query(`SELECT CodigoOrden FROM dbo.Ordenes
                             WHERE CodigoOrden = @Code OR CodigoOrden LIKE @Code + '-%'`);
                if (dupRes.recordset.length > 0) {
                    const usados = dupRes.recordset.map(r => {
                        const resto = String(r.CodigoOrden || '').slice(nuevoCodigo.length); // '' | '-2'
                        const m = resto.match(/^-(\d+)$/);
                        return m ? parseInt(m[1], 10) : 1;   // el código exacto cuenta como el nº 1
                    });
                    nuevoCodigo = `${nuevoCodigo}-${Math.max(...usados) + 1}`;
                    logger.info(`[postControlArchivo] Archivo ${archivoId} ya tenía reposición previa → nueva falla ${nuevoCodigo}`);
                }

                await new sql.Request(transaction)
                    .input('OldID',         sql.Int,            ordenId)
                    .input('NewCode',       sql.NVarChar,       nuevoCodigo)
                    .input('TipoFallaID',   sql.Int,            fallaIDClean)
                    .input('SafeMotivo',    sql.NVarChar(sql.MAX), obsFalla)
                    .input('EquipoID',      sql.Int,            equipoId)
                    .input('CantidadFalla', sql.Decimal(10, 2), metrosReponer)
                    .input('ArchivoID',     sql.Int,            archivoId)
                    .input('AreaID',        sql.NVarChar,       areaId)
                    .input('IsSB',          sql.Bit,            esFallaSB ? 1 : 0)
                    .input('NotaFinal',     sql.NVarChar(sql.MAX), notaFinal)
                    .input('ImagenFalla',   sql.NVarChar(300), fallaImgPath)
                    .input('CopiasFallaReg', sql.Int, req._fallaCopias ? req._fallaCopias.f : null)
                    .input('CopiaDesde', sql.Int, req._fallaCopias ? req._fallaCopias.copiaDesde : null)
                    .query(`
                        -- Nueva Orden de Falla
                        INSERT INTO dbo.Ordenes(
                            CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega,
                            Material, DescripcionTrabajo, Prioridad,
                            Estado, EstadoenArea, AreaID,
                            Magnitud, IdCabezalERP, ProximoServicio, Nota, NoDocERP,
                            FechaEntradaSector, ArchivosCount, Variante, UM,
                            IdClienteReact, CliIdCliente, CodCliente,
                            IdProductoReact, ProIdProducto, CodArticulo, BobinaTelaID, CostoTotal
                        )
                        SELECT
                            @NewCode, Cliente, GETDATE(), FechaEstimadaEntrega,
                            Material, DescripcionTrabajo, 'Falla',
                            'Pendiente', 'Pendiente', AreaID,
                            -- OJO: '0' entre comillas. Magnitud es NVARCHAR y guarda valores como '40.00';
                            -- con THEN 0 (int) el CASE resolvía a INT por precedencia de tipos y SQL Server
                            -- intentaba convertir la Magnitud a entero → "Conversion failed ... '40.00' to
                            -- data type int" en toda orden con decimales. Ambas ramas deben ser texto.
                            (CASE WHEN @IsSB = 1 THEN '0' ELSE Magnitud END), IdCabezalERP, ProximoServicio, @NotaFinal, NoDocERP,
                            GETDATE(), 1, Variante, UM,
                            IdClienteReact, CliIdCliente, CodCliente,
                            IdProductoReact, ProIdProducto, CodArticulo,
                            -- TELA DE CLIENTE (solo sublimación): la falla hereda la bobina de la madre
                            -- para mostrar el mismo material que la orden original (la planilla lo arma
                            -- desde InventarioBobinas). Fuera de SB queda NULL como antes.
                            CASE WHEN @IsSB = 1 THEN BobinaTelaID ELSE NULL END, 0
                        FROM dbo.Ordenes
                        WHERE OrdenID = @OldID;

                        UPDATE dbo.Ordenes
                        SET Observaciones = CONCAT(ISNULL(Observaciones,''), ' [Esperando Reposición]')
                        WHERE OrdenID = @OldID;

                        -- Registrar Falla en tabla auxiliar
                        INSERT INTO FallasProduccion(OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones, ImagenFalla, CopiasFalla, CopiaDesde)
                        VALUES(@OldID, @ArchivoID, @AreaID, GETDATE(), @TipoFallaID, @CantidadFalla, @EquipoID, @SafeMotivo, @ImagenFalla, @CopiasFallaReg, @CopiaDesde);
                    `);

                // Obtener el ID de la nueva orden recién insertada
                const newOrderRes = await new sql.Request(transaction).query("SELECT TOP 1 OrdenID FROM dbo.Ordenes ORDER BY OrdenID DESC");
                newOrderId = newOrderRes.recordset[0]?.OrdenID;

                // [REQUISITOS] La -F se produce con la misma tela/prenda/matriz que la madre: hereda
                // lo que la madre ya tiene CUMPLIDO (ej. TELA "Asignado: bobina X" en SB). Sin esto
                // nacía con todo pendiente y quedaba para siempre en "Esperando requisitos" de
                // Planificación (bug real 9-oct-2026). Mismo criterio que cadenaReposicionService.
                if (newOrderId) {
                    try {
                        await heredarRequisitosCumplidos(transaction, ordenId, newOrderId, 'orden de falla');
                    } catch (eReq) {
                        logger.warn(`[postControlArchivo] No se pudieron heredar requisitos a la falla ${nuevoCodigo}: ${eReq.message}`);
                    }
                }
            }

            try {
                const { changeOrderState } = require('../services/stateManagerService');
                await changeOrderState(transaction, {
                    target: { type: 'ORDER', id: ordenId },
                    estado: 'Con Falla',
                    userObj: req.user || usuario || 'Sistema',
                    detalle: 'Falla de impresión reportada',
                    io: req.app.get('socketio')
                });
            } catch (errSync) {
                logger.error('Error sincronizando estado a En falla la orden madre:', errSync);
            }

            if (newOrderId) {
                // En SB la -F mide 0m (metros del archivo = 0). Si no, se mantiene la lógica anterior.
                // OJO: en el UPDATE hay JOIN de dos ArchivosOrden (AO2/AO_SRC) → la columna "Metros"
                // desnuda es ambigua, se califica con AO_SRC. En el INSERT (una sola tabla) va desnuda.
                const metrosUpd = esFallaSB ? `0` : (metrosReponer !== null ? `@MetrosReponer` : `AO_SRC.Metros`);
                const metrosIns = esFallaSB ? `0` : (metrosReponer !== null ? `@MetrosReponer` : `Metros`);
                // FALLA POR COPIAS: la -F lleva SOLO las f copias falladas (no las Copias completas
                // del original, que era el "repone de más"). Al REUTILIZAR una -F que ya tenía este
                // archivo, las copias se SUMAN (falla de hoy + falla de ayer) y los metros también.
                // Sin parcial (legacy): clona Copias y pisa Metros, como siempre.
                const fCopias    = req._fallaCopias ? req._fallaCopias.f : null;
                const copiasUpd  = fCopias !== null ? `ISNULL(AO2.Copias, 1) + @CopiasF` : `AO2.Copias`;
                const copiasIns  = fCopias !== null ? `@CopiasF` : `Copias`;
                const metrosUpd2 = (fCopias !== null && metrosReponer !== null && !esFallaSB)
                    ? `ISNULL(AO2.Metros, 0) + @MetrosReponer` : metrosUpd;

                const insertRequest = new sql.Request(transaction)
                    .input('NewOrderID', sql.Int, newOrderId)
                    .input('OldFileID', sql.Int, archivoId);

                if (metrosReponer !== null) {
                    insertRequest.input('MetrosReponer', sql.Decimal(10, 2), metrosReponer);
                }
                if (fCopias !== null) {
                    insertRequest.input('CopiasF', sql.Int, fCopias);
                }

                // Si el archivo ya existe en la orden -F (mismo NombreArchivo),
                // actualizar sus metros en lugar de duplicarlo
                // Las observaciones se HEREDAN de la madre y la nota de reposición se anexa. Pisarlas
                // con un texto fijo borraba el detalle técnico de impresión ([RAPORT] ORIG: ... ->
                // FINAL: ...), que es de donde se deduce el modo de impresión: la -F nacía sin saber
                // que iba con rapport y el ojo del lote se veía gris. Se reconstruye siempre desde la
                // madre (no se acumula al reprocesar) y la nota va una sola vez.
                await insertRequest.query(`
                    -- Si ya existe el archivo, actualizar metros y copias (parcial: SUMA acumulada)
                    UPDATE AO2
                    SET AO2.Metros = ${metrosUpd2},
                        AO2.Copias = ${copiasUpd},
                        AO2.Observaciones = CASE
                            WHEN ISNULL(AO_SRC.Observaciones, '') LIKE '%Reposición por Falla%'
                                THEN AO_SRC.Observaciones
                            ELSE LTRIM(RTRIM(ISNULL(AO_SRC.Observaciones, ''))) + ' [Reposición por Falla]'
                        END
                    FROM dbo.ArchivosOrden AO2
                    INNER JOIN dbo.ArchivosOrden AO_SRC ON AO_SRC.ArchivoID = @OldFileID
                    WHERE AO2.OrdenID = @NewOrderID
                      AND AO2.NombreArchivo = AO_SRC.NombreArchivo;

                    -- Si no existía, insertar (parcial: con las f copias falladas, no todas)
                    IF @@ROWCOUNT = 0
                    BEGIN
                        INSERT INTO dbo.ArchivosOrden(
                            OrdenID, NombreArchivo, RutaAlmacenamiento, Metros, Copias, Ancho, Alto, Observaciones,
                            TipoArchivo, FechaSubida, EstadoArchivo
                        )
                        SELECT
                            @NewOrderID, NombreArchivo, RutaAlmacenamiento, ${metrosIns}, ${copiasIns}, Ancho, Alto,
                            CASE
                                WHEN ISNULL(Observaciones, '') LIKE '%Reposición por Falla%' THEN Observaciones
                                ELSE LTRIM(RTRIM(ISNULL(Observaciones, ''))) + ' [Reposición por Falla]'
                            END,
                            TipoArchivo, GETDATE(), 'Pendiente'
                        FROM dbo.ArchivosOrden
                        WHERE ArchivoID = @OldFileID
                    END
                `);

                // DTF: la -F reimprime el mismo arte → lleva la misma plancha de tinta blanca.
                try {
                    await require('../services/dtfBlancoService').copiarTintaBlanca(transaction, newOrderId, [archivoId]);
                } catch (eTb) {
                    logger.warn(`[falla] no se pudo copiar la tinta blanca del archivo ${archivoId}: ${eTb.message}`);
                }

                // Miniatura para planta: el clon de la -F apunta al MISMO archivo de Drive que el
                // original — se copia su miniatura al ArchivoID nuevo (fs local, sin Drive), así
                // Control y el modal de falla tienen vista previa cuando la -F se controla.
                try {
                    const thumbRes = await new sql.Request(transaction)
                        .input('NewOrderIDT', sql.Int, newOrderId)
                        .input('OldFileIDT', sql.Int, archivoId)
                        .query(`
                            SELECT TOP 1 ao.ArchivoID AS NuevoId,
                                   (SELECT CodigoOrden FROM dbo.Ordenes WHERE OrdenID = @NewOrderIDT) AS CodFalla,
                                   (SELECT o2.CodigoOrden FROM dbo.ArchivosOrden a2
                                    JOIN dbo.Ordenes o2 ON o2.OrdenID = a2.OrdenID
                                    WHERE a2.ArchivoID = @OldFileIDT) AS CodMadre
                            FROM dbo.ArchivosOrden ao
                            WHERE ao.OrdenID = @NewOrderIDT
                              AND ao.NombreArchivo = (SELECT NombreArchivo FROM dbo.ArchivosOrden WHERE ArchivoID = @OldFileIDT)
                            ORDER BY ao.ArchivoID DESC
                        `);
                    const t = thumbRes.recordset?.[0];
                    if (t && t.NuevoId) {
                        const { copyThumbnail } = require('../utils/thumbnailGenerator');
                        copyThumbnail(t.CodMadre, archivoId, t.CodFalla, t.NuevoId);
                    }
                } catch (eThumb) {
                    logger.warn(`[FALLA] No se pudo copiar la miniatura a la -F: ${eThumb.message}`);
                }

                // Actualizar ArchivosCount con el total real de archivos de la orden
                await new sql.Request(transaction)
                    .input('FallaOrderID', sql.Int, newOrderId)
                    .query(`
                        UPDATE dbo.Ordenes
                        SET ArchivosCount = (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = @FallaOrderID)
                        WHERE OrdenID = @FallaOrderID
                    `);

                // Actualizar Magnitud con la suma real de lo que repone la -F.
                // · Legacy (sin f): solo si quedó en 0 (la madre pudo tener Magnitud=0 por el ERP sync).
                // · FALLA POR COPIAS: SIEMPRE — la -F repone f copias / metros cargados, y al reutilizarse
                //   acumula; la Magnitud tiene que seguir esa suma (mismo criterio por UM que usa la -R:
                //   metros si UM='m…', copias si no; SB queda afuera: su Magnitud la carga la impresora).
                const magnitudReq = new sql.Request(transaction).input('FallaOrderID2', sql.Int, newOrderId);
                if (fCopias !== null && !esFallaSB) {
                    await magnitudReq.query(`
                        DECLARE @UM NVARCHAR(20) = (SELECT LTRIM(RTRIM(ISNULL(UM,'u'))) FROM dbo.Ordenes WHERE OrdenID = @FallaOrderID2);
                        DECLARE @Total FLOAT = 0;
                        IF LEFT(LOWER(@UM),1) = 'm'
                            SELECT @Total = ISNULL(SUM(CAST(ISNULL(Metros,0) AS FLOAT)),0) FROM dbo.ArchivosOrden WHERE OrdenID = @FallaOrderID2 AND ISNULL(EstadoArchivo,'') <> 'CANCELADO';
                        ELSE
                            SELECT @Total = ISNULL(SUM(CAST(ISNULL(Copias,0) AS FLOAT)),0) FROM dbo.ArchivosOrden WHERE OrdenID = @FallaOrderID2 AND ISNULL(EstadoArchivo,'') <> 'CANCELADO';
                        UPDATE dbo.Ordenes SET Magnitud = CAST(FORMAT(@Total,'0.##') AS NVARCHAR(20))
                        WHERE OrdenID = @FallaOrderID2;
                    `);
                } else {
                    await magnitudReq.query(`
                        UPDATE dbo.Ordenes
                        SET Magnitud = CAST(ISNULL(
                            (SELECT SUM(ISNULL(Metros, 0)) FROM dbo.ArchivosOrden WHERE OrdenID = @FallaOrderID2),
                            TRY_CAST(Magnitud AS DECIMAL(10,2))
                        ) AS NVARCHAR(50))
                        WHERE OrdenID = @FallaOrderID2
                          AND (Magnitud IS NULL OR TRY_CAST(Magnitud AS DECIMAL(10,2)) = 0 OR Magnitud = '' OR Magnitud = '0')
                    `);
                }
            }

            // ── Capturar hermanas que ya estaban en Canasto Produccion (retroactivas) ──
            let ordenesRetroactivas = [];
            if (noDocERP) {
                const retRes = await new sql.Request(transaction)
                    .input('NoDoc',  sql.VarChar(50), noDocERP)
                    .input('AreaID', sql.VarChar(50), areaId)
                    .input('OID',    sql.Int,         ordenId)
                    .query(`SELECT CodigoOrden FROM Ordenes
                             WHERE NoDocERP = @NoDoc
                               AND AreaID   = @AreaID
                               AND OrdenID != @OID
                               AND EstadoLogistica = 'Canasto Produccion'
                               AND Estado NOT IN ('CANCELADO') AND ISNULL(EstadoenArea,'') NOT IN ('Retenido', 'RETENIDO')`);
                ordenesRetroactivas = retRes.recordset.map(r => r.CodigoOrden);
            }

            // ── Mover todas las órdenes hermanas del área a "Canasto Falla" ──
            // Incluye la orden actual y todas las del mismo pedido (NoDocERP) en el área
            if (noDocERP) {
                await new sql.Request(transaction)
                    .input('NoDoc',  sql.VarChar(50), noDocERP)
                    .input('AreaID', sql.VarChar(50), areaId)
                    .query(`UPDATE Ordenes
                               SET EstadoLogistica = 'Canasto Falla'
                             WHERE NoDocERP = @NoDoc
                               AND AreaID   = @AreaID
                               AND Estado  NOT IN ('CANCELADO') AND ISNULL(EstadoenArea,'') NOT IN ('Retenido', 'RETENIDO')`);
            } else {
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .query(`UPDATE Ordenes SET EstadoLogistica = 'Canasto Falla' WHERE OrdenID = @OID`);
            }

            // Guardar para incluir en la respuesta final
            req._fallaData = { fallaDetectada: true, ordenesRetroactivas };

            // ── ETIQUETA DE FALLA: una sola por archivo, al quedar RESUELTO ──
            // Whole-file (sin f) y servicios quedan resueltos en este mismo reporte; con falla
            // por copias, recién cuando esta falla consumió lo último contable. Si todavía
            // quedan copias buenas por contar, la etiqueta la dispara updateFileCopyCount al
            // contarse la última.
            const itemResuelto = isService ? true : (req._fallaCopias ? !req._fallaCopias.quedanBuenas : true);
            if (itemResuelto) {
                try {
                    req._etiquetaFalla = {
                        imprimirEtiquetaFalla: true,
                        fallasArchivo: await getFallasDeArchivo(transaction, archivoId),
                    };
                } catch (eEtq) {
                    logger.warn('[postControlArchivo] No se pudieron leer las fallas para la etiqueta:', eEtq.message);
                }
            }
        }

        // 4. Verificación de Completitud
        // A. Local Stats (para la orden actual)
        const checkRequest = new sql.Request(transaction);
        const stats = await checkRequest.input('OID', sql.Int, ordenId).query(`
            SELECT
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID) + (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID) as Total,
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo IN('OK', 'Finalizado', 'CANCELADO', 'FALLA')) +
                (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado IN('OK', 'Finalizado', 'CANCELADO', 'FALLA')) as Controlados,
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND (EstadoArchivo IS NULL OR EstadoArchivo NOT IN('OK', 'Finalizado', 'CANCELADO', 'FALLA'))) +
                (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND (Estado IS NULL OR Estado NOT IN('OK', 'Finalizado', 'CANCELADO', 'FALLA'))) as Pendientes,
                -- Falla por copias: un archivo con CopiasFalladas>0 TIENE falla aunque su estado siga
                -- 'Pendiente' (quedan copias buenas por contar) — la orden debe verse 'Con Falla' igual.
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND (EstadoArchivo = 'FALLA' OR ISNULL(CopiasFalladas, 0) > 0)) + (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado = 'FALLA') as Fallas,
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo = 'CANCELADO') + (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado = 'CANCELADO') as Cancelados
    `);

        const { Total, Controlados: rawControlados, Pendientes, Fallas, Cancelados } = stats.recordset[0];

        // Corregir nulos
        const safeControlados = rawControlados || 0;
        const safePendientes = Pendientes || 0;
        const safeTotal = Total || 0;

        let orderCompleted = false; // Flag para la generación de etiquetas
        let totalBultos = 0;
        let etiquetasError = null;  // motivo por el que no se generaron, para avisar en pantalla

        // B. Verificación GLOBAL (Pedido Completo EN EL ÁREA ACTUAL)
        let groupCompleted = true;

        if (noDocERP) {
            const gStats = await new sql.Request(transaction)
                .input('NoDoc', sql.VarChar(50), noDocERP)
                .input('AreaID', sql.VarChar(50), areaId)
                .query(`
                SELECT 
                    (SELECT COUNT(*) FROM ArchivosOrden AO INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID WHERE O.NoDocERP = @NoDoc AND O.AreaID = @AreaID AND (O.Estado IS NULL OR O.Estado != 'CANCELADO') AND (AO.EstadoArchivo IS NULL OR AO.EstadoArchivo NOT IN('OK', 'Finalizado', 'CANCELADO', 'FALLA'))) +
                    (SELECT COUNT(*) FROM ServiciosExtraOrden SEO INNER JOIN Ordenes O ON SEO.OrdenID = O.OrdenID WHERE O.NoDocERP = @NoDoc AND O.AreaID = @AreaID AND (O.Estado IS NULL OR O.Estado != 'CANCELADO') AND (SEO.Estado IS NULL OR SEO.Estado NOT IN('OK', 'Finalizado', 'CANCELADO', 'FALLA'))) as Pendientes
             `);
            if ((gStats.recordset[0].Pendientes || 0) > 0) {
                groupCompleted = false;
            }
        } else {
            // Si no hay NoDocERP, la completitud del "grupo" es la completitud de la orden local
            if (safePendientes > 0 || safeControlados < safeTotal) groupCompleted = false;
        }

        // LÓGICA DE ACTUALIZACIÓN DE ESTADOS
        const isReposicion = codigoOrden.includes('-F');   // (mal nombrada: -F = FALLA, no reposición)
        const esRepoCliente = codigoOrden.includes('-R');  // -R = reposición de cliente (orden independiente)
        let nuevoEstado = null;
        let destinoLogistica = null;

        if (safePendientes > 0 || safeControlados < safeTotal) {
            // A. ORDEN INCOMPLETA LOCALMENTE -> Estado 'Produccion'
            // Diferenciar entre "Sin Tocar" y "En Curso"
            let nuevoEstadoArea = 'Control y Calidad';
            let detalleEstado = 'Control parcial (Pedido incompleto)';
            
            if (safeControlados > 0) {
                nuevoEstadoArea = 'En Curso';
            }
            if (Fallas > 0) {
                nuevoEstadoArea = 'Con Falla';
                detalleEstado = 'Control parcial (Con fallas)';
            }

            await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                .query(`UPDATE Ordenes SET EstadoLogistica = 'Canasto Incompletos' WHERE OrdenID = @OID`);
            await changeOrderState(transaction, { target: { type: 'ORDER', id: ordenId }, estado: nuevoEstadoArea, userObj: req.user || 'Sistema', detalle: detalleEstado,
                io       : req.app.get('socketio')
            });

        } else if (!groupCompleted) {
            // B. ORDEN COMPLETA LOCALMENTE, PERO PEDIDO INCOMPLETO EN ÁREA -> Estado 'Produccion' (Espera)
            // 'Control y Calidad' deriva a Estado general 'Produccion' (ConfigEstados) -> mismo valor que el crudo anterior.
            // OJO: si la orden tiene archivos en FALLA, el estado es 'Con Falla' — como en las otras dos
            // ramas. Esta rama no lo miraba y PISABA el 'Con Falla' recién puesto: al controlar el resto
            // de los archivos de una orden que ya tenía una falla, la orden volvía a 'Control y Calidad'
            // y la falla dejaba de verse (la madre quedaba como si nada, esperando una reposición invisible).
            await changeOrderState(transaction, {
                target : { type: 'ORDER', id: ordenId },
                estado : Fallas > 0 ? 'Con Falla' : 'Control y Calidad',
                userObj: req.user || 'Sistema',
                detalle: Fallas > 0 ? 'Con fallas (pedido incompleto en área)' : 'Pedido incompleto en área (espera)',
                io     : req.app.get('socketio'),
            });

        } else {
            // C. PEDIDO COMPLETO EN ÁREA (Orden Local Done + Grupo Area Completo)

            // Si todos los archivos de la orden actual están cancelados, la orden se cancela.
            if (Cancelados === Total && Total > 0) {
                await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                    .query("UPDATE Ordenes SET EstadoLogistica='Cancelado', Observaciones = 'Cancelada de oficio (Todos archivos cancelados)' WHERE OrdenID = @OID");
                // Tela cliente: devolver los metros consumidos también en la cancelación de oficio (idempotente).
                await devolverMetrosTelaCliente(transaction, ordenId, `Devolución por cancelación de oficio Orden ${ordenId}`, req.user?.id || 1);
                await changeOrderState(transaction, { target: { type: 'ORDER', id: ordenId }, estado: 'Cancelado', userObj: req.user || 'Sistema', detalle: 'Cancelada de oficio (Todos archivos cancelados)',
                io       : req.app.get('socketio')
            });
            } else {

                // Definir estados finales
                nuevoEstado = 'Pronto';
                let nuevoEstadoArea = 'Pronto';
                destinoLogistica = 'Canasto Produccion';

                if (Fallas > 0) {
                    nuevoEstado = 'Retenido';
                    nuevoEstadoArea = 'Con Falla';
                    destinoLogistica = 'Esperando Reposición';
                } else if (isReposicion) {
                    // -F (falla interna): su material se incorpora a la madre y NO se despacha sola,
                    // por lo que nunca pasa por recepción/logística → si quedaba en 'Pronto' se colgaba
                    // en general 'Produccion' para siempre. Al completar sin fallas finaliza directo.
                    nuevoEstado = 'Finalizado';
                    nuevoEstadoArea = 'Finalizado';
                    destinoLogistica = 'Canasto Reposiciones';
                }

                // Verificar si alguna hermana del pedido (mismo NoDocERP + AreaID) tiene fallas
                // → si sí, esta orden también va a "Canasto Falla" aunque sus propios archivos estén OK
                if (noDocERP && destinoLogistica === 'Canasto Produccion') {
                    const fallaHermanaRes = await new sql.Request(transaction)
                        .input('NoDoc',  sql.VarChar(50), noDocERP)
                        .input('AreaID', sql.VarChar(50), areaId)
                        .input('OID',    sql.Int,         ordenId)
                        .query(`
                            SELECT COUNT(*) as TieneFalla
                            FROM ArchivosOrden AO
                            INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                            WHERE O.NoDocERP = @NoDoc
                              AND O.AreaID   = @AreaID
                              AND O.OrdenID != @OID
                              AND (AO.EstadoArchivo = 'FALLA' OR ISNULL(AO.CopiasFalladas, 0) > 0)
                        `);
                    const tieneFallaHermana = (fallaHermanaRes.recordset[0]?.TieneFalla || 0) > 0;
                    if (tieneFallaHermana) {
                        destinoLogistica = 'Canasto Falla';
                        logger.info(`[postControlArchivo] Orden ${ordenId} OK pero hermana tiene FALLA → Canasto Falla`);
                    }
                }

                // ── ¿Está el pedido COMPLETAMENTE resuelto para poder liberar el Canasto Falla? ──
                // Condición: ninguna orden del pedido tiene archivos pendientes o en FALLA
                // (incluye las órdenes de reposición -F creadas)
                if (noDocERP && destinoLogistica === 'Canasto Falla') {
                    const liberacionRes = await new sql.Request(transaction)
                        .input('NoDoc',  sql.VarChar(50), noDocERP)
                        .input('AreaID', sql.VarChar(50), areaId)
                        .query(`
                            -- Archivos sin resolver (Pendiente, FALLA o con copias falladas sin reponer)
                            -- de CUALQUIER orden del pedido en el área
                            SELECT COUNT(*) as SinResolver
                            FROM ArchivosOrden AO
                            INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                            WHERE O.NoDocERP = @NoDoc
                              AND O.AreaID   = @AreaID
                              AND O.Estado  NOT IN ('CANCELADO')
                              AND (AO.EstadoArchivo IS NULL
                                OR AO.EstadoArchivo NOT IN ('OK','Finalizado','CANCELADO')
                                OR ISNULL(AO.CopiasFalladas, 0) > 0)
                        `);
                    const sinResolver = (liberacionRes.recordset[0]?.SinResolver || 0);
                    if (sinResolver === 0) {
                        // ¡Todo OK! Recopilar qué órdenes están en Canasto Falla para liberarlas
                        const enFallaRes = await new sql.Request(transaction)
                            .input('NoDoc',  sql.VarChar(50), noDocERP)
                            .input('AreaID', sql.VarChar(50), areaId)
                            .query(`SELECT OrdenID, CodigoOrden FROM Ordenes
                                     WHERE NoDocERP = @NoDoc
                                       AND AreaID   = @AreaID
                                       AND EstadoLogistica = 'Canasto Falla'
                                       AND Estado NOT IN ('CANCELADO')`);
                        const ordenesParaLiberar = enFallaRes.recordset.map(r => r.CodigoOrden);
                        if (ordenesParaLiberar.length > 0) {
                            logger.info(`[postControlArchivo] Pedido ${noDocERP} RESUELTO → listoParaProduccion: ${ordenesParaLiberar.join(', ')}`);
                            req._liberacionData = { listoParaProduccion: true, ordenesParaLiberar };
                        }
                    }
                }

                // ACTUALIZACIÓN DE ESTADOS
                if (isReposicion || esRepoCliente) {
                    // Falla o reposición: solo se actualiza a sí misma (no cascadea al pedido madre)
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, ordenId)
                        .query(`UPDATE Ordenes SET EstadoLogistica = '${destinoLogistica}' WHERE OrdenID = @OID`);
                    if (nuevoEstadoArea === 'Pronto') await marcarImpresaAlCompletar(transaction, ordenId);
                    await changeOrderState(transaction, { target: { type: 'ORDER', id: ordenId }, estado: nuevoEstadoArea, userObj: req.user || 'Sistema', detalle: 'Control finalizado (Reposición)',
                guard    : "Estado NOT IN ('Finalizado', 'Ingresado', 'Avisado', 'Entregado', 'Cancelado')",
                io       : req.app.get('socketio')
            });
                } else {
                    // ECOUV: una orden con terminaciones PENDIENTES no va a logística al salir
                    // de control — pasa a 'En Terminaciones' (la trabaja la bandeja de
                    // Terminaciones ECOUV; su botón "Finalizar Tarea" la manda a Pronto/Canasto).
                    const ordenesConTermPend = new Set();
                    if (areaId === 'ECOUV' && destinoLogistica === 'Canasto Produccion') {
                        try {
                            // Las filas de OrdenTerminaciones pueden apuntar a la orden ECOUV (legacy)
                            // o ya a su hermana XEUV/TERMINAC (modelo actual: se crea al ingresar el
                            // pedido). El ArchivoID SIEMPRE apunta a los archivos de la ECOUV, así que
                            // se mapea por archivo para encontrar la orden dueña.
                            const termReq = new sql.Request(transaction).input('OID', sql.Int, ordenId);
                            let termQuery;
                            if (noDocERP) {
                                termReq.input('NoDoc', sql.VarChar(50), noDocERP).input('AreaID', sql.VarChar(50), areaId);
                                termQuery = `SELECT DISTINCT AO.OrdenID FROM OrdenTerminaciones OT
                                             INNER JOIN ArchivosOrden AO ON AO.ArchivoID = OT.ArchivoID
                                             INNER JOIN Ordenes O ON O.OrdenID = AO.OrdenID
                                             WHERE O.NoDocERP = @NoDoc AND O.AreaID = @AreaID AND OT.Estado = 'Pendiente'`;
                            } else {
                                termQuery = `SELECT DISTINCT ISNULL(AO.OrdenID, OT.OrdenID) AS OrdenID
                                             FROM OrdenTerminaciones OT
                                             LEFT JOIN ArchivosOrden AO ON AO.ArchivoID = OT.ArchivoID
                                             WHERE (OT.OrdenID = @OID OR AO.OrdenID = @OID) AND OT.Estado = 'Pendiente'`;
                            }
                            (await termReq.query(termQuery)).recordset.forEach(r => ordenesConTermPend.add(r.OrdenID));
                        } catch (eTerm) {
                            logger.warn('[postControlArchivo] No se pudo evaluar terminaciones pendientes:', eTerm.message);
                        }
                    }
                    // TERMINACIONES COMO ÁREA: la orden ECOUV sale por el camino NORMAL
                    // (Pronto/Canasto) con ProximoServicio=TERMINAC. La hermana XEUV
                    // contenedora se crea DESDE EL INGRESO del pedido (webOrdersController);
                    // este llamado queda como red de seguridad para órdenes anteriores al
                    // cambio (el helper es idempotente: si ya existe hermana, no hace nada).
                    const { crearHermanaTerminaciones } = require('../utils/hermanaTerminaciones');
                    const crearHermanaTerminac = async (ecouvId) => {
                        const creada = await crearHermanaTerminaciones(transaction, ecouvId);
                        if (!creada) return;
                        await changeOrderState(transaction, {
                            target: { type: 'ORDER', id: creada.hermanaId },
                            estado: 'Pendiente',
                            userObj: req.user || 'Sistema',
                            detalle: `Orden de terminaciones creada (${creada.cantTerm} terminaciones)`,
                            io: req.app.get('socketio')
                        });
                    };

                    const detalleDe = (oid) => ordenesConTermPend.has(oid) ? 'Control OK — sale hacia Terminaciones (TERMINAC)' : 'Control finalizado en Área';

                    // Orden Normal -> Actualizar al Grupo Completo en el AREA
                    // (todas siguen el camino normal Pronto/Canasto; las que tienen
                    // terminaciones además generan su hermana TERMINAC y salen ruteadas
                    // al local de terminaciones vía ProximoServicio)
                    if (noDocERP) {
                        const grp = await new sql.Request(transaction)
                            .input('NoDoc', sql.VarChar(50), noDocERP)
                            .input('AreaID', sql.VarChar(50), areaId)
                            .query(`SELECT OrdenID FROM Ordenes WHERE NoDocERP = @NoDoc AND AreaID = @AreaID AND Estado != 'CANCELADO' AND ISNULL(EstadoenArea,'') != 'Retenido'`);
                        for (const o of grp.recordset) {
                            await new sql.Request(transaction)
                                .input('OID', sql.Int, o.OrdenID)
                                .query(`UPDATE Ordenes SET EstadoLogistica = '${destinoLogistica}' WHERE OrdenID = @OID`);
                            if (nuevoEstadoArea === 'Pronto') await marcarImpresaAlCompletar(transaction, o.OrdenID);
                            await changeOrderState(transaction, { target: { type: 'ORDER', id: o.OrdenID }, estado: nuevoEstadoArea, userObj: req.user || 'Sistema', detalle: detalleDe(o.OrdenID),
                guard    : "Estado NOT IN ('Finalizado', 'Ingresado', 'Avisado', 'Entregado', 'Cancelado')",
                io       : req.app.get('socketio')
            });
                            if (ordenesConTermPend.has(o.OrdenID)) {
                                await crearHermanaTerminac(o.OrdenID);
                            }
                        }
                    } else {
                        await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                            .query(`UPDATE Ordenes SET EstadoLogistica = '${destinoLogistica}' WHERE OrdenID = @OID`);
                        if (nuevoEstadoArea === 'Pronto') await marcarImpresaAlCompletar(transaction, ordenId);
                        await changeOrderState(transaction, { target: { type: 'ORDER', id: ordenId }, estado: nuevoEstadoArea, userObj: req.user || 'Sistema', detalle: detalleDe(ordenId),
                guard    : "Estado NOT IN ('Finalizado', 'Ingresado', 'Avisado', 'Entregado', 'Cancelado')",
                io       : req.app.get('socketio')
            });
                        if (ordenesConTermPend.has(ordenId)) {
                            await crearHermanaTerminac(ordenId);
                        }
                    }
                }

                orderCompleted = true; // Habilitar generación de etiquetas

                // --- LÓGICA DE CIERRE DE REPOSICIÓN (LIBERAR PADRE) ---
                if (isReposicion && Fallas === 0) {
                    // Cura la familia (ver sanarFamiliaTrasReposicion). Antes este bloque vivía acá
                    // inline y por eso no corría al cerrar la -F con el botón "CORREGIR FALLA".
                    try {
                        await sanarFamiliaTrasReposicion(transaction, { ordenId, codigoOrden, noDocERP, areaId });

                        // Tras curar, si el pedido quedó COMPLETAMENTE resuelto, avisar al frontend para liberar
                        // el Canasto Falla — mismo flujo/modal que una orden normal (el operario confirma y
                        // liberarCanastaFalla mueve la madre + los eslabones -F a 'Canasto Produccion' por NoDocERP).
                        // El bloque de líneas ~777 NO se dispara al completar una reposición (su destino es
                        // 'Canasto Reposiciones', no 'Canasto Falla'), así que la señal de liberación se emite acá.
                        // OJO: el guard viejo 'EstadoenArea = Retenido' nunca matcheaba — una orden en falla queda
                        // en EstadoLogistica='Canasto Falla' (EstadoenArea sigue siendo 'Control y Calidad', etc.).
                        // Sin NoDocERP (orden suelta) no hay pedido que liberar: basta con la cura de archivos de arriba.
                        if (noDocERP) {
                            const chkResuelto = await new sql.Request(transaction)
                                .input('NoDoc',  sql.VarChar(50), noDocERP)
                                .input('AreaID', sql.VarChar(50), areaId)
                                .query(`
                                    SELECT COUNT(*) AS SinResolver
                                    FROM ArchivosOrden AO
                                    INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                                    WHERE O.NoDocERP = @NoDoc AND O.AreaID = @AreaID
                                      AND O.Estado NOT IN ('CANCELADO')
                                      AND (AO.EstadoArchivo IS NULL OR AO.EstadoArchivo NOT IN ('OK','Finalizado','CANCELADO')
                                        OR ISNULL(AO.CopiasFalladas, 0) > 0)
                                `);
                            if ((chkResuelto.recordset[0]?.SinResolver || 0) === 0) {
                                const enFalla = await new sql.Request(transaction)
                                    .input('NoDoc',  sql.VarChar(50), noDocERP)
                                    .input('AreaID', sql.VarChar(50), areaId)
                                    .query(`SELECT CodigoOrden FROM Ordenes
                                             WHERE NoDocERP = @NoDoc AND AreaID = @AreaID
                                               AND EstadoLogistica = 'Canasto Falla' AND Estado NOT IN ('CANCELADO')`);
                                const ordenesParaLiberar = enFalla.recordset.map(r => r.CodigoOrden);
                                if (ordenesParaLiberar.length > 0) {
                                    req._liberacionData = { listoParaProduccion: true, ordenesParaLiberar };
                                    logger.info(`[postControlArchivo] Reposición ${codigoOrden} completada → pedido ${noDocERP} resuelto. Listo para liberar: ${ordenesParaLiberar.join(', ')}`);
                                }
                            }
                        }
                    } catch (e) { logger.error("Error curando/evaluando liberación tras reposición", e); }
                }
            }
        }
        if (orderCompleted) {
            // Ya no calculamos bultos manualmente aquí dentro de la transacción.
            // Delegamos todo al servicio post-commit.
            logger.info(`[postControlArchivo] Orden ${ordenId} COMPLETADA. Commiteando transacción principal y generando etiquetas...`);
        }

        await transaction.commit(); // COMMIT PRINCIPAL

        // --- AUTO-CLEANUP: Si la orden pertenecía a un lote, cerrarlo si ya no le quedan órdenes activas ---
        // (helper compartido: también corre al cancelar/finalizar órdenes fuera de Control)
        if (rolloId) {
            await cerrarLoteSiResuelto(rolloId, req.app.get('socketio'));
        }

        // --- RE-AVISO WSP: Si una reposición cliente (-R) se completó, resetear aviso de la madre ---
        if (orderCompleted && /-R\d+$/i.test(codigoOrden)) {
            try {
                const codigoMadreR = codigoOrden.replace(/-R\d+$/i, '');
                // Incluye madres divididas por tela con sufijo: 'SUB-154 (1/2)', 'SUB-154 (2/2)'
                const resetRes = await pool.request()
                    .input('CodigoMadre', sql.NVarChar, codigoMadreR)
                    .query(`
                        UPDATE OrdenesDeposito
                        SET OrdAvisoWsp = 0, OrdFechaAvisoWsp = NULL
                        WHERE (OrdCodigoOrden = @CodigoMadre OR OrdCodigoOrden LIKE @CodigoMadre + ' (%')
                          AND ISNULL(OrdAvisoWsp, 0) = 1
                    `);
                if (resetRes.rowsAffected[0] > 0) {
                    logger.info(`[postControlArchivo] ✅ Reposición ${codigoOrden} pronta → re-aviso WSP programado para orden madre ${codigoMadreR}`);
                }
            } catch (eReaviso) {
                logger.error(`[postControlArchivo] Error reseteando aviso WSP para madre de ${codigoOrden}: ${eReaviso.message}`);
            }
        }

        // --- GENERACIÓN DE ETIQUETAS POST-COMMIT (SI CORRESPONDE) ---
        if (orderCompleted) {
            try {
                // GUARD ANTI-DUPLICADO: verificar si ya existen etiquetas antes de generar.
                // Protege contra race conditions (doble-click, retry de red, socket concurrente).
                const existCheck = await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .query("SELECT COUNT(*) as cnt FROM Etiquetas WHERE OrdenID = @OID");
                const yaExisten = (existCheck.recordset[0]?.cnt || 0) > 0;

                if (yaExisten) {
                    totalBultos = existCheck.recordset[0].cnt;
                    logger.info(`[postControlArchivo] Orden ${ordenId} ya tiene ${totalBultos} etiqueta(s). Se omite regeneración (anti-duplicado).`);
                } else {
                    // Verificar magnitud desde PedidosCobranzaDetalle (cotización real del ERP Sync)
                    const checkMag = await pool.request()
                        .input('OID', sql.Int, ordenId)
                        .query("SELECT SUM(Cantidad) as TotalCantidad FROM PedidosCobranzaDetalle WHERE OrdenID = @OID");

                    const magVal = parseFloat(checkMag.recordset[0]?.TotalCantidad) || 0;

                    // Trabajo interno de un pedido con PRO: sin cotización propia a propósito.
                    const sinCotizacionPropia = magVal > 0 ? false : await esTrabajoInternoDePedidoConPro(pool, ordenId);
                    if (magVal > 0 || sinCotizacionPropia) {
                        logger.info(`[postControlArchivo] Llamando LabelGenerationService para Orden ${ordenId}...`);
                        const labelResult = await LabelGenerationService.regenerateLabelsForOrder(ordenId, (req.user?.id || 1), (req.user?.usuario || 'Sistema'));
                        if (labelResult.success) {
                            totalBultos = labelResult.totalBultos;
                            logger.info(`[postControlArchivo] Etiquetas generadas OK: ${totalBultos}`);
                        } else {
                            // Se devuelve a la pantalla: sin etiqueta no hay bulto y sin bulto
                            // no se puede armar el remito.
                            etiquetasError = labelResult.error;
                            logger.warn(`[postControlArchivo] Fallo generación etiquetas: ${labelResult.error}`);
                        }
                    } else {
                        etiquetasError = await mensajeSinCantidadCotizada(pool, ordenId);
                        logger.info(`[postControlArchivo] Magnitud 0, saltando etiquetas.`);
                    }
                }
            } catch (eLabels) {
                etiquetasError = eLabels.message;
                logger.error(`[postControlArchivo] Error generando etiquetas post-control: ${eLabels.message}`);
            }
        }

        // SOCKET EMIT
        if (req.app.get('socketio')) {
            req.app.get('socketio').emit('server:order_updated', { orderId: ordenId });
        }

        // Construir respuesta incluyendo datos de falla y/o liberación
        const fallaData = req._fallaData || {};
        const liberacionData = req._liberacionData || {};

        res.json({
            success: true,
            orderCompleted,
            totalBultos,
            etiquetasError,   // si viene, la orden quedó SIN etiqueta (no se puede despachar)
            nuevoEstado,
            destinoLogistica,
            proximoServicio,
            message: 'Estado actualizado correctamente',
            // Datos para modales del frontend:
            ...fallaData,       // { fallaDetectada, ordenesRetroactivas }
            ...liberacionData,  // { listoParaProduccion, ordenesParaLiberar }
            ...(req._etiquetaFalla || {}),  // { imprimirEtiquetaFalla, fallasArchivo } — archivo resuelto con fallas
        });

    } catch (err) {
        if (transaction) {
            try { await transaction.rollback(); } catch (e) { }
        }
        logger.error("Error en postControlArchivo:", err);
        res.status(500).json({ error: 'Error al controlar archivo', message: err.message, details: err.toString() });
    }
};

/**
 * 4. Obtener Tipos de Falla (Catálogo)
 */
// uso=produccion (default: lo que se ofrece al reportar una falla) o uso=reposicion (razones de la
// reposición de Atención al Cliente). Solo los activos. Con areaId, los de esa área más los 'General'
// (para todas las áreas; antes los General no salían en ninguna). Se administran en /admin/tipos-falla.
const getTiposFalla = async (req, res) => {
    try {
        const { areaId } = req.query;
        const uso = req.query.uso === 'reposicion' ? 'reposicion' : 'produccion';
        const pool = await getPool();

        let query = `SELECT FallaID, Titulo, DescripcionDefault, LTRIM(RTRIM(AreaID)) AS AreaID FROM TiposFallas
                     WHERE Activo = 1 AND ${uso === 'reposicion' ? 'EnReposicion = 1' : 'EnProduccion = 1'}`;
        if (areaId) {
            query += " AND (AreaID = @AreaID OR AreaID = 'General')";
        }
        query += " ORDER BY CASE WHEN AreaID = 'General' THEN 1 ELSE 0 END, EsFrecuente DESC, Titulo ASC";

        const request = pool.request();
        if (areaId) request.input('AreaID', sql.VarChar, areaId);

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        logger.error("Error getTiposFalla:", err);
        res.status(500).json({ error: 'Error al obtener tipos de falla' });
    }
};

// Imágenes de fallas ANOTADAS (recuadro dibujado) de una orden — para mostrar en el detalle (tab Referencias).
const getFallasImagenes = async (req, res) => {
    try {
        const { ordenId } = req.params;
        if (!ordenId) return res.status(400).json({ error: 'ordenId requerido' });
        const pool = await getPool();
        await ensureFallaColumn(pool);
        const result = await pool.request()
            .input('OID', sql.Int, Number(ordenId))
            .query(`
                -- La falla se registra contra la orden MADRE. Si @OID es una -F (reposición),
                -- resolvemos el código madre para mostrar igual las imágenes de la falla.
                DECLARE @Codigo NVARCHAR(100) = (SELECT CodigoOrden FROM Ordenes WHERE OrdenID = @OID);
                DECLARE @Madre NVARCHAR(100) = CASE
                    WHEN @Codigo LIKE '%-F[0-9]%' THEN LEFT(@Codigo, CHARINDEX('-F', @Codigo) - 1)
                    ELSE @Codigo END;

                SELECT fp.FallaID, fp.ArchivoID, fp.ImagenFalla, fp.FechaFalla, fp.Observaciones,
                       tf.Titulo AS TipoFalla, ao.NombreArchivo
                FROM FallasProduccion fp WITH(NOLOCK)
                JOIN Ordenes om WITH(NOLOCK) ON om.OrdenID = fp.OrdenID
                LEFT JOIN TiposFallas tf WITH(NOLOCK) ON tf.FallaID = fp.TipoFalla
                LEFT JOIN ArchivosOrden ao WITH(NOLOCK) ON ao.ArchivoID = fp.ArchivoID
                WHERE om.CodigoOrden = @Madre
                  AND fp.ImagenFalla IS NOT NULL AND LTRIM(RTRIM(fp.ImagenFalla)) <> ''
                ORDER BY fp.FechaFalla DESC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error("Error getFallasImagenes:", err);
        res.status(500).json({ error: err.message });
    }
};

// GET /orden/:ordenId/fallas — las fallas registradas para las líneas "FALLA:" de la nota de esta
// orden, con el NOMBRE del tipo. El detalle las usa para completar el motivo de las notas viejas, que
// solo llevaban el texto del operario ("Motivo: (sin especificar)" aunque hubiera tipo elegido).
// Cada falla agrega una línea a la nota de la -F y un registro en FallasProduccion contra la orden que
// falló (la madre o la -F anterior del linaje). Una -F que nace de otra HEREDA su nota (las líneas
// anteriores del linaje + la suya), y una orden deja de recibir líneas cuando se crea la -F siguiente
// del linaje. Se devuelven los registros del linaje hasta ese momento, con el lote de la orden que
// falló (la línea dice "Lote: …"), y el front los empareja de la línea más nueva a la más vieja.
const getFallasOrden = async (req, res) => {
    try {
        const ordenId = parseInt(req.params.ordenId, 10);
        if (!(ordenId > 0)) return res.status(400).json({ error: 'ordenId requerido' });
        const pool = await getPool();
        const result = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                DECLARE @Codigo NVARCHAR(100), @Ingreso DATETIME;
                SELECT @Codigo = CodigoOrden, @Ingreso = FechaIngreso FROM Ordenes WITH(NOLOCK) WHERE OrdenID = @OID;
                -- raíz del linaje: SUB-34096-F57092-2 → SUB-34096
                DECLARE @Raiz NVARCHAR(100) = CASE
                    WHEN @Codigo LIKE '%-F[0-9]%' THEN LEFT(@Codigo, CHARINDEX('-F', @Codigo) - 1)
                    ELSE @Codigo END;

                -- hasta que se creó la -F siguiente del linaje (desde ahí las fallas nuevas van a esa). El registro
                -- de una falla se graba milisegundos DESPUÉS de crear su -F: el corte es estricto en esa creación.
                DECLARE @Hasta DATETIME = (
                    SELECT MIN(FechaIngreso) FROM Ordenes WITH(NOLOCK)
                    WHERE CodigoOrden LIKE @Raiz + '-F%' AND CodigoOrden <> @Codigo AND FechaIngreso > @Ingreso);

                SELECT fp.FallaID, fp.ArchivoID, fp.FechaFalla, fp.Observaciones,
                       tf.Titulo AS TipoFalla, ao.NombreArchivo, r.Nombre AS Lote
                FROM FallasProduccion fp WITH(NOLOCK)
                JOIN Ordenes o WITH(NOLOCK) ON o.OrdenID = fp.OrdenID
                LEFT JOIN Rollos r WITH(NOLOCK) ON r.RolloID = o.RolloID
                LEFT JOIN TiposFallas tf WITH(NOLOCK) ON tf.FallaID = TRY_CAST(fp.TipoFalla AS INT)
                LEFT JOIN ArchivosOrden ao WITH(NOLOCK) ON ao.ArchivoID = fp.ArchivoID
                WHERE @Codigo IS NOT NULL
                  AND (o.CodigoOrden = @Raiz OR o.CodigoOrden LIKE @Raiz + '-F%')
                  AND (@Hasta IS NULL OR fp.FechaFalla < @Hasta)
                ORDER BY fp.FechaFalla, fp.FallaID
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('Error getFallasOrden:', err);
        res.status(500).json({ error: err.message });
    }
};

// Imágenes de falla (zona marcada) de TODAS las reposiciones -F de un lote, en una sola consulta:
// { [OrdenID de la -F]: [{ FallaID, ImagenFalla, FechaFalla, TipoFalla, NombreArchivo }] }.
// La falla se registra contra la MADRE; cada -F se asocia a las fallas de los archivos que repone por el
// NOMBRE del archivo (la -F clona NombreArchivo de la madre). Si ninguna coincide, van todas las de la
// madre. Para el detalle del lote (13/10/2026): ahí no se veía dónde estaba la falla.
const getFallasImagenesLote = async (req, res) => {
    try {
        const rolloId = parseInt(req.params.rolloId, 10);
        if (!(rolloId > 0)) return res.status(400).json({ error: 'rolloId requerido' });
        const pool = await getPool();
        await ensureFallaColumn(pool);
        const result = await pool.request()
            .input('R', sql.Int, rolloId)
            .query(`
                ;WITH F AS (
                    SELECT o.OrdenID, LEFT(o.CodigoOrden, CHARINDEX('-F', o.CodigoOrden) - 1) AS Madre
                    FROM Ordenes o WITH(NOLOCK)
                    WHERE o.RolloID = @R AND o.CodigoOrden LIKE '%-F[0-9]%'
                )
                SELECT F.OrdenID, fp.FallaID, fp.ImagenFalla, fp.FechaFalla, tf.Titulo AS TipoFalla, ao.NombreArchivo,
                       CASE WHEN EXISTS (SELECT 1 FROM ArchivosOrden af WITH(NOLOCK)
                                         WHERE af.OrdenID = F.OrdenID AND af.NombreArchivo = ao.NombreArchivo)
                            THEN 1 ELSE 0 END AS MismoArchivo
                FROM F
                JOIN Ordenes om WITH(NOLOCK) ON om.CodigoOrden = F.Madre
                JOIN FallasProduccion fp WITH(NOLOCK) ON fp.OrdenID = om.OrdenID
                LEFT JOIN TiposFallas tf WITH(NOLOCK) ON tf.FallaID = fp.TipoFalla
                LEFT JOIN ArchivosOrden ao WITH(NOLOCK) ON ao.ArchivoID = fp.ArchivoID
                WHERE LTRIM(RTRIM(ISNULL(fp.ImagenFalla, ''))) <> ''
                ORDER BY F.OrdenID, fp.FechaFalla DESC
            `);
        const porOrden = {};
        for (const r of result.recordset) (porOrden[r.OrdenID] = porOrden[r.OrdenID] || []).push(r);
        const data = {};
        for (const [oid, filas] of Object.entries(porOrden)) {
            const propias = filas.filter(f => f.MismoArchivo === 1);
            data[oid] = (propias.length ? propias : filas).map(({ MismoArchivo, OrdenID, ...f }) => f);
        }
        res.json({ success: true, data });
    } catch (err) {
        logger.error("Error getFallasImagenesLote:", err);
        res.status(500).json({ error: err.message });
    }
};

const getMotivosCancelacion = async (req, res) => {
    // Filtro por área via flags BIT de MotivosCancelacion: DF/DTF → columna DF, SB/SUB → columna SB.
    // Sin área (u otra área sin columna propia) → lista completa (comportamiento histórico).
    const area = String(req.query.area || '').toUpperCase();
    const col = (area === 'DF' || area === 'DTF') ? 'DF'
              : (area === 'SB' || area === 'SUB') ? 'SB'
              : null; // whitelist: col solo puede ser 'DF' o 'SB' (nunca input del usuario directo)
    try {
        const pool = await getPool();
        const where = col ? `WHERE ISNULL(${col}, 1) = 1` : '';
        const result = await pool.request().query(`SELECT MotivoID, Titulo, DescripcionDefault FROM MotivosCancelacion ${where} ORDER BY Titulo ASC`);
        res.json(result.recordset);
    } catch (err) {
        // Si la DB aún no tiene las columnas DF/SB, degradar a la lista completa en vez de romper el modal.
        try {
            const pool = await getPool();
            const result = await pool.request().query("SELECT MotivoID, Titulo, DescripcionDefault FROM MotivosCancelacion ORDER BY Titulo ASC");
            return res.json(result.recordset);
        } catch (e2) {
            logger.error("Error getMotivosCancelacion:", e2);
            res.status(500).json({ error: 'Error al obtener motivos de cancelación' });
        }
    }
};

const regenerateEtiquetas = async (req, res) => {
    // Extraer OrdenID (puede venir de params :id o de body)
    const ordenId = req.params.ordenId || req.body.ordenId;
    const userId = req.user?.id || 1;
    const userName = req.user?.usuario || 'Sistema';

    if (!ordenId) return res.status(400).json({ error: 'OrdenID es requerido' });

    logger.info(`[regenerateEtiquetas] Iniciando para Orden: ${ordenId} (User: ${userName})`);

    try {
        const cantidad = req.body.cantidad ? parseInt(req.body.cantidad) : null;
        const result = await LabelGenerationService.regenerateLabelsForOrder(ordenId, userId, userName, cantidad);

        if (!result.success) {
            logger.warn(`[regenerateEtiquetas] Falló validación para Orden ${ordenId}: ${result.error}`);
            return res.json({ success: false, error: result.error }); // Changed to 200 so axios doesn't throw
        }

        res.json({
            success: true,
            message: `Se han regenerado ${result.totalBultos} etiquetas correctamente.`,
            details: result
        });

    } catch (error) {
        logger.error("[regenerateEtiquetas] Error critico:", error);
        res.status(500).json({ error: "Error interno regenerando etiquetas: " + error.message });
    }
};

const recalcularContadoresEtiquetas = async (req, res) => {
    const ordenId = req.params.ordenId;
    if (!ordenId) return res.status(400).json({ error: 'OrdenID es requerido' });
    try {
        const result = await LabelGenerationService.recalcularContadores(parseInt(ordenId));
        if (!result.success) return res.json({ success: false, error: result.error });
        res.json({ success: true, message: `Contadores actualizados: ${result.totalBultos} bulto(s).`, totalBultos: result.totalBultos });
    } catch (error) {
        logger.error("[recalcularContadores] Error:", error);
        res.status(500).json({ error: "Error recalculando contadores: " + error.message });
    }
};
/**
 * 5. Proxy de Visualización de archivos en Drive
 * Utiliza el token del servidor para descargar y servir el archivo sin depender de permisos publicos.
 */
const viewDriveFile = async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send('Falta URL de Drive');

        // Extraer FileID usando Regex (más robusto)
        // Soporta: /d/ID/view, /open?id=ID, /file/d/ID, etc.
        const fileIdMatch = url.match(/[-\w]{25,}/);
        const fileId = fileIdMatch ? fileIdMatch[0] : null;

        if (!fileId) {
            logger.error("No se pudo identificar el FileID en:", url);
            return res.status(400).send('No se pudo identificar el FileID de Drive');
        }

        logger.info(`[Proxy] Solicitando archivo a Drive. ID: ${fileId}`);

        // Usamos la versión nueva que trae metadata (nombre, size, mimeType real)
        const { stream, mimeType, name, size } = await driveService.getFileStream(fileId);

        let finalMimeType = mimeType || 'application/octet-stream';

        // Si Drive nos da un tipo genérico o incorrecto, intentamos adivinar por la extensión del nombre
        if (name && (finalMimeType === 'application/octet-stream' || finalMimeType === 'application/vnd.google-apps.file')) {
            const ext = name.split('.').pop().toLowerCase();
            const mimeMap = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'pdf': 'application/pdf',
                'txt': 'text/plain',
                'json': 'application/json'
            };
            if (mimeMap[ext]) {
                finalMimeType = mimeMap[ext];
                logger.info(`[Proxy] MIME Type corregido por extensión (.${ext}): ${finalMimeType}`);
            }
        }

        res.setHeader('Content-Type', finalMimeType);
        if (size) res.setHeader('Content-Length', size);

        // Si el nombre no tiene extensión o termina en .dat, intentamos agregarle la extensión correcta según el MIME type
        let finalName = name || 'archivo';
        const hasExt = finalName.includes('.') && finalName.split('.').pop().length <= 4;
        
        if (!hasExt || finalName.toLowerCase().endsWith('.dat')) {
            const mimeToExt = {
                'application/pdf': '.pdf',
                'image/png': '.png',
                'image/jpeg': '.jpg',
                'image/jpg': '.jpg',
                'text/plain': '.txt',
                'application/json': '.json'
            };
            const expectedExt = mimeToExt[finalMimeType];
            if (expectedExt) {
                if (finalName.toLowerCase().endsWith('.dat')) {
                    finalName = finalName.substring(0, finalName.length - 4) + expectedExt;
                } else {
                    finalName = finalName + expectedExt;
                }
                logger.info(`[Proxy] Nombre de archivo corregido a: ${finalName} según MIME Type: ${finalMimeType}`);
            }
        }

        // Mantener el nombre original si es posible (meta-data opcional)
        // Usamos 'inline' para que el navegador intente mostrarlo
        const safeName = finalName.replace(/[^\w\.-]/g, '_');
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);

        stream.on('error', (err) => {
            logger.error("Error en stream del proxy:", err);
            if (!res.headersSent) res.status(500).send('Error durante la transmisión del archivo');
        });

        stream.pipe(res);
    } catch (error) {
        logger.error("Error en viewDriveFile proxy:", error);

        if (error.code === 404) {
            return res.status(404).send('Archivo no encontrado en Drive o falta de permisos (Scope limitado). Por favor re-autoriza el acceso.');
        }

        if (!res.headersSent) {
            res.status(500).send('Error al visualizar archivo desde Drive: ' + error.message);
        }
    }
};

/**
 * 6. Actualizar Contador de Copias (Control y Empaquetado)
 */
const updateFileCopyCount = async (req, res) => {
    const { archivoId, count, isService } = req.body;
    let transaction;
    try {
        const pool = await getPool();
        await ensureFallaColumn(pool);
        if (archivoId) {
            const rechazo = await rechazoSinImprimir(pool, { archivoId, isService });
            if (rechazo) return res.status(400).json({ error: rechazo });
        }
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        if (!archivoId) return res.status(400).json({ error: 'Falta archivoId' });

        // 1. Obtener estado actual y datos de la orden padre
        let file;
        if (isService) {
            const serviceRes = await new sql.Request(transaction)
                .input('ID', sql.Int, archivoId)
                .query(`
                    SELECT SEO.Cantidad as Copias, ISNULL(SEO.Controlcopias, 0) as Controlcopias, SEO.Estado as EstadoArchivo, SEO.OrdenID, SEO.Descripcion as NombreArchivo, 
                           O.CodigoOrden 
                    FROM ServiciosExtraOrden SEO WITH (UPDLOCK) 
                    INNER JOIN Ordenes O ON SEO.OrdenID = O.OrdenID
                    WHERE SEO.ServicioID = @ID
                `);
            if (!serviceRes.recordset.length) {
                await transaction.rollback();
                return res.status(404).json({ error: "Servicio no encontrado" });
            }
            file = serviceRes.recordset[0];
        } else {
            const fileRes = await new sql.Request(transaction)
                .input('ID', sql.Int, archivoId)
                .query(`
                    SELECT AO.Copias, AO.Controlcopias, AO.EstadoArchivo, AO.OrdenID, AO.NombreArchivo,
                           ISNULL(AO.CopiasFalladas, 0) as CopiasFalladas,
                           O.CodigoOrden, O.AreaID, O.NoDocERP,
                           TRY_CAST(REPLACE(REPLACE(ISNULL(O.Magnitud,'0'),' ',''),',','.') AS FLOAT) AS MagnitudOrden
                    FROM ArchivosOrden AO WITH (UPDLOCK)
                    INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                    WHERE AO.ArchivoID = @ID
                `);
            if (!fileRes.recordset.length) {
                await transaction.rollback();
                return res.status(404).json({ error: "Archivo no encontrado" });
            }
            file = fileRes.recordset[0];
        }

        const ordenId = file.OrdenID;
        // TPU: lo que se controla son los PARCHES, no las capas del arte. Los archivos de una orden
        // TPU son el diseño (cmyk, corte, relieve…), todos con Copias = 1, así que el tope tiene que
        // salir de la cantidad pedida (Ordenes.Magnitud). La vista de control muestra una sola línea
        // por orden apoyada en uno de esos archivos; este es el tope que le corresponde.
        const esTPUControl = !isService && String(file.AreaID || '').trim().toUpperCase() === 'TPU';
        // FALLA POR COPIAS: las falladas no se cuentan a mano — las acredita la reposición al
        // cerrarse. El tope de conteo del operario son las copias BUENAS (Copias - CopiasFalladas).
        // TPU queda afuera del modelo (control por parches/Magnitud).
        const falladas = (!isService && !esTPUControl) ? (file.CopiasFalladas || 0) : 0;
        const totalCopies = esTPUControl
            ? Math.max(1, Math.round(Number(file.MagnitudOrden) || 0))
            : Math.max(0, (file.Copias || 1) - falladas);
        let newCount = parseInt(count);

        // Validaciones
        if (isNaN(newCount)) newCount = (file.Controlcopias || 0) + 1;
        if (newCount < 0) newCount = 0;
        if (newCount > totalCopies) newCount = totalCopies;

        // Determinar Nuevo Estado
        let newStatus = file.EstadoArchivo;
        let isCompletedNow = false;
        let etiquetaFalla = null;

        if (newCount >= totalCopies) {
            if (falladas > 0) {
                // Todas las buenas contadas pero hay copias en reposición: el archivo queda FALLA
                // (mismo estado que el whole-file) y se resuelve cuando la -F acredite las que faltan.
                if (file.EstadoArchivo !== 'FALLA') {
                    newStatus = 'FALLA';
                    // El archivo quedó RESUELTO (contadas + falladas = total): acá sale LA etiqueta
                    // de falla, una sola, con todas las fallas acumuladas del archivo.
                    try {
                        etiquetaFalla = {
                            imprimirEtiquetaFalla: true,
                            fallasArchivo: await getFallasDeArchivo(transaction, archivoId),
                        };
                    } catch (eEtq) {
                        logger.warn('[updateFileCopyCount] No se pudieron leer las fallas para la etiqueta:', eEtq.message);
                    }
                }
            } else if (file.EstadoArchivo !== 'OK' && file.EstadoArchivo !== 'FINALIZADO') {
                newStatus = 'OK';
                isCompletedNow = true;

                // CIERRE DE REPOSICIÓN por conteo (solo archivos): al completar un archivo de una
                // -F, curar a la familia ese archivo. Antes había un heal propio que buscaba SOLO el
                // código raíz exacto (split('-F')[0]) — en linajes (SUB-X-F123-2) ignoraba los
                // eslabones intermedios. Ahora usa la misma cura familiar que los otros dos caminos
                // (sanarFamiliaTrasReposicion), acotada a ESTE archivo; reparte con tope en el
                // pendiente de cada pariente (min(f, CopiasFalladas)), así que repetirla no duplica.
                if (!isService && (file.CodigoOrden || '').includes('-F')) {
                    await sanarFamiliaTrasReposicion(transaction, {
                        ordenId: file.OrdenID,
                        codigoOrden: file.CodigoOrden,
                        noDocERP: file.NoDocERP,
                        areaId: file.AreaID,
                        soloNombreArchivo: file.NombreArchivo,
                    });
                }
            }
        } else {
            if (file.EstadoArchivo === 'OK') {
                newStatus = 'Pendiente';
            }
        }

        // Actualizar tabla correspondiente
        if (isService) {
            await new sql.Request(transaction)
                .input('ID', sql.Int, archivoId)
                .input('Count', sql.Int, newCount)
                .input('Status', sql.VarChar, newStatus)
                .query(`
                    UPDATE ServiciosExtraOrden 
                    SET Controlcopias = @Count, 
                        Estado = @Status,
                        FechaControl = GETDATE()
                    WHERE ServicioID = @ID
                `);
        } else {
            await new sql.Request(transaction)
                .input('ID', sql.Int, archivoId)
                .input('Count', sql.Int, newCount)
                .input('Status', sql.VarChar, newStatus)
                .query(`
                    UPDATE ArchivosOrden 
                    SET Controlcopias = @Count, 
                        EstadoArchivo = @Status,
                        FechaControl = GETDATE()
                    WHERE ArchivoID = @ID
                `);
        }

        // Si se completó el archivo, verificar si la orden está completa (solo para informar al frontend, NO cierra automáticamente)
        let orderFullyCompleted = false;
        if (isCompletedNow) {
            const checkOrder = await new sql.Request(transaction)
                .input('OID', sql.Int, ordenId)
                .query(`
                    SELECT 
                        (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo != 'CANCELADO') + 
                        (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado != 'CANCELADO') as Total,
                        (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo IN ('OK', 'FINALIZADO')) +
                        (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado IN ('OK', 'FINALIZADO')) as Completed
                `);
            const { Total, Completed } = checkOrder.recordset[0];
            if (Total > 0 && Total === Completed) {
                orderFullyCompleted = true;
                // NO se cierra automáticamente. El operador debe pulsar "Finalizar Orden".
            }
        }

        await transaction.commit();

        res.json({
            success: true,
            newCount,
            newStatus,
            isCompletedNow,
            orderFullyCompleted,
            ...(etiquetaFalla || {}),  // { imprimirEtiquetaFalla, fallasArchivo } — resuelto con fallas
        });

    } catch (err) {
        if (transaction) await transaction.rollback();
        logger.error("Error updateFileCopyCount:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * 7. Buscar Órdenes Entregadas/Finalizadas para Reposición (Atención al Cliente)
 */
const getCompletedOrdersForReplacement = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 3) return res.json([]);

        const pool = await getPool();
        const request = pool.request();

        let sqlQuery = `
            SELECT TOP 20 
                O.OrdenID, O.CodigoOrden, C.IDCliente, O.Cliente, O.FechaIngreso, O.FechaEstimadaEntrega, 
                O.Estado, O.Material, O.DescripcionTrabajo, O.NoDocERP, LTRIM(RTRIM(O.AreaID)) AS AreaID
            FROM Ordenes O WITH (NOLOCK)
            LEFT JOIN Clientes C WITH (NOLOCK) ON C.CliIdCliente = O.CliIdCliente
            WHERE O.Estado IN ('ENTREGADO', 'FINALIZADO', 'DESPACHADO', 'PRONTO')
            -- Fallas internas (-F#) fuera: el reclamo del cliente es sobre SU pedido y la madre
            -- tiene todos los archivos (la -F solo el subconjunto reimpreso). Elegirla por error
            -- generaba reposiciones con límites acotados a la -F (y antes, códigos híbridos).
            AND O.CodigoOrden NOT LIKE '%-F[0-9]%'
            AND (
                O.CodigoOrden LIKE @Search
                OR O.NoDocERP LIKE @Search
                OR C.IDCliente LIKE @Search
            )
            ORDER BY O.OrdenID DESC
        `;

        request.input('Search', sql.NVarChar, `%${q}%`);

        const result = await request.query(sqlQuery);
        res.json(result.recordset);

    } catch (error) {
        logger.error("Error getCompletedOrdersForReplacement:", error);
        res.status(500).json({ error: error.message });
    }
};

// ── Reposición en otra tela o con un archivo nuevo (26/10/2026) ─────────────────────────────────────────────
// Pedido de Atención al Cliente: a veces de una tizada se echó a perder solo una parte y se repone con un archivo
// NUEVO hecho con lo que falta (no con uno de la orden), y a veces se autoriza hacerla en otra tela porque la del
// pedido se agotó. Las telas que se ofrecen son las del MISMO catálogo que la orden (área + variante: la misma
// consulta de /ventas/pedido-prenda, GET /api/nomenclators/materials/:areaId/:variante) y el archivo nuevo se mide
// y se valida contra la tela con las reglas del ingreso de pedidos (validador.errorMedidaContraTela / DTF).
// Solo en las áreas que imprimen un archivo (AREAS_IMPRIMEN_POR_LOTE); en el resto la pantalla no lo ofrece.
const limpioRepo = (s) => String(s ?? '').trim();

async function telasDeReposicion(pool, orden) {
    const area = limpioRepo(orden.AreaID).toUpperCase();
    const { AREAS_IMPRIMEN_POR_LOTE } = require('../services/cadenaReposicionService');
    if (!AREAS_IMPRIMEN_POR_LOTE.includes(area)) return { admite: false, telas: [], actual: null, bobina: null };
    const { materialesDe } = require('../services/pedidosExternos/catalogo');
    const telas = await materialesDe(pool, area, limpioRepo(orden.Variante));
    const actual = telas.find(t => limpioRepo(t.CodArticulo) === limpioRepo(orden.CodArticulo))
        || telas.find(t => limpioRepo(t.Material).toLowerCase() === limpioRepo(orden.Material).toLowerCase())
        || null;
    // Tela del cliente: el ancho lo da su bobina, como en el ingreso del pedido
    let bobina = null;
    if (orden.BobinaTelaID) {
        const b = await pool.request().input('BID', sql.Int, orden.BobinaTelaID)
            .query('SELECT BobinaID, CodigoEtiqueta, Ancho, AnchoReal, DescripcionTela, Referencia FROM InventarioBobinas WHERE BobinaID = @BID');
        bobina = b.recordset[0] || null;
    }
    return { admite: true, telas, actual, bobina };
}

// Nombre del archivo nuevo de la reposición, como en el ingreso del pedido (webOrdersController): en las áreas con el
// formato nuevo (nombreArchivoOrden.js) {MATERIAL}-{ORDEN}_{CLIENTE}_Arch i de n (xC); en el resto, el de siempre.
// La pantalla lo muestra antes de generar con la plantilla de getOpcionesReposicion, armada con esta misma función.
function nombreArchivoNuevoRepo({ nombreNuevo, material, codigo, cliente, trabajo, idx, total, copias, ext }) {
    const { construirNombreArchivo } = require('../utils/nombreArchivoOrden');
    const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
    return nombreNuevo
        ? construirNombreArchivo({ material, codigoOrden: codigo, cliente, idx, total, copias, ext })
        : `${codigo.replace(/\//g, '-')}_${sanitize(cliente)}_${sanitize(trabajo)}_Archivo ${idx} de ${total} (x${copias})${ext}`;
}

// Código que va a tener la próxima reposición de la orden: sobre la RAÍZ, sin -R/-F (ver createCustomerReplacementOrder)
async function proximoCodigoReposicion(conn, codigoOrden) {
    const rootCode = String(codigoOrden || '').replace(/(-[RF]\d+)+$/i, '');
    const r = await conn.request().input('BaseCode', sql.NVarChar, rootCode)
        .query(`SELECT COUNT(*) as total FROM Ordenes WHERE CodigoOrden LIKE @BaseCode + '-R%'`);
    return { rootCode, nextRepNum: (r.recordset[0].total || 0) + 1 };
}

/**
 * 8a. Opciones de la reposición de una orden: si admite archivo nuevo, las telas que se pueden elegir y la actual.
 */
const getOpcionesReposicion = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().input('ID', sql.Int, parseInt(req.params.ordenId, 10))
            .query(`SELECT O.OrdenID, O.CodigoOrden, O.AreaID, O.Variante, O.Material, O.CodArticulo, O.BobinaTelaID, O.UM,
                           O.Cliente, O.DescripcionTrabajo, CL.IDCliente AS IDClienteFicha
                    FROM Ordenes O LEFT JOIN Clientes CL ON CL.CliIdCliente = O.CliIdCliente
                    WHERE O.OrdenID = @ID`);
        if (!r.recordset.length) return res.status(404).json({ error: 'Orden no encontrada' });
        const orden = r.recordset[0];
        const { admite, telas, actual, bobina } = await telasDeReposicion(pool, orden);
        const { anchoDeMaterial } = require('../services/pedidosExternos/catalogo');
        const { materialParaNombre, usaNombreNuevo } = require('../utils/nombreArchivoOrden');
        // materialNombre: cómo empieza el nombre del archivo con esa tela (la del pedido lleva el PRE de la tela del cliente)
        const fila = (t, pre = null) => ({
            codArticulo: limpioRepo(t.CodArticulo), nombre: limpioRepo(t.Material), anchoM: anchoDeMaterial(t), largoM: parseFloat(t.Largo) || 0,
            materialNombre: materialParaNombre(limpioRepo(t.Material), pre),
        });
        const anchoBobina = bobina ? parseFloat(bobina.AnchoReal ?? bobina.Ancho) : NaN;
        // Plantilla del nombre del archivo nuevo, armada con la misma función que lo nombra al crear la reposición:
        // la pantalla reemplaza {MATERIAL}, {I}, {N}, {C} y {EXT}.
        let plantillaNombre = null;
        if (admite) {
            const { rootCode, nextRepNum } = await proximoCodigoReposicion(pool, orden.CodigoOrden);
            plantillaNombre = nombreArchivoNuevoRepo({
                nombreNuevo: await usaNombreNuevo(limpioRepo(orden.AreaID).toUpperCase()), material: '{MATERIAL}',
                codigo: `${rootCode}-R${nextRepNum}`, cliente: limpioRepo(orden.IDClienteFicha) || limpioRepo(orden.Cliente) || 'Cliente',
                trabajo: orden.DescripcionTrabajo, idx: '{I}', total: '{N}', copias: '{C}', ext: '{EXT}',
            });
        }
        res.json({
            admiteArchivoNuevo: admite,
            area: limpioRepo(orden.AreaID).toUpperCase(),
            telas: telas.map(t => fila(t)),
            telaActual: actual
                ? fila(actual, bobina?.Referencia || null)
                : { ...fila({ CodArticulo: orden.CodArticulo, Material: orden.Material }, bobina?.Referencia || null), largoM: 0 },
            bobina: Number.isFinite(anchoBobina) && anchoBobina > 0
                ? { nombre: limpioRepo(bobina.DescripcionTela || bobina.CodigoEtiqueta), anchoM: anchoBobina }
                : null,
            plantillaNombre,
        });
    } catch (error) {
        logger.error('Error getOpcionesReposicion:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * 8. Crear Orden de Reposición (Batch)
 * Recibe lista de archivos a reponer de una orden ya terminada.
 * Con archivos nuevos llega como multipart (ruta con multer): los datos en el campo «datos» (JSON) y los archivos
 * en «archivosNuevos», con sus copias y observación en datos.nuevos (mismo orden). Sin archivos nuevos, JSON.
 */
const createCustomerReplacementOrder = async (req, res) => {
    const body = req.body?.datos ? JSON.parse(req.body.datos) : (req.body || {});
    const { originalOrderId, globalObservation, razonId, telaCodArticulo } = body;
    const files = Array.isArray(body.files) ? body.files : [];
    const subidos = Array.isArray(req.files) ? req.files : [];
    const nuevosInfo = Array.isArray(body.nuevos) ? body.nuevos : [];
    // Quién la crea sale del token (verifyToken en la ruta), nunca del body.
    const userId = req.user?.id;
    let transaction;
    const fs = require('fs');

    try {
        if (!originalOrderId || (files.length === 0 && subidos.length === 0)) {
            return res.status(400).json({ error: "Datos incompletos" });
        }

        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 1. Obtener Datos Orden Original (con Máquina y Lote)
        const ordRes = await new sql.Request(transaction)
            .input('ID', sql.Int, originalOrderId)
            .query(`
                SELECT O.*,
                       R.Nombre as NombreRollo,
                       CE.Nombre as NombreMaquina,
                       CE.EquipoID as EquipoID,
                       CL.IDCliente as IDClienteFicha
                FROM Ordenes O
                LEFT JOIN Rollos R ON O.RolloID = R.RolloID
                LEFT JOIN ConfigEquipos CE ON ISNULL(O.MaquinaID, R.MaquinaID) = CE.EquipoID
                LEFT JOIN Clientes CL ON CL.CliIdCliente = O.CliIdCliente
                WHERE O.OrdenID = @ID
            `);

        if (ordRes.recordset.length === 0) throw new Error("Orden original no encontrada");
        const originalOrder = ordRes.recordset[0];

        // 1a. Razón principal (23/10/2026): un tipo de falla activo, marcado para reposiciones, del área de la
        // orden o General. Es obligatoria si el área tiene razones cargadas (se administran en /admin/tipos-falla).
        // Se guarda como TipoFalla de cada falla registrada y encabeza la nota de la -R.
        const razonesRes = await new sql.Request(transaction)
            .input('Area', sql.VarChar(20), String(originalOrder.AreaID || '').trim())
            .query(`SELECT FallaID, Titulo FROM dbo.TiposFallas
                    WHERE Activo = 1 AND EnReposicion = 1 AND (AreaID = @Area OR AreaID = 'General')`);
        let razon = null;
        if (razonId !== undefined && razonId !== null && razonId !== '') {
            razon = razonesRes.recordset.find(r => r.FallaID === parseInt(razonId, 10)) || null;
            if (!razon) throw new Error('La razón elegida ya no está disponible para esta área. Volvé a elegirla.');
        } else if (razonesRes.recordset.length > 0) {
            throw new Error('Elegí la razón principal de la reposición.');
        }
        const razonTexto = razon ? `Razón: ${String(razon.Titulo).trim()}` : '';
        // Sin razones cargadas para el área queda el tipo 1 de siempre (antes era fijo para toda reposición).
        const tipoFallaReposicion = razon ? razon.FallaID : 1;

        // 1b. Obtener datos originales de los archivos para validar límites (metros y copias)
        const fileIds = files.map(f => parseInt(f.id)).filter(id => !isNaN(id));
        const origFilesMap = {};
        if (fileIds.length > 0) {   // solo con archivos nuevos no se repite ninguno de la orden
            const placeholders = fileIds.map((_, i) => `@FID${i}`).join(',');
            const origFilesReq = new sql.Request(transaction);
            fileIds.forEach((id, i) => origFilesReq.input(`FID${i}`, sql.Int, id));
            const origFilesRes = await origFilesReq.query(
                `SELECT ArchivoID, NombreArchivo, Ancho, Alto, Metros as MetrosOrig, Copias as CopiasOrig FROM dbo.ArchivosOrden WHERE ArchivoID IN (${placeholders})`
            );
            origFilesRes.recordset.forEach(r => { origFilesMap[r.ArchivoID] = r; });
        }

        // 1c. Validar límites antes de proceder
        for (const file of files) {
            const orig = origFilesMap[parseInt(file.id)];
            if (!orig) throw new Error(`Archivo ID ${file.id} no encontrado en la orden original`);

            const metersReq = parseFloat(file.meters);
            const copiesReq = parseInt(file.copies) || parseInt(orig.CopiasOrig);
            const metersOrig = parseFloat(orig.MetrosOrig);
            const copiesOrig = parseInt(orig.CopiasOrig);

            if (metersReq > metersOrig) {
                throw new Error(
                    `No se puede reponer más metros que los originales. ` +
                    `Solicitado: ${metersReq}m — Máximo permitido: ${metersOrig}m`
                );
            }
            if (copiesReq > copiesOrig) {
                throw new Error(
                    `No se puede reponer más copias que las originales. ` +
                    `Solicitado: ${copiesReq} copias — Máximo permitido: ${copiesOrig} copias`
                );
            }
        }

        // 1d. Tela de la reposición y archivos nuevos (26/10/2026, ver telasDeReposicion). Todo se valida ANTES de
        // escribir nada: el archivo nuevo se mide en el servidor y tiene que entrar en la tela con que se hace la -R.
        const areaOrig = limpioRepo(originalOrder.AreaID).toUpperCase();
        const quiereOtraTela = !!limpioRepo(telaCodArticulo) && limpioRepo(telaCodArticulo) !== limpioRepo(originalOrder.CodArticulo);
        let telaCambiada = null;      // { antes, ahora, codArticulo, proIdProducto, idProdReact, productoEsLaTela }
        let telaRepo = null;          // fila del catálogo de la tela con que se hace la -R
        let bobinaRepo = null;        // tela del cliente (solo si no se cambia la tela)
        const nuevosMedidos = [];
        if (quiereOtraTela || subidos.length > 0) {
            const opciones = await telasDeReposicion(pool, originalOrder);
            if (!opciones.admite) throw new Error(`En el área ${areaOrig} la reposición no admite otra tela ni archivos nuevos.`);
            if (quiereOtraTela) {
                const nueva = opciones.telas.find(t => limpioRepo(t.CodArticulo) === limpioRepo(telaCodArticulo));
                if (!nueva) throw new Error('La tela elegida no está en el catálogo de esta orden. Volvé a elegirla.');
                const artRes = await new sql.Request(transaction)
                    .input('Cod', sql.VarChar(50), limpioRepo(nueva.CodArticulo))
                    .input('ProOrig', sql.Int, originalOrder.ProIdProducto ?? null)
                    .query(`SELECT TOP 1 ProIdProducto, IDProdReact FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = @Cod;
                            SELECT TOP 1 Descripcion FROM dbo.Articulos WHERE ProIdProducto = @ProOrig;`);
                const art = artRes.recordsets[0][0] || {};
                // ¿El producto de la orden ES la tela (Sublimación: «Jacquard …») o algo hecho con ella (un roll up de
                // banner)? En el primer caso cambia también el artículo; en el segundo, solo el material.
                const productoEsLaTela = limpioRepo(artRes.recordsets[1][0]?.Descripcion).toLowerCase() === limpioRepo(originalOrder.Material).toLowerCase();
                telaCambiada = {
                    antes: limpioRepo(originalOrder.Material), ahora: limpioRepo(nueva.Material), codArticulo: limpioRepo(nueva.CodArticulo),
                    proIdProducto: art.ProIdProducto ?? null, idProdReact: art.IDProdReact ?? null, productoEsLaTela,
                };
                telaRepo = nueva;
            } else {
                telaRepo = opciones.actual || { Material: originalOrder.Material };
                bobinaRepo = opciones.bobina;
            }

            const { errorMedidaContraTela, errorMedidaDtf } = require('../services/pedidosExternos/validador');
            const errorMedida = (nombre, ancho, alto) => (areaOrig === 'DF'
                ? errorMedidaDtf(nombre, ancho, alto, telaRepo)
                : errorMedidaContraTela(nombre, ancho, alto, telaRepo, bobinaRepo));

            // Los archivos de la orden que se repiten tienen que entrar en la tela nueva
            if (telaCambiada) {
                for (const file of files) {
                    const o = origFilesMap[parseInt(file.id)];
                    const ancho = parseFloat(o?.Ancho), alto = parseFloat(o?.Alto);
                    if (!(ancho > 0) || !(alto > 0)) continue;   // archivo viejo sin medida: no hay contra qué validar
                    const e = errorMedida(limpioRepo(o.NombreArchivo), ancho, alto);
                    if (e) throw new Error(e.mensaje);
                }
            }

            // Archivos nuevos: se miden en el servidor (medicion.js, mismas reglas que el ingreso de pedidos)
            const { medirArchivo } = require('../services/pedidosExternos/medicion');
            for (let i = 0; i < subidos.length; i++) {
                const f = subidos[i];
                const nombre = Buffer.from(f.originalname || '', 'latin1').toString('utf8') || `archivo ${i + 1}`;
                const info = nuevosInfo[i] || {};
                const copias = parseInt(info.copias, 10);
                if (!(copias >= 1)) throw new Error(`"${nombre}": las copias deben ser 1 o más.`);
                // JPEG solo en Sublimación (fileService.validateFile del portal: el resto va en PNG o PDF)
                if (areaOrig !== 'SB' && /\.jpe?g$/i.test(nombre)) throw new Error(`"${nombre}": no se permiten archivos JPEG. Subí el arte en PNG o PDF.`);
                let medida;
                try { medida = await medirArchivo(f.path, nombre, f.mimetype); }
                catch (eMed) { throw new Error(`No pudimos medir "${nombre}": ${eMed.message}`); }
                const anchoM = Math.round(medida.anchoM * 1000) / 1000;
                const altoM = Math.round(medida.altoM * 1000) / 1000;
                const e = errorMedida(nombre, anchoM, altoM);
                if (e) throw new Error(e.mensaje);
                nuevosMedidos.push({ path: f.path, nombre, anchoM, altoM, copias, obs: limpioRepo(info.obs) });
            }
        }

        // 2. Crear Nueva Orden de Reposición
        // El código se construye sobre la RAÍZ (sin sufijos -R ni -F previos): la reposición de
        // una reposición debe incrementar (-R2), no apilar (-R1-R1); y la registrada parado en
        // una falla interna (-F#) debe salir SUB-X-R1, no SUB-X-F123-R1 — el híbrido contiene
        // '-F' y todo el sistema (portal, miniaturas, conteos) lo trata como falla interna
        // invisible para el cliente. Se strippean TODOS los -R\d+/-F\d+ del final.
        const stripRepoSuffix = (c) => (c || '').replace(/(-[RF]\d+)+$/i, '');
        const rootCode = stripRepoSuffix(originalOrder.CodigoOrden);
        // Número secuencial: contar cuántas reposiciones existen para la RAÍZ
        const countRepRes = await new sql.Request(transaction)
            .input('BaseCode', sql.NVarChar, rootCode)
            .query(`SELECT COUNT(*) as total FROM Ordenes WHERE CodigoOrden LIKE @BaseCode + '-R%'`);
        const nextRepNum = (countRepRes.recordset[0].total || 0) + 1;
        const suffix = `-R${nextRepNum}`;
        const newCode = `${rootCode}${suffix}`;

        // Construir NOTA DE LA ORDEN: obs del defecto (campo global del form) + contexto máquina/lote
        const maquinaInfo = originalOrder.NombreMaquina ? `Máquina: ${originalOrder.NombreMaquina}` : '';
        const loteInfo    = originalOrder.NombreRollo   ? `Lote: ${originalOrder.NombreRollo}`     : '';
        const contextInfo = [maquinaInfo, loteInfo].filter(Boolean).join(' | ');
        const globalObsBase = (globalObservation || '').trim(); // obs general de la falla ingresada por el usuario
        const telaTexto = telaCambiada ? `Tela cambiada: ${telaCambiada.antes} → ${telaCambiada.ahora}` : '';
        // Ordenes.Nota = "Razón: R | [texto del usuario] | Tela cambiada: A → B | Máquina: X | Lote: Y"
        const partesNota = [razonTexto, globalObsBase, telaTexto, contextInfo].filter(Boolean);
        const ordenNota = partesNota.length ? partesNota.join(' | ') : 'Reposición Cliente';

        // EquipoID de la máquina original (para FallasProduccion)
        const equipoIdOriginal = originalOrder.EquipoID || null;

        // 1e. Archivos nuevos: nombre como en el ingreso del pedido (webOrdersController) con el código de la -R y la
        // tela con que se hace, y subida a Drive. Va ANTES de escribir en la base: la transacción todavía no tiene nada
        // bloqueado mientras sube, y si Drive falla no queda una orden con un archivo sin subir.
        const totalArchivosRepo = files.length + nuevosMedidos.length;
        if (nuevosMedidos.length > 0) {
            const { materialParaNombre, usaNombreNuevo } = require('../utils/nombreArchivoOrden');
            const nombreNuevo = await usaNombreNuevo(areaOrig);
            const clienteNombre = limpioRepo(originalOrder.IDClienteFicha) || limpioRepo(originalOrder.Cliente) || 'Cliente';
            const materialNombre = materialParaNombre(telaCambiada ? telaCambiada.ahora : limpioRepo(originalOrder.Material), bobinaRepo?.Referencia || null);
            for (let k = 0; k < nuevosMedidos.length; k++) {
                const n = nuevosMedidos[k];
                const idx = files.length + k + 1;   // después de los archivos de la orden que se repiten
                const ext = n.nombre.lastIndexOf('.') > 0 ? n.nombre.substring(n.nombre.lastIndexOf('.')) : '';
                n.finalName = nombreArchivoNuevoRepo({
                    nombreNuevo, material: materialNombre, codigo: newCode, cliente: clienteNombre,
                    trabajo: originalOrder.DescripcionTrabajo, idx, total: totalArchivosRepo, copias: n.copias, ext,
                });
                n.url = await driveService.uploadToDrive(fs.createReadStream(n.path), n.finalName, areaOrig || 'GENERAL');
                logger.info(`[Reposición] ${newCode}: archivo nuevo "${n.nombre}" (${n.anchoM}×${n.altoM} m, x${n.copias}) subido como "${n.finalName}".`);
            }
        }

        const insertOrderResult = await new sql.Request(transaction)
            .input('NewCode',  sql.NVarChar,       newCode)
            .input('OldID',    sql.Int,            originalOrderId)
            .input('NotaOrd',  sql.NVarChar(sql.MAX), ordenNota)
            .query(`
                INSERT INTO dbo.Ordenes(
                    CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega,
                    Material, DescripcionTrabajo, Prioridad,
                    Estado, EstadoenArea, AreaID,
                    Magnitud, IdCabezalERP, ProximoServicio, Nota, NoDocERP,
                    FechaEntradaSector, ArchivosCount, Variante, UM,
                    IdClienteReact, CliIdCliente, CodCliente,
                    IdProductoReact, ProIdProducto, CodArticulo, CostoTotal
                )
                SELECT
                    @NewCode, Cliente, GETDATE(), DATEADD(day, 2, GETDATE()),
                    Material, DescripcionTrabajo, 'Reposición',
                    'Pendiente', 'Pendiente', AreaID,
                    Magnitud, IdCabezalERP, ProximoServicio, @NotaOrd, NoDocERP,
                    GETDATE(), 0, Variante, UM,
                    IdClienteReact, CliIdCliente, CodCliente,
                    IdProductoReact, ProIdProducto, CodArticulo, 0
                FROM dbo.Ordenes
                WHERE OrdenID = @OldID;

                SELECT SCOPE_IDENTITY() as NewID;
             `);

        const newOrderId = insertOrderResult.recordset[0].NewID;

        // Otra tela (1d): la -R se hace con la tela elegida. Si el producto de la orden es la tela misma, cambia también
        // el artículo (como el SQL a mano que se usaba: Material, ProIdProducto, CodArticulo, IdProductoReact).
        if (telaCambiada) {
            await new sql.Request(transaction)
                .input('ID', sql.Int, newOrderId)
                .input('Mat', sql.VarChar(255), telaCambiada.ahora)
                .input('Cod', sql.VarChar(50), telaCambiada.codArticulo)
                .input('Pro', sql.Int, telaCambiada.proIdProducto)
                .input('React', sql.Int, telaCambiada.idProdReact)
                .input('CambiaArt', sql.Bit, telaCambiada.productoEsLaTela && telaCambiada.proIdProducto ? 1 : 0)
                .query(`UPDATE dbo.Ordenes SET Material = @Mat,
                               CodArticulo     = CASE WHEN @CambiaArt = 1 THEN @Cod   ELSE CodArticulo END,
                               ProIdProducto   = CASE WHEN @CambiaArt = 1 THEN @Pro   ELSE ProIdProducto END,
                               IdProductoReact = CASE WHEN @CambiaArt = 1 THEN @React ELSE IdProductoReact END
                        WHERE OrdenID = @ID`);
        }

        // [REQUISITOS] La -R es la misma orden vuelta a hacer: hereda los requisitos que la madre
        // ya tiene CUMPLIDOS (TELA asignada / "material propio" en SB, matriz, aprobación, etc.).
        // Sin esto quedaba para siempre en "Esperando requisitos" de Planificación (9-oct-2026).
        try {
            await heredarRequisitosCumplidos(transaction, originalOrderId, newOrderId, 'reposición');
        } catch (eReq) {
            logger.warn(`[Reposición] No se pudieron heredar requisitos a ${newCode}: ${eReq.message}`);
        }

        let totalFiles = 0;
        // Miniaturas a copiar del archivo original al clon (se hace DESPUÉS del commit: es I/O de
        // disco, no debe alargar ni poder tumbar la transacción).
        const thumbsAcopiar = [];
        // Archivo original → clon, con las copias: de acá salen las terminaciones de la -R (paso 3b).
        const archivosClonados = [];

        // 3. Insertar Archivos Seleccionados
        for (const file of files) {
            const oldFileId       = parseInt(file.id);
            const metersToReprint = Number(file.meters) || 0;  // asegurar número
            const orig            = origFilesMap[oldFileId];
            const copiesToReprint = parseInt(file.copies) || parseInt(orig?.CopiasOrig) || 1;

            // file.obs = "Motivo / Observación de la Falla" (por archivo)
            const userObs = (file.obs || '').trim();

            // ──────────────────────────────────────────────────
            // NOTA DE LA ORDEN: obs del archivo + contexto (qué máquina/lote lo imprimió)
            const notaOrden = contextInfo
                ? (userObs ? `${userObs} | ${contextInfo}` : contextInfo)
                : (userObs || 'Reposición Cliente');

            // OBSERVACIÓN DE FALLAS: lo que escribió el usuario como obs general de la falla
            const obsParaFalla = globalObsBase || `Reposición cliente - Orden ${originalOrder.CodigoOrden}`;
            // ──────────────────────────────────────────────────

            // Con otra tela, el nombre que empieza con el material (formato de Sublimación, nombreArchivoOrden.js)
            // pasa a decir la tela nueva: es lo que mira el operario para cargarlo en la tela correcta.
            let nombreConTela = null;
            if (telaCambiada && orig?.NombreArchivo) {
                const { materialParaNombre } = require('../utils/nombreArchivoOrden');
                const prefijoViejo = `${materialParaNombre(telaCambiada.antes)}-`;
                if (orig.NombreArchivo.startsWith(prefijoViejo)) {
                    nombreConTela = `${materialParaNombre(telaCambiada.ahora)}-${orig.NombreArchivo.substring(prefijoViejo.length)}`;
                }
            }

            // Insertar archivo en la nueva orden
            const insFileRes = await new sql.Request(transaction)
                .input('NewOrderID', sql.Int,             newOrderId)
                .input('OldFileID',  sql.Int,             oldFileId)
                .input('Metros',     sql.Decimal(10,2),   metersToReprint)
                .input('Copias',     sql.Int,             copiesToReprint)
                .input('Obs',        sql.NVarChar,        notaOrden)
                .input('Nom',        sql.VarChar(200),    nombreConTela)
                .query(`
                    INSERT INTO dbo.ArchivosOrden(
                        OrdenID, NombreArchivo, RutaAlmacenamiento, Metros, Copias, Ancho, Alto, Observaciones,
                        FechaSubida, EstadoArchivo, TipoArchivo
                    )
                    OUTPUT INSERTED.ArchivoID
                    SELECT
                        @NewOrderID, ISNULL(@Nom, NombreArchivo), RutaAlmacenamiento, @Metros, @Copias, Ancho, Alto, @Obs,
                        GETDATE(), 'Pendiente', TipoArchivo
                    FROM dbo.ArchivosOrden WHERE ArchivoID = @OldFileID
                `);

            // El archivo es EL MISMO de Drive, solo cambia el ArchivoID → se copia la miniatura
            // en vez de regenerarla. Sin esto la reposición nace sin miniatura (nadie sube nada,
            // así que no se dispara la generación) y en Control se ve el ícono genérico y el
            // modal de falla dice "sin vista previa".
            const newFileId = insFileRes.recordset?.[0]?.ArchivoID;
            if (newFileId) {
                thumbsAcopiar.push({ origId: oldFileId, newId: newFileId });
                archivosClonados.push({ origId: oldFileId, newId: newFileId, copias: copiesToReprint, copiasOrig: parseInt(orig?.CopiasOrig) || copiesToReprint });
            }

            totalFiles++;

            // Registrar en FallasProduccion: obs global de la falla + EquipoID + metros reales
            try {
                const fallaReq = new sql.Request(transaction);
                fallaReq.input('OldID',    sql.Int,           originalOrderId);
                fallaReq.input('FileID',   sql.Int,           oldFileId);
                fallaReq.input('AreaID',   sql.VarChar,       originalOrder.AreaID || 'General');
                fallaReq.input('Metros',   sql.Decimal(10,2), metersToReprint);
                fallaReq.input('ObsFalla', sql.NVarChar,      obsParaFalla);
                fallaReq.input('EquipoID', sql.Int,           equipoIdOriginal);
                fallaReq.input('TipoFalla', sql.Int,          tipoFallaReposicion);
                await fallaReq.query(`
                    INSERT INTO FallasProduccion
                        (OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones)
                    VALUES
                        (@OldID, @FileID, @AreaID, GETDATE(), @TipoFalla, @Metros, @EquipoID, @ObsFalla)
                `);
            } catch (e) {
                logger.warn(`FallasProduccion insert failed (metros=${metersToReprint}, equipo=${equipoIdOriginal}):`, e.message);
            }
        }

        // 3a. Archivos nuevos (1e, ya en Drive): Metros por copia según la unidad del área, como el ingreso del pedido
        // (m: el alto; m2: ancho × alto; por unidad: 0). Sin tope de copias: no repiten uno de la orden.
        const umRepo = limpioRepo(originalOrder.UM).toLowerCase();
        const archivosNuevosCreados = [];
        for (const n of nuevosMedidos) {
            const metros = umRepo === 'm2' ? Math.round(n.anchoM * n.altoM * 1000) / 1000 : umRepo === 'm' ? n.altoM : 0;
            const obsArchivo = [n.obs || 'Archivo nuevo de la reposición', contextInfo].filter(Boolean).join(' | ');
            const ins = await new sql.Request(transaction)
                .input('OID',    sql.Int,               newOrderId)
                .input('Nom',    sql.VarChar(200),      n.finalName)
                .input('Url',    sql.VarChar(500),      n.url)
                .input('Cop',    sql.Int,               n.copias)
                .input('Met',    sql.Decimal(10, 3),    metros)
                .input('Ancho',  sql.Decimal(10, 2),    n.anchoM)
                .input('Alto',   sql.Decimal(10, 2),    n.altoM)
                .input('Obs',    sql.NVarChar(sql.MAX), obsArchivo)
                .input('CodArt', sql.VarChar(50),       limpioRepo(telaCambiada ? telaCambiada.codArticulo : originalOrder.CodArticulo) || null)
                .query(`
                    INSERT INTO dbo.ArchivosOrden (
                        OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida,
                        Ancho, Alto, Observaciones, CodigoArticulo
                    )
                    OUTPUT INSERTED.ArchivoID
                    VALUES (@OID, @Nom, @Url, 'Impresion', @Cop, @Met, 'Pendiente', GETDATE(), @Ancho, @Alto, @Obs, @CodArt)
                `);
            archivosNuevosCreados.push({ ...n, archivoId: ins.recordset[0].ArchivoID });
            totalFiles++;

            // La falla queda registrada contra la orden original, sin archivo: el nuevo no es uno de los suyos
            try {
                await new sql.Request(transaction)
                    .input('OldID',     sql.Int,           originalOrderId)
                    .input('AreaID',    sql.VarChar,       originalOrder.AreaID || 'General')
                    .input('Metros',    sql.Decimal(10,2), metros)
                    .input('ObsFalla',  sql.NVarChar,      globalObsBase || `Reposición cliente - Orden ${originalOrder.CodigoOrden} (archivo nuevo)`)
                    .input('EquipoID',  sql.Int,           equipoIdOriginal)
                    .input('TipoFalla', sql.Int,           tipoFallaReposicion)
                    .query(`
                        INSERT INTO FallasProduccion
                            (OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones)
                        VALUES
                            (@OldID, NULL, @AreaID, GETDATE(), @TipoFalla, @Metros, @EquipoID, @ObsFalla)
                    `);
            } catch (e) {
                logger.warn(`FallasProduccion insert failed (archivo nuevo, metros=${metros}):`, e.message);
            }
        }

        // DTF: la plancha de tinta blanca de cada archivo repuesto (mismo arte que la original).
        // Best-effort: sin ella el operario la hace como antes, pero la reposición no se frena.
        try {
            const tb = await require('../services/dtfBlancoService').copiarTintaBlanca(transaction, newOrderId, archivosClonados.map(a => a.origId));
            if (tb) logger.info(`[Reposición] ${newCode}: ${tb} plancha(s) de tinta blanca copiadas de la original.`);
        } catch (eTb) {
            logger.warn(`[Reposición] ${newCode}: no se pudo copiar la tinta blanca: ${eTb.message}`);
        }

        // Actualizar contador archivos orden nueva
        try {
            await new sql.Request(transaction)
                .input('Total', sql.Int, totalFiles)
                .input('ID', sql.Int, newOrderId)
                .query("UPDATE Ordenes SET ArchivosCount = @Total WHERE OrdenID = @ID");
        } catch (e) { logger.info('Update ArchivosCount failed (ignoring):', e.message); }

        // Magnitud de la reposición = suma REAL de lo repuesto (según UM: metros o copias),
        // NO la Magnitud completa de la orden madre (que se copió en el INSERT). Así la planilla
        // muestra en CANTIDAD "los metros a reponer" y no el total de todos los archivos originales.
        try {
            await new sql.Request(transaction)
                .input('ID', sql.Int, newOrderId)
                .query(`
                    DECLARE @UM NVARCHAR(20) = (SELECT LTRIM(RTRIM(ISNULL(UM,'u'))) FROM dbo.Ordenes WHERE OrdenID = @ID);
                    DECLARE @Total FLOAT = 0;
                    -- Metros es POR COPIA (se valida contra los metros del archivo original, que también
                    -- lo son): la magnitud es Metros × Copias, igual que recalculateOrderMagnitude. Antes
                    -- sumaba solo Metros y una -R de 2 copias de 0,73 m quedaba en 0,73 (20/10/2026).
                    IF LEFT(LOWER(@UM),1) = 'm'
                        SELECT @Total = ISNULL(SUM(CAST(ISNULL(Metros,0) AS FLOAT) * CAST(ISNULL(Copias,1) AS FLOAT)),0) FROM dbo.ArchivosOrden WHERE OrdenID = @ID AND ISNULL(EstadoArchivo,'') <> 'CANCELADO';
                    ELSE
                        SELECT @Total = ISNULL(SUM(CAST(ISNULL(Copias,0) AS FLOAT)),0) FROM dbo.ArchivosOrden WHERE OrdenID = @ID AND ISNULL(EstadoArchivo,'') <> 'CANCELADO';
                    -- TPU afuera: con UM='u' cae en la rama de SUM(Copias) y contaría las CAPAS del
                    -- arte (boceto + cmyk + corte + …) como si fueran unidades pedidas — una orden
                    -- de 15 parches quedaba en 7. La cantidad de TPU se fija al crear el pedido.
                    UPDATE dbo.Ordenes SET Magnitud = CAST(FORMAT(@Total,'0.##') AS NVARCHAR(20))
                    WHERE OrdenID = @ID AND UPPER(LTRIM(RTRIM(ISNULL(AreaID,'')))) <> 'TPU';
                `);
        } catch (e) { logger.info('Update Magnitud reposición failed (ignoring):', e.message); }

        // 3b. TERMINACIONES DE LA REPOSICIÓN (ECOUV, 19/10/2026): la lona repuesta lleva las mismas
        // terminaciones que la original. Se copian ligadas a los archivos NUEVOS y la hermana
        // XEUV-…-R# se crea con el helper de siempre (marca "[TERMINACIONES DE …]" y la -R ruteada
        // a TERMINAC), igual que en el ingreso del pedido. Antes la -R copiaba el ProximoServicio
        // de la original — que terminaciones ya había pasado a DEPOSITO — y la XEUV salía como
        // copia suelta sin terminaciones: no aparecía en la bandeja, se cerraba a mano, sacaba su
        // propia etiqueta y la de la -R quedaba en un remito a Depósito que nadie retiraba
        // (pedido 30736, REM-902601).
        let hermanaRepo = null;
        if (String(originalOrder.AreaID || '').trim().toUpperCase() === 'ECOUV') {
            let terminacionesCopiadas = 0;
            for (const a of archivosClonados) {
                const r = await new sql.Request(transaction)
                    .input('NewOID', sql.Int, newOrderId)
                    .input('NewAID', sql.Int, a.newId)
                    .input('OldAID', sql.Int, a.origId)
                    .input('Copias', sql.Decimal(18, 4), a.copias)
                    .input('CopiasOrig', sql.Decimal(18, 4), a.copiasOrig)
                    .query(`
                        -- Cantidad es el total de todas las copias: se escala a las copias repuestas
                        -- (en unidades hacia arriba, no existe medio ojal). Las líneas siguen en la
                        -- orden que tenga la original (su XEUV o, legacy, la ECOUV): se buscan por archivo.
                        INSERT INTO OrdenTerminaciones (OrdenID, ArchivoID, TerminacionID, Cantidad, Ubicacion, ParamCliente)
                        SELECT @NewOID, @NewAID, OT.TerminacionID,
                               CASE WHEN @CopiasOrig <= 0 OR @Copias >= @CopiasOrig THEN OT.Cantidad
                                    WHEN UPPER(LTRIM(RTRIM(ISNULL(T.UnidadCobro, 'U')))) = 'U' THEN CEILING(OT.Cantidad * @Copias / @CopiasOrig)
                                    ELSE ROUND(OT.Cantidad * @Copias / @CopiasOrig, 2) END,
                               OT.Ubicacion, OT.ParamCliente
                        FROM OrdenTerminaciones OT
                        LEFT JOIN Terminaciones T ON T.TerminacionID = OT.TerminacionID
                        WHERE OT.ArchivoID = @OldAID AND ISNULL(OT.Estado, '') <> 'Cancelado'`);
                terminacionesCopiadas += r.rowsAffected[0] || 0;
            }

            if (terminacionesCopiadas > 0) {
                // La hermana copia la Nota de la -R: sin las instrucciones del cliente (ojales c/…,
                // soldadura…) terminaciones solo veía el texto de la falla.
                const instrucciones = (String(originalOrder.Nota || '').match(/\[TERMINACIONES: [^\]]*\]/) || [])[0];
                if (instrucciones) {
                    await new sql.Request(transaction)
                        .input('ID', sql.Int, newOrderId)
                        .input('Ins', sql.NVarChar(sql.MAX), instrucciones)
                        .query("UPDATE Ordenes SET Nota = CONCAT(@Ins, ' ', ISNULL(Nota, '')) WHERE OrdenID = @ID");
                }
                const { crearHermanaTerminaciones } = require('../utils/hermanaTerminaciones');
                hermanaRepo = await crearHermanaTerminaciones(transaction, newOrderId);
                if (hermanaRepo) {
                    await changeOrderState(transaction, {
                        target : { type: 'ORDER', id: hermanaRepo.hermanaId },
                        estado : 'Pendiente',
                        userObj: req.user || 'Sistema',
                        detalle: `Orden de terminaciones de la reposición ${newCode} (${hermanaRepo.cantTerm} terminaciones)`,
                        io     : req.app.get('socketio'),
                    });
                }
            } else if (String(originalOrder.ProximoServicio || '').trim().toUpperCase() === 'TERMINAC') {
                // Los archivos repuestos no llevan terminaciones (otros archivos del pedido sí):
                // la -R no tiene nada que hacer en el taller, va directo a Depósito.
                await new sql.Request(transaction).input('ID', sql.Int, newOrderId)
                    .query("UPDATE Ordenes SET ProximoServicio = 'DEPOSITO' WHERE OrdenID = @ID");
            }
        }

        // 4. Clonar Órdenes de Servicios Relacionados (Si existen)
        const relatedOrderIds = Array.isArray(body.relatedOrderIds) ? body.relatedOrderIds : [];
        if (relatedOrderIds.length > 0) {
            for (const relId of relatedOrderIds) {
                // Obtener datos orden relacionada
                const relRes = await new sql.Request(transaction)
                    .input('RID', sql.Int, relId)
                    .query("SELECT * FROM Ordenes WHERE OrdenID = @RID");

                if (relRes.recordset.length > 0) {
                    const relOrder = relRes.recordset[0];
                    // Las órdenes de FALLA (-F) son internas/efímeras: NO se reponen. Si el pedido tenía
                    // una falla, no se le genera una -R (si no, quedaban 2 reposiciones: madre + falla).
                    if ((relOrder.CodigoOrden || '').includes('-F')) {
                        logger.info(`[Reposición] Salteada orden de falla ${relOrder.CodigoOrden} (las -F no se reponen).`);
                        continue;
                    }
                    // La hermana de terminaciones no se clona suelta (quedaba sin terminaciones, fuera
                    // de la bandeja): si corresponde, ya la creó el paso 3b desde la ECOUV repuesta.
                    if (String(relOrder.AreaID || '').trim().toUpperCase() === 'TERMINAC') {
                        logger.info(`[Reposición] Salteada ${relOrder.CodigoOrden}: ${hermanaRepo ? `su reposición es ${hermanaRepo.codigo}, creada con las terminaciones` : 'los archivos repuestos no llevan terminaciones'}.`);
                        continue;
                    }
                    const relNewCode = `${stripRepoSuffix(relOrder.CodigoOrden)}${suffix}`; // Mismo sufijo, sobre la raíz (evita apilar -R)

                    const relIns = await new sql.Request(transaction)
                        .input('RelNewCode', sql.NVarChar, relNewCode)
                        .input('RelOldID', sql.Int, relId)
                        .input('GlobalObs', sql.NVarChar, [razonTexto, (globalObservation || '').trim()].filter(Boolean).join(' | ') || 'Reposición Cliente (Servicio)')
                        .query(`
                            INSERT INTO dbo.Ordenes(
                                CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega,
                                Material, DescripcionTrabajo, Prioridad,
                                Estado, EstadoenArea, AreaID,
                                Magnitud, IdCabezalERP, ProximoServicio, Observaciones, NoDocERP,
                                FechaEntradaSector, ArchivosCount, Variante, UM, 
                                IdClienteReact, IdProductoReact, CodCliente, CodArticulo, CostoTotal
                            )
                            SELECT
                                @RelNewCode, Cliente, GETDATE(), DATEADD(day, 2, GETDATE()),
                                Material, DescripcionTrabajo, 'Reposición',
                                'Pendiente', 'Pendiente', AreaID,
                                Magnitud, IdCabezalERP, ProximoServicio, @GlobalObs, NoDocERP,
                                GETDATE(), 0, Variante, UM,
                                IdClienteReact, IdProductoReact, CodCliente, CodArticulo, 0
                            FROM dbo.Ordenes
                            WHERE OrdenID = @RelOldID;

                            SELECT SCOPE_IDENTITY() AS NewID;
                        `);
                    // [REQUISITOS] Misma herencia que la -R principal (ver arriba).
                    const relNewId = relIns.recordset?.[0]?.NewID;
                    if (relNewId) {
                        try {
                            await heredarRequisitosCumplidos(transaction, relId, relNewId, 'reposición');
                        } catch (eReq) {
                            logger.warn(`[Reposición] No se pudieron heredar requisitos a ${relNewCode}: ${eReq.message}`);
                        }
                    }
                }
            }
        }

        await transaction.commit();
        logger.info(`[Reposición] ${newCode} (OrdenID ${newOrderId}) creada desde ${originalOrder.CodigoOrden} por usuario ${userId}${razon ? ` · razón #${razon.FallaID} «${razon.Titulo}»` : ''}.`);

        // Miniaturas del clon (best-effort, fuera de la transacción): mismo archivo de Drive,
        // así que se copia el JPG ya rasterizado en vez de volver a bajar y rasterizar.
        if (thumbsAcopiar.length > 0) {
            try {
                const { copyThumbnail } = require('../utils/thumbnailGenerator');
                let copiadas = 0;
                for (const t of thumbsAcopiar) {
                    if (copyThumbnail(originalOrder.CodigoOrden, t.origId, newCode, t.newId)) copiadas++;
                }
                if (copiadas > 0) logger.info(`🖼️  [Reposición] ${copiadas} miniatura(s) copiadas de ${originalOrder.CodigoOrden} a ${newCode}.`);
            } catch (e) { logger.warn('[Reposición] copia de miniaturas: ' + e.message); }
        }

        // Archivos nuevos: miniatura, tinta blanca de DTF y perfil de color, como después de subir el arte de un pedido
        // (webOrdersController, upload-stream). Best-effort y antes del finally, que borra los temporales.
        for (const n of archivosNuevosCreados) {
            try {
                const buffer = await fs.promises.readFile(n.path);
                const { generateThumbnail } = require('../utils/thumbnailGenerator');
                generateThumbnail(buffer, newCode, n.archivoId, n.finalName).catch(e => logger.warn('[Reposición] miniatura del archivo nuevo: ' + e.message));
                require('../services/dtfBlancoService').encolarSiCorresponde({ archivoId: n.archivoId, tmpPath: n.path, nombreArchivo: n.finalName, codigoOrden: newCode });
                const { extractColorProfile } = require('../utils/colorProfile');
                extractColorProfile(buffer, n.finalName)
                    .then(async (perfil) => {
                        if (!perfil) return;
                        await (await getPool()).request()
                            .input('ID', sql.Int, n.archivoId)
                            .input('Perfil', sql.NVarChar(200), perfil)
                            .query('UPDATE ArchivosOrden SET PerfilColor = @Perfil WHERE ArchivoID = @ID');
                    })
                    .catch(e => logger.warn('[Reposición] perfil de color del archivo nuevo: ' + e.message));
            } catch (e) { logger.warn(`[Reposición] ${newCode}: después de subir "${n.finalName}": ${e.message}`); }
        }

        res.json({
            success: true, newOrderId, newCode, hermanaTerminaciones: hermanaRepo?.codigo || null,
            telaCambiada: telaCambiada ? { antes: telaCambiada.antes, ahora: telaCambiada.ahora } : null,
            archivosNuevos: archivosNuevosCreados.map(n => n.finalName),
        });

    } catch (error) {
        if (transaction) await transaction.rollback();
        logger.error("Error createCustomerReplacementOrder:", error);
        res.status(500).json({ error: error.message });
    } finally {
        for (const f of subidos) if (f.path) fs.promises.unlink(f.path).catch(() => {});
    }
};

/**
 * 9. Obtener Órdenes Relacionadas (Mismo NoDocERP)
 */
const getRelatedOrders = async (req, res) => {
    try {
        const { ordenId } = req.params;
        const pool = await getPool();

        // Primero obtener NoDocERP y CodigoOrden de la orden actual
        const currentRes = await pool.request()
            .input('ID', sql.Int, ordenId)
            .query("SELECT NoDocERP, CodigoOrden FROM Ordenes WHERE OrdenID = @ID");

        if (!currentRes.recordset.length) return res.json([]);

        const { NoDocERP: noDoc, CodigoOrden: codigoActual } = currentRes.recordset[0];

        let relatedRes;

        if (noDoc) {
            // Caso normal: buscar por NoDocERP
            relatedRes = await pool.request()
                .input('NoDoc', sql.VarChar, noDoc)
                .input('ExcludeID', sql.Int, ordenId)
                .query(`
                    SELECT OrdenID, CodigoOrden, AreaID, DescripcionTrabajo, Estado, Material, RolloID
                    FROM Ordenes
                    WHERE NoDocERP = @NoDoc AND OrdenID != @ExcludeID
                    ORDER BY OrdenID
                `);
        } else {
            // Fallback: orden sin NoDocERP (ej. órdenes de prueba)
            // Si es una orden -F, buscar la madre; si es madre, buscar sus -F
            // (-\d+)? contempla el sufijo de linaje: SUB-9960-F14604-3 también es una -F.
            const isFalla = codigoActual.match(/-F\d+(-\d+)?$/);
            const baseCode = isFalla ? codigoActual.replace(/-F\d+(-\d+)?$/, '') : codigoActual;

            relatedRes = await pool.request()
                .input('BaseCode', sql.NVarChar, baseCode)
                .input('ExcludeID', sql.Int, ordenId)
                .query(`
                    SELECT OrdenID, CodigoOrden, AreaID, DescripcionTrabajo, Estado, Material, RolloID
                    FROM Ordenes
                    WHERE (CodigoOrden = @BaseCode OR CodigoOrden LIKE @BaseCode + '-F%')
                      AND OrdenID != @ExcludeID
                    ORDER BY OrdenID
                `);
        }

        res.json(relatedRes.recordset);

    } catch (error) {
        logger.error("Error getRelatedOrders:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Cierre manual de orden: llamado cuando el operador pulsa "Finalizar Orden".
 * Hace exactamente lo mismo que antes ocurría automáticamente al contar la última copia.
 */
async function completarOrden(req, res) {
    const { ordenId } = req.params;
    let transaction;
    try {
        const pool = await getPool();
        await ensureFallaColumn(pool); // el chequeo de fallas de abajo lee CopiasFalladas

        // ── GUARD: no re-procesar órdenes que ya están prontas o finalizadas ──
        // Se considera "ya lista" si: EstadoenArea IN ('Pronto', 'En Transito', 'Recibido en Destino')
        //                           O Estado = 'Finalizado'
        // [23/10/2026] 'Recibido en Destino': la orden ya salió y la recibió otra área. Volver a cerrarla
        // la regresaba a 'Pronto' en su área (SUB-31896, después de "CORREGIR FALLA" de su -F).
        const guardCheck = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                SELECT TOP 1 Estado, EstadoenArea
                FROM Ordenes
                WHERE OrdenID = @OID
                  AND (
                      UPPER(LTRIM(RTRIM(EstadoenArea))) IN ('PRONTO', 'EN TRANSITO', 'RECIBIDO EN DESTINO')
                      OR UPPER(LTRIM(RTRIM(Estado)))    = 'FINALIZADO'
                  )
            `);

        if (guardCheck.recordset.length > 0) {
            const { Estado, EstadoenArea } = guardCheck.recordset[0];
            logger.info(`[completarOrden] Orden ${ordenId} ya está en estado final (Estado=${Estado}, EstadoenArea=${EstadoenArea}). Se omite.`);
            return res.json({ success: true, skipped: true, nuevoEstado: Estado, estadoArea: EstadoenArea });
        }

        const rechazo = await rechazoSinImprimir(pool, { ordenId });
        if (rechazo) return res.status(400).json({ success: false, error: rechazo });

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // Verificar que realmente todos los archivos están completos
        const checkOrder = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`
                SELECT 
                    (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo != 'CANCELADO') + 
                    (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado != 'CANCELADO') as Total,
                    (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo IN ('OK', 'FINALIZADO')) +
                    (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado IN ('OK', 'FINALIZADO')) as Completed,
                    (SELECT UPPER(LTRIM(RTRIM(ISNULL(AreaID, '')))) FROM Ordenes WHERE OrdenID = @OID) as Area,
                    -- TPU: en control hay UNA línea por orden (los archivos son las capas del arte),
                    -- así que alcanza con que esa línea haya llegado a OK.
                    (SELECT COUNT(*) FROM ArchivosOrden
                      WHERE OrdenID = @OID AND EstadoArchivo IN ('OK', 'FINALIZADO')
                        AND LOWER(NombreArchivo) NOT LIKE '%boceto%') as ArteControlada
            `);

        const { Total, Completed, Area, ArteControlada } = checkOrder.recordset[0];
        // TPU: el control es por PARCHE, no por archivo. La vista muestra una sola línea (apoyada en
        // una capa del arte) y el resto de las capas queda en Pendiente porque nadie las cuenta; la
        // matriz, que vive en ServiciosExtraOrden, tampoco se controla. Contando filas esto daba
        // 1 de 6 y el cierre rebotaba. Acá la condición es que la línea de control esté completa.
        const esTPUCierre = String(Area || '') === 'TPU';
        
        // Si todos los archivos están cancelados (Total de válidos = 0), cancelar la orden entera
        if (Total === 0) {
            // [23/10/2026] Una orden de falla reportada desde otra área que nunca tuvo archivo de impresión
            // NO se cancela de oficio: se avisa que falta el archivo (SUB-31896-F2623 se canceló así y no
            // hubo etiqueta). Las fallas de Control no tienen reposición y siguen como siempre.
            const { fallasSinArchivoDeImpresion, avisoFallaSinArchivo } = require('../services/cadenaReposicionService');
            const sinArchivo = await fallasSinArchivoDeImpresion(transaction, [ordenId]);
            if (sinArchivo.length > 0) {
                const yaTuvo = await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                    .query("SELECT COUNT(*) AS n FROM ArchivosOrden WHERE OrdenID = @OID AND UPPER(LTRIM(RTRIM(ISNULL(TipoArchivo, '')))) = 'IMPRESION'");
                if ((yaTuvo.recordset[0]?.n || 0) === 0) {
                    await transaction.rollback();
                    return res.status(409).json({ success: false, error: avisoFallaSinArchivo(sinArchivo.map(x => x.CodigoOrden)) });
                }
            }
            await new sql.Request(transaction)
                .input('OID', sql.Int, ordenId)
                .query("UPDATE Ordenes SET EstadoLogistica='Cancelado', Observaciones = CONCAT(ISNULL(Observaciones,''), ' [Cancelada de oficio: Todos archivos cancelados]') WHERE OrdenID = @OID");
            // Tela cliente: devolver los metros consumidos también en la cancelación de oficio (idempotente).
            await devolverMetrosTelaCliente(transaction, ordenId, `Devolución por cancelación de oficio Orden ${ordenId}`, req.user?.id || 1);
            await changeOrderState(transaction, { target: { type: 'ORDER', id: ordenId }, estado: 'Cancelado', userObj: req.user || 'Sistema', detalle: 'Cancelada de oficio',
                io       : req.app.get('socketio')
            });
            
            await transaction.commit();

            const io = req.app.get('socketio');
            if (io) {
                io.emit('server:order_updated', { orderId: ordenId, status: 'CANCELADO', timestamp: new Date() });
                io.emit('server:ordersUpdated', { count: 1 });
            }

            return res.json({ success: true, nuevoEstado: 'CANCELADO', estadoLogistica: 'Cancelado', totalBultos: 0 });
        }

        if (esTPUCierre ? (ArteControlada || 0) === 0 : (Total !== Completed)) {
            await transaction.rollback();
            return res.status(400).json({
                error: esTPUCierre
                    ? 'Todavía faltan copias por controlar: la orden se cierra al llegar a la cantidad pedida.'
                    : 'La orden aún tiene archivos sin completar.'
            });
        }

        // Verificar si tiene fallas pendientes
        const fallaCheck = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`SELECT COUNT(*) as Fallas FROM ArchivosOrden WHERE OrdenID = @OID AND (EstadoArchivo = 'FALLA' OR ISNULL(CopiasFalladas, 0) > 0)`);
        const tieneFallas = (fallaCheck.recordset[0]?.Fallas || 0) > 0;

        // Verificar si es una orden de reposición (-F) y obtener código
        const codigoRes = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query("SELECT CodigoOrden, NoDocERP, AreaID, RolloID FROM Ordenes WHERE OrdenID = @OID");
        const codigoOrden = codigoRes.recordset[0]?.CodigoOrden || '';
        const noDocERP    = codigoRes.recordset[0]?.NoDocERP || null;
        const areaOrden   = codigoRes.recordset[0]?.AreaID || null;
        const rolloIdOrden = codigoRes.recordset[0]?.RolloID || null;
        // (-\d+)? contempla el sufijo de linaje (SUB-9960-F14604-3). Sin él, una reposición de
        // segundo nivel no se reconocía como -F y se salteaba TODO el cierre de reposición:
        // no finalizaba, no curaba a la madre ni a los eslabones previos.
        const isFallaOrder = /-F\d+(-\d+)?$/.test(codigoOrden);

        // Spec 39: una orden de falla con reposición registrada que tiene que VIAJAR (nació en otra
        // área por un faltante, o su madre ya salió en envío parcial) se termina como una orden
        // común (Pronto → etiqueta → complemento de la madre), no se guarda en el canasto de
        // reposiciones. Las fallas de siempre (sin registro) siguen exactamente igual.
        let fallaViajaComoComplemento = false;
        if (isFallaOrder && !tieneFallas) {
            try {
                const rep = await require('../services/reposicionesService').alTerminarOrdenFalla(transaction, ordenId, req.user || 'Sistema', req.app.get('socketio'));
                fallaViajaComoComplemento = !!(rep && rep.viaja);
            } catch (eRep) { logger.warn(`[completarOrden] reposiciones (Spec 39): ${eRep.message}`); }
        }

        // -F (falla interna) completada sin fallas → Finalizado (su material se incorpora a la
        // madre, no se despacha sola). Orden/reposición común → Pronto.
        const cierraEnCanasto = isFallaOrder && !fallaViajaComoComplemento;
        const nuevoEstado     = tieneFallas ? 'Retenido' : (cierraEnCanasto ? 'Finalizado' : 'Pronto');
        const nuevoEstadoArea = tieneFallas ? 'Retenido' : (cierraEnCanasto ? 'Finalizado' : 'Pronto');
        let estadoLogistica = tieneFallas
            ? 'Esperando Reposición'
            : (cierraEnCanasto ? 'Canasto Reposiciones' : 'Canasto Produccion');

        // ── PEDIDO COMPLETO EN ÁREA: órdenes hermanas divididas por tela (mismo NoDocERP) ──
        // Si al pasar esta orden a Pronto todavía quedan hermanas del mismo pedido en el área
        // sin estar prontas, la orden espera en 'Canasto Incompletos'. Si esta es la última,
        // se libera a todas las hermanas que esperaban al 'Canasto Produccion'.
        let pedidoCompletoEnArea = null;
        let faltantesPedido = [];
        let ordenesLiberadas = [];
        if (!tieneFallas && !isFallaOrder && noDocERP) {
            const chk = await isPedidoCompletoEnArea(transaction, noDocERP, areaOrden, { asumirProntaOrdenId: ordenId });
            pedidoCompletoEnArea = chk.completo;
            if (!chk.completo) {
                estadoLogistica = 'Canasto Incompletos';
                faltantesPedido = chk.faltantes.map(f => f.CodigoOrden);
                logger.info(`[completarOrden] Orden ${codigoOrden} → Canasto Incompletos. Faltan del pedido ${noDocERP}: ${faltantesPedido.join(', ')}`);
            } else {
                const libRes = await new sql.Request(transaction)
                    .input('NoDoc', sql.VarChar, String(noDocERP))
                    .input('Area', sql.VarChar, areaOrden)
                    .input('OID', sql.Int, ordenId)
                    .query(`
                        UPDATE Ordenes SET EstadoLogistica = 'Canasto Produccion'
                        OUTPUT INSERTED.OrdenID, INSERTED.CodigoOrden
                        WHERE NoDocERP = @NoDoc AND AreaID = @Area AND OrdenID != @OID
                          AND EstadoLogistica = 'Canasto Incompletos'
                    `);
                ordenesLiberadas = libRes.recordset;
                if (ordenesLiberadas.length > 0) {
                    await new sql.Request(transaction)
                        .input('UID', sql.Int, req.user?.id || 1)
                        .input('Accion', sql.NVarChar, 'PEDIDO_COMPLETO_LIBERA_CANASTO')
                        .input('Detalles', sql.NVarChar, `Pedido ${noDocERP} completo en ${areaOrden}. Liberadas de Canasto Incompletos: ${ordenesLiberadas.map(o => o.CodigoOrden).join(', ')}`)
                        .query(`INSERT INTO dbo.Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora) VALUES (@UID, @Accion, @Detalles, '127.0.0.1', GETDATE())`);
                    logger.info(`[completarOrden] Pedido ${noDocERP} completo en ${areaOrden}. Liberadas: ${ordenesLiberadas.map(o => o.CodigoOrden).join(', ')}`);
                }
            }
        }

        // CIERRE DE REPOSICIÓN: curar la familia. Este es el camino que usa el botón "CORREGIR FALLA"
        // (FilePrintControl → completarOrden), o sea el flujo NATURAL para cerrar una -F. La cura vivía
        // solo en postControlArchivo (marcar archivo por archivo en Control), así que acá no se hacía
        // nada: los eslabones previos de la cadena quedaban con su archivo en FALLA para siempre.
        if (isFallaOrder && !tieneFallas) {
            try {
                await sanarFamiliaTrasReposicion(transaction, { ordenId, codigoOrden, noDocERP, areaId: areaOrden });
                logger.info(`[completarOrden] Reposición ${codigoOrden} cerrada → familia curada (pedido ${noDocERP || 's/doc'}).`);
            } catch (eSanar) {
                logger.error(`[completarOrden] Error curando la familia tras reposición: ${eSanar.message}`);
            }
        }

        // Actualizar la orden
        await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`UPDATE Ordenes SET EstadoLogistica = '${estadoLogistica}' WHERE OrdenID = @OID`);

        // Control aprobó todo → la orden queda impresa (ver marcarImpresaAlCompletar).
        if (nuevoEstadoArea === 'Pronto') await marcarImpresaAlCompletar(transaction, ordenId);

        await changeOrderState(transaction, { target: { type: 'ORDER', id: ordenId }, estado: nuevoEstadoArea, userObj: req.user || 'Sistema', detalle: 'Completada manualmente',
                io       : req.app.get('socketio')
            });

        // [PRENDAS] Gate secuencial "Comprar y personalizar": si esta Orden es un DTF o
        // TPU que acaba de quedar Pronto, libera la Orden de Estampado que la esperaba
        // (si no tiene ninguna encadenada, la query no devuelve nada y no pasa nada).
        if (nuevoEstadoArea === 'Pronto' && ['DF', 'TPU'].includes(String(areaOrden || '').toUpperCase())) {
            try {
                const chainedRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .query(`SELECT OrdenID FROM Ordenes WHERE LiberaCuandoOrdenID = @OID AND EstadoDependencia = 'ESPERANDO_IMPRESION'`);
                for (const row of chainedRes.recordset) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, row.OrdenID)
                        .query(`UPDATE Ordenes SET EstadoDependencia = 'OK' WHERE OrdenID = @OID`);
                    await changeOrderState(transaction, {
                        target : { type: 'ORDER', id: row.OrdenID },
                        estado : 'Pendiente',
                        userObj: req.user || 'Sistema',
                        detalle: `DTF/TPU (Orden ${ordenId}) terminó — Estampado habilitado`,
                        guard  : "Estado = 'Cargando...'",
                        io     : req.app.get('socketio'),
                    });
                }
            } catch (eChain) {
                logger.warn(`[completarOrden] No se pudo liberar Estampado encadenado de Orden ${ordenId}: ${eChain.message}`);
            }
        }

        await transaction.commit();

        // Emitir socket para actualizar todas las pantallas
        const io = req.app.get('socketio');
        if (io) {
            io.emit('server:order_updated', { orderId: ordenId, status: nuevoEstado, timestamp: new Date() });
            for (const lib of ordenesLiberadas) {
                io.emit('server:order_updated', { orderId: lib.OrdenID, status: 'Pronto', timestamp: new Date() });
            }
            io.emit('server:ordersUpdated', { count: 1 + ordenesLiberadas.length });
        }

        // Si es una orden -F completada sin fallas: ya quedó Finalizada (arriba) y además
        // desbloqueamos la madre (Retenido → Pendiente) para que vuelva al lote de Control.
        if (isFallaOrder && !tieneFallas) {
            try {
                // Se desbloquea TODA la familia, no solo la raíz: el replace se come el sufijo entero
                // (SUB-X-F123-2 → SUB-X) y el match exacto dejaba afuera al eslabón intermedio, que
                // quedaba en 'Con Falla' para siempre aunque su falla ya estuviera repuesta.
                const codigoMadre = codigoOrden.replace(/-F\d+(-\d+)?$/, '');
                const madreRes = await pool.request()
                    .input('CodigoMadre', sql.NVarChar, codigoMadre)
                    .input('NoDoc', sql.VarChar(50), noDocERP)
                    .input('AreaID', sql.VarChar(50), areaOrden)
                    .input('OID', sql.Int, ordenId)
                    .query(`
                        SELECT O.OrdenID, O.CodigoOrden,
                               (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = O.OrdenID AND EstadoArchivo = 'FALLA') as FallasRestantes
                        FROM Ordenes O
                        WHERE O.OrdenID <> @OID
                          AND (
                              (@NoDoc IS NOT NULL AND O.NoDocERP = @NoDoc AND O.AreaID = @AreaID)
                              OR (@NoDoc IS NULL AND (O.CodigoOrden = @CodigoMadre OR O.CodigoOrden LIKE @CodigoMadre + '-F%'))
                          )
                    `);
                for (const fam of madreRes.recordset) {
                    const { OrdenID: famId, CodigoOrden: famCod, FallasRestantes } = fam;
                    if (FallasRestantes !== 0) continue;
                    // Solo desbloquear: Retenido → Pendiente (vuelve al lote de Control).
                    // El operador la finalizará manualmente junto con el resto del lote.
                    const mdCheck = await pool.request()
                        .input('MID', sql.Int, famId)
                        .query(`SELECT Estado FROM Ordenes WHERE OrdenID = @MID AND Estado IN ('Retenido', 'RETENIDO')`);
                    if (mdCheck.recordset.length > 0) {
                        await changeOrderState(pool, { target: { type: 'ORDER', id: famId }, estado: 'Pendiente', userObj: req.user || 'Sistema', detalle: 'Desbloqueo automático post-reposición' });
                        logger.info(`[completarOrden] ${famCod} desbloqueada → Pendiente (esperando finalización manual en lote)`);
                    }
                    if (io) io.emit('server:order_updated', { orderId: famId, status: 'Pendiente' });
                }
            } catch (eMadre) {
                logger.error(`[completarOrden] Error desbloqueando madre: ${eMadre.message}`);
            }
        }

        // --- RE-AVISO WSP: Si una reposición cliente (-R) se completó, resetear aviso de la madre ---
        if (!tieneFallas && /-R\d+$/i.test(codigoOrden)) {
            try {
                const codigoMadreR = codigoOrden.replace(/-R\d+$/i, '');
                // Incluye madres divididas por tela con sufijo: 'SUB-154 (1/2)', 'SUB-154 (2/2)'
                const resetRes = await pool.request()
                    .input('CodigoMadre', sql.NVarChar, codigoMadreR)
                    .query(`
                        UPDATE OrdenesDeposito
                        SET OrdAvisoWsp = 0, OrdFechaAvisoWsp = NULL
                        WHERE (OrdCodigoOrden = @CodigoMadre OR OrdCodigoOrden LIKE @CodigoMadre + ' (%')
                          AND ISNULL(OrdAvisoWsp, 0) = 1
                    `);
                if (resetRes.rowsAffected[0] > 0) {
                    logger.info(`[completarOrden] ✅ Reposición ${codigoOrden} pronta → re-aviso WSP programado para orden madre ${codigoMadreR}`);
                }
            } catch (eReaviso) {
                logger.error(`[completarOrden] Error reseteando aviso WSP para madre de ${codigoOrden}: ${eReaviso.message}`);
            }
        }

        // Generar etiquetas si corresponde
        // Guard: si ya tienen etiquetas (generadas en postControlArchivo) no regenerar para evitar descalce de códigos
        // IMPORTANTE: también se generan para órdenes con fallas (Retenido) para que circulen físicamente
        let totalBultos = 0;
        let etiquetasError = null;   // motivo por el que no se generaron, para avisar en pantalla
        try {
            const existingLabels = await pool.request()
                .input('OID', sql.Int, ordenId)
                .query("SELECT COUNT(*) as cnt FROM Etiquetas WHERE OrdenID = @OID");
            const yaExisten = (existingLabels.recordset[0]?.cnt || 0) > 0;

            if (yaExisten) {
                // Ya tienen etiquetas → no regenerar, solo contabilizar
                totalBultos = existingLabels.recordset[0].cnt;
                logger.info(`[completarOrden] Orden ${ordenId} ya tiene ${totalBultos} etiqueta(s). Se omite regeneración.`);
            } else {
                const checkMag = await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .query("SELECT SUM(Cantidad) as TotalCantidad FROM PedidosCobranzaDetalle WHERE OrdenID = @OID");
                const magVal = parseFloat(checkMag.recordset[0]?.TotalCantidad) || 0;

                const prioridadRes = await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .query("SELECT Prioridad FROM Ordenes WHERE OrdenID = @OID");
                const prioridadStr = (prioridadRes.recordset[0]?.Prioridad || '').toUpperCase();
                const esReposicion = codigoOrden.includes('-R') || prioridadStr === 'REPOSICIÓN' || prioridadStr === 'REPOSICION';

                // Trabajo interno de un pedido con PRO: sin cotización propia a propósito.
                const sinCotizacionPropia = (magVal > 0 || esReposicion) ? false : await esTrabajoInternoDePedidoConPro(pool, ordenId);
                // [23/10/2026] Una orden de falla que VIAJA a otra área (reposición de otra área, ver
                // reposicionesService.alTerminarOrdenFalla) nace sin costo y no se cotiza: igual necesita su
                // etiqueta para el remito. Antes solo salía si el pedido tenía PRO.
                if (magVal > 0 || esReposicion || sinCotizacionPropia || fallaViajaComoComplemento) {
                    const labelResult = await LabelGenerationService.regenerateLabelsForOrder(
                        ordenId, (req.user?.id || 1), (req.user?.usuario || 'Sistema')
                    );
                    if (labelResult.success) {
                        totalBultos = labelResult.totalBultos;
                        logger.info(`[completarOrden] Etiquetas generadas para orden ${nuevoEstado} ${ordenId}: ${totalBultos} bulto(s).`);
                    } else {
                        // El motivo VUELVE A LA PANTALLA: sin etiqueta no hay bulto y sin
                        // bulto no se puede armar el remito. Si esto se queda solo en el
                        // log, el operario se entera recién al ir a despachar.
                        etiquetasError = labelResult.error;
                        logger.warn(`[completarOrden] No se pudieron generar etiquetas: ${labelResult.error}`);
                    }
                } else {
                    etiquetasError = await mensajeSinCantidadCotizada(pool, ordenId);
                    logger.info(`[completarOrden] Orden ${ordenId} sin magnitud cotizada, no se generan etiquetas.`);
                }
            }
        } catch (eLabels) {
            etiquetasError = eLabels.message;
            logger.warn(`[completarOrden] Error etiquetas: ${eLabels.message}`);
        }


        // AUTO-CLEANUP: si esta era la última orden activa del lote, cerrarlo (ver loteCleanupService)
        if (rolloIdOrden) {
            await cerrarLoteSiResuelto(rolloIdOrden, req.app.get('socketio'));
        }

        res.json({
            success: true, nuevoEstado, estadoLogistica, totalBultos,
            etiquetasError,          // si viene, la orden quedó SIN etiqueta (y sin bulto para el remito)
            codigoOrden,
            pedidoCompletoEnArea,
            faltantesPedido,
            ordenesLiberadas: ordenesLiberadas.map(o => o.CodigoOrden)
        });

    } catch (err) {
        if (transaction) { try { await transaction.rollback(); } catch (e) {} }
        logger.error('Error completarOrden:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * CONFIRMAR FALLA: registra en auditoría que el operador confirmó
 * que movió físicamente las órdenes al Canasto Falla.
 */
const confirmarFalla = async (req, res) => {
    const { userId, noDocERP, areaId, ordenesAfectadas = [] } = req.body;
    try {
        const pool = await getPool();
        const detalle = `Operador confirmó movimiento a Canasto Falla. Órdenes: ${ordenesAfectadas.join(', ')}`;
        await pool.request()
            .input('UID',     sql.Int,               userId || 1)
            .input('Accion',  sql.NVarChar(100),     'CONFIRM_CANASTO_FALLA')
            .input('Detalle', sql.NVarChar(sql.MAX),  detalle)
            .query(`INSERT INTO dbo.Auditoria (UsuarioID, Accion, Detalle, Fecha)
                    VALUES (@UID, @Accion, @Detalle, GETDATE())`);
        res.json({ success: true });
    } catch (err) {
        logger.error('confirmarFalla:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * LIBERAR CANASTO FALLA: mueve todas las órdenes del pedido de
 * 'Canasto Falla' a 'Canasto Produccion' y registra en auditoría.
 */
const liberarCanastaFalla = async (req, res) => {
    const { userId, noDocERP, areaId } = req.body;
    if (!noDocERP || !areaId) return res.status(400).json({ error: 'Faltan noDocERP o areaId' });

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 1. Verificar que todo esté OK (seguridad doble)
        const checkRes = await new sql.Request(transaction)
            .input('NoDoc',  sql.VarChar(50), noDocERP)
            .input('AreaID', sql.VarChar(50), areaId)
            .query(`SELECT COUNT(*) as SinResolver
                    FROM ArchivosOrden AO
                    INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                    WHERE O.NoDocERP = @NoDoc
                      AND O.AreaID   = @AreaID
                      AND O.Estado  NOT IN ('CANCELADO')
                      AND (AO.EstadoArchivo IS NULL
                        OR AO.EstadoArchivo NOT IN ('OK','Finalizado','CANCELADO'))`);

        const sinResolver = checkRes.recordset[0]?.SinResolver || 0;
        if (sinResolver > 0) {
            await transaction.rollback();
            return res.status(409).json({ error: `Todavía hay ${sinResolver} archivo(s) sin resolver.` });
        }

        // 2. Mover Canasto Falla → Canasto Produccion
        const updRes = await new sql.Request(transaction)
            .input('NoDoc',  sql.VarChar(50), noDocERP)
            .input('AreaID', sql.VarChar(50), areaId)
            .query(`UPDATE Ordenes
                       SET EstadoLogistica = 'Canasto Produccion'
                     WHERE NoDocERP = @NoDoc
                       AND AreaID   = @AreaID
                       AND EstadoLogistica = 'Canasto Falla'
                       AND Estado NOT IN ('CANCELADO')`);
        const cantActualizadas = updRes.rowsAffected[0] || 0;

        // 3. Auditoría
        await new sql.Request(transaction)
            .input('UID',     sql.Int,               userId || 1)
            .input('Accion',  sql.NVarChar(100),     'LIBERACION_CANASTO_FALLA')
            .input('Detalle', sql.NVarChar(sql.MAX),  `Pedido ${noDocERP} / Área ${areaId}: ${cantActualizadas} órdenes liberadas a Canasto Producción.`)
            .query(`INSERT INTO dbo.Auditoria (UsuarioID, Accion, Detalle, Fecha)
                    VALUES (@UID, @Accion, @Detalle, GETDATE())`);

        await transaction.commit();
        res.json({ success: true, ordenesActualizadas: cantActualizadas });

    } catch (err) {
        if (transaction) { try { await transaction.rollback(); } catch (e) {} }
        logger.error('liberarCanastaFalla:', err.message);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getOrdenes,
    getArchivosPorOrden,
    viewDriveFile,
    postControlArchivo,
    getTiposFalla,
    getFallasImagenes,
    getFallasImagenesLote,
    getFallasOrden,
    regenerateEtiquetas,
    updateFileCopyCount,
    getCompletedOrdersForReplacement,
    createCustomerReplacementOrder,
    getOpcionesReposicion,
    getRelatedOrders,
    completarOrden,
    getMotivosCancelacion,
    confirmarFalla,
    liberarCanastaFalla,
    recalcularContadoresEtiquetas,
    // exportada para poder probar la cura (parcial/whole-file) de forma aislada
    sanarFamiliaTrasReposicion
};

