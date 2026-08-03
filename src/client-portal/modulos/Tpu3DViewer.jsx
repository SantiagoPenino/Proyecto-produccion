import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Rotate3d, Sparkles, Save, Check, ChevronRight, ChevronLeft, Move, Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { API_BASE_URL } from '../api/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Visor 3D del parche TPU (aprobación del cliente).
//
// El modelo se arma con el BOCETO DE PRODUCCIÓN (el PDF que el cliente está aprobando);
// para pedidos viejos, sin boceto, cae al cmyk del arte.
//
// Las capas del arte son PLANCHAS (el diseño repetido N veces): se aísla UNA copia
// (componente conexo más grande de la silueta) y el mismo recorte se aplica a todas
// las capas, que están alineadas. Un boceto de una sola copia entra por el mismo camino:
// el componente mayor es el diseño entero.
//
// El modelo es una EXTRUSIÓN REAL de la silueta (marching por bordes de píxel →
// contornos con agujeros → THREE.Shape → ExtrudeGeometry): paredes blancas lisas
// también de canto. El arte va como textura de una lámina plana sobre la tapa, y la
// textura del material se lee SOLO por sombreado (bumpMap): se probó desplazar la
// malla y con texturas reales daba ruido, no volumen — el relieve de un TPU es
// demasiado fino para lo que una malla razonable puede representar.
// three.js se carga lazy (solo al abrir el visor).
// ─────────────────────────────────────────────────────────────────────────────

const authHeaders = () => {
    const token = localStorage.getItem('auth_token');
    const h = token ? { Authorization: `Bearer ${token}` } : {};
    try {
        const dc = JSON.parse(localStorage.getItem('designer_cliente') || 'null');
        if (dc?.codCliente) h['X-Cliente-CodCliente'] = String(dc.codCliente);
    } catch { /* sin impersonación */ }
    return h;
};

// Abre un PDF y devuelve la página 1 con sus dimensiones base (a escala 1).
const abrirPdf = async (buf) => {
    const pdfjsLib = await import('pdfjs-dist');
    // El worker se configura ACÁ y no se asume: en el portal lo setea fileService al arrancar,
    // pero este visor también corre en la app interna (modo interno), donde nadie lo configuró
    // y pdf.js moría con 'No "GlobalWorkerOptions.workerSrc" specified'.
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
    }
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // `pdf` se conserva para leer las capas (OCG) del boceto: son las zonas texturables.
    return { pdf, page, baseW: base.width, baseH: base.height };
};

// Rasteriza un RECORTE de la página a un canvas de outW×outH, con fondo transparente.
// sx/sy en píxeles YA escalados. Renderizar directo el recorte (vía transform) permite
// resolución completa de UNA copia sin generar el canvas gigante de toda la plancha.
// `occ` (OptionalContentConfig) permite rasterizar con solo ALGUNAS capas del PDF visibles.
// Como el viewport y el transform son los mismos, las máscaras por zona salen alineadas al
// píxel con el arte, sin registrar nada.
const rasterizar = async ({ page }, { scale, sx = 0, sy = 0, outW, outH, occ = null }) => {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(outW);
    canvas.height = Math.ceil(outH);
    await page.render({
        // willReadFrequently: de este canvas se leen los píxeles (máscaras, silueta, arte). Sin el
        // flag Chrome lo deja en la GPU y cada getImageData es una bajada GPU→CPU que frena todo.
        canvasContext: canvas.getContext('2d', { willReadFrequently: true }),
        viewport,
        transform: [1, 0, 0, 1, -sx, -sy],
        background: 'rgba(0,0,0,0)',
        ...(occ ? { optionalContentConfigPromise: Promise.resolve(occ) } : {}),
    }).promise;
    return canvas;
};

// ─── Texturas por zona ───────────────────────────────────────────────────────
// Multiplicador global del bumpMap. La intensidad real de cada textura se hornea en el mapa
// (ver `altura` en cargarTile), porque bumpScale es del MATERIAL y hay un solo material para
// todas las zonas: no se puede tener una altura distinta por zona desde acá.
const RELIEVE_FUERZA = 2;
// Ancho de la franja donde el relieve se apaga hacia el borde del parche: el filo del parche es un
// canto limpio, no material texturado. (Venía del modo con desplazamiento, donde además evitaba que
// la lámina se despegara de la base; sigue valiendo para el sombreado.)
const BORDE_APAGADO_PX = 18;
// Cuántos píxeles se empuja el color del arte HACIA AFUERA de la silueta. No agranda el parche (el
// alphaTest recorta igual): solo evita que el filtrado bilineal de la textura mezcle el blanco de
// afuera con el arte en el filo, que es lo que dibujaba una línea blanca en todo el contorno.
const COLOR_EXTIENDE_PX = 4;
// Barniz sectorizado: es una capa brillante sobre una zona. Se resuelve con el roughnessMap —
// menos rugosidad = más brillo especular. El material queda con roughness 1 y el mapa manda.
// 235 ≈ 0.92: MUY mate, que es lo que es un parche de TPU. Estuvo en 128 (≈0.50) y ahí el
// especular dieléctrico (F0 = 0.04) tendía un velo blanco parejo sobre todo el parche: contra un
// albedo casi negro (el fondo del escudo es #1f1a16 → 0.014 lineal) ese velo valía varias veces
// el difuso, así que el negro salía gris medio y los amarillos saturados se iban al pastel. Eso
// era el "lavado". El relieve no se pierde: se lee sobre todo por cómo el bump cambia el N·L del
// difuso, no por el brillo.
const RUGOSIDAD_MATE = 235;
// 64 ≈ 0.25. Un barniz NO es un espejo: con 0.08 la zona reflejaba casi puntual y, como el bump le
// perturba la normal, cada faceta devolvía un punto de luz duro — se veía como sal y pimienta sobre
// el negro. A 0.25 el reflejo se abre y queda un lustre parejo.
const RUGOSIDAD_BARNIZ = 64;
// Cuánto se ACHICA la base blanca respecto del arte, en píxeles de la grilla de contornos (CW=640).
// El arte queda entonces sobresaliendo apenas por todo el borde y de frente no asoma nada de blanco.
const BASE_ACHICA_PX = 4;
// ESCALA de la textura dentro de la zona: 1 = el tamaño que define el catálogo (texturas.json),
// 2 = el dibujo del material al doble. Se expone escala y no "repeticiones" porque es lo que se
// está mirando — agrandar o achicar la trama — y porque el número de repeticiones depende del
// tamaño del parche, que el cliente no tiene por qué tener en la cabeza.
const ESCALA_MIN = 1, ESCALA_MAX = 3, ESCALA_PASO = 0.5;
// ALTURA_PASO queda sin usar a propósito: el slider de altura está escondido (todas las texturas
// van al relieve máximo) y el paso es lo único que hace falta para volver a mostrarlo.
const ALTURA_MIN = 0.5, ALTURA_MAX = 2, ALTURA_PASO = 0.25;
// Tope del tile respecto del ancho del render: sin esto, escalas grandes generan un canvas de
// varios miles de píxeles y el recorrido píxel a píxel de cargarTile se hace notar.
const TILE_MAX_FACTOR = 1.5;

