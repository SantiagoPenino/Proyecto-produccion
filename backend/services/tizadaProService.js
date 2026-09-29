'use strict';
// =====================================================================
// TizadaPro — lector de SOLO LECTURA de la base externa de tizadas
// =====================================================================
// TizadaPro es el sistema que arma los moldes y las tizadas. Vive en la base
// `TizadaPro` del MISMO servidor SQL (sin API). Acá se lee lo que nuestro
// sistema necesita y NUNCA se escribe: su catálogo es un JSON con contador de
// versión (config.clave='catalogo') y tocarlo desde afuera lo puede romper.
//
// Qué expone:
//   - moldes(): los moldes activos con sus modelos (variantes de piezas), piezas,
//     talles y telas permitidas (por molde y por pieza) → configurador.
//   - trabajos(dias) / trabajo(id): tizadas terminadas con sus hojas por tela
//     (ancho, consumo, piezas) → solicitudes.
//   - telas(): las telas de TizadaPro son copias de NUESTROS artículos
//     (id = ProIdProducto, codigo = CodArticulo); acá se pasa de una a otra.
//
// El molde se identifica por `legacy_id` ("prod_AAAAMMDD_…"), que es estable;
// el id numérico cambia entre restauraciones de la base.
// =====================================================================
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

const DB = /^[A-Za-z0-9_]+$/.test(process.env.TIZADAPRO_DB || '') ? process.env.TIZADAPRO_DB : 'TizadaPro';
const fallo = (status, mensaje) => { const e = new Error(mensaje); e.status = status; return e; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const jsonObj = (s) => { try { return s ? JSON.parse(s) : {}; } catch (_) { return {}; } };

// ¿Se puede leer TizadaPro desde este servidor? Mensaje claro si falta la base o el permiso.
async function exigir(pool) {
    const r = await pool.request().input('Db', sql.NVarChar(128), DB).query('SELECT DB_ID(@Db) AS id');
    if (r.recordset[0].id == null) throw fallo(503, `La base ${DB} no está en este servidor SQL.`);
    try { await pool.request().query(`SELECT TOP 0 id FROM [${DB}].dbo.trabajo`); }
    catch (e) { throw fallo(503, `No se puede leer TizadaPro (${e.message}). Falta darle permiso de lectura al usuario del sistema sobre la base ${DB}.`); }
}

// Catálogo JSON de TizadaPro (productos = moldes, telas, grupos, variantes…). Se cachea 60 s.
let _cat = { t: 0, v: null };
async function catalogo(pool) {
    if (_cat.v && Date.now() - _cat.t < 60000) return _cat.v;
    const r = await pool.request().query(`SELECT valor FROM [${DB}].dbo.config WHERE clave = 'catalogo'`);
    _cat = { t: Date.now(), v: jsonObj(r.recordset[0]?.valor) };
    return _cat.v;
}

// Telas de TizadaPro → nuestro artículo. Devuelve Map por nombre normalizado y por id.
async function telas(pool) {
    const cat = await catalogo(pool);
    const porNombre = new Map(), porId = new Map();
    (cat.telas || []).forEach(t => {
        const v = { id: String(t.id), proIdProducto: parseInt(t.id, 10) || null, codArticulo: String(t.codigo ?? '').trim(), nombre: t.nombre, anchoCm: t.ancho_cm ?? null };
        porNombre.set(norm(t.nombre), v); porId.set(String(t.id), v);
    });
    return { porNombre, porId };
}

// ---------------------------------------------------------------------
// Moldes (productos de TizadaPro) con piezas, talles, modelos y telas permitidas
// ---------------------------------------------------------------------
async function moldes(pool, { ref = null, soloActivos = true } = {}) {
    await exigir(pool);
    const [cat, tl, filas, piezas, tallesR] = await Promise.all([
        catalogo(pool), telas(pool),
        pool.request().query(`SELECT id, nombre, legacy_id, variante_guia, activo, creado_en, modificado_en FROM [${DB}].dbo.producto ${soloActivos ? 'WHERE activo = 1' : ''} ORDER BY nombre`),
        pool.request().query(`SELECT id, producto_id, id_en_molde, nombre, nombre_generico FROM [${DB}].dbo.pieza ORDER BY producto_id, id_en_molde`),
        pool.request().query(`SELECT producto_id, nombre, orden FROM [${DB}].dbo.talle ORDER BY producto_id, orden`),
    ]);
    // Medidas (cm) de cada pieza en el talle guía del molde, para dibujar una silueta a escala.
    // TizadaPro no guarda el contorno de la pieza en su base (solo el PDF en su disco): se muestra
    // el rectángulo que ocupa, no la forma real.
    const medidas = new Map();   // pieza_id → { anchoCm, altoCm }
    try {
        const md = await pool.request().query(`
            SELECT pt.pieza_id, MAX(pt.ancho_cm) AS ancho_cm, MAX(pt.alto_cm) AS alto_cm
            FROM [${DB}].dbo.pieza_talle pt
            INNER JOIN [${DB}].dbo.talle t ON t.id = pt.talle_id
            INNER JOIN [${DB}].dbo.producto p ON p.id = t.producto_id
            WHERE t.nombre = p.variante_guia
            GROUP BY pt.pieza_id`);
        md.recordset.forEach(x => medidas.set(x.pieza_id, { anchoCm: x.ancho_cm != null ? Number(x.ancho_cm) : null, altoCm: x.alto_cm != null ? Number(x.alto_cm) : null }));
    } catch (e) { logger.warn(`[TizadaPro] sin medidas de piezas: ${e.message}`); }
    const catPorRef = new Map((cat.productos || []).map(p => [p.id, p]));
    const piezasPor = new Map(); piezas.recordset.forEach(p => { if (!piezasPor.has(p.producto_id)) piezasPor.set(p.producto_id, []); piezasPor.get(p.producto_id).push(p); });
    const tallesPor = new Map(); tallesR.recordset.forEach(t => { if (!tallesPor.has(t.producto_id)) tallesPor.set(t.producto_id, []); tallesPor.get(t.producto_id).push(t.nombre); });

    // Precio base de cada tela = NUESTRA lista de precios (PreciosBase). Se muestra, no se edita acá:
    // cambiar precios es competencia del área de Precios, no del configurador.
    const precios = new Map();
    try {
        const pr = await pool.request().query(`SELECT ProIdProducto, Precio, Moneda FROM dbo.PreciosBase WHERE ProIdProducto IS NOT NULL`);
        pr.recordset.forEach(x => precios.set(x.ProIdProducto, { precio: x.Precio, moneda: String(x.Moneda || '').trim() }));
    } catch (e) { logger.warn(`[TizadaPro] sin precios base: ${e.message}`); }
    // Un molde puede apuntar a una tela que TizadaPro no tiene en su catálogo (copia vieja de
    // nuestros artículos): se avisa qué pasó con ella en NUESTRA base (oculta / borrada / sin sincronizar).
    const nuestras = new Map();
    try {
        const ar = await pool.request().query(`SELECT ProIdProducto, LTRIM(RTRIM(Descripcion)) AS d, ISNULL(Mostrar, 1) AS m, ISNULL(borrar, 0) AS b FROM dbo.Articulos`);
        ar.recordset.forEach(x => nuestras.set(x.ProIdProducto, x));
    } catch (e) { logger.warn(`[TizadaPro] sin artículos: ${e.message}`); }
    const telaDe = (id) => {
        const t = tl.porId.get(String(id));
        if (!t) {
            const a = nuestras.get(parseInt(id, 10));
            if (!a || a.b) return { proIdProducto: null, codArticulo: null, nombre: `Tela ${id}`, anchoCm: null, precioBase: null, moneda: null, estado: 'BORRADA', aviso: 'TizadaPro la tiene en este molde, pero ya no existe en nuestro catálogo. Quitala del molde en TizadaPro.' };
            return { proIdProducto: null, codArticulo: null, nombre: a.d, anchoCm: null, precioBase: null, moneda: null, estado: a.m ? 'SIN_SINCRONIZAR' : 'OCULTA', aviso: a.m ? 'Está en nuestro catálogo pero TizadaPro todavía no la sincronizó.' : 'Está oculta en nuestro catálogo. Para ofrecerla, mostrala en Artículos y sincronizá TizadaPro.' };
        }
        const p = precios.get(t.proIdProducto) || {};
        return { proIdProducto: t.proIdProducto, codArticulo: t.codArticulo, nombre: t.nombre, anchoCm: t.anchoCm, precioBase: p.precio ?? null, moneda: p.moneda || null, estado: 'OK', aviso: null };
    };

    // Siluetas ya procesadas (nuestra tabla): por molde, solo del talle guía
    const svgPor = new Map();
    try {
        const sv = await pool.request().query(`SELECT MoldeRef, Pieza, Talle, SvgPath FROM dbo.TizadaProMoldePiezas${ref ? ' WHERE MoldeRef = @Ref' : ''}`.replace('@Ref', `'${String(ref || '').replace(/'/g, "''")}'`));
        sv.recordset.forEach(x => { if (!svgPor.has(x.MoldeRef)) svgPor.set(x.MoldeRef, []); svgPor.get(x.MoldeRef).push(x); });
    } catch (e) { /* falta el SQL de siluetas: se muestran sin dibujo */ }

    const lista = filas.recordset
        .filter(p => !ref || p.legacy_id === ref)
        .map(p => {
            const c = catPorRef.get(p.legacy_id) || {};
            const pz = piezasPor.get(p.id) || [];
            // Modelos = "variantes" de TizadaPro: cada una es la lista de piezas de una combinación (ej. Cuello V común + costadillo fino)
            const grupos = new Map((c.grupos || []).map(g => [g.id, g.nombre]));
            // Un modelo = subconjunto de piezas del molde (valores[].pieza_id ↔ pieza.id_en_molde).
            // El molde puede tener varias versiones de una misma pieza ("Frente 1".."Frente 5"): el
            // modelo dice cuál va. `nombre` es único dentro del molde; `generico` es la pieza en sí.
            const modelos = (c.variantes || []).map(v => ({
                clave: v.clave, nombre: v.label, grupo: grupos.get(v.grupoId) || null,
                piezas: (v.valores || []).map(x => x.label),
                piezasIds: (v.valores || []).map(x => x.pieza_id).filter(x => x != null),
            }));
            const tc = c.telas_cfg || {};
            return {
                ref: p.legacy_id, id: p.id, nombre: p.nombre, talleGuia: p.variante_guia || null, activo: !!p.activo,
                fecha: p.modificado_en || p.creado_en || null,
                piezas: pz.map(x => x.nombre),   // únicas dentro del molde (ej. "Frente 3")
                piezasGenericas: [...new Set(pz.map(x => x.nombre_generico || x.nombre))],   // la pieza en sí (ej. "Frente"), para ubicar apliques
                piezasDetalle: pz.map(x => {
                    const nombre = x.nombre, generico = x.nombre_generico || x.nombre;
                    const svgs = svgPor.get(p.legacy_id) || [];
                    const buscar = (n) => svgs.find(s => s.Pieza === n && s.Talle === p.variante_guia) || svgs.find(s => s.Pieza === n) || null;
                    const svg = buscar(nombre) || (nombre !== generico ? buscar(generico) : null);
                    return { idEnMolde: x.id_en_molde, nombre, generico, ...(medidas.get(x.id) || { anchoCm: null, altoCm: null }), svgPath: svg ? svg.SvgPath : null };
                }),
                siluetas: (svgPor.get(p.legacy_id) || []).length > 0,
                talles: tallesPor.get(p.id) || [],
                modelos,
                telas: (tc.todas || []).map(telaDe),
                telasPorPieza: Object.fromEntries(Object.entries(tc.por_pieza || {}).map(([pieza, ids]) => [pieza, (ids || []).map(telaDe)])),
                completo: pz.length > 0 && (tallesPor.get(p.id) || []).length > 0,
            };
        });
    return lista;
}

// ---------------------------------------------------------------------
// Tizadas terminadas (trabajo.estado = 'listo') con sus hojas por tela
// ---------------------------------------------------------------------
function resumirTrabajo(t, tl, materiales) {
    const res = jsonObj(t.resultado);
    const hojas = (res.hojas || []).map(h => {
        const tp = tl.porNombre.get(norm(h.tela));
        const mat = (tp && materiales.find(x => String(x.CodArticulo).trim() === tp.codArticulo))
            || materiales.find(x => norm(x.Material) === norm(h.tela)) || null;
        return {
            archivo: h.archivo, tela: h.tela, paginas: h.paginas || 1,
            anchoCm: Number(h.ancho_cm) || null, consumoCm: Number(h.consumo_cm) || null,
            alturasCm: h.alturas_cm || [], aprovechamiento: h.aprovechamiento ?? null,
            codArticulo: mat ? String(mat.CodArticulo).trim() : null,
            material: mat ? String(mat.Material).trim() : null,
        };
    });
    return {
        trabajoId: t.id, ref: t.legacy_id || null,
        molde: t.molde_nombre || (res.moldes || []).join(', ') || null, moldeRef: t.moldes || null,
        fecha: t.creado_en || null, piezas: res.piezas ?? null, hojas,
        ficha: res.ficha || null, avisos: [...(res.avisos || []), ...(res.avisos_pedido || [])],
    };
}

// `materiales` = telas de sublimación que acepta la conversión a pedido (services/solicitudesVendedorConversion.materialesPrincipal)
async function trabajos(pool, materiales, { dias = 15, moldeRef = null } = {}) {
    await exigir(pool);
    const d = Math.min(Math.max(parseInt(dias, 10) || 15, 1), 120);
    const r = await pool.request().input('Dias', sql.Int, d).query(`
        SELECT TOP 100 id, legacy_id, estado, moldes, molde_nombre, creado_en, resultado
        FROM [${DB}].dbo.trabajo
        WHERE estado = 'listo' AND creado_en >= DATEADD(DAY, -@Dias, SYSUTCDATETIME())
        ORDER BY creado_en DESC`);
    const tl = await telas(pool);
    return r.recordset.filter(t => !moldeRef || t.moldes === moldeRef).map(t => resumirTrabajo(t, tl, materiales));
}

async function trabajo(pool, materiales, id) {
    await exigir(pool);
    const r = await pool.request().input('T', sql.Int, id)
        .query(`SELECT id, legacy_id, estado, moldes, molde_nombre, creado_en, resultado FROM [${DB}].dbo.trabajo WHERE id = @T`);
    const t = r.recordset[0];
    if (!t) return null;
    return { estado: t.estado, ...resumirTrabajo(t, await telas(pool), materiales) };
}

// ---------------------------------------------------------------------
// Siluetas: contornos del PDF del molde cruzados con las cajas de TizadaPro
// ---------------------------------------------------------------------
// Devuelve { talleGuia, piezas: { [nombrePieza]: { svgPath, anchoCm, altoCm } } } para el talle guía,
// leído de NUESTRA tabla TizadaProMoldePiezas (vacía hasta que se suba el PDF del molde).
async function siluetas(pool, ref, talleGuia) {
    try {
        const r = await pool.request().input('Ref', sql.NVarChar(128), ref).input('T', sql.NVarChar(96), talleGuia || '')
            .query(`SELECT Pieza, SvgPath, AnchoCm, AltoCm, Talle FROM dbo.TizadaProMoldePiezas WHERE MoldeRef = @Ref AND (Talle = @T OR @T = '')`);
        const out = {};
        r.recordset.forEach(x => { if (!out[x.Pieza] || x.Talle === talleGuia) out[x.Pieza] = { svgPath: x.SvgPath, anchoCm: x.AnchoCm, altoCm: x.AltoCm }; });
        return out;
    } catch (e) { return {}; }   // sin la tabla (falta el SQL) → sin siluetas
}

// Procesa el PDF del molde: cada caja por pieza/talle de TizadaPro busca su contorno en el PDF
// (mismas coordenadas, eje Y invertido) y se guarda como SVG. Devuelve el resumen.
async function procesarPdfMolde(pool, ref, rutaPdf, nombreArchivo) {
    await exigir(pool);
    const contorno = require('./moldeContornoService');
    const prod = await pool.request().input('Ref', sql.NVarChar(128), ref)
        .query(`SELECT id, nombre, variante_guia FROM [${DB}].dbo.producto WHERE legacy_id = @Ref`);
    if (!prod.recordset.length) throw fallo(404, 'Ese molde no está en TizadaPro.');
    const molde = prod.recordset[0];
    const cajas = await pool.request().input('P', sql.Int, molde.id).query(`
        SELECT pz.nombre AS pieza, t.nombre AS talle, pt.bbox_mu, pt.ancho_cm, pt.alto_cm
        FROM [${DB}].dbo.pieza_talle pt
        INNER JOIN [${DB}].dbo.pieza pz ON pz.id = pt.pieza_id
        INNER JOIN [${DB}].dbo.talle t ON t.id = pt.talle_id
        WHERE pz.producto_id = @P AND pt.bbox_mu IS NOT NULL`);
    if (!cajas.recordset.length) throw fallo(400, 'TizadaPro no tiene las cajas de las piezas de este molde: no hay con qué cruzar el PDF.');

    const { trazos, altoPt } = await contorno.leerTrazos(rutaPdf);
    if (!trazos.length) throw fallo(400, 'El PDF no tiene trazos vectoriales (¿es un escaneo o una imagen?). Tiene que ser el PDF que exporta el CAD.');
    const cerca = (a, b) => Math.abs(a - b) < 3;   // 3 pt ≈ 1 mm
    const filas = []; const sinContorno = [];
    for (const c of cajas.recordset) {
        let bb; try { bb = JSON.parse(c.bbox_mu); } catch (_) { continue; }
        const [x0, y0, x1, y1] = bb;
        const t = trazos.find(z => cerca(z.x0, x0) && cerca(z.x1, x1) && cerca(altoPt - z.y1, y0) && cerca(altoPt - z.y0, y1))
               || trazos.find(z => cerca(z.x0, x0) && cerca(z.x1, x1) && cerca(z.y0, y0) && cerca(z.y1, y1));
        if (!t) { sinContorno.push(`${c.pieza} ${c.talle}`); continue; }
        filas.push({ pieza: c.pieza, talle: c.talle, svg: contorno.aSvgPath(t), ancho: c.ancho_cm, alto: c.alto_cm });
    }
    if (!filas.length) throw fallo(400, `Ninguna pieza del molde "${molde.nombre}" coincide con este PDF. ¿Es el mismo archivo que se cargó en TizadaPro?`);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        await new sql.Request(transaction).input('Ref', sql.NVarChar(128), ref).query('DELETE FROM dbo.TizadaProMoldePiezas WHERE MoldeRef = @Ref');
        for (const f of filas) {
            await new sql.Request(transaction).input('Ref', sql.NVarChar(128), ref).input('Pz', sql.NVarChar(320), f.pieza).input('T', sql.NVarChar(96), f.talle)
                .input('Svg', sql.NVarChar(sql.MAX), f.svg).input('An', sql.Decimal(8, 2), f.ancho).input('Al', sql.Decimal(8, 2), f.alto).input('Arch', sql.NVarChar(400), nombreArchivo || null)
                .query(`INSERT INTO dbo.TizadaProMoldePiezas (MoldeRef, Pieza, Talle, SvgPath, AnchoCm, AltoCm, ArchivoPdf) VALUES (@Ref, @Pz, @T, @Svg, @An, @Al, @Arch)`);
        }
        await transaction.commit();
    } catch (e) { try { await transaction.rollback(); } catch (_) {} throw e; }
    const piezas = new Set(filas.map(f => f.pieza));
    logger.info(`[TizadaPro] Siluetas de "${molde.nombre}": ${filas.length} contornos (${piezas.size} piezas) · sin contorno: ${sinContorno.length}`);
    return { molde: molde.nombre, talleGuia: molde.variante_guia, contornos: filas.length, piezas: piezas.size, cajas: cajas.recordset.length, sinContorno };
}

