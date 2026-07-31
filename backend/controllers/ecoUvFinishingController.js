const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Orden MADRE de una hermana de terminaciones: es la dueña de los archivos a los que
 * apuntan las OrdenTerminaciones (la orden de impresión, ej. EUV-9987). Fallback por
 * el marcador de la nota `[TERMINACIONES DE <codigo>]` si la hermana no tuviera filas.
 */
async function resolverOrdenMadre(pool, hermanaId) {
    const porArchivo = await pool.request()
        .input('OID', sql.Int, hermanaId)
        .query(`
            SELECT TOP 1 O.OrdenID, O.CodigoOrden, O.AreaID
            FROM OrdenTerminaciones OT
            INNER JOIN ArchivosOrden AO ON AO.ArchivoID = OT.ArchivoID
            INNER JOIN Ordenes O ON O.OrdenID = AO.OrdenID
            WHERE OT.OrdenID = @OID AND O.OrdenID <> @OID`);
    if (porArchivo.recordset.length > 0) return porArchivo.recordset[0];

    const porNota = await pool.request()
        .input('OID', sql.Int, hermanaId)
        .query(`
            SELECT TOP 1 M.OrdenID, M.CodigoOrden, M.AreaID
            FROM Ordenes H
            -- '[TERMINACIONES DE ' ocupa 18 caracteres: el código arranca en el 19
            INNER JOIN Ordenes M ON LTRIM(RTRIM(M.CodigoOrden)) =
                LTRIM(RTRIM(SUBSTRING(H.Nota, 19, CHARINDEX(']', H.Nota) - 19)))
            WHERE H.OrdenID = @OID AND H.Nota LIKE '![TERMINACIONES DE %' ESCAPE '!'`);
    return porNota.recordset[0] || null;
}

