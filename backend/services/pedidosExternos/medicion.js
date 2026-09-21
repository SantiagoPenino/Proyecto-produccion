'use strict';
// Medición en servidor del arte que va a producción, para pedidos que llegan SIN medida
// (un sistema externo que manda solo el enlace). La Solicitud del vendedor no pasa por acá:
// sus archivos ya vienen medidos por el navegador.
//
// Copia de medirArteMetros (controllers/webOrdersController.js, el que ya usa upload-stream para
// la medida fija) con las dos reglas del formulario que aquel no aplica:
//   · imagen sin DPI → se rechaza (fileService.js / PrendaOrderForm.jsx:1019-1057), no se asume 72
//   · PDF de más de una página → se rechaza (PrendaOrderForm.jsx:1174-1180)
const fs = require('fs');

async function medirArchivo(ruta, nombre, mime) {
  const buf = await fs.promises.readFile(ruta);
  const ptToM = (pt) => (pt * 0.0254) / 72;
  const nom = String(nombre || '').toLowerCase();
  const mm = String(mime || '').toLowerCase();
  const esPdf = mm.includes('pdf') || nom.endsWith('.pdf') || buf.slice(0, 4).toString() === '%PDF';
  if (esPdf) {
    const { PDFDocument, PDFName } = require('pdf-lib');
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
    const paginas = doc.getPageCount();
    if (paginas > 1) throw new Error(`tiene ${paginas} páginas. Solo se permite 1 página por archivo.`);
    const page = doc.getPages()[0];
    if (!page) throw new Error('el PDF no tiene páginas.');
    let { width, height } = page.getSize();
    let uu = 1;
    try { const u = page.node.get(PDFName.of('UserUnit')); const n = u && u.asNumber ? u.asNumber() : NaN; if (Number.isFinite(n) && n > 0) uu = n; } catch (_) { /* sin UserUnit */ }
    width *= uu; height *= uu;
    const rot = (((page.getRotation()?.angle || 0) % 360) + 360) % 360;
    if (rot === 90 || rot === 270) { const t = width; width = height; height = t; }
    return { anchoM: ptToM(width), altoM: ptToM(height) };
  }
  const meta = await require('sharp')(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('no se pudieron leer las dimensiones de la imagen.');
  if (!meta.density) throw new Error('el archivo no trae DPI. Exportalo con resolución (DPI).');
  const pxToM = (px) => (px / meta.density) * 0.0254;
  return { anchoM: pxToM(meta.width), altoM: pxToM(meta.height) };
}

module.exports = { medirArchivo };
