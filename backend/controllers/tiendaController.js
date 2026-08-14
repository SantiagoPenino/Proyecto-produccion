const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// [TIENDA] E-commerce del portal de clientes — F0: modelo de publicación + catálogo.
// Plan: docs/ecommerce-portal-plan.md. La tabla TiendaProductos decide QUÉ artículos se ven
// en la vitrina y cómo (título/descripción de venta, categoría, solapa). Los datos duros
// (precio, variantes, stock, fotos) salen de las MISMAS tablas del catálogo interno WMS
// (wmsController) — acá solo se filtra lo publicado y se recorta lo que un cliente no puede
// ver: ubicación de picking, sync del catálogo y edición de precios quedan en /api/wms.

let schemaListo = false;
async function ensureTiendaSchema(pool) {
    if (schemaListo) return;
    await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TiendaProductos')
        CREATE TABLE dbo.TiendaProductos (
            ProIdProducto    INT           NOT NULL PRIMARY KEY,   -- FK lógica a Articulos
            Publicado        BIT           NOT NULL CONSTRAINT DF_Tienda_Publicado DEFAULT 0,
            -- Solapa de la vitrina. TERMINADO va al carrito (precio cerrado); PERSONALIZADO y
            -- CONFECCIONADO no se pueden cotizar al momento: su ficha inicia un pedido normal.
            TipoVitrina      VARCHAR(20)   NOT NULL CONSTRAINT DF_Tienda_Tipo DEFAULT 'TERMINADO',
            TituloVenta      NVARCHAR(200) NULL,      -- si falta, se muestra Articulos.Descripcion
            DescripcionVenta NVARCHAR(MAX) NULL,
            CategoriaVitrina NVARCHAR(100) NULL,
            Orden            INT           NOT NULL CONSTRAINT DF_Tienda_Orden DEFAULT 0,
            -- Sin uso hoy (todo se paga al retirar). Existe desde el día 1 para que el cobro
            -- online futuro sea prender un flag y no una migración.
            PagoOnline       BIT           NOT NULL CONSTRAINT DF_Tienda_PagoOnline DEFAULT 0,
            FechaAlta        DATETIME      NOT NULL CONSTRAINT DF_Tienda_FechaAlta DEFAULT GETDATE()
        );
    `);
    schemaListo = true;
}

// Stock vivo del WMS por variante — mismo origen y filtros que el catálogo interno
// (wmsController.getCatalog). Best-effort A PROPÓSITO: la tienda vende también sin stock,
// así que si el WMS no contesta el catálogo sale igual, con stock null (= "sin dato").
async function fetchStockWms() {
    try {
        const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
        const depositoId = parseInt(process.env.WMS_DEPOSITO_LOCAL_ID, 10) || 5; // depósito de Ventas
        const wmsQuery = `
            USE Ventas_Dev;
            SELECT variante_id, ISNULL(SUM(cantidad_actual), 0) as total_stock
            FROM Stock_Etiquetas
            WHERE estado = 'activo' AND cantidad_actual > 0 AND deposito_id = ${depositoId}
            GROUP BY variante_id
        `;
        const response = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: wmsQuery })
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data.success || !data.data) return null;
        const map = {};
        data.data.forEach(r => { map[r.variante_id] = r.total_stock; });
        return map;
    } catch (e) {
        logger.warn(`[Tienda] stock WMS no disponible: ${e.message}`);
        return null;
    }
}

// GET /api/web-orders/tienda/catalogo — vitrina del portal (solo publicados).
// Read-only, token del portal. Devuelve además la cotización del dólar para que el front
// pueda mostrar totales mixtos UYU/USD sin pegarle a las rutas internas de /api/wms.
exports.getTiendaCatalogo = async (req, res) => {
    try {
        const pool = await getPool();
        await ensureTiendaSchema(pool);

        // 1. Productos publicados + precio base. Mismos filtros de higiene que
        //    /prendas-orders/productos-terminados (borrar/Mostrar).
        const prods = await pool.request().query(`
            SELECT tp.ProIdProducto, tp.TipoVitrina, tp.TituloVenta, tp.DescripcionVenta,
                   tp.CategoriaVitrina, tp.Orden, tp.PagoOnline,
                   LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                   LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo,
                   pb.Precio, pb.Moneda
            FROM dbo.TiendaProductos tp
            INNER JOIN dbo.Articulos a ON a.ProIdProducto = tp.ProIdProducto
            LEFT JOIN dbo.PreciosBase pb ON pb.ProIdProducto = tp.ProIdProducto
            WHERE tp.Publicado = 1
              AND ISNULL(a.borrar, 0) = 0
              AND ISNULL(a.Mostrar, 1) = 1
            ORDER BY tp.Orden ASC, Descripcion ASC
        `);
        if (!prods.recordset.length) return res.json({ success: true, data: [], cotizacionDolar: null });

        // 2. Variantes (talle/color) y fotos de los publicados, en consultas aparte para no
        //    multiplicar filas (variantes × imágenes) en un solo JOIN.
        const [vars, fotos, stockMap, cotiz, combos] = await Promise.all([
            pool.request().query(`
                SELECT v.Idproid, v.wms_variante_id, v.sku, v.nombre_variante,
                       v.precio_excepcion, v.moneda_excepcion
                FROM dbo.Articulos_WMS_Variantes v
                INNER JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = v.Idproid AND tp.Publicado = 1
            `),
            // Todas las imágenes ordenadas: orden=1 (la miniatura interna) sirve de portada,
            // orden>1 es la galería que carga el admin de la tienda (F4).
            pool.request().query(`
                SELECT img.Idproid, img.url_imagen, img.orden
                FROM dbo.Articulos_Imagenes img
                INNER JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = img.Idproid AND tp.Publicado = 1
                ORDER BY img.Idproid, img.orden
            `),
            fetchStockWms(),
            pool.request().query('SELECT TOP 1 CotDolar AS Valor FROM dbo.Cotizaciones ORDER BY CotFecha DESC'),
            // [COMBOS] Composición de los publicados (ProductoComboItems, la carga el
            // configurador). Con .catch: si la tabla no existe todavía (prod sin migrar
            // el configurador), el catálogo sale igual y nada se trata como combo.
            pool.request().query(`
                SELECT pci.ProIdProducto, pci.WmsVarianteId, pci.Cantidad
                FROM dbo.ProductoComboItems pci
                INNER JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = pci.ProIdProducto AND tp.Publicado = 1
            `).catch(() => ({ recordset: [] })),
        ]);

        const varsPorProd = {};
        vars.recordset.forEach(v => { (varsPorProd[v.Idproid] = varsPorProd[v.Idproid] || []).push(v); });
        const fotosPorProd = {};
        fotos.recordset.forEach(f => { (fotosPorProd[f.Idproid] = fotosPorProd[f.Idproid] || []).push(f.url_imagen); });
        const combosPorProd = {};
        combos.recordset.forEach(c => { (combosPorProd[c.ProIdProducto] = combosPorProd[c.ProIdProducto] || []).push(c); });

        const data = prods.recordset.map(p => {
            // [COMBOS] Stock del combo = cuántos se pueden ARMAR con el stock de sus
            // componentes: min(stock componente ÷ cantidad por combo). Regla de negocio
            // (12/08): si ALGÚN componente está en 0, el combo NO se muestra en el portal
            // — excepción puntual a "se vende sin stock", que sigue valiendo para los
            // artículos comunes. Si el WMS no contesta (stockMap null) no hay dato para
            // afirmar que falte stock: el combo se muestra con stock "sin dato".
            const comps = combosPorProd[p.ProIdProducto] || null;
            let stockCombo = null;
            if (comps && stockMap) {
                stockCombo = Math.min(...comps.map(c =>
                    Math.floor((stockMap[c.WmsVarianteId] || 0) / (parseInt(c.Cantidad, 10) || 1))
                ));
                if (stockCombo <= 0) return null; // componente sin stock → combo invisible
            }

            const precioBase = p.Precio != null ? parseFloat(p.Precio) : null;
            const monedaBase = (p.Moneda || 'UYU').trim();
            const variantes = (varsPorProd[p.ProIdProducto] || []).map(v => ({
                wmsVarianteId: v.wms_variante_id,
                sku: v.sku || '',
                nombre: v.nombre_variante || 'Única',
                // Excepción por variante si existe; si no, el precio base del artículo.
                precio: v.precio_excepcion != null ? parseFloat(v.precio_excepcion) : precioBase,
                moneda: v.moneda_excepcion === 2 ? 'USD' : (v.moneda_excepcion === 1 ? 'UYU' : monedaBase),
                // null = WMS sin dato (no bloquea nada: se vende también sin stock)
                stock: stockMap ? (stockMap[v.wms_variante_id] || 0) : null,
            }));
            return {
                proIdProducto: p.ProIdProducto,
                codArticulo: p.CodArticulo,
                tipo: (p.TipoVitrina || 'TERMINADO').trim().toUpperCase(),
                titulo: (p.TituloVenta || '').trim() || p.Descripcion,
                descripcion: p.DescripcionVenta || null,
                categoria: p.CategoriaVitrina || null,
                orden: p.Orden || 0,
                pagoOnline: !!p.PagoOnline,
                precio: precioBase,
                moneda: monedaBase,
                fotos: fotosPorProd[p.ProIdProducto] || [],
                variantes,
                esCombo: !!comps,
                // Combos: stock armable (min de componentes); comunes: suma de variantes.
                stockTotal: comps ? stockCombo : (stockMap ? variantes.reduce((s, v) => s + (v.stock || 0), 0) : null),
            };
        }).filter(Boolean);

        const cotizacionDolar = cotiz.recordset.length ? (parseFloat(cotiz.recordset[0].Valor) || null) : null;
        res.json({ success: true, data, cotizacionDolar });
    } catch (err) {
        logger.error('[Tienda] getTiendaCatalogo: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// POST /api/web-orders/tienda/checkout — F2: compra de TERMINADOS del carrito.
// Misma lógica VEN- que wmsController.createOrder (PedidosCobranza + detalle + ancla PRO
// 'VENTA_DIRECTA' + remito en la Print Station), con tres diferencias de cara al cliente:
//   1. El cliente sale SIEMPRE del token (o de la impersonación de diseñador ya validada);
//      el body no puede elegirlo.
//   2. El precio NO se toma del body: se recalcula acá desde PreciosBase/precio_excepcion
//      y solo para productos publicados como TERMINADO en TiendaProductos.
//   3. Lleva forma de envío (Retiro en el Local / Encomienda) → Ordenes.ModoRetiro del ancla.
// Sin gate de stock a propósito (definición de negocio: se vende también sin stock) y
// EstadoCobro='PENDIENTE' → cae solo en Pagos Pendientes/caja, se paga al retirar.
exports.checkoutTienda = async (req, res) => {
    try {
        const { items, formaEnvioId } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'El carrito está vacío.' });
        }

        // ── Cliente del token ────────────────────────────────────────────────
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(403).json({ error: 'Sesión sin cliente asociado.' });

        const pool = await getPool();
        await ensureTiendaSchema(pool);

        const cliRes = await pool.request()
            .input('cod', sql.Int, codCliente)
            .query('SELECT CliIdCliente, IDCliente, Nombre, ESTADO FROM Clientes WHERE CodCliente = @cod');
        if (!cliRes.recordset.length) return res.status(404).json({ error: 'Cliente no encontrado.' });
        const cliente = cliRes.recordset[0];
        if (cliente.ESTADO === 'BLOQUEADO') {
            return res.status(403).json({
                error: 'Tu cuenta está bloqueada. Contactá con nosotros para regularizar tu situación.',
                blocked: true
            });
        }
        const cliIdCliente = cliente.CliIdCliente;
        const clienteNombre = (cliente.IDCliente && cliente.IDCliente.trim()) ? cliente.IDCliente.trim() : (cliente.Nombre || 'Cliente Web');

        // ── Re-precio server-side (nunca confiar en el precio del front) ─────
        // Solo publicados TERMINADO: PERSONALIZADO/CONFECCIONADO no tienen precio cerrado
        // y jamás pueden entrar por acá.
        const publicados = await pool.request().query(`
            SELECT tp.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                   pb.Precio AS PrecioBase, pb.Moneda AS MonedaBase
            FROM dbo.TiendaProductos tp
            INNER JOIN dbo.Articulos a ON a.ProIdProducto = tp.ProIdProducto
            LEFT JOIN dbo.PreciosBase pb ON pb.ProIdProducto = tp.ProIdProducto
            WHERE tp.Publicado = 1
              AND UPPER(LTRIM(RTRIM(tp.TipoVitrina))) = 'TERMINADO'
              AND ISNULL(a.borrar, 0) = 0
              AND ISNULL(a.Mostrar, 1) = 1
        `);
        const prodPorId = {};
        publicados.recordset.forEach(p => { prodPorId[p.ProIdProducto] = p; });

        const variantesRes = await pool.request().query(`
            SELECT v.Idproid, v.wms_variante_id, v.nombre_variante, v.precio_excepcion, v.moneda_excepcion
            FROM dbo.Articulos_WMS_Variantes v
            INNER JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = v.Idproid AND tp.Publicado = 1
        `);
        const varPorKey = {};
        variantesRes.recordset.forEach(v => { varPorKey[`${v.Idproid}:${v.wms_variante_id}`] = v; });

        const lineas = [];
        for (const it of items) {
            const proId = parseInt(it.proIdProducto, 10);
            const wmsVarId = parseInt(it.wmsVarianteId, 10);
            const cantidad = parseInt(it.cantidad, 10);
            const prod = prodPorId[proId];
            if (!prod) return res.status(400).json({ error: 'Uno de los productos del carrito ya no está disponible en la tienda. Vaciá el carrito y volvé a armarlo.' });
            if (!cantidad || cantidad < 1 || cantidad > 9999) return res.status(400).json({ error: `Cantidad inválida para ${prod.Descripcion}.` });

            // Variante mapeada al WMS si existe; sin mapeo vale el fallback "Única"
            // (wms_variante_id = ProIdProducto), igual que el catálogo.
            const variante = varPorKey[`${proId}:${wmsVarId}`] || null;
            if (!variante && wmsVarId !== proId) {
                return res.status(400).json({ error: `La variante elegida de ${prod.Descripcion} ya no existe. Quitala del carrito y elegila de nuevo.` });
            }
            const precio = (variante && variante.precio_excepcion != null)
                ? parseFloat(variante.precio_excepcion)
                : (prod.PrecioBase != null ? parseFloat(prod.PrecioBase) : null);
            const moneda = (variante && variante.moneda_excepcion === 2) ? 'USD'
                : (variante && variante.moneda_excepcion === 1) ? 'UYU'
                : ((prod.MonedaBase || 'UYU').trim() || 'UYU');
            if (precio == null) return res.status(400).json({ error: `${prod.Descripcion} no tiene precio cargado — consultanos por soporte.` });

            lineas.push({
                proIdProducto: proId,
                wmsVarianteId: wmsVarId,
                descripcion: prod.Descripcion,
                varianteNombre: variante?.nombre_variante || 'Única',
                cantidad,
                precioOriginal: precio,
                monedaOriginal: moneda === 'USD' ? 'USD' : 'UYU',
            });
        }

        // ── Moneda del pedido: misma regla que el carrito interno del WMS ────
        // (WmsOrderPage): si ALGÚN ítem es USD, el pedido entero va en USD y los ítems en
        // pesos se convierten con la cotización vigente; si no, todo en UYU.
        const monedaPedido = lineas.some(l => l.monedaOriginal === 'USD') ? 'USD' : 'UYU';
        let cotizacion = null;
        if (lineas.some(l => l.monedaOriginal !== monedaPedido)) {
            const cotRes = await pool.request().query('SELECT TOP 1 CotDolar AS Valor FROM dbo.Cotizaciones ORDER BY CotFecha DESC');
            cotizacion = cotRes.recordset.length ? parseFloat(cotRes.recordset[0].Valor) : null;
            if (!cotizacion || cotizacion <= 0) {
                return res.status(500).json({ error: 'No hay cotización del dólar cargada para combinar monedas. Probá de nuevo más tarde.' });
            }
        }
        lineas.forEach(l => {
            l.precio = l.monedaOriginal === monedaPedido ? l.precioOriginal
                : (monedaPedido === 'USD' ? l.precioOriginal / cotizacion : l.precioOriginal * cotizacion);
            l.precio = Math.round(l.precio * 100) / 100;
        });
        const total = Math.round(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0) * 100) / 100;

        // ── Forma de envío (patrón ECOUV): FormasEnvio → Ordenes.ModoRetiro ──
        let modoRetiro = null;
        if (formaEnvioId) {
            try {
                const feRes = await pool.request()
                    .input('FE', sql.Int, parseInt(formaEnvioId, 10))
                    .query('SELECT Nombre FROM FormasEnvio WHERE ID = @FE');
                modoRetiro = (feRes.recordset[0]?.Nombre || '').trim() || null;
            } catch (eFE) { logger.warn('[Tienda] No se pudo resolver la forma de envío: ' + eFE.message); }
        }

        // ── VEN- + cabecera + detalle + ancla, transaccional (calco de createOrder) ──
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        let pedidoId, codigoVenta;
        try {
            const maxResult = await transaction.request().query(`
                SELECT ISNULL(MAX(CAST(SUBSTRING(NoDocERP, 5, LEN(NoDocERP)) AS INT)), 0) + 1 as NextID
                FROM PedidosCobranza
                WHERE NoDocERP LIKE 'VEN-%'
            `);
            codigoVenta = `VEN-${maxResult.recordset[0].NextID.toString().padStart(4, '0')}`;

            const insertHeader = await transaction.request()
                .input('NoDocERP', sql.NVarChar, codigoVenta)
                .input('ClienteID', sql.Int, cliIdCliente)
                .input('MontoTotal', sql.Decimal(18, 2), total)
                .input('Moneda', sql.VarChar, monedaPedido)
                .input('EstadoCobro', sql.NVarChar, 'PENDIENTE')
                .query(`
                    INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, EstadoCobro)
                    OUTPUT INSERTED.ID
                    VALUES (@NoDocERP, @ClienteID, @MontoTotal, @Moneda, GETDATE(), @EstadoCobro)
                `);
            pedidoId = insertHeader.recordset[0].ID;

            let ordenIndex = 1;
            for (const l of lineas) {
                await transaction.request()
                    .input('PedidoCobranzaID', sql.Int, pedidoId)
                    .input('OrdenID', sql.Int, ordenIndex)
                    .input('ProIdProducto', sql.Int, l.proIdProducto)
                    .input('CodArticulo', sql.NVarChar, l.wmsVarianteId.toString())
                    .input('Cantidad', sql.Decimal(18, 2), l.cantidad)
                    .input('PrecioUnitario', sql.Decimal(18, 2), l.precio)
                    .input('Subtotal', sql.Decimal(18, 2), Math.round(l.precio * l.cantidad * 100) / 100)
                    .input('Moneda', sql.VarChar, monedaPedido)
                    .input('PrecioUnitarioOriginal', sql.Decimal(18, 2), l.precioOriginal)
                    .input('SubtotalOriginal', sql.Decimal(18, 2), Math.round(l.precioOriginal * l.cantidad * 100) / 100)
                    .input('MonedaOriginal', sql.VarChar, l.monedaOriginal)
                    .query(`
                        INSERT INTO PedidosCobranzaDetalle
                        (PedidoCobranzaID, OrdenID, ProIdProducto, CodArticulo, Cantidad, PrecioUnitario, Subtotal, Moneda, DatoTecnico, PrecioUnitarioOriginal, SubtotalOriginal, MonedaOriginal)
                        VALUES
                        (@PedidoCobranzaID, @OrdenID, @ProIdProducto, @CodArticulo, @Cantidad, @PrecioUnitario, @Subtotal, @Moneda, 0, @PrecioUnitarioOriginal, @SubtotalOriginal, @MonedaOriginal)
                    `);
                ordenIndex++;
            }

            // Ancla de etiqueta en PRO (VENTA_DIRECTA): UNA por pedido, no es trabajo de
            // producción — existe para el bulto/etiqueta con destino Depósito. ModoRetiro
            // lleva la forma de envío elegida (misma columna que muestran los detalles).
            const totalUnidades = lineas.reduce((s, l) => s + l.cantidad, 0);
            await transaction.request()
                .input('Cliente', sql.NVarChar(200), clienteNombre)
                .input('CliId', sql.Int, cliIdCliente)
                .input('Desc', sql.NVarChar(300), `VENTA TIENDA WEB (${lineas.length} artículo(s), ${totalUnidades} unidad(es))`)
                .input('Mat', sql.VarChar(255), 'VENTA WMS')
                .input('Cod', sql.VarChar(50), codigoVenta)
                .input('Doc', sql.VarChar(50), codigoVenta)
                .input('Mag', sql.VarChar(50), String(totalUnidades))
                .input('Prod', sql.Int, lineas.length === 1 ? lineas[0].proIdProducto : null)
                .input('Wms', sql.Int, lineas.length === 1 ? lineas[0].wmsVarianteId : null)
                .input('Modo', sql.NVarChar(100), modoRetiro)
                .query(`
                    INSERT INTO Ordenes (
                        AreaID, Cliente, CliIdCliente, DescripcionTrabajo, Prioridad,
                        FechaIngreso, FechaEstimadaEntrega, Material, CodigoOrden, NoDocERP,
                        Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                        ProIdProducto, WmsVarianteId, EstadoDependencia, ModoRetiro
                    )
                    VALUES (
                        'PRO', @Cliente, @CliId, @Desc, 'Normal',
                        GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Cod, @Doc,
                        @Mag, 'DEPOSITO', 'u', 'Pendiente', 'Pendiente',
                        @Prod, @Wms, 'VENTA_DIRECTA', @Modo
                    )
                `);

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }

        // Trazabilidad + remito automático en la Print Station — best-effort, la venta ya está.
        try {
            const { logEvento } = require('./logisticaWmsController');
            await logEvento(pool, pedidoId, {
                estado: 'PENDIENTE',
                nota: `Compra desde la tienda del portal${modoRetiro ? ` — Envío: ${modoRetiro}` : ''}`,
                usuario: clienteNombre
            });
        } catch (eEv) { /* sin trazabilidad no se corta la venta */ }
        const ioInst = req.app?.get('socketio');
        if (ioInst) {
            ioInst.emit('wms:pedido', { type: 'nuevo_pedido', pedidoId, codigoVenta });
            logger.info(`[Tienda] 📡 Socket wms:pedido emitido para ${codigoVenta}`);
        }

        logger.info(`[Tienda] 🛒 ${codigoVenta} — cliente ${clienteNombre} (CodCliente ${codCliente}), ${lineas.length} línea(s), ${monedaPedido} ${total}`);
        res.json({ success: true, pedidoId, codigoVenta, total, moneda: monedaPedido, modoRetiro });
    } catch (err) {
        logger.error('[Tienda] checkoutTienda: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};