// Obtener órdenes de terminación ECOUV Agrupadas
// Modelo nuevo: la terminación vive DENTRO de la orden madre (OrdenTerminaciones por archivo).
// Legacy: órdenes-extra separadas con Variante '%Extra%' (pedidos anteriores al cambio).
exports.getFinishingOrders = async (req, res) => {
    try {
        const pool = await getPool();
        // Fases del ciclo TERMINAC (29/07):
        //   trabajo (default) -> 'Material Recibido' (llegó el material por check-in) y
        //                        'En Terminaciones' (ya se empezó a trabajar).
        //   control           -> 'Control y Calidad' (Finalizar Tarea = fin de lote).
        const fase = req.query.fase === 'control' ? 'control' : 'trabajo';
        let result;
        try {
            const whereFase = fase === 'control'
                ? `(O.AreaID = 'TERMINAC'
                     AND ISNULL(O.EstadoenArea, '') = 'Control y Calidad'
                     AND EXISTS (SELECT 1 FROM OrdenTerminaciones OT WHERE OT.OrdenID = O.OrdenID))`
                : `(O.AreaID = 'TERMINAC'
                     AND ISNULL(O.EstadoenArea, '') IN ('Material Recibido', 'En Terminaciones')
                     AND EXISTS (SELECT 1 FROM OrdenTerminaciones OT WHERE OT.OrdenID = O.OrdenID))
                    -- Legacy: orden-extra separada del modelo viejo (siguen en ECOUV)
                    OR (O.AreaID = 'ECOUV'
                        AND (O.Variante LIKE '%Extra%' OR O.Variante LIKE '%Servicio%' OR O.Variante LIKE '%Materiales%' OR O.Material LIKE '%Extra%'))`;
            result = await pool.request().query(`
                SELECT
                    O.OrdenID, O.CodigoOrden, O.NoDocERP, O.Cliente, O.DescripcionTrabajo, O.Prioridad, O.Estado,
                    O.Material, O.Variante, O.FechaIngreso, O.Magnitud, O.UM, O.Nota, O.EstadoenArea,
                    LTRIM(RTRIM(ISNULL(O.ModoRetiro, ''))) AS ModoRetiro,
                    -- Las etiquetas del producto terminado van a nombre de la orden MADRE
                    -- (la de impresión, dueña de los archivos): de ahí salen el contador
                    -- y el botón de reimprimir de la bandeja.
                    (SELECT TOP 1 AO.OrdenID FROM OrdenTerminaciones OT
                       INNER JOIN ArchivosOrden AO ON AO.ArchivoID = OT.ArchivoID
                       WHERE OT.OrdenID = O.OrdenID AND AO.OrdenID <> O.OrdenID) as MadreOrdenID,
                    -- Solo etiquetas VIVAS: las de bultos consumidos (el material que entró
                    -- a terminaciones) ya no se imprimen ni se cuentan.
                    (SELECT COUNT(*) FROM Etiquetas E
                      LEFT JOIN Logistica_Bultos LB ON LB.CodigoEtiqueta = E.CodigoEtiqueta
                      WHERE ISNULL(LB.Estado, '') NOT IN ('CONSUMIDO', 'PERDIDO')
                        AND E.OrdenID IN (
                          SELECT AO2.OrdenID FROM OrdenTerminaciones OT2
                          INNER JOIN ArchivosOrden AO2 ON AO2.ArchivoID = OT2.ArchivoID
                          WHERE OT2.OrdenID = O.OrdenID AND AO2.OrdenID <> O.OrdenID)) as CantidadEtiquetas,
                    (SELECT COUNT(*) FROM ServiciosExtraOrden S WHERE S.OrdenID = O.OrdenID) as ExtrasCount,
                    (SELECT COUNT(*) FROM OrdenTerminaciones OT WHERE OT.OrdenID = O.OrdenID) as TermCount,
                    (SELECT COUNT(*) FROM OrdenTerminaciones OT WHERE OT.OrdenID = O.OrdenID AND OT.Estado = 'Pendiente') as TermPendientes
                FROM Ordenes O
                WHERE O.Estado NOT IN ('Finalizado', 'Entregado', 'Cancelado')
                  AND ( ${whereFase} )
                ORDER BY
                    CASE WHEN O.Prioridad = 'Urgente' THEN 0 ELSE 1 END,
                    O.FechaIngreso DESC
            `);
        } catch (eTabla) {
            // Base sin la migración ECOUV (tabla OrdenTerminaciones inexistente): fallback legacy
            logger.warn('[Finishing] OrdenTerminaciones no disponible, usando query legacy:', eTabla.message);
            result = await pool.request().query(`
                SELECT
                    O.OrdenID, O.CodigoOrden, O.NoDocERP, O.Cliente, O.DescripcionTrabajo, O.Prioridad, O.Estado,
                    O.Material, O.Variante, O.FechaIngreso, O.Magnitud, O.UM, O.Nota, O.EstadoenArea,
                    (SELECT COUNT(*) FROM ServiciosExtraOrden S WHERE S.OrdenID = O.OrdenID) as ExtrasCount
                FROM Ordenes O
                WHERE O.AreaID = 'ECOUV'
                  AND O.Estado NOT IN ('Finalizado', 'Entregado', 'Cancelado')
                  AND (O.Variante LIKE '%Extra%' OR O.Variante LIKE '%Servicio%' OR O.Variante LIKE '%Materiales%' OR O.Material LIKE '%Extra%')
                ORDER BY
                    CASE WHEN O.Prioridad = 'Urgente' THEN 0 ELSE 1 END,
                    O.FechaIngreso DESC
            `);
        }

        // Agrupar por NoDocERP para mostrar "Orden 20" en vez de "20(1/3), 20(2/3)"
        const grouped = {};
        result.recordset.forEach(ord => {
            // Limpiar NoDocERP para agrupar mejor (si viene sucio)
            const docKey = ord.NoDocERP ? String(ord.NoDocERP).trim() : ord.CodigoOrden;

            if (!grouped[docKey]) {
                grouped[docKey] = {
                    docId: docKey,
                    cliente: ord.Cliente,
                    trabajo: ord.DescripcionTrabajo,
                    fecha: ord.FechaIngreso,
                    prioridad: ord.Prioridad, // Si alguno es urgente, el grupo es urgente? Ajustaremos después
                    ordenes: []
                };
            }
            // Upgrade prioridad del grupo si encuentro un urgente
            if (ord.Prioridad === 'Urgente') grouped[docKey].prioridad = 'Urgente';

            grouped[docKey].ordenes.push(ord);
        });

        res.json(Object.values(grouped));
    } catch (e) {
        logger.error("Error getFinishingOrders:", e);
        res.status(500).json({ error: e.message });
    }
};

