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
        const [vars, fotos, stockMap, cotiz] = await Promise.all([
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
        ]);

        const varsPorProd = {};
        vars.recordset.forEach(v => { (varsPorProd[v.Idproid] = varsPorProd[v.Idproid] || []).push(v); });
        const fotosPorProd = {};
        fotos.recordset.forEach(f => { (fotosPorProd[f.Idproid] = fotosPorProd[f.Idproid] || []).push(f.url_imagen); });

        const data = prods.recordset.map(p => {
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
                stockTotal: stockMap ? variantes.reduce((s, v) => s + (v.stock || 0), 0) : null,
            };
        });

        const cotizacionDolar = cotiz.recordset.length ? (parseFloat(cotiz.recordset[0].Valor) || null) : null;
        res.json({ success: true, data, cotizacionDolar });
    } catch (err) {
        logger.error('[Tienda] getTiendaCatalogo: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};
