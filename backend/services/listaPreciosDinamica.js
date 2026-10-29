'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LISTA DE PRECIOS DINÁMICA (29-oct-2026) — pantalla /admin/lista-precios-dinamica
// backend/scripts/lista_precios_dinamica.sql (ProductoTelas.ConsumoM, ProductoVentaConfig.CorteCostura*,
// ProductoValoresAgregados y menú)
//
// Recrea la maqueta «Pricing textil» con los datos reales. El precio por unidad de un producto confeccionado:
//   costo  = consumo de la tela principal (m por unidad, ProductoTelas.ConsumoM) × precio del metro de esa tela
//            + corte y costura por unidad del producto
//   precio = costo × (1 + margen % de la franja de unidades) × (1 + suma de sus valores agregados en %)
//            + suma de sus valores agregados en monto por prenda, redondeado hacia arriba si se configuró
// Todo en la MONEDA DEL PRODUCTO (la de su precio de lista; sin precio de lista, la general): la tela, que suele estar
// en dólares, se pasa con la cotización (la del día en la pantalla y la Solicitud; la del pedido en el motor).
// Valores agregados (ProductoValoresAgregados): lo que hace a un producto más caro que otro con la misma tela y
// costura, p. ej. «Complejidad / riesgo +5 %» en una campera; % o monto por prenda con su moneda.
// El corte y costura es el de cada producto (ProductoVentaConfig.CorteCosturaCosto, con su moneda; un short no
// cuesta lo mismo que una campera); sin el suyo, el general de la lista. Va UN valor por producto y no cambia con la
// cantidad (29/10: se probó un ajuste % por franja y la usuaria lo sacó: lo que cambia por cantidad es el margen).
// El precio del metro es el de la lista de la tela (PreciosBase) con las escalas por metros de su área (perfil
// global del área, p. ej. SUBLIMACION ESCALONADOS: desde 100 m −10 %…); la franja la dan los metros TOTALES del
// pedido (unidades × consumo). Las telas son las de las áreas configuradas (Sublimación, Directa): sus precios y
// escalas se ven acá y se cambian en Precios Estándar / Perfiles de Precios. La tela secundaria (cuello,
// costadillo) no entra: el consumo se carga solo en las telas principales, en el configurador de productos.
//
// Franjas de unidades (margen), corte y costura general, áreas, moneda (de los productos sin precio de lista),
// redondeo y si se aplica en los pedidos:
// ConfiguracionGlobal
// 'LISTA_PRECIOS_DINAMICA' (JSON). Nace APAGADA: con `aplicar` en false los pedidos se cotizan como siempre.
// Prendida, el motor (pricingService.calculatePrice) usa este precio como precio de lista de la línea del producto
// en lugar de su lista y de sus escalas (PRODUCTOS ESCALONADOS); los descuentos del cliente se aplican encima.
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../config/db');

const CLAVE = 'LISTA_PRECIOS_DINAMICA';
const REDONDEOS = [0, 0.05, 0.1, 0.5, 1, 5, 10];   // los de la maqueta
const MAX_FRANJAS = 8;
// Margen de la maqueta como punto de partida (sus datos son de ejemplo); el corte y costura hay que cargarlo
const DEFECTO = {
    aplicar: false, moneda: 'USD', redondeo: 0, areas: ['SB', 'DIRECTA'], corteCostura: 0,
    franjas: [{ desde: 1, margen: 100 }, { desde: 12, margen: 50 }, { desde: 50, margen: 25 }, { desde: 200, margen: 5 }],
};

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const limpio = (s) => String(s ?? '').trim();
const req = (cx) => new sql.Request(cx);

