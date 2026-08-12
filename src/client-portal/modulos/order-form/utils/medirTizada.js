// =====================================================================
// MEDIR TIZADA — calcula piezas y recorrido real de corte (láser) de un
// archivo de tizada ANTES de dejarlo adjuntar al pedido de Corte.
//
// FORMATOS ACEPTADOS (regla 06/08): solo los que usa la máquina de corte —
//   - DXF (texto)
//   - PLT / HPGL (lo que come el plotter de corte)
//   - AI guardado como Illustrator 3 (PostScript, no el .ai moderno que es PDF)
// Cualquier otro (PDF, AI moderno, imágenes...) se rechaza con motivo.
//
// CÓMO SE MIDE (regla 06/08): por LÍNEAS, no por trazos.
//   - Todos los segmentos se "planarizan": se parten en los nodos comunes y
//     en los cruces, y las líneas repetidas o superpuestas se cuentan UNA vez
//     (si una línea corta dos piezas pegadas, es un solo corte del láser).
//   - Las piezas son las REGIONES CERRADAS que forman esas líneas (fórmula de
//     Euler), así que da igual que el archivo venga como 16 rectángulos sueltos
//     o como un zigzag continuo: la misma tizada da la misma cantidad de piezas.
//
// Devuelve { formato, piezas, metrosCorte, anchoTelaM, largoTelaM }.
// Si no se puede leer/medir, TIRA Error con el motivo (el form lo usa para
// RECHAZAR la subida — sin medición no hay forma de cotizar el corte).
// =====================================================================

const PT_A_M = 25.4 / 72 / 1000;   // puntos PostScript → metros
const TOL = 0.0005;                // 0,5 mm: dos puntos más cerca que esto son el MISMO nodo

// MESA DE CORTE (láser): medida física del equipo. Ninguna tizada puede superarla.
export const MESA_CORTE_ANCHO_M = 1.789;
export const MESA_CORTE_LARGO_M = 2.90;
// Margen no utilizable a lo ancho de la tela: los mismos 3 cm que descuenta
// sublimación contra el ancho del rollo (ver OrderForm: maxWidth - 0.03).
export const MARGEN_TELA_M = 0.03;

// ---------------------------------------------------------------------
// Geometría auxiliar
// ---------------------------------------------------------------------
function largoBezier(x0, y0, x1, y1, x2, y2, x3, y3, n = 16) {
    const pts = [];
    for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([
            u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        ]);
    }
    return pts;
}