// Carga una textura y la deja rasterizada como TILE de tamaño entero en píxeles, EN GRISES.
// La textura no pinta color: el color lo sigue poniendo el arte. Se usa como mapa de RELIEVE
// (bumpMap), así que de cada píxel solo importa el brillo.
//
// `repeticiones` = cuántas veces entra a lo ancho del parche. El valor base viene por textura del
// catálogo (no del archivo: los SVG traen viewBox pero sin medida física, así que no hay tamaño
// real del que deducirlo) y la escala que elige el cliente lo divide. Puede ser fraccionario —
// incluso menor que 1, o sea un tile más grande que el parche.
// `altura` = cuánto SOBRESALE el trazo (1 = medio relieve, 2 = relieve completo). En un bumpMap lo
// más claro es lo más alto, así que el gris se INVIERTE: la tinta del dibujo pasa a blanco (sube) y
// el fondo a negro (nivel base). Sin invertir, el dibujo quedaba grabado hacia adentro.
const cargarTile = async (url, anchoRenderPx, repeticiones, altura) => {
    const img = new Image();
    await new Promise((ok, fail) => {
        img.onload = ok;
        img.onerror = () => fail(new Error('No se pudo cargar la textura.'));
        img.src = url;
    });
    const aspecto = (img.naturalHeight || 1) / (img.naturalWidth || 1);

    const w = Math.max(4, Math.min(
        Math.round(anchoRenderPx * TILE_MAX_FACTOR),
        Math.round(anchoRenderPx / Math.max(0.05, repeticiones))
    ));
    const h = Math.max(4, Math.round(w * aspecto));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    // Sobre BLANCO antes de dibujar: las texturas suelen ser trazo oscuro sobre fondo
    // transparente. Sin este relleno, el fondo queda en alpha 0 y al pasar a grises todo
    // da 0 — la textura entera quedaría plana, sin relieve.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const d = ctx.getImageData(0, 0, w, h);

    // 1) Luminancia + rango real de la imagen.
    const grises = new Float32Array(w * h);
    let min = 255, max = 0;
    for (let i = 0; i < w * h; i++) {
        const g = 0.299 * d.data[i * 4] + 0.587 * d.data[i * 4 + 1] + 0.114 * d.data[i * 4 + 2];
        grises[i] = g;
        if (g < min) min = g;
        if (g > max) max = g;
    }
    const rango = Math.max(1, max - min);

    // 2) Polaridad automática. Lo que tiene que sobresalir es el DIBUJO, que siempre es la minoría
    //    de la superficie. Algunos SVG vienen como trazo oscuro sobre fondo claro y otros al revés
    //    (mancha oscura con el patrón calado); con una regla fija, en la mitad de los casos se
    //    levantaba el fondo. Se mide qué proporción quedaría alta y, si es mayoría, se da vuelta.
    let suma = 0;
    for (let i = 0; i < w * h; i++) suma += 1 - (grises[i] - min) / rango;
    const media = suma / (w * h);
    const invertido = media > 0.5;
    const piso = invertido ? 1 - media : media; // nivel promedio con la polaridad ya resuelta

    // 3) Normalizar, restar el piso y RECIÉN AHÍ escalar por altura.
    //    - Restar el piso es lo que hace que suba SOLO el dibujo: sin eso, un patrón denso deja el
    //      mapa alto en casi toda la zona y el desplazamiento la levanta entera como un bloque, en
    //      vez de despegar el trazo de la superficie. Peor todavía con el desenfoque, que funde los
    //      trazos en una meseta pareja.
    //    - Escalar al final y hacia abajo desde el rango completo: multiplicar el contraste (×3, ×6)
    //      saturaba en blanco y los dos pasos de altura daban el mismo mapa.
    const escala = Math.max(0, Math.min(1, (Number(altura) || 0) / ALTURA_MAX));
    for (let i = 0; i < w * h; i++) {
        const norm = (grises[i] - min) / rango;               // 0 = el tono más oscuro del tile
        const alto = invertido ? norm : (1 - norm);           // 0 = al ras del parche
        const v = Math.round(255 * Math.max(0, alto - piso) * escala);
        d.data[i * 4] = v; d.data[i * 4 + 1] = v; d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
    return c;
};

// Máscara → canvas de color sólido (para los mini mapas de zona).
const mascaraAColor = ({ m, w, h }, [r, g, bl]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        if (!m[i]) continue;
        img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = bl; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
};

// Máscara → canvas donde el alpha marca la zona (para recortar el patrón con destination-in).
const mascaraAAlpha = ({ m, w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = m[i] ? 255 : 0;
    ctx.putImageData(img, 0, 0);
    return c;
};

// Máscara de "tinta": alpha visible y no blanco-papel.
const mascaraTinta = (canvas) => {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const a = d[i * 4 + 3];
        if (a < 16) continue;
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        if (r > 245 && g > 245 && b > 245) continue;
        m[i] = 1;
    }
    return { m, w, h };
};

// Interior del trazo de corte: flood-fill desde los bordes por píxeles sin tinta.
const interiorDeCorte = ({ m, w, h }) => {
    const fuera = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => { const i = y * w + x; if (!fuera[i] && !m[i]) { fuera[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
        const i = stack.pop(); const x = i % w, y = (i - x) / w;
        if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y);
        if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
    }
    const interior = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) interior[i] = fuera[i] ? 0 : 1;
    return { m: interior, w, h };
};

// La plancha trae N copias: bbox (fracciones 0..1) del componente conexo más grande.
const bboxUnaCopia = ({ m, w, h }) => {
    const label = new Int32Array(w * h);
    let next = 0, best = null;
    const stack = [];
    for (let s = 0; s < w * h; s++) {
        if (!m[s] || label[s]) continue;
        next++;
        let area = 0, minX = w, maxX = 0, minY = h, maxY = 0;
        label[s] = next; stack.push(s);
        while (stack.length) {
            const i = stack.pop(); const x = i % w, y = (i - x) / w;
            area++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (x > 0) { const j = i - 1; if (m[j] && !label[j]) { label[j] = next; stack.push(j); } }
            if (x < w - 1) { const j = i + 1; if (m[j] && !label[j]) { label[j] = next; stack.push(j); } }
            if (y > 0) { const j = i - w; if (m[j] && !label[j]) { label[j] = next; stack.push(j); } }
            if (y < h - 1) { const j = i + w; if (m[j] && !label[j]) { label[j] = next; stack.push(j); } }
        }
        if (!best || area > best.area) best = { area, minX, maxX, minY, maxY };
    }
    if (!best) return null;
    const mx = (best.maxX - best.minX) * 0.05 + 2;
    const my = (best.maxY - best.minY) * 0.05 + 2;
    return {
        x0: Math.max(0, best.minX - mx) / w,
        x1: Math.min(w - 1, best.maxX + mx) / w,
        y0: Math.max(0, best.minY - my) / h,
        y1: Math.min(h - 1, best.maxY + my) / h,
    };
};

// Deja SOLO el componente conexo más grande de la máscara (borra motas y vecinos), in-place.
const mantenerMayorComponente = ({ m, w, h }) => {
    const label = new Int32Array(w * h);
    let next = 0, mejor = 0, mejorArea = 0;
    const stack = [];
    for (let s = 0; s < w * h; s++) {
        if (!m[s] || label[s]) continue;
        next++;
        let area = 0;
        label[s] = next; stack.push(s);
        while (stack.length) {
            const i = stack.pop(); const x = i % w;
            area++;
            if (x > 0 && m[i - 1] && !label[i - 1]) { label[i - 1] = next; stack.push(i - 1); }
            if (x < w - 1 && m[i + 1] && !label[i + 1]) { label[i + 1] = next; stack.push(i + 1); }
            if (i >= w && m[i - w] && !label[i - w]) { label[i - w] = next; stack.push(i - w); }
            if (i < w * (h - 1) && m[i + w] && !label[i + w]) { label[i + w] = next; stack.push(i + w); }
        }
        if (area > mejorArea) { mejorArea = area; mejor = next; }
    }
    for (let i = 0; i < w * h; i++) m[i] = label[i] === mejor && m[i] ? 1 : 0;
};

// Máscara → canvas B/N (blanco = adentro).
const mascaraACanvas = ({ m, w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const v = m[i] ? 255 : 0;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
};

// Recorta una FRACCIÓN (bbox 0..1) de un canvas a un tamaño de salida fijo.
const recortarFraccion = (canvas, fr, outW, outH) => {
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(
        canvas,
        fr.x0 * canvas.width, fr.y0 * canvas.height,
        (fr.x1 - fr.x0) * canvas.width, (fr.y1 - fr.y0) * canvas.height,
        0, 0, outW, outH
    );
    return c;
};

// Douglas-Peucker: simplifica un polígono (menos vértices → paredes lisas y liviano).
const simplificar = (pts, eps) => {
    if (pts.length < 5) return pts;
    const distSeg = (p, a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    const rdp = (arr, i0, i1, out) => {
        let maxD = 0, maxI = -1;
        for (let i = i0 + 1; i < i1; i++) {
            const d = distSeg(arr[i], arr[i0], arr[i1]);
            if (d > maxD) { maxD = d; maxI = i; }
        }
        if (maxD > eps) {
            rdp(arr, i0, maxI, out);
            out.push(arr[maxI]);
            rdp(arr, maxI, i1, out);
        }
    };
    const out = [pts[0]];
    rdp(pts, 0, pts.length - 1, out);
    out.push(pts[pts.length - 1]);
    return out;
};

// ─── Imagen del boceto aprobado ──────────────────────────────────────────────
// Lo que queda archivado al aprobar: a la izquierda el parche renderizado con las texturas
// puestas, a la derecha la referencia de qué se le aplicó a cada zona. Es el documento que mira
// producción para fabricar, así que va sobre blanco y con los datos en TEXTO, no solo dibujados.
const FOTO_ANCHO = 820, LEYENDA_ANCHO = 640, PAD = 30, CABECERA = 86, FILA_ALTO = 112;
const FUENTE = 'system-ui, "Segoe UI", Roboto, sans-serif';

const cargarImagen = (src) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('No se pudo cargar la imagen.'));
    img.src = src;
});

// Dibuja la imagen entera adentro de la caja, sin deformarla.
const dibujarContenida = (x, img, bx, by, bw, bh) => {
    const e = Math.min(bw / img.width, bh / img.height);
    const w = img.width * e, h = img.height * e;
    x.drawImage(img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
};

const armarImagenAprobacion = async ({ foto, codigo, fecha, filas }) => {
    const imgFoto = await cargarImagen(foto);
    // Mini mapas y muestras son opcionales: si alguna no carga, la fila se dibuja igual. La imagen
    // tiene que salir sí o sí — es el respaldo de una aprobación.
    const extras = await Promise.all(filas.map(async (f) => ({
        mini: f.mini ? await cargarImagen(f.mini).catch(() => null) : null,
        muestra: f.texturaUrl ? await cargarImagen(f.texturaUrl).catch(() => null) : null,
    })));

    const fotoAlto = Math.round(FOTO_ANCHO * (imgFoto.height / imgFoto.width));
    const W = PAD * 3 + FOTO_ANCHO + LEYENDA_ANCHO;
    const H = Math.max(
        CABECERA + PAD * 2 + fotoAlto,
        CABECERA + PAD * 2 + 34 + filas.length * FILA_ALTO,
        460
    );

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W, H);
    x.textBaseline = 'middle';

    // Cabecera
    x.fillStyle = '#18181b';
    x.fillRect(0, 0, W, CABECERA);
    x.fillStyle = '#ffffff';
    x.font = `bold 30px ${FUENTE}`;
    x.fillText('BOCETO APROBADO', PAD, 34);
    x.fillStyle = '#a1a1aa';
    x.font = `bold 20px ${FUENTE}`;
    x.fillText(codigo || '', PAD, 63);
    x.textAlign = 'right';
    x.font = `16px ${FUENTE}`;
    x.fillText(fecha, W - PAD, CABECERA / 2);
    x.textAlign = 'left';

    // Parche. El render viene con fondo transparente (el canvas del visor es alpha), así que se
    // apoya sobre un gris claro: el cuerpo del parche es blanco y sobre blanco no se vería el filo.
    const fx = PAD, fy = CABECERA + PAD;
    x.fillStyle = '#efeff1';
    x.fillRect(fx, fy, FOTO_ANCHO, fotoAlto);
    x.drawImage(imgFoto, fx, fy, FOTO_ANCHO, fotoAlto);
    x.strokeStyle = '#d4d4d8';
    x.lineWidth = 1;
    x.strokeRect(fx + 0.5, fy + 0.5, FOTO_ANCHO - 1, fotoAlto - 1);

    // Referencia por zona
    const lx = PAD * 2 + FOTO_ANCHO;
    x.fillStyle = '#71717a';
    x.font = `bold 15px ${FUENTE}`;
    x.fillText('ZONAS Y TEXTURAS', lx, fy + 8);

    filas.forEach((f, i) => {
        const top = fy + 34 + i * FILA_ALTO;
        x.strokeStyle = '#e4e4e7';
        x.beginPath();
        x.moveTo(lx, top + 0.5);
        x.lineTo(lx + LEYENDA_ANCHO, top + 0.5);
        x.stroke();

        const my = top + 18;
        if (extras[i].mini) dibujarContenida(x, extras[i].mini, lx, my, 78, 76);

        // Muestra de la textura, con el mismo encuadre que en el visor (se ve un cuarto del tile).
        const sx = lx + 92, sw = 62;
        x.fillStyle = '#fafafa';
        x.fillRect(sx, my + 7, sw, sw);
        if (extras[i].muestra) {
            x.save();
            x.beginPath();
            x.rect(sx, my + 7, sw, sw);
            x.clip();
            x.drawImage(extras[i].muestra, sx - sw / 2, my + 7 - sw / 2, sw * 2, sw * 2);
            x.restore();
        }
        x.strokeStyle = '#d4d4d8';
        x.strokeRect(sx + 0.5, my + 7.5, sw - 1, sw - 1);

        const tx = lx + 174;
        x.fillStyle = '#71717a';
        x.font = `bold 13px ${FUENTE}`;
        x.fillText(String(f.zona || '').toUpperCase(), tx, my + 10);
        x.fillStyle = '#18181b';
        x.font = `bold 21px ${FUENTE}`;
        x.fillText(f.textura, tx, my + 36);
        x.fillStyle = '#52525b';
        x.font = `15px ${FUENTE}`;
        x.fillText(f.detalle, tx, my + 62);
    });

    return await new Promise((res) => c.toBlob(res, 'image/png'));
};

// Pad para CORRER la textura dentro de la zona: se arrastra el punto y la trama se mueve con él.
// El recorrido es UNA repetición del tile en cada eje y nada más: las texturas son seamless, así
// que correrla un tile entero da exactamente el mismo dibujo — con este cuadradito ya se alcanza
// cualquier posición posible. dx/dy van en 0..1 y 0.5 es "sin correr" (el centro del pad).
const PadMover = ({ dx, dy, onChange, onReset, clase }) => {
    const ref = useRef(null);
    const mover = (ev) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
        onChange(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
    };
    return (
        <div
            ref={ref}
            // Con captura de puntero el arrastre sigue andando aunque el dedo se vaya del cuadrado.
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); mover(e); }}
            onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) mover(e); }}
            onDoubleClick={onReset}
            title="Arrastrá para correr la textura dentro de la zona · doble clic para centrarla"
            // touch-none: sin esto, en mobile el gesto lo toma el scroll del modal y el pad no responde.
            className={`relative w-11 h-11 rounded-lg border cursor-grab active:cursor-grabbing touch-none ${clase}`}
        >
            <span className="absolute inset-x-1 top-1/2 border-t border-dashed border-current opacity-25" />
            <span className="absolute inset-y-1 left-1/2 border-l border-dashed border-current opacity-25" />
            <span
                className="absolute w-2.5 h-2.5 rounded-full bg-brand-magenta"
                style={{ left: `${dx * 100}%`, top: `${dy * 100}%`, transform: 'translate(-50%,-50%)' }}
            />
        </div>
    );
};

