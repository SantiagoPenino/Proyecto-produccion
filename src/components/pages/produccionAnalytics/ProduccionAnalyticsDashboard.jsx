import { useState, useEffect, useCallback } from 'react';
import api from '../../../services/apiClient';
import {
    BarChart2, Package, Users, AlertTriangle, XCircle,
    TrendingUp, RefreshCw, CheckCircle, Clock,
} from 'lucide-react';

// ─── Presets de fecha ─────────────────────────────────────────────────────────
const PRESETS = [
    { label: 'Hoy',     value: 'hoy' },
    { label: 'Ayer',    value: 'ayer' },
    { label: '7 días',  value: '7d' },
    { label: '30 días', value: '30d' },
    { label: '90 días', value: '90d' },
];

function getDateRange(preset) {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (preset) {
        case 'hoy':  return { desde: today, hasta: now };
        case 'ayer': { const d = new Date(today); d.setDate(d.getDate()-1); const e = new Date(d); e.setHours(23,59,59,999); return { desde: d, hasta: e }; }
        case '7d':   { const d = new Date(today); d.setDate(d.getDate()-7);  return { desde: d, hasta: now }; }
        case '30d':  { const d = new Date(today); d.setDate(d.getDate()-30); return { desde: d, hasta: now }; }
        case '90d':  { const d = new Date(today); d.setDate(d.getDate()-90); return { desde: d, hasta: now }; }
        default:     return { desde: null, hasta: null };
    }
}

