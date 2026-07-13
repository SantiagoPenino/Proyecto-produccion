const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Obtener Tiempos de Entrega
exports.getAllDeliveryTimes = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT * FROM dbo.ConfiguracionTiemposEntrega ORDER BY AreaID ASC, Prioridad ASC");
        res.json(result.recordset);
    } catch (err) {
        logger.error("Error getting delivery times:", err);
        res.status(500).json({ error: err.message });
    }
};

// Crear Tiempo de Entrega
// AreaID es VarChar(20) en la tabla (VarChar(5) rompía con 'DIRECTA') y Prioridad
// es TEXTO ('Normal'/'Urgente') — el portal la matchea por nombre, no por número.
exports.createDeliveryTime = async (req, res) => {
    const { areaID, prioridad, horas, dias, texto } = req.body;
    try {
        const prioridadStr = String(prioridad || '').trim();
        if (!areaID || !prioridadStr) {
            return res.status(400).json({ error: "Área y Prioridad son obligatorios." });
        }

        const pool = await getPool();

        // Evitar duplicados área+prioridad (el portal usa la primera que encuentra)
        const dup = await pool.request()
            .input('AreaID', sql.VarChar(20), areaID)
            .input('Prioridad', sql.VarChar(20), prioridadStr)
            .query("SELECT ConfigID FROM dbo.ConfiguracionTiemposEntrega WHERE AreaID = @AreaID AND Prioridad = @Prioridad");
        if (dup.recordset.length > 0) {
            return res.status(409).json({ error: `Ya existe un tiempo para ${areaID} / ${prioridadStr}. Editá el existente.` });
        }

        await pool.request()
            .input('AreaID', sql.VarChar(20), areaID)
            .input('Prioridad', sql.VarChar(20), prioridadStr)
            .input('Horas', sql.Int, horas || 0)
            .input('Dias', sql.Int, dias || 0)
            .input('Texto', sql.NVarChar(200), (texto && texto.trim()) ? texto.trim() : null)
            .query("INSERT INTO dbo.ConfiguracionTiemposEntrega (AreaID, Prioridad, Horas, Dias, Texto) VALUES (@AreaID, @Prioridad, @Horas, @Dias, @Texto)");

        res.json({ success: true, message: 'Tiempo de entrega creado' });
    } catch (err) {
        logger.error("Error creating delivery time:", err);
        res.status(500).json({ error: err.message });
    }
};

// Actualizar Tiempo de Entrega
exports.updateDeliveryTime = async (req, res) => {
    const { id } = req.params;
    const { areaID, prioridad, horas, dias, texto } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, id)
            .input('AreaID', sql.VarChar(20), areaID)
            .input('Prioridad', sql.VarChar(20), String(prioridad || '').trim())
            .input('Horas', sql.Int, horas || 0)
            .input('Dias', sql.Int, dias || 0)
            .input('Texto', sql.NVarChar(200), (texto && texto.trim()) ? texto.trim() : null)
            .query(`UPDATE dbo.ConfiguracionTiemposEntrega
                    SET AreaID = @AreaID, Prioridad = @Prioridad, Horas = @Horas, Dias = @Dias, Texto = @Texto
                    WHERE ConfigID = @ID`);

        res.json({ success: true, message: 'Tiempo de entrega actualizado' });
    } catch (err) {
        logger.error("Error updating delivery time:", err);
        res.status(500).json({ error: err.message });
    }
};

// Eliminar Tiempo de Entrega
exports.deleteDeliveryTime = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, id)
            .query("DELETE FROM dbo.ConfiguracionTiemposEntrega WHERE ConfigID = @ID");

        res.json({ success: true, message: 'Tiempo de entrega eliminado' });
    } catch (err) {
        logger.error("Error deleting delivery time:", err);
        res.status(500).json({ error: err.message });
    }
};
