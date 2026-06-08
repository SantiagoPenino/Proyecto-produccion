const fs = require('fs');

const path = 'controllers/productsIntegrationController.js';
let content = fs.readFileSync(path, 'utf8');

// Replace updateWmsMasterId
const updateRegex = /\/\/ 7\. Update WMS Master ID[\s\S]*?\/\/ 8\. Upload Article Image/;
const newUpdateFn = `// 7. Update WMS Master ID
const updateWmsMasterId = async (req, res) => {
    const { id } = req.params;
    const { producto_maestro_id } = req.body;

    if (!id) return res.status(400).json({ error: 'Falta ProIdProducto' });

    try {
        const pool = await getPool();
        
        // Primero intentamos hacer UPDATE
        const updateRes = await pool.request()
            .input('Idproid', sql.Int, parseInt(id))
            .input('producto_maestro_id', sql.Int, producto_maestro_id != null && producto_maestro_id !== '' ? parseInt(producto_maestro_id) : null)
            .query(\`
                UPDATE Articulos_Wms 
                SET producto_maestro_id = @producto_maestro_id 
                WHERE Idproid = @Idproid
            \`);

        let nombre_wms = 'Sin Nombre';
        
        // Conseguir la descripcion para nombre_wms
        const articleRes = await pool.request()
            .input('Idproid', sql.Int, parseInt(id))
            .query(\`SELECT Descripcion FROM Articulos WHERE ProIdProducto = @Idproid\`);
            
        if (articleRes.recordset.length > 0) {
            nombre_wms = articleRes.recordset[0].Descripcion;
        }

        // Si no se actualizó nada, significa que no existe el registro, hacemos INSERT
        if (updateRes.rowsAffected[0] === 0) {
            await pool.request()
                .input('Idproid', sql.Int, parseInt(id))
                .input('producto_maestro_id', sql.Int, producto_maestro_id != null && producto_maestro_id !== '' ? parseInt(producto_maestro_id) : null)
                .input('nombre_wms', sql.VarChar(255), nombre_wms)
                .query(\`
                    INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms)
                    VALUES (@Idproid, @producto_maestro_id, @nombre_wms)
                \`);
        }

        // --- NEW: Fetch variants from WMS and sync Articulos_WMS_Variantes ---
        if (producto_maestro_id) {
            try {
                const axios = require('axios');
                const wmsQuery = \`
                    USE Ventas_Dev;
                    SELECT id as variante_id, nombre_variante, codigo_variante 
                    FROM Stock_Variantes 
                    WHERE producto_maestro_id = \${parseInt(producto_maestro_id)};
                \`;
                const response = await axios.post('https://administracionuser.uy/api/sql', { query: wmsQuery }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                });
                
                const wmsData = response.data;
                const variants = wmsData.data || [];
                
                // Borrar variantes anteriores para este articulo
                await pool.request()
                    .input('Idproid', sql.Int, parseInt(id))
                    .query(\`DELETE FROM Articulos_WMS_Variantes WHERE Idproid = @Idproid\`);
                    
                // Insertar nuevas variantes
                for (const v of variants) {
                    await pool.request()
                        .input('Idproid', sql.Int, parseInt(id))
                        .input('WmsVarianteId', sql.Int, v.variante_id)
                        .input('Sku', sql.VarChar, v.codigo_variante || '')
                        .input('NombreVariante', sql.VarChar, v.nombre_variante || '')
                        .query(\`
                            INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante)
                            VALUES (@Idproid, @WmsVarianteId, @Sku, @NombreVariante)
                        \`);
                }
                logger.info(\`Updated WMS Master ID for ProId: \${id}. Synced \${variants.length} variants.\`);
            } catch (err) {
                logger.error('Error syncing WMS variants on updateWmsMasterId: ' + err.message);
            }
        }

        res.json({ success: true, message: 'ID Maestro WMS actualizado correctamente' });
    } catch (e) {
        logger.error('Error updateWmsMasterId:', e);
        res.status(500).json({ error: e.message });
    }
};

// 8. Upload Image`;

content = content.replace(updateRegex, newUpdateFn);

// Append endpoints
const newEndpoints = `
// 9. Get WMS Master Products
const getWmsMasters = async (req, res) => {
    try {
        const axios = require('axios');
        const wmsQuery = \`
            USE Ventas_Dev;
            SELECT id, nombre 
            FROM Stock_Productos_Maestros 
            ORDER BY nombre;
        \`;
        const response = await axios.post('https://administracionuser.uy/api/sql', { query: wmsQuery }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
        const wmsData = response.data;
        res.json({ success: true, data: wmsData.data || [] });
    } catch (e) {
        logger.error("Error fetching WMS Masters:", e);
        res.status(500).json({ error: 'Error al obtener productos maestros del WMS' });
    }
};

// 10. Get WMS Variants for a specific Master ID
const getWmsVariants = async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Falta ID de producto maestro' });

    try {
        const axios = require('axios');
        const wmsQuery = \`
            USE Ventas_Dev;
            SELECT id as variante_id, nombre_variante, codigo_variante 
            FROM Stock_Variantes 
            WHERE producto_maestro_id = \${parseInt(id)};
        \`;
        const response = await axios.post('https://administracionuser.uy/api/sql', { query: wmsQuery }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
        const wmsData = response.data;
        res.json({ success: true, data: wmsData.data || [] });
    } catch (e) {
        logger.error("Error fetching WMS Variants:", e);
        res.status(500).json({ error: 'Error al obtener variantes del WMS' });
    }
};

module.exports = {
    getLocalArticles,
    getRemoteProducts,
    linkProduct,
    unlinkProduct,
    updateLocalProduct,
    createLocalProduct,
    updateWmsMasterId,
    uploadArticleImage,
    getWmsMasters,
    getWmsVariants
};
`;

content = content.replace(/module\.exports = \{[\s\S]*?\};/, newEndpoints);

fs.writeFileSync(path, content, 'utf8');
console.log('Done');


