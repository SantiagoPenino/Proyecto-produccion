const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { upsertPrecioBase } = require('./stockArtController');

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  CONFIGURADOR DE PRODUCTOS — backend (F2)
 * ══════════════════════════════════════════════════════════════════════════
 *  Ruta /configurar-productos. Camino NUEVO y AISLADO: no toca web-orders,
 *  prendas-orders ni stockart (solo reusa upsertPrecioBase). Modelo en
 *  docs/migrations/configurador_productos.sql (secciones A–J).
 *
 *  Piezas:
 *   - Productos configurables: prendas PT (SupFlia 2) + combos de bordado
 *     (1.1.4.10) + cualquier artículo que ya tenga ProductoVentaConfig.
 *     ECOUV (grupo 1.3) queda afuera: tiene su propio gestor.
 *   - Técnicas: ProductoTerminadoServicios (qué técnica) + TecnicaOpciones
 *     (catálogo general) + ProductoTecnicaOpciones (permitidas por producto).
 *   - Venta: ProductoVentaConfig (origen/cantidades/estado) +
 *     ProductoOrigenVariantes (surtido del paquete).
 *   - Confeccionados: el molde vive en TizadaPro (services/tizadaProService.js,
 *     solo lectura). Acá se vincula el producto a su molde (TizadaProMoldeRef) y se
 *     elige qué modelos (ProductoModelos) y qué telas (ProductoTelas) se
 *     venden. Los apliques (ProductoApliques) se ubican sobre una pieza del molde.
 *  El precio NUNCA vive acá: PreciosBase vía upsertPrecioBase.
 */

const MODOS = ['LIBRE', 'RESTRINGIDO', 'FIJA'];
const COBROS = ['APARTE', 'INCLUIDA'];
const ORIGENES = ['LOCAL', 'CLIENTE', 'CONFECCIONADO', 'AMBOS'];
const ESTADOS = ['BORRADOR', 'PUBLICADO'];
// EMB/DF/TPU = decoración (el cliente elige agregar); SB/TWC/TWT = construcción
// (sublimación/corte/costura — casi siempre obligatoria, 12-ago).
const AREAS_TECNICA = ['EMB', 'DF', 'TPU', 'SB', 'TWC', 'TWT', 'DIRECTA', 'ECOUV'];
// F1 (29-sep): la producción principal del producto es un área de ConfigMapeoERP (SB, DIRECTA,
// ECOUV…) y se guarda en ProductoVentaConfig.TecnicaPrincipal; DIRECTA/ECOUV también pueden ser
// filas de ProductoTerminadoServicios (la principal va como técnica obligatoria e incluida).
const MOLDES = ['OBLIGATORIO', 'OPCIONAL', 'NO'];   // ProductoVentaConfig.Molde
const UMS = ['u', 'm', 'm2'];                        // ProductoVentaConfig.UM
const AREAS_APLIQUE = ['EMB', 'DF', 'TPU', 'ETIQUETA'];
// La familia/categoría del producto vive en StockArt (Grupo 2.1) desde el
// 12-ago — se administra con GET /stockart?grupo=2.1, POST /stockart y
// PUT /stockart/articulos/:cod/mover (mismo mecanismo que EcoUV). La
// columna ProductoVentaConfig.Familia queda como dato histórico sin uso.

