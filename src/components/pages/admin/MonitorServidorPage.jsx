import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import {
    Activity, Cpu, MemoryStick, HardDrive, Database, Gauge, Server, Clock, Volume2, VolumeX,
    Maximize2, Minimize2, AlertTriangle, CheckCircle2, XCircle, Archive, WifiOff, Cloud, ExternalLink,
    Plug, Network, RotateCcw, Moon, Sun, ShieldAlert, Route, Power, Scissors, OctagonX, Boxes, Bug, Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../services/api';
import useConfirmar from '../../ui/useConfirmar';

// Monitor del servidor en tiempo real (23/10/2026, después de las caídas por la red de Hostinger en BR-CAM).
// Pensado para quedar abierto en una pantalla. Pide GET /api/sysadmin/monitor cada 5 s (la primera vez con las
// últimas 2 h de historia) y el navegador hace de observador de afuera: si el servidor deja de contestar, lo marca
// con la hora desde la que no responde, aunque adentro no quede ningún log. El estado de Hostinger se pide DIRECTO
// a su página de estado (permite CORS), así se ve aunque nuestro servidor esté caído.
// Además: integraciones de afuera, versión del front por navegador, disco y red, disponibilidad, reinicios, backups,
// procesos pesados, y gráficos de 24 h / 7 días sacados de la historia que el servidor guarda en disco.
// También: servicios del servidor (nginx, tizadapro, el contenedor de SQL), errores del backend de la última hora
// agrupados y la red hacia afuera (ping a internet y a la oficina, con latencia y pérdida de paquetes).
// Acciones (con confirmación; quedan en la auditoría): terminar un python desbocado, cortar una sesión de SQL que
// bloquea o tiene una transacción colgada, y reiniciar el backend (pide la contraseña de administración).
// Tiene su propio modo oscuro (switch en el recuadro del estado, guardado en el navegador): se arma con un <style>
// que reescribe, solo dentro de .monitor-oscuro, los colores de Tailwind que usa esta pantalla.
// Estética nueva: tarjetas blancas zinc, íconos brand-cyan sin fondo, color solo para el estado.

const CARD = 'bg-white rounded-2xl border border-zinc-200';
// En pantalla ancha (4 columnas) la grilla de abajo ocupa todo el alto que queda hasta el borde: en cada columna, la
// tarjeta «que crece» se estira hasta abajo y muestra todas las filas que entran (con scroll si hay más). Su contenido
// va en absoluto, así no empuja la altura de la página. En el celular y la tablet, flujo normal y hasta 6 filas.
const CRECE = `${CARD} overflow-hidden flex flex-col 2xl:flex-1 2xl:min-h-[160px]`;
const CUERPO = '2xl:absolute 2xl:inset-0 2xl:overflow-y-auto monitor-scroll';
const HASTA_6 = 'max-2xl:[&>*:nth-child(n+7)]:hidden';
const ROTULO = 'text-[11px] font-black uppercase tracking-widest text-zinc-400';
const CADA_MS = 5000;
const LATIDOS = 360;                          // 30 min de chequeos desde el navegador
const STATUS_HOSTINGER = 'https://statuspage.hostinger.com/api/v2/summary.json';
const PAGINA_HOSTINGER = 'https://statuspage.hostinger.com/';
const REGEX_BRASIL = /BR-CAM|Campinas|Brazil|Brasil|BR Datacenter/i;
const RANGOS = [['2h', 'Últimas 2 h'], ['24h', 'Últimas 24 h'], ['7d', 'Últimos 7 días']];

const COLOR = {
    ok: { texto: 'text-emerald-700', fondo: 'bg-emerald-50', borde: 'border-emerald-200', trazo: '#059669', punto: 'bg-emerald-500' },
    atencion: { texto: 'text-amber-700', fondo: 'bg-amber-50', borde: 'border-amber-200', trazo: '#d97706', punto: 'bg-amber-500' },
    mal: { texto: 'text-brand-magenta', fondo: 'bg-brand-magenta/5', borde: 'border-brand-magenta/30', trazo: '#BD0C7E', punto: 'bg-brand-magenta' },
    neutro: { texto: 'text-zinc-900', fondo: 'bg-white', borde: 'border-zinc-200', trazo: '#006E97', punto: 'bg-zinc-300' },
};

// Lo que guarda el navegador entre recargas (solo conveniencia: si no hay, arranca vacío)
const leerLocal = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

const hora = (t) => (t ? new Date(t).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const horaCorta = (t) => (t ? new Date(t).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' }) : '—');
const duracion = (seg) => {
    if (seg == null) return '—';
    const s = Math.max(0, Math.round(seg));
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
    return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
};
const gb = (mb) => (mb == null ? '—' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

// Modo oscuro de esta pantalla: reescribe los colores de Tailwind que usa, solo adentro de .monitor-oscuro
const TemaOscuro = createContext(false);
const CSS_OSCURO = `
.monitor-scroll { scrollbar-width: thin; scrollbar-color: #d4d4d8 transparent; }
.monitor-oscuro .monitor-scroll { scrollbar-color: #3f3f46 transparent; }
.monitor-oscuro { background-color: #09090b; color-scheme: dark; }
.monitor-oscuro .bg-white { background-color: #18181b; }
.monitor-oscuro .bg-zinc-50 { background-color: #1f1f23; }
.monitor-oscuro .bg-zinc-100 { background-color: #27272a; }
.monitor-oscuro .border-zinc-200 { border-color: #34343a; }
.monitor-oscuro .border-zinc-100, .monitor-oscuro .divide-zinc-100 > :not([hidden]) ~ :not([hidden]) { border-color: #27272a; }
.monitor-oscuro .text-zinc-900 { color: #fafafa; }
.monitor-oscuro .text-zinc-800 { color: #f4f4f5; }
.monitor-oscuro .text-zinc-700 { color: #e4e4e7; }
.monitor-oscuro .text-zinc-600 { color: #d4d4d8; }
.monitor-oscuro .text-zinc-500 { color: #b4b4bc; }
.monitor-oscuro .text-zinc-400 { color: #8e8e97; }
.monitor-oscuro .text-zinc-300 { color: #5f5f68; }
.monitor-oscuro .bg-zinc-300 { background-color: #52525b; }
.monitor-oscuro .hover\:bg-zinc-50:hover { background-color: #232327; }
.monitor-oscuro .hover\:bg-zinc-100:hover { background-color: #2a2a2f; }
.monitor-oscuro .hover\:text-zinc-800:hover { color: #f4f4f5; }
.monitor-oscuro .bg-zinc-900 { background-color: #fafafa; }
.monitor-oscuro .bg-zinc-900.text-white, .monitor-oscuro .bg-zinc-900 .text-white { color: #09090b; }
.monitor-oscuro .border-zinc-900 { border-color: #fafafa; }
.monitor-oscuro .bg-emerald-50 { background-color: rgba(16, 185, 129, .12); }
.monitor-oscuro .border-emerald-200 { border-color: rgba(16, 185, 129, .35); }
.monitor-oscuro .text-emerald-700 { color: #34d399; }
.monitor-oscuro .bg-amber-50 { background-color: rgba(245, 158, 11, .12); }
.monitor-oscuro .border-amber-200 { border-color: rgba(245, 158, 11, .35); }
.monitor-oscuro .text-amber-700 { color: #fbbf24; }
.monitor-oscuro .text-brand-magenta { color: #ec4fa9; }
.monitor-oscuro .bg-brand-magenta\/5 { background-color: rgba(189, 12, 126, .16); }
.monitor-oscuro .bg-brand-magenta\/10 { background-color: rgba(189, 12, 126, .22); }
.monitor-oscuro .border-brand-magenta\/20, .monitor-oscuro .border-brand-magenta\/30 { border-color: rgba(236, 79, 169, .4); }
.monitor-oscuro .text-brand-cyan, .monitor-oscuro .hover\:text-brand-cyan:hover { color: #3fb5e0; }
.monitor-oscuro .bg-brand-cyan\/10 { background-color: rgba(0, 110, 151, .28); }
.monitor-oscuro .border-brand-cyan\/20 { border-color: rgba(63, 181, 224, .38); }
`;

// ─── Piezas ────────────────────────────────────────────────────────────────────────────────────────────────────
// Marcas sobre los gráficos: una línea vertical por evento, en la posición de su hora
const COLOR_MARCA = { caida: '#BD0C7E', oom: '#BD0C7E', deploy: '#006E97', reinicio: '#a1a1aa' };
const RAYA_MARCA = { oom: '3 2', deploy: '2 2' };

function Sparkline({ datos = [], max, color = '#006E97', alto = 40, marcas = [] }) {
    const oscuro = useContext(TemaOscuro);
    if (oscuro && color === '#006E97') color = '#3fb5e0';
    const vals = datos || [];
    if (vals.filter(v => v != null).length < 2) return <div style={{ height: alto }} />;
    const tope = max ?? Math.max(1, ...vals.filter(v => v != null)) * 1.15;
    const ancho = vals.length - 1;
    const tramos = [];
    let actual = [];
    vals.forEach((v, i) => {
        if (v == null) { if (actual.length) tramos.push(actual); actual = []; return; }
        actual.push(`${i},${(alto - (Math.min(v, tope) / tope) * (alto - 2) - 1).toFixed(1)}`);
    });
    if (actual.length) tramos.push(actual);
    return (
        <svg viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none" className="w-full block" style={{ height: alto }} aria-hidden="true">
            {marcas.map((m, i) => (
                <line key={`m${i}`} x1={m.f * ancho} x2={m.f * ancho} y1={0} y2={alto} stroke={oscuro && m.tipo === 'deploy' ? '#3fb5e0' : COLOR_MARCA[m.tipo]}
                    strokeWidth="1.2" strokeDasharray={RAYA_MARCA[m.tipo]} vectorEffect="non-scaling-stroke" opacity="0.85" />
            ))}
            {tramos.map((t, i) => (
                <g key={i}>
                    {t.length > 1 && <polygon points={`${t[0].split(',')[0]},${alto} ${t.join(' ')} ${t[t.length - 1].split(',')[0]},${alto}`} fill={color} opacity="0.08" />}
                    <polyline points={t.join(' ')} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </g>
            ))}
        </svg>
    );
}

function Metrica({ icono: Icono, titulo, valor, sub, nivel = 'neutro', datos, max, marcas }) {
    const c = COLOR[nivel] || COLOR.neutro;
    return (
        <div className={`${CARD} ${nivel === 'neutro' || nivel === 'ok' ? '' : c.borde} px-4 py-3 flex flex-col gap-0.5 min-w-0`}>
            <div className="flex items-center gap-1.5">
                <Icono size={14} className="text-brand-cyan shrink-0" />
                <span className={`${ROTULO} truncate`}>{titulo}</span>
            </div>
            <div className={`text-2xl 2xl:text-3xl font-black tabular-nums leading-tight ${nivel === 'neutro' || nivel === 'ok' ? 'text-zinc-900' : c.texto}`}>{valor}</div>
            <div className="text-xs text-zinc-500 truncate min-h-[16px]">{sub}</div>
            {datos && <div className="mt-1"><Sparkline datos={datos} max={max} alto={30} marcas={marcas} color={nivel === 'neutro' || nivel === 'ok' ? '#006E97' : c.trazo} /></div>}
        </div>
    );
}

function Fila({ etiqueta, valor, nivel }) {
    const c = COLOR[nivel] || null;
    return (
        <div className="flex items-center justify-between gap-3 py-1.5 border-b border-zinc-100 last:border-0 text-sm">
            <span className="text-zinc-500">{etiqueta}</span>
            <span className={`font-bold tabular-nums text-right ${c ? c.texto : 'text-zinc-800'}`}>{valor}</span>
        </div>
    );
}

const NIVEL_INTEGRACION = {
    ok: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'ok'],
    atencion: ['bg-amber-50 text-amber-700 border-amber-200', 'con fallas'],
    mal: ['bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20', 'no anda'],
    info: ['bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20', 'info'],
    'sin-datos': ['bg-zinc-100 text-zinc-500 border-zinc-200', 'sin datos'],
    apagado: ['bg-zinc-100 text-zinc-500 border-zinc-200', 'apagado'],
};

const PESTANAS = [['integraciones', 'Integraciones', Plug], ['seguridad', 'Seguridad', ShieldAlert], ['servidor', 'Servidor', Server]];

// Pitido corto para cuando el estado empeora (solo con «Sonido» prendido)
function pitar(veces = 2) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        for (let i = 0; i < veces; i++) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.frequency.value = 880;
            o.connect(g); g.connect(ctx.destination);
            const t = ctx.currentTime + i * 0.35;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
            o.start(t); o.stop(t + 0.3);
        }
    } catch { /* sin audio */ }
}

