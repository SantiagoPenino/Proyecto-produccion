const { sql, getPool } = require('../config/db');
const PricingService = require('../services/pricingService');
const LabelGenerationService = require('../services/LabelGenerationService');
const driveService = require('../services/driveService');
const logger = require('../utils/logger');
const { changeOrderState } = require('../services/stateManagerService');
const { saveFallaImage } = require('../utils/thumbnailGenerator');
const { devolverMetrosTelaCliente } = require('../utils/telaClienteDevolucion');

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
const { cancelarLoteSiVacio } = require('../services/loteCleanupService');

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
                                LTRIM(RTRIM(ISNULL(O.ModoRetiro, ''))) AS ModoRetiro
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
            const tipoFallaDesc = fallaIDClean;  // se muestra el ID; podría JOIN TiposFalla si existe
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
            // Motivo SIEMPRE presente: si el operario no escribe nada, la línea quedaba muda
            // ("Máquina: X | Lote: Y") sin decir por qué falló.
            partesFalla.push(`Motivo: ${safeMotivo || '(sin especificar)'}`);
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

        // --- AUTO-CLEANUP: Si la orden pertenecía a un lote, verificar si el lote quedó vacío ---
        // (helper compartido: también corre al cancelar/finalizar órdenes fuera de Control)
        if (rolloId) {
            await cancelarLoteSiVacio(rolloId, req.app.get('socketio'));
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

                    if (magVal > 0) {
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
                        etiquetasError = 'La orden no tiene cantidad cotizada, así que no se generaron etiquetas. Revisá "Cotizar Productos".';
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
const getTiposFalla = async (req, res) => {
    try {
        const { areaId } = req.query;
        const pool = await getPool();

        let query = "SELECT FallaID, Titulo, DescripcionDefault FROM TiposFallas";
        if (areaId) {
            query += " WHERE AreaID = @AreaID";
        }
        query += " ORDER BY EsFrecuente DESC, Titulo ASC";

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
                O.Estado, O.Material, O.DescripcionTrabajo, O.NoDocERP
            FROM Ordenes O WITH (NOLOCK)
            LEFT JOIN Clientes C WITH (NOLOCK) ON C.CliIdCliente = O.CliIdCliente
            WHERE O.Estado IN ('ENTREGADO', 'FINALIZADO', 'DESPACHADO', 'PRONTO')
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

/**
 * 8. Crear Orden de Reposición (Batch)
 * Recibe lista de archivos a reponer de una orden ya terminada.
 */
const createCustomerReplacementOrder = async (req, res) => {
    const { originalOrderId, files, globalObservation, userId } = req.body;
    let transaction;

    try {
        if (!originalOrderId || !files || files.length === 0) {
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
                       CE.EquipoID as EquipoID
                FROM Ordenes O
                LEFT JOIN Rollos R ON O.RolloID = R.RolloID
                LEFT JOIN ConfigEquipos CE ON ISNULL(O.MaquinaID, R.MaquinaID) = CE.EquipoID
                WHERE O.OrdenID = @ID
            `);

        if (ordRes.recordset.length === 0) throw new Error("Orden original no encontrada");
        const originalOrder = ordRes.recordset[0];

        // 1b. Obtener datos originales de los archivos para validar límites (metros y copias)
        const fileIds = files.map(f => parseInt(f.id)).filter(id => !isNaN(id));
        const placeholders = fileIds.map((_, i) => `@FID${i}`).join(',');
        const origFilesReq = new sql.Request(transaction);
        fileIds.forEach((id, i) => origFilesReq.input(`FID${i}`, sql.Int, id));
        const origFilesRes = await origFilesReq.query(
            `SELECT ArchivoID, Metros as MetrosOrig, Copias as CopiasOrig FROM dbo.ArchivosOrden WHERE ArchivoID IN (${placeholders})`
        );
        const origFilesMap = {};
        origFilesRes.recordset.forEach(r => { origFilesMap[r.ArchivoID] = r; });

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

        // 2. Crear Nueva Orden de Reposición
        // El código se construye sobre la RAÍZ (sin sufijos -R previos): la reposición de una
        // reposición debe incrementar (-R2), no apilar (-R1-R1). Se strippean TODOS los -R\d+ del
        // final, así también se normalizan casos legacy ya apilados ("-R1-R1" → raíz).
        const stripRepoSuffix = (c) => (c || '').replace(/(-R\d+)+$/i, '');
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
        // Ordenes.Nota = "[texto del usuario] | Máquina: X | Lote: Y"
        const ordenNota = contextInfo
            ? (globalObsBase ? `${globalObsBase} | ${contextInfo}` : contextInfo)
            : (globalObsBase || 'Reposición Cliente');

        // EquipoID de la máquina original (para FallasProduccion)
        const equipoIdOriginal = originalOrder.EquipoID || null;

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

        let totalFiles = 0;

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

            // Insertar archivo en la nueva orden
            await new sql.Request(transaction)
                .input('NewOrderID', sql.Int,             newOrderId)
                .input('OldFileID',  sql.Int,             oldFileId)
                .input('Metros',     sql.Decimal(10,2),   metersToReprint)
                .input('Copias',     sql.Int,             copiesToReprint)
                .input('Obs',        sql.NVarChar,        notaOrden)
                .query(`
                    INSERT INTO dbo.ArchivosOrden(
                        OrdenID, NombreArchivo, RutaAlmacenamiento, Metros, Copias, Ancho, Alto, Observaciones,
                        FechaSubida, EstadoArchivo, TipoArchivo
                    )
                    SELECT
                        @NewOrderID, NombreArchivo, RutaAlmacenamiento, @Metros, @Copias, Ancho, Alto, @Obs,
                        GETDATE(), 'Pendiente', TipoArchivo
                    FROM dbo.ArchivosOrden WHERE ArchivoID = @OldFileID
                `);

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
                await fallaReq.query(`
                    INSERT INTO FallasProduccion
                        (OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones)
                    VALUES
                        (@OldID, @FileID, @AreaID, GETDATE(), 1, @Metros, @EquipoID, @ObsFalla)
                `);
            } catch (e) {
                logger.warn(`FallasProduccion insert failed (metros=${metersToReprint}, equipo=${equipoIdOriginal}):`, e.message);
            }
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
                    IF LEFT(LOWER(@UM),1) = 'm'
                        SELECT @Total = ISNULL(SUM(CAST(ISNULL(Metros,0) AS FLOAT)),0) FROM dbo.ArchivosOrden WHERE OrdenID = @ID AND ISNULL(EstadoArchivo,'') <> 'CANCELADO';
                    ELSE
                        SELECT @Total = ISNULL(SUM(CAST(ISNULL(Copias,0) AS FLOAT)),0) FROM dbo.ArchivosOrden WHERE OrdenID = @ID AND ISNULL(EstadoArchivo,'') <> 'CANCELADO';
                    -- TPU afuera: con UM='u' cae en la rama de SUM(Copias) y contaría las CAPAS del
                    -- arte (boceto + cmyk + corte + …) como si fueran unidades pedidas — una orden
                    -- de 15 parches quedaba en 7. La cantidad de TPU se fija al crear el pedido.
                    UPDATE dbo.Ordenes SET Magnitud = CAST(FORMAT(@Total,'0.##') AS NVARCHAR(20))
                    WHERE OrdenID = @ID AND UPPER(LTRIM(RTRIM(ISNULL(AreaID,'')))) <> 'TPU';
                `);
        } catch (e) { logger.info('Update Magnitud reposición failed (ignoring):', e.message); }

        // 4. Clonar Órdenes de Servicios Relacionados (Si existen)
        const relatedOrderIds = req.body.relatedOrderIds || [];
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
                    const relNewCode = `${stripRepoSuffix(relOrder.CodigoOrden)}${suffix}`; // Mismo sufijo, sobre la raíz (evita apilar -R)

                    await new sql.Request(transaction)
                        .input('RelNewCode', sql.NVarChar, relNewCode)
                        .input('RelOldID', sql.Int, relId)
                        .input('GlobalObs', sql.NVarChar, globalObservation || 'Reposición Cliente (Servicio)')
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
                            WHERE OrdenID = @RelOldID
                        `);
                }
            }
        }

        await transaction.commit();
        res.json({ success: true, newOrderId, newCode });

    } catch (error) {
        if (transaction) await transaction.rollback();
        logger.error("Error createCustomerReplacementOrder:", error);
        res.status(500).json({ error: error.message });
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
        // Se considera "ya lista" si: EstadoenArea IN ('Pronto', 'En Transito')
        //                           O Estado = 'Finalizado'
        const guardCheck = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                SELECT TOP 1 Estado, EstadoenArea
                FROM Ordenes
                WHERE OrdenID = @OID
                  AND (
                      UPPER(LTRIM(RTRIM(EstadoenArea))) IN ('PRONTO', 'EN TRANSITO')
                      OR UPPER(LTRIM(RTRIM(Estado)))    = 'FINALIZADO'
                  )
            `);

        if (guardCheck.recordset.length > 0) {
            const { Estado, EstadoenArea } = guardCheck.recordset[0];
            logger.info(`[completarOrden] Orden ${ordenId} ya está en estado final (Estado=${Estado}, EstadoenArea=${EstadoenArea}). Se omite.`);
            return res.json({ success: true, skipped: true, nuevoEstado: Estado, estadoArea: EstadoenArea });
        }

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

        // -F (falla interna) completada sin fallas → Finalizado (su material se incorpora a la
        // madre, no se despacha sola). Orden/reposición común → Pronto.
        const nuevoEstado     = tieneFallas ? 'Retenido' : (isFallaOrder ? 'Finalizado' : 'Pronto');
        const nuevoEstadoArea = tieneFallas ? 'Retenido' : (isFallaOrder ? 'Finalizado' : 'Pronto');
        let estadoLogistica = tieneFallas
            ? 'Esperando Reposición'
            : (isFallaOrder ? 'Canasto Reposiciones' : 'Canasto Produccion');

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

                if (magVal > 0 || esReposicion) {
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
                    etiquetasError = 'La orden no tiene cantidad cotizada, así que no se generaron etiquetas. Revisá "Cotizar Productos".';
                    logger.info(`[completarOrden] Orden ${ordenId} sin magnitud cotizada, no se generan etiquetas.`);
                }
            }
        } catch (eLabels) {
            etiquetasError = eLabels.message;
            logger.warn(`[completarOrden] Error etiquetas: ${eLabels.message}`);
        }


        // AUTO-CLEANUP: si esta era la última orden activa del lote, cancelarlo y liberar la máquina
        if (rolloIdOrden) {
            await cancelarLoteSiVacio(rolloIdOrden, req.app.get('socketio'));
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
    regenerateEtiquetas,
    updateFileCopyCount,
    getCompletedOrdersForReplacement,
    createCustomerReplacementOrder,
    getRelatedOrders,
    completarOrden,
    getMotivosCancelacion,
    confirmarFalla,
    liberarCanastaFalla,
    recalcularContadoresEtiquetas,
    // exportada para poder probar la cura (parcial/whole-file) de forma aislada
    sanarFamiliaTrasReposicion
};

