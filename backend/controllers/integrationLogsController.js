const { sql, getPool } = require('../config/db');

// Obtener Logs
const getLogs = async (req, res) => {
    try {
        const { estado, entidad } = req.query;
        const pool = await getPool();

        let query = "SELECT TOP 500 * FROM IntegrationLogs";
        let filters = [];

        if (estado && estado !== 'TODOS') {
            filters.push("Estado = @Estado");
        }
        if (entidad && entidad !== 'TODAS') {
            filters.push("TipoEntidad = @Entidad");
        }

        if (filters.length > 0) {
            query += " WHERE " + filters.join(" AND ");
        }

        query += " ORDER BY Fecha DESC";

        const request = pool.request();
        if (estado && estado !== 'TODOS') request.input('Estado', sql.VarChar, estado);
        if (entidad && entidad !== 'TODAS') request.input('Entidad', sql.VarChar, entidad);

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (e) {
        console.error("Error getting Logs:", e);
        res.status(500).json({ error: e.message });
    }
};

// Resolver Log
const resolveLog = async (req, res) => {
    const { logId, nuevoEstado } = req.body; // 'RESUELTO', 'IGNORADO'

    if (!logId) return res.status(400).json({ error: "LogID requerido" });

    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, logId)
            .input('Estado', sql.VarChar(20), nuevoEstado || 'RESUELTO')
            .query("UPDATE IntegrationLogs SET Estado = @Estado WHERE LogID = @ID");

        res.json({ success: true });
    } catch (e) {
        console.error("Error resolving log:", e);
        res.status(500).json({ error: e.message });
    }
};

// Limpiar Logs Antiguos (Mantenimiento)
const clearLogs = async (req, res) => {
    try {
        const pool = await getPool();
        // Borrar resueltos/ignorados de más de 30 días
        await pool.request().query("DELETE FROM IntegrationLogs WHERE Estado != 'PENDIENTE' AND Fecha < DATEADD(day, -30, GETDATE())");
        res.json({ success: true, message: "Logs antiguos eliminados" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getLogs,
    resolveLog,
    clearLogs
};
