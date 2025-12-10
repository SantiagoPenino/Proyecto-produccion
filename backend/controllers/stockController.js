const { getPool, sql } = require('../config/db');

// Crear solicitud
exports.createRequest = async (req, res) => {
    const { areaId, item, cantidad, unidad, prioridad, observaciones } = req.body;

    try {
        const pool = await getPool();
        await pool.request()
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Item', sql.NVarChar(200), item)
            .input('Cantidad', sql.Decimal(10, 2), cantidad)
            .input('Unidad', sql.VarChar(20), unidad)
            .input('Prioridad', sql.VarChar(20), prioridad)
            .input('Observaciones', sql.NVarChar(sql.MAX), observaciones || '')
            .query(`
                INSERT INTO dbo.SolicitudesInsumos (AreaID, Item, Cantidad, Unidad, Prioridad, Observaciones)
                VALUES (@AreaID, @Item, @Cantidad, @Unidad, @Prioridad, @Observaciones)
            `);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// Obtener historial
exports.getHistory = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT Top 50 * FROM dbo.SolicitudesInsumos 
                WHERE AreaID = @AreaID 
                ORDER BY FechaSolicitud DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Obtener conteo de urgentes (ESTE ES EL QUE FALTABA O CAUSABA ERROR)
exports.getUrgentCount = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .query("SELECT COUNT(*) as count FROM dbo.SolicitudesInsumos WHERE Prioridad = 'Urgente' AND Estado = 'Pendiente'");
        
        res.json({ count: result.recordset[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};