// Modelo de la pieza: un fondo (formato, fondo, acento, marco) y una lista de capas.
// El orden de la lista es el de dibujo: la primera queda al fondo y la última, adelante.
//
// Cada capa tiene su caja: x, y (arriba a la izquierda), el giro en grados alrededor de ese punto
// (como Konva) y el ancho y alto que da medirCapa. Las capas no salen del recuadro: normalizar()
// las corre adentro después de cada cambio, con la caja girada.

import { FORMATOS, LIMITE_MARCO, ISOTIPO } from './marca';
import { medirCapa } from './dibujo';

export const TIPOS = {
    titulo: { nombre: 'Título', rol: 'titulo' },
    texto: { nombre: 'Texto', rol: null },
    dato: { nombre: 'Dato técnico', rol: 'unidad' },
    precio: { nombre: 'Precio', rol: 'precio' },
    etiqueta: { nombre: 'Etiqueta', rol: 'categoria' },
    imagen: { nombre: 'Imagen', rol: 'imagen' },
    logo: { nombre: 'Logo', rol: null },
    barra: { nombre: 'Barra de proceso', rol: null },
    asterisco: { nombre: 'Asterisco', rol: null },
};

export const ES_TEXTO = new Set(['titulo', 'texto', 'dato']);

let contador = 0;
export const nuevoId = () => `c${Date.now().toString(36)}${(contador++).toString(36)}`;

const valoresPorDefecto = (tipo) => {
    switch (tipo) {
        case 'titulo': return { texto: 'Título', tamano: 108, ancho: 872, color: 'auto', alineacion: 'center' };
        case 'texto': return { texto: 'Texto de apoyo', tamano: 34, ancho: 700, color: 'auto', alineacion: 'center', peso: '400', mayusculas: false };
        case 'dato': return { texto: 'Dato técnico', tamano: 30, ancho: 700, color: 'suave', alineacion: 'center', corchetes: false };
        case 'precio': return { moneda: 'US$', monto: '00', tamano: 132, color: 'auto' };
        case 'etiqueta': return { texto: 'Etiqueta', tamano: 34, color: 'auto', colorBorde: 'acento' };
        case 'imagen': return { src: null, origen: null, nombreArchivo: '', ancho: 640, alto: 480, forma: 'marca', borde: true, zoom: 1, encuadreX: 0.5, encuadreY: 0.5 };
        case 'logo': return { version: 'isotipo', ancho: 68, color: 'auto' };
        case 'barra': return { ancho: 780, alto: 44 };
        case 'asterisco': return { ancho: 64, color: 'auto' };
        default: return {};
    }
};

export const piezaVacia = () => ({ v: 1, formato: 'feed', fondo: 'oscuro', acento: 'magenta', marco: true, capas: [] });

export const dimensiones = (pieza) => FORMATOS[pieza.formato] || FORMATOS.feed;

export const limites = (pieza) => {
    const { W, H } = dimensiones(pieza);
    const m = pieza.marco ? LIMITE_MARCO : 0;
    return { x0: m, y0: m, x1: W - m, y1: H - m };
};

// ---------- geometría ----------

const rad = (g) => (g || 0) * Math.PI / 180;

export const esquinas = (x, y, w, h, rot) => {
    const c = Math.cos(rad(rot)), s = Math.sin(rad(rot));
    return [[0, 0], [w, 0], [w, h], [0, h]].map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]);
};

