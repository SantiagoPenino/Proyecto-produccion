import { contours } from 'd3-contour';
import cartaHilos from './cartaHilosBordado.json';
import { apiClient } from '../../../api/apiClient';

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
// se reemplaza el JSON por la importación de su archivo .TCH y el resto del
// código sigue igual: solo necesita {codigo, nombre, hex}.
//
// La carta de verdad es el nomenclador de Configurar Productos › Hilos (dbo.CatalogoHilos),
// que también usa la matriz automática del servidor. Acá arranca con el JSON
// (cartaHilosBordado.json, la carga inicial y el respaldo si la tabla no está) y
// cargarCartaHilos() la reemplaza por la del nomenclador, en el MISMO arreglo: todo lo que
// usa CARTA_HILOS (hiloMasCercano, el editor de hilos) ve la nueva sin cambiar nada.
export const CARTA_HILOS = [...cartaHilos];

let cartaCargada = null;
/** Trae los hilos activos del nomenclador, una vez por sesión. Devuelve una promesa (true si los trajo). */
export function cargarCartaHilos() {
    if (!cartaCargada) {
        cartaCargada = apiClient.get('/web-orders/hilos-bordado')
            .then((r) => {
                const hilos = (r?.data || []).filter(h => h.codigo && h.nombre && /^#[0-9A-Fa-f]{6}$/.test(h.hex || ''));
                if (hilos.length) CARTA_HILOS.splice(0, CARTA_HILOS.length, ...hilos);
                return hilos.length > 0;
            })
            .catch((e) => {
                console.warn('[BORDADO] Sin el nomenclador de hilos, queda la carta de respaldo:', e?.message);
                cartaCargada = null;   // se reintenta la próxima vez
                return false;
            });
    }
    return cartaCargada;
}

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

// [RELIEVE 3D] APAGADO (20/10, pedido del usuario: por ahora no se usa). En false
// no se ofrece en ningún lado del pedido de bordado —ni la casilla de la tarjeta
// del diseño ni la del editor de hilos— y el pedido sale sin relieve. Todo lo de
// relieve sigue en el código: para volver a ofrecerlo alcanza con ponerlo en true.
export const RELIEVE_3D_HABILITADO = false;

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
/**
 * Color del fondo: el más repetido entre las cuatro esquinas, como [r, g, b].
 * null si las esquinas ya son transparentes.
 */
export function colorDelFondo(ctx, w, h) {
    const votos = new Map();
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        if (p[3] < 128) continue;             // ya es transparente
        const k = `${p[0]},${p[1]},${p[2]}`;
        votos.set(k, (votos.get(k) || 0) + 1);
    }
    if (!votos.size) return null;
    const [mejorK] = [...votos.entries()].sort((a, b) => b[1] - a[1])[0];
    return mejorK.split(',').map(Number);
}

export function quitarFondo(ctx, w, h, tolerancia = 42) {
    const fondo = colorDelFondo(ctx, w, h);
    if (!fondo) return 0;                     // las esquinas ya son transparentes
    const [fr, fg, fb] = fondo;

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

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
// RECORTE AL DIBUJO
// =====================================================================
// El ancho y el largo que carga el cliente son los del LOGO, no los de la
// imagen: un logo apaisado guardado en un PNG cuadrado con margen blanco tiene
// que medir como apaisado. Por eso lo que mide el arte (la proporción que ata
// ancho y largo, la vista a tamaño real y la resolución del editor) y el
// análisis automático trabajan sobre el dibujo, sin el margen.

/** Caja de los píxeles con dibujo (no transparentes) del lienzo, o null si quedó vacío. */
export function cajaDelDibujo(ctx, w, h) {
    const { data } = ctx.getImageData(0, 0, w, h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] < 128) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Blanco o casi: un JPG nunca trae el blanco puro.
const esPapel = (rgb) => !!rgb && rgb.every(v => v >= 215);

// Hay fondo de verdad cuando al menos 3 de las 4 esquinas son de ese color (o
// transparentes). Con un logo recortado justo, dos esquinas pueden ser de un
// color del dibujo, y "quitar el fondo" se comería parte del logo.
function fondoParejo(ctx, w, h, fondo) {
    const [r, g, b] = fondo;
    let parejas = 0;
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        if (p[3] < 128 || dist({ r: p[0], g: p[1], b: p[2] }, { r, g, b }) <= 42) parejas++;
    }
    return parejas >= 3;
}

