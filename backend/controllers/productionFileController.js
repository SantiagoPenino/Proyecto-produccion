const { sql, getPool } = require('../config/db');
const PricingService = require('../services/pricingService');
const LabelGenerationService = require('../services/LabelGenerationService');
const driveService = require('../services/driveService');

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
            console.log("[getOrdenes] Control View 'Todos' selected -> Returning empty list to force selection.");
            return res.json([]);
        }

        // Si estamos en Control View y NO se seleccionó un rollo específico (Todos), aplicamos filtro estricto.
        const applyControlFilter = (isControlView && cleanRoll === '') ? 1 : 0; // Este flag ya no se usará si retornamos arriba, pero lo dejo por compatibilidad si quitamos el return.

        const searchTerm = (search && search !== 'undefined' && search.trim() !== '') ? `%${search.trim()}%` : null;

        // Debug Log
        console.log(`Getting Ordenes: Search="${searchTerm}", Rollo="${cleanRoll}", Area="${cleanArea}", CtxControl=${isControlView}, ApplyFilter=${applyControlFilter}`);

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
                                (CASE WHEN(SELECT COUNT(*) FROM ArchivosOrden AO WITH(NOLOCK) WHERE AO.OrdenID = O.OrdenID AND AO.EstadoArchivo = 'Pendiente') = 0 THEN 1 ELSE 0 END) as Controlada
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
                    O.RolloID IN(SELECT RolloID FROM Rollos WITH(NOLOCK) WHERE Estado = 'Finalizado')
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
        console.error("Error en getOrdenes:", err);
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

        console.log(`Getting Archivos for OrdenID: ${ordenId} `);

        // 1. Obtener Archivos del File System (Simulado desde DB Files)
        const archivosResult = await pool.request()
            .input('OrdenID', sql.Int, ordenId)
            .query(`
                SELECT 
                    AO.*,
                    O.Material as Material,
                    O.Cliente as Cliente
                FROM ArchivosOrden AO WITH (NOLOCK)
                LEFT JOIN Ordenes O WITH (NOLOCK) ON AO.OrdenID = O.OrdenID
                WHERE AO.OrdenID = @OrdenID
                ORDER BY AO.NombreArchivo ASC
            `);

        // 2. Mapear URLs de Drive a Proxy de Backend si es necesario
        const mappedArchivos = archivosResult.recordset.map(archivo => {
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
        console.error("Error en getArchivosPorOrden:", err);
        res.status(500).json({ error: 'Error al obtener archivos', message: err.message });
    }
};

/**
 * 3. Controlar Archivo (OK, FALLA, CANCELADO)
 */
