// Plano de una planta de un local (Servicio Técnico → Locales, 20/10/2026). Geometría pura, sin React: la usa el
// editor (PlanoEditor.jsx) y se prueba suelta. Se guarda como JSON en ST_LocalPlantas.Contorno.
//
// Todo en centímetros, con el eje y para abajo (como la pantalla). Todas las plantas de un local comparten el mismo
// origen: así la planta alta se dibuja encima de la baja.
//
// El contorno es una lista de puntos; la pared i va del punto i al i+1 (la última, del último al primero si está
// cerrado). Cada pared tiene su medida real (`largo`, la que se midió) o null si no se midió. El dibujo es un
// borrador: «Recalcular» deja cada pared con su medida, con la dirección que tiene en el dibujo.

export const VERSION_PLANO = 1;
// Alturas para la vista 3D cuando no se cargaron (cm).
export const ALTURA_PLANTA = 300;
export const ALTO_ABERTURA = { puerta: 210, porton: 350, ventana: 120 };
export const ANTEPECHO_VENTANA = 100;
export const GIROS = [0, 90, 180, 270];

export const planoVacio = () => ({
    v: VERSION_PLANO, puntos: [], cerrado: false, paredes: [], hueco: null, altura: null,
    interiores: [], aberturas: [], elementos: [], maquinas: [], habitaciones: [],
});

const finito = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const medida = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v));
export const nuevoId = () => Math.random().toString(36).slice(2, 9);
const giroValido = (g) => (GIROS.includes(Number(g)) ? Number(g) : 0);

export const cantParedes = (p) => (p.cerrado ? p.puntos.length : Math.max(0, p.puntos.length - 1));

// Lo que viene del servidor (o de una versión vieja) a la forma de ahora, sin romper si falta algo.
export function normalizarPlano(o) {
    const p = planoVacio();
    if (!o || typeof o !== 'object') return p;
    p.puntos = (Array.isArray(o.puntos) ? o.puntos : []).map(q => ({ x: finito(q?.x), y: finito(q?.y) }));
    p.cerrado = !!o.cerrado && p.puntos.length >= 3;
    const n = cantParedes(p);
    p.paredes = Array.from({ length: n }, (_, i) => ({ largo: medida(o.paredes?.[i]?.largo) }));
    p.hueco = o.hueco && p.cerrado ? { x: finito(o.hueco.x), y: finito(o.hueco.y) } : null;
    p.altura = medida(o.altura); // del piso al techo (cm); null = ALTURA_PLANTA (para la vista 3D)
    p.interiores = (Array.isArray(o.interiores) ? o.interiores : []).map(w => ({
        id: String(w?.id || nuevoId()), x1: finito(w?.x1), y1: finito(w?.y1), x2: finito(w?.x2), y2: finito(w?.y2), largo: medida(w?.largo),
    }));
    p.aberturas = (Array.isArray(o.aberturas) ? o.aberturas : [])
        // En una pared del contorno (`pared`: índice) o en una interior (`interior`: su id).
        .filter(a => (a?.interior != null ? p.interiores.some(w => w.id === String(a.interior))
            : Number.isInteger(a?.pared) && a.pared >= 0 && a.pared < n))
        .map(a => ({ id: String(a.id || nuevoId()), pared: a.interior != null ? null : a.pared, interior: a.interior != null ? String(a.interior) : null,
                     desde: Math.max(0, finito(a.desde)), ancho: medida(a.ancho) || 90,
                     // Portón y entrada son lo mismo (21/10): una «entrada» guardada se toma como portón.
                     tipo: a.tipo === 'entrada' ? 'porton' : ['puerta', 'porton', 'ventana'].includes(a.tipo) ? a.tipo : 'puerta',
                     // puerta: 0/1 bisagra al comienzo de la pared, abre adentro/afuera; 2/3 bisagra al final
                     lado: [0, 1, 2, 3].includes(a.lado) ? a.lado : 0,
                     // Para la vista 3D (cm; null = el de siempre: ALTO_ABERTURA, ANTEPECHO_VENTANA)
                     alto: medida(a.alto), antepecho: a.antepecho == null || a.antepecho === '' ? null : Math.max(0, finito(a.antepecho)) }));
    p.elementos = (Array.isArray(o.elementos) ? o.elementos : []).map(e => {
        const tipo = ['columna', 'escalera', 'ascensor', 'ambiente', 'otro', ...Object.keys(INSTALACIONES)].includes(e?.tipo) ? e.tipo : 'otro';
        const def = INSTALACIONES[tipo] || MEDIDAS_ELEMENTO[tipo];
        const el = {
            id: String(e?.id || nuevoId()), tipo,
            x: finito(e?.x), y: finito(e?.y), w: medida(e?.w) || def?.w || 30, h: medida(e?.h) || def?.h || 30, giro: giroValido(e?.giro),
            nombre: String(e?.nombre || '').slice(0, 60),
        };
        if (tipo === 'escalera') el.baja = !!e?.baja; // en la planta de arriba la misma escalera «baja»
        // Tablero: la térmica general, si es trifásico o monofásico y las máquinas que cuelgan de él.
        if (tipo === 'tablero') {
            el.termicaA = medida(e?.termicaA);
            el.fasesTablero = e?.fasesTablero === 'mono' ? 'mono' : 'tri';
            el.equipos = [...new Set((Array.isArray(e?.equipos) ? e.equipos : []).map(Number).filter(Number.isInteger))];
        }
        return el;
    });
    // Nombres de las habitaciones: un punto adentro de cada una (ver detectarHabitaciones).
    p.habitaciones = (Array.isArray(o.habitaciones) ? o.habitaciones : [])
        .map(h => ({ id: String(h?.id || nuevoId()), x: finito(h?.x), y: finito(h?.y), nombre: String(h?.nombre || '').slice(0, 60) }))
        .filter(h => h.nombre);
    p.maquinas = (Array.isArray(o.maquinas) ? o.maquinas : [])
        .filter(m => Number.isInteger(Number(m?.equipoId)))
        .map(m => ({ equipoId: Number(m.equipoId), x: finito(m.x), y: finito(m.y), giro: giroValido(m.giro) }));
    return p;
}

