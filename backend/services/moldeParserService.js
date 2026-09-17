const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const logger = require('../utils/logger');

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  DESPIECE DE MOLDES ESCALADOS — PDF de plotter → piezas y talles
 * ══════════════════════════════════════════════════════════════════════════
 *  Un molde escalado es un PDF de plotter a escala 1:1 (el de camisetas con
 *  costadillo mide 500 x 500 cm) donde las piezas están dibujadas una encima
 *  de otra: el mismo frente repetido en los 10 talles, anidado. Ese conjunto
 *  de contornos concéntricos es lo que acá se llama un NIDO.
 *
 *  El archivo NO trae nada escrito: cero items de texto, cero metadatos. No
 *  dice qué pieza es cada nido ni a qué talle corresponde cada contorno. Lo
 *  único que hay es geometría, y con eso alcanza para dos de las tres cosas:
 *
 *   1) SEPARAR las piezas → dos trazos que se solapan fuerte son el mismo
 *      nido (un frente talle XS está adentro del frente talle 6XL). Union-
 *      find sobre el solapamiento de bounding boxes.
 *   2) ORDENAR los talles → dentro de un nido, ordenados por área de menor
 *      a mayor, el contorno n-ésimo es el talle n-ésimo de la curva. El
 *      escalado de moldería es monótono, siempre.
 *   3) NOMBRAR las piezas → esto NO se puede sacar del archivo. Lo hace el
 *      usuario en pantalla, una vez por molde, contra PiezasPrenda.
 *
 *  Medido sobre el archivo real (15-sep-2026): 333 trazos → 303 útiles →
 *  33 nidos, de los cuales 30 son piezas (3 bandas x 10) y 3 son los
 *  cuadritos de talles que el CAD dibuja al costado.
 *
 *  Depende de pdfjs-dist, y SOLO de getOperatorList: no renderiza nada, así
 *  que no necesita canvas ni ningún binario nativo.
 */

const PT2CM = 2.54 / 72;              // el PDF está en puntos: 72 pt = 1 pulgada
const MIN_LADO_CM = 1;                 // menos que esto es una marca (piquete), no una pieza
const MAX_LADO_CM = 400;               // más que esto es el marco de la hoja
const SOLAPE_MIN = 0.4;                // 40% del menor = mismo nido
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
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
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

    await doc.destroy();
    return { trazos, anchoPt: vp.width, altoPt: vp.height };
}

