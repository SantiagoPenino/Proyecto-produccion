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
    `);
    _fallaColEnsured = true;
}
const { isPedidoCompletoEnArea } = require('../services/pedidoCompletoService');
const { cancelarLoteSiVacio } = require('../services/loteCleanupService');

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
                                O.EstadoenArea
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

        // logger.info(`Getting Archivos for OrdenID: ${ordenId} `);

        // 1. Obtener Archivos y Servicios (UNION)
        let queryStr = `
            SELECT 
                AO.ArchivoID, AO.OrdenID, AO.NombreArchivo, AO.RutaAlmacenamiento, AO.Metros, AO.Copias, 
                AO.Controlcopias, AO.EstadoArchivo, AO.UsuarioControl, AO.FechaControl, AO.Observaciones, AO.TipoArchivo,
                AO.Ancho, AO.Alto, AO.CodigoArticulo, AO.FechaSubida,
                AO.PreflightVeredicto, AO.PreflightReporte,
                O.Material as Material, O.Cliente as Cliente, O.AreaID as AreaActual, O.NoDocERP, 0 as isService
            FROM ArchivosOrden AO WITH (NOLOCK)
            LEFT JOIN Ordenes O WITH (NOLOCK) ON AO.OrdenID = O.OrdenID
            WHERE AO.OrdenID = @OrdenID

            UNION ALL

            SELECT 
                SEO.ServicioID as ArchivoID, SEO.OrdenID, SEO.Descripcion as NombreArchivo, NULL as RutaAlmacenamiento, NULL as Metros, SEO.Cantidad as Copias, 
                ISNULL(SEO.Controlcopias, 0) as Controlcopias, SEO.Estado as EstadoArchivo, SEO.UsuarioControl, SEO.FechaControl, SEO.Observaciones as Observaciones, 'Servicio' as TipoArchivo,
                0 as Ancho, 0 as Alto, SEO.CodArt as CodigoArticulo, SEO.FechaRegistro as FechaSubida,
                NULL as PreflightVeredicto, NULL as PreflightReporte,
                O.Material as Material, O.Cliente as Cliente, O.AreaID as AreaActual, O.NoDocERP, 1 as isService
            FROM ServiciosExtraOrden SEO WITH (NOLOCK)
            LEFT JOIN Ordenes O WITH (NOLOCK) ON SEO.OrdenID = O.OrdenID
            WHERE SEO.OrdenID = @OrdenID
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

            await new sql.Request(transaction)
                .input('Estado', sql.NVarChar, estado)
                .input('Usuario', sql.NVarChar, usuario || 'System')
                .input('Motivo', sql.NVarChar, motivo || '')
                .input('ID', sql.Int, archivoId)
                .query(`
                    UPDATE ArchivosOrden
                    SET EstadoArchivo = @Estado,
                        FechaControl = GETDATE(),
                        UsuarioControl = @Usuario,
                        Observaciones = @Motivo
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

            // Partes de la nota
            const partesFalla = [];
            if (safeMotivo)     partesFalla.push(`Motivo: ${safeMotivo}`);
            if (metrosReponer)  partesFalla.push(`Reponer: ${metrosReponer}m`);
            if (nombreMaquina)  partesFalla.push(`Máquina: ${nombreMaquina}`);
            if (nombreLote)     partesFalla.push(`Lote: ${nombreLote}`);
            const notaFallaDetalle = partesFalla.join(' | ');
            // Nota final = nota original + detalle de la falla
            const notaFinal = notaOriginal
                ? `${notaOriginal} || FALLA: ${notaFallaDetalle}`
                : (notaFallaDetalle || 'Reposición por Falla');

            const obsFalla = metrosReponer
                ? `${safeMotivo} (Reponer: ${metrosReponer}m)`
                : safeMotivo;

            const nuevoCodigo = `${codigoOrden}-F${archivoId}`;

            // ── Buscar si ya existe una orden -F activa para esta madre ──
            const existingFallaRes = await new sql.Request(transaction)
                .input('BaseCode', sql.NVarChar, codigoOrden)
                .query(`
                    SELECT TOP 1 OrdenID, CodigoOrden, ArchivosCount
                    FROM dbo.Ordenes
                    WHERE CodigoOrden LIKE @BaseCode + '-F%'
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
                    .query(`
                        -- Actualizamos la orden original
                        UPDATE dbo.Ordenes
                        SET Observaciones = CONCAT(ISNULL(Observaciones,''), ' [Esperando Reposición]')
                        WHERE OrdenID = @OldID;

                        -- Actualizamos la orden de falla para concatenar la nueva nota
                        UPDATE dbo.Ordenes
                        SET Nota = CONCAT(ISNULL(Nota,''), @NotaAdd)
                        WHERE OrdenID = @NewFallaID;

                        INSERT INTO FallasProduccion(OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones, ImagenFalla)
                        VALUES(@OldID, @ArchivoID, @AreaID, GETDATE(), @TipoFallaID, @CantidadFalla, @EquipoID, @SafeMotivo, @ImagenFalla);
                    `);
            } else {
                // ── CREAR nueva orden -F ──
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
                    .query(`
                        -- Nueva Orden de Falla
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
                            @NewCode, Cliente, GETDATE(), FechaEstimadaEntrega,
                            Material, DescripcionTrabajo, 'Falla',
                            'Pendiente', 'Pendiente', AreaID,
                            (CASE WHEN @IsSB = 1 THEN 0 ELSE Magnitud END), IdCabezalERP, ProximoServicio, @NotaFinal, NoDocERP,
                            GETDATE(), 1, Variante, UM,
                            IdClienteReact, CliIdCliente, CodCliente,
                            IdProductoReact, ProIdProducto, CodArticulo, 0
                        FROM dbo.Ordenes
                        WHERE OrdenID = @OldID;

                        UPDATE dbo.Ordenes
                        SET Observaciones = CONCAT(ISNULL(Observaciones,''), ' [Esperando Reposición]')
                        WHERE OrdenID = @OldID;

                        -- Registrar Falla en tabla auxiliar
                        INSERT INTO FallasProduccion(OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones, ImagenFalla)
                        VALUES(@OldID, @ArchivoID, @AreaID, GETDATE(), @TipoFallaID, @CantidadFalla, @EquipoID, @SafeMotivo, @ImagenFalla);
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

                const insertRequest = new sql.Request(transaction)
                    .input('NewOrderID', sql.Int, newOrderId)
                    .input('OldFileID', sql.Int, archivoId);

                if (metrosReponer !== null) {
                    insertRequest.input('MetrosReponer', sql.Decimal(10, 2), metrosReponer);
                }

                // Si el archivo ya existe en la orden -F (mismo NombreArchivo),
                // actualizar sus metros en lugar de duplicarlo
                await insertRequest.query(`
                    -- Si ya existe el archivo, actualizar los metros
                    UPDATE AO2
                    SET AO2.Metros = ${metrosUpd},
                        AO2.Observaciones = 'Reposición por Falla (actualizado)'
                    FROM dbo.ArchivosOrden AO2
                    INNER JOIN dbo.ArchivosOrden AO_SRC ON AO_SRC.ArchivoID = @OldFileID
                    WHERE AO2.OrdenID = @NewOrderID
                      AND AO2.NombreArchivo = AO_SRC.NombreArchivo;

                    -- Si no existía, insertar
                    IF @@ROWCOUNT = 0
                    BEGIN
                        INSERT INTO dbo.ArchivosOrden(
                            OrdenID, NombreArchivo, RutaAlmacenamiento, Metros, Copias, Ancho, Alto, Observaciones,
                            TipoArchivo, FechaSubida, EstadoArchivo
                        )
                        SELECT
                            @NewOrderID, NombreArchivo, RutaAlmacenamiento, ${metrosIns}, Copias, Ancho, Alto, 'Reposición por Falla',
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

                // Actualizar Magnitud con la suma real de metros de los archivos de la falla
                // (la orden madre puede haber tenido Magnitud=0 si el ERP sync ocurrió después)
                await new sql.Request(transaction)
                    .input('FallaOrderID2', sql.Int, newOrderId)
                    .query(`
                        UPDATE dbo.Ordenes
                        SET Magnitud = CAST(ISNULL(
                            (SELECT SUM(ISNULL(Metros, 0)) FROM dbo.ArchivosOrden WHERE OrdenID = @FallaOrderID2),
                            TRY_CAST(Magnitud AS DECIMAL(10,2))
                        ) AS NVARCHAR(50))
                        WHERE OrdenID = @FallaOrderID2
                          AND (Magnitud IS NULL OR TRY_CAST(Magnitud AS DECIMAL(10,2)) = 0 OR Magnitud = '' OR Magnitud = '0')
                    `);
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
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo = 'FALLA') + (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado = 'FALLA') as Fallas,
                (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo = 'CANCELADO') + (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado = 'CANCELADO') as Cancelados
    `);

        const { Total, Controlados: rawControlados, Pendientes, Fallas, Cancelados } = stats.recordset[0];

        // Corregir nulos
        const safeControlados = rawControlados || 0;
        const safePendientes = Pendientes || 0;
        const safeTotal = Total || 0;

        let orderCompleted = false; // Flag para la generación de etiquetas
        let totalBultos = 0;

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
            await changeOrderState(transaction, {
                target : { type: 'ORDER', id: ordenId },
                estado : 'Control y Calidad',
                userObj: req.user || 'Sistema',
                detalle: 'Pedido incompleto en área (espera)',
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
                              AND AO.EstadoArchivo = 'FALLA'
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
                            -- Archivos sin resolver (Pendiente o FALLA) de CUALQUIER orden del pedido en el área
                            SELECT COUNT(*) as SinResolver
                            FROM ArchivosOrden AO
                            INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                            WHERE O.NoDocERP = @NoDoc
                              AND O.AreaID   = @AreaID
                              AND O.Estado  NOT IN ('CANCELADO')
                              AND (AO.EstadoArchivo IS NULL
                                OR AO.EstadoArchivo NOT IN ('OK','Finalizado','CANCELADO'))
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
                            const termReq = new sql.Request(transaction).input('OID', sql.Int, ordenId);
                            let termQuery;
                            if (noDocERP) {
                                termReq.input('NoDoc', sql.VarChar(50), noDocERP).input('AreaID', sql.VarChar(50), areaId);
                                termQuery = `SELECT DISTINCT OT.OrdenID FROM OrdenTerminaciones OT
                                             INNER JOIN Ordenes O ON O.OrdenID = OT.OrdenID
                                             WHERE O.NoDocERP = @NoDoc AND O.AreaID = @AreaID AND OT.Estado = 'Pendiente'`;
                            } else {
                                termQuery = `SELECT DISTINCT OrdenID FROM OrdenTerminaciones WHERE OrdenID = @OID AND Estado = 'Pendiente'`;
                            }
                            (await termReq.query(termQuery)).recordset.forEach(r => ordenesConTermPend.add(r.OrdenID));
                        } catch (eTerm) {
                            logger.warn('[postControlArchivo] No se pudo evaluar terminaciones pendientes:', eTerm.message);
                        }
                    }
                    const estadoDe  = (oid) => ordenesConTermPend.has(oid) ? 'En Terminaciones' : nuevoEstadoArea;
                    const destinoDe = (oid) => ordenesConTermPend.has(oid) ? 'En Terminaciones' : destinoLogistica;
                    const detalleDe = (oid) => ordenesConTermPend.has(oid) ? 'Control OK — pasa a Terminaciones ECOUV' : 'Control finalizado en Área';

                    // Orden Normal -> Actualizar al Grupo Completo en el AREA
                    if (noDocERP) {
                        const grp = await new sql.Request(transaction)
                            .input('NoDoc', sql.VarChar(50), noDocERP)
                            .input('AreaID', sql.VarChar(50), areaId)
                            .query(`SELECT OrdenID FROM Ordenes WHERE NoDocERP = @NoDoc AND AreaID = @AreaID AND Estado != 'CANCELADO' AND ISNULL(EstadoenArea,'') != 'Retenido'`);
                        for (const o of grp.recordset) {
                            await new sql.Request(transaction)
                                .input('OID', sql.Int, o.OrdenID)
                                .query(`UPDATE Ordenes SET EstadoLogistica = '${destinoDe(o.OrdenID)}' WHERE OrdenID = @OID`);
                            await changeOrderState(transaction, { target: { type: 'ORDER', id: o.OrdenID }, estado: estadoDe(o.OrdenID), userObj: req.user || 'Sistema', detalle: detalleDe(o.OrdenID),
                guard    : "Estado NOT IN ('Finalizado', 'Ingresado', 'Avisado', 'Entregado', 'Cancelado')",
                io       : req.app.get('socketio')
            });
                        }
                    } else {
                        await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                            .query(`UPDATE Ordenes SET EstadoLogistica = '${destinoDe(ordenId)}' WHERE OrdenID = @OID`);
                        await changeOrderState(transaction, { target: { type: 'ORDER', id: ordenId }, estado: estadoDe(ordenId), userObj: req.user || 'Sistema', detalle: detalleDe(ordenId),
                guard    : "Estado NOT IN ('Finalizado', 'Ingresado', 'Avisado', 'Entregado', 'Cancelado')",
                io       : req.app.get('socketio')
            });
                    }
                }

                orderCompleted = true; // Habilitar generación de etiquetas

                // --- LÓGICA DE CIERRE DE REPOSICIÓN (LIBERAR PADRE) ---
                if (isReposicion && Fallas === 0) {
                    const codigoMadre = codigoOrden.split('-F')[0];
                    if (codigoMadre) {
                        try {
                            const reqMadre = new sql.Request(transaction);
                            reqMadre.input('CodeParent', sql.NVarChar, codigoMadre);
                            reqMadre.input('CurrentOrderID', sql.Int, ordenId);
                            // 1 + 1b. Sanar archivos y servicios de la madre (no son estado de orden)
                            await reqMadre.query(`
                                UPDATE ParentFiles
                                SET EstadoArchivo = 'OK', Observaciones = CONCAT(ISNULL(ParentFiles.Observaciones, ''), ' [Repuesto]')
                                FROM dbo.ArchivosOrden AS ParentFiles
                                INNER JOIN dbo.Ordenes AS ParentOrder ON ParentFiles.OrdenID = ParentOrder.OrdenID
                                WHERE ParentOrder.CodigoOrden = @CodeParent
                                  AND ParentFiles.EstadoArchivo = 'FALLA'
                                  AND ParentFiles.NombreArchivo IN(SELECT NombreArchivo FROM dbo.ArchivosOrden WHERE OrdenID = @CurrentOrderID);

                                UPDATE ParentServices
                                SET Estado = 'OK', Observaciones = CONCAT(ISNULL(ParentServices.Observaciones, ''), ' [Repuesto]')
                                FROM dbo.ServiciosExtraOrden AS ParentServices
                                INNER JOIN dbo.Ordenes AS ParentOrder ON ParentServices.OrdenID = ParentOrder.OrdenID
                                WHERE ParentOrder.CodigoOrden = @CodeParent
                                  AND ParentServices.Estado = 'FALLA'
                                  AND ParentServices.Descripcion IN(SELECT Descripcion FROM dbo.ServiciosExtraOrden WHERE OrdenID = @CurrentOrderID);
                            `);

                            // 2. Liberar Orden Madre SOLO si ya no le quedan fallas (chequeo en JS)
                            const fallasMadre = await new sql.Request(transaction)
                                .input('CodeParent', sql.NVarChar, codigoMadre)
                                .query(`
                                    SELECT COUNT(*) AS c FROM (
                                        SELECT 1 FROM dbo.ArchivosOrden AO INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID WHERE O.CodigoOrden = @CodeParent AND AO.EstadoArchivo = 'FALLA'
                                        UNION ALL
                                        SELECT 1 FROM dbo.ServiciosExtraOrden SEO INNER JOIN dbo.Ordenes O ON SEO.OrdenID = O.OrdenID WHERE O.CodigoOrden = @CodeParent AND SEO.Estado = 'FALLA'
                                    ) x
                                `);
                            if ((fallasMadre.recordset[0]?.c || 0) === 0) {
                                // Estado vía servicio central: 'Pronto' (área) -> deriva Produccion. Guarda: solo si estaba Retenida.
                                const relRes = await changeOrderState(transaction, {
                                    target  : { type: 'CODE', id: codigoMadre },
                                    estado  : 'Pronto',
                                    userObj : req.user || 'Sistema',
                                    detalle : 'Reposición completada — madre liberada',
                                    guard   : "ISNULL(EstadoenArea,'') = 'Retenido'",
                                    extraSet: { EstadoLogistica: 'Canasto Produccion' },
                                    io      : req.app.get('socketio'),
                                });
                                // Observaciones (no es estado) -> update directo solo sobre la orden liberada
                                if (relRes.ordenesAfectadas.length > 0) {
                                    await new sql.Request(transaction)
                                        .input('OID', sql.Int, relRes.ordenesAfectadas[0])
                                        .query(`UPDATE dbo.Ordenes SET Observaciones = CONCAT(ISNULL(Observaciones,''), ' [Reposición Completada]') WHERE OrdenID = @OID`);
                                }
                            }
                        } catch (e) { logger.error("Error liberando madre", e); }
                    }
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
                            logger.warn(`[postControlArchivo] Fallo generación etiquetas: ${labelResult.error}`);
                        }
                    } else {
                        logger.info(`[postControlArchivo] Magnitud 0, saltando etiquetas.`);
                    }
                }
            } catch (eLabels) {
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
            nuevoEstado,
            destinoLogistica,
            proximoServicio,
            message: 'Estado actualizado correctamente',
            // Datos para modales del frontend:
            ...fallaData,       // { fallaDetectada, ordenesRetroactivas }
            ...liberacionData,  // { listoParaProduccion, ordenesParaLiberar }
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
                           O.CodigoOrden 
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
        const totalCopies = file.Copias || 1;
        let newCount = parseInt(count);

        // Validaciones
        if (isNaN(newCount)) newCount = (file.Controlcopias || 0) + 1;
        if (newCount < 0) newCount = 0;
        if (newCount > totalCopies) newCount = totalCopies;

        // Determinar Nuevo Estado
        let newStatus = file.EstadoArchivo;
        let isCompletedNow = false;

        if (newCount >= totalCopies) {
            if (file.EstadoArchivo !== 'OK' && file.EstadoArchivo !== 'FINALIZADO') {
                newStatus = 'OK';
                isCompletedNow = true;

                // LOGICA REPOSICIÓN (Solo para archivos)
                if (!isService) {
                    const codigoOrden = file.CodigoOrden || '';
                    const isFallaOrder = codigoOrden.includes('-F');
                    if (isFallaOrder) {
                        const codigoMadre = codigoOrden.split('-F')[0];
                        if (codigoMadre) {
                            await new sql.Request(transaction)
                                .input('CodigoMadre', sql.NVarChar, codigoMadre)
                                .input('Nombre',      sql.NVarChar, file.NombreArchivo)
                                .query(`
                                    UPDATE dbo.ArchivosOrden
                                    SET EstadoArchivo   = 'OK',
                                        Controlcopias   = Copias,
                                        FechaControl    = GETDATE(),
                                        Observaciones   = CONCAT(ISNULL(Observaciones,''), ' [Reposición OK]')
                                    WHERE NombreArchivo = @Nombre
                                      AND OrdenID IN (
                                          SELECT OrdenID FROM dbo.Ordenes
                                          WHERE CodigoOrden = @CodigoMadre
                                      )
                                      AND EstadoArchivo = 'FALLA'
                                `);
                        }
                    }
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
            orderFullyCompleted
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
                    UPDATE dbo.Ordenes SET Magnitud = CAST(FORMAT(@Total,'0.##') AS NVARCHAR(20)) WHERE OrdenID = @ID;
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
            const isFalla = codigoActual.match(/-F\d+$/);
            const baseCode = isFalla ? codigoActual.replace(/-F\d+$/, '') : codigoActual;

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
                    (SELECT COUNT(*) FROM ServiciosExtraOrden WHERE OrdenID = @OID AND Estado IN ('OK', 'FINALIZADO')) as Completed
            `);

        const { Total, Completed } = checkOrder.recordset[0];
        
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

        if (Total !== Completed) {
            await transaction.rollback();
            return res.status(400).json({ error: 'La orden aún tiene archivos sin completar.' });
        }

        // Verificar si tiene fallas pendientes
        const fallaCheck = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`SELECT COUNT(*) as Fallas FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo = 'FALLA'`);
        const tieneFallas = (fallaCheck.recordset[0]?.Fallas || 0) > 0;

        // Verificar si es una orden de reposición (-F) y obtener código
        const codigoRes = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query("SELECT CodigoOrden, NoDocERP, AreaID, RolloID FROM Ordenes WHERE OrdenID = @OID");
        const codigoOrden = codigoRes.recordset[0]?.CodigoOrden || '';
        const noDocERP    = codigoRes.recordset[0]?.NoDocERP || null;
        const areaOrden   = codigoRes.recordset[0]?.AreaID || null;
        const rolloIdOrden = codigoRes.recordset[0]?.RolloID || null;
        const isFallaOrder = /-F\d+$/.test(codigoOrden);

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

        // Actualizar la orden
        await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`UPDATE Ordenes SET EstadoLogistica = '${estadoLogistica}' WHERE OrdenID = @OID`);
        await changeOrderState(transaction, { target: { type: 'ORDER', id: ordenId }, estado: nuevoEstadoArea, userObj: req.user || 'Sistema', detalle: 'Completada manualmente',
                io       : req.app.get('socketio')
            });

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
                const codigoMadre = codigoOrden.replace(/-F\d+$/, '');
                const madreRes = await pool.request()
                    .input('CodigoMadre', sql.NVarChar, codigoMadre)
                    .query(`
                        SELECT O.OrdenID,
                               (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = O.OrdenID AND EstadoArchivo = 'FALLA') as FallasRestantes
                        FROM Ordenes O
                        WHERE O.CodigoOrden = @CodigoMadre
                    `);
                if (madreRes.recordset.length > 0) {
                    const { OrdenID: madreId, FallasRestantes } = madreRes.recordset[0];
                    if (FallasRestantes === 0) {
                        // Solo desbloquear: Retenido → Pendiente (vuelve al lote de Control)
                        // El operador la finalizará manualmente junto con el resto del lote.
                        const mdCheck = await pool.request()
                            .input('MID', sql.Int, madreId)
                            .query(`SELECT Estado FROM Ordenes WHERE OrdenID = @MID AND Estado IN ('Retenido', 'RETENIDO')`);
                        if (mdCheck.recordset.length > 0) {
                            await changeOrderState(pool, { target: { type: 'ORDER', id: madreId }, estado: 'Pendiente', userObj: req.user || 'Sistema', detalle: 'Desbloqueo automático post-reposición' });
                        }
                        if (io) io.emit('server:order_updated', { orderId: madreId, status: 'Pendiente' });
                        logger.info(`[completarOrden] Madre ${codigoMadre} desbloqueada → Pendiente (esperando finalización manual en lote)`);
                    }
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
                        logger.warn(`[completarOrden] No se pudieron generar etiquetas: ${labelResult.error}`);
                    }
                } else {
                    logger.info(`[completarOrden] Orden ${ordenId} sin magnitud cotizada, no se generan etiquetas.`);
                }
            }
        } catch (eLabels) {
            logger.warn(`[completarOrden] Error etiquetas: ${eLabels.message}`);
        }


        // AUTO-CLEANUP: si esta era la última orden activa del lote, cancelarlo y liberar la máquina
        if (rolloIdOrden) {
            await cancelarLoteSiVacio(rolloIdOrden, req.app.get('socketio'));
        }

        res.json({
            success: true, nuevoEstado, estadoLogistica, totalBultos,
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
    recalcularContadoresEtiquetas
};