// ---------------------------------------------------------------------
// PLANARIZACIÓN + EULER
// segmentos: [[x1,y1,x2,y2], ...] en metros
// ---------------------------------------------------------------------
function analizarGeometria(segmentos) {
    // 1) Nodos únicos (snap por celda de TOL)
    const nodos = [];
    const grilla = new Map();
    const claveCelda = (x, y) => `${Math.round(x / TOL)}|${Math.round(y / TOL)}`;
    const nodoDe = (x, y) => {
        const cx = Math.round(x / TOL), cy = Math.round(y / TOL);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const lista = grilla.get(`${cx + dx}|${cy + dy}`);
                if (!lista) continue;
                for (const id of lista) {
                    const n = nodos[id];
                    if (Math.hypot(n[0] - x, n[1] - y) <= TOL) return id;
                }
            }
        }
        const id = nodos.length;
        nodos.push([x, y]);
        const k = claveCelda(x, y);
        if (!grilla.has(k)) grilla.set(k, []);
        grilla.get(k).push(id);
        return id;
    };

    // Segmentos con sus extremos ya como nodos (descarta los de largo ~0)
    const segs = [];
    for (const [x1, y1, x2, y2] of segmentos) {
        if (Math.hypot(x2 - x1, y2 - y1) < TOL) continue;
        segs.push({ a: nodoDe(x1, y1), b: nodoDe(x2, y2) });
    }
    if (segs.length === 0) return null;

    // 2) Cruces propios (X): parten segmentos que se cortan en el medio.
    //    Los toques en T ya quedan cubiertos por el paso 3 (nodo sobre segmento).
    //    ÍNDICE ESPACIAL: una tizada real trae miles de segmentos y comparar todos
    //    contra todos colgaría el navegador; solo se comparan los que comparten celda.
    const cortes = segs.map(() => []);
    const cajas = segs.map((s) => {
        const A = nodos[s.a], B = nodos[s.b];
        return [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[0], B[0]), Math.max(A[1], B[1])];
    });
    // Celda = largo promedio de segmento (mínimo 1 cm) → pocos candidatos por celda
    let sumaLargos = 0;
    for (const c of cajas) sumaLargos += Math.hypot(c[2] - c[0], c[3] - c[1]);
    const CELDA = Math.max(0.01, sumaLargos / Math.max(1, cajas.length));
    const celdasDeCaja = (c) => {
        const out = [];
        const x0 = Math.floor(c[0] / CELDA), x1 = Math.floor(c[2] / CELDA);
        const y0 = Math.floor(c[1] / CELDA), y1 = Math.floor(c[3] / CELDA);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) out.push(`${gx}|${gy}`);
        return out;
    };
    const indiceSegs = new Map();
    cajas.forEach((c, idx) => {
        for (const k of celdasDeCaja(c)) {
            if (!indiceSegs.has(k)) indiceSegs.set(k, []);
            indiceSegs.get(k).push(idx);
        }
    });

    const paresVistos = new Set();
    for (let i = 0; i < segs.length; i++) {
        const candidatos = new Set();
        for (const k of celdasDeCaja(cajas[i])) {
            for (const j of (indiceSegs.get(k) || [])) if (j > i) candidatos.add(j);
        }
        for (const j of candidatos) {
            const clavePar = `${i}:${j}`;
            if (paresVistos.has(clavePar)) continue;
            paresVistos.add(clavePar);
            // descarte rápido por bounding box
            if (cajas[i][0] > cajas[j][2] + TOL || cajas[j][0] > cajas[i][2] + TOL ||
                cajas[i][1] > cajas[j][3] + TOL || cajas[j][1] > cajas[i][3] + TOL) continue;
            const p = nodos[segs[i].a], p2 = nodos[segs[i].b];
            const q = nodos[segs[j].a], q2 = nodos[segs[j].b];
            const r = [p2[0] - p[0], p2[1] - p[1]];
            const s = [q2[0] - q[0], q2[1] - q[1]];
            const den = r[0] * s[1] - r[1] * s[0];
            if (Math.abs(den) < 1e-12) continue; // paralelos/colineales
            const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
            const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
            if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue; // se tocan en extremos
            const ix = p[0] + t * r[0], iy = p[1] + t * r[1];
            const id = nodoDe(ix, iy);
            cortes[i].push(id);
            cortes[j].push(id);
        }
    }

    // 3) Cada segmento se parte en TODOS los nodos que caen sobre él (extremos de
    //    otros segmentos + cruces). Así dos piezas pegadas comparten los mismos
    //    tramos y la línea del medio se cuenta una sola vez.
    const aristas = new Map(); // "a-b" (ordenado) → largo
    const sobreSegmento = (P, A, B) => {
        const vx = B[0] - A[0], vy = B[1] - A[1];
        const largo2 = vx * vx + vy * vy;
        if (largo2 === 0) return null;
        const t = ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / largo2;
        if (t <= 1e-9 || t >= 1 - 1e-9) return null;
        const dist = Math.abs((P[0] - A[0]) * vy - (P[1] - A[1]) * vx) / Math.sqrt(largo2);
        return dist <= TOL ? t : null;
    };

    // Índice espacial de NODOS: para partir un segmento solo se miran los nodos
    // de las celdas que ese segmento atraviesa (no los miles del archivo entero).
    const indiceNodos = new Map();
    nodos.forEach(([x, y], id) => {
        const k = `${Math.floor(x / CELDA)}|${Math.floor(y / CELDA)}`;
        if (!indiceNodos.has(k)) indiceNodos.set(k, []);
        indiceNodos.get(k).push(id);
    });

    segs.forEach((s, idx) => {
        const A = nodos[s.a], B = nodos[s.b];
        const puntos = [{ t: 0, id: s.a }, { t: 1, id: s.b }];
        const vistos = new Set([s.a, s.b]);
        cortes[idx].forEach(id => {
            if (vistos.has(id)) return;
            vistos.add(id);
            const t = sobreSegmento(nodos[id], A, B);
            if (t !== null) puntos.push({ t, id });
        });
        // nodos de otros segmentos que caen sobre este (toques en T). La caja se
        // agranda TOL para no perder un nodo pegado al borde de la celda.
        const cajaAmpliada = [cajas[idx][0] - TOL, cajas[idx][1] - TOL, cajas[idx][2] + TOL, cajas[idx][3] + TOL];
        for (const k of celdasDeCaja(cajaAmpliada)) {
            for (const id of (indiceNodos.get(k) || [])) {
                if (vistos.has(id)) continue;
                vistos.add(id);
                const t = sobreSegmento(nodos[id], A, B);
                if (t !== null) puntos.push({ t, id });
            }
        }
        puntos.sort((p, q) => p.t - q.t);
        for (let k = 0; k + 1 < puntos.length; k++) {
            const n1 = puntos[k].id, n2 = puntos[k + 1].id;
            if (n1 === n2) continue;
            const clave = n1 < n2 ? `${n1}-${n2}` : `${n2}-${n1}`;
            if (aristas.has(clave)) continue; // línea repetida/superpuesta: UN solo corte
            const P1 = nodos[n1], P2 = nodos[n2];
            aristas.set(clave, Math.hypot(P2[0] - P1[0], P2[1] - P1[1]));
        }
    });

    // 4) Métricas: largo de corte = suma de aristas ÚNICAS
    let metrosCorte = 0;
    for (const l of aristas.values()) metrosCorte += l;

    // 5) Piezas = caras internas del grafo planar (Euler: F = E - V + C)
    //    Solo cuentan los nodos que participan de alguna arista.
    const usados = new Set();
    const padre = new Map();
    const find = (x) => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) padre.set(ra, rb); };
    for (const clave of aristas.keys()) {
        const [a, b] = clave.split('-').map(Number);
        [a, b].forEach(n => { if (!usados.has(n)) { usados.add(n); padre.set(n, n); } });
        union(a, b);
    }
    const componentes = new Set([...usados].map(find)).size;
    const piezas = Math.max(0, aristas.size - usados.size + componentes);

    // 6) Medida ocupada por la tizada
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of usados) {
        const [x, y] = nodos[n];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const dx = maxX - minX, dy = maxY - minY;

    return {
        piezas,
        metrosCorte,
        // La tizada se acuesta sobre la tela: el lado corto va al ancho del rollo
        anchoTelaM: Math.min(dx, dy),
        largoTelaM: Math.max(dx, dy),
    };
}

