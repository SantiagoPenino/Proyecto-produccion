import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Rotate3d } from 'lucide-react';
import { API_BASE_URL } from '../api/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Visor 3D del parche TPU (aprobación del cliente).
//
// Las capas del arte son PLANCHAS (el diseño repetido N veces): se aísla UNA copia
// (componente conexo más grande de la silueta) y el mismo recorte se aplica a todas
// las capas, que están alineadas.
//
// El modelo es una EXTRUSIÓN REAL de la silueta (marching por bordes de píxel →
// contornos con agujeros → THREE.Shape → ExtrudeGeometry): paredes blancas lisas
// también de canto — un heightfield con displacement dejaba los bordes como peines.
// El arte cmyk va como textura de la tapa, y el relieve se agrega como micro-
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
    return { page, baseW: base.width, baseH: base.height };
};

// Rasteriza un RECORTE de la página a un canvas de outW×outH, con fondo transparente.
// sx/sy en píxeles YA escalados. Renderizar directo el recorte (vía transform) permite
// resolución completa de UNA copia sin generar el canvas gigante de toda la plancha.
const rasterizar = async ({ page }, { scale, sx = 0, sy = 0, outW, outH }) => {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(outW);
    canvas.height = Math.ceil(outH);
    await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: [1, 0, 0, 1, -sx, -sy],
        background: 'rgba(0,0,0,0)',
    }).promise;
    return canvas;
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
    const ctx = c.getContext('2d');
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
    const ctx = c.getContext('2d');
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
                if (!capas.cmyk) throw new Error('El arte todavía no tiene la capa de color (CMYK).');

                const traer = async (archivoId) => {
                    const r = await fetch(`${API_BASE_URL}/web-orders/tpu-model/${ordenId}/archivo/${archivoId}`, { headers: authHeaders() });
                    if (!r.ok) throw new Error('No se pudo leer una capa del arte.');
                    return r.arrayBuffer();
                };

                // 2. Abrir capas: SOLO cmyk (color) y corte (silueta). El relieve no se usa en el
                // visor — sus surcos finos no se pueden mallar bien y arruinaban el negro del arte.
                const [bufCmyk, bufCorte] = await Promise.all([
                    traer(capas.cmyk),
                    capas.corte ? traer(capas.corte) : null,
                ]);
                if (!vivo) return;
                const pdfCmyk = await abrirPdf(bufCmyk);
                const pdfCorte = bufCorte ? await abrirPdf(bufCorte) : null;
                if (!vivo) return;

                // 3a. PASADA 1 (barata, plancha entera a baja resolución): detectar dónde está UNA copia.
                const rasterFull = (pdf, maxDim) => {
                    const e = maxDim / Math.max(pdf.baseW, pdf.baseH);
                    return rasterizar(pdf, { scale: e, outW: pdf.baseW * e, outH: pdf.baseH * e });
                };
                const cvGuia = pdfCorte ? await rasterFull(pdfCorte, 1400) : await rasterFull(pdfCmyk, 1400);
                if (!vivo) return;
                // Silueta: interior del corte; sin corte, interior de la tinta del cmyk
                // (no sirve el alpha pelado: la plancha puede traer fondo blanco OPACO).
                const silPlancha = interiorDeCorte(mascaraTinta(cvGuia));
                const fr = bboxUnaCopia(silPlancha);
                if (!fr) throw new Error('No se pudo detectar el diseño en la plancha.');

                // 3b. PASADA 2: re-rasterizar SOLO el recorte de esa copia, a resolución completa.
                // Antes se recortaba de la plancha ya rasterizada (~500px la copia) y se estiraba a
                // 1024: las líneas finas (negros) quedaban grises y lavadas.
                const pdfGuia = pdfCorte || pdfCmyk;
                const aspecto = ((fr.y1 - fr.y0) * pdfGuia.baseH) / ((fr.x1 - fr.x0) * pdfGuia.baseW);
                const W = 1024, H = Math.max(64, Math.round(W * aspecto));
                const rasterCrop = (pdf) => {
                    const s = W / ((fr.x1 - fr.x0) * pdf.baseW);
                    return rasterizar(pdf, {
                        scale: s,
                        sx: fr.x0 * pdf.baseW * s,
                        sy: fr.y0 * pdf.baseH * s,
                        outW: W,
                        outH: H,
                    });
                };
                const cvCmykCrop = await rasterCrop(pdfCmyk);
                const cvCorteCrop = pdfCorte ? await rasterCrop(pdfCorte) : null;
                if (!vivo) return;

                // Silueta del recorte (a resolución completa) — y solo el componente mayor, por si
                // entra una puntita de la copia vecina en el margen del recorte.
                const silCrop = interiorDeCorte(mascaraTinta(cvCorteCrop || cvCmykCrop));
                mantenerMayorComponente(silCrop);
                const cvSilCrop = mascaraACanvas(silCrop);

                // 4. Texturas: color (cmyk sobre base blanca) y alpha (silueta). Nada más:
                // el arte se muestra PLANO — solo CMYK + corte, sin relieve.
                const dSil = cvSilCrop.getContext('2d').getImageData(0, 0, W, H).data;
                const dArt = cvCmykCrop.getContext('2d').getImageData(0, 0, W, H).data;

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

                // Alpha ERO­SIONADO para la lámina del arte: la silueta se encoge unos px para que
                // la lámina no llegue al borde del parche — si llega, su canto asoma sobre la pared
                // blanca de la extrusión y se ve como vetas de color en el borde (visto de costado).
                const cAlphaEro = document.createElement('canvas'); cAlphaEro.width = W; cAlphaEro.height = H;
                {
                    const ctxE = cAlphaEro.getContext('2d');
                    ctxE.filter = 'blur(6px)';
                    ctxE.drawImage(cAlpha, 0, 0);
                    ctxE.filter = 'none';
                    const iE = ctxE.getImageData(0, 0, W, H);
                    for (let i = 0; i < W * H; i++) {
                        const v = iE.data[i * 4] > 235 ? 255 : 0; // umbral alto = erosión
                        iE.data[i * 4] = v; iE.data[i * 4 + 1] = v; iE.data[i * 4 + 2] = v; iE.data[i * 4 + 3] = 255;
                    }
                    ctxE.putImageData(iE, 0, 0);
                }

                // 5. Contornos de la silueta (a escala reducida) → polígonos con agujeros.
                // d3-contour (marching squares): devuelve los anillos YA armados por polígono
                // (exterior + agujeros) e interpola las diagonales — el trazador casero armaba
                // lazos cruzados y la pared salía con bandas tipo código de barras.
                const CW = 640, CH = Math.max(40, Math.round(CW * aspecto));
                const cvSilChico = recortarFraccion(cvSilCrop, { x0: 0, x1: 1, y0: 0, y1: 1 }, CW, CH);
                const dChico = cvSilChico.getContext('2d').getImageData(0, 0, CW, CH).data;
                const valores = new Float64Array(CW * CH);
                for (let i = 0; i < CW * CH; i++) valores[i] = dChico[i * 4] > 127 ? 1 : 0;

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
                const GROSOR = 0.5;
                const BISEL = 0.06; // ojo: el bisel EXTIENDE la tapa frontal hasta GROSOR + BISEL
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
                // EROSIONADO para no asomar por el borde. Sin relieve: solo CMYK + corte.
                const texAlphaEro = new THREE.CanvasTexture(cAlphaEro);
                const geoArte = new THREE.PlaneGeometry(anchoMundo, altoMundo, 1, 1);
                const matArte = new THREE.MeshStandardMaterial({
                    map: texColor,
                    alphaMap: texAlphaEro,
                    transparent: true,
                    alphaTest: 0.5,
                    roughness: 0.5,
                    metalness: 0,
                });
                const laminaArte = new THREE.Mesh(geoArte, matArte);
                // Por ENCIMA del bisel: a GROSOR + 0.02 quedaba DENTRO del sólido (la tapa con
                // bisel llega a GROSOR + BISEL) y la base blanca tapaba el arte entero.
                laminaArte.position.z = GROSOR + BISEL + 0.015;
                escena.add(laminaArte);

                escena.add(new THREE.HemisphereLight(0xffffff, 0x555566, 1.15));
                const luz = new THREE.DirectionalLight(0xffffff, 1.5);
                luz.position.set(6, 8, 12);
                escena.add(luz);

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

                limpiar = () => {
                    renderer.setAnimationLoop(null);
                    controles.dispose();
                    geoBase.dispose(); geoArte.dispose();
                    matBlanco.dispose(); matArte.dispose();
                    texColor.dispose(); texAlphaEro.dispose();
                    renderer.dispose();
                    if (renderer.domElement.parentNode === cont) cont.removeChild(renderer.domElement);
                };

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
            className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
            // Cerrar SOLO si el click empezó Y terminó en el overlay: un drag de rotación que
            // termina fuera del canvas generaba un click en el overlay y cerraba el modal.
            onMouseDown={(e) => { downEnOverlay.current = e.target === e.currentTarget; }}
            onClick={(e) => { if (downEnOverlay.current && e.target === e.currentTarget) onClose(); }}
        >
            <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
                    <div className="min-w-0 flex items-center gap-2">
                        <Rotate3d size={16} className="text-cyan-400 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400/80">Vista 3D del parche</p>
                            <p className="text-xs font-bold text-zinc-300 truncate">{codigo}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center"
                        title="Cerrar"
                    ><X size={16} /></button>
                </div>

                <div ref={mountRef} className="relative w-full h-[60vh] min-h-[320px] bg-gradient-to-b from-zinc-900 to-zinc-800">
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
                </div>

                {estado === 'listo' && (
                    <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500 text-center">
                        Girá: arrastrá · Zoom: rueda o pinch · Mover: botón derecho o dos dedos
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default Tpu3DViewer;