// ── Configuración ────────────────────────────────────────────────────────────
function normalizarConfig(e = {}) {
    const moneda = e.moneda === 'UYU' ? 'UYU' : e.moneda === 'USD' || e.moneda == null ? 'USD' : null;
    if (!moneda) throw fallo(400, 'La moneda tiene que ser USD o UYU.');
    const redondeo = e.redondeo == null ? 0 : Number(e.redondeo);
    if (!REDONDEOS.includes(redondeo)) throw fallo(400, 'Redondeo no válido.');
    const areas = [...new Set((Array.isArray(e.areas) ? e.areas : []).map(a => limpio(a).toUpperCase()).filter(Boolean))];
    if (!areas.length) throw fallo(400, 'Elegí al menos un área de donde salen las telas.');
    const corteCostura = Number(e.corteCostura ?? 0);
    if (!(corteCostura >= 0)) throw fallo(400, 'El corte y costura general no puede ser negativo.');
    const franjas = (Array.isArray(e.franjas) ? e.franjas : []).map(f => ({ desde: Number(f.desde), margen: Number(f.margen) }));
    if (!franjas.length || franjas.length > MAX_FRANJAS) throw fallo(400, `Cargá entre 1 y ${MAX_FRANJAS} franjas de unidades.`);
    franjas.forEach((f, i) => {
        if (!Number.isInteger(f.desde) || f.desde < 1) throw fallo(400, `Franja ${i + 1}: «desde» tiene que ser un número entero de unidades, 1 o más.`);
        if (!(f.margen >= 0)) throw fallo(400, `Franja ${i + 1}: el margen no puede ser negativo.`);
        if (i > 0 && f.desde <= franjas[i - 1].desde) throw fallo(400, 'Las franjas tienen que ir de menor a mayor cantidad de unidades, sin repetir.');
    });
    if (franjas[0].desde !== 1) throw fallo(400, 'La primera franja tiene que empezar desde 1 unidad.');
    return { aplicar: !!e.aplicar, moneda, redondeo, areas, corteCostura: r2(corteCostura), franjas: franjas.map(f => ({ desde: f.desde, margen: r2(f.margen) })) };
}

let _cfg = null, _cfgVence = 0;
async function leerConfig(cx) {
    if (_cfg && Date.now() < _cfgVence) return _cfg;
    const r = await req(cx).input('K', sql.VarChar(50), CLAVE)
        .query("SELECT TOP 1 Valor FROM dbo.ConfiguracionGlobal WHERE Clave = @K AND LTRIM(RTRIM(AreaID)) = 'ADMIN'");
    let cfg = DEFECTO;
    try { if (r.recordset[0]?.Valor) cfg = normalizarConfig(JSON.parse(r.recordset[0].Valor)); } catch (_) { cfg = DEFECTO; }
    _cfg = cfg; _cfgVence = Date.now() + 60 * 1000;   // como mucho 1 lectura por minuto (el motor la consulta en cada línea)
    return cfg;
}

async function guardarConfig(cx, entrada) {
    const cfg = normalizarConfig(entrada);
    await req(cx).input('K', sql.VarChar(50), CLAVE).input('V', sql.NVarChar(sql.MAX), JSON.stringify(cfg))
        .query(`UPDATE dbo.ConfiguracionGlobal SET Valor = @V WHERE Clave = @K AND LTRIM(RTRIM(AreaID)) = 'ADMIN';
                IF @@ROWCOUNT = 0 INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES (@K, 'ADMIN', @V);`);
    _cfg = cfg; _cfgVence = Date.now() + 60 * 1000;
    return cfg;
}

let _conConsumo = null, _conCorte = null;   // ¿ya se corrió el SQL? (se recuerda solo cuando sí)
async function hayConsumo(cx) {
    if (_conConsumo) return true;
    const r = await req(cx).query("SELECT COL_LENGTH('dbo.ProductoTelas', 'ConsumoM') AS c");
    _conConsumo = r.recordset[0].c != null;
    return _conConsumo;
}
// Corte y costura por producto (segunda vuelta del 29/10: puede faltar donde se corrió la primera versión del SQL)
async function hayCorteCostura(cx) {
    if (_conCorte) return true;
    const r = await req(cx).query("SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'CorteCosturaCosto') AS c");
    _conCorte = r.recordset[0].c != null;
    return _conCorte;
}
// Valores agregados por producto (tercera vuelta del 29/10: ídem)
let _conValores = null;
async function hayValoresAgregados(cx) {
    if (_conValores) return true;
    const r = await req(cx).query("SELECT OBJECT_ID('dbo.ProductoValoresAgregados', 'U') AS t");
    _conValores = r.recordset[0].t != null;
    return _conValores;
}
const TIPOS_VALOR = ['PORCENTAJE', 'MONTO'];