// ---------------------------------------------------------------------
// AI3 (Illustrator 3 / PostScript). Operadores:
//   "x y m" moveto | "x y l|L" lineto | "x1..y3 c|C" curva
//   "x2 y2 x3 y3 v|V" (ctrl1 = punto actual) | "x1 y1 x3 y3 y|Y" (ctrl2 = final)
//   "s|b" cierra el trazo. Coordenadas en puntos PostScript.
// ---------------------------------------------------------------------
export function segmentosAI3(texto) {
    const NUM = '(-?\\d*\\.?\\d+)';
    const reOp = new RegExp(
        `(?:${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+([cC])|` +
        `${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+([vVyY])|` +
        `${NUM}\\s+${NUM}\\s+([mlL])|` +
        `(?<![A-Za-z])([sb])(?![A-Za-z]))`, 'g');

    const segs = [];
    let cx = 0, cy = 0, sx = 0, sy = 0, hayTrazo = false;
    const push = (x1, y1, x2, y2) => segs.push([x1 * PT_A_M, y1 * PT_A_M, x2 * PT_A_M, y2 * PT_A_M]);
    const curva = (x1, y1, x2, y2, x3, y3) => {
        let px = cx, py = cy;
        for (const [x, y] of largoBezier(cx, cy, x1, y1, x2, y2, x3, y3)) { push(px, py, x, y); px = x; py = y; }
        cx = x3; cy = y3;
    };

    for (const m of texto.matchAll(reOp)) {
        if (m[7]) {
            const [x1, y1, x2, y2, x3, y3] = m.slice(1, 7).map(Number);
            curva(x1, y1, x2, y2, x3, y3); hayTrazo = true;
        } else if (m[12]) {
            const [a, b, c, d] = m.slice(8, 12).map(Number);
            if (m[12].toLowerCase() === 'v') curva(cx, cy, a, b, c, d);
            else curva(a, b, c, d, c, d);
            hayTrazo = true;
        } else if (m[15]) {
            const x = Number(m[13]), y = Number(m[14]);
            if (m[15] === 'm') { cx = x; cy = y; sx = x; sy = y; }
            else { push(cx, cy, x, y); cx = x; cy = y; hayTrazo = true; }
        } else if (m[16]) {
            push(cx, cy, sx, sy); cx = sx; cy = sy;
        }
    }
    if (!hayTrazo) throw new Error('El archivo de Illustrator no contiene trazos de corte.');
    return segs;
}