export const cajaEnvolvente = (x, y, w, h, rot) => {
    const p = esquinas(x, y, w, h, rot);
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

export const centroDe = (capa, w, h) => {
    const c = Math.cos(rad(capa.rotacion)), s = Math.sin(rad(capa.rotacion));
    return [capa.x + (w / 2) * c - (h / 2) * s, capa.y + (w / 2) * s + (h / 2) * c];
};

// Posición (x, y) que deja el centro de una caja w × h girada `rot` en (cx, cy).
export const origenDesdeCentro = (cx, cy, w, h, rot) => {
    const c = Math.cos(rad(rot)), s = Math.sin(rad(rot));
    return { x: cx - (w / 2) * c + (h / 2) * s, y: cy - (w / 2) * s - (h / 2) * c };
};

// Corrimiento que mete la caja (girada) dentro de los límites. Si no entra, queda pegada arriba a la izquierda.
export const corrimientoDentro = (b, lim) => {
    let dx = 0, dy = 0;
    if (b.x1 - b.x0 > lim.x1 - lim.x0 || b.x0 < lim.x0) dx = lim.x0 - b.x0;
    else if (b.x1 > lim.x1) dx = lim.x1 - b.x1;
    if (b.y1 - b.y0 > lim.y1 - lim.y0 || b.y0 < lim.y0) dy = lim.y0 - b.y0;
    else if (b.y1 > lim.y1) dy = lim.y1 - b.y1;
    return { dx, dy };
};

export const encerrar = (capa, lim) => {
    const { w, h } = medirCapa(capa);
    const { dx, dy } = corrimientoDentro(cajaEnvolvente(capa.x, capa.y, w, h, capa.rotacion), lim);
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return capa;
    return { ...capa, x: capa.x + dx, y: capa.y + dy };
};

export const normalizar = (pieza) => {
    const lim = limites(pieza);
    let cambio = false;
    const capas = pieza.capas.map((c) => {
        const n = encerrar(c, lim);
        if (n !== c) cambio = true;
        return n;
    });
    return cambio ? { ...pieza, capas } : pieza;
};

// Cambia propiedades de una capa sin mover su centro (tamaño de letra, precio, versión del logo):
// una pieza centrada sigue centrada.
export const cambiarConCentro = (capa, cambios) => {
    const antes = medirCapa(capa);
    const [cx, cy] = centroDe(capa, antes.w, antes.h);
    const nueva = { ...capa, ...cambios };
    const despues = medirCapa(nueva);
    return { ...nueva, ...origenDesdeCentro(cx, cy, despues.w, despues.h, nueva.rotacion) };
};

// Gira alrededor del centro, como la manija de giro.
export const rotarCapa = (capa, grados) => {
    const { w, h } = medirCapa(capa);
    const [cx, cy] = centroDe(capa, w, h);
    const r = ((Number(grados) % 360) + 360) % 360;
    const rot = r > 180 ? r - 360 : r;
    return { ...capa, rotacion: rot, ...origenDesdeCentro(cx, cy, w, h, rot) };
};

// ---------- crear ----------

export const crearCapa = (tipo, pieza, extra = {}) => {
    const capa = { id: nuevoId(), tipo, rol: null, x: 0, y: 0, rotacion: 0, oculta: false, bloqueada: false, ...valoresPorDefecto(tipo), ...extra };
    if (extra.x === undefined || extra.y === undefined) {
        const { W, H } = dimensiones(pieza);
        const { w, h } = medirCapa(capa);
        if (extra.x === undefined) capa.x = (W - w) / 2;
        if (extra.y === undefined) capa.y = (H - h) / 2;
    }
    return capa;
};

// La copia queda corrida 24 px y sin rol: el producto sigue llenando la original.
export const duplicarCapa = (capa) => ({ ...capa, id: nuevoId(), rol: null, x: capa.x + 24, y: capa.y + 24 });

export const nombreCapa = (capa) => {
    const tipo = TIPOS[capa.tipo]?.nombre || capa.tipo;
    let detalle = '';
    if (ES_TEXTO.has(capa.tipo) || capa.tipo === 'etiqueta') detalle = String(capa.texto || '').replace(/\s+/g, ' ').trim();
    else if (capa.tipo === 'precio') detalle = [capa.moneda, capa.monto].filter(Boolean).join(' ');
    else if (capa.tipo === 'imagen') detalle = capa.nombreArchivo || (capa.src ? 'foto' : 'sin foto');
    else if (capa.tipo === 'logo') detalle = capa.version === 'logotipo' ? 'logotipo' : 'isotipo';
    return { tipo, detalle };
};

// ---------- plantillas ----------

export const PLANTILLAS = [
    { id: 'precio-foto', nombre: 'Precio con foto' },
    { id: 'precio', nombre: 'Precio sin foto' },
    { id: 'blanco', nombre: 'En blanco' },
];

// El diseño del compositor de Marketing pasado a capas: logo, etiqueta, título, precio y dato,
// centrados, y abajo la foto (o la barra de proceso). Con textos de muestra, sin precios reales.
export const capasDePlantilla = (id, pieza) => {
    if (id === 'blanco') return [];
    const { W, H } = dimensiones(pieza);
    const hist = pieza.formato === 'historia';
    const pad = 104, maxW = W - pad * 2, cx = W / 2;
    const capas = [];
    let y = 112;

    const logoAlto = 100;
    const logoAncho = logoAlto * ISOTIPO.w / ISOTIPO.h;
    capas.push(crearCapa('logo', pieza, { ancho: logoAncho, x: cx - logoAncho / 2, y }));
    y += logoAlto + (hist ? 120 : 64);

    const etiqueta = crearCapa('etiqueta', pieza, { rol: 'categoria', texto: 'Categoría', x: 0, y });
    const me = medirCapa(etiqueta);
    etiqueta.x = cx - me.w / 2;
    capas.push(etiqueta);
    y += me.h + (hist ? 64 : 40);

    const titulo = crearCapa('titulo', pieza, { rol: 'titulo', texto: 'Nombre del producto', tamano: hist ? 124 : 108, ancho: maxW, x: pad, y });
    capas.push(titulo);
    y += medirCapa(titulo).h + (hist ? 44 : 26);

    const precio = crearCapa('precio', pieza, { rol: 'precio', moneda: 'US$', monto: '00', tamano: hist ? 156 : 132, x: 0, y });
    const mp = medirCapa(precio);
    precio.x = cx - mp.w / 2;
    capas.push(precio);
    y += mp.h + 10;

    const dato = crearCapa('dato', pieza, { rol: 'unidad', texto: 'unidad • medida', ancho: maxW, x: pad, y });
    capas.push(dato);
    y += 44;

    const top = y + (hist ? 64 : 44), bot = H - 64;
    if (id === 'precio-foto' && bot - top >= 150) {
        capas.push(crearCapa('imagen', pieza, { rol: 'imagen', x: 64, y: top, ancho: W - 128, alto: bot - top }));
    } else if (bot - top >= 80) {
        const ancho = W - 300, alto = 44;
        capas.push(crearCapa('barra', pieza, { ancho, alto, x: cx - ancho / 2, y: (top + bot) / 2 - alto / 2 }));
    }
    return capas;
};

// Feed ↔ historia: cada capa conserva su altura relativa (por el centro) y vuelve al recuadro.
export const cambiarFormato = (pieza, formato) => {
    if (pieza.formato === formato) return pieza;
    const H0 = dimensiones(pieza).H;
    const H1 = (FORMATOS[formato] || FORMATOS.feed).H;
    const capas = pieza.capas.map((c) => {
        const { w, h } = medirCapa(c);
        const [cx, cy] = centroDe(c, w, h);
        return { ...c, ...origenDesdeCentro(cx, cy * H1 / H0, w, h, c.rotacion) };
    });
    return normalizar({ ...pieza, formato, capas });
};

// ---------- producto ----------

const formatoMonto = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    const entero = Math.abs(v - Math.round(v)) < 0.005;
    return v.toLocaleString('es-UY', { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: 2 });
};

