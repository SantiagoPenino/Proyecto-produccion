// ─────────────────────────────────────────────────────────────────────
// TIZADA PRO — revisión del ARTE de nuestro lado, antes de mandarlo.
// El /pedidos/validar de TIZADA "sólo revisa los DATOS; el arte y las tipografías se revisan al procesar"
// (respuesta real del servidor, 05-oct). Para no enterarnos recién al procesar, acá se revisa cada arte
// (.pdf o .ai compatible con PDF) con lo que tiene la base que da TIZADA para la prenda (ej. "Camiseta Goes 2026 -
// Camiseta basket Goes 2026.ai"): una mesa de trabajo por pieza con su nombre en la capa "guias", y las capas
// diseño · Editable <objeto> · Nombre · Número · guias.
//   - La letra VIENE EN EL ARTE: la de las capas Nombre y Número tiene que estar en GET /tipografias.
//     (La de "guias" no cuenta: la base trae Myriad Pro ahí y es solo la etiqueta de la pieza.)
//   - En "diseño" no puede haber texto vivo (va convertido a curvas).
//   - Cada pieza del molde tiene que tener su mesa (texto en "guias").
// ─────────────────────────────────────────────────────────────────────
const path = require('path');
const { pathToFileURL } = require('url');

let pdfjsPromise = null;
const cargarPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      let ruta;
      try { ruta = require.resolve('pdfjs-dist/legacy/build/pdf.mjs'); } catch (e) {
        ruta = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy', 'build', 'pdf.mjs');
      }
      return import(pathToFileURL(ruta).href);
    })();
  }
  return pdfjsPromise;
};

const clave = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// "ABCDEF+Arial-BoldMT" → "arialbold" · "BebasNeue-Regular" → "bebasneueregular" · "ArialMT" → "arialregular"
const SUFIJOS = /(PSMT|MT|PS)$/;
function claveFuente(nombre) {
  const sinSubset = String(nombre || '').replace(/^[A-Z]{6}\+/, '');
  const [fam, ...resto] = sinSubset.split(/[-,]/);
  const estilo = resto.join('').replace(SUFIJOS, '') || 'Regular';
  return clave(fam.replace(SUFIJOS, '') + estilo);
}
const legible = (nombre) => String(nombre || '').replace(/^[A-Z]{6}\+/, '');
const esCapa = (capa, ...nombres) => nombres.map(clave).includes(clave(capa));

/** Lo que trae un arte: capas, mesas, letras por capa y los nombres de pieza escritos en "guias". */
async function analizarArte(buffer) {
  const pdfjs = await cargarPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    let oc = null; try { oc = await doc.getOptionalContentConfig(); } catch (_) { /* sin capas */ }
    const capas = oc ? [...oc].map(([, g]) => g.name) : [];
    const letras = new Map(); const guias = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const ol = await pg.getOperatorList();
      const pila = []; let textoGuias = '';
      ol.fnArray.forEach((fn, k) => {
        const a = ol.argsArray[k];
        if (fn === pdfjs.OPS.beginMarkedContentProps || fn === pdfjs.OPS.beginMarkedContent) pila.push(oc && a?.[1]?.id ? (oc.getGroup(a[1].id)?.name || null) : null);
        else if (fn === pdfjs.OPS.endMarkedContent) pila.pop();
        else if (fn === pdfjs.OPS.setFont) {
          const f = pg.commonObjs.has(a[0]) ? pg.commonObjs.get(a[0]) : null;
          const nombre = f?.name || f?.loadedName || String(a[0]);
          const e = letras.get(nombre) || { nombre, capas: new Set() };
          e.capas.add([...pila].reverse().find(Boolean) || '(sin capa)');
          letras.set(nombre, e);
        } else if ((fn === pdfjs.OPS.showText || fn === pdfjs.OPS.showSpacedText) && esCapa([...pila].reverse().find(Boolean), 'guias')) {
          // el texto de "guias" (nombre de la pieza): glifos con su unicode; un salto grande = espacio
          textoGuias += (a?.[0] || []).map(g => (typeof g === 'number' ? (g < -200 ? ' ' : '') : (g?.unicode ?? ''))).join('');
          textoGuias += ' ';
        }
      });
      if (textoGuias.trim()) guias.push({ mesa: i, texto: textoGuias.replace(/\s+/g, ' ').trim() });
      pg.cleanup();
    }
    return { mesas: doc.numPages, capas, letras: [...letras.values()].map(e => ({ ...e, capas: [...e.capas] })), guias };
  } finally { await doc.destroy(); }
}

