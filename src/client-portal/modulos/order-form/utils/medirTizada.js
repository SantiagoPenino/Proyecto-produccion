// =====================================================================
// MEDIR TIZADA — calcula piezas y recorrido real de corte (láser) de un
// archivo de tizada ANTES de dejarlo adjuntar al pedido de Corte.
// Formatos soportados (todos vectoriales, a escala real):
//   - PDF vectorial (export de los CAD de tizada)
//   - AI en compatibilidad Illustrator 3 (PostScript texto) o AI moderno (PDF interno)
//   - DXF (texto; LINE / LWPOLYLINE / POLYLINE / ARC / CIRCLE / SPLINE aprox.)
// Devuelve { formato, piezas, metrosCorte, anchoTelaM, largoTelaM }.
// Si el archivo no se puede leer/medir, TIRA Error con el motivo (el form
// usa eso para RECHAZAR la subida — regla del negocio: sin medición no entra).
// =====================================================================

const PT_A_M = 25.4 / 72 / 1000; // puntos PDF/PostScript → metros

// Largo de una curva Bézier cúbica por muestreo (error < 0.1% con n=24)
function largoBezier(x0, y0, x1, y1, x2, y2, x3, y3, n = 24) {
    let len = 0, px = x0, py = y0;
    for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        len += Math.hypot(x - px, y - py);
        px = x; py = y;
    }
    return len;
}

// ---------------------------------------------------------------------
// PDF (pdf.js v5): constructPath llega como [opPintado, [arrayPlano], minMax]
// arrayPlano: 0=moveTo(x,y) 1=lineTo(x,y) 2=curveTo(6) 3=quad(4) 4=closePath
// Solo cuentan los trazos DIBUJADOS (stroke): las tizadas pintan cada pieza
// dos veces (relleno blanco + contorno) y el clip del borde de página llega
// como endPath — ninguno de esos se corta.
// ---------------------------------------------------------------------
async function getPdfjs() {
    const pdfjsLib = await import('pdfjs-dist');
    if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
    }
    return pdfjsLib;
}

function largoPathPlano(flat) {
    let k = 0, cx = 0, cy = 0, sx = 0, sy = 0, len = 0, subtrazos = 0;
    while (k < flat.length) {
        const tag = flat[k];
        if (tag === 0) { cx = flat[k + 1]; cy = flat[k + 2]; sx = cx; sy = cy; subtrazos++; k += 3; }
        else if (tag === 1) { len += Math.hypot(flat[k + 1] - cx, flat[k + 2] - cy); cx = flat[k + 1]; cy = flat[k + 2]; k += 3; }
        else if (tag === 2) { len += largoBezier(cx, cy, flat[k + 1], flat[k + 2], flat[k + 3], flat[k + 4], flat[k + 5], flat[k + 6]); cx = flat[k + 5]; cy = flat[k + 6]; k += 7; }
        else if (tag === 3) { len += largoBezier(cx, cy, flat[k + 1], flat[k + 2], flat[k + 1], flat[k + 2], flat[k + 3], flat[k + 4]); cx = flat[k + 3]; cy = flat[k + 4]; k += 5; }
        else if (tag === 4) { len += Math.hypot(sx - cx, sy - cy); cx = sx; cy = sy; k += 1; }
        else { k += 1; }
    }
    return { len, subtrazos };
}