/**
 * Dibuja una zona de la imagen en un lienzo de hasta `maxLado` px de lado y le
 * quita el fondo, salvo que no corresponda.
 *
 * Solo se quita si el fondo es parejo en las esquinas (ver fondoParejo). Y si
 * quitarlo se come casi todo (más del 92%), en general el arte no tenía fondo
 * liso —un logo a sangre, un parche de un color— y se deshace en vez de dejar el
 * lienzo vacío. La excepción es el fondo blanco: un logo chico en una hoja
 * blanca grande también pasa del 92%, y ahí lo que se borró es margen, no
 * dibujo. Antes eso se deshacía y el blanco quedaba como un hilo más, con casi
 * toda la cobertura.
 */
function lienzoSinFondo(img, zona, maxLado) {
    const escala = Math.min(1, maxLado / Math.max(zona.w, zona.h));
    const w = Math.max(1, Math.round(zona.w * escala));
    const h = Math.max(1, Math.round(zona.h * escala));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const pintar = () => ctx.drawImage(img, zona.x, zona.y, zona.w, zona.h, 0, 0, w, h);
    pintar();

    const fondo = colorDelFondo(ctx, w, h);
    if (fondo && !fondoParejo(ctx, w, h, fondo)) return { c, ctx, w, h, sinFondo: false };
    const borrados = quitarFondo(ctx, w, h);
    let sinFondo = borrados > 0;
    if (borrados / (w * h) > 0.92 && !(esPapel(fondo) && cajaDelDibujo(ctx, w, h))) {
        ctx.clearRect(0, 0, w, h);
        pintar();
        sinFondo = false;
    }
    return { c, ctx, w, h, sinFondo };
}

/**
 * Deja el arte listo para medirlo y analizarlo: sin fondo y recortado al dibujo
 * (con un poco de margen), en un lienzo de hasta `maxLado` px de lado.
 *
 * Va en dos pasadas. La primera, sobre la imagen entera, ubica el dibujo. La
 * segunda vuelve a dibujar SOLO esa zona, para que el logo aproveche toda la
 * resolución del lienzo y no solo la parte que ocupaba dentro de la imagen. A
 * esa zona se le deja un poco de margen: así sus esquinas siguen siendo fondo y
 * se puede quitar (recortado justo, un logo rectangular tiene sus esquinas en
 * el dibujo y el fondo se lo comería a él).
 *
 * El análisis y el editor trabajan los dos sobre `lienzoZona`, así los contornos
 * de las piezas y el prediseño quedan en las mismas coordenadas. El recorte
 * justo (`caja`, `proporcion`) es solo para medir.
 *
 * Devuelve, o null si la imagen está vacía:
 *   · proporcion  — ancho / largo del dibujo
 *   · caja        — el dibujo, en píxeles de la imagen original
 *   · zona        — el dibujo con su margen, en píxeles de la imagen original
 *   · lienzoZona  — la zona en el lienzo, sin fondo si correspondía quitarlo
 *   · sinFondo    — si se quitó el fondo
 */
