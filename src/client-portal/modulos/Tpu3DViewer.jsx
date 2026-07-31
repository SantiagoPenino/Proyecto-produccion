import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Rotate3d, Sparkles, Gauge, Save, ChevronRight, ChevronLeft } from 'lucide-react';
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
// también de canto — un heightfield con displacement dejaba los bordes como peines.
// El arte va como textura de la tapa, y el relieve se agrega como micro-
// displacement de una lámina superior (bultos chicos, no paredes).
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
// Subdivisión de la lámina del arte: sin segmentos no hay vértices que desplazar. 128 alcanza —
// con 1 a 3 repeticiones los rasgos del tile ocupan decenas de píxeles del mapa, y bajar de 256
// a 128 son 4 veces menos vértices.
const RELIEVE_SEGMENTOS = 128;
// Altura REAL del relieve, en unidades de la escena (el parche mide 10 de ancho).
// El límite es la pendiente, no la altura: si entre dos vértices vecinos el mapa salta mucho más
// que el lado del cuadro de la malla (10 / 128 ≈ 0,078), la superficie se rompe en púas. Como al
// desplazamiento se le pasa el mapa DESENFOCADO a esa misma escala, el salto entre vecinos ya viene
// acotado y se puede levantar bastante la altura sin que se quiebre.
const RELIEVE_ALTURA_MUNDO = 0.08;
// El desplazamiento se muestrea POR VÉRTICE, así que solo puede representar detalle más grande que
// un cuadro de la malla; con las líneas finas de la textura salían púas en vez de relieve. Se le
// pasa una copia DESENFOCADA a esa escala: el volumen lo da el desplazamiento y el detalle fino
// queda para el bumpMap, que trabaja por píxel y sí lo resuelve.
const DESPLAZ_SUAVIZADO_PX = Math.round(1024 / RELIEVE_SEGMENTOS);
// Ancho de la franja donde el relieve se apaga hacia el borde del parche. Sin esto la lámina se
// levanta también en el filo, se despega de la base y por abajo asoma el blanco: las puntas quedan
// como solapas. Tiene que ser bastante más que la altura del relieve (0,08 ≈ 8 px acá).
const BORDE_APAGADO_PX = 18;
// Barniz sectorizado: es una capa brillante sobre una zona. Se resuelve con el roughnessMap —
// menos rugosidad = más brillo especular. El material queda con roughness 1 y el mapa manda.
// 128 ≈ 0.50: es el mismo acabado que tenía el material antes del barniz. Subirlo apaga el
// especular y con él se apaga el relieve del bump, que se lee justamente por el brillo.
const RUGOSIDAD_MATE = 128;
// 64 ≈ 0.25. Un barniz NO es un espejo: con 0.08 la zona reflejaba casi puntual y, como el bump le
// perturba la normal, cada faceta devolvía un punto de luz duro — se veía como sal y pimienta sobre
// el negro. A 0.25 el reflejo se abre y queda un lustre parejo.
const RUGOSIDAD_BARNIZ = 64;
// Cuánto se ACHICA la base blanca respecto del arte, en píxeles de la grilla de contornos (CW=640).
// El arte queda entonces sobresaliendo apenas por todo el borde y de frente no asoma nada de blanco.
const BASE_ACHICA_PX = 4;
const REPETICIONES_MIN = 1, REPETICIONES_MAX = 3;
const ALTURA_MIN = 1, ALTURA_MAX = 2;

// Carga una textura y la deja rasterizada como TILE de tamaño entero en píxeles, EN GRISES.
// La textura no pinta color: el color lo sigue poniendo el arte. Se usa como mapa de RELIEVE
// (bumpMap), así que de cada píxel solo importa el brillo.
//
// `repeticiones` = cuántas veces entra a lo ancho del parche. Viene por textura del catálogo, no
// del archivo: los SVG traen viewBox pero sin medida física, así que no hay tamaño real del que
// deducirlo. El lado se redondea a ENTERO — si saliera fraccionario, el resto se acumula en cada
// repetición hasta que aparece una costura visible.
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

    const w = Math.max(4, Math.round(anchoRenderPx / Math.max(1, repeticiones)));
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