// ─────────────────────────────────────────────────────────────────────────
// Stock vivo del local (WMS externo). Falla blanda: si el WMS no contesta,
// devuelve null y el que llama sigue sin stock (decisión 11-ago: la venta
// no se cae si se cae el sistema de stock — ver ProductoVentaConfig.ValidarStock).
// Mismo origen de datos que wmsController.getCatalog.
// ─────────────────────────────────────────────────────────────────────────
async function fetchStockLocalWms(depIdPedido = null) {
    // [CUTOVER WMS PROPIO] WMS_INTERNO=true → stock desde las tablas Wms_* (JOIN local).
    if (String(process.env.WMS_INTERNO || '').toLowerCase() === 'true') {
        try {
            return await require('../services/wmsInternoService').getStockPorVariante(null, depIdPedido || null);
        } catch (e) {
            logger.warn(`[Configurador] stock interno no disponible: ${e.message}`);
            return null;
        }
    }
    try {
        const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
        const depositoId = depIdPedido || process.env.WMS_DEPOSITO_LOCAL_ID || 5; // depósito de Ventas, salvo que se pida otro
        const wmsQuery = `
            USE Ventas_Dev;
            SELECT variante_id, ISNULL(SUM(cantidad_actual), 0) AS total_stock
            FROM Stock_Etiquetas
            WHERE estado = 'activo' AND cantidad_actual > 0 AND deposito_id = ${depositoId}
            GROUP BY variante_id`;
        const response = await fetch(`${wmsUrl}/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: wmsQuery }),
            signal: AbortSignal.timeout(6000)
        });
        if (!response.ok) { logger.warn(`[Configurador] WMS stock status ${response.status}`); return null; }
        const data = await response.json();
        if (!data.success || !data.data) return null;
        const map = {};
        data.data.forEach(i => { map[i.variante_id] = i.total_stock; });
        return map;
    } catch (e) {
        logger.warn(`[Configurador] Sin stock vivo del WMS: ${e.message}`);
        return null;
    }
}

// ═════════════════════════════════════════════════════════════════════════
//  PRODUCTOS CONFIGURABLES
// ═════════════════════════════════════════════════════════════════════════

// ¿Ya se corrió docs/migrations/configurador_etiquetas.sql? (tabla ProductoEtiqueta +
// columna ProductoVentaConfig.EtiquetaID). Si el backend se despliega antes que el
// SQL, el listado sigue saliendo plano en vez de romperse. Solo se cachea el "sí".
let _tieneEtiquetas = false;
async function tieneEtiquetas(pool) {
    if (_tieneEtiquetas) return true;
    const r = await pool.request().query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'EtiquetaID') AS c`);
    _tieneEtiquetas = r.recordset[0].c != null;
    return _tieneEtiquetas;
}
const FALTA_SQL_ETIQUETAS = 'Falta correr docs/migrations/configurador_etiquetas.sql en esta base.';

// ¿Ya se corrió docs/migrations/configurador_tizadapro.sql? (TizadaProMoldeRef + ProductoModelos + ProductoTelas)
let _tieneTizadaPro = false;
async function tieneTizadaPro(pool) {
    if (_tieneTizadaPro) return true;
    const r = await pool.request().query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') AS c, OBJECT_ID('dbo.ProductoTelas', 'U') AS t, OBJECT_ID('dbo.ProductoAvios', 'U') AS av`);
    _tieneTizadaPro = r.recordset[0].c != null && r.recordset[0].t != null && r.recordset[0].av != null;
    return _tieneTizadaPro;
}

// ¿Ya se corrió docs/migrations/configurador_f1_produccion_principal.sql? (TecnicaPrincipal, Molde, UM, medida fija, canales)
let _tieneF1 = false;
async function tieneF1(pool) {
    if (_tieneF1) return true;
    const r = await pool.request().query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') AS c`);
    _tieneF1 = r.recordset[0].c != null;
    return _tieneF1;
}
const F1_COLS = 'TecnicaPrincipal, AnchoM, AltoM, BordeCm, UM, Molde, VisiblePortal, VisibleTienda, VisibleInterno';

// [ACCESORIOS] ¿Ya se corrió docs/migrations/configurador_accesorios.sql? (ProductoAccesorios: artículos de
// stock que salen con un producto fabricado — mástil, base… — con Obligatorio y Cobro). Tabla propia, NO
// ProductoComboItems, para que un producto con accesorios no se trate como combo.
let _tieneAccesorios = false;
async function tieneAccesorios(pool) {
    if (_tieneAccesorios) return true;
    const r = await pool.request().query(`SELECT OBJECT_ID('dbo.ProductoAccesorios', 'U') AS t`);
    _tieneAccesorios = r.recordset[0].t != null;
    return _tieneAccesorios;
}
const COBROS_ACCESORIO = ['INCLUIDO', 'APARTE'];

// Áreas que pueden ser producción principal de un producto: las áreas de producción de ConfigMapeoERP
// (sin PRO, que es la orden madre, ni las que no producen nada).
async function areasPrincipales(pool) {
    const r = await pool.request().query(`
        SELECT LTRIM(RTRIM(AreaID_Interno)) AS AreaID, MIN(LTRIM(RTRIM(NombreReferencia))) AS Nombre, MIN(LTRIM(RTRIM(CodOrden))) AS CodOrden, MIN(Numero) AS Numero
        FROM dbo.ConfigMapeoERP
        WHERE AreaID_Interno IS NOT NULL AND LTRIM(RTRIM(AreaID_Interno)) NOT IN ('PRO', 'TERMINAC')
        GROUP BY LTRIM(RTRIM(AreaID_Interno)) ORDER BY MIN(Numero), AreaID`);
    return r.recordset;
}
async function areaPrincipalValida(pool, areaId) {
    if (areaId == null || areaId === '') return true;
    return (await areasPrincipales(pool)).some(a => a.AreaID === String(areaId).trim().toUpperCase());
}

// GET /api/configurador/areas-principales — para el selector "Producción principal"
exports.getAreasPrincipales = async (req, res) => {
    try { res.json({ success: true, data: await areasPrincipales(await getPool()) }); }
    catch (e) { logger.error('[Configurador] getAreasPrincipales:', e); res.status(500).json({ error: e.message }); }
};

// GET /api/configurador/materiales-area/:areaId — materiales de impresión del área (StockArt del
// Grupo del área, TipoStock MATERIAL, visibles), con precio base. Es lo que ofrece un producto
// cuya producción principal no pasa por un molde de TizadaPro (windflag, funda, cuadro).
exports.getMaterialesArea = async (req, res) => {
    const areaId = String(req.params.areaId || '').trim().toUpperCase();
    if (!areaId) return res.status(400).json({ error: 'AreaID requerido.' });
    try {
        const pool = await getPool();
        const r = await pool.request().input('Area', sql.VarChar(20), areaId).query(`
            SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Material,
                   LTRIM(RTRIM(sa.Articulo)) AS Variante, LTRIM(RTRIM(a.CodStock)) AS CodStock,
                   a.anchoimprimible AS Ancho, a.largoimprimible AS Largo, a.UniIdUnidad,
                   pb.Precio AS PrecioBase, LTRIM(RTRIM(pb.Moneda)) AS Moneda
            FROM dbo.StockArt sa
            INNER JOIN dbo.Articulos a ON LTRIM(RTRIM(a.CodStock)) = LTRIM(RTRIM(sa.CodStock))
            INNER JOIN dbo.ConfigMapeoERP m ON LTRIM(RTRIM(m.CodigoERP)) = LTRIM(RTRIM(sa.Grupo))
            OUTER APPLY (SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase p WHERE p.ProIdProducto = a.ProIdProducto ORDER BY p.UltimaActualizacion DESC) pb
            WHERE LTRIM(RTRIM(m.AreaID_Interno)) = @Area
              AND ISNULL(sa.TipoStock, 'MATERIAL') = 'MATERIAL'
              AND ISNULL(sa.Mostrar, 1) = 1 AND ISNULL(a.Mostrar, 1) = 1 AND ISNULL(a.borrar, 0) = 0
            ORDER BY Variante, Material`);
        res.json({ success: true, data: r.recordset });
    } catch (e) { logger.error('[Configurador] getMaterialesArea:', e); res.status(500).json({ error: e.message }); }
};

// Puente de visibilidad (F1): la casilla "Tienda" del configurador mantiene TiendaProductos.Publicado
// hasta que la tienda lea VisibleTienda directamente. Sin la tabla, no hace nada.
async function puenteTienda(pool, proId, visible) {
    const ex = (await pool.request().query(`SELECT OBJECT_ID('dbo.TiendaProductos', 'U') AS t`)).recordset[0].t;
    if (!ex) return;
    await pool.request().input('PID', sql.Int, proId).input('V', sql.Bit, visible ? 1 : 0).query(`
        IF EXISTS (SELECT 1 FROM dbo.TiendaProductos WHERE ProIdProducto = @PID)
            UPDATE dbo.TiendaProductos SET Publicado = @V WHERE ProIdProducto = @PID
        ELSE IF @V = 1
            INSERT INTO dbo.TiendaProductos (ProIdProducto, Publicado, TipoVitrina, TituloVenta)
            SELECT vc.ProIdProducto, 1,
                   CASE WHEN ISNULL(vc.EsCombo, 0) = 1 OR vc.OrigenTipo = 'LOCAL' THEN 'TERMINADO' ELSE 'CONFECCIONADO' END,
                   LTRIM(RTRIM(a.Descripcion))
            FROM dbo.ProductoVentaConfig vc JOIN dbo.Articulos a ON a.ProIdProducto = vc.ProIdProducto
            WHERE vc.ProIdProducto = @PID`);
}

// GET /api/configurador/productos — lista con config + técnicas + precio
exports.getProductos = async (req, res) => {
    try {
        const pool = await getPool();
        const conEtiqueta = await tieneEtiquetas(pool);
        const conF1 = await tieneF1(pool);
        const area = String(req.query.area || '').trim().toUpperCase();   // solo los productos que produce ese área
        const r = await pool.request().input('Area', sql.VarChar(20), area || null).query(`
            SELECT
                a.ProIdProducto,
                LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo,
                LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                LTRIM(RTRIM(a.CodStock))    AS CodStock,
                LTRIM(RTRIM(sa.Articulo))   AS Categoria,
                ISNULL(a.Mostrar, 1)        AS Mostrar,
                pb.Precio, pb.Moneda,
                img.url_imagen AS Imagen,
                vc.OrigenTipo, vc.OrigenProIdProducto, vc.CantidadMinima, vc.CantidadFija,
                vc.ValidarStock, vc.Estado, vc.EsCombo,
                ${conEtiqueta ? 'vc.EtiquetaID, etq.Nombre AS Etiqueta,' : ''}
                ${conF1 ? 'vc.TecnicaPrincipal, vc.Molde, vc.UM, vc.VisiblePortal, vc.VisibleTienda, vc.VisibleInterno,' : ''}
                tecnicas.Lista AS Tecnicas,
                ISNULL(wv.CantidadVariantes, 0) AS CantidadVariantes,
                ISNULL(ci.Items, 0) AS ComboItems
            FROM dbo.Articulos a
            INNER JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
            LEFT JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
            ${conEtiqueta ? 'LEFT JOIN dbo.ProductoEtiqueta etq ON etq.EtiquetaID = vc.EtiquetaID' : ''}
            OUTER APPLY (SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase p
                         WHERE p.ProIdProducto = a.ProIdProducto
                         ORDER BY p.UltimaActualizacion DESC) pb
            OUTER APPLY (SELECT TOP 1 url_imagen FROM (
                             SELECT i.url_imagen, i.orden FROM dbo.Articulos_Imagenes i WHERE i.Idproid = a.ProIdProducto
                             UNION ALL
                             -- [FOTO ÚNICA] sin foto de catálogo, vale el dibujo de la ficha técnica
                             SELECT f.DibujoUrl, 9999 FROM dbo.ProductoFichaDiseno f WHERE f.ProIdProducto = a.ProIdProducto AND f.DibujoUrl IS NOT NULL
                         ) x ORDER BY x.orden) img
            OUTER APPLY (SELECT STRING_AGG(s.AreaID, ',') AS Lista
                         FROM dbo.ProductoTerminadoServicios s
                         WHERE s.ProIdProducto = a.ProIdProducto) tecnicas
            LEFT JOIN (SELECT Idproid, COUNT(*) AS CantidadVariantes
                       FROM dbo.Articulos_WMS_Variantes GROUP BY Idproid) wv
                   ON wv.Idproid = a.ProIdProducto
            LEFT JOIN (SELECT ProIdProducto, COUNT(*) AS Items
                       FROM dbo.ProductoComboItems GROUP BY ProIdProducto) ci
                   ON ci.ProIdProducto = a.ProIdProducto
            WHERE ISNULL(a.borrar, 0) = 0
              AND (
                    (ISNULL(sa.TipoStock,'MATERIAL') IN ('PRODUCTO_TERMINADO', 'PRODUCTO_LOCAL')
                     AND (LTRIM(RTRIM(sa.SupFlia)) = '2' OR LTRIM(RTRIM(sa.CodStock)) = '1.1.4.10'))
                    OR vc.ProIdProducto IS NOT NULL
                  )
              ${conF1 && area ? 'AND vc.TecnicaPrincipal = @Area' : ''}
            ORDER BY Categoria, Descripcion
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[Configurador] getProductos:', e);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/configurador/productos/:proId — ficha completa
exports.getProductoFicha = async (req, res) => {
    const proId = parseInt(req.params.proId, 10);
    if (!Number.isInteger(proId)) return res.status(400).json({ error: 'ProIdProducto inválido.' });
    try {
        const pool = await getPool();
        const conTizada = await tieneTizadaPro(pool);
        const conAcc = await tieneAccesorios(pool);   // [ACCESORIOS]
        const conF1 = await tieneF1(pool);
        const rq = () => pool.request().input('PID', sql.Int, proId);

        const datos = await rq().query(`
            SELECT TOP 1 a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo,
                   LTRIM(RTRIM(a.Descripcion)) AS Descripcion, LTRIM(RTRIM(a.CodStock)) AS CodStock,
                   LTRIM(RTRIM(sa.Articulo)) AS Categoria, ISNULL(a.Mostrar,1) AS Mostrar,
                   pb.Precio, pb.Moneda, img.url_imagen AS Imagen
            FROM dbo.Articulos a
            LEFT JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
            OUTER APPLY (SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase p
                         WHERE p.ProIdProducto = a.ProIdProducto
                         ORDER BY p.UltimaActualizacion DESC) pb
            OUTER APPLY (SELECT TOP 1 url_imagen FROM (
                             SELECT i.url_imagen, i.orden FROM dbo.Articulos_Imagenes i WHERE i.Idproid = a.ProIdProducto
                             UNION ALL
                             -- [FOTO ÚNICA] sin foto de catálogo, vale el dibujo de la ficha técnica
                             SELECT f.DibujoUrl, 9999 FROM dbo.ProductoFichaDiseno f WHERE f.ProIdProducto = a.ProIdProducto AND f.DibujoUrl IS NOT NULL
                         ) x ORDER BY x.orden) img
            WHERE a.ProIdProducto = @PID AND ISNULL(a.borrar, 0) = 0`);
        if (!datos.recordset.length) return res.status(404).json({ error: 'Producto no encontrado.' });

        const [config, tecnicas, opciones, surtido, modelos, telas, avios, apliques, comboItems, comboSrv, fichaDiseno, fdAnot, fdExtra, fdCost, accesorios] = await Promise.all([
            rq().query(`SELECT OrigenTipo, OrigenProIdProducto, CantidadMinima, CantidadFija,
                               ValidarStock, Estado, EsCombo, FechaRegistro, FechaModif,
                               ${conTizada ? 'TizadaProMoldeRef' : 'CAST(NULL AS NVARCHAR(128)) AS TizadaProMoldeRef'}
                               ${conF1 ? ', ' + F1_COLS : ''}
                        FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @PID`),
            rq().query(`SELECT AreaID, Obligatorio, Modo, Cobro
                        FROM dbo.ProductoTerminadoServicios WHERE ProIdProducto = @PID`),
            rq().query(`SELECT pto.TecnicaOpcionID, t.AreaID, t.Nombre, t.CodArticulo, t.AnchoCm, t.AltoCm
                        FROM dbo.ProductoTecnicaOpciones pto
                        INNER JOIN dbo.TecnicaOpciones t ON t.TecnicaOpcionID = pto.TecnicaOpcionID
                        WHERE pto.ProIdProducto = @PID`),
            rq().query(`SELECT pov.WmsVarianteId, v.nombre_variante, v.sku
                        FROM dbo.ProductoOrigenVariantes pov
                        LEFT JOIN dbo.Articulos_WMS_Variantes v ON v.wms_variante_id = pov.WmsVarianteId
                        WHERE pov.ProIdProducto = @PID`),
            // Modelos y telas ofrecidos (docs/migrations/configurador_tizadapro.sql); sin el script, vacíos
            conTizada ? rq().query(`SELECT ModeloClave, ModeloNombre, EsDefault, Orden FROM dbo.ProductoModelos
                                    WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ID`) : { recordset: [] },
            conTizada ? rq().query(`SELECT t.TelaProIdProducto, t.EsDefault, t.Orden,
                                           LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Material, a.anchoimprimible AS Ancho
                                    FROM dbo.ProductoTelas t
                                    LEFT JOIN dbo.Articulos a ON a.ProIdProducto = t.TelaProIdProducto
                                    WHERE t.ProIdProducto = @PID ORDER BY ISNULL(t.Orden, 999), t.ID`) : { recordset: [] },
            // Avíos (insumos que no son tela) para la ficha de producción
            conTizada ? rq().query(`SELECT ID, Nombre, ArtProIdProducto, Cantidad, Unidad, Medida, Nota, Orden,
                                           CASE WHEN COL_LENGTH('dbo.ProductoAvios', 'AvioID') IS NULL THEN NULL ELSE AvioID END AS AvioID
                                    FROM dbo.ProductoAvios WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ID`) : { recordset: [] },
            rq().query(`SELECT ApliqueID, Posicion, AreaID, TecnicaOpcionID, Cantidad, Incluido, Orden
                        FROM dbo.ProductoApliques WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ApliqueID`),
            rq().query(`SELECT ci.ID, ci.ItemProIdProducto, ci.WmsVarianteId, ci.Cantidad, ci.Orden,
                               LTRIM(RTRIM(a.Descripcion)) AS ItemDescripcion,
                               v.nombre_variante AS VarianteNombre
                        FROM dbo.ProductoComboItems ci
                        LEFT JOIN dbo.Articulos a ON a.ProIdProducto = ci.ItemProIdProducto
                        LEFT JOIN dbo.Articulos_WMS_Variantes v ON v.wms_variante_id = ci.WmsVarianteId
                        WHERE ci.ProIdProducto = @PID ORDER BY ISNULL(ci.Orden, 999), ci.ID`),
            rq().query(`SELECT s.ComboItemID, s.AreaID, s.TecnicaOpcionID, s.Incluido, t.Nombre AS OpcionNombre
                        FROM dbo.ProductoComboItemServicios s
                        INNER JOIN dbo.ProductoComboItems ci ON ci.ID = s.ComboItemID
                        LEFT JOIN dbo.TecnicaOpciones t ON t.TecnicaOpcionID = s.TecnicaOpcionID
                        WHERE ci.ProIdProducto = @PID`),
            rq().query(`SELECT Ref, Marca, Material, Tallas, Marcacion, Colores, Proveedor, DibujoUrl
                        FROM dbo.ProductoFichaDiseno WHERE ProIdProducto = @PID`),
            // [ACCESORIOS] al final de la lista para no mover los índices anteriores
            rq().query(`SELECT AnotacionID, PosX, PosY, Texto FROM dbo.ProductoFichaDisenoAnotaciones
                        WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), AnotacionID`),
            rq().query(`SELECT ExtraID, Etiqueta, Valor FROM dbo.ProductoFichaDisenoExtra
                        WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ExtraID`),
            rq().query(`SELECT ID, UnionNombre, CodigoISO FROM dbo.ProductoFichaDisenoCosturas
                        WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ID`),
            conAcc ? rq().query(`SELECT ac.ID, ac.ItemProIdProducto, ac.WmsVarianteId, ac.Cantidad, ac.Obligatorio, ac.Cobro, ac.Orden, ac.WmsDepositoId,
                                        LTRIM(RTRIM(a.Descripcion)) AS ItemDescripcion, v.nombre_variante AS VarianteNombre
                                 FROM dbo.ProductoAccesorios ac
                                 LEFT JOIN dbo.Articulos a ON a.ProIdProducto = ac.ItemProIdProducto
                                 LEFT JOIN dbo.Articulos_WMS_Variantes v ON v.wms_variante_id = ac.WmsVarianteId
                                 WHERE ac.ProIdProducto = @PID ORDER BY ISNULL(ac.Orden, 999), ac.ID`) : { recordset: [] }
        ]);

        // Nombre del producto de origen (si hay)
        let origen = null;
        const origenId = config.recordset[0]?.OrigenProIdProducto;
        if (origenId) {
            const o = await pool.request().input('OID', sql.Int, origenId).query(`
                SELECT TOP 1 ProIdProducto, LTRIM(RTRIM(Descripcion)) AS Descripcion FROM dbo.Articulos
                WHERE ProIdProducto = @OID`);
            origen = o.recordset[0] || null;
        }

        res.json({
            success: true,
            data: {
                ...datos.recordset[0],
                config: config.recordset[0] || null,
                origen,
                tecnicas: tecnicas.recordset,
                opcionesPermitidas: opciones.recordset,
                surtido: surtido.recordset,
                modelos: modelos.recordset,
                telas: telas.recordset,
                avios: avios.recordset,
                apliques: apliques.recordset,
                accesorios: accesorios.recordset,   // [ACCESORIOS]
                comboItems: comboItems.recordset.map(ci => ({
                    ...ci,
                    servicios: comboSrv.recordset.filter(s => s.ComboItemID === ci.ID)
                })),
                fichaDiseno: fichaDiseno.recordset[0] || null,
                fichaDisenoAnotaciones: fdAnot.recordset,
                fichaDisenoExtra: fdExtra.recordset,
                fichaDisenoCosturas: fdCost.recordset
            }
        });
    } catch (e) {
        logger.error('[Configurador] getProductoFicha:', e);
        res.status(500).json({ error: e.message });
    }
};

// Reglas de venta compartidas entre crear y guardar
function validarVenta(body) {
    const errores = [];
    if (body.origenTipo !== undefined && body.origenTipo !== null && !ORIGENES.includes(body.origenTipo))
        errores.push(`OrigenTipo inválido (${ORIGENES.join(' | ')}).`);
    if (body.estado !== undefined && body.estado !== null && !ESTADOS.includes(body.estado))
        errores.push(`Estado inválido (${ESTADOS.join(' | ')}).`);
    for (const k of ['cantidadMinima', 'cantidadFija']) {
        const v = body[k];
        if (v !== undefined && v !== null && (!Number.isInteger(Number(v)) || Number(v) <= 0))
            errores.push(`${k} debe ser un entero mayor a 0 (o null).`);
    }
    if (body.cantidadMinima != null && body.cantidadFija != null)
        errores.push('CantidadMinima y CantidadFija son excluyentes: el paquete fijo ya bloquea la cantidad.');
    if (body.molde !== undefined && body.molde !== null && !MOLDES.includes(body.molde))
        errores.push(`Molde inválido (${MOLDES.join(' | ')}).`);
    if (body.um !== undefined && body.um !== null && !UMS.includes(body.um))
        errores.push(`UM inválida (${UMS.join(' | ')}).`);
    for (const k of ['anchoM', 'altoM', 'bordeCm']) {
        const v = body[k];
        if (v !== undefined && v !== null && v !== '' && !(Number(v) >= 0)) errores.push(`${k} debe ser un número mayor o igual a 0 (o vacío).`);
    }
    for (const t of (Array.isArray(body.tecnicas) ? body.tecnicas : [])) {
        if (!AREAS_TECNICA.includes(t.areaId)) errores.push(`Técnica con AreaID inválido: '${t.areaId}' (${AREAS_TECNICA.join(' | ')}).`);
        if (t.modo !== undefined && !MODOS.includes(t.modo)) errores.push(`Modo inválido en ${t.areaId} (${MODOS.join(' | ')}).`);
        if (t.cobro !== undefined && !COBROS.includes(t.cobro)) errores.push(`Cobro inválido en ${t.areaId} (${COBROS.join(' | ')}).`);
    }
    for (const ap of (Array.isArray(body.apliques) ? body.apliques : [])) {
        if (!ap.posicion || !String(ap.posicion).trim()) errores.push('Cada aplique necesita una Posición.');
        if (!AREAS_APLIQUE.includes(ap.areaId)) errores.push(`Aplique con AreaID inválido: '${ap.areaId}' (${AREAS_APLIQUE.join(' | ')}).`);
    }
    for (const a of (Array.isArray(body.fichaDisenoAnotaciones) ? body.fichaDisenoAnotaciones : [])) {
        if (a.x == null || a.y == null || !Number.isFinite(Number(a.x)) || !Number.isFinite(Number(a.y)))
            errores.push('Cada anotación de la ficha de diseño necesita posición X e Y.');
    }
    for (const c of (Array.isArray(body.fichaDisenoCosturas) ? body.fichaDisenoCosturas : [])) {
        if (!c.union || !String(c.union).trim()) errores.push('Cada costura de la ficha de diseño necesita un nombre de unión.');
        if (!c.iso || !String(c.iso).trim()) errores.push('Cada costura de la ficha de diseño necesita un código ISO.');
    }
    return errores;
}

// Reemplaza los sets hijos (solo los que vienen en el body; undefined = no tocar)
async function aplicarSetsHijos(transaction, proId, body, conTizada = false, conAcc = false) {
    const del = (tabla) => new sql.Request(transaction)
        .input('PID', sql.Int, proId)
        .query(`DELETE FROM dbo.${tabla} WHERE ProIdProducto = @PID`);

    if (body.tecnicas !== undefined) {
        await del('ProductoTerminadoServicios');
        for (const t of (body.tecnicas || [])) {
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .input('Area', sql.VarChar(10), t.areaId)
                .input('Obl', sql.Bit, t.obligatorio === false ? 0 : 1)
                .input('Modo', sql.VarChar(15), MODOS.includes(t.modo) ? t.modo : 'LIBRE')
                .input('Cobro', sql.VarChar(10), COBROS.includes(t.cobro) ? t.cobro : 'APARTE')
                .query(`INSERT INTO dbo.ProductoTerminadoServicios (ProIdProducto, AreaID, Obligatorio, Modo, Cobro)
                        VALUES (@PID, @Area, @Obl, @Modo, @Cobro)`);
        }
    }
    if (body.opcionesPermitidas !== undefined) {
        await del('ProductoTecnicaOpciones');
        for (const op of (body.opcionesPermitidas || [])) {
            const id = Number(op.tecnicaOpcionId ?? op);
            if (!Number.isInteger(id) || id <= 0) continue;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId).input('TOP', sql.Int, id)
                .query(`INSERT INTO dbo.ProductoTecnicaOpciones (ProIdProducto, TecnicaOpcionID) VALUES (@PID, @TOP)`);
        }
    }
    if (body.surtido !== undefined) {
        await del('ProductoOrigenVariantes');
        for (const v of (body.surtido || [])) {
            const id = Number(v.wmsVarianteId ?? v);
            if (!Number.isInteger(id)) continue;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId).input('VID', sql.Int, id)
                .query(`INSERT INTO dbo.ProductoOrigenVariantes (ProIdProducto, WmsVarianteId) VALUES (@PID, @VID)`);
        }
    }
    // Modelos del molde de TizadaPro que se ofrecen (clave de la variante + nombre copiado)
    if (body.modelos !== undefined && conTizada) {
        await del('ProductoModelos');
        let orden = 1;
        for (const m of (body.modelos || [])) {
            const clave = String(m.clave ?? m.modeloClave ?? '').trim().slice(0, 96);
            if (!clave) continue;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId).input('Cl', sql.NVarChar(96), clave)
                .input('Nom', sql.NVarChar(320), m.nombre ? String(m.nombre).trim().slice(0, 320) : null)
                .input('Def', sql.Bit, m.esDefault ? 1 : 0).input('Ord', sql.Int, orden)
                .query(`INSERT INTO dbo.ProductoModelos (ProIdProducto, ModeloClave, ModeloNombre, EsDefault, Orden) VALUES (@PID, @Cl, @Nom, @Def, @Ord)`);
            orden++;
        }
    }
    // Telas ofrecidas (el precio es el de PreciosBase de la tela; acá no se edita)
    if (body.telas !== undefined && conTizada) {
        await del('ProductoTelas');
        let orden = 1;
        for (const t of (body.telas || [])) {
            const telaId = Number(t.telaProIdProducto ?? t);
            if (!Number.isInteger(telaId) || telaId <= 0) continue;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId).input('Tela', sql.Int, telaId)
                .input('Def', sql.Bit, t.esDefault ? 1 : 0).input('Ord', sql.Int, orden)
                .query(`INSERT INTO dbo.ProductoTelas (ProIdProducto, TelaProIdProducto, EsDefault, Orden) VALUES (@PID, @Tela, @Def, @Ord)`);
            orden++;
        }
    }
    // Avíos: nombre libre + cantidad por prenda (+ artículo del insumo si existe, medida por talle y nota)
    if (body.avios !== undefined && conTizada) {
        const conAvioId = (await new sql.Request(transaction).query(`SELECT COL_LENGTH('dbo.ProductoAvios', 'AvioID') AS c`)).recordset[0].c != null;
        await del('ProductoAvios');
        let orden = 1;
        for (const av of (body.avios || [])) {
            const nombre = String(av.nombre || '').trim().slice(0, 200);
            if (!nombre) continue;
            const cant = Number(av.cantidad);
            const avioId = Number.isInteger(Number(av.avioId)) && Number(av.avioId) > 0 ? Number(av.avioId) : null;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId).input('Nom', sql.NVarChar(200), nombre).input('AvioID', sql.Int, avioId)
                .input('Art', sql.Int, Number.isInteger(Number(av.artProIdProducto)) && Number(av.artProIdProducto) > 0 ? Number(av.artProIdProducto) : null)
                .input('Cant', sql.Decimal(10, 2), Number.isFinite(cant) && cant > 0 ? cant : 1)
                .input('Uni', sql.NVarChar(20), av.unidad ? String(av.unidad).trim().slice(0, 20) : null)
                .input('Med', sql.NVarChar(200), av.medida ? String(av.medida).trim().slice(0, 200) : null)
                .input('Nota', sql.NVarChar(400), av.nota ? String(av.nota).trim().slice(0, 400) : null)
                .input('Ord', sql.Int, orden)
                .query(conAvioId
                    ? `INSERT INTO dbo.ProductoAvios (ProIdProducto, Nombre, ArtProIdProducto, Cantidad, Unidad, Medida, Nota, Orden, AvioID)
                        VALUES (@PID, @Nom, @Art, @Cant, @Uni, @Med, @Nota, @Ord, @AvioID)`
                    : `INSERT INTO dbo.ProductoAvios (ProIdProducto, Nombre, ArtProIdProducto, Cantidad, Unidad, Medida, Nota, Orden)
                        VALUES (@PID, @Nom, @Art, @Cant, @Uni, @Med, @Nota, @Ord)`);
            orden++;
        }
    }
    if (body.comboItems !== undefined) {
        // primero los servicios (FK a los ítems), después los ítems
        await new sql.Request(transaction).input('PID', sql.Int, proId).query(`
            DELETE s FROM dbo.ProductoComboItemServicios s
            INNER JOIN dbo.ProductoComboItems ci ON ci.ID = s.ComboItemID
            WHERE ci.ProIdProducto = @PID`);
        await del('ProductoComboItems');
        let ordenCI = 1;
        for (const it of (body.comboItems || [])) {
            const itemId = Number(it.itemProIdProducto);
            if (!Number.isInteger(itemId) || itemId <= 0) continue;
            const ins = await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .input('Item', sql.Int, itemId)
                .input('Var', sql.Int, Number.isInteger(Number(it.wmsVarianteId)) && Number(it.wmsVarianteId) > 0 ? Number(it.wmsVarianteId) : null)
                .input('Cnt', sql.Int, Number.isInteger(Number(it.cantidad)) && Number(it.cantidad) > 0 ? Number(it.cantidad) : 1)
                .input('Ord', sql.Int, ordenCI)
                .query(`INSERT INTO dbo.ProductoComboItems (ProIdProducto, ItemProIdProducto, WmsVarianteId, Cantidad, Orden)
                        OUTPUT INSERTED.ID
                        VALUES (@PID, @Item, @Var, @Cnt, @Ord)`);
            const comboItemId = ins.recordset[0].ID;
            for (const s of (Array.isArray(it.servicios) ? it.servicios : [])) {
                if (!AREAS_TECNICA.includes(s.areaId)) continue;
                await new sql.Request(transaction)
                    .input('CI', sql.Int, comboItemId)
                    .input('Area', sql.VarChar(10), s.areaId)
                    .input('TOP', sql.Int, Number.isInteger(Number(s.tecnicaOpcionId)) && Number(s.tecnicaOpcionId) > 0 ? Number(s.tecnicaOpcionId) : null)
                    .input('Inc', sql.Bit, s.incluido === false ? 0 : 1)
                    .query(`INSERT INTO dbo.ProductoComboItemServicios (ComboItemID, AreaID, TecnicaOpcionID, Incluido)
                            VALUES (@CI, @Area, @TOP, @Inc)`);
            }
            ordenCI++;
        }
    }
    // [ACCESORIOS] artículos de stock que salen con el producto (se pisan enteros, como el resto de las listas)
    if (conAcc && body.accesorios !== undefined) {
        await new sql.Request(transaction).input('PID', sql.Int, proId).query(`DELETE FROM dbo.ProductoAccesorios WHERE ProIdProducto = @PID`);
        let ordenAc = 1;
        for (const ac of (body.accesorios || [])) {
            const itemId = Number(ac.itemProIdProducto);
            if (!Number.isInteger(itemId) || itemId <= 0) continue;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .input('Item', sql.Int, itemId)
                .input('Var', sql.Int, Number.isInteger(Number(ac.wmsVarianteId)) && Number(ac.wmsVarianteId) > 0 ? Number(ac.wmsVarianteId) : null)
                .input('Cnt', sql.Int, Number.isInteger(Number(ac.cantidad)) && Number(ac.cantidad) > 0 ? Number(ac.cantidad) : 1)
                .input('Obl', sql.Bit, ac.obligatorio === false ? 0 : 1)
                .input('Cob', sql.VarChar(10), COBROS_ACCESORIO.includes(ac.cobro) ? ac.cobro : 'INCLUIDO')
                .input('Ord', sql.Int, ordenAc++)
                // depósito del WMS de donde sale (NULL = el de ventas)
                .input('Dep', sql.Int, Number.isInteger(Number(ac.wmsDepositoId)) && Number(ac.wmsDepositoId) > 0 ? Number(ac.wmsDepositoId) : null)
                .query(`INSERT INTO dbo.ProductoAccesorios (ProIdProducto, ItemProIdProducto, WmsVarianteId, Cantidad, Obligatorio, Cobro, Orden, WmsDepositoId)
                        VALUES (@PID, @Item, @Var, @Cnt, @Obl, @Cob, @Ord, @Dep)`);
        }
    }
    if (body.apliques !== undefined) {
        await del('ProductoApliques');
        let orden = 1;
        for (const ap of (body.apliques || [])) {
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .input('Pos', sql.NVarChar(100), String(ap.posicion).trim())
                .input('Area', sql.VarChar(10), ap.areaId)
                .input('TOP', sql.Int, Number.isInteger(Number(ap.tecnicaOpcionId)) && Number(ap.tecnicaOpcionId) > 0 ? Number(ap.tecnicaOpcionId) : null)
                .input('Cnt', sql.Int, Number.isInteger(Number(ap.cantidad)) && Number(ap.cantidad) > 0 ? Number(ap.cantidad) : 1)
                .input('Inc', sql.Bit, ap.incluido === false ? 0 : 1)
                .input('Ord', sql.Int, Number.isInteger(Number(ap.orden)) ? Number(ap.orden) : orden)
                .query(`INSERT INTO dbo.ProductoApliques (ProIdProducto, Posicion, AreaID, TecnicaOpcionID, Cantidad, Incluido, Orden)
                        VALUES (@PID, @Pos, @Area, @TOP, @Cnt, @Inc, @Ord)`);
            orden++;
        }
    }
    if (body.fichaDisenoAnotaciones !== undefined) {
        await del('ProductoFichaDisenoAnotaciones');
        let orden = 1;
        for (const a of (body.fichaDisenoAnotaciones || [])) {
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .input('X', sql.Decimal(5, 2), Number(a.x) || 0)
                .input('Y', sql.Decimal(5, 2), Number(a.y) || 0)
                .input('Texto', sql.VarChar(300), String(a.texto || '').trim() || 'Detalle')
                .input('Ord', sql.Int, orden)
                .query(`INSERT INTO dbo.ProductoFichaDisenoAnotaciones (ProIdProducto, PosX, PosY, Texto, Orden)
                        VALUES (@PID, @X, @Y, @Texto, @Ord)`);
            orden++;
        }
    }
    if (body.fichaDisenoExtra !== undefined) {
        await del('ProductoFichaDisenoExtra');
        let orden = 1;
        for (const c of (body.fichaDisenoExtra || [])) {
            if (!c.label || !String(c.label).trim()) continue;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .input('Et', sql.VarChar(100), String(c.label).trim())
                .input('Val', sql.VarChar(300), c.valor != null && c.valor !== '' ? String(c.valor) : null)
                .input('Ord', sql.Int, orden)
                .query(`INSERT INTO dbo.ProductoFichaDisenoExtra (ProIdProducto, Etiqueta, Valor, Orden)
                        VALUES (@PID, @Et, @Val, @Ord)`);
            orden++;
        }
    }
    if (body.fichaDisenoCosturas !== undefined) {
        await del('ProductoFichaDisenoCosturas');
        let orden = 1;
        for (const c of (body.fichaDisenoCosturas || [])) {
            if (!c.union || !String(c.union).trim() || !c.iso) continue;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .input('Un', sql.VarChar(100), String(c.union).trim())
                .input('Iso', sql.VarChar(20), String(c.iso).trim())
                .input('Ord', sql.Int, orden)
                .query(`INSERT INTO dbo.ProductoFichaDisenoCosturas (ProIdProducto, UnionNombre, CodigoISO, Orden)
                        VALUES (@PID, @Un, @Iso, @Ord)`);
            orden++;
        }
    }
}

// PUT /api/configurador/productos/:proId — guarda config + sets (transaccional)
exports.guardarProductoConfig = async (req, res) => {
    const proId = parseInt(req.params.proId, 10);
    if (!Number.isInteger(proId)) return res.status(400).json({ error: 'ProIdProducto inválido.' });
    const body = req.body || {};
    const errores = validarVenta(body);
    if (errores.length) return res.status(400).json({ error: errores.join(' ') });
    try {
        const pool = await getPool();

        const existe = await pool.request().input('PID', sql.Int, proId)
            .query(`SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @PID AND ISNULL(borrar,0) = 0`);
        if (!existe.recordset.length) return res.status(404).json({ error: 'Producto no encontrado.' });

        if (body.origenProIdProducto != null) {
            const o = await pool.request().input('OID', sql.Int, Number(body.origenProIdProducto))
                .query(`SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @OID AND ISNULL(borrar,0) = 0`);
            if (!o.recordset.length) return res.status(400).json({ error: 'El producto de origen no existe.' });
        }

        const conTizada = await tieneTizadaPro(pool);
        const conAcc = await tieneAccesorios(pool);   // [ACCESORIOS]
        const conF1 = await tieneF1(pool);
        if (conF1 && body.tecnicaPrincipal !== undefined && !(await areaPrincipalValida(pool, body.tecnicaPrincipal)))
            return res.status(400).json({ error: `La producción principal '${body.tecnicaPrincipal}' no es un área de producción (ConfigMapeoERP).` });
        const dec = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            // Upsert de ProductoVentaConfig (solo pisa los campos que vienen)
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .input('Ori', sql.VarChar(15), body.origenTipo !== undefined ? body.origenTipo : null)
                .input('OriPID', sql.Int, body.origenProIdProducto !== undefined ? (body.origenProIdProducto == null ? null : Number(body.origenProIdProducto)) : null)
                .input('OriPIDSet', sql.Bit, body.origenProIdProducto !== undefined ? 1 : 0)
                .input('Min', sql.Int, body.cantidadMinima !== undefined ? (body.cantidadMinima == null ? null : Number(body.cantidadMinima)) : null)
                .input('MinSet', sql.Bit, body.cantidadMinima !== undefined ? 1 : 0)
                .input('Fija', sql.Int, body.cantidadFija !== undefined ? (body.cantidadFija == null ? null : Number(body.cantidadFija)) : null)
                .input('FijaSet', sql.Bit, body.cantidadFija !== undefined ? 1 : 0)
                .input('VStock', sql.Bit, body.validarStock !== undefined ? (body.validarStock ? 1 : 0) : null)
                .input('Est', sql.VarChar(12), body.estado !== undefined ? body.estado : null)
                .input('MRef', sql.NVarChar(128), body.tizadaProMoldeRef !== undefined ? (body.tizadaProMoldeRef ? String(body.tizadaProMoldeRef).trim().slice(0, 128) : null) : null)
                .input('MRefSet', sql.Bit, body.tizadaProMoldeRef !== undefined && conTizada ? 1 : 0)
                // F1: producción principal, molde, UM, medida fija y canales (cada grupo se pisa solo si viene)
                .input('TP', sql.VarChar(10), body.tecnicaPrincipal ? String(body.tecnicaPrincipal).trim().toUpperCase() : null)
                .input('TPSet', sql.Bit, body.tecnicaPrincipal !== undefined && conF1 ? 1 : 0)
                .input('Mol', sql.VarChar(12), body.molde || null)
                .input('MolSet', sql.Bit, body.molde !== undefined && conF1 ? 1 : 0)
                .input('UMv', sql.VarChar(3), body.um || null)
                .input('UMSet', sql.Bit, body.um !== undefined && conF1 ? 1 : 0)
                .input('AnchoM', sql.Decimal(10, 3), dec(body.anchoM)).input('AltoM', sql.Decimal(10, 3), dec(body.altoM)).input('BordeCm', sql.Decimal(6, 2), dec(body.bordeCm))
                .input('MedSet', sql.Bit, (body.anchoM !== undefined || body.altoM !== undefined) && conF1 ? 1 : 0)
                .input('VP', sql.Bit, body.visiblePortal !== undefined ? (body.visiblePortal ? 1 : 0) : null)
                .input('VT', sql.Bit, body.visibleTienda !== undefined ? (body.visibleTienda ? 1 : 0) : null)
                .input('VI', sql.Bit, body.visibleInterno !== undefined ? (body.visibleInterno ? 1 : 0) : null)
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @PID)
                        UPDATE dbo.ProductoVentaConfig SET
                            OrigenTipo          = ISNULL(@Ori, OrigenTipo),
                            OrigenProIdProducto = CASE WHEN @OriPIDSet = 1 THEN @OriPID ELSE OrigenProIdProducto END,
                            CantidadMinima      = CASE WHEN @MinSet  = 1 THEN @Min  ELSE CantidadMinima END,
                            CantidadFija        = CASE WHEN @FijaSet = 1 THEN @Fija ELSE CantidadFija END,
                            ValidarStock        = ISNULL(@VStock, ValidarStock),
                            Estado              = ISNULL(@Est, Estado),
                            ${conTizada ? 'TizadaProMoldeRef = CASE WHEN @MRefSet = 1 THEN @MRef ELSE TizadaProMoldeRef END,' : ''}
                            ${conF1 ? `TecnicaPrincipal = CASE WHEN @TPSet = 1 THEN @TP ELSE TecnicaPrincipal END,
                            Molde  = CASE WHEN @MolSet = 1 THEN ISNULL(@Mol, Molde) ELSE Molde END,
                            UM     = CASE WHEN @UMSet = 1 THEN ISNULL(@UMv, UM) ELSE UM END,
                            AnchoM = CASE WHEN @MedSet = 1 THEN @AnchoM ELSE AnchoM END,
                            AltoM  = CASE WHEN @MedSet = 1 THEN @AltoM ELSE AltoM END,
                            BordeCm = CASE WHEN @MedSet = 1 THEN @BordeCm ELSE BordeCm END,
                            VisiblePortal  = ISNULL(@VP, VisiblePortal),
                            VisibleTienda  = ISNULL(@VT, VisibleTienda),
                            VisibleInterno = ISNULL(@VI, VisibleInterno),` : ''}
                            FechaModif          = GETDATE()
                        WHERE ProIdProducto = @PID
                    ELSE
                        INSERT INTO dbo.ProductoVentaConfig
                            (ProIdProducto, OrigenTipo, OrigenProIdProducto, CantidadMinima, CantidadFija, ValidarStock, Estado${conTizada ? ', TizadaProMoldeRef' : ''}${conF1 ? ', ' + F1_COLS : ''})
                        VALUES (@PID, ISNULL(@Ori,'CONFECCIONADO'), @OriPID, @Min, @Fija, ISNULL(@VStock,1), ISNULL(@Est,'BORRADOR')${conTizada ? ', @MRef' : ''}${conF1 ? ", ISNULL(@TP,'SB'), @AnchoM, @AltoM, @BordeCm, ISNULL(@UMv,'u'), ISNULL(@Mol,'OBLIGATORIO'), ISNULL(@VP,0), ISNULL(@VT,0), ISNULL(@VI,1)" : ''})
                `);

            // Upsert de ProductoFichaDiseno (encabezado + campos del pie) — todo o nada,
            // el form de la ficha se guarda como una unidad, no campo por campo.
            if (body.fichaDiseno !== undefined) {
                const fd = body.fichaDiseno || {};
                await new sql.Request(transaction)
                    .input('PID', sql.Int, proId)
                    .input('Ref', sql.VarChar(50), fd.ref ? String(fd.ref).trim() : null)
                    .input('Marca', sql.VarChar(50), fd.marca ? String(fd.marca).trim() : 'USER')
                    .input('Material', sql.VarChar(200), fd.material ? String(fd.material).trim() : null)
                    .input('Tallas', sql.VarChar(200), fd.tallas ? String(fd.tallas).trim() : null)
                    .input('Marcacion', sql.VarChar(500), fd.marcacion ? String(fd.marcacion).trim() : null)
                    .input('Colores', sql.VarChar(200), fd.colores ? String(fd.colores).trim() : null)
                    .input('Proveedor', sql.VarChar(200), fd.proveedor ? String(fd.proveedor).trim() : null)
                    .query(`
                        IF EXISTS (SELECT 1 FROM dbo.ProductoFichaDiseno WHERE ProIdProducto = @PID)
                            UPDATE dbo.ProductoFichaDiseno SET
                                Ref = @Ref, Marca = @Marca, Material = @Material, Tallas = @Tallas,
                                Marcacion = @Marcacion, Colores = @Colores, Proveedor = @Proveedor,
                                FechaModif = GETDATE()
                            WHERE ProIdProducto = @PID
                        ELSE
                            INSERT INTO dbo.ProductoFichaDiseno
                                (ProIdProducto, Ref, Marca, Material, Tallas, Marcacion, Colores, Proveedor)
                            VALUES (@PID, @Ref, @Marca, @Material, @Tallas, @Marcacion, @Colores, @Proveedor)
                    `);
            }

            await aplicarSetsHijos(transaction, proId, body, conTizada, conAcc);

            // Para PUBLICAR un confeccionado: molde de TizadaPro definido y cada aplique sobre una
            // técnica que el producto tiene activa (se valida contra lo que quedó guardado).
            const estadoFinal = await new sql.Request(transaction).input('PID', sql.Int, proId)
                .query(`SELECT Estado, OrigenTipo, ISNULL(EsCombo, 0) AS EsCombo${conTizada ? ', TizadaProMoldeRef' : ''}${conF1 ? ', Molde, AnchoM, AltoM, TecnicaPrincipal' : ''} FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @PID`);
            const ef = estadoFinal.recordset[0];
            if (ef && ef.Estado === 'PUBLICADO' && !ef.EsCombo && ef.OrigenTipo === 'CONFECCIONADO') {
                const faltas = [];
                // F1: el molde es obligatorio solo si el producto lo dice (Molde = OBLIGATORIO, el caso de las
                // prendas). Con molde OPCIONAL o NO y sin molde vinculado, hace falta la medida fija.
                const molde = conF1 ? (ef.Molde || 'OBLIGATORIO') : 'OBLIGATORIO';
                if (conTizada && molde === 'OBLIGATORIO' && !ef.TizadaProMoldeRef) faltas.push('Falta vincular el molde de TizadaPro (paso "Molde, telas y apliques"), o marcá en "Producción principal" que el molde es opcional o que no lleva.');
                if (conF1 && molde !== 'OBLIGATORIO' && !ef.TizadaProMoldeRef && !(Number(ef.AnchoM) > 0 && Number(ef.AltoM) > 0)) faltas.push('Sin molde, el producto necesita su medida fija (ancho × alto en metros) en "Producción principal".');
                if (conF1 && !ef.TecnicaPrincipal) faltas.push('Falta la producción principal (qué área lo produce) en "Producción principal".');
                const chk = await new sql.Request(transaction).input('PID', sql.Int, proId).query(`
                    SELECT DISTINCT ap.AreaID FROM dbo.ProductoApliques ap
                    WHERE ap.ProIdProducto = @PID AND ap.AreaID <> 'ETIQUETA'
                      AND NOT EXISTS (SELECT 1 FROM dbo.ProductoTerminadoServicios s WHERE s.ProIdProducto = @PID AND s.AreaID = ap.AreaID)`);
                if (chk.recordset.length) faltas.push(`Hay apliques de una técnica que el producto no tiene activa (${chk.recordset.map(x => x.AreaID).join(', ')}): activala en "Técnicas" o quitá el aplique.`);
                if (faltas.length) { const e = new Error('No se puede publicar. ' + faltas.join(' ')); e.status = 400; throw e; }
            }
            await transaction.commit();
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

        // F1: puente de visibilidad hacia la tienda (hasta que la tienda lea VisibleTienda)
        if (conF1 && body.visibleTienda !== undefined) await puenteTienda(pool, proId, !!body.visibleTienda);

        // Precio (base o de paquete) → PreciosBase, con el CodArticulo del artículo
        if (body.precio !== undefined && body.precio !== null && body.precio !== '') {
            const cod = await pool.request().input('PID', sql.Int, proId)
                .query(`SELECT TOP 1 LTRIM(RTRIM(CodArticulo)) AS Cod FROM dbo.Articulos WHERE ProIdProducto = @PID`);
            await upsertPrecioBase(pool, cod.recordset[0].Cod, parseFloat(body.precio) || 0, body.moneda);
        }

        logger.info(`[Configurador] Config guardada para ProIdProducto ${proId} por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        if (e.status) return res.status(e.status).json({ error: e.message });   // regla de negocio (ej. no se puede publicar)
        logger.error('[Configurador] guardarProductoConfig:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/configurador/productos — alta de artículo nuevo (producto o combo)
// Patrón del gestor de PT de ECOUV (CodArticulo = IDProdReact = ProIdProducto)
// pero con el grupo de PRENDAS: SupFlia '2', Grupo '2.1', CodStock '2.2.1.3'.
exports.crearProducto = async (req, res) => {
    const { descripcion, codStock, mostrar, precio, moneda, esCombo } = req.body || {};
    if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    const errores = validarVenta(req.body || {});
    if (errores.length) return res.status(400).json({ error: errores.join(' ') });
    try {
        const pool = await getPool();
        const conF1 = await tieneF1(pool);
        // F1: producción principal del producto nuevo (SB si no viene). Su molde: obligatorio con SB, "no lleva" en el resto.
        const principal = !esCombo && conF1 ? String(req.body.tecnicaPrincipal || 'SB').trim().toUpperCase() : (esCombo ? null : 'SB');
        if (conF1 && principal && !(await areaPrincipalValida(pool, principal))) return res.status(400).json({ error: `La producción principal '${principal}' no es un área de producción (ConfigMapeoERP).` });
        const moldeInicial = MOLDES.includes(req.body.molde) ? req.body.molde : (principal === 'SB' ? 'OBLIGATORIO' : 'NO');
        // Los combos nacen en su propia categoría de artículos (StockArt 2.2.1.4 'Combos')
        const stock = String(codStock || (esCombo ? '2.2.1.4' : '2.2.1.3')).trim();

        const sa = await pool.request().input('CS', sql.VarChar(50), stock).query(`
            SELECT TOP 1 LTRIM(RTRIM(SupFlia)) AS SupFlia, LTRIM(RTRIM(Grupo)) AS Grupo
            FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = @CS`);
        if (!sa.recordset.length) return res.status(400).json({ error: `La variante ${stock} no existe en StockArt.` });

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        let proId;
        try {
            const ins = await new sql.Request(transaction)
                .input('Desc',  sql.VarChar(255), descripcion.trim())
                .input('Stock', sql.VarChar(50), stock)
                .input('Sup',   sql.VarChar(10), sa.recordset[0].SupFlia)
                .input('Gru',   sql.VarChar(10), sa.recordset[0].Grupo)
                .input('Mos',   sql.Bit, mostrar === false ? 0 : 1)
                .input('MonId', sql.Int, (String(moneda || 'UYU').toUpperCase() === 'USD') ? 2 : 1)
                .query(`
                    INSERT INTO dbo.Articulos
                        (CodArticulo, IDProdReact, Descripcion, CodStock, Grupo, SupFlia, Mostrar, MonIdMoneda, borrar)
                    OUTPUT INSERTED.ProIdProducto
                    VALUES ('CFG-TMP', NULL, @Desc, @Stock, @Gru, @Sup, @Mos, @MonId, 0)
                `);
            proId = ins.recordset[0].ProIdProducto;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                .query(`UPDATE dbo.Articulos SET CodArticulo = CAST(ProIdProducto AS VARCHAR(50)),
                        IDProdReact = ProIdProducto WHERE ProIdProducto = @PID`);

            // Config inicial (BORRADOR salvo que venga otra cosa)
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId)
                // Confeccionado por default: este catálogo se fabrica a pedido salvo que
                // se pida explícitamente Local/Cliente/Ambos (12-ago, decisión del usuario).
                .input('Ori', sql.VarChar(15), ORIGENES.includes(req.body.origenTipo) ? req.body.origenTipo : 'CONFECCIONADO')
                .input('OriPID', sql.Int, req.body.origenProIdProducto != null ? Number(req.body.origenProIdProducto) : null)
                .input('Min', sql.Int, req.body.cantidadMinima != null ? Number(req.body.cantidadMinima) : null)
                .input('Fija', sql.Int, req.body.cantidadFija != null ? Number(req.body.cantidadFija) : null)
                .input('VStock', sql.Bit, req.body.validarStock === false ? 0 : 1)
                .input('Est', sql.VarChar(12), ESTADOS.includes(req.body.estado) ? req.body.estado : 'BORRADOR')
                .input('Combo', sql.Bit, esCombo ? 1 : 0)
                .input('TP', sql.VarChar(10), principal).input('Mol', sql.VarChar(12), moldeInicial).input('UMv', sql.VarChar(3), UMS.includes(req.body.um) ? req.body.um : 'u')
                .query(`INSERT INTO dbo.ProductoVentaConfig
                            (ProIdProducto, OrigenTipo, OrigenProIdProducto, CantidadMinima, CantidadFija, ValidarStock, Estado, EsCombo${conF1 ? ', TecnicaPrincipal, Molde, UM' : ''})
                        VALUES (@PID, @Ori, @OriPID, @Min, @Fija, @VStock, @Est, @Combo${conF1 ? ', @TP, @Mol, @UMv' : ''})`);

            await aplicarSetsHijos(transaction, proId, req.body);
            // Un confeccionado nuevo nace con las técnicas de CONSTRUCCIÓN (sublimación, corte y
            // costura) obligatorias e incluidas en el precio (decisión del usuario, 28-sep). Solo si
            // el alta no trajo técnicas propias.
            if (!esCombo && req.body.tecnicas === undefined) {
                for (const area of [principal || 'SB', 'TWC', 'TWT']) {
                    await new sql.Request(transaction).input('PID', sql.Int, proId).input('Area', sql.VarChar(10), area)
                        .query(`INSERT INTO dbo.ProductoTerminadoServicios (ProIdProducto, AreaID, Obligatorio, Modo, Cobro)
                                VALUES (@PID, @Area, 1, 'LIBRE', 'INCLUIDA')`);
                }
            }
            await transaction.commit();
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

        if (precio !== undefined && precio !== null && precio !== '') {
            await upsertPrecioBase(pool, String(proId), parseFloat(precio) || 0, moneda);
        }

        logger.info(`[Configurador] Producto creado: '${descripcion.trim()}' (cod/id ${proId}) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true, codArticulo: String(proId), proIdProducto: proId });
    } catch (e) {
        logger.error('[Configurador] crearProducto:', e);
        res.status(500).json({ error: e.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════
//  CATÁLOGO DE TÉCNICAS (TecnicaOpciones)
// ═════════════════════════════════════════════════════════════════════════

// GET /api/configurador/tecnicas (?all=1 incluye inactivas)
exports.getTecnicas = async (req, res) => {
    try {
        const pool = await getPool();
        const all = req.query.all === '1';
        const r = await pool.request().query(`
            SELECT t.TecnicaOpcionID, t.AreaID, t.Nombre, t.CodArticulo, t.AnchoCm, t.AltoCm,
                   t.Activo, t.Orden, pb.Precio, pb.Moneda
            FROM dbo.TecnicaOpciones t
            OUTER APPLY (SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase p
                         WHERE LTRIM(RTRIM(p.CodArticulo)) = LTRIM(RTRIM(t.CodArticulo))
                         ORDER BY p.UltimaActualizacion DESC) pb
            ${all ? '' : 'WHERE t.Activo = 1'}
            ORDER BY t.AreaID, ISNULL(t.Orden, 999), t.Nombre
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[Configurador] getTecnicas:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/configurador/tecnicas
exports.crearTecnicaOpcion = async (req, res) => {
    const { areaId, nombre, codArticulo, anchoCm, altoCm, orden, precio, moneda } = req.body || {};
    if (!AREAS_TECNICA.includes(areaId)) return res.status(400).json({ error: `AreaID inválido (${AREAS_TECNICA.join(' | ')}).` });
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Area', sql.VarChar(10), areaId)
            .input('Nom', sql.NVarChar(100), nombre.trim())
            .input('Cod', sql.VarChar(50), codArticulo ? String(codArticulo).trim() : null)
            .input('An', sql.Decimal(9, 2), anchoCm != null && anchoCm !== '' ? anchoCm : null)
            .input('Al', sql.Decimal(9, 2), altoCm != null && altoCm !== '' ? altoCm : null)
            .input('Ord', sql.Int, Number.isInteger(Number(orden)) ? Number(orden) : null)
            .query(`INSERT INTO dbo.TecnicaOpciones (AreaID, Nombre, CodArticulo, AnchoCm, AltoCm, Orden)
                    OUTPUT INSERTED.TecnicaOpcionID
                    VALUES (@Area, @Nom, @Cod, @An, @Al, @Ord)`);
        if (precio !== undefined && precio !== null && precio !== '' && codArticulo) {
            await upsertPrecioBase(pool, String(codArticulo).trim(), parseFloat(precio) || 0, moneda);
        }
        res.json({ success: true, tecnicaOpcionId: r.recordset[0].TecnicaOpcionID });
    } catch (e) {
        if (/UQ_TecnicaOpciones/.test(e.message)) return res.status(409).json({ error: 'Ya existe una opción con ese nombre en esa técnica.' });
        logger.error('[Configurador] crearTecnicaOpcion:', e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/configurador/tecnicas/:id
exports.updateTecnicaOpcion = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const { nombre, codArticulo, anchoCm, altoCm, activo, orden, precio, moneda } = req.body || {};
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('ID', sql.Int, id)
            .input('Nom', sql.NVarChar(100), nombre !== undefined ? String(nombre).trim() : null)
            .input('Cod', sql.VarChar(50), codArticulo !== undefined ? (codArticulo ? String(codArticulo).trim() : null) : null)
            .input('CodSet', sql.Bit, codArticulo !== undefined ? 1 : 0)
            .input('An', sql.Decimal(9, 2), anchoCm !== undefined ? (anchoCm === '' || anchoCm == null ? null : anchoCm) : null)
            .input('AnSet', sql.Bit, anchoCm !== undefined ? 1 : 0)
            .input('Al', sql.Decimal(9, 2), altoCm !== undefined ? (altoCm === '' || altoCm == null ? null : altoCm) : null)
            .input('AlSet', sql.Bit, altoCm !== undefined ? 1 : 0)
            .input('Act', sql.Bit, activo !== undefined ? (activo ? 1 : 0) : null)
            .input('Ord', sql.Int, orden !== undefined ? (Number.isInteger(Number(orden)) ? Number(orden) : null) : null)
            .input('OrdSet', sql.Bit, orden !== undefined ? 1 : 0)
            .query(`UPDATE dbo.TecnicaOpciones SET
                        Nombre  = ISNULL(@Nom, Nombre),
                        CodArticulo = CASE WHEN @CodSet = 1 THEN @Cod ELSE CodArticulo END,
                        AnchoCm = CASE WHEN @AnSet = 1 THEN @An ELSE AnchoCm END,
                        AltoCm  = CASE WHEN @AlSet = 1 THEN @Al ELSE AltoCm END,
                        Activo  = ISNULL(@Act, Activo),
                        Orden   = CASE WHEN @OrdSet = 1 THEN @Ord ELSE Orden END
                    WHERE TecnicaOpcionID = @ID`);
        if (!r.rowsAffected[0]) return res.status(404).json({ error: 'Opción no encontrada.' });
        if (precio !== undefined && precio !== null && precio !== '') {
            const cod = await pool.request().input('ID', sql.Int, id)
                .query(`SELECT CodArticulo FROM dbo.TecnicaOpciones WHERE TecnicaOpcionID = @ID`);
            const c = cod.recordset[0]?.CodArticulo;
            if (c) await upsertPrecioBase(pool, String(c).trim(), parseFloat(precio) || 0, moneda);
        }
        res.json({ success: true });
    } catch (e) {
        if (/UQ_TecnicaOpciones/.test(e.message)) return res.status(409).json({ error: 'Ya existe una opción con ese nombre en esa técnica.' });
        logger.error('[Configurador] updateTecnicaOpcion:', e);
        res.status(500).json({ error: e.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════
//  PRODUCTOS DEL LOCAL (selector del paso Origen)
// ═════════════════════════════════════════════════════════════════════════

// [ACCESORIOS] GET /api/configurador/depositos-wms — depósitos del WMS de donde puede salir un accesorio.
// Del WMS propio (Wms_Depositos) si está cargado; si no, los tres conocidos del WMS externo.
const DEPOSITOS_WMS_FALLBACK = [
    { DepId: 5, Nombre: 'Ventas (local)', Tipo: 'ventas' },
    { DepId: 1, Nombre: 'Centro de stock general', Tipo: 'central' },
    { DepId: 3, Nombre: 'ECOUV', Tipo: 'sector' },
];
exports.getDepositosWms = async (req, res) => {
    try {
        const pool = await getPool();
        let lista = [];
        try {
            const r = await pool.request().query(`IF OBJECT_ID('dbo.Wms_Depositos', 'U') IS NOT NULL SELECT DepId, Nombre, Tipo FROM dbo.Wms_Depositos WHERE ISNULL(Activo, 1) = 1 ORDER BY DepId`);
            lista = r.recordset || [];
        } catch (_) { lista = []; }
        const porDefecto = parseInt(process.env.WMS_DEPOSITO_LOCAL_ID, 10) || 5;
        res.json({ success: true, data: (lista.length ? lista : DEPOSITOS_WMS_FALLBACK).map(d => ({ ...d, PorDefecto: d.DepId === porDefecto })), porDefecto });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
// [ACCESORIOS] GET /api/configurador/stock-wms/:depositoId — stock vivo por variante en ESE depósito
exports.getStockWms = async (req, res) => {
    try {
        const dep = parseInt(req.params.depositoId, 10);
        if (!dep) return res.status(400).json({ error: 'Depósito inválido.' });
        const map = await fetchStockLocalWms(dep);
        res.json({ success: true, data: map || {}, stockDisponible: map !== null });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /api/configurador/productos-local (?q= busca por nombre)
// Artículos del local (SupFlia 2) que tienen variantes WMS, con stock vivo
// del depósito del local si el WMS contesta (si no, stockDisponible=false y
// las cantidades van null — la pantalla lo muestra igual).
exports.getProductosLocal = async (req, res) => {
    try {
        const pool = await getPool();
        const q = (req.query.q || '').trim();
        const todos = String(req.query.todos || '') === '1';   // [ACCESORIOS] sin filtro de familia
        const request = pool.request();
        if (q) request.input('Q', sql.NVarChar, `%${q}%`);
        const r = await request.query(`
            SELECT a.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                   LTRIM(RTRIM(a.CodStock)) AS CodStock,
                   v.wms_variante_id, v.sku, v.nombre_variante,
                   loc.pasillo, loc.estante, pb.Precio, pb.Moneda,
                   img.url_imagen
            FROM dbo.Articulos a
            INNER JOIN dbo.Articulos_WMS_Variantes v ON v.Idproid = a.ProIdProducto
            LEFT JOIN dbo.Articulos_UbicacionLocal loc ON loc.Idproid = a.ProIdProducto
            OUTER APPLY (SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase p
                         WHERE p.ProIdProducto = a.ProIdProducto
                         ORDER BY p.UltimaActualizacion DESC) pb
            OUTER APPLY (SELECT TOP 1 url_imagen FROM (
                             SELECT i.url_imagen, i.orden FROM dbo.Articulos_Imagenes i WHERE i.Idproid = a.ProIdProducto
                             UNION ALL
                             -- [FOTO ÚNICA] sin foto de catálogo, vale el dibujo de la ficha técnica
                             SELECT f.DibujoUrl, 9999 FROM dbo.ProductoFichaDiseno f WHERE f.ProIdProducto = a.ProIdProducto AND f.DibujoUrl IS NOT NULL
                         ) x ORDER BY x.orden) img
            WHERE ${todos ? '1 = 1' : "LTRIM(RTRIM(a.SupFlia)) = '2'"} AND ISNULL(a.borrar, 0) = 0
              ${q ? 'AND a.Descripcion LIKE @Q' : ''}
            ORDER BY a.Descripcion, v.nombre_variante
        `);

        const stockMap = await fetchStockLocalWms();   // null = WMS caído
        const productos = {};
        for (const row of r.recordset) {
            if (!productos[row.ProIdProducto]) {
                productos[row.ProIdProducto] = {
                    ProIdProducto: row.ProIdProducto,
                    Descripcion: row.Descripcion,
                    CodStock: row.CodStock,
                    Imagen: row.url_imagen || null,
                    ubicacion: { pasillo: row.pasillo, estante: row.estante },
                    Precio: row.Precio, Moneda: row.Moneda,
                    totalStock: stockMap ? 0 : null,
                    variantes: []
                };
            }
            const stock = stockMap ? (stockMap[row.wms_variante_id] || 0) : null;
            if (stockMap) productos[row.ProIdProducto].totalStock += stock;
            productos[row.ProIdProducto].variantes.push({
                wmsVarianteId: row.wms_variante_id,
                sku: row.sku || '',
                nombre: row.nombre_variante || 'Única',
                stock
            });
        }
        res.json({ success: true, stockDisponible: !!stockMap, data: Object.values(productos) });
    } catch (e) {
        logger.error('[Configurador] getProductosLocal:', e);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/configurador/costuras-iso — catálogo chico para el selector de la
// ficha de diseño (clasificación ISO 4915, no el catálogo de operaciones/SAM)
exports.getCosturasIso = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT CosturaISOID, CodigoISO, Nombre, Activo FROM dbo.CosturasISO
            ${req.query.all === '1' ? '' : 'WHERE Activo = 1'} ORDER BY CodigoISO`);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[Configurador] getCosturasIso:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/configurador/productos/:proId/ficha-diseno/dibujo — dibujo técnico
// anotable de la ficha (multipart). NO es la foto de catálogo (Articulos_Imagenes,
// esa la maneja products-integration/upload-image) — es un archivo aparte.
exports.subirDibujoFicha = async (req, res) => {
    const proId = parseInt(req.params.proId, 10);
    if (!Number.isInteger(proId)) return res.status(400).json({ error: 'ProIdProducto inválido.' });
    if (!req.file) return res.status(400).json({ error: 'No se subió ninguna imagen.' });
    try {
        const pool = await getPool();
        const dibujoUrl = `/uploads/fichas-diseno/${req.file.filename}`;
        await pool.request()
            .input('PID', sql.Int, proId)
            .input('Url', sql.VarChar(500), dibujoUrl)
            .query(`
                -- [FOTO ÚNICA] el dibujo anterior, para saber si la foto de catálogo era este mismo dibujo
                DECLARE @Ant VARCHAR(500) = (SELECT DibujoUrl FROM dbo.ProductoFichaDiseno WHERE ProIdProducto = @PID);
                IF EXISTS (SELECT 1 FROM dbo.ProductoFichaDiseno WHERE ProIdProducto = @PID)
                    UPDATE dbo.ProductoFichaDiseno SET DibujoUrl = @Url, FechaModif = GETDATE() WHERE ProIdProducto = @PID
                ELSE
                    INSERT INTO dbo.ProductoFichaDiseno (ProIdProducto, DibujoUrl) VALUES (@PID, @Url);
                -- [FOTO ÚNICA] si el artículo no tiene foto de catálogo (o su foto era el dibujo anterior), este dibujo
                -- pasa a ser la foto principal en Articulos_Imagenes: así la ven el editor de artículo, la tienda,
                -- el portal y la solicitud. Una foto subida a propósito nunca se pisa.
                IF NOT EXISTS (SELECT 1 FROM dbo.Articulos_Imagenes WHERE Idproid = @PID AND color IS NULL)
                    INSERT INTO dbo.Articulos_Imagenes (Idproid, url_imagen, es_generica, orden, color) VALUES (@PID, @Url, 0, 1, NULL);
                ELSE IF @Ant IS NOT NULL
                    UPDATE dbo.Articulos_Imagenes SET url_imagen = @Url WHERE Idproid = @PID AND color IS NULL AND url_imagen = @Ant;
            `);
        logger.info(`[Configurador] Dibujo de ficha subido para ProIdProducto ${proId} por ${req.user?.username || 'N/A'}`);
        res.json({ success: true, dibujoUrl });
    } catch (e) {
        logger.error('[Configurador] subirDibujoFicha:', e);
        res.status(500).json({ error: e.message });
    }
};


// ═════════════════════════════════════════════════════════════════════════
//  ETIQUETA — nivel intermedio del árbol del configurador
//  Familia (StockArt) → Etiqueta (para qué es: Básquet, Fútbol, Vóley…) → Producto.
//  Lo que trae el nombre (FP, +B, +DTF) es parte del nombre, no del árbol.
//  Modelo: docs/migrations/configurador_etiquetas.sql. Asignar/crear/renombrar se
//  aplica al instante (igual que mover de familia), no espera al "Guardar".
// ═════════════════════════════════════════════════════════════════════════

// GET /api/configurador/etiquetas — todas, con cuántos productos tiene cada una
exports.getEtiquetas = async (req, res) => {
    try {
        const pool = await getPool();
        if (!(await tieneEtiquetas(pool))) return res.json({ success: true, data: [], faltaSql: true });
        const r = await pool.request().query(`
            SELECT e.EtiquetaID, e.Nombre, COUNT(vc.ProIdProducto) AS Productos
            FROM dbo.ProductoEtiqueta e
            LEFT JOIN dbo.ProductoVentaConfig vc ON vc.EtiquetaID = e.EtiquetaID
            WHERE e.Activo = 1
            GROUP BY e.EtiquetaID, e.Nombre
            ORDER BY e.Nombre`);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[Configurador] getEtiquetas:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/configurador/etiquetas — { nombre } → crea (o devuelve la existente con ese nombre)
exports.crearEtiqueta = async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim().slice(0, 100);
    if (!nombre) return res.status(400).json({ error: 'Poné el nombre de la etiqueta.' });
    try {
        const pool = await getPool();
        if (!(await tieneEtiquetas(pool))) return res.status(409).json({ error: FALTA_SQL_ETIQUETAS });
        const r = await pool.request().input('Nom', sql.NVarChar(100), nombre).query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.ProductoEtiqueta WHERE Nombre = @Nom)
                INSERT INTO dbo.ProductoEtiqueta (Nombre) VALUES (@Nom);
            SELECT EtiquetaID, Nombre FROM dbo.ProductoEtiqueta WHERE Nombre = @Nom;`);
        logger.info(`[Configurador] Etiqueta "${nombre}" (#${r.recordset[0].EtiquetaID}) por ${req.user?.username || 'N/A'}`);
        res.json({ success: true, data: r.recordset[0] });
    } catch (e) {
        logger.error('[Configurador] crearEtiqueta:', e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/configurador/etiquetas/:id — { nombre } → renombra (afecta a todos sus productos)
exports.renombrarEtiqueta = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const nombre = String(req.body?.nombre || '').trim().slice(0, 100);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Etiqueta inválida.' });
    if (!nombre) return res.status(400).json({ error: 'Poné el nombre de la etiqueta.' });
    try {
        const pool = await getPool();
        if (!(await tieneEtiquetas(pool))) return res.status(409).json({ error: FALTA_SQL_ETIQUETAS });
        const dup = await pool.request().input('ID', sql.Int, id).input('Nom', sql.NVarChar(100), nombre)
            .query(`SELECT 1 FROM dbo.ProductoEtiqueta WHERE Nombre = @Nom AND EtiquetaID <> @ID`);
        if (dup.recordset.length) return res.status(409).json({ error: `Ya existe una etiqueta llamada "${nombre}".` });
        const r = await pool.request().input('ID', sql.Int, id).input('Nom', sql.NVarChar(100), nombre)
            .query(`UPDATE dbo.ProductoEtiqueta SET Nombre = @Nom WHERE EtiquetaID = @ID; SELECT @@ROWCOUNT AS n;`);
        if (!r.recordset[0].n) return res.status(404).json({ error: 'Etiqueta no encontrada.' });
        res.json({ success: true });
    } catch (e) {
        logger.error('[Configurador] renombrarEtiqueta:', e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/configurador/productos/:proId/etiqueta — { etiquetaId: number|null }
// null = el producto queda sin etiqueta. Si todavía no tenía ProductoVentaConfig,
// la crea con los mismos defaults que guardarProductoConfig.
exports.asignarEtiqueta = async (req, res) => {
    const proId = parseInt(req.params.proId, 10);
    if (!Number.isInteger(proId)) return res.status(400).json({ error: 'ProIdProducto inválido.' });
    const raw = req.body?.etiquetaId;
    const etiquetaId = raw == null || raw === '' ? null : parseInt(raw, 10);
    if (raw != null && raw !== '' && !Number.isInteger(etiquetaId)) return res.status(400).json({ error: 'Etiqueta inválida.' });
    try {
        const pool = await getPool();
        if (!(await tieneEtiquetas(pool))) return res.status(409).json({ error: FALTA_SQL_ETIQUETAS });
        const existe = await pool.request().input('PID', sql.Int, proId)
            .query(`SELECT 1 FROM dbo.Articulos WHERE ProIdProducto = @PID AND ISNULL(borrar,0) = 0`);
        if (!existe.recordset.length) return res.status(404).json({ error: 'Producto no encontrado.' });
        if (etiquetaId != null) {
            const e = await pool.request().input('ID', sql.Int, etiquetaId)
                .query(`SELECT 1 FROM dbo.ProductoEtiqueta WHERE EtiquetaID = @ID`);
            if (!e.recordset.length) return res.status(400).json({ error: 'La etiqueta no existe.' });
        }
        await pool.request().input('PID', sql.Int, proId).input('EID', sql.Int, etiquetaId).query(`
            IF EXISTS (SELECT 1 FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @PID)
                UPDATE dbo.ProductoVentaConfig SET EtiquetaID = @EID, FechaModif = GETDATE() WHERE ProIdProducto = @PID
            ELSE
                INSERT INTO dbo.ProductoVentaConfig (ProIdProducto, OrigenTipo, ValidarStock, Estado, EtiquetaID)
                VALUES (@PID, 'CONFECCIONADO', 1, 'BORRADOR', @EID)`);
        logger.info(`[Configurador] ProIdProducto ${proId} → etiqueta ${etiquetaId ?? '(ninguna)'} por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
        logger.error('[Configurador] asignarEtiqueta:', e);
        res.status(500).json({ error: e.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════
//  MOLDES DE TIZADAPRO (solo lectura — services/tizadaProService.js)
//  El configurador no carga moldes: los vincula. TizadaPro es el dueño de las
//  piezas, los talles, los modelos y las telas permitidas por pieza.
// ═════════════════════════════════════════════════════════════════════════

// GET /api/configurador/tizadapro/moldes — moldes activos con modelos, piezas, talles y telas
exports.getTizadaProMoldes = async (req, res) => {
    try {
        const pool = await getPool();
        const lista = await require('../services/tizadaProService').moldes(pool, { soloActivos: req.query.todos !== '1' });
        res.json({ success: true, data: lista });
    } catch (e) {
        if (e.status) return res.status(e.status).json({ error: e.message });
        logger.error('[Configurador] getTizadaProMoldes:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/configurador/tizadapro/moldes/:ref/pdf — sube el PDF del molde y arma las siluetas de
// sus piezas cruzando los contornos del PDF con las cajas por pieza/talle de TizadaPro.
exports.subirPdfMoldeTizadaPro = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún PDF.' });
    try {
        const pool = await getPool();
        const r = await require('../services/tizadaProService').procesarPdfMolde(pool, String(req.params.ref || ''), req.file.path, req.file.filename);
        logger.info(`[Configurador] PDF de molde ${req.params.ref} procesado por ${req.user?.username || 'N/A'}: ${r.contornos} contornos`);
        res.json({ success: true, data: r });
    } catch (e) {
        try { require('fs').unlinkSync(req.file.path); } catch (_) { /* nada */ }
        if (e.status) return res.status(e.status).json({ error: e.message });
        logger.error('[Configurador] subirPdfMoldeTizadaPro:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/configurador/tizadapro/moldes/procesar-carpeta — lee los PDFs de la carpeta de moldes y
// arma las siluetas de los moldes que aún no las tienen (el nombre del archivo no importa).
exports.procesarCarpetaMoldes = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await require('../services/tizadaProService').procesarCarpetaMoldes(pool);
        logger.info(`[Configurador] Carpeta de moldes leída por ${req.user?.username || 'N/A'}: ${r.procesados.length} molde(s) con silueta nueva`);
        res.json({ success: true, data: r });
    } catch (e) {
        if (e.status) return res.status(e.status).json({ error: e.message });
        logger.error('[Configurador] procesarCarpetaMoldes:', e);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/configurador/tizadapro/moldes/:ref — un molde por su clave estable (legacy_id)
exports.getTizadaProMolde = async (req, res) => {
    try {
        const pool = await getPool();
        const lista = await require('../services/tizadaProService').moldes(pool, { ref: String(req.params.ref || ''), soloActivos: false });
        if (!lista.length) return res.status(404).json({ error: 'Ese molde ya no está en TizadaPro.' });
        res.json({ success: true, data: lista[0] });
    } catch (e) {
        if (e.status) return res.status(e.status).json({ error: e.message });
        logger.error('[Configurador] getTizadaProMolde:', e);
        res.status(500).json({ error: e.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════
//  NOMBRE Y CÓDIGO DEL PRODUCTO (Articulos.Descripcion / CodArticulo)
//  El nombre se cambia siempre. El código solo si el producto todavía no tiene
//  pedidos ni cobranzas (esas tablas guardan el código como texto y quedarían
//  desparejas); al cambiarlo se arrastra a las tablas de precios del artículo.
// ═════════════════════════════════════════════════════════════════════════
// PUT /api/configurador/productos/:proId/identidad — { descripcion, codArticulo }
exports.actualizarIdentidad = async (req, res) => {
    const proId = parseInt(req.params.proId, 10);
    if (!Number.isInteger(proId)) return res.status(400).json({ error: 'ProIdProducto inválido.' });
    const descripcion = String(req.body?.descripcion || '').trim();
    const codArticulo = req.body?.codArticulo === undefined ? undefined : String(req.body.codArticulo || '').trim();
    if (!descripcion) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    if (descripcion.length > 100) return res.status(400).json({ error: 'El nombre no puede pasar de 100 caracteres.' });
    if (codArticulo !== undefined && (!codArticulo || codArticulo.length > 20)) return res.status(400).json({ error: 'El código tiene que tener entre 1 y 20 caracteres.' });
    try {
        const pool = await getPool();
        const act = await pool.request().input('PID', sql.Int, proId).query(`
            SELECT LTRIM(RTRIM(CodArticulo)) AS Cod, LTRIM(RTRIM(CodStock)) AS CodStock, LTRIM(RTRIM(Descripcion)) AS Descripcion,
                   (SELECT COUNT(*) FROM dbo.Ordenes o WHERE o.ProIdProducto = a.ProIdProducto) AS Ordenes,
                   (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle d WHERE d.ProIdProducto = a.ProIdProducto) AS Cobranzas
            FROM dbo.Articulos a WHERE a.ProIdProducto = @PID AND ISNULL(a.borrar, 0) = 0`);
        const a = act.recordset[0];
        if (!a) return res.status(404).json({ error: 'Producto no encontrado.' });
        const cambiaCod = codArticulo !== undefined && codArticulo !== a.Cod;
        if (cambiaCod) {
            if (a.Ordenes || a.Cobranzas) return res.status(409).json({ error: `El código no se puede cambiar: el producto ya tiene ${a.Ordenes} pedido(s) y ${a.Cobranzas} cobranza(s) con el código ${a.Cod}. El nombre sí se puede cambiar.` });
            const dup = await pool.request().input('Cod', sql.VarChar(20), codArticulo).input('CS', sql.VarChar(20), a.CodStock).input('PID', sql.Int, proId)
                .query(`SELECT TOP 1 LTRIM(RTRIM(Descripcion)) AS d FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = @Cod AND LTRIM(RTRIM(CodStock)) = @CS AND ProIdProducto <> @PID AND ISNULL(borrar, 0) = 0`);
            if (dup.recordset.length) return res.status(409).json({ error: `El código ${codArticulo} ya lo usa "${dup.recordset[0].d}" en la misma familia.` });
        }
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const rq = () => new sql.Request(transaction).input('PID', sql.Int, proId).input('Desc', sql.VarChar(100), descripcion).input('Cod', sql.VarChar(20), cambiaCod ? codArticulo : a.Cod).input('Viejo', sql.VarChar(20), a.Cod);
            await rq().query(`UPDATE dbo.Articulos SET Descripcion = @Desc${cambiaCod ? ', CodArticulo = @Cod' : ''} WHERE ProIdProducto = @PID`);
            if (cambiaCod) {
                // Las tablas de precios guardan el código como texto: se arrastra el nuevo
                for (const t of ['PreciosBase', 'PreciosEspecialesItems', 'PerfilesItems']) {
                    await rq().query(`UPDATE dbo.${t} SET CodArticulo = @Cod WHERE ProIdProducto = @PID`);
                }
            }
            await transaction.commit();
        } catch (txErr) { await transaction.rollback(); throw txErr; }
        logger.info(`[Configurador] Identidad ProIdProducto ${proId}: "${a.Descripcion}" [${a.Cod}] → "${descripcion}" [${cambiaCod ? codArticulo : a.Cod}] por ${req.user?.username || 'N/A'}`);
        res.json({ success: true, data: { descripcion, codArticulo: cambiaCod ? codArticulo : a.Cod, codigoCambiado: cambiaCod } });
    } catch (e) {
        logger.error('[Configurador] actualizarIdentidad:', e);
        res.status(500).json({ error: e.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════
//  CATÁLOGO DE AVÍOS (dbo.CatalogoAvios — sección H de configurador_tizadapro.sql)
//  Cierres, botones, elásticos, etiquetas… con su unidad. Los productos eligen de acá.
// ═════════════════════════════════════════════════════════════════════════
const UNIDADES_AVIO = ['u', 'par', 'm', 'cm'];
async function tieneCatalogoAvios(pool) {
    const r = await pool.request().query(`SELECT OBJECT_ID('dbo.CatalogoAvios', 'U') AS t`);
    return r.recordset[0].t != null;
}
// GET /api/configurador/avios (?all=1 incluye inactivos)
exports.getAvios = async (req, res) => {
    try {
        const pool = await getPool();
        if (!(await tieneCatalogoAvios(pool))) return res.json({ success: true, data: [], faltaSql: true });
        const r = await pool.request().query(`
            SELECT a.AvioID, a.Nombre, a.Unidad, a.ArtProIdProducto, a.Activo, a.Orden, LTRIM(RTRIM(x.Descripcion)) AS Articulo,
                   (SELECT COUNT(*) FROM dbo.ProductoAvios pa WHERE pa.AvioID = a.AvioID) AS Usos
            FROM dbo.CatalogoAvios a LEFT JOIN dbo.Articulos x ON x.ProIdProducto = a.ArtProIdProducto
            ${req.query.all === '1' ? '' : 'WHERE a.Activo = 1'} ORDER BY ISNULL(a.Orden, 999), a.Nombre`);
        res.json({ success: true, data: r.recordset });
    } catch (e) { logger.error('[Configurador] getAvios:', e); res.status(500).json({ error: e.message }); }
};
// POST /api/configurador/avios — { nombre, unidad, artProIdProducto? }
exports.crearAvio = async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim().slice(0, 200);
    const unidad = UNIDADES_AVIO.includes(req.body?.unidad) ? req.body.unidad : 'u';
    if (!nombre) return res.status(400).json({ error: 'Poné el nombre del avío.' });
    try {
        const pool = await getPool();
        if (!(await tieneCatalogoAvios(pool))) return res.status(409).json({ error: 'Falta correr docs/migrations/configurador_tizadapro.sql (sección H) en esta base.' });
        const r = await pool.request().input('Nom', sql.NVarChar(200), nombre).input('Uni', sql.NVarChar(20), unidad)
            .input('Art', sql.Int, Number.isInteger(Number(req.body?.artProIdProducto)) && Number(req.body.artProIdProducto) > 0 ? Number(req.body.artProIdProducto) : null)
            .query(`INSERT INTO dbo.CatalogoAvios (Nombre, Unidad, ArtProIdProducto) OUTPUT INSERTED.AvioID VALUES (@Nom, @Uni, @Art)`)
            .catch(e => { if (/UQ_CatalogoAvios/.test(e.message)) { const x = new Error('Ya hay un avío con ese nombre.'); x.status = 409; throw x; } throw e; });
        res.json({ success: true, data: { AvioID: r.recordset[0].AvioID } });
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); logger.error('[Configurador] crearAvio:', e); res.status(500).json({ error: e.message }); }
};
// PUT /api/configurador/avios/:id — { nombre?, unidad?, artProIdProducto?, activo?, orden? }
exports.updateAvio = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Avío inválido.' });
    const b = req.body || {}; const sets = [];
    const rq = (await getPool()).request().input('ID', sql.Int, id);
    if (b.nombre !== undefined) { const n = String(b.nombre || '').trim().slice(0, 200); if (!n) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' }); sets.push('Nombre = @Nom'); rq.input('Nom', sql.NVarChar(200), n); }
    if (b.unidad !== undefined) { sets.push('Unidad = @Uni'); rq.input('Uni', sql.NVarChar(20), UNIDADES_AVIO.includes(b.unidad) ? b.unidad : 'u'); }
    if (b.artProIdProducto !== undefined) { sets.push('ArtProIdProducto = @Art'); rq.input('Art', sql.Int, Number.isInteger(Number(b.artProIdProducto)) && Number(b.artProIdProducto) > 0 ? Number(b.artProIdProducto) : null); }
    if (b.activo !== undefined) { sets.push('Activo = @Act'); rq.input('Act', sql.Bit, b.activo ? 1 : 0); }
    if (b.orden !== undefined) { sets.push('Orden = @Ord'); rq.input('Ord', sql.Int, Number.isInteger(Number(b.orden)) ? Number(b.orden) : null); }
    if (!sets.length) return res.status(400).json({ error: 'Nada para cambiar.' });
    try {
        const r = await rq.query(`UPDATE dbo.CatalogoAvios SET ${sets.join(', ')} WHERE AvioID = @ID; SELECT @@ROWCOUNT AS n;`)
            .catch(e => { if (/UQ_CatalogoAvios/.test(e.message)) { const x = new Error('Ya hay un avío con ese nombre.'); x.status = 409; throw x; } throw e; });
        if (!r.recordset[0].n) return res.status(404).json({ error: 'Avío no encontrado.' });
        res.json({ success: true });
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); logger.error('[Configurador] updateAvio:', e); res.status(500).json({ error: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
//  CATÁLOGO DE COSTURAS (dbo.CosturasISO) — alta y edición
// ═════════════════════════════════════════════════════════════════════════
// POST /api/configurador/costuras-iso — { codigoISO, nombre }
exports.crearCosturaIso = async (req, res) => {
    const codigo = String(req.body?.codigoISO || '').trim().slice(0, 20);
    const nombre = String(req.body?.nombre || '').trim().slice(0, 200);
    if (!codigo || !nombre) return res.status(400).json({ error: 'Poné el código (ej. ISO 504) y el nombre de la costura.' });
    try {
        const pool = await getPool();
        const dup = await pool.request().input('C', sql.VarChar(20), codigo).query(`SELECT 1 FROM dbo.CosturasISO WHERE CodigoISO = @C`);
        if (dup.recordset.length) return res.status(409).json({ error: `Ya existe una costura con el código ${codigo}.` });
        const r = await pool.request().input('C', sql.VarChar(20), codigo).input('N', sql.VarChar(200), nombre)
            .query(`INSERT INTO dbo.CosturasISO (CodigoISO, Nombre, Activo) OUTPUT INSERTED.CosturaISOID VALUES (@C, @N, 1)`);
        res.json({ success: true, data: { CosturaISOID: r.recordset[0].CosturaISOID } });
    } catch (e) { logger.error('[Configurador] crearCosturaIso:', e); res.status(500).json({ error: e.message }); }
};
// PUT /api/configurador/costuras-iso/:id — { codigoISO?, nombre?, activo? }
exports.updateCosturaIso = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Costura inválida.' });
    const b = req.body || {}; const sets = [];
    const rq = (await getPool()).request().input('ID', sql.Int, id);
    if (b.codigoISO !== undefined) { const c = String(b.codigoISO || '').trim().slice(0, 20); if (!c) return res.status(400).json({ error: 'El código no puede quedar vacío.' }); sets.push('CodigoISO = @C'); rq.input('C', sql.VarChar(20), c); }
    if (b.nombre !== undefined) { const n = String(b.nombre || '').trim().slice(0, 200); if (!n) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' }); sets.push('Nombre = @N'); rq.input('N', sql.VarChar(200), n); }
    if (b.activo !== undefined) { sets.push('Activo = @A'); rq.input('A', sql.Bit, b.activo ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Nada para cambiar.' });
    try {
        const r = await rq.query(`UPDATE dbo.CosturasISO SET ${sets.join(', ')} WHERE CosturaISOID = @ID; SELECT @@ROWCOUNT AS n;`);
        if (!r.recordset[0].n) return res.status(404).json({ error: 'Costura no encontrada.' });
        res.json({ success: true });
    } catch (e) { logger.error('[Configurador] updateCosturaIso:', e); res.status(500).json({ error: e.message }); }
};
