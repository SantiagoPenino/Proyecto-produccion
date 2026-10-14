'use strict';
// =====================================================================
// TIZADA PRO — productos A MEDIDA (pañuelos, toallas, banderas, banderines)
// =====================================================================
// Una prenda a medida es UNA pieza sin talles cuya medida la dice cada pedido. TIZADA le suma el margen
// para coser (el total que se imprime), marca dónde van las tiras y arma la ficha "MEDIDA Y TERMINACIÓN".
// Fuente: integracion/API.md y GUIA_PARA_IA.md §5 del repo de TIZADA (commit 3d54304, 12-oct-2026).
//
// Tres niveles:
//   1. TIZADA: la VARIABLE a medida (GET /variables, bloque `a_medida`) dice qué se PUEDE pedir.
//   2. El PRODUCTO (ProductoVentaConfig.AMedidaJson) dice qué OFRECEMOS de eso: formas, punta, terminación,
//      medida libre (mínimo/máximo) o medidas fijas, telas y tiras por defecto.
//   3. Cada DISEÑO de la solicitud lleva SU medida (un diseño = una medida: 10 pañuelos de 50 × 50 y 5 de
//      70 × 70 son dos diseños). La fila de la lista no lleva talle: solo la cantidad.
//
// Medidas SIEMPRE en metros y SIEMPRE las del diseño: nunca se suma ni se resta el margen de este lado.
// =====================================================================
const logger = require('../utils/logger');
const api = require('./tizadaProApi');

const FORMAS = ['rectangulo', 'circulo', 'triangulo'];
const PUNTAS = ['abajo', 'arriba', 'izq', 'der'];
const TERMINACIONES = ['dobladillo', 'overlock', 'sin'];
const LADOS = { rectangulo: ['arriba', 'abajo', 'izq', 'der'], triangulo: ['base', 'laterales'], circulo: ['alrededor'] };
const TODOS_LOS_LADOS = [...LADOS.rectangulo, ...LADOS.triangulo, ...LADOS.circulo];
const NOMBRE = {
  rectangulo: 'Rectángulo', circulo: 'Círculo', triangulo: 'Triángulo',
  abajo: 'Punta abajo', arriba: 'Punta arriba', izq: 'Punta a la izquierda', der: 'Punta a la derecha',
  dobladillo: 'Dobladillo', overlock: 'Overlock', sin: 'Sin terminación',
};

const fallo = (status, msg, extra) => Object.assign(new Error(msg), { status, ...(extra || {}) });
const sinTilde = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const lista = (v) => (Array.isArray(v) ? v : []);
const metros = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null; };
const entero = (v, max) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : 0; };
const m2txt = (m) => (m == null ? '—' : `${Number(m).toLocaleString('es-UY', { maximumFractionDigits: 3 })} m`);

// "círculo" → circulo, "izquierda" → izq, "derecha" → der
function forma(v) { const s = sinTilde(v); return FORMAS.includes(s) ? s : null; }
function punta(v) { const s = sinTilde(v); return s === 'izquierda' ? 'izq' : s === 'derecha' ? 'der' : (PUNTAS.includes(s) ? s : null); }
function terminacion(v) { const s = sinTilde(v); return s === 'sin margen' ? 'sin' : (TERMINACIONES.includes(s) ? s : null); }

// ─────────────────────────────────────────────────────────────────────
// 1. Las variables a medida de TIZADA (cacheadas 5 min; se refrescan si cambia la versión del catálogo)
// ─────────────────────────────────────────────────────────────────────
let _cache = { t: 0, version: null, lista: null };
async function variablesAMedida({ forzar = false } = {}) {
  if (!forzar && _cache.lista && Date.now() - _cache.t < 5 * 60 * 1000) return _cache.lista;
  const r = await api.variables();
  const vs = lista(r?.variables).filter(v => v && v.a_medida && typeof v.a_medida === 'object');
  _cache = {
    t: Date.now(), version: r?.version ?? null,
    lista: vs.map(v => ({ clave: v.clave, nombre: v.nombre, molde: v.molde, moldeNombre: v.molde_nombre || null, planilla: v.planilla || null, foto: v.foto || null, aMedida: v.a_medida })),
  };
  return _cache.lista;
}
async function variableAMedida(clave) {
  if (!clave) return null;
  return (await variablesAMedida()).find(v => v.clave === clave) || null;
}

