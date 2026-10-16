/*
 * ══════════════════════════════════════════════════════════════════════════
 *  EXPORTAR PRODUCTOS PUBLICADOS (14/10) — arma un .sql para crear en OTRA base
 *  los productos del configurador que están PUBLICADOS, con todo lo que cuelga.
 * ══════════════════════════════════════════════════════════════════════════
 *   node backend/scripts/exportar_productos_publicados.js                 → todos los PUBLICADO
 *   node backend/scripts/exportar_productos_publicados.js GEO-CUA-01 ...  → solo esos códigos
 *
 *  Sale en scripts/pasar_publicados/: PASAR_productos_publicados.sql + uploads/ (las fotos que
 *  usan) + LEEME.txt. El .sql se corre en la otra base y es re-ejecutable.
 *
 *  Qué viaja: Articulos, ProductoVentaConfig, PreciosBase, TiendaProductos, fotos
 *  (Articulos_Imagenes), ficha de diseño con sus pasos/anotaciones/extras, técnicas, opciones,
 *  modelos, telas, avíos (y por talle), apliques, accesorios, componentes, combos con sus
 *  servicios, surtido. Una variante publicada lleva a su PADRE (con el estado que tenga).
 *  Los catálogos que usan (familia de StockArt, etiqueta, técnica, avío, máquina, costura ISO)
 *  se crean allá si faltan, buscándolos por nombre/código.
 *
 *  Los IDs de allá son otros: todo se enlaza por código (CodArticulo) o por nombre. Los
 *  artículos ajenos (telas, ítems de combo, origen) NO se crean: si allá no existe el código,
 *  esa fila se saltea y el script lo avisa al final.
 *  No viajan: stock/variantes del WMS, órdenes, pedidos, perfiles de precio ni código de Odoo.
 * ══════════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');
const { sql, getPool } = require('../config/db');   // primero: carga el .env (UPLOADS_PATH)
const { urlUploadsADisco } = require('../utils/rutasUploads');

const SALIDA = path.resolve(__dirname, '..', '..', 'scripts', 'pasar_publicados');
const ARCHIVO_SQL = 'PASAR_productos_publicados.sql';

// Tablas que cuelgan de ProIdProducto y se pisan enteras (como al guardar en el configurador).
// refs: columna → a qué se enlaza allá (por código o nombre, nunca por ID).
const TABLAS_HIJAS = [
    { t: 'ProductoTerminadoServicios' },
    { t: 'ProductoTecnicaOpciones', refs: { TecnicaOpcionID: 'tecnica' } },
    { t: 'ProductoOrigenVariantes' },   // WmsVarianteId es del WMS (compartido): va tal cual
    { t: 'ProductoModelos' },           // ModeloClave es de TIZADA PRO: va tal cual
    { t: 'ProductoTelas', refs: { TelaProIdProducto: 'articulo' } },
    { t: 'ProductoAvios', refs: { ArtProIdProducto: 'articulo', AvioID: 'avio' } },
    { t: 'ProductoAviosTalle', refs: { AvioID: 'avio' } },
    { t: 'ProductoApliques', refs: { TecnicaOpcionID: 'tecnica' } },
    { t: 'ProductoAccesorios', refs: { ItemProIdProducto: 'articulo' } },
    { t: 'ProductoComponentes', refs: { OpcionID: 'componente' } },
    { t: 'ProductoFichaDisenoAnotaciones' },
    { t: 'ProductoFichaDisenoExtra' },
    { t: 'ProductoFichaDisenoCosturas', refs: { MaquinaCosturaID: 'maquina', AvioID: 'avio' } },
    { t: 'ProductoVariantes' }
];
// Del artículo viaja esto (si la columna existe). CodArticulo e IDProdReact se arman aparte;
// ProCodigoOdooProducto no (es de cada ERP).
const COLS_ARTICULO = ['Descripcion', 'SupFlia', 'Grupo', 'CodStock', 'Mostrar', 'anchoimprimible', 'LLEVAPAPEL',
    'MonIdMoneda', 'UniIdUnidad', 'largoimprimible', 'EnListaPrecios', 'EnListaPublica', 'DescripcionLista'];

// Qué migración agrega cada tabla/columna, para el aviso del chequeo previo
const F1 = ['TecnicaPrincipal', 'AnchoM', 'AltoM', 'BordeCm', 'UM', 'Molde', 'VisiblePortal', 'VisibleTienda', 'VisibleInterno'];
const PASO = ['Etapa', 'Descripcion', 'MaquinaCosturaID', 'TiempoMin', 'Observaciones', 'ImagenUrl'];
function migracionDe(t, c) {
    const k = `${t}.${c}`;
    if (t === 'ProductoEtiqueta' || k === 'ProductoVentaConfig.EtiquetaID') return 'configurador_etiquetas.sql';
    if (t === 'ProductoVentaConfig' && F1.includes(c)) return 'configurador_f1_produccion_principal.sql';
    if (['ProductoVentaConfig.PadreProIdProducto', 'ProductoVentaConfig.ModeloClave'].includes(k)) return 'configurador_variantes.sql';
    if (k === 'ProductoVentaConfig.AMedidaJson') return 'configurador_a_medida.sql';
    if (k === 'ProductoVentaConfig.TizadaMesasModo') return 'configurador_tizadapro_mesas.sql';
    if (t === 'ProductoAviosTalle' || ['ProductoAvios.VariaPorTalle', 'ProductoFichaDisenoCosturas.AvioID'].includes(k)) return 'configurador_ficha_avios_talle.sql';
    if (t === 'MaquinasCostura' || (t === 'ProductoFichaDisenoCosturas' && PASO.includes(c))
        || ['CosturasISO.Descripcion', 'CosturasISO.ImagenUrl', 'CosturasISO.MaquinaCosturaID'].includes(k)) return 'configurador_costuras_paso_a_paso.sql';
    if (['ProductoModelos', 'ProductoTelas', 'ProductoAvios', 'CatalogoAvios'].includes(t) || k === 'ProductoVentaConfig.TizadaProMoldeRef') return 'configurador_tizadapro.sql';
    if (t === 'ProductoAccesorios') return 'configurador_accesorios.sql';
    if (t.startsWith('Producto') || ['TecnicaOpciones', 'CosturasISO', 'ComponenteOpciones'].includes(t)) return 'configurador_productos.sql';
    return null;
}

const TIPOS_CHAR = new Set(['char', 'nchar']);
const sqlStr = (s) => `N'${String(s).replace(/'/g, "''")}'`;
const limpio = (v) => (typeof v === 'string' ? v.trim() : v);

async function main() {
    const pool = await getPool();
    const q = async (texto, entradas = {}) => {
        const rq = pool.request();
        for (const [k, [tipo, v]] of Object.entries(entradas)) rq.input(k, tipo, v);
        return (await rq.query(texto)).recordset;
    };

    // ── Columnas de cada tabla (vacío si no existe en esta base) ──
    const metas = new Map();
    async function meta(t) {
        if (!metas.has(t)) {
            metas.set(t, await q(`
                SELECT c.name, TYPE_NAME(c.user_type_id) AS typ, c.is_nullable AS nul, c.is_identity AS ident,
                       CAST(CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END AS BIT) AS def
                FROM sys.columns c
                WHERE c.object_id = OBJECT_ID(@T, 'U') AND c.is_computed = 0
                  AND TYPE_NAME(c.user_type_id) NOT IN ('timestamp', 'rowversion')
                ORDER BY c.column_id`, { T: [sql.NVarChar(256), `dbo.${t}`] }));
        }
        return metas.get(t);
    }
    const identidad = async (t) => (await meta(t)).find(c => c.ident)?.name;

    function lit(v, col) {
        if (v === null || v === undefined) return 'NULL';
        if (v instanceof Date) return 'GETDATE()';   // fechas de alta/modificación: las de allá
        if (typeof v === 'boolean') return v ? '1' : '0';
        if (typeof v === 'number') return String(v);
        if (Buffer.isBuffer(v)) return '0x' + v.toString('hex');
        const s = String(v);
        return sqlStr(col && TIPOS_CHAR.has(col.typ) ? s.replace(/\s+$/, '') : s);
    }

    // ── Qué productos ──
    const pedidos = process.argv.slice(2).map(s => s.trim()).filter(Boolean);
    const base = await q(`
        SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS Cod, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
               vc.Estado, vc.PadreProIdProducto
        FROM dbo.Articulos a
        JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
        WHERE ISNULL(a.borrar, 0) = 0
          AND ${pedidos.length ? `LTRIM(RTRIM(a.CodArticulo)) IN (${pedidos.map(sqlStr).join(', ')})` : `vc.Estado = 'PUBLICADO'`}`);
    if (!base.length) throw new Error(pedidos.length ? `No encontré esos códigos: ${pedidos.join(', ')}` : 'No hay productos PUBLICADOS.');
    const faltan = pedidos.filter(c => !base.some(b => b.Cod === c));
    if (faltan.length) throw new Error(`No encontré estos códigos (o no son del configurador): ${faltan.join(', ')}`);

    // Una variante necesita a su padre allá: se agrega con el estado que tenga
    const productos = new Map(base.map(p => [p.ProIdProducto, { ...p, motivo: null }]));
    for (const p of base) {
        if (p.PadreProIdProducto && !productos.has(p.PadreProIdProducto)) {
            const [padre] = await q(`
                SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS Cod, LTRIM(RTRIM(a.Descripcion)) AS Descripcion, vc.Estado, vc.PadreProIdProducto
                FROM dbo.Articulos a JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
                WHERE a.ProIdProducto = @P`, { P: [sql.Int, p.PadreProIdProducto] });
            if (!padre) throw new Error(`La variante ${p.Cod} apunta a un padre (${p.PadreProIdProducto}) que no existe.`);
            productos.set(padre.ProIdProducto, { ...padre, motivo: `padre de ${p.Cod}` });
        }
    }
    // Padres antes que variantes (la variante busca al padre por código)
    const lista = [...productos.values()].sort((a, b) => (!!a.PadreProIdProducto - !!b.PadreProIdProducto) || a.Cod.localeCompare(b.Cod));
    const codsExport = new Set(lista.map(p => p.Cod));

    // ── Enlaces por código / nombre ──
    const requeridas = new Map();   // tabla → Set(columnas) que el script usa
    const opcionales = new Set(['TiendaProductos']);
    const usar = (t, c) => { if (!requeridas.has(t)) requeridas.set(t, new Set()); if (c) requeridas.get(t).add(c); };
    const externos = new Map();     // cod → { desc, usos:Set } artículos que no viajan y tienen que existir allá
    const catalogo = { stockArt: new Set(), etiqueta: new Set(), tecnica: new Set(), avio: new Set(), maquina: new Set(), iso: new Set(), componente: new Set() };
    const fotos = new Set();
    const cache = new Map();
    const una = async (clave, fn) => { if (!cache.has(clave)) cache.set(clave, await fn()); return cache.get(clave); };

    const exprArticulo = (cod) => `(SELECT TOP 1 ProIdProducto FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = ${sqlStr(cod)} AND ISNULL(borrar, 0) = 0 ORDER BY ProIdProducto)`;
    const resolver = {
        async articulo(id, uso) {
            const a = await una(`art:${id}`, async () => (await q(`SELECT LTRIM(RTRIM(CodArticulo)) AS Cod, LTRIM(RTRIM(Descripcion)) AS D FROM dbo.Articulos WHERE ProIdProducto = @I`, { I: [sql.Int, id] }))[0]);
            if (!a) return 'NULL';
            if (!codsExport.has(a.Cod)) {
                if (!externos.has(a.Cod)) externos.set(a.Cod, { desc: a.D, usos: new Set() });
                externos.get(a.Cod).usos.add(uso);
            }
            return exprArticulo(a.Cod);
        },
        async tecnica(id) {
            const r = await una(`tec:${id}`, async () => (await q(`SELECT AreaID, Nombre FROM dbo.TecnicaOpciones WHERE TecnicaOpcionID = @I`, { I: [sql.Int, id] }))[0]);
            if (!r) return 'NULL';
            catalogo.tecnica.add(id);
            return `(SELECT TecnicaOpcionID FROM dbo.TecnicaOpciones WHERE AreaID = ${sqlStr(r.AreaID.trim())} AND Nombre = ${sqlStr(r.Nombre)})`;
        },
        async avio(id) {
            const r = await una(`avio:${id}`, async () => (await q(`SELECT Nombre FROM dbo.CatalogoAvios WHERE AvioID = @I`, { I: [sql.Int, id] }))[0]);
            if (!r) return 'NULL';
            catalogo.avio.add(id);
            return `(SELECT AvioID FROM dbo.CatalogoAvios WHERE Nombre = ${sqlStr(r.Nombre)})`;
        },
        async maquina(id) {
            const r = await una(`maq:${id}`, async () => (await q(`SELECT Nombre FROM dbo.MaquinasCostura WHERE MaquinaCosturaID = @I`, { I: [sql.Int, id] }))[0]);
            if (!r) return 'NULL';
            catalogo.maquina.add(id);
            return `(SELECT MaquinaCosturaID FROM dbo.MaquinasCostura WHERE Nombre = ${sqlStr(r.Nombre)})`;
        },
        async etiqueta(id) {
            const r = await una(`etq:${id}`, async () => (await q(`SELECT Nombre FROM dbo.ProductoEtiqueta WHERE EtiquetaID = @I`, { I: [sql.Int, id] }))[0]);
            if (!r) return 'NULL';
            catalogo.etiqueta.add(id);
            return `(SELECT EtiquetaID FROM dbo.ProductoEtiqueta WHERE Nombre = ${sqlStr(r.Nombre)})`;
        },
        // Opciones de componentes (cuellos, puños…): tienen piezas propias, no se crean; tienen que existir allá
        async componente(id) {
            const r = await una(`comp:${id}`, async () => (await q(`SELECT Tipo, Codigo, Nombre FROM dbo.ComponenteOpciones WHERE OpcionID = @I`, { I: [sql.Int, id] }))[0]);
            if (!r) return 'NULL';
            catalogo.componente.add(`${r.Tipo.trim()}|${r.Codigo.trim()}|${r.Nombre}`);
            return `(SELECT TOP 1 OpcionID FROM dbo.ComponenteOpciones WHERE Tipo = ${sqlStr(r.Tipo.trim())} AND Codigo = ${sqlStr(r.Codigo.trim())} ORDER BY OpcionID)`;
        }
    };

    // INSERT de una fila: columnas con valor (o sin nulo/default), IDs reemplazados por su búsqueda allá.
    // Si una referencia obligatoria no aparece allá, la fila no se inserta (WHERE … IS NOT NULL).
    async function insertFila(t, fila, { fijos = {}, refs = {}, uso = '' } = {}) {
        const cols = [], vals = [], conds = [];
        for (const c of await meta(t)) {
            if (c.ident) continue;
            const v = fila[c.name];
            let expr;
            if (fijos[c.name] !== undefined) expr = fijos[c.name];
            else if (v === null || v === undefined) { if (c.nul && !c.def) continue; expr = 'NULL'; }
            else if (refs[c.name]) {
                expr = await resolver[refs[c.name]](v, uso);
                if (!c.nul && expr !== 'NULL') conds.push(`${expr} IS NOT NULL`);
            } else expr = lit(v, c);
            cols.push(`[${c.name}]`); vals.push(expr); usar(t, c.name);
        }
        return `INSERT INTO dbo.[${t}] (${cols.join(', ')})\n    SELECT ${vals.join(',\n           ')}${conds.length ? `\n    WHERE ${conds.join(' AND ')}` : ''};`;
    }
    const filasDe = async (t, clave, id) => {
        if (!(await meta(t)).length) return [];
        const ord = await identidad(t);
        return q(`SELECT * FROM dbo.[${t}] WHERE [${clave}] = @I${ord ? ` ORDER BY [${ord}]` : ''}`, { I: [sql.Int, id] });
    };
    const guardFoto = (url) => { if (url && String(url).startsWith('/uploads/')) fotos.add(String(url)); };

    // ── Un bloque por producto ──
    const bloques = [];
    const colsArt = (await meta('Articulos')).map(c => c.name);
    usar('Articulos', 'CodArticulo'); usar('Articulos', 'IDProdReact'); usar('Articulos', 'borrar');
    for (const p of lista) {
        const L = [];
        const [art] = await q(`SELECT * FROM dbo.Articulos WHERE ProIdProducto = @I`, { I: [sql.Int, p.ProIdProducto] });
        const [vc] = await q(`SELECT * FROM dbo.ProductoVentaConfig WHERE ProIdProducto = @I`, { I: [sql.Int, p.ProIdProducto] });
        const metaArt = await meta('Articulos');
        const colsA = COLS_ARTICULO.filter(c => colsArt.includes(c) && (art[c] != null || !metaArt.find(m => m.name === c).nul));
        colsA.forEach(c => usar('Articulos', c));
        if (art.CodStock) catalogo.stockArt.add(String(art.CodStock).trim());
        const valA = (c) => lit(limpio(art[c]), metaArt.find(m => m.name === c));

        L.push(`-- ─────────────────────────────────────────────────────────────────────────`);
        L.push(`-- ${p.Cod} · ${p.Descripcion} (${p.Estado}${p.motivo ? ` — viaja por ser ${p.motivo}: solo se crea si allá no existe` : ''})`);
        L.push(`-- ─────────────────────────────────────────────────────────────────────────`);
        L.push(`SET @id = ${exprArticulo(p.Cod)};`);
        // El padre que viaja de arrastre no se pisa si allá ya está (puede tener otro estado o variantes propias)
        if (p.motivo) {
            L.push(`IF @id IS NOT NULL`);
            L.push(`    INSERT INTO @resumen VALUES (${sqlStr(p.Cod)}, ${sqlStr(p.Descripcion)}, ${sqlStr(p.Estado)}, @id, N'YA EXISTÍA (no se tocó)');`);
            L.push(`ELSE`);
            L.push(`BEGIN -- ${p.Cod}`);
        }
        L.push(`IF @id IS NULL`);
        L.push(`BEGIN`);
        L.push(`    INSERT INTO dbo.Articulos (CodArticulo, borrar, ${colsA.map(c => `[${c}]`).join(', ')})`);
        L.push(`    VALUES (${sqlStr(p.Cod)}, 0, ${colsA.map(valA).join(', ')});`);
        L.push(`    SET @id = SCOPE_IDENTITY();`);
        L.push(`    UPDATE dbo.Articulos SET IDProdReact = @id WHERE ProIdProducto = @id;`);
        L.push(`    INSERT INTO @resumen VALUES (${sqlStr(p.Cod)}, ${sqlStr(p.Descripcion)}, ${sqlStr(p.Estado)}, @id, 'CREADO');`);
        L.push(`END`);
        L.push(`ELSE`);
        L.push(`BEGIN`);
        L.push(`    UPDATE dbo.Articulos SET ${colsA.map(c => `[${c}] = ${valA(c)}`).join(', ')} WHERE ProIdProducto = @id;`);
        L.push(`    INSERT INTO @resumen VALUES (${sqlStr(p.Cod)}, ${sqlStr(p.Descripcion)}, ${sqlStr(p.Estado)}, @id, 'ACTUALIZADO');`);
        L.push(`END`);

        // Se pisa la configuración entera (si ya existía allá queda igual a la de acá)
        L.push(`-- se borra la configuración anterior (si la había) y se carga la de acá`);
        L.push(`IF OBJECT_ID('dbo.ProductoComboItemServicios', 'U') IS NOT NULL DELETE s FROM dbo.ProductoComboItemServicios s JOIN dbo.ProductoComboItems ci ON ci.ID = s.ComboItemID WHERE ci.ProIdProducto = @id;`);
        for (const t of ['ProductoComboItems', ...TABLAS_HIJAS.map(x => x.t), 'ProductoFichaDiseno', 'ProductoVentaConfig', 'TiendaProductos'])
            L.push(`IF OBJECT_ID('dbo.${t}', 'U') IS NOT NULL DELETE FROM dbo.${t} WHERE ProIdProducto = @id;`);
        L.push(`DELETE FROM dbo.Articulos_Imagenes WHERE Idproid = @id;`);
        usar('Articulos_Imagenes', 'Idproid');

        // Configuración de venta
        if (vc.PadreProIdProducto && vc.ModeloClave) {
            const padre = productos.get(vc.PadreProIdProducto);
            L.push(`IF EXISTS (SELECT 1 FROM dbo.ProductoVentaConfig WHERE PadreProIdProducto = ${exprArticulo(padre.Cod)} AND ModeloClave = ${sqlStr(vc.ModeloClave)} AND ProIdProducto <> @id)`);
            L.push(`    THROW 50001, ${sqlStr(`Allá ya hay otra variante de ${padre.Cod} para el modelo ${vc.ModeloClave} (con otro código que ${p.Cod}). Borrala o cambiale el modelo y volvé a correr el script.`)}, 1;`);
        }
        L.push(await insertFila('ProductoVentaConfig', vc, {
            fijos: { ProIdProducto: '@id' },
            refs: { EtiquetaID: 'etiqueta', PadreProIdProducto: 'articulo', OrigenProIdProducto: 'articulo' },
            uso: `origen/padre de ${p.Cod}`
        }));

        // Ficha de diseño
        for (const f of await filasDe('ProductoFichaDiseno', 'ProIdProducto', p.ProIdProducto)) {
            guardFoto(f.DibujoUrl);
            L.push(await insertFila('ProductoFichaDiseno', f, { fijos: { ProIdProducto: '@id' } }));
        }
        // Listas
        for (const { t, refs } of TABLAS_HIJAS) {
            const filas = await filasDe(t, 'ProIdProducto', p.ProIdProducto);
            for (const f of filas) {
                if (t === 'ProductoFichaDisenoCosturas') { guardFoto(f.ImagenUrl); if (f.CodigoISO) catalogo.iso.add(f.CodigoISO.trim()); }
                L.push(await insertFila(t, f, { fijos: { ProIdProducto: '@id' }, refs, uso: `${t === 'ProductoTelas' ? 'tela' : t === 'ProductoAvios' ? 'avío' : 'ítem'} de ${p.Cod}` }));
            }
        }
        // Combo: cada ítem con sus servicios (cuelgan del ID nuevo del ítem)
        for (const ci of await filasDe('ProductoComboItems', 'ProIdProducto', p.ProIdProducto)) {
            L.push(`SET @ci = NULL;`);
            L.push((await insertFila('ProductoComboItems', ci, { fijos: { ProIdProducto: '@id' }, refs: { ItemProIdProducto: 'articulo' }, uso: `ítem del combo ${p.Cod}` }))
                .replace(/;$/, `;\nIF @@ROWCOUNT > 0 SET @ci = SCOPE_IDENTITY();`));
            for (const s of await filasDe('ProductoComboItemServicios', 'ComboItemID', ci.ID)) {
                L.push(`IF @ci IS NOT NULL`);
                L.push(await insertFila('ProductoComboItemServicios', s, { fijos: { ComboItemID: '@ci' }, refs: { TecnicaOpcionID: 'tecnica' } }));
            }
        }
        // Fotos
        for (const f of await filasDe('Articulos_Imagenes', 'Idproid', p.ProIdProducto)) {
            guardFoto(f.url_imagen);
            L.push(await insertFila('Articulos_Imagenes', f, { fijos: { Idproid: '@id' } }));
        }
        // Vitrina de la tienda (si allá existe la tabla)
        const tienda = await filasDe('TiendaProductos', 'ProIdProducto', p.ProIdProducto);
        if (tienda.length) {
            L.push(`IF OBJECT_ID('dbo.TiendaProductos', 'U') IS NOT NULL`);
            L.push(`BEGIN`);
            for (const f of tienda) L.push(await insertFila('TiendaProductos', f, { fijos: { ProIdProducto: '@id' } }));
            L.push(`END`);
        }
        // Precio (único por código y moneda)
        for (const pr of await q(`SELECT * FROM dbo.PreciosBase WHERE LTRIM(RTRIM(CodArticulo)) = @C`, { C: [sql.NVarChar(50), p.Cod] })) {
            const mon = pr.Moneda ? String(pr.Moneda).trim() : 'UYU';
            ['CodArticulo', 'Precio', 'Moneda', 'MonIdMoneda', 'UltimaActualizacion', 'ProIdProducto'].forEach(c => usar('PreciosBase', c));
            L.push(`UPDATE dbo.PreciosBase SET Precio = ${lit(pr.Precio)}, MonIdMoneda = ${lit(pr.MonIdMoneda)}, ProIdProducto = @id, UltimaActualizacion = GETDATE()`);
            L.push(`    WHERE LTRIM(RTRIM(CodArticulo)) = ${sqlStr(p.Cod)} AND Moneda = ${sqlStr(mon)};`);
            L.push(`IF @@ROWCOUNT = 0 INSERT INTO dbo.PreciosBase (CodArticulo, Precio, Moneda, MonIdMoneda, UltimaActualizacion, ProIdProducto)`);
            L.push(`    VALUES (${sqlStr(p.Cod)}, ${lit(pr.Precio)}, ${sqlStr(mon)}, ${lit(pr.MonIdMoneda)}, GETDATE(), @id);`);
        }
        if (p.motivo) L.push(`END -- ${p.Cod}`);
        bloques.push(L.join('\n'));
    }

    // ── Catálogos: se crean allá si faltan (no se pisan los que ya estén) ──
    const cat = [];
    const crearSiFalta = async (t, fila, donde, { refs = {}, log }) => {
        cat.push(`IF NOT EXISTS (SELECT 1 FROM dbo.${t} WHERE ${donde})\nBEGIN\n    ${(await insertFila(t, fila, { refs, uso: `catálogo ${t}` })).replace(/\n/g, '\n    ')}\n    INSERT INTO @creados VALUES (${sqlStr(t)}, ${sqlStr(log)});\nEND`);
    };
    const porId = (t, col, ids) => ids.size ? q(`SELECT * FROM dbo.${t} WHERE ${col} IN (${[...ids].map(Number).join(', ')}) ORDER BY ${col}`) : [];
    // Costuras ISO primero: su máquina entra en el catálogo de máquinas
    const isos = catalogo.iso.size ? await q(`SELECT * FROM dbo.CosturasISO WHERE LTRIM(RTRIM(CodigoISO)) IN (${[...catalogo.iso].map(sqlStr).join(', ')})`) : [];
    for (const r of isos) if (r.MaquinaCosturaID) await resolver.maquina(r.MaquinaCosturaID);
    const avios = await porId('CatalogoAvios', 'AvioID', catalogo.avio);
    for (const r of avios) if (r.ArtProIdProducto) await resolver.articulo(r.ArtProIdProducto, `avío "${r.Nombre}" del catálogo`);

    for (const cs of [...catalogo.stockArt].sort()) {
        const [r] = await q(`SELECT * FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock)) = @C`, { C: [sql.VarChar(50), cs] });
        if (r) await crearSiFalta('StockArt', r, `LTRIM(RTRIM(CodStock)) = ${sqlStr(cs)}`, { log: `${cs} ${limpio(r.Articulo)}` });
    }
    for (const r of await porId('ProductoEtiqueta', 'EtiquetaID', catalogo.etiqueta))
        await crearSiFalta('ProductoEtiqueta', r, `Nombre = ${sqlStr(r.Nombre)}`, { log: r.Nombre });
    for (const r of await porId('MaquinasCostura', 'MaquinaCosturaID', catalogo.maquina))
        await crearSiFalta('MaquinasCostura', r, `Nombre = ${sqlStr(r.Nombre)}`, { log: r.Nombre });
    for (const r of isos)
        await crearSiFalta('CosturasISO', r, `LTRIM(RTRIM(CodigoISO)) = ${sqlStr(r.CodigoISO.trim())}`, { refs: { MaquinaCosturaID: 'maquina' }, log: `${r.CodigoISO.trim()} ${r.Nombre}` });
    for (const r of await porId('TecnicaOpciones', 'TecnicaOpcionID', catalogo.tecnica))
        await crearSiFalta('TecnicaOpciones', r, `AreaID = ${sqlStr(r.AreaID.trim())} AND Nombre = ${sqlStr(r.Nombre)}`, { log: `${r.AreaID.trim()} · ${r.Nombre}` });
    for (const r of avios)
        await crearSiFalta('CatalogoAvios', r, `Nombre = ${sqlStr(r.Nombre)}`, { refs: { ArtProIdProducto: 'articulo' }, log: r.Nombre });

    // ── Avisos: lo que tiene que existir allá y no se crea ──
    const avisos = [];
    for (const [cod, x] of [...externos].sort()) {
        avisos.push(`IF NOT EXISTS (SELECT 1 FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = ${sqlStr(cod)} AND ISNULL(borrar, 0) = 0)\n    INSERT INTO @avisos VALUES (${sqlStr(`No existe el artículo ${cod} "${x.desc}" (${[...x.usos].join(', ')}): no se enlaza.`)});`);
    }
    for (const k of catalogo.componente) {
        const [tipo, codigo, nombre] = k.split('|');
        avisos.push(`IF NOT EXISTS (SELECT 1 FROM dbo.ComponenteOpciones WHERE Tipo = ${sqlStr(tipo)} AND Codigo = ${sqlStr(codigo)})\n    INSERT INTO @avisos VALUES (${sqlStr(`No existe la opción de componente ${tipo} ${codigo} "${nombre}": no se enlaza.`)});`);
    }

    // ── Chequeo previo de estructura (tablas/columnas que el script usa) ──
    // Columna NULL = la tabla tiene que existir. Las opcionales (TiendaProductos) solo se revisan si existen.
    const chequeos = [];
    const mig = (t, c) => { const m = migracionDe(t, c); return sqlStr(m ? `docs/migrations/${m}` : ''); };
    for (const [t, cols] of requeridas) {
        if (!opcionales.has(t)) chequeos.push(`(N'${t}', NULL, ${mig(t, null)})`);
        for (const c of cols) chequeos.push(`(N'${t}', N'${c}', ${mig(t, c)})`);
    }

    // ── Fotos: se copian al lado del .sql ──
    fs.mkdirSync(SALIDA, { recursive: true });
    const fotosOk = [], fotosFalta = [];
    for (const url of [...fotos].sort()) {
        const disco = urlUploadsADisco(url) || urlUploadsADisco(decodeURI(url));
        const rel = url.slice('/uploads/'.length);
        if (disco && fs.existsSync(disco)) {
            const dest = path.join(SALIDA, 'uploads', rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(disco, dest);
            fotosOk.push(rel);
        } else fotosFalta.push(url);
    }

    // ── Armado del .sql ──
    const hoy = new Date().toISOString().slice(0, 10);
    const lineasProd = lista.map(p => `--   ${p.Cod.padEnd(16)} ${p.Descripcion}${p.Estado !== 'PUBLICADO' ? `  [${p.Estado}${p.motivo ? `, ${p.motivo}: se crea solo si allá no existe` : ''}]` : ''}`);
    const textoSql = `/* ══════════════════════════════════════════════════════════════════════════
 *  PASAR PRODUCTOS PUBLICADOS DEL CONFIGURADOR  (generado el ${hoy})
 * ══════════════════════════════════════════════════════════════════════════
 *  Crea en ESTA base los productos de abajo con toda su configuración: artículo,
 *  venta, precio, vitrina de la tienda, fotos, ficha de diseño y pasos de costura,
 *  técnicas, modelos, telas, avíos y apliques. Los catálogos que usan (familia,
 *  etiqueta, técnica, avío, máquina, costura ISO) se crean si faltan.
 *
 *  CÓMO CORRERLO
 *   1. Abrilo en SQL Server Management Studio, elegí la base del sistema (arriba a
 *      la izquierda, NO master) y apretá F5.
 *   2. Copiá la carpeta "uploads" que viene al lado de este archivo adentro de la
 *      carpeta uploads del backend (backend/uploads, o la de UPLOADS_PATH del .env).
 *      Son las fotos de los productos: sin eso, salen sin imagen.
 *
 *  Es todo o nada: si algo falla no queda nada a medias. Se puede correr más de
 *  una vez: si el código ya existe, el producto se actualiza (no se duplica).
 *  Si a la base le falta alguna migración, el script no hace nada y dice cuál correr.
 *
 *  Productos (${lista.length}):
${lineasProd.join('\n')}
 * ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

-- ── 0. Chequeo de estructura ─────────────────────────────────────────────
SET NOEXEC OFF;
DECLARE @faltan TABLE (Falta NVARCHAR(300), CorrerAntes NVARCHAR(300));
IF OBJECT_ID('dbo.Articulos', 'U') IS NULL OR OBJECT_ID('dbo.ProductoVentaConfig', 'U') IS NULL
    INSERT INTO @faltan VALUES (N'Esta no es la base del sistema (no tiene Articulos / ProductoVentaConfig)', N'Elegí la base correcta');
INSERT INTO @faltan
SELECT CASE WHEN u.Col IS NULL THEN N'tabla ' + u.Tabla ELSE N'columna ' + u.Tabla + N'.' + u.Col END, u.Migracion
FROM (VALUES
    ${chequeos.join(',\n    ')}
) AS u (Tabla, Col, Migracion)
WHERE (u.Col IS NULL AND OBJECT_ID(N'dbo.' + u.Tabla, 'U') IS NULL)
   OR (u.Col IS NOT NULL AND OBJECT_ID(N'dbo.' + u.Tabla, 'U') IS NOT NULL AND COL_LENGTH(N'dbo.' + u.Tabla, u.Col) IS NULL);
IF EXISTS (SELECT 1 FROM @faltan)
BEGIN
    SELECT * FROM @faltan;
    RAISERROR(N'A esta base le faltan tablas o columnas (ver la grilla). No se hizo NADA: corré esas migraciones y volvé a correr este script.', 16, 1);
    SET NOEXEC ON;   -- lo que sigue no se ejecuta
END
GO

-- ── 1. Carga (una sola transacción) ──────────────────────────────────────
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @id INT, @ci INT;
DECLARE @resumen TABLE (Codigo NVARCHAR(50), Producto NVARCHAR(200), Estado NVARCHAR(20), ProIdProductoAca INT, Accion NVARCHAR(30));
DECLARE @creados TABLE (Catalogo NVARCHAR(50), Nombre NVARCHAR(300));
DECLARE @avisos  TABLE (Aviso NVARCHAR(500));

-- Artículos que no viajan y se enlazan por código: si falta alguno, esa fila se saltea
${avisos.join('\n') || '-- (ninguno)'}

-- ── Catálogos (solo si faltan; los que ya existen no se tocan) ──
${cat.join('\n') || '-- (ninguno)'}

${bloques.join('\n\n')}

COMMIT TRANSACTION;

SELECT * FROM @resumen ORDER BY Codigo;
IF EXISTS (SELECT 1 FROM @creados) SELECT * FROM @creados ORDER BY Catalogo, Nombre;
IF EXISTS (SELECT 1 FROM @avisos) SELECT * FROM @avisos;
PRINT N'Listo: productos cargados. Acordate de copiar la carpeta uploads (fotos).';
GO
SET NOEXEC OFF;
GO
`;
    fs.writeFileSync(path.join(SALIDA, ARCHIVO_SQL), '﻿' + textoSql.replace(/\r?\n/g, '\r\n'), 'utf8');

    const leeme = `PASAR PRODUCTOS PUBLICADOS (generado el ${hoy})
==========================================

1. Abrí ${ARCHIVO_SQL} en SQL Server Management Studio.
2. Elegí la base del sistema (NO master) y apretá F5.
   - Si falta alguna migración, no hace nada y te muestra cuál correr (están en docs/migrations).
   - Al final muestra los productos creados, los catálogos que agregó y los avisos.
3. Copiá la carpeta "uploads" de acá adentro de la carpeta uploads del backend
   (backend/uploads, o la que diga UPLOADS_PATH en el .env). Son las fotos.

Se puede correr más de una vez: si el producto ya existe (mismo código), lo actualiza.

Productos:
${lista.map(p => `  ${p.Cod.padEnd(16)} ${p.Descripcion}${p.Estado !== 'PUBLICADO' ? `  [${p.Estado}${p.motivo ? `, ${p.motivo}: se crea solo si allá no existe` : ''}]` : ''}`).join('\n')}

Fotos (${fotosOk.length}):
${fotosOk.map(f => `  uploads/${f}`).join('\n') || '  (ninguna)'}
`;
    fs.writeFileSync(path.join(SALIDA, 'LEEME.txt'), leeme.replace(/\r?\n/g, '\r\n'), 'utf8');

    console.log(`\nListo → ${path.join(SALIDA, ARCHIVO_SQL)}`);
    console.log(`Productos (${lista.length}): ${lista.map(p => `${p.Cod}${p.motivo ? ` (${p.motivo})` : ''}`).join(', ')}`);
    console.log(`Fotos copiadas: ${fotosOk.length}${fotosFalta.length ? ` · NO encontradas: ${fotosFalta.join(', ')}` : ''}`);
    if (externos.size) console.log(`Tienen que existir allá (por código): ${[...externos.keys()].join(', ')}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
