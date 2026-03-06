const { sql, getPool } = require('../config/db');
const axios = require('axios');
const https = require('https');
const { logAlert } = require('../services/alertsService');

// 1. Obtener Articulos Locales (Izquierda)
const getLocalArticles = async (req, res) => {
    try {
        const pool = await getPool();
        // Traemos más campos para poder armar el árbol (SupFlia, Grupo)
        const result = await pool.request().query(`
            SELECT TOP 5000 
                a.SupFlia, a.Grupo, a.CodStock, a.CodArticulo, a.Descripcion, a.IDProdReact, a.Mostrar, a.anchoimprimible, a.LLEVAPAPEL,
                map.NombreReferencia as DescripcionGrupo
            FROM Articulos a
            LEFT JOIN ConfigMapeoERP map ON map.CodigoERP = a.Grupo COLLATE Database_Default
            ORDER BY a.SupFlia, a.Grupo, a.Descripcion
        `);
        res.json(result.recordset);
    } catch (e) {
        console.error("Error getLocalArticles:", e);
        res.status(500).json({ error: e.message });
    }
};

// 2. Obtener Productos (query directa a DB local)
const getRemoteProducts = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                p.ProIdProducto, p.ProCodigoOdooProducto, p.ProNombreProducto,
                p.ProDetalleProducto, p.SMaIdSubMarca, p.UniIdUnidad,
                p.ProVigente, p.MonIdMoneda, p.ProPrecioActual,
                sm.SMaNombreSubMarca AS SubMarca,
                u.UniNotación AS Unidad,
                m.MonSimbolo AS Moneda
            FROM Productos p WITH(NOLOCK)
            LEFT JOIN SubMarcas sm WITH(NOLOCK) ON sm.SMaIdSubMarca = p.SMaIdSubMarca
            LEFT JOIN Unidades u WITH(NOLOCK) ON u.UniIdUnidad = p.UniIdUnidad
            LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = p.MonIdMoneda
            ORDER BY p.ProNombreProducto
        `);
        res.json(result.recordset);
    } catch (e) {
        console.error("Error getRemoteProducts:", e.message);
        res.status(500).json({ error: "Error al obtener productos", details: e.message });
    }
};

// 3. Vincular (Link)
const linkProduct = async (req, res) => {
    const { codArticulo, idProdReact } = req.body;

    if (!codArticulo || !idProdReact) {
        return res.status(400).json({ error: "Falta CodArticulo o IdProdReact" });
    }

    try {
        const pool = await getPool();
        await pool.request()
            .input('Cod', sql.VarChar, codArticulo)
            .input('ReactID', sql.Int, idProdReact)
            .query("UPDATE Articulos SET IDProdReact = @ReactID WHERE CodArticulo = @Cod");

        logAlert('INFO', 'PRODUCTO', 'Producto vinculado manualmente', codArticulo, { idProdReact });

        res.json({ success: true, message: "Vinculado correctamente" });
    } catch (e) {
        console.error("Error linkProduct:", e);
        logAlert('ERROR', 'PRODUCTO', 'Fallo al vincular producto', codArticulo, { error: e.message });
        res.status(500).json({ error: e.message });
    }
};

// 4. Desvincular (Unlink)
const unlinkProduct = async (req, res) => {
    const { codArticulo } = req.body;

    if (!codArticulo) return res.status(400).json({ error: "Falta CodArticulo" });

    try {
        const pool = await getPool();
        await pool.request()
            .input('Cod', sql.VarChar, codArticulo)
            .query("UPDATE Articulos SET IDProdReact = NULL WHERE CodArticulo = @Cod");

        logAlert('WARN', 'PRODUCTO', 'Producto desvinculado', codArticulo);

        res.json({ success: true, message: "Desvinculado correctamente" });
    } catch (e) {
        console.error("Error unlinkProduct:", e);
        res.status(500).json({ error: e.message });
    }
};

// 5. Actualizar Producto Local
const updateLocalProduct = async (req, res) => {
    const { codArticulo, descripcion, codStock, grupo, supFlia, mostrar, anchoImprimible, llevaPapel } = req.body;

    if (!codArticulo) return res.status(400).json({ error: "Falta CodArticulo" });

    try {
        const pool = await getPool();
        await pool.request()
            .input('Cod', sql.VarChar(50), codArticulo)
            .input('Desc', sql.VarChar(255), descripcion || '')
            .input('Stock', sql.VarChar(50), codStock || '')
            .input('Grp', sql.VarChar(100), grupo || '')
            .input('Sup', sql.VarChar(100), supFlia || '')
            .input('Mos', sql.Bit, mostrar ? 1 : 0)
            .input('Ancho', sql.Decimal(10, 2), anchoImprimible || 0)
            .input('Papel', sql.Bit, llevaPapel ? 1 : 0)
            .query(`
                UPDATE Articulos 
                SET Descripcion = @Desc, 
                    CodStock = @Stock, 
                    Grupo = @Grp, 
                    SupFlia = @Sup, 
                    Mostrar = @Mos, 
                    anchoimprimible = @Ancho, 
                    LLEVAPAPEL = @Papel
                WHERE CodArticulo = @Cod
            `);

        logAlert('INFO', 'PRODUCTO', 'Producto local actualizado', codArticulo, { descripcion, codStock });

        res.json({ success: true, message: "Producto actualizado correctamente" });
    } catch (e) {
        console.error("Error updateLocalProduct:", e);
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getLocalArticles,
    getRemoteProducts,
    linkProduct,
    unlinkProduct,
    updateLocalProduct
};
