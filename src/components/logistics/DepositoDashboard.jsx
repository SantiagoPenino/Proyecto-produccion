import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import {
    Package, RefreshCcw, TrendingUp, ShoppingBag, AlertTriangle, Users, DollarSign, ArrowDown, ArrowUp,
    Boxes, Warehouse,
} from 'lucide-react';

// Estética nueva (22/10/2026, como Reportes y Logística): tarjetas blancas con borde, íconos de Lucide en brand-cyan sin
// fondo y el color solo para lo que es estado. Antes cada estado tenía su color (azul, índigo, violeta, celeste…):
// ahora son cinco tonos con significado — gris (ingresado), brand-cyan (en curso), ámbar (esperando algo),
// verde (listo / pagado) y rojo (problema). Los tipos de cliente no son estados: van todos en brand-cyan.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const TONOS = {
    neutro: { chip: 'bg-zinc-100 text-zinc-600 border-zinc-200',       bar: '#a1a1aa' },
    curso:  { chip: 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20', bar: '#006E97' },
    aviso:  { chip: 'bg-amber-50 text-amber-700 border-amber-200',     bar: '#f59e0b' },
    ok:     { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: '#10b981' },
    alerta: { chip: 'bg-rose-50 text-rose-700 border-rose-200',        bar: '#f43f5e' },
};
const estado = (tono, label) => ({ ...TONOS[tono], label });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ESTADO_COLORS = {
    1:  estado('neutro', 'Ingresado'),
    2:  estado('curso',  'Para imprimir'),
    3:  estado('curso',  'Impreso'),
    4:  estado('curso',  'Pronto'),
    5:  estado('aviso',  'Para avisar'),
    6:  estado('aviso',  'Avisado'),
    7:  estado('ok',     'Pronto p/ entregar'),
    8:  estado('curso',  'En camino'),
    12: estado('alerta', 'Avisar nuevamente'),
};
const RETIRO_ESTADO_COLORS = {
    1:  estado('neutro', 'Ingresado'),
    2:  estado('alerta', 'Pasar por caja'),
    3:  estado('curso',  'Abonado'),
    4:  estado('curso',  'Abonado antemano'),
    7:  estado('aviso',  'Empaq. sin abonar'),
    8:  estado('ok',     'Empaq. y abonado'),
    9:  estado('curso',  'Autorizado'),
    10: estado('curso',  'En viaje'),
};
const BAR_CATEGORIA = '#006E97';

const MetricCard = ({ icon: Icon, label, value, sub, valorCls = 'text-zinc-800', loading }) => (
    <div className={`${CARD} px-4 py-3 min-w-0`}>
        <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black text-zinc-400 uppercase tracking-wide truncate">{label}</span>
            <Icon size={16} className="shrink-0 text-brand-cyan" />
        </div>
        {loading
            ? <div className="h-8 mt-1 bg-zinc-100 rounded-lg animate-pulse w-20" />
            : <div className={`mt-1 text-2xl md:text-3xl font-black tabular-nums leading-tight ${valorCls}`}>{value}</div>
        }
        {sub && <div className="text-xs text-zinc-400 mt-0.5">{sub}</div>}
    </div>
);

const TituloTarjeta = ({ icon: Icon, children, extra }) => (
    <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-sm font-black text-zinc-800 flex items-center gap-2">
            <Icon size={16} className="text-brand-cyan shrink-0" /> {children}
        </h3>
        {extra}
    </div>
);

const BarChart = ({ data, labelKey = 'nombre', valueKey = 'total', colorMap, title, icon, loading }) => {
    const max = Math.max(1, ...data.map(d => d[valueKey] || 0));
    return (
        <div className={`${CARD} p-4 md:p-5`}>
            <TituloTarjeta icon={icon}>{title}</TituloTarjeta>
            {loading
                ? <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-6 bg-zinc-100 rounded-lg animate-pulse" />)}</div>
                : data.length === 0
                    ? <p className="text-zinc-400 text-sm text-center py-6">Sin datos</p>
                    : <div className="space-y-2.5">
                        {data.map((item, i) => {
                            const estadoKey = item.estado;
                            const cfg = colorMap?.[estadoKey];
                            // Estado sin configurar (ej. «Esperando Bultos»): gris, como su etiqueta en la tabla de abajo
                            const barColor = cfg?.bar || (colorMap ? TONOS.neutro.bar : BAR_CATEGORIA);
                            const pct = Math.max(2, Math.round((item[valueKey] / max) * 100));
                            return (
                                <div key={i} className="flex items-center gap-3">
                                    <span className="text-xs font-bold text-zinc-600 w-28 sm:w-32 truncate shrink-0">
                                        {cfg?.label || item[labelKey] || '–'}
                                    </span>
                                    <div className="flex-1 bg-zinc-100 rounded-full h-2.5 overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-700"
                                            style={{ width: `${pct}%`, backgroundColor: barColor }}
                                        />
                                    </div>
                                    <span className="text-xs font-black text-zinc-800 w-10 text-right tabular-nums">{item[valueKey]}</span>
                                </div>
                            );
                        })}
                    </div>
            }
        </div>
    );
};