export const Tpu3DViewer = ({ ordenId, codigo, onClose }) => {
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
    // Relieve real (desplaza geometría) vs solo sombreado (bump). Lo segundo es mucho más liviano.
    // Queda guardado por dispositivo: en un celular flojo no hay que volver a bajarlo cada vez.
    const [modoRelieve, setModoRelieve] = useState(() => {
        try { return localStorage.getItem('tpu3d_relieve') !== '0'; } catch { return true; }
    });
    const [errorGuardado, setErrorGuardado] = useState('');
    const [guardando, setGuardando] = useState(false);
    const escenaRef = useRef(null);                   // { componer, anchoRenderPx }
    const tilesRef = useRef(new Map());               // clave archivo|rep|alt → canvas del tile
    const ultimoGuardado = useRef('{}');              // evita re-postear lo que se acaba de cargar

    // Repetición y altura de la textura elegida, ajustables en el momento. Los valores de arranque
    // salen del catálogo (assets/textures/texturas.json).
    const [ajustes, setAjustes] = useState({});       // archivo → { repeticiones, altura }
    const acotar = (v, min, max) => Math.min(max, Math.max(min, v));
    const ajusteDe = (t) => ({
        repeticiones: acotar(ajustes[t.archivo]?.repeticiones ?? t.repeticiones ?? 2, REPETICIONES_MIN, REPETICIONES_MAX),
        altura:       acotar(ajustes[t.archivo]?.altura       ?? t.altura       ?? 1, ALTURA_MIN, ALTURA_MAX),
    });

    // Catálogo de texturas
    useEffect(() => {
        let vivo = true;
        fetch(`${API_BASE_URL}/web-orders/texturas-tpu`, { headers: authHeaders() })
            .then(r => r.json())
            .then(j => { if (vivo && j?.success) setTexturas(j.data || []); })
            .catch(() => { /* sin catálogo: el visor sigue andando, solo no hay texturas */ });
        return () => { vivo = false; };
    }, []);

    // Elección ya guardada (reabrir el visor tiene que mostrar lo que había elegido)
    useEffect(() => {
        let vivo = true;
        fetch(`${API_BASE_URL}/web-orders/orden/${ordenId}/texturas`, { headers: authHeaders() })
            .then(r => r.json())
            .then(j => {
                if (!vivo || !j?.success) return;
                const e = {}, b = {};
                (j.data || []).forEach(r => {
                    if (r.ArchivoTextura) e[r.ZonaIndice] = r.ArchivoTextura;
                    if (r.Barniz) b[r.ZonaIndice] = true;
                });
                ultimoGuardado.current = JSON.stringify({ e, b });
                setElecciones(e);
                setBarnices(b);
            })
            .catch(() => { /* sin elección previa */ });
        return () => { vivo = false; };
    }, [ordenId]);

    // Nada se persiste hasta que se aprieta "Guardar cambios": probar texturas en el 3D no debe
    // dejar rastro si el cliente no confirma.
    const estadoActual = JSON.stringify({ e: elecciones, b: barnices });
    const hayCambios = estadoActual !== ultimoGuardado.current;

    const guardar = async () => {
        setGuardando(true);
        setErrorGuardado('');
        try {
            // Una entrada por zona tocada, con textura y barniz juntos.
            const zonasPayload = {};
            for (const k of new Set([...Object.keys(elecciones), ...Object.keys(barnices)])) {
                zonasPayload[k] = { textura: elecciones[k] || null, barniz: !!barnices[k] };
            }
            const r = await fetch(`${API_BASE_URL}/web-orders/orden/${ordenId}/texturas`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ elecciones: zonasPayload }),
            });
            if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                setErrorGuardado(j.error || 'No se pudo guardar la elección.');
                return;
            }
            ultimoGuardado.current = estadoActual;
        } catch {
            setErrorGuardado('No se pudo guardar la elección (sin conexión).');
        } finally {
            setGuardando(false);
        }
    };

    useEffect(() => {
        escenaRef.current?.aplicarModo?.(modoRelieve);
        try { localStorage.setItem('tpu3d_relieve', modoRelieve ? '1' : '0'); } catch { /* modo privado */ }
    }, [modoRelieve, estado]);

    // Repintar el arte cuando cambia una elección. No rearma la escena: recompone el canvas de
    // color y avisa a three.js con needsUpdate.
    useEffect(() => {
        const e = escenaRef.current;
        if (!e) return;
        let vivo = true;
        (async () => {
            const tiles = {};
            for (const [idx, archivo] of Object.entries(elecciones)) {
                if (!archivo) continue;
                const t = texturas.find(x => x.archivo === archivo);
                if (!t) continue;
                const { repeticiones, altura } = ajusteDe(t);
                // La clave incluye los ajustes: moverlos en calibración tiene que regenerar el tile.
                const clave = `${archivo}|${repeticiones}|${altura}`;
                if (!tilesRef.current.has(clave)) {
                    // null = textura que no cargó: la zona queda sin relieve en vez de romper el render.
                    let tile = null;
                    try { tile = await cargarTile(t.url, e.anchoRenderPx, repeticiones, altura); } catch { tile = null; }
                    tilesRef.current.set(clave, tile);
                }
                tiles[idx] = tilesRef.current.get(clave);
            }
            if (vivo) e.componer(tiles, barnices);
        })();
        return () => { vivo = false; };
    }, [elecciones, barnices, texturas, ajustes, estado]);


    useEffect(() => {
        let vivo = true;
        let limpiar = null;

        (async () => {
            try {
                // 1. Capas disponibles
                const resCapas = await fetch(`${API_BASE_URL}/web-orders/tpu-model/${ordenId}`, { headers: authHeaders() });
                const jCapas = await resCapas.json();
                if (!resCapas.ok) throw new Error(jCapas.error || 'No se pudieron obtener las capas.');
                const capas = jCapas.capas || {};
                // Capa de arte: el BOCETO DE PRODUCCIÓN — es lo que el cliente está aprobando y lo
                // único que existe en ese momento (el resto del arte se sube después). El cmyk queda
                // como fallback para las órdenes anteriores al cambio de flujo, que no tienen boceto.
                const capaArte = capas.boceto || capas.cmyk;
                if (!capaArte) throw new Error('El pedido todavía no tiene el boceto cargado.');

                const traer = async (archivoId) => {
                    const r = await fetch(`${API_BASE_URL}/web-orders/tpu-model/${ordenId}/archivo/${archivoId}`, { headers: authHeaders() });
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

                // 3a. PASADA 1 (barata, plancha entera a baja resolución): detectar dónde está UNA copia.
                const rasterFull = (pdf, maxDim) => {
                    const e = maxDim / Math.max(pdf.baseW, pdf.baseH);
                    return rasterizar(pdf, { scale: e, outW: pdf.baseW * e, outH: pdf.baseH * e });
                };
                const cvGuia = pdfCorte ? await rasterFull(pdfCorte, 1400) : await rasterFull(pdfArte, 1400);
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
                const cvArteCrop = await rasterCrop(pdfArte);
                const cvCorteCrop = pdfCorte ? await rasterCrop(pdfCorte) : null;
                if (!vivo) return;

                // 3c. ZONAS: cada capa (OCG) del boceto es una zona texturable. Se rasteriza el
                // MISMO recorte una vez por capa, con solo esa capa visible → máscaras alineadas al
                // píxel con el arte. getOrder() viene de arriba hacia abajo del panel de capas, o sea
                // en orden de prioridad: la primera que cubre un píxel es la que se ve.
                const occ = await pdfArte.pdf.getOptionalContentConfig();
                const idsZonas = (occ.getOrder() || []).filter(x => typeof x === 'string');
                const mascarasZona = [];
                for (const id of idsZonas) {
                    for (const [otro] of occ) occ.setVisibility(otro, otro === id);
                    const cv = await rasterCrop(pdfArte, occ);
                    if (!vivo) return;
                    const msk = mascaraTinta(cv);
                    // Una capa sin tinta dentro del recorte no sirve como zona (queda fuera de la
                    // copia aislada, o es una capa de guías): se descarta en vez de ofrecer una
                    // zona que al pintarla no cambia nada.
                    if (msk.m.some(v => v)) mascarasZona.push({ id, msk, nombre: occ.getGroup(id)?.name || '' });
                }
                for (const [otro] of occ) occ.setVisibility(otro, true); // dejar el config como estaba

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
                    const af = dArt[i * 4 + 3] / 255;
                    iColor.data[i * 4]     = dentro ? Math.round(dArt[i * 4] * af + 255 * (1 - af)) : 255;
                    iColor.data[i * 4 + 1] = dentro ? Math.round(dArt[i * 4 + 1] * af + 255 * (1 - af)) : 255;
                    iColor.data[i * 4 + 2] = dentro ? Math.round(dArt[i * 4 + 2] * af + 255 * (1 - af)) : 255;
                    iColor.data[i * 4 + 3] = 255;
                    const va = dentro ? 255 : 0;
                    iAlpha.data[i * 4] = va; iAlpha.data[i * 4 + 1] = va; iAlpha.data[i * 4 + 2] = va; iAlpha.data[i * 4 + 3] = 255;
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

                // Copia desenfocada del relieve, solo para el desplazamiento (ver DESPLAZ_SUAVIZADO_PX).
                const cRelieveSuave = document.createElement('canvas'); cRelieveSuave.width = W; cRelieveSuave.height = H;
                const ctxRelieveSuave = cRelieveSuave.getContext('2d');

                const cTmp = document.createElement('canvas'); cTmp.width = W; cTmp.height = H;
                const ctxTmp = cTmp.getContext('2d');
                const ctxColor = cColor.getContext('2d');

                // Se pinta de MENOR a MAYOR prioridad para que la capa de arriba quede encima,
                // igual que en el PDF.
                const componer = (tiles, barnices = {}) => {
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
                        ctxTmp.globalCompositeOperation = 'source-over';
                        ctxTmp.clearRect(0, 0, W, H);
                        ctxTmp.fillStyle = ctxTmp.createPattern(tile, 'repeat');
                        ctxTmp.fillRect(0, 0, W, H);
                        ctxTmp.globalCompositeOperation = 'destination-in';
                        ctxTmp.drawImage(zonasAlpha[z], 0, 0);
                        ctxRelieve.drawImage(cTmp, 0, 0);
                    }
                    // Apagar el relieve contra el borde, para que la lámina siga pegada a la base.
                    ctxRelieve.globalCompositeOperation = 'multiply';
                    ctxRelieve.drawImage(cvApagaBorde, 0, 0);
                    ctxRelieve.globalCompositeOperation = 'source-over';
                    texRelieve.needsUpdate = true;

                    ctxRelieveSuave.clearRect(0, 0, W, H);
                    ctxRelieveSuave.filter = `blur(${DESPLAZ_SUAVIZADO_PX}px)`;
                    ctxRelieveSuave.drawImage(cRelieve, 0, 0);
                    ctxRelieveSuave.filter = 'none';
                    texRelieveSuave.needsUpdate = true;
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
                const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
                const texRelieveSuave = new THREE.CanvasTexture(cRelieveSuave);
                const texBarniz = new THREE.CanvasTexture(cBarniz);
                // Lámina subdividida: el desplazamiento mueve VÉRTICES, así que sin segmentos no
                // pasa nada. 256 alcanza y sobra — con 1 a 3 repeticiones los rasgos del tile son
                // grandes.
                // Arranca SIEMPRE con la malla llana. La subdividida se crea recién si se pide el
                // modo relieve: si el cliente quedó en "solo sombreado", nunca se allocan ni se
                // suben esos ~11.000 vértices a la GPU.
                const geoArteLlana = new THREE.PlaneGeometry(anchoMundo, altoMundo, 1, 1);
                let geoArteRelieve = null;
                const matArte = new THREE.MeshStandardMaterial({
                    map: texColor,
                    alphaMap: texAlphaArte,
                    // El desplazamiento lo cuelga aplicarModo(): así el modo liviano no arranca ni
                    // por un frame con el shader que lee una textura por vértice.
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
                escena.add(new THREE.HemisphereLight(0xffffff, 0x555566, 0.65));
                const luz = new THREE.DirectionalLight(0xffffff, 2.2);
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

                renderer.setAnimationLoop(() => { controles.update(); renderer.render(escena, camara); });

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
                    // Sin impacto = se tocó el fondo, fuera del parche: también deselecciona.
                    // Antes salía por acá y la marca quedaba pegada.
                    if (!hit?.uv) { setZonaActiva(null); return; }
                    const px = Math.min(W - 1, Math.max(0, Math.round(hit.uv.x * W)));
                    const py = Math.min(H - 1, Math.max(0, Math.round((1 - hit.uv.y) * H)));
                    const i = py * W + px;
                    for (let z = 0; z < zonasPix.length; z++) {
                        // Tocar una zona del parche despliega el cajón con sus texturas.
                        if (zonasPix[z][i]) { setZonaActiva(z); setPanelAbierto(true); return; }
                    }
                    // Fuera del parche: se deselecciona, así se saca el contorno de encima y el
                    // escudo se puede mirar limpio.
                    setZonaActiva(null);
                };
                renderer.domElement.addEventListener('pointerdown', alBajar);
                renderer.domElement.addEventListener('pointerup', alSoltar);

                // El alto del canvas no es fijo: en mobile ocupa lo que sobra, y el panel de texturas
                // recién aparece cuando el modelo está listo — o sea DESPUÉS de este setup. Sin esto
                // el render se quedaba con la medida vieja y salía estirado.
                let ultimoW = ancho, ultimoH = alto;
                const ro = new ResizeObserver(() => {
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
                    ro.disconnect();
                    renderer.domElement.removeEventListener('pointerdown', alBajar);
                    renderer.domElement.removeEventListener('pointerup', alSoltar);
                    controles.dispose();
                    geoBase.dispose(); geoArteLlana.dispose(); geoArteRelieve?.dispose();
                    matBlanco.dispose(); matArte.dispose();
                    texColor.dispose(); texAlphaArte.dispose(); texRelieve.dispose();
                    texRelieveSuave.dispose(); texBarniz.dispose();
                    renderer.dispose();
                    if (renderer.domElement.parentNode === cont) cont.removeChild(renderer.domElement);
                };

                // Cambio de modo sin rearmar nada: se intercambia la malla y se saca el mapa de
                // desplazamiento. Sacarlo (y no solo poner la escala en 0) evita que el shader siga
                // leyendo una textura por vértice en cada frame, que es lo caro.
                const aplicarModo = (conRelieve) => {
                    if (conRelieve && !geoArteRelieve) {
                        geoArteRelieve = new THREE.PlaneGeometry(
                            anchoMundo, altoMundo,
                            RELIEVE_SEGMENTOS, Math.max(8, Math.round(RELIEVE_SEGMENTOS * (H / W)))
                        );
                    }
                    laminaArte.geometry = conRelieve ? geoArteRelieve : geoArteLlana;
                    matArte.displacementMap = conRelieve ? texRelieveSuave : null;
                    matArte.displacementScale = conRelieve ? RELIEVE_ALTURA_MUNDO : 0;
                    matArte.needsUpdate = true;
                };

                escenaRef.current = { componer, aplicarModo, anchoRenderPx: W };
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
            className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center p-0 sm:p-4"
            // Cerrar SOLO si el click empezó Y terminó en el overlay: un drag de rotación que
            // termina fuera del canvas generaba un click en el overlay y cerraba el modal.
            onMouseDown={(e) => { downEnOverlay.current = e.target === e.currentTarget; }}
            onClick={(e) => { if (downEnOverlay.current && e.target === e.currentTarget) onClose(); }}
        >
            {/* Mobile: pantalla completa, en columna — el canvas se queda con lo que sobra después
                del header y del panel de texturas. Desktop: modal centrado como siempre. */}
            <div className="relative bg-zinc-900 border-0 sm:border border-zinc-700 rounded-none sm:rounded-2xl w-full max-w-none sm:max-w-3xl shadow-2xl flex flex-col h-[100dvh] sm:h-auto sm:max-h-[95dvh] overflow-y-auto">
                <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
                    <div className="min-w-0 flex items-center gap-2">
                        <Rotate3d size={16} className="text-cyan-400 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400/80">Vista 3D del parche</p>
                            <p className="text-xs font-bold text-zinc-300 truncate">{codigo}</p>
                        </div>
                    </div>

                    {/* Acciones: barniz (por zona), calidad del render y guardar. */}
                    <div className="shrink-0 flex items-center gap-1">
                        {estado === 'listo' && zonas.length > 0 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => zonaActiva !== null && setBarnices(p => ({ ...p, [zonaActiva]: !p[zonaActiva] }))}
                                    disabled={zonaActiva === null}
                                    title={zonaActiva === null
                                        ? 'Elegí una zona para barnizarla'
                                        : (barnices[zonaActiva] ? 'Sacar el barniz de esta zona' : 'Barnizar esta zona')}
                                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 ${
                                        zonaActiva !== null && barnices[zonaActiva]
                                            ? 'text-cyan-300 bg-cyan-500/15'
                                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                                    }`}
                                ><Sparkles size={16} /></button>

                                <button
                                    type="button"
                                    onClick={guardar}
                                    disabled={!hayCambios || guardando}
                                    title={guardando ? 'Guardando…' : hayCambios ? 'Guardar cambios' : 'No hay cambios sin guardar'}
                                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 ${
                                        hayCambios ? 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25' : 'text-zinc-400'
                                    }`}
                                >{guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}</button>
                            </>
                        )}
                        {estado === 'listo' && (
                            <button
                                type="button"
                                onClick={() => setModoRelieve(v => !v)}
                                title={modoRelieve
                                    ? 'Relieve 3D (más realista) — tocá para aligerar'
                                    : 'Solo sombreado (más liviano) — tocá para el relieve'}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                    modoRelieve ? 'text-cyan-300 bg-cyan-500/15' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                                }`}
                            ><Gauge size={16} /></button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center"
                            title="Cerrar"
                        ><X size={16} /></button>
                    </div>
                </div>

                {/* Cuerpo: el canvas ocupa todo y el cajón de zonas/texturas se le monta encima por
                    la derecha. Al abrirlo y cerrarlo el canvas NO cambia de tamaño, así que no hay
                    reasignación del buffer de dibujo. */}
                {/* overflow-hidden: el cajón cerrado queda trasladado fuera del contenedor y, sin
                    esto, sigue contando para el ancho — aparecía una barra de scroll horizontal. */}
                <div className="relative flex-1 min-h-[240px] sm:flex-none sm:h-[60vh] sm:min-h-[360px] overflow-hidden">
                    <div ref={mountRef} className="absolute inset-0 bg-gradient-to-b from-zinc-900 to-zinc-800" />

                    {estado === 'cargando' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-400">
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
                        <div className="absolute left-3 bottom-3 right-3 sm:right-auto sm:max-w-sm px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] text-amber-300">
                            {errorGuardado}
                        </div>
                    )}

                    {estado === 'listo' && zonas.length > 0 && (
                    <>
                    <button
                        type="button"
                        onClick={() => setPanelAbierto(v => !v)}
                        /* bg-zinc-950: el canvas detrás es un degradado zinc-900→zinc-800 y la pestaña
                           cae justo donde el fondo vale casi lo mismo. Con un tono parecido, aunque sea
                           opaca, se lee como vidrio esmerilado. Necesita contrastar de verdad. */
                        className={`absolute top-1/2 -translate-y-1/2 z-10 w-6 h-16 rounded-l-lg bg-zinc-950 border border-r-0 border-zinc-600 text-zinc-300 hover:text-white flex items-center justify-center transition-all duration-150 ${
                            panelAbierto ? 'right-[78%] sm:right-72' : 'right-0'
                        }`}
                        title={panelAbierto ? 'Ocultar texturas' : 'Elegir texturas'}
                    >{panelAbierto ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}</button>

                    <aside className={`absolute inset-y-0 right-0 w-[78%] sm:w-72 bg-zinc-900 border-l border-zinc-800 overflow-y-auto transition-transform duration-150 ${
                        panelAbierto ? 'translate-x-0' : 'translate-x-full'
                    }`}>
                    <div className="p-3 space-y-2.5">
                        <div>
                            <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">Zona</span>
                            <div className="grid grid-cols-3 gap-2">
                                {zonas.map(z => (
                                    <button
                                        key={z.idx}
                                        type="button"
                                        onClick={() => setZonaActiva(z.idx)}
                                        className={`relative rounded-lg border p-1 transition-all ${
                                            zonaActiva === z.idx
                                                ? 'border-brand-magenta bg-brand-magenta/10'
                                                : 'border-zinc-700 hover:border-zinc-500'
                                        }`}
                                        title={z.nombre}
                                    >
                                        <img src={z.mini} alt="" className="w-full h-11 object-contain" />
                                        <span className={`block mt-0.5 text-[9px] font-bold uppercase tracking-wide truncate ${
                                            zonaActiva === z.idx ? 'text-brand-magenta' : 'text-zinc-400'
                                        }`}>{z.nombre}</span>
                                        {elecciones[z.idx] && (
                                            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-brand-magenta" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {zonaActiva === null ? (
                            <p className="text-[11px] text-zinc-500">
                                Tocá una zona del parche o elegila arriba para asignarle una textura.
                            </p>
                        ) : texturas.length === 0 ? (
                            <p className="text-[11px] text-zinc-500">
                                No hay texturas cargadas todavía.
                            </p>
                        ) : (
                            /* 3 columnas: el cajón es angosto y las muestras tienen que seguir
                               siendo lo bastante grandes como para distinguir el material. */
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setElecciones(p => ({ ...p, [zonaActiva]: null })); setPanelAbierto(false); }}
                                    className="text-center group"
                                    title="Dejar la zona como está en el boceto"
                                >
                                    <div className={`w-full aspect-square rounded-lg border-2 flex items-center justify-center transition-all ${
                                        !elecciones[zonaActiva] ? 'border-cyan-400' : 'border-zinc-700 group-hover:border-zinc-500'
                                    }`}>
                                        <X size={16} className="text-zinc-500" />
                                    </div>
                                    <span className="block mt-1 text-[9px] text-zinc-500 leading-tight">Sin textura</span>
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
                                                elecciones[zonaActiva] === t.archivo ? 'border-cyan-400' : 'border-zinc-700 group-hover:border-zinc-500'
                                            }`}
                                            /* 400% = se ve un cuarto del tile: con menos repeticiones a la
                                               vista se distingue de qué material se trata. */
                                            style={{ backgroundImage: `url("${t.url}")`, backgroundSize: '400%', backgroundPosition: 'center' }}
                                        />
                                        <span className="block mt-1 text-[9px] text-zinc-400 leading-tight truncate">{t.nombre}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Perillas de la textura elegida en la zona activa */}
                        {elecciones[zonaActiva] && (() => {
                            const t = texturas.find(x => x.archivo === elecciones[zonaActiva]);
                            if (!t) return null;
                            const a = ajusteDe(t);
                            const set = (campo, valor) => setAjustes(p => ({ ...p, [t.archivo]: { ...a, [campo]: valor } }));
                            return (
                                <div className="pt-2 border-t border-zinc-800 space-y-1.5">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                        {t.nombre}
                                    </div>
                                    <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                                        <span className="w-20 shrink-0">Repeticiones</span>
                                        <input
                                            type="range" min={REPETICIONES_MIN} max={REPETICIONES_MAX} step="1" value={a.repeticiones}
                                            onChange={(e) => set('repeticiones', Number(e.target.value))}
                                            className="flex-1 accent-cyan-400"
                                        />
                                        <span className="w-9 text-right font-mono text-zinc-300">{a.repeticiones}</span>
                                    </label>
                                    <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                                        <span className="w-20 shrink-0">Altura</span>
                                        <input
                                            type="range" min={ALTURA_MIN} max={ALTURA_MAX} step="1" value={a.altura}
                                            onChange={(e) => set('altura', Number(e.target.value))}
                                            className="flex-1 accent-cyan-400"
                                        />
                                        <span className="w-9 text-right font-mono text-zinc-300">{a.altura}</span>
                                    </label>
                                </div>
                            );
                        })()}

                    </div>
                    </aside>
                    </>
                    )}
                </div>

                {estado === 'listo' && (
                    <div className="shrink-0 px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500 text-center">
                        {zonas.length > 0
                            ? 'Tocá una parte del parche para elegir la zona · Girá arrastrando · Zoom con la rueda'
                            : 'Girá: arrastrá · Zoom: rueda o pinch · Mover: botón derecho o dos dedos'}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default Tpu3DViewer;
