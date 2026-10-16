// Dibujo de la pieza en canvas 2D: el fondo y cada tipo de capa. Es el código del compositor de
// Marketing (compositor-user.html) separado por capa: cada una se dibuja en su propia caja,
// con el origen (0, 0) arriba a la izquierda. Konva pone la posición, el giro y la escala.
//
// medirCapa(capa) da el ancho y el alto de la caja sin dibujar. Lo usan el editor (manijas, guías,
// límites del recuadro) y el dibujo, así lo que se mide es lo que se ve y lo que se baja.

import { TINTAS, SOMBRAS, MARCO, ISOTIPO, LOGOTIPO, ASTERISCO, resolverColor } from './marca';

// Mientras se exporta el PNG no se dibujan las ayudas del editor (huecos de foto, textos de muestra).
export const estadoDibujo = { exportando: false };

// ---------- auxiliares ----------

const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

// Rectángulo redondeado; r puede ser un número o [arriba-izq, arriba-der, abajo-der, abajo-izq].
export const rr = (ctx, x, y, w, h, r) => {
    const m = Math.max(0, Math.min(w, h) / 2);
    const t = (typeof r === 'number' ? [r, r, r, r] : r).map(v => Math.min(Math.max(0, v), m));
    ctx.beginPath();
    ctx.moveTo(x + t[0], y);
    ctx.lineTo(x + w - t[1], y); ctx.arcTo(x + w, y, x + w, y + t[1], t[1]);
    ctx.lineTo(x + w, y + h - t[2]); ctx.arcTo(x + w, y + h, x + w - t[2], y + h, t[2]);
    ctx.lineTo(x + t[3], y + h); ctx.arcTo(x, y + h, x, y + h - t[3], t[3]);
    ctx.lineTo(x, y + t[0]); ctx.arcTo(x, y, x + t[0], y, t[0]);
    ctx.closePath();
};

let grano = null;
const texturaGrano = () => {
    if (grano) return grano;
    const c = document.createElement('canvas');
    c.width = c.height = 220;
    const g = c.getContext('2d');
    const d = g.createImageData(220, 220);
    for (let i = 0; i < d.data.length; i += 4) {
        const v = Math.random() * 255;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 26;
    }
    g.putImageData(d, 0, 0);
    grano = c;
    return c;
};

let ctxMedida = null;
const medida = () => {
    if (!ctxMedida) ctxMedida = document.createElement('canvas').getContext('2d');
    return ctxMedida;
};

const cacheAncho = new Map();
const anchoTexto = (texto, fuente) => {
    const k = `${fuente}|${texto}`;
    let v = cacheAncho.get(k);
    if (v === undefined) {
        const c = medida();
        c.font = fuente;
        v = c.measureText(texto).width;
        if (cacheAncho.size > 4000) cacheAncho.clear();
        cacheAncho.set(k, v);
    }
    return v;
};

// ---------- textos ----------

export const INTERLINEADO = { titulo: 1.02, texto: 1.35, dato: 1.4 };
const MUESTRA = { titulo: 'Título', texto: 'Texto', dato: 'Dato técnico', etiqueta: 'Etiqueta' };

export const fuenteDe = (capa) => {
    const t = capa.tamano;
    if (capa.tipo === 'titulo') return `italic 800 ${t}px Inter`;
    if (capa.tipo === 'dato') return `400 ${t}px "Roboto Mono"`;
    if (capa.tipo === 'etiqueta') return `500 ${t}px Inter`;
    return `${capa.peso || '400'} ${t}px Inter`;
};

// Lo que se ve: el título va en mayúsculas, el dato puede ir entre < >.
const textoVisible = (capa) => {
    const s = String(capa.texto ?? '');
    if (capa.tipo === 'titulo' || (capa.tipo === 'texto' && capa.mayusculas)) return s.toUpperCase();
    if (capa.tipo === 'dato' && capa.corchetes && s.trim()) return `< ${s} >`;
    return s;
};