// ── Medidas básicas ─────────────────────────────────────────────────────────────────────────────────────────
export const distancia = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const extremosPared = (p, i) => [p.puntos[i], p.puntos[(i + 1) % p.puntos.length]];
export const largoDibujo = (p, i) => { const [a, b] = extremosPared(p, i); return distancia(a, b); };

// Área en m² (fórmula del cordón de zapato) y perímetro en cm.
export function areaM2(puntos) {
    let s = 0;
    for (let i = 0; i < puntos.length; i++) {
        const a = puntos[i], b = puntos[(i + 1) % puntos.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2 / 10000;
}
export const perimetro = (p) => Array.from({ length: cantParedes(p) }, (_, i) => largoDibujo(p, i)).reduce((a, b) => a + b, 0);

// Una dirección a menos de 3° de horizontal o vertical se toma recta: lo que se dibujó a mano "derecho".
const TOL_RECTO = 3 * Math.PI / 180;
function direccion(a, b) {
    let ang = Math.atan2(b.y - a.y, b.x - a.x);
    const recto = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ang - recto) < TOL_RECTO) ang = recto;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    // sin(π/2) da 6e-17: se limpia para que una pared recta quede recta de verdad
    return { ux: Math.abs(ux) < 1e-12 ? 0 : ux, uy: Math.abs(uy) < 1e-12 ? 0 : uy };
}

// ── Recalcular ──────────────────────────────────────────────────────────────────────────────────────────────
// Deja cada pared con su medida y la dirección del dibujo, a partir del primer punto (que no se mueve).
// Contorno cerrado: las medidas tienen que cerrar (volver al primer punto).
//   1. Las paredes sin medida se calculan para cerrar: con una sin medir por dirección (una horizontal y una
//      vertical en un local de ángulos rectos) queda justo. Si hay más, se reparte cambiando lo menos posible.
//   2. Lo que no cierra y es poco (hasta `tolerancia`) se reparte entre todas las paredes en proporción a lo que
//      avanzan en cada eje (regla del tránsito de los agrimensores): las paredes rectas siguen rectas.
//   3. Si no cierra por más, se dibuja igual y el hueco queda marcado (`hueco`): alguna medida está mal.
// resultado: { estado: 'ok' | 'calculadas' | 'ajustado' | 'no-cierra' | 'abierto' | 'vacio', calculadas: [i],
//              error: cm sin cerrar (o repartidos), errorX, errorY, tolerancia }
export function recalcular(plano, opciones = {}) {
    const p = normalizarPlano(plano);
    const n = cantParedes(p);
    if (!n) return { plano: p, resultado: { estado: 'vacio', calculadas: [], error: 0 } };
    const dirs = [], largos = [], medidas = [];
    for (let i = 0; i < n; i++) {
        const [a, b] = tramoPared(p, i); // con hueco, la última apunta al hueco (como se ve)
        dirs.push(direccion(a, b));
        medidas.push(p.paredes[i].largo);
        largos.push(p.paredes[i].largo ?? distancia(a, b));
    }
    const resultado = { estado: 'ok', calculadas: [], error: 0, errorX: 0, errorY: 0 };

    if (p.cerrado) {
        const per = largos.reduce((a, b) => a + b, 0);
        const tol = opciones.tolerancia ?? Math.max(5, per * 0.003);
        resultado.tolerancia = tol;
        const resto = () => {
            let rx = 0, ry = 0;
            for (let i = 0; i < n; i++) { rx += largos[i] * dirs[i].ux; ry += largos[i] * dirs[i].uy; }
            return { rx, ry };
        };
        let { rx, ry } = resto();

        // 1. Paredes sin medir: mínimo cambio relativo (pesos = largo del dibujo²) que cierre.
        const libres = medidas.map((m, i) => (m == null ? i : -1)).filter(i => i >= 0);
        if (libres.length && Math.hypot(rx, ry) <= 0.01) {
            resultado.calculadas = libres; // el dibujo ya cierra: quedan como están
            resultado.estado = 'calculadas';
        } else if (libres.length) {
            let a = 0, b = 0, c = 0; // M = Σ w·u·uᵀ = [[a, b], [b, c]]
            for (const i of libres) { const w = largos[i] ** 2 || 1; a += w * dirs[i].ux ** 2; b += w * dirs[i].ux * dirs[i].uy; c += w * dirs[i].uy ** 2; }
            const det = a * c - b * b;
            const nuevos = [...largos];
            if (Math.abs(det) > 1e-9 * Math.max(1, a * c)) {
                // λ = M⁻¹ · (−R); δi = w·uiᵀλ
                const lx = (c * -rx - b * -ry) / det, ly = (a * -ry - b * -rx) / det;
                for (const i of libres) { const w = largos[i] ** 2 || 1; nuevos[i] = largos[i] + w * (dirs[i].ux * lx + dirs[i].uy * ly); }
            } else {
                // Todas las libres van en la misma dirección: solo arreglan lo que no cierra en esa dirección.
                const u = dirs[libres[0]];
                const pr = rx * u.ux + ry * u.uy;
                const sw = libres.reduce((s, i) => s + (largos[i] ** 2 || 1) * (dirs[i].ux * u.ux + dirs[i].uy * u.uy) ** 2, 0);
                for (const i of libres) { const w = largos[i] ** 2 || 1; const s = dirs[i].ux * u.ux + dirs[i].uy * u.uy; nuevos[i] = largos[i] - w * s * pr / sw; }
            }
            if (libres.every(i => nuevos[i] >= 1)) {
                libres.forEach(i => { largos[i] = nuevos[i]; });
                resultado.calculadas = libres;
                ({ rx, ry } = resto());
                resultado.estado = 'calculadas';
            }
        }

        // 2. y 3. Lo que queda sin cerrar.
        const err = Math.hypot(rx, ry);
        resultado.errorX = rx; resultado.errorY = ry; resultado.error = err;
        if (err > 0.5) {
            if (err <= tol) {
                const vs = largos.map((L, i) => ({ x: L * dirs[i].ux, y: L * dirs[i].uy }));
                const sx = vs.reduce((s, v) => s + Math.abs(v.x), 0), sy = vs.reduce((s, v) => s + Math.abs(v.y), 0);
                for (const v of vs) { if (sx) v.x -= rx * Math.abs(v.x) / sx; if (sy) v.y -= ry * Math.abs(v.y) / sy; }
                const pts = [p.puntos[0]];
                for (let i = 0; i < n - 1; i++) pts.push({ x: pts[i].x + vs[i].x, y: pts[i].y + vs[i].y });
                p.puntos = pts.map(q => ({ x: redondear(q.x), y: redondear(q.y) }));
                p.hueco = null;
                resultado.estado = 'ajustado';
                return { plano: ajustarAberturasEInteriores(p), resultado };
            }
            resultado.estado = 'no-cierra';
        }
    } else {
        resultado.estado = 'abierto';
    }

    // Se recorre con las medidas desde el primer punto.
    const pts = [p.puntos[0]];
    for (let i = 0; i < n; i++) pts.push({ x: pts[i].x + largos[i] * dirs[i].ux, y: pts[i].y + largos[i] * dirs[i].uy });
    const fin = pts.pop(); // cerrado: tiene que ser el primero; abierto: es el último punto
    if (!p.cerrado) pts.push(fin);
    p.puntos = pts.map(q => ({ x: redondear(q.x), y: redondear(q.y) }));
    p.hueco = resultado.estado === 'no-cierra' ? { x: redondear(fin.x), y: redondear(fin.y) } : null;
    return { plano: ajustarAberturasEInteriores(p), resultado };
}