// ---------------------------------------------------------------------
// PLT / HPGL — lo que come el plotter de corte.
// PU = pluma arriba (traslado, NO corta) | PD = pluma abajo (corta).
// Unidad estándar: 1 plotter unit = 0,025 mm. IN/IP/SC no se interpretan
// (las tizadas salen en unidades nativas); SC haría falta solo con escalado.
// ---------------------------------------------------------------------
export function segmentosPLT(texto) {
    const UNIDAD_M = 0.025 / 1000; // 0,025 mm por unidad
    const segs = [];
    let x = 0, y = 0, pluma = false, absoluto = true, iniciado = false;

    const comandos = texto.replace(/[\r\n]+/g, '').split(';');
    for (const cmd of comandos) {
        const t = cmd.trim();
        if (!t) continue;
        const op = t.slice(0, 2).toUpperCase();
        if (op === 'PA') absoluto = true;
        if (op === 'PR') absoluto = false;
        if (!['PU', 'PD', 'PA', 'PR'].includes(op)) continue;
        if (op === 'PU') pluma = false;
        if (op === 'PD') pluma = true;

        const nums = (t.slice(2).match(/-?\d+(\.\d+)?/g) || []).map(Number);
        for (let i = 0; i + 1 < nums.length; i += 2) {
            const nx = absoluto ? nums[i] : x + nums[i];
            const ny = absoluto ? nums[i + 1] : y + nums[i + 1];
            if (pluma && iniciado) segs.push([x * UNIDAD_M, y * UNIDAD_M, nx * UNIDAD_M, ny * UNIDAD_M]);
            x = nx; y = ny; iniciado = true;
        }
    }
    if (segs.length === 0) throw new Error('El PLT no contiene trazos de corte (comandos PD).');
    return segs;
}