// Corta en líneas por palabras para el ancho dado. Respeta los saltos de línea escritos, y una
// palabra que no entra sola se corta por letras, para que nada se salga de la caja.
const envolver = (texto, fuente, ancho) => {
    const lineas = [];
    texto.split('\n').forEach((parrafo) => {
        const palabras = parrafo.split(' ');
        let actual = '';
        palabras.forEach((palabra) => {
            const prueba = actual ? `${actual} ${palabra}` : palabra;
            if (anchoTexto(prueba, fuente) <= ancho || !actual) {
                actual = prueba;
            } else {
                lineas.push(actual);
                actual = palabra;
            }
            while (anchoTexto(actual, fuente) > ancho && actual.length > 1) {
                let corte = actual.length - 1;
                while (corte > 1 && anchoTexto(actual.slice(0, corte), fuente) > ancho) corte--;
                lineas.push(actual.slice(0, corte));
                actual = actual.slice(corte);
            }
        });
        lineas.push(actual);
    });
    return lineas;
};

const layoutTexto = (capa) => {
    const visible = textoVisible(capa);
    const muestra = !visible.trim();
    const fuente = fuenteDe(capa);
    const lineas = envolver(muestra ? MUESTRA[capa.tipo] : visible, fuente, capa.ancho);
    const alto = capa.tamano * (INTERLINEADO[capa.tipo] || 1.3);
    return { lineas, fuente, alto, muestra, w: capa.ancho, h: Math.max(1, lineas.length) * alto };
};

// ---------- medidas ----------

const layoutPrecio = (capa) => {
    const t = capa.tamano;
    const moneda = String(capa.moneda ?? '').trim();
    const monto = String(capa.monto ?? '').trim();
    const muestra = !monto;
    const fMoneda = `400 ${t}px Inter`;
    const fNumero = `800 ${t}px Inter`;
    const cw = moneda ? anchoTexto(moneda, fMoneda) : 0;
    const gap = moneda ? t * 0.22 : 0;
    const nw = anchoTexto(muestra ? '00' : monto, fNumero);
    return { moneda, monto: muestra ? '00' : monto, muestra, fMoneda, fNumero, cw, gap, w: cw + gap + nw, h: t * 1.04 };
};

const layoutEtiqueta = (capa) => {
    const t = capa.tamano;
    const texto = String(capa.texto ?? '').trim();
    const muestra = !texto;
    const fuente = fuenteDe(capa);
    const tw = anchoTexto(muestra ? MUESTRA.etiqueta : texto, fuente);
    return { texto: muestra ? MUESTRA.etiqueta : texto, muestra, fuente, w: tw + t * 2, h: t * 2, grosor: Math.max(2, t * 0.088) };
};

export const medirCapa = (capa) => {
    switch (capa.tipo) {
        case 'titulo':
        case 'texto':
        case 'dato': {
            const l = layoutTexto(capa);
            return { w: l.w, h: l.h };
        }
        case 'precio': {
            const l = layoutPrecio(capa);
            return { w: l.w, h: l.h };
        }
        case 'etiqueta': {
            const l = layoutEtiqueta(capa);
            return { w: l.w, h: l.h };
        }
        case 'logo': {
            const d = capa.version === 'logotipo' ? LOGOTIPO : ISOTIPO;
            return { w: capa.ancho, h: capa.ancho * d.h / d.w };
        }
        case 'asterisco':
            return { w: capa.ancho, h: capa.ancho };
        case 'barra':
        case 'imagen':
            return { w: capa.ancho, h: capa.alto };
        default:
            return { w: 10, h: 10 };
    }
};

// ---------- fondo ----------

const halo = (ctx, W, H, x, y, r, hex, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hex, a));
    g.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
};