// Obtener detalles de items extras (materiales) de una orden + terminaciones por archivo
exports.getOrderDetails = async (req, res) => {
    const { id } = req.params; // OrdenID
    try {
        const pool = await getPool();
        const extras = await pool.request()
            .input('OID', sql.Int, id)
            .query("SELECT * FROM ServiciosExtraOrden WHERE OrdenID = @OID");

        // Modelo nuevo: terminaciones ligadas a cada archivo de impresión de la orden
        const terminaciones = await pool.request()
            .input('OID', sql.Int, id)
            .query(`
                SELECT OT.ID, OT.ArchivoID, OT.TerminacionID, OT.Cantidad, OT.Estado,
                       LTRIM(RTRIM(ISNULL(OT.Ubicacion, ''))) AS Ubicacion,
                       -- Lo que definió el cliente: separación de los ojales o
                       -- distancia del bolsillo al borde (cm). Si no lo tocó, el
                       -- valor por defecto del catálogo.
                       ISNULL(OT.ParamCliente, T.ParamCantidad) AS Param,
                       T.ReglaCantidad, T.Nombre, T.UnidadCobro,
                       A.Ancho, A.Alto, A.Copias,
                       A.RutaAlmacenamiento,
                       A.NombreArchivo
                FROM OrdenTerminaciones OT
                INNER JOIN Terminaciones T ON T.TerminacionID = OT.TerminacionID
                LEFT JOIN ArchivosOrden A ON A.ArchivoID = OT.ArchivoID
                -- La orden puede ser la hermana TERMINAC (dueña de las filas) o la ECOUV
                -- (dueña de los archivos): ambas ven el mismo checklist.
                WHERE OT.OrdenID = @OID
                   OR OT.ArchivoID IN (SELECT ArchivoID FROM ArchivosOrden WHERE OrdenID = @OID)
                ORDER BY OT.ArchivoID, T.Nombre
            `);

        // Archivos ligados a las terminaciones, con su conteo de control POR ARCHIVO
        // (ej. 3 controlados de los 10 del arte A). Columna propia del control de
        // terminaciones — Controlcopias es del control de impresión y ya viene lleno.
        let archivos = [];
        try {
            const arch = await pool.request()
                .input('OID', sql.Int, id)
                .query(`
                    SELECT AO.ArchivoID, AO.NombreArchivo, ISNULL(AO.Copias, 1) AS Copias,
                           ISNULL(AO.ControlTerminacCopias, 0) AS Controladas
                    FROM ArchivosOrden AO
                    WHERE AO.ArchivoID IN (
                        SELECT OT.ArchivoID FROM OrdenTerminaciones OT
                        WHERE OT.OrdenID = @OID
                           OR OT.ArchivoID IN (SELECT ArchivoID FROM ArchivosOrden WHERE OrdenID = @OID)
                    )
                    ORDER BY AO.ArchivoID
                `);
            archivos = arch.recordset;
        } catch (eArch) {
            // Columna ControlTerminacCopias ausente (sin migración): sin conteo por archivo
            logger.warn('[Finishing] Conteo por archivo no disponible:', eArch.message);
        }

        // URL del arte para dibujarlo dentro del boceto. Los archivos de Drive se
        // sirven por el proxy del backend (mismo que usa el control de impresión).
        const conArte = terminaciones.recordset.map(t => {
            const ruta = (t.RutaAlmacenamiento || '').trim();
            if (!ruta) return t;
            return {
                ...t,
                arteUrl: ruta.includes('drive.google.com')
                    ? `/api/production-file-control/view-drive-file?url=${encodeURIComponent(ruta)}`
                    : ruta
            };
        });

        res.json({ extras: extras.recordset, terminaciones: conArte, archivos });
    } catch (e) {
        logger.error("Error getOrderDetails:", e);
        res.status(500).json({ error: e.message });
    }
};