/** Fracción de solapamiento respecto del bounding box más chico de los dos. */
function solape(a, b) {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (w <= 0 || h <= 0) return 0;
    const menor = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
    return menor > 0 ? (w * h) / menor : 0;
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

/**
 * Agrupa los nidos en bandas horizontales. Un molde con varias curvas las
 * dibuja en filas separadas de la hoja (masculino arriba, femenino al medio,
 * niño abajo).
 *
 * OJO con la tentación de cortar por "hueco grande entre nidos": no funciona.
 * En el archivo de camisetas el hueco DENTRO de una banda (de las tiras de
 * cuello al cuerpo: 66 cm) es MAYOR que el hueco ENTRE bandas (37 cm), así
 * que cortar por el salto más grande parte cada banda al medio y devuelve 6.
 *
 * Lo que sí se cumple es que las bandas no se pisan verticalmente: cada una
 * ocupa una franja propia de la hoja. Entonces se fusionan los intervalos
 * [y0, y1] de los nidos y se corta sólo cuando el siguiente arranca por
 * debajo de la franja acumulada, con una tolerancia del 5% del alto de la
 * hoja para los huecos internos.
 *
 * Aun así ESTO ES UNA SUGERENCIA: la curva de cada pieza la confirma el
 * usuario en pantalla. Si el molde viene con las bandas encimadas, el
 * resultado va a estar mal y hay que reasignarlo a mano.
 */
function detectarBandas(nidos, altoHojaPt) {
    if (!nidos.length) return;
    const tolerancia = altoHojaPt * 0.05;
    const orden = [...nidos].sort((a, b) => b.mayor.y1 - a.mayor.y1);

    let banda = 1;
    let pisoBanda = orden[0].mayor.y0;   // el borde inferior de la franja acumulada
    orden[0].bloque = 1;

    for (let i = 1; i < orden.length; i++) {
        const n = orden[i];
        if (n.mayor.y1 < pisoBanda - tolerancia) {
            banda++;
            pisoBanda = n.mayor.y0;
        } else {
            pisoBanda = Math.min(pisoBanda, n.mayor.y0);
        }
        n.bloque = banda;
    }
}

/**
 * Despieza un molde escalado.
 * Devuelve la hoja, el conteo de trazos y un nido por pieza, cada uno con su
 * contorno para la miniatura y la medida de cada talle. NO nombra nada: los
 * nidos vienen sin PiezaID y sin CurvaID, eso lo pone el usuario.
 */
async function parsearMolde(rutaPdf) {
    const { trazos, anchoPt, altoPt } = await leerTrazos(rutaPdf);

    const utiles = trazos.filter(t => {
        const w = (t.x1 - t.x0) * PT2CM;
        const h = (t.y1 - t.y0) * PT2CM;
        return w > MIN_LADO_CM && h > MIN_LADO_CM && !(w > MAX_LADO_CM && h > MAX_LADO_CM);
    });

    // Union-find por solapamiento
    const padre = utiles.map((_, i) => i);
    const raiz = x => (padre[x] === x ? x : (padre[x] = raiz(padre[x])));
    for (let i = 0; i < utiles.length; i++) {
        for (let j = i + 1; j < utiles.length; j++) {
            if (solape(utiles[i], utiles[j]) >= SOLAPE_MIN) padre[raiz(i)] = raiz(j);
        }
    }
    const porRaiz = new Map();
    utiles.forEach((t, i) => {
        const r = raiz(i);
        if (!porRaiz.has(r)) porRaiz.set(r, []);
        porRaiz.get(r).push(t);
    });

    // Un nido con un solo trazo no es una pieza escalada: es el cuadro de
    // talles que el CAD dibuja al costado, o un adorno suelto. Se descarta.
    const nidos = [...porRaiz.values()]
        .filter(g => g.length > 1)
        .map(g => {
            g.sort((a, b) => a.area - b.area);
            return { trazos: g, mayor: g[g.length - 1] };
        });

    detectarBandas(nidos, altoPt);

    // Orden de lectura: de arriba hacia abajo y de izquierda a derecha, que es
    // como el usuario los ve en la hoja.
    nidos.sort((a, b) => (b.mayor.y1 - a.mayor.y1) || (a.mayor.x0 - b.mayor.x0));

    const redondear = n => Math.round(n * 100) / 100;
    const piezas = nidos.map((nido, i) => ({
        nidoIndice: i + 1,
        bloque: nido.bloque || 1,
        cantidadTalles: nido.trazos.length,
        svgPath: aSvgPath(nido.mayor),
        talles: nido.trazos.map((t, k) => ({
            orden: k + 1,
            anchoCm: redondear((t.x1 - t.x0) * PT2CM),
            altoCm: redondear((t.y1 - t.y0) * PT2CM),
            areaCm2: redondear(t.area * PT2CM * PT2CM)
        }))
    }));

    const resultado = {
        anchoHojaCm: redondear(anchoPt * PT2CM),
        altoHojaCm: redondear(altoPt * PT2CM),
        trazosTotales: trazos.length,
        trazosUtiles: utiles.length,
        nidosDetectados: piezas.length,
        bandas: piezas.length ? Math.max(...piezas.map(p => p.bloque)) : 0,
        piezas
    };

    logger.info(`[Moldes] Despiece: ${resultado.trazosTotales} trazos → ${resultado.nidosDetectados} nidos en ${resultado.bandas} banda(s)`);
    return resultado;
}

/**
 * Validación previa a guardar nada. Un molde escaneado (raster) llega con
 * cero trazos vectoriales: no se puede despiezar y hay que rechazarlo en la
 * cara del usuario, no dejarlo entrar y que falle más tarde.
 */
function validarDespiece(r) {
    if (!r.trazosTotales) {
        return 'El PDF no tiene dibujo vectorial. Parece un molde escaneado o una imagen: hay que exportarlo del CAD como PDF vectorial.';
    }
    if (!r.nidosDetectados) {
        return 'No se encontró ninguna pieza escalada. Revisá que el PDF sea el molde con todos los talles anidados y no un talle suelto.';
    }
    const irregulares = new Set(r.piezas.map(p => p.cantidadTalles));
    if (irregulares.size > 1) {
        return `Las piezas no tienen todas la misma cantidad de talles (${[...irregulares].sort((a, b) => a - b).join(', ')}). Puede haber piezas encimadas en la hoja: revisá el despiece antes de rotular.`;
    }
    return null;
}

module.exports = { parsearMolde, validarDespiece };
