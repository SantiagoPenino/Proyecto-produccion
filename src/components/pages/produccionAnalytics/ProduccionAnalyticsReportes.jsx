import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../../services/apiClient';
import {
    Printer, FileSpreadsheet, ClipboardList, BarChart2,
    Package, AlertTriangle, XCircle, RefreshCw, Search,
} from 'lucide-react';

// ─── Reportes disponibles (sin turno) ────────────────────────────────────────
const REPORTS = [
    { id: 'fallas-reposiciones', label: 'Fallas y Reposiciones', icon: AlertTriangle, color: 'text-orange-500' },
    { id: 'cancelaciones',       label: 'Cancelaciones',         icon: XCircle,       color: 'text-red-500'    },
    { id: 'ordenes',             label: 'Órdenes',               icon: ClipboardList, color: 'text-sky-500'    },
    { id: 'metros-material',     label: 'Metros por Material',   icon: Package,       color: 'text-violet-500' },
    { id: 'clientes',            label: 'Volumen por Cliente',   icon: BarChart2,     color: 'text-brand-cyan' },
];

const COLUMNS = {
    'fallas-reposiciones': [
        { key: 'Fecha',       label: 'Fecha' },
        { key: 'CodigoOrden', label: 'Código Orden' },
        { key: 'Cliente',     label: 'Cliente' },
        { key: 'Metros',      label: 'Metros' },
        { key: 'Material',    label: 'Material' },
        { key: 'Causa',       label: 'Causa / Observación' },
        { key: 'Estado',      label: 'Estado' },
    ],
    cancelaciones: [
        { key: 'FechaIngreso',        label: 'Fecha Ingreso' },
        { key: 'CodigoOrden',         label: 'Código Orden' },
        { key: 'Cliente',             label: 'Cliente' },
        { key: 'Metros',              label: 'Metros' },
        { key: 'Estado',              label: 'Estado' },
        { key: 'Material',            label: 'Material' },
        { key: 'FechaCancelacion',    label: 'Fecha Cancelación' },
        { key: 'MotivoCancelacion',   label: 'Motivo' },
        { key: 'CanceladoPor',        label: 'Cancelado Por' },
    ],
    ordenes: [
        { key: 'CodigoOrden',   label: 'Código' },
        { key: 'FechaIngreso',  label: 'Fecha Ingreso' },
        { key: 'Estado',        label: 'Estado' },
        { key: 'Area',          label: 'Área' },
        { key: 'Material',      label: 'Material' },
        { key: 'Metros',        label: 'Metros' },
        { key: 'Cliente',       label: 'Cliente' },
        { key: 'Observaciones', label: 'Observaciones' },
    ],
    'metros-material': [
        { key: 'Material',       label: 'Material' },
        { key: 'Ordenes',        label: 'Órdenes' },
        { key: 'TotalMetros',    label: 'Total Metros' },
        { key: 'Activas',        label: 'Activas' },
        { key: 'Completadas',    label: 'Completadas' },
        { key: 'PromedioMetros', label: 'Promedio m²' },
    ],
    clientes: [
        { key: 'Cliente',     label: 'Cliente' },
        { key: 'Ordenes',     label: 'Órdenes' },
        { key: 'TotalMetros', label: 'Total Metros' },
        { key: 'Activas',     label: 'Activas' },
        { key: 'Completadas', label: 'Completadas' },
        { key: 'UltimaOrden', label: 'Última Orden' },
    ],
};

