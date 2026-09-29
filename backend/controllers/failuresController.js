const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Catálogo de tipos de falla de producción (TiposFallas), por área.
// Los tickets de mantenimiento de máquinas (TicketsMantenimiento, que además dejaban la máquina
// en 'FALLA' para siempre) se reemplazaron por Servicio Técnico — controllers/servicioTecnicoController.js.

// =====================================================================
// 1. BUSCAR TÍTULOS DE FALLA (Nomenclador)
// =====================================================================
exports.searchFailureTitles = async (req, res) => {
    const { q, area } = req.query;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('term', sql.NVarChar(100), `%${q || ''}%`)
            .input('area', sql.VarChar(20), area)
            .query(`
                SELECT Top 10 Titulo
                FROM dbo.TiposFallas
                WHERE AreaID = @area AND Titulo LIKE @term
                ORDER BY EsFrecuente DESC, Titulo ASC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 2. CREAR NUEVO TIPO DE FALLA (Catálogo)
// =====================================================================
exports.createFailureType = async (req, res) => {
    const { areaId, titulo } = req.body;

    if (!areaId || !titulo) return res.status(400).json({ error: "Faltan datos" });

    try {
        const pool = await getPool();

        // Insertar directo (con validación de existencia implícita en SQL)
        await pool.request()
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Titulo', sql.NVarChar(200), titulo)
            .query(`
                IF NOT EXISTS (SELECT * FROM dbo.TiposFallas WHERE AreaID = @AreaID AND Titulo = @Titulo)
                BEGIN
                    INSERT INTO dbo.TiposFallas (AreaID, Titulo) VALUES (@AreaID, @Titulo)
                END
            `);

        res.json({ success: true, message: 'Catálogo actualizado' });
    } catch (err) {
        logger.error("Error crear tipo falla:", err);
        res.status(500).json({ error: err.message });
    }
};
