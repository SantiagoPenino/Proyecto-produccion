import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, RotateCcw, Box, ExternalLink, Wrench } from 'lucide-react';
import Selector from '../ui/Selector';
import { estadoEquipo } from './constantes';
import {
    cantParedes, tramoPared, distancia, caja, detectarHabitaciones, esInstalacion, INSTALACIONES,
    ALTURA_PLANTA, ALTO_ABERTURA, ANTEPECHO_VENTANA, COLORES_HABITACION,
} from './planoLocal';

// Servicio Técnico → Locales → vista 3D del local (21/10/2026). Se arma con el plano de cada planta (planoLocal.js):
// paredes con su altura y los huecos de puertas, portones y ventanas, el piso de cada planta (la alta encima de la
// baja), las habitaciones con su color, columnas, escalera, ascensor, instalaciones y las máquinas como cajas con las
// medidas de su ficha (frente × fondo × alto; la cara más oscura es el frente). three.js se carga recién al abrir,
// se dibuja solo cuando se mueve la cámara y al cerrar se libera el contexto (como el visor 3D de TPU).
// En el mundo 3D: x = x del plano, z = y del plano, y = altura; en metros.

const M = 0.01; // cm → m
const LOSA = 0.2; // espesor del piso entre plantas (m)
const E_CONTORNO = 15, E_INTERIOR = 10; // espesor de las paredes (cm)
// Los pisos de color (habitaciones, oficina) van casi pegados al piso gris: se dibujan siempre por delante, si no desde
// lejos la placa no distingue cuál está arriba y se cuelan rayas grises al mover la cámara (z-fighting).
const SOBRE_EL_PISO = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };

// Colores de las máquinas: uno solo, por área (una paleta, en el orden de las áreas) o por estado de la máquina (los de
// Servicio Técnico: Disponible, Ocupado = andando, Mantenimiento = en servicio, Falla).
const COLOR_UNO = '#7dd3fc';
const PALETA_AREAS = ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#60a5fa', '#f87171', '#2dd4bf', '#a3e635', '#e879f9', '#94a3b8'];
const COLOR_ESTADO = { DISPONIBLE: '#34d399', OCUPADO: '#38bdf8', MANTENIMIENTO: '#fbbf24', FALLA: '#f87171' };
const claveEstado = (v) => { const k = String(v || '').trim().toUpperCase(); return !k || k === 'OK' ? 'DISPONIBLE' : k; };
const colorMaquina = (modo, eq, areas) => (modo === 'area' ? PALETA_AREAS[Math.max(0, areas.indexOf(eq?.AreaID)) % PALETA_AREAS.length]
    : modo === 'estado' ? COLOR_ESTADO[claveEstado(eq?.Estado)] || '#a1a1aa' : COLOR_UNO);

const capital = (s) => String(s || '').replace(/(^|\s)(\p{L})/gu, (m, e, l) => e + l.toUpperCase());

// Tramos de una pared entre sus aberturas: [desde, hasta] en cm.
function tramosLibres(aberturas, L) {
    const abs = aberturas.map(a => [Math.max(0, a.desde), Math.min(L, a.desde + a.ancho)]).sort((x, y) => x[0] - y[0]);
    const r = [];
    let t = 0;
    for (const [d, h] of abs) { if (d > t) r.push([t, d]); t = Math.max(t, h); }
    if (t < L) r.push([t, L]);
    return r;
}
// Normal hacia afuera de la pared i del contorno (con el eje y para abajo, suma del cordón positiva = horario).
function normalAfuera(p, a, b) {
    const L = distancia(a, b) || 1;
    const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
    let s = 0;
    for (let j = 0; j < p.puntos.length; j++) { const u = p.puntos[j], v = p.puntos[(j + 1) % p.puntos.length]; s += u.x * v.y - v.x * u.y; }
    return s >= 0 ? { x: dy, y: -dx } : { x: -dy, y: dx };
}

