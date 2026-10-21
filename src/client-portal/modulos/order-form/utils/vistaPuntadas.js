import { apiClient } from '../../../api/apiClient';

// [BORDADO] Vista de puntadas.
//
// En «Viendo tu diseño», en lugar del prediseño (el arte repintado con una textura por puntada),
// va lo que se va a bordar: las puntadas que arma Ink/Stitch con la paleta y las medidas del
// diseño, dibujadas con el brillo del hilo (backend: bordadoMatrizService.vistaPuntadas). Son las
// mismas puntadas del borrador de matriz que recibe el taller cuando entra el pedido.
//
// El servidor devuelve un SVG con una forma por puntada; acá se dibuja en un PNG, que es lo que
// muestra la tarjeta del diseño y lo que viaja con el pedido como prediseño. Mientras tanto se ve
// el prediseño de siempre, y si el servidor no puede armar la vista, queda ese.

// Lo que cambia la vista: medidas, y por cada parada su hilo, su puntada y su forma.
export const claveVista = (d) => JSON.stringify([
    parseFloat(d.ancho) || 0, parseFloat(d.alto) || 0,
    (d.paleta || []).map(p => [p.hilo, p.puntada, !!p.relieve, (p.anillos || []).length, Math.round((p.cobertura || 0) * 1000)]),
]);

// Lado mayor del PNG, y el fondo: gris muy claro, como el área de trabajo de Wilcom (sobre la
// tarjeta oscura, un hilo negro sobre transparente no se veía).
const LADO_PNG = 1000;
const FONDO = '#f4f4f5';

/** Dibuja el SVG de la vista en un PNG. null si el navegador no pudo. */
export function svgAPng(svg, nombre, lado = LADO_PNG) {
    return new Promise((resolve) => {
        const vb = (svg.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/) || []);
        const w0 = parseFloat(vb[1]) || 1, h0 = parseFloat(vb[2]) || 1;
        const escala = lado / Math.max(w0, h0);
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        const img = new Image();
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(w0 * escala));
            c.height = Math.max(1, Math.round(h0 * escala));
            const ctx = c.getContext('2d');
            ctx.fillStyle = FONDO;
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            c.toBlob(b => resolve(b ? new File([b], nombre, { type: 'image/png' }) : null), 'image/png');
        };
        img.src = url;
    });
}

/**
 * Pide la vista de puntadas de un diseño y la devuelve como PNG (File), o null si no se pudo
 * (servidor sin Ink/Stitch, error, medidas fuera de rango).
 */
export async function pedirVistaPuntadas({ paleta, anchoCm, altoCm, nombre }) {
    try {
        const r = await apiClient.post('/web-orders/bordado/vista-puntadas', { paleta, anchoCm, altoCm });
        return r?.svg ? await svgAPng(r.svg, `${nombre} PREDISENO.png`) : null;
    } catch (e) {
        console.warn('[BORDADO] Sin vista de puntadas:', e?.message);
        return null;
    }
}
