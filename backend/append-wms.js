exports.getMasterVariants = async (req, res) => {
    try {
        const { idproid } = req.params;
        const pool = await getPool();
        const result = await pool.request()
            .input('Idproid', sql.Int, idproid)
            .query(`
                SELECT wms_variante_id, sku, nombre_variante, precio_excepcion, moneda_excepcion
                FROM Articulos_WMS_Variantes
                WHERE Idproid = @Idproid
                ORDER BY nombre_variante
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error(`Error getMasterVariants: ${err.message}`);
        res.status(500).json({ success: false, error: 'Server error' });
    }
};

exports.updateVariantPrice = async (req, res) => {
    try {
        const { wms_variante_id } = req.params;
        const { precio_excepcion, moneda_excepcion } = req.body;
        
        const pool = await getPool();
        await pool.request()
            .input('WmsVarianteId', sql.Int, wms_variante_id)
            .input('PrecioExcepcion', sql.Decimal(18,2), precio_excepcion === '' ? null : precio_excepcion)
            .input('MonedaExcepcion', sql.Int, moneda_excepcion === '' ? null : moneda_excepcion)
            .query(`
                UPDATE Articulos_WMS_Variantes
                SET precio_excepcion = @PrecioExcepcion, moneda_excepcion = @MonedaExcepcion
                WHERE wms_variante_id = @WmsVarianteId
            `);
            
        res.json({ success: true, message: 'Precio actualizado exitosamente.' });
    } catch (err) {
        logger.error(`Error updateVariantPrice: ${err.message}`);
        res.status(500).json({ success: false, error: 'Server error' });
    }
};
