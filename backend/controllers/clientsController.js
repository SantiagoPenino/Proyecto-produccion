const { getPool, sql } = require('../config/db');

// Buscar Clientes (Autocompletado)
exports.searchClients = async (req, res) => {
    const { q } = req.query; // Lo que escribe el usuario
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('term', sql.NVarChar(100), `%${q}%`)
            .query('SELECT TOP 10 * FROM dbo.Clientes WHERE Nombre LIKE @term');
        res.json(result.recordset);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
};

// Crear Cliente
exports.createClient = async (req, res) => {
    const { nombre, telefono } = req.body;
    try {
        const pool = await getPool();
        
        // Verificar si existe
        const check = await pool.request()
            .input('Nombre', sql.NVarChar(200), nombre)
            .query("SELECT COUNT(*) as count FROM dbo.Clientes WHERE Nombre = @Nombre");
            
        if (check.recordset[0].count > 0) {
            // Si ya existe, devolvemos el existente sin error
            const existing = await pool.request()
                .input('Nombre', sql.NVarChar(200), nombre)
                .query("SELECT * FROM dbo.Clientes WHERE Nombre = @Nombre");
            return res.json(existing.recordset[0]);
        }

        // Insertar nuevo
        const result = await pool.request()
            .input('Nombre', sql.NVarChar(200), nombre)
            .input('Telefono', sql.NVarChar(50), telefono || '')
            .query('INSERT INTO dbo.Clientes (Nombre, Telefono) OUTPUT INSERTED.* VALUES (@Nombre, @Telefono)');
            
        res.json(result.recordset[0]);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
};