/**
 * [TPU] Generación del archivo de corte (.plt / HPGL) desde el PDF de la plancha.
 *
 * Reemplaza el paso manual de hoy: exportar la capa "Corte" a PDF y abrirla en Corel para
 * guardarla como .plt. Acá se lee la geometría de esa capa directo del PDF y se escribe el HPGL.
 *
 * El dialecto está CALCADO de una muestra real que la cortadora aceptó (leones.plt):
 *   · 40 unidades por milímetro
 *   · origen en el CENTRO de la plancha, eje Y hacia arriba
 *   · marcas de registro con pluma 1 (SP1), contornos de corte con pluma 7 (SP7)
 *   · curvas aplanadas a segmentos rectos; contornos cerrados (el último punto repite el primero)
 * Ver docs/tpu-cliente-sube-vectorizado-plan.md §6.
 */
const UNIDADES_POR_MM = 40;
const PT_POR_MM = 2.83464567;          // 1 pt = 1/72", 1 mm = 2.834... pt
const TOLERANCIA_MM = 0.05;            // error máximo al aplanar una curva
const PLUMA_REGISTRO = 1;
const PLUMA_CORTE = 7;

const CABECERA = [
    'IN;',
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(p => `VS32,${p};`),
    'WU0;',
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(p => `PW0.350,${p};`),
].join('\n');

// ── Geometría ────────────────────────────────────────────────────────────────

/** Aplica una matriz PDF [a b c d e f] a un punto. */
const aplicar = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Multiplica dos matrices PDF (primero `a`, después `b`). */
const componer = (a, b) => [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

/**
 * Aplana una Bézier cúbica por subdivisión adaptativa: se corta al medio mientras la curva
 * se aparte del segmento recto más que la tolerancia. Es lo mismo que hace el plóter
 * internamente, y lo que hace Corel al exportar (en la muestra el escudo queda en ~57 puntos).
 */
function aplanarBezier(p0, p1, p2, p3, tol, salida, prof = 0) {
    // Distancia de los puntos de control a la recta p0-p3: si es chica, la curva ya es una recta.
    const dx = p3[0] - p0[0], dy = p3[1] - p0[1];
    const largo = Math.hypot(dx, dy);
    let esPlana = false;
    if (largo < 1e-9) {
        esPlana = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < tol
             && Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) < tol;
    } else {
        const d1 = Math.abs((p1[0] - p3[0]) * dy - (p1[1] - p3[1]) * dx) / largo;
        const d2 = Math.abs((p2[0] - p3[0]) * dy - (p2[1] - p3[1]) * dx) / largo;
        esPlana = Math.max(d1, d2) < tol;
    }
    if (esPlana || prof > 16) { salida.push(p3); return; }

    const medio = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const p01 = medio(p0, p1), p12 = medio(p1, p2), p23 = medio(p2, p3);
    const p012 = medio(p01, p12), p123 = medio(p12, p23);
    const centro = medio(p012, p123);
    aplanarBezier(p0, p01, p012, centro, tol, salida, prof + 1);
    aplanarBezier(centro, p123, p23, p3, tol, salida, prof + 1);
}

// ── Extracción de trazados de UNA capa del PDF ───────────────────────────────

/**
 * Devuelve los contornos (polilíneas en puntos PDF) de la capa `nombreCapa`.
 * Recorre la lista de operadores rastreando la matriz de transformación (CTM) y el
 * marcado de contenido (BDC/EMC), que es lo que delimita cada capa OCG.
 */