const postControlArchivo = async (req, res) => {
    const { archivoId, estado, motivo, tipoFalla, usuario } = req.body;
    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        if (!archivoId) return res.status(400).json({ error: 'Falta archivoId' });

        // 1. Obtener datos clave del archivo y la orden
        const pRequest = new sql.Request(transaction);
        const fileData = await pRequest
            .input('ArchivoID', sql.Int, archivoId)
            .query(`
                SELECT AO.OrdenID, AO.NombreArchivo, O.AreaID, O.CodigoOrden, O.OrdenID as ExisteOrden, O.NoDocERP, O.ProximoServicio
                FROM ArchivosOrden AO WITH (NOLOCK)
                LEFT JOIN Ordenes O WITH (NOLOCK) ON AO.OrdenID = O.OrdenID
                WHERE AO.ArchivoID = @ArchivoID
    `);

        if (fileData.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Archivo no encontrado' });
        }

        const ordenId = fileData.recordset[0]?.OrdenID;
        const codigoOrden = fileData.recordset[0]?.CodigoOrden;
        const existeOrden = fileData.recordset[0]?.ExisteOrden;
        let areaId = fileData.recordset[0]?.AreaID;
        const noDocERP = fileData.recordset[0]?.NoDocERP;
        const proximoServicio = fileData.recordset[0]?.ProximoServicio;

        // Sanitize inputs
        if (!areaId) areaId = 'General';
        if (areaId.length > 20) areaId = areaId.substring(0, 20); // Truncate to DB field size
        const safeUser = (usuario && typeof usuario === 'string') ? usuario : 'System';
        const safeMotivo = (motivo || '').substring(0, 4000);

        // 2. Actualizar Tabla ArchivosOrden
        const uRequest = new sql.Request(transaction);
        await uRequest
            .input('Estado', sql.NVarChar, estado)
            .input('Usuario', sql.NVarChar, safeUser)
            .input('Motivo', sql.NVarChar, safeMotivo)
            .input('ArchivoID', sql.Int, archivoId)
            .query(`
                UPDATE ArchivosOrden
SET
EstadoArchivo = @Estado,
    FechaControl = GETDATE(),
    UsuarioControl = @Usuario,
    Observaciones = @Motivo
                WHERE ArchivoID = @ArchivoID
    `);

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
                .query(`
                    INSERT INTO dbo.Ordenes(
        CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega,
        Material, DescripcionTrabajo, Prioridad,
        Estado, EstadoenArea, AreaID,
        Magnitud, IdCabezalERP, ProximoServicio, Observaciones, NoDocERP
    )
SELECT
@NewCode, Cliente, GETDATE(), FechaEstimadaEntrega,
    Material, DescripcionTrabajo, 'ALTA',
    'Pendiente', 'Pendiente', AreaID,
    Magnitud, IdCabezalERP, ProximoServicio, 'Reposición por Falla', NoDocERP
                    FROM dbo.Ordenes
                    WHERE OrdenID = @OldID;
                    
                    UPDATE dbo.Ordenes 
                    SET Observaciones = CONCAT(Observaciones, ' [Esperando Reposición]')
                    WHERE OrdenID = @OldID;

--Registrar Falla en tabla auxiliar
--FallaID es Autonumérico(IDENTITY) en la BD.No lo incluimos.
                    INSERT INTO FallasProduccion(OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones)
VALUES(@OldID, ${archivoId}, '${areaId}', GETDATE(), @TipoFallaID, @CantidadFalla, @EquipoID, @SafeMotivo);
`);

            // NOTA: Deberíamos clonar también los archivos? 
            // El requerimiento dice "generar otra orden identica". Una orden sin archivos no tiene sentido.
            // PERO la falla es especifica de UN archivo.
            // Asumiremos que clonamos SOLO el archivo que falló para la nueva orden de reposición?
            // "con F al final... + el id del archivo que fue falla". Esto sugiere que la nueva orden es especificamente para reponer ESE archivo.
            // Por tanto, clonamos el registro de ArchivosOrden asociado a la nueva Orden.

            // Obtener el ID de la nueva orden recién insertada
            const newOrderRes = await new sql.Request(transaction).query("SELECT TOP 1 OrdenID FROM dbo.Ordenes ORDER BY OrdenID DESC");
            // OJO: usar SCOPE_IDENTITY() es mejor práctica en la misma query, pero separado por seguridad aquí.
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
                    INSERT INTO dbo.ArchivosOrden(OrdenID, NombreArchivo, RutaAlmacenamiento, Metros, Copias, Observaciones)
                    SELECT @NewOrderID, NombreArchivo, RutaAlmacenamiento, ${metrosSQL}, Copias, 'Reposición por Falla'
                    FROM dbo.ArchivosOrden WHERE ArchivoID = @OldFileID
    `);
            }
        }

        // 4. Verificación de Completitud
        // A. Local Stats (para la orden actual)
        const checkRequest = new sql.Request(transaction);
        const stats = await checkRequest.input('OID', sql.Int, ordenId).query(`
SELECT
COUNT(*) as Total,
    SUM(CASE WHEN EstadoArchivo IN('OK', 'Finalizado', 'CANCELADO', 'FALLA') THEN 1 ELSE 0 END) as Controlados,
    SUM(CASE WHEN EstadoArchivo IS NULL OR EstadoArchivo NOT IN('OK', 'Finalizado', 'CANCELADO', 'FALLA') THEN 1 ELSE 0 END) as Pendientes,
    SUM(CASE WHEN EstadoArchivo = 'FALLA' THEN 1 ELSE 0 END) as Fallas,
    SUM(CASE WHEN EstadoArchivo = 'CANCELADO' THEN 1 ELSE 0 END) as Cancelados
            FROM ArchivosOrden
            WHERE OrdenID = @OID
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
                SELECT COUNT(*) as Pendientes
                FROM ArchivosOrden AO
                INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                WHERE O.NoDocERP = @NoDoc 
                  AND O.AreaID = @AreaID
AND(O.Estado IS NULL OR O.Estado != 'CANCELADO')
AND(AO.EstadoArchivo IS NULL OR AO.EstadoArchivo NOT IN('OK', 'Finalizado', 'CANCELADO', 'FALLA'))
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

--2. Liberar Orden Madre
                                IF NOT EXISTS(
    SELECT 1 
                                    FROM dbo.ArchivosOrden AO
                                    INNER JOIN dbo.Ordenes O ON AO.OrdenID = O.OrdenID
                                    WHERE O.CodigoOrden = @CodeParent AND AO.EstadoArchivo = 'FALLA'
)
BEGIN
                                    UPDATE dbo.Ordenes
                                    SET Estado = 'Pronto', EstadoenArea = 'Pronto', EstadoLogistica = 'Canasto Produccion', Observaciones = CONCAT(Observaciones, ' [Reposición Completada]')
                                    WHERE CodigoOrden = @CodeParent AND Estado = 'Retenido';
END
    `);
                        } catch (e) { console.error("Error liberando madre", e); }
                    }
                }
            }
        }
        if (orderCompleted) {
            // Ya no calculamos bultos manualmente aquí dentro de la transacción.
            // Delegamos todo al servicio post-commit.
            console.log(`[postControlArchivo] Orden ${ordenId} COMPLETADA. Commiteando transacción principal y generando etiquetas...`);
        }

        await transaction.commit(); // COMMIT PRINCIPAL

        // --- GENERACIÓN DE ETIQUETAS POST-COMMIT (SI CORRESPONDE) ---
        if (orderCompleted) {
            try {
                // Verificar magnitud de nuevo fuera de transacción (seguridad)
                const checkMag = await pool.request().input('OID', sql.Int, ordenId).query("SELECT Magnitud FROM Ordenes WHERE OrdenID = @OID");
                const magStr = checkMag.recordset[0]?.Magnitud;

                // Validación Rápida antes de llamar al servicio (aunque el servicio valida tambien)
                let magVal = 0;
                if (typeof magStr === 'number') magVal = magStr;
                else if (magStr) {
                    const match = magStr.toString().match(/[\d\.]+/);
                    if (match) magVal = parseFloat(match[0]);
                }

                if (magVal > 0) {
                    console.log(`[postControlArchivo] Llamando LabelGenerationService para Orden ${ordenId}...`);
                    const labelResult = await LabelGenerationService.regenerateLabelsForOrder(ordenId, (req.user?.id || 1), (req.user?.usuario || 'Sistema'));
                    if (labelResult.success) {
                        totalBultos = labelResult.totalBultos; // Para devolver en el JSON
                        console.log(`[postControlArchivo] Etiquetas generadas OK: ${totalBultos}`);
                    } else {
                        console.warn(`[postControlArchivo] Fallo generación etiquetas: ${labelResult.error}`);
                    }
                } else {
                    console.log(`[postControlArchivo] Magnitud 0, saltando etiquetas.`);
                }
            } catch (eLabels) {
                console.error(`[postControlArchivo] Error generando etiquetas post-control: ${eLabels.message}`);
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
        console.error("Error en postControlArchivo:", err);
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
        console.error("Error getTiposFalla:", err);
        res.status(500).json({ error: 'Error al obtener tipos de falla' });
    }
};

const regenerateEtiquetas = async (req, res) => {
    // Extraer OrdenID (puede venir de params :id o de body)
    const ordenId = req.params.ordenId || req.body.ordenId;
    const userId = req.user?.id || 1;
    const userName = req.user?.usuario || 'Sistema';

    if (!ordenId) return res.status(400).json({ error: 'OrdenID es requerido' });

    console.log(`[regenerateEtiquetas] Iniciando para Orden: ${ordenId} (User: ${userName})`);

    try {
        const result = await LabelGenerationService.regenerateLabelsForOrder(ordenId, userId, userName);

        if (!result.success) {
            return res.status(400).json({ error: result.error }); // Return specific validation error
        }

        res.json({
            success: true,
            message: `Se han regenerado ${result.totalBultos} etiquetas correctamente.`,
            details: result
        });

    } catch (error) {
        console.error("[regenerateEtiquetas] Error critico:", error);
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
            console.error("No se pudo identificar el FileID en:", url);
            return res.status(400).send('No se pudo identificar el FileID de Drive');
        }

        console.log(`[Proxy] Solicitando archivo a Drive. ID: ${fileId}`);

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
                console.log(`[Proxy] MIME Type corregido por extensión (.${ext}): ${finalMimeType}`);
            }
        }

        res.setHeader('Content-Type', finalMimeType);
        if (size) res.setHeader('Content-Length', size);

        // Mantener el nombre original si es posible (meta-data opcional)
        // Usamos 'inline' para que el navegador intente mostrarlo
        const safeName = (name || 'archivo').replace(/[^\w\.-]/g, '_');
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);

        stream.on('error', (err) => {
            console.error("Error en stream del proxy:", err);
            if (!res.headersSent) res.status(500).send('Error durante la transmisión del archivo');
        });

        stream.pipe(res);
    } catch (error) {
        console.error("Error en viewDriveFile proxy:", error);

        if (error.code === 404) {
            return res.status(404).send('Archivo no encontrado en Drive o falta de permisos (Scope limitado). Por favor re-autoriza el acceso.');
        }

        if (!res.headersSent) {
            res.status(500).send('Error al visualizar archivo desde Drive: ' + error.message);
        }
    }
};

module.exports = {
    getOrdenes,
    getArchivosPorOrden,
    viewDriveFile,
    postControlArchivo,
    getTiposFalla,
    regenerateEtiquetas
    // getRollosActivos y getRolloMetrics se movieron a rollosController.js
};
