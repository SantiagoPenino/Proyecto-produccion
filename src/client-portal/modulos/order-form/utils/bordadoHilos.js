import { contours } from 'd3-contour';

// [BORDADO] Carta de hilos y cálculo de puntadas.
//
// Basado en cómo trabajan los sistemas de digitalización (Wilcom y compañía):
//
//  · Todo bordado se digitaliza con TRES puntadas: pespunte (run), satén (satin)
//    y relleno (tatami). El resto son variantes.
//  · Las puntadas se estiman por ÁREA y DENSIDAD, no por complejidad a ojo:
//    relleno ~1.250-1.500 por pulgada², satén ~800-1.200, pespunte ~200-400.
//  · Cada color es una PARADA de máquina: el orden importa para el operario.
//
// La carta de abajo es la carta INTERNA de USER, no la de una marca. Si en algún
// momento se quiere trabajar con la carta real (Madeira Classic 40, Isacord 40),
// se reemplaza este array por la importación de su archivo .TCH y el resto del
// código sigue igual: solo necesita {codigo, nombre, hex}.

export const CARTA_HILOS = [
    { codigo: 'USR-1001', nombre: 'Blanco',            hex: '#FFFFFF' },
    { codigo: 'USR-1002', nombre: 'Crudo',             hex: '#F2E8D5' },
    { codigo: 'USR-1010', nombre: 'Gris Perla',        hex: '#C9CCD1' },
    { codigo: 'USR-1015', nombre: 'Gris Acero',        hex: '#7A7F87' },
    { codigo: 'USR-1020', nombre: 'Negro',             hex: '#111111' },
    { codigo: 'USR-2001', nombre: 'Rojo Fuego',        hex: '#D81E28' },
    { codigo: 'USR-2005', nombre: 'Bordó',             hex: '#7B1420' },
    { codigo: 'USR-2010', nombre: 'Naranja',           hex: '#F26522' },
    { codigo: 'USR-2015', nombre: 'Coral',             hex: '#F2726F' },
    { codigo: 'USR-3001', nombre: 'Amarillo Oro',      hex: '#F2C200' },
    { codigo: 'USR-3005', nombre: 'Mostaza',           hex: '#C79A18' },
    { codigo: 'USR-4001', nombre: 'Verde Manzana',     hex: '#7AC143' },
    { codigo: 'USR-4005', nombre: 'Verde Bandera',     hex: '#128A3E' },
    { codigo: 'USR-4010', nombre: 'Verde Botella',     hex: '#0B4A2F' },
    { codigo: 'USR-5001', nombre: 'Celeste',           hex: '#57C3E8' },
    { codigo: 'USR-5005', nombre: 'Azul Francia',      hex: '#1B6ACB' },
    { codigo: 'USR-5010', nombre: 'Azul Marino',       hex: '#12275B' },
    { codigo: 'USR-5015', nombre: 'Turquesa',          hex: '#00A99D' },
    { codigo: 'USR-6001', nombre: 'Violeta',           hex: '#6B3FA0' },
    { codigo: 'USR-6005', nombre: 'Fucsia',            hex: '#D6248C' },
    { codigo: 'USR-6010', nombre: 'Rosa',              hex: '#F4A6C0' },
    { codigo: 'USR-7001', nombre: 'Beige',             hex: '#D8C3A5' },
    { codigo: 'USR-7005', nombre: 'Marrón',            hex: '#6B4423' },
    { codigo: 'USR-7010', nombre: 'Camel',             hex: '#A9762F' },
];