async function extraerContornosDeCapa(pdfjs, rutaPdf, nombreCapa, fs) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(rutaPdf)) }).promise;
    const occ = await doc.getOptionalContentConfig();
    const pagina = await doc.getPage(1);
    const vista = pagina.getViewport({ scale: 1 });
    const ops = await pagina.getOperatorList();

    const nombreOp = {};
    for (const k in pdfjs.OPS) nombreOp[pdfjs.OPS[k]] = k;

    let ctm = [1, 0, 0, 1, 0, 0];
    const pilaCtm = [];
    const pilaCapa = [];
    // `nombreCapa = null` = tomar TODO el dibujo. Es el caso del PDF de una sola capa que sale
    // de la imposición (ya viene aplanado por Poppler, sin OCG que filtrar).
    const enCapa = () => nombreCapa === null
        || (pilaCapa.length > 0 && pilaCapa[pilaCapa.length - 1] === nombreCapa);

    const contornos = [];
    const tolPt = TOLERANCIA_MM * PT_POR_MM;

    for (let i = 0; i < ops.fnArray.length; i++) {
        const op = nombreOp[ops.fnArray[i]];
        const arg = ops.argsArray[i];

        if (op === 'save') { pilaCtm.push(ctm.slice()); continue; }
        if (op === 'restore') { ctm = pilaCtm.pop() || [1, 0, 0, 1, 0, 0]; continue; }
        if (op === 'transform') { ctm = componer(arg, ctm); continue; }

        if (op === 'beginMarkedContentProps') {
            const bruto = Array.isArray(arg) ? arg[1] : arg;
            const id = (bruto && typeof bruto === 'object') ? (bruto.id ?? bruto.ids?.[0]) : bruto;
            let nom = null;
            try { nom = occ.getGroup(id)?.name ?? null; } catch (_) { }
            pilaCapa.push(nom ?? (pilaCapa[pilaCapa.length - 1] ?? null));
            continue;
        }
        if (op === 'beginMarkedContent') { pilaCapa.push(pilaCapa[pilaCapa.length - 1] ?? null); continue; }
        if (op === 'endMarkedContent') { pilaCapa.pop(); continue; }

        if (op !== 'constructPath' || !enCapa()) continue;

        // constructPath en pdf.js 5.x: args = [opPintado, [Float32Array codificado], minMax].
        // El array intercala CÓDIGO + coordenadas: 0=moveTo(2) 1=lineTo(2) 2=curveTo(6)
        // 3=rect(4) 4=closePath(0). No son los OPS.* del listado general.
        const datos = Array.isArray(arg[1]) ? arg[1] : [arg[1]];
        let actual = null, inicio = null, cursor = null;
        const cerrar = () => { if (actual && actual.length > 1) contornos.push(actual); actual = null; };
        const punto = (x, y) => aplicar(ctm, x, y);

        for (const buf of datos) {
            const d = buf; let k = 0;
            while (k < d.length) {
                const codigo = d[k++];
                if (codigo === 0) {                       // moveTo
                    cerrar();
                    cursor = punto(d[k], d[k + 1]); k += 2;
                    inicio = cursor; actual = [cursor];
                } else if (codigo === 1) {                // lineTo
                    cursor = punto(d[k], d[k + 1]); k += 2;
                    if (actual) actual.push(cursor);
                } else if (codigo === 2) {                // curveTo (cúbica)
                    const c1 = punto(d[k], d[k + 1]);
                    const c2 = punto(d[k + 2], d[k + 3]);
                    const fin = punto(d[k + 4], d[k + 5]); k += 6;
                    if (actual && cursor) aplanarBezier(cursor, c1, c2, fin, tolPt, actual);
                    cursor = fin;
                } else if (codigo === 3) {                // rectángulo (x, y, w, h)
                    const x = d[k], y = d[k + 1], w = d[k + 2], h = d[k + 3]; k += 4;
                    cerrar();
                    contornos.push([punto(x, y), punto(x + w, y), punto(x + w, y + h), punto(x, y + h), punto(x, y)]);
                    cursor = null;
                } else if (codigo === 4) {                // closePath
                    if (actual && inicio) actual.push(inicio);
                } else {
                    // Código desconocido: cortar acá antes de desalinear el resto del buffer.
                    throw new Error(`constructPath: código de trazado desconocido ${codigo} (pos ${k - 1})`);
                }
            }
        }
        cerrar();
    }

    await doc.destroy?.();
    // `page.view` = MediaBox [x0, y0, x1, y1]. NO siempre arranca en (0,0): la plancha se recorta
    // a su contenido, así que el origen queda corrido. Los contornos salen en ese mismo espacio
    // de usuario, y el centro (que es el origen del plóter) hay que calcularlo con ese offset —
    // si no, el corte sale desplazado por el tamaño del recorte.
    const [vx0, vy0, vx1, vy1] = pagina.view;
    return {
        contornos,
        ancho: vista.width, alto: vista.height,
        centro: [(vx0 + vx1) / 2, (vy0 + vy1) / 2],
    };
}