// ---------------------------------------------------------------------
// DXF (texto, pares código/valor). LINE / LWPOLYLINE / POLYLINE / ARC /
// CIRCLE / SPLINE. Unidades por $INSUNITS (1=pulgadas, 4=mm, 5=cm, 6=m).
// ---------------------------------------------------------------------
export function segmentosDXF(texto) {
    const lineas = texto.split(/\r?\n/);
    const pares = [];
    for (let i = 0; i + 1 < lineas.length; i += 2) {
        pares.push([parseInt(lineas[i].trim(), 10), lineas[i + 1].trim()]);
    }

    let aM = 0.001; // default mm
    for (let i = 0; i < pares.length - 1; i++) {
        if (pares[i][0] === 9 && pares[i][1] === '$INSUNITS' && pares[i + 1][0] === 70) {
            const u = parseInt(pares[i + 1][1], 10);
            aM = u === 1 ? 0.0254 : u === 4 ? 0.001 : u === 5 ? 0.01 : u === 6 ? 1 : 0.001;
            break;
        }
    }

    const segs = [];
    const push = (x1, y1, x2, y2) => segs.push([x1 * aM, y1 * aM, x2 * aM, y2 * aM]);
    // Arco por bulge (LWPOLYLINE/POLYLINE): se aproxima por tramos rectos
    const arcoBulge = (x1, y1, x2, y2, bulge) => {
        if (!bulge) { push(x1, y1, x2, y2); return; }
        const theta = 4 * Math.atan(bulge);
        const c = Math.hypot(x2 - x1, y2 - y1);
        const r = c / (2 * Math.sin(Math.abs(theta) / 2));
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const d = Math.sqrt(Math.max(0, r * r - (c / 2) * (c / 2))) * (Math.abs(theta) > Math.PI ? -1 : 1) * Math.sign(theta);
        const cx0 = mx - d * (y2 - y1) / c, cy0 = my + d * (x2 - x1) / c;
        const a1 = Math.atan2(y1 - cy0, x1 - cx0);
        const n = Math.max(4, Math.ceil(Math.abs(theta) / 0.2));
        let px = x1, py = y1;
        for (let i = 1; i <= n; i++) {
            const a = a1 + (theta * i) / n;
            const nx = cx0 + r * Math.cos(a), ny = cy0 + r * Math.sin(a);
            push(px, py, nx, ny); px = nx; py = ny;
        }
    };

    let i = 0;
    const leerEntidad = (desde) => {
        const ent = []; let j = desde;
        while (j < pares.length && pares[j][0] !== 0) { ent.push(pares[j]); j++; }
        return [ent, j];
    };

    let entidades = 0;
    while (i < pares.length) {
        if (pares[i][0] !== 0) { i++; continue; }
        const tipo = pares[i][1].toUpperCase();
        const [ent, sig] = leerEntidad(i + 1);
        const val = (c) => { const p = ent.find(e => e[0] === c); return p ? parseFloat(p[1]) : null; };
        const vals = (c) => ent.filter(e => e[0] === c).map(e => parseFloat(e[1]));

        if (tipo === 'LINE') {
            const x1 = val(10), y1 = val(20), x2 = val(11), y2 = val(21);
            if (x1 !== null && x2 !== null) { push(x1, y1, x2, y2); entidades++; }
        } else if (tipo === 'LWPOLYLINE') {
            const xs = vals(10), ys = vals(20), bulges = vals(42);
            const cerrado = ((val(70) || 0) & 1) === 1;
            for (let k = 0; k + 1 < xs.length; k++) arcoBulge(xs[k], ys[k], xs[k + 1], ys[k + 1], bulges[k] || 0);
            if (cerrado && xs.length > 1) arcoBulge(xs[xs.length - 1], ys[ys.length - 1], xs[0], ys[0], bulges[xs.length - 1] || 0);
            entidades++;
        } else if (tipo === 'ARC') {
            const r = val(40), a1 = val(50), a2 = val(51), cx0 = val(10), cy0 = val(20);
            if (r !== null && a1 !== null && a2 !== null) {
                let sweep = a2 - a1; while (sweep < 0) sweep += 360;
                const n = Math.max(4, Math.ceil(sweep / 12));
                let px = cx0 + r * Math.cos(a1 * Math.PI / 180), py = cy0 + r * Math.sin(a1 * Math.PI / 180);
                for (let k = 1; k <= n; k++) {
                    const a = (a1 + (sweep * k) / n) * Math.PI / 180;
                    const nx = cx0 + r * Math.cos(a), ny = cy0 + r * Math.sin(a);
                    push(px, py, nx, ny); px = nx; py = ny;
                }
                entidades++;
            }
        } else if (tipo === 'CIRCLE') {
            const r = val(40), cx0 = val(10), cy0 = val(20);
            if (r !== null) {
                const n = 32;
                let px = cx0 + r, py = cy0;
                for (let k = 1; k <= n; k++) {
                    const a = (2 * Math.PI * k) / n;
                    const nx = cx0 + r * Math.cos(a), ny = cy0 + r * Math.sin(a);
                    push(px, py, nx, ny); px = nx; py = ny;
                }
                entidades++;
            }
        } else if (tipo === 'SPLINE') {
            let xs = vals(11), ys = vals(21);
            if (xs.length < 2) { xs = vals(10); ys = vals(20); }
            for (let k = 0; k + 1 < xs.length; k++) push(xs[k], ys[k], xs[k + 1], ys[k + 1]);
            entidades++;
        } else if (tipo === 'POLYLINE') {
            const cerrado = ((val(70) || 0) & 1) === 1;
            let j = sig, px = null, py = null, fx = null, fy = null, pb = 0;
            while (j < pares.length && pares[j][0] === 0 && pares[j][1].toUpperCase() === 'VERTEX') {
                const [vent, vsig] = leerEntidad(j + 1);
                const vv = (c) => { const p = vent.find(e => e[0] === c); return p ? parseFloat(p[1]) : null; };
                const x = vv(10), y = vv(20);
                if (x !== null) {
                    if (px !== null) arcoBulge(px, py, x, y, pb);
                    else { fx = x; fy = y; }
                    pb = vv(42) || 0; px = x; py = y;
                }
                j = vsig;
            }
            if (j < pares.length && pares[j][0] === 0 && pares[j][1].toUpperCase() === 'SEQEND') j = leerEntidad(j + 1)[1];
            if (cerrado && px !== null && fx !== null) arcoBulge(px, py, fx, fy, pb);
            entidades++;
            i = j; continue;
        }
        i = sig;
    }

    if (entidades === 0 || segs.length === 0) throw new Error('El DXF no contiene entidades de corte (LINE/POLYLINE/ARC/...).');
    return segs;
}