// Marcar estado de una terminación de la orden (Pendiente | Hecha)
exports.updateTerminacionEstado = async (req, res) => {
    const { id } = req.params; // OrdenTerminaciones.ID
    const { estado } = req.body;
    if (!['Pendiente', 'Hecha'].includes(estado)) {
        return res.status(400).json({ error: "Estado inválido. Valores: 'Pendiente' | 'Hecha'." });
    }
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('ID', sql.Int, parseInt(id))
            .input('Est', sql.VarChar(20), estado)
            .query("UPDATE OrdenTerminaciones SET Estado = @Est OUTPUT INSERTED.OrdenID WHERE ID = @ID");
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe la terminación ${id}.` });

        // Al marcar la PRIMERA terminación Hecha, la orden empieza a trabajarse:
        // 'Material Recibido' -> 'En Terminaciones' (con historial).
        if (estado === 'Hecha') {
            try {
                const ordenId = r.recordset[0]?.OrdenID;
                if (ordenId) {
                    const est = await pool.request()
                        .input('OID', sql.Int, ordenId)
                        .query("SELECT EstadoenArea FROM Ordenes WHERE OrdenID = @OID");
                    if ((est.recordset[0]?.EstadoenArea || '').trim() === 'Material Recibido') {
                        const { changeOrderState } = require('../services/stateManagerService');
                        const tx = new sql.Transaction(pool);
                        await tx.begin();
                        try {
                            await changeOrderState(tx, {
                                target : { type: 'ORDER', id: ordenId },
                                estado : 'En Terminaciones',
                                userObj: req.user || 'Sistema',
                                detalle: 'Se empezó a trabajar (primera terminación marcada)',
                                io     : req.app.get('socketio'),
                            });
                            await tx.commit();
                        } catch (eTx) { await tx.rollback(); throw eTx; }
                    }
                }
            } catch (eEst) {
                logger.warn('[Finishing] No se pudo pasar la orden a En Terminaciones:', eEst.message);
            }
        }

        res.json({ success: true });
    } catch (e) {
        logger.error("Error updateTerminacionEstado:", e);
        res.status(500).json({ error: e.message });
    }
};

// Actualizar cantidad de un item extra
exports.updateExtraItem = async (req, res) => {
    const { itemId } = req.params;
    const { cantidad } = req.body;

    if (!itemId || itemId === 'undefined') {
        return res.status(400).json({ error: "Invalid Item ID" });
    }

    try {
        const pool = await getPool();

        // 1. Obtener OrdenID antes de actualizar
        const itemRes = await pool.request()
            .input('SID', sql.Int, itemId)
            .query("SELECT OrdenID FROM ServiciosExtraOrden WHERE ServicioID = @SID");

        if (!itemRes.recordset.length) return res.status(404).json({ error: "Item not found" });
        const ordenId = itemRes.recordset[0].OrdenID;

        // 2. Update Cantidad del Item
        await pool.request()
            .input('ID', sql.Int, itemId)
            .input('Cant', sql.Decimal(18, 2), cantidad)
            .query("UPDATE ServiciosExtraOrden SET Cantidad = @Cant WHERE ServicioID = @ID");

        // 3. Recalcular Magnitud SOLO si la orden no tiene archivos de impresión.
        // En una orden con impresión la magnitud son sus m² (o metros): pisarla con la
        // suma de servicios (unidades de ojales, etc.) hacía que el motor cotizara el
        // material por una cifra que mezcla superficie con cantidades.
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                UPDATE Ordenes
                SET Magnitud = (
                    SELECT COALESCE(SUM(Cantidad), 0)
                    FROM ServiciosExtraOrden
                    WHERE OrdenID = @OID
                )
                WHERE OrdenID = @OID
                  AND NOT EXISTS (
                      SELECT 1 FROM ArchivosOrden
                      WHERE OrdenID = @OID AND ISNULL(EstadoArchivo, '') <> 'CANCELADO'
                        AND ISNULL(Metros, 0) > 0
                  )
            `);

        res.json({ success: true });
    } catch (e) {
        logger.error("Error updateExtraItem:", e);
        res.status(500).json({ error: e.message });
    }
};

/**
 * CONFIRMAR MAGNITUDES del trabajo real de terminaciones.
 *
 * El cliente pidió una cantidad estimada (ojales sugeridos, metros de soldadura);
 * el taller confirma lo que REALMENTE hizo. Eso actualiza:
 *   1. OrdenTerminaciones.Cantidad  → lo que ve el taller
 *   2. ServiciosExtraOrden.Cantidad → la línea que se cobra
 *   3. la cotización del pedido (misma vía que usa el detalle de orden)
 *
 * body: { items: [{ id, cantidad }] }  (id = OrdenTerminaciones.ID)
 */
