const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const logger = require('../utils/logger');

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  CONTORNOS DEL PDF DEL MOLDE (para las siluetas de las piezas de TizadaPro)
 * ══════════════════════════════════════════════════════════════════════════
 *  TizadaPro guarda, por pieza y talle, la caja (bbox) que ocupa cada pieza en
 *  el PDF del molde, pero no el dibujo. Este servicio lee los trazos vectoriales
 *  de ese PDF (pdfjs, solo getOperatorList: sin render ni binarios) y devuelve
 *  cada contorno con su caja en puntos PDF; tizadaProService los cruza con las
 *  cajas de TizadaPro y así cada contorno recibe su nombre de pieza y su talle.
 *  Verificado 28-sep-2026 sobre "Short basket 4 piezas.pdf": las 12 cajas
 *  probadas coinciden con un trazo (con el eje Y invertido: TizadaPro mide
 *  desde arriba, el PDF desde abajo).
 *
 *  El despiece por nidos/bandas de la versión anterior (moldes escalados) ya
 *  no se usa: TizadaPro es el dueño del molde.
 */

const PT2CM = 2.54 / 72;              // el PDF está en puntos: 72 pt = 1 pulgada
const VIEWBOX = 100;                   // las miniaturas salen normalizadas a 0 0 100 100

// Códigos de operación de dibujo de pdf.js y cuántos números consume cada uno.
const DRAW_ARGS = { 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 }; // moveTo, lineTo, curveTo, quadTo, closePath

// Multiplicación de matrices [a,b,c,d,e,f] en el mismo orden que ctx.transform
const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// pdfjs-dist se publica como ESM: hay que importarlo dinámicamente y, en
// Windows, con una URL file:// (un path "C:\..." lo rechaza el loader ESM).
let pdfjsPromise = null;
const cargarPdfjs = () => {
    if (!pdfjsPromise) {
        pdfjsPromise = (async () => {
            let ruta;
            try {
                ruta = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
            } catch (e) {
                const pkg = require.resolve('pdfjs-dist/package.json');
                ruta = path.join(path.dirname(pkg), 'legacy', 'build', 'pdf.mjs');
            }
            return import(pathToFileURL(ruta).href);
        })();
    }
    return pdfjsPromise;
};

/**
 * Lee todos los contornos cerrados de la primera página, ya con las
 * transformaciones aplicadas (el CAD dibuja cada pieza en el origen y la
 * ubica con un `cm`, así que sin resolver la matriz caen todas encimadas).
 */
async function leerTrazos(rutaPdf) {
    const pdfjs = await cargarPdfjs();
    const data = new Uint8Array(fs.readFileSync(rutaPdf));
    // pdfjs 6 sacó doc.destroy(): el que cierra y libera memoria es el loadingTask.
    const tarea = pdfjs.getDocument({ data, isEvalSupported: false });
    const doc = await tarea.promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const ol = await page.getOperatorList();
    const NOMBRE = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));

    let ctm = [1, 0, 0, 1, 0, 0];
    const pila = [];
    const trazos = [];

    for (let i = 0; i < ol.fnArray.length; i++) {
        const op = NOMBRE[ol.fnArray[i]];
        const args = ol.argsArray[i];

        if (op === 'save') { pila.push(ctm.slice()); continue; }
        if (op === 'restore') { ctm = pila.pop() || [1, 0, 0, 1, 0, 0]; continue; }
        if (op === 'transform') { ctm = mul(ctm, args); continue; }
        if (op !== 'constructPath') continue;

        const crudo = args[1] && args[1][0];
        if (!crudo) continue;

        const d = Array.from(crudo);
        const puntos = [];
        const segmentos = [];
        for (let k = 0; k < d.length;) {
            const codigo = d[k];
            const n = DRAW_ARGS[codigo];
            if (n === undefined) break;          // operación desconocida: cortamos este trazo
            const coords = [];
            for (let j = 0; j < n; j += 2) {
                const p = apply(ctm, d[k + 1 + j], d[k + 2 + j]);
                coords.push(p);
                puntos.push(p);
            }
            segmentos.push([codigo, coords]);
            k += 1 + n;
        }
        if (puntos.length < 3) continue;

        const xs = puntos.map(p => p[0]);
        const ys = puntos.map(p => p[1]);
        // Área por la fórmula del cordón. Los puntos de control de las bezier
        // entran como vértices: no es el área exacta, pero para ORDENAR los
        // talles de un mismo nido alcanza y sobra (son la misma curva escalada).
        let acum = 0;
        for (let k = 0; k < puntos.length; k++) {
            const q = puntos[(k + 1) % puntos.length];
            acum += puntos[k][0] * q[1] - q[0] * puntos[k][1];
        }

        trazos.push({
            x0: Math.min(...xs), x1: Math.max(...xs),
            y0: Math.min(...ys), y1: Math.max(...ys),
            area: Math.abs(acum / 2),
            segmentos
        });
    }

    await tarea.destroy();
    return { trazos, anchoPt: vp.width, altoPt: vp.height };
}

/** Contorno del talle más grande, normalizado y centrado en un viewBox 0 0 100 100. */
function aSvgPath(trazo) {
    const w = trazo.x1 - trazo.x0;
    const h = trazo.y1 - trazo.y0;
    const s = VIEWBOX / Math.max(w, h);
    const ox = (VIEWBOX - w * s) / 2;
    const oy = (VIEWBOX - h * s) / 2;
    const r = n => Math.round(n * 100) / 100;
    // El PDF tiene el eje Y hacia arriba y el SVG hacia abajo: se invierte acá.
    const T = ([x, y]) => `${r(ox + (x - trazo.x0) * s)} ${r(VIEWBOX - oy - (y - trazo.y0) * s)}`;

    let d = '';
    for (const [codigo, coords] of trazo.segmentos) {
        if (codigo === 0) d += `M${T(coords[0])} `;
        else if (codigo === 1) d += `L${T(coords[0])} `;
        else if (codigo === 2) d += `C${T(coords[0])} ${T(coords[1])} ${T(coords[2])} `;
        else if (codigo === 3) d += `Q${T(coords[0])} ${T(coords[1])} `;
        else if (codigo === 4) d += 'Z ';
    }
    return d.trim();
}

module.exports = { leerTrazos, aSvgPath, PT2CM };
