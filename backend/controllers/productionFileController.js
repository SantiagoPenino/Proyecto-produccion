const { sql, getPool } = require('../config/db');
const PricingService = require('../services/pricingService');
const LabelGenerationService = require('../services/LabelGenerationService');
const driveService = require('../services/driveService');
const logger = require('../utils/logger');

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

        // Si estamos en Control View y NO se seleccionó un rollo específico (Todos), 
        // devolvemos VACÍO para obligar al usuario a seleccionar un rollo.
        if (isControlView && cleanRoll === '') {
            logger.info("[getOrdenes] Control View 'Todos' selected -> Returning empty list to force selection.");
            return res.json([]);
        }

        // Si estamos en Control View y NO se seleccionó un rollo específico (Todos), aplicamos filtro estricto.
        const applyControlFilter = (isControlView && cleanRoll === '') ? 1 : 0; // Este flag ya no se usará si retornamos arriba, pero lo dejo por compatibilidad si quitamos el return.

        const searchTerm = (search && search !== 'undefined' && search.trim() !== '') ? `%${search.trim()}%` : null;

        // Debug Log
        logger.info(`Getting Ordenes: Search="${searchTerm}", Rollo="${cleanRoll}", Area="${cleanArea}", CtxControl=${isControlView}, ApplyFilter=${applyControlFilter}`);

        const query = `
        SELECT
        O.OrdenID,
            O.AreaID,
            O.CodigoOrden,
            O.Cliente AS Cliente,
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
                                O.Magnitud
            FROM Ordenes O WITH(NOLOCK)
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
                    O.RolloID IN(SELECT RolloID FROM Rollos WITH(NOLOCK) WHERE Estado IN ('Finalizado', 'En maquina', 'Produccion', 'Imprimiendo'))
)

                AND O.Estado != 'CANCELADO'
AND(
    @IsLabelMode = 1
                    OR(
        LTRIM(RTRIM(O.Estado)) != 'PRONTO' 
                        AND(
            EXISTS(SELECT 1 FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID AND(AO.EstadoArchivo = 'Pendiente' OR AO.EstadoArchivo IS NULL))
                            OR 
                            NOT EXISTS(SELECT 1 FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID)
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
                O.Material as Material, O.Cliente as Cliente, O.AreaID as AreaActual, O.NoDocERP, 0 as isService
            FROM ArchivosOrden AO WITH (NOLOCK)
            LEFT JOIN Ordenes O WITH (NOLOCK) ON AO.OrdenID = O.OrdenID
            WHERE AO.OrdenID = @OrdenID

            UNION ALL

            SELECT 
                SEO.ServicioID as ArchivoID, SEO.OrdenID, SEO.Descripcion as NombreArchivo, NULL as RutaAlmacenamiento, NULL as Metros, SEO.Cantidad as Copias, 
                ISNULL(SEO.Controlcopias, 0) as Controlcopias, SEO.Estado as EstadoArchivo, SEO.UsuarioControl, SEO.FechaControl, SEO.Observaciones as Observaciones, 'Servicio' as TipoArchivo,
                0 as Ancho, 0 as Alto, SEO.CodArt as CodigoArticulo, SEO.FechaRegistro as FechaSubida,
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
    const { archivoId, estado, motivo, tipoFalla, usuario, isService } = req.body;
    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        if (!archivoId) return res.status(400).json({ error: 'Falta ID del ítem (archivoId/servicioId)' });

        let ordenId, codigoOrden, existeOrden, areaId, noDocERP, proximoServicio;

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
            const fileData = await new sql.Request(transaction)
                .input('ArchivoID', sql.Int, archivoId)
                .query(`
                    SELECT AO.OrdenID, AO.NombreArchivo, O.AreaID, O.CodigoOrden, O.NoDocERP, O.ProximoServicio
                    FROM ArchivosOrden AO WITH (NOLOCK)
                    LEFT JOIN Ordenes O WITH (NOLOCK) ON AO.OrdenID = O.OrdenID
                    WHERE AO.ArchivoID = @ArchivoID
                `);

            if (fileData.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Archivo no encontrado' });
            }

            const row = fileData.recordset[0];
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
            const equipoId = req.body.equipoId ? parseInt(req.body.equipoId) : null; // Capturamos EquipoID

            const safeMotivo = (motivo || '').toString().trim();
            const obsFalla = metrosReponer
                ? `${safeMotivo} (Reponer: ${metrosReponer}m)`
                : safeMotivo;

            const nuevoCodigo = `${codigoOrden} -F${archivoId} `;

            await new sql.Request(transaction)
                .input('OldID', sql.Int, ordenId)
                .input('NewCode', sql.NVarChar, nuevoCodigo)
                .input('TipoFallaID', sql.Int, fallaIDClean)
                .input('SafeMotivo', sql.NVarChar(sql.MAX), obsFalla)
                .input('EquipoID', sql.Int, equipoId)
                .input('CantidadFalla', sql.Decimal(10, 2), metrosReponer)
                .input('ArchivoID', sql.Int, archivoId)
                .input('AreaID', sql.NVarChar, areaId)
                .query(`
                    -- Insertar la nueva Orden de Falla con todos los campos solicitados
                    INSERT INTO dbo.Ordenes(
                        CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega,
                        Material, DescripcionTrabajo, Prioridad,
                        Estado, EstadoenArea, AreaID,
                        Magnitud, IdCabezalERP, ProximoServicio, Observaciones, NoDocERP,
                        FechaEntradaSector, ArchivosCount, Variante, UM, 
                        IdClienteReact, IdProductoReact, CodCliente, CodArticulo, CostoTotal
                    )
                    SELECT
                        @NewCode, Cliente, GETDATE(), FechaEstimadaEntrega,
                        Material, DescripcionTrabajo, 'ALTA',
                        'Pendiente', 'Pendiente', AreaID,
                        Magnitud, IdCabezalERP, ProximoServicio, 'Reposición por Falla', NoDocERP,
                        GETDATE(), 1, Variante, UM,
                        IdClienteReact, IdProductoReact, CodCliente, CodArticulo, 0
                    FROM dbo.Ordenes
                    WHERE OrdenID = @OldID;
                    
                    UPDATE dbo.Ordenes 
                    SET Observaciones = CONCAT(Observaciones, ' [Esperando Reposición]')
                    WHERE OrdenID = @OldID;

                    -- Registrar Falla en tabla auxiliar
                    INSERT INTO FallasProduccion(OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones)
                    VALUES(@OldID, @ArchivoID, @AreaID, GETDATE(), @TipoFallaID, @CantidadFalla, @EquipoID, @SafeMotivo);
                `);

            // Obtener el ID de la nueva orden recién insertada
            const newOrderRes = await new sql.Request(transaction).query("SELECT TOP 1 OrdenID FROM dbo.Ordenes ORDER BY OrdenID DESC");
            const newOrderId = newOrderRes.recordset[0]?.OrdenID;

            if (newOrderId) {
                // Si tenemos metros especificos, los usamos. Si no, copiamos el original.
                const metrosSQL = metrosReponer !== null ? `@MetrosReponer` : `Metros`;

                const insertRequest = new sql.Request(transaction)
                    .input('NewOrderID', sql.Int, newOrderId)
                    .input('OldFileID', sql.Int, archivoId);

                if (metrosReponer !== null) {
                    insertRequest.input('MetrosReponer', sql.Decimal(10, 2), metrosReponer);
                }

                await insertRequest.query(`
                    -- Insertar archivo asociado a la nueva orden (Clonando datos)
                    INSERT INTO dbo.ArchivosOrden(
                        OrdenID, NombreArchivo, RutaAlmacenamiento, Metros, Copias, Ancho, Alto, Observaciones,
                        TipoArchivo, FechaSubida, EstadoArchivo
                    )
                    SELECT 
                        @NewOrderID, NombreArchivo, RutaAlmacenamiento, ${metrosSQL}, Copias, Ancho, Alto, 'Reposición por Falla',
                        TipoArchivo, GETDATE(), 'Pendiente'
                    FROM dbo.ArchivosOrden WHERE ArchivoID = @OldFileID
                `);
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
        const isReposicion = codigoOrden.includes('-F');
        let nuevoEstado = null;
        let destinoLogistica = null;

        if (safePendientes > 0 || safeControlados < safeTotal) {
            // A. ORDEN INCOMPLETA LOCALMENTE -> Estado 'Produccion'
            // Diferenciar entre "Sin Tocar" y "En Curso"
            let nuevoEstadoArea = 'Control y Calidad';
            if (safeControlados > 0) {
                nuevoEstadoArea = 'En Curso';
            }

            await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                .query(`UPDATE Ordenes SET Estado = 'Produccion', EstadoenArea = '${nuevoEstadoArea}', EstadoLogistica = 'Canasto Incompletos' WHERE OrdenID = @OID`);

        } else if (!groupCompleted) {
            // B. ORDEN COMPLETA LOCALMENTE, PERO PEDIDO INCOMPLETO EN ÁREA -> Estado 'Produccion' (Espera)
            await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                .query("UPDATE Ordenes SET Estado='Produccion', EstadoenArea='Control y Calidad' WHERE OrdenID = @OID");

        } else {
            // C. PEDIDO COMPLETO EN ÁREA (Orden Local Done + Grupo Area Completo)

            // Si todos los archivos de la orden actual están cancelados, y no hay cabezal, la orden se cancela.
            if (Cancelados === Total && !noDocERP) {
                await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                    .query("UPDATE Ordenes SET Estado = 'CANCELADO', EstadoenArea = 'Cancelado', EstadoLogistica='Cancelado', Observaciones = 'Cancelada de oficio (Todos archivos cancelados)' WHERE OrdenID = @OID");
            } else {

                // Definir estados finales
                nuevoEstado = 'Pronto';
                let nuevoEstadoArea = 'Pronto';
                destinoLogistica = 'Canasto Produccion';

                if (Fallas > 0) {
                    nuevoEstado = 'Retenido';
                    nuevoEstadoArea = 'Retenido';
                    destinoLogistica = 'Esperando Reposición';
                } else if (isReposicion) {
                    destinoLogistica = 'Canasto Reposiciones';
                }

                // ACTUALIZACIÓN DE ESTADOS
                if (isReposicion) {
                    // Reposición solo se actualiza a sí misma
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, ordenId)
                        .query(`UPDATE Ordenes SET Estado = '${nuevoEstado}', EstadoenArea = '${nuevoEstadoArea}', EstadoLogistica = '${destinoLogistica}' WHERE OrdenID = @OID`);
                } else {
                    // Orden Normal -> Actualizar al Grupo Completo en el AREA
                    if (noDocERP) {
                        await new sql.Request(transaction)
                            .input('NoDoc', sql.VarChar(50), noDocERP)
                            .input('AreaID', sql.VarChar(50), areaId)
                            .query(`UPDATE Ordenes SET Estado = '${nuevoEstado}', EstadoenArea = '${nuevoEstadoArea}', EstadoLogistica = '${destinoLogistica}' WHERE NoDocERP = @NoDoc AND AreaID = @AreaID AND Estado != 'CANCELADO' AND Estado != 'Retenido'`);
                    } else {
                        await new sql.Request(transaction).input('OID', sql.Int, ordenId)
                            .query(`UPDATE Ordenes SET Estado = '${nuevoEstado}', EstadoenArea = '${nuevoEstadoArea}', EstadoLogistica = '${destinoLogistica}' WHERE OrdenID = @OID`);
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
                            await reqMadre.query(`