async function medirPDF(data) {
    const pdfjsLib = await getPdfjs();
    const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

    // Ops de pintado que implican corte real (contorno dibujado)
    const STROKE_OPS = [pdfjsLib.OPS.stroke, pdfjsLib.OPS.closeStroke, pdfjsLib.OPS.fillStroke,
        pdfjsLib.OPS.eoFillStroke, pdfjsLib.OPS.closeFillStroke, pdfjsLib.OPS.closeEOFillStroke];
    const FILL_OPS = [pdfjsLib.OPS.fill, pdfjsLib.OPS.eoFill];

    let metros = 0, metrosFill = 0, piezas = 0, piezasFill = 0;
    let anchoM = 0, largoM = 0;

    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        // La tizada es larga: el lado corto es el ancho de tela, el largo suma
        anchoM = Math.max(anchoM, Math.min(vp.width, vp.height) * PT_A_M * 1000);
        largoM += Math.max(vp.width, vp.height) * PT_A_M * 1000;

        const ops = await page.getOperatorList();
        for (let i = 0; i < ops.fnArray.length; i++) {
            if (ops.fnArray[i] !== pdfjsLib.OPS.constructPath) continue;
            const [opPintado, [flat]] = ops.argsArray[i];
            const { len, subtrazos } = largoPathPlano(flat);
            if (STROKE_OPS.includes(opPintado)) { metros += len * PT_A_M; piezas += subtrazos; }
            else if (FILL_OPS.includes(opPintado)) { metrosFill += len * PT_A_M; piezasFill += subtrazos; }
        }
    }
    // Sin contornos trazados (tizada exportada solo con rellenos): usar los rellenos
    if (metros <= 0 && metrosFill > 0) { metros = metrosFill; piezas = piezasFill; }
    return { formato: 'pdf', piezas, metrosCorte: metros, anchoTelaM: anchoM / 1000, largoTelaM: largoM / 1000 };
}

// ---------------------------------------------------------------------
// AI estilo Illustrator 3 (PostScript texto). Operadores:
//   "x y m" moveto | "x y l|L" lineto | "x1..y3 c|C" curva
//   "x2 y2 x3 y3 v|V" (ctrl1=punto actual) | "x1 y1 x3 y3 y|Y" (ctrl2=final)
//   "s" cierra+traza. Los CAD anotan cada pieza como "%AI3_Note:@Nombre".
// ---------------------------------------------------------------------
export function medirAI3(texto) {
    const piezasNotas = [...texto.matchAll(/%AI3_Note:@([^\r\n]+)/g)].length;

    const NUM = '(-?\\d*\\.?\\d+)';
    const reOp = new RegExp(
        `(?:${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+([cC])|` +
        `${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+([vVyY])|` +
        `${NUM}\\s+${NUM}\\s+([mlL])|` +
        `(?<![A-Za-z])([sb])(?![A-Za-z]))`, 'g');

    let cx = 0, cy = 0, sx = 0, sy = 0, total = 0, nSub = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const marca = (x, y) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    };

    for (const m of texto.matchAll(reOp)) {
        if (m[7]) {
            const [x1, y1, x2, y2, x3, y3] = m.slice(1, 7).map(Number);
            total += largoBezier(cx, cy, x1, y1, x2, y2, x3, y3); cx = x3; cy = y3; marca(x3, y3);
        } else if (m[12]) {
            const [a, b, c, d] = m.slice(8, 12).map(Number);
            if (m[12].toLowerCase() === 'v') total += largoBezier(cx, cy, cx, cy, a, b, c, d);
            else total += largoBezier(cx, cy, a, b, c, d, c, d);
            cx = c; cy = d; marca(c, d);
        } else if (m[15]) {
            const x = Number(m[13]), y = Number(m[14]);
            if (m[15] === 'm') { cx = x; cy = y; sx = x; sy = y; nSub++; }
            else { total += Math.hypot(x - cx, y - cy); cx = x; cy = y; }
            marca(x, y);
        } else if (m[16]) { // s / b: cerrar el trazo
            total += Math.hypot(sx - cx, sy - cy); cx = sx; cy = sy;
        }
    }

    if (nSub === 0 || total <= 0) throw new Error('El archivo AI no contiene trazos vectoriales medibles.');
    const dx = (maxX - minX) * PT_A_M * 1000, dy = (maxY - minY) * PT_A_M * 1000;
    return {
        formato: 'ai',
        // Piezas = CONTORNOS de corte (sub-trazos), NO las anotaciones %AI3_Note:
        // una sola nota puede cubrir varias copias de la pieza (ej. "Manga corta"
        // anotada una vez pero cortada dos veces) y quedaba subcontada.
        piezas: nSub,
        metrosCorte: total * PT_A_M,
        anchoTelaM: Math.min(dx, dy) / 1000,
        largoTelaM: Math.max(dx, dy) / 1000
    };
}

