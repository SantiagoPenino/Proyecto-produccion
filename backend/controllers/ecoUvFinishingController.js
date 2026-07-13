const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Obtener órdenes de terminación ECOUV Agrupadas
// Modelo nuevo: la terminación vive DENTRO de la orden madre (OrdenTerminaciones por archivo).
// Legacy: órdenes-extra separadas con Variante '%Extra%' (pedidos anteriores al cambio).
exports.getFinishingOrders = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT
                O.OrdenID, O.CodigoOrden, O.NoDocERP, O.Cliente, O.DescripcionTrabajo, O.Prioridad, O.Estado,
                O.Material, O.Variante, O.FechaIngreso, O.Magnitud, O.UM, O.Nota, O.EstadoenArea,
                (SELECT COUNT(*) FROM ServiciosExtraOrden S WHERE S.OrdenID = O.OrdenID) as ExtrasCount,
                (SELECT COUNT(*) FROM OrdenTerminaciones OT WHERE OT.OrdenID = O.OrdenID) as TermCount,
                (SELECT COUNT(*) FROM OrdenTerminaciones OT WHERE OT.OrdenID = O.OrdenID AND OT.Estado = 'Pendiente') as TermPendientes
            FROM Ordenes O
            WHERE O.AreaID = 'ECOUV'
              AND O.Estado NOT IN ('Finalizado', 'Entregado', 'Cancelado')
              AND (
                    -- Modelo nuevo: orden con terminaciones por archivo
                    EXISTS (SELECT 1 FROM OrdenTerminaciones OT WHERE OT.OrdenID = O.OrdenID)
                    -- Legacy: orden-extra separada
                    OR O.Variante LIKE '%Extra%' OR O.Variante LIKE '%Servicio%' OR O.Variante LIKE '%Materiales%' OR O.Material LIKE '%Extra%'
              )
            ORDER BY
                CASE WHEN O.Prioridad = 'Urgente' THEN 0 ELSE 1 END,
                O.FechaIngreso DESC
        `);

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
                       T.Nombre, T.UnidadCobro,
                       A.NombreArchivo
                FROM OrdenTerminaciones OT
                INNER JOIN Terminaciones T ON T.TerminacionID = OT.TerminacionID
                LEFT JOIN ArchivosOrden A ON A.ArchivoID = OT.ArchivoID
                WHERE OT.OrdenID = @OID
                ORDER BY OT.ArchivoID, T.Nombre
            `);

        res.json({ extras: extras.recordset, terminaciones: terminaciones.recordset });
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
            .query("UPDATE OrdenTerminaciones SET Estado = @Est WHERE ID = @ID");
        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: `No existe la terminación ${id}.` });
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

        // 3. Recalcular Magnitud Total de la Orden (Suma de Extras) y Actualizar Ordenes
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
            `);

        res.json({ success: true });
    } catch (e) {
        logger.error("Error updateExtraItem:", e);
        res.status(500).json({ error: e.message });
    }
};

// Controlar Orden (Finalizar)
exports.controlOrder = async (req, res) => {
    const { id } = req.params; // OrdenID
    try {
        const pool = await getPool();
        const { changeOrderState } = require('../services/stateManagerService');
        // Acabado UV finalizado: pasa a 'Pronto' (detalle de Producción) + Canasto Producción, vía servicio central.
        const txUv = new sql.Transaction(pool);
        await txUv.begin();
        try {
            await changeOrderState(txUv, {
                target  : { type: 'ORDER', id },
                estado  : 'Pronto',
                userObj : req.user || 'Sistema',
                detalle : 'Acabado UV finalizado',
                extraSet: { EstadoLogistica: 'Canasto Produccion' },
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

        res.json({ success: true, message: "Orden marcada como Pronto (Canasto Producción)." });
    } catch (e) {
        logger.error("Error controlOrder:", e);
        res.status(500).json({ error: e.message });
    }
};