const toISO = d => d ? d.toISOString().slice(0, 10) : '';
const fmt   = (n, dec = 2) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color, bg }) {
    return (
        <div className={`rounded-xl border border-slate-100 p-4 flex items-start gap-3 shadow-sm ${bg || 'bg-white'}`}>
            <div className={`p-2 rounded-lg ${color}`}>
                <Icon size={18} className="text-white" />
            </div>
            <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">{label}</p>
                <p className="text-xl font-bold text-slate-800 leading-tight">{value}</p>
                {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

// ─── Mini bar chart SVG ───────────────────────────────────────────────────────
function TendenciaChart({ data }) {
    if (!data || data.length === 0) {
        return <div className="flex items-center justify-center h-32 text-slate-400 text-xs">Sin datos</div>;
    }

    const maxM  = Math.max(...data.map(d => Number(d.Metros || 0)), 1);
    const W     = 700;
    const H     = 120;
    const BAR_W = Math.max(4, Math.floor((W - 40) / data.length) - 2);
    const GAP   = Math.floor((W - 40) / data.length);

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
            {data.map((d, i) => {
                const metros = Number(d.Metros || 0);
                const barH   = Math.max(2, Math.round((metros / maxM) * (H - 20)));
                const x      = 20 + i * GAP;
                const y      = H - barH;
                return (
                    <g key={i}>
                        <rect x={x} y={y} width={BAR_W} height={barH}
                            rx={2} fill="#06b6d4" opacity={0.8} />
                        <title>{d.Dia}: {fmt(metros)} m²</title>
                    </g>
                );
            })}
        </svg>
    );
}

// ─── Pie chart SVG ────────────────────────────────────────────────────────────
const COLORS = ['#06b6d4','#8b5cf6','#f59e0b','#10b981','#f43f5e','#3b82f6','#84cc16','#f97316'];

function PieChart({ data, valueKey = 'TotalMetros', labelKey = 'Material' }) {
    if (!data || data.length === 0) return null;
    const total = data.reduce((s, d) => s + Number(d[valueKey] || 0), 0);
    if (total === 0) return null;

    let cumAngle = -Math.PI / 2;
    const slices = data.slice(0, 6).map((d, i) => {
        const val   = Number(d[valueKey] || 0);
        const angle = (val / total) * 2 * Math.PI;
        const start = cumAngle;
        cumAngle   += angle;
        return { ...d, val, angle, start, end: cumAngle, color: COLORS[i % COLORS.length] };
    });

    const arc = (cx, cy, r, startAngle, endAngle) => {
        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const large = endAngle - startAngle > Math.PI ? 1 : 0;
        return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    };

    return (
        <div className="flex items-center gap-4">
            <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0">
                {slices.map((s, i) => (
                    <path key={i} d={arc(50, 50, 46, s.start, s.end)} fill={s.color} opacity={0.9}>
                        <title>{s[labelKey]}: {fmt(s.val)} m²</title>
                    </path>
                ))}
            </svg>
            <div className="min-w-0 flex flex-col gap-1">
                {slices.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs truncate">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                        <span className="text-slate-600 truncate">{s[labelKey]}</span>
                        <span className="text-slate-400 shrink-0">{fmt(s.val)} m²</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Tabla top clientes ───────────────────────────────────────────────────────
function TopClientesTable({ data }) {
    if (!data || data.length === 0) return <p className="text-xs text-slate-400 p-3">Sin datos</p>;
    const max = Math.max(...data.map(d => Number(d.TotalMetros || 0)), 1);

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-slate-100">
                        <th className="text-left py-2 px-3 text-slate-400 font-semibold">#</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-semibold">Cliente</th>
                        <th className="text-right py-2 px-3 text-slate-400 font-semibold">Órdenes</th>
                        <th className="text-right py-2 px-3 text-slate-400 font-semibold">Metros m²</th>
                        <th className="py-2 px-3 text-slate-400 font-semibold w-28">Volumen</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => {
                        const metros = Number(row.TotalMetros || 0);
                        const pct    = Math.round((metros / max) * 100);
                        return (
                            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                                <td className="py-2 px-3 text-slate-300 font-mono">{i + 1}</td>
                                <td className="py-2 px-3 text-slate-700 font-medium max-w-[160px] truncate">{row.Cliente}</td>
                                <td className="py-2 px-3 text-slate-500 text-right tabular-nums">{Number(row.Ordenes || 0).toLocaleString()}</td>
                                <td className="py-2 px-3 text-brand-cyan font-bold text-right tabular-nums">{fmt(metros)}</td>
                                <td className="py-2 px-3">
                                    <div className="bg-slate-100 rounded-full h-1.5 w-full">
                                        <div className="bg-brand-cyan h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function ProduccionAnalyticsDashboard() {
    const [preset,    setPreset]    = useState('30d');
    const [area,      setArea]      = useState('Todas');
    const [areas,     setAreas]     = useState([]);
    const [data,      setData]      = useState(null);
    const [loading,   setLoading]   = useState(false);
    const [error,     setError]     = useState(null);

    // Cargar filtros
    useEffect(() => {
        api.get('/produccion-analytics/filtros').then(r => setAreas(r.data.areas || [])).catch(() => {});
    }, []);

    const fetchDashboard = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { desde, hasta } = getDateRange(preset);
            const params = {
                ...(area !== 'Todas' && { area }),
                ...(desde && { fechaDesde: toISO(desde) }),
                ...(hasta && { fechaHasta: toISO(hasta) }),
            };
            const res = await api.get('/produccion-analytics/dashboard', { params });
            setData(res.data);
        } catch (e) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setLoading(false);
        }
    }, [preset, area]);

    useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

    const kpis = data?.kpis || {};

    return (
        <div className="flex flex-col h-full bg-slate-50 overflow-auto">
            {/* Header */}
            <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <BarChart2 size={18} className="text-brand-cyan" />
                    <span className="font-bold text-slate-800 text-sm">Dashboard Analítico</span>
                </div>
                <button onClick={fetchDashboard} disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition">
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            {/* Filtros */}
            <div className="bg-white border-b border-slate-100 px-5 py-2.5 flex items-center gap-4 shrink-0 flex-wrap">
                <div className="flex items-center gap-1">
                    {PRESETS.map(p => (
                        <button key={p.value} onClick={() => setPreset(p.value)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition
                                ${preset === p.value
                                    ? 'bg-brand-cyan text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                            {p.label}
                        </button>
                    ))}
                </div>
                <select value={area} onChange={e => setArea(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 bg-white">
                    <option value="Todas">Todas las áreas</option>
                    {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
            </div>

            {error && (
                <div className="mx-5 mt-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-xs">{error}</div>
            )}

            <div className="flex-1 p-5 overflow-auto">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                    <KpiCard icon={TrendingUp}    label="Total Órdenes"        value={Number(kpis.totalOrdenes||0).toLocaleString()}   sub={`${Number(kpis.activas||0)} activas`} color="bg-brand-cyan"  />
                    <KpiCard icon={Package}        label="Metros Producidos"    value={`${fmt(kpis.totalMetros)} m²`}                   sub={`${Number(kpis.completadas||0)} completadas`} color="bg-violet-500" />
                    <KpiCard icon={AlertTriangle}  label="Fallas"               value={Number(kpis.totalFallas||0).toLocaleString()}    sub={`${fmt(kpis.metrosFalla)} m² en falla`}     color="bg-orange-500" />
                    <KpiCard icon={XCircle}        label="Cancelaciones"        value={Number(kpis.totalCancelaciones||0).toLocaleString()} sub={`Tasa falla: ${kpis.tasaFalla}%`}       color="bg-red-500"    />
                </div>

                {/* Segunda fila de KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                    <KpiCard icon={CheckCircle}  label="Completadas"           value={Number(kpis.completadas||0).toLocaleString()} color="bg-emerald-500" />
                    <KpiCard icon={Clock}        label="Activas (en curso)"    value={Number(kpis.activas||0).toLocaleString()}     color="bg-blue-500"   />
                    <KpiCard icon={AlertTriangle} label="Metros en Falla"      value={`${fmt(kpis.metrosFalla)} m²`}               color="bg-orange-400" />
                    <KpiCard icon={XCircle}      label="Metros Cancelados"     value={`${fmt(kpis.metrosCancelaciones)} m²`}       color="bg-red-400"    />
                </div>

                {/* Gráfico tendencia + Distribución material */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                    <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                        <h3 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-2">
                            <TrendingUp size={13} className="text-brand-cyan" />
                            Tendencia de Metros Producidos
                        </h3>
                        {loading
                            ? <div className="h-32 flex items-center justify-center text-slate-300 text-xs">Cargando...</div>
                            : <TendenciaChart data={data?.tendencia} />
                        }
                        {data?.tendencia?.length > 0 && (
                            <p className="text-[10px] text-slate-400 mt-1 text-center">
                                {data.tendencia[0]?.Dia} → {data.tendencia[data.tendencia.length-1]?.Dia}
                            </p>
                        )}
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                        <h3 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-2">
                            <Package size={13} className="text-violet-500" />
                            Distribución por Material
                        </h3>
                        {loading
                            ? <div className="h-32 flex items-center justify-center text-slate-300 text-xs">Cargando...</div>
                            : <PieChart data={data?.porMaterial} valueKey="TotalMetros" labelKey="Material" />
                        }
                    </div>
                </div>

                {/* Top Clientes */}
                <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 mb-4">
                    <h3 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-2">
                        <Users size={13} className="text-brand-cyan" />
                        Top Clientes por Volumen
                    </h3>
                    {loading
                        ? <div className="h-20 flex items-center justify-center text-slate-300 text-xs">Cargando...</div>
                        : <TopClientesTable data={data?.topClientes} />
                    }
                </div>

                {/* Tabla por material */}
                <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                    <h3 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-2">
                        <Package size={13} className="text-violet-500" />
                        Volumen por Material
                    </h3>
                    {loading
                        ? <div className="h-20 flex items-center justify-center text-slate-300 text-xs">Cargando...</div>
                        : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-100">
                                            <th className="text-left py-2 px-3 text-slate-400 font-semibold">Material</th>
                                            <th className="text-right py-2 px-3 text-slate-400 font-semibold">Órdenes</th>
                                            <th className="text-right py-2 px-3 text-slate-400 font-semibold">Total m²</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(data?.porMaterial || []).map((row, i) => (
                                            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                                                <td className="py-2 px-3 text-slate-700 font-medium">{row.Material}</td>
                                                <td className="py-2 px-3 text-slate-500 text-right tabular-nums">{Number(row.Ordenes||0).toLocaleString()}</td>
                                                <td className="py-2 px-3 text-violet-600 font-bold text-right tabular-nums">{fmt(row.TotalMetros)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    }
                </div>
            </div>
        </div>
    );
}