// Negro con halos (oscuro) o la tinta a pleno (tinta), el grano y el recuadro.
export const dibujarFondo = (ctx, { W, H, fondo, acento, marco }) => {
    const tinta = fondo === 'tinta';
    const ac = TINTAS[acento] || TINTAS.magenta;
    const so = SOMBRAS[acento] || SOMBRAS.magenta;
    ctx.save();
    ctx.fillStyle = tinta ? ac : '#000000';
    ctx.fillRect(0, 0, W, H);
    if (tinta) {
        halo(ctx, W, H, 0, 0, W * 0.95, '#ffffff', 0.3);
        halo(ctx, W, H, W, H, W * 0.95, so, 0.5);
    } else {
        halo(ctx, W, H, 0, H * 0.72, W * 0.8, SOMBRAS.amarillo, 0.85);
        halo(ctx, W, H, W, H * 0.08, W * 0.75, SOMBRAS.magenta, 0.8);
        halo(ctx, W, H, W * 0.92, H, W * 0.85, SOMBRAS.cian, 0.85);
    }
    ctx.fillStyle = ctx.createPattern(texturaGrano(), 'repeat');
    ctx.fillRect(0, 0, W, H);
    if (marco) {
        rr(ctx, MARCO.inset, MARCO.inset, W - MARCO.inset * 2, H - MARCO.inset * 2, MARCO.radio);
        ctx.lineWidth = MARCO.grosor;
        ctx.strokeStyle = tinta ? '#000000' : ac;
        ctx.stroke();
    }
    ctx.restore();
};

// ---------- capas ----------

// Barra de Proceso: cápsula de cuatro segmentos con cortes en diagonal (CMY + blanco), o de un
// solo color con aire entre segmentos (sobre la tinta va en negro).
const dibujarBarra = (ctx, w, h, mono) => {
    const k = h * 0.414, seg = w / 4, gap = mono ? h * 0.3 : 0;
    const cols = [TINTAS.cian, TINTAS.magenta, TINTAS.amarillo, '#ffffff'];
    ctx.save();
    rr(ctx, 0, 0, w, h, h / 2);
    ctx.clip();
    for (let i = 0; i < 4; i++) {
        const a = seg * i + (i ? gap / 2 : -k);
        const b = seg * (i + 1) - (i < 3 ? gap / 2 : -k);
        ctx.beginPath();
        ctx.moveTo(a + k, 0); ctx.lineTo(b + k, 0); ctx.lineTo(b, h); ctx.lineTo(a, h);
        ctx.closePath();
        ctx.fillStyle = mono || cols[i];
        ctx.fill();
    }
    ctx.restore();
};

const dibujarPaths = (ctx, def, w, h, colorUnico) => {
    ctx.save();
    ctx.scale(w / def.w, h / def.h);
    def.paths.forEach((p) => {
        const [color, d] = Array.isArray(p) ? p : [null, p];
        ctx.fillStyle = colorUnico || color;
        ctx.fill(new Path2D(d));
    });
    ctx.restore();
};

const formaImagen = (ctx, forma, w, h) => {
    if (forma === 'circulo') {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.closePath();
    } else if (forma === 'recta') {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.closePath();
    } else if (forma === 'redondeada') {
        rr(ctx, 0, 0, w, h, 34);
    } else {
        // La de la marca: dos esquinas grandes arriba (150 px en la foto de 952 × 531 del compositor).
        const k = Math.min(1, Math.min(w, h) / 531);
        rr(ctx, 0, 0, w, h, [150 * k, 150 * k, 34 * k, 34 * k]);
    }
};

const dibujarAyuda = (ctx, w, h, texto, tinta) => {
    ctx.save();
    ctx.fillStyle = tinta ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = tinta ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.4)';
    ctx.stroke();
    ctx.setLineDash([]);
    const t = Math.max(16, Math.min(34, w / 16));
    ctx.font = `500 ${t}px Inter`;
    ctx.fillStyle = tinta ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, w / 2, h / 2, w - 40);
    ctx.restore();
};

