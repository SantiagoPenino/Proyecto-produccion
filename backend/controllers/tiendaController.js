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
        -- [IMÁGENES POR COLOR] NULL = principal/galería; con valor ("ROJO"), la ficha de la
        -- tienda muestra esa foto cuando el nombre de la variante elegida contiene ese texto.
        IF COL_LENGTH('dbo.Articulos_Imagenes', 'color') IS NULL
            ALTER TABLE dbo.Articulos_Imagenes ADD color VARCHAR(50) NULL;
        -- [VARIANTES 21/08] Talle/Color como DATOS de la variante (largo plazo: la ficha deja
        -- de adivinar sobre nombres). NULL = sin ese eje (talle único / sin color). Los llena
        -- el auto-parse (utils/variantesEjes) y marketing corrige en /marketing/productos.
        IF COL_LENGTH('dbo.Articulos_WMS_Variantes', 'Talle') IS NULL
            ALTER TABLE dbo.Articulos_WMS_Variantes ADD Talle VARCHAR(20) NULL;
        IF COL_LENGTH('dbo.Articulos_WMS_Variantes', 'Color') IS NULL
            ALTER TABLE dbo.Articulos_WMS_Variantes ADD Color VARCHAR(80) NULL;
        -- [LISTAS DE PRECIOS 26/08] Visibilidad por producto en las dos listas de precios:
        -- EnListaPrecios = la del portal (clientes con cuenta, PricesView) · EnListaPublica =
        -- la de la landing para leads (PreciosListModal). Viven en ARTICULOS (26/08, antes en
        -- TiendaProductos): mostrar el precio en la lista es propiedad del PRODUCTO y no tiene
        -- que ver con estar o no en la tienda. DEFAULT 1 = visible (comportamiento histórico).
        -- Al crear la columna se migra UNA vez lo apagado desde TiendaProductos (EXEC: la
        -- columna recién agregada no puede referenciarse en el mismo batch). Las columnas
        -- viejas de TiendaProductos quedan huérfanas — ya nadie las lee ni escribe.
        IF COL_LENGTH('dbo.Articulos', 'EnListaPrecios') IS NULL
        BEGIN
            ALTER TABLE dbo.Articulos ADD EnListaPrecios BIT NOT NULL CONSTRAINT DF_Articulos_EnListaPrecios DEFAULT 1;
            IF COL_LENGTH('dbo.TiendaProductos', 'EnListaPrecios') IS NOT NULL
                EXEC('UPDATE a SET a.EnListaPrecios = 0 FROM dbo.Articulos a JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = a.ProIdProducto WHERE tp.EnListaPrecios = 0');
        END
        IF COL_LENGTH('dbo.Articulos', 'EnListaPublica') IS NULL
        BEGIN
            ALTER TABLE dbo.Articulos ADD EnListaPublica BIT NOT NULL CONSTRAINT DF_Articulos_EnListaPublica DEFAULT 1;
            IF COL_LENGTH('dbo.TiendaProductos', 'EnListaPublica') IS NOT NULL
                EXEC('UPDATE a SET a.EnListaPublica = 0 FROM dbo.Articulos a JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = a.ProIdProducto WHERE tp.EnListaPublica = 0');
        END
        -- [DESCRIPCIÓN DE LISTA 27/08] Texto que acompaña al producto en las DOS listas de
        -- precios (columna "Descripción" del portal y de la landing, que hasta ahora mostraban
        -- un guion). Propiedad del PRODUCTO, igual criterio que los flags de arriba: se edita
        -- en /marketing/precios y no depende de que el artículo esté en la tienda.
        IF COL_LENGTH('dbo.Articulos', 'DescripcionLista') IS NULL
            ALTER TABLE dbo.Articulos ADD DescripcionLista NVARCHAR(500) NULL;
        -- [MARCA TIENDA 18/08] Origen='TIENDA' + ModoRetiro normalizado ('RETIRO'/'ENCOMIENDA')
        -- en la cabecera del VEN: de dónde vino la venta y cómo se entrega (el remito A4
        -- imprime el banner ENCOMIENDA). Mostrador queda con NULL en ambas. NO afecta a la
        -- preparación: desde el 21/08 los pedidos de tienda se preparan como cualquier VEN.
        IF COL_LENGTH('dbo.PedidosCobranza', 'Origen') IS NULL
            ALTER TABLE dbo.PedidosCobranza ADD Origen VARCHAR(20) NULL;
        IF COL_LENGTH('dbo.PedidosCobranza', 'ModoRetiro') IS NULL
            ALTER TABLE dbo.PedidosCobranza ADD ModoRetiro VARCHAR(20) NULL;
        -- [PAGO ONLINE 21/08] La VERDAD de "pagado online" (EstadoCobro es estado de
        -- pipeline, no sirve de marcador de pago). Las estampa el webhook al confirmarse.
        IF COL_LENGTH('dbo.PedidosCobranza', 'FechaPagoOnline') IS NULL
            ALTER TABLE dbo.PedidosCobranza ADD FechaPagoOnline DATETIME NULL;
        IF COL_LENGTH('dbo.PedidosCobranza', 'PagoOnlineRef') IS NULL
            ALTER TABLE dbo.PedidosCobranza ADD PagoOnlineRef VARCHAR(100) NULL;
        IF COL_LENGTH('dbo.PedidosCobranza', 'MetodoPagoOnline') IS NULL
            ALTER TABLE dbo.PedidosCobranza ADD MetodoPagoOnline VARCHAR(20) NULL;
    `);
    schemaListo = true;
}
// Para que otros consumidores del schema (ej. /api/precios-publicos en server.js) puedan
// garantizarlo antes de filtrar por las columnas nuevas.
exports.ensureTiendaSchema = ensureTiendaSchema;

// Stock vivo del WMS por variante — mismo origen y filtros que el catálogo interno
// (wmsController.getCatalog). Best-effort A PROPÓSITO: la tienda vende también sin stock,
// así que si el WMS no contesta el catálogo sale igual, con stock null (= "sin dato").
async function fetchStockWms() {
    // [CUTOVER WMS PROPIO] WMS_INTERNO=true → el stock sale de NUESTRAS tablas (un JOIN local,
    // sin salir a internet). Apagado, sigue el fetch al proxy externo de siempre.
    if (String(process.env.WMS_INTERNO || '').toLowerCase() === 'true') {
        try {
            return await require('../services/wmsInternoService').getStockPorVariante();
        } catch (e) {
            logger.warn(`[Tienda] stock interno no disponible: ${e.message}`);
            return null;
        }
    }
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

// ── [MARKETING 21/08] Admin de la vitrina ───────────────────────────────────
// GET /api/products-integration/vitrina — lista para la pantalla de marketing
// (/marketing/productos): artículos vendibles (ya publicados o con vínculo WMS) con su
// estado de publicación, portada, precio base y datos de venta. Solo lo que marketing
// administra — los vínculos ERP/WMS siguen en /admin/products-integration.
exports.getVitrinaAdmin = async (req, res) => {
    try {
        const pool = await getPool();
        await ensureTiendaSchema(pool);
        const result = await pool.request().query(`
            SELECT a.ProIdProducto,
                   LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo,
                   LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                   ISNULL(tp.Publicado, 0)     AS Publicado,
                   tp.TipoVitrina, tp.TituloVenta, tp.DescripcionVenta,
                   tp.CategoriaVitrina, ISNULL(tp.Orden, 0) AS Orden, ISNULL(tp.PagoOnline, 0) AS PagoOnline,
                   ISNULL(a.EnListaPrecios, 1) AS EnListaPrecios,
                   ISNULL(a.EnListaPublica, 1) AS EnListaPublica,
                   pb.Precio, pb.Moneda,
                   img.url_imagen AS Portada,
                   ISNULL(vc.CantidadVariantes, 0) AS CantidadVariantes
            FROM dbo.Articulos a
            LEFT JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = a.ProIdProducto
            LEFT JOIN dbo.PreciosBase pb WITH(NOLOCK) ON pb.ProIdProducto = a.ProIdProducto
            LEFT JOIN dbo.Articulos_Wms wm ON wm.Idproid = a.ProIdProducto
            OUTER APPLY (SELECT TOP 1 i.url_imagen FROM dbo.Articulos_Imagenes i
                         WHERE i.Idproid = a.ProIdProducto AND i.color IS NULL
                         ORDER BY i.orden) img
            LEFT JOIN (SELECT Idproid, COUNT(*) AS CantidadVariantes
                       FROM dbo.Articulos_WMS_Variantes GROUP BY Idproid) vc ON vc.Idproid = a.ProIdProducto
            WHERE ISNULL(a.borrar, 0) = 0
              AND ISNULL(a.Mostrar, 1) = 1
              AND (tp.ProIdProducto IS NOT NULL OR wm.Idproid IS NOT NULL)
            ORDER BY ISNULL(tp.Publicado, 0) DESC, ISNULL(tp.Orden, 0) ASC, Descripcion ASC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (e) {
        logger.error('Error getVitrinaAdmin:', e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/products-integration/vitrina/:id — upsert de la ficha de venta de UN producto.
// Body: { Publicado, TipoVitrina, TituloVenta, DescripcionVenta, CategoriaVitrina, Orden }.
// El precio NO se toca acá (vive en PreciosBase y se edita en /marketing/precios).
exports.saveVitrinaProducto = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Falta ProIdProducto' });
    const {
        Publicado = 0, TipoVitrina = 'TERMINADO', TituloVenta = null,
        DescripcionVenta = null, CategoriaVitrina = null, Orden = 0,
        EnListaPrecios = 1, EnListaPublica = 1
    } = req.body || {};
    const tipo = ['TERMINADO', 'PERSONALIZADO', 'CONFECCIONADO'].includes(String(TipoVitrina).toUpperCase())
        ? String(TipoVitrina).toUpperCase() : 'TERMINADO';
    try {
        const pool = await getPool();
        await ensureTiendaSchema(pool);
        await pool.request()
            .input('Id', sql.Int, id)
            .input('Pub', sql.Bit, Publicado ? 1 : 0)
            .input('Tipo', sql.VarChar(20), tipo)
            .input('Tit', sql.NVarChar(200), (TituloVenta || '').trim().substring(0, 200) || null)
            .input('Desc', sql.NVarChar(sql.MAX), (DescripcionVenta || '').trim() || null)
            .input('Cat', sql.NVarChar(100), (CategoriaVitrina || '').trim().substring(0, 100) || null)
            .input('Ord', sql.Int, parseInt(Orden, 10) || 0)
            .input('LisCli', sql.Bit, EnListaPrecios ? 1 : 0)
            .input('LisPub', sql.Bit, EnListaPublica ? 1 : 0)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.TiendaProductos WHERE ProIdProducto = @Id)
                    UPDATE dbo.TiendaProductos
                    SET Publicado = @Pub, TipoVitrina = @Tipo, TituloVenta = @Tit,
                        DescripcionVenta = @Desc, CategoriaVitrina = @Cat, Orden = @Ord
                    WHERE ProIdProducto = @Id
                ELSE
                    INSERT INTO dbo.TiendaProductos
                        (ProIdProducto, Publicado, TipoVitrina, TituloVenta, DescripcionVenta, CategoriaVitrina, Orden)
                    VALUES (@Id, @Pub, @Tipo, @Tit, @Desc, @Cat, @Ord);

                -- Los flags de listas de precios viven en el PRODUCTO (26/08), no en la vitrina
                UPDATE dbo.Articulos
                SET EnListaPrecios = @LisCli, EnListaPublica = @LisPub
                WHERE ProIdProducto = @Id;
            `);
        res.json({ success: true });
    } catch (e) {
        logger.error('Error saveVitrinaProducto:', e);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/products-integration/vitrina/:id/variantes — variantes de un producto para el
// editor de marketing, con BACKFILL INCREMENTAL de ejes: si ninguna variante del producto
// tiene Talle/Color cargado todavía, se derivan del nombre acá mismo y se persisten. Así
// el catálogo converge producto a producto a medida que marketing los abre, sin scripts.
exports.getVitrinaVariantes = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Falta ProIdProducto' });
    try {
        const pool = await getPool();
        await ensureTiendaSchema(pool);
        const leer = () => pool.request()
            .input('Id', sql.Int, id)
            .query(`
                SELECT id, wms_variante_id, sku, nombre_variante, Talle, Color
                FROM dbo.Articulos_WMS_Variantes
                WHERE Idproid = @Id
                ORDER BY nombre_variante
            `);
        let result = await leer();
        const vars = result.recordset;
        if (vars.length && vars.every(v => v.Talle == null && v.Color == null)) {
            const { derivarEjesProducto } = require('../utils/variantesEjes');
            const derivadas = derivarEjesProducto(vars).filter(v => v.Talle != null || v.Color != null);
            for (const d of derivadas) {
                await pool.request()
                    .input('VId', sql.Int, d.id)
                    .input('Talle', sql.VarChar(20), d.Talle)
                    .input('Color', sql.VarChar(80), d.Color)
                    .query('UPDATE dbo.Articulos_WMS_Variantes SET Talle = @Talle, Color = @Color WHERE id = @VId');
            }
            if (derivadas.length) result = await leer();
        }
        res.json({ success: true, data: result.recordset });
    } catch (e) {
        logger.error('Error getVitrinaVariantes:', e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/products-integration/vitrina/:id/variantes-ejes — corrección manual de Talle/Color
// desde el editor de marketing. Body: { variantes: [{ id, Talle, Color }] }. Vacío = NULL.
exports.saveVitrinaVariantesEjes = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const variantes = Array.isArray(req.body?.variantes) ? req.body.variantes : [];
    if (!id || !variantes.length) return res.status(400).json({ error: 'Faltan variantes' });
    try {
        const pool = await getPool();
        await ensureTiendaSchema(pool);
        for (const v of variantes) {
            const vId = parseInt(v.id, 10);
            if (!vId) continue;
            const talle = String(v.Talle || '').trim().toUpperCase().substring(0, 20) || null;
            const color = String(v.Color || '').trim().toUpperCase().substring(0, 80) || null;
            await pool.request()
                .input('VId', sql.Int, vId)
                .input('Id', sql.Int, id)
                .input('Talle', sql.VarChar(20), talle)
                .input('Color', sql.VarChar(80), color)
                .query('UPDATE dbo.Articulos_WMS_Variantes SET Talle = @Talle, Color = @Color WHERE id = @VId AND Idproid = @Id');
        }
        res.json({ success: true });
    } catch (e) {
        logger.error('Error saveVitrinaVariantesEjes:', e);
        res.status(500).json({ error: e.message });
    }
};

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
                       v.precio_excepcion, v.moneda_excepcion, v.Talle, v.Color
                FROM dbo.Articulos_WMS_Variantes v
                INNER JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = v.Idproid AND tp.Publicado = 1
            `),
            // Todas las imágenes ordenadas: orden=1 (la miniatura interna) sirve de portada,
            // orden>1 es la galería que carga el admin de la tienda (F4), y las de color
            // (color NOT NULL, orden>=101) van aparte en fotosColor.
            pool.request().query(`
                SELECT img.Idproid, img.url_imagen, img.orden, img.color
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
        const fotosColorPorProd = {};
        fotos.recordset.forEach(f => {
            if (f.color) {
                (fotosColorPorProd[f.Idproid] = fotosColorPorProd[f.Idproid] || [])
                    .push({ color: String(f.color).trim().toUpperCase(), url: f.url_imagen });
            } else {
                (fotosPorProd[f.Idproid] = fotosPorProd[f.Idproid] || []).push(f.url_imagen);
            }
        });
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
                // [VARIANTES 21/08] Ejes como datos (ver utils/variantesEjes). NULL = sin ese
                // eje. El front los usa si existen y cae a su heurística de nombres si no.
                talle: v.Talle || null,
                color: v.Color || null,
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
                fotosColor: fotosColorPorProd[p.ProIdProducto] || [],
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

        const { lineas, monedaPedido, total } = await validarCarritoTienda(pool, items);
        const modoRetiro = await resolverModoRetiro(pool, formaEnvioId);

        const { pedidoId, codigoVenta } = await crearVentaTienda(pool, {
            cliIdCliente, clienteNombre, lineas, monedaPedido, total, modoRetiro,
            io: req.app?.get('socketio'),
        });

        logger.info(`[Tienda] 🛒 ${codigoVenta} — cliente ${clienteNombre} (CodCliente ${codCliente}), ${lineas.length} línea(s), ${monedaPedido} ${total}`);
        res.json({ success: true, pedidoId, codigoVenta, total, moneda: monedaPedido, modoRetiro });
    } catch (err) {
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        logger.error('[Tienda] checkoutTienda: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// ── Helpers del checkout (compartidos por el flujo sin pago y el pago online) ────────

// Re-precio server-side (nunca confiar en el precio del front). Solo publicados TERMINADO:
// PERSONALIZADO/CONFECCIONADO no tienen precio cerrado y jamás pueden entrar por acá.
// Lanza { status, message } con mensajes amigables para el portal.
async function validarCarritoTienda(pool, items) {
    const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };

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
        if (!prod) fail(400, 'Uno de los productos del carrito ya no está disponible en la tienda. Vaciá el carrito y volvé a armarlo.');
        if (!cantidad || cantidad < 1 || cantidad > 9999) fail(400, `Cantidad inválida para ${prod.Descripcion}.`);

        // Variante mapeada al WMS si existe; sin mapeo vale el fallback "Única"
        // (wms_variante_id = ProIdProducto), igual que el catálogo.
        const variante = varPorKey[`${proId}:${wmsVarId}`] || null;
        if (!variante && wmsVarId !== proId) {
            fail(400, `La variante elegida de ${prod.Descripcion} ya no existe. Quitala del carrito y elegila de nuevo.`);
        }
        const precio = (variante && variante.precio_excepcion != null)
            ? parseFloat(variante.precio_excepcion)
            : (prod.PrecioBase != null ? parseFloat(prod.PrecioBase) : null);
        const moneda = (variante && variante.moneda_excepcion === 2) ? 'USD'
            : (variante && variante.moneda_excepcion === 1) ? 'UYU'
            : ((prod.MonedaBase || 'UYU').trim() || 'UYU');
        if (precio == null) fail(400, `${prod.Descripcion} no tiene precio cargado — consultanos por soporte.`);

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

    // Moneda del pedido: misma regla que el carrito interno del WMS (WmsOrderPage): si
    // ALGÚN ítem es USD, el pedido entero va en USD y los ítems en pesos se convierten
    // con la cotización vigente; si no, todo en UYU.
    const monedaPedido = lineas.some(l => l.monedaOriginal === 'USD') ? 'USD' : 'UYU';
    let cotizacion = null;
    if (lineas.some(l => l.monedaOriginal !== monedaPedido)) {
        const cotRes = await pool.request().query('SELECT TOP 1 CotDolar AS Valor FROM dbo.Cotizaciones ORDER BY CotFecha DESC');
        cotizacion = cotRes.recordset.length ? parseFloat(cotRes.recordset[0].Valor) : null;
        if (!cotizacion || cotizacion <= 0) {
            fail(500, 'No hay cotización del dólar cargada para combinar monedas. Probá de nuevo más tarde.');
        }
    }
    lineas.forEach(l => {
        l.precio = l.monedaOriginal === monedaPedido ? l.precioOriginal
            : (monedaPedido === 'USD' ? l.precioOriginal / cotizacion : l.precioOriginal * cotizacion);
        l.precio = Math.round(l.precio * 100) / 100;
    });
    const total = Math.round(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0) * 100) / 100;

    return { lineas, monedaPedido, total };
}

// Forma de envío (patrón ECOUV): FormasEnvio → Ordenes.ModoRetiro (texto del nomenclador).
async function resolverModoRetiro(pool, formaEnvioId) {
    if (!formaEnvioId) return null;
    try {
        const feRes = await pool.request()
            .input('FE', sql.Int, parseInt(formaEnvioId, 10))
            .query('SELECT Nombre FROM FormasEnvio WHERE ID = @FE');
        return (feRes.recordset[0]?.Nombre || '').trim() || null;
    } catch (eFE) {
        logger.warn('[Tienda] No se pudo resolver la forma de envío: ' + eFE.message);
        return null;
    }
}

// Crea la venta completa (VEN- + cabecera + detalle + ancla PRO + trazabilidad + socket).
// `pago` opcional { ref, metodo }: estampa FechaPagoOnline/PagoOnlineRef/MetodoPagoOnline
// en la cabecera — es la marca de VERDAD de "pagado online" (EstadoCobro es pipeline).
async function crearVentaTienda(pool, { cliIdCliente, clienteNombre, lineas, monedaPedido, total, modoRetiro, pago = null, io = null }) {
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

        // [MARCA TIENDA 18/08] Origen + ModoRetiro NORMALIZADO en la cabecera (no el
        // texto libre del nomenclador): el filtro de preparación compara por igualdad.
        const modoRetiroNorm = modoRetiro ? (/encomienda/i.test(modoRetiro) ? 'ENCOMIENDA' : 'RETIRO') : null;
        const insertHeader = await transaction.request()
            .input('NoDocERP', sql.NVarChar, codigoVenta)
            .input('ClienteID', sql.Int, cliIdCliente)
            .input('MontoTotal', sql.Decimal(18, 2), total)
            .input('Moneda', sql.VarChar, monedaPedido)
            .input('EstadoCobro', sql.NVarChar, 'PENDIENTE')
            .input('Origen', sql.VarChar(20), 'TIENDA')
            .input('ModoRetiro', sql.VarChar(20), modoRetiroNorm)
            .input('PagoRef', sql.VarChar(100), pago?.ref || null)
            .input('PagoMetodo', sql.VarChar(20), pago?.metodo || null)
            .query(pago ? `
                INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, EstadoCobro, Origen, ModoRetiro, FechaPagoOnline, PagoOnlineRef, MetodoPagoOnline)
                OUTPUT INSERTED.ID
                VALUES (@NoDocERP, @ClienteID, @MontoTotal, @Moneda, GETDATE(), @EstadoCobro, @Origen, @ModoRetiro, GETDATE(), @PagoRef, @PagoMetodo)
            ` : `
                INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, EstadoCobro, Origen, ModoRetiro)
                OUTPUT INSERTED.ID
                VALUES (@NoDocERP, @ClienteID, @MontoTotal, @Moneda, GETDATE(), @EstadoCobro, @Origen, @ModoRetiro)
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
            nota: `Compra desde la tienda del portal${modoRetiro ? ` — Envío: ${modoRetiro}` : ''}${pago ? ` — PAGADA ONLINE (${pago.metodo})` : ''}`,
            usuario: clienteNombre
        });
    } catch (eEv) { /* sin trazabilidad no se corta la venta */ }
    if (io) {
        io.emit('wms:pedido', { type: 'nuevo_pedido', pedidoId, codigoVenta });
        logger.info(`[Tienda] 📡 Socket wms:pedido emitido para ${codigoVenta}`);
    }

    return { pedidoId, codigoVenta };
}

