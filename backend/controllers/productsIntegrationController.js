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
                SupFlia, Grupo, CodStock, CodArticulo, Descripcion, IDProdReact
            FROM Articulos
            ORDER BY SupFlia, Grupo, Descripcion
        `);
        res.json(result.recordset);
    } catch (e) {
        console.error("Error getLocalArticles:", e);
        res.status(500).json({ error: e.message });
    }
};

// 2. Obtener Productos Remotos (Derecha - Proxy)
const getRemoteProducts = async (req, res) => {
    try {
        // Agente para ignorar errores SSL (Self-signed o intermedios faltantes)
        const agent = new https.Agent({
            rejectUnauthorized: false
        });

        // Fetch directo a la API externa
        const response = await axios.get('https://administracionuser.uy/api/apiproducto/data', {
            httpsAgent: agent,
            timeout: 10000 // 10 segundos timeout
        });

        res.json(response.data);
    } catch (e) {
        console.error("Error getRemoteProducts DETAILED:", e.message);
        if (e.response) {
            console.error("Remote Status:", e.response.status);
            console.error("Remote Data:", JSON.stringify(e.response.data).substring(0, 200));
        }
        res.status(502).json({ error: "Error conectando con API Externa", details: e.message });
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

module.exports = {
    getLocalArticles,
    getRemoteProducts,
    linkProduct,
    unlinkProduct
};
