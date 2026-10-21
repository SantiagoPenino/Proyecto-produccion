import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
    X, Undo2, Redo2, Save, Loader2, MousePointer2, PenLine, Minus, DoorOpen, Square, Footprints, Maximize, ZoomIn, ZoomOut,
    RotateCw, Trash2, Calculator, Scissors, Copy, AlertTriangle, CheckCircle2, LandPlot, Zap, ArrowUpDown, SquareDashed, ChevronDown, Shapes, Box, ExternalLink, Wrench,
} from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { mensajeError } from './constantes';
import { label, input, btn, btnPri, btnSec, btnCancelar, MiniModal } from './ui';
import Selector from '../ui/Selector';
import {
    normalizarPlano, recalcular, cantParedes, tramoPared, tramoAbertura, largoPared, largoSoporte, partirPared, borrarPunto,
    medidasMaquina, caja, revisarMaquinas, lugarLibre, ocupadoM2, limitesPlano, areaM2, perimetro, distancia, nuevoId, fmtM, leerMetros,
    INSTALACIONES, esInstalacion, apoyarEnPared, zonaLibre, FRENTE, MEDIDAS_ELEMENTO, detectarHabitaciones, dentroDeHabitacion,
    COLORES_HABITACION, ALTURA_PLANTA, ALTO_ABERTURA, ANTEPECHO_VENTANA,
} from './planoLocal';
import Plano3D from './Plano3D';
import MaquinaFicha from './MaquinaFicha';

const NuevaSolicitudModal = lazy(() => import('./NuevaSolicitudModal'));
import { useNavigate } from 'react-router-dom';

// La ficha de una máquina en un panel encima del plano y del 3D (21/10): se cierra y se vuelve a donde se estaba, sin
// perder el plano sin guardar. z-[6020]: encima del editor (6000) y del 3D (6010), debajo de las ventanas de la ficha
// (MiniModal 6100) y del pedido de Servicio Técnico (6050).
const PanelFicha = ({ equipoId, meta, onCerrar, onCambiarMaquina, onIr }) => createPortal(
    <div className="fixed inset-0 z-[6020] flex justify-end bg-zinc-900/50" onMouseDown={onCerrar}>
        <div className="h-full w-full max-w-6xl bg-zinc-50 shadow-2xl overflow-y-auto p-4 sm:p-6" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex justify-end -mb-2">
                <button type="button" onClick={onCerrar} title="Cerrar" className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-200"><X size={20} /></button>
            </div>
            <MaquinaFicha equipoId={equipoId} meta={meta} volverTexto="Volver al plano" onVolver={onCerrar} onAbrirMaquina={onCambiarMaquina}
                onAbrirSolicitud={(id) => onIr(`sol=${id}`)} onAbrirTrabajo={(id) => onIr(`trab=${id}`)} />
        </div>
    </div>,
    document.body,
);
import { cargaTablero } from './consumoLocal';

// Servicio Técnico → Locales → plano de una planta (20/10/2026). Se dibuja el contorno a ojo (las medidas no
// importan), se escribe lo que mide cada pared y «Recalcular plano» lo deja a escala (planoLocal.js). Después se
// agregan puertas, paredes interiores, columnas y escaleras, y se ubican las máquinas de la planta con sus medidas
// de la ficha técnica. Todo en cm; en pantalla, `k` = píxeles por cm. Dibujo en SVG: nítido con cualquier zoom, y
// mouse y dedo pasan por los mismos eventos (pointer).

const CIAN = '#006E97';
const ROJO = '#e11d48';
const AMBAR = '#d97706';
const OSCURO = '#27272a';
const SIN_MEDIDAS = { w: 100, h: 100, servicio: 0, peso: null, sinMedidas: true };
const K_MIN = 0.01, K_MAX = 5;

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const aGrilla = (v, s) => Math.round(v / s) * s;
// Imán de la grilla según el zoom: de cerca 5 cm, de lejos 50.
const pasoIman = (k) => (k >= 1 ? 5 : k >= 0.3 ? 10 : k >= 0.12 ? 25 : 50);
const metrosCorto = (cm) => (cm / 100).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function distSeg(q, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? limitar(((q.x - a.x) * dx + (q.y - a.y) * dy) / L2, 0, 1) : 0;
    const x = a.x + t * dx, y = a.y + t * dy;
    return { d: Math.hypot(q.x - x, q.y - y), t, x, y };
}

// Normal hacia afuera de la pared i (para poner la medida del lado de afuera). Con el eje y para abajo, la suma del
// cordón positiva es sentido horario en pantalla.
function normalAfuera(p, i) {
    const [a, b] = tramoPared(p, i);
    const L = distancia(a, b) || 1;
    const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
    let s = 0;
    for (let j = 0; j < p.puntos.length; j++) { const u = p.puntos[j], v = p.puntos[(j + 1) % p.puntos.length]; s += u.x * v.y - v.x * u.y; }
    return s >= 0 ? { x: dy, y: -dx } : { x: -dy, y: dx };
}

// ── El dibujo (mundo en cm). `k` = px por cm, para que líneas, textos y puntos midan lo mismo en pantalla. ────────
const Texto = ({ x, y, k, tam = 12, color = OSCURO, peso = 600, italica = false, children }) => (
    <text x={x} y={y} fontSize={tam / k} fill={color} fontWeight={peso} fontStyle={italica ? 'italic' : 'normal'} textAnchor="middle"
        dominantBaseline="central" stroke="#fff" strokeWidth={3.5 / k} paintOrder="stroke" strokeLinejoin="round"
        style={{ userSelect: 'none', pointerEvents: 'none' }}>{children}</text>
);
const NS = 'non-scaling-stroke';

// Espesor con que se dibujan las paredes: el real aproximado (15 cm; las interiores 10), pero nunca menos de unos
// píxeles, para que se vean de lejos.
const espesor = (k, mini, cm, px) => Math.max(cm, (mini ? px * 0.4 : px) / k);

// Tramos de una pared que quedan entre sus puertas y ventanas (`aberturas`, las de esa pared): [desde, hasta] en cm
// desde el comienzo de la pared.
function tramosSinAberturas(aberturas, L) {
    const abs = aberturas.map(a => [Math.max(0, a.desde), Math.min(L, a.desde + a.ancho)]).sort((x, y) => x[0] - y[0]);
    const r = [];
    let t = 0;
    for (const [d, h] of abs) { if (d > t) r.push([t, d]); t = Math.max(t, h); }
    if (t < L) r.push([t, L]);
    return r;
}
// Rectángulo de un tramo de pared con espesor E. En las esquinas se estira medio espesor para que las paredes se
// junten; donde corta una puerta, no.
function poliTramo(a, u, t1, t2, e1, e2, E) {
    const nx = -u.y * E / 2, ny = u.x * E / 2;
    const x1 = a.x + u.x * (t1 - e1), y1 = a.y + u.y * (t1 - e1), x2 = a.x + u.x * (t2 + e2), y2 = a.y + u.y * (t2 + e2);
    return `${x1 + nx},${y1 + ny} ${x2 + nx},${y2 + ny} ${x2 - nx},${y2 - ny} ${x1 - nx},${y1 - ny}`;
}