/**
 * Revisa los artes. artes: [{ nombre, buffer, campo }] · tipografias: GET /tipografias · piezas: las del molde.
 * Devuelve alarmas con el formato de las de TIZADA ({ codigo, frena, etapa, mensaje, donde }).
 */
async function revisarArtes(artes, tipografias, piezas = []) {
  const tiene = new Set((tipografias || []).map(clave));
  const alarmas = [];
  const alarma = (a, codigo, mensaje) => alarmas.push({ codigo, frena: true, etapa: 'arte (revisión USER)', donde: { campo: a.campo }, mensaje });
  for (const a of artes) {
    let r;
    try { r = await analizarArte(a.buffer); } catch (e) {
      alarma(a, 'arte-ilegible', `No se pudo leer el arte "${a.nombre}". Si es .ai, guardalo con «Crear archivo compatible con PDF» o exportalo a PDF.`);
      continue;
    }
    // La base de TIZADA trae estas capas; sin "diseño" y "guias" el arte no está armado sobre la base
    const faltanCapas = ['diseño', 'guias'].filter(c => !r.capas.some(x => esCapa(x, c)));
    if (faltanCapas.length) { alarma(a, 'arte-sin-base', `El arte "${a.nombre}" no tiene las capas de la base de TIZADA (${faltanCapas.join(', ')}). Armalo sobre el archivo base que da TIZADA para esta prenda.`); continue; }
    // Una mesa por pieza: cada pieza del molde tiene que aparecer en "guias"
    const enGuias = r.guias.map(g => clave(g.texto));
    const sinMesa = (piezas || []).filter(pz => !enGuias.some(t => t === clave(pz) || t.includes(clave(pz))));
    if (sinMesa.length) alarma(a, 'arte-pieza-sin-mesa', `El arte "${a.nombre}" no tiene mesa de trabajo para: ${sinMesa.join(', ')} (el nombre de la pieza va en la capa "guias", una mesa por pieza).`);
    // Una pieza por mesa: dos piezas en la misma mesa (ej. todo en una sola página) no es la base de TIZADA
    const mesaDe = (pz) => r.guias.find(g => { const t = clave(g.texto); return t === clave(pz) || t.includes(clave(pz)); })?.mesa;
    const porMesa = {};
    (piezas || []).forEach(pz => { const m = mesaDe(pz); if (m) (porMesa[m] = porMesa[m] || []).push(pz); });
    const juntas = Object.entries(porMesa).filter(([, l]) => l.length > 1);
    if (juntas.length) alarma(a, 'arte-piezas-juntas', `El arte "${a.nombre}" tiene varias piezas en la misma mesa de trabajo (${juntas.map(([m, l]) => `mesa ${m}: ${l.join(', ')}`).join(' · ')}). TIZADA quiere una mesa por pieza, como en su archivo base.`);
    for (const l of r.letras) {
      const enNombreNumero = l.capas.filter(c => esCapa(c, 'Nombre', 'Número'));
      if (enNombreNumero.length && !tiene.has(claveFuente(l.nombre))) {
        alarma(a, 'tipografia-falta', `El arte "${a.nombre}" usa la letra "${legible(l.nombre)}" en ${enNombreNumero.join(' y ')}, y TIZADA PRO no la tiene. Usá una de las suyas (${(tipografias || []).slice(0, 8).join(', ')}${(tipografias || []).length > 8 ? '…' : ''}).`);
      }
      if (l.capas.some(c => esCapa(c, 'diseño'))) alarma(a, 'texto-vivo', `El arte "${a.nombre}" tiene texto sin convertir a curvas en la capa "diseño" (letra "${legible(l.nombre)}"). Convertilo a contornos.`);
    }
  }
  return alarmas;
}

module.exports = { analizarArte, revisarArtes, claveFuente };
