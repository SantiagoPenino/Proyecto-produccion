'use strict';
// =====================================================================
// TIZADA PRO — EDITABLES del arte (capas "Editable <objeto>" de la plantilla de TIZADA)
// =====================================================================
// Al mandar la tizada (solicitudesVendedorTizadaPro.enviar) se extraen los objetos editables de cada arte y se
// decide qué proceso lleva cada uno. A TIZADA se le manda `editables` (lo que no es "sublimado" lo saca de la pieza
// sublimada) y de nuestro lado queda preparado, esperando que vuelva la tizada:
//   · DTF      → un PLIEGO (ancho útil del film) con cada objeto × las prendas de su diseño → diseño pronto del
//                Estampado DTF, que pasa a Diseñado (diseño automático).
//   · TPU      → el arte del objeto como archivo de REFERENCIA del Estampado TPU (como si lo hubieran subido a mano;
//   · Bordado  →   el servicio sigue su circuito de diseño normal, no cambia de estado).
//   · Sublimado → va impreso en la tizada: no se extrae.
// Extracción: pdfjs dentro de Chrome (puppeteer) dibuja SOLO esa capa (las demás apagadas), fondo transparente,
// a 300 dpi, y la recorta a lo dibujado → PNG + medida, posición y pieza (texto de "guias" de esa mesa).
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DPI = 300;
const ANCHO_PLIEGO_CM = () => Number(process.env.TIZADAPRO_DTF_ANCHO_CM) || 57;   // film de 60 cm: los pliegos de producción miden 55–57
const SEPARACION_CM = () => Number(process.env.TIZADAPRO_DTF_SEPARACION_CM) || 1;
const CM = 28.3465;

// Proceso de un objeto: lo que diga el nombre de la capa; si no, por los extras de la solicitud; si no, sublimado
function procesoDe(objeto, tiposExtras) {
  const n = String(objeto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/\bdtf\b/.test(n)) return 'dtf';
  if (/\btpu\b/.test(n)) return 'tpu';
  if (/bordad|\bemb\b/.test(n)) return 'bordado';
  if (/sublim/.test(n)) return 'sublimado';
  const t = new Set(tiposExtras || []);
  if (/escudo/.test(n) && t.has('BORDADO')) return 'bordado';
  if (/logo|sponsor|marca/.test(n) && t.has('DTF')) return 'dtf';
  if (/logo|sponsor|marca/.test(n) && t.has('TPU')) return 'tpu';
  return 'sublimado';
}

const HTML = `<!doctype html><html><body><script type="module">
import * as pdfjs from '/pdfjs/pdf.mjs'; pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
// pdfjs 6 ya no acepta la URL suelta como string: hay que pasarla en { url } (si no: "expected either data, range, or url").
window.abrir = async (i) => { window.doc = await pdfjs.getDocument({ url: '/arte/' + i }).promise; return window.doc.numPages; };
window.analizar = async () => {
  const oc = await doc.getOptionalContentConfig(); const out = [];
  for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const ol = await pg.getOperatorList(); const pila = []; const capas = new Set(); let guia = '';
    ol.fnArray.forEach((fn, k) => { const a = ol.argsArray[k];
      if (fn === pdfjs.OPS.beginMarkedContentProps || fn === pdfjs.OPS.beginMarkedContent) pila.push(a && a[1] && a[1].id ? (oc.getGroup(a[1].id) || {}).name : null);
      else if (fn === pdfjs.OPS.endMarkedContent) pila.pop();
      else { const capa = [...pila].reverse().find(Boolean);
        if ([pdfjs.OPS.constructPath, pdfjs.OPS.showText, pdfjs.OPS.showSpacedText, pdfjs.OPS.paintImageXObject].includes(fn) && capa) capas.add(capa);
        if ((fn === pdfjs.OPS.showText || fn === pdfjs.OPS.showSpacedText) && capa === 'guias') guia += (a[0] || []).map(g => typeof g === 'number' ? (g < -200 ? ' ' : '') : (g && g.unicode != null ? g.unicode : '')).join(''); } });
    const v = pg.view; out.push({ pagina: i, capas: [...capas], pieza: guia.replace(/\\s+/g, ' ').trim(), anchoCm: (v[2] - v[0]) / 28.3465 }); }
  return out;
};
const recorte = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 }; };
window.extraer = async (pagina, capa, dpi) => {
  const pg = await doc.getPage(pagina); const oc = await doc.getOptionalContentConfig();
  for (const [id, g] of oc) oc.setVisibility(id, g.name === capa);
  const s1 = 20 / 72, v1 = pg.getViewport({ scale: s1 }), c1 = document.createElement('canvas'); c1.width = Math.ceil(v1.width); c1.height = Math.ceil(v1.height);
  await pg.render({ canvasContext: c1.getContext('2d'), viewport: v1, optionalContentConfigPromise: Promise.resolve(oc), background: 'rgba(0,0,0,0)' }).promise;
  const b1 = recorte(c1); if (!b1) return null;
  const s = dpi / 72, k = s / s1, pad = 4 * k;
  const ox = b1.x0 * k - pad, oy = b1.y0 * k - pad, w = (b1.x1 - b1.x0 + 1) * k + 2 * pad, h = (b1.y1 - b1.y0 + 1) * k + 2 * pad;
  const v = pg.getViewport({ scale: s, offsetX: -ox, offsetY: -oy }); const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  await pg.render({ canvasContext: c.getContext('2d'), viewport: v, optionalContentConfigPromise: Promise.resolve(oc), background: 'rgba(0,0,0,0)' }).promise;
  const b = recorte(c); if (!b) return null;
  const f = document.createElement('canvas'); f.width = b.x1 - b.x0 + 1; f.height = b.y1 - b.y0 + 1;
  f.getContext('2d').drawImage(c, b.x0, b.y0, f.width, f.height, 0, 0, f.width, f.height);
  const px = 2.54 / dpi;
  return { png: f.toDataURL('image/png'), anchoCm: f.width * px, altoCm: f.height * px, xCm: (ox + b.x0) * px, yCm: (oy + b.y0) * px };
};
document.title = 'listo';
</script></body></html>`;