// Cuántos latidos entran a lo ancho: en el celular, los últimos 6 min; en una tablet, 15; en adelante, los 30
const celdasPorAncho = () => (window.innerWidth < 640 ? 72 : window.innerWidth < 1024 ? 180 : LATIDOS);
function useCeldas() {
    const [n, setN] = useState(celdasPorAncho);
    useEffect(() => {
        const alCambiar = () => setN(celdasPorAncho());
        window.addEventListener('resize', alCambiar);
        return () => window.removeEventListener('resize', alCambiar);
    }, []);
    return n;
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────────────────────────────────────
export default function MonitorServidorPage() {
    const celdas = useCeldas();
    const [snap, setSnap] = useState(null);
    const [hist, setHist] = useState(null);
    const [latidos, setLatidos] = useState(() => leerLocal('monitor_latidos', []));
    const [conexion, setConexion] = useState({ estado: 'iniciando', desde: null, fallas: 0, ultimoOk: null, ms: null });
    const [eventosLocales, setEventosLocales] = useState(() => leerLocal('monitor_eventos', []));
    const [hostinger, setHostinger] = useState(null);
    const [sonido, setSonido] = useState(() => leerLocal('monitor_sonido', false));
    const [pantallaCompleta, setPantallaCompleta] = useState(false);
    const [ahora, setAhora] = useState(Date.now());
    const [rango, setRango] = useState(() => leerLocal('monitor_rango', '2h'));
    const [histLarga, setHistLarga] = useState(null);
    // La pestaña Jobs se sacó el 26/10: si el navegador tenía guardada esa (u otra que ya no existe), arranca en Integraciones
    const [pestana, setPestana] = useState(() => { const p = leerLocal('monitor_pestana', 'integraciones'); return PESTANAS.some(x => x[0] === p) ? p : 'integraciones'; });
    const [oscuro, setOscuro] = useState(() => leerLocal('monitor_oscuro', false));
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const [reinicio, setReinicio] = useState(null);           // { clave, enviando, error } mientras la ventana está abierta
    const contenedor = useRef(null);
    const conexionRef = useRef(conexion);
    const pedirHistoria = useRef(true);
    const uptimeAnterior = useRef(null);
    const nivelAnterior = useRef('ok');

    conexionRef.current = conexion;

    const anotarLatido = useCallback((l) => {
        setLatidos(prev => {
            const nuevo = [...prev, l].slice(-LATIDOS);
            guardarLocal('monitor_latidos', nuevo);
            return nuevo;
        });
    }, []);

    const anotarEvento = useCallback((e) => {
        setEventosLocales(prev => {
            const nuevo = [e, ...prev].slice(0, 30);
            guardarLocal('monitor_eventos', nuevo);
            return nuevo;
        });
    }, []);

    // Muestra del servidor cada 5 s
    useEffect(() => {
        let vivo = true;
        let timer;
        const ciclo = async () => {
            const t0 = performance.now();
            const t = Date.now();
            try {
                const { data } = await api.get('/sysadmin/monitor', { params: pedirHistoria.current ? { historia: 1 } : {}, timeout: 8000 });
                if (!vivo) return;
                const ms = Math.round(performance.now() - t0);
                const previa = conexionRef.current;
                if (previa.estado === 'caido' || previa.estado === 'backend') {
                    const seg = (t - previa.desde) / 1000;
                    anotarEvento({
                        ts: previa.desde, nivel: 'mal',
                        texto: `${previa.estado === 'backend' ? 'El backend no respondió' : 'El servidor no respondió'} de ${horaCorta(previa.desde)} a ${horaCorta(t)} (${duracion(seg)})`,
                    });
                }
                setConexion({ estado: 'ok', desde: null, fallas: 0, ultimoOk: t, ms });
                anotarLatido({ t, ok: true, ms });
                if (data?.listo) {
                    // El backend se reinició: su historia arrancó de cero
                    if (uptimeAnterior.current != null && data.node.uptimeSeg < uptimeAnterior.current) pedirHistoria.current = true;
                    uptimeAnterior.current = data.node.uptimeSeg;
                    if (data.historia) {
                        setHist(data.historia);
                        pedirHistoria.current = false;
                    } else {
                        setHist(prev => {
                            if (!prev) return prev;
                            const ts = Date.parse(data.ts);
                            if (prev.ts.length && prev.ts[prev.ts.length - 1] >= ts) return prev;
                            const agregar = (arr, v) => [...arr, v].slice(-1440);
                            return {
                                ts: agregar(prev.ts, ts),
                                cpu: agregar(prev.cpu, data.host.cpu.pct),
                                memPct: agregar(prev.memPct, Math.round((1 - data.host.mem.disponibleMB / data.host.mem.totalMB) * 1000) / 10),
                                swapPct: agregar(prev.swapPct, data.host.swap ? Math.round(data.host.swap.usadaMB / data.host.swap.totalMB * 1000) / 10 : null),
                                dbMs: agregar(prev.dbMs, data.db.ms),
                                reqMin: agregar(prev.reqMin, data.http.porMin),
                                err5xx: agregar(prev.err5xx, data.http.errores5xxPorMin),
                                lag: agregar(prev.lag, data.node.lagMs),
                                iowait: agregar(prev.iowait || [], data.host.io?.iowaitPct ?? null),
                                redEntra: agregar(prev.redEntra || [], data.host.red?.entraMbps ?? null),
                                redSale: agregar(prev.redSale || [], data.host.red?.saleMbps ?? null),
                                pingMs: agregar(prev.pingMs || [], data.red?.ms ?? null),
                                pingPerdida: agregar(prev.pingPerdida || [], data.red?.perdida ?? null),
                            };
                        });
                    }
                    setSnap(data);
                }
            } catch (e) {
                if (!vivo) return;
                const status = e.response?.status;
                const tipo = status && [502, 503, 504].includes(status) ? 'backend' : status ? 'error' : 'caido';
                setConexion(prev => {
                    const fallas = prev.fallas + 1;
                    // Un error suelto no alcanza: a la segunda falla seguida se marca como caído
                    if (tipo === 'error') return { ...prev, fallas };
                    if (fallas < 2) return { ...prev, fallas };
                    return { estado: tipo, desde: prev.desde || prev.ultimoOk || t, fallas, ultimoOk: prev.ultimoOk, ms: null };
                });
                anotarLatido({ t, ok: false, ms: null, status: status || null });
            }
            if (vivo) timer = setTimeout(ciclo, CADA_MS);
        };
        ciclo();
        return () => { vivo = false; clearTimeout(timer); };
    }, [anotarLatido, anotarEvento]);

    // Estado de Hostinger, directo desde el navegador, cada 60 s
    useEffect(() => {
        let vivo = true;
        const pedir = async () => {
            try {
                const r = await fetch(STATUS_HOSTINGER, { cache: 'no-store' });
                const s = await r.json();
                if (!vivo) return;
                const comp = (s.components || []).find(c => /^BR Datacenter$/i.test(c.name));
                const incidentes = (s.incidents || []).filter(i =>
                    REGEX_BRASIL.test(`${i.name} ${i.incident_updates?.[0]?.body || ''}`) || (i.components || []).some(c => c.id === comp?.id));
                const mantenimientos = (s.scheduled_maintenances || []).filter(m => REGEX_BRASIL.test(`${m.name} ${m.incident_updates?.[0]?.body || ''}`));
                setHostinger({ ok: true, componente: comp?.status || null, incidentes, mantenimientos, consultado: Date.now() });
            } catch {
                if (vivo) setHostinger(prev => ({ ...(prev || {}), ok: false, consultado: Date.now() }));
            }
        };
        pedir();
        const id = setInterval(pedir, 60000);
        return () => { vivo = false; clearInterval(id); };
    }, []);

    // Gráficos de 24 h / 7 días: la historia que el servidor guarda en disco, cada 60 s
    useEffect(() => {
        if (rango === '2h') return undefined;
        let vivo = true;
        const pedir = async () => {
            try {
                const { data } = await api.get('/sysadmin/monitor/historia', { params: { horas: rango === '7d' ? 168 : 24 }, timeout: 15000 });
                if (vivo) setHistLarga({ rango, ...data });
            } catch { /* se reintenta en la próxima vuelta */ }
        };
        pedir();
        const id = setInterval(pedir, 60000);
        return () => { vivo = false; clearInterval(id); };
    }, [rango]);
    const elegirRango = (k) => { setRango(k); guardarLocal('monitor_rango', k); };
    const elegirPestana = (k) => { setPestana(k); guardarLocal('monitor_pestana', k); };
    // ── Acciones ──────────────────────────────────────────────────────────────────────────────────────────
    const terminarProceso = async (p) => {
        const ok = await confirmar({
            titulo: `¿Terminar ${p.detalle || p.nombre}?`,
            texto: `Usa ${gb(p.rssMB)} de RAM. Lo que estaba procesando se pierde (si es una capa de blanco o una matriz, queda el aviso en la orden). Queda en la auditoría.`,
            confirmar: 'Terminar', peligro: true,
        });
        if (!ok) return;
        try { const { data } = await api.post('/sysadmin/monitor/terminar-proceso', { pid: p.pid }); toast.success(data.mensaje); }
        catch (e) { toast.error(e.response?.data?.error || e.message); }
    };
    const cortarSesion = async (x) => {
        const ok = await confirmar({
            titulo: `¿Cortar la sesión ${x.sesion} de SQL?`,
            texto: `${x.programa || x.login || 'Sin programa'}${x.transacciones ? ` · ${x.transacciones} transacción(es) abierta(s): se deshacen` : ''}${x.bloqueaA ? ` · tiene trabadas ${x.bloqueaA} consulta(s)` : ''}. Queda en la auditoría.`,
            confirmar: 'Cortar', peligro: true,
        });
        if (!ok) return;
        try { const { data } = await api.post('/sysadmin/monitor/cortar-sesion', { sesion: x.sesion }); toast.success(data.mensaje); }
        catch (e) { toast.error(e.response?.data?.error || e.message); }
    };
    const reiniciarBackend = async () => {
        if (!reinicio?.clave) return setReinicio(r => ({ ...r, error: 'Falta la contraseña.' }));
        setReinicio(r => ({ ...r, enviando: true, error: null }));
        try {
            await api.post('/sysadmin/restart', { password: reinicio.clave });
            setReinicio(null);
            toast.success('Reiniciando el backend: vuelve en unos segundos.');
        } catch (e) {
            setReinicio(r => ({ ...r, enviando: false, error: e.response?.data?.error || e.message }));
        }
    };
    const alternarOscuro = () => setOscuro(v => { guardarLocal('monitor_oscuro', !v); return !v; });

    // Reloj y «hace X s»
    useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(id); }, []);

    // Pantalla completa y que la pantalla no se apague mientras está a la vista
    useEffect(() => {
        const alCambiar = () => setPantallaCompleta(document.fullscreenElement === contenedor.current);
        document.addEventListener('fullscreenchange', alCambiar);
        let bloqueo = null;
        const pedirBloqueo = async () => {
            try { if ('wakeLock' in navigator && document.visibilityState === 'visible') bloqueo = await navigator.wakeLock.request('screen'); } catch { /* no soportado */ }
        };
        pedirBloqueo();
        document.addEventListener('visibilitychange', pedirBloqueo);
        return () => {
            document.removeEventListener('fullscreenchange', alCambiar);
            document.removeEventListener('visibilitychange', pedirBloqueo);
            try { bloqueo?.release(); } catch { /* ya liberado */ }
        };
    }, []);

    const alternarPantallaCompleta = () => {
        try {
            if (document.fullscreenElement) document.exitFullscreen();
            else contenedor.current?.requestFullscreen();
        } catch { /* no soportado */ }
    };
    const alternarSonido = () => {
        setSonido(v => { guardarLocal('monitor_sonido', !v); if (!v) pitar(1); return !v; });
    };

    // ─── Nivel general ────────────────────────────────────────────────────────────────────────────────────────
    const alertas = snap?.alertas || [];
    const caido = conexion.estado === 'caido' || conexion.estado === 'backend';
    const nivel = caido ? 'caido' : alertas.some(a => a.nivel === 'mal') ? 'mal' : alertas.length ? 'atencion' : snap ? 'ok' : 'iniciando';
    useEffect(() => {
        const peor = { iniciando: 0, ok: 0, atencion: 1, mal: 2, caido: 3 };
        if (sonido && peor[nivel] > peor[nivelAnterior.current] && peor[nivel] >= 2) pitar(3);
        nivelAnterior.current = nivel;
    }, [nivel, sonido]);

    const incidenteBR = hostinger?.incidentes?.[0];
    const hace = snap ? Math.round((ahora - (conexion.ultimoOk || ahora)) / 1000) : null;

    const banner = {
        caido: {
            c: COLOR.mal, icono: WifiOff,
            titulo: conexion.estado === 'backend' ? 'EL BACKEND NO RESPONDE' : 'EL SERVIDOR NO RESPONDE',
            sub: `Sin respuesta desde las ${horaCorta(conexion.desde)} · hace ${duracion((ahora - conexion.desde) / 1000)}${conexion.estado === 'backend' ? ' · nginx contesta, la app no' : ''}${snap ? ` · lo de abajo es de la última muestra (${hora(snap.ts)})` : ''}`,
        },
        mal: { c: COLOR.mal, icono: XCircle, titulo: 'PROBLEMA', sub: alertas.filter(a => a.nivel === 'mal').map(a => a.texto).join(' · ') },
        atencion: { c: COLOR.atencion, icono: AlertTriangle, titulo: `ATENCIÓN · ${alertas.length} aviso${alertas.length !== 1 ? 's' : ''}`, sub: alertas.map(a => a.texto).join(' · ') },
        ok: { c: COLOR.ok, icono: CheckCircle2, titulo: 'TODO EN ORDEN', sub: 'El servidor, la base y los procesos están dentro de lo normal.' },
        iniciando: { c: COLOR.neutro, icono: Activity, titulo: 'CONECTANDO…', sub: 'Esperando la primera muestra del servidor.' },
    }[nivel];

    // ─── Niveles de cada métrica ──────────────────────────────────────────────────────────────────────────────
    const h = snap?.host;
    const memLibrePct = h ? h.mem.disponibleMB / h.mem.totalMB : null;
    const swapPct = h?.swap ? h.swap.usadaMB / h.swap.totalMB : null;
    const nivelCpu = h?.cpu.pct >= 90 ? 'mal' : h?.cpu.pct >= 75 ? 'atencion' : 'neutro';
    const nivelRam = memLibrePct == null ? 'neutro' : memLibrePct < 0.1 ? 'mal' : memLibrePct < 0.2 ? 'atencion' : 'neutro';
    const nivelSwap = swapPct > 0.85 ? 'atencion' : 'neutro';
    const nivelDb = !snap ? 'neutro' : !snap.db.ok ? 'mal' : snap.db.ms > 500 ? 'atencion' : 'neutro';
    const series = rango === '2h' ? hist : (histLarga?.rango === rango ? histLarga.historia : null);
    // Marcas de los gráficos dentro del período que se ve (reinicios, deploys, OOM y, en 24 h / 7 días, caídas)
    const marcasGraf = (() => {
        if (!series?.ts?.length) return [];
        const t0 = series.ts[0];
        const t1 = series.ts[series.ts.length - 1];
        if (t1 <= t0) return [];
        const lista = [...(snap?.marcas || []), ...(rango !== '2h' && histLarga?.huecos ? histLarga.huecos.map(x => ({ t: Date.parse(x.desde), tipo: 'caida' })) : [])];
        return lista.filter(m => m.t >= t0 && m.t <= t1).map(m => ({ f: (m.t - t0) / (t1 - t0), tipo: m.tipo }));
    })();
    const bloqueos = snap?.bloqueos;
    const seg = snap?.seguridad;
    const red = snap?.red;

    // Cuántas cosas para mirar tiene cada pestaña (el número que se ve en la pestaña)
    const paraMirar = {
        seguridad: (seg?.logins?.porIp || []).filter(x => x.cantidad >= 15).length,
        integraciones: (snap?.integraciones || []).filter(i => i.nivel === 'mal' || i.nivel === 'atencion').length,
        servidor: !snap ? 0 : [
            (snap.pm2 || []).some(x => x.estado !== 'online'),
            snap.front?.navegadoresViejos > 0,
            snap.http.erroresFrontPorMin >= 20,
            snap.ssl?.dias < 15,
            snap.avisos && !snap.avisos.mails && !snap.avisos.whatsapp,
        ].filter(Boolean).length,
    };
    const fechaCorta = (iso) => new Date(iso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const nivelLag = snap?.node.lagMs > 2000 ? 'mal' : snap?.node.lagMs > 500 ? 'atencion' : 'neutro';
    const nivelIo = h?.io?.iowaitPct >= 50 ? 'mal' : h?.io?.iowaitPct >= 25 ? 'atencion' : 'neutro';
    const ext = snap?.externo;
    const disp = snap?.disponibilidad;
    const diasConDatos = (disp || []).filter(d => !d.sinDatos);
    const dispPromedio = diasConDatos.length ? Math.round(diasConDatos.reduce((t, d) => t + d.pct, 0) / diasConDatos.length * 100) / 100 : null;
    const ultimaCaida = (disp || []).flatMap(d => d.caidas || []).sort((a, b) => Date.parse(b.desde) - Date.parse(a.desde))[0];
    const diaCorto = (f) => new Date(`${f}T12:00:00-03:00`).toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric' });

    const largos = rango !== '2h' && histLarga?.rango === rango
        ? [...(histLarga.eventos || []), ...(histLarga.huecos || []).map(x => ({ ts: x.desde, nivel: 'mal', texto: `Sin muestras de ${horaCorta(x.desde)} a ${horaCorta(x.hasta)} (${duracion(x.minutos * 60)}): backend o servidor caído` }))]
        : [];
    const vistos = new Set();
    const eventos = [...(snap?.eventos || []), ...eventosLocales, ...largos]
        .filter(e => { const k = `${e.ts}|${e.texto}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
        .slice(0, 40);

    return (
        <TemaOscuro.Provider value={oscuro}>
        <style>{CSS_OSCURO}</style>
        <div ref={contenedor} className={`px-3 sm:px-6 py-5 min-h-full flex flex-col text-zinc-700 ${oscuro ? 'monitor-oscuro' : 'bg-zinc-50'} ${pantallaCompleta ? 'overflow-auto h-screen' : ''}`}>
            {/* Estado general */}
            <div className={`rounded-2xl border ${banner.c.borde} ${banner.c.fondo} px-5 py-3 mb-3 flex flex-wrap items-center gap-x-6 gap-y-3`}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <banner.icono size={30} className={`${banner.c.texto} shrink-0`} />
                    <div className="min-w-0">
                        <div className={`text-2xl font-black tracking-tight leading-tight ${banner.c.texto}`}>{banner.titulo}</div>
                        <div className="text-sm text-zinc-600 mt-0.5 break-words">{banner.sub}</div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div className="flex items-baseline gap-2 whitespace-nowrap">
                        <span className={ROTULO}>Respuesta desde acá:</span>
                        <span className="text-xl font-black tabular-nums text-zinc-900">{conexion.ms != null ? `${conexion.ms} ms` : '—'}</span>
                    </div>
                    <div className="flex items-baseline gap-2 whitespace-nowrap">
                        <span className={ROTULO}>Usuarios conectados:</span>
                        <span className="text-xl font-black tabular-nums text-zinc-900">{snap?.sockets ?? '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-2xl font-black tabular-nums text-zinc-900 mr-1 whitespace-nowrap">{new Date(ahora).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        <button type="button" onClick={alternarOscuro} title={oscuro ? 'Pasar a modo claro' : 'Pasar a modo oscuro'} aria-pressed={oscuro}
                            className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 transition-colors">
                            {oscuro ? <Sun size={17} className="text-brand-cyan" /> : <Moon size={17} className="text-brand-cyan" />}
                        </button>
                        <button type="button" onClick={alternarSonido} title={sonido ? 'Sonido prendido: pita cuando algo se cae' : 'Prender el sonido de alerta'}
                            className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 transition-colors">
                            {sonido ? <Volume2 size={17} className="text-brand-cyan" /> : <VolumeX size={17} />}
                        </button>
                        <button type="button" onClick={alternarPantallaCompleta} title={pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
                            className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 transition-colors">
                            {pantallaCompleta ? <Minimize2 size={17} /> : <Maximize2 size={17} className="text-brand-cyan" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Conexión (cada chequeo del navegador) y estado de Hostinger en Brasil */}
            <div className={`${CARD} px-4 py-2.5 mb-3`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-sm">
                    <span className={ROTULO}>Conexión · últimos {Math.round(celdas * CADA_MS / 60000)} min</span>
                    <span className="text-xs text-zinc-400 tabular-nums">
                        {latidos.length ? `${Math.round(latidos.filter(l => l.ok).length * 100 / latidos.length)} % de respuestas` : ''}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs sm:ml-auto" title="La PC de la oficina chequea el servidor cada minuto desde afuera de Hostinger">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${!ext?.configurado || !ext.ultimo ? 'bg-zinc-300' : ext.haceSeg > 300 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                        <span className="font-black text-zinc-800">Monitor externo</span>
                        <span className={!ext?.ultimo ? 'text-zinc-400' : ext.haceSeg > 300 ? 'text-amber-700 font-bold' : 'text-zinc-500'}>
                            {!ext ? '' : !ext.configurado ? 'sin configurar' : !ext.ultimo ? 'esperando el primer latido' : ext.haceSeg > 300 ? `sin latido hace ${duracion(ext.haceSeg)}` : `OK · ${ext.pc} · hace ${duracion(ext.haceSeg)}`}
                        </span>
                    </span>
                    <span className="flex items-center gap-2 min-w-0">
                        <Cloud size={15} className="text-brand-cyan shrink-0" />
                        <span className="font-black text-zinc-800 shrink-0">Hostinger · Brasil</span>
                        {!hostinger ? <span className="text-zinc-400">consultando…</span>
                            : !hostinger.ok ? <span className="text-zinc-500">no se pudo consultar su página de estado</span>
                                : incidenteBR ? (
                                    <span className="text-brand-magenta font-bold min-w-0 truncate" title={incidenteBR.name}>
                                        {incidenteBR.name} · {incidenteBR.status} · actualizado {horaCorta(incidenteBR.updated_at)}
                                    </span>
                                ) : hostinger.mantenimientos?.length ? (
                                    <span className="text-amber-700 font-bold min-w-0 truncate">Mantenimiento programado: {hostinger.mantenimientos[0].name} · {new Date(hostinger.mantenimientos[0].scheduled_for).toLocaleString('es-UY')}</span>
                                ) : (
                                    <span className="text-emerald-700 font-bold">Operativo{hostinger.componente && hostinger.componente !== 'operational' ? ` (${hostinger.componente})` : ''}</span>
                                )}
                        <a href={incidenteBR?.shortlink || PAGINA_HOSTINGER} target="_blank" rel="noreferrer" title="Ver la página de estado de Hostinger" className="shrink-0 text-zinc-400 hover:text-brand-cyan">
                            <ExternalLink size={13} />
                        </a>
                    </span>
                </div>
                <div className="flex gap-[2px] h-6 items-stretch">
                    {Array.from({ length: celdas }).map((_, i) => {
                        const l = latidos[latidos.length - celdas + i];
                        const color = !l ? 'bg-zinc-100' : !l.ok ? 'bg-brand-magenta' : l.ms > 1500 ? 'bg-amber-400' : 'bg-emerald-400';
                        return <div key={i} className={`flex-1 rounded-[1px] ${color}`} title={l ? `${hora(l.t)} · ${l.ok ? `${l.ms} ms` : `sin respuesta${l.status ? ` (${l.status})` : ''}`}` : ''} />;
                    })}
                </div>
            </div>

            {/* Métricas (atenuadas si el servidor no responde: son de la última muestra) */}
            <div className={`flex-1 flex flex-col transition-opacity ${caido ? 'opacity-40 grayscale' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={ROTULO}>Gráficos · {(RANGOS.find(r => r[0] === rango) || RANGOS[0])[1]}{rango !== '2h' && !series ? ' · cargando…' : ''}</span>
                    <span className="flex items-center gap-2.5 text-[11px] text-zinc-400">
                        {[['reinicio', 'reinicio'], ['deploy', 'deploy'], ['oom', 'OOM'], ...(rango !== '2h' ? [['caida', 'caída']] : [])].map(([k, l]) => (
                            <span key={k} className="inline-flex items-center gap-1">
                                <svg width="10" height="12" aria-hidden="true"><line x1="5" x2="5" y1="0" y2="12" stroke={oscuro && k === 'deploy' ? '#3fb5e0' : COLOR_MARCA[k]} strokeWidth="1.5" strokeDasharray={RAYA_MARCA[k]} /></svg>{l}
                            </span>
                        ))}
                    </span>
                </span>
                <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-0.5 gap-0.5">
                    {RANGOS.map(([k, l]) => (
                        <button key={k} type="button" onClick={() => elegirRango(k)}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${rango === k ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>{l}</button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3 mb-3">
                <Metrica icono={Cpu} titulo="CPU" nivel={nivelCpu}
                    valor={h?.cpu.pct != null ? `${Math.round(h.cpu.pct)} %` : '—'}
                    sub={h ? `${h.cpu.nucleos} núcleos${h.carga ? ` · carga ${h.carga[0]}` : ''}${h.io ? ` · steal ${h.io.stealPct} %` : ''}` : ''} marcas={marcasGraf} datos={series?.cpu} max={100} />
                <Metrica icono={MemoryStick} titulo="RAM en uso" nivel={nivelRam}
                    valor={h ? `${Math.round((1 - memLibrePct) * 100)} %` : '—'}
                    sub={h ? `${gb(h.mem.disponibleMB)} libres de ${gb(h.mem.totalMB)}` : ''} marcas={marcasGraf} datos={series?.memPct} max={100} />
                <Metrica icono={Archive} titulo="Swap" nivel={nivelSwap}
                    valor={h?.swap ? `${Math.round(swapPct * 100)} %` : '—'}
                    sub={h?.swap ? `${gb(h.swap.usadaMB)} de ${gb(h.swap.totalMB)}` : h ? 'solo en el servidor' : ''} marcas={marcasGraf} datos={series?.swapPct} max={100} />
                <Metrica icono={Database} titulo="Base de datos" nivel={nivelDb}
                    valor={!snap ? '—' : snap.db.ok ? `${snap.db.ms} ms` : 'CAÍDA'}
                    sub={!snap ? '' : snap.db.ok ? 'tiempo de respuesta' : snap.db.error} marcas={marcasGraf} datos={series?.dbMs} />
                <Metrica icono={Gauge} titulo="Backend trabado" nivel={nivelLag}
                    valor={snap ? `${snap.node.lagMs} ms` : '—'}
                    sub="demora del event loop (p99)" marcas={marcasGraf} datos={series?.lag} />
                <Metrica icono={HardDrive} titulo="Disco (espera)" nivel={nivelIo}
                    valor={h?.io ? `${h.io.iowaitPct} %` : '—'}
                    sub={h?.io ? `uso ${h.io.utilPct ?? '—'} % · ${h.io.leeMBs ?? '—'} / ${h.io.escribeMBs ?? '—'} MB/s` : h ? 'solo en el servidor' : ''} marcas={marcasGraf} datos={series?.iowait} max={100} />
                <Metrica icono={Network} titulo="Red (Mbps)" nivel="neutro"
                    valor={h?.red ? `${h.red.entraMbps} / ${h.red.saleMbps}` : '—'}
                    sub={h?.red ? `entrando / saliendo · ${h.red.interfaz}` : h ? 'solo en el servidor' : ''} marcas={marcasGraf} datos={series?.redEntra} />
                <div className={`${CARD} px-4 py-3 flex flex-col gap-2 min-w-0`}>
                    <div className="flex items-center gap-1.5"><HardDrive size={14} className="text-brand-cyan" /><span className={ROTULO}>Discos</span></div>
                    {(snap?.discos || []).map(d => {
                        const nv = d.usadoPct >= 90 ? COLOR.mal : d.usadoPct >= 80 ? COLOR.atencion : null;
                        return (
                            <div key={d.ruta}>
                                <div className="flex justify-between text-xs"><span className="font-bold text-zinc-700 truncate">{d.ruta}</span><span className={`font-black tabular-nums ${nv ? nv.texto : 'text-zinc-900'}`}>{d.usadoPct} %</span></div>
                                <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden mt-1"><div className={`h-full rounded-full ${nv ? nv.punto : 'bg-brand-cyan'}`} style={{ width: `${d.usadoPct}%` }} /></div>
                                <div className="text-[11px] text-zinc-400 mt-0.5">{d.libreGB} GB libres de {d.totalGB} GB</div>
                                <div className={`text-[11px] ${d.pronostico?.dias != null && d.pronostico.dias < 14 ? 'text-amber-700 font-bold' : 'text-zinc-400'}`}>
                                    {!d.pronostico ? 'pronóstico: junta 2 días de datos' : d.pronostico.dias != null ? `se llena en ~${d.pronostico.dias} días` : 'estable'}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Abajo, en cuatro columnas: procesos y colas | SQL y backups | disponibilidad, reinicios y eventos | pestañas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-3 items-start 2xl:items-stretch 2xl:flex-1">
                <div className="flex flex-col gap-3">
                <div className={CRECE}>
                    <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
                        <MemoryStick size={15} className="text-brand-cyan" />
                        <span className="text-sm font-black uppercase tracking-wide text-zinc-800">Procesos que más memoria usan</span>
                    </div>
                    <div className="relative 2xl:flex-1"><div className={CUERPO}>
                    {!snap?.procesos ? (
                        <div className="px-4 py-8 text-center text-sm text-zinc-400 2xl:h-full 2xl:flex 2xl:items-center 2xl:justify-center">{snap && !h?.linux ? 'Se ve en el servidor (Linux).' : 'Cargando…'}</div>
                    ) : (
                        <div className={`divide-y divide-zinc-100 ${HASTA_6}`}>
                            {snap.procesos.map(p => {
                                const nv = p.python && p.rssMB > 8192 ? COLOR.mal : p.python && p.rssMB > 4096 ? COLOR.atencion : null;
                                return (
                                    <div key={p.pid} className={`px-4 py-1.5 flex items-center gap-2.5 text-sm ${nv ? nv.fondo : ''}`}>
                                        <span className="min-w-0 flex-1 truncate">
                                            <span className={`font-bold ${p.python ? 'text-brand-cyan' : 'text-zinc-800'}`}>{p.nombre}</span>
                                            {p.detalle && <span className="text-zinc-500"> · {p.detalle}</span>}
                                        </span>
                                        <span className="text-[11px] text-zinc-400 tabular-nums shrink-0 text-right">{p.cpu} % CPU · {duracion(p.segundos)}</span>
                                        <span className={`font-black tabular-nums shrink-0 w-[60px] text-right ${nv ? nv.texto : 'text-zinc-900'}`}>{gb(p.rssMB)}</span>
                                        <span className="w-7 shrink-0 flex justify-end">
                                            {p.python && (
                                                <button type="button" onClick={() => terminarProceso(p)} title="Terminar este proceso" aria-label={`Terminar ${p.detalle || p.nombre}`}
                                                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5">
                                                    <OctagonX size={14} />
                                                </button>
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    </div></div>
                </div>
                <div className={`${CARD} px-4 py-2.5`}>
                    <div className="flex items-center gap-2 mb-1.5"><Cpu size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Procesos pesados</span></div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {(snap?.colas || []).map(c => {
                            const largo = c.actual && c.actual.segundos > 300;
                            const clase = largo || (!c.actual && c.fallasHora) ? NIVEL_INTEGRACION.atencion[0] : c.actual ? NIVEL_INTEGRACION.info[0] : 'bg-zinc-50 text-zinc-500 border-zinc-200';
                            const detalle = c.actual ? `${c.actual.detalle} · hace ${duracion(c.actual.segundos)}` : `${c.hechasHora} en la última hora${c.promedioSeg != null ? ` · ${duracion(c.promedioSeg)} c/u` : ''}`;
                            return (
                                <div key={c.clave} className={`rounded-lg border px-2 py-1.5 min-w-0 ${clase}`}
                                    title={`${c.nombre}: ${detalle}${c.esperando ? ` · ${c.esperando} esperando` : ''}${c.fallasHora ? ` · ${c.fallasHora} con error en la hora` : ''}`}>
                                    <div className="text-[11px] font-bold text-zinc-700 truncate">{c.nombre}</div>
                                    <div className="text-[11px] font-bold tabular-nums truncate">
                                        {c.actual ? `corriendo · ${duracion(c.actual.segundos)}` : `libre · ${c.hechasHora} en 1 h`}{c.esperando ? ` · ${c.esperando} esp.` : ''}{!c.actual && c.fallasHora ? ` · ${c.fallasHora} err.` : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div className={`${CARD} overflow-hidden`}>
                    <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2"><Boxes size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Servicios</span></div>
                    {!snap?.servicios ? <div className="px-4 py-3 text-sm text-zinc-400">{snap && !h?.linux ? 'Se ve en el servidor (Linux).' : 'Cargando…'}</div>
                        : !snap.servicios.length ? <div className="px-4 py-3 text-sm text-zinc-400">Ninguno configurado</div> : (
                            <div className="divide-y divide-zinc-100">
                                {snap.servicios.map(s => {
                                    const pct = s.topeMB && s.memMB != null ? Math.min(100, (s.memMB / s.topeMB) * 100) : null;
                                    const nv = s.error ? null : !s.activo ? COLOR.mal : s.salud === 'unhealthy' || pct >= 90 ? COLOR.atencion : null;
                                    const detalle = s.error ? s.error
                                        : !s.activo ? `parado (${s.estado})`
                                            : `${s.salud && s.salud !== 'healthy' ? `${s.salud} · ` : ''}${s.desde ? `arriba hace ${duracion((ahora - Date.parse(s.desde)) / 1000)}` : 'arriba'}${s.reinicios ? ` · ${s.reinicios} reinicio${s.reinicios === 1 ? '' : 's'}` : ''}`;
                                    return (
                                        <div key={s.nombre} className={`px-4 py-1.5 ${!s.error && !s.activo ? COLOR.mal.fondo : ''}`} title={`${s.nombre}: ${detalle}`}>
                                            <div className="flex items-center gap-2 text-sm">
                                                <span className={`w-2 h-2 rounded-full shrink-0 ${s.error ? 'bg-zinc-300' : nv ? nv.punto : COLOR.ok.punto}`} />
                                                <span className="font-bold text-zinc-800 shrink-0">{s.nombre}</span>
                                                <span className="text-[11px] text-zinc-400 shrink-0">{s.tipo === 'contenedor' ? 'Docker' : 'systemd'}</span>
                                                <span className={`text-[11px] truncate min-w-0 flex-1 text-right ${nv ? `${nv.texto} font-bold` : 'text-zinc-500'}`}>{detalle}</span>
                                                <span className={`font-black tabular-nums shrink-0 ${nv ? nv.texto : 'text-zinc-900'}`}>
                                                    {s.memMB != null ? gb(s.memMB) : '—'}{s.topeMB ? <span className="text-zinc-400 font-bold"> / {gb(s.topeMB)}</span> : null}
                                                </span>
                                            </div>
                                            {pct != null && <div className="h-1 rounded-full bg-zinc-100 overflow-hidden mt-1 ml-4"><div className={`h-full ${nv ? nv.punto : 'bg-brand-cyan/60'}`} style={{ width: `${pct}%` }} /></div>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                </div>
                <div className={`${CARD} px-4 py-2.5`}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="flex items-center gap-2"><Globe size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Red hacia afuera</span></span>
                        {red?.ts && <span className="text-[11px] text-zinc-400 tabular-nums">ping cada 1 min · {horaCorta(red.ts)}</span>}
                    </div>
                    {!red ? <div className="text-sm text-zinc-400 py-1">{snap ? 'Midiendo…' : 'Cargando…'}</div>
                        : red.sinPing ? <div className="text-sm text-zinc-500 py-1">No se pudo hacer ping desde el servidor.</div> : (<>
                            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, red.destinos.length)}, minmax(0, 1fr))` }}>
                                {red.destinos.map(d => {
                                    // En la casilla, ámbar desde el 5 % perdido; el aviso es con 20 % dos minutos seguidos
                                    const nv = !d.contesto || d.perdida == null ? null : d.perdida >= 100 ? 'mal' : d.perdida >= 5 ? 'atencion' : 'ok';
                                    const conPerdida = red.destinos.some(x => x.contesto && x.perdida > 0 && x.perdida < 100);
                                    return (
                                        <div key={d.nombre} className={`rounded-lg border px-2 py-1 min-w-0 ${nv ? `${COLOR[nv].fondo} ${COLOR[nv].borde}` : 'bg-zinc-50 border-zinc-200'}`} title={d.host || d.nombre}>
                                            <div className="text-[10px] font-bold uppercase text-zinc-500 truncate">{d.nombre}</div>
                                            <div className={`text-xs font-black tabular-nums truncate ${nv ? COLOR[nv].texto : 'text-zinc-400'}`}>
                                                {!d.contesto ? 'no contesta ping' : d.perdida == null ? 'sin dato' : d.perdida >= 100 ? 'sin respuesta' : `${d.ms ?? '—'} ms`}
                                            </div>
                                            {conPerdida && <div className="text-[10px] text-zinc-500 tabular-nums truncate">{d.contesto && d.perdida > 0 && d.perdida < 100 ? `${d.perdida} % perdido` : 'sin pérdida'}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-1.5">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Latencia a internet</div>
                                    <Sparkline datos={series?.pingMs} alto={22} marcas={marcasGraf} />
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Paquetes perdidos</div>
                                    <Sparkline datos={series?.pingPerdida} max={100} alto={22} color="#BD0C7E" marcas={marcasGraf} />
                                </div>
                            </div>
                        </>)}
                </div>
                </div>
                <div className="flex flex-col gap-3">
                    <div className={`${CARD} px-4 py-3`}>
                        <div className="flex items-center gap-2 mb-1"><Database size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">SQL Server</span></div>
                        {snap?.db.error && snap.db.ok && <div className="text-xs text-zinc-400 mb-1">{snap.db.error}</div>}
                        <Fila etiqueta="Sesiones abiertas" valor={snap?.db.sesiones ?? '—'} />
                        <Fila etiqueta="Consultas bloqueadas" valor={snap?.db.bloqueadas ?? '—'} nivel={snap?.db.bloqueadas > 0 ? 'atencion' : null} />
                        <Fila etiqueta="Transacciones abiertas sin actividad" valor={snap?.db.txAbiertasDormidas ?? '—'} nivel={snap?.db.txAbiertasDormidas > 0 ? 'atencion' : null} />
                        <Fila etiqueta="Consulta más larga en curso" valor={snap?.db.consultaMasLargaSeg != null ? duracion(snap.db.consultaMasLargaSeg) : 'ninguna'} nivel={snap?.db.consultaMasLargaSeg > 120 ? 'atencion' : null} />
                        <Fila etiqueta="Memoria del motor" valor={`${gb(snap?.db.sqlMemMB)}${snap?.db.sqlTopeMB ? ` de ${gb(snap.db.sqlTopeMB)}` : ''}`} />
                        {bloqueos && !bloqueos.error && (<>
                            {[...(bloqueos.cabezas || []).map(x => ({ ...x, clase: 'bloquea' })), ...(bloqueos.dormidas || []).filter(d => !(bloqueos.cabezas || []).some(c => c.sesion === d.sesion)).map(x => ({ ...x, clase: 'dormida' }))].length > 0 && (
                                <div className="mt-2">
                                    <div className={ROTULO}>Para cortar</div>
                                    {[...(bloqueos.cabezas || []).map(x => ({ ...x, clase: 'bloquea' })), ...(bloqueos.dormidas || []).filter(d => !(bloqueos.cabezas || []).some(c => c.sesion === d.sesion)).map(x => ({ ...x, clase: 'dormida' }))].map(x => (
                                        <div key={x.sesion} className="flex items-start gap-2 py-1.5 border-b border-zinc-100 last:border-0">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm">
                                                    <span className="font-black text-zinc-800">Sesión {x.sesion}</span>
                                                    <span className={x.clase === 'bloquea' ? 'text-brand-magenta font-bold' : 'text-amber-700 font-bold'}>{x.clase === 'bloquea' ? ` · traba ${x.bloqueaA} consulta(s)` : ` · transacción abierta hace ${duracion(x.quietaSeg)}`}</span>
                                                </div>
                                                <div className="text-[11px] text-zinc-500 truncate">{[x.programa, x.login, x.host].filter(Boolean).join(' · ')}</div>
                                                {x.consulta && <div className="text-[11px] font-mono text-zinc-400 truncate" title={x.consulta}>{x.consulta}</div>}
                                            </div>
                                            <button type="button" onClick={() => cortarSesion(x)} title="Cortar la sesión (KILL): deshace su transacción" className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 bg-white text-[11px] font-bold text-zinc-500 transition-colors hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5">
                                                <Scissors size={12} /> Cortar
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {(bloqueos.bloqueadas || []).length > 0 && (
                                <div className="mt-2">
                                    <div className={ROTULO}>Esperando</div>
                                    {bloqueos.bloqueadas.slice(0, 4).map(x => (
                                        <div key={x.sesion} className="py-1 border-b border-zinc-100 last:border-0 text-[11px]">
                                            <span className="font-bold text-zinc-700">{x.sesion}</span>
                                            <span className="text-zinc-500"> espera a {x.bloqueadaPor} hace {duracion(x.seg)}{x.programa ? ` · ${x.programa}` : ''}</span>
                                            {x.consulta && <div className="font-mono text-zinc-400 truncate" title={x.consulta}>{x.consulta}</div>}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {(bloqueos.pesadas || []).filter(x => x.cpuMs > 1000 || x.seg > 10).length > 0 && (
                                <div className="mt-2">
                                    <div className={ROTULO}>Las que más CPU llevan ahora</div>
                                    {bloqueos.pesadas.filter(x => x.cpuMs > 1000 || x.seg > 10).slice(0, 3).map(x => (
                                        <div key={x.sesion} className="py-1 border-b border-zinc-100 last:border-0 text-[11px]">
                                            <span className="font-bold text-zinc-700">{x.sesion}</span>
                                            <span className="text-zinc-500"> · {Math.round(x.cpuMs / 1000)} s de CPU · {Math.round(x.lecturas / 1000)} mil lecturas · hace {duracion(x.seg)}</span>
                                            {x.consulta && <div className="font-mono text-zinc-400 truncate" title={x.consulta}>{x.consulta}</div>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>)}
                    </div>
                <div className={`${CARD} px-4 py-3`}>
                    <div className="flex items-center gap-2 mb-1"><Archive size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Backups</span></div>
                    {!snap?.backups ? <div className="text-sm text-zinc-400 py-1">Cargando…</div>
                        : snap.backups.error ? <div className="text-sm text-zinc-500 py-1">{snap.backups.error}</div>
                            : !snap.backups.lista?.length ? <div className="text-sm text-amber-700 font-bold py-1">No hay backups registrados</div>
                                : snap.backups.lista.map((b, i) => (
                                    <Fila key={b.terminado} etiqueta={`${fechaCorta(b.terminado)} · hace ${duracion(b.haceMin * 60)}`}
                                        valor={`${gb(Math.round(b.tamanoMB))} · tardó ${duracion(b.segundos)}`}
                                        nivel={i === 0 && b.haceMin > 26 * 60 ? 'atencion' : null} />
                                ))}
                    {snap?.backups?.archivos && (
                        <div className="text-[11px] text-zinc-400 mt-1 truncate">
                            Copia en el servidor: {snap.backups.archivos[0] ? `${snap.backups.archivos[0].nombre} · ${gb(snap.backups.archivos[0].tamanoMB)}` : 'no hay archivos'}
                        </div>
                    )}
                </div>
                <div className={CRECE}>
                    <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2"><Bug size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Errores del backend · 1 h</span></span>
                        {snap?.errores?.total > 0 && <span className="text-xs font-black text-zinc-600 tabular-nums">{snap.errores.total} · {snap.errores.tipos} tipo{snap.errores.tipos === 1 ? '' : 's'}</span>}
                    </div>
                    <div className="relative 2xl:flex-1"><div className={CUERPO}>
                    {!snap?.errores ? <div className="px-4 py-3 text-sm text-zinc-400">Cargando…</div>
                        : !snap.errores.top.length ? <div className="px-4 py-3 text-sm font-bold text-emerald-700">Ninguno en la última hora</div> : (
                            <div className={`divide-y divide-zinc-100 ${HASTA_6}`}>
                                {snap.errores.top.map(e => (
                                    <div key={e.texto} className="px-4 py-1.5 flex items-start gap-2.5" title={e.texto}>
                                        <span className={`shrink-0 min-w-[30px] text-center text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded-md border ${e.n >= 30 ? NIVEL_INTEGRACION.mal[0] : e.n >= 10 ? NIVEL_INTEGRACION.atencion[0] : 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}>{e.n}</span>
                                        <span className="min-w-0 flex-1 text-[11px] font-mono text-zinc-600 leading-snug line-clamp-2 break-all">{e.texto}</span>
                                        <span className={`shrink-0 text-[11px] tabular-nums ${ahora - Date.parse(e.ultimo) < 5 * 60000 ? 'text-zinc-700 font-bold' : 'text-zinc-400'}`}>{horaCorta(e.ultimo)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div></div>
                </div>
                </div>
                <div className="flex flex-col gap-3">
                <div className={`${CARD} px-4 py-3`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="flex items-center gap-2"><Activity size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Disponibilidad · 7 días</span></span>
                        {dispPromedio != null && <span className="text-xs font-black text-zinc-600 tabular-nums">{dispPromedio} %</span>}
                    </div>
                    {!disp ? <div className="text-sm text-zinc-400 py-1">Cargando…</div> : (
                        <div className="grid grid-cols-7 gap-1.5">
                            {disp.map(d => {
                                const nv = d.sinDatos ? null : d.pct >= 99.9 ? 'ok' : d.pct >= 99 ? 'atencion' : 'mal';
                                return (
                                    <div key={d.fecha} className={`rounded-lg border px-1 py-1.5 text-center ${nv ? `${COLOR[nv].fondo} ${COLOR[nv].borde}` : 'bg-zinc-50 border-zinc-200'}`}
                                        title={d.sinDatos ? 'Sin datos: el monitor todavía no medía' : d.caidas?.length ? d.caidas.map(c => `${horaCorta(c.desde)}–${horaCorta(c.hasta)} (${c.minutos} min)`).join(', ') : 'Sin caídas'}>
                                        <div className="text-[10px] font-bold uppercase text-zinc-500 truncate">{diaCorto(d.fecha)}</div>
                                        <div className={`text-xs font-black tabular-nums ${nv ? COLOR[nv].texto : 'text-zinc-300'}`}>{d.sinDatos ? '—' : `${d.pct} %`}</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <div className="text-[11px] text-zinc-400 mt-1.5 truncate">
                        {ultimaCaida ? `Última caída: ${fechaCorta(ultimaCaida.desde)} a ${horaCorta(ultimaCaida.hasta)} (${duracion(ultimaCaida.minutos * 60)})` : 'Sin caídas en los días medidos'}
                    </div>
                </div>
                <div className={`${CARD} px-4 py-3`}>
                    <div className="flex items-center gap-2 mb-1"><RotateCcw size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Memoria agotada y reinicios</span></div>
                    {!snap?.sistema ? <div className="text-sm text-zinc-400 py-1">Cargando…</div> : (<>
                        {h?.linux ? (<>
                            <div className={`${ROTULO} mt-1`}>El kernel mató por falta de memoria · 7 días</div>
                            {snap.sistema.oom == null ? <div className="text-xs text-zinc-400 py-0.5">sin dato</div>
                                : !snap.sistema.oom.length ? <div className="text-sm font-bold text-emerald-700 py-0.5">Ninguna vez</div>
                                    : snap.sistema.oom.slice(0, 3).map(o => <Fila key={o.ts} etiqueta={`${fechaCorta(o.ts)} · ${o.proceso}`} valor={`${o.rssGB} GB`} nivel="mal" />)}
                            <div className={`${ROTULO} mt-2`}>Arranques del servidor</div>
                            {(snap.sistema.arranquesServidor || []).slice(0, 3).map(a => (
                                <Fila key={a.inicio} etiqueta={`${fechaCorta(a.inicio)}${a.fin ? ` → ${fechaCorta(a.fin)}` : ''}`}
                                    valor={a.actual ? 'el actual' : a.limpio ? 'se apagó normal' : 'se cortó sin apagarse'}
                                    nivel={!a.actual && a.limpio === false ? 'atencion' : null} />
                            ))}
                        </>) : <div className="text-xs text-zinc-400 py-0.5">Los OOM y arranques del servidor se ven en el servidor (Linux).</div>}
                        <div className={`${ROTULO} mt-2`}>Arranques del backend</div>
                        <div className="text-xs text-zinc-600 tabular-nums">{(snap.sistema.arranquesBackend || []).slice(0, 4).map(fechaCorta).join(' · ') || '—'}</div>
                    </>)}
                </div>
                    <div className={CRECE}>
                        <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2"><Clock size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Eventos</span></div>
                        <div className="relative 2xl:flex-1"><div className={CUERPO}>
                        {eventos.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-zinc-400">Sin eventos desde que arrancó el backend.</div>
                        ) : (
                            <div className={`divide-y divide-zinc-100 ${HASTA_6}`}>
                                {eventos.map((e, i) => (
                                    <div key={`${e.ts}-${i}`} className="px-4 py-1.5 flex items-start gap-2.5 text-sm">
                                        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${(COLOR[e.nivel] || COLOR.neutro).punto}`} />
                                        <span className="text-zinc-400 tabular-nums shrink-0">{horaCorta(e.ts)}</span>
                                        <span className="text-zinc-700 min-w-0 break-words">{e.texto}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        </div></div>
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                <div className={`${CARD} overflow-hidden`}>
                    <div className="px-1.5 pt-2 border-b border-zinc-100 flex gap-0.5">
                        {PESTANAS.map(([k, l, Icono]) => (
                            <button key={k} type="button" onClick={() => elegirPestana(k)}
                                className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-t-lg text-[13px] font-bold border-b-2 -mb-px transition-colors whitespace-nowrap ${pestana === k ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
                                <Icono size={14} className="text-brand-cyan" /> {l}
                                {paraMirar[k] > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-magenta text-white text-[10px] font-black inline-flex items-center justify-center tabular-nums">{paraMirar[k]}</span>
                                )}
                            </button>
                        ))}
                    </div>
                    {pestana === 'integraciones' && (
                        <div className="divide-y divide-zinc-100">
                            {(snap?.integraciones || []).map(i => {
                                const [clase, etiqueta] = NIVEL_INTEGRACION[i.nivel] || NIVEL_INTEGRACION['sin-datos'];
                                const detalle = (i.nivel === 'mal' || i.nivel === 'atencion') && i.ultimoError ? i.ultimoError
                                    : i.ultimoOkHaceMin != null ? `${i.texto} hace ${duracion(i.ultimoOkHaceMin * 60)}`
                                        : i.ultimoOk ? `bien hace ${duracion((ahora - Date.parse(i.ultimoOk)) / 1000)}${i.fallasHora ? ` · ${i.fallasHora} falla(s) en la hora` : ''}`
                                            : i.texto;
                                return (
                                    <div key={i.clave} className="px-4 py-1.5 flex items-center gap-3 text-sm" title={i.ultimoError || ''}>
                                        <span className="font-bold text-zinc-800 shrink-0">{i.nombre}</span>
                                        <span className={`text-[11px] truncate min-w-0 flex-1 text-right ${i.nivel === 'mal' ? 'text-brand-magenta' : i.nivel === 'atencion' ? 'text-amber-700' : 'text-zinc-400'}`}>{detalle}</span>
                                        <span className={`shrink-0 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${clase}`}>{etiqueta}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {pestana === 'servidor' && (
                        <div className="px-4 py-2">
                        <Fila etiqueta="Prendido hace" valor={h ? duracion(h.uptimeSeg) : '—'} />
                        <Fila etiqueta="Backend" valor={snap ? `${gb(snap.node.rssMB)} · arriba hace ${duracion(snap.node.uptimeSeg)}${snap.node.reinicios != null ? ` · ${snap.node.reinicios} reinicios` : ''}` : '—'} />
                        {(snap?.pm2 || []).map(x => (
                            <Fila key={x.nombre} etiqueta={`pm2 · ${x.nombre}`} valor={`${x.estado} · ${gb(x.memMB)} · ${x.reinicios} reinicios`} nivel={x.estado !== 'online' ? 'mal' : null} />
                        ))}
                        <Fila etiqueta="Front deployado"
                            valor={!snap?.front ? '—' : `${snap.front.deployado ? fechaCorta(snap.front.deployado) : 'sin dato'} · ${snap.front.navegadoresAlDia} al día${snap.front.navegadoresViejos ? ` · ${snap.front.navegadoresViejos} con versión vieja` : ''}`}
                            nivel={snap?.front?.navegadoresViejos > 0 ? 'atencion' : null} />
                        <Fila etiqueta="Errores del front" valor={snap ? `${snap.http.erroresFrontPorMin} por minuto` : '—'} nivel={snap?.http.erroresFrontPorMin >= 20 ? 'atencion' : null} />
                        <Fila etiqueta={`Certificado ${snap?.ssl?.host || 'SSL'}`} valor={snap?.ssl ? `vence en ${snap.ssl.dias} días` : '—'} nivel={snap?.ssl?.dias < 5 ? 'mal' : snap?.ssl?.dias < 15 ? 'atencion' : null} />
                        <Fila etiqueta="Avisos por mail / WhatsApp" valor={!snap?.avisos ? '—' : `${snap.avisos.mails || 'sin'} destinatario${snap.avisos.mails === 1 ? '' : 's'} · ${snap.avisos.whatsapp || 'sin'} WhatsApp`} nivel={snap?.avisos && !snap.avisos.mails && !snap.avisos.whatsapp ? 'atencion' : null} />
                        <div className="flex justify-end pt-2">
                            <button type="button" onClick={() => setReinicio({ clave: '', enviando: false, error: null })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-600 transition-colors hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5">
                                <Power size={13} /> Reiniciar el backend
                            </button>
                        </div>
                        </div>
                    )}
                    {pestana === 'seguridad' && (
                        <div className="px-4 py-2">
                            <div className={ROTULO}>Logins fallidos · 15 min</div>
                            {!seg?.logins?.total ? <div className="text-sm font-bold text-emerald-700 py-1">Ninguno</div> : (<>
                                <div className="text-sm text-zinc-600 py-0.5">{seg.logins.total} en total</div>
                                {seg.logins.porIp.map(x => (
                                    <Fila key={x.ip} etiqueta={`${x.ip}${x.usuarios.length ? ` · ${x.usuarios.join(', ')}` : ''}`} valor={`${x.cantidad} · ${x.sistemas.join(' y ')}`} nivel={x.cantidad >= 15 ? 'mal' : x.cantidad >= 5 ? 'atencion' : null} />
                                ))}
                            </>)}
                            <div className={`${ROTULO} mt-2`}>SSH · intentos fallidos en 15 min</div>
                            {!seg?.sistema ? <div className="text-xs text-zinc-400 py-0.5">{h && !h.linux ? 'Se ve en el servidor (Linux).' : 'sin dato'}</div>
                                : !seg.sistema.ssh ? <div className="text-xs text-zinc-400 py-0.5">sin dato</div>
                                    : (<>
                                        <div className="text-sm text-zinc-600 py-0.5">{seg.sistema.ssh.total} intentos{seg.sistema.fail2ban ? ` · fail2ban: ${seg.sistema.fail2ban.baneadas} IP bloqueadas ahora` : ''}</div>
                                        {seg.sistema.ssh.top.slice(0, 3).map(x => <Fila key={x.ip} etiqueta={x.ip} valor={`${x.cantidad}`} />)}
                                    </>)}
                            <div className={`${ROTULO} mt-2`}>Firewall · bloqueos en 15 min</div>
                            {!seg?.sistema?.firewall ? <div className="text-xs text-zinc-400 py-0.5">{h && !h.linux ? 'Se ve en el servidor (Linux).' : 'sin dato'}</div> : (<>
                                <div className="text-sm text-zinc-600 py-0.5">{seg.sistema.firewall.total} paquetes bloqueados</div>
                                {seg.sistema.firewall.top.slice(0, 3).map(x => <Fila key={x.ip} etiqueta={`${x.ip}${x.puertos.length ? ` · puertos ${x.puertos.join(', ')}` : ''}`} valor={`${x.cantidad}`} />)}
                            </>)}
                        </div>
                    )}
                </div>
                <div className={CRECE}>
                    <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2"><Route size={15} className="text-brand-cyan" /><span className="text-sm font-black uppercase tracking-wide text-zinc-800">Rutas · últimos 15 min</span></div>
                    <div className="relative 2xl:flex-1"><div className={CUERPO}>
                    {!snap?.rutas ? <div className="px-4 py-3 text-sm text-zinc-400">Cargando…</div> : (
                        <div className="px-4 py-2">
                            <div className={ROTULO}>Las más lentas (p95)</div>
                            {!snap.rutas.lentas.length ? <div className="text-xs text-zinc-400 py-0.5">sin datos todavía</div> : (
                                <div className={HASTA_6}>
                                    {snap.rutas.lentas.map(r => (
                                        <Fila key={r.ruta} etiqueta={<span className="font-mono text-xs" title={r.ruta}>{r.ruta}</span>} valor={`${r.p95 >= 1000 ? `${(r.p95 / 1000).toFixed(1)} s` : `${r.p95} ms`} · ${r.n}`} nivel={r.p95 >= 3000 ? 'atencion' : null} />
                                    ))}
                                </div>
                            )}
                            <div className={`${ROTULO} mt-2`}>Con errores 500</div>
                            {!snap.rutas.conErrores.length ? <div className="text-sm font-bold text-emerald-700 py-0.5">Ninguna</div> : (
                                <div className={HASTA_6}>
                                    {snap.rutas.conErrores.map(r => (
                                        <Fila key={r.ruta} etiqueta={<span className="font-mono text-xs" title={r.ruta}>{r.ruta}</span>} valor={`${r.e5} de ${r.n}`} nivel="mal" />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    </div></div>
                </div>
                </div>
            </div>
            </div>
            {reinicio && (
                <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4" onClick={() => !reinicio.enviando && setReinicio(null)}>
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-1"><Power size={18} className="text-brand-magenta" /><span className="text-lg font-black text-zinc-900">Reiniciar el backend</span></div>
                        <p className="text-sm text-zinc-500 mb-3">Corta lo que esté procesando y vuelve en unos segundos. Pide la contraseña de administración, la misma de la consola.</p>
                        <input type="password" autoFocus value={reinicio.clave} placeholder="Contraseña de administración"
                            onChange={e => setReinicio(r => ({ ...r, clave: e.target.value, error: null }))}
                            onKeyDown={e => { if (e.key === 'Enter') reiniciarBackend(); if (e.key === 'Escape' && !reinicio.enviando) setReinicio(null); }}
                            className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
                        {reinicio.error && <div className="text-xs font-bold text-brand-magenta mt-2">{reinicio.error}</div>}
                        <div className="flex justify-end gap-2 mt-4">
                            <button type="button" disabled={reinicio.enviando} onClick={() => setReinicio(null)} className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">Cancelar</button>
                            <button type="button" disabled={reinicio.enviando} onClick={reiniciarBackend} className="px-3 py-2 rounded-xl bg-brand-magenta text-white text-sm font-bold hover:opacity-90 disabled:opacity-50">{reinicio.enviando ? 'Reiniciando…' : 'Reiniciar'}</button>
                        </div>
                    </div>
                </div>
            )}
            {ventanaConfirmar}
        </div>
        </TemaOscuro.Provider>
    );
}