// ── Telas: artículo, área, precio de lista y escalas por metros ──────────────
// Mismas tablas que catalogo.materialesDeArea (StockArt del grupo del área en ConfigMapeoERP); con `ids` trae
// esas telas aunque estén ocultas en el catálogo. Precio: el de PreciosBase en la moneda de la lista, si no USD,
// si no UYU (el mismo orden que el motor).
async function telasDe(cx, { areas = null, ids = null }, moneda) {
    const r = req(cx).input('Mon', sql.Int, moneda === 'UYU' ? 1 : 2);
    let donde;
    if (ids) {
        const lista = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
        if (!lista.length) return [];
        donde = `a.ProIdProducto IN (${lista.join(',')})`;
    } else {
        const lista = (areas || []).map(limpio).filter(Boolean);
        if (!lista.length) return [];
        lista.forEach((a, i) => r.input(`A${i}`, sql.VarChar(20), a));
        donde = `ar.AreaID IN (${lista.map((_, i) => `@A${i}`).join(',')})
                 AND ISNULL(s.TipoStock, 'MATERIAL') = 'MATERIAL' AND ISNULL(s.mostrar, 1) = 1
                 AND ISNULL(a.mostrar, 1) = 1 AND ISNULL(a.borrar, 0) = 0`;
    }
    const res = await r.query(`
        SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Material,
               a.anchoimprimible AS Ancho, LTRIM(RTRIM(a.Grupo)) AS Grupo, LTRIM(RTRIM(s.Articulo)) AS Variante,
               ar.AreaID, ar.AreaNombre, pb.Precio, pb.Moneda
        FROM dbo.Articulos a
        LEFT JOIN dbo.StockArt s ON s.CodStock = a.CodStock
        OUTER APPLY (SELECT TOP 1 LTRIM(RTRIM(m.AreaID_Interno)) AS AreaID, LTRIM(RTRIM(m.NombreReferencia)) AS AreaNombre
                     FROM dbo.ConfigMapeoERP m WHERE LTRIM(RTRIM(m.CodigoERP)) = LTRIM(RTRIM(s.Grupo))) ar
        OUTER APPLY (SELECT TOP 1 p.Precio, CASE WHEN p.MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END AS Moneda
                     FROM dbo.PreciosBase p WHERE p.ProIdProducto = a.ProIdProducto
                     ORDER BY CASE WHEN p.MonIdMoneda = @Mon THEN 1 WHEN p.MonIdMoneda = 2 THEN 2 ELSE 3 END) pb
        WHERE ${donde}
        ORDER BY ar.AreaID, s.Articulo, a.Descripcion`);
    return res.recordset;
}

// Reglas de los perfiles globales activos de cada área (por código o por nombre del área, como el motor)
async function reglasDeAreas(cx, areasConNombre) {
    const claves = [...new Set(areasConNombre.flatMap(a => [a.AreaID, a.AreaNombre]).map(limpio).filter(Boolean))];
    if (!claves.length) return [];
    const r = req(cx);
    claves.forEach((c, i) => r.input(`C${i}`, sql.VarChar(100), c));
    const res = await r.query(`
        SELECT PP.ID AS PerfilID, LTRIM(RTRIM(PP.Nombre)) AS Perfil, LTRIM(RTRIM(PP.Categoria)) AS Categoria,
               PI.ProIdProducto, LTRIM(RTRIM(PI.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(PI.CodGrupo)) AS CodGrupo,
               PI.TipoRegla, PI.Valor, CASE WHEN PI.MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END AS Moneda, PI.CantidadMinima
        FROM dbo.PerfilesPrecios PP
        JOIN dbo.PerfilesItems PI ON PI.PerfilID = PP.ID
        WHERE PP.EsGlobal = 1 AND ISNULL(PP.Activo, 1) = 1 AND LTRIM(RTRIM(PP.Categoria)) IN (${claves.map((_, i) => `@C${i}`).join(',')})`);
    return res.recordset;
}