function armarEscena(THREE, plantas, { medidas, nombres }) {
    const escena = new THREE.Scene();
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
    const mats = {
        pared: mat('#e7e5e4'), interior: mat('#f5f5f4'), piso: mat('#d6d3d1'), columna: mat('#52525b'),
        escalon: mat('#a8a29e'), hoja: mat('#a16207'), vidrio: mat('#7dd3fc', { transparent: true, opacity: 0.35 }),
        ascensor: mat('#94a3b8', { transparent: true, opacity: 0.45 }), maquina: mat('#7dd3fc'), frente: mat('#0369a1'),
        tablero: mat('#71717a'), toma: mat('#f97316'), compresor: mat('#64748b'), extractor: mat('#a1a1aa'),
        matafuegos: mat('#dc2626'), salida: mat('#16a34a'), otro: mat('#e4e4e7', { transparent: true, opacity: 0.6 }),
    };
    const bordes = new THREE.LineBasicMaterial({ color: '#57534e', transparent: true, opacity: 0.35 });
    const conBordes = (m) => { m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), bordes)); return m; };

    // Caja a lo largo de una dirección: de t1 a t2 (cm) desde `a` sobre `u`, `grosor` cm, de y1 a y2 (m).
    const cajaEntre = (a, u, t1, t2, grosor, y1, y2, material, grupo, bordesSi = true) => {
        const L = (t2 - t1) * M;
        if (L <= 0.001 || y2 - y1 <= 0.001) return null;
        const m = new THREE.Mesh(new THREE.BoxGeometry(L, y2 - y1, grosor * M), material);
        const tc = (t1 + t2) / 2;
        m.position.set((a.x + u.x * tc) * M, (y1 + y2) / 2, (a.y + u.y * tc) * M);
        m.rotation.y = -Math.atan2(u.y, u.x);
        grupo.add(bordesSi ? conBordes(m) : m);
        return m;
    };
    // Caja alineada a los ejes (centro en el plano, de y1 a y2 en m).
    const cajaEjes = (cx, cz, w, d, y1, y2, material, grupo) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w * M, y2 - y1, d * M), material);
        m.position.set(cx * M, (y1 + y2) / 2, cz * M);
        grupo.add(conBordes(m));
        return m;
    };
    // Cartel con texto que siempre mira a la cámara, del mismo tamaño en pantalla de cerca y de lejos (`alto`: fracción
    // del alto de la vista por renglón). Se dibuja encima de todo (las paredes no lo cortan). `siempre`: se ve con
    // «Mostrar nombres»; si no, solo al pasar el mouse por lo que nombra.
    const cartel = (texto, x, y, z, { color = '#0f172a', alto = 0.3, siempre = true } = {}) => {
        const lineas = String(texto).split('\n');
        const fs = 44;
        const cv = document.createElement('canvas');
        const ctx = cv.getContext('2d');
        ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`;
        const w = Math.ceil(Math.max(...lineas.map(l => ctx.measureText(l).width)) + 36), h = lineas.length * (fs + 8) + 20;
        cv.width = w; cv.height = h;
        ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill();
        ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        lineas.forEach((l, i) => ctx.fillText(l, w / 2, 10 + (fs + 8) * (i + 0.5)));
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
        const hm = alto * 0.11 * lineas.length;
        s.scale.set(hm * w / h, hm, 1);
        s.position.set(x, y, z);
        s.renderOrder = 10;
        s.userData.cartel = true;
        s.userData.siempre = siempre;
        s.visible = false;
        return s;
    };
    // Lo que se puede tocar o señalar con el mouse para ver su cartel (máquinas, habitaciones, elementos).
    const objetivos = [];
    const vincular = (objs, s, g, plantaId) => {
        s.userData.planta = plantaId;
        (Array.isArray(objs) ? objs : [objs]).filter(Boolean).forEach(o => { o.userData.cartel = s; o.userData.planta = plantaId; objetivos.push(o); });
        g.add(s);
        return s;
    };

    const maquinas3D = [];
    const grupos = new Map();
    const limites = new Map(); // por planta: { x1, x2, z1, z2, y1, y2 } en m (para encuadrar las que se ven)
    let elev = 0;
    for (const { planta, plano: p } of plantas) {
        const g = new THREE.Group();
        grupos.set(planta.PlantaId, g);
        escena.add(g);
        const H = (p.altura || ALTURA_PLANTA) * M;
        const pts = [...p.puntos, ...p.interiores.flatMap(w => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }])];
        limites.set(planta.PlantaId, {
            x1: Math.min(...pts.map(q => q.x)) * M, x2: Math.max(...pts.map(q => q.x)) * M,
            z1: Math.min(...pts.map(q => q.y)) * M, z2: Math.max(...pts.map(q => q.y)) * M, y1: elev, y2: elev + H,
        });

        // Piso (losa) con la forma del contorno.
        if (p.cerrado && p.puntos.length >= 3) {
            const forma = new THREE.Shape(p.puntos.map(q => new THREE.Vector2(q.x * M, q.y * M)));
            const geo = new THREE.ExtrudeGeometry(forma, { depth: elev === 0 ? 0.12 : LOSA, bevelEnabled: false });
            const losa = new THREE.Mesh(geo, mats.piso);
            losa.rotation.x = Math.PI / 2; // la forma (x, y) queda en (x, z) y el espesor va para abajo
            losa.position.y = elev;
            g.add(losa);
        }
        // Habitaciones: el piso de cada una con su color y el cartel con el nombre y los m².
        detectarHabitaciones(p).forEach((hb, i) => {
            const forma = new THREE.Shape(hb.poligono.map(q => new THREE.Vector2(q.x * M, q.y * M)));
            hb.huecos.forEach(h => forma.holes.push(new THREE.Path(h.map(q => new THREE.Vector2(q.x * M, q.y * M)))));
            const m = new THREE.Mesh(new THREE.ShapeGeometry(forma), new THREE.MeshBasicMaterial({ color: COLORES_HABITACION[i % COLORES_HABITACION.length], side: THREE.DoubleSide, ...SOBRE_EL_PISO }));
            m.rotation.x = Math.PI / 2;
            m.position.y = elev + 0.01;
            g.add(m);
            vincular(m, cartel(`${hb.nombre ? `${hb.nombre}\n` : ''}${hb.areaM2.toLocaleString('es-UY', { maximumFractionDigits: 1 })} m²`,
                hb.etiqueta.x * M, elev + 0.15, hb.etiqueta.y * M, { color: '#334155', alto: 0.26 }), g, planta.PlantaId);
        });

        // Paredes con sus aberturas: tramos llenos, dintel encima de cada hueco, antepecho y vidrio en las ventanas, y la
        // hoja de las puertas abierta a 90° (como en el plano).
        const paredes = [];
        for (let i = 0; i < cantParedes(p); i++) {
            const [a, b] = tramoPared(p, i);
            paredes.push({ a, b, E: E_CONTORNO, mat: mats.pared, abs: p.aberturas.filter(ab => ab.interior == null && ab.pared === i), nr: normalAfuera(p, a, b) });
        }
        for (const w of p.interiores) {
            const a = { x: w.x1, y: w.y1 }, b = { x: w.x2, y: w.y2 };
            const L = distancia(a, b) || 1;
            paredes.push({ a, b, E: E_INTERIOR, mat: mats.interior, abs: p.aberturas.filter(ab => ab.interior === w.id), nr: { x: -(b.y - a.y) / L, y: (b.x - a.x) / L } });
        }
        for (const { a, b, E, mat: mp, abs, nr } of paredes) {
            const L = distancia(a, b);
            if (L < 0.5) continue;
            const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
            for (const [t1, t2] of tramosLibres(abs, L)) {
                cajaEntre(a, u, t1 - (t1 <= 0.01 ? E / 2 : 0), t2 + (t2 >= L - 0.01 ? E / 2 : 0), E, elev, elev + H, mp, g);
            }
            for (const ab of abs) {
                const d = Math.max(0, ab.desde), h = Math.min(L, ab.desde + ab.ancho);
                const alto = (ab.alto || ALTO_ABERTURA[ab.tipo] || 210) * M;
                if (ab.tipo === 'ventana') {
                    const ante = (ab.antepecho ?? ANTEPECHO_VENTANA) * M;
                    cajaEntre(a, u, d, h, E, elev, elev + ante, mp, g);
                    cajaEntre(a, u, d, h, 2, elev + ante, elev + Math.min(H, ante + alto), mats.vidrio, g, false);
                    if (ante + alto < H) cajaEntre(a, u, d, h, E, elev + ante + alto, elev + H, mp, g);
                    continue;
                }
                if (alto < H) cajaEntre(a, u, d, h, E, elev + alto, elev + H, mp, g);
                if (ab.tipo === 'puerta') {
                    const lado = ab.lado || 0;
                    const bis = lado >= 2 ? h : d;
                    const H0 = { x: a.x + u.x * bis, y: a.y + u.y * bis };
                    const dir = lado % 2 === 1 ? nr : { x: -nr.x, y: -nr.y };
                    cajaEntre(H0, dir, 0, h - d, 4, elev, elev + Math.min(alto, H), mats.hoja, g);
                }
            }
        }

        // Columnas, escaleras, ascensores, oficinas, otros e instalaciones.
        for (const e of p.elementos) {
            const c = caja(e, e.w, e.h);
            const cx = (c.x1 + c.x2) / 2, cz = (c.y1 + c.y2) / 2, w = c.x2 - c.x1, d = c.y2 - c.y1;
            if (e.tipo === 'columna') cajaEjes(cx, cz, w, d, elev, elev + H, mats.columna, g);
            else if (e.tipo === 'ascensor') {
                const ma = cajaEjes(cx, cz, w, d, elev, elev + H, mats.ascensor, g);
                vincular(ma, cartel(e.nombre || 'Ascensor', cx * M, elev + H * 0.6, cz * M, { alto: 0.24 }), g, planta.PlantaId);
            } else if (e.tipo === 'escalera') {
                if (e.baja) continue; // en la planta de arriba es el hueco de la que sube desde abajo
                const largoX = w >= d, L = largoX ? w : d;
                const n = Math.max(2, Math.floor(L / 28));
                const sube = e.giro >= 180 ? -1 : 1;
                const subida = (H + LOSA) / n;
                const escalones = [];
                for (let i = 0; i < n; i++) {
                    const pos = (i + 0.5) * (L / n) * sube;
                    const ex = largoX ? (sube > 0 ? c.x1 : c.x2) + pos : cx, ez = largoX ? cz : (sube > 0 ? c.y1 : c.y2) + pos;
                    escalones.push(cajaEjes(ex, ez, largoX ? L / n : w, largoX ? d : L / n, elev, elev + subida * (i + 1), mats.escalon, g));
                }
                vincular(escalones, cartel(e.nombre || 'Escalera', cx * M, elev + H * 0.6, cz * M, { alto: 0.22, siempre: false }), g, planta.PlantaId);
            } else if (e.tipo === 'ambiente') {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(w * M, d * M), new THREE.MeshBasicMaterial({ color: '#bae6fd', transparent: true, opacity: 0.7, side: THREE.DoubleSide, ...SOBRE_EL_PISO }));
                m.rotation.x = -Math.PI / 2;
                m.position.set(cx * M, elev + 0.015, cz * M);
                g.add(m);
                vincular(m, cartel(`${e.nombre || 'Oficina'}\n${(e.w * e.h / 10000).toLocaleString('es-UY', { maximumFractionDigits: 1 })} m²`, cx * M, elev + 0.15, cz * M, { color: '#334155', alto: 0.24 }), g, planta.PlantaId);
            } else if (e.tipo === 'otro') {
                const mo = cajaEjes(cx, cz, w, d, elev, elev + 1, mats.otro, g);
                vincular(mo, cartel(e.nombre || 'Otro', cx * M, elev + 1.3, cz * M, { alto: 0.22, siempre: !!e.nombre }), g, planta.PlantaId);
            } else if (esInstalacion(e.tipo)) {
                const def = INSTALACIONES[e.tipo];
                const alturas = { tablero: [1, 1.8], toma: [1.15, 1.3], compresor: [0, 0.8], extractor: [H - 0.4, H], matafuegos: [1, 1.5], salida: [2.15, 2.35] }[e.tipo];
                const mi = cajaEjes(cx, cz, w, d, elev + alturas[0], elev + Math.min(H, alturas[1]), mats[e.tipo] || mats.otro, g);
                const texto = e.tipo === 'tablero' ? `${e.nombre || 'Tablero'}${e.termicaA ? ` · ${e.termicaA} A` : ''}` : e.nombre || def.label;
                // Con «Mostrar nombres» se ven el tablero y el compresor; el resto, al pasar el mouse.
                vincular(mi, cartel(texto, cx * M, elev + Math.min(H, alturas[1]) + 0.3, cz * M,
                    { color: '#92400e', alto: 0.2, siempre: e.tipo === 'tablero' || e.tipo === 'compresor' }), g, planta.PlantaId);
            }
        }

        // Máquinas: cajas con las medidas de la ficha; la cara más oscura es el frente (el color se pinta después).
        for (const m of p.maquinas) {
            const md = medidas[m.equipoId] || { w: 100, h: 100, alto: 100 };
            const [ww, dd] = m.giro % 180 === 0 ? [md.w, md.h] : [md.h, md.w];
            const altoM = (md.alto || 100) * M;
            const caras = Array(6).fill(mats.maquina);
            caras[{ 0: 4, 90: 1, 180: 5, 270: 0 }[m.giro] ?? 4] = mats.frente; // +x, −x, +y, −y, +z, −z
            const caja3 = new THREE.Mesh(new THREE.BoxGeometry(ww * M, altoM, dd * M), caras);
            caja3.position.set(m.x * M, elev + altoM / 2, m.y * M);
            caja3.userData.equipoId = m.equipoId;
            caja3.userData.caraFrente = { 0: 4, 90: 1, 180: 5, 270: 0 }[m.giro] ?? 4;
            maquinas3D.push(caja3);
            g.add(conBordes(caja3));
            vincular(caja3, cartel(nombres[m.equipoId] || `#${m.equipoId}`, m.x * M, elev + altoM + 0.3, m.y * M, { color: '#0c4a6e', alto: 0.26 }), g, planta.PlantaId);
        }
        elev += H + LOSA;
    }

    // Grilla de 1 m alrededor de la planta de más abajo (debajo de su piso).
    const base = limites.get(plantas[0]?.planta.PlantaId);
    if (base) {
        const tam = Math.ceil(Math.max(base.x2 - base.x1, base.z2 - base.z1, 10) + 8);
        const grilla = new THREE.GridHelper(tam, tam, '#a1a1aa', '#d4d4d8');
        grilla.position.set((base.x1 + base.x2) / 2, -0.16, (base.z1 + base.z2) / 2);
        escena.add(grilla);
    }

    escena.add(new THREE.HemisphereLight('#ffffff', '#a8a29e', 1.1));
    const sol = new THREE.DirectionalLight('#ffffff', 1.4);
    sol.position.set(0.6, 1.4, 0.9).multiplyScalar(50);
    escena.add(sol);
    return { escena, grupos, limites, objetivos, maquinas3D };
}