// Lo que TIZADA permite de una variable (con los valores por defecto de la guía si el bloque no los trae)
function permitido(am) {
  const a = am || {};
  const formas = lista(a.formas).map(forma).filter(Boolean);
  const terms = lista(a.terminaciones).map(terminacion).filter(Boolean);
  return {
    pieza: a.pieza || null,
    formas: formas.length ? formas : ['rectangulo'],
    forma: forma(a.forma_por_defecto) || 'rectangulo',
    puntas: lista(a.orientaciones_triangulo).map(punta).filter(Boolean).length ? lista(a.orientaciones_triangulo).map(punta).filter(Boolean) : PUNTAS,
    punta: punta(a.orientacion_por_defecto) || 'abajo',
    terminaciones: terms.length ? terms : TERMINACIONES,
    terminacion: terminacion(a.terminacion_por_defecto) || 'dobladillo',
    minimo: Number(a.medida_minima_m) > 0 ? Number(a.medida_minima_m) : 0.05,
    maximo: Number(a.medida_maxima_m) > 0 ? Number(a.medida_maxima_m) : 50,
    muestra: a.medida_de_muestra_m || null,
    telas: lista(a.telas).map(t => ({ id: String(t.id), nombre: t.nombre || `Tela ${t.id}`, anchoMesaCm: t.ancho_mesa_cm ?? null, entraHastaCm: t.entra_hasta_cm ?? null })),
    maxLado: Number(a.tiras?.maximo_por_lado) > 0 ? Number(a.tiras.maximo_por_lado) : 50,
    tiras: { lleva: !!a.tiras?.lleva_por_defecto, lados: { ...(a.tiras?.lados_por_defecto || {}) } },
    margenCm: a.margen_cm || null, overlockCm: a.overlock_cm ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 2. La configuración del PRODUCTO (lo que ofrecemos). `v` = la variable a medida de TIZADA (si se pudo leer):
//    con ella se recorta todo a lo que TIZADA acepta. Sin ella (TIZADA apagada) se guarda lo elegido tal cual.
// ─────────────────────────────────────────────────────────────────────
function ladosLimpios(l, maxLado) {
  const o = {};
  TODOS_LOS_LADOS.forEach(k => { o[k] = entero(l?.[k], k === 'alrededor' ? 200 : maxLado); });
  return o;
}

function normalizarConfig(b, v) {
  if (!b || !b.variable) return null;
  const p = permitido(v?.aMedida);
  const de = (xs, ok) => [...new Set(lista(xs).map(ok).filter(Boolean))];
  let formas = de(b.formas, forma); if (v) formas = formas.filter(f => p.formas.includes(f));
  if (!formas.length) formas = v ? p.formas : ['rectangulo'];
  let terms = de(b.terminaciones, terminacion); if (v) terms = terms.filter(t => p.terminaciones.includes(t));
  if (!terms.length) terms = v ? p.terminaciones : TERMINACIONES;
  const f0 = formas.includes(forma(b.forma)) ? forma(b.forma) : (formas.includes(p.forma) ? p.forma : formas[0]);
  const t0 = terms.includes(terminacion(b.terminacion)) ? terminacion(b.terminacion) : (terms.includes(p.terminacion) ? p.terminacion : terms[0]);
  const pu = punta(b.orientacion) || p.punta;
  const md = b.medidas || {};
  const minimo = Math.max(p.minimo, metros(md.minimo_m) || p.minimo);
  const maximo = Math.min(p.maximo, metros(md.maximo_m) || p.maximo);
  const fijas = lista(md.fijas).slice(0, 30).map(x => {
    const fx = formas.includes(forma(x.forma)) ? forma(x.forma) : f0;
    return {
      nombre: String(x.nombre || '').trim().slice(0, 60), forma: fx, orientacion: fx === 'triangulo' ? (punta(x.orientacion) || pu) : null,
      ancho_m: fx === 'circulo' ? null : metros(x.ancho_m), alto_m: fx === 'circulo' ? null : metros(x.alto_m), diametro_m: fx === 'circulo' ? metros(x.diametro_m ?? x.ancho_m) : null,
    };
  }).filter(x => x.nombre && (x.forma === 'circulo' ? x.diametro_m : x.ancho_m && x.alto_m));
  const telasOk = new Set(p.telas.map(t => t.id));
  const telas = [...new Set(lista(b.telas).map(String))].filter(id => !v || telasOk.has(id));
  const tr = b.tiras || {};
  return {
    variable: String(b.variable).trim().slice(0, 96),
    variableNombre: v?.nombre || String(b.variableNombre || '').trim().slice(0, 200) || null,
    molde: v?.molde || String(b.molde || '').trim().slice(0, 128) || null,
    pieza: p.pieza || b.pieza || null,
    formas, forma: f0, orientacion: pu,
    terminaciones: terms, terminacion: t0,
    medidas: { modo: md.modo === 'FIJAS' && fijas.length ? 'FIJAS' : 'LIBRE', minimo_m: minimo, maximo_m: Math.max(minimo, maximo), fijas },
    telas,
    tiras: {
      lleva: tr.lleva !== undefined ? !!tr.lleva : p.tiras.lleva,
      marcar: tr.marcar !== false,
      lados: ladosLimpios(tr.lados || p.tiras.lados, p.maxLado),
      fijas: !!tr.fijas,   // true = el vendedor no las cambia
    },
  };
}

// Problemas de una configuración contra lo que TIZADA dice HOY de la variable (para avisar en el configurador)
function revisarConfig(cfg, v) {
  const avisos = [];
  if (!cfg) return avisos;
  if (!v) { avisos.push(`La variable ${cfg.variable} ya no está en TIZADA como "a medida" (o TIZADA no contestó).`); return avisos; }
  const p = permitido(v.aMedida);
  cfg.formas.filter(f => !p.formas.includes(f)).forEach(f => avisos.push(`TIZADA ya no ofrece la forma ${NOMBRE[f]}.`));
  cfg.terminaciones.filter(t => !p.terminaciones.includes(t)).forEach(t => avisos.push(`TIZADA ya no ofrece la terminación ${NOMBRE[t]}.`));
  const ids = new Set(p.telas.map(t => t.id));
  cfg.telas.filter(id => !ids.has(id)).forEach(id => avisos.push(`La tela ${id} ya no está entre las de esta variable en TIZADA.`));
  return avisos;
}

// Las telas que se ofrecen en la solicitud: las del producto (si eligió) dentro de las de TIZADA
function telasOfrecidas(cfg, v) {
  const p = permitido(v?.aMedida);
  return cfg?.telas?.length ? p.telas.filter(t => cfg.telas.includes(t.id)) : p.telas;
}

// ─────────────────────────────────────────────────────────────────────
// 3. La medida de UN DISEÑO de la solicitud. Devuelve { medida, errores } — medida queda guardable aunque
//    tenga errores (para no perder lo escrito); errores frena el envío.
// ─────────────────────────────────────────────────────────────────────
function normalizarMedida(e, cfg, v) {
  const errores = [];
  if (!cfg) return { medida: null, errores: ['El producto no es a medida.'] };
  const x = e || {};
  const p = permitido(v?.aMedida);
  let fija = null;
  if (cfg.medidas.modo === 'FIJAS') {
    // la elegida; si el producto tiene UNA sola medida fija, es esa (se carga sola)
    fija = cfg.medidas.fijas.find(f => sinTilde(f.nombre) === sinTilde(x.fija)) || (cfg.medidas.fijas.length === 1 ? cfg.medidas.fijas[0] : null);
    if (!fija) errores.push(`Elegí una de las medidas del producto (${cfg.medidas.fijas.map(f => f.nombre).join(', ')}).`);
  }
  const fo = fija ? fija.forma : (cfg.formas.includes(forma(x.forma)) ? forma(x.forma) : cfg.forma);
  const pu = fo === 'triangulo' ? (fija?.orientacion || (p.puntas.includes(punta(x.orientacion)) ? punta(x.orientacion) : cfg.orientacion)) : null;
  const te = cfg.terminaciones.includes(terminacion(x.terminacion)) ? terminacion(x.terminacion) : cfg.terminacion;
  const min = cfg.medidas.minimo_m, max = cfg.medidas.maximo_m;
  // Medida libre con mínimo = máximo: hay una sola medida posible → es esa (se carga sola, no se pide)
  const unica = !fija && cfg.medidas.modo !== 'FIJAS' && min > 0 && min === max ? min : null;
  const ancho = fo === 'circulo' ? null : (fija ? fija.ancho_m : (metros(x.ancho_m) ?? unica));
  const alto = fo === 'circulo' ? null : (fija ? fija.alto_m : (metros(x.alto_m) ?? unica));
  const diam = fo === 'circulo' ? (fija ? fija.diametro_m : (metros(x.diametro_m ?? x.ancho_m) ?? unica)) : null;
  const fuera = (n, que) => {
    if (n == null) errores.push(`Falta ${que} (en metros).`);
    else if (!fija && (n < min || n > max)) errores.push(`${que[0].toUpperCase()}${que.slice(1)}: ${m2txt(n)} está fuera de lo que admite el producto (de ${m2txt(min)} a ${m2txt(max)}).`);
  };
  if (fo === 'circulo') fuera(diam, 'el diámetro');
  else { fuera(ancho, 'el ancho'); fuera(alto, 'el alto'); }
  // Tiras: las del producto si son fijas o si el diseño no dice nada; los lados según la forma
  const t0 = cfg.tiras;
  const tx = !t0.fijas && x.tiras && typeof x.tiras === 'object' ? x.tiras : null;
  const lleva = tx && tx.lleva !== undefined ? !!tx.lleva : t0.lleva;
  const lados = {};
  LADOS[fo].forEach(k => { lados[k] = entero(tx?.lados?.[k] ?? t0.lados[k], k === 'alrededor' ? 200 : p.maxLado); });
  const tiras = { lleva, marcar: tx && tx.marcar !== undefined ? tx.marcar !== false : t0.marcar, lados };
  if (lleva && !Object.values(lados).some(n => n > 0)) errores.push('Lleva tiras pero ningún lado tiene: poné cuántas por lado (o sacá las tiras).');
  return {
    medida: { fija: fija ? fija.nombre : null, forma: fo, orientacion: pu, ancho_m: ancho, alto_m: alto, diametro_m: diam, terminacion: te, tiras },
    errores,
  };
}

// Texto corto para listas y eventos: "Triángulo punta abajo · 1 × 0,6 m · Dobladillo · tiras base 3"
function resumen(m) {
  if (!m) return '';
  const med = m.forma === 'circulo' ? `Ø ${m2txt(m.diametro_m)}` : `${m2txt(m.ancho_m).replace(' m', '')} × ${m2txt(m.alto_m)}`;
  const tiras = m.tiras?.lleva ? `tiras ${Object.entries(m.tiras.lados).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ')}${m.tiras.marcar === false ? ' (sin marcar)' : ''}` : 'sin tiras';
  return [m.fija, NOMBRE[m.forma] + (m.forma === 'triangulo' ? ` ${NOMBRE[m.orientacion].toLowerCase()}` : ''), med, NOMBRE[m.terminacion], tiras].filter(Boolean).join(' · ');
}

// ─────────────────────────────────────────────────────────────────────
// 4. Lo que se manda a TIZADA
// ─────────────────────────────────────────────────────────────────────
function medidaApi(m) { return m.forma === 'circulo' ? { diametro_m: m.diametro_m } : { ancho_m: m.ancho_m, alto_m: m.alto_m }; }
function tirasApi(t) {
  if (!t || !t.lleva) return { lleva: false };
  return { lleva: true, ...(t.marcar === false ? { marcar: false } : {}), lados: { ...t.lados } };
}
// Campos que van en el molde del pedido (disenos[].moldes[])
function paraPedido(m) {
  if (!m) return {};
  return { forma: m.forma, ...(m.forma === 'triangulo' ? { orientacion: m.orientacion } : {}), medida: medidaApi(m), terminacion: m.terminacion, tiras: tirasApi(m.tiras) };
}
// Cuerpo de POST /a_medida/calcular
function paraCalcular(variable, m, tela) {
  return {
    variable, forma: m.forma, ...(m.forma === 'triangulo' ? { orientacion: m.orientacion } : {}), ...medidaApi(m), terminacion: m.terminacion,
    ...(tela ? { tela: String(tela) } : {}), tiras: tirasApi(m.tiras),
  };
}
// Una prenda a medida en POST /plantillas: { variable, medida } (+ forma, punta y terminación)
function paraPlantilla(variable, m) {
  return { variable, forma: m.forma, ...(m.forma === 'triangulo' ? { orientacion: m.orientacion } : {}), terminacion: m.terminacion, medida: medidaApi(m) };
}

// Las cuentas de TIZADA para un diseño. Si TIZADA rechaza la medida, devuelve sus alarmas (no lanza).
async function calcular(variable, m, tela) {
  try { return { ok: true, ...(await api.aMedidaCalcular(paraCalcular(variable, m, tela))) }; }
  catch (e) {
    if (e.status === 422 || e.status === 404) return { ok: false, alarmas: e.alarmas || [], error: e.alarmas?.length ? null : e.message };
    logger.warn(`[TIZADAPRO] a_medida/calcular ${variable}: ${e.message}`);
    throw fallo(e.status === 503 ? 503 : 502, e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 5. [PORTAL · AUTOGESTIÓN] El arte para TIZADA armado solo desde el .ai / .pdf del cliente: un PDF con UNA mesa del
//    tamaño TOTAL que da TIZADA (medida del diseño + margen, `calcular().total_cm`), como el que sale de la plantilla:
//    capa "diseño" = la primera página del cliente, en VECTORES (llenar: cubre toda la mesa y recorta lo que sobra ·
//    entera: entra toda, sobre blanco) y capa "guias" = el nombre de la pieza (así TIZADA sabe de qué pieza es la mesa).
// ─────────────────────────────────────────────────────────────────────
const PT_CM = 72 / 2.54;
// La resolución más baja de las imágenes del arte una vez impreso a la medida total (null = todo vectores).
// a = calidad de analizarArte ({ anchoPt, altoPt, imagenes:[{ px, py, wPt, hPt }] }), total en cm.
function dpiImpreso(a, anchoCm, altoCm, ajuste = 'llenar') {
  if (!a?.imagenes?.length || !(a.anchoPt > 0 && a.altoPt > 0 && anchoCm > 0 && altoCm > 0)) return null;
  const k = (ajuste === 'entera' ? Math.min : Math.max)((anchoCm * PT_CM) / a.anchoPt, (altoCm * PT_CM) / a.altoPt);
  const dpis = a.imagenes.filter(i => i.wPt > 0.5 && i.hPt > 0.5).map(i => Math.min(i.px / ((i.wPt * k) / 72), i.py / ((i.hPt * k) / 72)));
  return dpis.length ? Math.round(Math.min(...dpis)) : null;
}
async function arteDesdePdf({ pdf, anchoCm, altoCm, pieza, ajuste = 'llenar' }) {
  const { PDFDocument, PDFName, PDFHexString, StandardFonts } = require('pdf-lib');
  if (!(anchoCm > 0 && altoCm > 0)) throw fallo(400, 'Falta la medida total del diseño (TIZADA no la calculó).');
  // un .ai compatible con PDF es un PDF por dentro (a veces con algo antes del encabezado)
  const ini = pdf.indexOf('%PDF');
  const src = await PDFDocument.load(ini > 0 ? pdf.subarray(ini) : pdf, { ignoreEncryption: true, updateMetadata: false });
  const sp = src.getPage(0);
  const t = sp.getTrimBox();   // la mesa de trabajo (TrimBox → CropBox → MediaBox)
  const doc = await PDFDocument.create();
  const W = anchoCm * PT_CM, H = altoCm * PT_CM;
  const page = doc.addPage([W, H]);
  page.setTrimBox(0, 0, W, H); page.setArtBox(0, 0, W, H);   // la mesa = la página entera
  const im = await doc.embedPage(sp, { left: t.x, bottom: t.y, right: t.x + t.width, top: t.y + t.height });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Capas (Optional Content), con los nombres que lee TIZADA
  const ctx = doc.context;
  const capa = (nombre, imprime) => ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText(nombre), ...(imprime ? {} : { Usage: { Print: { PrintState: 'OFF' } } }) }));
  const disenoRef = capa('diseño', true);
  const guiasRef = capa('guias', false);
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [disenoRef, guiasRef], D: { Order: [disenoRef, guiasRef], ON: [disenoRef, guiasRef], OFF: [] } }));
  page.node.Resources().set(PDFName.of('Properties'), ctx.obj({ MC0: disenoRef, MC1: guiasRef }));
  const fmN = page.node.newXObject('Fm', im.ref).asString();
  const fN = page.node.newFontDictionary('F', font.ref).asString();
  // la página del cliente (un form de im.width × im.height pt) escalada para llenar o entrar entera, centrada
  const k = (ajuste === 'entera' ? Math.min : Math.max)(W / im.width, H / im.height);
  const w = im.width * k, h = im.height * k;
  const n = (v) => (Math.round(v * 100000) / 100000).toString();
  const contenido = [
    '/OC /MC0 BDC', 'q', `0 0 ${n(W)} ${n(H)} re W n`,
    ...(ajuste === 'entera' ? ['1 1 1 rg', `0 0 ${n(W)} ${n(H)} re f`] : []),
    'q', `${n(k)} 0 0 ${n(k)} ${n((W - w) / 2)} ${n((H - h) / 2)} cm`, `${fmN} Do`, 'Q', 'Q', 'EMC',
    '/OC /MC1 BDC', 'BT', `${fN} 10 Tf`, '0 0 0 rg', `${n(Math.min(14, W / 4))} ${n(Math.max(4, H - 18))} Td`,
    `${font.encodeText(String(pieza || 'Pieza')).toString()} Tj`, 'ET', 'EMC',
  ].join('\n');
  page.node.addContentStream(ctx.register(ctx.flateStream(contenido)));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

module.exports = {
  FORMAS, PUNTAS, TERMINACIONES, LADOS, NOMBRE,
  variablesAMedida, variableAMedida, permitido, normalizarConfig, revisarConfig, telasOfrecidas,
  normalizarMedida, resumen, paraPedido, paraCalcular, paraPlantilla, calcular, arteDesdePdf, dpiImpreso,
};