// Puerta, portón o ventana, con los símbolos de un plano: la pared queda cortada y en el hueco va el símbolo.
// Puerta: la hoja (línea gruesa) abierta a 90° y el arco que barre. `lado`: 0/1 bisagra al comienzo, abre adentro
// o afuera; 2/3 bisagra al final.
const Abertura = ({ p, ab, E: eContorno, Ei, k, elegida, mini }) => {
    const s = tramoAbertura(p, ab);
    // En una pared interior no hay adentro y afuera: un lado y el otro (el botón de sentido los alterna).
    const nr = ab.interior != null ? { x: -s.uy, y: s.ux } : normalAfuera(p, ab.pared);
    const E = ab.interior != null ? Ei : eContorno;
    const col = elegida ? CIAN : OSCURO;
    const h = E / 2;
    const fino = mini ? 0.6 : elegida ? 1.8 : 1.1;
    const jamba = (x, y, key) => (
        <line key={key} x1={x + nr.x * h} y1={y + nr.y * h} x2={x - nr.x * h} y2={y - nr.y * h} stroke={col} strokeWidth={fino} vectorEffect={NS} />
    );
    if (ab.tipo === 'ventana') {
        // Marco del espesor de la pared y el vidrio al medio.
        const marco = poliTramo({ x: s.x1, y: s.y1 }, { x: s.ux, y: s.uy }, 0, ab.ancho, 0, 0, E);
        return (
            <g>
                <polygon points={marco} fill={elegida ? '#e0f2fe' : '#fff'} stroke={col} strokeWidth={fino} vectorEffect={NS} />
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={col} strokeWidth={fino} vectorEffect={NS} />
            </g>
        );
    }
    const adentro = { x: -nr.x, y: -nr.y };
    if (ab.tipo === 'porton') {
        // Portón / entrada: la cortina cerrada (línea gruesa en el hueco), punteado lo que ocupa hacia adentro y, afuera,
        // el cartel «ENTRADA» con una flecha para adentro.
        const prof = Math.min(Math.max(ab.ancho * 0.2, 40), 80);
        const q1 = { x: s.x1 + adentro.x * prof, y: s.y1 + adentro.y * prof };
        const q2 = { x: s.x2 + adentro.x * prof, y: s.y2 + adentro.y * prof };
        const M = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
        const f0 = h + 5 / k, f1 = f0 + 9 / k;
        // Más afuera que la medida de la pared, para no pisarla.
        const sepTxt = f1 + (Math.abs(nr.x) * 72 + Math.abs(nr.y) * 30) / k;
        return (
            <g>
                {jamba(s.x1, s.y1, 'a')}{jamba(s.x2, s.y2, 'b')}
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={col} strokeWidth={mini ? 1 : elegida ? 3.5 : 2.5} vectorEffect={NS} />
                {!mini && <>
                    <polyline points={`${s.x1},${s.y1} ${q1.x},${q1.y} ${q2.x},${q2.y} ${s.x2},${s.y2}`} fill={col} fillOpacity={0.04}
                        stroke={col} strokeWidth={1} strokeDasharray="6 4" vectorEffect={NS} />
                    <polygon fill={CIAN} points={`${M.x + nr.x * f0},${M.y + nr.y * f0} ${M.x + nr.x * f1 - nr.y * 5 / k},${M.y + nr.y * f1 + nr.x * 5 / k} ${M.x + nr.x * f1 + nr.y * 5 / k},${M.y + nr.y * f1 - nr.x * 5 / k}`} />
                    <Texto x={M.x + nr.x * sepTxt} y={M.y + nr.y * sepTxt} k={k} tam={10} color={CIAN} peso={800}>ENTRADA</Texto>
                </>}
            </g>
        );
    }
    const lado = ab.lado || 0;
    const [H, O] = lado >= 2 ? [{ x: s.x2, y: s.y2 }, { x: s.x1, y: s.y1 }] : [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
    const d = lado % 2 === 1 ? nr : adentro;
    const T = { x: H.x + d.x * ab.ancho, y: H.y + d.y * ab.ancho };
    // Sentido del arco: con el eje y para abajo, producto cruz positivo = horario = barrido 1 en SVG.
    const barrido = (T.x - H.x) * (O.y - H.y) - (T.y - H.y) * (O.x - H.x) > 0 ? 1 : 0;
    const arco = `A ${ab.ancho} ${ab.ancho} 0 0 ${barrido} ${O.x} ${O.y}`;
    return (
        <g>
            {jamba(s.x1, s.y1, 'a')}{jamba(s.x2, s.y2, 'b')}
            <path d={`M ${H.x} ${H.y} L ${T.x} ${T.y} ${arco} Z`} fill={col} fillOpacity={elegida ? 0.12 : 0.05} />
            <path d={`M ${T.x} ${T.y} ${arco}`} fill="none" stroke={col} strokeWidth={fino} vectorEffect={NS} />
            <line x1={H.x} y1={H.y} x2={T.x} y2={T.y} stroke={col} strokeWidth={mini ? 1 : elegida ? 3.5 : 2.5} strokeLinecap="round" vectorEffect={NS} />
        </g>
    );
};

// Instalaciones: cada una con su símbolo; adelante, punteado, lo que tiene que quedar libre (tablero, matafuegos y
// salida de emergencia). El nombre va adelante, pegado al frente.
const COLOR_LIBRE = { tablero: AMBAR, matafuegos: ROJO, salida: '#16a34a' };
const Instalacion = ({ e, elegido, k, mini }) => {
    const c = caja(e, e.w, e.h);
    const w = c.x2 - c.x1, h = c.y2 - c.y1;
    const cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2;
    const col = elegido ? CIAN : OSCURO;
    const borde = elegido ? 2.5 : 1.4;
    if (mini) {
        const relleno = { matafuegos: ROJO, salida: '#16a34a', tablero: OSCURO }[e.tipo] || '#fff';
        return <rect x={c.x1} y={c.y1} width={w} height={h} fill={relleno} stroke={OSCURO} strokeWidth={0.6} vectorEffect={NS} />;
    }
    const f = FRENTE[e.giro] || FRENTE[0];
    const z = zonaLibre(e);
    const texto = e.tipo === 'tablero' ? `${e.nombre || 'Tablero'}${e.termicaA ? ` · ${e.termicaA} A` : ''}`
        : e.nombre || { toma: 'Toma 3F', compresor: '', extractor: 'Extractor', matafuegos: 'Matafuegos', salida: 'Salida' }[e.tipo];
    const prof = e.giro % 180 === 0 ? h : w;
    const sepTxt = (prof / 2) + (11 + Math.abs(f.x) * (String(texto || '').length * 3.1)) / k;
    const colTxt = { matafuegos: ROJO, salida: '#15803d', tablero: '#92400e' }[e.tipo] || '#52525b';
    const r = Math.min(w, h) / 2;
    return (
        <g>
            {z && <rect x={z.x1} y={z.y1} width={z.x2 - z.x1} height={z.y2 - z.y1} fill={COLOR_LIBRE[e.tipo]} fillOpacity={0.07}
                stroke={COLOR_LIBRE[e.tipo]} strokeOpacity={0.6} strokeWidth={1} strokeDasharray="5 4" vectorEffect={NS} />}
            {e.tipo === 'tablero' && <>
                <rect x={c.x1} y={c.y1} width={w} height={h} fill="#fff" stroke={col} strokeWidth={borde} vectorEffect={NS} />
                <polygon points={`${c.x1},${c.y2} ${c.x2},${c.y1} ${c.x2},${c.y2}`} fill={col} />
            </>}
            {e.tipo === 'toma' && <>
                <circle cx={cx} cy={cy} r={Math.max(w, h) / 2} fill="#fff" stroke={col} strokeWidth={borde} vectorEffect={NS} />
                <line x1={cx - f.y * r} y1={cy + f.x * r} x2={cx + f.y * r} y2={cy - f.x * r} stroke={col} strokeWidth={1} vectorEffect={NS} />
            </>}
            {e.tipo === 'compresor' && <>
                <rect x={c.x1} y={c.y1} width={w} height={h} fill="#fff" stroke={col} strokeWidth={borde} vectorEffect={NS} />
                <circle cx={cx} cy={cy} r={r * 0.7} fill="none" stroke={col} strokeWidth={1.2} vectorEffect={NS} />
                <Texto x={cx} y={cy} k={k} tam={9} color={col} peso={800}>C</Texto>
            </>}
            {e.tipo === 'extractor' && <>
                <rect x={c.x1} y={c.y1} width={w} height={h} fill="#fff" fillOpacity={0.6} stroke={col} strokeWidth={borde} strokeDasharray="5 3" vectorEffect={NS} />
                <circle cx={cx} cy={cy} r={r * 0.8} fill="none" stroke={col} strokeWidth={1.2} vectorEffect={NS} />
                <line x1={cx - r * 0.57} y1={cy - r * 0.57} x2={cx + r * 0.57} y2={cy + r * 0.57} stroke={col} strokeWidth={1.2} vectorEffect={NS} />
                <line x1={cx - r * 0.57} y1={cy + r * 0.57} x2={cx + r * 0.57} y2={cy - r * 0.57} stroke={col} strokeWidth={1.2} vectorEffect={NS} />
            </>}
            {(e.tipo === 'matafuegos' || e.tipo === 'salida') && (
                <rect x={c.x1} y={c.y1} width={w} height={h} rx={Math.min(w, h) * 0.2} fill={e.tipo === 'matafuegos' ? ROJO : '#16a34a'}
                    stroke={elegido ? CIAN : 'none'} strokeWidth={borde} vectorEffect={NS} />
            )}
            {texto && (e.tipo === 'compresor'
                ? null
                : <Texto x={cx + f.x * sepTxt} y={cy + f.y * sepTxt} k={k} tam={9.5} color={colTxt} peso={700}>{texto}</Texto>)}
            {e.tipo === 'compresor' && <Texto x={cx} y={c.y2 + 9 / k} k={k} tam={9.5} color={colTxt} peso={700}>{e.nombre || 'Compresor'}</Texto>}
        </g>
    );
};

// Columna (maciza, como en los planos), escalera (escalones de 28 cm y la flecha de «sube» o «baja»), ascensor (la
// cruz), ambiente (zona con nombre y m²) u otro (punteado).
const Elemento = ({ e, elegido, k, mini }) => {
    if (esInstalacion(e.tipo)) return <Instalacion e={e} elegido={elegido} k={k} mini={mini} />;
    const c = caja(e, e.w, e.h);
    const w = c.x2 - c.x1, h = c.y2 - c.y1;
    const col = elegido ? CIAN : OSCURO;
    const cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2;
    if (e.tipo === 'ambiente') {
        const m2 = (e.w * e.h / 10000).toLocaleString('es-UY', { maximumFractionDigits: 1 });
        return (
            <g>
                <rect x={c.x1} y={c.y1} width={w} height={h} fill={elegido ? CIAN : '#0ea5e9'} fillOpacity={elegido ? 0.1 : 0.05}
                    stroke={elegido ? CIAN : '#64748b'} strokeWidth={elegido ? 2 : 1} strokeDasharray="8 5" vectorEffect={NS} />
                {!mini && <>
                    <Texto x={cx} y={cy - 7 / k} k={k} tam={11} color="#334155" peso={800}>{(e.nombre || 'Ambiente').toUpperCase()}</Texto>
                    <Texto x={cx} y={cy + 8 / k} k={k} tam={9.5} color="#64748b" peso={600}>{m2} m²</Texto>
                </>}
            </g>
        );
    }
    if (e.tipo === 'ascensor') {
        return (
            <g>
                <rect x={c.x1} y={c.y1} width={w} height={h} fill="#fff" stroke={col} strokeWidth={elegido ? 2.2 : 1.4} vectorEffect={NS} />
                <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={col} strokeWidth={mini ? 0.5 : 1} vectorEffect={NS} />
                <line x1={c.x1} y1={c.y2} x2={c.x2} y2={c.y1} stroke={col} strokeWidth={mini ? 0.5 : 1} vectorEffect={NS} />
                {!mini && <Texto x={cx} y={c.y2 + 9 / k} k={k} tam={9.5} color="#52525b">{e.nombre || 'Ascensor'}</Texto>}
            </g>
        );
    }
    if (e.tipo === 'columna') {
        return (
            <g>
                <rect x={c.x1} y={c.y1} width={w} height={h} fill={elegido ? CIAN : '#3f3f46'} stroke={col} strokeWidth={elegido ? 2 : 1} vectorEffect={NS} />
                {!mini && e.nombre && <Texto x={cx} y={c.y2 + 9 / k} k={k} tam={9.5} color="#52525b">{e.nombre}</Texto>}
            </g>
        );
    }
    if (e.tipo === 'escalera') {
        const largoX = w >= h;
        const L = largoX ? w : h;
        const escalones = [];
        for (let d = 28; d < L - 1; d += 28) escalones.push(d);
        const sube = e.giro >= 180 ? -1 : 1;
        const m = Math.min(14, L / 4);
        const ini = largoX ? { x: sube > 0 ? c.x1 + m : c.x2 - m, y: cy } : { x: cx, y: sube > 0 ? c.y1 + m : c.y2 - m };
        const fin = largoX ? { x: sube > 0 ? c.x2 - m : c.x1 + m, y: cy } : { x: cx, y: sube > 0 ? c.y2 - m : c.y1 + m };
        const v = { x: Math.sign(fin.x - ini.x), y: Math.sign(fin.y - ini.y) };
        const a = Math.min(22, (largoX ? h : w) * 0.3);
        const punta = `${fin.x},${fin.y} ${fin.x - v.x * a - v.y * a * 0.5},${fin.y - v.y * a + v.x * a * 0.5} ${fin.x - v.x * a + v.y * a * 0.5},${fin.y - v.y * a - v.x * a * 0.5}`;
        return (
            <g>
                <rect x={c.x1} y={c.y1} width={w} height={h} fill="#fff" stroke={col} strokeWidth={elegido ? 2.2 : 1.3} vectorEffect={NS} />
                {escalones.map(d => (largoX
                    ? <line key={d} x1={c.x1 + d} y1={c.y1} x2={c.x1 + d} y2={c.y2} stroke="#71717a" strokeWidth={mini ? 0.5 : 1} vectorEffect={NS} />
                    : <line key={d} x1={c.x1} y1={c.y1 + d} x2={c.x2} y2={c.y1 + d} stroke="#71717a" strokeWidth={mini ? 0.5 : 1} vectorEffect={NS} />))}
                {!mini && <>
                    <circle cx={ini.x} cy={ini.y} r={3 / k} fill={col} />
                    <line x1={ini.x} y1={ini.y} x2={fin.x - v.x * a * 0.6} y2={fin.y - v.y * a * 0.6} stroke={col} strokeWidth={1.3} vectorEffect={NS} />
                    <polygon points={punta} fill={col} />
                    {/* El texto va donde apunta la flecha, pegado a la punta. */}
                    {(() => {
                        const txt = e.nombre || (e.baja ? 'Baja' : 'Sube');
                        const sep = m + (largoX ? 6 + txt.length * 3.2 : 9) / k;
                        return <Texto x={fin.x + v.x * sep} y={fin.y + v.y * sep} k={k} tam={9.5} color={col} peso={700}>{txt}</Texto>;
                    })()}
                </>}
            </g>
        );
    }
    return (
        <g>
            <rect x={c.x1} y={c.y1} width={w} height={h} fill={col} fillOpacity={0.04} stroke={col} strokeWidth={elegido ? 2 : 1.2} strokeDasharray="6 4" vectorEffect={NS} />
            {!mini && <Texto x={cx} y={cy} k={k} tam={10} color="#52525b">{e.nombre || 'Otro'}</Texto>}
        </g>
    );
};

const caminoPoligono = (pol) => `M ${pol.map(v => `${v.x} ${v.y}`).join(' L ')} Z`;

const DibujoPlano = ({ plano: p, medidas = {}, nombres = {}, avisos = {}, sel = null, k, mini = false, editable = false, calculadas = [], habitaciones = [] }) => {
    const n = cantParedes(p);
    const esSel = (t, id) => sel && sel.t === t && (sel.id ?? sel.i) === id;
    const E = espesor(k, mini, 15, 4);
    const Ei = espesor(k, mini, 10, 2.5);
    return (
        <g>
            {/* Habitaciones (las arman las paredes interiores): color, nombre y m² */}
            {!mini && habitaciones.map((hb, i) => {
                const elegida = sel?.t === 'habitacion' && sel.i === i;
                return (
                    <g key={`hab${i}`}>
                        <path d={[hb.poligono, ...hb.huecos].map(caminoPoligono).join(' ')} fillRule="evenodd" fill={COLORES_HABITACION[i % COLORES_HABITACION.length]}
                            fillOpacity={elegida ? 0.9 : 0.55} stroke={elegida ? CIAN : 'none'} strokeWidth={2} strokeDasharray="7 5" vectorEffect={NS} />
                        {hb.nombre && <Texto x={hb.etiqueta.x} y={hb.etiqueta.y - 8 / k} k={k} tam={11} color="#334155" peso={800}>{hb.nombre.toUpperCase()}</Texto>}
                        <Texto x={hb.etiqueta.x} y={hb.etiqueta.y + (hb.nombre ? 7 : 0) / k} k={k} tam={hb.nombre ? 9.5 : 10.5} color="#64748b" peso={600}>
                            {`${hb.areaM2.toLocaleString('es-UY', { maximumFractionDigits: 1 })} m²`}
                        </Texto>
                    </g>
                );
            })}
            {/* Ambientes (oficina), abajo de todo */}
            {p.elementos.filter(e => e.tipo === 'ambiente').map(e => <Elemento key={e.id} e={e} elegido={esSel('elemento', e.id)} k={k} mini={mini} />)}
            {/* Escaleras, ascensores y otros, debajo de las paredes */}
            {p.elementos.filter(e => e.tipo !== 'columna' && e.tipo !== 'ambiente' && !esInstalacion(e.tipo)).map(e => <Elemento key={e.id} e={e} elegido={esSel('elemento', e.id)} k={k} mini={mini} />)}
            {/* Paredes interiores, cortadas donde tienen una puerta */}
            {p.interiores.map(w => {
                const a = { x: w.x1, y: w.y1 }, L = distancia(a, { x: w.x2, y: w.y2 });
                if (L < 0.01) return null;
                const u = { x: (w.x2 - w.x1) / L, y: (w.y2 - w.y1) / L };
                const col = esSel('interior', w.id) ? CIAN : '#3f3f46';
                return tramosSinAberturas(p.aberturas.filter(ab => ab.interior === w.id), L).map(([t1, t2], j) => (
                    <polygon key={`${w.id}-${j}`} points={poliTramo(a, u, t1, t2, t1 <= 0.01 ? Ei / 2 : 0, t2 >= L - 0.01 ? Ei / 2 : 0, Ei)} fill={col} />
                ));
            })}
            {/* Paredes, cortadas donde hay una puerta o una ventana */}
            {Array.from({ length: n }, (_, i) => {
                const [a, b] = tramoPared(p, i);
                const L = distancia(a, b);
                if (L < 0.01) return null;
                const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
                const col = esSel('pared', i) ? CIAN : OSCURO;
                return tramosSinAberturas(p.aberturas.filter(ab => ab.interior == null && ab.pared === i), L).map(([t1, t2], j) => (
                    <polygon key={`w${i}-${j}`} points={poliTramo(a, u, t1, t2, t1 <= 0.01 ? E / 2 : 0, t2 >= L - 0.01 ? E / 2 : 0, E)} fill={col} />
                ));
            })}
            {p.hueco && p.puntos[0] && (
                <line x1={p.hueco.x} y1={p.hueco.y} x2={p.puntos[0].x} y2={p.puntos[0].y} stroke={ROJO} strokeWidth={mini ? 1.5 : 2.5}
                    strokeDasharray={mini ? '3 3' : '8 6'} vectorEffect={NS} />
            )}
            {/* Puertas, portones y ventanas */}
            {p.aberturas.map(ab => <Abertura key={ab.id} p={p} ab={ab} E={E} Ei={Ei} k={k} elegida={esSel('abertura', ab.id)} mini={mini} />)}
            {/* Columnas e instalaciones, encima de las paredes */}
            {p.elementos.filter(e => e.tipo === 'columna' || esInstalacion(e.tipo)).map(e => <Elemento key={e.id} e={e} elegido={esSel('elemento', e.id)} k={k} mini={mini} />)}
            {/* Máquinas */}
            {p.maquinas.map(m => {
                const md = medidas[m.equipoId] || SIN_MEDIDAS;
                const c = caja(m, md.w, md.h);
                const cs = md.servicio ? caja(m, md.w, md.h, md.servicio) : null;
                const mal = !!avisos[m.equipoId];
                const elegida = esSel('maquina', m.equipoId);
                const col = mal ? ROJO : CIAN;
                // El frente (el lado del largo) va abajo sin girar; gira en sentido horario.
                const frente = { 0: [c.x1, c.y2, c.x2, c.y2], 90: [c.x1, c.y1, c.x1, c.y2], 180: [c.x1, c.y1, c.x2, c.y1], 270: [c.x2, c.y1, c.x2, c.y2] }[m.giro];
                return (
                    <g key={m.equipoId}>
                        {cs && !mini && <rect x={cs.x1} y={cs.y1} width={cs.x2 - cs.x1} height={cs.y2 - cs.y1} fill="none" stroke={col}
                            strokeOpacity={0.45} strokeWidth={1} strokeDasharray="4 4" vectorEffect={NS} />}
                        <rect x={c.x1} y={c.y1} width={c.x2 - c.x1} height={c.y2 - c.y1} fill={col} fillOpacity={elegida ? 0.22 : 0.1}
                            stroke={col} strokeWidth={mini ? 1 : elegida ? 3 : 1.5} strokeDasharray={md.sinMedidas ? '6 4' : undefined} vectorEffect={NS} />
                        {frente && !mini && <line x1={frente[0]} y1={frente[1]} x2={frente[2]} y2={frente[3]} stroke={col} strokeWidth={4} vectorEffect={NS} />}
                        {!mini && (
                            <Texto x={m.x} y={m.y} k={k} tam={11} color={mal ? ROJO : '#0c4a6e'} peso={700}>
                                {nombres[m.equipoId] || `#${m.equipoId}`}{mal ? ' ⚠' : ''}
                            </Texto>
                        )}
                    </g>
                );
            })}
            {/* Medidas de las paredes */}
            {!mini && Array.from({ length: n }, (_, i) => {
                const [a, b] = tramoPared(p, i);
                const nr = normalAfuera(p, i);
                const L = distancia(a, b);
                const med = p.paredes[i]?.largo;
                const difiere = med != null && Math.abs(med - L) > 1;
                const calc = calculadas.includes(i);
                const txt = `${i + 1} · ${med != null ? metrosCorto(med) : `${calc ? '' : '≈ '}${metrosCorto(L)}`}${difiere ? ` (dibujo ${metrosCorto(L)})` : ''}`;
                // Afuera de la pared: en las verticales, corrido medio texto para que no la pise.
                const sep = 10 + E * k / 2 + Math.abs(nr.x) * txt.length * 3.3 + Math.abs(nr.y) * 4;
                return (
                    <Texto key={`m${i}`} x={(a.x + b.x) / 2 + nr.x * sep / k} y={(a.y + b.y) / 2 + nr.y * sep / k} k={k} tam={11.5}
                        color={difiere ? AMBAR : med != null ? OSCURO : calc ? CIAN : '#a1a1aa'} peso={med != null ? 700 : 600} italica={med == null && !calc}>
                        {txt}
                    </Texto>
                );
            })}
            {!mini && p.hueco && p.puntos[0] && (
                <Texto x={(p.hueco.x + p.puntos[0].x) / 2} y={(p.hueco.y + p.puntos[0].y) / 2 - 16 / k} k={k} tam={11} color={ROJO} peso={700}>
                    {`no cierra: ${metrosCorto(distancia(p.hueco, p.puntos[0]))} m`}
                </Texto>
            )}
            {/* Puntos (para moverlos) */}
            {editable && p.puntos.map((q, i) => (
                <circle key={`p${i}`} cx={q.x} cy={q.y} r={(esSel('punto', i) ? 7 : 5) / k} fill={esSel('punto', i) ? CIAN : '#fff'}
                    stroke={i === 0 && !p.cerrado ? CIAN : OSCURO} strokeWidth={i === 0 && !p.cerrado ? 2.5 : 1.5} vectorEffect={NS} />
            ))}
        </g>
    );
};

// Vista chica del plano (en la tarjeta de cada planta).
export const MiniPlano = ({ plano, medidas, ancho = 132, alto = 84 }) => {
    const p = useMemo(() => normalizarPlano(plano), [plano]);
    const b = limitesPlano([p]);
    if (!b) return null;
    const m = Math.max(b.x2 - b.x1, b.y2 - b.y1, 100) * 0.06;
    const vb = [b.x1 - m, b.y1 - m, b.x2 - b.x1 + 2 * m, b.y2 - b.y1 + 2 * m];
    const k = Math.min(ancho / vb[2], alto / vb[3]);
    return (
        <svg viewBox={vb.join(' ')} width={ancho} height={alto} className="shrink-0 rounded-lg bg-zinc-50 border border-zinc-200" aria-hidden="true">
            <DibujoPlano plano={p} medidas={medidas} k={k} mini />
        </svg>
    );
};

// Campo de metros: muestra "12,35"; acepta "12,35", "12.35", "12,35 m" o "1235 cm". Se confirma con Enter o al salir.
const InputMetros = ({ valor, onCambiar, onEnter, disabled, placeholder = '—', id, refInput, className = '' }) => {
    const aTexto = (cm) => (cm == null ? '' : String(Math.round(cm) / 100).replace('.', ','));
    const [txt, setTxt] = useState(aTexto(valor));
    const [mal, setMal] = useState(false);
    useEffect(() => { setTxt(aTexto(valor)); setMal(false); }, [valor]);
    const confirmar = () => {
        const v = leerMetros(txt);
        if (Number.isNaN(v)) { setMal(true); return false; }
        setMal(false);
        const r = v == null ? null : Math.round(v * 10) / 10;
        if (r !== (valor ?? null)) onCambiar(r);
        return true;
    };
    return (
        <div className="relative">
            <input id={id} ref={refInput} value={txt} disabled={disabled} placeholder={placeholder} inputMode="decimal"
                onChange={(e) => setTxt(e.target.value)} onBlur={confirmar}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); if (confirmar()) onEnter?.(); }
                    else if (e.key === 'Escape') { setTxt(aTexto(valor)); setMal(false); e.currentTarget.blur(); }
                }}
                className={`w-full pl-2.5 pr-7 py-1.5 border rounded-lg text-sm text-zinc-800 bg-white outline-none focus:ring-2 disabled:bg-zinc-50 ${mal ? 'border-rose-400 focus:ring-rose-100' : 'border-zinc-200 focus:border-brand-cyan focus:ring-brand-cyan/10'} ${className}`} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400 pointer-events-none">m</span>
        </div>
    );
};