const Plano3D = ({ local, plantas, plantaActualId, medidas, nombres, equipos = [], onAbrirFicha, onPedirServicio, onCerrar }) => {
    const montaje = useRef(null);
    const api = useRef(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    // Se ven la planta que se está editando y las de abajo (las de arriba la taparían).
    const ordenActual = plantas.find(x => x.planta.PlantaId === plantaActualId)?.planta.Orden ?? Infinity;
    const [visibles, setVisibles] = useState(() => new Set(plantas.filter(x => x.planta.Orden <= ordenActual).map(x => x.planta.PlantaId)));
    const [carteles, setCarteles] = useState(false); // arrancan ocultos: se ve el de lo que está bajo el mouse
    const [colorPor, setColorPor] = useState('uno'); // 'uno' | 'area' | 'estado'
    const [elegida, setElegida] = useState(null);    // EquipoID tocada: tarjeta con sus datos y «Abrir ficha»
    const infoEq = Object.fromEntries(equipos.map(e => [e.EquipoID, e]));
    const enEscena = plantas.flatMap(x => x.plano.maquinas.map(m => ({ ...m, planta: x.planta })));
    const areas = [...new Set(enEscena.map(m => infoEq[m.equipoId]?.AreaID).filter(Boolean))].sort();
    // Leyenda del color elegido: solo lo de las plantas que se ven (los colores de las áreas no cambian al prender o
    // apagar una planta: salen de todas).
    const enVista = enEscena.filter(m => visibles.has(m.planta.PlantaId));
    const leyenda = colorPor === 'area'
        ? areas.filter(a => enVista.some(m => infoEq[m.equipoId]?.AreaID === a))
            .map(a => ({ color: colorMaquina('area', { AreaID: a }, areas), texto: equipos.find(e => e.AreaID === a)?.AreaNombre || a }))
        : colorPor === 'estado'
            ? [...new Set(enVista.map(m => claveEstado(infoEq[m.equipoId]?.Estado)))].map(k => ({ color: COLOR_ESTADO[k] || '#a1a1aa', texto: estadoEquipo(k).label }))
            : [];

    useEffect(() => {
        let vivo = true;
        let limpiar = () => {};
        (async () => {
            try {
                const THREE = await import('three');
                const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
                if (!vivo || !montaje.current) return;
                const cont = montaje.current;
                const { escena, grupos, limites, objetivos, maquinas3D } = armarEscena(THREE, plantas, { medidas, nombres });
                const renderer = new THREE.WebGLRenderer({ antialias: true });
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
                renderer.setSize(cont.clientWidth, cont.clientHeight);
                renderer.setClearColor('#f4f4f5');
                cont.appendChild(renderer.domElement);
                // near 0,3 m (no 5 cm): la precisión del fondo depende de far/near, y con 5 cm los pisos titilaban.
                const camara = new THREE.PerspectiveCamera(45, cont.clientWidth / cont.clientHeight, 0.3, 1000);
                const controles = new OrbitControls(camara, renderer.domElement);
                controles.screenSpacePanning = true;
                controles.maxPolarAngle = Math.PI * 0.49; // no se mete debajo del piso
                controles.minDistance = 1.5; // más cerca que el plano cercano de la cámara cortaría las cosas
                const dibujar = () => renderer.render(escena, camara);
                controles.addEventListener('change', dibujar);
                // Vista inicial: desde una esquina, en diagonal y de arriba, con las plantas que se ven adentro.
                let vistas = new Set(grupos.keys());
                const encuadrar = () => {
                    const ls = [...limites].filter(([id]) => vistas.has(id)).map(([, l]) => l);
                    const usar = ls.length ? ls : [...limites.values()];
                    if (!usar.length) return;
                    const x1 = Math.min(...usar.map(l => l.x1)), x2 = Math.max(...usar.map(l => l.x2));
                    const z1 = Math.min(...usar.map(l => l.z1)), z2 = Math.max(...usar.map(l => l.z2));
                    const y1 = Math.min(...usar.map(l => l.y1)), y2 = Math.max(...usar.map(l => l.y2));
                    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
                    const tam = Math.max(x2 - x1, z2 - z1, y2 - y1, 5);
                    controles.target.set(cx, y1 + (y2 - y1) * 0.3, cz);
                    camara.position.set(cx + tam * 0.7, y1 + tam * 0.9, cz + tam * 1.0);
                    controles.update();
                    dibujar();
                };
                const ro = new ResizeObserver(() => {
                    const w = cont.clientWidth, h = cont.clientHeight;
                    if (!w || !h) return;
                    camara.aspect = w / h;
                    camara.updateProjectionMatrix();
                    renderer.setSize(w, h);
                    dibujar();
                });
                ro.observe(cont);
                // Carteles: con «Mostrar nombres», los de la planta de más arriba que se ve (los de abajo quedan tapados por
                // su piso y amontonarían). Siempre, el de lo que está bajo el mouse (o lo último que se tocó con el dedo).
                let conNombres = false, arriba = null, hover = null;
                const normal = (s) => conNombres && s.userData.siempre && s.userData.planta === arriba;
                const ponerHover = (s) => {
                    if (s === hover) return;
                    const antes = hover;
                    hover = s;
                    if (antes) antes.visible = normal(antes);
                    if (s) s.visible = true;
                    renderer.domElement.style.cursor = s ? 'pointer' : '';
                    dibujar();
                };
                const raycaster = new THREE.Raycaster();
                const puntero = new THREE.Vector2();
                const objetoBajo = (ev) => {
                    const r = renderer.domElement.getBoundingClientRect();
                    puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
                    raycaster.setFromCamera(puntero, camara);
                    return raycaster.intersectObjects(objetivos.filter(o => grupos.get(o.userData.planta)?.visible), false)[0]?.object || null;
                };
                const bajo = (ev) => objetoBajo(ev)?.userData.cartel || null;

                // Máquina elegida: un contorno celeste alrededor (los materiales son compartidos: no se puede teñir una sola).
                let marco = null;
                const marcar = (mesh) => {
                    if (marco) { marco.parent?.remove(marco); marco.geometry.dispose(); marco = null; }
                    if (mesh) {
                        mesh.geometry.computeBoundingBox();
                        const bb = mesh.geometry.boundingBox;
                        const t = new THREE.Vector3(); bb.getSize(t);
                        marco = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(t.x + 0.08, t.y + 0.08, t.z + 0.08)),
                            new THREE.LineBasicMaterial({ color: '#0e7490', depthTest: false }));
                        marco.renderOrder = 9;
                        mesh.add(marco);
                    }
                    dibujar();
                };
                let toque = null;
                const alMover = (ev) => { if (ev.pointerType === 'mouse' && ev.buttons === 0) ponerHover(bajo(ev)); };
                const alSalir = () => ponerHover(null);
                const alBajar = (ev) => { toque = { x: ev.clientX, y: ev.clientY }; };
                const alSoltar = (ev) => {
                    // Un toque o un clic sin arrastrar: muestra el nombre (con el dedo) y, si es una máquina, la elige.
                    if (toque && Math.hypot(ev.clientX - toque.x, ev.clientY - toque.y) < 8 && ev.button === 0) {
                        const o = objetoBajo(ev);
                        if (ev.pointerType !== 'mouse') ponerHover(o?.userData.cartel || null);
                        const id = o?.userData.equipoId ?? null;
                        marcar(id != null ? o : null);
                        setElegida(id);
                    }
                    toque = null;
                };
                renderer.domElement.addEventListener('pointermove', alMover);
                renderer.domElement.addEventListener('pointerleave', alSalir);
                renderer.domElement.addEventListener('pointerdown', alBajar);
                renderer.domElement.addEventListener('pointerup', alSoltar);
                // Pintar las máquinas según el modo (materiales en caché por color: base y frente más oscuro).
                const cacheMat = new Map();
                const parDe = (color) => {
                    if (!cacheMat.has(color)) {
                        const base = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
                        const c = new THREE.Color(color); const hsl = {}; c.getHSL(hsl);
                        const frente = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l * 0.55), roughness: 0.9, metalness: 0 });
                        cacheMat.set(color, { base, frente });
                    }
                    return cacheMat.get(color);
                };
                const pintar = (modo) => {
                    for (const mesh of maquinas3D) {
                        const { base, frente } = parDe(colorMaquina(modo, infoEq[mesh.userData.equipoId], areas));
                        const caras = Array(6).fill(base);
                        caras[mesh.userData.caraFrente] = frente;
                        mesh.material = caras;
                    }
                    dibujar();
                };
                let primera = true;
                api.current = {
                    pintar,
                    elegir: (id) => marcar(id == null ? null : maquinas3D.find(m => m.userData.equipoId === id) || null),
                    encuadrar,
                    aplicar: (vis, conCarteles) => {
                        vistas = vis;
                        conNombres = conCarteles;
                        arriba = [...plantas].reverse().find(x => vis.has(x.planta.PlantaId))?.planta.PlantaId ?? null;
                        grupos.forEach((g, id) => {
                            g.visible = vis.has(id);
                            g.traverse(o => { if (o.userData.cartel === true) o.visible = normal(o) || o === hover; });
                        });
                        if (primera) { primera = false; encuadrar(); } else dibujar();
                    },
                };
                setCargando(false);
                limpiar = () => {
                    renderer.domElement.removeEventListener('pointermove', alMover);
                    renderer.domElement.removeEventListener('pointerleave', alSalir);
                    renderer.domElement.removeEventListener('pointerdown', alBajar);
                    renderer.domElement.removeEventListener('pointerup', alSoltar);
                    controles.removeEventListener('change', dibujar);
                    controles.dispose();
                    ro.disconnect();
                    cacheMat.forEach(({ base, frente }) => { base.dispose(); frente.dispose(); });
                    escena.traverse(o => {
                        o.geometry?.dispose();
                        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m?.map?.dispose(); m?.dispose(); });
                    });
                    renderer.dispose();
                    renderer.forceContextLoss(); // si no, abrir y cerrar va acumulando contextos WebGL
                    if (renderer.domElement.parentNode === cont) cont.removeChild(renderer.domElement);
                };
            } catch (e) {
                if (vivo) { setError(e?.message || 'No se pudo armar la vista 3D'); setCargando(false); }
            }
        })();
        return () => { vivo = false; api.current = null; limpiar(); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- se arma una vez con el plano como estaba al abrir

    useEffect(() => { api.current?.aplicar(visibles, carteles); }, [visibles, carteles, cargando]);
    useEffect(() => { api.current?.pintar(colorPor); }, [colorPor, cargando]); // eslint-disable-line react-hooks/exhaustive-deps

    const alternar = (id) => setVisibles(v => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    return createPortal(
        <div className="fixed inset-0 z-[6010] bg-white flex flex-col">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2 border-b border-zinc-200 shrink-0">
                <Box size={20} className="text-brand-cyan shrink-0" />
                <div className="font-black text-zinc-800 mr-auto">3D · {capital(local.Nombre)}</div>
                {plantas.length > 1 && plantas.map(({ planta }) => (
                    <label key={planta.PlantaId} className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-600 whitespace-nowrap">
                        <input type="checkbox" checked={visibles.has(planta.PlantaId)} onChange={() => alternar(planta.PlantaId)} className="w-4 h-4 accent-brand-cyan" />
                        {planta.Nombre}
                    </label>
                ))}
                <span className="w-40">
                    <Selector value={colorPor} onChange={(e) => setColorPor(e.target.value)} aria-label="Color de las máquinas">
                        <option value="uno">Máquinas: un color</option>
                        <option value="area">Color por área</option>
                        <option value="estado">Color por estado</option>
                    </Selector>
                </span>
                <label className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-600 whitespace-nowrap">
                    <input type="checkbox" checked={carteles} onChange={(e) => setCarteles(e.target.checked)} className="w-4 h-4 accent-brand-cyan" /> Mostrar nombres
                </label>
                <button type="button" onClick={() => api.current?.encuadrar()} title="Vista inicial"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100">
                    <RotateCcw size={15} /> Vista inicial
                </button>
                <button type="button" onClick={onCerrar} title="Cerrar" className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><X size={20} /></button>
            </div>
            <div className="relative flex-1 min-h-0">
                <div ref={montaje} className="absolute inset-0" style={{ touchAction: 'none' }} />
                {cargando && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-zinc-300" size={32} /></div>}
                {error && <div className="absolute inset-0 flex items-center justify-center text-sm text-rose-600">{error}</div>}
                {!cargando && !error && leyenda.length > 0 && (
                    <div className="absolute left-3 top-3 rounded-xl bg-white/95 border border-zinc-200 shadow-sm px-3 py-2 space-y-1 max-h-[60%] overflow-y-auto">
                        {leyenda.map(l => (
                            <div key={l.texto} className="flex items-center gap-2 text-xs font-bold text-zinc-600">
                                <span className="w-3.5 h-3.5 rounded shrink-0 border border-black/10" style={{ background: l.color }} />{l.texto}
                            </div>
                        ))}
                    </div>
                )}
                {elegida != null && (() => {
                    const eq = infoEq[elegida];
                    const md = medidas[elegida];
                    const m = enEscena.find(x => x.equipoId === elegida);
                    const est = estadoEquipo(eq?.Estado);
                    const metros = (cm) => (cm / 100).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    return (
                        <div className="absolute right-3 top-3 w-72 rounded-2xl bg-white border border-zinc-200 shadow-xl p-4 space-y-2">
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 mr-auto">
                                    <div className="font-black text-zinc-800 truncate">{eq?.Nombre || nombres[elegida] || `#${elegida}`}</div>
                                    <div className="text-xs text-zinc-500 truncate">{eq?.AreaNombre || eq?.AreaID || ''}{m ? ` · ${m.planta.Nombre}` : ''}</div>
                                </div>
                                <button type="button" onClick={() => { setElegida(null); api.current?.elegir(null); }} title="Cerrar"
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 shrink-0"><X size={16} /></button>
                            </div>
                            <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold ${est.chip}`}>{est.label}</span>
                            {md && (
                                <div className="text-xs text-zinc-600">
                                    {md.sinMedidas ? 'Sin medidas en la ficha' : `Frente ${metros(md.w)} × fondo ${metros(md.h)} m`}
                                    {!md.sinAlto && ` × alto ${metros(md.alto)} m`}
                                </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                                {onAbrirFicha && (
                                    <button type="button" onClick={() => onAbrirFicha(elegida)}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-brand-cyan text-white hover:bg-brand-cyan/90">
                                        <ExternalLink size={15} /> Abrir ficha
                                    </button>
                                )}
                                {onPedirServicio && (
                                    <button type="button" onClick={() => onPedirServicio(elegida)}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100">
                                        <Wrench size={15} /> Pedir servicio
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })()}
                {!cargando && !error && (
                    <div className="absolute left-3 bottom-3 rounded-xl bg-white/95 border border-zinc-200 shadow-sm px-3 py-1.5 text-xs text-zinc-600 pointer-events-none">
                        Pasá el mouse para ver el nombre · tocá una máquina para ver sus datos · arrastrá para girar · rueda o pellizco para el zoom · clic derecho o dos dedos para correr la vista
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
};

export default Plano3D;
