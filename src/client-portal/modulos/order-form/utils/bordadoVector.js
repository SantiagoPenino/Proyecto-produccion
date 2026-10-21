import { apiClient } from '../../../api/apiClient';
import { analizarArteAutomatico, hexARgb } from './bordadoHilos';

// [BORDADO] Logo en vector (PDF o AI).
//
// Pasa por el MISMO control que TPU "Hago mi matriz" (backend/python/tpu_matriz.py analizar): una
// sola página, sin imágenes, textos convertidos a curvas. Si pasa, salen exactas tres cosas que de
// un PNG solo se pueden aproximar:
//   · los COLORES de relleno, tal cual están en el archivo (no una reducción de píxeles);
//   · las FORMAS, sin el fondo blanco de la hoja;
//   · la MEDIDA REAL del dibujo en mm.
// Las formas se dibujan en un PNG transparente, que es lo que usan el análisis de siempre (piezas,
// cobertura, puntadas) y el editor de hilos: así todo lo demás funciona igual que con un PNG.
//
// Un archivo que no pasa el control no se rechaza: bordado acepta igual PNG y JPG, y el taller ve el
// archivo. Vuelve con el motivo de TPU para que el cliente sepa por qué no se pudo calcular.
//
// SVG no entra por acá: el lector de PDF del servidor no aplica los estilos por clase CSS, que es como
// exporta Illustrator, y los colores salían negros. Un SVG sigue yendo como imagen (ver
// analizarArteAutomatico), que el navegador sí dibuja bien.

export const esVectorBordado = (file) => /\.(pdf|ai)$/i.test(file?.name || '');

// Lado mayor del PNG. Más que los 420 del análisis, para que la vista previa y el editor se vean
// nítidos; prepararArte lo baja igual a 420 para analizar.
const LADO_PNG = 1200;

/**
 * Las formas del análisis en un canvas transparente, con un margen vacío alrededor del dibujo.
 *
 * El margen es imprescindible: el fondo ya lo sacó el análisis (las formas blancas de la hoja), y con
 * las esquinas transparentes prepararArte no intenta quitar nada. Recortado justo, un logo que llena su
 * recuadro (un escudo rectangular) tiene las cuatro esquinas de su color, y el análisis lo borraba
 * como si fuera el fondo.
 */
export function dibujarFormas(analisis, lado = LADO_PNG) {
    const [x0, y0, x1, y1] = analisis.bbox;
    const escala = lado / Math.max(x1 - x0, y1 - y0);
    const margen = Math.max(4, Math.round(lado * 0.02));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((x1 - x0) * escala)) + 2 * margen;
    c.height = Math.max(1, Math.round((y1 - y0) * escala)) + 2 * margen;
    const ctx = c.getContext('2d');
    // Las coordenadas del análisis son pt de la página, con el origen arriba a la izquierda.
    ctx.setTransform(escala, 0, 0, escala, margen - x0 * escala, margen - y0 * escala);
    ctx.lineJoin = 'round';
    // En el orden del archivo: lo que va arriba tapa lo de abajo.
    for (const f of analisis.formas) {
        const p = new Path2D(f.d);
        if (f.fill) {
            ctx.fillStyle = f.fill;
            ctx.fill(p, f.evenOdd ? 'evenodd' : 'nonzero');
        }
        if (f.stroke && f.width > 0) {
            ctx.strokeStyle = f.stroke;
            ctx.lineWidth = f.width;
            ctx.stroke(p);
        }
    }
    return c;
}

const aPng = (canvas, nombre) => new Promise(ok => canvas.toBlob(
    b => ok(b ? new File([b], nombre, { type: 'image/png' }) : null), 'image/png'));

// Los avisos del análisis están escritos para TPU (parche, corte, relieve). Acá solo importa uno: las
// partes con degradado o patrón no son formas con un color, así que no entran en el cálculo.
const avisosBordado = (avisos = []) => avisos.some(a => /degradad/i.test(a))
    ? ['Las partes con degradado o con patrón no entran en el cálculo de hilos y puntadas: el taller las resuelve al hacer la matriz.']
    : [];

/**
 * Analiza un logo en PDF o AI. Devuelve:
 *   · { vector: false, motivo } si no pasa el control. `motivo` es null cuando no se pudo
 *     analizar por algo que no es del archivo (servidor sin análisis, sin conexión).
 *   · { vector: true, paleta, canvas, proporcion, medidaMm, raster, coloresExactos, avisos } si
 *     pasa. `raster` es el PNG con las formas: el editor de hilos trabaja sobre él.
 */
export async function analizarVectorBordado(file, { usaTafeta = false } = {}) {
    let analisis;
    try {
        const fd = new FormData();
        fd.append('file', file);
        analisis = (await apiClient.postFormData('/web-orders/bordado/analizar-vector', fd))?.analisis;
    } catch (e) {
        console.warn('[BORDADO] No se pudo analizar el vector:', e?.message);
        return { vector: false, motivo: null };
    }
    if (!analisis?.vector) return { vector: false, motivo: analisis?.motivo || null };
    if (!analisis.bbox || !analisis.formas?.length) return { vector: false, motivo: null };

    const raster = await aPng(dibujarFormas(analisis), `${file.name.replace(/\.[^.]+$/, '')}.png`);
    if (!raster) return { vector: false, motivo: null };

    // Los colores exactos del archivo, del que más formas pinta al que menos.
    const coloresExactos = (analisis.colores || []).map(c => c.fill).filter(Boolean);
    const r = await analizarArteAutomatico(raster, { usaTafeta, coloresExactos });
    if (!r) return { vector: false, motivo: null };

    const [ancho, alto] = analisis.bbox_mm;
    return {
        ...r,
        vector: true,
        // La del archivo, en mm: más precisa que la del PNG.
        proporcion: ancho / alto,
        medidaMm: { ancho, alto },
        raster,
        coloresExactos,
        avisos: avisosBordado(analisis.avisos),
    };
}

const distancia = (a, b) => {
    const x = hexARgb(a), y = hexARgb(b);
    return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
};

/**
 * Para «Volver a detectar los hilos» en un logo en vector: los colores exactos del archivo, más los
 * detectados que no se parecen a ninguno (lo que el cliente pintó con el balde, que es un hilo de la
 * carta y no un color del archivo).
 */
export function conColoresExactos(exactos, detectados, umbral = 40) {
    return [
        ...exactos.map(hex => ({ hex })),
        ...detectados.filter(d => !exactos.some(hex => distancia(hex, d.hex) < umbral)),
    ];
}