// Escalas de una tela en la moneda de la lista: [{ desde (m), precio, regla }]. La primera es la lista (desde 1 m).
// Para cada escalón: en cada perfil gana la regla de cantidad más alta que alcanza (la propia de la tela desempata),
// y entre perfiles el precio más bajo (descuento contra precio fijo), como la competencia del motor.
function escalasDeTela(tela, reglas, moneda, tipoCambio) {
    const conv = (v, de) => convertir(v, de, moneda, tipoCambio);
    const lista = tela.Precio != null ? conv(tela.Precio, tela.Moneda) : null;
    if (!(lista > 0)) return [];
    const areaTela = [limpio(tela.AreaID), limpio(tela.AreaNombre)].filter(Boolean).map(s => s.toUpperCase());
    const propias = reglas.filter(rg => {
        if (!areaTela.includes(limpio(rg.Categoria).toUpperCase())) return false;
        if (Number(rg.ProIdProducto) > 0) return Number(rg.ProIdProducto) === Number(tela.ProIdProducto);
        if (rg.CodArticulo && rg.CodArticulo !== 'TOTAL') return rg.CodArticulo === tela.CodArticulo;
        if (rg.CodGrupo) return rg.CodGrupo === tela.Grupo;
        return true;
    });
    const desdes = [...new Set([1, ...propias.map(rg => Number(rg.CantidadMinima) || 1)])].sort((a, b) => a - b);
    return desdes.map(desde => {
        const porPerfil = new Map();
        propias.filter(rg => (Number(rg.CantidadMinima) || 1) <= desde).forEach(rg => {
            const actual = porPerfil.get(rg.PerfilID);
            const exacta = (x) => (Number(x.ProIdProducto) > 0 || (x.CodArticulo && x.CodArticulo !== 'TOTAL') ? 1 : 0);
            if (!actual || (Number(rg.CantidadMinima) || 1) > (Number(actual.CantidadMinima) || 1)
                || ((Number(rg.CantidadMinima) || 1) === (Number(actual.CantidadMinima) || 1) && exacta(rg) > exacta(actual))) porPerfil.set(rg.PerfilID, rg);
        });
        let precio = lista, regla = null;
        porPerfil.forEach(rg => {
            const t = String(rg.TipoRegla || '');
            let p = null;
            if (t.includes('percentage')) p = lista * (1 - Number(rg.Valor) / 100);
            else if (t.includes('discount') || t === 'subtract') p = lista - conv(rg.Valor, rg.Moneda);
            else if (t === 'fixed' || t === 'fixed_price') p = Number(rg.Valor) > 0 ? conv(rg.Valor, rg.Moneda) : null;
            if (p != null && p >= 0 && p < precio) { precio = p; regla = `${rg.Perfil}: ${t.includes('percentage') ? `−${r2(rg.Valor)} %` : 'precio fijo'}`; }
        });
        return { desde, precio: r2(precio), regla };
    });
}

// ── Cálculo (el de la maqueta) ───────────────────────────────────────────────
const indiceFranja = (lista, valor) => lista.reduce((i, f, k) => (valor >= f.desde ? k : i), 0);
const redondear = (p, paso) => (!paso || !isFinite(p) ? p : Math.ceil(p / paso - 1e-9) * paso);

const convertir = (v, de, a, tipoCambio) => (de === a ? Number(v) : de === 'USD' ? Number(v) * tipoCambio : Number(v) / tipoCambio);

// Todo en la moneda del producto. corte = corte y costura por unidad (el del producto o el general); extras = sus valores
// agregados { pct: suma de %, fijo: suma de montos por prenda }. Los valores agregados van sobre el precio con margen.
function calcular(cfg, escalas, consumo, cantidad, corte, extras = { pct: 0, fijo: 0 }) {
    const metros = cantidad * consumo;
    const ft = indiceFranja(escalas, metros);
    const precioMetro = escalas[ft]?.precio ?? NaN;
    const costoTela = consumo * precioMetro;
    const fv = indiceFranja(cfg.franjas, cantidad);
    const f = cfg.franjas[fv];
    const costoConfeccion = r2(corte);
    const costoUnitario = costoTela + costoConfeccion;
    const precioConMargen = costoUnitario * (1 + f.margen / 100);
    const precioConValores = precioConMargen * (1 + extras.pct / 100) + extras.fijo;
    const precio = r2(redondear(precioConValores, cfg.redondeo));
    return {
        cantidad, metros: r2(metros), franjaTela: ft, desdeMetros: escalas[ft]?.desde ?? null, reglaTela: escalas[ft]?.regla || null,
        precioMetro: r2(precioMetro), costoTela: r2(costoTela), franjaVenta: fv, desdeUnidades: f.desde,
        costoConfeccion, costoUnitario: r2(costoUnitario), margen: f.margen, precioConMargen: r2(precioConMargen),
        valoresPct: extras.pct, valoresFijo: r2(extras.fijo), valoresImporte: r2(precioConValores - precioConMargen),
        precio, ganancia: r2(precio - costoUnitario),
    };
}