// Las tres puntadas reales + dos casos que el taller igual necesita distinguir.
// `densidad` = puntadas por pulgada² (rango de la industria, tomado al medio).
export const TIPOS_PUNTADA = [
    { id: 'TATAMI',   nombre: 'Relleno (tatami)', densidad: 1400, ayuda: 'Para superficies grandes. Es el que más hilo lleva.' },
    { id: 'SATEN',    nombre: 'Satén',            densidad: 1000, ayuda: 'Brillante. Para letras, bordes y detalles finos.' },
    { id: 'PESPUNTE', nombre: 'Pespunte (run)',   densidad: 300,  ayuda: 'Una línea simple. Contornos y detalles sueltos.' },
    { id: 'ZIGZAG',   nombre: 'Zig-Zag',          densidad: 700,  ayuda: 'Contorno ancho, más liviano que el satén.' },
    // TAFETA = la pieza se resuelve con un recorte de tela y solo se borda el
    // contorno que lo sujeta. Por eso su densidad es la más baja de todas: es
    // exactamente lo que quiere decir "con tafeta" en el tipo de bordado del
    // pedido, y lo que hace que salga más barato que el 100% hilo.
    { id: 'TAFETA',   nombre: 'Tafeta (tela aplicada)', densidad: 250, ayuda: 'La tela cubre la superficie y solo se borda el contorno: lleva mucho menos hilo.' },
];

export const puntadaPorId = (id) => TIPOS_PUNTADA.find(t => t.id === id) || TIPOS_PUNTADA[1];

const CM2_POR_PULGADA2 = 6.4516;

// [RELIEVE 3D] El bordado sobre goma espuma no es el mismo trabajo con un recargo:
// la puntada de arriba es la que CORTA la goma, así que va mucho más cerrada —
// la industria sube la densidad entre 40% y 60% sobre lo normal. Se toma el medio.
// Y por eso mismo el relieve solo se puede hacer en SATÉN: es la única puntada que
// cubre y corta la goma limpio. Un relleno tatami no la corta y queda sucio.
export const FACTOR_RELIEVE = 1.5;
export const PUNTADA_RELIEVE = 'SATEN';

/** Puntadas de UNA pieza: su parte del área, a la densidad de su tipo de puntada. */
export function estimarPuntadas({ anchoCm, altoCm, cobertura, tipoPuntada, relieve = false }) {
    const a = parseFloat(anchoCm) || 0;
    const b = parseFloat(altoCm) || 0;
    if (a <= 0 || b <= 0) return 0;
    const pulgadas2 = (a * b * (cobertura || 0)) / CM2_POR_PULGADA2;
    const densidad = puntadaPorId(relieve ? PUNTADA_RELIEVE : tipoPuntada).densidad;
    return Math.round(pulgadas2 * densidad * (relieve ? FACTOR_RELIEVE : 1));
}

/** Minutos de máquina: puntadas a 600 ppm + 20 s por cambio de color. */
export function estimarMinutos(totalPuntadas, cantidadColores) {
    const PPM = 600;
    return (totalPuntadas / PPM) + (Math.max(0, cantidadColores - 1) * 20 / 60);
}

const dist = (a, b) =>
    Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

export const hexARgb = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

export const rgbAHex = (r, g, b) =>
    '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).padStart(6, '0');

/** El hilo de la carta más parecido a un color cualquiera. */
export function hiloMasCercano(hex) {
    const c = hexARgb(hex);
    let mejor = CARTA_HILOS[0], mejorD = Infinity;
    for (const h of CARTA_HILOS) {
        const d = dist(c, hexARgb(h.hex));
        if (d < mejorD) { mejorD = d; mejor = h; }
    }
    return mejor;
}

/**
 * Detecta los colores dominantes de la imagen y con qué proporción aparece cada
 * uno (sin contar lo transparente). Es la "reducción a N hilos" que hacen los
 * programas de digitalización antes de asignar puntadas.
 *
 * Cuantiza a una grilla de 32 niveles por canal para juntar los tonos que el
 * antialiasing genera alrededor de cada color real, y después fusiona los grupos
 * que quedaron demasiado parecidos entre sí.
 */