// «SUBLIMACIÓN» → «Sublimación», «ESTAMPADO DTF» → «Estampado DTF»: las palabras cortas que no
// son conectores («DTF», «UV», «TPU») y ECOUV quedan como siglas.
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'y', 'e', 'o', 'con', 'sin', 'por', 'para', 'al', 'a']);
const comoEtiqueta = (s) => {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    if (!t || t !== t.toUpperCase()) return t;
    const palabras = t.split(' ').map((p) => {
        const min = p.toLowerCase();
        if (p === 'ECOUV' || p === 'CMYK' || (p.length <= 3 && /[A-Z]/.test(p) && !CONECTORES.has(min))) return p;
        return min;
    });
    const r = palabras.join(' ');
    return r.charAt(0).toUpperCase() + r.slice(1);
};

// Llena las capas con rol (título, precio, dato, etiqueta, imagen) con los datos del producto. Si
// falta alguna, la crea. Devuelve la pieza y qué no se pudo completar.
export const aplicarProducto = (pieza, { titulo, grupo, descripcionLista, moneda, precio, foto }) => {
    const avisos = [];
    let capas = [...pieza.capas];
    const datos = {
        titulo: { tipo: 'titulo', cambios: { texto: titulo } },
        categoria: { tipo: 'etiqueta', cambios: { texto: comoEtiqueta(grupo) } },
        precio: { tipo: 'precio', cambios: { moneda: moneda === 'UYU' ? '$' : 'US$', monto: precio == null ? '' : formatoMonto(precio) } },
        unidad: { tipo: 'dato', cambios: { texto: descripcionLista || '' } },
    };
    if (!descripcionLista) avisos.push('El producto no tiene descripción para la lista: el dato técnico quedó vacío.');
    if (foto) datos.imagen = { tipo: 'imagen', cambios: { src: foto, origen: 'vitrina', nombreArchivo: '', faltaImagen: null } };

    Object.entries(datos).forEach(([rol, { tipo, cambios }]) => {
        const i = capas.findIndex(c => c.rol === rol);
        if (i >= 0) {
            capas[i] = tipo === 'precio' || tipo === 'etiqueta' ? cambiarConCentro(capas[i], cambios) : { ...capas[i], ...cambios };
        } else {
            capas.push(crearCapa(tipo, pieza, { rol, ...cambios }));
        }
    });
    return { pieza: normalizar({ ...pieza, capas }), avisos };
};