// ── Escritura del HPGL ───────────────────────────────────────────────────────

/**
 * Arma el texto .plt. Los contornos vienen en puntos PDF con origen abajo-izquierda; el
 * plóter los quiere en unidades de 40/mm con origen en el CENTRO de la plancha.
 */
function escribirPlt(grupos, anchoPt, altoPt, centro = null) {
    const [cx, cy] = centro || [anchoPt / 2, altoPt / 2];
    const aU = (v) => Math.round((v / PT_POR_MM) * UNIDADES_POR_MM);
    const lineas = [CABECERA];

    for (const { pluma, contornos } of grupos) {
        for (const c of contornos) {
            if (c.length < 2) continue;
            lineas.push(`SP${pluma};`);
            const [x0, y0] = c[0];
            lineas.push(`PU${aU(x0 - cx)} ${aU(y0 - cy)};`);
            for (let i = 1; i < c.length; i++) {
                const [x, y] = c[i];
                lineas.push(`PD${aU(x - cx)} ${aU(y - cy)};`);
            }
        }
    }
    lineas.push('SP0;');
    return lineas.join('\n') + '\n';
}

/**
 * Genera el .plt de una plancha ya impuesta.
 * @param {string} rutaPdf  PDF/AI de la plancha (con sus capas)
 * @param {object} opts     { capaCorte='Corte', capaRegistro=null }
 * @returns {Promise<{plt: string, contornos: number, marcas: number}>}
 */
async function generarPltDesdePlancha(rutaPdf, opts = {}) {
    const fs = require('fs');
    const path = require('path');
    const pdfjs = await import(
        require('url').pathToFileURL(
            path.join(require.resolve('pdfjs-dist/package.json'), '..', 'legacy', 'build', 'pdf.mjs')
        ).href
    );

    // `capaCorte: null` fuerza el modo "todo el dibujo" (PDF ya aislado). Si se pide una capa y
    // el PDF no la tiene, se cae a ese modo en vez de devolver un .plt vacío.
    const capaCorte = opts.capaCorte === null ? null : (opts.capaCorte || 'Corte');
    let corte = await extraerContornosDeCapa(pdfjs, rutaPdf, capaCorte, fs);
    if (capaCorte !== null && corte.contornos.length === 0) {
        corte = await extraerContornosDeCapa(pdfjs, rutaPdf, null, fs);
    }

    // Las marcas de registro viven en la MISMA capa Corte (el script de Illustrator las dibuja
    // ahí y en CMYK). Se separan por tamaño: son círculos de 5 mm, mucho más chicos que un parche.
    const LIMITE_MARCA_PT = 8 * PT_POR_MM;
    const marcas = [], troqueles = [];
    for (const c of corte.contornos) {
        const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
        const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        (w <= LIMITE_MARCA_PT && h <= LIMITE_MARCA_PT ? marcas : troqueles).push(c);
    }

    const plt = escribirPlt([
        { pluma: PLUMA_REGISTRO, contornos: marcas },
        { pluma: PLUMA_CORTE, contornos: troqueles },
    ], corte.ancho, corte.alto, corte.centro);

    return { plt, contornos: troqueles.length, marcas: marcas.length };
}

module.exports = { generarPltDesdePlancha, extraerContornosDeCapa, escribirPlt, UNIDADES_POR_MM, PT_POR_MM };
