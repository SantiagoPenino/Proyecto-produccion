const express = require('express');
const router = express.Router();
const prendasOrdersController = require('../controllers/prendasOrdersController');
const { verifyToken } = require('../middleware/authMiddleware');
const { impersonarClienteInterno } = require('../middleware/impersonarClienteInterno');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  RUTA NUEVA — PRODUCTOS TERMINADOS / PRENDAS (alta interna)
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  Camino PARALELO y AISLADO. No comparte código con /api/web-orders.
 *  Nada de lo que se toque acá puede afectar a DTF, Sublimación,
 *  Impresión Directa, TPU ni ECOUV: esos siguen entrando por
 *  POST /api/web-orders/create → webOrdersController.createWebOrder,
 *  que queda intacto.
 *
 *  Diferencias con el camino del portal:
 *    - Entra por el menú interno, no por el portal del cliente.
 *    - El cliente lo elige el vendedor (header X-Cliente-CodCliente),
 *      validado por impersonarClienteInterno (userType === 'INTERNAL').
 *    - El orden de los pasos lo arma el vendedor; no sale de
 *      ConfigMapeoERP.Numero.
 *
 *  Estado: copia fiel de webOrdersController al 16-07-2026. Todavía sin
 *  modificar — se va podando y adaptando de a poco.
 */

// POST /api/prendas-orders/create
router.post('/create', verifyToken, impersonarClienteInterno, prendasOrdersController.createWebOrder);

// [PRENDAS] "Comprar y personalizar" — retiro WMS pendiente (equivalente de
// getPendingOrders/confirmPreparation de logisticaWmsController, pero sobre Ordenes).
router.get('/retiros-wms-pendientes', verifyToken, prendasOrdersController.getRetirosWmsPendientes);
// [CONFIGURADOR] Qué personalización (EMB/DF/TPU) admite cada artículo de stock del carrito,
// según los productos "del local" del Configurador que apuntan a él. ?ids=474,440
router.get('/personalizacion-admitida', verifyToken, prendasOrdersController.getPersonalizacionAdmitida);
router.put('/:ordenId/iniciar-preparacion-retiro', verifyToken, prendasOrdersController.iniciarPreparacionRetiroWms);
router.put('/:ordenId/actualizar-cantidad-retiro', verifyToken, prendasOrdersController.actualizarCantidadRetiroWms);
router.put('/:ordenId/confirmar-retiro-wms', verifyToken, prendasOrdersController.confirmarRetiroWms);