const FECHA_PRESETS = [
    { label: 'Hoy',           value: 'hoy'    },
    { label: 'Ayer',          value: 'ayer'   },
    { label: '7 días',        value: '7d'     },
    { label: '30 días',       value: '30d'    },
    { label: '90 días',       value: '90d'    },
    { label: 'Personalizado', value: 'custom' },
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
const METRO_KEYS = new Set(['Metros','TotalMetros','PromedioMetros','MetrosAfectados']);

// ─── Badges ───────────────────────────────────────────────────────────────────
const ESTADO_CLS = {
    'Entregado': 'bg-emerald-100 text-emerald-700',
    'Finalizado': 'bg-emerald-100 text-emerald-700',
    'Pronto': 'bg-emerald-100 text-emerald-700',
    'Cancelado': 'bg-red-100 text-red-600',
    'Anulado': 'bg-red-100 text-red-600',
    'Con Falla': 'bg-orange-100 text-orange-700',
    'CON FALLA': 'bg-orange-100 text-orange-700',
    'En Proceso': 'bg-blue-100 text-blue-700',
    'Pendiente': 'bg-slate-100 text-slate-500',
};

function EstadoBadge({ estado }) {
    if (!estado) return <span className="text-slate-400">—</span>;
    const key = Object.keys(ESTADO_CLS).find(k => k.toLowerCase() === estado.toLowerCase());
    const cls = ESTADO_CLS[key] || 'bg-slate-100 text-slate-600';
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>{estado}</span>;
}

function Cell({ col, value }) {
    if (col.key === 'Estado') return <EstadoBadge estado={value} />;
    if (METRO_KEYS.has(col.key)) return (
        <span className="font-mono tabular-nums">
            {Number(value || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
        </span>
    );
    if (typeof value === 'string' && value.length > 60)
        return <span className="text-slate-500 text-[11px] leading-tight">{value}</span>;
    return <span className="text-slate-600">{value ?? '—'}</span>;
}

// ─── KPI Strip ────────────────────────────────────────────────────────────────
function KpiChip({ label, value, cls }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-slate-400">{label}:</span>
            <span className={`font-bold ${cls}`}>{value}</span>
        </div>
    );
}

function KpisStrip({ activeReport, totales }) {
    if (!totales || !Object.keys(totales).length) return null;
    const loc = n => Number(n || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 });

    const base = 'bg-white border-b border-slate-100 px-5 py-2 flex items-center gap-6 text-xs shrink-0 flex-wrap';

    if (activeReport === 'fallas-reposiciones') return (
        <div className={base}>
            <KpiChip label="Fallas"          value={loc(totales.totalFallas)}       cls="text-orange-600" />
            <KpiChip label="Reposiciones"    value={loc(totales.totalReposiciones)} cls="text-violet-600" />
            <KpiChip label="Metros en falla" value={`${loc(totales.metrosFalla)} m²`}      cls="text-orange-600" />
            <KpiChip label="Metros repos."   value={`${loc(totales.metrosReposicion)} m²`} cls="text-violet-600" />
        </div>
    );
    if (activeReport === 'cancelaciones') return (
        <div className={base}>
            <KpiChip label="Total canceladas" value={loc(totales.total)}       cls="text-red-600"     />
            <KpiChip label="Metros totales"   value={`${loc(totales.totalMetros)} m²`} cls="text-slate-700" />
            <KpiChip label="Con motivo"       value={loc(totales.conMotivo)}   cls="text-emerald-600" />
            <KpiChip label="Sin motivo"       value={loc(totales.sinMotivo)}   cls="text-amber-600"   />
        </div>
    );
    if (activeReport === 'ordenes') return (
        <div className={base}>
            <KpiChip label="Total"       value={loc(totales.total)}       cls="text-slate-700"   />
            <KpiChip label="Metros"      value={`${loc(totales.totalMetros)} m²`} cls="text-brand-cyan" />
            <KpiChip label="Activas"     value={loc(totales.activas)}     cls="text-amber-600"   />
            <KpiChip label="Completadas" value={loc(totales.completadas)} cls="text-emerald-600" />
        </div>
    );
    return null;
}

// ─── Print helper ─────────────────────────────────────────────────────────────
function printReport({ reportLabel, cols, data, groupedData }) {
    const fecha = new Date().toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const buildTable = (title, rows, color = '#0891b2') => `
        <div style="margin-bottom:12px">
            <div style="border-left:4px solid ${color};padding-left:8px;margin-bottom:6px;font-size:12px;font-weight:700;color:${color}">
                ${title} <span style="font-weight:400;color:#888;font-size:10px">— ${rows.length} registros</span>
            </div>
            <table style="width:100%;border-collapse:collapse">
                <thead><tr>${['#',...cols.map(c=>`<th style="background:#f1f5f9;padding:5px 7px;text-align:left;border:1px solid #cbd5e1;font-size:9px;font-weight:700;color:#475569">${c.label}</th>`)].join('')}</tr></thead>
                <tbody>${rows.map((r,i)=>`<tr style="${i%2===0?'background:#f8fafc':''}">
                    <td style="padding:4px 7px;border:1px solid #e2e8f0;font-size:9px;color:#94a3b8">${i+1}</td>
                    ${cols.map(c=>`<td style="padding:4px 7px;border:1px solid #e2e8f0;font-size:9px">${r[c.key]??''}</td>`).join('')}
                </tr>`).join('')}</tbody>
            </table>
        </div>`;

    let body = groupedData
        ? buildTable('Fallas', groupedData.fallas, '#ea580c') + buildTable('Reposiciones', groupedData.reposiciones, '#7c3aed')
        : buildTable(reportLabel, data);

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${reportLabel}</title>
        <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10px;color:#222;padding:20px}
        h1{font-size:15px;font-weight:700;margin-bottom:2px}.meta{color:#888;font-size:10px;margin-bottom:14px}
        @media print{body{padding:10px}}</style></head><body>
        <h1>${reportLabel}</h1><div class="meta">Generado el ${fecha}</div>${body}
        <script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ProduccionAnalyticsReportes() {
    const [activeReport, setActiveReport] = useState('fallas-reposiciones');
    const [filters, setFilters] = useState({
        area: 'Todas', fechaPreset: '30d',
        material: '', clienteSearch: '',
        customDesde: '', customHasta: '',
    });
    const [filtrosData, setFiltrosData] = useState({ areas: [], materiales: [], clientes: [] });
    const [data,    setData]    = useState([]);
    const [grouped, setGrouped] = useState(null);
    const [totales, setTotales] = useState({});
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState(null);
    const clienteInputRef = useRef(null);

    useEffect(() => {
        api.get('/produccion-analytics/filtros')
            .then(r => setFiltrosData(r.data))
            .catch(() => {});
    }, []);

    const fetchReport = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let fechaDesde, fechaHasta;
            if (filters.fechaPreset === 'custom') {
                fechaDesde = filters.customDesde;
                fechaHasta = filters.customHasta;
            } else {
                const { desde, hasta } = getDateRange(filters.fechaPreset);
                fechaDesde = toISO(desde);
                fechaHasta = toISO(hasta);
            }

            const params = {
                ...(filters.area !== 'Todas' && { area: filters.area }),
                ...(fechaDesde && { fechaDesde }),
                ...(fechaHasta && { fechaHasta }),
                ...(filters.material && { material: filters.material }),
                ...(filters.clienteSearch && { clienteSearch: filters.clienteSearch }),
            };

            const endpointMap = {
                'fallas-reposiciones': '/produccion-analytics/reporte/fallas-reposiciones',
                cancelaciones:         '/produccion-analytics/reporte/cancelaciones',
                ordenes:               '/produccion-analytics/reporte/ordenes',
                'metros-material':     '/produccion-analytics/reporte/metros-material',
                clientes:              '/produccion-analytics/reporte/clientes',
            };

            const res = await api.get(endpointMap[activeReport], { params });
            const d   = res.data;

            if (activeReport === 'fallas-reposiciones') {
                setGrouped({ fallas: d.fallas || [], reposiciones: d.reposiciones || [] });
                setData([]);
                setTotales(d.totales || {});
            } else {
                setGrouped(null);
                setData(d.data || []);
                setTotales(d.totales || {});
            }
        } catch (e) {
            setError(e.response?.data?.error || e.message);
        } finally {
            setLoading(false);
        }
    }, [activeReport, filters]);

    useEffect(() => { fetchReport(); }, [fetchReport]);

    const cols = COLUMNS[activeReport] || [];
    const currentReport = REPORTS.find(r => r.id === activeReport);
    const totalRows = grouped ? (grouped.fallas.length + grouped.reposiciones.length) : data.length;

    const handlePrint = () => {
        printReport({
            reportLabel: currentReport?.label || '',
            cols,
            data,
            groupedData: grouped,
        });
    };

    return (
        <div className="flex h-full bg-slate-50 overflow-hidden">
            {/* Sidebar */}
            <aside className="w-52 shrink-0 bg-white border-r border-slate-100 flex flex-col py-3">
                <div className="px-4 mb-3 flex items-center gap-2">
                    <FileSpreadsheet size={15} className="text-brand-cyan" />
                    <span className="font-bold text-slate-700 text-sm">Reportes</span>
                </div>
                {REPORTS.map(r => {
                    const Icon = r.icon;
                    const active = activeReport === r.id;
                    return (
                        <button key={r.id} onClick={() => setActiveReport(r.id)}
                            className={`flex items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium transition
                                ${active ? 'bg-slate-50 border-r-2 border-brand-cyan text-slate-800' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
                            <Icon size={14} className={active ? r.color : ''} />
                            {r.label}
                        </button>
                    );
                })}
            </aside>

            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Filtros header */}
                <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center gap-3 shrink-0 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                        <currentReport.icon size={13} className={currentReport.color} />
                        {currentReport?.label}
                    </div>

                    {/* Área */}
                    <select value={filters.area} onChange={e => setFilters(f => ({ ...f, area: e.target.value }))}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 bg-white">
                        <option value="Todas">Todas</option>
                        {filtrosData.areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>

                    {/* Fecha presets */}
                    <div className="flex items-center gap-1">
                        {FECHA_PRESETS.map(p => (
                            <button key={p.value} onClick={() => setFilters(f => ({ ...f, fechaPreset: p.value }))}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition
                                    ${filters.fechaPreset === p.value
                                        ? 'bg-brand-cyan text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Custom date range */}
                    {filters.fechaPreset === 'custom' && (
                        <div className="flex items-center gap-1.5">
                            <input type="date" value={filters.customDesde}
                                onChange={e => setFilters(f => ({ ...f, customDesde: e.target.value }))}
                                className="border border-slate-200 rounded px-2 py-1 text-xs" />
                            <span className="text-slate-400 text-xs">—</span>
                            <input type="date" value={filters.customHasta}
                                onChange={e => setFilters(f => ({ ...f, customHasta: e.target.value }))}
                                className="border border-slate-200 rounded px-2 py-1 text-xs" />
                        </div>
                    )}

                    {/* Material */}
                    <select value={filters.material} onChange={e => setFilters(f => ({ ...f, material: e.target.value }))}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 bg-white min-w-[140px]">
                        <option value="">Todos los materiales</option>
                        {filtrosData.materiales.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                    </select>

                    {/* Cliente search */}
                    <div className="relative">
                        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input ref={clienteInputRef} type="text" placeholder="Buscar cliente..."
                            value={filters.clienteSearch}
                            onChange={e => setFilters(f => ({ ...f, clienteSearch: e.target.value }))}
                            className="border border-slate-200 rounded-lg pl-6 pr-2 py-1 text-xs w-36" />
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                        <button onClick={fetchReport} disabled={loading}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition">
                            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={handlePrint}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition">
                            <Printer size={12} />
                            Imprimir PDF
                        </button>
                    </div>
                </div>

                {/* KPI Strip */}
                <KpisStrip activeReport={activeReport} totales={totales} />

                {error && (
                    <div className="mx-5 mt-3 px-4 py-2 bg-red-50 border border-red-100 rounded text-red-600 text-xs">{error}</div>
                )}

                {/* Table */}
                <div className="flex-1 overflow-auto px-5 py-4">
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <RefreshCw size={20} className="animate-spin text-brand-cyan" />
                        </div>
                    ) : grouped ? (
                        <div className="flex flex-col gap-6">
                            {[
                                { key: 'fallas',      label: 'Fallas',       color: '#ea580c', rows: grouped.fallas },
                                { key: 'reposiciones',label: 'Reposiciones', color: '#7c3aed', rows: grouped.reposiciones },
                            ].map(({ key, label, color, rows }) => (
                                <div key={key}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-1 h-4 rounded" style={{ background: color }} />
                                        <span className="text-xs font-bold" style={{ color }}>
                                            {label} <span className="font-normal text-slate-400">— {rows.length} registros</span>
                                        </span>
                                    </div>
                                    <SimpleTable rows={rows} cols={cols} />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div>
                            <p className="text-xs text-slate-400 mb-2">{totalRows} registros</p>
                            <SimpleTable rows={data} cols={cols} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function SimpleTable({ rows, cols }) {
    if (!rows || rows.length === 0) return (
        <p className="text-xs text-slate-400 py-4">Sin registros</p>
    );
    return (
        <div className="overflow-x-auto rounded-xl border border-slate-100 shadow-sm bg-white">
            <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-100 sticky top-0">
                    <tr>
                        <th className="py-2 px-3 text-left text-slate-400 font-semibold w-8">#</th>
                        {cols.map(c => (
                            <th key={c.key} className="py-2 px-3 text-left text-slate-400 font-semibold whitespace-nowrap">
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${i % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                            <td className="py-2 px-3 text-slate-300 font-mono">{i + 1}</td>
                            {cols.map(c => (
                                <td key={c.key} className="py-2 px-3 max-w-[200px]">
                                    <Cell col={c} value={row[c.key]} row={row} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
