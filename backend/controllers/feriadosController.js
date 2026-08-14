const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

exports.getAll = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .query("SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha, Descripcion FROM dbo.CalendarioFeriados ORDER BY Fecha ASC");
        res.json(result.recordset);
    } catch (err) {
        logger.error("Error getting feriados:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.create = async (req, res) => {
    const { fecha, descripcion } = req.body;
    try {
        if (!fecha) return res.status(400).json({ error: "Fecha requerida." });

        const pool = await getPool();
        const dup = await pool.request().input('Fecha', sql.Date, fecha)
            .query("SELECT 1 FROM dbo.CalendarioFeriados WHERE Fecha = @Fecha");
        if (dup.recordset.length > 0) {
            return res.status(409).json({ error: "Ya existe un feriado en esa fecha." });
        }

        await pool.request()
            .input('Fecha', sql.Date, fecha)
            .input('Descripcion', sql.VarChar(100), descripcion || null)
            .query("INSERT INTO dbo.CalendarioFeriados (Fecha, Descripcion) VALUES (@Fecha, @Descripcion)");

        res.json({ success: true, message: 'Feriado creado' });
    } catch (err) {
        logger.error("Error creating feriado:", err);
        res.status(500).json({ error: err.message });
    }
};

// La PK es Fecha (no hay un ID propio) — se identifica el feriado por su fecha original.
exports.update = async (req, res) => {
    const { fecha: fechaOriginal } = req.params;
    const { fecha, descripcion } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('FechaOriginal', sql.Date, fechaOriginal)
            .input('FechaNueva', sql.Date, fecha)
            .input('Descripcion', sql.VarChar(100), descripcion || null)
            .query(`UPDATE dbo.CalendarioFeriados SET Fecha = @FechaNueva, Descripcion = @Descripcion
                    WHERE Fecha = @FechaOriginal`);

        res.json({ success: true, message: 'Feriado actualizado' });
    } catch (err) {
        logger.error("Error updating feriado:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.remove = async (req, res) => {
    const { fecha } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('Fecha', sql.Date, fecha)
            .query("DELETE FROM dbo.CalendarioFeriados WHERE Fecha = @Fecha");

        res.json({ success: true, message: 'Feriado eliminado' });
    } catch (err) {
        logger.error("Error deleting feriado:", err);
        res.status(500).json({ error: err.message });
    }
};