const dibujarImagen = (ctx, capa, img, tinta, w, h) => {
    formaImagen(ctx, capa.forma, w, h);
    const lista = img && img.complete && img.naturalWidth > 0;
    if (!lista) {
        if (estadoDibujo.exportando) return;
        let ayuda = 'Arrastrá una foto acá';
        if (capa.faltaImagen) ayuda = `Subí de nuevo: ${capa.faltaImagen}`;
        else if (capa.src && img === null) ayuda = 'No se pudo cargar la foto';
        else if (capa.src) ayuda = 'Cargando foto…';
        dibujarAyuda(ctx, w, h, ayuda, tinta);
        return;
    }
    ctx.save();
    ctx.clip();
    const zoom = Math.max(1, capa.zoom || 1);
    const sc = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
    const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    const fx = capa.encuadreX ?? 0.5, fy = capa.encuadreY ?? 0.5;
    ctx.drawImage(img, (w - dw) * fx, (h - dh) * fy, dw, dh);
    ctx.restore();
    if (capa.borde) {
        formaImagen(ctx, capa.forma, w, h);
        ctx.lineWidth = 2;
        ctx.strokeStyle = tinta ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.35)';
        ctx.stroke();
    }
};

const conMuestra = (ctx, muestra, dibujar) => {
    if (muestra && estadoDibujo.exportando) return;
    ctx.save();
    if (muestra) ctx.globalAlpha *= 0.35;
    dibujar();
    ctx.restore();
};

// Dibuja una capa en su caja. `pieza` trae el fondo y el acento (para resolver los colores).
export const dibujarCapa = (ctx, capa, pieza, img) => {
    if (!capa) return;
    const tinta = pieza?.fondo === 'tinta';
    const color = (c) => resolverColor(c, pieza?.fondo, pieza?.acento);
    switch (capa.tipo) {
        case 'titulo':
        case 'texto':
        case 'dato': {
            const l = layoutTexto(capa);
            conMuestra(ctx, l.muestra, () => {
                ctx.font = l.fuente;
                ctx.fillStyle = color(capa.color);
                ctx.textBaseline = 'top';
                const al = capa.alineacion || 'center';
                ctx.textAlign = al === 'left' ? 'left' : al === 'right' ? 'right' : 'center';
                const x = al === 'left' ? 0 : al === 'right' ? l.w : l.w / 2;
                const ajuste = (l.alto - capa.tamano) / 2;
                l.lineas.forEach((linea, i) => ctx.fillText(linea, x, i * l.alto + ajuste));
            });
            break;
        }
        case 'precio': {
            const l = layoutPrecio(capa);
            conMuestra(ctx, l.muestra, () => {
                ctx.fillStyle = color(capa.color);
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                if (l.moneda) {
                    ctx.font = l.fMoneda;
                    ctx.fillText(l.moneda, 0, 0);
                }
                ctx.font = l.fNumero;
                ctx.fillText(l.monto, l.cw + l.gap, 0);
            });
            break;
        }
        case 'etiqueta': {
            const l = layoutEtiqueta(capa);
            conMuestra(ctx, l.muestra, () => {
                const g = l.grosor;
                rr(ctx, g / 2, g / 2, l.w - g, l.h - g, (l.h - g) / 2);
                ctx.lineWidth = g;
                ctx.strokeStyle = color(capa.colorBorde || 'acento');
                ctx.stroke();
                ctx.font = l.fuente;
                ctx.fillStyle = color(capa.color);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(l.texto, l.w / 2, l.h / 2 + capa.tamano * 0.06);
            });
            break;
        }
        case 'logo': {
            const { w, h } = medirCapa(capa);
            if (capa.version === 'logotipo') {
                // En color solo sobre el negro: sobre la tinta, la barra se pierde y va en negro.
                const unico = capa.color && capa.color !== 'auto' ? color(capa.color) : tinta ? '#000000' : null;
                dibujarPaths(ctx, LOGOTIPO, w, h, unico);
            } else {
                dibujarPaths(ctx, ISOTIPO, w, h, color(capa.color));
            }
            break;
        }
        case 'asterisco':
            dibujarPaths(ctx, ASTERISCO, capa.ancho, capa.ancho, color(capa.color));
            break;
        case 'barra':
            dibujarBarra(ctx, capa.ancho, capa.alto, tinta ? '#000000' : null);
            break;
        case 'imagen':
            dibujarImagen(ctx, capa, img, tinta, capa.ancho, capa.alto);
            break;
        default:
            break;
    }
};
