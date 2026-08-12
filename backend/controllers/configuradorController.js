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
 *   - Confeccionados: ComponenteOpciones (+ ProductoComponentes) y
 *     ProductoApliques.
 *  El precio NUNCA vive acá: PreciosBase vía upsertPrecioBase.
 */

const MODOS = ['LIBRE', 'RESTRINGIDO', 'FIJA'];
const COBROS = ['APARTE', 'INCLUIDA'];
const ORIGENES = ['LOCAL', 'CLIENTE', 'CONFECCIONADO', 'AMBOS'];
const ESTADOS = ['BORRADOR', 'PUBLICADO'];
const AREAS_TECNICA = ['EMB', 'DF', 'TPU'];
const AREAS_APLIQUE = ['EMB', 'DF', 'TPU', 'ETIQUETA'];
const TIPOS_COMPONENTE = ['CUELLO', 'MANGA', 'PUNO', 'COSTADO'];

// ─────────────────────────────────────────────────────────────────────────
// Stock vivo del local (WMS externo). Falla blanda: si el WMS no contesta,
// devuelve null y el que llama sigue sin stock (decisión 11-ago: la venta
// no se cae si se cae el sistema de stock — ver ProductoVentaConfig.ValidarStock).
// Mismo origen de datos que wmsController.getCatalog.
// ─────────────────────────────────────────────────────────────────────────
async function fetchStockLocalWms() {
    try {
        const wmsUrl = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';
        const depositoId = process.env.WMS_DEPOSITO_LOCAL_ID || 5; // depósito de Ventas
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

// GET /api/configurador/productos — lista con config + técnicas + precio
exports.getProductos = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
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
                tecnicas.Lista AS Tecnicas,
                ISNULL(wv.CantidadVariantes, 0) AS CantidadVariantes,
                ISNULL(ci.Items, 0) AS ComboItems
            FROM dbo.Articulos a
            INNER JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
            LEFT JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
            OUTER APPLY (SELECT TOP 1 Precio, Moneda FROM dbo.PreciosBase p
                         WHERE p.ProIdProducto = a.ProIdProducto
                         ORDER BY p.UltimaActualizacion DESC) pb
            OUTER APPLY (SELECT TOP 1 url_imagen FROM dbo.Articulos_Imagenes i
                         WHERE i.Idproid = a.ProIdProducto ORDER BY i.orden) img
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
                    (ISNULL(sa.TipoStock,'MATERIAL') = 'PRODUCTO_TERMINADO'
                     AND (LTRIM(RTRIM(sa.SupFlia)) = '2' OR LTRIM(RTRIM(sa.CodStock)) = '1.1.4.10'))
                    OR vc.ProIdProducto IS NOT NULL
                  )
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
            OUTER APPLY (SELECT TOP 1 url_imagen FROM dbo.Articulos_Imagenes i
                         WHERE i.Idproid = a.ProIdProducto ORDER BY i.orden) img
            WHERE a.ProIdProducto = @PID AND ISNULL(a.borrar, 0) = 0`);
        if (!datos.recordset.length) return res.status(404).json({ error: 'Producto no encontrado.' });

        const [config, tecnicas, opciones, surtido, componentes, apliques, comboItems, comboSrv] = await Promise.all([
            rq().query(`SELECT OrigenTipo, OrigenProIdProducto, CantidadMinima, CantidadFija,
                               ValidarStock, Estado, EsCombo, FechaRegistro, FechaModif
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
            rq().query(`SELECT pc.OpcionID, pc.EsDefault, c.Tipo, c.SubTipo, c.Codigo, c.Nombre
                        FROM dbo.ProductoComponentes pc
                        INNER JOIN dbo.ComponenteOpciones c ON c.OpcionID = pc.OpcionID
                        WHERE pc.ProIdProducto = @PID`),
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
                        WHERE ci.ProIdProducto = @PID`)
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
                componentes: componentes.recordset,
                apliques: apliques.recordset,
                comboItems: comboItems.recordset.map(ci => ({
                    ...ci,
                    servicios: comboSrv.recordset.filter(s => s.ComboItemID === ci.ID)
                }))
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
    for (const t of (Array.isArray(body.tecnicas) ? body.tecnicas : [])) {
        if (!AREAS_TECNICA.includes(t.areaId)) errores.push(`Técnica con AreaID inválido: '${t.areaId}' (${AREAS_TECNICA.join(' | ')}).`);
        if (t.modo !== undefined && !MODOS.includes(t.modo)) errores.push(`Modo inválido en ${t.areaId} (${MODOS.join(' | ')}).`);
        if (t.cobro !== undefined && !COBROS.includes(t.cobro)) errores.push(`Cobro inválido en ${t.areaId} (${COBROS.join(' | ')}).`);
    }
    for (const ap of (Array.isArray(body.apliques) ? body.apliques : [])) {
        if (!ap.posicion || !String(ap.posicion).trim()) errores.push('Cada aplique necesita una Posición.');
        if (!AREAS_APLIQUE.includes(ap.areaId)) errores.push(`Aplique con AreaID inválido: '${ap.areaId}' (${AREAS_APLIQUE.join(' | ')}).`);
    }
    return errores;
}

// Reemplaza los sets hijos (solo los que vienen en el body; undefined = no tocar)
async function aplicarSetsHijos(transaction, proId, body) {
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
    if (body.componentes !== undefined) {
        await del('ProductoComponentes');
        for (const c of (body.componentes || [])) {
            const id = Number(c.opcionId ?? c);
            if (!Number.isInteger(id) || id <= 0) continue;
            await new sql.Request(transaction)
                .input('PID', sql.Int, proId).input('OID', sql.Int, id)
                .input('Def', sql.Bit, c.esDefault ? 1 : 0)
                .query(`INSERT INTO dbo.ProductoComponentes (ProIdProducto, OpcionID, EsDefault) VALUES (@PID, @OID, @Def)`);
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
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @PID)
                        UPDATE dbo.ProductoVentaConfig SET
                            OrigenTipo          = ISNULL(@Ori, OrigenTipo),
                            OrigenProIdProducto = CASE WHEN @OriPIDSet = 1 THEN @OriPID ELSE OrigenProIdProducto END,
                            CantidadMinima      = CASE WHEN @MinSet  = 1 THEN @Min  ELSE CantidadMinima END,
                            CantidadFija        = CASE WHEN @FijaSet = 1 THEN @Fija ELSE CantidadFija END,
                            ValidarStock        = ISNULL(@VStock, ValidarStock),
                            Estado              = ISNULL(@Est, Estado),
                            FechaModif          = GETDATE()
                        WHERE ProIdProducto = @PID
                    ELSE
                        INSERT INTO dbo.ProductoVentaConfig
                            (ProIdProducto, OrigenTipo, OrigenProIdProducto, CantidadMinima, CantidadFija, ValidarStock, Estado)
                        VALUES (@PID, ISNULL(@Ori,'LOCAL'), @OriPID, @Min, @Fija, ISNULL(@VStock,1), ISNULL(@Est,'BORRADOR'))
                `);

            await aplicarSetsHijos(transaction, proId, body);
            await transaction.commit();
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

        // Precio (base o de paquete) → PreciosBase, con el CodArticulo del artículo
        if (body.precio !== undefined && body.precio !== null && body.precio !== '') {
            const cod = await pool.request().input('PID', sql.Int, proId)
                .query(`SELECT TOP 1 LTRIM(RTRIM(CodArticulo)) AS Cod FROM dbo.Articulos WHERE ProIdProducto = @PID`);
            await upsertPrecioBase(pool, cod.recordset[0].Cod, parseFloat(body.precio) || 0, body.moneda);
        }

        logger.info(`[Configurador] Config guardada para ProIdProducto ${proId} por ${req.user?.username || 'N/A'}`);
        res.json({ success: true });
    } catch (e) {
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
                .input('Ori', sql.VarChar(15), ORIGENES.includes(req.body.origenTipo) ? req.body.origenTipo : 'LOCAL')
                .input('OriPID', sql.Int, req.body.origenProIdProducto != null ? Number(req.body.origenProIdProducto) : null)
                .input('Min', sql.Int, req.body.cantidadMinima != null ? Number(req.body.cantidadMinima) : null)
                .input('Fija', sql.Int, req.body.cantidadFija != null ? Number(req.body.cantidadFija) : null)
                .input('VStock', sql.Bit, req.body.validarStock === false ? 0 : 1)
                .input('Est', sql.VarChar(12), ESTADOS.includes(req.body.estado) ? req.body.estado : 'BORRADOR')
                .input('Combo', sql.Bit, esCombo ? 1 : 0)
                .query(`INSERT INTO dbo.ProductoVentaConfig
                            (ProIdProducto, OrigenTipo, OrigenProIdProducto, CantidadMinima, CantidadFija, ValidarStock, Estado, EsCombo)
                        VALUES (@PID, @Ori, @OriPID, @Min, @Fija, @VStock, @Est, @Combo)`);

            await aplicarSetsHijos(transaction, proId, req.body);
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
//  CATÁLOGO DE COMPONENTES (ComponenteOpciones — confeccionados)
// ═════════════════════════════════════════════════════════════════════════

// GET /api/configurador/componentes (?all=1 incluye inactivos)
exports.getComponentes = async (req, res) => {
    try {
        const pool = await getPool();
        const all = req.query.all === '1';
        const r = await pool.request().query(`
            SELECT OpcionID, Tipo, SubTipo, Codigo, Nombre, NotaMolde, NotaTallesFemeninos,
                   AnchoRefMm, PrecioExtra, Activo, Orden
            FROM dbo.ComponenteOpciones
            ${all ? '' : 'WHERE Activo = 1'}
            ORDER BY Tipo, ISNULL(Orden, 999), Codigo
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[Configurador] getComponentes:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/configurador/componentes
exports.crearComponenteOpcion = async (req, res) => {
    const { tipo, subTipo, codigo, nombre, notaMolde, notaTallesFemeninos, anchoRefMm, precioExtra, orden } = req.body || {};
    if (!TIPOS_COMPONENTE.includes(tipo)) return res.status(400).json({ error: `Tipo inválido (${TIPOS_COMPONENTE.join(' | ')}).` });
    if (!codigo || !codigo.trim()) return res.status(400).json({ error: 'El código es obligatorio (ej. CR-04).' });
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Tipo', sql.VarChar(15), tipo)
            .input('Sub', sql.VarChar(20), subTipo ? String(subTipo).trim() : null)
            .input('Cod', sql.VarChar(10), codigo.trim().toUpperCase())
            .input('Nom', sql.NVarChar(100), nombre.trim())
            .input('NM', sql.NVarChar(200), notaMolde ? String(notaMolde).trim() : null)
            .input('NF', sql.NVarChar(200), notaTallesFemeninos ? String(notaTallesFemeninos).trim() : null)
            .input('An', sql.Decimal(9, 2), anchoRefMm != null && anchoRefMm !== '' ? anchoRefMm : null)
            .input('PE', sql.Decimal(18, 2), precioExtra != null && precioExtra !== '' ? precioExtra : null)
            .input('Ord', sql.Int, Number.isInteger(Number(orden)) ? Number(orden) : null)
            .query(`INSERT INTO dbo.ComponenteOpciones
                        (Tipo, SubTipo, Codigo, Nombre, NotaMolde, NotaTallesFemeninos, AnchoRefMm, PrecioExtra, Orden)
                    OUTPUT INSERTED.OpcionID
                    VALUES (@Tipo, @Sub, @Cod, @Nom, @NM, @NF, @An, @PE, @Ord)`);
        res.json({ success: true, opcionId: r.recordset[0].OpcionID });
    } catch (e) {
        if (/UQ_ComponenteOpciones/.test(e.message)) return res.status(409).json({ error: 'Ese código ya existe.' });
        logger.error('[Configurador] crearComponenteOpcion:', e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/configurador/componentes/:id
exports.updateComponenteOpcion = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const { nombre, subTipo, notaMolde, notaTallesFemeninos, anchoRefMm, precioExtra, activo, orden } = req.body || {};
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('ID', sql.Int, id)
            .input('Nom', sql.NVarChar(100), nombre !== undefined ? String(nombre).trim() : null)
            .input('Sub', sql.VarChar(20), subTipo !== undefined ? (subTipo ? String(subTipo).trim() : null) : null)
            .input('SubSet', sql.Bit, subTipo !== undefined ? 1 : 0)
            .input('NM', sql.NVarChar(200), notaMolde !== undefined ? (notaMolde ? String(notaMolde).trim() : null) : null)
            .input('NMSet', sql.Bit, notaMolde !== undefined ? 1 : 0)
            .input('NF', sql.NVarChar(200), notaTallesFemeninos !== undefined ? (notaTallesFemeninos ? String(notaTallesFemeninos).trim() : null) : null)
            .input('NFSet', sql.Bit, notaTallesFemeninos !== undefined ? 1 : 0)
            .input('An', sql.Decimal(9, 2), anchoRefMm !== undefined ? (anchoRefMm === '' || anchoRefMm == null ? null : anchoRefMm) : null)
            .input('AnSet', sql.Bit, anchoRefMm !== undefined ? 1 : 0)
            .input('PE', sql.Decimal(18, 2), precioExtra !== undefined ? (precioExtra === '' || precioExtra == null ? null : precioExtra) : null)
            .input('PESet', sql.Bit, precioExtra !== undefined ? 1 : 0)
            .input('Act', sql.Bit, activo !== undefined ? (activo ? 1 : 0) : null)
            .input('Ord', sql.Int, orden !== undefined ? (Number.isInteger(Number(orden)) ? Number(orden) : null) : null)
            .input('OrdSet', sql.Bit, orden !== undefined ? 1 : 0)
            .query(`UPDATE dbo.ComponenteOpciones SET
                        Nombre = ISNULL(@Nom, Nombre),
                        SubTipo = CASE WHEN @SubSet = 1 THEN @Sub ELSE SubTipo END,
                        NotaMolde = CASE WHEN @NMSet = 1 THEN @NM ELSE NotaMolde END,
                        NotaTallesFemeninos = CASE WHEN @NFSet = 1 THEN @NF ELSE NotaTallesFemeninos END,
                        AnchoRefMm = CASE WHEN @AnSet = 1 THEN @An ELSE AnchoRefMm END,
                        PrecioExtra = CASE WHEN @PESet = 1 THEN @PE ELSE PrecioExtra END,
                        Activo = ISNULL(@Act, Activo),
                        Orden = CASE WHEN @OrdSet = 1 THEN @Ord ELSE Orden END
                    WHERE OpcionID = @ID`);
        if (!r.rowsAffected[0]) return res.status(404).json({ error: 'Componente no encontrado.' });
        res.json({ success: true });
    } catch (e) {
        logger.error('[Configurador] updateComponenteOpcion:', e);
        res.status(500).json({ error: e.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════
//  PRODUCTOS DEL LOCAL (selector del paso Origen)
// ═════════════════════════════════════════════════════════════════════════

// GET /api/configurador/productos-local (?q= busca por nombre)
// Artículos del local (SupFlia 2) que tienen variantes WMS, con stock vivo
// del depósito del local si el WMS contesta (si no, stockDisponible=false y
// las cantidades van null — la pantalla lo muestra igual).
exports.getProductosLocal = async (req, res) => {
    try {
        const pool = await getPool();
        const q = (req.query.q || '').trim();
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
            OUTER APPLY (SELECT TOP 1 url_imagen FROM dbo.Articulos_Imagenes i
                         WHERE i.Idproid = a.ProIdProducto ORDER BY i.orden) img
            WHERE LTRIM(RTRIM(a.SupFlia)) = '2' AND ISNULL(a.borrar, 0) = 0
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