// `modo`:
//  · 'cliente' (default) — portal: endpoints /web-orders scopeados al dueño. Si el pedido tiene
//    TexturasElige='DISENADOR', la UI de elección se oculta y el cliente solo mira y aprueba.
//  · 'interno' — detalle de la orden: endpoints /orders sin scope; el diseñador elige las texturas
//    (se guardan con PUT, que marca ElegidaPor=OPERARIO y deja historial).
// `onAprobado` (solo modo cliente): callback tras aprobar desde el visor, para refrescar la lista.
export const Tpu3DViewer = ({ ordenId, codigo, onClose, onAprobado, modo = 'cliente' }) => {
    const esInterno = modo === 'interno';
    // Tema: el portal es oscuro; la app interna es clara (zinc-100), así que el visor interno
    // usa superficies claras para no verse como un parche de otra app.
    const ui = esInterno ? {
        panel: 'bg-zinc-100 border-zinc-300',
        headerBorde: 'border-zinc-300',
        titulo: 'text-cyan-700/90',
        codigo: 'text-zinc-700',
        botonHeader: 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200',
        canvas: 'bg-gradient-to-b from-zinc-100 to-zinc-300',
        cargandoTxt: 'text-zinc-500',
        drawer: 'bg-zinc-100 border-zinc-300',
        etiqueta: 'text-zinc-500',
        cardBorde: 'border-zinc-300 hover:border-zinc-400',
        cardTxt: 'text-zinc-600',
        swatchBorde: 'border-zinc-300 group-hover:border-zinc-400',
        swatchTxt: 'text-zinc-600',
        separador: 'border-zinc-300',
        pestania: 'bg-white border-zinc-400 text-zinc-500 hover:text-zinc-900',
        pie: 'border-zinc-300 text-zinc-500',
        padFondo: 'bg-white',
        barraFondo: 'bg-zinc-100',
    } : {
        panel: 'bg-zinc-900 border-zinc-700',
        headerBorde: 'border-zinc-800',
        titulo: 'text-cyan-400/80',
        codigo: 'text-zinc-300',
        botonHeader: 'text-zinc-400 hover:text-white hover:bg-zinc-800',
        canvas: 'bg-gradient-to-b from-zinc-900 to-zinc-800',
        cargandoTxt: 'text-zinc-400',
        drawer: 'bg-zinc-900 border-zinc-800',
        etiqueta: 'text-zinc-500',
        cardBorde: 'border-zinc-700 hover:border-zinc-500',
        cardTxt: 'text-zinc-400',
        swatchBorde: 'border-zinc-700 group-hover:border-zinc-500',
        swatchTxt: 'text-zinc-400',
        separador: 'border-zinc-800',
        pestania: 'bg-zinc-950 border-zinc-600 text-zinc-300 hover:text-white',
        pie: 'border-zinc-800 text-zinc-500',
        padFondo: 'bg-zinc-950',
        barraFondo: 'bg-zinc-900',
    };
    const rutas = esInterno ? {
        capas: `${API_BASE_URL}/orders/${ordenId}/tpu-model`,
        archivo: (id) => `${API_BASE_URL}/orders/${ordenId}/tpu-model/archivo/${id}`,
        texturas: `${API_BASE_URL}/orders/${ordenId}/texturas`,
        bocetoAprobado: `${API_BASE_URL}/orders/${ordenId}/boceto-aprobado`,
        metodoGuardar: 'PUT',
    } : {
        capas: `${API_BASE_URL}/web-orders/tpu-model/${ordenId}`,
        archivo: (id) => `${API_BASE_URL}/web-orders/tpu-model/${ordenId}/archivo/${id}`,
        texturas: `${API_BASE_URL}/web-orders/orden/${ordenId}/texturas`,
        bocetoAprobado: `${API_BASE_URL}/web-orders/orden/${ordenId}/boceto-aprobado`,
        metodoGuardar: 'POST',
    };
    const mountRef = useRef(null);
    const downEnOverlay = useRef(false);
    const [estado, setEstado] = useState('cargando'); // cargando | listo | error
    const [errorMsg, setErrorMsg] = useState('');

    // Zonas del boceto (capas del PDF) y la textura elegida para cada una.
    const [zonas, setZonas] = useState([]);           // [{ idx, nombre }] — idx 0 = la de más arriba
    const [texturas, setTexturas] = useState([]);     // catálogo (carpeta assets/textures)
    const [elecciones, setElecciones] = useState({}); // { zonaIdx: 'lino-crudo.svg' }
    const [barnices, setBarnices] = useState({});     // { zonaIdx: true } — barniz sectorizado
    const [zonaActiva, setZonaActiva] = useState(0); // null = ninguna (parche sin marcar)
    // Arranca cerrado: el modal abre mostrando el parche. Se despliega al tocar una zona y se
    // vuelve a cerrar al elegir la textura, que es cuando el cliente quiere ver cómo quedó.
    const [panelAbierto, setPanelAbierto] = useState(false);
    // Ojo del header: saca de encima la pestaña del cajón, el joystick y la barra de escala, para
    // mirar el parche sin nada arriba. No cambia nada de lo elegido, solo esconde los controles.
    const [controlesVisibles, setControlesVisibles] = useState(true);
    // El ojo no desmonta nada: desvanece. Así el fade se ve en las dos direcciones (un elemento
    // que se desmonta no puede animar su salida) y no hay que orquestar timers.
    const fade = `transition-opacity duration-200 ${controlesVisibles ? 'opacity-100' : 'opacity-0 pointer-events-none'}`;
    const [errorGuardado, setErrorGuardado] = useState('');
    const [guardando, setGuardando] = useState(false);
    const escenaRef = useRef(null);                   // { componer, anchoRenderPx }
    const tilesRef = useRef(new Map());               // clave archivo|rep|alt → canvas del tile
    const ultimoGuardado = useRef('{}');              // evita re-postear lo que se acaba de cargar

    // Cómo queda PUESTA la textura en cada zona: escala, altura del relieve y corrimiento.
    // Va por ZONA y no por textura: la misma textura puede ir en dos zonas y no tiene por qué
    // quedar igual puesta en las dos. Lo que no está tocado sale del catálogo (texturas.json).
    const [ajustes, setAjustes] = useState({});       // zonaIdx → { escala, altura, dx, dy }
    // Copia DIFERIDA, solo para lo que obliga a rehacer el tile (escala y altura): un slider
    // dispara un cambio por píxel de arrastre y regenerar la textura cuesta un canvas entero más
    // dos recorridos píxel a píxel. El pad de mover NO pasa por acá — corre la trama sin tocar el
    // tile, así que tiene que responder al instante.
    const [ajustesTile, setAjustesTile] = useState({});
    useEffect(() => {
        const id = setTimeout(() => setAjustesTile(ajustes), 80);
        return () => clearTimeout(id);
    }, [ajustes]);

    const acotar = (v, min, max) => Math.min(max, Math.max(min, v));
    const ajusteDe = (zona, t, fuente = ajustes) => {
        const a = fuente[zona] || {};
        return {
            escala: acotar(Number(a.escala ?? 1), ESCALA_MIN, ESCALA_MAX),
            // Altura sin control por ahora: todas las texturas van al relieve máximo. Se sigue
            // guardando y respetando lo que ya esté guardado, así que volver a mostrar el slider
            // es solo devolverlo a la barra.
            altura: acotar(Number(a.altura ?? ALTURA_MAX), ALTURA_MIN, ALTURA_MAX),
            dx: acotar(Number(a.dx ?? 0.5), 0, 1),
            dy: acotar(Number(a.dy ?? 0.5), 0, 1),
        };
    };
    // Repeticiones que se le pide al tile: la base del catálogo dividida por la escala elegida.
    const repeticionesDe = (t, escala) => (Number(t?.repeticiones) || 2) / Math.max(0.05, escala);

    // Textura de la zona seleccionada y sus perillas. Los controles viven en dos lugares (el
    // joystick sobre el render, la escala en la barra de abajo) y los dos leen de acá.
    const texturaActiva = (zonaActiva !== null && elecciones[zonaActiva])
        ? texturas.find(x => x.archivo === elecciones[zonaActiva])
        : null;
    const ajusteActivo = texturaActiva ? ajusteDe(zonaActiva, texturaActiva) : null;
    const setAjuste = (campo, valor) => setAjustes(p => ({ ...p, [zonaActiva]: { ...ajusteActivo, [campo]: valor } }));
    const moverTextura = (dx, dy) => setAjustes(p => ({ ...p, [zonaActiva]: { ...ajusteActivo, dx, dy } }));

    // Catálogo de texturas
    useEffect(() => {
        let vivo = true;
        fetch(`${API_BASE_URL}/web-orders/texturas-tpu`, { headers: authHeaders() })
            .then(r => r.json())
            .then(j => { if (vivo && j?.success) setTexturas(j.data || []); })
            .catch(() => { /* sin catálogo: el visor sigue andando, solo no hay texturas */ });
        return () => { vivo = false; };
    }, []);

    // Fase del pedido, para decidir quién puede tocar las texturas. null = todavía no se sabe:
    // hasta que llegue, nadie edita (si la lectura falla, se queda en mirar, que es lo seguro).
    const [estadoTpu, setEstadoTpu] = useState(null); // { aprobado, eligeCliente, texturasElige }
    // Interno: el diseñador levanta el candado a propósito para corregir una elección del cliente.
    const [desbloqueado, setDesbloqueado] = useState(false);

    // ¿Quién puede elegir acá?
    //  · Interno — solo si las texturas las define el diseñador ('DISENADOR'). En los otros dos
    //    casos (el cliente las eligió, o todavía no aprobó) el visor abre como "ver": se puede
    //    editar igual, pero levantando el candado, y eso queda en el historial de la orden.
    //  · Cliente — solo mientras el pedido espera su aprobación Y le toca elegir a él. Aprobado,
    //    el visor sigue abriéndose para ver lo que quedó, sin poder cambiarlo.
    const puedeElegir = esInterno
        ? (desbloqueado || estadoTpu?.texturasElige === 'DISENADOR')
        : !!estadoTpu && !estadoTpu.aprobado && estadoTpu.eligeCliente !== false;
    const conCandado = esInterno && !desbloqueado && estadoTpu?.texturasElige !== 'DISENADOR';

    // Elección ya guardada (reabrir el visor tiene que mostrar lo que había elegido)
    useEffect(() => {
        let vivo = true;
        fetch(rutas.texturas, { headers: authHeaders() })
            .then(r => r.json())
            .then(j => {
                if (!vivo || !j?.success) return;
                const e = {}, b = {}, a = {};
                (j.data || []).forEach(r => {
                    if (r.ArchivoTextura) e[r.ZonaIndice] = r.ArchivoTextura;
                    if (r.Barniz) b[r.ZonaIndice] = true;
                    // Solo lo que está guardado de verdad: lo que venga NULL lo resuelve ajusteDe
                    // con el default del catálogo. Sembrar defaults acá haría que el estado inicial
                    // no coincidiera con ultimoGuardado y el visor abriría diciendo "hay cambios".
                    const aj = {};
                    if (r.Escala != null) aj.escala = Number(r.Escala);
                    if (r.Altura != null) aj.altura = Number(r.Altura);
                    if (r.OffsetX != null) aj.dx = Number(r.OffsetX);
                    if (r.OffsetY != null) aj.dy = Number(r.OffsetY);
                    if (Object.keys(aj).length) a[r.ZonaIndice] = aj;
                });
                ultimoGuardado.current = JSON.stringify({ e, b, a });
                setElecciones(e);
                setBarnices(b);
                // Los dos a la vez: si el diferido arranca vacío, el primer armado usa la escala
                // por defecto del catálogo y 80 ms después la corrige a la vista.
                setAjustes(a);
                setAjustesTile(a);
                setEstadoTpu({
                    aprobado: !!j.aprobado,
                    eligeCliente: j.eligeCliente !== false,
                    texturasElige: j.texturasElige || null,
                });
            })
            .catch(() => { /* sin elección previa */ });
        return () => { vivo = false; };
    }, [ordenId]);

    // Nada se persiste hasta que se aprieta "Guardar cambios": probar texturas en el 3D no debe
    // dejar rastro si el cliente no confirma.
    const estadoActual = JSON.stringify({ e: elecciones, b: barnices, a: ajustes });
    const hayCambios = estadoActual !== ultimoGuardado.current;

    // Arma el PNG del boceto aprobado (parche renderizado + referencia por zona) y lo manda a
    // archivos de referencia de la orden. Se llama al guardar, en los dos modos: del lado cliente
    // guardar ES aprobar, y del lado interno es el diseñador definiendo las texturas de un boceto
    // que el cliente aprobó "pelado" — en los dos casos queda documentado qué se va a fabricar.
    const archivarBoceto = async () => {
        try {
            const foto = escenaRef.current?.capturar?.();
            if (!foto) return;

            const filas = zonas.map((z) => {
                const archivo = elecciones[z.idx] || null;
                const t = archivo ? texturas.find((x) => x.archivo === archivo) : null;
                const a = t ? ajusteDe(z.idx, t) : null;
                const partes = [];
                if (a) partes.push(`Escala ${a.escala.toFixed(1)}×`, `Altura ${a.altura.toFixed(2)}`);
                partes.push(barnices[z.idx] ? 'Con barniz' : 'Sin barniz');
                return {
                    mini: z.mini,
                    zona: z.nombre,
                    // Una textura que ya no está en la carpeta se nombra igual: producción tiene que
                    // ver que hay algo elegido que no se puede resolver, no un "sin textura" falso.
                    textura: t ? t.nombre : (archivo ? `${archivo} — no encontrada` : 'Sin textura'),
                    texturaUrl: t?.url || null,
                    detalle: partes.join(' · '),
                };
            });

            const blob = await armarImagenAprobacion({
                foto,
                codigo,
                fecha: new Date().toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }),
                filas,
            });
            if (!blob) return;

            // El mismo detalle en texto, para que se lea desde la lista de referencias sin abrir la imagen.
            const resumen = filas.map(f => `${f.zona}: ${f.textura} (${f.detalle})`).join('\n');
            const fd = new FormData();
            fd.append('file', blob, `BOCETO APROBADO - ${String(codigo || ordenId).replace(/\//g, '-')}.png`);
            fd.append('resumen', resumen);
            // Sin Content-Type a mano: lo pone el browser con el boundary del multipart.
            await fetch(rutas.bocetoAprobado, { method: 'POST', headers: authHeaders(), body: fd });
        } catch (e) {
            console.warn('[TPU-3D] No se pudo archivar el boceto aprobado:', e);
        }
    };

    // Interno: guarda la elección del diseñador y listo.
    // Cliente: guardar ES aprobar — elige sus texturas y con eso el boceto queda aprobado (las dos
    // vías del portal terminan en aprobación; la otra es el ✓ pelado, donde elige el diseñador).
    const guardar = async () => {
        setGuardando(true);
        setErrorGuardado('');
        try {
            if (hayCambios) {
                // Una entrada por zona tocada, con textura, barniz y cómo queda puesta.
                const zonasPayload = {};
                for (const k of new Set([...Object.keys(elecciones), ...Object.keys(barnices), ...Object.keys(ajustes)])) {
                    const archivo = elecciones[k] || null;
                    const t = archivo ? texturas.find(x => x.archivo === archivo) : null;
                    // Sin textura no hay puesta en página que guardar: van los campos en null y el
                    // backend deja los valores que ya estaban.
                    const a = t ? ajusteDe(k, t) : {};
                    zonasPayload[k] = { textura: archivo, barniz: !!barnices[k], ...a };
                }
                const r = await fetch(rutas.texturas, {
                    method: rutas.metodoGuardar,
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ elecciones: zonasPayload }),
                });
                if (!r.ok) {
                    const j = await r.json().catch(() => ({}));
                    setErrorGuardado(j.error || 'No se pudo guardar la elección.');
                    return;
                }
                ultimoGuardado.current = estadoActual;
            }

            // El PNG del boceto aprobado. NUNCA puede frenar la aprobación: si falla el render, la
            // subida o Drive, se avisa por consola y se sigue. Va antes de aprobar para que, cuando
            // producción vea la orden aprobada, el documento ya esté ahí.
            await archivarBoceto();

            if (!esInterno) {
                const rAprob = await fetch(`${API_BASE_URL}/web-orders/aprobar-pedido`, {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ordenId }),
                });
                if (!rAprob.ok) {
                    const j = await rAprob.json().catch(() => ({}));
                    setErrorGuardado(j.error || 'No se pudo aprobar el pedido.');
                    return;
                }
                onAprobado?.();
                onClose?.();
            }
        } catch {
            setErrorGuardado('No se pudo guardar la elección (sin conexión).');
        } finally {
            setGuardando(false);
        }
    };

    // Repintar el arte cuando cambia una elección. No rearma la escena: recompone el canvas de
    // color y avisa a three.js con needsUpdate.
    useEffect(() => {
        const e = escenaRef.current;
        if (!e) return;
        let vivo = true;
        (async () => {
            const tiles = {}, corrimientos = {};
            for (const [idx, archivo] of Object.entries(elecciones)) {
                if (!archivo) continue;
                const t = texturas.find(x => x.archivo === archivo);
                if (!t) continue;
                const { dx, dy } = ajusteDe(idx, t);                         // al instante
                const { escala, altura } = ajusteDe(idx, t, ajustesTile);    // diferidos
                // La clave incluye escala y altura porque cambian el tile. dx/dy NO: mover la
                // textura es solo dibujar el mismo tile desde otro origen, y regenerarlo por cada
                // píxel de arrastre haría que el pad se sintiera pesado.
                const clave = `${archivo}|${escala}|${altura}`;
                if (!tilesRef.current.has(clave)) {
                    // null = textura que no cargó: la zona queda sin relieve en vez de romper el render.
                    let tile = null;
                    try { tile = await cargarTile(t.url, e.anchoRenderPx, repeticionesDe(t, escala), altura); } catch { tile = null; }
                    tilesRef.current.set(clave, tile);
                }
                tiles[idx] = tilesRef.current.get(clave);
                corrimientos[idx] = { dx, dy };
            }
            if (vivo) e.componer(tiles, barnices, corrimientos);
        })();
        return () => { vivo = false; };
    }, [elecciones, barnices, texturas, ajustes, ajustesTile, estado]);


    useEffect(() => {
        let vivo = true;
        let limpiar = null;

        // Lo setea el armado de la escena; componer() lo llama para redibujar tras un cambio de
        // textura (con render bajo demanda, sin esto el cambio no se vería hasta mover la cámara).
        let pedirRender = () => {};

        (async () => {
            try {
                // 1. Capas disponibles
                const resCapas = await fetch(rutas.capas, { headers: authHeaders() });
                const jCapas = await resCapas.json();
                if (!resCapas.ok) throw new Error(jCapas.error || 'No se pudieron obtener las capas.');
                const capas = jCapas.capas || {};
                // Capa de arte: el BOCETO DE PRODUCCIÓN — es lo que el cliente está aprobando y lo
                // único que existe en ese momento (el resto del arte se sube después). El cmyk queda
                // como fallback para las órdenes anteriores al cambio de flujo, que no tienen boceto.
                const capaArte = capas.boceto || capas.cmyk;
                if (!capaArte) throw new Error('El pedido todavía no tiene el boceto cargado.');

                const traer = async (archivoId) => {
                    const r = await fetch(rutas.archivo(archivoId), { headers: authHeaders() });
                    if (!r.ok) throw new Error('No se pudo leer una capa del arte.');
                    return r.arrayBuffer();
                };

                // 2. Abrir capas: SOLO el arte (color) y corte (silueta). El relieve no se usa en el
                // visor — sus surcos finos no se pueden mallar bien y arruinaban el negro del arte.
                // En la aprobación por boceto el corte todavía no existe: la silueta sale de la
                // propia tinta del boceto (mismo camino que ya se usaba cuando faltaba el corte).
                const [bufArte, bufCorte] = await Promise.all([
                    traer(capaArte),
                    capas.corte ? traer(capas.corte) : null,
                ]);
                if (!vivo) return;
                const pdfArte = await abrirPdf(bufArte);
                const pdfCorte = bufCorte ? await abrirPdf(bufCorte) : null;
                if (!vivo) return;

                // Capa "extras" del boceto: anotaciones/medidas del diseñador para producción — NO
                // es parte del parche. Se apaga para TODO el 3D: si se dibujara, las notas saldrían
                // impresas en el arte, su tinta agrandaría la silueta y aparecería como una zona más.
                const occArte = await pdfArte.pdf.getOptionalContentConfig();
                const esCapaExtras = (n) => /^\s*extras?\s*$/i.test(String(n || ''));
                const idsCapas = (occArte.getOrder() || []).filter(x => typeof x === 'string');
                for (const id of idsCapas) {
                    if (esCapaExtras(occArte.getGroup(id)?.name)) occArte.setVisibility(id, false);
                }

                // 3a. PASADA 1 (barata, plancha entera a baja resolución): detectar dónde está UNA copia.
                const rasterFull = (pdf, maxDim, occ = null) => {
                    const e = maxDim / Math.max(pdf.baseW, pdf.baseH);
                    return rasterizar(pdf, { scale: e, outW: pdf.baseW * e, outH: pdf.baseH * e, occ });
                };
                const cvGuia = pdfCorte ? await rasterFull(pdfCorte, 1400) : await rasterFull(pdfArte, 1400, occArte);
                if (!vivo) return;
                // Silueta: interior del corte; sin corte, interior de la tinta del arte
                // (no sirve el alpha pelado: la plancha puede traer fondo blanco OPACO).
                const silPlancha = interiorDeCorte(mascaraTinta(cvGuia));
                const fr = bboxUnaCopia(silPlancha);
                if (!fr) throw new Error('No se pudo detectar el diseño en la plancha.');

                // 3b. PASADA 2: re-rasterizar SOLO el recorte de esa copia, a resolución completa.
                // Antes se recortaba de la plancha ya rasterizada (~500px la copia) y se estiraba a
                // 1024: las líneas finas (negros) quedaban grises y lavadas.
                const pdfGuia = pdfCorte || pdfArte;
                const aspecto = ((fr.y1 - fr.y0) * pdfGuia.baseH) / ((fr.x1 - fr.x0) * pdfGuia.baseW);
                const W = 1024, H = Math.max(64, Math.round(W * aspecto));
                const rasterCrop = (pdf, occ = null) => {
                    const s = W / ((fr.x1 - fr.x0) * pdf.baseW);
                    return rasterizar(pdf, {
                        scale: s,
                        sx: fr.x0 * pdf.baseW * s,
                        sy: fr.y0 * pdf.baseH * s,
                        outW: W,
                        outH: H,
                        occ,
                    });
                };
                const cvArteCrop = await rasterCrop(pdfArte, occArte);
                const cvCorteCrop = pdfCorte ? await rasterCrop(pdfCorte) : null;
                if (!vivo) return;

                // 3c. ZONAS: cada capa (OCG) del boceto es una zona texturable — menos "extras".
                // Se rasteriza el MISMO recorte una vez por capa, con solo esa capa visible →
                // máscaras alineadas al píxel con el arte. getOrder() viene de arriba hacia abajo
                // del panel de capas, o sea en orden de prioridad: la primera que cubre un píxel gana.
                const idsZonas = idsCapas.filter(id => !esCapaExtras(occArte.getGroup(id)?.name));
                const mascarasZona = [];
                for (const id of idsZonas) {
                    for (const [otro] of occArte) occArte.setVisibility(otro, otro === id);
                    const cv = await rasterCrop(pdfArte, occArte);
                    if (!vivo) return;
                    const msk = mascaraTinta(cv);
                    // Una capa sin tinta dentro del recorte no sirve como zona (queda fuera de la
                    // copia aislada, o es una capa de guías): se descarta en vez de ofrecer una
                    // zona que al pintarla no cambia nada.
                    if (msk.m.some(v => v)) mascarasZona.push({ id, msk, nombre: occArte.getGroup(id)?.name || '' });
                }
                // Restaurar: todo visible MENOS extras (que queda apagada para siempre en este visor).
                for (const [otro, g] of occArte) occArte.setVisibility(otro, !esCapaExtras(g?.name));

                // Silueta del recorte (a resolución completa) — y solo el componente mayor, por si
                // entra una puntita de la copia vecina en el margen del recorte.
                const silCrop = interiorDeCorte(mascaraTinta(cvCorteCrop || cvArteCrop));
                mantenerMayorComponente(silCrop);
                const cvSilCrop = mascaraACanvas(silCrop);

                // 4. Texturas: color (arte sobre base blanca) y alpha (silueta). Nada más:
                // el arte se muestra PLANO — solo arte + corte, sin relieve.
                const dSil = cvSilCrop.getContext('2d').getImageData(0, 0, W, H).data;
                const dArt = cvArteCrop.getContext('2d').getImageData(0, 0, W, H).data;

                const cColor = document.createElement('canvas'); cColor.width = W; cColor.height = H;
                const cAlpha = document.createElement('canvas'); cAlpha.width = W; cAlpha.height = H;
                const iColor = cColor.getContext('2d').createImageData(W, H);
                const iAlpha = cAlpha.getContext('2d').createImageData(W, H);

                for (let i = 0; i < W * H; i++) {
                    const dentro = dSil[i * 4] > 127;
                    // Donde HAY tinta se usa el color del arte TAL CUAL, sin mezclarlo con el blanco
                    // de la base. El borde del arte viene con antialias y mascaraTinta lo cuenta como
                    // tinta desde alpha 6%: al mezclar, esos píxeles quedaban casi blancos y dibujaban
                    // un halo alrededor de todo el parche. El canal RGB del canvas no está
                    // premultiplicado, así que aun con alpha baja trae el color real del trazo.
                    // El blanco queda solo donde no hay nada de tinta (huecos reales del diseño).
                    const conTinta = dArt[i * 4 + 3] > 4;
                    const usarArte = dentro && conTinta;
                    iColor.data[i * 4]     = usarArte ? dArt[i * 4] : 255;
                    iColor.data[i * 4 + 1] = usarArte ? dArt[i * 4 + 1] : 255;
                    iColor.data[i * 4 + 2] = usarArte ? dArt[i * 4 + 2] : 255;
                    iColor.data[i * 4 + 3] = 255;
                    const va = dentro ? 255 : 0;
                    iAlpha.data[i * 4] = va; iAlpha.data[i * 4 + 1] = va; iAlpha.data[i * 4 + 2] = va; iAlpha.data[i * 4 + 3] = 255;
                }
                // EXTENSIÓN DEL BORDE: se empuja el color del arte unos píxeles fuera de la silueta,
                // para que al interpolar la textura en el filo haya arte de los dos lados en vez de
                // blanco. Es la causa real del halo: el alphaTest recorta bien, pero el color que
                // sobrevive al corte ya venía mezclado con el blanco de afuera.
                {
                    const lleno = new Uint8Array(W * H);
                    for (let i = 0; i < W * H; i++) lleno[i] = dSil[i * 4] > 127 ? 1 : 0;
                    const px = iColor.data;
                    for (let paso = 0; paso < COLOR_EXTIENDE_PX; paso++) {
                        const nuevos = [];
                        for (let y = 0; y < H; y++) {
                            for (let x = 0; x < W; x++) {
                                const i = y * W + x;
                                if (lleno[i]) continue;
                                let src = -1;
                                if (x > 0 && lleno[i - 1]) src = i - 1;
                                else if (x < W - 1 && lleno[i + 1]) src = i + 1;
                                else if (y > 0 && lleno[i - W]) src = i - W;
                                else if (y < H - 1 && lleno[i + W]) src = i + W;
                                if (src < 0) continue;
                                px[i * 4] = px[src * 4];
                                px[i * 4 + 1] = px[src * 4 + 1];
                                px[i * 4 + 2] = px[src * 4 + 2];
                                nuevos.push(i);
                            }
                        }
                        // Recién al terminar la pasada: si no, el color se arrastraría muchos píxeles
                        // en una sola vuelta en vez de avanzar de a uno.
                        for (const i of nuevos) lleno[i] = 1;
                    }
                }

                cColor.getContext('2d').putImageData(iColor, 0, 0);
                cAlpha.getContext('2d').putImageData(iAlpha, 0, 0);

                // 4b. Zonas listas para usar: la máscara de cada capa recortada por la silueta
                // (lo que quede fuera del parche no se pinta ni se puede clickear).
                const zonasPix = mascarasZona.map(z => {
                    const m = new Uint8Array(W * H);
                    for (let i = 0; i < W * H; i++) m[i] = (z.msk.m[i] && dSil[i * 4] > 127) ? 1 : 0;
                    return m;
                });

                // Zonas EXCLUYENTES: cada píxel pertenece a la capa MÁS ALTA que lo cubre, y se le
                // resta a las de abajo. Una capa "fondo" es una mancha que cubre todo el parche, con
                // las estrellas y los bastones dibujados ENCIMA: sin esto, texturizar el fondo pintaba
                // el parche entero (las otras zonas solo lo tapaban si además tenían textura elegida).
                // getOrder() viene de arriba hacia abajo, así que recorrer 0→n reparte por prioridad.
                const ocupado = new Uint8Array(W * H);
                for (const m of zonasPix) {
                    for (let i = 0; i < W * H; i++) {
                        if (!m[i]) continue;
                        if (ocupado[i]) m[i] = 0;
                        else ocupado[i] = 1;
                    }
                }

                const zonasAlpha = zonasPix.map(m => mascaraAAlpha({ m, w: W, h: H }));

                // MINI MAPA por zona: la silueta del parche en gris con esa zona en cian, reducida
                // a una miniatura. Va en el chip del cajón.
                // Se probaron dos caminos sobre el modelo y los dos fallan: el contorno, porque dos
                // zonas contiguas comparten borde y el mismo trazo marca las dos; y atenuar el resto,
                // porque lava el parche entero justo cuando el cliente lo está evaluando. El mapa
                // resuelve lo mismo sin tocar el render.
                const siluetaPix = new Uint8Array(W * H);
                for (let i = 0; i < W * H; i++) siluetaPix[i] = dSil[i * 4] > 127 ? 1 : 0;
                const cvSilueta = mascaraAColor({ m: siluetaPix, w: W, h: H }, [82, 82, 91]);
                const miniDe = (m) => {
                    const grande = document.createElement('canvas'); grande.width = W; grande.height = H;
                    const g = grande.getContext('2d');
                    g.drawImage(cvSilueta, 0, 0);
                    g.drawImage(mascaraAColor({ m, w: W, h: H }, [189, 12, 126]), 0, 0); // brand-magenta
                    const mw = 120, mh = Math.max(24, Math.round(mw * (H / W)));
                    const chico = document.createElement('canvas'); chico.width = mw; chico.height = mh;
                    chico.getContext('2d').drawImage(grande, 0, 0, mw, mh);
                    return chico.toDataURL('image/png');
                };
                const zonasMini = zonasPix.map(miniDe);

                // Mapa de RELIEVE. La textura NO pinta color: el color lo pone el arte y queda
                // arriba. La textura va abajo y solo deforma cómo pega la luz — que es como se ve
                // en el parche real (el material tiene trama, la tinta va encima).
                // Base NEGRA = nivel del parche. El tile llega invertido (trazo claro = alto), así que
                // lo que tenga textura SOBRESALE y una zona sin textura queda al ras, sin escalón.
                const cRelieve = document.createElement('canvas'); cRelieve.width = W; cRelieve.height = H;
                const ctxRelieve = cRelieve.getContext('2d');
                ctxRelieve.fillStyle = '#000000';
                ctxRelieve.fillRect(0, 0, W, H); // plano hasta que se elija una textura
                // Mapa de rugosidad: arranca todo mate y las zonas con barniz se pintan oscuras.
                const cBarniz = document.createElement('canvas'); cBarniz.width = W; cBarniz.height = H;
                const ctxBarniz = cBarniz.getContext('2d');
                const grisRug = (v) => `rgb(${v},${v},${v})`;
                ctxBarniz.fillStyle = grisRug(RUGOSIDAD_MATE);
                ctxBarniz.fillRect(0, 0, W, H);

                // Máscara que apaga el relieve hacia el borde: blanco en el interior, negro en el
                // filo. Se erosiona la silueta y después se desenfoca, para que el degradado empiece
                // en 0 justo en el contorno y no a mitad de camino.
                const cvApagaBorde = document.createElement('canvas'); cvApagaBorde.width = W; cvApagaBorde.height = H;
                {
                    const cvEro = document.createElement('canvas'); cvEro.width = W; cvEro.height = H;
                    const ctxE2 = cvEro.getContext('2d', { willReadFrequently: true });
                    ctxE2.filter = `blur(${BORDE_APAGADO_PX}px)`;
                    ctxE2.drawImage(cvSilCrop, 0, 0);
                    ctxE2.filter = 'none';
                    const iB = ctxE2.getImageData(0, 0, W, H);
                    for (let i = 0; i < W * H; i++) {
                        const v = iB.data[i * 4] > 235 ? 255 : 0; // umbral alto = erosión
                        iB.data[i * 4] = v; iB.data[i * 4 + 1] = v; iB.data[i * 4 + 2] = v; iB.data[i * 4 + 3] = 255;
                    }
                    ctxE2.putImageData(iB, 0, 0);

                    const ctxB = cvApagaBorde.getContext('2d');
                    ctxB.fillStyle = '#000000';
                    ctxB.fillRect(0, 0, W, H);
                    ctxB.filter = `blur(${BORDE_APAGADO_PX}px)`;
                    ctxB.drawImage(cvEro, 0, 0);
                    ctxB.filter = 'none';
                }

                const cTmp = document.createElement('canvas'); cTmp.width = W; cTmp.height = H;
                const ctxTmp = cTmp.getContext('2d');
                const ctxColor = cColor.getContext('2d');

                // Se pinta de MENOR a MAYOR prioridad para que la capa de arriba quede encima,
                // igual que en el PDF.
                const componer = (tiles, barnices = {}, corrimientos = {}) => {
                    // Barniz: la zona pasa a ser mucho menos rugosa, o sea que refleja la luz en
                    // vez de difundirla. Se recorta el gris con la máscara, igual que la textura.
                    ctxBarniz.globalCompositeOperation = 'source-over';
                    ctxBarniz.fillStyle = grisRug(RUGOSIDAD_MATE);
                    ctxBarniz.fillRect(0, 0, W, H);
                    for (let z = 0; z < zonasAlpha.length; z++) {
                        if (!barnices?.[z]) continue;
                        ctxTmp.globalCompositeOperation = 'source-over';
                        ctxTmp.clearRect(0, 0, W, H);
                        ctxTmp.fillStyle = grisRug(RUGOSIDAD_BARNIZ);
                        ctxTmp.fillRect(0, 0, W, H);
                        ctxTmp.globalCompositeOperation = 'destination-in';
                        ctxTmp.drawImage(zonasAlpha[z], 0, 0);
                        ctxBarniz.drawImage(cTmp, 0, 0);
                    }
                    texBarniz.needsUpdate = true;

                    ctxRelieve.globalCompositeOperation = 'source-over';
                    ctxRelieve.fillStyle = '#000000';
                    ctxRelieve.fillRect(0, 0, W, H);
                    for (let z = zonasAlpha.length - 1; z >= 0; z--) {
                        const tile = tiles?.[z];
                        if (!tile) continue;
                        // Corrimiento de la textura dentro de la zona: el patrón se pinta con el
                        // lienzo trasladado, así que se mueve la trama sin tocar el tile. Alcanza con
                        // media repetición para cada lado — más allá el dibujo se repite igual.
                        const c = corrimientos?.[z];
                        const ox = Math.round(((c?.dx ?? 0.5) - 0.5) * tile.width);
                        const oy = Math.round(((c?.dy ?? 0.5) - 0.5) * tile.height);
                        ctxTmp.globalCompositeOperation = 'source-over';
                        ctxTmp.clearRect(0, 0, W, H);
                        ctxTmp.save();
                        ctxTmp.translate(ox, oy);
                        ctxTmp.fillStyle = ctxTmp.createPattern(tile, 'repeat');
                        ctxTmp.fillRect(-ox, -oy, W, H);
                        ctxTmp.restore();
                        ctxTmp.globalCompositeOperation = 'destination-in';
                        ctxTmp.drawImage(zonasAlpha[z], 0, 0);
                        ctxRelieve.drawImage(cTmp, 0, 0);
                    }
                    // Apagar el relieve contra el borde, para que la lámina siga pegada a la base.
                    ctxRelieve.globalCompositeOperation = 'multiply';
                    ctxRelieve.drawImage(cvApagaBorde, 0, 0);
                    ctxRelieve.globalCompositeOperation = 'source-over';
                    texRelieve.needsUpdate = true;
                    pedirRender();
                };

                // La lámina del arte usa la silueta EXACTA — ni encogida ni agrandada. Encogerla
                // dejaba ver la base blanca; agrandarla destapa el blanco del propio canvas de color.
                // Quien se corre es la base (ver BASE_ACHICA_PX más abajo).
                const cAlphaArte = cAlpha;

                // 5. Contornos de la silueta (a escala reducida) → polígonos con agujeros.
                // d3-contour (marching squares): devuelve los anillos YA armados por polígono
                // (exterior + agujeros) e interpola las diagonales — el trazador casero armaba
                // lazos cruzados y la pared salía con bandas tipo código de barras.
                // La base se traza con la silueta ACHICADA unos píxeles, para que quede por dentro
                // de la lámina del arte. Si la base es igual o más grande, su blanco asoma alrededor
                // del diseño mirando de frente. Dilatar el arte en vez de achicar la base NO sirve:
                // fuera de la silueta el canvas de color es blanco, así que agrandar el alpha lo
                // único que hace es destapar más blanco.
                const CW = 640, CH = Math.max(40, Math.round(CW * aspecto));
                const cvSilChico = recortarFraccion(cvSilCrop, { x0: 0, x1: 1, y0: 0, y1: 1 }, CW, CH);
                // A un canvas APARTE: dibujarlo sobre sí mismo con filtro no erosiona nada.
                const cvSilErosion = document.createElement('canvas');
                cvSilErosion.width = CW; cvSilErosion.height = CH;
                {
                    const ctxS = cvSilErosion.getContext('2d', { willReadFrequently: true });
                    ctxS.filter = `blur(${BASE_ACHICA_PX}px)`;
                    ctxS.drawImage(cvSilChico, 0, 0);
                    ctxS.filter = 'none';
                }
                const dChico = cvSilErosion.getContext('2d').getImageData(0, 0, CW, CH).data;
                const valores = new Float64Array(CW * CH);
                // Umbral ALTO sobre el desenfoque = erosión: la silueta se encoge.
                for (let i = 0; i < CW * CH; i++) valores[i] = dChico[i * 4] > 230 ? 1 : 0;

                const { contours } = await import('d3-contour');
                const multi = contours().size([CW, CH]).thresholds([0.5])(valores)[0];
                if (!multi || !multi.coordinates.length) throw new Error('No se pudo trazar el contorno del parche.');

                const anchoMundo = 10;
                const altoMundo = anchoMundo * (H / W);
                const aMundo = ([px, py]) => [
                    (px / CW - 0.5) * anchoMundo,
                    (0.5 - py / CH) * altoMundo,
                ];
                // Cada polígono = [anillo exterior, ...agujeros]. Se simplifica cada anillo (RDP)
                // y se descartan motas (área ínfima respecto del mayor).
                const areaAbs = (pts) => {
                    let a = 0;
                    for (let i = 0; i < pts.length; i++) {
                        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
                        a += x1 * y2 - x2 * y1;
                    }
                    return Math.abs(a / 2);
                };
                let poligonos = multi.coordinates.map(anillos =>
                    anillos.map(an => {
                        const abierto = an.length > 1 ? an.slice(0, -1) : an; // GeoJSON cierra repitiendo el 1º punto
                        return simplificar(abierto, 1.1).map(aMundo);
                    }).filter(an => an.length >= 3)
                ).filter(p => p.length > 0);
                const mayor = Math.max(...poligonos.map(p => areaAbs(p[0])));
                poligonos = poligonos.filter(p => areaAbs(p[0]) > mayor * 0.001);
                if (!poligonos.length) throw new Error('No se pudo trazar el contorno del parche.');

                // 6. Escena three.js (lazy)
                const THREE = await import('three');
                const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
                if (!vivo || !mountRef.current) return;

                const shapes = poligonos.map(([exterior, ...huecos]) => {
                    const s = new THREE.Shape(exterior.map(([x, y]) => new THREE.Vector2(x, y)));
                    for (const hueco of huecos) {
                        s.holes.push(new THREE.Path(hueco.map(([x, y]) => new THREE.Vector2(x, y))));
                    }
                    return s;
                });

                const cont = mountRef.current;
                const ancho = cont.clientWidth, alto = cont.clientHeight;

                const escena = new THREE.Scene();
                const camara = new THREE.PerspectiveCamera(38, ancho / alto, 0.1, 200);
                // Encuadre automático: distancia para que la pieza ENTERA entre en el campo visual
                // (con parches altos la cámara fija arrancaba recortada / con demasiado zoom).
                const radio = Math.hypot(anchoMundo, altoMundo) / 2;
                const fitDist = (radio / Math.sin(THREE.MathUtils.degToRad(38 / 2))) * 1.12;
                camara.position.set(0, -fitDist * 0.18, fitDist);

                // DPR tope 1.5: con 2 en pantallas grandes el canvas se va a millones de píxeles
                // y la rotación se siente pesada. A 1.5 no se nota y vuela.
                // preserveDrawingBuffer: al aprobar hay que sacarle una foto al render (el PNG que
                // se archiva). Sin esto el navegador puede descartar el buffer apenas compone el
                // frame y toDataURL devuelve un canvas en blanco. Con la escena estática y el
                // render bajo demanda, el costo es despreciable.
                const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
                renderer.setSize(ancho, alto);
                cont.appendChild(renderer.domElement);

                const texColor = new THREE.CanvasTexture(cColor);
                texColor.colorSpace = THREE.SRGBColorSpace;
                texColor.anisotropy = renderer.capabilities.getMaxAnisotropy();

                // Base: EXTRUSIÓN de la silueta, TODA blanca (tapas y paredes) — el DORSO del
                // parche real es blanco. Antes las dos tapas llevaban el arte y de atrás se veía
                // el diseño espejado (y girarlo parecía "solo un espejo", como si no rotara).
                const GROSOR = 0.25; // espesor del parche, en unidades de escena (10 de ancho)
                const BISEL = 0.03; // ojo: el bisel EXTIENDE la tapa frontal hasta GROSOR + BISEL
                const geoBase = new THREE.ExtrudeGeometry(shapes, {
                    depth: GROSOR,
                    bevelEnabled: true,
                    bevelThickness: BISEL,
                    bevelSize: BISEL,
                    bevelSegments: 2,
                    curveSegments: 2,
                });
                const matBlanco = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58, metalness: 0 });
                const base = new THREE.Mesh(geoBase, matBlanco);
                escena.add(base);

                // Arte: lámina PLANA solo del frente (el dorso queda blanco), con el alpha
                // DILATADO para que no asome la base blanca por el borde visto de frente.
                const texAlphaArte = new THREE.CanvasTexture(cAlphaArte);
                // Sin mipmaps: es una máscara de recorte, no una imagen. Con mipmaps, mirando el
                // parche de canto cada píxel abarca media textura, el alpha se promedia, pasa el
                // alphaTest donde debería descartar y aparecen líneas del color de afuera de la
                // silueta (blanco) arriba y abajo del canto.
                texAlphaArte.generateMipmaps = false;
                texAlphaArte.minFilter = THREE.LinearFilter;
                texAlphaArte.magFilter = THREE.LinearFilter;
                // Relieve de las texturas elegidas: mapa en grises que solo altera la normal, así
                // el material se lee en la luz sin tocar el color del arte.
                const texRelieve = new THREE.CanvasTexture(cRelieve);
                texRelieve.anisotropy = renderer.capabilities.getMaxAnisotropy();
                const texBarniz = new THREE.CanvasTexture(cBarniz);
                // Lámina subdividida: el desplazamiento mueve VÉRTICES, así que sin segmentos no
                // pasa nada. 256 alcanza y sobra — con 1 a 3 repeticiones los rasgos del tile son
                // grandes.
                // Lámina llana (4 vértices): la textura se lee SOLO por sombreado (bumpMap). Hubo un
                // modo con displacementMap y malla subdividida y se sacó — pesaba (lectura de textura
                // por vértice) y con las texturas reales no aportaba: el relieve de un parche TPU es
                // demasiado fino para la malla y aparecía como ruido antes que como volumen.
                const geoArteLlana = new THREE.PlaneGeometry(anchoMundo, altoMundo, 1, 1);
                const matArte = new THREE.MeshStandardMaterial({
                    map: texColor,
                    alphaMap: texAlphaArte,
                    bumpMap: texRelieve,
                    bumpScale: RELIEVE_FUERZA,
                    // roughness 1 para que el mapa mande sin atenuarse (three lo multiplica).
                    roughnessMap: texBarniz,
                    roughness: 1,
                    transparent: true,
                    alphaTest: 0.5,
                    metalness: 0,
                });
                const laminaArte = new THREE.Mesh(geoArteLlana, matArte);
                // Por ENCIMA del bisel: a GROSOR + 0.02 quedaba DENTRO del sólido (la tapa con
                // bisel llega a GROSOR + BISEL) y la base blanca tapaba el arte entero.
                laminaArte.position.z = GROSOR + BISEL + 0.015;
                escena.add(laminaArte);

                // El relieve se lee por cómo cambia el sombreado con la normal, y una hemisférica
                // fuerte lo APLANA (ilumina casi igual venga de donde venga). Se baja la ambiente y
                // se sube la direccional: mismo brillo general, mucho más contraste de relieve.
                // Ambiente NEUTRA: el gris de abajo estaba en 0x555566 (azulado) y ese tinte le
                // comía saturación al amarillo del escudo.
                escena.add(new THREE.HemisphereLight(0xffffff, 0x555555, 0.65));
                // 3.0 y no 2.2: con three 0.185 las luces son físicas (la contribución difusa de una
                // direccional es I·(N·L)/π), y sumando las tres el parche recibía ~0.78 — o sea que
                // el color salía un 20% más apagado que el del boceto. A 3.0 la suma da ~0.98 y el
                // amarillo del PDF llega a pantalla como es. Sin tone mapping no hay nada más que lo
                // toque, así que el número es directo.
                const luz = new THREE.DirectionalLight(0xffffff, 3.0);
                luz.position.set(6, 8, 12);
                escena.add(luz);
                // Segunda direccional rasante desde el otro lado: sin ella hay ángulos de giro donde
                // la textura queda sin sombra y desaparece.
                const luz2 = new THREE.DirectionalLight(0xffffff, 0.8);
                luz2.position.set(-8, -4, 6);
                escena.add(luz2);

                // Rotar: arrastrar · Zoom: rueda / pinch · Mover (pan): botón derecho / dos dedos.
                const controles = new OrbitControls(camara, renderer.domElement);
                controles.enableDamping = true;
                controles.dampingFactor = 0.12;
                controles.rotateSpeed = 1.35;   // giro más ágil
                controles.zoomSpeed = 1.15;
                controles.enablePan = true;
                controles.screenSpacePanning = true;
                controles.minDistance = fitDist * 0.3;
                controles.maxDistance = fitDist * 3;

                // Render BAJO DEMANDA: la escena es estática, así que redibujar 60 veces por segundo
                // mientras nadie la toca es trabajo tirado — y en la app interna ese trabajo compite
                // con la tabla, el polling y los sockets de la pantalla de atrás.
                // controles.update() devuelve true mientras el damping sigue moviendo la cámara.
                let pedido = true;
                pedirRender = () => { pedido = true; };
                controles.addEventListener('change', pedirRender);
                renderer.setAnimationLoop(() => {
                    const moviendo = controles.update();
                    if (!moviendo && !pedido) return;
                    pedido = false;
                    renderer.render(escena, camara);
                });

                // Elegir zona tocándola en el parche. La lámina del arte tiene UVs 0..1, así que
                // del raycast sale directo la coordenada de píxel y se consulta qué máscara la cubre
                // (en orden de prioridad, igual que la composición).
                const raycaster = new THREE.Raycaster();
                const puntero = new THREE.Vector2();
                let desde = null;
                const alBajar = (ev) => { desde = [ev.clientX, ev.clientY]; };
                const alSoltar = (ev) => {
                    const ini = desde; desde = null;
                    // Un giro que termina sobre el canvas también dispara pointerup: si el puntero
                    // se movió, fue una rotación y no una selección.
                    if (!ini || Math.hypot(ev.clientX - ini[0], ev.clientY - ini[1]) > 5) return;
                    const r = renderer.domElement.getBoundingClientRect();
                    puntero.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
                    puntero.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
                    raycaster.setFromCamera(puntero, camara);
                    const hit = raycaster.intersectObject(laminaArte, false)[0];
                    // Tocar fuera del parche = "quiero ver el escudo limpio": se deselecciona la
                    // zona Y se cierra el cajón. Solo deseleccionar dejaba el cajón abierto pero
                    // vacío ("elegí una zona"), tapando el parche justo cuando se lo quiere mirar.
                    const soltarTodo = () => { setZonaActiva(null); setPanelAbierto(false); };
                    if (!hit?.uv) { soltarTodo(); return; }
                    const px = Math.min(W - 1, Math.max(0, Math.round(hit.uv.x * W)));
                    const py = Math.min(H - 1, Math.max(0, Math.round((1 - hit.uv.y) * H)));
                    const i = py * W + px;
                    for (let z = 0; z < zonasPix.length; z++) {
                        // Tocar una zona del parche despliega el cajón con sus texturas.
                        if (zonasPix[z][i]) { setZonaActiva(z); setPanelAbierto(true); return; }
                    }
                    // Impacto en la lámina pero fuera de la silueta (el rectángulo del plano llega
                    // más lejos que el parche): mismo caso que tocar el fondo.
                    soltarTodo();
                };
                renderer.domElement.addEventListener('pointerdown', alBajar);
                renderer.domElement.addEventListener('pointerup', alSoltar);

                // El alto del canvas no es fijo: en mobile ocupa lo que sobra, y el panel de texturas
                // recién aparece cuando el modelo está listo — o sea DESPUÉS de este setup. Sin esto
                // el render se quedaba con la medida vieja y salía estirado.
                let ultimoW = ancho, ultimoH = alto;
                const ro = new ResizeObserver(() => {
                    pedirRender();
                    const w = cont.clientWidth, h = cont.clientHeight;
                    // Solo si CAMBIÓ de verdad: setSize reasigna el buffer de dibujo, y dejarlo
                    // dispararse con cada notificación del observer es tirar trabajo a la basura.
                    if (!w || !h || (w === ultimoW && h === ultimoH)) return;
                    ultimoW = w; ultimoH = h;
                    camara.aspect = w / h;
                    camara.updateProjectionMatrix();
                    renderer.setSize(w, h);
                });
                ro.observe(cont);

                limpiar = () => {
                    renderer.setAnimationLoop(null);
                    controles.removeEventListener('change', pedirRender);
                    ro.disconnect();
                    renderer.domElement.removeEventListener('pointerdown', alBajar);
                    renderer.domElement.removeEventListener('pointerup', alSoltar);
                    controles.dispose();
                    geoBase.dispose(); geoArteLlana.dispose();
                    matBlanco.dispose(); matArte.dispose();
                    texColor.dispose(); texAlphaArte.dispose(); texRelieve.dispose();
                    texBarniz.dispose();
                    renderer.dispose();
                    // dispose() libera lo que three subió a la GPU pero NO el contexto WebGL en sí:
                    // el navegador permite unos 16 vivos a la vez y abrir y cerrar el visor los iba
                    // acumulando ("Too many active WebGL contexts. Oldest context will be lost." en
                    // consola) hasta matar el más viejo — que podía ser el visor abierto.
                    renderer.forceContextLoss();
                    if (renderer.domElement.parentNode === cont) cont.removeChild(renderer.domElement);
                };

                // Foto del parche para el archivo de aprobación. SIEMPRE de frente y con el encuadre
                // inicial: el cliente pudo dejarlo girado o con zoom, y lo que se archiva tiene que
                // mostrar el parche entero. Al doble de resolución — updateStyle=false cambia solo el
                // buffer de dibujo, no el tamaño en pantalla, así que agrandar y volver no se ve.
                const capturar = () => {
                    const tam = new THREE.Vector2();
                    renderer.getSize(tam);
                    const camFoto = new THREE.PerspectiveCamera(38, tam.x / tam.y, 0.1, 200);
                    camFoto.position.set(0, 0, fitDist);
                    camFoto.lookAt(0, 0, 0);
                    renderer.setSize(tam.x * 2, tam.y * 2, false);
                    renderer.render(escena, camFoto);
                    const url = renderer.domElement.toDataURL('image/png');
                    renderer.setSize(tam.x, tam.y, false);
                    renderer.render(escena, camara); // deja la pantalla como estaba
                    return url;
                };

                escenaRef.current = { componer, anchoRenderPx: W, capturar };
                // Si el diseñador le puso nombre a la capa ("Fondo", "Estrellas") se muestra ese;
                // si quedó el default de Illustrator ("Capa 2") no dice nada útil y encima el orden
                // va al revés que la numeración, así que se usa "Zona N".
                const esNombrePorDefecto = (n) => !n || /^(capa|layer)\s*\d*$/i.test(String(n).trim());
                setZonas(mascarasZona.map((z, i) => ({
                    idx: i,
                    nombre: esNombrePorDefecto(z.nombre) ? `Zona ${i + 1}` : z.nombre,
                    mini: zonasMini[i],
                })));
                setEstado('listo');
            } catch (e) {
                console.warn('[TPU-3D] No se pudo armar el modelo:', e);
                if (vivo) { setErrorMsg(e.message || 'No se pudo armar el modelo 3D.'); setEstado('error'); }
            }
        })();

        return () => { vivo = false; if (limpiar) limpiar(); };
    }, [ordenId]);

    return createPortal(
        <div
            // Fondo OPACO, no translúcido: con transparencia el navegador tiene que recomponer todo
            // lo que hay detrás (en la app interna, la tabla del área entera) en cada frame del 3D.
            className="fixed inset-0 z-[9999] bg-black flex items-center justify-center p-0 sm:p-4"
            // Cerrar SOLO si el click empezó Y terminó en el overlay: un drag de rotación que
            // termina fuera del canvas generaba un click en el overlay y cerraba el modal.
            onMouseDown={(e) => { downEnOverlay.current = e.target === e.currentTarget; }}
            onClick={(e) => { if (downEnOverlay.current && e.target === e.currentTarget) onClose(); }}
        >
            {/* Mobile: pantalla completa, en columna — el canvas se queda con lo que sobra después
                del header y del panel de texturas. Desktop: modal centrado como siempre. */}
            <div className={`relative ${ui.panel} border-0 sm:border rounded-none sm:rounded-2xl w-full max-w-none sm:max-w-5xl xl:max-w-6xl shadow-2xl flex flex-col h-[100dvh] sm:h-auto sm:max-h-[95dvh] overflow-y-auto`}>
                <div className={`shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b ${ui.headerBorde}`}>
                    <div className="min-w-0 flex items-center gap-2">
                        <Rotate3d size={16} className="text-cyan-400 shrink-0" />
                        <div className="min-w-0">
                            <p className={`text-[10px] font-black uppercase tracking-widest ${ui.titulo}`}>Vista 3D del parche</p>
                            <p className={`text-xs font-bold ${ui.codigo} truncate`}>{codigo}</p>
                        </div>
                    </div>

                    {/* Acciones: candado (interno), ocultar controles y guardar. */}
                    <div className="shrink-0 flex items-center gap-1">
                        {/* Candado: solo interno y solo cuando el visor abrió como "ver" — o el
                            cliente eligió sus texturas, o todavía no aprobó. Levantarlo habilita la
                            edición; el PUT queda marcado como OPERARIO y con su línea en el historial,
                            porque se está cambiando lo que se fabrica respecto de lo que aprobó el cliente. */}
                        {estado === 'listo' && zonas.length > 0 && esInterno && (conCandado || desbloqueado) && (
                            <button
                                type="button"
                                onClick={() => setDesbloqueado(v => !v)}
                                title={desbloqueado
                                    ? 'Volver a solo ver'
                                    : 'Habilitar la edición (queda registrado en el historial de la orden)'}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                    desbloqueado ? 'text-amber-600 bg-amber-500/15' : ui.botonHeader
                                }`}
                            >{desbloqueado ? <LockOpen size={16} /> : <Lock size={16} />}</button>
                        )}

                        {estado === 'listo' && zonas.length > 0 && puedeElegir && (
                            <>
                                <button
                                    type="button"
                                    /* Cierra el cajón en las dos direcciones: si se tocó una zona
                                       con los controles ocultos, al volver a mostrarlos no tiene
                                       que aparecer el cajón desplegado de sorpresa. */
                                    onClick={() => { setControlesVisibles(v => !v); setPanelAbierto(false); }}
                                    title={controlesVisibles ? 'Ver el parche sin los controles' : 'Mostrar los controles'}
                                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                        controlesVisibles ? ui.botonHeader : 'text-cyan-300 bg-cyan-500/15'
                                    }`}
                                >{controlesVisibles ? <Eye size={16} /> : <EyeOff size={16} />}</button>

                                <button
                                    type="button"
                                    onClick={guardar}
                                    disabled={guardando || (esInterno && !hayCambios)}
                                    title={guardando
                                        ? 'Guardando…'
                                        : esInterno
                                            ? (hayCambios ? 'Guardar cambios' : 'No hay cambios sin guardar')
                                            : 'Aprobar el boceto con estas texturas'}
                                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 ${
                                        (esInterno ? hayCambios : true) ? 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25' : 'text-zinc-400'
                                    }`}
                                >{guardando
                                    ? <Loader2 size={16} className="animate-spin" />
                                    : esInterno ? <Save size={16} /> : <Check size={16} strokeWidth={3} />}</button>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className={`w-8 h-8 rounded-lg ${ui.botonHeader} flex items-center justify-center`}
                            title="Cerrar"
                        ><X size={16} /></button>
                    </div>
                </div>

                {/* Cuerpo: el canvas ocupa todo y el cajón de zonas/texturas se le monta encima por
                    la derecha. Al abrirlo y cerrarlo el canvas NO cambia de tamaño, así que no hay
                    reasignación del buffer de dibujo. */}
                {/* overflow-hidden: el cajón cerrado queda trasladado fuera del contenedor y, sin
                    esto, sigue contando para el ancho — aparecía una barra de scroll horizontal. */}
                <div className="relative flex-1 min-h-[240px] sm:flex-none sm:h-[78vh] xl:h-[82vh] sm:min-h-[420px] overflow-hidden">
                    <div ref={mountRef} className={`absolute inset-0 ${ui.canvas}`} />

                    {estado === 'cargando' && (
                        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 ${ui.cargandoTxt}`}>
                            <Loader2 size={28} className="animate-spin text-cyan-400" />
                            <span className="text-xs font-bold uppercase tracking-wide">Armando el modelo…</span>
                        </div>
                    )}
                    {estado === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400 px-8 text-center">
                            <span className="text-sm font-bold text-zinc-300">No se pudo armar el modelo 3D</span>
                            <span className="text-xs text-zinc-500">{errorMsg}</span>
                        </div>
                    )}

                    {/* El error de guardado va flotando sobre el canvas: guardar se dispara desde el
                        header, así que el aviso no puede vivir adentro del cajón (podría estar cerrado). */}
                    {errorGuardado && (
                        <div className="absolute left-3 bottom-3 right-3 sm:right-auto sm:max-w-sm z-20 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] text-amber-300">
                            {errorGuardado}
                        </div>
                    )}

                    {/* Todo lo de abajo (joystick, escala, pie) va SUPERPUESTO al canvas y NO en el
                        flujo del modal. Estando en el flujo, mostrarlo u ocultarlo le cambiaba el
                        alto al canvas → saltaba el ResizeObserver → se recalculaba la cámara y el
                        parche cambiaba de tamaño en pantalla. Ahora el canvas mide siempre igual y
                        el ojo no toca el render en absoluto. */}
                    {estado === 'listo' && (
                        <div className={`absolute inset-x-0 bottom-0 flex flex-col ${fade}`}>
                            {/* self-end: el bloque del joystick se achica a su contenido, así el
                                resto de la franja no se come los clicks de rotar el parche. */}
                            {puedeElegir && ajusteActivo && (
                                <div className="self-end mr-3 mb-2 flex flex-col items-center gap-1">
                                    <span className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest ${ui.etiqueta}`}>
                                        <Move size={10} /> Mover
                                    </span>
                                    <PadMover
                                        dx={ajusteActivo.dx} dy={ajusteActivo.dy}
                                        onChange={moverTextura}
                                        onReset={() => moverTextura(0.5, 0.5)}
                                        clase={`${ui.padFondo} ${ui.cardBorde} ${ui.cardTxt}`}
                                    />
                                </div>
                            )}

                            {puedeElegir && ajusteActivo && (
                                <div className={`border-t ${ui.separador} ${ui.barraFondo} px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1`}>
                                    <div className="min-w-0 max-w-[40%] sm:max-w-[9rem]">
                                        <p className={`text-[9px] font-black uppercase tracking-widest ${ui.etiqueta} leading-tight truncate`}>
                                            {zonas[zonaActiva]?.nombre || `Zona ${zonaActiva + 1}`}
                                        </p>
                                        <p className={`text-[11px] font-bold ${ui.codigo} truncate`}>{texturaActiva.nombre}</p>
                                    </div>

                                    <label className={`flex-1 min-w-[180px] flex items-center gap-2 text-[11px] ${ui.cardTxt}`}>
                                        <span className="w-11 shrink-0">Escala</span>
                                        <input
                                            type="range" min={ESCALA_MIN} max={ESCALA_MAX} step={ESCALA_PASO} value={ajusteActivo.escala}
                                            onChange={(e) => setAjuste('escala', Number(e.target.value))}
                                            className="flex-1 accent-cyan-400"
                                        />
                                        <span className={`w-11 text-right font-mono ${ui.codigo}`}>{ajusteActivo.escala.toFixed(1)}×</span>
                                    </label>
                                </div>
                            )}

                            <div className={`px-4 py-2 border-t ${ui.pie} ${ui.barraFondo} text-[11px] text-center`}>
                                {zonas.length > 0 && puedeElegir
                                    ? 'Tocá una parte del parche para elegir textura.'
                                    : 'Girá: arrastrá · Zoom: rueda o pinch · Mover: botón derecho o dos dedos'}
                            </div>
                        </div>
                    )}

                    {estado === 'listo' && zonas.length > 0 && puedeElegir && (
                    <>
                    <button
                        type="button"
                        onClick={() => setPanelAbierto(v => !v)}
                        /* bg-zinc-950: el canvas detrás es un degradado zinc-900→zinc-800 y la pestaña
                           cae justo donde el fondo vale casi lo mismo. Con un tono parecido, aunque sea
                           opaca, se lee como vidrio esmerilado. Necesita contrastar de verdad. */
                        className={`absolute top-1/2 -translate-y-1/2 z-10 w-6 h-16 rounded-l-lg border border-r-0 ${ui.pestania} flex items-center justify-center transition-all duration-150 ${
                            panelAbierto ? 'right-[78%] sm:right-72' : 'right-0'
                        } ${controlesVisibles ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                        title={panelAbierto ? 'Ocultar texturas' : 'Elegir texturas'}
                    >{panelAbierto ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}</button>

                    <aside className={`absolute inset-y-0 right-0 w-[78%] sm:w-72 ${ui.drawer} border-l overflow-y-auto transition-all duration-150 ${
                        panelAbierto ? 'translate-x-0' : 'translate-x-full'
                    } ${controlesVisibles ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <div className="p-3 space-y-2.5">
                        <div>
                            <span className={`block text-[10px] font-black uppercase tracking-widest ${ui.etiqueta} mb-1.5`}>Zona</span>
                            <div className="grid grid-cols-3 gap-2">
                                {zonas.map(z => (
                                    <button
                                        key={z.idx}
                                        type="button"
                                        onClick={() => setZonaActiva(z.idx)}
                                        className={`relative rounded-lg border p-1 transition-all ${
                                            zonaActiva === z.idx
                                                ? 'border-brand-magenta bg-brand-magenta/10'
                                                : ui.cardBorde + ' '
                                        }`}
                                        title={z.nombre}
                                    >
                                        {/* Qué tiene puesta la zona, arriba de todo y adentro del
                                            chip: el nombre de la textura y la chispa del barniz.
                                            Antes eran dos puntitos de color en las esquinas — decían
                                            que había algo, no QUÉ. Con los nombres a la vista se lee
                                            el parche entero sin ir zona por zona. */}
                                        {(elecciones[z.idx] || barnices[z.idx]) && (
                                            <span className="flex items-center justify-center gap-0.5 mb-0.5">
                                                {barnices[z.idx] && (
                                                    <Sparkles size={9} strokeWidth={2.5} className="text-cyan-300 shrink-0" />
                                                )}
                                                {elecciones[z.idx] && (
                                                    <span className="text-[9px] font-bold text-brand-magenta leading-tight truncate">
                                                        {texturas.find(x => x.archivo === elecciones[z.idx])?.nombre || elecciones[z.idx]}
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                        <img src={z.mini} alt="" className="w-full h-11 object-contain" />
                                        <span className={`block mt-0.5 text-[9px] font-bold uppercase tracking-wide truncate ${
                                            zonaActiva === z.idx ? 'text-brand-magenta' : ui.cardTxt
                                        }`}>{z.nombre}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Barniz de la zona activa. Vive acá y no en el header porque es una
                            decisión sobre LA ZONA, igual que la textura: separado arriba había que
                            acordarse de qué zona estaba seleccionada para saber a qué se aplicaba. */}
                        {zonaActiva !== null && (
                            <button
                                type="button"
                                onClick={() => setBarnices(p => ({ ...p, [zonaActiva]: !p[zonaActiva] }))}
                                title="Barniz sectorizado: la zona queda brillante en vez de mate"
                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-bold transition-colors ${
                                    barnices[zonaActiva]
                                        ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300'
                                        : `${ui.cardBorde} ${ui.cardTxt}`
                                }`}
                            >
                                <span className="flex items-center gap-1.5"><Sparkles size={13} /> Barniz</span>
                                <span className={`text-[9px] font-black uppercase tracking-widest ${
                                    barnices[zonaActiva] ? 'text-cyan-300' : ui.etiqueta
                                }`}>{barnices[zonaActiva] ? 'Sí' : 'No'}</span>
                            </button>
                        )}

                        {zonaActiva === null && (
                            <p className={`text-[11px] ${ui.etiqueta}`}>
                                Tocá una zona del parche o elegila arriba para asignarle una textura.
                            </p>
                        )}

                        {texturas.length === 0 ? (
                            <p className={`text-[11px] ${ui.etiqueta}`}>
                                No hay texturas cargadas todavía.
                            </p>
                        ) : (
                            /* Las muestras se ven SIEMPRE, con zona seleccionada o sin ella: el
                               catálogo es lo que el cliente vino a mirar, y esconderlo detrás de
                               "elegí una zona" dejaba el cajón vacío. Sin zona no hay a qué
                               aplicarlas, así que quedan atenuadas y sin click.
                               3 columnas: el cajón es angosto y las muestras tienen que seguir
                               siendo lo bastante grandes como para distinguir el material. */
                            <div className={`grid grid-cols-3 gap-2 ${zonaActiva === null ? 'opacity-40 pointer-events-none' : ''}`}>
                                <button
                                    type="button"
                                    onClick={() => { setElecciones(p => ({ ...p, [zonaActiva]: null })); setPanelAbierto(false); }}
                                    className="text-center group"
                                    title="Dejar la zona como está en el boceto"
                                >
                                    <div className={`w-full aspect-square rounded-lg border-2 flex items-center justify-center transition-all ${
                                        zonaActiva !== null && !elecciones[zonaActiva] ? 'border-cyan-400' : ui.swatchBorde
                                    }`}>
                                        <X size={16} className="text-zinc-500" />
                                    </div>
                                    <span className={`block mt-1 text-[9px] ${ui.swatchTxt} leading-tight`}>Sin textura</span>
                                </button>
                                {texturas.map(t => (
                                    <button
                                        key={t.archivo}
                                        type="button"
                                        onClick={() => { setElecciones(p => ({ ...p, [zonaActiva]: t.archivo })); setPanelAbierto(false); }}
                                        className="text-center group"
                                        title={t.nombre}
                                    >
                                        <div
                                            className={`w-full aspect-square rounded-lg border-2 bg-zinc-800 transition-all ${
                                                elecciones[zonaActiva] === t.archivo ? 'border-cyan-400' : ui.swatchBorde
                                            }`}
                                            /* 400% = se ve un cuarto del tile: con menos repeticiones a la
                                               vista se distingue de qué material se trata. */
                                            style={{ backgroundImage: `url("${t.url}")`, backgroundSize: '400%', backgroundPosition: 'center' }}
                                        />
                                        <span className={`block mt-1 text-[9px] ${ui.swatchTxt} leading-tight truncate`}>{t.nombre}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                    </div>
                    </aside>
                    </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default Tpu3DViewer;
