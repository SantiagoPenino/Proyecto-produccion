import React, { useEffect, useMemo, useState } from 'react';

// Planilla de alertas de entrega: misma data que ProductionTable (rowData ya filtrado por
// AreaView), pero en vez de columnas neutras muestra qué tan cerca está cada orden de
// incumplir su ENTREGA COMPROMETIDA (deliveryDate = Ordenes.FechaEstimadaEntrega, ya
// calculada por sp_CalcularFechaEntrega). No recalcula la fecha compromiso acá — solo la
// compara contra "ahora" para clasificar semáforo, ordenar y contar.
//
// Fechas del backend: node-mssql las devuelve marcadas UTC pero son hora de negocio "naive"
// (ver src/utils/fechas.js). Por eso NO se usa `new Date()` tal cual para "ahora": hay que
// construir un Date cuyos campos UTC sean la hora local real, para que la resta contra
// entryDate/deliveryDate (que ya vienen en ese mismo formato) dé el tiempo real transcurrido.
function ahoraComoFechaDeNegocio() {
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()));
}

const H = 3600 * 1000;

function fmtFechaHoraUTC(d) {
    if (!d) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function fmtDuracion(ms) {
    ms = Math.abs(ms);
    const horas = Math.floor(ms / H);
    const min = Math.round((ms % H) / 60000);
    if (horas <= 0) return `${min}m`;
    return `${horas}h ${String(min).padStart(2, '0')}m`;
}

const ESTADO_ORDEN = { VENCIDA: 0, RIESGO: 1, TIEMPO: 2, SIN_FECHA: 3 };

function clasificar(orden, now) {
    const entryDate = orden.entryDate ? new Date(orden.entryDate) : null;
    const deliveryDate = orden.deliveryDate ? new Date(orden.deliveryDate) : null;
    if (!deliveryDate || isNaN(deliveryDate.getTime())) {
        return { estado: 'SIN_FECHA', rest: Infinity, pct: 0, deliveryDate: null };
    }
    const rest = deliveryDate.getTime() - now.getTime();
    const total = entryDate && !isNaN(entryDate.getTime())
        ? Math.max(deliveryDate.getTime() - entryDate.getTime(), H)
        : 24 * H;
    const transcurrido = entryDate ? (now.getTime() - entryDate.getTime()) : 0;
    const pct = Math.min(100, Math.max(0, (transcurrido / total) * 100));

    let estado = 'TIEMPO';
    const enRiesgoPorPendiente = /pendiente/i.test(orden.areaStatus || '') && !orden.rollId && rest < 4 * H;
    if (rest < 0) estado = 'VENCIDA';
    else if (rest <= Math.max(2 * H, total * 0.25) || enRiesgoPorPendiente) estado = 'RIESGO';

    return { estado, rest, pct, deliveryDate };
}

const ESTADO_CFG = {
    VENCIDA: { label: 'Vencidas', dot: 'bg-red-600', chip: 'bg-red-50 text-red-600', chipSel: 'ring-red-600', row: 'bg-red-50/60', borde: 'border-l-red-600', pill: 'bg-red-600 text-white', pulse: true, icono: '⛔' },
    RIESGO: { label: 'En riesgo', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600', chipSel: 'ring-amber-500', row: 'bg-amber-50/60', borde: 'border-l-amber-500', pill: 'bg-amber-500 text-white', pulse: false, icono: '⚠' },
    TIEMPO: { label: 'En tiempo', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600', chipSel: 'ring-emerald-500', row: '', borde: 'border-l-emerald-200', pill: 'bg-emerald-50 text-emerald-600', pulse: false, icono: '✓' },
    SIN_FECHA: { label: 'Sin fecha', dot: 'bg-zinc-300', chip: 'bg-zinc-100 text-zinc-500', chipSel: 'ring-zinc-400', row: '', borde: 'border-l-zinc-200', pill: 'bg-zinc-100 text-zinc-500', pulse: false, icono: '–' },
};

const PriorityBadge = ({ priority, code }) => {
    const isFalla = priority === 'Falla' || (code || '').toUpperCase().includes('-F');
    if (isFalla) return <span className="text-xs font-bold text-red-600 uppercase">FALLA</span>;
    if (priority === 'Urgente') return <span className="text-xs font-bold text-brand-magenta uppercase">URGENTE</span>;
    if (/reposici/i.test(priority || '')) return <span className="text-xs font-bold text-orange-500 uppercase">REPOSICIÓN</span>;
    return <span className="text-xs text-zinc-500 font-medium">{priority || 'Normal'}</span>;
};

const PAGE_SIZE = 25;

export default function PlanillaAlertas({ rowData = [], onRowClick, toolbarContent }) {
    const [nowReal, setNowReal] = useState(ahoraComoFechaDeNegocio);
    const [filtro, setFiltro] = useState(null);
    const [ordenarPorUrgencia, setOrdenarPorUrgencia] = useState(true);
    const [pageIndex, setPageIndex] = useState(0);
    // Simular hora (solo demo/pruebas): mueve el "ahora" contra el que se mide el semáforo,
    // sin esperar a que pase el tiempo real. Apagado por defecto: en planta se usa la hora real.
    const [simActivo, setSimActivo] = useState(false);
    const [horaSimMin, setHoraSimMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });

    // Refresca la clasificación cada minuto: el semáforo cambia con el tiempo aunque no
    // haya cambios en las órdenes.
    useEffect(() => {
        const id = setInterval(() => setNowReal(ahoraComoFechaDeNegocio()), 60 * 1000);
        return () => clearInterval(id);
    }, []);

    const now = useMemo(() => {
        if (!simActivo) return nowReal;
        const h = Math.floor(horaSimMin / 60), mi = horaSimMin % 60;
        return new Date(Date.UTC(nowReal.getUTCFullYear(), nowReal.getUTCMonth(), nowReal.getUTCDate(), h, mi, 0));
    }, [simActivo, horaSimMin, nowReal]);

    const clasificadas = useMemo(
        () => rowData.map(o => ({ o, ...clasificar(o, now) })),
        [rowData, now]
    );

    const conteos = useMemo(() => {
        const c = { VENCIDA: 0, RIESGO: 0, TIEMPO: 0 };
        clasificadas.forEach(({ estado }) => { if (c[estado] !== undefined) c[estado]++; });
        return c;
    }, [clasificadas]);

    const filtradas = useMemo(() => {
        let data = filtro ? clasificadas.filter(x => x.estado === filtro) : clasificadas;
        if (ordenarPorUrgencia) {
            data = [...data].sort((a, b) => {
                const ea = ESTADO_ORDEN[a.estado], eb = ESTADO_ORDEN[b.estado];
                if (ea !== eb) return ea - eb;
                return a.rest - b.rest;
            });
        }
        return data;
    }, [clasificadas, filtro, ordenarPorUrgencia]);

    useEffect(() => { setPageIndex(0); }, [filtro, rowData.length]);

    const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
    const pageSafe = Math.min(pageIndex, totalPages - 1);
    const pagina = filtradas.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);

    const totalMetros = useMemo(() => rowData.reduce((s, o) => s + (parseFloat(o.magnitude) || 0), 0), [rowData]);

    return (
        <div className="flex flex-col h-full w-full bg-white overflow-hidden animate-in fade-in duration-300">
            {/* Toolbar: reutiliza el mismo bloque (Historial/Filtros/selector PRO) que la Planilla en modo tabla, más los chips de alerta y el orden por urgencia */}
            <div className="px-4 py-2 tablet:px-2 tablet:py-1.5 border-b-2 border-zinc-200 bg-zinc-50 flex flex-wrap justify-between items-center gap-2 shrink-0 z-20">
                <div className="flex-1 flex items-center flex-wrap gap-2 tablet:gap-1.5">
                    {toolbarContent}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {['VENCIDA', 'RIESGO', 'TIEMPO'].map(key => {
                        const cfg = ESTADO_CFG[key];
                        const sel = filtro === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setFiltro(sel ? null : key)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${cfg.chip} ${sel ? `ring-2 ${cfg.chipSel}` : 'opacity-90 hover:opacity-100'}`}
                                title={`Filtrar por ${cfg.label.toLowerCase()}`}
                            >
                                <span className={`w-2 h-2 rounded-full ${cfg.dot}`}></span>
                                {cfg.label} <b className="text-sm">{conteos[key]}</b>
                            </button>
                        );
                    })}
                    <label className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-zinc-600 cursor-pointer select-none">
                        <input type="checkbox" checked={ordenarPorUrgencia} onChange={e => setOrdenarPorUrgencia(e.target.checked)} className="w-3.5 h-3.5 accent-brand-cyan rounded" />
                        Ordenar por urgencia
                    </label>

                    {/* Simular hora (solo demo/pruebas): mueve el "ahora" del semáforo sin esperar
                        el tiempo real. Apagado por defecto — en planta corre con la hora real. */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-zinc-300 text-zinc-500">
                        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none whitespace-nowrap">
                            <input type="checkbox" checked={simActivo} onChange={e => setSimActivo(e.target.checked)} className="w-3.5 h-3.5 accent-amber-500 rounded" />
                            Simular hora <span className="text-zinc-400">(solo demo)</span>:
                        </label>
                        {simActivo && (
                            <>
                                <input
                                    type="range" min={0} max={1439} step={10}
                                    value={horaSimMin}
                                    onChange={e => setHoraSimMin(Number(e.target.value))}
                                    className="w-40 accent-brand-cyan"
                                />
                                <b className="text-xs text-zinc-700 font-mono whitespace-nowrap">
                                    {String(now.getUTCDate()).padStart(2, '0')}/{String(now.getUTCMonth() + 1).padStart(2, '0')} {String(Math.floor(horaSimMin / 60)).padStart(2, '0')}:{String(horaSimMin % 60).padStart(2, '0')}
                                </b>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {filtradas.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400 bg-zinc-50">
                    <i className="fa-solid fa-circle-check text-5xl text-zinc-200"></i>
                    <span className="text-sm font-medium">
                        {filtro ? `No hay órdenes en "${ESTADO_CFG[filtro].label}"` : 'No hay órdenes para mostrar'}
                    </span>
                </div>
            ) : (
                <div className="flex-1 overflow-auto bg-zinc-50 relative custom-scrollbar-alertas">
                    <table className="text-left border-collapse w-full text-xs tablet:text-[11px]">
                        <thead className="bg-zinc-100 sticky top-0 z-10 border-b-2 border-zinc-200 shadow-sm">
                            <tr>
                                {['Fecha', 'Prioridad', 'Orden', 'Cliente', 'Trabajo', 'Variante', 'Entrega comprometida', 'Cantidad', 'Estado General', 'Estado en Área', 'Lote', 'Máquina'].map((h, i) => (
                                    <th key={h} className={`py-3 px-2 text-[10px] font-black text-zinc-600 uppercase tracking-widest whitespace-nowrap border-r border-zinc-200/50 last:border-r-0 ${i === 6 ? 'text-left' : 'text-center'}`}>
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white">
                            {pagina.map(({ o, estado, rest, pct, deliveryDate }) => {
                                const cfg = ESTADO_CFG[estado];
                                const entryDate = o.entryDate ? new Date(o.entryDate) : null;
                                const label = estado === 'SIN_FECHA'
                                    ? 'Sin fecha compromiso'
                                    : estado === 'VENCIDA'
                                        ? `Vencida hace ${fmtDuracion(rest)}`
                                        : `Quedan ${fmtDuracion(rest)}`;
                                return (
                                    <tr
                                        key={o.id}
                                        onClick={() => onRowClick && onRowClick(o)}
                                        className={`cursor-pointer transition-colors border-b border-zinc-100 border-l-4 ${cfg.borde} ${cfg.row} hover:brightness-[0.98]`}
                                    >
                                        <td className="py-2 px-2 text-center whitespace-nowrap">
                                            {entryDate ? (
                                                <div className="flex flex-col leading-tight">
                                                    <span className="font-bold text-zinc-700">{fmtFechaHoraUTC(entryDate).split(' ')[0]}</span>
                                                    <span className="text-[10px] text-zinc-400">{fmtFechaHoraUTC(entryDate).split(' ')[1]}</span>
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="py-2 px-2 text-center"><PriorityBadge priority={o.priority} code={o.code} /></td>
                                        <td className="py-2 px-2 text-center font-bold text-brand-cyan whitespace-nowrap">{o.code || '-'}</td>
                                        <td className="py-2 px-2 text-center font-bold text-zinc-700 truncate max-w-[140px]">{o.client || '-'}</td>
                                        <td className="py-2 px-2 text-center text-zinc-700 truncate max-w-[160px]">{o.desc || '-'}</td>
                                        <td className="py-2 px-2 text-center text-zinc-500">{o.variantCode || '-'}</td>
                                        <td className="py-2 px-3 min-w-[180px]">
                                            <span className={`inline-flex items-center gap-1 font-extrabold text-[11px] px-2 py-0.5 rounded-full ${cfg.pill} ${cfg.pulse ? 'animate-pulse' : ''}`}>
                                                {cfg.icono} {label}
                                            </span>
                                            {deliveryDate && (
                                                <div className="text-[10px] text-zinc-400 mt-0.5">Compromiso {fmtFechaHoraUTC(deliveryDate)}</div>
                                            )}
                                            {deliveryDate && (
                                                <div className="h-1 bg-zinc-200 rounded mt-1 overflow-hidden">
                                                    <div className={`h-full ${estado === 'VENCIDA' ? 'bg-red-600' : estado === 'RIESGO' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }}></div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-2 px-2 text-center font-bold text-zinc-700 whitespace-nowrap">
                                            {o.magnitude ?? '-'}{o.unit ? ` ${o.unit}` : ''}
                                        </td>
                                        <td className="py-2 px-2 text-center text-zinc-600">{o.status || '-'}</td>
                                        <td className="py-2 px-2 text-center text-zinc-600">{o.areaStatus || '-'}</td>
                                        <td className="py-2 px-2 text-center">
                                            {o.rollId ? <span className="font-bold text-brand-cyan">{o.rollId}</span> : <span className="text-zinc-300">-</span>}
                                        </td>
                                        <td className="py-2 px-2 text-center text-zinc-600 whitespace-nowrap">{o.printer || '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {filtradas.length > 0 && (
                <div className="px-6 py-3 tablet:px-3 tablet:py-2 bg-white border-t border-zinc-200 flex items-center justify-between shrink-0">
                    <span className="text-xs font-bold text-zinc-500 flex items-center gap-2">
                        <span className="bg-zinc-100 text-zinc-600 px-2 py-1 rounded-md">Página {pageSafe + 1} de {totalPages}</span>
                        <span className="font-medium text-zinc-400">({filtradas.length} órdenes{filtro ? ` · ${ESTADO_CFG[filtro].label.toLowerCase()}` : ''})</span>
                        <span className="bg-brand-cyan/10 text-brand-cyan px-2 py-1 rounded-md font-bold">{totalMetros.toFixed(2)} m</span>
                    </span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setPageIndex(p => Math.max(0, p - 1))} disabled={pageSafe === 0}
                            className="px-3 h-8 flex items-center gap-1.5 text-xs font-bold bg-white text-zinc-600 border border-zinc-200 rounded-lg shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:text-brand-cyan">
                            <i className="fa-solid fa-angle-left"></i> Anterior
                        </button>
                        <button onClick={() => setPageIndex(p => Math.min(totalPages - 1, p + 1))} disabled={pageSafe >= totalPages - 1}
                            className="px-3 h-8 flex items-center gap-1.5 text-xs font-bold bg-white text-zinc-600 border border-zinc-200 rounded-lg shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:text-brand-cyan">
                            Siguiente <i className="fa-solid fa-angle-right"></i>
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                .custom-scrollbar-alertas::-webkit-scrollbar { width: 8px; height: 8px; }
                .custom-scrollbar-alertas::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar-alertas::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
                .custom-scrollbar-alertas::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
            `}</style>
        </div>
    );
}