const HERRAMIENTAS = [
    { id: 'mover', label: 'Elegir y mover', corto: 'Mover', Icono: MousePointer2 },
    { id: 'contorno', label: 'Contorno', corto: 'Contorno', Icono: PenLine },
    { id: 'interior', label: 'Pared interior', corto: 'Interior', Icono: Minus },
];
// Herramienta Elemento: columna, escalera, ascensor u oficina (zona con nombre y m²: 'amb:Oficina').
const OPCIONES_ELEMENTO = [
    { id: 'columna', label: 'Columna', Icono: Square },
    { id: 'escalera', label: 'Escalera', Icono: Footprints },
    { id: 'ascensor', label: 'Ascensor', Icono: ArrowUpDown },
    { id: 'amb:Oficina', label: 'Oficina', Icono: SquareDashed },
];

// Botón de herramienta con menú (nombre fijo: Aberturas, Elementos, Instalaciones): tocarlo activa la herramienta con lo
// último elegido y abre la lista para cambiarlo. Lo elegido se ve marcado en la lista y en la ayuda del plano.
// La lista va en un portal (la barra tiene scroll y la cortaría).
const MenuHerramienta = ({ activo, Icono, etiqueta, opciones, valor, onActivar, onElegir }) => {
    const [pos, setPos] = useState(null);
    const botonRef = useRef(null);
    const listaRef = useRef(null);
    useEffect(() => {
        if (!pos) return undefined;
        const afuera = (e) => { if (!botonRef.current?.contains(e.target) && !listaRef.current?.contains(e.target)) setPos(null); };
        // En captura y sin seguir: Esc cierra la lista sin soltar la herramienta.
        const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setPos(null); } };
        const cerrar = () => setPos(null);
        document.addEventListener('pointerdown', afuera, true);
        document.addEventListener('keydown', tecla, true);
        window.addEventListener('resize', cerrar);
        return () => {
            document.removeEventListener('pointerdown', afuera, true);
            document.removeEventListener('keydown', tecla, true);
            window.removeEventListener('resize', cerrar);
        };
    }, [pos]);
    const alTocar = () => {
        onActivar();
        if (pos) { setPos(null); return; }
        const r = botonRef.current.getBoundingClientRect();
        setPos({ left: Math.min(r.left, window.innerWidth - 230), top: r.bottom + 4 });
    };
    return <>
        <button ref={botonRef} type="button" onClick={alTocar} aria-haspopup="menu" aria-expanded={!!pos}
            className={`${btn} shrink-0 border ${activo ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}>
            <Icono size={15} />{etiqueta}<ChevronDown size={14} className={`opacity-60 transition-transform ${pos ? 'rotate-180' : ''}`} />
        </button>
        {pos && createPortal(
            <div ref={listaRef} role="menu" style={{ position: 'fixed', left: pos.left, top: pos.top }}
                className="z-[6200] min-w-[210px] max-h-[70vh] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 py-1">
                {opciones.map((o, i) => (o.titulo
                    ? <div key={`t${i}`} className="px-3 pt-2.5 pb-1 text-[11px] font-black text-zinc-400 uppercase tracking-wide border-t border-zinc-100 mt-1">{o.titulo}</div>
                    : (
                        <button key={o.id} type="button" role="menuitem" onClick={() => { onElegir(o.id); setPos(null); }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-zinc-50 ${valor === o.id ? 'text-brand-cyan font-bold bg-brand-cyan/5' : 'text-zinc-700'}`}>
                            {o.Icono && <o.Icono size={15} className="shrink-0 text-brand-cyan" />}{o.label}
                        </button>
                    )))}
            </div>,
            document.body,
        )}
    </>;
};
const TIPOS_ABERTURA = [['puerta', 'Puerta', 90], ['porton', 'Portón / entrada', 300], ['ventana', 'Ventana', 120]];
const TIPOS_ELEMENTO = [['columna', 'Columna'], ['escalera', 'Escalera'], ['ascensor', 'Ascensor'], ['ambiente', 'Oficina'], ['otro', 'Otro']];