const redondear = (v) => Math.round(v * 10) / 10;

// Paredes interiores: quedan con su medida desde su primer punto. Puertas: no se salen de su pared.
function ajustarAberturasEInteriores(p) {
    p.interiores = p.interiores.map(w => {
        if (w.largo == null) return w;
        const d = direccion({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
        return { ...w, x2: redondear(w.x1 + w.largo * d.ux), y2: redondear(w.y1 + w.largo * d.uy) };
    });
    p.aberturas = p.aberturas.map(a => {
        const L = largoSoporte(p, a);
        const ancho = Math.min(a.ancho, L);
        return { ...a, ancho, desde: Math.min(Math.max(0, a.desde), Math.max(0, L - ancho)) };
    });
    return p;
}

// Largo de una pared tal como se dibuja (con hueco, la última va hasta el hueco).
export function largoPared(p, i) {
    const [a, b] = tramoPared(p, i);
    return distancia(a, b);
}
export function tramoPared(p, i) {
    const n = cantParedes(p);
    const [a, b] = extremosPared(p, i);
    return p.cerrado && p.hueco && i === n - 1 ? [a, p.hueco] : [a, b];
}

// La pared donde va una abertura: del contorno o interior. [inicio, fin], o null si ya no existe.
export function soporteAbertura(p, ab) {
    if (ab.interior != null) {
        const w = p.interiores.find(x => x.id === ab.interior);
        return w ? [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }] : null;
    }
    return ab.pared != null && ab.pared < cantParedes(p) ? tramoPared(p, ab.pared) : null;
}
export const largoSoporte = (p, ab) => { const s = soporteAbertura(p, ab); return s ? distancia(s[0], s[1]) : 0; };

// Una puerta en su pared: de dónde a dónde va y la dirección de la pared.
export function tramoAbertura(p, ab) {
    const [a, b] = soporteAbertura(p, ab) || [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const L = distancia(a, b) || 1;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    return { x1: a.x + ux * ab.desde, y1: a.y + uy * ab.desde, x2: a.x + ux * (ab.desde + ab.ancho), y2: a.y + uy * (ab.desde + ab.ancho), ux, uy };
}

// ── Editar el contorno ──────────────────────────────────────────────────────────────────────────────────────
// Partir la pared i en dos (punto en el medio): las dos mitades quedan sin medida; las puertas siguen en la mitad
// donde caen.
export function partirPared(plano, i) {
    const p = normalizarPlano(plano);
    const [a, b] = extremosPared(p, i);
    const L = distancia(a, b);
    const medio = { x: redondear((a.x + b.x) / 2), y: redondear((a.y + b.y) / 2) };
    p.puntos.splice(i + 1, 0, medio);
    p.paredes.splice(i, 1, { largo: null }, { largo: null });
    p.aberturas = p.aberturas.map(ab => {
        if (ab.interior != null || ab.pared < i) return ab;
        if (ab.pared > i) return { ...ab, pared: ab.pared + 1 };
        return ab.desde >= L / 2 ? { ...ab, pared: i + 1, desde: ab.desde - L / 2 } : ab;
    });
    p.hueco = null;
    return p;
}

// Sacar el punto i: las dos paredes que llegan a él quedan en una, sin medida. Las puertas de esas dos se pierden.
export function borrarPunto(plano, i) {
    const p = normalizarPlano(plano);
    const N = p.puntos.length;
    if (i < 0 || i >= N) return p;
    // Para cada pared nueva, de qué paredes viejas sale (dos = se fusionaron y queda sin medida).
    let puntos, origen, cerrado = p.cerrado;
    if (p.cerrado && N > 3) {
        if (i === 0) {
            puntos = p.puntos.slice(1);
            origen = [...Array.from({ length: N - 2 }, (_, j) => [j + 1]), [N - 1, 0]];
        } else {
            puntos = p.puntos.filter((_, j) => j !== i);
            origen = Array.from({ length: N - 1 }, (_, j) => (j < i - 1 ? [j] : j === i - 1 ? [i - 1, i] : [j + 1]));
        }
    } else if (p.cerrado) {
        // Triángulo: queda una pared suelta, la que unía los otros dos puntos.
        cerrado = false;
        puntos = [p.puntos[(i + 1) % 3], p.puntos[(i + 2) % 3]];
        origen = [[(i + 1) % 3]];
    } else if (N <= 2) {
        return { ...planoVacio(), interiores: p.interiores, elementos: p.elementos, maquinas: p.maquinas };
    } else {
        puntos = p.puntos.filter((_, j) => j !== i);
        origen = i === 0 ? Array.from({ length: N - 2 }, (_, j) => [j + 1])
            : i === N - 1 ? Array.from({ length: N - 2 }, (_, j) => [j])
            : Array.from({ length: N - 2 }, (_, j) => (j < i - 1 ? [j] : j === i - 1 ? [i - 1, i] : [j + 1]));
    }
    const nueva = new Map(); // pared vieja → nueva, solo las que siguen enteras
    origen.forEach((o, j) => { if (o.length === 1) nueva.set(o[0], j); });
    return {
        ...p, puntos, cerrado, hueco: null,
        paredes: origen.map(o => (o.length === 1 ? p.paredes[o[0]] : { largo: null })),
        aberturas: p.aberturas.filter(ab => ab.interior != null || nueva.has(ab.pared))
            .map(ab => (ab.interior != null ? ab : { ...ab, pared: nueva.get(ab.pared) })),
    };
}

// ── Instalaciones (21/10) ───────────────────────────────────────────────────────────────────────────────────
// Van en `elementos` con su tipo. Las de pared (`pared`) se apoyan en la más cercana con el frente para adentro: el
// frente es el lado del ancho (`w`), abajo sin girar, como en las máquinas. `libre`: cm que tienen que quedar libres
// adelante (para abrir el tablero, sacar el matafuegos o salir). `obstaculo`: una máquina no puede ir encima.
export const INSTALACIONES = {
    tablero: { label: 'Tablero eléctrico', corto: 'Tablero', w: 60, h: 25, pared: true, obstaculo: true, libre: 100 },
    toma: { label: 'Toma trifásica', corto: 'Toma', w: 15, h: 10, pared: true, obstaculo: false, libre: 0 },
    compresor: { label: 'Compresor', corto: 'Compresor', w: 80, h: 60, pared: false, obstaculo: true, libre: 0 },
    extractor: { label: 'Extractor', corto: 'Extractor', w: 60, h: 60, pared: false, obstaculo: false, libre: 0 },
    matafuegos: { label: 'Matafuegos', corto: 'Matafuegos', w: 30, h: 20, pared: true, obstaculo: false, libre: 50 },
    salida: { label: 'Salida de emergencia', corto: 'Salida', w: 100, h: 15, pared: true, obstaculo: false, libre: 120 },
};
export const esInstalacion = (tipo) => Object.prototype.hasOwnProperty.call(INSTALACIONES, tipo);
// Medidas con que se ponen los elementos que no son instalaciones (cm). Ambiente: la oficina (zona con nombre y m²;
// las máquinas pueden ir adentro, no avisa).
export const MEDIDAS_ELEMENTO = { columna: { w: 30, h: 30 }, escalera: { w: 100, h: 300 }, ascensor: { w: 150, h: 150 }, ambiente: { w: 300, h: 250 }, otro: { w: 100, h: 100 } };
const OBSTACULOS = new Set(['columna', 'escalera', 'ascensor', 'otro', 'tablero', 'compresor']);
const ETIQUETAS = { columna: 'una columna', escalera: 'la escalera', ascensor: 'el ascensor', ambiente: 'la oficina', otro: 'otro elemento' };
export const etiquetaElemento = (e) => e.nombre || (esInstalacion(e.tipo) ? INSTALACIONES[e.tipo].label.toLowerCase() : ETIQUETAS[e.tipo]) || e.tipo;

// Hacia dónde mira el frente según el giro (eje y para abajo).
export const FRENTE = { 0: { x: 0, y: 1 }, 90: { x: -1, y: 0 }, 180: { x: 0, y: -1 }, 270: { x: 1, y: 0 } };
const giroDeFrente = (n) => (Math.abs(n.y) >= Math.abs(n.x) ? (n.y > 0 ? 0 : 180) : (n.x < 0 ? 90 : 270));

// Lo que tiene que quedar libre adelante de una instalación, o null.
export function zonaLibre(e) {
    const d = INSTALACIONES[e.tipo]?.libre;
    if (!d) return null;
    const c = caja(e, e.w, e.h);
    if (e.giro === 90) return { x1: c.x1 - d, y1: c.y1, x2: c.x1, y2: c.y2 };
    if (e.giro === 180) return { x1: c.x1, y1: c.y1 - d, x2: c.x2, y2: c.y1 };
    if (e.giro === 270) return { x1: c.x2, y1: c.y1, x2: c.x2 + d, y2: c.y2 };
    return { x1: c.x1, y1: c.y2, x2: c.x2, y2: c.y2 + d };
}

// Apoyar algo de `fondo` cm contra la pared más cercana a q (hasta `tol` cm), con el frente para adentro del local.
// Contorno: 15 cm de pared; interiores: 10, y el frente para el lado donde se tocó. null si no hay pared cerca.
export function apoyarEnPared(p, q, fondo, tol) {
    let mejor = null;
    const probar = (a, b, n, espesorPared) => {
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
        if (!L2) return;
        const t = Math.min(1, Math.max(0, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2));
        const x = a.x + t * dx, y = a.y + t * dy, d = Math.hypot(q.x - x, q.y - y);
        if (d <= tol && (!mejor || d < mejor.d)) mejor = { d, x, y, n, espesorPared };
    };
    let s = 0;
    for (let j = 0; j < p.puntos.length; j++) { const u = p.puntos[j], v = p.puntos[(j + 1) % p.puntos.length]; s += u.x * v.y - v.x * u.y; }
    for (let i = 0; i < cantParedes(p); i++) {
        const [a, b] = tramoPared(p, i);
        const L = distancia(a, b) || 1;
        const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
        // Adentro: la normal opuesta a la de afuera (con la suma del cordón positiva, afuera es (uy, −ux)).
        probar(a, b, s >= 0 ? { x: -uy, y: ux } : { x: uy, y: -ux }, 15);
    }
    for (const w of p.interiores) {
        const a = { x: w.x1, y: w.y1 }, b = { x: w.x2, y: w.y2 };
        const L = distancia(a, b) || 1;
        let n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
        if ((q.x - a.x) * n.x + (q.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
        probar(a, b, n, 10);
    }
    if (!mejor) return null;
    const giro = giroDeFrente(mejor.n);
    const f = FRENTE[giro];
    const r5 = (v) => Math.round(v / 5) * 5;
    // Sobre la pared se redondea a 5 cm; contra la pared, exacto (si no, se despega o la pisa).
    const sep = mejor.espesorPared / 2 + fondo / 2;
    const x = f.x ? mejor.x + f.x * sep : r5(mejor.x);
    const y = f.y ? mejor.y + f.y * sep : r5(mejor.y);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, giro };
}

// ── Máquinas en el plano ────────────────────────────────────────────────────────────────────────────────────
// Medidas de la ficha (en mm) a cm. largo = frente (va en x sin girar), ancho = profundidad.
export function medidasMaquina(ficha = {}) {
    const dim = ficha.dim || {};
    const n = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : null; };
    const largo = n(dim.largo), ancho = n(dim.ancho);
    return {
        w: largo ? largo / 10 : 100, h: ancho ? ancho / 10 : 100,
        sinMedidas: !largo || !ancho,
        servicio: n(dim.espacioServicio) ? n(dim.espacioServicio) / 10 : 0,
        peso: n(dim.peso),
        alto: n(dim.alto) ? n(dim.alto) / 10 : 100, sinAlto: !n(dim.alto), // para la vista 3D
    };
}

// Caja de una máquina o elemento (x, y = centro; giro múltiplo de 90°).
export function caja({ x, y, giro = 0 }, w, h, margen = 0) {
    const [ww, hh] = giro % 180 === 0 ? [w, h] : [h, w];
    return { x1: x - ww / 2 - margen, y1: y - hh / 2 - margen, x2: x + ww / 2 + margen, y2: y + hh / 2 + margen };
}
const seSolapan = (a, b, tol = 0.5) => a.x1 < b.x2 - tol && b.x1 < a.x2 - tol && a.y1 < b.y2 - tol && b.y1 < a.y2 - tol;

export function puntoEnPoligono(q, puntos) {
    let dentro = false;
    for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
        const a = puntos[i], b = puntos[j];
        if ((a.y > q.y) !== (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) dentro = !dentro;
    }
    return dentro;
}
const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
// ¿El segmento ab cruza el interior de la caja? (tocar el borde no cuenta)
export function segmentoCruzaCaja(a, b, k, tol = 0.5) {
    const c = { x1: k.x1 + tol, y1: k.y1 + tol, x2: k.x2 - tol, y2: k.y2 - tol };
    if (c.x1 >= c.x2 || c.y1 >= c.y2) return false;
    const dentro = (q) => q.x > c.x1 && q.x < c.x2 && q.y > c.y1 && q.y < c.y2;
    if (dentro(a) || dentro(b)) return true;
    const esq = [{ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x1, y: c.y2 }];
    for (let i = 0; i < 4; i++) {
        const p1 = esq[i], p2 = esq[(i + 1) % 4];
        const d1 = orient(a, b, p1), d2 = orient(a, b, p2), d3 = orient(p1, p2, a), d4 = orient(p1, p2, b);
        if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
    return false;
}

// Avisos de cada máquina ubicada: queda afuera o pisa una pared, se pisa con otra máquina o con una columna o
// escalera, no le queda el espacio de servicio, o pesa más de lo que aguanta el piso.
// medidas: { [equipoId]: medidasMaquina(...) }; nombres: { [equipoId]: 'DTF-1' }.
export function revisarMaquinas(plano, medidas, { cargaMaxKgM2 = null, nombres = {} } = {}) {
    const p = plano;
    const avisos = {};
    const cajas = p.maquinas.map(m => {
        const md = medidas[m.equipoId] || { w: 100, h: 100, servicio: 0 };
        return { m, md, k: caja(m, md.w, md.h), ks: caja(m, md.w, md.h, md.servicio) };
    });
    const obst = p.elementos.filter(e => OBSTACULOS.has(e.tipo)).map(e => ({ e, k: caja(e, e.w, e.h) }));
    const zonas = p.elementos.map(e => ({ e, k: zonaLibre(e) })).filter(z => z.k);
    const paredes = [];
    for (let i = 0; i < cantParedes(p); i++) paredes.push(tramoPared(p, i));
    for (const w of p.interiores) paredes.push([{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]);
    const nombre = (id) => nombres[id] || `máquina ${id}`;

    for (const { m, md, k, ks } of cajas) {
        const lista = [];
        const esquinas = [{ x: k.x1, y: k.y1 }, { x: k.x2, y: k.y1 }, { x: k.x2, y: k.y2 }, { x: k.x1, y: k.y2 }];
        const afuera = p.cerrado && p.puntos.length >= 3 && esquinas.some(q => !puntoEnPoligono(q, p.puntos));
        if (afuera || paredes.some(([a, b]) => segmentoCruzaCaja(a, b, k))) lista.push({ tipo: 'pared', texto: 'Pisa una pared o queda afuera' });
        for (const o of cajas) if (o.m !== m && seSolapan(k, o.k)) lista.push({ tipo: 'maquina', texto: `Se pisa con ${nombre(o.m.equipoId)}` });
        for (const o of obst) if (seSolapan(k, o.k)) lista.push({ tipo: 'elemento', texto: `Se pisa con ${etiquetaElemento(o.e)}` });
        for (const z of zonas) if (seSolapan(k, z.k)) lista.push({ tipo: 'acceso', texto: `Tapa el paso a ${etiquetaElemento(z.e)} (${Math.round(INSTALACIONES[z.e.tipo].libre)} cm libres adelante)` });
        if (md.servicio > 0 && !lista.length) {
            const sinLugar = cajas.some(o => o.m !== m && seSolapan(ks, o.k)) || obst.some(o => seSolapan(ks, o.k))
                || paredes.some(([a, b]) => segmentoCruzaCaja(a, b, ks))
                || (p.cerrado && p.puntos.length >= 3 && [{ x: ks.x1, y: ks.y1 }, { x: ks.x2, y: ks.y1 }, { x: ks.x2, y: ks.y2 }, { x: ks.x1, y: ks.y2 }].some(q => !puntoEnPoligono(q, p.puntos)));
            if (sinLugar) lista.push({ tipo: 'servicio', texto: `No le quedan los ${Math.round(md.servicio)} cm libres para servicio` });
        }
        if (cargaMaxKgM2 && md.peso && !md.sinMedidas) {
            const kgm2 = md.peso / (md.w * md.h / 10000);
            if (kgm2 > cargaMaxKgM2) lista.push({ tipo: 'carga', texto: `Carga ${Math.round(kgm2)} kg/m² y el piso aguanta ${Math.round(cargaMaxKgM2)}` });
        }
        if (lista.length) avisos[m.equipoId] = lista;
    }
    return avisos;
}

// Un lugar para una máquina nueva: el más cerca de `cerca` (el centro de lo que se ve) donde entra sin pisar paredes,
// otras máquinas ni columnas, y si se puede, con su espacio de servicio. Sin contorno cerrado, `cerca`.
export function lugarLibre(plano, medidas, equipoId, cerca) {
    const md = medidas[equipoId] || { w: 100, h: 100, servicio: 0 };
    if (!plano.cerrado || plano.puntos.length < 3) return { x: Math.round(cerca.x / 5) * 5, y: Math.round(cerca.y / 5) * 5, giro: 0 };
    const b = limitesPlano([{ ...plano, maquinas: [] }]);
    const paso = Math.max(10, Math.round(Math.min(md.w, md.h) / 4 / 5) * 5);
    const candidatos = [];
    for (let y = b.y1; y <= b.y2; y += paso) for (let x = b.x1; x <= b.x2; x += paso) candidatos.push({ x: Math.round(x / 5) * 5, y: Math.round(y / 5) * 5 });
    candidatos.sort((a, c) => distancia(a, cerca) - distancia(c, cerca));
    const otras = plano.maquinas.filter(m => m.equipoId !== equipoId);
    // Tampoco puede empeorar a las que ya están (por ejemplo, meterse en su espacio de servicio).
    const antes = revisarMaquinas({ ...plano, maquinas: otras }, medidas);
    const empeora = (av) => otras.some(m => (av[m.equipoId]?.length || 0) > (antes[m.equipoId]?.length || 0));
    let sinServicio = null;
    for (const giro of [0, 90]) {
        for (const q of candidatos) {
            const prueba = { ...plano, maquinas: [...otras, { equipoId, x: q.x, y: q.y, giro }] };
            const todos = revisarMaquinas(prueba, medidas);
            const av = todos[equipoId] || [];
            if (empeora(todos)) continue;
            if (!av.length) return { ...q, giro };
            if (!sinServicio && av.every(a => a.tipo === 'servicio')) sinServicio = { ...q, giro };
        }
        if (sinServicio) return sinServicio;
    }
    return { x: Math.round(cerca.x / 5) * 5, y: Math.round(cerca.y / 5) * 5, giro: 0 };
}

// ── Habitaciones (21/10) ────────────────────────────────────────────────────────────────────────────────────
// Las paredes interiores que se juntan con el contorno (o entre ellas, por ejemplo 4 interiores sueltas) dividen el
// local en habitaciones. Se arman con la geometría: todas las paredes como segmentos, cortados donde se cruzan o donde
// una termina sobre otra, y se recorren las caras del dibujo. Las puntas de las interiores que quedan a menos de `tol`
// cm de otra pared se toman como pegadas (dibujadas a mano no llegan justo). Los nombres se guardan con un punto
// (`habitaciones: [{ id, x, y, nombre }]`): la habitación que lo contiene lleva ese nombre aunque se muevan las paredes.
function proyectar(q, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2)) : 0;
    const x = a.x + t * dx, y = a.y + t * dy;
    return { x, y, t, d: Math.hypot(q.x - x, q.y - y) };
}
function cruce(a, b, c, d) {
    const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
    const eps = 1e-6;
    return t < -eps || t > 1 + eps || u < -eps || u > 1 + eps ? null : { t, u };
}
const area2 = (pol) => pol.reduce((s, v, i) => { const w = pol[(i + 1) % pol.length]; return s + v.x * w.y - w.x * v.y; }, 0);
// Colores suaves para distinguir las habitaciones (plano y vista 3D).
export const COLORES_HABITACION = ['#e0f2fe', '#fef3c7', '#dcfce7', '#fae8ff', '#ffe4e6', '#e0e7ff'];
export const dentroDeHabitacion = (q, h) => puntoEnPoligono(q, h.poligono) && !h.huecos.some(x => puntoEnPoligono(q, x));

// Dónde poner el nombre: el centro si cae adentro y lejos de las paredes; si no (una L), el punto más alejado de las
// paredes entre una grilla de prueba.
function puntoEtiqueta(pol, huecos) {
    const bordes = [pol, ...huecos];
    const distBorde = (q) => Math.min(...bordes.flatMap(b => b.map((v, i) => proyectar(q, v, b[(i + 1) % b.length]).d)));
    const dentro = (q) => puntoEnPoligono(q, pol) && !huecos.some(x => puntoEnPoligono(q, x));
    const A = area2(pol);
    let cx = 0, cy = 0;
    pol.forEach((v, i) => { const w = pol[(i + 1) % pol.length], f = v.x * w.y - w.x * v.y; cx += (v.x + w.x) * f; cy += (v.y + w.y) * f; });
    const c = A ? { x: cx / (3 * A), y: cy / (3 * A) } : pol[0];
    if (dentro(c) && distBorde(c) >= 60) return { x: Math.round(c.x), y: Math.round(c.y) };
    const xs = pol.map(v => v.x), ys = pol.map(v => v.y);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    let mejor = dentro(c) ? { q: c, d: distBorde(c) } : null;
    const N = 24;
    for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
        const q = { x: x1 + (x2 - x1) * i / N, y: y1 + (y2 - y1) * j / N };
        if (!dentro(q)) continue;
        const d = distBorde(q);
        if (!mejor || d > mejor.d) mejor = { q, d };
    }
    const q = mejor ? mejor.q : pol[0];
    return { x: Math.round(q.x), y: Math.round(q.y) };
}

export function detectarHabitaciones(p, { tol = 20, minM2 = 0.5 } = {}) {
    if (!p.interiores.length) return [];
    const segs = [];
    for (let i = 0; i < cantParedes(p); i++) { const [a, b] = tramoPared(p, i); segs.push({ a: { ...a }, b: { ...b }, fija: true }); }
    for (const w of p.interiores) segs.push({ a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 }, fija: false });
    const lista = segs.filter(s => distancia(s.a, s.b) > 0.5);

    // 1. Las puntas de las interiores cerca de otra pared se pegan: primero a una punta, si no, sobre la pared. Dos
    //    interiores que se juntan van las dos a la esquina donde se cruzan sus líneas (no a la punta de una).
    const esquina = (s, t) => {
        const r = { x: s.b.x - s.a.x, y: s.b.y - s.a.y }, u = { x: t.b.x - t.a.x, y: t.b.y - t.a.y };
        const den = r.x * u.y - r.y * u.x;
        if (Math.abs(den) < 1e-9 * Math.hypot(r.x, r.y) * Math.hypot(u.x, u.y)) return null;
        const k = ((t.a.x - s.a.x) * u.y - (t.a.y - s.a.y) * u.x) / den;
        return { x: s.a.x + k * r.x, y: s.a.y + k * r.y };
    };
    for (const s of lista) {
        if (s.fija) continue;
        for (const k of ['a', 'b']) {
            const q = s[k];
            let mejor = null;
            for (const t of lista) {
                if (t === s) continue;
                for (const ke of ['a', 'b']) {
                    const e = t[ke];
                    const d = distancia(q, e);
                    if (d > tol || (mejor && d >= mejor.d)) continue;
                    const c = !t.fija && esquina(s, t);
                    mejor = c && distancia(c, q) <= tol * 1.5 && distancia(c, e) <= tol * 1.5
                        ? { d, x: c.x, y: c.y, otra: t, ke } : { d, x: e.x, y: e.y };
                }
            }
            if (mejor?.otra) mejor.otra[mejor.ke] = { x: mejor.x, y: mejor.y };
            if (!mejor) {
                for (const t of lista) {
                    if (t === s) continue;
                    const pr = proyectar(q, t.a, t.b);
                    if (pr.d <= tol && (!mejor || pr.d < mejor.d)) mejor = pr;
                }
            }
            if (mejor) s[k] = { x: mejor.x, y: mejor.y };
        }
    }

    // 2. Cortes: donde se cruzan dos paredes o donde una termina sobre otra.
    const cortes = lista.map(() => [0, 1]);
    for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
            const c = cruce(lista[i].a, lista[i].b, lista[j].a, lista[j].b);
            if (c) { cortes[i].push(c.t); cortes[j].push(c.u); }
            for (const [x, y] of [[i, j], [j, i]]) {
                for (const e of [lista[x].a, lista[x].b]) { const pr = proyectar(e, lista[y].a, lista[y].b); if (pr.d < 0.5) cortes[y].push(pr.t); }
            }
        }
    }

    // 3. Nodos (puntos a menos de 1 cm son el mismo) y aristas.
    const nodos = [];
    const idNodo = (q) => {
        for (let k = 0; k < nodos.length; k++) if (Math.hypot(nodos[k].x - q.x, nodos[k].y - q.y) < 1) return k;
        nodos.push({ x: q.x, y: q.y });
        return nodos.length - 1;
    };
    const vecinos = new Map();
    const unir = (u, v) => {
        if (!vecinos.has(u)) vecinos.set(u, new Set());
        if (!vecinos.has(v)) vecinos.set(v, new Set());
        vecinos.get(u).add(v); vecinos.get(v).add(u);
    };
    lista.forEach((s, i) => {
        const ts = [...new Set(cortes[i].map(t => Math.round(Math.min(1, Math.max(0, t)) * 1e6) / 1e6))].sort((x, y) => x - y);
        for (let k = 0; k + 1 < ts.length; k++) {
            const en = (t) => ({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t });
            const u = idNodo(en(ts[k])), v = idNodo(en(ts[k + 1]));
            if (u !== v) unir(u, v);
        }
    });

    // 4. Sin las paredes sueltas (una punta que no se junta con nada no cierra nada).
    for (let cambio = true; cambio;) {
        cambio = false;
        for (const [n, vs] of [...vecinos]) {
            if (vs.size > 1) continue;
            for (const m of vs) vecinos.get(m)?.delete(n);
            vecinos.delete(n);
            cambio = true;
        }
    }

    // 5. Caras: cada arista se recorre en los dos sentidos doblando siempre hacia el mismo lado. Con el eje y para
    //    abajo, las caras cerradas quedan con la suma del cordón positiva y el borde de afuera de cada grupo, negativa.
    const ang = (u, v) => Math.atan2(nodos[v].y - nodos[u].y, nodos[v].x - nodos[u].x);
    const orden = new Map([...vecinos].map(([n, vs]) => [n, [...vs].sort((a, b) => ang(n, a) - ang(n, b))]));
    const usadas = new Set();
    const caras = [];
    for (const [u, vs] of orden) {
        for (const v of vs) {
            if (usadas.has(`${u}>${v}`)) continue;
            const cara = [];
            let a = u, b = v;
            for (let g = 0; !usadas.has(`${a}>${b}`) && g < 10000; g++) {
                usadas.add(`${a}>${b}`);
                cara.push(nodos[a]);
                const l = orden.get(b);
                const c = l[(l.indexOf(a) - 1 + l.length) % l.length];
                a = b; b = c;
            }
            if (cara.length >= 3) caras.push(cara);
        }
    }
    const habs = caras.filter(c => area2(c) / 2 / 10000 >= minM2).map(c => ({ poligono: c, huecos: [] }));
    // 6. El borde de afuera de un grupo de paredes suelto (4 interiores en el medio) es un hueco de la cara que lo tiene.
    for (const c of caras.filter(x => area2(x) < 0)) {
        const q = c[0];
        const tiene = habs.filter(h => !h.poligono.some(v => distancia(v, q) < 1) && puntoEnPoligono(q, h.poligono))
            .sort((x, y) => area2(x.poligono) - area2(y.poligono))[0];
        if (tiene) tiene.huecos.push(c);
    }
    const res = habs.map(h => ({ ...h, areaM2: (area2(h.poligono) - h.huecos.reduce((s, x) => s + Math.abs(area2(x)), 0)) / 2 / 10000 }))
        .filter(h => h.areaM2 >= minM2);
    // Si las interiores no dividen nada (queda una sola cara: el local entero), no hay habitaciones.
    if (res.length === 1 && p.cerrado && !p.hueco && Math.abs(res[0].areaM2 - areaM2(p.puntos)) < 0.05) return [];

    // 7. Dónde va el nombre y cuál es (por los puntos guardados).
    return res.map(h => {
        const etiqueta = puntoEtiqueta(h.poligono, h.huecos);
        const ancla = (p.habitaciones || []).find(a => dentroDeHabitacion(a, h));
        return { ...h, etiqueta, nombre: ancla?.nombre || '', anclaId: ancla?.id || null };
    });
}