/**
 * Extrae los objetos editables de los artes. artes: [{ clave, buffer }] → { [clave]: [{ objeto, capa, pieza, pagina,
 * anchoCm, altoCm, xCm, yCm, posicion, png (Buffer) }] }. Solo capas "Editable …" con algo dibujado.
 */
async function extraer(artes) {
  const dirPdfjs = path.dirname(require.resolve('pdfjs-dist/build/pdf.mjs'));
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    if (u.startsWith('/arte/')) { const a = artes[Number(u.slice(6))]; if (!a) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': 'application/pdf' }); return r.end(a.buffer); }
    if (u.startsWith('/pdfjs/')) { const f = path.join(dirPdfjs, path.basename(u)); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(r); }
    r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(HTML);
  });
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const out = {};
  try {
    const pg = await browser.newPage();
    await pg.goto(`http://127.0.0.1:${srv.address().port}/`, { timeout: 30000 });
    await pg.waitForFunction(() => document.title === 'listo', { timeout: 30000 });
    for (const [i, a] of artes.entries()) {
      out[a.clave] = [];
      await pg.evaluate(n => window.abrir(n), i);
      const mesas = await pg.evaluate(() => window.analizar());
      for (const m of mesas) for (const capa of m.capas.filter(c => /^editable\s/i.test(c))) {
        const r = await pg.evaluate((p, c, d) => window.extraer(p, c, d), m.pagina, capa, DPI);
        if (!r) continue;
        out[a.clave].push({
          objeto: capa.replace(/^editable\s+/i, '').trim(), capa, pieza: m.pieza || `mesa ${m.pagina}`, pagina: m.pagina,
          anchoCm: +r.anchoCm.toFixed(2), altoCm: +r.altoCm.toFixed(2), xCm: +r.xCm.toFixed(1), yCm: +r.yCm.toFixed(1),
          posicion: `a ${r.yCm.toFixed(1)} cm del borde de arriba${Math.abs(r.xCm + r.anchoCm / 2 - m.anchoCm / 2) < 0.5 ? ', centrado' : `, ${(r.xCm + r.anchoCm / 2 - m.anchoCm / 2).toFixed(1)} cm del centro`}`,
          png: Buffer.from(r.png.split(',')[1], 'base64'),
        });
      }
    }
  } finally {
    await browser.close().catch(() => { });
    srv.close();
  }
  return out;
}

/** Pliego de DTF: items [{ png, anchoCm, altoCm, cantidad }] acomodados por estantes en el ancho útil del film. */
async function armarPliego(items) {
  const { PDFDocument } = require('pdf-lib');
  const ancho = ANCHO_PLIEGO_CM(), sep = SEPARACION_CM();
  const copias = items.flatMap(it => Array.from({ length: Math.max(0, it.cantidad | 0) }, () => it)).sort((x, y) => y.altoCm - x.altoCm);
  if (!copias.length) return null;
  const filas = []; let fila = null;
  for (const o of copias) {
    if (o.anchoCm + 2 * sep > ancho) throw new Error(`un objeto de ${o.anchoCm} cm no entra en el film de ${ancho} cm`);
    if (!fila || fila.x + o.anchoCm + sep > ancho) { fila = { x: sep, alto: o.altoCm, items: [] }; filas.push(fila); }
    fila.items.push({ o, x: fila.x }); fila.x += o.anchoCm + sep; fila.alto = Math.max(fila.alto, o.altoCm);
  }
  const largo = sep + filas.reduce((s, f) => s + f.alto + sep, 0);
  const doc = await PDFDocument.create();
  doc.setTitle(`Pliego DTF · ${copias.length} transfers`);
  const page = doc.addPage([ancho * CM, largo * CM]);
  const emb = new Map();
  let y = largo - sep;
  for (const f of filas) {
    for (const it of f.items) {
      if (!emb.has(it.o.png)) emb.set(it.o.png, await doc.embedPng(it.o.png));
      page.drawImage(emb.get(it.o.png), { x: it.x * CM, y: (y - it.o.altoCm) * CM, width: it.o.anchoCm * CM, height: it.o.altoCm * CM });
    }
    y -= f.alto + sep;
  }
  return { buffer: Buffer.from(await doc.save()), anchoCm: ancho, largoCm: +largo.toFixed(1), transfers: copias.length, filas: filas.length };
}

module.exports = { extraer, armarPliego, procesoDe };