--1. Sanar Archivos de la Madre
                                UPDATE ParentFiles
                                SET EstadoArchivo = 'OK', Observaciones = CONCAT(ISNULL(ParentFiles.Observaciones, ''), ' [Repuesto]')
                                FROM dbo.ArchivosOrden AS ParentFiles
                                INNER JOIN dbo.Ordenes AS ParentOrder ON ParentFiles.OrdenID = ParentOrder.OrdenID
                                WHERE ParentOrder.CodigoOrden = @CodeParent
                                  AND ParentFiles.EstadoArchivo = 'FALLA'
                                  AND ParentFiles.NombreArchivo IN(SELECT NombreArchivo FROM dbo.ArchivosOrden WHERE OrdenID = @CurrentOrderID);

-- 1b. Sanar Servicios de la Madre
                                UPDATE ParentServices
                                SET Estado = 'OK', Observaciones = CONCAT(ISNULL(ParentServices.Observaciones, ''), ' [Repuesto]')
                                FROM dbo.ServiciosExtraOrden AS ParentServices
                                INNER JOIN dbo.Ordenes AS ParentOrder ON ParentServices.OrdenID = ParentOrder.OrdenID
                                WHERE ParentOrder.CodigoOrden = @CodeParent
                                  AND ParentServices.Estado = 'FALLA'
                                  AND ParentServices.Descripcion IN(SELECT Descripcion FROM dbo.ServiciosExtraOrden WHERE OrdenID = @CurrentOrderID);