const PlanoEditor = ({ local, planta, plantasLocal, equipos, todosEquipos, puedeEditar, meta, onCerrar, onGuardado }) => {
    const [plano, setPlano] = useState(() => normalizarPlano(planta.Plano));
    const planoRef = useRef(plano);
    planoRef.current = plano;
    const [version, setVersion] = useState(planta.Plano?.guardado || null);
    const [sucio, setSucio] = useState(false);
    const hist = useRef({ pasado: [], futuro: [] });
    const [, setNHist] = useState(0); // para que los botones de deshacer/rehacer se enteren
    const [herr, setHerr] = useState(() => (puedeEditar && !normalizarPlano(planta.Plano).puntos.length ? 'contorno' : 'mover'));
    const [recto, setRecto] = useState(true);
    const [sel, setSel] = useState(null);
    const [pendiente, setPendiente] = useState(null); // primer punto de una pared interior
    const [cursor, setCursor] = useState(null);       // dónde caería el próximo punto (con el imán)
    const [vista, setVista] = useState({ x: 40, y: 40, k: 0.4 });
    const vistaRef = useRef(vista);
    vistaRef.current = vista;
    const [resultado, setResultado] = useState(null);
    const [pestana, setPestana] = useState('paredes');
    const [tipoInst, setTipoInst] = useState('tablero'); // qué pone la herramienta Instalación
    const [tipoAbertura, setTipoAbertura] = useState('puerta'); // y la herramienta Puerta
    const [tipoElemento, setTipoElemento] = useState('columna'); // y la herramienta Elemento
    // Grupos abiertos de los paneles (arrancan cerrados).
    const [abiertos, setAbiertos] = useState(() => new Set());
    const alternar = useCallback((clave) => setAbiertos(a => { const n = new Set(a); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; }), []);
    const panelRef = useRef(null);
    const [guardando, setGuardando] = useState(false);
    const [confirmar, setConfirmar] = useState(null); // { titulo, texto, boton, accion }
    const [ver3D, setVer3D] = useState(null); // plantas del local para la vista 3D (con el plano de esta como está ahora)
    const [fichaId, setFichaId] = useState(null); // máquina cuya ficha se ve en el panel
    const [pedirPara, setPedirPara] = useState(null); // máquina para la que se pide Servicio Técnico
    const navigate = useNavigate();

    const otras = plantasLocal.filter(x => x.PlantaId !== planta.PlantaId);
    const conPlano = otras.filter(x => x.Plano?.puntos?.length);
    const [refId, setRefId] = useState(() => {
        const abajo = conPlano.filter(x => x.Orden < planta.Orden).sort((a, b) => b.Orden - a.Orden)[0];
        return abajo ? String(abajo.PlantaId) : '';
    });
    const refPlano = useMemo(() => {
        const r = otras.find(x => String(x.PlantaId) === refId);
        return r?.Plano ? normalizarPlano(r.Plano) : null;
    }, [refId]); // eslint-disable-line react-hooks/exhaustive-deps

    const medidas = useMemo(() => Object.fromEntries(todosEquipos.map(e => [e.EquipoID, medidasMaquina(e.ficha)])), [todosEquipos]);
    const nombres = useMemo(() => Object.fromEntries(todosEquipos.map(e => [e.EquipoID, e.Nombre])), [todosEquipos]);
    const idsPlanta = useMemo(() => new Set(equipos.map(e => e.EquipoID)), [equipos]);
    const equiposLocal = useMemo(() => todosEquipos.filter(e => e.LocalId === planta.LocalId), [todosEquipos, planta.LocalId]);
    const tableroDe = useMemo(() => {
        const m = {};
        plano.elementos.filter(e => e.tipo === 'tablero').forEach(t => (t.equipos || []).forEach(id => { m[id] = t.nombre || 'Tablero'; }));
        return m;
    }, [plano.elementos]);
    // Las máquinas que ya no son de esta planta (se movieron) no se dibujan ni se guardan.
    const visible = useMemo(() => ({ ...plano, maquinas: plano.maquinas.filter(m => idsPlanta.has(m.equipoId)) }), [plano, idsPlanta]);
    const avisos = useMemo(() => revisarMaquinas(visible, medidas, { cargaMaxKgM2: planta.CargaMaxKgM2, nombres }), [visible, medidas, nombres, planta.CargaMaxKgM2]);
    const habitaciones = useMemo(() => detectarHabitaciones(plano), [plano]);
    // Al elegir algo (en el plano o en la lista), se abre su grupo y se ve su tarjeta.
    const grupoSel = !sel ? null : sel.t === 'habitacion' ? 'habitaciones' : sel.t === 'interior' ? 'interior'
        : sel.t === 'abertura' ? plano.aberturas.find(a => a.id === sel.id)?.tipo
        : sel.t === 'elemento' ? plano.elementos.find(e => e.id === sel.id)?.tipo : null;
    useEffect(() => {
        if (grupoSel) setAbiertos(a => (a.has(grupoSel) ? a : new Set(a).add(grupoSel)));
        const id = requestAnimationFrame(() => panelRef.current?.querySelector('[data-elegido="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
        return () => cancelAnimationFrame(id);
    }, [sel, grupoSel]);
    const habitacionesRef = useRef(habitaciones);
    habitacionesRef.current = habitaciones;

    // ── Cambios con deshacer ────────────────────────────────────────────────────────────────────────────────
    const fijar = (sig) => { planoRef.current = sig; setPlano(sig); };
    const cambiar = useCallback((nuevo) => {
        const prev = planoRef.current;
        const sig = typeof nuevo === 'function' ? nuevo(prev) : nuevo;
        if (!sig || sig === prev) return;
        hist.current.pasado.push(prev);
        if (hist.current.pasado.length > 150) hist.current.pasado.shift();
        hist.current.futuro = [];
        fijar(sig);
        setSucio(true);
        setResultado(null);
        setNHist(x => x + 1);
    }, []);
    const deshacer = useCallback(() => {
        const h = hist.current;
        if (!h.pasado.length) return;
        h.futuro.push(planoRef.current);
        fijar(h.pasado.pop());
        setSucio(true); setResultado(null); setSel(null); setNHist(x => x + 1);
    }, []);
    const rehacer = useCallback(() => {
        const h = hist.current;
        if (!h.futuro.length) return;
        h.pasado.push(planoRef.current);
        fijar(h.futuro.pop());
        setSucio(true); setResultado(null); setSel(null); setNHist(x => x + 1);
    }, []);

    // ── Tamaño del lienzo y vista ───────────────────────────────────────────────────────────────────────────
    const contRef = useRef(null);
    const svgRef = useRef(null);
    const [tam, setTam] = useState(null);
    useLayoutEffect(() => {
        const el = contRef.current;
        if (!el) return undefined;
        const medir = () => { const r = el.getBoundingClientRect(); setTam({ w: Math.max(200, r.width), h: Math.max(200, r.height) }); };
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const tamRef = useRef(tam);
    tamRef.current = tam;

    const encuadrar = useCallback(() => {
        const t = tamRef.current;
        if (!t) return;
        const b = limitesPlano([planoRef.current, refPlano]) || { x1: 0, y1: 0, x2: 2000, y2: 1500 };
        const bw = Math.max(200, b.x2 - b.x1), bh = Math.max(200, b.y2 - b.y1);
        const k = limitar(Math.min((t.w - 180) / bw, (t.h - 140) / bh), K_MIN, K_MAX); // margen para las medidas
        setVista({ k, x: (t.w - bw * k) / 2 - b.x1 * k, y: (t.h - bh * k) / 2 - b.y1 * k });
    }, [refPlano]);
    const encuadrado = useRef(false);
    useLayoutEffect(() => { if (tam && !encuadrado.current) { encuadrado.current = true; encuadrar(); } }, [tam, encuadrar]);

    const zoomEn = useCallback((sx, sy, factor) => {
        setVista(v => {
            const k = limitar(v.k * factor, K_MIN, K_MAX);
            return { k, x: sx - (sx - v.x) * k / v.k, y: sy - (sy - v.y) * k / v.k };
        });
    }, []);
    const zoomCentro = (f) => tam && zoomEn(tam.w / 2, tam.h / 2, f);

    // Rueda del mouse: zoom donde está el puntero (necesita preventDefault: listener no pasivo). El SVG aparece
    // recién cuando se midió el lugar: por eso depende de `hayLienzo`.
    const hayLienzo = !!tam;
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return undefined;
        const rueda = (e) => {
            e.preventDefault();
            const r = el.getBoundingClientRect();
            zoomEn(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
        };
        el.addEventListener('wheel', rueda, { passive: false });
        return () => el.removeEventListener('wheel', rueda);
    }, [zoomEn, hayLienzo]);

    const aMundo = (sx, sy) => { const v = vistaRef.current; return { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k }; };

    // ── Imanes ──────────────────────────────────────────────────────────────────────────────────────────────
    const puntosIman = () => {
        const p = planoRef.current;
        const pts = [...p.puntos];
        p.interiores.forEach(w => { pts.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); });
        if (refPlano) pts.push(...refPlano.puntos);
        return pts;
    };
    const iman = (w, tol, excluir = -1) => {
        let mejor = null, dm = tol;
        puntosIman().forEach((q, i) => { if (i === excluir) return; const d = distancia(w, q); if (d <= dm) { dm = d; mejor = q; } });
        return mejor ? { x: mejor.x, y: mejor.y } : null;
    };
    // Próximo punto del contorno: cerrar, pegarse a un punto, recto desde el anterior y alineado con el primero.
    const puntoContorno = (w) => {
        const p = planoRef.current;
        const k = vistaRef.current.k;
        const tol = 10 / k;
        if (p.puntos.length >= 3 && !p.cerrado && distancia(w, p.puntos[0]) <= 14 / k) return { cerrar: true, q: p.puntos[0] };
        const im = iman(w, tol);
        if (im) return { q: im };
        const s = pasoIman(k);
        const q = { x: aGrilla(w.x, s), y: aGrilla(w.y, s) };
        const ult = p.puntos[p.puntos.length - 1];
        const pri = p.puntos[0];
        if (ult && recto) {
            if (Math.abs(w.x - ult.x) >= Math.abs(w.y - ult.y)) {
                q.y = ult.y;
                if (pri && p.puntos.length >= 2 && Math.abs(w.x - pri.x) <= tol) q.x = pri.x;
            } else {
                q.x = ult.x;
                if (pri && p.puntos.length >= 2 && Math.abs(w.y - pri.y) <= tol) q.y = pri.y;
            }
        }
        return { q };
    };
    const puntoInterior = (w) => {
        const k = vistaRef.current.k;
        const im = iman(w, 10 / k);
        if (im) return im;
        const s = pasoIman(k);
        let q = { x: aGrilla(w.x, s), y: aGrilla(w.y, s) };
        let horizontal = null;
        if (pendiente && recto) {
            horizontal = Math.abs(w.x - pendiente.x) >= Math.abs(w.y - pendiente.y);
            if (horizontal) q.y = pendiente.y; else q.x = pendiente.x;
        }
        // Cerca de una pared (del contorno u otra interior), la punta se pega a ella: así se juntan justo y forman
        // habitaciones. Con ángulos rectos, donde la línea recta corta esa pared.
        const p = planoRef.current;
        const paredes = Array.from({ length: cantParedes(p) }, (_, i) => tramoPared(p, i))
            .concat(p.interiores.map(iw => [{ x: iw.x1, y: iw.y1 }, { x: iw.x2, y: iw.y2 }]));
        let mejor = null;
        for (const [a, b] of paredes) {
            const d = distSeg(q, a, b);
            if (d.d > 12 / k || (mejor && d.d >= mejor.d)) continue;
            let pt = { x: d.x, y: d.y };
            if (horizontal !== null) {
                // Corte de la recta (horizontal o vertical desde el primer punto) con la pared.
                const dx = b.x - a.x, dy = b.y - a.y;
                const t = horizontal ? (dy ? (pendiente.y - a.y) / dy : NaN) : (dx ? (pendiente.x - a.x) / dx : NaN);
                if (!(t >= 0 && t <= 1)) continue;
                pt = horizontal ? { x: a.x + t * dx, y: pendiente.y } : { x: pendiente.x, y: a.y + t * dy };
                if (distancia(pt, q) > 20 / k) continue;
            }
            mejor = { d: d.d, ...pt };
        }
        if (mejor) q = { x: Math.round(mejor.x * 10) / 10, y: Math.round(mejor.y * 10) / 10 };
        return q;
    };

    // ── Qué hay bajo el puntero (herramienta Mover) ────────────────────────────────────────────────────────
    const golpe = (w) => {
        const p = planoRef.current;
        const t = (px) => px / vistaRef.current.k;
        if (puedeEditar) for (let i = p.puntos.length - 1; i >= 0; i--) if (distancia(w, p.puntos[i]) <= t(10)) return { t: 'punto', i };
        for (const ab of p.aberturas) {
            const s = tramoAbertura(p, ab);
            if (distSeg(w, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }).d <= t(8)) return { t: 'abertura', id: ab.id };
        }
        const maqs = p.maquinas.filter(m => idsPlanta.has(m.equipoId));
        for (let i = maqs.length - 1; i >= 0; i--) {
            const m = maqs[i];
            const md = medidas[m.equipoId] || SIN_MEDIDAS;
            const c = caja(m, md.w, md.h);
            if (w.x >= c.x1 && w.x <= c.x2 && w.y >= c.y1 && w.y <= c.y2) return { t: 'maquina', id: m.equipoId };
        }
        for (let i = p.elementos.length - 1; i >= 0; i--) {
            const e = p.elementos[i];
            if (e.tipo === 'ambiente') continue;
            const c = caja(e, e.w, e.h);
            if (w.x >= c.x1 - t(4) && w.x <= c.x2 + t(4) && w.y >= c.y1 - t(4) && w.y <= c.y2 + t(4)) return { t: 'elemento', id: e.id };
        }
        const ambiente = (e) => {
            const c = caja(e, e.w, e.h);
            const cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2;
            const enNombre = Math.abs(w.x - cx) <= t(60) && Math.abs(w.y - cy) <= t(16);
            const dentro = w.x >= c.x1 - t(6) && w.x <= c.x2 + t(6) && w.y >= c.y1 - t(6) && w.y <= c.y2 + t(6);
            const lejosDelBorde = w.x > c.x1 + t(6) && w.x < c.x2 - t(6) && w.y > c.y1 + t(6) && w.y < c.y2 - t(6);
            return enNombre || (dentro && !lejosDelBorde);
        };
        for (const iw of p.interiores) if (distSeg(w, { x: iw.x1, y: iw.y1 }, { x: iw.x2, y: iw.y2 }).d <= t(8)) return { t: 'interior', id: iw.id };
        const medioEspesor = espesor(vistaRef.current.k, false, 15, 4) / 2;
        for (let i = 0; i < cantParedes(p); i++) {
            const [a, b] = tramoPared(p, i);
            if (distSeg(w, a, b).d <= Math.max(t(8), medioEspesor + t(3))) return { t: 'pared', i };
        }
        for (let i = p.elementos.length - 1; i >= 0; i--) if (p.elementos[i].tipo === 'ambiente' && ambiente(p.elementos[i])) return { t: 'elemento', id: p.elementos[i].id };
        const hb = habitacionesRef.current.findIndex(x => dentroDeHabitacion(w, x));
        if (hb >= 0) return { t: 'habitacion', i: hb };
        return null;
    };
    const pestanaDe = (h) => (h.t === 'maquina' ? 'maquinas' : h.t === 'pared' || h.t === 'punto' ? 'paredes' : h.t === 'habitacion' ? 'elementos'
        : h.t === 'elemento' && esInstalacion(planoRef.current.elementos.find(e => e.id === h.id)?.tipo) ? 'instalaciones' : 'elementos');

    // ── Clic (sin arrastrar) según la herramienta ───────────────────────────────────────────────────────────
    const clic = (w) => {
        const p = planoRef.current;
        if (herr === 'mover' || !puedeEditar) {
            const h = golpe(w);
            setSel(h);
            if (h) setPestana(pestanaDe(h));
            return;
        }
        if (herr === 'contorno') {
            if (p.cerrado) { toast.info('El contorno ya está cerrado. Para cambiarlo, mové sus puntos o partí una pared.'); return; }
            const r = puntoContorno(w);
            if (r.cerrar) {
                cambiar({ ...p, cerrado: true, paredes: [...p.paredes, { largo: null }], hueco: null });
                setHerr('mover'); setCursor(null); setPestana('paredes');
                toast.success('Contorno cerrado. Ahora escribí lo que mide cada pared y tocá «Recalcular plano».');
                return;
            }
            const ult = p.puntos[p.puntos.length - 1];
            if (ult && distancia(ult, r.q) < 1) return;
            cambiar({ ...p, puntos: [...p.puntos, r.q], paredes: p.puntos.length ? [...p.paredes, { largo: null }] : p.paredes });
            return;
        }
        if (herr === 'interior') {
            const q = puntoInterior(w);
            if (!pendiente) { setPendiente(q); return; }
            if (distancia(pendiente, q) < 5) return;
            const nueva = { id: nuevoId(), x1: pendiente.x, y1: pendiente.y, x2: q.x, y2: q.y, largo: null };
            cambiar({ ...p, interiores: [...p.interiores, nueva] });
            setPendiente(null); setSel({ t: 'interior', id: nueva.id }); setPestana('elementos');
            return;
        }
        if (herr === 'puerta') {
            let mejor = null;
            const tol = 20 / vistaRef.current.k;
            for (let i = 0; i < cantParedes(p); i++) {
                const [a, b] = tramoPared(p, i);
                const d = distSeg(w, a, b);
                if (d.d <= tol && (!mejor || d.d < mejor.d)) mejor = { ...d, pared: i, interior: null, L: distancia(a, b) };
            }
            for (const iw of p.interiores) {
                const a = { x: iw.x1, y: iw.y1 }, b = { x: iw.x2, y: iw.y2 };
                const d = distSeg(w, a, b);
                if (d.d <= tol && (!mejor || d.d < mejor.d)) mejor = { ...d, pared: null, interior: iw.id, L: distancia(a, b) };
            }
            if (!mejor) { toast.info('Tocá sobre una pared.'); return; }
            const ancho = Math.min(TIPOS_ABERTURA.find(x => x[0] === tipoAbertura)[2], mejor.L);
            const ab = { id: nuevoId(), pared: mejor.pared, interior: mejor.interior, tipo: tipoAbertura, ancho, lado: 0,
                desde: aGrilla(limitar(mejor.t * mejor.L - ancho / 2, 0, mejor.L - ancho), 5) };
            cambiar({ ...p, aberturas: [...p.aberturas, ab] });
            setSel({ t: 'abertura', id: ab.id }); setPestana('elementos');
            return;
        }
        if (herr === 'elemento') {
            const s = pasoIman(vistaRef.current.k);
            const ambiente = tipoElemento.startsWith('amb:') ? tipoElemento.slice(4) : null;
            const tipo = ambiente ? 'ambiente' : tipoElemento;
            const md = MEDIDAS_ELEMENTO[tipo];
            const e = { id: nuevoId(), tipo, x: aGrilla(w.x, s), y: aGrilla(w.y, s), w: md.w, h: md.h, giro: 0, nombre: ambiente || '' };
            cambiar({ ...p, elementos: [...p.elementos, e] });
            setSel({ t: 'elemento', id: e.id }); setPestana('elementos');
        }
        if (herr === 'instalacion') {
            const def = INSTALACIONES[tipoInst];
            const k = vistaRef.current.k;
            const s = pasoIman(k);
            // Las de pared se apoyan solas en la más cercana, con el frente para adentro.
            const pos = (def.pared && apoyarEnPared(p, w, def.h, 40 / k)) || { x: aGrilla(w.x, s), y: aGrilla(w.y, s), giro: 0 };
            const e = { id: nuevoId(), tipo: tipoInst, ...pos, w: def.w, h: def.h, nombre: '',
                ...(tipoInst === 'tablero' ? { termicaA: null, fasesTablero: 'tri', equipos: [] } : {}) };
            cambiar({ ...p, elementos: [...p.elementos, e] });
            setSel({ t: 'elemento', id: e.id }); setPestana('instalaciones');
        }
    };

    // ── Arrastrar un objeto (Mover): se calcula desde cómo estaba al empezar ───────────────────────────────
    const arrastrar = (g, w) => {
        const base = g.base;
        const k = vistaRef.current.k;
        const s = pasoIman(k);
        const dx = w.x - g.w0.x, dy = w.y - g.w0.y;
        const h = g.hit;
        if (h.t === 'punto') {
            const q0 = base.puntos[h.i];
            let q = iman({ x: q0.x + dx, y: q0.y + dy }, 10 / k, h.i) || { x: aGrilla(q0.x + dx, s), y: aGrilla(q0.y + dy, s) };
            // Alineado con los vecinos: si queda casi derecho, queda derecho.
            const nP = base.puntos.length;
            const vecinos = [base.cerrado || h.i > 0 ? base.puntos[(h.i - 1 + nP) % nP] : null, base.cerrado || h.i < nP - 1 ? base.puntos[(h.i + 1) % nP] : null].filter(Boolean);
            q = { ...q };
            for (const v of vecinos) { if (Math.abs(q.x - v.x) <= 8 / k) q.x = v.x; if (Math.abs(q.y - v.y) <= 8 / k) q.y = v.y; }
            return { ...base, puntos: base.puntos.map((pt, i) => (i === h.i ? q : pt)), hueco: null };
        }
        if (h.t === 'maquina') {
            return { ...base, maquinas: base.maquinas.map(m => (m.equipoId === h.id ? { ...m, x: aGrilla(m.x + dx, s), y: aGrilla(m.y + dy, s) } : m)) };
        }
        if (h.t === 'elemento') {
            return {
                ...base, elementos: base.elementos.map(e => {
                    if (e.id !== h.id) return e;
                    // Las de pared se siguen apoyando en la más cercana mientras se arrastran.
                    const ap = INSTALACIONES[e.tipo]?.pared ? apoyarEnPared(base, { x: e.x + dx, y: e.y + dy }, e.h, 30 / k) : null;
                    return { ...e, ...(ap || { x: aGrilla(e.x + dx, s), y: aGrilla(e.y + dy, s) }) };
                }),
            };
        }
        if (h.t === 'interior') {
            const ddx = aGrilla(dx, s), ddy = aGrilla(dy, s);
            return { ...base, interiores: base.interiores.map(iw => (iw.id === h.id ? { ...iw, x1: iw.x1 + ddx, y1: iw.y1 + ddy, x2: iw.x2 + ddx, y2: iw.y2 + ddy } : iw)) };
        }
        if (h.t === 'abertura') {
            return {
                ...base, aberturas: base.aberturas.map(ab => {
                    if (ab.id !== h.id) return ab;
                    const t = tramoAbertura(base, ab);
                    const L = largoSoporte(base, ab);
                    return { ...ab, desde: aGrilla(limitar(ab.desde + dx * t.ux + dy * t.uy, 0, Math.max(0, L - ab.ancho)), 5) };
                }),
            };
        }
        return base;
    };

    // ── Eventos del puntero (mouse y dedos) ─────────────────────────────────────────────────────────────────
    const punteros = useRef(new Map());
    const gesto = useRef(null);
    const posPantalla = (e) => { const r = svgRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    const alBajar = (e) => {
        if (e.button !== undefined && e.button > 1) return;
        svgRef.current.setPointerCapture?.(e.pointerId);
        const sp = posPantalla(e);
        punteros.current.set(e.pointerId, sp);
        if (punteros.current.size === 2) {
            const [a, b] = [...punteros.current.values()];
            gesto.current = { tipo: 'pinza', d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: vistaRef.current };
            return;
        }
        if (punteros.current.size > 2) return;
        const w = aMundo(sp.x, sp.y);
        const hit = herr === 'mover' && puedeEditar && e.button !== 1 ? golpe(w) : null;
        if (hit && hit.t !== 'pared' && hit.t !== 'habitacion') {
            gesto.current = { tipo: 'arrastre', hit, w0: w, s0: sp, base: planoRef.current, movido: false };
            setSel(hit); setPestana(pestanaDe(hit));
        } else {
            gesto.current = { tipo: 'pan', s0: sp, v0: vistaRef.current, movido: false, boton: e.button };
        }
    };
    const alMover = (e) => {
        const sp = posPantalla(e);
        if (punteros.current.has(e.pointerId)) punteros.current.set(e.pointerId, sp);
        const g = gesto.current;
        if ((herr === 'contorno' || herr === 'interior') && puedeEditar && (!g || g.tipo !== 'pinza')) {
            const w = aMundo(sp.x, sp.y);
            setCursor(herr === 'contorno' ? puntoContorno(w) : { q: puntoInterior(w) });
        }
        if (!g) return;
        if (g.tipo === 'pinza') {
            const pts = [...punteros.current.values()];
            if (pts.length < 2) return;
            const [a, b] = pts;
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const k = limitar(g.v0.k * d / g.d0, K_MIN, K_MAX);
            setVista({ k, x: c.x - (g.c0.x - g.v0.x) * k / g.v0.k, y: c.y - (g.c0.y - g.v0.y) * k / g.v0.k });
            return;
        }
        const mov = Math.hypot(sp.x - g.s0.x, sp.y - g.s0.y);
        if (g.tipo === 'pan') {
            if (!g.movido && mov < 5) return;
            g.movido = true;
            setVista({ ...g.v0, x: g.v0.x + sp.x - g.s0.x, y: g.v0.y + sp.y - g.s0.y });
            return;
        }
        if (g.tipo === 'arrastre') {
            if (!g.movido && mov < 4) return;
            if (!g.movido) {
                g.movido = true;
                hist.current.pasado.push(g.base);
                hist.current.futuro = [];
                setSucio(true); setResultado(null); setNHist(x => x + 1);
            }
            fijar(arrastrar(g, aMundo(sp.x, sp.y)));
        }
    };
    const alSoltar = (e) => {
        const g = gesto.current;
        const habia = punteros.current.size;
        punteros.current.delete(e.pointerId);
        if (g?.tipo === 'pinza') { if (punteros.current.size === 0) gesto.current = null; else gesto.current = { tipo: 'nada' }; return; }
        if (habia > 1 || !g) { if (!punteros.current.size) gesto.current = null; return; }
        gesto.current = null;
        if (g.tipo === 'pan' && !g.movido && g.boton !== 1) {
            const sp = posPantalla(e);
            clic(aMundo(sp.x, sp.y));
        }
    };

    // ── Acciones ────────────────────────────────────────────────────────────────────────────────────────────
    const hacerRecalcular = () => {
        const { plano: sig, resultado: r } = recalcular(planoRef.current);
        cambiar(sig);
        setResultado(r);
    };
    const borrarSel = useCallback(() => {
        if (!sel || !puedeEditar) return;
        const p = planoRef.current;
        if (sel.t === 'punto') cambiar(borrarPunto(p, sel.i));
        else if (sel.t === 'pared') { toast.info('Para sacar una pared, borrá uno de sus puntos.'); return; }
        else if (sel.t === 'habitacion') { toast.info('La habitación la forman las paredes: para sacarla, mové o borrá una pared interior.'); return; }
        else if (sel.t === 'interior') cambiar({ ...p, interiores: p.interiores.filter(x => x.id !== sel.id), aberturas: p.aberturas.filter(a => a.interior !== sel.id) });
        else if (sel.t === 'abertura') cambiar({ ...p, aberturas: p.aberturas.filter(x => x.id !== sel.id) });
        else if (sel.t === 'elemento') cambiar({ ...p, elementos: p.elementos.filter(x => x.id !== sel.id) });
        else if (sel.t === 'maquina') cambiar({ ...p, maquinas: p.maquinas.filter(x => x.equipoId !== sel.id) });
        setSel(null);
    }, [sel, puedeEditar, cambiar]);
    const girarSel = useCallback(() => {
        if (!sel || !puedeEditar) return;
        const p = planoRef.current;
        if (sel.t === 'maquina') cambiar({ ...p, maquinas: p.maquinas.map(m => (m.equipoId === sel.id ? { ...m, giro: (m.giro + 90) % 360 } : m)) });
        if (sel.t === 'elemento') cambiar({ ...p, elementos: p.elementos.map(x => (x.id === sel.id ? { ...x, giro: (x.giro + 90) % 360 } : x)) });
    }, [sel, puedeEditar, cambiar]);
    const ubicarMaquina = (equipoId) => {
        const t = tamRef.current || { w: 800, h: 600 };
        const p = planoRef.current;
        // El lugar libre más cerca del centro de lo que se ve (solo con las máquinas de esta planta).
        const actual = { ...p, maquinas: p.maquinas.filter(m => idsPlanta.has(m.equipoId)) };
        const q = lugarLibre(actual, medidas, equipoId, aMundo(t.w / 2, t.h / 2));
        cambiar({ ...p, maquinas: [...p.maquinas.filter(m => m.equipoId !== equipoId), { equipoId, ...q }] });
        setSel({ t: 'maquina', id: equipoId });
        setHerr('mover');
    };
    const copiarContorno = (otra) => {
        const o = normalizarPlano(otra.Plano);
        cambiar({ ...planoRef.current, puntos: o.puntos, cerrado: o.cerrado, paredes: o.paredes, hueco: o.hueco, aberturas: [] });
        setSel(null);
        toast.success(`Contorno copiado de ${otra.Nombre}. Las puertas no se copian.`);
    };

    const guardar = useCallback(async () => {
        if (!puedeEditar) return;
        setGuardando(true);
        try {
            const p = planoRef.current;
            const r = await servicioTecnicoService.guardarPlano(planta.PlantaId, { ...p, maquinas: p.maquinas.filter(m => idsPlanta.has(m.equipoId)) }, version);
            setVersion(r.data?.guardado || null);
            setSucio(false);
            toast.success('Plano guardado');
            onGuardado?.();
        } catch (e) { toast.error(mensajeError(e, 'No se pudo guardar el plano')); }
        finally { setGuardando(false); }
    }, [puedeEditar, planta.PlantaId, idsPlanta, version, onGuardado]);
    const cerrar = () => {
        if (sucio) setConfirmar({ titulo: 'Hay cambios sin guardar', texto: 'Si salís ahora, se pierden.', boton: 'Salir sin guardar', accion: onCerrar });
        else onCerrar();
    };

    // Teclado: Supr borra, R gira, Ctrl+Z / Ctrl+Y, Ctrl+S guarda, Esc cancela.
    useEffect(() => {
        const tecla = (e) => {
            if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            const ctrl = e.ctrlKey || e.metaKey;
            if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); guardar(); return; }
            if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) rehacer(); else deshacer(); return; }
            if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); rehacer(); return; }
            if (e.key === 'Escape') {
                if (fichaId != null) setFichaId(null);
                else if (pendiente) setPendiente(null);
                else if (herr !== 'mover') { setHerr('mover'); setCursor(null); }
                else setSel(null);
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); borrarSel(); return; }
            if (e.key.toLowerCase() === 'r' && !ctrl) girarSel();
        };
        window.addEventListener('keydown', tecla);
        return () => window.removeEventListener('keydown', tecla);
    }, [guardar, deshacer, rehacer, borrarSel, girarSel, pendiente, herr, fichaId]);

    useEffect(() => {
        if (!sucio) return undefined;
        const antes = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', antes);
        return () => window.removeEventListener('beforeunload', antes);
    }, [sucio]);

    const elegirHerr = (id) => { setHerr(id); setPendiente(null); setCursor(null); if (id !== 'mover') setSel(null); };

    // ── Grilla visible ──────────────────────────────────────────────────────────────────────────────────────
    const grilla = useMemo(() => {
        if (!tam) return null;
        const { k, x, y } = vista;
        const x1 = -x / k, y1 = -y / k, x2 = (tam.w - x) / k, y2 = (tam.h - y) / k;
        const chico = [10, 50, 100, 500, 1000, 5000].find(s => s * k >= 12) || 5000;
        const grande = [100, 500, 1000, 5000, 10000].find(s => s >= chico * 5 && s * k >= 60) || 10000;
        const lineas = (s) => {
            let d = '';
            for (let gx = Math.floor(x1 / s) * s; gx <= x2; gx += s) d += `M${gx} ${y1}V${y2}`;
            for (let gy = Math.floor(y1 / s) * s; gy <= y2; gy += s) d += `M${x1} ${gy}H${x2}`;
            return d;
        };
        return { chico: lineas(chico), grande: lineas(grande), paso: grande };
    }, [tam, vista]);
    // Escala: una barra de 60 a 150 px con un largo redondo.
    const escala = useMemo(() => {
        const cm = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find(c => c * vista.k >= 60) || 10000;
        return { cm, px: cm * vista.k };
    }, [vista.k]);

    const n = cantParedes(plano);
    const area = plano.cerrado && !plano.hueco ? areaM2(plano.puntos) : null;
    const ocupado = ocupadoM2(visible, medidas);
    const refsParedes = useRef([]);
    const selMaquina = sel?.t === 'maquina' ? visible.maquinas.find(m => m.equipoId === sel.id) : null;
    const ayuda = !puedeEditar ? 'Arrastrá para mover el plano; rueda o pellizco para el zoom.'
        : herr === 'contorno' ? (plano.cerrado ? 'El contorno ya está cerrado.' : !plano.puntos.length ? 'Tocá donde va la primera esquina.'
            : 'Tocá la esquina siguiente. Para cerrar, tocá el primer punto. Doble clic o Esc: dejarlo abierto.')
        : herr === 'interior' ? (pendiente ? 'Tocá donde termina la pared.' : 'Tocá donde empieza la pared interior.')
        : herr === 'puerta' ? `${TIPOS_ABERTURA.find(x => x[0] === tipoAbertura)[1]}: tocá sobre una pared (del contorno o interior).`
        : herr === 'elemento' ? (tipoElemento.startsWith('amb:') ? `${tipoElemento.slice(4)}: tocá donde va; el ancho y el largo se ajustan en «Elementos».` : `${OPCIONES_ELEMENTO.find(o => o.id === tipoElemento)?.label}: tocá donde va.`)
        : herr === 'instalacion' ? (INSTALACIONES[tipoInst].pared ? `${INSTALACIONES[tipoInst].label}: tocá cerca de la pared; se apoya solo, con el frente para adentro.` : `${INSTALACIONES[tipoInst].label}: tocá donde va.`)
        : 'Tocá una pared, un punto o una máquina para elegirla; arrastrá para moverla. Supr borra, R gira.';

    const titulo = `${String(local.Nombre || '').replace(/(^|\s)(\p{L})/gu, (m, e, l) => e + l.toUpperCase())} · ${planta.Nombre}`;

    return createPortal(
        <div className="fixed inset-0 z-[6000] bg-white flex flex-col">
            {/* Encabezado */}
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-zinc-200 shrink-0">
                <LandPlot size={20} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 mr-auto">
                    <div className="font-black text-zinc-800 truncate">Plano · {titulo}</div>
                    <div className="text-xs text-zinc-400 truncate">
                        {sucio ? <span className="text-amber-600 font-bold">Sin guardar</span>
                            : planta.Plano?.por ? `Guardado por ${planta.Plano.por}` : 'Sin plano todavía'}
                    </div>
                </div>
                <button type="button" title="Ver el local en 3D" className={btnSec}
                    onClick={() => {
                        // Todas las plantas del local con plano; la de acá, como está ahora (aunque no esté guardada).
                        const lista = [...plantasLocal].sort((a, b) => a.Orden - b.Orden).map(x => {
                            if (x.PlantaId === planta.PlantaId) {
                                const p = planoRef.current;
                                return { planta: x, plano: { ...p, maquinas: p.maquinas.filter(m => idsPlanta.has(m.equipoId)) } };
                            }
                            const pl = normalizarPlano(x.Plano);
                            const ids = new Set(todosEquipos.filter(e => e.LocalId === x.LocalId && e.PlantaId === x.PlantaId).map(e => e.EquipoID));
                            return { planta: x, plano: { ...pl, maquinas: pl.maquinas.filter(m => ids.has(m.equipoId)) } };
                        }).filter(x => x.plano.puntos.length || x.plano.interiores.length);
                        if (!lista.length) { toast.info('Primero dibujá el contorno.'); return; }
                        setVer3D(lista);
                    }}>
                    <Box size={16} /><span className="hidden sm:inline">3D</span>
                </button>
                {puedeEditar && <>
                    <button type="button" onClick={deshacer} disabled={!hist.current.pasado.length} title="Deshacer (Ctrl+Z)" className={`${btnSec} px-2.5`}><Undo2 size={16} /></button>
                    <button type="button" onClick={rehacer} disabled={!hist.current.futuro.length} title="Rehacer (Ctrl+Y)" className={`${btnSec} px-2.5`}><Redo2 size={16} /></button>
                    <button type="button" onClick={guardar} disabled={guardando || !sucio} className={btnPri}>
                        {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}<span className="hidden sm:inline">Guardar</span>
                    </button>
                </>}
                <button type="button" onClick={cerrar} title="Cerrar" className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><X size={20} /></button>
            </div>

            {/* Herramientas */}
            <div className="flex items-center gap-1.5 px-3 sm:px-4 py-2 border-b border-zinc-100 overflow-x-auto no-scrollbar shrink-0">
                {puedeEditar && HERRAMIENTAS.map(({ id, label: l, corto, Icono }) => (
                    <button key={id} type="button" onClick={() => elegirHerr(id)} title={l}
                        className={`${btn} shrink-0 border ${herr === id ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}>
                        <Icono size={15} /><span className="hidden md:inline">{l}</span><span className="md:hidden">{corto}</span>
                    </button>
                ))}
                {puedeEditar && <>
                    <MenuHerramienta activo={herr === 'puerta'} Icono={DoorOpen} etiqueta="Aberturas"
                        opciones={TIPOS_ABERTURA.map(([id, l]) => ({ id, label: l }))} valor={tipoAbertura}
                        onActivar={() => elegirHerr('puerta')} onElegir={(v) => { setTipoAbertura(v); elegirHerr('puerta'); }} />
                    <MenuHerramienta activo={herr === 'elemento'} Icono={Shapes} etiqueta="Elementos" opciones={OPCIONES_ELEMENTO} valor={tipoElemento}
                        onActivar={() => elegirHerr('elemento')} onElegir={(v) => { setTipoElemento(v); elegirHerr('elemento'); }} />
                    <MenuHerramienta activo={herr === 'instalacion'} Icono={Zap} etiqueta="Instalaciones"
                        opciones={Object.entries(INSTALACIONES).map(([id, d]) => ({ id, label: d.label }))} valor={tipoInst}
                        onActivar={() => elegirHerr('instalacion')} onElegir={(v) => { setTipoInst(v); elegirHerr('instalacion'); }} />
                </>}
                {puedeEditar && (
                    <label className="shrink-0 inline-flex items-center gap-2 ml-1 px-2 text-sm font-bold text-zinc-600 whitespace-nowrap">
                        <input type="checkbox" checked={recto} onChange={(e) => setRecto(e.target.checked)} className="w-4 h-4 accent-brand-cyan" /> Ángulos rectos
                    </label>
                )}
                <span className="ml-auto shrink-0 flex items-center gap-1.5">
                    {/* Otra planta del local, clarita de fondo, para dibujar encima. Solo si alguna ya tiene plano. */}
                    {conPlano.length > 0 && (
                        <span className="w-48" title="Otra planta del local, clarita de fondo, para dibujar encima">
                            <Selector value={refId} onChange={(e) => setRefId(e.target.value)} aria-label="Planta de fondo">
                                <option value="">Sin planta de fondo</option>
                                {conPlano.map(o => <option key={o.PlantaId} value={String(o.PlantaId)}>De fondo: {o.Nombre}</option>)}
                            </Selector>
                        </span>
                    )}
                    <button type="button" onClick={() => zoomCentro(1 / 1.3)} title="Alejar" className={`${btnSec} px-2.5`}><ZoomOut size={16} /></button>
                    <button type="button" onClick={() => zoomCentro(1.3)} title="Acercar" className={`${btnSec} px-2.5`}><ZoomIn size={16} /></button>
                    <button type="button" onClick={encuadrar} title="Ver todo" className={`${btnSec} px-2.5`}><Maximize size={16} /></button>
                </span>
            </div>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
                {/* Lienzo */}
                <div ref={contRef} className="relative h-[55vh] lg:h-auto lg:flex-1 min-w-0 bg-zinc-50 overflow-hidden">
                    {tam && (
                        <svg ref={svgRef} width={tam.w} height={tam.h} className="block select-none"
                            style={{ touchAction: 'none', cursor: herr === 'mover' || !puedeEditar ? (gesto.current?.tipo === 'pan' ? 'grabbing' : 'default') : 'crosshair' }}
                            onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar}
                            onPointerLeave={() => setCursor(null)}
                            onDoubleClick={() => { if (herr === 'contorno' && !plano.cerrado && plano.puntos.length) { elegirHerr('mover'); } }}
                            onContextMenu={(e) => e.preventDefault()}>
                            <g transform={`translate(${vista.x} ${vista.y}) scale(${vista.k})`}>
                                {grilla && <>
                                    <path d={grilla.chico} stroke="#e4e4e7" strokeWidth={1} vectorEffect={NS} fill="none" />
                                    <path d={grilla.grande} stroke="#d4d4d8" strokeWidth={1} vectorEffect={NS} fill="none" />
                                </>}
                                {refPlano && (
                                    <g opacity={0.35}>
                                        <DibujoPlano plano={refPlano} medidas={medidas} k={vista.k} mini />
                                    </g>
                                )}
                                <DibujoPlano plano={visible} medidas={medidas} nombres={nombres} avisos={avisos} sel={sel} k={vista.k}
                                    editable={puedeEditar && herr === 'mover'} calculadas={resultado?.calculadas || []} habitaciones={habitaciones} />
                                {/* Lo que se está dibujando */}
                                {herr === 'contorno' && !plano.cerrado && plano.puntos.length > 0 && cursor?.q && (() => {
                                    const ult = plano.puntos[plano.puntos.length - 1];
                                    const L = distancia(ult, cursor.q);
                                    return <>
                                        <line x1={ult.x} y1={ult.y} x2={cursor.q.x} y2={cursor.q.y} stroke={CIAN} strokeWidth={2} strokeDasharray="6 4" vectorEffect={NS} />
                                        {L > 0 && <Texto x={(ult.x + cursor.q.x) / 2} y={(ult.y + cursor.q.y) / 2 - 14 / vista.k} k={vista.k} tam={11} color={CIAN}>≈ {metrosCorto(L)} m</Texto>}
                                    </>;
                                })()}
                                {herr === 'contorno' && !plano.cerrado && plano.puntos.length > 0 && plano.puntos.map((q, i) => (
                                    <circle key={i} cx={q.x} cy={q.y} r={(i === 0 ? 6 : 3.5) / vista.k} fill={i === 0 ? '#fff' : OSCURO} stroke={CIAN} strokeWidth={i === 0 ? 2.5 : 0} vectorEffect={NS} />
                                ))}
                                {(herr === 'contorno' || herr === 'interior') && cursor?.q && (
                                    <circle cx={cursor.q.x} cy={cursor.q.y} r={(cursor.cerrar ? 9 : 4) / vista.k} fill={cursor.cerrar ? 'none' : CIAN} stroke={CIAN} strokeWidth={2} vectorEffect={NS} />
                                )}
                                {herr === 'interior' && pendiente && <>
                                    <circle cx={pendiente.x} cy={pendiente.y} r={4 / vista.k} fill={CIAN} />
                                    {cursor?.q && <line x1={pendiente.x} y1={pendiente.y} x2={cursor.q.x} y2={cursor.q.y} stroke={CIAN} strokeWidth={2} strokeDasharray="6 4" vectorEffect={NS} />}
                                </>}
                            </g>
                        </svg>
                    )}
                    <div className="absolute left-3 top-3 right-3 sm:right-auto sm:max-w-md pointer-events-none">
                        <div className="inline-block rounded-xl bg-white/95 border border-zinc-200 shadow-sm px-3 py-1.5 text-xs text-zinc-600">{ayuda}</div>
                    </div>
                    <div className="absolute right-3 bottom-3 pointer-events-none flex flex-col items-end gap-0.5">
                        <div className="h-1.5 border-x-2 border-b-2 border-zinc-500" style={{ width: escala.px }} />
                        <div className="text-[11px] font-bold text-zinc-500">{fmtM(escala.cm, escala.cm < 100 ? 2 : 0)}</div>
                    </div>
                </div>

                {/* Panel */}
                <div className="flex-1 lg:flex-none lg:w-[380px] min-h-0 border-t lg:border-t-0 lg:border-l border-zinc-200 flex flex-col bg-white">
                    <div className="flex px-2 pt-2 border-b border-zinc-100 shrink-0">
                        {[['paredes', 'Paredes'], ['maquinas', 'Máquinas', equipos.length], ['elementos', 'Elementos'], ['instalaciones', 'Instalaciones']].map(([id, l, n]) => (
                            <button key={id} type="button" onClick={() => setPestana(id)}
                                className={`flex-auto px-1.5 py-2 text-[13px] font-bold border-b-2 -mb-px whitespace-nowrap ${pestana === id ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-zinc-400 hover:text-zinc-600'}`}>
                                {l}{n != null && <span className="ml-1 text-[11px] font-black opacity-70">{n}</span>}
                            </button>
                        ))}
                    </div>
                    <div ref={panelRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                        {pestana === 'paredes' && <>
                            {!plano.puntos.length ? (
                                <div className="text-sm text-zinc-600 space-y-2">
                                    <p><b>1.</b> Con <b>Contorno</b>, tocá cada esquina del local, una tras otra. Las medidas no importan: es un borrador.</p>
                                    <p><b>2.</b> Cerralo tocando el primer punto.</p>
                                    <p><b>3.</b> Escribí acá lo que mide cada pared y tocá <b>Recalcular plano</b>.</p>
                                    <p className="text-zinc-400">Si dejás una pared sin medir por dirección (una horizontal y una vertical), se calcula sola.</p>
                                    {conPlano.length > 0 && puedeEditar && (
                                        <div className="pt-2 space-y-1.5">
                                            {conPlano.map(o => (
                                                <button key={o.PlantaId} type="button" onClick={() => copiarContorno(o)} className={`${btnSec} w-full justify-center`}>
                                                    <Copy size={14} /> Empezar con el contorno de {o.Nombre}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : <>
                                <div className="flex items-center gap-3">
                                    <span className="shrink-0 text-[11px] font-black text-zinc-500 uppercase tracking-wide">Altura (piso a techo)</span>
                                    <span className="w-28"><InputMetros valor={plano.altura} disabled={!puedeEditar} placeholder={String(ALTURA_PLANTA / 100).replace('.', ',')}
                                        onCambiar={(v) => cambiar(p => ({ ...p, altura: v }))} /></span>
                                    <span className="text-[11px] text-zinc-400">para la vista 3D</span>
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                    <span className="text-zinc-500">Superficie <b className="text-zinc-800">{area != null ? `${area.toLocaleString('es-UY', { maximumFractionDigits: 1 })} m²` : '—'}</b></span>
                                    <span className="text-zinc-500">Perímetro <b className="text-zinc-800">{fmtM(perimetro(plano), 1)}</b></span>
                                </div>
                                {!plano.cerrado && <p className="text-xs text-amber-700">El contorno está abierto: cerralo tocando su primer punto con la herramienta Contorno.</p>}
                                <div>
                                    <div className="grid grid-cols-[auto_1fr_96px] gap-x-2 gap-y-1.5 items-center">
                                        {Array.from({ length: n }, (_, i) => {
                                            const med = plano.paredes[i]?.largo;
                                            const L = largoPared(plano, i);
                                            const elegida = sel?.t === 'pared' && sel.i === i;
                                            return [
                                                <button key={`n${i}`} type="button" onClick={() => setSel({ t: 'pared', i })}
                                                    className={`w-7 h-7 rounded-lg text-xs font-black ${elegida ? 'bg-brand-cyan text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>{i + 1}</button>,
                                                <span key={`d${i}`} className="text-xs text-zinc-400 truncate">
                                                    {resultado?.calculadas?.includes(i) ? <span className="text-brand-cyan font-bold">calculada: {fmtM(L)}</span>
                                                        : med != null && Math.abs(med - L) > 1 ? <span className="text-amber-600">dibujo {fmtM(L)}</span>
                                                        : med == null ? `dibujo ≈ ${fmtM(L)}` : ''}
                                                </span>,
                                                <InputMetros key={`i${i}`} valor={med} disabled={!puedeEditar}
                                                    refInput={(el) => { refsParedes.current[i] = el; }}
                                                    onCambiar={(v) => cambiar(p => ({ ...p, paredes: p.paredes.map((w, j) => (j === i ? { largo: v } : w)) }))}
                                                    onEnter={() => { const sig = refsParedes.current[i + 1]; if (sig) sig.focus(); else hacerRecalcular(); }} />,
                                            ];
                                        })}
                                    </div>
                                    {puedeEditar && <p className="mt-1.5 text-[11px] text-zinc-400">Enter pasa a la siguiente; en la última, recalcula.</p>}
                                </div>
                                {puedeEditar && (
                                    <button type="button" onClick={hacerRecalcular} disabled={!n} className={`${btnPri} w-full justify-center py-2.5`}>
                                        <Calculator size={16} /> Recalcular plano
                                    </button>
                                )}
                                {resultado && <ResultadoRecalculo r={resultado} />}
                                {puedeEditar && (sel?.t === 'pared' || sel?.t === 'punto') && (
                                    <div className="flex flex-wrap gap-2">
                                        {sel.t === 'pared' && <button type="button" onClick={() => { cambiar(partirPared(planoRef.current, sel.i)); setSel(null); }} className={btnSec}><Scissors size={14} /> Partir la pared {sel.i + 1}</button>}
                                        {sel.t === 'punto' && <button type="button" onClick={borrarSel} className={btnSec}><Trash2 size={14} /> Borrar el punto</button>}
                                    </div>
                                )}
                                {puedeEditar && (
                                    <div className="pt-2 border-t border-zinc-100 space-y-1.5">
                                        {conPlano.map(o => (
                                            <button key={o.PlantaId} type="button" className={`${btnSec} w-full justify-center`}
                                                onClick={() => setConfirmar({ titulo: `Copiar el contorno de ${o.Nombre}`, texto: 'Se reemplaza el contorno de esta planta (las máquinas y columnas quedan).', boton: 'Copiar', accion: () => copiarContorno(o) })}>
                                                <Copy size={14} /> Copiar el contorno de {o.Nombre}
                                            </button>
                                        ))}
                                        <button type="button" className={`${btnSec} w-full justify-center text-rose-600`}
                                            onClick={() => setConfirmar({ titulo: 'Borrar el contorno', texto: 'Se borran las paredes del contorno y sus puertas. Las máquinas, columnas y paredes interiores quedan.', boton: 'Borrar', accion: () => { cambiar({ ...planoRef.current, puntos: [], cerrado: false, paredes: [], hueco: null, aberturas: [] }); setSel(null); elegirHerr('contorno'); } })}>
                                            <Trash2 size={14} /> Borrar el contorno
                                        </button>
                                    </div>
                                )}
                            </>}
                        </>}

                        {pestana === 'maquinas' && <>
                            <div className="text-sm text-zinc-500">
                                Ocupan <b className="text-zinc-800">{ocupado.toLocaleString('es-UY', { maximumFractionDigits: 1 })} m²</b>
                                {area ? <> de {area.toLocaleString('es-UY', { maximumFractionDigits: 1 })} m² ({Math.round(ocupado / area * 100)} %)</> : null}.
                            </div>
                            {selMaquina && (() => {
                                const md = medidas[selMaquina.equipoId] || SIN_MEDIDAS;
                                return (
                                    <div className="rounded-xl border border-brand-cyan/40 bg-brand-cyan/5 p-3 space-y-2">
                                        <div className="font-black text-zinc-800">{nombres[selMaquina.equipoId]}</div>
                                        <div className="text-xs text-zinc-600">
                                            {md.sinMedidas ? <span className="text-amber-700">La ficha no tiene largo y ancho: se dibuja de 1 × 1 m.</span>
                                                : <>Frente {fmtM(md.w)} × fondo {fmtM(md.h)}</>}
                                            {md.servicio > 0 && <> · {fmtM(md.servicio)} libres para servicio</>}
                                            {md.peso && <> · {md.peso.toLocaleString('es-UY')} kg</>}
                                        </div>
                                        {(avisos[selMaquina.equipoId] || []).map((a, i) => (
                                            <div key={i} className="flex items-start gap-1.5 text-xs font-bold text-rose-700"><AlertTriangle size={13} className="mt-px shrink-0" />{a.texto}</div>
                                        ))}
                                        <div className="flex flex-wrap gap-2">
                                            {puedeEditar && <button type="button" onClick={girarSel} className={btnSec}><RotateCw size={14} /> Girar</button>}
                                            {puedeEditar && <button type="button" onClick={borrarSel} className={btnSec}><Trash2 size={14} /> Sacar del plano</button>}
                                            <button type="button" onClick={() => setFichaId(selMaquina.equipoId)} className={btnSec}><ExternalLink size={14} /> Abrir ficha</button>
                                            <button type="button" onClick={() => setPedirPara(selMaquina.equipoId)} className={btnSec}><Wrench size={14} /> Pedir servicio</button>
                                        </div>
                                    </div>
                                );
                            })()}
                            {equipos.length === 0 && <p className="text-sm text-zinc-400">Esta planta no tiene máquinas. Se agregan desde la lista del local, con «Agregar máquinas».</p>}
                            <div className="space-y-1">
                                {equipos.map(e => {
                                    const ubicada = visible.maquinas.find(m => m.equipoId === e.EquipoID);
                                    const md = medidas[e.EquipoID] || SIN_MEDIDAS;
                                    const av = avisos[e.EquipoID];
                                    return (
                                        <div key={e.EquipoID} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${sel?.t === 'maquina' && sel.id === e.EquipoID ? 'border-brand-cyan' : 'border-zinc-200'}`}>
                                            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => ubicada && setSel({ t: 'maquina', id: e.EquipoID })}>
                                                <span className="flex items-center gap-1.5 font-bold text-sm text-zinc-800 truncate">
                                                    {av ? <AlertTriangle size={13} className="text-rose-600 shrink-0" /> : ubicada ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : null}
                                                    {e.Nombre}
                                                </span>
                                                <span className="block text-xs text-zinc-400 truncate">
                                                    {md.sinMedidas ? 'Sin medidas en la ficha' : `${metrosCorto(md.w)} × ${metrosCorto(md.h)} m`}{ubicada ? '' : ' · sin ubicar'}{tableroDe[e.EquipoID] ? ` · ${tableroDe[e.EquipoID]}` : ''}
                                                </span>
                                            </button>
                                            {puedeEditar && !ubicada && <button type="button" onClick={() => ubicarMaquina(e.EquipoID)} className={btnSec}>Ubicar</button>}
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-[11px] text-zinc-400">Las medidas salen de la ficha técnica (largo = frente, la línea gruesa; ancho = fondo). La línea punteada es el espacio libre para servicio.</p>
                        </>}

                        {pestana === 'elementos' && <PanelElementos plano={plano} sel={sel} setSel={setSel} cambiar={cambiar} puedeEditar={puedeEditar}
                            habitaciones={habitaciones} abiertos={abiertos} alternar={alternar} />}
                        {pestana === 'instalaciones' && <PanelInstalaciones plano={plano} sel={sel} setSel={setSel} cambiar={cambiar} puedeEditar={puedeEditar}
                            equiposLocal={equiposLocal} plantasLocal={plantasLocal} plantaId={planta.PlantaId} abiertos={abiertos} alternar={alternar} />}
                    </div>
                </div>
            </div>

            {ver3D && <Plano3D local={local} plantas={ver3D} plantaActualId={planta.PlantaId} medidas={medidas} nombres={nombres} equipos={todosEquipos}
                onAbrirFicha={setFichaId} onPedirServicio={setPedirPara} onCerrar={() => setVer3D(null)} />}
            {pedirPara != null && (
                <Suspense fallback={null}>
                    <NuevaSolicitudModal abierta equipoInicial={pedirPara} onCerrar={() => setPedirPara(null)} />
                </Suspense>
            )}
            {fichaId != null && (
                <PanelFicha equipoId={fichaId} meta={meta} onCerrar={() => setFichaId(null)} onCambiarMaquina={setFichaId}
                    onIr={(param) => {
                        // Ir a una solicitud o un trabajo sale del plano: con cambios sin guardar, primero guardar.
                        if (sucio) { toast.info('Guardá el plano antes de ir a Servicio Técnico: si no, se pierden los cambios.'); return; }
                        navigate(`/servicio-tecnico?${param}`);
                    }} />
            )}
            {confirmar && (
                <MiniModal titulo={confirmar.titulo} chico onCerrar={() => setConfirmar(null)} pie={<>
                    <button onClick={() => setConfirmar(null)} className={btnCancelar}>Cancelar</button>
                    <button onClick={() => { const a = confirmar.accion; setConfirmar(null); a(); }} className={btnPri}>{confirmar.boton}</button>
                </>}>
                    <p className="text-sm text-zinc-600">{confirmar.texto}</p>
                </MiniModal>
            )}
        </div>,
        document.body,
    );
};

const ResultadoRecalculo = ({ r }) => {
    if (r.estado === 'no-cierra') {
        return (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <div className="font-black flex items-center gap-1.5"><AlertTriangle size={15} /> No cierra por {fmtM(r.error)}</div>
                <p className="mt-1 text-xs">
                    {Math.abs(r.errorX) > 1 && <>Sobran o faltan {fmtM(Math.abs(r.errorX))} en horizontal. </>}
                    {Math.abs(r.errorY) > 1 && <>Sobran o faltan {fmtM(Math.abs(r.errorY))} en vertical. </>}
                    Revisá las medidas, o dejá una pared sin medir en esa dirección para que se calcule. El hueco queda marcado en rojo.
                </p>
            </div>
        );
    }
    const textos = {
        ok: 'Listo: el plano quedó con las medidas.',
        calculadas: `Listo. ${r.calculadas.length === 1 ? 'La pared sin medir se calculó' : 'Las paredes sin medir se calcularon'} para que cierre (en celeste).`,
        ajustado: `Listo. No cerraba por ${fmtM(r.error)}: se repartió entre las paredes.`,
        abierto: 'El contorno está abierto: se aplicaron las medidas sin cerrarlo.',
        vacio: 'No hay paredes.',
    };
    return (
        <div className={`rounded-xl border p-3 text-sm ${r.estado === 'ajustado' || r.estado === 'abierto' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            <div className="flex items-start gap-1.5"><CheckCircle2 size={15} className="mt-0.5 shrink-0" />{textos[r.estado]}</div>
        </div>
    );
};

// Grupos plegables de los paneles (uno por tipo, con la cantidad). Se abren solos al elegir algo en el plano.
const TITULO_GRUPO = {
    habitaciones: 'Habitaciones', puerta: 'Puertas', porton: 'Portones / entradas', ventana: 'Ventanas', interior: 'Paredes interiores',
    columna: 'Columnas', escalera: 'Escaleras', ascensor: 'Ascensores', ambiente: 'Oficinas', otro: 'Otros',
    tablero: 'Tableros eléctricos', toma: 'Tomas trifásicas', compresor: 'Compresores', extractor: 'Extractores', matafuegos: 'Matafuegos', salida: 'Salidas de emergencia',
};
const Grupo = ({ clave, cantidad, abiertos, alternar, children }) => {
    if (!cantidad) return null;
    const abierto = abiertos.has(clave);
    return (
        <div className="rounded-xl border border-zinc-200 overflow-hidden">
            <button type="button" onClick={() => alternar(clave)} aria-expanded={abierto}
                className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-50 hover:bg-zinc-100 text-left">
                <ChevronDown size={15} className={`shrink-0 text-zinc-400 transition-transform ${abierto ? '' : '-rotate-90'}`} />
                <span className="text-sm font-bold text-zinc-700 mr-auto">{TITULO_GRUPO[clave] || clave}</span>
                <span className="text-xs font-black text-zinc-500 bg-white border border-zinc-200 rounded-full px-2">{cantidad}</span>
            </button>
            {abierto && <div className="p-2 space-y-2 border-t border-zinc-200">{children}</div>}
        </div>
    );
};

// Habitaciones, puertas, paredes interiores, columnas, escaleras…: medidas y tipo, agrupadas por tipo.
const PanelElementos = ({ plano, sel, setSel, cambiar, puedeEditar, habitaciones = [], abiertos, alternar }) => {
    // El nombre de una habitación va en un punto adentro de ella; sin nombre, el punto se borra.
    const nombrarHabitacion = (hb, nombre) => cambiar(p => {
        let hs = p.habitaciones || [];
        if (hb.anclaId) hs = nombre.trim() ? hs.map(a => (a.id === hb.anclaId ? { ...a, nombre } : a)) : hs.filter(a => a.id !== hb.anclaId);
        else if (nombre.trim()) hs = [...hs, { id: nuevoId(), x: hb.etiqueta.x, y: hb.etiqueta.y, nombre }];
        return { ...p, habitaciones: hs };
    });
    const cambiarEn = (clave, id, campos) => cambiar(p => ({ ...p, [clave]: p[clave].map(x => (x.id === id ? { ...x, ...campos } : x)) }));
    // Al borrar una pared interior se van también sus puertas.
    const quitar = (clave, id) => {
        cambiar(p => ({ ...p, [clave]: p[clave].filter(x => x.id !== id), ...(clave === 'interiores' ? { aberturas: p.aberturas.filter(a => a.interior !== id) } : {}) }));
        setSel(null);
    };
    const elementos = plano.elementos.filter(e => !esInstalacion(e.tipo));
    const vacio = !plano.aberturas.length && !plano.interiores.length && !elementos.length && !habitaciones.length;
    const tarjeta = (elegido) => `rounded-xl border p-3 space-y-2 ${elegido ? 'border-brand-cyan bg-brand-cyan/5' : 'border-zinc-200'}`;
    const boton = 'p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50';
    return <>
        {vacio && (
            <div className="text-sm text-zinc-600 space-y-1.5">
                <p>Con las herramientas de arriba: <b>Aberturas</b> (puerta, portón / entrada o ventana, tocando una pared del contorno o interior), <b>Pared interior</b> y <b>Elementos</b> (columna, escalera, ascensor u oficina).</p>
                <p className="text-zinc-400">Cada puerta se ubica por la distancia desde una esquina de su pared: la que comparte con la pared anterior.</p>
            </div>
        )}
        {habitaciones.length > 0 && (
            <Grupo clave="habitaciones" cantidad={habitaciones.length} abiertos={abiertos} alternar={alternar}>
                {habitaciones.map((hb, i) => (
                    <div key={`hab${i}`} onClick={() => setSel({ t: 'habitacion', i })} data-elegido={sel?.t === 'habitacion' && sel.i === i}
                        className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${sel?.t === 'habitacion' && sel.i === i ? 'border-brand-cyan bg-brand-cyan/5' : 'border-zinc-200'}`}>
                        <span className="w-4 h-4 rounded shrink-0 border border-zinc-300" style={{ background: COLORES_HABITACION[i % COLORES_HABITACION.length] }} />
                        <input value={hb.nombre} disabled={!puedeEditar} maxLength={60} placeholder="Nombre (ej: Oficina)"
                            onChange={(e) => nombrarHabitacion(hb, e.target.value)}
                            className="min-w-0 flex-1 px-2 py-1 border border-zinc-200 rounded-lg text-sm text-zinc-800 bg-white outline-none focus:border-brand-cyan disabled:bg-zinc-50" />
                        <span className="shrink-0 text-xs font-bold text-zinc-500">{hb.areaM2.toLocaleString('es-UY', { maximumFractionDigits: 1 })} m²</span>
                    </div>
                ))}
                <p className="text-[11px] text-zinc-400 px-1">Las forman las paredes interiores al juntarse con el contorno o entre ellas.</p>
            </Grupo>
        )}
        {TIPOS_ABERTURA.map(([tipoA]) => {
            const delTipo = plano.aberturas.filter(a => a.tipo === tipoA);
            return (
                <Grupo key={tipoA} clave={tipoA} cantidad={delTipo.length} abiertos={abiertos} alternar={alternar}>
        {delTipo.map(ab => {
            const L = largoSoporte(plano, ab);
            const nP = cantParedes(plano);
            const iInt = ab.interior != null ? plano.interiores.findIndex(w => w.id === ab.interior) : -1;
            const wInt = iInt >= 0 ? plano.interiores[iInt] : null;
            // Desde dónde se mide: en el contorno, la pared i empieza en la esquina que comparte con la anterior; en una
            // interior, desde la punta donde se empezó a dibujar (izquierda, derecha, arriba o abajo).
            const anterior = !wInt && (plano.cerrado || ab.pared > 0) ? ((ab.pared - 1 + nP) % nP) + 1 : null;
            const desdeTexto = wInt
                ? (Math.abs(wInt.x2 - wInt.x1) >= Math.abs(wInt.y2 - wInt.y1)
                    ? `Desde la ${wInt.x1 <= wInt.x2 ? 'izquierda' : 'derecha'}` : `Desde ${wInt.y1 <= wInt.y2 ? 'arriba' : 'abajo'}`)
                : anterior ? `Desde la pared ${anterior}` : 'Desde el comienzo';
            return (
                <div key={ab.id} className={tarjeta(sel?.t === 'abertura' && sel.id === ab.id)} data-elegido={sel?.t === 'abertura' && sel.id === ab.id} onClick={() => setSel({ t: 'abertura', id: ab.id })}>
                    <div className="flex items-center gap-2">
                        <span className="w-32">
                            <Selector value={ab.tipo} disabled={!puedeEditar} aria-label="Tipo de abertura"
                                onChange={(e) => { const t = TIPOS_ABERTURA.find(x => x[0] === e.target.value); cambiarEn('aberturas', ab.id, { tipo: t[0], ancho: Math.min(t[2], L) }); }}>
                                {TIPOS_ABERTURA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </Selector>
                        </span>
                        <span className="text-xs text-zinc-500 mr-auto">{wInt ? `interior ${iInt + 1}` : `en la pared ${ab.pared + 1}`}</span>
                        {puedeEditar && ab.tipo === 'puerta' && (
                            <button type="button" title="Cambiar hacia dónde abre" className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-zinc-100"
                                onClick={(e) => { e.stopPropagation(); setSel({ t: 'abertura', id: ab.id }); cambiarEn('aberturas', ab.id, { lado: ((ab.lado || 0) + 1) % 4 }); }}><RotateCw size={15} /></button>
                        )}
                        {puedeEditar && <button type="button" onClick={(e) => { e.stopPropagation(); quitar('aberturas', ab.id); }} className={boton} title="Borrar"><Trash2 size={15} /></button>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div><span className={label}>{desdeTexto}</span>
                            <InputMetros valor={ab.desde} disabled={!puedeEditar} onCambiar={(v) => cambiarEn('aberturas', ab.id, { desde: limitar(v ?? 0, 0, Math.max(0, L - ab.ancho)) })} /></div>
                        <div><span className={label}>Ancho</span>
                            <InputMetros valor={ab.ancho} disabled={!puedeEditar} onCambiar={(v) => v && cambiarEn('aberturas', ab.id, { ancho: Math.min(v, L), desde: Math.min(ab.desde, Math.max(0, L - Math.min(v, L))) })} /></div>
                        <div><span className={label}>Alto</span>
                            <InputMetros valor={ab.alto} disabled={!puedeEditar} placeholder={String((ALTO_ABERTURA[ab.tipo] || 210) / 100).replace('.', ',')}
                                onCambiar={(v) => cambiarEn('aberturas', ab.id, { alto: v })} /></div>
                        {ab.tipo === 'ventana' && <div><span className={label}>Desde el piso</span>
                            <InputMetros valor={ab.antepecho} disabled={!puedeEditar} placeholder={String(ANTEPECHO_VENTANA / 100).replace('.', ',')}
                                onCambiar={(v) => cambiarEn('aberturas', ab.id, { antepecho: v })} /></div>}
                    </div>
                </div>
            );
        })}
                </Grupo>
            );
        })}
        <Grupo clave="interior" cantidad={plano.interiores.length} abiertos={abiertos} alternar={alternar}>
        {plano.interiores.map((iw, i) => (
            <div key={iw.id} className={tarjeta(sel?.t === 'interior' && sel.id === iw.id)} data-elegido={sel?.t === 'interior' && sel.id === iw.id} onClick={() => setSel({ t: 'interior', id: iw.id })}>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-700 mr-auto">Pared interior {i + 1}</span>
                    {puedeEditar && <button type="button" onClick={(e) => { e.stopPropagation(); quitar('interiores', iw.id); }} className={boton} title="Borrar"><Trash2 size={15} /></button>}
                </div>
                <div className="grid grid-cols-2 gap-2 items-end">
                    <div><span className={label}>Mide</span>
                        <InputMetros valor={iw.largo} disabled={!puedeEditar} onCambiar={(v) => cambiarEn('interiores', iw.id, { largo: v })} /></div>
                    <span className="pb-2 text-xs text-zinc-400">dibujo {fmtM(distancia({ x: iw.x1, y: iw.y1 }, { x: iw.x2, y: iw.y2 }))}</span>
                </div>
            </div>
        ))}
        </Grupo>
        {TIPOS_ELEMENTO.map(([tipoE]) => {
            const delTipo = elementos.filter(e => e.tipo === tipoE);
            return (
                <Grupo key={tipoE} clave={tipoE} cantidad={delTipo.length} abiertos={abiertos} alternar={alternar}>
        {delTipo.map(el => (
            <div key={el.id} className={tarjeta(sel?.t === 'elemento' && sel.id === el.id)} data-elegido={sel?.t === 'elemento' && sel.id === el.id} onClick={() => setSel({ t: 'elemento', id: el.id })}>
                <div className="flex items-center gap-2">
                    <span className="w-32">
                        <Selector value={el.tipo} disabled={!puedeEditar} aria-label="Tipo" onChange={(e) => cambiarEn('elementos', el.id, { tipo: e.target.value })}>
                            {TIPOS_ELEMENTO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Selector>
                    </span>
                    <span className="mr-auto" />
                    {puedeEditar && <button type="button" onClick={(e) => { e.stopPropagation(); cambiarEn('elementos', el.id, { giro: (el.giro + 90) % 360 }); }} className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-zinc-100" title="Girar"><RotateCw size={15} /></button>}
                    {puedeEditar && <button type="button" onClick={(e) => { e.stopPropagation(); quitar('elementos', el.id); }} className={boton} title="Borrar"><Trash2 size={15} /></button>}
                </div>
                <input className={input} value={el.nombre} disabled={!puedeEditar} maxLength={60}
                    placeholder={el.tipo === 'ambiente' ? 'Nombre (ej: Oficina)' : 'Nombre (opcional)'}
                    onChange={(e) => cambiarEn('elementos', el.id, { nombre: e.target.value })} />
                {el.tipo === 'escalera' && (
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-zinc-500">En esta planta</span>
                        <span className="w-28">
                            <Selector value={el.baja ? 'baja' : 'sube'} disabled={!puedeEditar} aria-label="Sube o baja" onChange={(e) => cambiarEn('elementos', el.id, { baja: e.target.value === 'baja' })}>
                                <option value="sube">Sube</option>
                                <option value="baja">Baja</option>
                            </Selector>
                        </span>
                        <span className="text-[11px] text-zinc-400">Girar la invierte.</span>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                    <div><span className={label}>Ancho</span><InputMetros valor={el.w} disabled={!puedeEditar} onCambiar={(v) => v && cambiarEn('elementos', el.id, { w: v })} /></div>
                    <div><span className={label}>Largo</span><InputMetros valor={el.h} disabled={!puedeEditar} onCambiar={(v) => v && cambiarEn('elementos', el.id, { h: v })} /></div>
                </div>
            </div>
        ))}
                </Grupo>
            );
        })}
    </>;
};

// Número con unidad (amperes de la térmica). Vacío = sin dato.
const InputNumero = ({ valor, onCambiar, unidad, disabled, placeholder = '—' }) => {
    const aTexto = (v) => (v == null ? '' : String(v).replace('.', ','));
    const [txt, setTxt] = useState(aTexto(valor));
    useEffect(() => { setTxt(aTexto(valor)); }, [valor]);
    const confirmar = () => {
        const t = txt.trim();
        if (!t) { if (valor != null) onCambiar(null); return; }
        const n = Number(t.replace(',', '.'));
        if (Number.isFinite(n) && n > 0) { if (n !== valor) onCambiar(n); } else setTxt(aTexto(valor));
    };
    return (
        <div className="relative">
            <input value={txt} disabled={disabled} placeholder={placeholder} inputMode="decimal" onChange={(e) => setTxt(e.target.value)} onBlur={confirmar}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                className="w-full pl-2.5 pr-7 py-1.5 border border-zinc-200 rounded-lg text-sm text-zinc-800 bg-white outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/10 disabled:bg-zinc-50" />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400 pointer-events-none">{unidad}</span>
        </div>
    );
};

const fmt1 = (n, dec = 1) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const TONO_CARGA = {
    zinc: 'bg-zinc-50 text-zinc-700', emerald: 'bg-emerald-50 text-emerald-800', amber: 'bg-amber-50 text-amber-800', rose: 'bg-rose-50 text-rose-800',
};

// Instalaciones: tipo, nombre y medidas. Los tableros, además: la térmica general, si son trifásicos o monofásicos y
// qué máquinas del local cuelgan de cada uno, con la carga a pleno comparada con la térmica (consumoLocal.cargaTablero).
// Una máquina cuelga de un solo tablero; si es de un tablero de otra planta, se ve pero se cambia desde esa planta.
const PanelInstalaciones = ({ plano, sel, setSel, cambiar, puedeEditar, equiposLocal, plantasLocal, plantaId, abiertos, alternar }) => {
    const cambiarEl = (id, campos) => cambiar(p => ({ ...p, elementos: p.elementos.map(x => (x.id === id ? { ...x, ...campos } : x)) }));
    const quitar = (id) => { cambiar(p => ({ ...p, elementos: p.elementos.filter(x => x.id !== id) })); setSel(null); };
    const conectar = (tabId, equipoId, si) => cambiar(p => ({
        ...p, elementos: p.elementos.map(x => {
            if (x.tipo !== 'tablero') return x;
            const sin = (x.equipos || []).filter(id => id !== equipoId);
            return { ...x, equipos: x.id === tabId && si ? [...sin, equipoId] : sin };
        }),
    }));
    const lista = plano.elementos.filter(e => esInstalacion(e.tipo));
    const nombrePlanta = (id) => plantasLocal.find(x => x.PlantaId === id)?.Nombre;
    // De qué tablero cuelga cada máquina: los de esta planta (como están ahora) y los guardados en las otras.
    const deTablero = {};
    plantasLocal.filter(x => x.PlantaId !== plantaId && x.Plano).forEach(x => normalizarPlano(x.Plano).elementos
        .filter(e => e.tipo === 'tablero').forEach(t => t.equipos.forEach(id => { deTablero[id] = { nombre: t.nombre || 'Tablero', planta: x.Nombre, otra: true }; })));
    lista.filter(e => e.tipo === 'tablero').forEach(t => (t.equipos || []).forEach(id => { deTablero[id] = { nombre: t.nombre || 'Tablero', id: t.id }; }));
    const hayTableros = Object.keys(deTablero).length > 0 || lista.some(e => e.tipo === 'tablero');
    const sinTablero = equiposLocal.filter(e => e.PlantaId === plantaId && !deTablero[e.EquipoID]);
    const tarjeta = (elegido) => `rounded-xl border p-3 space-y-2 ${elegido ? 'border-brand-cyan bg-brand-cyan/5' : 'border-zinc-200'}`;
    const boton = 'p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50';
    const ordenadas = [...equiposLocal].sort((a, b) => (a.PlantaId === plantaId ? 0 : 1) - (b.PlantaId === plantaId ? 0 : 1) || String(a.Nombre).localeCompare(String(b.Nombre)));

    return <>
        {!lista.length && (
            <div className="text-sm text-zinc-600 space-y-1.5">
                <p>Con <b>Instalaciones</b> marcá los tableros eléctricos, tomas trifásicas, compresores, extractores, matafuegos y salidas de emergencia.</p>
                <p className="text-zinc-400">Los que van en la pared se apoyan solos en la más cercana, con el frente para adentro. Adelante del tablero, del matafuegos y de la salida queda marcado lo que tiene que estar libre: si una máquina lo tapa, avisa.</p>
            </div>
        )}
        {hayTableros && sinTablero.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <b>Sin tablero ({sinTablero.length}):</b> {sinTablero.map(e => e.Nombre).join(', ')}
            </div>
        )}
        {Object.keys(INSTALACIONES).map(tipoI => {
            const delTipo = lista.filter(e => e.tipo === tipoI);
            return (
                <Grupo key={tipoI} clave={tipoI} cantidad={delTipo.length} abiertos={abiertos} alternar={alternar}>
        {delTipo.map(el => {
            const def = INSTALACIONES[el.tipo];
            const elegido = sel?.t === 'elemento' && sel.id === el.id;
            const conectadas = el.tipo === 'tablero' ? equiposLocal.filter(e => (el.equipos || []).includes(e.EquipoID)) : [];
            const c = el.tipo === 'tablero' ? cargaTablero(conectadas, { fases: el.fasesTablero, termicaA: el.termicaA }) : null;
            const tono = !c || c.uso == null ? 'zinc' : c.uso > 1 ? 'rose' : c.uso > 0.8 ? 'amber' : 'emerald';
            return (
                <div key={el.id} className={tarjeta(elegido)} data-elegido={elegido} onClick={() => setSel({ t: 'elemento', id: el.id })}>
                    <div className="flex items-center gap-2">
                        <span className="w-44">
                            <Selector value={el.tipo} disabled={!puedeEditar} aria-label="Tipo de instalación"
                                onChange={(e) => {
                                    const t = e.target.value, d = INSTALACIONES[t];
                                    cambiarEl(el.id, { tipo: t, w: d.w, h: d.h, ...(t === 'tablero' ? { termicaA: el.termicaA ?? null, fasesTablero: el.fasesTablero || 'tri', equipos: el.equipos || [] } : {}) });
                                }}>
                                {Object.entries(INSTALACIONES).map(([v, d]) => <option key={v} value={v}>{d.label}</option>)}
                            </Selector>
                        </span>
                        <span className="mr-auto" />
                        {puedeEditar && <button type="button" onClick={(e) => { e.stopPropagation(); cambiarEl(el.id, { giro: (el.giro + 90) % 360 }); }} className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-zinc-100" title="Girar"><RotateCw size={15} /></button>}
                        {puedeEditar && <button type="button" onClick={(e) => { e.stopPropagation(); quitar(el.id); }} className={boton} title="Borrar"><Trash2 size={15} /></button>}
                    </div>
                    <input className={input} value={el.nombre} disabled={!puedeEditar} maxLength={60}
                        placeholder={el.tipo === 'tablero' ? 'Nombre (ej: TG, Tablero impresoras)' : 'Nombre (opcional)'}
                        onChange={(e) => cambiarEl(el.id, { nombre: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                        <div><span className={label}>Ancho</span><InputMetros valor={el.w} disabled={!puedeEditar} onCambiar={(v) => v && cambiarEl(el.id, { w: v })} /></div>
                        <div><span className={label}>Fondo</span><InputMetros valor={el.h} disabled={!puedeEditar} onCambiar={(v) => v && cambiarEl(el.id, { h: v })} /></div>
                    </div>
                    {def.libre > 0 && <p className="text-[11px] text-zinc-400">Adelante tienen que quedar {fmtM(def.libre)} libres (la zona punteada).</p>}
                    {el.tipo === 'tablero' && <>
                        <div className="grid grid-cols-2 gap-2">
                            <div><span className={label}>Térmica general</span>
                                <InputNumero valor={el.termicaA} unidad="A" disabled={!puedeEditar} placeholder="Ej: 63" onCambiar={(v) => cambiarEl(el.id, { termicaA: v })} /></div>
                            <div><span className={label}>Fases</span>
                                <Selector value={el.fasesTablero} disabled={!puedeEditar} aria-label="Fases del tablero" onChange={(e) => cambiarEl(el.id, { fasesTablero: e.target.value })}>
                                    <option value="tri">Trifásico</option>
                                    <option value="mono">Monofásico</option>
                                </Selector></div>
                        </div>
                        <div className={`rounded-lg px-3 py-2 text-xs space-y-0.5 ${TONO_CARGA[tono]}`}>
                            <div className="text-sm font-black">
                                {fmt1(c.corriente)} A{el.fasesTablero === 'tri' ? ' por fase' : ''}{el.termicaA ? ` de ${fmt1(el.termicaA, 0)} A (${Math.round(c.uso * 100)} %)` : ''}
                            </div>
                            <div>{conectadas.length} máquina{conectadas.length === 1 ? '' : 's'} · {fmt1(c.potNom)} kW a pleno · pico {fmt1(c.potMax)} kW</div>
                            {c.uso > 1 && <div className="font-bold">Se pasa de la térmica: con todas a pleno, salta.</div>}
                            {c.uso != null && c.uso > 0.8 && c.uso <= 1 && <div className="font-bold">Cerca del límite de la térmica.</div>}
                            {!el.termicaA && conectadas.length > 0 && <div>Cargá la térmica para compararla.</div>}
                            {c.sinPotencia.length > 0 && <div>Sin potencia en la ficha (no suman): {c.sinPotencia.map(e => e.Nombre).join(', ')}.</div>}
                            {c.triEnMono.length > 0 && <div className="font-bold">Trifásicas en un tablero monofásico: {c.triEnMono.map(e => e.Nombre).join(', ')}.</div>}
                            {el.fasesTablero === 'tri' && conectadas.length > 0 && <div className="opacity-75">Las monofásicas se suponen repartidas parejas entre las fases.</div>}
                        </div>
                        <div>
                            <span className={label}>Máquinas que cuelgan de este tablero</span>
                            <div className="max-h-56 overflow-y-auto space-y-0.5 -mx-1 px-1">
                                {ordenadas.map(e => {
                                    const de = deTablero[e.EquipoID];
                                    const marcada = (el.equipos || []).includes(e.EquipoID);
                                    const bloqueada = de?.otra;
                                    const otraPlanta = e.PlantaId !== plantaId ? (nombrePlanta(e.PlantaId) || 'sin planta') : null;
                                    return (
                                        <label key={e.EquipoID} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${bloqueada ? 'opacity-50' : 'hover:bg-zinc-50 cursor-pointer'}`}
                                            onClick={(ev) => ev.stopPropagation()}>
                                            <input type="checkbox" className="w-4 h-4 accent-brand-cyan" checked={marcada} disabled={!puedeEditar || bloqueada}
                                                onChange={(ev) => conectar(el.id, e.EquipoID, ev.target.checked)} />
                                            <span className="min-w-0 flex-1 truncate text-zinc-700">{e.Nombre}</span>
                                            <span className="shrink-0 text-[11px] text-zinc-400">
                                                {[otraPlanta, de && !marcada ? `en ${de.nombre}${de.planta ? ` (${de.planta})` : ''}` : null].filter(Boolean).join(' · ')}
                                            </span>
                                        </label>
                                    );
                                })}
                                {!ordenadas.length && <p className="text-xs text-zinc-400">El local no tiene máquinas.</p>}
                            </div>
                        </div>
                    </>}
                </div>
            );
        })}
                </Grupo>
            );
        })}
    </>;
};

export default PlanoEditor;
