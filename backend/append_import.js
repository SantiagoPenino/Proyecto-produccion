exports.importWmsMaster = async (req, res) => {
    const { getPool, sql } = require('../config/db');
    try {
        const { id } = req.params;
        const wmsUrl = process.env.WMS_API_URL || 'https://administracionuser.uy/api';

        // 1. Fetch Master info from WMS
        const resMaestro = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `USE Ventas_Dev; SELECT id, nombre FROM Stock_Productos_Maestros WHERE id = ${id}` })
        });
        const wmsMaestro = (await resMaestro.json()).data?.[0];

        if (!wmsMaestro) {
            return res.status(404).json({ success: false, message: 'Producto Maestro no encontrado en WMS.' });
        }

        // 2. Fetch variants
        const resVariantes = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `USE Ventas_Dev; SELECT id, producto_maestro_id, nombre_variante, codigo_variante FROM Stock_Variantes WHERE producto_maestro_id = ${id}` })
        });
        const wmsVariantes = (await resVariantes.json()).data || [];

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Check if already mapped
            const checkMapping = await transaction.request()
                .input('WmsMasterId', sql.Int, id)
                .query(`SELECT Idproid FROM Articulos_Wms WHERE producto_maestro_id = @WmsMasterId`);

            if (checkMapping.recordset.length > 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, message: 'El producto ya está importado.' });
            }

            // Create new Article
            const insertArt = await transaction.request()
                .input('Nombre', sql.VarChar, wmsMaestro.nombre)
                .input('CodArticulo', sql.VarChar, `WMS-${id}`)
                .query(`
                    INSERT INTO Articulos (CodArticulo, Descripcion, SupFlia, Grupo, Mostrar, MonIdMoneda, borrar)
                    OUTPUT INSERTED.ProIdProducto
                    VALUES (@CodArticulo, @Nombre, '2', '2.1', 1, 2, 0)
                `);
            const localId = insertArt.recordset[0].ProIdProducto;

            // Mapping
            await transaction.request()
                .input('Idproid', sql.Int, localId)
                .input('WmsMasterId', sql.Int, id)
                .input('NombreWms', sql.VarChar, wmsMaestro.nombre)
                .query(`
                    INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms, fecha_sync)
                    VALUES (@Idproid, @WmsMasterId, @NombreWms, GETDATE())
                `);

            // Variants
            for (const variant of wmsVariantes) {
                await transaction.request()
                    .input('Idproid', sql.Int, localId)
                    .input('WmsVarianteId', sql.Int, variant.id)
                    .input('Sku', sql.VarChar, variant.codigo_variante || '')
                    .input('NombreVariante', sql.VarChar, variant.nombre_variante || '')
                    .query(`
                        INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante)
                        VALUES (@Idproid, @WmsVarianteId, @Sku, @NombreVariante)
                    `);
            }

            await transaction.commit();
            res.json({ success: true, message: 'Producto y variantes importados correctamente.', newId: localId });

        } catch (dbErr) {
            await transaction.rollback();
            throw dbErr;
        }

    } catch (err) {
        console.error('Error in importWmsMaster:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};