exports.confirmarMagnitudes = async (req, res) => {
    const { id } = req.params;               // OrdenID de la hermana TERMINAC
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'No se recibió ninguna cantidad para confirmar.' });
    try {
        const pool = await getPool();
        const cambios = [];
        for (const it of items) {
            const cant = parseFloat(it.cantidad);
            if (!Number.isFinite(cant) || cant < 0) continue;

            // La terminación (para saber a qué artículo de cobro corresponde)
            const info = await pool.request()
                .input('ID', sql.Int, parseInt(it.id))
                .query(`SELECT OT.ID, OT.OrdenID, OT.ArchivoID, OT.Cantidad, OT.TerminacionID,
                               LTRIM(RTRIM(ISNULL(T.CodArticulo,''))) AS CodArt, T.Nombre
                        FROM OrdenTerminaciones OT
                        JOIN Terminaciones T ON T.TerminacionID = OT.TerminacionID
                        WHERE OT.ID = @ID`);
            const row = info.recordset[0];
            if (!row) continue;
            if (parseFloat(row.Cantidad) === cant) continue;   // sin cambios

            await pool.request()
                .input('ID', sql.Int, row.ID)
                .input('C', sql.Decimal(18, 2), cant)
                .query('UPDATE OrdenTerminaciones SET Cantidad = @C WHERE ID = @ID');

            // La línea de cobro vive en la orden de IMPRESIÓN (dueña del archivo),
            // no en la hermana: se ubica por archivo + artículo.
            if (row.CodArt) {
                await pool.request()
                    .input('AID', sql.Int, row.ArchivoID)
                    .input('Cod', sql.VarChar(50), row.CodArt)
                    .input('C', sql.Decimal(18, 2), cant)
                    .query(`
                        UPDATE SEO SET Cantidad = @C
                        FROM ServiciosExtraOrden SEO
                        WHERE LTRIM(RTRIM(SEO.CodArt)) = @Cod
                          AND ISNULL(SEO.Observacion,'') LIKE N'%rminaci%por archivo%'
                          AND SEO.OrdenID = (SELECT OrdenID FROM ArchivosOrden WHERE ArchivoID = @AID)`);
            }
            cambios.push({ nombre: row.Nombre, antes: parseFloat(row.Cantidad), ahora: cant, ordenImpresionArchivo: row.ArchivoID });
        }

        // Recotizar el pedido: las líneas cambiaron de cantidad
        let recotizada = false;
        if (cambios.length > 0) {
            try {
                const ordImp = await pool.request()
                    .input('OID', sql.Int, id)
                    .query(`SELECT TOP 1 AO.OrdenID FROM OrdenTerminaciones OT
                            JOIN ArchivosOrden AO ON AO.ArchivoID = OT.ArchivoID
                            WHERE OT.OrdenID = @OID`);
                const ordenImpresion = ordImp.recordset[0]?.OrdenID || parseInt(id);
                const { recotizarPedidoDeOrden } = require('./ordersController');
                if (typeof recotizarPedidoDeOrden === 'function') {
                    await recotizarPedidoDeOrden(pool, ordenImpresion, req.user?.id || 1, req.user?.usuario || 'Sistema');
                    recotizada = true;
                } else {
                    // Fallback: el motor directo (misma vía, sin empujar a ERP)
                    const doc = await pool.request().input('OID', sql.Int, ordenImpresion)
                        .query('SELECT NoDocERP FROM Ordenes WHERE OrdenID = @OID');
                    const noDoc = (doc.recordset[0]?.NoDocERP || '').toString().trim();
                    if (noDoc) {
                        const ERPSyncService = require('../services/erpSyncService');
                        await ERPSyncService.syncFinalOrderIntegration(noDoc, req.user?.id || 1,
                            String(req.user?.usuario || 'Sistema').substring(0, 99), null, { onlyCalculate: true });
                        recotizada = true;
                    }
                }
            } catch (eRec) {
                logger.error('[Finishing] Error recotizando tras confirmar magnitudes:', eRec.message);
            }
        }

        logger.info(`[Finishing] Magnitudes confirmadas en orden ${id}: ${cambios.length} cambio(s)${recotizada ? ' + cotización actualizada' : ''}`);
        res.json({ success: true, cambios, recotizada });
    } catch (e) {
        logger.error('Error confirmarMagnitudes:', e);
        res.status(500).json({ error: e.message });
    }
};

