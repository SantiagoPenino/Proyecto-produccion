import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/apiClient';
import {
    Landmark, ChevronRight, Search, RefreshCw, Download,
    PieChart as PieChartIcon, FileCheck2, CheckCircle2, XCircle, Wallet,
} from 'lucide-react';

// ─── Reportes disponibles ────────────────────────────────────────────────────
const REPORTS = [
    {
        id: 'ventas-area',
        label: 'Ventas por Área',
        icon: PieChartIcon,
        desc: 'Facturación agrupada por área/sector, con % y gráfico por moneda',
        color: 'text-brand-cyan',
    },
    {
        id: 'ventas-documento',
        label: 'Ventas por Documento (DGI)',
        icon: FileCheck2,
        desc: 'Documentos enviados vs no enviados a DGI, cantidad e importe por moneda',
        color: 'text-emerald-500',
    },
];

// ─── Utilidades de fecha (mismo patrón que ReportesPage.jsx) ─────────────────
const FECHA_PRESETS = [
    { label: 'Hoy',           value: 'hoy' },
    { label: 'Ayer',          value: 'ayer' },
    { label: '7 días',        value: '7d' },
    { label: '30 días',       value: '30d' },
    { label: '90 días',       value: '90d' },
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
        default: return { desde: null, hasta: null };
    }
}
const toISO = d => d ? d.toISOString().slice(0, 10) : '';

// Mismo mapeo usado en contabilidadCore.js (od.MonIdMoneda = 2 → USD, = 1 → UYU)
const MONEDA_ID_MAP = { UYU: 1, USD: 2 };

const fmtMoney = n => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt   = n => Number(n || 0).toLocaleString('es-UY');

// ─── SVG: Donut Chart (mismo patrón que ProductionDashboard.jsx) ─────────────
const AREA_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#0ea5e9','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316'];

function DonutChart({ data = [], size = 120, stroke = 20, centerLabel }) {
    const r  = (size - stroke) / 2;
    const cx = size / 2, cy = size / 2;
    const C  = 2 * Math.PI * r;
    const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
    let cum = 0;
    const segs = data.map(d => {
        const v   = Number(d.value) || 0;
        const len = total > 0 ? (v / total) * C : 0;
        const seg = { ...d, len, offset: cum };
        cum += len;
        return seg;
    });
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
            {total === 0
                ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
                : segs.map((seg, i) => (
                    <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                        stroke={seg.color || AREA_COLORS[i % AREA_COLORS.length]}
                        strokeWidth={stroke}
                        strokeDasharray={`${seg.len} ${C - seg.len}`}
                        strokeDashoffset={-seg.offset}
                        transform={`rotate(-90 ${cx} ${cy})`}
                    />
                ))
            }
            <text x={cx} y={cy - (centerLabel ? 6 : 0)} textAnchor="middle" dy="0.35em"
                  fill="#1e293b" fontSize={size * 0.14} fontWeight="700">
                {total === 0 ? '—' : fmtMoney(total)}
            </text>
            {centerLabel && (
                <text x={cx} y={cy + size * 0.14} textAnchor="middle"
                      fill="#94a3b8" fontSize={size * 0.1}>
                    {centerLabel}
                </text>
            )}
        </svg>
    );
}

// ─── Barra Enviado / No Enviado (reporte DGI) ────────────────────────────────
function DgiBar({ enviado, noEnviado, sym }) {
    const total = enviado + noEnviado;
    if (total === 0) return <div className="h-2 rounded-full bg-slate-100 w-full" />;
    const pctEnv = (enviado / total) * 100;
    return (
        <div className="flex h-2.5 rounded-full overflow-hidden w-full bg-slate-50">
            {enviado > 0 && <div style={{ width: `${pctEnv}%` }} className="bg-emerald-500" title={`Enviado a DGI: ${sym} ${fmtMoney(enviado)}`} />}
            {noEnviado > 0 && <div style={{ width: `${100 - pctEnv}%` }} className="bg-amber-400" title={`No enviado: ${sym} ${fmtMoney(noEnviado)}`} />}
        </div>
    );
}