export function detectarColores(ctx, ancho, alto, maxColores = 6) {
    const { data } = ctx.getImageData(0, 0, ancho, alto);
    const cubos = new Map();
    let opacos = 0;

    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;   // transparente o casi
        opacos++;
        const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
        const c = cubos.get(k);
        if (c) { c.n++; c.r += data[i]; c.g += data[i + 1]; c.b += data[i + 2]; }
        else cubos.set(k, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    if (!opacos) return [];

    let grupos = [...cubos.values()]
        .map(c => ({ n: c.n, r: Math.round(c.r / c.n), g: Math.round(c.g / c.n), b: Math.round(c.b / c.n) }))
        .sort((a, b) => b.n - a.n);

    // Fusionar los que quedaron muy cerca: el degradé de un mismo color no son
    // dos hilos distintos, es uno solo.
    const finales = [];
    for (const g of grupos) {
        const cerca = finales.find(f => dist(f, g) < 48);
        if (cerca) {
            const total = cerca.n + g.n;
            cerca.r = Math.round((cerca.r * cerca.n + g.r * g.n) / total);
            cerca.g = Math.round((cerca.g * cerca.n + g.g * g.n) / total);
            cerca.b = Math.round((cerca.b * cerca.n + g.b * g.n) / total);
            cerca.n = total;
        } else if (finales.length < maxColores) {
            finales.push({ ...g });
        }
    }

    return finales.map(f => ({
        hex: rgbAHex(f.r, f.g, f.b),
        cobertura: f.n / opacos,
    }));
}

// =====================================================================
// QUITAR EL FONDO
// =====================================================================
/**
 * Borra el fondo del arte dejándolo transparente.
 *
 * Es un relleno por inundación DESDE LOS BORDES: toma el color de las cuatro
 * esquinas y va comiendo hacia adentro todo lo que se le parezca y esté pegado
 * al borde. Esa es la parte importante — solo borra lo que está CONECTADO al
 * borde, así que un logo con letras blancas adentro no pierde las letras aunque
 * el fondo también sea blanco.
 *
 * Devuelve cuántos píxeles borró, para poder avisar si no encontró fondo.
 */
export function quitarFondo(ctx, w, h, tolerancia = 42) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Color del fondo: el más repetido entre las cuatro esquinas.
    const esquinas = [0, (w - 1), (h - 1) * w, (h - 1) * w + (w - 1)];
    const votos = new Map();
    for (const n of esquinas) {
        const i = n * 4;
        if (d[i + 3] < 128) continue;         // ya es transparente
        const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
        votos.set(k, (votos.get(k) || 0) + 1);
    }
    if (!votos.size) return 0;                // las esquinas ya son transparentes
    const [mejorK] = [...votos.entries()].sort((a, b) => b[1] - a[1])[0];
    const [fr, fg, fb] = mejorK.split(',').map(Number);

    const tol2 = tolerancia * tolerancia;
    const parecido = (i) =>
        (d[i] - fr) ** 2 + (d[i + 1] - fg) ** 2 + (d[i + 2] - fb) ** 2 <= tol2;

    const visto = new Uint8Array(w * h);
    // Pila propia en vez de recursión: una imagen grande desborda el stack.
    const pila = [];
    const encolar = (n) => {
        if (n < 0 || n >= w * h || visto[n]) return;
        visto[n] = 1;
        const i = n * 4;
        if (d[i + 3] < 128 || parecido(i)) pila.push(n);
    };

    for (let x = 0; x < w; x++) { encolar(x); encolar((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { encolar(y * w); encolar(y * w + (w - 1)); }

    let borrados = 0;
    while (pila.length) {
        const n = pila.pop();
        const i = n * 4;
        if (d[i + 3] !== 0) { d[i + 3] = 0; borrados++; }
        const x = n % w, y = (n / w) | 0;
        if (x > 0)     encolar(n - 1);
        if (x < w - 1) encolar(n + 1);
        if (y > 0)     encolar(n - w);
        if (y < h - 1) encolar(n + w);
    }

    // ── Limpieza del halo ────────────────────────────────────────────────
    // El borde de cualquier dibujo viene MEZCLADO con el fondo (antialiasing).
    // Esos píxeles no se parecen al fondo lo suficiente para entrar en el
    // relleno de arriba, así que sobreviven y dejan un contorno fantasma
    // alrededor de todo. Se limpian aparte: dos vueltas comiendo los píxeles
    // que tocan lo transparente y todavía tiran al color del fondo, con una
    // tolerancia más ancha porque son justamente tonos intermedios.
    const tolHalo2 = (tolerancia * 2.2) ** 2;
    for (let vuelta = 0; vuelta < 2; vuelta++) {
        const aBorrar = [];
        for (let n = 0; n < w * h; n++) {
            const i = n * 4;
            if (d[i + 3] === 0) continue;
            const x = n % w, y = (n / w) | 0;
            const tocaVacio =
                (x > 0     && d[(n - 1) * 4 + 3] === 0) ||
                (x < w - 1 && d[(n + 1) * 4 + 3] === 0) ||
                (y > 0     && d[(n - w) * 4 + 3] === 0) ||
                (y < h - 1 && d[(n + w) * 4 + 3] === 0);
            if (!tocaVacio) continue;
            const dd = (d[i] - fr) ** 2 + (d[i + 1] - fg) ** 2 + (d[i + 2] - fb) ** 2;
            if (dd <= tolHalo2) aBorrar.push(n);
        }
        if (!aBorrar.length) break;
        for (const n of aBorrar) { d[n * 4 + 3] = 0; borrados++; }
    }

    ctx.putImageData(imgData, 0, 0);
    return borrados;
}

// =====================================================================
// GOMA Y BALDE (retoque manual)
// =====================================================================

/** Goma: deja transparente un círculo de radio `radio` centrado en (cx, cy). */
export function borrarPincel(ctx, w, h, cx, cy, radio) {
    const x0 = Math.max(0, Math.floor(cx - radio)), x1 = Math.min(w - 1, Math.ceil(cx + radio));
    const y0 = Math.max(0, Math.floor(cy - radio)), y1 = Math.min(h - 1, Math.ceil(cy + radio));
    if (x1 < x0 || y1 < y0) return;
    const imgData = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const d = imgData.data, ancho = x1 - x0 + 1;
    const r2 = radio * radio;
    for (let n = 0; n < d.length / 4; n++) {
        const x = x0 + (n % ancho), y = y0 + ((n / ancho) | 0);
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) d[n * 4 + 3] = 0;
    }
    ctx.putImageData(imgData, x0, y0);
}

/**
 * Balde: pinta la REGIÓN CERRADA donde se hizo click.
 *
 * Se expande desde el punto tocado por todos los píxeles vecinos de color
 * parecido, y frena solo donde el color cambia — o sea, contra el contorno. Por
 * eso pinta una raya de la abeja y no todas: cada raya es una región distinta,
 * aunque compartan el mismo color.
 *
 * Sirve igual para el contorno: si tocás la línea negra, se pinta esa línea.
 *
 * Devuelve cuántos píxeles pintó (0 = se tocó una zona vacía).
 */
export function pintarRegion(ctx, w, h, cx, cy, hexDestino, tolerancia = 60) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const inicio = (cy * w + cx) * 4;
    if (d[inicio + 3] < 128) return 0;          // zona transparente: no hay nada que pintar

    const or = d[inicio], og = d[inicio + 1], ob = d[inicio + 2];
    const dest = hexARgb(hexDestino);
    if (or === dest.r && og === dest.g && ob === dest.b) return 0;   // ya está de ese color

    const tol2 = tolerancia * tolerancia;
    const visto = new Uint8Array(w * h);
    const pila = [cy * w + cx];
    visto[cy * w + cx] = 1;
    let pintados = 0;

    const encolar = (n) => {
        if (n < 0 || n >= w * h || visto[n]) return;
        visto[n] = 1;
        const i = n * 4;
        if (d[i + 3] < 128) return;
        if ((d[i] - or) ** 2 + (d[i + 1] - og) ** 2 + (d[i + 2] - ob) ** 2 <= tol2) pila.push(n);
    };

    while (pila.length) {
        const n = pila.pop();
        const i = n * 4;
        d[i] = dest.r; d[i + 1] = dest.g; d[i + 2] = dest.b;
        pintados++;
        const x = n % w, y = (n / w) | 0;
        if (x > 0)     encolar(n - 1);
        if (x < w - 1) encolar(n + 1);
        if (y > 0)     encolar(n - w);
        if (y < h - 1) encolar(n + w);
    }

    ctx.putImageData(imgData, 0, 0);
    return pintados;
}

// =====================================================================
// VECTORIZAR
// =====================================================================
const areaAnillo = (anillo) => {
    // Fórmula del cordón (shoelace). El signo dice si es contorno o agujero.
    let s = 0;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
        s += (anillo[j][0] + anillo[i][0]) * (anillo[j][1] - anillo[i][1]);
    }
    return s / 2;
};