// ── [PAGO ONLINE 21/08] Tienda paga-primero ─────────────────────────────────────────
// POST /api/web-orders/tienda/init-pago — body { items, formaEnvioId, metodo: 'handy' }.
// NO crea la venta: valida y re-precia el carrito, y genera el link de pago guardando el
// carrito VALIDADO en el payload de la transacción (type 'tienda-checkout'). La venta la
// crea el WEBHOOK al confirmarse el pago (crearVentaTiendaPagada) — así no existen VEN de
// tienda con retiro sin plata. El retorno del pago va a /portal/payment-status (genérica).
exports.initPagoTienda = async (req, res) => {
    try {
        const { items, formaEnvioId, metodo } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'El carrito está vacío.' });
        }
        if (String(metodo || '').toLowerCase() !== 'handy') {
            return res.status(400).json({ error: 'Método de pago no disponible todavía. Elegí Handy.' });
        }

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
            return res.status(403).json({ error: 'Tu cuenta está bloqueada. Contactá con nosotros para regularizar tu situación.', blocked: true });
        }
        const clienteNombre = (cliente.IDCliente && cliente.IDCliente.trim()) ? cliente.IDCliente.trim() : (cliente.Nombre || 'Cliente Web');

        const { lineas, monedaPedido, total } = await validarCarritoTienda(pool, items);
        const modoRetiro = await resolverModoRetiro(pool, formaEnvioId);

        const products = lineas.map(l => {
            const amt = Number((l.precio * l.cantidad).toFixed(2));
            return {
                Name: `${l.descripcion}${l.varianteNombre && l.varianteNombre !== 'Única' ? ` - ${l.varianteNombre}` : ''}`.substring(0, 50),
                Quantity: l.cantidad,
                Amount: amt,
                TaxedAmount: Number((amt / 1.22).toFixed(2)),
            };
        });

        const { createPaymentLink } = require('../services/handyService');
        const result = await createPaymentLink({
            products,
            totalAmount: total,
            currencyCode: monedaPedido === 'USD' ? 840 : 858,
            commerceName: 'USER - Tienda',
            ordersData: {
                type: 'tienda-checkout',
                cliIdCliente: cliente.CliIdCliente,
                clienteNombre,
                lineas,          // carrito YA validado y re-preciado: el webhook crea la venta con esto tal cual
                monedaPedido,
                total,
                modoRetiro,
            },
            codCliente,
            logPrefix: '[HANDY TIENDA]'
        });

        if (!result.success) return res.status(500).json({ error: result.error });
        res.json({ success: true, url: result.url, transactionId: result.transactionId, total, moneda: monedaPedido });
    } catch (err) {
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        logger.error('[Tienda] initPagoTienda: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Llamada por el WEBHOOK (Handy hoy; MP cuando se sume) al confirmarse un pago de tienda.
// Crea la venta YA PAGADA. Idempotente vía el campo ventaCreada del OrdersJson (el caller
// lo persiste tras el éxito y no reintenta si ya está).
exports.crearVentaTiendaPagada = async (pool, storedData, { ref, metodo, io }) => {
    await ensureTiendaSchema(pool);
    const { pedidoId, codigoVenta } = await crearVentaTienda(pool, {
        cliIdCliente: storedData.cliIdCliente,
        clienteNombre: storedData.clienteNombre || 'Cliente Web',
        lineas: storedData.lineas || [],
        monedaPedido: storedData.monedaPedido || 'UYU',
        total: storedData.total || 0,
        modoRetiro: storedData.modoRetiro || null,
        pago: { ref: ref || null, metodo: metodo || 'HANDY' },
        io,
    });
    logger.info(`[Tienda] 💳 Venta pagada online creada por webhook: ${codigoVenta} (${metodo} ${ref})`);
    return { pedidoId, codigoVenta };
};
