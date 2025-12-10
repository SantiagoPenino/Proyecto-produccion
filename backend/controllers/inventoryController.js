const { getPool, sql } = require('../config/db');

// Buscar Insumos (Autocompletado)
exports.searchItems = async (req, res) => {
    const { q } = req.query; 
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('term', sql.NVarChar(100), `%${q}%`)
            .query('SELECT Top 20 Nombre, UnidadDefault FROM dbo.Insumos WHERE Nombre LIKE @term');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Crear Insumo Nuevo
exports.createItem = async (req, res) => {
    const { nombre, unidad } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('Nombre', sql.NVarChar(200), nombre)
            .input('Unidad', sql.VarChar(20), unidad)
            .query('INSERT INTO dbo.Insumos (Nombre, UnidadDefault) VALUES (@Nombre, @Unidad)');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};