// Un anillo más chico que esto es ruido del trazado (un píxel suelto, un resto
// del antialiasing). Ni se cuenta como superficie ni se dibuja: si no, el arte
// queda lleno de contornos de manchitas que nadie va a bordar.
const AREA_MINIMA_PX = 24;

// El contorno que devuelve d3-contour va píxel por píxel y queda escalonado.
// Se tiran los puntos que están a menos de `paso` del anterior: el borde queda
// más limpio de dibujar y con muchos menos vértices.
const suavizarAnillo = (anillo, paso = 1.6) => {
    if (anillo.length < 8) return anillo;
    const paso2 = paso * paso;
    const salida = [anillo[0]];
    for (let i = 1; i < anillo.length - 1; i++) {
        const u = salida[salida.length - 1], v = anillo[i];
        if ((u[0] - v[0]) ** 2 + (u[1] - v[1]) ** 2 >= paso2) salida.push(v);
    }
    salida.push(anillo[anillo.length - 1]);
    return salida.length >= 4 ? salida : anillo;
};

/**
 * Convierte el mapa de píxeles en PIEZAS con contorno propio, una por color.
 *
 * Para cada color arma una máscara (1 donde ese color es el más parecido) y le
 * saca los contornos con d3-contour. Es lo que hace un programa de digitalizar
 * antes de generar puntadas: primero convierte el dibujo en objetos, después
 * decide cómo bordar cada objeto.
 *
 * Gana dos cosas sobre contar píxeles sueltos:
 *   · El área sale de la geometría, no de un conteo con bordes difusos → la
 *     estimación de puntadas se apoya en algo firme.
 *   · Quedan los contornos para dibujarlos sobre el arte.
 *
 * Devuelve, por color: { hex, anillos, areaPx, cobertura }.
 */
