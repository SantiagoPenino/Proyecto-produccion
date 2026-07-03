const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
// Dynamic import for fetch if needed, but since Node 18 it's native.
// The .env has WMS_API_URL

exports.syncCatalog = async (req, res) => {
    try {
        const wmsSqlUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';

        // Query WMS for Familia 2 (if filtering there) or just get all and filter here
        const wmsQuery = `
            USE Ventas_Dev;
            SELECT v.id as variante_id, v.nombre_variante, v.codigo_variante, 
                   v.producto_maestro_id, p.nombre as producto_nombre, 
                   p.categoria_id, c.nombre as cat_nombre 
            FROM Stock_Variantes v 
            INNER JOIN Stock_Productos_Maestros p ON v.producto_maestro_id = p.id 
            LEFT JOIN Stock_Categorias c ON p.categoria_id = c.id 
            ORDER BY p.nombre, v.nombre_variante;
        `;

        const response = await fetch(`${wmsSqlUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: wmsQuery })
        });
        
        const wmsData = await response.json();
        if (wmsData.error) throw new Error(`WMS API Error: ${wmsData.error}`);
        
        const items = wmsData.data || [];
        
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            let insertedMasters = 0;
            let insertedVariants = 0;

            for (const item of items) {
                // Try to map to local article
                // For this MVP, we match by name or by existing records
                const checkLocal = await transaction.request()
                    .input('ProdNombre', sql.VarChar, item.producto_nombre)
                    .query(`
                        SELECT TOP 1 ProIdProducto 
                        FROM Articulos 
                        WHERE Descripcion = @ProdNombre OR Descripcion LIKE '%' + @ProdNombre + '%'
                        ORDER BY 
                            CASE WHEN SupFlia = '2' THEN 0 ELSE 1 END, 
                            CASE WHEN Descripcion = @ProdNombre THEN 0 ELSE 1 END,
                            ProIdProducto ASC
                    `);

                let localId = null;
                if (checkLocal.recordset.length > 0) {
                    localId = checkLocal.recordset[0].ProIdProducto;
                }

                if (localId) {
                    // UPSERT Master
                    const checkMaster = await transaction.request()
                        .input('Idproid', sql.Int, localId)
                        .input('WmsMasterId', sql.Int, item.producto_maestro_id)
                        .input('NombreWms', sql.VarChar, item.producto_nombre)
                        .query(`
                            IF NOT EXISTS (SELECT 1 FROM Articulos_Wms WHERE Idproid = @Idproid)
                            BEGIN
                                INSERT INTO Articulos_Wms (Idproid, producto_maestro_id, nombre_wms, fecha_sync)
                                VALUES (@Idproid, @WmsMasterId, @NombreWms, GETDATE());
                            END
                            ELSE
                            BEGIN
                                UPDATE Articulos_Wms SET fecha_sync = GETDATE(), nombre_wms = @NombreWms, producto_maestro_id = @WmsMasterId
                                WHERE Idproid = @Idproid;
                            END
                        `);
                    insertedMasters++;

                    // UPSERT Variant
                    await transaction.request()
                        .input('Idproid', sql.Int, localId)
                        .input('WmsVarianteId', sql.Int, item.variante_id)
                        .input('Sku', sql.VarChar, item.codigo_variante || '')
                        .input('NombreVariante', sql.VarChar, item.nombre_variante || '')
                        .query(`
                            IF NOT EXISTS (SELECT 1 FROM Articulos_WMS_Variantes WHERE wms_variante_id = @WmsVarianteId)
                            BEGIN
                                INSERT INTO Articulos_WMS_Variantes (Idproid, wms_variante_id, sku, nombre_variante)
                                VALUES (@Idproid, @WmsVarianteId, @Sku, @NombreVariante);
                            END
                            ELSE
                            BEGIN
                                UPDATE Articulos_WMS_Variantes 
                                SET sku = @Sku, nombre_variante = @NombreVariante
                                WHERE wms_variante_id = @WmsVarianteId;
                            END
                        `);
                    insertedVariants++;
                }
            }

            await transaction.commit();
            res.json({ success: true, message: `Sync completada. Masters: ${insertedMasters}, Variantes: ${insertedVariants}` });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        logger.error('Error en syncCatalog:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getCatalog = async (req, res) => {
    try {
        const pool = await getPool();
        
        // 1. Get ALL local catalog where SupFlia = 2 (LEFT JOIN for WMS data)
        const result = await pool.request().query(`
            SELECT 
                a.ProIdProducto, a.Descripcion, a.SupFlia,
                aw.producto_maestro_id, aw.nombre_wms,
                v.wms_variante_id, v.sku, v.nombre_variante,
                v.precio_excepcion, v.moneda_excepcion,
                img.url_imagen, img.es_generica,
                loc.pasillo, loc.estante,
                pb.Precio, pb.Moneda
            FROM Articulos a
            LEFT JOIN Articulos_Wms aw ON a.ProIdProducto = aw.Idproid
            LEFT JOIN Articulos_WMS_Variantes v ON aw.Idproid = v.Idproid
            LEFT JOIN PreciosBase pb ON a.ProIdProducto = pb.ProIdProducto
            LEFT JOIN Articulos_Imagenes img ON a.ProIdProducto = img.Idproid AND img.orden = 1
            LEFT JOIN Articulos_UbicacionLocal loc ON a.ProIdProducto = loc.Idproid
            WHERE a.SupFlia = '2'
        `);

        // 2. Fetch live stock from WMS — solo depósito configurado (WMS_DEPOSITO_LOCAL_ID)
        const stockMap = {};
        try {
            const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
            const depositoId = process.env.WMS_DEPOSITO_LOCAL_ID || 5; // depósito de Ventas
            if (wmsUrl) {
                const wmsQuery = `
                    USE Ventas_Dev;
                    SELECT 
                        variante_id, 
                        ISNULL(SUM(cantidad_actual), 0) as total_stock
                    FROM Stock_Etiquetas
                    WHERE estado = 'activo' 
                      AND cantidad_actual > 0
                      AND deposito_id = ${depositoId}
                    GROUP BY variante_id
                `;
                const response = await fetch(`${wmsUrl}/sql`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: wmsQuery })
                });
                
                if (response.ok) {
                    const stockData = await response.json();
                    if (stockData.success && stockData.data) {
                        stockData.data.forEach(item => {
                            stockMap[item.variante_id] = item.total_stock;
                        });
                    }
                } else {
                    logger.warn(`WMS API returned status ${response.status} for stock`);
                }
            }
        } catch (e) {
            logger.warn(`Could not fetch live stock from WMS: ${e.message}`);
        }

        // 3. Group by Product
        const productsMap = {};
        result.recordset.forEach(row => {
            if (!productsMap[row.ProIdProducto]) {
                productsMap[row.ProIdProducto] = {
                    ProIdProducto: row.ProIdProducto,
                    Descripcion: (row.Descripcion || '').trim(),
                    nombre_wms: (row.nombre_wms || row.Descripcion || '').trim(),
                    producto_maestro_id: row.producto_maestro_id || null,
                    imagen: row.url_imagen || null,
                    es_generica: row.es_generica,
                    ubicacion: { pasillo: row.pasillo, estante: row.estante },
                    precio: row.Precio || 0,
                    moneda: row.Moneda ? row.Moneda.trim() : 'UYU',
                    variantes: [],
                    total_stock: 0
                };
            }
            
            // Get actual stock from WMS mapped data, fallback to 0
            const variantStock = stockMap[row.wms_variante_id] || 0;
            productsMap[row.ProIdProducto].total_stock += variantStock;
            
            productsMap[row.ProIdProducto].variantes.push({
                wms_variante_id: row.wms_variante_id || row.ProIdProducto, // fallback to local ID if not mapped
                sku: row.sku || '',
                nombre_variante: row.nombre_variante || 'Única',
                stock: variantStock,
                // Precio por variante: usa precio_excepcion si existe, sino el precio base del artículo
                precio_excepcion: row.precio_excepcion != null ? parseFloat(row.precio_excepcion) : null,
                // moneda_excepcion: 1=UYU, 2=USD
                moneda_excepcion: row.moneda_excepcion === 2 ? 'USD' : (row.moneda_excepcion === 1 ? 'UYU' : null)
            });
        });

        res.json({ success: true, data: Object.values(productsMap) });
    } catch (err) {
        logger.error('Error en getCatalog:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.createOrder = async (req, res) => {
    try {
        const { clienteId, items, moneda, total } = req.body;
        if (!items || items.length === 0) throw new Error('El pedido no tiene items');

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Get next VEN code
            const maxResult = await transaction.request().query(`
                SELECT ISNULL(MAX(CAST(SUBSTRING(NoDocERP, 5, LEN(NoDocERP)) AS INT)), 0) + 1 as NextID 
                FROM PedidosCobranza 
                WHERE NoDocERP LIKE 'VEN-%'
            `);
            const nextId = maxResult.recordset[0].NextID;
            const codigoVenta = `VEN-${nextId.toString().padStart(4, '0')}`;

            // 1. Insert header
            const insertHeader = await transaction.request()
                .input('NoDocERP', sql.NVarChar, codigoVenta)
                .input('ClienteID', sql.Int, clienteId || 2089) // 2089 = CONSUMIDOR FINAL
                .input('MontoTotal', sql.Decimal(18,2), total)
                .input('Moneda', sql.VarChar, moneda || 'UYU')
                .input('EstadoCobro', sql.NVarChar, 'PENDIENTE')
                .query(`
                    INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, EstadoCobro)
                    OUTPUT INSERTED.ID
                    VALUES (@NoDocERP, @ClienteID, @MontoTotal, @Moneda, GETDATE(), @EstadoCobro)
                `);
            
            const pedidoId = insertHeader.recordset[0].ID;

            // 2. Insert items
            let ordenIndex = 1;
            for (const item of items) {
                await transaction.request()
                    .input('PedidoCobranzaID', sql.Int, pedidoId)
                    .input('OrdenID', sql.Int, ordenIndex)
                    .input('ProIdProducto', sql.Int, item.ProIdProducto)
                    .input('CodArticulo', sql.NVarChar, item.wms_variante_id.toString()) // Storing WMS ID here for tracking
                    .input('Cantidad', sql.Decimal(18,2), item.cantidad)
                    .input('PrecioUnitario', sql.Decimal(18,2), item.precio)
                    .input('Subtotal', sql.Decimal(18,2), item.cantidad * item.precio)
                    .input('Moneda', sql.VarChar, moneda || 'UYU')
                    .input('PrecioUnitarioOriginal', sql.Decimal(18,2), item.precioOriginal || item.precio)
                    .input('SubtotalOriginal', sql.Decimal(18,2), item.subtotalOriginal || (item.cantidad * item.precio))
                    .input('MonedaOriginal', sql.VarChar, item.monedaOriginal || moneda || 'UYU')
                    .query(`
                        INSERT INTO PedidosCobranzaDetalle 
                        (PedidoCobranzaID, OrdenID, ProIdProducto, CodArticulo, Cantidad, PrecioUnitario, Subtotal, Moneda, DatoTecnico, PrecioUnitarioOriginal, SubtotalOriginal, MonedaOriginal)
                        VALUES 
                        (@PedidoCobranzaID, @OrdenID, @ProIdProducto, @CodArticulo, @Cantidad, @PrecioUnitario, @Subtotal, @Moneda, 0, @PrecioUnitarioOriginal, @SubtotalOriginal, @MonedaOriginal)
                    `);
                ordenIndex++;
            }

            await transaction.commit();
            res.json({ success: true, pedidoId, codigoVenta });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        logger.error('Error en createOrder:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getImages = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('Idproid', sql.Int, req.params.idproid)
            .query('SELECT * FROM Articulos_Imagenes WHERE Idproid = @Idproid ORDER BY orden');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateLocation = async (req, res) => {
    try {
        const { pasillo, estante, observaciones } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('Idproid', sql.Int, req.params.idproid)
            .input('Pasillo', sql.VarChar, pasillo)
            .input('Estante', sql.VarChar, estante)
            .input('Obs', sql.VarChar, observaciones)
            .query(`
                IF EXISTS (SELECT 1 FROM Articulos_UbicacionLocal WHERE Idproid = @Idproid)
                    UPDATE Articulos_UbicacionLocal SET pasillo = @Pasillo, estante = @Estante, observaciones_ubicacion = @Obs WHERE Idproid = @Idproid;
                ELSE
                    INSERT INTO Articulos_UbicacionLocal (Idproid, pasillo, estante, observaciones_ubicacion) VALUES (@Idproid, @Pasillo, @Estante, @Obs);
            `);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getExchangeRate = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT TOP 1 CotDolar AS Valor FROM dbo.Cotizaciones ORDER BY CotFecha DESC");
        const rate = result.recordset.length > 0 ? parseFloat(result.recordset[0].Valor) || 40.0 : 40.0;
        res.json({ success: true, rate });
    } catch (err) {
        logger.error('Error fetching exchange rate:', err);
        res.status(500).json({ error: err.message });
    }
};
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
