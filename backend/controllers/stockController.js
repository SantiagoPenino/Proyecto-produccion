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
                INSERT INTO dbo.Solicitudes (AreaID, Item, Cantidad, Unidad, Prioridad, Observaciones, Estado, FechaSolicitud)
                VALUES (@AreaID, @Item, @Cantidad, @Unidad, @Prioridad, @Observaciones, 'Pendiente', GETDATE())
            `);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// Obtener historial por area
exports.getHistory = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT Top 50 * FROM dbo.Solicitudes 
                WHERE AreaID = @AreaID 
                ORDER BY FechaSolicitud DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Obtener TODAS las solicitudes (Logística)
exports.getAllRequests = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .query("SELECT * FROM dbo.Solicitudes ORDER BY CASE WHEN Estado='Pendiente' THEN 0 ELSE 1 END, FechaSolicitud DESC");
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Actualizar estado
exports.updateRequestStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, id)
            .input('Status', sql.VarChar(50), status)
            .query("UPDATE dbo.Solicitudes SET Estado = @Status WHERE SolicitudID = @ID");

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Obtener conteo de urgentes
exports.getUrgentCount = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .query("SELECT COUNT(*) as count FROM dbo.Solicitudes WHERE Prioridad = 'Urgente' AND Estado = 'Pendiente'");

        res.json({ count: result.recordset[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