export function vectorizarPiezas(ctx, w, h, coloresHex) {
    if (!coloresHex.length) return [];
    const { data } = ctx.getImageData(0, 0, w, h);
    const refs = coloresHex.map(hexARgb);

    // A qué color pertenece cada píxel (-1 = transparente).
    const pertenece = new Int16Array(w * h).fill(-1);
    for (let n = 0; n < w * h; n++) {
        const i = n * 4;
        if (data[i + 3] < 128) continue;
        let mejor = -1, mejorD = Infinity;
        for (let k = 0; k < refs.length; k++) {
            const dd = (data[i] - refs[k].r) ** 2 + (data[i + 1] - refs[k].g) ** 2 + (data[i + 2] - refs[k].b) ** 2;
            if (dd < mejorD) { mejorD = dd; mejor = k; }
        }
        pertenece[n] = mejor;
    }

    const generador = contours().size([w, h]).thresholds([0.5]);
    const piezas = coloresHex.map((hex, k) => {
        const mascara = new Float64Array(w * h);
        for (let n = 0; n < w * h; n++) mascara[n] = pertenece[n] === k ? 1 : 0;

        const salida = generador(mascara);
        const poligonos = salida[0]?.coordinates || [];

        let area = 0;
        const anillos = [];
        for (const poligono of poligonos) {
            for (const anillo of poligono) {
                const a = areaAnillo(anillo);          // los agujeros vienen con signo opuesto
                if (Math.abs(a) < AREA_MINIMA_PX) continue;   // manchita: se descarta
                anillos.push(suavizarAnillo(anillo));
                area += a;
            }
        }
        return { hex, anillos, areaPx: Math.abs(area) };
    });

    const total = piezas.reduce((s, p) => s + p.areaPx, 0) || 1;
    return piezas.map(p => ({ ...p, cobertura: p.areaPx / total }));
}