--2. Liberar Orden Madre
                                IF NOT EXISTS(
                                    SELECT 1 FROM dbo.ArchivosOrden AO INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID WHERE O.CodigoOrden = @CodeParent AND AO.EstadoArchivo = 'FALLA'
                                    UNION ALL
                                    SELECT 1 FROM dbo.ServiciosExtraOrden SEO INNER JOIN dbo.Ordenes O ON SEO.OrdenID = O.OrdenID WHERE O.CodigoOrden = @CodeParent AND SEO.Estado = 'FALLA'
                                )
BEGIN
                                    UPDATE dbo.Ordenes
                                    SET Estado = 'Pronto', EstadoenArea = 'Pronto', EstadoLogistica = 'Canasto Produccion', Observaciones = CONCAT(Observaciones, ' [Reposición Completada]')
                                    WHERE CodigoOrden = @CodeParent AND Estado = 'Retenido';
END
    `);
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

        // --- GENERACIÓN DE ETIQUETAS POST-COMMIT (SI CORRESPONDE) ---
        if (orderCompleted) {
            try {
                // Verificar magnitud desde PedidosCobranzaDetalle (cotización real del ERP Sync)
                const checkMag = await pool.request()
                    .input('OID', sql.Int, ordenId)
                    .query("SELECT SUM(Cantidad) as TotalCantidad FROM PedidosCobranzaDetalle WHERE OrdenID = @OID");
                
                const magVal = parseFloat(checkMag.recordset[0]?.TotalCantidad) || 0;

                if (magVal > 0) {
                    logger.info(`[postControlArchivo] Llamando LabelGenerationService para Orden ${ordenId}...`);
                    const labelResult = await LabelGenerationService.regenerateLabelsForOrder(ordenId, (req.user?.id || 1), (req.user?.usuario || 'Sistema'));
                    if (labelResult.success) {
                        totalBultos = labelResult.totalBultos; // Para devolver en el JSON
                        logger.info(`[postControlArchivo] Etiquetas generadas OK: ${totalBultos}`);
                    } else {
                        logger.warn(`[postControlArchivo] Fallo generación etiquetas: ${labelResult.error}`);
                    }
                } else {
                    logger.info(`[postControlArchivo] Magnitud 0, saltando etiquetas.`);
                }
            } catch (eLabels) {
                logger.error(`[postControlArchivo] Error generando etiquetas post-control: ${eLabels.message}`);
            }
        }

        // SOCKET EMIT
        if (req.app.get('socketio')) {
            req.app.get('socketio').emit('server:order_updated', { orderId: ordenId });
        }

        res.json({ success: true, orderCompleted, totalBultos, nuevoEstado, destinoLogistica, proximoServicio, message: 'Estado actualizado correctamente' });

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
            query += " WHERE AreaID = @AreaID OR AreaID = 'General'";
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
            return res.status(400).json({ error: result.error }); // Return specific validation error
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
                    const matchFalla = codigoOrden.match(/-F(\d+)\s*$/);
                    if (matchFalla) {
                        const originalArchivoID = parseInt(matchFalla[1]);
                        if (originalArchivoID && !isNaN(originalArchivoID)) {
                            await new sql.Request(transaction)
                                .input('OrigID', sql.Int, originalArchivoID)
                                .input('Nombre', sql.NVarChar, file.NombreArchivo)
                                .query(`
                                    UPDATE ArchivosOrden 
                                    SET EstadoArchivo = 'OK', Observaciones = CONCAT(Observaciones, ' [Reposición OK]')
                                    WHERE ArchivoID = @OrigID AND NombreArchivo = @Nombre
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

        // Si se completó el archivo, verificar si se completa la orden
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
                // Actualizar orden a Pronto
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .query("UPDATE Ordenes SET Estado = 'Pronto', EstadoenArea = 'Pronto', EstadoLogistica = 'Canasto Produccion' WHERE OrdenID = @OID");
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
                OrdenID, CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega, 
                Estado, Material, DescripcionTrabajo, NoDocERP
            FROM Ordenes WITH (NOLOCK)
            WHERE Estado IN ('ENTREGADO', 'FINALIZADO', 'DESPACHADO', 'PRONTO')
            AND (
                CodigoOrden LIKE @Search 
                OR Cliente LIKE @Search 
                OR CAST(OrdenID AS VARCHAR) = @Exact
                OR NoDocERP LIKE @Search
            )
            ORDER BY OrdenID DESC
        `;

        request.input('Search', sql.NVarChar, `%${q}%`);
        request.input('Exact', sql.NVarChar, q);

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

        // 1. Obtener Datos Orden Original
        const ordRes = await new sql.Request(transaction)
            .input('ID', sql.Int, originalOrderId)
            .query("SELECT * FROM Ordenes WHERE OrdenID = @ID");

        if (ordRes.recordset.length === 0) throw new Error("Orden original no encontrada");
        const originalOrder = ordRes.recordset[0];

        // 1b. Preparar Observaciones Globales
        // El usuario pide: "las observaciones que ponga en el registro de la falla, ponerselo a la orden nueva."
        let finalGlobalObs = globalObservation || 'Reposición Cliente';
        const fileObsList = [];

        files.forEach(f => {
            if (f.obs) {
                // Buscar nombre archivo si es posible, o solo poner la obs. 
                // Como f es solo {id, meters, obs}, no tengo el nombre aqui facil.
                // Pero puedo poner "- [Obs]"
                fileObsList.push(`- ${f.obs}`);
            }
        });

        if (fileObsList.length > 0) {
            finalGlobalObs += `\nDetalles:\n${fileObsList.join('\n')}`;
        }

        // 2. Crear Nueva Orden de Reposición
        // Generar codigo: ORD-123 -R (Si ya existe -R, buscar -R2?)
        const suffix = `-R${Math.floor(Math.random() * 1000)}`;
        const newCode = `${originalOrder.CodigoOrden} ${suffix}`;

        const insertOrderResult = await new sql.Request(transaction)
            .input('NewCode', sql.NVarChar, newCode)
            .input('OldID', sql.Int, originalOrderId)
            .input('GlobalObs', sql.NVarChar, finalGlobalObs)
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
                    @NewCode, Cliente, GETDATE(), DATEADD(day, 2, GETDATE()), -- 2 dias default para reposición
                    Material, DescripcionTrabajo, 'URGENTE', -- Prioridad Alta
                    'Pendiente', 'Pendiente', AreaID,
                    Magnitud, IdCabezalERP, ProximoServicio, @GlobalObs, NoDocERP,
                    GETDATE(), 0, Variante, UM,
                    IdClienteReact, IdProductoReact, CodCliente, CodArticulo, 0
                FROM dbo.Ordenes
                WHERE OrdenID = @OldID;
                
                SELECT SCOPE_IDENTITY() as NewID;
             `);

        const newOrderId = insertOrderResult.recordset[0].NewID;

        let totalFiles = 0;

        // 3. Insertar Archivos Seleccionados
        for (const file of files) {
            // file: { id, meters, obs, copies }
            const oldFileId = file.id;
            const metersToReprint = file.meters;
            const copiesToReprint = file.copies || 1;
            const obs = file.obs || 'Reposición Cliente';

            await new sql.Request(transaction)
                .input('NewOrderID', sql.Int, newOrderId)
                .input('OldFileID', sql.Int, oldFileId)
                .input('Metros', sql.Decimal(10, 2), metersToReprint)
                .input('Copias', sql.Int, copiesToReprint)
                .input('Obs', sql.NVarChar, obs)
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

            // Registrar en FallasProduccion (Safe Mode)
            try {
                await new sql.Request(transaction)
                    .input('OldID', sql.Int, originalOrderId)
                    .input('FileID', sql.Int, oldFileId)
                    .input('AreaID', sql.VarChar, originalOrder.AreaID || 'General')
                    .input('Metros', sql.Decimal(10, 2), metersToReprint)
                    .input('Obs', sql.NVarChar, obs)
                    .query(`
                        INSERT INTO FallasProduccion(OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, Observaciones)
                        VALUES(@OldID, @FileID, @AreaID, GETDATE(), 1, @Metros, @Obs) 
                    `);
            } catch (e) { logger.info('FallasProduccion insert failed (ignoring):', e.message); }
        }

        // Actualizar contador archivos orden nueva
        try {
            await new sql.Request(transaction)
                .input('Total', sql.Int, totalFiles)
                .input('ID', sql.Int, newOrderId)
                .query("UPDATE Ordenes SET ArchivosCount = @Total WHERE OrdenID = @ID");
        } catch (e) { logger.info('Update ArchivosCount failed (ignoring):', e.message); }

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
                    const relNewCode = `${relOrder.CodigoOrden} ${suffix}`; // Mismo sufijo para consistencia

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
                                Material, DescripcionTrabajo, 'URGENTE',
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

        // Primero obtener el NoDocERP de la orden actual
        const currentRes = await pool.request()
            .input('ID', sql.Int, ordenId)
            .query("SELECT NoDocERP FROM Ordenes WHERE OrdenID = @ID");

        if (!currentRes.recordset.length || !currentRes.recordset[0].NoDocERP) {
            return res.json([]); // No tiene NoDoc, no hay relacionadas
        }

        const noDoc = currentRes.recordset[0].NoDocERP;

        const relatedRes = await pool.request()
            .input('NoDoc', sql.VarChar, noDoc)
            .input('ExcludeID', sql.Int, ordenId)
            .query(`
                SELECT OrdenID, CodigoOrden, AreaID, DescripcionTrabajo, Estado, Material
                FROM Ordenes 
                WHERE NoDocERP = @NoDoc AND OrdenID != @ExcludeID
                ORDER BY OrdenID
            `);

        res.json(relatedRes.recordset);

    } catch (error) {
        logger.error("Error getRelatedOrders:", error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getOrdenes,
    getArchivosPorOrden,
    viewDriveFile,
    postControlArchivo,
    getTiposFalla,
    regenerateEtiquetas,
    updateFileCopyCount,
    getCompletedOrdersForReplacement,
    createCustomerReplacementOrder,
    getRelatedOrders
};