// Copias controladas en el control de terminaciones, POR ARCHIVO (como el conteo del
// control de lotes): se escribe el total controlado del arte y se clampa a [0, Copias].
exports.updateControlCopiasArchivo = async (req, res) => {
    const { archivoId } = req.params; // ArchivosOrden.ArchivoID
    let cantidad = parseInt(req.body?.cantidad, 10);
    if (isNaN(cantidad) || cantidad < 0) cantidad = 0;
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('AID', sql.Int, archivoId)
            .input('C', sql.Int, cantidad)
            .query(`
                UPDATE ArchivosOrden
                SET ControlTerminacCopias = CASE WHEN @C > ISNULL(Copias, 1) THEN ISNULL(Copias, 1) ELSE @C END
                OUTPUT INSERTED.ControlTerminacCopias AS Controladas, ISNULL(INSERTED.Copias, 1) AS Copias
                WHERE ArchivoID = @AID`);
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe el archivo ${archivoId}.` });
        res.json({ success: true, ...r.recordset[0] });
    } catch (e) {
        logger.error('Error updateControlCopiasArchivo:', e);
        res.status(500).json({ error: e.message });
    }
};

// Controlar Orden (Finalizar) — dos fases (29/07):
//   fase=trabajo (bandeja): con todas las terminaciones Hechas, la orden pasa a
//                           'Terminado' y queda esperando en la pestaña Control.
//   sin fase / control:     aprobación final -> 'Pronto' + Canasto Produccion.
exports.controlOrder = async (req, res) => {
    const { id } = req.params; // OrdenID
    const fase = (req.body?.fase || req.query?.fase || '').toString();
    try {
        const pool = await getPool();

        // GATE: no se puede finalizar con terminaciones PENDIENTES (se marcan primero)
        const pend = await pool.request()
            .input('OID', sql.Int, id)
            .query("SELECT COUNT(*) AS C FROM OrdenTerminaciones WHERE OrdenID = @OID AND Estado = 'Pendiente'");
        const pendientes = pend.recordset[0]?.C || 0;
        if (pendientes > 0) {
            return res.status(400).json({ error: `Quedan ${pendientes} terminación(es) pendientes: marcalas como Hechas antes de finalizar.` });
        }
        const { changeOrderState } = require('../services/stateManagerService');

        if (fase === 'trabajo') {
            // Trabajo de terminaciones completo -> 'Control y Calidad' (igual que el fin
            // de lote de las demás áreas). Recién ahí se ve en la pestaña Control.
            const txT = new sql.Transaction(pool);
            await txT.begin();
            try {
                await changeOrderState(txT, {
                    target : { type: 'ORDER', id },
                    estado : 'Control y Calidad',
                    userObj: req.user || 'Sistema',
                    detalle: 'Terminaciones completas — pasa a Control y Calidad',
                    io     : req.app.get('socketio'),
                });
                await txT.commit();
            } catch (e) { await txT.rollback(); throw e; }
            return res.json({ success: true, message: "Trabajo terminado: la orden pasó a Control y Calidad." });
        }

        // GATE de aprobación: el conteo tiene que estar completo EN CADA ARCHIVO
        // (igual que el control de lotes: no se cierra con copias sin contar).
        try {
            const gate = await pool.request()
                .input('OID', sql.Int, id)
                .query(`
                    SELECT ISNULL(SUM(ISNULL(AO.ControlTerminacCopias, 0)), 0) AS Contadas,
                           ISNULL(SUM(ISNULL(AO.Copias, 1)), 0) AS Total,
                           SUM(CASE WHEN ISNULL(AO.ControlTerminacCopias, 0) < ISNULL(AO.Copias, 1) THEN 1 ELSE 0 END) AS ArchivosIncompletos
                    FROM ArchivosOrden AO
                    WHERE AO.ArchivoID IN (SELECT OT.ArchivoID FROM OrdenTerminaciones OT WHERE OT.OrdenID = @OID)`);
            const g = gate.recordset[0] || {};
            if ((g.Total || 0) > 0 && (g.ArchivosIncompletos || 0) > 0) {
                return res.status(400).json({ error: `Controlaste ${g.Contadas || 0} de ${g.Total} copias (${g.ArchivosIncompletos} archivo(s) sin completar): terminá el conteo antes de aprobar.` });
            }
        } catch (eGate) {
            // Columna ControlTerminacCopias ausente (entorno sin la migración): aprobar sin conteo.
            logger.warn('[Finishing] Gate de conteo no disponible:', eGate.message);
        }

        // Aprobación de control: la hermana CIERRA su ciclo acá. No se despacha ni entra a
        // depósito — el producto viaja en el bulto de la orden madre (ver punto 3). Si
        // quedara en Canasto Producción aparecería para siempre en el canasto de TERMINAC
        // como una orden sin bultos que despachar.
        const txUv = new sql.Transaction(pool);
        await txUv.begin();
        try {
            await changeOrderState(txUv, {
                target  : { type: 'ORDER', id },
                estado  : 'Finalizado',
                userObj : req.user || 'Sistema',
                detalle : 'Control de terminaciones aprobado — producto etiquetado en la orden de impresión',
                extraSet: { EstadoLogistica: null },
                io      : req.app.get('socketio'),
            });
            await txUv.commit();
        } catch (e) { await txUv.rollback(); throw e; }

        // 2. Intentar Update Fecha Fin
        try {
            await pool.request()
                .input('OID', sql.Int, id)
                .query("UPDATE Ordenes SET FechaFinalizacion = GETDATE() WHERE OrdenID = @OID");
        } catch (ignored) {
            logger.warn("⚠️ No se pudo actualizar FechaFinalizacion");
        }

        // 3. Etiquetar el producto terminado A NOMBRE DE LA ORDEN MADRE (decisión 29/07).
        // La hermana XEUV registra el TRABAJO; el producto que se despacha, se cobra y se
        // entrega es el de la orden madre (ECOUV). Si el bulto quedara a nombre de la
        // hermana, el paquete del estante no coincidiría con la orden que el cliente retira.
        let totalBultos = 0;
        let labelOrdenId = parseInt(id);
        try {
            const madre = await resolverOrdenMadre(pool, id);
            if (madre) {
                labelOrdenId = madre.OrdenID;
                // La madre ya pasó por terminaciones: su próximo destino es depósito
                // (esto además hace que el bulto nuevo nazca como PROD_TERMINADO).
                await pool.request()
                    .input('OID', sql.Int, madre.OrdenID)
                    .query("UPDATE Ordenes SET ProximoServicio = 'DEPOSITO' WHERE OrdenID = @OID");

                // Cuántos bultos físicos salen de terminaciones (ej. 3 cuadros que se
                // envían por separado). Lo elige quien controla; default 1.
                const cantBultos = Math.max(1, parseInt(req.body?.bultos, 10) || 1);
                const LabelGenerationService = require('../services/LabelGenerationService');
                const lr = await LabelGenerationService.addBultosTerminados(
                    madre.OrdenID, cantBultos, req.user?.id || 1, req.user?.usuario || 'Sistema',
                    { ubicacion: 'TERMINAC', tipoBulto: 'PROD_TERMINADO' }
                );
                if (lr.success) {
                    totalBultos = lr.totalBultos;
                    // Consumir el bulto EN_PROCESO que llegó a terminaciones: su contenido
                    // ya está dentro del bulto terminado, no puede despacharse por separado.
                    await pool.request()
                        .input('OID', sql.Int, madre.OrdenID)
                        .query(`UPDATE Logistica_Bultos SET Estado = 'CONSUMIDO'
                                WHERE OrdenID = @OID AND UbicacionActual = 'TERMINAC'
                                  AND Estado = 'EN_STOCK' AND Tipocontenido = 'EN_PROCESO'`);
                } else {
                    logger.warn('[Finishing] No se generó la etiqueta del producto terminado:', lr.error);
                }
            } else {
                logger.warn(`[Finishing] No se encontró la orden madre de ${id}: no se generan etiquetas.`);
            }
        } catch (eLab) {
            logger.warn('[Finishing] Error generando la etiqueta del producto terminado:', eLab.message);
        }

        res.json({
            success: true, totalBultos, labelOrdenId,
            message: `Orden marcada como Pronto (Canasto Producción)${totalBultos ? ` — ${totalBultos} bulto(s) generados` : ''}.`
        });
    } catch (e) {
        logger.error("Error controlOrder:", e);
        res.status(500).json({ error: e.message });
    }
};