const DonutChart = ({ parts, loading }) => {
    // parts: [{label, value, color}]
    const total = parts.reduce((s, p) => s + (p.value || 0), 0);
    if (loading) return <div className="h-28 bg-zinc-100 rounded-2xl animate-pulse" />;
    return (
        <div className="flex items-center gap-6">
            <div className="relative w-28 h-28 shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#f4f4f5" strokeWidth="3.8" />
                    {(() => {
                        let offset = 0;
                        return parts.map((p, i) => {
                            const pct = total > 0 ? (p.value / total) * 100 : 0;
                            const el = (
                                <circle key={i} cx="18" cy="18" r="15.9155"
                                    fill="none" stroke={p.color} strokeWidth="3.8"
                                    strokeDasharray={`${pct} ${100 - pct}`}
                                    strokeDashoffset={-offset}
                                />
                            );
                            offset += pct;
                            return el;
                        });
                    })()}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-black text-zinc-800 tabular-nums">{total}</span>
                </div>
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
                {parts.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="text-xs text-zinc-600 font-medium">{p.label}</span>
                        <span className="text-xs font-black text-zinc-800 ml-auto pl-3 tabular-nums">{p.value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Main component ───────────────────────────────────────────────────────────
const DepositoDashboard = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/dashboard/deposito');
            setData(res.data);
            setLastUpdate(new Date());
        } catch (e) {
            console.error('[DepositoDashboard]', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const timer = setInterval(load, 60000); // auto-refresh cada 1 min
        return () => clearInterval(timer);
    }, [load]);

    const d = data || {};

    const pagoParts = [
        { label: 'Pagadas', value: +(d.pagas || 0), color: TONOS.ok.bar },
        { label: 'Pend. de pago', value: +(d.pendientesPago || 0), color: TONOS.alerta.bar },
    ];

    const retirosParts = [
        { label: 'Por empaquetar', value: +(d.retirosPorEmpaquetar || 0), color: TONOS.aviso.bar },
        { label: 'Por levantar', value: +(d.retirosPorLevantar || 0), color: TONOS.ok.bar },
    ];

    return (
        <div className="p-3 md:p-6 bg-slate-50 min-h-full flex flex-col gap-4 font-sans text-zinc-800">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <Warehouse size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Dashboard depósito</h1>
                        <p className="text-sm text-zinc-400">
                            {lastUpdate ? `Actualizado: ${lastUpdate.toLocaleTimeString('es-UY')}` : 'Cargando...'}
                            <span className="ml-1 text-zinc-300">· se actualiza solo cada 60 s</span>
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
                    title="Actualizar"
                    aria-label="Actualizar"
                >
                    <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* ── KPI Cards ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <MetricCard icon={Boxes} label="Activas en depósito" value={d.totalActivas ?? '–'} loading={loading} sub="órdenes activas" />
                <MetricCard icon={ArrowDown} label="Entraron hoy" value={d.entraronHoy ?? '–'} loading={loading} sub="nuevas hoy" />
                <MetricCard icon={ArrowUp} label="Despachadas hoy" value={d.despachadasHoy ?? '–'} loading={loading} sub="estado Entregado hoy" />
                <MetricCard icon={Package} label="Retiros activos" value={d.retirosActivos ?? '–'} loading={loading} sub="órdenes de retiro" />
                <MetricCard icon={AlertTriangle} label="Sin pago" value={d.pendientesPago ?? '–'} valorCls={d.pendientesPago > 0 ? 'text-rose-600' : 'text-zinc-800'} loading={loading} sub="pendientes de cobro" />
            </div>

            {/* ── Fila 2: Bar charts ──────────────────────────────────────── */}
            <div className="grid lg:grid-cols-2 gap-3">
                <BarChart
                    title="Órdenes de depósito por estado"
                    icon={Boxes}
                    data={d.ordenesPorEstado || []}
                    labelKey="nombre"
                    valueKey="total"
                    colorMap={ESTADO_COLORS}
                    loading={loading}
                />
                <BarChart
                    title="Órdenes de retiro por estado"
                    icon={Package}
                    data={d.retirosPorEstado || []}
                    labelKey="nombre"
                    valueKey="total"
                    colorMap={RETIRO_ESTADO_COLORS}
                    loading={loading}
                />
            </div>

            {/* ── Fila 3: Donuts + tipo cliente ───────────────────────────── */}
            <div className="grid lg:grid-cols-3 gap-3">
                {/* Pago */}
                <div className={`${CARD} p-4 md:p-5`}>
                    <TituloTarjeta icon={DollarSign}>Estado de pago</TituloTarjeta>
                    <DonutChart parts={pagoParts} loading={loading} />
                </div>

                {/* Retiros empaquetar/levantar */}
                <div className={`${CARD} p-4 md:p-5`}>
                    <TituloTarjeta icon={ShoppingBag}>Retiros pendientes</TituloTarjeta>
                    <DonutChart parts={retirosParts} loading={loading} />
                    {/* Mini summary */}
                    <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                            <div className="text-2xl font-black text-amber-600 tabular-nums">{d.retirosPorEmpaquetar ?? '–'}</div>
                            <div className="text-[10px] font-black text-amber-700 uppercase tracking-wide">Por empaquetar</div>
                        </div>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                            <div className="text-2xl font-black text-emerald-600 tabular-nums">{d.retirosPorLevantar ?? '–'}</div>
                            <div className="text-[10px] font-black text-emerald-700 uppercase tracking-wide">Por levantar</div>
                        </div>
                    </div>
                </div>

                {/* Tipo cliente bar */}
                <div className={`${CARD} p-4 md:p-5`}>
                    <TituloTarjeta icon={Users}>Por tipo de cliente</TituloTarjeta>
                    {loading
                        ? <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-6 bg-zinc-100 rounded-lg animate-pulse" />)}</div>
                        : (d.porTipoCliente || []).length === 0
                            ? <p className="text-zinc-400 text-sm text-center py-4">Sin datos</p>
                            : (() => {
                                const maxT = Math.max(1, ...(d.porTipoCliente || []).map(t => t.total));
                                return (
                                    <div className="space-y-2.5">
                                        {(d.porTipoCliente || []).map((t, i) => (
                                            <div key={i} className="flex items-center gap-3">
                                                <span className="text-xs text-zinc-600 font-bold w-28 truncate shrink-0" title={t.tipo}>{t.tipo || '–'}</span>
                                                <div className="flex-1 bg-zinc-100 rounded-full h-2.5 overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-700"
                                                        style={{ width: `${Math.max(2, Math.round((t.total / maxT) * 100))}%`, backgroundColor: BAR_CATEGORIA }}
                                                    />
                                                </div>
                                                <span className="text-xs font-black text-zinc-800 w-10 text-right tabular-nums">{t.total}</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()
                    }
                </div>
            </div>

            {/* ── Fila 4: Tabla detalle por estado ─────────────────────────── */}
            <div className={`${CARD} overflow-hidden`}>
                <div className="px-4 md:px-5 py-3 border-b border-zinc-200 flex items-center justify-between gap-2">
                    <h3 className="font-black text-zinc-800 text-sm flex items-center gap-2">
                        <TrendingUp size={16} className="text-brand-cyan shrink-0" /> Detalle de órdenes activas por estado
                    </h3>
                    {!loading && <span className="text-xs text-zinc-400 tabular-nums">{d.totalActivas} total</span>}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                <th className="px-4 md:px-5 py-2.5 text-left">Estado</th>
                                <th className="px-4 md:px-5 py-2.5 text-right">Cantidad</th>
                                <th className="px-4 md:px-5 py-2.5 text-right">% del total</th>
                                <th className="px-4 md:px-5 py-2.5 text-left hidden sm:table-cell">Distribución</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {loading
                                ? [...Array(4)].map((_, i) => (
                                    <tr key={i}><td colSpan={4} className="px-5 py-3"><div className="h-5 bg-zinc-100 rounded animate-pulse" /></td></tr>
                                ))
                                : (d.ordenesPorEstado || []).map((row) => {
                                    const cfg = ESTADO_COLORS[row.estado] || { ...TONOS.neutro, label: row.nombre };
                                    const pct = d.totalActivas > 0 ? Math.round((row.total / d.totalActivas) * 100) : 0;
                                    return (
                                        <tr key={row.estado} className="hover:bg-zinc-50 transition-colors">
                                            <td className="px-4 md:px-5 py-2.5">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${cfg.chip}`}>
                                                    {cfg.label || row.nombre || `Estado ${row.estado}`}
                                                </span>
                                            </td>
                                            <td className="px-4 md:px-5 py-2.5 text-right font-black text-zinc-800 text-base tabular-nums">{row.total}</td>
                                            <td className="px-4 md:px-5 py-2.5 text-right font-bold text-zinc-500 tabular-nums">{pct}%</td>
                                            <td className="px-4 md:px-5 py-2.5 w-48 hidden sm:table-cell">
                                                <div className="bg-zinc-100 rounded-full h-2 w-full overflow-hidden">
                                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cfg.bar }} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            }
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
};

export default DepositoDashboard;
