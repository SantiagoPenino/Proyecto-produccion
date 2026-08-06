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

            // 3. [WMS] Orden acompañante por ítem, área PRO — mismo mecanismo que la prenda
            // personalizada: existe SOLO para poder generar su bulto/etiqueta con destino
            // Depósito en confirmPreparation. EstadoDependencia='VENTA_DIRECTA' la excluye
            // de cualquier grilla de producción (no es trabajo, es un ancla de etiqueta) —
            // aditivo, no toca en nada el resto del flujo VEN/PedidosCobranza de arriba.
            let clienteNombre = 'Consumidor Final';
            try {
                const cliRes = await transaction.request()
                    .input('CID', sql.Int, clienteId || 2089)
                    .query("SELECT Nombre, IDCliente FROM Clientes WHERE CliIdCliente = @CID");
                const c = cliRes.recordset[0];
                if (c) clienteNombre = (c.IDCliente && c.IDCliente.trim()) ? c.IDCliente.trim() : (c.Nombre || clienteNombre);
            } catch (eCli) { /* fallback al nombre por defecto */ }

            for (const item of items) {
                await transaction.request()
                    .input('Cliente', sql.NVarChar(200), clienteNombre)
                    .input('CliId', sql.Int, clienteId || 2089)
                    .input('Desc', sql.NVarChar(300), item.nombre || 'Producto WMS')
                    .input('Mat', sql.VarChar(255), item.nombre || 'Producto WMS')
                    // CodigoOrden = el código de venta tal cual (es lo que se imprime en
                    // grande en la etiqueta) — sin prefijo PRO-, que solo confundía.
                    .input('Cod', sql.VarChar(50), codigoVenta)
                    .input('Doc', sql.VarChar(50), codigoVenta)
                    .input('Mag', sql.VarChar(50), String(item.cantidad))
                    .input('Prod', sql.Int, item.ProIdProducto || null)
                    .input('Wms', sql.Int, parseInt(item.wms_variante_id) || null)
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CliIdCliente, DescripcionTrabajo, Prioridad,
                            FechaIngreso, FechaEstimadaEntrega, Material, CodigoOrden, NoDocERP,
                            Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                            ProIdProducto, WmsVarianteId, EstadoDependencia
                        )
                        VALUES (
                            'PRO', @Cliente, @CliId, @Desc, 'Normal',
                            GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Cod, @Doc,
                            @Mag, 'DEPOSITO', 'u', 'Pendiente', 'Pendiente',
                            @Prod, @Wms, 'VENTA_DIRECTA'
                        )
                    `);
            }

            await transaction.commit();

            // [WMS] Trazabilidad: primer evento del pedido (creado por el vendedor)
            try {
                const { logEvento } = require('./logisticaWmsController');
                await logEvento(pool, pedidoId, { estado: 'PENDIENTE', usuario: req.user?.usuario });
            } catch (eEv) { /* sin trazabilidad no se corta la venta */ }

            // [WMS] Notificar a la Print Station de pedidos WMS (misma mecánica que el
            // 'retiros:update' de los retiros web): la estación imprime sola la hoja A4
            // del pedido (formato remito, con productos y cantidades).
            const ioInst = req.app?.get('socketio');
            if (ioInst) {
                ioInst.emit('wms:pedido', { type: 'nuevo_pedido', pedidoId, codigoVenta });
                logger.info(`[WMS] 📡 Socket wms:pedido emitido para ${codigoVenta}`);
            }

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

// [WMS] Hoja A4 del pedido de venta, formato calcado del remito de despacho
// (CreateDispatchModal): título REMITO + fecha, banda ORIGEN→DESTINO, QR con el
// código VEN y tabla de productos/cantidades (+ ubicación para el picking).
// Sin verifyToken en la ruta: la carga el iframe de la Print Station
// (/wms-remito-station), igual que el print de etiquetas de producción.
exports.printPedidoRemito = async (req, res) => {
    try {
        const { pedidoId } = req.params;
        const pool = await getPool();
        const result = await pool.request()
            .input('PedidoID', sql.Int, parseInt(pedidoId))
            .query(`
                SELECT
                    p.ID, p.NoDocERP, p.MontoTotal, p.Moneda, p.FechaGeneracion,
                    c.Nombre AS ClienteNombre,
                    ISNULL(NULLIF(LTRIM(RTRIM(c.IDCliente)), ''), c.Nombre) AS IDCliente,
                    d.Cantidad,
                    a.Descripcion AS nombre_producto,
                    awv.nombre_variante, awv.sku,
                    loc.pasillo, loc.estante
                FROM PedidosCobranza p
                LEFT JOIN Clientes c ON p.ClienteID = c.CliIdCliente
                INNER JOIN PedidosCobranzaDetalle d ON p.ID = d.PedidoCobranzaID
                LEFT JOIN Articulos a ON d.ProIdProducto = a.ProIdProducto
                LEFT JOIN Articulos_WMS_Variantes awv ON CAST(awv.wms_variante_id AS VARCHAR(100)) = CAST(d.CodArticulo AS VARCHAR(100))
                LEFT JOIN Articulos_UbicacionLocal loc ON a.ProIdProducto = loc.Idproid
                WHERE p.ID = @PedidoID AND p.NoDocERP LIKE 'VEN-%'
                ORDER BY d.OrdenID ASC
            `);

        if (result.recordset.length === 0) {
            return res.send('<h1>Pedido no encontrado</h1>');
        }

        const cab = result.recordset[0];
        const codigo = (cab.NoDocERP || '').trim();
        const cliente = cab.ClienteNombre || 'Consumidor Final';
        const fecha = new Date(cab.FechaGeneracion).toLocaleDateString('es-UY');
        const items = result.recordset.map(r => ({
            nombre: r.nombre_variante
                ? `${(r.nombre_producto || '').trim()} - ${r.nombre_variante}`
                : ((r.nombre_producto || '').trim() || 'Artículo'),
            sku: r.sku || '',
            cantidad: Number(r.Cantidad) || 0,
            ubicacion: [r.pasillo, r.estante].filter(Boolean).join(' / ')
        }));
        const totalUnidades = items.reduce((s, it) => s + it.cantidad, 0);

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Remito ${codigo}</title>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
                <style>
                    @page { size: A4; margin: 15mm; }
                    body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; background: #fff; color: #111; }
                    .sheet { max-width: 180mm; margin: 0 auto; border: 3px dashed #222; border-radius: 12px; padding: 24px; box-sizing: border-box; }
                    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #111; padding-bottom: 14px; margin-bottom: 20px; }
                    .head h1 { margin: 0; font-size: 42px; font-weight: 900; text-transform: uppercase; letter-spacing: -1px; }
                    .head .sub { font-size: 13px; font-weight: 800; color: #555; text-transform: uppercase; letter-spacing: 2px; }
                    .fecha-label { font-size: 11px; font-weight: 800; color: #888; text-align: right; }
                    .fecha-val { font-family: monospace; font-size: 16px; font-weight: 800; text-align: right; }
                    .band { display: flex; justify-content: space-between; align-items: center; background: #f0f0f0; padding: 12px 18px; border-radius: 8px; margin-bottom: 20px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .band .lbl { font-size: 10px; font-weight: 800; color: #999; text-transform: uppercase; letter-spacing: 1px; }
                    .band .val { font-size: 20px; font-weight: 900; }
                    .band .arrow { font-size: 24px; color: #bbb; }
                    .qr-zone { text-align: center; margin-bottom: 10px; }
                    #qr { display: inline-block; }
                    .codigo { text-align: center; font-family: monospace; font-size: 30px; font-weight: 900; letter-spacing: 6px; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 12px 0; margin: 14px 0 22px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; border-bottom: 2px solid #111; padding: 6px 8px; }
                    th.center, td.center { text-align: center; }
                    td { font-size: 15px; font-weight: 700; border-bottom: 1px solid #ddd; padding: 8px; }
                    td.cant { font-size: 20px; font-weight: 900; }
                    td.sku { font-family: monospace; font-size: 12px; color: #555; }
                    .resumen { text-align: right; font-size: 14px; font-weight: 800; color: #555; }
                    @media print { .no-print { display: none !important; } .sheet { border: 3px solid #000; } }
                </style>
            </head>
            <body>
                <div class="no-print" style="position: sticky; top: 0; z-index: 100; padding: 12px; text-align: center; background: #333; color: white; display: flex; justify-content: center; align-items: center; gap: 20px; margin-bottom: 16px;">
                    <strong>Remito de Pedido WMS ${codigo}</strong>
                    <button onclick="window.print()" style="padding: 8px 22px; font-size: 15px; cursor: pointer; background: #4f46e5; color: white; border: none; border-radius: 6px; font-weight: bold;">🖨️ IMPRIMIR</button>
                </div>

                <div class="sheet">
                    <div class="head">
                        <div>
                            <h1>REMITO</h1>
                            <div class="sub">Pedido de venta WMS</div>
                        </div>
                        <div>
                            <div class="fecha-label">FECHA</div>
                            <div class="fecha-val">${fecha}</div>
                        </div>
                    </div>

                    <div class="band">
                        <div>
                            <div class="lbl">ORIGEN</div>
                            <div class="val">DEPÓSITO WMS</div>
                        </div>
                        <div class="arrow">&#10132;</div>
                        <div style="text-align: right;">
                            <div class="lbl">CLIENTE</div>
                            <div class="val">${cliente}</div>
                        </div>
                    </div>

                    <div class="qr-zone"><div id="qr"></div></div>
                    <div class="codigo">${codigo}</div>

                    <table>
                        <tr>
                            <th class="center" style="width: 12%;">CANT</th>
                            <th>PRODUCTO</th>
                            <th style="width: 18%;">SKU</th>
                            <th style="width: 18%;">UBICACIÓN</th>
                        </tr>
                        ${items.map(it => `
                        <tr>
                            <td class="cant center">${it.cantidad}</td>
                            <td>${it.nombre}</td>
                            <td class="sku">${it.sku}</td>
                            <td class="center">${it.ubicacion || '-'}</td>
                        </tr>`).join('')}
                    </table>

                    <div class="resumen">${items.length} artículo(s) &nbsp;|&nbsp; ${totalUnidades} unidad(es) en total</div>
                </div>

                <script>
                    new QRCode(document.getElementById("qr"), {
                        text: "${codigo}",
                        width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M
                    });
                </script>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        logger.error('Error en printPedidoRemito:', err);
        res.status(500).send('Error generando el remito del pedido');
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