// Moneda en que se calcula el producto: la de su precio de lista; sin precio de lista, la general de la lista
const monedaDe = (prod, cfg) => prod.monedaProducto || cfg.moneda;

// Corte y costura del producto en `moneda`: el suyo si lo tiene, si no el general
function corteDe(prod, cfg, tipoCambio, moneda) {
    if (prod.corteCostura != null) {
        const mon = prod.corteMoneda || cfg.moneda;
        return { base: convertir(prod.corteCostura, mon, moneda, tipoCambio), propio: true, costo: prod.corteCostura, moneda: mon };
    }
    return { base: convertir(cfg.corteCostura, cfg.moneda, moneda, tipoCambio), propio: false, costo: cfg.corteCostura, moneda: cfg.moneda };
}

// Valores agregados del producto: la suma de los % y la de los montos por prenda (pasados a `moneda`)
function extrasDe(prod, tipoCambio, moneda) {
    const items = prod.valores || [];
    return {
        pct: r2(items.filter(v => v.tipo === 'PORCENTAJE').reduce((t, v) => t + v.valor, 0)),
        fijo: items.filter(v => v.tipo === 'MONTO').reduce((t, v) => t + convertir(v.valor, v.moneda || moneda, moneda, tipoCambio), 0),
        items,
    };
}
const textoValores = (items) => items.map(v => `${v.nombre} ${v.tipo === 'PORCENTAJE' ? `+${v.valor} %` : `+${v.moneda === 'USD' ? 'US$' : '$'} ${v.valor}`}`).join(', ');