// ─── Tabla simple ─────────────────────────────────────────────────────────────
function SimpleTable({ rows, cols }) {
    if (!rows.length) {
        return (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Landmark size={36} className="text-slate-200" />
                <p className="text-slate-400 text-sm">Sin resultados para los filtros seleccionados</p>
            </div>
        );
    }
    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-3 py-2.5 text-left text-slate-400 font-semibold w-8">#</th>
                            {cols.map(c => (
                                <th key={c.key} className="px-3 py-2.5 text-left text-slate-500 font-semibold whitespace-nowrap">{c.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {rows.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50/70 transition-colors">
                                <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{i + 1}</td>
                                {cols.map(c => (
                                    <td key={c.key} className="px-3 py-2 whitespace-nowrap">
                                        {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-400">
                {rows.length.toLocaleString()} registros
            </div>
        </div>
    );
}

// ─── Tabla agrupada por moneda, con subtotal por grupo ───────────────────────
function TablaAgrupadaPorMoneda({ rows, cols, groupBy, sumKeys = [] }) {
    if (!rows.length) {
        return (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Landmark size={36} className="text-slate-200" />
                <p className="text-slate-400 text-sm">Sin resultados para los filtros seleccionados</p>
            </div>
        );
    }
    const groups = {};
    const order = [];
    for (const row of rows) {
        const key = groupBy(row);
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(row);
    }
    return (
        <div className="space-y-4">
            {order.map(moneda => {
                const groupRows = groups[moneda];
                const subtotal = {};
                for (const k of sumKeys) subtotal[k] = groupRows.reduce((s, r) => s + Number(r[k] || 0), 0);
                return (
                    <div key={moneda} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                            <span className="font-bold text-xs text-slate-700">{moneda}</span>
                            <span className="text-[11px] text-slate-400">{groupRows.length} registros</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50/50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-slate-400 font-semibold w-8">#</th>
                                        {cols.map(c => (
                                            <th key={c.key} className="px-3 py-2 text-left text-slate-500 font-semibold whitespace-nowrap">{c.label}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {groupRows.map((row, i) => (
                                        <tr key={i} className="hover:bg-slate-50/70 transition-colors">
                                            <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{i + 1}</td>
                                            {cols.map(c => (
                                                <td key={c.key} className="px-3 py-2 whitespace-nowrap">
                                                    {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-100 border-t-2 border-slate-300">
                                        <td className="px-3 py-2.5"></td>
                                        {cols.map((c, idx) => {
                                            const isSum = sumKeys.includes(c.key);
                                            const isFirstNonSum = !isSum && cols.slice(0, idx).every(cc => sumKeys.includes(cc.key));
                                            if (isSum) {
                                                return (
                                                    <td key={c.key} className="px-3 py-2.5 text-slate-900 font-bold whitespace-nowrap">
                                                        {c.render ? c.render(subtotal[c.key], null) : subtotal[c.key]}
                                                    </td>
                                                );
                                            }
                                            if (isFirstNonSum) {
                                                return <td key={c.key} className="px-3 py-2.5 text-slate-800 text-xs font-bold whitespace-nowrap">SUBTOTAL</td>;
                                            }
                                            return <td key={c.key} className="px-3 py-2.5" />;
                                        })}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ContabilidadReportesPage() {
    const [activeReport, setActiveReport] = useState('ventas-area');
    const [opciones, setOpciones]         = useState({ areas: [], monedas: [] });
    const [filters, setFilters]           = useState({
        area: 'Todas', fechaPreset: '30d', fechaDesde: '', fechaHasta: '',
        moneda: 'Todas', articuloId: null, articuloNombre: '',
    });

    const [areaData, setAreaData]   = useState([]);
    const [porMoneda, setPorMoneda] = useState({});
    const [docData, setDocData]     = useState([]);
    const [ingresos, setIngresos]   = useState({ porFechaPago: [], porFechaFactura: [] });
    const [ingresosBase, setIngresosBase] = useState('pago'); // 'pago' | 'factura'

    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState(null);

    const [artSuggs, setArtSuggs] = useState([]);
    const artBoxRef = useRef(null);

    useEffect(() => {
        api.get('/contabilidad/reportes/ventas-filtros').then(r => {
            setOpciones({ areas: r.data.areas || [], monedas: r.data.monedas || [] });
        }).catch(() => {});
    }, []);

    // Autocomplete de artículo (mismo patrón de búsqueda por texto que RecursosView.jsx)
    useEffect(() => {
        const q = filters.articuloNombre.trim();
        if (!q || q.length < 2 || filters.articuloId) { setArtSuggs([]); return; }
        const handle = setTimeout(() => {
            api.get('/contabilidad/articulos', { params: { q } })
                .then(r => setArtSuggs((r.data.data || []).slice(0, 8)))
                .catch(() => {});
        }, 250);
        return () => clearTimeout(handle);
    }, [filters.articuloNombre, filters.articuloId]);

    useEffect(() => {
        const handler = e => {
            if (artBoxRef.current && !artBoxRef.current.contains(e.target)) setArtSuggs([]);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const fetchReport = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let dateRange = { desde: null, hasta: null };
            if (filters.fechaPreset !== 'custom') {
                dateRange = getDateRange(filters.fechaPreset);
            } else {
                if (filters.fechaDesde) dateRange.desde = new Date(filters.fechaDesde);
                if (filters.fechaHasta) dateRange.hasta = new Date(filters.fechaHasta);
            }

            const baseParams = {
                ...(filters.area !== 'Todas' && { area: filters.area }),
                ...(dateRange.desde && { fechaDesde: toISO(dateRange.desde) }),
                ...(dateRange.hasta && { fechaHasta: toISO(dateRange.hasta) }),
                ...(filters.articuloId && { articulo: filters.articuloId }),
            };

            if (activeReport === 'ventas-area') {
                const params = { ...baseParams, ...(filters.moneda !== 'Todas' && { moneda: filters.moneda }) };
                const r = await api.get('/contabilidad/reportes/ventas-por-area', { params });
                setAreaData(r.data.data || []);
                setPorMoneda(r.data.porMoneda || {});
            } else {
                const params = { ...baseParams, ...(filters.moneda !== 'Todas' && { moneda: MONEDA_ID_MAP[filters.moneda] }) };
                const [rDoc, rIng] = await Promise.all([
                    api.get('/contabilidad/reportes/ventas-por-documento', { params }),
                    api.get('/contabilidad/reportes/ingresos', { params }),
                ]);
                setDocData(rDoc.data.data || []);
                setIngresos({ porFechaPago: rIng.data.porFechaPago || [], porFechaFactura: rIng.data.porFechaFactura || [] });
            }
        } catch (e) {
            setError(e.response?.data?.error || e.message || 'Error al cargar el reporte');
            setAreaData([]); setPorMoneda({}); setDocData([]); setIngresos({ porFechaPago: [], porFechaFactura: [] });
        } finally {
            setLoading(false);
        }
    }, [activeReport, filters]);

    useEffect(() => { fetchReport(); }, [fetchReport]);

    const setF = patch => setFilters(f => ({ ...f, ...patch }));

    const handleReportChange = id => {
        setActiveReport(id);
        setAreaData([]); setPorMoneda({}); setDocData([]); setIngresos({ porFechaPago: [], porFechaFactura: [] });
    };

    const activeRep = REPORTS.find(r => r.id === activeReport);
    const hasData = activeReport === 'ventas-area' ? areaData.length > 0 : docData.length > 0;

    const exportarCSV = () => {
        let cols, rows, filename;
        if (activeReport === 'ventas-area') {
            cols = ['Área', 'Moneda', 'Ventas', '% del total', 'Cant. Documentos'];
            const flat = Object.entries(porMoneda).flatMap(([moneda, bucket]) =>
                bucket.items.map(it => [it.area, moneda, it.ventas, it.porcentaje, it.cantidadDocumentos])
            );
            rows = flat.map(r => r.join(','));
            filename = `ventas_por_area_${new Date().toISOString().split('T')[0]}.csv`;
        } else {
            cols = ['Estado DGI', 'Tipo', 'Moneda', 'Cantidad', 'Importe', 'Pendiente de Cobro'];
            rows = docData.map(d => [
                d.EstadoDgi === 'ENVIADO_DGI' ? 'Enviado a DGI' : 'No enviado',
                d.TipoPago === 'CREDITO' ? 'Crédito' : 'Contado',
                d.MonNombre || d.MonIdMoneda, d.CantidadDocumentos, d.ImporteTotal, d.ImportePendiente,
            ].join(','));
            rows.push('');
            rows.push(`Ingresos (Cobrado) — base: ${ingresosBase === 'pago' ? 'Fecha de pago' : 'Fecha de factura'}`);
            rows.push(['Moneda', 'Cantidad Facturas Cobradas', 'Importe Cobrado'].join(','));
            rows.push(...ingresosRows.map(r => [r.MonIdMoneda, r.CantidadFacturas, r.ImporteCobrado].join(',')));
            filename = `ventas_por_documento_dgi_${new Date().toISOString().split('T')[0]}.csv`;
        }
        const csv = [cols.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    };

    // ── KPIs Ventas por Área ──────────────────────────────────────────────────
    const monedasArea = Object.keys(porMoneda);

    // ── KPIs Ventas por Documento (indexado por MonIdMoneda, para cruzar con ingresos) ──
    const docPorMoneda = {};
    for (const row of docData) {
        const key = row.MonIdMoneda;
        if (!docPorMoneda[key]) docPorMoneda[key] = { sym: row.MonSimbolo || '', nombre: row.MonNombre || '', enviado: 0, noEnviado: 0, cantEnviado: 0, cantNoEnviado: 0, credito: 0, cantCredito: 0, pendiente: 0 };
        if (row.EstadoDgi === 'ENVIADO_DGI') {
            docPorMoneda[key].enviado += Number(row.ImporteTotal || 0);
            docPorMoneda[key].cantEnviado += Number(row.CantidadDocumentos || 0);
        } else {
            docPorMoneda[key].noEnviado += Number(row.ImporteTotal || 0);
            docPorMoneda[key].cantNoEnviado += Number(row.CantidadDocumentos || 0);
        }
        if (row.TipoPago === 'CREDITO') {
            docPorMoneda[key].credito += Number(row.ImporteTotal || 0);
            docPorMoneda[key].cantCredito += Number(row.CantidadDocumentos || 0);
            // Pendiente de cobro (dbo.DeudaDocumento) SOLO de las de Crédito — es lo que se
            // muestra debajo de "a crédito", tiene que ser un subconjunto de ese monto.
            docPorMoneda[key].pendiente += Number(row.ImportePendiente || 0);
        }
    }

    // ── Ingresos (cobrado real) — comparación Facturado vs Cobrado por moneda ────
    const ingresosRows = ingresos[ingresosBase === 'pago' ? 'porFechaPago' : 'porFechaFactura'] || [];
    const ingresosPorMoneda = {};
    for (const row of ingresosRows) {
        ingresosPorMoneda[row.MonIdMoneda] = { cobrado: Number(row.ImporteCobrado || 0), cantidad: row.CantidadFacturas };
    }
    const monedaKeysComparacion = [...new Set([...Object.keys(docPorMoneda), ...Object.keys(ingresosPorMoneda)])];

    return (
        <div className="flex h-full bg-slate-50 overflow-hidden">

            {/* ── Sidebar ─────────────────────────────────────────────────── */}
            <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm">
                <div className="px-4 py-3.5 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <Landmark size={17} className="text-brand-cyan" />
                        <span className="font-bold text-slate-800 text-sm">Reportes de Contabilidad</span>
                    </div>
                </div>

                <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {REPORTS.map(r => {
                        const Icon = r.icon;
                        const active = activeReport === r.id;
                        return (
                            <button
                                key={r.id}
                                onClick={() => handleReportChange(r.id)}
                                title={r.desc}
                                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all group ${
                                    active
                                        ? 'bg-brand-cyan text-white shadow-md shadow-brand-cyan/20'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                                }`}
                            >
                                <Icon size={14} className={active ? 'text-white shrink-0' : `${r.color} shrink-0 opacity-80`} />
                                <span className="text-xs font-medium truncate flex-1">{r.label}</span>
                                {active && <ChevronRight size={11} className="text-white/70 shrink-0" />}
                            </button>
                        );
                    })}
                </nav>
            </aside>

            {/* ── Contenido ───────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* ── Header filtros ──────────────────────────────────────── */}
                <div className="bg-white border-b border-slate-200 px-5 py-3 shadow-sm shrink-0 space-y-2.5">

                    {/* Fila 1: título + botones */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5">
                            {activeRep && (() => { const I = activeRep.icon; return <I size={15} className={activeRep.color} />; })()}
                            <span className="font-bold text-slate-700 text-sm">{activeRep?.label}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button onClick={fetchReport} disabled={loading}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-all"
                                title="Actualizar">
                                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button onClick={exportarCSV} disabled={!hasData || loading}
                                className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-all shadow-sm">
                                <Download size={13} />
                                Exportar CSV
                            </button>
                        </div>
                    </div>

                    {/* Fila 2: FECHA */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-slate-500 w-11 shrink-0 tracking-wide">FECHA</span>
                        {FECHA_PRESETS.map(p => (
                            <button key={p.value} onClick={() => setF({ fechaPreset: p.value })}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                    filters.fechaPreset === p.value ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}>
                                {p.label}
                            </button>
                        ))}
                        {filters.fechaPreset === 'custom' && (
                            <div className="flex items-center gap-2 ml-1">
                                <input type="date" value={filters.fechaDesde} onChange={e => setF({ fechaDesde: e.target.value })}
                                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                                <span className="text-slate-400 text-xs">—</span>
                                <input type="date" value={filters.fechaHasta} onChange={e => setF({ fechaHasta: e.target.value })}
                                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                            </div>
                        )}
                    </div>

                    {/* Fila 3: ÁREA */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-slate-500 w-11 shrink-0 tracking-wide">ÁREA</span>
                        {['Todas', ...opciones.areas.map(a => a.nombre)].map(a => (
                            <button key={a} onClick={() => setF({ area: a })}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                    filters.area === a ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}>
                                {a}
                            </button>
                        ))}
                    </div>

                    {/* Fila 4: MONEDA + ARTÍCULO */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">MONEDA</span>
                            {['Todas', 'UYU', 'USD'].map(m => (
                                <button key={m} onClick={() => setF({ moneda: m })}
                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                        filters.moneda === m ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}>
                                    {m}
                                </button>
                            ))}
                        </div>

                        <div className="h-4 w-px bg-slate-200 hidden sm:block" />

                        <div className="flex items-center gap-2 relative" ref={artBoxRef}>
                            <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">ARTÍCULO</span>
                            <div className="relative">
                                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input type="text" placeholder="Buscar artículo..." value={filters.articuloNombre}
                                    onChange={e => setF({ articuloNombre: e.target.value, articuloId: null })}
                                    className="text-xs border border-slate-300 rounded-lg pl-7 pr-2 py-1.5 focus:ring-2 focus:ring-brand-cyan/30 outline-none w-52" />
                                {artSuggs.length > 0 && (
                                    <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 min-w-full max-h-48 overflow-y-auto">
                                        {artSuggs.map(a => (
                                            <button key={a.IDArticulo}
                                                className="w-full text-left px-3 py-2 text-xs hover:bg-brand-cyan/10 hover:text-brand-cyan transition-colors first:rounded-t-xl last:rounded-b-xl"
                                                onClick={() => { setF({ articuloNombre: a.NombreArticulo, articuloId: a.IDArticulo }); setArtSuggs([]); }}>
                                                {a.NombreArticulo}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {filters.articuloNombre && (
                                <button onClick={() => setF({ articuloNombre: '', articuloId: null })}
                                    className="text-xs text-red-500 hover:text-red-700 font-bold leading-none" title="Limpiar">✕</button>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Contenido del reporte ──────────────────────────────── */}
                <div className="flex-1 overflow-auto p-4 space-y-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-cyan" />
                            <p className="text-sm text-slate-400">Cargando reporte...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2">
                            <p className="text-red-500 font-semibold text-sm">Error al cargar el reporte</p>
                            <p className="text-slate-400 text-xs max-w-sm text-center">{error}</p>
                            <button onClick={fetchReport} className="mt-2 px-4 py-1.5 bg-brand-cyan text-white text-xs rounded-lg font-medium">
                                Reintentar
                            </button>
                        </div>
                    ) : activeReport === 'ventas-area' ? (
                        <>
                            {monedasArea.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-40 gap-2">
                                    <PieChartIcon size={42} className="text-slate-200" />
                                    <p className="text-slate-400 text-sm">Sin resultados para los filtros seleccionados</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {monedasArea.map(moneda => {
                                        const bucket = porMoneda[moneda];
                                        const chartData = bucket.items.map((it, i) => ({
                                            label: it.area, value: it.ventas, color: AREA_COLORS[i % AREA_COLORS.length],
                                        }));
                                        return (
                                            <div key={moneda} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="font-bold text-slate-700 text-sm">{moneda}</span>
                                                    <span className="text-xs text-slate-400">{bucket.items.length} área{bucket.items.length !== 1 ? 's' : ''}</span>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <DonutChart data={chartData} centerLabel={moneda} />
                                                    <div className="flex-1 space-y-1.5 min-w-0">
                                                        {bucket.items.map((it, i) => (
                                                            <div key={it.area} className="flex items-center gap-2 text-xs">
                                                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: AREA_COLORS[i % AREA_COLORS.length] }} />
                                                                <span className="text-slate-600 truncate flex-1">{it.area}</span>
                                                                <span className="font-mono tabular-nums text-slate-800 font-semibold shrink-0">{it.porcentaje}%</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <SimpleTable
                                rows={areaData}
                                cols={[
                                    { key: 'Area', label: 'Área' },
                                    { key: 'Moneda', label: 'Moneda' },
                                    { key: 'Ventas', label: 'Ventas', render: v => <span className="font-mono tabular-nums">{fmtMoney(v)}</span> },
                                    { key: 'CantidadDocumentos', label: 'Cant. Documentos', render: v => <span className="font-mono tabular-nums">{fmtInt(v)}</span> },
                                ]}
                            />
                        </>
                    ) : (
                        <>
                            {Object.keys(docPorMoneda).length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-40 gap-2">
                                    <FileCheck2 size={42} className="text-slate-200" />
                                    <p className="text-slate-400 text-sm">Sin resultados para los filtros seleccionados</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {Object.entries(docPorMoneda).map(([monId, b]) => (
                                        <div key={monId} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-slate-700 text-sm">{b.nombre || monId}</span>
                                                <span className="text-xs text-slate-400">{fmtInt(b.cantEnviado + b.cantNoEnviado)} documentos</span>
                                            </div>
                                            <DgiBar enviado={b.enviado} noEnviado={b.noEnviado} sym={b.sym} />
                                            <div className="flex items-center justify-between text-xs">
                                                <div className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                                                    <CheckCircle2 size={13} /> Enviado a DGI
                                                    <span className="text-slate-400 font-normal ml-1">{fmtInt(b.cantEnviado)} · {b.sym} {fmtMoney(b.enviado)}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between text-xs">
                                                <div className="flex items-center gap-1.5 text-amber-600 font-semibold">
                                                    <XCircle size={13} /> No enviado
                                                    <span className="text-slate-400 font-normal ml-1">{fmtInt(b.cantNoEnviado)} · {b.sym} {fmtMoney(b.noEnviado)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* ── Ingresos (cobrado real) vs Facturado ────────────────── */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-1.5">
                                        <Wallet size={15} className="text-violet-500" />
                                        <span className="font-bold text-slate-700 text-sm">Ingresos (Cobrado) vs Facturado</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold text-slate-500 tracking-wide">BASE</span>
                                        {[{ v: 'pago', l: 'Fecha de pago' }, { v: 'factura', l: 'Fecha de factura' }].map(o => (
                                            <button key={o.v} onClick={() => setIngresosBase(o.v)}
                                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                                    ingresosBase === o.v ? 'bg-violet-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}>
                                                {o.l}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-[11px] text-slate-400">
                                    {ingresosBase === 'pago'
                                        ? 'Plata que efectivamente entró en el rango de fechas elegido, sea de facturas nuevas o viejas.'
                                        : 'Solo lo cobrado de facturas emitidas dentro del rango de fechas elegido.'}
                                </p>
                                {monedaKeysComparacion.length === 0 ? (
                                    <div className="text-xs text-slate-400 text-center py-4">Sin cobros registrados para los filtros seleccionados</div>
                                ) : (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        {monedaKeysComparacion.map(monId => {
                                            const doc = docPorMoneda[monId] || { sym: '', nombre: '', enviado: 0, noEnviado: 0 };
                                            const ing = ingresosPorMoneda[monId] || { cobrado: 0, cantidad: 0 };
                                            const facturado = doc.enviado + doc.noEnviado;
                                            const delta = facturado - ing.cobrado;
                                            return (
                                                <div key={monId} className="border border-slate-100 rounded-lg p-3 space-y-1.5">
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className="font-bold text-slate-700">{doc.nombre || monId}</span>
                                                        <span className="text-slate-400">{fmtInt(ing.cantidad)} facturas cobradas</span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className="text-slate-500">Facturado</span>
                                                        <span className="font-mono tabular-nums text-slate-700">{doc.sym} {fmtMoney(facturado)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-[11px] pl-2">
                                                        <span className="text-slate-400 italic">de eso, a crédito</span>
                                                        <span className="font-mono tabular-nums text-slate-400">{doc.sym} {fmtMoney(doc.credito)} ({fmtInt(doc.cantCredito)})</span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-[11px] pl-2">
                                                        <span className="text-rose-500 italic">de eso, pendiente de cobro</span>
                                                        <span className="font-mono tabular-nums text-rose-600 font-semibold">{doc.sym} {fmtMoney(doc.pendiente)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className="text-violet-600 font-semibold">Cobrado</span>
                                                        <span className="font-mono tabular-nums text-violet-700 font-semibold">{doc.sym} {fmtMoney(ing.cobrado)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                                                        <span className="text-slate-400">Diferencia</span>
                                                        <span className={`font-mono tabular-nums font-semibold ${delta >= 0 ? 'text-amber-600' : 'text-sky-600'}`}>
                                                            {doc.sym} {fmtMoney(Math.abs(delta))} {delta >= 0 ? '(facturado no cobrado)' : '(cobrado de más / deuda vieja)'}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <TablaAgrupadaPorMoneda
                                rows={docData}
                                groupBy={row => row.MonNombre || row.MonIdMoneda}
                                sumKeys={['CantidadDocumentos', 'ImporteTotal', 'ImportePendiente']}
                                cols={[
                                    { key: 'EstadoDgi', label: 'Estado DGI', render: v => v === 'ENVIADO_DGI'
                                        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">Enviado a DGI</span>
                                        : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">No enviado</span> },
                                    { key: 'TipoPago', label: 'Tipo', render: v => v === 'CREDITO'
                                        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700">Crédito</span>
                                        : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">Contado</span> },
                                    { key: 'CantidadDocumentos', label: 'Cantidad', render: v => <span className="font-mono tabular-nums">{fmtInt(v)}</span> },
                                    { key: 'ImporteTotal', label: 'Importe', render: v => <span className="font-mono tabular-nums">{fmtMoney(v)}</span> },
                                    { key: 'ImportePendiente', label: 'Pendiente de Cobro', render: v => <span className="font-mono tabular-nums text-rose-600">{fmtMoney(v)}</span> },
                                ]}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