// ---------------------------------------------------------------------
// DXF (texto, pares código/valor). Entidades: LINE, LWPOLYLINE (con bulge),
// POLYLINE/VERTEX, ARC, CIRCLE, SPLINE (aprox. por puntos de ajuste/control).
// Unidades por $INSUNITS (1=pulgadas, 4=mm, 5=cm, 6=m; default mm).
// OJO: implementado sin archivo de ejemplo real — validar con una tizada DXF
// de un cliente en cuanto haya una.
// ---------------------------------------------------------------------
export function medirDXF(texto) {
    const lineas = texto.split(/\r?\n/);
    // Parsear pares (código, valor)
    const pares = [];
    for (let i = 0; i + 1 < lineas.length; i += 2) {
        pares.push([parseInt(lineas[i].trim(), 10), lineas[i + 1].trim()]);
    }

    // Unidades
    let aM = 0.001; // default mm
    for (let i = 0; i < pares.length - 1; i++) {
        if (pares[i][0] === 9 && pares[i][1] === '$INSUNITS' && pares[i + 1][0] === 70) {
            const u = parseInt(pares[i + 1][1], 10);
            aM = u === 1 ? 0.0254 : u === 4 ? 0.001 : u === 5 ? 0.01 : u === 6 ? 1 : 0.001;
            break;
        }
    }

    const largoBulge = (x1, y1, x2, y2, bulge) => {
        const c = Math.hypot(x2 - x1, y2 - y1);
        if (!bulge) return c;
        const theta = 4 * Math.atan(Math.abs(bulge));
        const r = c / (2 * Math.sin(theta / 2));
        return r * theta;
    };

    let total = 0, piezas = 0, entidades = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const marca = (x, y) => {
        if (Number.isFinite(x) && Number.isFinite(y)) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    };

    let i = 0;
    const leerEntidad = (desde) => {
        // Junta los códigos de la entidad hasta el próximo código 0
        const ent = [];
        let j = desde;
        while (j < pares.length && pares[j][0] !== 0) { ent.push(pares[j]); j++; }
        return [ent, j];
    };

    while (i < pares.length) {
        if (pares[i][0] !== 0) { i++; continue; }
        const tipo = pares[i][1].toUpperCase();
        const [ent, sig] = leerEntidad(i + 1);
        const val = (code) => { const p = ent.find(e => e[0] === code); return p ? parseFloat(p[1]) : null; };
        const vals = (code) => ent.filter(e => e[0] === code).map(e => parseFloat(e[1]));

        if (tipo === 'LINE') {
            const x1 = val(10), y1 = val(20), x2 = val(11), y2 = val(21);
            if (x1 !== null && x2 !== null) { total += Math.hypot(x2 - x1, y2 - y1); marca(x1, y1); marca(x2, y2); entidades++; }
        } else if (tipo === 'LWPOLYLINE') {
            const xs = vals(10), ys = vals(20);
            // bulge (42) es por vértice pero puede faltar en algunos: aproximamos secuencial
            const bulges = vals(42);
            const cerrado = ((val(70) || 0) & 1) === 1;
            for (let k = 0; k + 1 < xs.length; k++) {
                total += largoBulge(xs[k], ys[k], xs[k + 1], ys[k + 1], bulges[k] || 0);
                marca(xs[k], ys[k]);
            }
            if (xs.length > 1) {
                marca(xs[xs.length - 1], ys[ys.length - 1]);
                if (cerrado) { total += largoBulge(xs[xs.length - 1], ys[ys.length - 1], xs[0], ys[0], bulges[xs.length - 1] || 0); piezas++; }
            }
            entidades++;
        } else if (tipo === 'ARC') {
            const r = val(40), a1 = val(50), a2 = val(51);
            if (r !== null && a1 !== null && a2 !== null) {
                let sweep = (a2 - a1); while (sweep < 0) sweep += 360;
                total += (Math.PI * r * sweep) / 180;
                const cx0 = val(10), cy0 = val(20);
                marca(cx0 - r, cy0 - r); marca(cx0 + r, cy0 + r);
                entidades++;
            }
        } else if (tipo === 'CIRCLE') {
            const r = val(40);
            if (r !== null) {
                total += 2 * Math.PI * r; piezas++;
                const cx0 = val(10), cy0 = val(20);
                marca(cx0 - r, cy0 - r); marca(cx0 + r, cy0 + r);
                entidades++;
            }
        } else if (tipo === 'SPLINE') {
            // Aproximación poligonal por puntos de ajuste (11/21) o de control (10/20)
            let xs = vals(11), ys = vals(21);
            if (xs.length < 2) { xs = vals(10); ys = vals(20); }
            for (let k = 0; k + 1 < xs.length; k++) {
                total += Math.hypot(xs[k + 1] - xs[k], ys[k + 1] - ys[k]);
                marca(xs[k], ys[k]);
            }
            if (xs.length) marca(xs[xs.length - 1], ys[ys.length - 1]);
            entidades++;
        } else if (tipo === 'POLYLINE') {
            // POLYLINE viejo: vértices como entidades VERTEX hasta SEQEND
            const cerrado = ((val(70) || 0) & 1) === 1;
            let j = sig, px = null, py = null, fx = null, fy = null, pb = 0;
            while (j < pares.length && pares[j][0] === 0 && pares[j][1].toUpperCase() === 'VERTEX') {
                const [vent, vsig] = leerEntidad(j + 1);
                const vv = (code) => { const p = vent.find(e => e[0] === code); return p ? parseFloat(p[1]) : null; };
                const x = vv(10), y = vv(20);
                if (x !== null) {
                    if (px !== null) total += largoBulge(px, py, x, y, pb);
                    else { fx = x; fy = y; }
                    pb = vv(42) || 0; px = x; py = y; marca(x, y);
                }
                j = vsig;
            }
            if (j < pares.length && pares[j][0] === 0 && pares[j][1].toUpperCase() === 'SEQEND') { const r = leerEntidad(j + 1); j = r[1]; }
            if (cerrado && px !== null && fx !== null) { total += largoBulge(px, py, fx, fy, pb); piezas++; }
            entidades++;
            i = j; continue;
        }
        i = sig;
    }

    if (entidades === 0 || total <= 0) throw new Error('El DXF no contiene entidades de corte medibles (LINE/POLYLINE/ARC/...).');
    const dx = (maxX - minX) * aM, dy = (maxY - minY) * aM;
    return {
        formato: 'dxf',
        piezas: piezas > 0 ? piezas : entidades,
        metrosCorte: total * aM,
        anchoTelaM: Math.min(dx, dy),
        largoTelaM: Math.max(dx, dy)
    };
}

