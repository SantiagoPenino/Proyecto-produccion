const { getPool, sql } = require('../config/db');

// Obtener órdenes de terminación ECOUV Agrupadas
exports.getFinishingOrders = async (req, res) => {
    try {
        const pool = await getPool();
        // Filtro flexible para variantes de terminación/extra
        const result = await pool.request().query(`
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
        console.error("Error getFinishingOrders:", e);
        res.status(500).json({ error: e.message });
    }
};

// Obtener detalles de items extras (materiales) de una orden
exports.getOrderDetails = async (req, res) => {
    const { id } = req.params; // OrdenID
    try {
        const pool = await getPool();
        const extras = await pool.request()
            .input('OID', sql.Int, id)
            .query("SELECT * FROM ServiciosExtraOrden WHERE OrdenID = @OID");

        if (extras.recordset.length > 0) {
            console.log("🔍 Extra Item Keys:", Object.keys(extras.recordset[0]));
        }

        res.json({ extras: extras.recordset });
    } catch (e) {
        console.error("Error getOrderDetails:", e);
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
        console.error("Error updateExtraItem:", e);
        res.status(500).json({ error: e.message });
    }
};

// Controlar Orden (Finalizar)
exports.controlOrder = async (req, res) => {
    const { id } = req.params; // OrdenID
    try {
        const pool = await getPool();
        // 1. Update Estado: Usar "Pronto" para que Logística lo vea (igual que AreaView)
        // para que avance al flujo de despacho.
        await pool.request()
            .input('OID', sql.Int, id)
            .query(`
                UPDATE Ordenes 
                SET EstadoenArea = 'Pronto', 
                    Estado = 'Pronto',
                    EstadoLogistica = 'Canasto Produccion'
                WHERE OrdenID = @OID
            `);

        // 2. Intentar Update Fecha Fin
        try {
            await pool.request()
                .input('OID', sql.Int, id)
                .query("UPDATE Ordenes SET FechaFinalizacion = GETDATE() WHERE OrdenID = @OID");
        } catch (ignored) {
            console.warn("⚠️ No se pudo actualizar FechaFinalizacion");
        }

        res.json({ success: true, message: "Orden marcada como Pronto (Canasto Producción)." });
    } catch (e) {
        console.error("Error controlOrder:", e);
        res.status(500).json({ error: e.message });
    }
};