// Superficie que ocupan las máquinas ubicadas (m²).
export const ocupadoM2 = (plano, medidas) => plano.maquinas.reduce((s, m) => {
    const md = medidas[m.equipoId]; return s + (md ? md.w * md.h / 10000 : 0);
}, 0);

// Límites de todo lo dibujado (para encuadrar).
export function limitesPlano(planos) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const sumar = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    for (const p of planos.filter(Boolean)) {
        p.puntos.forEach(q => sumar(q.x, q.y));
        if (p.hueco) sumar(p.hueco.x, p.hueco.y);
        p.interiores.forEach(w => { sumar(w.x1, w.y1); sumar(w.x2, w.y2); });
        p.elementos.forEach(e => { sumar(e.x - e.w / 2, e.y - e.h / 2); sumar(e.x + e.w / 2, e.y + e.h / 2); });
        p.maquinas.forEach(m => sumar(m.x, m.y));
    }
    return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null;
}

// Metros con coma: 1234.5 cm → "12,35 m".
export const fmtM = (cm, dec = 2) => (cm == null || !Number.isFinite(cm) ? '—'
    : `${(cm / 100).toLocaleString('es-UY', { minimumFractionDigits: dec, maximumFractionDigits: dec })} m`);
// "12,35" / "12.35" / "12,35 m" / "1235 cm" → cm. Vacío → null; inválido → NaN.
export function leerMetros(txt) {
    const s = String(txt ?? '').trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    const cm = /cm$/.test(s);
    const n = Number(s.replace(/(cm|m)$/, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return NaN;
    return cm ? n : n * 100;
}