// ---------------------------------------------------------------------
// Entrada principal: detecta el formato por contenido (no solo extensión)
// ---------------------------------------------------------------------
export async function medirTizada(file) {
    const buffer = await file.arrayBuffer();
    const cabecera = new TextDecoder('latin1').decode(buffer.slice(0, 64));
    const nombre = (file.name || '').toLowerCase();

    let medicion;
    if (cabecera.startsWith('%PDF')) {
        // PDF puro o AI moderno (PDF-compatible)
        medicion = await medirPDF(buffer.slice(0));
    } else if (cabecera.startsWith('%!PS-Adobe') || nombre.endsWith('.ai') || nombre.endsWith('.eps')) {
        medicion = medirAI3(new TextDecoder('latin1').decode(buffer));
    } else if (nombre.endsWith('.dxf') || /^\s*0\s/.test(cabecera)) {
        medicion = medirDXF(new TextDecoder('latin1').decode(buffer));
    } else {
        throw new Error('Formato no soportado: la tizada debe ser un archivo vectorial de corte (PDF, AI o DXF).');
    }

    // Redondeos de presentación (2 decimales en metros)
    medicion.metrosCorte = Math.round(medicion.metrosCorte * 100) / 100;
    medicion.anchoTelaM = Math.round(medicion.anchoTelaM * 100) / 100;
    medicion.largoTelaM = Math.round(medicion.largoTelaM * 100) / 100;

    if (!(medicion.metrosCorte > 0)) throw new Error('No se detectaron trazos de corte en el archivo.');
    if (!(medicion.piezas >= 1)) throw new Error('No se detectaron piezas en la tizada.');
    return medicion;
}

export default medirTizada;