// GET /api/prendas-orders/productos-terminados
// Los artículos de Articulos cuyo CodStock cae en una variante de StockArt marcada
// TipoStock = 'PRODUCTO_TERMINADO'. Sin filtro de área a propósito: las prendas no
// pertenecen a un área de impresión (a diferencia de /nomenclators/materiales-por-tipo,
// que filtra por StockArt.Grupo -> ConfigMapeoERP.AreaID_Interno).
//
// Si TipoStock todavía no existe en la base, cae al fallback y devuelve lista vacía
// en vez de romper (lección del incidente del 13/07).
router.get('/productos-terminados', verifyToken, async (req, res) => {
    try {
        const pool = await getPool();
        // [PRENDAS] Filtro opcional por categoría (StockArt.Articulo) — sin esto se ven TODOS
        // los producto-terminado (incluidos los de ECOUV: Cuadros Canvas, Roll Up, etc.), que
        // no aplican a "Fabricar a Medida". El selector de Producto a Fabricar pasa
        // ?categoria=Prendas Confeccionadas para traer solo lo suyo.
        const categoria = (req.query.categoria || '').trim();
        // [PRENDAS] Filtro opcional por GRUPO de StockArt. Desde que el configurador
        // partió las prendas en familias reales (Camisetas, Remeras, Shorts, ...), filtrar
        // por un solo nombre de categoría ya no alcanza: el Grupo '2.1' las agrupa a todas
        // (Combos viven en '2.2' y Productos del Local en '2.3', que no aplican acá).
        const grupo = (req.query.grupo || '').trim();
        const request = pool.request();
        if (categoria) request.input('Cat', require('mssql').VarChar, categoria);
        if (grupo) request.input('Grp', require('mssql').VarChar, grupo);
        // Etiqueta del configurador (Básquet, Fútbol…) y estado: el árbol de la solicitud es
        // Familia › Etiqueta › Producto. Si la base todavía no tiene la etiqueta (falta
        // docs/migrations/configurador_etiquetas.sql), viene NULL y el árbol sale sin ese nivel.
        const conEtiqueta = (await pool.request().query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'EtiquetaID') AS c`)).recordset[0].c != null;
        // F1: producción principal, molde y medida fija del producto (docs/migrations/configurador_f1_produccion_principal.sql)
        const conF1 = (await pool.request().query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') AS c`)).recordset[0].c != null;
        const area = String(req.query.area || '').trim().toUpperCase();
        if (area) request.input('Area', require('mssql').VarChar, area);
        const r = await request.query(`
            SELECT
                a.ProIdProducto,
                LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo,
                LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                LTRIM(RTRIM(a.CodStock))    AS CodStock,
                LTRIM(RTRIM(sa.Articulo))   AS Categoria,
                -- [FUENTE ÚNICA] la moneda del precio es la de PreciosBase (la del artículo queda para materiales)
                ISNULL(pb.MonIdMoneda, CASE UPPER(LTRIM(RTRIM(pb.Moneda))) WHEN 'USD' THEN 2 WHEN 'UYU' THEN 1 ELSE a.MonIdMoneda END) AS MonIdMoneda,
                pb.Precio,
                ISNULL(vc.CantidadVariantes, 0) AS CantidadVariantes,
                ISNULL(img.url_imagen, fd.DibujoUrl) AS Imagen,   -- foto del producto; si no hay, el dibujo de la ficha de diseño
                vcfg.Estado, vcfg.CantidadMinima, vcfg.CantidadFija, LTRIM(RTRIM(pb.Moneda)) AS Moneda,
                ${conEtiqueta ? 'vcfg.EtiquetaID, etq.Nombre AS Etiqueta' : 'CAST(NULL AS INT) AS EtiquetaID, CAST(NULL AS NVARCHAR(100)) AS Etiqueta'},
                ${conF1 ? 'vcfg.TecnicaPrincipal, vcfg.Molde, vcfg.UM, vcfg.AnchoM, vcfg.AltoM, vcfg.BordeCm, vcfg.VisibleInterno, vcfg.VisibleTienda, vcfg.VisiblePortal' : "CAST(NULL AS VARCHAR(10)) AS TecnicaPrincipal, CAST(NULL AS VARCHAR(12)) AS Molde, CAST(NULL AS VARCHAR(3)) AS UM, CAST(NULL AS DECIMAL(10,3)) AS AnchoM, CAST(NULL AS DECIMAL(10,3)) AS AltoM, CAST(NULL AS DECIMAL(6,2)) AS BordeCm, CAST(1 AS BIT) AS VisibleInterno, CAST(NULL AS BIT) AS VisibleTienda, CAST(NULL AS BIT) AS VisiblePortal"}
            FROM dbo.Articulos a
            INNER JOIN dbo.StockArt sa
                ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
            LEFT JOIN dbo.PreciosBase pb ON pb.ProIdProducto = a.ProIdProducto
            LEFT JOIN dbo.ProductoVentaConfig vcfg ON vcfg.ProIdProducto = a.ProIdProducto
            ${conEtiqueta ? 'LEFT JOIN dbo.ProductoEtiqueta etq ON etq.EtiquetaID = vcfg.EtiquetaID' : ''}
            OUTER APPLY (SELECT TOP 1 url_imagen FROM (
                             SELECT i.url_imagen, i.orden FROM dbo.Articulos_Imagenes i WHERE i.Idproid = a.ProIdProducto
                             UNION ALL   -- [FOTO ÚNICA] sin foto de catálogo, el dibujo de la ficha técnica
                             SELECT f.DibujoUrl, 9999 FROM dbo.ProductoFichaDiseno f WHERE f.ProIdProducto = a.ProIdProducto AND f.DibujoUrl IS NOT NULL
                         ) x ORDER BY x.orden) img
            LEFT JOIN dbo.ProductoFichaDiseno fd ON fd.ProIdProducto = a.ProIdProducto
            LEFT JOIN (
                SELECT Idproid, COUNT(*) AS CantidadVariantes
                FROM dbo.Articulos_WMS_Variantes GROUP BY Idproid
            ) vc ON vc.Idproid = a.ProIdProducto
            WHERE ISNULL(sa.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO'
              AND ISNULL(a.borrar, 0) = 0
              AND ISNULL(a.Mostrar, 1) = 1
              ${categoria ? 'AND LTRIM(RTRIM(sa.Articulo)) = @Cat' : ''}
              ${grupo ? 'AND LTRIM(RTRIM(sa.Grupo)) = @Grp' : ''}
              ${req.query.publicados === '1' ? "AND vcfg.Estado = 'PUBLICADO'" : ''}
              ${conF1 && area ? 'AND vcfg.TecnicaPrincipal = @Area' : ''}
            ORDER BY Categoria, Descripcion
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.warn(`[Prendas] productos-terminados: ${e.message}`);
        res.json({ success: true, data: [], warning: e.message });
    }
});

// GET /api/prendas-orders/productos-terminados/:proIdProducto/servicios
// [PRENDAS] Servicios de decoración (Bordado/DTF/TPU) incluidos por defecto en el producto —
// ver ProductoTerminadoServicios. Al elegir el producto en "Fabricar a Medida", el front
// activa estos solos y los bloquea (Obligatorio=1 = no se pueden apagar).
//
// [COMBOS] Si el producto es un combo (tiene filas en ProductoComboItems, las carga el
// Configurador), la respuesta suma esCombo:true + componentes[]: cada componente lleva sus
// PROPIOS servicios (ProductoComboItemServicios) — ej. el Gorro borda, el Short estampa.
// Toda fila de ProductoComboItemServicios se pide igual que un Obligatorio=1 (el bit
// "Incluido" es de PRECIO — si se cobra aparte o no — no decide si hace falta pedirlo).
// Mismas queries que usa configuradorController.getProductoFicha para armar comboItems +
// servicios. Sin combo, "data" sale exactamente como antes — no cambia nada para el caso simple.
router.get('/productos-terminados/:proIdProducto/servicios', verifyToken, async (req, res) => {
    try {
        const pool = await getPool();
        const proId = parseInt(req.params.proIdProducto, 10);
        const r = await pool.request()
            .input('PID', sql.Int, proId)
            .query(`SELECT AreaID, Obligatorio, Modo, Cobro FROM dbo.ProductoTerminadoServicios WHERE ProIdProducto = @PID`);

        // [F1] Producción principal del producto (área, molde, medida fija, unidad, cantidades) y los
        // materiales que ofrece (ProductoTelas → artículos; si no marcó ninguno y la principal no es
        // sublimación, todos los del área). Mismo formato que /nomenclators/materials para que el
        // formulario los use tal cual. Sin el SQL de F1, config = null y todo sigue como antes.
        let config = null, materiales = [];
        try {
            const conF1 = (await pool.request().query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') AS c`)).recordset[0].c != null;
            if (conF1) {
                const c = (await pool.request().input('PID', sql.Int, proId).query(`
                    SELECT TecnicaPrincipal, Molde, UM, AnchoM, AltoM, BordeCm, CantidadMinima, CantidadFija, Estado,
                           CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL ELSE TizadaProMoldeRef END AS TizadaProMoldeRef
                    FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @PID`)).recordset[0];
                if (c) {
                    config = { ...c, TecnicaPrincipal: c.TecnicaPrincipal || 'SB', Molde: c.Molde || 'OBLIGATORIO', UM: c.UM || 'u' };
                    const t = await pool.request().input('PID', sql.Int, proId).query(`
                        SELECT LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.CodStock)) AS CodStock, LTRIM(RTRIM(a.Descripcion)) AS Material,
                               a.anchoimprimible AS Ancho, a.largoimprimible AS Largo, LTRIM(RTRIM(sa.Articulo)) AS Variante, a.ProIdProducto, t.EsDefault
                        FROM dbo.ProductoTelas t
                        INNER JOIN dbo.Articulos a ON a.ProIdProducto = t.TelaProIdProducto
                        LEFT JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
                        WHERE t.ProIdProducto = @PID ORDER BY ISNULL(t.Orden, 999), t.ID`);
                    materiales = t.recordset;
                    if (!materiales.length && config.TecnicaPrincipal !== 'SB') materiales = await require('../services/pedidosExternos/catalogo').materialesDeArea(pool, config.TecnicaPrincipal);
                }
            }
        } catch (e) { logger.warn(`[Prendas] productos-terminados/servicios config F1: ${e.message}`); }

        const comboItems = await pool.request()
            .input('PID', sql.Int, proId)
            .query(`
                SELECT ci.ID, ci.ItemProIdProducto, ci.WmsVarianteId, ci.Cantidad,
                       LTRIM(RTRIM(a.Descripcion)) AS ItemDescripcion
                FROM dbo.ProductoComboItems ci
                LEFT JOIN dbo.Articulos a ON a.ProIdProducto = ci.ItemProIdProducto
                WHERE ci.ProIdProducto = @PID ORDER BY ISNULL(ci.Orden, 999), ci.ID
            `);
        // [ACCESORIOS] artículos de stock que salen con el producto (configurador › Accesorios y estructura).
        // Si la tabla no existe todavía (prod sin migrar), lista vacía.
        let accesorios = [];
        try {
            const acc = await pool.request().input('PID', sql.Int, proId).query(`
                IF OBJECT_ID('dbo.ProductoAccesorios', 'U') IS NOT NULL
                SELECT ac.ID, ac.ItemProIdProducto, ac.WmsVarianteId, ac.Cantidad, ac.Obligatorio, ac.Cobro, ac.WmsDepositoId,
                       LTRIM(RTRIM(a.Descripcion)) AS ItemDescripcion, v.nombre_variante AS VarianteNombre, v.sku AS Sku
                FROM dbo.ProductoAccesorios ac
                LEFT JOIN dbo.Articulos a ON a.ProIdProducto = ac.ItemProIdProducto
                LEFT JOIN dbo.Articulos_WMS_Variantes v ON v.wms_variante_id = ac.WmsVarianteId
                WHERE ac.ProIdProducto = @PID ORDER BY ISNULL(ac.Orden, 999), ac.ID`);
            accesorios = acc.recordset || [];
            // Sin variante fija, quien carga el pedido elige talle/color: se mandan las variantes del artículo
            // Un artículo con UNA sola variante (ej. "Auriculares" = el artículo mismo) no da nada a elegir:
            // se resuelve sola y VarianteUnica avisa a los formularios que no la muestren.
            const ids = [...new Set(accesorios.map(a => a.ItemProIdProducto))];
            if (ids.length) {
                const vs = await pool.request().query(`SELECT Idproid, wms_variante_id, nombre_variante, sku FROM dbo.Articulos_WMS_Variantes WHERE Idproid IN (${ids.join(',')}) ORDER BY nombre_variante`);
                accesorios = accesorios.map(a => {
                    const vars = vs.recordset.filter(v => v.Idproid === a.ItemProIdProducto);
                    const unica = vars.length === 1;
                    if (a.WmsVarianteId) return { ...a, VarianteUnica: unica };
                    if (unica) return { ...a, WmsVarianteId: vars[0].wms_variante_id, VarianteNombre: vars[0].nombre_variante, VarianteUnica: true };
                    return { ...a, variantes: vars, VarianteUnica: false };
                });
            }
        } catch (e) { accesorios = []; }
        if (!comboItems.recordset.length) {
            return res.json({ success: true, data: r.recordset, config, materiales, accesorios });
        }

        const comboSrv = await pool.request()
            .input('PID', sql.Int, proId)
            .query(`
                SELECT s.ComboItemID, s.AreaID, s.TecnicaOpcionID, s.Incluido,
                       LTRIM(RTRIM(t.Nombre)) AS TecnicaOpcionNombre,
                       LTRIM(RTRIM(t.CodArticulo)) AS TecnicaOpcionCodArticulo
                FROM dbo.ProductoComboItemServicios s
                INNER JOIN dbo.ProductoComboItems ci ON ci.ID = s.ComboItemID
                LEFT JOIN dbo.TecnicaOpciones t ON t.TecnicaOpcionID = s.TecnicaOpcionID
                WHERE ci.ProIdProducto = @PID
            `);

        const componentes = comboItems.recordset.map(ci => ({
            comboItemId: ci.ID,
            itemProIdProducto: ci.ItemProIdProducto,
            descripcion: ci.ItemDescripcion || `Producto ${ci.ItemProIdProducto}`,
            wmsVarianteId: ci.WmsVarianteId,
            cantidad: ci.Cantidad,
            // tecnicaOpcionId NULL = "opción libre" (el cliente/vendedor elige en el pedido);
            // con valor = técnica FIJA por el combo (se muestra como dato, no como selector).
            servicios: comboSrv.recordset
                .filter(s => s.ComboItemID === ci.ID)
                .map(s => ({ areaId: s.AreaID, tecnicaOpcionId: s.TecnicaOpcionID, tecnicaOpcionNombre: s.TecnicaOpcionNombre, tecnicaOpcionCodArticulo: s.TecnicaOpcionCodArticulo, incluido: !!s.Incluido }))
        }));

        res.json({ success: true, data: r.recordset, esCombo: true, componentes, config, materiales });
    } catch (e) {
        logger.warn(`[Prendas] productos-terminados/servicios: ${e.message}`);
        res.json({ success: true, data: [], warning: e.message });
    }
});

// GET /api/prendas-orders/ping — smoke test: confirma que la ruta está montada y aislada.
router.get('/ping', (req, res) => res.json({
    ok: true,
    ruta: 'prendas-orders',
    nota: 'camino aislado; no afecta /api/web-orders'
}));

module.exports = router;