export function prepararArte(img, maxLado = 420) {
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    if (!(W > 0 && H > 0)) return null;

    // 1ª pasada: dónde está el dibujo dentro de la imagen.
    const a = lienzoSinFondo(img, { x: 0, y: 0, w: W, h: H }, maxLado);
    const ca = cajaDelDibujo(a.ctx, a.w, a.h);
    if (!ca) return null;
    const ex = W / a.w, ey = H / a.h;         // px de la imagen por px del lienzo
    const margen = Math.max(2, Math.round(Math.max(ca.w, ca.h) * 0.03));
    const x = Math.max(0, Math.floor((ca.x - margen) * ex));
    const y = Math.max(0, Math.floor((ca.y - margen) * ey));
    let zona = {
        x, y,
        w: Math.min(W, Math.ceil((ca.x + ca.w + margen) * ex)) - x,
        h: Math.min(H, Math.ceil((ca.y + ca.h + margen) * ey)) - y,
    };

    // 2ª pasada: solo esa zona.
    let b = lienzoSinFondo(img, zona, maxLado);
    // Si ahí no se pudo quitar el fondo y en la imagen entera sí (el logo toca
    // el borde y la zona se quedó sin margen de ese lado), vale la 1ª pasada.
    if (a.sinFondo && !b.sinFondo) {
        b = a;
        zona = { x: 0, y: 0, w: W, h: H };
    }
    const cb = cajaDelDibujo(b.ctx, b.w, b.h) || { x: 0, y: 0, w: b.w, h: b.h };

    const fx = zona.w / b.w, fy = zona.h / b.h;
    return {
        proporcion: cb.w / cb.h,
        caja: { x: zona.x + cb.x * fx, y: zona.y + cb.y * fy, w: cb.w * fx, h: cb.h * fy },
        zona,
        lienzoZona: b.c,
        sinFondo: b.sinFondo,
    };
}

/** Abre un archivo de imagen. null si el navegador no puede. */
export function cargarImagen(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.src = url;
    });
}

// =====================================================================
// ANÁLISIS AUTOMÁTICO (sin abrir el editor)
// =====================================================================

/** Puntadas de una paleta completa, para un bordado de ese tamaño. */
export function puntadasDePaleta(paleta, anchoCm, altoCm) {
    return (paleta || []).reduce((s, p) => s + estimarPuntadas({
        anchoCm, altoCm, cobertura: p.cobertura, tipoPuntada: p.puntada, relieve: p.relieve,
    }), 0);
}

/**
 * Corre el mismo análisis que hace el editor, pero sin pantalla: el cliente
 * sube su logo y el sistema ya sabe con qué hilos y qué puntadas se borda.
 *
 * Hace exactamente los mismos pasos y en el mismo orden:
 *   1. quita el fondo (si lo tiene) y recorta el margen (ver prepararArte)
 *   2. reduce el arte a sus colores dominantes
 *   3. vectoriza cada color en una pieza con su área real
 *   4. le asigna a cada una el hilo más parecido de la carta
 *   5. elige la puntada: relleno para lo que ocupa mucho, satén para el detalle
 *
 * `usaTafeta` viene del artículo elegido en el pedido ("con tafeta"): en ese caso
 * la pieza de MAYOR superficie se resuelve con tela aplicada en vez de hilo, que
 * es justamente lo que hace que ese artículo salga más barato.
 *
 * Devuelve { paleta, canvas, proporcion, sinFondo }, o null si el archivo no es una
 * imagen que el navegador pueda abrir (un ponchado en PDF, AI o DST no se puede
 * analizar acá).
 */