// ── Productos con sus telas y consumos ───────────────────────────────────────
async function productosConTelas(cx, proIds = null) {
    if (!(await hayConsumo(cx))) return [];
    const conCorte = await hayCorteCostura(cx);
    const r = req(cx);
    let filtro = '';
    if (proIds) {
        const lista = [...new Set(proIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
        if (!lista.length) return [];
        filtro = `AND t.ProIdProducto IN (${lista.join(',')})`;
    }
    // La moneda del producto: la de su precio de lista (el último que se cargó, como en el configurador)
    const res = await r.query(`
        SELECT t.ProIdProducto, t.TelaProIdProducto, t.EsDefault, t.Orden, t.ConsumoM,
               LTRIM(RTRIM(p.CodArticulo)) AS Cod, LTRIM(RTRIM(p.Descripcion)) AS Nombre, LTRIM(RTRIM(st.Articulo)) AS Familia,
               c.Estado, mp.Moneda AS MonedaProducto${conCorte ? ', c.CorteCosturaCosto, LTRIM(RTRIM(c.CorteCosturaMoneda)) AS CorteCosturaMoneda' : ''}
        FROM dbo.ProductoTelas t
        JOIN dbo.Articulos p ON p.ProIdProducto = t.ProIdProducto
        LEFT JOIN dbo.StockArt st ON st.CodStock = p.CodStock
        LEFT JOIN dbo.ProductoVentaConfig c ON c.ProIdProducto = t.ProIdProducto
        OUTER APPLY (SELECT TOP 1 CASE WHEN pb.MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END AS Moneda
                     FROM dbo.PreciosBase pb WHERE pb.ProIdProducto = t.ProIdProducto ORDER BY pb.UltimaActualizacion DESC) mp
        WHERE ISNULL(p.borrar, 0) = 0 ${filtro}
        ORDER BY p.Descripcion, ISNULL(t.Orden, 999), t.ID`);
    const porProd = new Map();
    res.recordset.forEach(x => {
        const id = Number(x.ProIdProducto);
        const p = porProd.get(id) || {
            proId: id, cod: x.Cod, nombre: x.Nombre, familia: x.Familia || '', estado: x.Estado || null, telas: [], valores: [],
            monedaProducto: x.MonedaProducto || null,
            corteCostura: x.CorteCosturaCosto != null ? Number(x.CorteCosturaCosto) : null, corteMoneda: x.CorteCosturaMoneda || null,
        };
        p.telas.push({ telaProId: Number(x.TelaProIdProducto), esDefault: !!x.EsDefault, consumo: x.ConsumoM != null ? Number(x.ConsumoM) : null });
        porProd.set(id, p);
    });
    if (porProd.size && await hayValoresAgregados(cx)) {
        const v = await req(cx).query(`
            SELECT ProIdProducto, Nombre, Tipo, Valor, LTRIM(RTRIM(Moneda)) AS Moneda FROM dbo.ProductoValoresAgregados
            WHERE ProIdProducto IN (${[...porProd.keys()].join(',')}) ORDER BY ISNULL(Orden, 999), ID`);
        v.recordset.forEach(x => {
            const p = porProd.get(Number(x.ProIdProducto));
            if (p && TIPOS_VALOR.includes(x.Tipo)) p.valores.push({ nombre: x.Nombre, tipo: x.Tipo, valor: Number(x.Valor), moneda: x.Moneda || null });
        });
    }
    return [...porProd.values()];
}

// La tela con que se calcula: la pedida si es del producto y tiene consumo; si no, la primera del pedido que lo sea;
// si no, la ★ con consumo; si no, la primera con consumo. null = el producto no tiene consumo cargado.
function telaParaCalculo(prod, { tela = null, candidatas = [] } = {}, telasValidas) {
    const usable = (t) => t && t.consumo > 0 && telasValidas.has(t.telaProId);
    const pedida = prod.telas.find(t => t.telaProId === Number(tela));
    if (usable(pedida)) return pedida;
    for (const c of candidatas || []) { const t = prod.telas.find(x => x.telaProId === Number(c)); if (usable(t)) return t; }
    return prod.telas.find(t => t.esDefault && usable(t)) || prod.telas.find(usable) || null;
}

// Telas (por ProIdProducto) de las áreas configuradas, con sus escalas en `moneda` (la de la lista si no se dice)
async function telasConEscalas(cx, cfg, { ids = null } = {}, tipoCambio, moneda = cfg.moneda) {
    const filas = ids ? await telasDe(cx, { ids }, moneda) : await telasDe(cx, { areas: cfg.areas }, moneda);
    const deAreas = filas.filter(t => cfg.areas.includes(limpio(t.AreaID).toUpperCase()));
    const reglas = await reglasDeAreas(cx, deAreas);
    const mapa = new Map();
    deAreas.forEach(t => mapa.set(Number(t.ProIdProducto), { ...t, escalas: escalasDeTela(t, reglas, moneda, tipoCambio) }));
    return { mapa, fueraDeAreas: filas.filter(t => !mapa.has(Number(t.ProIdProducto))) };
}

// Un producto como lo muestran la pantalla y el configurador: su moneda, tela, corte y costura, valores agregados y el
// precio de cada franja. porMoneda = telas con escalas en cada moneda de los productos (telasConEscalas por moneda).
function armarProducto(p, cfg, porMoneda, tipoCambio) {
    const moneda = monedaDe(p, cfg);
    const deProductos = porMoneda[moneda];
    const nombreTela = (id) => (deProductos.mapa.get(id) || deProductos.fueraDeAreas.find(t => Number(t.ProIdProducto) === id))?.Material || `Tela ${id}`;
    const elegida = telaParaCalculo(p, {}, deProductos.mapa);
    const info = elegida ? deProductos.mapa.get(elegida.telaProId) || null : null;
    const avisos = [];
    if (!p.telas.some(t => t.consumo > 0)) avisos.push('Falta el consumo de sus telas (Configurar productos › Molde, telas y apliques).');
    else if (!elegida) avisos.push('Sus telas con consumo no son de las áreas de la lista.');
    else if (!info?.escalas.length) avisos.push(`«${info?.Material || nombreTela(elegida.telaProId)}» no tiene precio en la lista de precios.`);
    const corte = corteDe(p, cfg, tipoCambio, moneda);
    const extras = extrasDe(p, tipoCambio, moneda);
    const lista = elegida && info?.escalas.length ? cfg.franjas.map(f => calcular(cfg, info.escalas, elegida.consumo, f.desde, corte.base, extras)) : null;
    return {
        proId: p.proId, cod: p.cod, nombre: p.nombre, familia: p.familia, estado: p.estado, moneda,
        corteCostura: { propio: corte.propio, costo: corte.costo, moneda: corte.moneda, base: r2(corte.base) },
        valores: extras.items,
        telas: p.telas.map(t => ({ ...t, nombre: nombreTela(t.telaProId), enLista: deProductos.mapa.has(t.telaProId) })),
        tela: elegida ? { telaProId: elegida.telaProId, nombre: nombreTela(elegida.telaProId), consumo: elegida.consumo } : null,
        lista, avisos,
    };
}

// La lista dinámica de UN producto (paso Precios del configurador, al lado de su lista y sus escalas)
async function deProducto(cx, proId) {
    const cfg = await leerConfig(cx);
    const cot = await require('./retiroService').cotizacionDelDia(cx);
    const tipoCambio = cot?.cotizacion || 40;
    const base = { config: { aplicar: cfg.aplicar, franjas: cfg.franjas }, cotizacion: cot ? { valor: cot.cotizacion, dia: cot.dia } : null, faltaSQL: !(await hayConsumo(cx)) };
    const [p] = await productosConTelas(cx, [proId]);
    if (!p) return { ...base, producto: null };
    const moneda = monedaDe(p, cfg);
    const porMoneda = { [moneda]: await telasConEscalas(cx, cfg, { ids: p.telas.map(t => t.telaProId) }, tipoCambio, moneda) };
    return { ...base, producto: armarProducto(p, cfg, porMoneda, tipoCambio) };
}

// ── Todo lo de la pantalla ───────────────────────────────────────────────────
async function datos(cx) {
    const cfg = await leerConfig(cx);
    const cot = await require('./retiroService').cotizacionDelDia(cx);
    const tipoCambio = cot?.cotizacion || 40;
    const faltaSQL = !(await hayConsumo(cx));

    const areasRes = await req(cx).query(`
        SELECT LTRIM(RTRIM(m.AreaID_Interno)) AS AreaID, MAX(LTRIM(RTRIM(m.NombreReferencia))) AS Nombre
        FROM dbo.ConfigMapeoERP m
        JOIN dbo.StockArt s ON LTRIM(RTRIM(s.Grupo)) = LTRIM(RTRIM(m.CodigoERP))
        WHERE ISNULL(s.TipoStock, 'MATERIAL') = 'MATERIAL' AND NULLIF(LTRIM(RTRIM(m.AreaID_Interno)), '') IS NOT NULL
        GROUP BY LTRIM(RTRIM(m.AreaID_Interno)) ORDER BY 1`);

    const catalogo = await telasConEscalas(cx, cfg, {}, tipoCambio);
    const productos = await productosConTelas(cx);
    const idsTelas = [...new Set(productos.flatMap(p => p.telas.map(t => t.telaProId)))];
    // Las escalas de las telas en cada moneda en que hay productos (pesos y/o dólares)
    const porMoneda = {};
    for (const mon of new Set(productos.map(p => monedaDe(p, cfg)))) porMoneda[mon] = await telasConEscalas(cx, cfg, { ids: idsTelas }, tipoCambio, mon);
    const prods = productos.map(p => armarProducto(p, cfg, porMoneda, tipoCambio));

    const filaTela = (t) => ({
        proId: Number(t.ProIdProducto), cod: t.CodArticulo, nombre: t.Material, variante: t.Variante || '', area: t.AreaID,
        anchoM: t.Ancho != null ? Number(t.Ancho) : null, precioLista: t.Precio != null ? Number(t.Precio) : null, monedaLista: t.Moneda || null,
        escalas: t.escalas,
    });
    return {
        config: cfg, redondeos: REDONDEOS, maxFranjas: MAX_FRANJAS, faltaSQL,
        cotizacion: cot ? { valor: cot.cotizacion, dia: cot.dia } : null,
        areas: areasRes.recordset.map(a => ({ id: a.AreaID, nombre: a.Nombre || a.AreaID })),
        telas: [...catalogo.mapa.values()].map(filaTela),
        productos: prods,
    };
}

// Cotizar un producto con una tela y una cantidad (cotizador de la pantalla)
async function cotizar(cx, { proId, telaProId, cantidad }) {
    const q = Number(cantidad);
    if (!(q > 0)) throw fallo(400, 'Escribí una cantidad de unidades mayor a 0.');
    const cfg = await leerConfig(cx);
    const cot = await require('./retiroService').cotizacionDelDia(cx);
    const [prod] = await productosConTelas(cx, [proId]);
    if (!prod) throw fallo(404, 'El producto no tiene telas cargadas.');
    const tipoCambio = cot?.cotizacion || 40;
    const moneda = monedaDe(prod, cfg);
    const { mapa } = await telasConEscalas(cx, cfg, { ids: prod.telas.map(t => t.telaProId) }, tipoCambio, moneda);
    const tela = telaParaCalculo(prod, { tela: telaProId }, mapa);
    if (!tela) throw fallo(400, 'Esa tela no tiene consumo cargado o no es de las áreas de la lista.');
    const info = mapa.get(tela.telaProId);
    if (!info.escalas.length) throw fallo(400, `«${info.Material}» no tiene precio en la lista de precios.`);
    const corte = corteDe(prod, cfg, tipoCambio, moneda);
    const extras = extrasDe(prod, tipoCambio, moneda);
    return { tela: { telaProId: tela.telaProId, nombre: info.Material, consumo: tela.consumo }, moneda, corteCosturaPropio: corte.propio, valores: extras.items,
        ...calcular(cfg, info.escalas, tela.consumo, q, corte.base, extras) };
}

/**
 * Precio de lista dinámico para la línea de un producto (lo usa el motor). null si no aplica: la lista está apagada,
 * falta el SQL o el producto no tiene consumo cargado en una tela de las áreas de la lista.
 * @param {object} o  { tela: ProIdProducto elegido, candidatas: ProIdProducto de las órdenes del pedido, tipoCambio,
 *                     aunqueApagada: calcularlo igual con la lista apagada (la Solicitud lo muestra al lado del de catálogo) }
 * @returns {{ precio, moneda, detalle, tela }}
 */
async function precioParaLinea(cx, proId, cantidad, o = {}) {
    const cfg = await leerConfig(cx);
    if ((!cfg.aplicar && !o.aunqueApagada) || !(Number(proId) > 0) || !(Number(cantidad) > 0)) return null;
    const [prod] = await productosConTelas(cx, [proId]);
    if (!prod || !prod.telas.some(t => t.consumo > 0)) return null;
    const tipoCambio = Number(o.tipoCambio) > 0 ? Number(o.tipoCambio) : ((await require('./retiroService').cotizacionDelDia(cx))?.cotizacion || 40);
    const moneda = monedaDe(prod, cfg);
    const { mapa } = await telasConEscalas(cx, cfg, { ids: prod.telas.map(t => t.telaProId) }, tipoCambio, moneda);
    const tela = telaParaCalculo(prod, { tela: o.tela, candidatas: o.candidatas }, mapa);
    const info = tela ? mapa.get(tela.telaProId) : null;
    if (!info?.escalas.length) return null;
    const corte = corteDe(prod, cfg, tipoCambio, moneda);
    const extras = extrasDe(prod, tipoCambio, moneda);
    const c = calcular(cfg, info.escalas, tela.consumo, Number(cantidad), corte.base, extras);
    const m = moneda === 'USD' ? 'US$' : '$';
    const origenCorte = corte.propio ? 'del producto' : 'general';
    const detalle = `Lista dinámica: ${info.Material} ${tela.consumo} m × ${m} ${c.precioMetro} + corte y costura ${m} ${c.costoConfeccion}`
        + ` (${origenCorte})`
        + ` = costo ${m} ${c.costoUnitario}, +${c.margen} % (desde ${c.desdeUnidades} u.)`
        + (extras.items.length ? `, valores agregados: ${textoValores(extras.items)}` : '');
    return { precio: c.precio, moneda, detalle, tela: info.Material };
}

module.exports = { CLAVE, REDONDEOS, TIPOS_VALOR, leerConfig, guardarConfig, normalizarConfig, datos, deProducto, cotizar, precioParaLinea, calcular, escalasDeTela, hayConsumo, hayCorteCostura, hayValoresAgregados };
