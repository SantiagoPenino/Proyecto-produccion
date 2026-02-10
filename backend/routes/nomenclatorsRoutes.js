const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../config/db');

// Get All Departments
router.get('/departments', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM Departamentos ORDER BY Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Localities by Department ID
router.get('/localities/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Id', sql.Int, req.params.id)
            .query("SELECT * FROM Localidades WHERE DepartamentoID = @Id ORDER BY Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Agencies
router.get('/agencies', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM Agencias ORDER BY Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Shipping Methods
router.get('/shipping-methods', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM FormasEnvio ORDER BY Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Priorities
router.get('/priorities', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM ConfigPrioridades WHERE Activo = 1 ORDER BY Nivel ASC");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Variants (Sub-Categoría) by AreaID
router.get('/variants/:areaId', async (req, res) => {
    try {
        const { areaId } = req.params;
        const pool = await getPool();

        const r = await pool.request()
            .input('AreaID', sql.VarChar, areaId)
            .query(`
                SELECT DISTINCT LTRIM(RTRIM(dbo.StockArt.Articulo)) AS Variante
                FROM dbo.ConfigMapeoERP 
                INNER JOIN dbo.StockArt ON dbo.ConfigMapeoERP.CodigoERP = dbo.StockArt.Grupo
                WHERE dbo.ConfigMapeoERP.AreaID_Interno = @AreaID
                  AND ISNULL(dbo.StockArt.mostrar, 1) = 1
                ORDER BY Variante
            `);

        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Materials (Soporte) dependent on Area and Selected Variant
router.get('/materials/:areaId/:variante', async (req, res) => {
    try {
        const { areaId, variante } = req.params;
        const pool = await getPool();

        const r = await pool.request()
            .input('AreaID', sql.VarChar, areaId)
            .input('Variante', sql.NVarChar, variante)
            .query(`
                SELECT 
                    dbo.articulos.CodArticulo, 
                    dbo.articulos.CodStock,
                    dbo.articulos.Descripcion AS Material
                FROM dbo.ConfigMapeoERP 
                INNER JOIN dbo.StockArt ON dbo.ConfigMapeoERP.CodigoERP = dbo.StockArt.Grupo 
                INNER JOIN dbo.articulos ON dbo.StockArt.CodStock = dbo.articulos.CodStock
                WHERE dbo.ConfigMapeoERP.AreaID_Interno = @AreaID
                  AND LTRIM(RTRIM(dbo.StockArt.Articulo)) = LTRIM(RTRIM(@Variante))
                  AND ISNULL(dbo.StockArt.mostrar, 1) = 1
                  AND ISNULL(dbo.articulos.mostrar, 1) = 1
                ORDER BY dbo.articulos.Descripcion
            `);

        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