export async function analizarArteAutomatico(file, { usaTafeta = false, maxLado = 420, coloresExactos = null } = {}) {
    if (!file || !/^image\//.test(file.type || '')) return null;
    const img = await cargarImagen(file);
    if (!img) return null;

    try {
        // 1. Fondo y margen: queda el dibujo, con el mismo poco de margen que
        //    usa el editor (ver prepararArte), así los contornos coinciden.
        const arte = prepararArte(img, maxLado);
        if (!arte) return null;
        const { lienzoZona: c, proporcion, sinFondo } = arte;
        const w = c.width, h = c.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });

        // 2, 3 y 4. Colores dominantes, juntados por hilo (una parada por
        //          hilo), y sus piezas. Un logo en vector (ver bordadoVector)
        //          trae sus colores EXACTOS: no hay nada que reducir.
        const colores = coloresExactos?.length
            ? coloresExactos.map(hex => ({ hex }))
            : detectarColores(ctx, w, h, 6);
        if (!colores.length) return null;
        let grupos = agruparPorHilo(colores);
        let vector = vectorizarPiezas(ctx, w, h, grupos.map(g => g.colores));
        if (coloresExactos?.length) {
            // Un color del archivo que quedó tapado entero por otras formas no
            // se borda: no es una parada.
            const vivos = vector.map((p, i) => i).filter(i => vector[i].areaPx > 0);
            grupos = vivos.map(i => grupos[i]);
            vector = vivos.map(i => vector[i]);
            if (!grupos.length) return null;
        }

        // La pieza más grande es la candidata a tafeta.
        let idxMayor = 0;
        vector.forEach((p, i) => { if (p.areaPx > vector[idxMayor].areaPx) idxMayor = i; });

        const paleta = grupos.map((g, i) => {
            const pieza = vector[i];
            let puntada = pieza.proporcion > 0.35 ? 'TATAMI' : 'SATEN';
            if (usaTafeta && i === idxMayor) puntada = 'TAFETA';
            return {
                id: `auto${i}_${g.colores[0].slice(1)}`,
                colorOriginal: g.colores[0],
                coloresOriginales: g.colores,
                hilo: g.hilo,
                cobertura: pieza.cobertura,
                proporcion: pieza.proporcion,
                anillos: pieza.anillos,
                puntada,
                relieve: false,
            };
        });

        return { paleta, canvas: c, proporcion, sinFondo };
    } catch (e) {
        console.warn('[BORDADO] No se pudo analizar el arte automáticamente:', e?.message);
        return null;
    }
}

/**
 * Proporción ancho / largo del arte. Con ella el ancho y el largo del bordado
 * quedan atados al logo: si no, el cliente puede cargar 10 × 10 para un logo
 * tres veces más ancho que alto y las puntadas (ancho × largo × cobertura)
 * salen el triple. Es la del DIBUJO, sin el fondo ni el margen que lo rodea
 * (ver prepararArte): lo mismo que miden el análisis y el editor.
 *
 * Devuelve null si el navegador no puede abrirlo (PDF, AI, DST) o si no trae
 * medidas propias (un SVG sin viewBox): ahí el ancho y el largo siguen sueltos.
 * El SVG se mide por su viewBox, con el margen que tenga.
 */