// Recorre la CARPETA de PDFs de moldes (TIZADAPRO_MOLDES_DIR, o backend/uploads/moldes-tizadapro) y,
// para cada PDF, prueba contra cada molde de TizadaPro que todavía no tiene siluetas. El nombre
// del archivo no importa: lo que decide es que sus contornos coincidan con las cajas del molde.
async function procesarCarpetaMoldes(pool) {
    const fs = require('fs'); const path = require('path');
    const dir = process.env.TIZADAPRO_MOLDES_DIR || path.join(__dirname, '../uploads/moldes-tizadapro');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const pdfs = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f));
    const todos = await moldes(pool, { soloActivos: true });
    const pendientes = todos.filter(m => !m.siluetas && m.completo);
    const resultado = { carpeta: dir, pdfs: pdfs.length, moldesSinSilueta: pendientes.length, procesados: [], sinCoincidencia: [] };
    const usados = new Set();
    for (const pdf of pdfs) {
        let hecho = null;
        for (const m of pendientes) {
            if (usados.has(m.ref)) continue;
            try { const r = await procesarPdfMolde(pool, m.ref, path.join(dir, pdf), pdf); hecho = { pdf, molde: r.molde, piezas: r.piezas, contornos: r.contornos }; usados.add(m.ref); break; }
            catch (e) { if (!e.status || e.status === 500) throw e; }
        }
        if (hecho) resultado.procesados.push(hecho); else resultado.sinCoincidencia.push(pdf);
    }
    return resultado;
}

module.exports = { DB, exigir, moldes, trabajos, trabajo, telas, siluetas, procesarPdfMolde, procesarCarpetaMoldes, getPool };