// ---------------------------------------------------------------------
// Entrada principal: detecta el formato por CONTENIDO (no solo por extensión)
// ---------------------------------------------------------------------
export async function medirTizada(file) {
    const buffer = await file.arrayBuffer();
    const texto = new TextDecoder('latin1').decode(buffer);
    const cabecera = texto.slice(0, 2048);
    const nombre = (file.name || '').toLowerCase();

    let segmentos, formato;

    if (cabecera.startsWith('%PDF')) {
        throw new Error('Es un PDF (los .ai actuales de Illustrator también lo son). Guardalo desde Illustrator con "Guardar como → Illustrator 3", o exportá el DXF o el PLT del programa de corte.');
    }

    if (cabecera.startsWith('%!PS-Adobe') || /%%Creator:\s*Adobe Illustrator/i.test(cabecera)) {
        if (!/Adobe Illustrator/i.test(cabecera)) {
            throw new Error('Es un PostScript que no salió de Illustrator. Guardá la tizada como Illustrator 3, DXF o PLT.');
        }
        segmentos = segmentosAI3(texto);
        formato = 'ai3';
    } else if (nombre.endsWith('.dxf') || /^\s*0\s*[\r\n]+\s*SECTION/i.test(cabecera)) {
        segmentos = segmentosDXF(texto);
        formato = 'dxf';
    } else if (nombre.endsWith('.plt') || nombre.endsWith('.hpgl') || /(^|;)\s*(IN|SP\d|PU|PD|PA)/i.test(cabecera)) {
        segmentos = segmentosPLT(texto);
        formato = 'plt';
    } else {
        throw new Error('Formato no soportado. La tizada tiene que ser DXF, PLT o AI guardado como Illustrator 3.');
    }

    const geo = analizarGeometria(segmentos);
    if (!geo) throw new Error('No se detectaron trazos de corte en el archivo.');

    const r2 = (n) => Math.round(n * 100) / 100;
    const medicion = {
        formato,
        piezas: geo.piezas,
        metrosCorte: r2(geo.metrosCorte),
        anchoTelaM: r2(geo.anchoTelaM),
        largoTelaM: r2(geo.largoTelaM),
    };

    if (!(medicion.metrosCorte > 0)) throw new Error('No se detectaron trazos de corte en el archivo.');
    if (!(medicion.piezas >= 1)) throw new Error('No se detectaron piezas cerradas en la tizada: revisá que los contornos estén cerrados.');
    return medicion;
}

export default medirTizada;