export async function leerProporcionArte(file) {
    if (!file || !/^image\//.test(file.type || '')) return null;

    // Un SVG sin width/height no tiene tamaño natural en el navegador: se lee
    // del viewBox.
    if (/svg/i.test(file.type)) {
        try {
            const vb = (await file.text()).match(
                /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i
            );
            const w = vb ? parseFloat(vb[1]) : 0;
            const h = vb ? parseFloat(vb[2]) : 0;
            return w > 0 && h > 0 ? w / h : null;
        } catch {
            return null;
        }
    }

    const img = await cargarImagen(file);
    return (img && prepararArte(img)?.proporcion) || null;
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
 * Convierte el mapa de píxeles en PIEZAS con contorno propio, una por grupo de
 * colores (ver agruparPorHilo: los tonos que caen en el mismo hilo son una sola
 * pieza).
 *
 * Para cada grupo arma una máscara (1 donde el color más parecido es de ese
 * grupo) y le saca los contornos con d3-contour. Es lo que hace un programa de
 * digitalizar antes de generar puntadas: primero convierte el dibujo en
 * objetos, después decide cómo bordar cada objeto.
 *
 * Gana dos cosas sobre contar píxeles sueltos:
 *   · El área sale de la geometría, no de un conteo con bordes difusos → la
 *     estimación de puntadas se apoya en algo firme.
 *   · Quedan los contornos para dibujarlos sobre el arte.
 *
 * Devuelve, por grupo: { hex, anillos, areaPx, cobertura, proporcion }.
 *   · cobertura  — parte de la CAJA DEL DIBUJO que ocupa la pieza. Es lo que
 *                  multiplica a ancho × largo para sacar las puntadas: el ancho
 *                  y el largo son los de esa caja, y un logo redondo o un escudo
 *                  no la llenan entera. (Antes era sobre el total pintado, que
 *                  siempre suma 100%, y las puntadas salían como si el logo
 *                  fuera un rectángulo lleno.)
 *   · proporcion — parte del dibujo que es esta pieza (todas suman 1). Sirve
 *                  para decidir relleno o satén.
 */
export function vectorizarPiezas(ctx, w, h, grupos) {
    if (!grupos.length) return [];
    const { data } = ctx.getImageData(0, 0, w, h);
    // Cada color de referencia apunta a la pieza (grupo) a la que pertenece.
    const refs = [];
    grupos.forEach((g, k) => (Array.isArray(g) ? g : [g]).forEach(hex => refs.push({ ...hexARgb(hex), k })));

    // A qué pieza pertenece cada píxel (-1 = transparente), y la caja del
    // dibujo con el mismo criterio que cajaDelDibujo.
    const pertenece = new Int16Array(w * h).fill(-1);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let n = 0; n < w * h; n++) {
        const i = n * 4;
        if (data[i + 3] < 128) continue;
        let mejor = -1, mejorD = Infinity;
        for (const r of refs) {
            const dd = (data[i] - r.r) ** 2 + (data[i + 1] - r.g) ** 2 + (data[i + 2] - r.b) ** 2;
            if (dd < mejorD) { mejorD = dd; mejor = r.k; }
        }
        pertenece[n] = mejor;
        const x = n % w, y = (n / w) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
    }
    const areaCaja = x1 < 0 ? w * h : (x1 - x0 + 1) * (y1 - y0 + 1);

    const generador = contours().size([w, h]).thresholds([0.5]);
    const piezas = grupos.map((g, k) => {
        const hex = Array.isArray(g) ? g[0] : g;
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
    return piezas.map(p => ({
        ...p,
        cobertura: Math.min(1, p.areaPx / areaCaja),
        proporcion: p.areaPx / total,
    }));
}

// =====================================================================
// PARADAS: un hilo, una parada
// =====================================================================

/**
 * Junta los colores detectados que caen en el MISMO hilo de la carta. Dos tonos
 * de azul (la sombra de un parche fotografiado, el antialiasing) que terminan
 * los dos en "Azul Marino" son una sola parada: si quedaban separadas, la
 * máquina paraba para volver a poner el mismo hilo.
 *
 * `colores` viene de detectarColores, de mayor a menor superficie, así que el
 * primer color de cada grupo es el dominante. Devuelve [{ hilo, colores }].
 */
export function agruparPorHilo(colores) {
    const grupos = [];
    for (const { hex } of colores) {
        const hilo = hiloMasCercano(hex).codigo;
        const g = grupos.find(x => x.hilo === hilo);
        if (g) g.colores.push(hex);
        else grupos.push({ hilo, colores: [hex] });
    }
    return grupos;
}

/** Los colores del arte que forman una pieza (las viejas solo traen uno). */
export const coloresDe = (p) => (p.coloresOriginales?.length ? p.coloresOriginales : [p.colorOriginal]);

// =====================================================================
// SIMULACIÓN DE BORDADO
// =====================================================================

/**
 * Repinta el arte que ya está en `ctx` como se vería bordado: cada píxel toma el
 * hilo de su pieza y una textura según la puntada (y el volumen del relieve, si
 * lo lleva). Es la vista «Simulación» del editor de hilos y la vista previa
 * «Viendo tu diseño» del pedido: las dos salen de acá, así se ven iguales.
 */
export function pintarSimulacion(ctx, w, h, paleta) {
    if (!paleta?.length) return;
    const piezas = paleta.map(p => ({
        dest: hexARgb((CARTA_HILOS.find(x => x.codigo === p.hilo) || {}).hex || p.colorOriginal),
        // El relieve solo existe en satén: la puntada de arriba corta la goma.
        puntada: p.relieve ? PUNTADA_RELIEVE : p.puntada,
        relieve: !!p.relieve,
    }));
    // Cada color del arte apunta a su pieza: una pieza puede juntar varios
    // tonos que van con el mismo hilo.
    const refs = [];
    paleta.forEach((p, k) => coloresDe(p).forEach(hex => refs.push({ ...hexARgb(hex), k })));

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const total = w * h;

    // Paso 1 — a qué pieza pertenece cada píxel. Se calcula aparte porque el
    // relieve necesita mirar a los vecinos para sombrear los bordes.
    const idx = new Int8Array(total).fill(-1);
    for (let n = 0; n < total; n++) {
        const i = n * 4;
        if (d[i + 3] < 128) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let mejor = -1, mejorD = Infinity;
        for (const ref of refs) {
            const dd = (r - ref.r) ** 2 + (g - ref.g) ** 2 + (b - ref.b) ** 2;
            if (dd < mejorD) { mejorD = dd; mejor = ref.k; }
        }
        idx[n] = mejor;
    }

    // Paso 2 — color del hilo + textura de la puntada.
    for (let n = 0; n < total; n++) {
        const pi = idx[n];
        if (pi < 0) continue;
        const p = piezas[pi];
        const i = n * 4;
        const px = n % w, py = (n / w) | 0;

        let nr = p.dest.r, ng = p.dest.g, nb = p.dest.b;

        // La textura es lo que hace que se lea como bordado y no como dibujo
        // plano. Se modula el brillo; el color del hilo no cambia.
        let k = 0;
        switch (p.puntada) {
            case 'SATEN':    k = ((px + py) % 6 < 2) ? 26 : -10; break;   // brillo diagonal
            case 'TATAMI':   k = (py % 3 === 0) ? -22 : ((px % 4 === 0) ? -10 : 6); break; // trama
            case 'PESPUNTE': k = (px % 5 === 0 && py % 5 === 0) ? -55 : 10; break;  // línea punteada
            case 'ZIGZAG':   k = (Math.abs((px % 8) - 4) + py) % 6 < 2 ? 22 : -14; break;
            case 'TAFETA':   k = (px % 5 === 0 || py % 5 === 0) ? -18 : 4; break;   // trama de tela
            default:         k = 0;
        }

        // [RELIEVE] Volumen: la pieza se ilumina del lado de la luz y se
        // ensombrece del opuesto, mirando si el vecino es otra pieza o vacío.
        // Con dos píxeles de borde alcanza para que se lea levantada.
        if (p.relieve) {
            const arriba = (px > 1 && py > 1) ? idx[n - w - 1] : -1;
            const abajo  = (px < w - 2 && py < h - 2) ? idx[n + w + 1] : -1;
            if (arriba !== pi) k += 55;        // canto iluminado
            else if (abajo !== pi) k -= 60;    // sombra proyectada
            else k += 12;                      // la cara de arriba, más clara
        }

        nr += k; ng += k; nb += k;
        d[i]     = nr < 0 ? 0 : nr > 255 ? 255 : nr;
        d[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
        d[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
    ctx.putImageData(imgData, 0, 0);
}

/** Copia de `canvas` con la simulación de bordado encima (ver pintarSimulacion). */
export function canvasSimulado(canvas, paleta) {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    pintarSimulacion(ctx, c.width, c.height, paleta);
    return c;
}

/** Una sola pieza con lo de las dos: colores, contornos y superficie. Queda la configuración de `a`. */
export function unirPiezas(a, b) {
    return {
        ...a,
        coloresOriginales: [...coloresDe(a), ...coloresDe(b)],
        anillos: [...(a.anillos || []), ...(b.anillos || [])],
        cobertura: (a.cobertura || 0) + (b.cobertura || 0),
        proporcion: (a.proporcion || 0) + (b.proporcion || 0),
    };
}
