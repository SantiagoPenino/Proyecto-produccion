import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import api from '../../services/apiClient';
import { fmtFecha } from '../../utils/fechas';
import {
    Landmark, ChevronRight, Search, RefreshCw, Download,
    PieChart as PieChartIcon, FileCheck2, CheckCircle2, XCircle, Wallet, BookText, Eye,
    Users, Package, BarChart3, Settings2, FolderTree, ChevronDown, Check,
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
    {
        id: 'top-clientes',
        label: 'Top Clientes',
        icon: Users,
        desc: 'Ranking de clientes internos (dueños de la orden) por monto facturado, con drill-down a sus comprobantes',
        color: 'text-violet-500',
    },
    {
        id: 'top-productos',
        label: 'Top Productos',
        icon: Package,
        desc: 'Ranking de artículos vendidos por monto o unidades, con drill-down a los comprobantes',
        color: 'text-sky-500',
    },
    {
        id: 'resumen-mensual',
        label: 'Resumen Mensual',
        icon: BarChart3,
        desc: 'Un mes completo: pesos + dólares unificados a un tipo de cambio de referencia, por área',
        color: 'text-rose-500',
    },
    {
        id: 'libro-contador',
        label: 'Libro Contador (CSV)',
        icon: BookText,
        desc: 'CSV de ventas y cobros para importar en el sistema del contador — solo CFE aceptados por DGI',
        color: 'text-amber-500',
    },
    {
        id: 'catalogo',
        label: 'Sectores y Catálogo',
        icon: FolderTree,
        desc: 'Configurar los sectores comerciales y clasificar los artículos en el árbol Sector → Área → Variante',
        color: 'text-slate-500',
        esConfig: true,
    },
];

// Reportes que manejan sus propios filtros y carga (no usan los filtros genéricos
// del encabezado ni el fetch automático de la página).
const REPORTES_AUTONOMOS = ['libro-contador', 'top-clientes', 'top-productos', 'resumen-mensual', 'catalogo'];

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
        // Dos columnas para que cada moneda quede debajo de su tarjeta de arriba
        // (pesos con pesos, dólares con dólares) en vez de apiladas a lo largo.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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

// ─── Piezas compartidas de los reportes nuevos (maqueta del contador) ─────────
const AREA_COLOR_MAP = {
    'DTF': '#10b981', 'Sublimacion': '#8b5cf6', 'ECOUV': '#f59e0b', 'IMPRESION DIRECTA': '#84cc16',
    'Bordado': '#ec4899', 'Corte': '#ef4444', 'Costura': '#06b6d4', 'Diseño': '#3b82f6',
    'TPU': '#0ea5e9', 'Estampado': '#f97316', 'Productos Confeccionados': '#38bdf8',
    'Venta Directa': '#a855f7', 'Sin área': '#94a3b8',
};
const colorArea = (a) => AREA_COLOR_MAP[a] || '#94a3b8';

// ─── Ámbito: "Todas" | un SECTOR comercial | un ÁREA productiva ──────────────
// Sector y área no son lo mismo: el sector agrupa varias áreas (CENCO = Corte +
// Costura). Un solo control con los dos niveles evita que se elijan a la vez.
// Valor: 'Todas' | 'S:<sectorId>' | 'A:<nombreArea>'
const paramsAmbito = (ambito) => {
    if (!ambito || ambito === 'Todas') return {};
    if (ambito.startsWith('S:')) return { sector: ambito.slice(2) };
    return { area: ambito.slice(2) };
};

const etiquetaAmbito = (ambito, opciones) => {
    if (!ambito || ambito === 'Todas') return 'Todos los sectores';
    if (ambito.startsWith('S:')) {
        const s = (opciones.sectores || []).find(x => x.id === ambito.slice(2));
        return s ? `Sector ${s.nombre}` : 'Sector';
    }
    return `Área ${ambito.slice(2)}`;
};

/**
 * Fila "VER POR": elige el nivel (sector comercial o área productiva) y muestra
 * los chips de ese nivel. Un solo control decide por qué se filtra y —donde
 * corresponda— cómo se agrupa el resultado. Se usa en todos los reportes.
 */
const FilaVerPor = ({ verPor, onVerPor, ambito, onAmbito, opciones, extra = null }) => {
    const haySectores = (opciones.sectores || []).length > 0;
    const porSector = verPor === 'sector' && haySectores;
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">VER POR</span>
            {haySectores && (
                <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5 shrink-0">
                    {[{ v: 'sector', l: 'Sectores comerciales' }, { v: 'area', l: 'Áreas productivas' }].map(o => (
                        <button key={o.v}
                            onClick={() => { onVerPor(o.v); onAmbito('Todas'); }}
                            title={o.v === 'sector'
                                ? 'Agrupación comercial: un sector junta varias áreas (CENCO = Corte + Costura)'
                                : 'Detalle fino por área de producción'}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                verPor === o.v ? 'bg-brand-cyan text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}>
                            {o.l}
                        </button>
                    ))}
                </div>
            )}
            <div className="h-4 w-px bg-slate-200 shrink-0 hidden sm:block" />

            <Chip active={ambito === 'Todas'} onClick={() => onAmbito('Todas')}>
                {porSector ? 'Todos' : 'Todas'}
            </Chip>
            {porSector
                ? opciones.sectores.map(s => (
                    <Chip key={s.id} active={ambito === `S:${s.id}`} onClick={() => onAmbito(`S:${s.id}`)}>
                        <span title={s.areas?.length ? `Agrupa: ${s.areas.join(' + ')}` : ''}>{s.nombre}</span>
                    </Chip>
                ))
                : (opciones.areas || []).map(a => (
                    <Chip key={a.nombre} active={ambito === `A:${a.nombre}`} onClick={() => onAmbito(`A:${a.nombre}`)}>
                        {a.nombre}
                    </Chip>
                ))}
            {extra}
        </div>
    );
};

const Chip = ({ active, onClick, children }) => (
    <button onClick={onClick}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            active ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
        {children}
    </button>
);

const KpiCard = ({ label, value, sub, color }) => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 relative overflow-hidden">
        <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
        <p className="text-[11px] text-slate-400 font-semibold">{label}</p>
        <p className="text-xl font-extrabold mt-1 tabular-nums truncate" style={{ color }}>{value}</p>
        {sub ? <p className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</p> : null}
    </div>
);

const RankBadge = ({ n }) => (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-[11px] font-extrabold ${
        n <= 3 ? 'bg-brand-cyan text-white' : 'bg-slate-100 text-slate-500'}`}>{n}</span>
);

const MiniBar = ({ pct, color }) => (
    <div className="h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden w-28 ml-auto">
        <i className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
    </div>
);

// Modal genérico de drill-down (comprobantes que componen un total)
function DrillModal({ drill, onClose, children }) {
    if (!drill) return null;
    return (
        <div className="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-6"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] mx-auto">
                <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
                    <div>
                        <h3 className="font-bold text-slate-800 text-sm">{drill.titulo}</h3>
                        {drill.sub && <p className="text-xs text-slate-400 mt-0.5">{drill.sub}</p>}
                    </div>
                    <button onClick={onClose}
                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold shrink-0"
                        title="Cerrar">✕</button>
                </div>
                <div className="overflow-auto">
                    {drill.rows === null ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-cyan" />
                        </div>
                    ) : children}
                </div>
            </div>
        </div>
    );
}

const descargarCSV = (nombre, header, filas) => {
    const csv = [header.join(','), ...filas.map(f => f.map(v => {
        const s = String(v ?? '').replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
};

// Rango de fechas de una sección autónoma (presets compartidos con la página)
const rangoDeFiltros = (f) => {
    if (f.preset !== 'custom') {
        const r = getDateRange(f.preset);
        return { desde: toISO(r.desde), hasta: toISO(r.hasta) };
    }
    return { desde: f.desde || '', hasta: f.hasta || '' };
};

const FilaFecha = ({ f, setF }) => (
    <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-slate-500 w-14 shrink-0 tracking-wide">FECHA</span>
        {FECHA_PRESETS.map(p => (
            <Chip key={p.value} active={f.preset === p.value} onClick={() => setF({ preset: p.value })}>{p.label}</Chip>
        ))}
        {f.preset === 'custom' && (
            <div className="flex items-center gap-2 ml-1">
                <input type="date" value={f.desde} onChange={e => setF({ desde: e.target.value })}
                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                <span className="text-slate-400 text-xs">—</span>
                <input type="date" value={f.hasta} onChange={e => setF({ hasta: e.target.value })}
                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
            </div>
        )}
    </div>
);

// ─── Top 50 Clientes ──────────────────────────────────────────────────────────
// Ranking por CLIENTE INTERNO (dueño de la orden), no por el receptor del CFE en
// DGI. Lo irresoluble cae en "Mostrador / sin identificar". NC restan.
function TopClientesSection({ opciones }) {
    const [f, setFRaw] = useState({ preset: '30d', desde: '', hasta: '', ambito: 'Todas', verPor: 'sector', moneda: 'UYU', comparar: false, top: 25 });
    const setF = patch => setFRaw(x => ({ ...x, ...patch }));
    const topN = Math.min(Math.max(parseInt(f.top) || 25, 1), 200);
    const [rows, setRows] = useState([]);
    const [totalUniverso, setTotalUniverso] = useState(0);
    const [cantidadClientes, setCantidadClientes] = useState(0);
    const [prevMap, setPrevMap] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [drill, setDrill] = useState(null);
    // Documento expandido dentro del modal (click en el N°): trae sus líneas reales
    const [docAbierto, setDocAbierto] = useState(null); // { id, loading, lineas, doc }

    const sym = f.moneda === 'USD' ? 'US$' : '$';

    const toggleDoc = async (docId) => {
        if (docAbierto?.id === docId) { setDocAbierto(null); return; }
        setDocAbierto({ id: docId, loading: true, lineas: [], doc: null });
        try {
            const r = await api.get(`/contabilidad/cfe/documentos/${docId}/detalle`);
            setDocAbierto(d => d?.id === docId
                ? { id: docId, loading: false, lineas: r.data.detalles || [], doc: r.data.doc || null } : d);
        } catch {
            setDocAbierto(d => d?.id === docId ? { id: docId, loading: false, lineas: [], doc: null } : d);
        }
    };

    const cargar = useCallback(async () => {
        const { desde, hasta } = rangoDeFiltros(f);
        setLoading(true); setError(null);
        try {
            const params = {
                moneda: MONEDA_ID_MAP[f.moneda],
                limite: Math.min(Math.max(parseInt(f.top) || 25, 1), 200),
                ...paramsAmbito(f.ambito),
            };
            if (desde) params.fechaDesde = desde;
            if (hasta) params.fechaHasta = hasta;
            const r = await api.get('/contabilidad/reportes/top-clientes', { params });
            setRows(r.data.data || []);
            setTotalUniverso(Number(r.data.totalUniverso || 0));
            setCantidadClientes(r.data.cantidadClientes || 0);

            if (f.comparar && desde && hasta) {
                // Período anterior equivalente: misma cantidad de días, terminando el día antes.
                const d1 = new Date(desde + 'T00:00:00'), d2 = new Date(hasta + 'T00:00:00');
                const len = Math.max(1, Math.round((d2 - d1) / 864e5) + 1);
                const pHasta = new Date(d1); pHasta.setDate(pHasta.getDate() - 1);
                const pDesde = new Date(pHasta); pDesde.setDate(pDesde.getDate() - (len - 1));
                const rp = await api.get('/contabilidad/reportes/top-clientes', {
                    params: { ...params, limite: 200, fechaDesde: toISO(pDesde), fechaHasta: toISO(pHasta) },
                });
                setPrevMap(new Map((rp.data.data || []).map(x => [x.cliId, x.monto])));
            } else {
                setPrevMap(null);
            }
        } catch (e) {
            setError(e.response?.data?.error || e.message);
            setRows([]); setPrevMap(null);
        } finally { setLoading(false); }
    }, [f]);
    useEffect(() => { cargar(); }, [cargar]);

    const abrirDrill = async (row) => {
        setDrill({
            titulo: row.nombre,
            sub: `${row.codCliente ? row.codCliente + ' · ' : ''}Comprobantes que componen el total (${f.moneda}). ` +
                (f.ambito !== 'Todas'
                    ? `El Importe es SOLO la porción de ${etiquetaAmbito(f.ambito, opciones)} de cada comprobante (si tiene líneas de otras áreas, esa parte no se cuenta acá). `
                    : 'El Importe es el total de cada comprobante. ') +
                'Las NC aparecen en negativo. Click en el N° para ver el documento.',
            rows: null,
        });
        setDocAbierto(null);
        try {
            const { desde, hasta } = rangoDeFiltros(f);
            const params = { cliente: row.cliId, moneda: MONEDA_ID_MAP[f.moneda], ...paramsAmbito(f.ambito) };
            if (desde) params.fechaDesde = desde;
            if (hasta) params.fechaHasta = hasta;
            const r = await api.get('/contabilidad/reportes/top-clientes-detalle', { params });
            setDrill(d => d ? { ...d, rows: r.data.data || [] } : d);
        } catch {
            setDrill(d => d ? { ...d, rows: [] } : d);
        }
    };

    const exportar = () => descargarCSV(
        `top_clientes_${f.moneda}_${new Date().toISOString().slice(0, 10)}.csv`,
        ['#', 'Cliente', 'Código', 'Área dominante', `Monto (${f.moneda})`, '% participación', 'Documentos', 'NC'],
        rows.map((r, i) => [i + 1, r.nombre, r.codCliente, r.areaDominante, r.monto.toFixed(2), r.participacion, r.cantidadDocumentos, r.cantidadNC]));

    const maxMonto = rows.length ? Math.max(...rows.map(r => r.monto)) : 1;
    const drillTotal = drill?.rows?.reduce((s, d) => s + Number(d.Importe || 0), 0) || 0;

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2.5">
                <FilaFecha f={f} setF={setF} />
                <FilaVerPor verPor={f.verPor} onVerPor={v => setF({ verPor: v })}
                    ambito={f.ambito} onAmbito={v => setF({ ambito: v })} opciones={opciones} />
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-500 w-14 shrink-0 tracking-wide">MONEDA</span>
                        {['UYU', 'USD'].map(m => (
                            <Chip key={m} active={f.moneda === m} onClick={() => setF({ moneda: m })}>{m === 'UYU' ? 'UYU (pesos)' : 'USD (dólares)'}</Chip>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                        <span className="text-[11px] font-bold text-slate-500 tracking-wide">TOP</span>
                        <input type="number" min="1" max="200" value={f.top}
                            onChange={e => setF({ top: e.target.value })}
                            title="Cuántos clientes mostrar en el ranking"
                            className="text-xs border border-slate-300 rounded-lg px-2 py-1 w-16 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                        <span className="text-[11px] text-slate-400">clientes</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-slate-600 ml-2">
                        <span onClick={() => setF({ comparar: !f.comparar })}
                            className={`w-9 h-5 rounded-full relative transition-colors ${f.comparar ? 'bg-brand-cyan' : 'bg-slate-300'}`}>
                            <span className={`absolute w-4 h-4 rounded-full bg-white top-0.5 transition-all ${f.comparar ? 'left-[18px]' : 'left-0.5'}`} />
                        </span>
                        <span onClick={() => setF({ comparar: !f.comparar })}>Comparar contra período anterior equivalente</span>
                    </label>
                    <button onClick={exportar} disabled={!rows.length}
                        className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all shadow-sm">
                        <Download size={13} /> Exportar CSV
                    </button>
                </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-4 py-3">{error}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiCard label="Facturación del período (neta de NC)" value={`${sym} ${fmtMoney(totalUniverso)}`}
                    sub={etiquetaAmbito(f.ambito, opciones)} color={f.moneda === 'USD' ? '#0891b2' : '#0d9488'} />
                <KpiCard label="Clientes con compras" value={fmtInt(cantidadClientes)} sub={`mostrando los ${rows.length} mayores`} color="#8b5cf6" />
                <KpiCard label="Cliente #1" value={rows.length ? rows[0].nombre : '—'}
                    sub={rows.length ? `${sym} ${fmtMoney(rows[0].monto)}` : ''} color="#f59e0b" />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-700">
                        {f.ambito === 'Todas' ? `Top ${topN} clientes — General (todos los sectores)` : `Top ${topN} clientes — ${etiquetaAmbito(f.ambito, opciones)}`}
                    </span>
                    <span className="text-[11px] text-slate-400">{rows.length} clientes · {f.moneda} · clic en un cliente para ver sus comprobantes</span>
                </div>
                {loading ? (
                    <div className="flex items-center justify-center py-14"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-cyan" /></div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50/50 border-b border-slate-100">
                                <tr>
                                    <th className="px-3 py-2 text-left text-slate-400 font-semibold w-10">#</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold">Cliente</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold">Área dominante</th>
                                    <th className="px-3 py-2 text-right text-slate-500 font-semibold">Monto facturado</th>
                                    <th className="px-3 py-2 text-right text-slate-500 font-semibold">% part.</th>
                                    {prevMap && <th className="px-3 py-2 text-right text-slate-500 font-semibold">Período ant.</th>}
                                    {prevMap && <th className="px-3 py-2 text-right text-slate-500 font-semibold">Variación</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {rows.map((r, i) => {
                                    const prev = prevMap ? Number(prevMap.get(r.cliId) || 0) : null;
                                    const diff = prev !== null ? r.monto - prev : null;
                                    return (
                                        <tr key={r.cliId} className="hover:bg-cyan-50/40 cursor-pointer transition-colors" onClick={() => abrirDrill(r)}>
                                            <td className="px-3 py-2"><RankBadge n={i + 1} /></td>
                                            <td className="px-3 py-2">
                                                <div className="font-semibold text-teal-700">{r.nombre}
                                                    {r.esMostrador && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">MOSTRADOR</span>}
                                                    {r.esSinFicha && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-700"
                                                        title="Facturado con una ficha genérica: este nombre es el receptor real del CFE en DGI. No tiene ficha de cliente propia.">SIN FICHA</span>}
                                                </div>
                                                <div className="text-[10px] text-slate-400 font-mono">
                                                    {r.codCliente || (r.esSinFicha ? 'receptor del CFE en DGI' : `#${r.cliId}`)}
                                                    {r.cantidadNC > 0 ? ` · ${r.cantidadNC} NC restada${r.cantidadNC > 1 ? 's' : ''}` : ''}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap">
                                                <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
                                                    <span className="w-2 h-2 rounded-full" style={{ background: colorArea(r.areaDominante) }} />{r.areaDominante}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right whitespace-nowrap">
                                                <span className="font-mono tabular-nums font-bold">{sym} {fmtMoney(r.monto)}</span>
                                                <MiniBar pct={(r.monto / maxMonto) * 100} color={colorArea(r.areaDominante)} />
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtMoney(r.participacion)}%</td>
                                            {prevMap && <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{prev ? `${sym} ${fmtMoney(prev)}` : '—'}</td>}
                                            {prevMap && (
                                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                                    <span className={`font-mono tabular-nums font-semibold ${diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                        {diff >= 0 ? '▲' : '▼'} {sym} {fmtMoney(Math.abs(diff))}
                                                    </span>
                                                    <div className="text-[10px] text-slate-400">{!prev ? 'nuevo' : `${diff >= 0 ? '+' : '−'}${fmtMoney(Math.abs(diff / prev) * 100)}%`}</div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                                {!rows.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Sin datos para el filtro seleccionado.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <p className="text-[11px] text-slate-400">
                El cliente es el <b>cliente interno dueño de la orden</b>, aunque el CFE haya salido a DGI como consumidor final o a nombre de un tercero.
                Lo que no se pudo atribuir a ningún cliente queda en la fila "Mostrador / sin identificar". Las notas de crédito restan del total.
            </p>

            <DrillModal drill={drill} onClose={() => { setDrill(null); setDocAbierto(null); }}>
                <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                        <tr>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Comprobante</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">N°</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Fecha</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">DGI</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Área</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Importe</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {(drill?.rows || []).map(d => (
                            <Fragment key={d.DocIdDocumento}>
                                <tr className={docAbierto?.id === d.DocIdDocumento ? 'bg-cyan-50/40' : ''}>
                                    <td className="px-3 py-1.5 whitespace-nowrap">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${d.Signo === -1 ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'}`}>{d.DocTipo}</span>
                                    </td>
                                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                                        <button onClick={() => toggleDoc(d.DocIdDocumento)}
                                            className="text-teal-700 font-semibold hover:underline"
                                            title="Ver las líneas del documento">
                                            {d.NumeroInterno} {docAbierto?.id === d.DocIdDocumento ? '▴' : '▾'}
                                        </button>
                                    </td>
                                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtFecha(d.DocFechaEmision)}</td>
                                    <td className="px-3 py-1.5">{d.EnviadoDgi
                                        ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">Enviado</span>
                                        : <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">No enviado</span>}</td>
                                    <td className="px-3 py-1.5 whitespace-nowrap">
                                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                                            <span className="w-2 h-2 rounded-full" style={{ background: colorArea(d.AreaDominante) }} />{d.AreaDominante || '—'}
                                        </span>
                                    </td>
                                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-semibold ${Number(d.Importe) < 0 ? 'text-red-600' : ''}`}>{sym} {fmtMoney(d.Importe)}</td>
                                </tr>
                                {docAbierto?.id === d.DocIdDocumento && (
                                    <tr>
                                        <td colSpan={6} className="bg-slate-50/80 px-4 py-3">
                                            {docAbierto.loading ? (
                                                <p className="text-[11px] text-slate-400">Cargando documento...</p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {d.ReceptorDgi && (
                                                        <p className="text-[11px] text-slate-500">
                                                            CFE emitido en DGI a nombre de: <b>{d.ReceptorDgi}</b>
                                                        </p>
                                                    )}
                                                    {docAbierto.lineas.length === 0 ? (
                                                        <p className="text-[11px] text-slate-400">El documento no tiene líneas cargadas.</p>
                                                    ) : (
                                                        <table className="w-full text-[11px] bg-white rounded-lg overflow-hidden border border-slate-200">
                                                            <thead className="bg-slate-100">
                                                                <tr>
                                                                    <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Ítem</th>
                                                                    <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Orden</th>
                                                                    <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Cant.</th>
                                                                    <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">P. unitario</th>
                                                                    <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Total línea</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100">
                                                                {docAbierto.lineas.map(l => (
                                                                    <tr key={l.DcdIdDetalle}>
                                                                        <td className="px-2 py-1.5 text-slate-700">{l.DcdNomItem}</td>
                                                                        <td className="px-2 py-1.5 font-mono text-slate-500 whitespace-nowrap">{l.OrdCodigoOrden || ''}</td>
                                                                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtMoney(l.DcdCantidad)}</td>
                                                                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtMoney(l.DcdPrecioUnitario)}</td>
                                                                        <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{fmtMoney(l.DcdTotal)}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-slate-50 border-t-2 border-slate-200">
                            <td colSpan={5} className="px-3 py-2 font-bold text-slate-700">TOTAL ({drill?.rows?.length || 0} comprobantes)</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-extrabold">{sym} {fmtMoney(drillTotal)}</td>
                        </tr>
                    </tfoot>
                </table>
            </DrillModal>
        </div>
    );
}

// ─── Top Productos ────────────────────────────────────────────────────────────
// El artículo se resuelve por la cotización de la orden (línea del documento →
// orden → línea de pedido con artículo). Ventas sin orden/artículo no aparecen.
function TopProductosSection({ opciones }) {
    const [f, setFRaw] = useState({ preset: '30d', desde: '', hasta: '', ambito: 'Todas', verPor: 'sector', moneda: 'UYU', orden: 'monto', familia: 'Todas', top: 25 });
    const setF = patch => setFRaw(x => ({ ...x, ...patch }));
    const topN = Math.min(Math.max(parseInt(f.top) || 25, 1), 200);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [drill, setDrill] = useState(null);
    const [cliente, setCliente] = useState({ id: null, nombre: '', sugs: [] });
    const cliBoxRef = useRef(null);
    // Documento expandido dentro del modal (click en el N°): trae sus líneas reales
    const [docAbierto, setDocAbierto] = useState(null);

    const sym = f.moneda === 'USD' ? 'US$' : '$';

    const toggleDoc = async (docId) => {
        if (docAbierto?.id === docId) { setDocAbierto(null); return; }
        setDocAbierto({ id: docId, loading: true, lineas: [] });
        try {
            const r = await api.get(`/contabilidad/cfe/documentos/${docId}/detalle`);
            setDocAbierto(d => d?.id === docId ? { id: docId, loading: false, lineas: r.data.detalles || [] } : d);
        } catch {
            setDocAbierto(d => d?.id === docId ? { id: docId, loading: false, lineas: [] } : d);
        }
    };

    // Autocomplete de cliente (mismo endpoint que Caja)
    useEffect(() => {
        const q = cliente.nombre.trim();
        if (!q || q.length < 2 || cliente.id) { setCliente(c => ({ ...c, sugs: [] })); return; }
        const h = setTimeout(() => {
            api.get('/contabilidad/clientes-activos', { params: { q, limit: 8 } })
                .then(r => setCliente(c => ({ ...c, sugs: r.data?.data || [] })))
                .catch(() => {});
        }, 250);
        return () => clearTimeout(h);
    }, [cliente.nombre, cliente.id]);
    useEffect(() => {
        const handler = e => { if (cliBoxRef.current && !cliBoxRef.current.contains(e.target)) setCliente(c => ({ ...c, sugs: [] })); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const cargar = useCallback(async () => {
        const { desde, hasta } = rangoDeFiltros(f);
        setLoading(true); setError(null);
        try {
            const params = { moneda: MONEDA_ID_MAP[f.moneda], limite: 200, ...paramsAmbito(f.ambito) };
            if (desde) params.fechaDesde = desde;
            if (hasta) params.fechaHasta = hasta;
            if (cliente.id) params.cliente = cliente.id;
            const r = await api.get('/contabilidad/reportes/top-productos', { params });
            setRows(r.data.data || []);
        } catch (e) {
            setError(e.response?.data?.error || e.message);
            setRows([]);
        } finally { setLoading(false); }
    }, [f.preset, f.desde, f.hasta, f.ambito, f.moneda, cliente.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { cargar(); }, [cargar]);

    const familias = ['Todas', ...[...new Set(rows.map(r => r.Grupo).filter(Boolean))].sort()];
    const vista = rows
        .filter(r => f.familia === 'Todas' || r.Grupo === f.familia)
        .sort((a, b) => f.orden === 'unid' ? b.Unidades - a.Unidades : b.Monto - a.Monto)
        .slice(0, topN);
    const totM = vista.reduce((s, r) => s + Number(r.Monto || 0), 0);
    const totU = vista.reduce((s, r) => s + Number(r.Unidades || 0), 0);
    const maxV = vista.length ? Math.max(...vista.map(r => f.orden === 'unid' ? Number(r.Unidades) : Number(r.Monto))) : 1;

    const abrirDrill = async (row) => {
        setDrill({
            titulo: row.Descripcion,
            sub: `${row.CodArticulo}${row.Area ? ' · ' + row.Area : ''} · Comprobantes/órdenes que componen el total (${f.moneda}). Click en el N° para ver el documento.`,
            rows: null,
        });
        setDocAbierto(null);
        try {
            const { desde, hasta } = rangoDeFiltros(f);
            const params = { producto: row.ProIdProducto, moneda: MONEDA_ID_MAP[f.moneda], ...paramsAmbito(f.ambito) };
            if (desde) params.fechaDesde = desde;
            if (hasta) params.fechaHasta = hasta;
            if (cliente.id) params.cliente = cliente.id;
            const r = await api.get('/contabilidad/reportes/top-productos-detalle', { params });
            setDrill(d => d ? { ...d, rows: r.data.data || [] } : d);
        } catch {
            setDrill(d => d ? { ...d, rows: [] } : d);
        }
    };

    const exportar = () => descargarCSV(
        `top_productos_${f.moneda}_${new Date().toISOString().slice(0, 10)}.csv`,
        ['#', 'Código', 'Descripción', 'Grupo', 'Sector', 'Área', 'Variante', 'Unidades', `Monto (${f.moneda})`, 'Precio prom.', 'Documentos'],
        vista.map((r, i) => [i + 1, r.CodArticulo, r.Descripcion, r.Grupo, r.Sector, r.Area, r.Variante || '',
            r.Unidades, Number(r.Monto).toFixed(2),
            r.Unidades ? (r.Monto / r.Unidades).toFixed(2) : '', r.CantidadDocumentos]));

    const drillTotal = drill?.rows?.reduce((s, d) => s + Number(d.Subtotal || 0), 0) || 0;

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2.5">
                <FilaFecha f={f} setF={setF} />
                <FilaVerPor verPor={f.verPor} onVerPor={v => setF({ verPor: v })}
                    ambito={f.ambito} onAmbito={v => setF({ ambito: v })} opciones={opciones} />
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 w-14 shrink-0 tracking-wide">ORDENAR</span>
                    <Chip active={f.orden === 'monto'} onClick={() => setF({ orden: 'monto' })}>Monto total ($)</Chip>
                    <Chip active={f.orden === 'unid'} onClick={() => setF({ orden: 'unid' })}>Unidades vendidas</Chip>
                    <span className="text-[11px] font-bold text-slate-500 tracking-wide ml-3">MONEDA</span>
                    {['UYU', 'USD'].map(m => <Chip key={m} active={f.moneda === m} onClick={() => setF({ moneda: m })}>{m}</Chip>)}
                    <span className="text-[11px] font-bold text-slate-500 tracking-wide ml-3">TOP</span>
                    <input type="number" min="1" max="200" value={f.top}
                        onChange={e => setF({ top: e.target.value })}
                        title="Cuántos productos mostrar en el ranking"
                        className="text-xs border border-slate-300 rounded-lg px-2 py-1 w-16 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                    <span className="text-[11px] text-slate-400">productos</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-500 tracking-wide">FAMILIA</span>
                        <select value={f.familia} onChange={e => setF({ familia: e.target.value })}
                            className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-brand-cyan/30">
                            {familias.map(g => <option key={g} value={g}>{g === 'Todas' ? 'Todas (grupo)' : g}</option>)}
                        </select>
                    </div>
                    <div className="flex items-center gap-2 relative" ref={cliBoxRef}>
                        <span className="text-[11px] font-bold text-slate-500 tracking-wide">CLIENTE</span>
                        <div className="relative">
                            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" placeholder="Todos — buscar cliente..." value={cliente.nombre}
                                onChange={e => setCliente({ id: null, nombre: e.target.value, sugs: [] })}
                                className="text-xs border border-slate-300 rounded-lg pl-7 pr-2 py-1.5 focus:ring-2 focus:ring-brand-cyan/30 outline-none w-52" />
                            {cliente.sugs.length > 0 && (
                                <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 min-w-full max-h-48 overflow-y-auto">
                                    {cliente.sugs.map(c => (
                                        <button key={c.CliIdCliente}
                                            className="w-full text-left px-3 py-2 text-xs hover:bg-brand-cyan/10 hover:text-brand-cyan transition-colors first:rounded-t-xl last:rounded-b-xl"
                                            onClick={() => setCliente({ id: c.CliIdCliente, nombre: (c.Nombre || c.NombreFantasia || '').trim(), sugs: [] })}>
                                            {(c.Nombre || c.NombreFantasia || '').trim()}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {cliente.nombre && (
                            <button onClick={() => setCliente({ id: null, nombre: '', sugs: [] })}
                                className="text-xs text-red-500 hover:text-red-700 font-bold leading-none" title="Limpiar">✕</button>
                        )}
                    </div>
                    <button onClick={exportar} disabled={!vista.length}
                        className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all shadow-sm">
                        <Download size={13} /> Exportar CSV
                    </button>
                </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-4 py-3">{error}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiCard label={`Monto total (${f.moneda})`} value={`${sym} ${fmtMoney(totM)}`} sub={`${vista.length} artículos`} color={f.moneda === 'USD' ? '#0891b2' : '#0d9488'} />
                <KpiCard label="Unidades vendidas" value={fmtMoney(totU)} sub="en el período/filtro" color="#8b5cf6" />
                <KpiCard label="Producto #1" value={vista.length ? vista[0].Descripcion : '—'}
                    sub={vista.length ? (f.orden === 'unid' ? `${fmtMoney(vista[0].Unidades)} u.` : `${sym} ${fmtMoney(vista[0].Monto)}`) : ''} color="#f59e0b" />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-700">Top {topN} productos</span>
                    <span className="text-[11px] text-slate-400">{vista.length} artículos · orden por {f.orden === 'unid' ? 'unidades' : 'monto'} · {f.moneda} · clic para ver comprobantes</span>
                </div>
                {loading ? (
                    <div className="flex items-center justify-center py-14"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-cyan" /></div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50/50 border-b border-slate-100">
                                <tr>
                                    <th className="px-3 py-2 text-left text-slate-400 font-semibold w-10">#</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold">Código</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold">Descripción</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold">{f.verPor === 'sector' ? 'Sector' : 'Área'}</th>
                                    <th className="px-3 py-2 text-right text-slate-500 font-semibold">Unidades</th>
                                    <th className="px-3 py-2 text-right text-slate-500 font-semibold">Monto acumulado</th>
                                    <th className="px-3 py-2 text-right text-slate-500 font-semibold">Precio prom.</th>
                                    <th className="px-3 py-2 text-right text-slate-500 font-semibold">Docs</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {vista.map((r, i) => (
                                    <tr key={r.ProIdProducto} className="hover:bg-cyan-50/40 cursor-pointer transition-colors" onClick={() => abrirDrill(r)}>
                                        <td className="px-3 py-2"><RankBadge n={i + 1} /></td>
                                        <td className="px-3 py-2 font-mono text-slate-500">{r.CodArticulo}</td>
                                        <td className="px-3 py-2">
                                            <div className="font-semibold text-teal-700">{r.Descripcion}</div>
                                            {r.Grupo && <div className="text-[10px] text-slate-400">Grupo {r.Grupo}</div>}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1.5 text-slate-600">
                                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorArea(r.Area) }} />
                                                {f.verPor === 'sector' ? (r.Sector || '—') : (r.Area || '—')}
                                            </span>
                                            {r.Variante && <div className="text-[10px] text-slate-400 pl-3.5">{r.Variante}</div>}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtMoney(r.Unidades)}</td>
                                        <td className="px-3 py-2 text-right whitespace-nowrap">
                                            <span className="font-mono tabular-nums font-bold">{sym} {fmtMoney(r.Monto)}</span>
                                            <MiniBar pct={((f.orden === 'unid' ? r.Unidades : r.Monto) / maxV) * 100} color="#0d9488" />
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums">{r.Unidades ? `${sym} ${fmtMoney(r.Monto / r.Unidades)}` : '—'}</td>
                                        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{fmtInt(r.CantidadDocumentos)}</td>
                                    </tr>
                                ))}
                                {!vista.length && <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">Sin datos para el filtro seleccionado.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <p className="text-[11px] text-slate-400">
                El artículo se resuelve desde la cotización de la orden de cada línea facturada; las ventas sin orden o sin artículo cotizado no entran al ranking,
                y las notas de crédito no se incluyen. Unidades en la unidad de medida de cada artículo (metros, unidades, etc.).
            </p>

            <DrillModal drill={drill} onClose={() => { setDrill(null); setDocAbierto(null); }}>
                <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                        <tr>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Comprobante</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">N°</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Fecha</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Orden</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">{f.verPor === 'sector' ? 'Sector' : 'Área'}</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Trabajo</th>
                            <th className="px-3 py-2 text-left text-slate-500 font-semibold">Cliente</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Cant.</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">P. unitario</th>
                            <th className="px-3 py-2 text-right text-slate-500 font-semibold">Importe</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {(drill?.rows || []).map((d, i) => (
                            <Fragment key={i}>
                                <tr className={docAbierto?.id === d.DocIdDocumento ? 'bg-cyan-50/40' : ''}>
                                    <td className="px-3 py-1.5 whitespace-nowrap"><span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700">{d.DocTipo}</span></td>
                                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                                        <button onClick={() => toggleDoc(d.DocIdDocumento)}
                                            className="text-teal-700 font-semibold hover:underline" title="Ver las líneas del documento">
                                            {d.NumeroInterno} {docAbierto?.id === d.DocIdDocumento ? '▴' : '▾'}
                                        </button>
                                    </td>
                                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtFecha(d.DocFechaEmision)}</td>
                                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">{d.CodigoOrden}</td>
                                    <td className="px-3 py-1.5 whitespace-nowrap">
                                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorArea(d.Area) }} />
                                            {f.verPor === 'sector' ? (d.Sector || '—') : (d.Area || '—')}
                                        </span>
                                        {d.Variante && <div className="text-[10px] text-slate-400 pl-3.5">{d.Variante}</div>}
                                    </td>
                                    <td className="px-3 py-1.5 text-slate-600 max-w-[16rem] truncate" title={d.NombreTrabajo || ''}>{d.NombreTrabajo || '—'}</td>
                                    <td className="px-3 py-1.5 text-slate-600">{d.Cliente}</td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtMoney(d.Cantidad)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{sym} {fmtMoney(d.PrecioUnitario)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">{sym} {fmtMoney(d.Subtotal)}</td>
                                </tr>
                                {docAbierto?.id === d.DocIdDocumento && (
                                    <tr>
                                        <td colSpan={9} className="bg-slate-50/80 px-4 py-3">
                                            {docAbierto.loading ? (
                                                <p className="text-[11px] text-slate-400">Cargando documento...</p>
                                            ) : docAbierto.lineas.length === 0 ? (
                                                <p className="text-[11px] text-slate-400">El documento no tiene líneas cargadas.</p>
                                            ) : (
                                                <table className="w-full text-[11px] bg-white rounded-lg overflow-hidden border border-slate-200">
                                                    <thead className="bg-slate-100">
                                                        <tr>
                                                            <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Todas las líneas del documento</th>
                                                            <th className="px-2 py-1.5 text-left text-slate-500 font-semibold">Orden</th>
                                                            <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Cant.</th>
                                                            <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">P. unitario</th>
                                                            <th className="px-2 py-1.5 text-right text-slate-500 font-semibold">Total línea</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {docAbierto.lineas.map(l => (
                                                            <tr key={l.DcdIdDetalle}>
                                                                <td className="px-2 py-1.5 text-slate-700">{l.DcdNomItem}</td>
                                                                <td className="px-2 py-1.5 font-mono text-slate-500 whitespace-nowrap">{l.OrdCodigoOrden || ''}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtMoney(l.DcdCantidad)}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtMoney(l.DcdPrecioUnitario)}</td>
                                                                <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{fmtMoney(l.DcdTotal)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-slate-50 border-t-2 border-slate-200">
                            <td colSpan={8} className="px-3 py-2 font-bold text-slate-700">TOTAL ({drill?.rows?.length || 0} líneas)</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-extrabold">{sym} {fmtMoney(drillTotal)}</td>
                        </tr>
                    </tfoot>
                </table>
            </DrillModal>
        </div>
    );
}

// ─── Resumen Mensual (multimoneda unificada) ─────────────────────────────────
// Reutiliza el endpoint de Ventas por Área con el rango del mes; la unificación
// a un TC de referencia (editable) es de esta pantalla.
function ResumenMensualSection({ opciones }) {
    const hoy = new Date();
    const MESES_L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const [mes, setMes] = useState(hoy.getMonth());
    const [anio, setAnio] = useState(hoy.getFullYear());
    const [tc, setTc] = useState('');           // vacío = usa la cotización del día
    const [unif, setUnif] = useState('UYU');
    // Un solo control (VER POR) define el nivel: por qué se filtra Y cómo se agrupa.
    const [agrupar, setAgrupar] = useState('sector'); // 'sector' (comercial) | 'area' (productiva)
    const [ambito, setAmbito] = useState('Todas');    // acota el mes a un sector o un área
    const [porMoneda, setPorMoneda] = useState({});
    const [porSector, setPorSector] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const tcEff = Number(tc) > 0 ? Number(tc) : (Number(opciones.cotizacionDolar) || 40);

    const cargar = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const desde = `${anio}-${String(mes + 1).padStart(2, '0')}-01`;
            const hasta = new Date(Date.UTC(anio, mes + 1, 0)).toISOString().slice(0, 10);
            const r = await api.get('/contabilidad/reportes/ventas-por-area', {
                params: { fechaDesde: desde, fechaHasta: hasta, ...paramsAmbito(ambito) },
            });
            setPorMoneda(r.data.porMoneda || {});
            setPorSector(r.data.porSector || {});
        } catch (e) {
            setError(e.response?.data?.error || e.message);
            setPorMoneda({}); setPorSector({});
        } finally { setLoading(false); }
    }, [mes, anio, ambito]);
    useEffect(() => { cargar(); }, [cargar]);

    const totY = Number(porMoneda.UYU?.total || 0);
    const totU = Number(porMoneda.USD?.total || 0);
    const toUnif = (uyu, usd) => unif === 'UYU' ? uyu + usd * tcEff : uyu / tcEff + usd;
    const totUnif = toUnif(totY, totU);
    const symU = unif === 'USD' ? 'US$' : '$';

    // Filas por sector comercial (default) o por área productiva
    const fuente = agrupar === 'sector' ? porSector : porMoneda;
    const claveDe = it => agrupar === 'sector' ? it.nombre : it.area;
    const acc = {};
    for (const it of (fuente.UYU?.items || [])) { const k = claveDe(it); acc[k] = acc[k] || { uyu: 0, usd: 0 }; acc[k].uyu += it.ventas; }
    for (const it of (fuente.USD?.items || [])) { const k = claveDe(it); acc[k] = acc[k] || { uyu: 0, usd: 0 }; acc[k].usd += it.ventas; }
    const filas = Object.entries(acc)
        .map(([area, v]) => ({ area, ...v, unif: toUnif(v.uyu, v.usd) }))
        .sort((a, b) => b.unif - a.unif);
    const maxUnif = filas.length ? Math.max(...filas.map(x => x.unif)) : 1;
    const etiq = agrupar === 'sector' ? 'sector' : 'área';
    const etiqPlural = agrupar === 'sector' ? 'sectores' : 'áreas';

    const donutData = [
        { label: 'Pesos (UYU)', value: unif === 'UYU' ? totY : totY / tcEff, color: '#0d9488' },
        { label: 'Dólares (USD)', value: unif === 'UYU' ? totU * tcEff : totU, color: '#06b6d4' },
    ];
    const donutTot = donutData.reduce((s, d) => s + d.value, 0) || 1;

    const exportar = () => descargarCSV(
        `resumen_mensual_${agrupar}_${anio}-${String(mes + 1).padStart(2, '0')}.csv`,
        ['#', agrupar === 'sector' ? 'Sector' : 'Área', 'Total Pesos (UYU)', 'Total Dólares (USD)', `Total Unificado (${unif})`, '% part.', `TC 1 USD = ${tcEff} UYU`],
        filas.map((x, i) => [i + 1, x.area, x.uyu.toFixed(2), x.usd.toFixed(2), x.unif.toFixed(2), totUnif ? ((x.unif / totUnif) * 100).toFixed(2) : 0, '']));

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 tracking-wide">PERÍODO</span>
                    <select value={mes} onChange={e => setMes(Number(e.target.value))}
                        className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-brand-cyan/30">
                        {MESES_L.map((m, i) => <option key={m} value={i}>{m}</option>)}
                    </select>
                    <select value={anio} onChange={e => setAnio(Number(e.target.value))}
                        className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-brand-cyan/30">
                        {[hoy.getFullYear() - 2, hoy.getFullYear() - 1, hoy.getFullYear()].map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <div className="h-4 w-px bg-slate-200 hidden sm:block" />
                    <span className="text-[11px] text-slate-500">TC de referencia · 1 USD =</span>
                    <input type="number" step="0.1" value={tc} placeholder={String(tcEff)}
                        onChange={e => setTc(e.target.value)}
                        className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-20 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                    <span className="text-[11px] text-slate-500">UYU {!tc && opciones.cotizacionDolar ? '(cotización del día)' : ''}</span>
                    <div className="h-4 w-px bg-slate-200 hidden sm:block" />
                    <span className="text-[11px] text-slate-500">Unificar en:</span>
                    <Chip active={unif === 'UYU'} onClick={() => setUnif('UYU')}>Pesos</Chip>
                    <Chip active={unif === 'USD'} onClick={() => setUnif('USD')}>Dólares</Chip>
                    <button onClick={exportar} disabled={!filas.length}
                        className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all shadow-sm">
                        <Download size={13} /> Exportar CSV
                    </button>
                </div>
                <FilaVerPor verPor={agrupar} onVerPor={setAgrupar}
                    ambito={ambito} onAmbito={setAmbito} opciones={opciones} />
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-4 py-3">{error}</div>}

            {loading ? (
                <div className="flex items-center justify-center py-14"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-cyan" /></div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <KpiCard label="Venta total en Pesos" value={`$ ${fmtMoney(totY)}`} sub={`${MESES_L[mes]} ${anio}`} color="#0d9488" />
                        <KpiCard label="Venta total en Dólares" value={`US$ ${fmtMoney(totU)}`} sub={`${MESES_L[mes]} ${anio}`} color="#0891b2" />
                        <KpiCard label={`Total unificado (${unif === 'UYU' ? 'pesos' : 'dólares'})`} value={`${symU} ${fmtMoney(totUnif)}`}
                            sub={`TC 1 USD = ${fmtMoney(tcEff)} UYU`} color="#8b5cf6" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                            <h3 className="font-bold text-slate-700 text-sm">Participación por {etiq}</h3>
                            <p className="text-[11px] text-slate-400 mb-3">Total unificado por {etiq} (en {unif === 'UYU' ? 'pesos' : 'dólares'})</p>
                            <div className="space-y-2">
                                {filas.map(x => (
                                    <div key={x.area} className="grid items-center gap-3" style={{ gridTemplateColumns: '150px 1fr 110px' }}>
                                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 font-medium truncate">
                                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorArea(x.area) }} />{x.area}
                                        </span>
                                        <div className="h-4 bg-slate-100 rounded-md overflow-hidden">
                                            <i className="block h-full rounded-md" style={{ width: `${(x.unif / maxUnif) * 100}%`, background: colorArea(x.area) }} />
                                        </div>
                                        <span className="text-right font-mono tabular-nums text-xs font-semibold">{symU} {fmtMoney(x.unif)}</span>
                                    </div>
                                ))}
                                {!filas.length && <p className="text-xs text-slate-400 text-center py-6">Sin ventas en {MESES_L[mes]} {anio}.</p>}
                            </div>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                            <h3 className="font-bold text-slate-700 text-sm">Composición por moneda</h3>
                            <p className="text-[11px] text-slate-400 mb-3">Pesos vs. dólares del mes (equivalente unificado)</p>
                            <div className="flex items-center gap-4">
                                <DonutChart data={donutData} centerLabel={unif} />
                                <div className="flex-1 space-y-1.5 min-w-0">
                                    {donutData.map(d => (
                                        <div key={d.label} className="flex items-center gap-2 text-xs">
                                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                                            <span className="text-slate-600 truncate flex-1">{d.label}</span>
                                            <span className="font-mono tabular-nums text-slate-800 font-semibold">{fmtMoney((d.value / donutTot) * 100)}%</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                            <span className="font-bold text-xs text-slate-700">Desglose por {etiq} — {MESES_L[mes]} {anio}</span>
                            <span className="text-[11px] text-slate-400">{filas.length} {etiqPlural} · unificado en {unif === 'UYU' ? 'pesos' : 'dólares'}</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50/50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-slate-400 font-semibold w-8">#</th>
                                        <th className="px-3 py-2 text-left text-slate-500 font-semibold">{agrupar === 'sector' ? 'Sector' : 'Área'}</th>
                                        <th className="px-3 py-2 text-right text-slate-500 font-semibold">Total Pesos (UYU)</th>
                                        <th className="px-3 py-2 text-right text-slate-500 font-semibold">Total Dólares (USD)</th>
                                        <th className="px-3 py-2 text-right text-slate-500 font-semibold">Total Unificado ({unif})</th>
                                        <th className="px-3 py-2 text-right text-slate-500 font-semibold">% part.</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filas.map((x, i) => (
                                        <tr key={x.area} className="hover:bg-slate-50/70 transition-colors">
                                            <td className="px-3 py-2 text-slate-300">{i + 1}</td>
                                            <td className="px-3 py-2">
                                                <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
                                                    <span className="w-2 h-2 rounded-full" style={{ background: colorArea(x.area) }} />{x.area}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">$ {fmtMoney(x.uyu)}</td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">US$ {fmtMoney(x.usd)}</td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums font-bold">{symU} {fmtMoney(x.unif)}</td>
                                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtMoney(totUnif ? (x.unif / totUnif) * 100 : 0)}%</td>
                                        </tr>
                                    ))}
                                    {!filas.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">Sin ventas en el mes elegido.</td></tr>}
                                </tbody>
                                {filas.length > 0 && (
                                    <tfoot>
                                        <tr className="bg-slate-100 border-t-2 border-slate-300">
                                            <td className="px-3 py-2.5"></td>
                                            <td className="px-3 py-2.5 font-bold text-slate-800">TOTAL EMPRESA</td>
                                            <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold">$ {fmtMoney(totY)}</td>
                                            <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold">US$ {fmtMoney(totU)}</td>
                                            <td className="px-3 py-2.5 text-right font-mono tabular-nums font-extrabold">{symU} {fmtMoney(totUnif)}</td>
                                            <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold">100%</td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                        Los KPIs suman por separado lo facturado en pesos y en dólares (mismo universo que Ventas por Área).
                        La columna Total Unificado lleva las dos monedas a una sola con el TC de referencia, para calcular el % real de participación de cada área.
                    </p>
                </>
            )}
        </div>
    );
}

// ─── Sectores y Catálogo (configuración) ─────────────────────────────────────
// Dos cosas en una pantalla porque son la misma decisión vista de dos lados:
//   1. Qué áreas agrupa cada sector comercial (dbo.SectorMapeo).
//   2. En qué área/variante vive cada artículo del catálogo (ArticuloClasificacion),
//      para que una venta de mostrador sin orden igual sepa a qué sector pertenece.
function CatalogoSectoresSection() {
    const [tab, setTab] = useState('catalogo'); // 'catalogo' | 'sectores'
    const [cat, setCat] = useState(null);
    const [sec, setSec] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [msg, setMsg] = useState(null);
    const [abiertos, setAbiertos] = useState({});     // nodos expandidos del árbol
    const [seleccion, setSeleccion] = useState([]);   // artículos tildados (sin clasificar)
    const [destino, setDestino] = useState({ area: '', variante: '' });
    const [busca, setBusca] = useState('');
    const [nuevoSector, setNuevoSector] = useState({ id: '', nombre: '', orden: 100 });

    const cargar = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const [rc, rs] = await Promise.all([
                api.get('/contabilidad/reportes/catalogo'),
                api.get('/contabilidad/reportes/sectores'),
            ]);
            setCat(rc.data); setSec(rs.data);
        } catch (e) {
            setError(e.response?.data?.error || e.message);
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const avisar = (t) => { setMsg(t); setTimeout(() => setMsg(null), 4000); };

    const clasificar = async (productos, area, variante) => {
        if (!productos.length) return;
        try {
            await api.put('/contabilidad/reportes/catalogo/articulo', { productos, area, variante });
            avisar(area
                ? `${productos.length} artículo(s) movidos a ${area}${variante ? ' / ' + variante : ''}.`
                : `${productos.length} artículo(s) quedaron sin clasificar.`);
            setSeleccion([]);
            await cargar();
        } catch (e) { avisar('Error: ' + (e.response?.data?.error || e.message)); }
    };

    const asignarAreaASector = async (area, sector) => {
        try {
            await api.put('/contabilidad/reportes/sectores/mapeo', { area, sector });
            avisar(sector ? `El área ${area} ahora pertenece al sector elegido.` : `El área ${area} quedó sin sector.`);
            await cargar();
        } catch (e) { avisar('Error: ' + (e.response?.data?.error || e.message)); }
    };

    const crearSector = async () => {
        if (!nuevoSector.id.trim() || !nuevoSector.nombre.trim()) { avisar('Poné código y nombre del sector.'); return; }
        try {
            await api.post('/contabilidad/reportes/sectores', nuevoSector);
            avisar(`Sector "${nuevoSector.nombre}" guardado.`);
            setNuevoSector({ id: '', nombre: '', orden: 100 });
            await cargar();
        } catch (e) { avisar('Error: ' + (e.response?.data?.error || e.message)); }
    };

    if (loading) return <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-cyan" /></div>;
    if (error) return <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-4 py-3">{error}</div>;
    // Base sin las tablas de sectores/clasificación todavía
    if (cat && cat.disponible === false) return (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-4 py-3 max-w-2xl">
            {cat.mensaje || 'Falta la migración de sectores y clasificación de artículos en esta base.'}
        </div>
    );

    const sinClas = (cat?.sinClasificar || []).filter(a =>
        !busca.trim() || `${a.descripcion} ${a.codArticulo} ${a.grupo}`.toLowerCase().includes(busca.trim().toLowerCase()));
    const variantesDestino = (cat?.variantesPorArea?.[destino.area]) || [];

    return (
        <div className="space-y-4 max-w-6xl">
            <div className="flex items-center gap-2">
                <Chip active={tab === 'catalogo'} onClick={() => setTab('catalogo')}>Catálogo de artículos</Chip>
                <Chip active={tab === 'sectores'} onClick={() => setTab('sectores')}>Configurar sectores</Chip>
                {msg && <span className="ml-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1">{msg}</span>}
            </div>

            {tab === 'sectores' ? (
                <>
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <Settings2 size={15} className="text-slate-500" />
                            <span className="font-bold text-slate-700 text-sm">A qué sector pertenece cada área</span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                            El <b>área</b> es dónde se produjo (no cambia); el <b>sector</b> es cómo lo agrupa el negocio.
                            Cambiar esta asignación <b>reagrupa todo el histórico al instante</b> y no modifica ninguna venta:
                            los importes siguen siendo los mismos, solo se suman en otra columna.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(sec?.areas || []).map(a => (
                                <div key={a.nombre} className="flex items-center gap-2 border border-slate-100 rounded-lg px-3 py-2">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorArea(a.nombre) }} />
                                    <span className="text-xs text-slate-700 flex-1 truncate">{a.nombre}</span>
                                    <select value={a.sector || ''} onChange={e => asignarAreaASector(a.nombre, e.target.value)}
                                        className={`text-xs border rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-brand-cyan/30 ${
                                            a.sector ? 'border-slate-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
                                        <option value="">— Sin sector —</option>
                                        {(sec?.sectores || []).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                        <span className="font-bold text-slate-700 text-sm">Sectores</span>
                        <div className="space-y-1.5">
                            {(sec?.sectores || []).map(s => (
                                <div key={s.id} className="flex items-center gap-3 text-xs border border-slate-100 rounded-lg px-3 py-2">
                                    <span className="font-semibold text-slate-700 w-44 truncate">{s.nombre}</span>
                                    <span className="font-mono text-[10px] text-slate-400 w-32">{s.id}</span>
                                    <span className="text-slate-500 flex-1 truncate">
                                        {s.areas.length ? s.areas.join(' + ') : <span className="text-amber-600">sin áreas asignadas</span>}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-end gap-2 flex-wrap border-t border-slate-100 pt-3">
                            <div>
                                <label className="block text-[10px] text-slate-400 font-semibold mb-0.5">CÓDIGO (interno)</label>
                                <input value={nuevoSector.id} onChange={e => setNuevoSector(s => ({ ...s, id: e.target.value }))}
                                    placeholder="EJ_NUEVO" className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-32 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                            </div>
                            <div>
                                <label className="block text-[10px] text-slate-400 font-semibold mb-0.5">NOMBRE VISIBLE</label>
                                <input value={nuevoSector.nombre} onChange={e => setNuevoSector(s => ({ ...s, nombre: e.target.value }))}
                                    placeholder="Nombre del sector" className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-52 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                            </div>
                            <div>
                                <label className="block text-[10px] text-slate-400 font-semibold mb-0.5">ORDEN</label>
                                <input type="number" value={nuevoSector.orden} onChange={e => setNuevoSector(s => ({ ...s, orden: e.target.value }))}
                                    className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-20 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                            </div>
                            <button onClick={crearSector}
                                className="px-4 py-1.5 bg-brand-cyan hover:opacity-90 text-white text-xs font-semibold rounded-lg transition-all shadow-sm">
                                Crear o renombrar sector
                            </button>
                            <span className="text-[11px] text-slate-400">Si el código ya existe, se le cambia el nombre y el orden.</span>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <KpiCard label="Artículos del catálogo" value={fmtInt(cat?.totalArticulos || 0)} sub="total en Artículos" color="#0d9488" />
                        <KpiCard label="Clasificados" value={fmtInt(cat?.clasificados || 0)}
                            sub="tienen área y variante" color="#10b981" />
                        <KpiCard label="Sin clasificar" value={fmtInt(cat?.sinClasificar?.length || 0)}
                            sub="no heredan área en las ventas" color="#f59e0b" />
                    </div>

                    {/* Árbol del catálogo */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                            <span className="font-bold text-xs text-slate-700">Sector → Área → Variante → Artículos</span>
                            <span className="text-[11px] text-slate-400">clic en una rama para abrirla</span>
                        </div>
                        <div className="p-2 max-h-[30rem] overflow-y-auto">
                            {(cat?.arbol || []).map(s => {
                                const openS = abiertos[s.id];
                                return (
                                    <div key={s.id}>
                                        <button onClick={() => setAbiertos(a => ({ ...a, [s.id]: !a[s.id] }))}
                                            className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg text-left">
                                            <ChevronDown size={13} className={`text-slate-400 transition-transform ${openS ? '' : '-rotate-90'}`} />
                                            <span className="font-bold text-xs text-slate-800">{s.nombre}</span>
                                            <span className="text-[10px] text-slate-400">{s.cantidad} artículos</span>
                                        </button>
                                        {openS && s.hijos.map(a => {
                                            const openA = abiertos[a.id];
                                            return (
                                                <div key={a.id} className="ml-5">
                                                    <button onClick={() => setAbiertos(x => ({ ...x, [a.id]: !x[a.id] }))}
                                                        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg text-left">
                                                        <ChevronDown size={12} className={`text-slate-300 transition-transform ${openA ? '' : '-rotate-90'}`} />
                                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorArea(a.nombre) }} />
                                                        <span className="text-xs text-slate-700 font-semibold">{a.nombre}</span>
                                                        <span className="text-[10px] text-slate-400">{a.cantidad}</span>
                                                    </button>
                                                    {openA && a.hijos.map(v => {
                                                        const openV = abiertos[v.id];
                                                        return (
                                                            <div key={v.id} className="ml-5">
                                                                <button onClick={() => setAbiertos(x => ({ ...x, [v.id]: !x[v.id] }))}
                                                                    className="w-full flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded-lg text-left">
                                                                    <ChevronDown size={11} className={`text-slate-300 transition-transform ${openV ? '' : '-rotate-90'}`} />
                                                                    <span className="text-xs text-slate-600">{v.nombre}</span>
                                                                    <span className="text-[10px] text-slate-400">{v.cantidad}</span>
                                                                </button>
                                                                {openV && (
                                                                    <div className="ml-8 space-y-0.5 pb-1">
                                                                        {v.articulos.map(art => (
                                                                            <div key={art.proIdProducto} className="flex items-center gap-2 text-[11px] px-2 py-1 hover:bg-slate-50 rounded group">
                                                                                <span className="font-mono text-slate-400 w-14 shrink-0 truncate">{art.codArticulo}</span>
                                                                                <span className="text-slate-600 flex-1 truncate">{art.descripcion}</span>
                                                                                {art.origen === 'USO' && <span className="text-[9px] text-slate-400 bg-slate-100 rounded px-1" title="Clasificado automáticamente por el uso real en órdenes">auto</span>}
                                                                                <button onClick={() => clasificar([art.proIdProducto], '', '')}
                                                                                    className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 font-bold px-1"
                                                                                    title="Sacar del árbol (queda sin clasificar)">✕</button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                            {!(cat?.arbol || []).length && <p className="text-xs text-slate-400 text-center py-8">Todavía no hay artículos clasificados.</p>}
                        </div>
                    </div>

                    {/* Sin clasificar */}
                    <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between flex-wrap gap-2">
                            <span className="font-bold text-xs text-amber-800">Artículos sin clasificar ({cat?.sinClasificar?.length || 0})</span>
                            <div className="relative">
                                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar artículo..."
                                    className="text-xs border border-slate-300 rounded-lg pl-7 pr-2 py-1 w-52 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                            </div>
                        </div>

                        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 flex-wrap bg-slate-50/60">
                            <span className="text-[11px] font-bold text-slate-500">MOVER {seleccion.length} SELECCIONADO(S) A</span>
                            <select value={destino.area} onChange={e => setDestino({ area: e.target.value, variante: '' })}
                                className="text-xs border border-slate-300 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-brand-cyan/30">
                                <option value="">— Elegí un área —</option>
                                {(cat?.areas || []).map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                            <input list="variantes-destino" value={destino.variante} placeholder="Variante (opcional)"
                                onChange={e => setDestino(d => ({ ...d, variante: e.target.value }))}
                                className="text-xs border border-slate-300 rounded-lg px-2 py-1 w-52 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                            <datalist id="variantes-destino">
                                {variantesDestino.map(v => <option key={v} value={v} />)}
                            </datalist>
                            <button onClick={() => clasificar(seleccion, destino.area, destino.variante)}
                                disabled={!seleccion.length || !destino.area}
                                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-all">
                                <Check size={12} /> Clasificar
                            </button>
                            {sinClas.length > 0 && (
                                <button onClick={() => setSeleccion(seleccion.length === sinClas.length ? [] : sinClas.map(a => a.proIdProducto))}
                                    className="text-[11px] text-brand-cyan font-semibold hover:underline ml-auto">
                                    {seleccion.length === sinClas.length ? 'Desmarcar todos' : `Marcar los ${sinClas.length} visibles`}
                                </button>
                            )}
                        </div>

                        <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                            {sinClas.map(a => {
                                const marcado = seleccion.includes(a.proIdProducto);
                                return (
                                    <label key={a.proIdProducto}
                                        className={`flex items-center gap-2 px-4 py-1.5 text-xs cursor-pointer hover:bg-slate-50 ${marcado ? 'bg-cyan-50/50' : ''}`}>
                                        <input type="checkbox" checked={marcado}
                                            onChange={() => setSeleccion(s => marcado ? s.filter(x => x !== a.proIdProducto) : [...s, a.proIdProducto])} />
                                        <span className="font-mono text-slate-400 w-14 shrink-0 truncate">{a.codArticulo}</span>
                                        <span className="text-slate-700 flex-1 truncate">{a.descripcion}</span>
                                        {a.grupo && <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5">grupo {a.grupo}</span>}
                                    </label>
                                );
                            })}
                            {!sinClas.length && <p className="text-xs text-slate-400 text-center py-8">
                                {busca ? 'Ningún artículo coincide con la búsqueda.' : '¡Todo el catálogo está clasificado!'}</p>}
                        </div>
                    </div>

                    <p className="text-[11px] text-slate-400">
                        Los marcados como <b>auto</b> se clasificaron solos según el área y variante en que más se usaron en órdenes reales;
                        podés corregirlos sacándolos del árbol y volviéndolos a asignar. Clasificar un artículo no cambia ninguna venta ya
                        registrada: sirve para que las ventas de mostrador (sin orden de producción) puedan saber a qué área y sector pertenecen.
                    </p>
                </>
            )}
        </div>
    );
}

// ─── Libro Contador (CSV de importación para el estudio contable) ────────────
// Formato: Dia,Debe,Haber,Concepto,RUC,Moneda,Total,CodigoIVA,IVA,Cotizacion,Libro
// Solo documentos ACEPTADO_DGI. La lógica vive en backend/services/libroContadorService.js.
function LibroContadorSection() {
    const hoy = new Date();
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const defMes = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`;

    const [mes, setMes] = useState(defMes);
    const [fechaBase, setFechaBase] = useState('dgi');
    const [busy, setBusy] = useState(null);      // 'ventas' | 'cobros' | null
    const [result, setResult] = useState({});    // { ventas: {stats, archivos}, cobros: {...} }
    const [preview, setPreview] = useState(null); // { tipo, mes, archivos: [{filename, lineas, rows}] }
    const [error, setError] = useState(null);

    const COLUMNAS = ['Dia', 'Debe', 'Haber', 'Concepto', 'RUC', 'Moneda', 'Total', 'CodigoIVA', 'IVA', 'Cotizacion', 'Libro'];
    const PREVIEW_MAX_FILAS = 500;

    const fetchLibro = async (tipo) => {
        const url = tipo === 'ventas'
            ? '/contabilidad/reportes/libro-contador-ventas'
            : '/contabilidad/reportes/libro-contador-cobros';
        const params = tipo === 'ventas' ? { mes, fechaBase } : { mes };
        const r = await api.get(url, { params });
        const archivos = r.data.archivos || [];
        setResult(p => ({ ...p, [tipo]: { stats: r.data.stats, archivos } }));
        return archivos;
    };

    const descargar = async (tipo) => {
        setBusy(tipo);
        setError(null);
        try {
            const archivos = await fetchLibro(tipo);
            for (const a of archivos) {
                const blob = new Blob([a.csv], { type: 'text/csv;charset=utf-8;' });
                const u = URL.createObjectURL(blob);
                const el = document.createElement('a');
                el.href = u; el.download = a.filename; el.click();
                URL.revokeObjectURL(u);
            }
        } catch (e) {
            setError(e.response?.data?.error || e.message || 'Error al generar el libro');
        } finally {
            setBusy(null);
        }
    };

    const verEnPantalla = async (tipo) => {
        setBusy(tipo);
        setError(null);
        try {
            const archivos = await fetchLibro(tipo);
            setPreview({
                tipo,
                mes,
                archivos: archivos.map(a => ({
                    filename: a.filename,
                    lineas: a.lineas,
                    // filas del CSV tal cual se exportan (sin el encabezado)
                    rows: a.csv.split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(',')),
                })),
            });
        } catch (e) {
            setError(e.response?.data?.error || e.message || 'Error al generar el libro');
        } finally {
            setBusy(null);
        }
    };

    const CardLibro = ({ tipo, titulo, descripcion, detalle }) => {
        const res = result[tipo];
        return (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <BookText size={16} className="text-amber-500" />
                    <span className="font-bold text-slate-700 text-sm">{titulo}</span>
                </div>
                <p className="text-xs text-slate-500">{descripcion}</p>
                <p className="text-[11px] text-slate-400">{detalle}</p>
                <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => verEnPantalla(tipo)} disabled={busy !== null}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-cyan hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-all shadow-sm">
                        {busy === tipo ? <RefreshCw size={13} className="animate-spin" /> : <Eye size={13} />}
                        {busy === tipo ? 'Generando...' : 'Ver en pantalla'}
                    </button>
                    <button onClick={() => descargar(tipo)} disabled={busy !== null}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-all shadow-sm">
                        {busy === tipo ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
                        {busy === tipo ? 'Generando...' : `Descargar CSV ${mes}`}
                    </button>
                </div>
                {res && (
                    res.archivos.length === 0
                        ? <p className="text-[11px] text-amber-600 font-medium">Sin registros para {mes}: no se descargó ningún archivo.</p>
                        : <div className="text-[11px] text-slate-500 space-y-0.5">
                            {res.archivos.map(a => (
                                <p key={a.filename}>✔ <span className="font-mono">{a.filename}</span> — {a.lineas.toLocaleString()} líneas</p>
                            ))}
                            {tipo === 'ventas' && res.stats && (
                                <p>{res.stats.total} documentos · {res.stats.usd} en USD · {res.stats.sinRuc} sin RUC/CI (e-tickets sin identificar)</p>
                            )}
                            {tipo === 'cobros' && res.stats && (
                                <p>{res.stats.movs} cobros · {res.stats.usd} en USD · {res.stats.sinMetodo} sin método de pago registrado</p>
                            )}
                        </div>
                )}
            </div>
        );
    };

    return (
        <div className="max-w-5xl space-y-4">
            {/* Selector de mes + fecha base */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 tracking-wide">MES</span>
                    <input type="month" value={mes} onChange={e => { setMes(e.target.value); setPreview(null); }}
                        className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                    <div className="h-4 w-px bg-slate-200 hidden sm:block" />
                    <span className="text-[11px] font-bold text-slate-500 tracking-wide">FECHA DEL LIBRO DE VENTAS</span>
                    {[{ v: 'dgi', l: 'Fecha DGI (la del CFE emitido)' }, { v: 'contable', l: 'Fecha contable (emisión interna)' }].map(o => (
                        <button key={o.v} onClick={() => { setFechaBase(o.v); setPreview(null); }}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                fechaBase === o.v ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}>
                            {o.l}
                        </button>
                    ))}
                </div>
                <p className="text-[11px] text-slate-400">
                    {fechaBase === 'dgi'
                        ? 'La columna Dia y el mes se toman de la fecha con la que el CFE quedó emitido ante DGI (coincide con lo que el contador ve en DGI).'
                        : 'La columna Dia y el mes se toman de la fecha de emisión interna del documento (puede no coincidir con la fecha declarada en DGI).'}
                </p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-4 py-3">{error}</div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <CardLibro tipo="ventas" titulo="Libro de Ventas"
                    descripcion="Todos los CFE aceptados por DGI del mes. Un asiento por documento: Debe 1121001 (deudores) por el total, Haber 5130 (ventas) por el neto y Haber 21332 (IVA) por el impuesto. Las notas de crédito van invertidas. Libro = V."
                    detalle="Formato: Dia,Debe,Haber,Concepto,RUC,Moneda,Total,CodigoIVA,IVA,Cotizacion,Libro. USD: Moneda=1, importe en dólares y cotización del día. Si hay más de una empresa, baja un archivo por empresa." />
                <CardLibro tipo="cobros" titulo="Libro de Cobros (facturas crédito)"
                    descripcion="Pagos del mes aplicados a facturas crédito aceptadas por DGI (pagos anulados excluidos). Por cada cobro: Debe caja/banco/cheques según el método de pago, Haber 1121001 (deudores). Libro = D."
                    detalle="La fecha es siempre la del cobro. Un pago que cubre varias facturas genera una línea por factura, con la serie y número oficial DGI en el concepto." />
            </div>

            {/* ── Vista previa en pantalla: las filas del CSV tal cual se exportan ── */}
            {preview && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Eye size={15} className="text-brand-cyan" />
                            <span className="font-bold text-slate-700 text-sm">
                                Vista previa — {preview.tipo === 'ventas' ? 'Libro de Ventas' : 'Libro de Cobros'} {preview.mes}
                            </span>
                        </div>
                        <button onClick={() => setPreview(null)}
                            className="text-xs text-slate-400 hover:text-red-500 font-bold px-2 py-1" title="Cerrar vista previa">
                            ✕ Cerrar
                        </button>
                    </div>

                    {preview.archivos.length === 0 ? (
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-6 text-center text-xs text-slate-400">
                            Sin registros para {preview.mes}.
                        </div>
                    ) : preview.archivos.map(a => (
                        <div key={a.filename} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                <span className="font-mono text-xs text-slate-700">{a.filename}</span>
                                <span className="text-[11px] text-slate-400">{a.lineas.toLocaleString()} líneas</span>
                            </div>
                            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                                        <tr>
                                            <th className="px-2 py-2 text-left text-slate-400 font-semibold w-8">#</th>
                                            {COLUMNAS.map(c => (
                                                <th key={c} className="px-2 py-2 text-left text-slate-500 font-semibold whitespace-nowrap">{c}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {a.rows.slice(0, PREVIEW_MAX_FILAS).map((row, i) => (
                                            <tr key={i} className="hover:bg-slate-50/70 transition-colors">
                                                <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{i + 1}</td>
                                                {COLUMNAS.map((c, j) => (
                                                    <td key={c} className={`px-2 py-1.5 whitespace-nowrap ${
                                                        ['Total', 'IVA', 'Cotizacion'].includes(c) ? 'font-mono tabular-nums text-right' : ''
                                                    } ${c === 'Debe' && row[j] ? 'text-sky-700 font-semibold' : ''} ${
                                                        c === 'Haber' && row[j] ? 'text-emerald-700 font-semibold' : ''}`}>
                                                        {row[j] || ''}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-400">
                                {a.rows.length > PREVIEW_MAX_FILAS
                                    ? `Mostrando las primeras ${PREVIEW_MAX_FILAS} de ${a.rows.length.toLocaleString()} filas — el archivo completo baja con "Descargar CSV".`
                                    : `${a.rows.length.toLocaleString()} filas — idénticas al CSV que baja con "Descargar CSV".`}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ContabilidadReportesPage() {
    const [activeReport, setActiveReport] = useState('ventas-area');
    const [opciones, setOpciones]         = useState({ areas: [], monedas: [] });
    // `ambito` = 'Todas' | 'S:<sectorId>' | 'A:<área>' — un solo valor en vez de dos
    // filtros excluyentes (un sector ya agrupa varias áreas).
    const [filters, setFilters]           = useState({
        ambito: 'Todas', fechaPreset: '30d', fechaDesde: '', fechaHasta: '',
        moneda: 'Todas', articuloId: null, articuloNombre: '',
    });

    const [areaData, setAreaData]   = useState([]);
    const [porMoneda, setPorMoneda] = useState({});
    const [porSector, setPorSector] = useState({});
    // Ventas por Área: ver agrupado por sector comercial (default) o por área productiva
    const [verPor, setVerPor] = useState('sector');
    const [docData, setDocData]     = useState([]);
    const [ingresos, setIngresos]   = useState({ porFechaPago: [], porFechaFactura: [] });
    const [ingresosBase, setIngresosBase] = useState('pago'); // 'pago' | 'factura'

    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState(null);

    // TC editable de la torta "Resumen unificado en dólares" (vacío = cotización del día)
    const [tcDoc, setTcDoc] = useState('');

    const [artSuggs, setArtSuggs] = useState([]);
    const artBoxRef = useRef(null);

    useEffect(() => {
        api.get('/contabilidad/reportes/ventas-filtros').then(r => {
            setOpciones({
                areas: r.data.areas || [],
                monedas: r.data.monedas || [],
                cotizacionDolar: r.data.cotizacionDolar || null,
                // Sin esto la fila SECTOR y el selector de ámbito quedan vacíos.
                sectores: r.data.sectores || [],
                areasSinSector: r.data.areasSinSector || [],
            });
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
        if (REPORTES_AUTONOMOS.includes(activeReport)) return; // esas secciones cargan solas, con sus propios filtros
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
                ...paramsAmbito(filters.ambito),
                ...(dateRange.desde && { fechaDesde: toISO(dateRange.desde) }),
                ...(dateRange.hasta && { fechaHasta: toISO(dateRange.hasta) }),
                ...(filters.articuloId && { articulo: filters.articuloId }),
            };

            if (activeReport === 'ventas-area') {
                const params = { ...baseParams, ...(filters.moneda !== 'Todas' && { moneda: filters.moneda }) };
                const r = await api.get('/contabilidad/reportes/ventas-por-area', { params });
                setAreaData(r.data.data || []);
                setPorMoneda(r.data.porMoneda || {});
                setPorSector(r.data.porSector || {});
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
            setAreaData([]); setPorMoneda({}); setPorSector({}); setDocData([]); setIngresos({ porFechaPago: [], porFechaFactura: [] });
        } finally {
            setLoading(false);
        }
    }, [activeReport, filters]);

    useEffect(() => { fetchReport(); }, [fetchReport]);

    const setF = patch => setFilters(f => ({ ...f, ...patch }));

    const handleReportChange = id => {
        setActiveReport(id);
        setAreaData([]); setPorMoneda({}); setPorSector({}); setDocData([]); setIngresos({ porFechaPago: [], porFechaFactura: [] });
    };

    const activeRep = REPORTS.find(r => r.id === activeReport);
    const hasData = activeReport === 'ventas-area' ? areaData.length > 0 : docData.length > 0;

    const exportarCSV = () => {
        let cols, rows, filename;
        if (activeReport === 'ventas-area') {
            const esSector = verPor === 'sector';
            cols = [esSector ? 'Sector' : 'Área', ...(esSector ? ['Áreas que agrupa'] : []),
                'Moneda', 'Ventas', '% del total', 'Cant. Documentos'];
            rows = filasTablaArea.map(it => [
                it.label, ...(esSector ? [`"${it.detalle || ''}"`] : []),
                it.moneda, it.ventas, it.porcentaje, it.cantidadDocumentos,
            ].join(','));
            filename = `ventas_por_${esSector ? 'sector' : 'area'}_${new Date().toISOString().split('T')[0]}.csv`;
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
    // Vista de Ventas por Área: normaliza sector/área a la misma forma para las
    // tortas y la tabla (el sector es un roll-up de áreas, los totales coinciden).
    const fuenteArea = verPor === 'sector' && Object.keys(porSector).length ? porSector : porMoneda;
    const monedasArea = Object.keys(fuenteArea);
    const itemsArea = (mon) => (fuenteArea[mon]?.items || []).map(it => ({
        label: verPor === 'sector' ? it.nombre : it.area,
        ventas: it.ventas,
        porcentaje: it.porcentaje,
        cantidadDocumentos: it.cantidadDocumentos,
        detalle: verPor === 'sector' ? (it.areas || []).join(' + ') : null,
    }));
    const filasTablaArea = monedasArea.flatMap(mon => itemsArea(mon).map(it => ({ ...it, moneda: mon })));

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
                        {!REPORTES_AUTONOMOS.includes(activeReport) && <div className="flex items-center gap-2 shrink-0">
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
                        </div>}
                    </div>

                    {!REPORTES_AUTONOMOS.includes(activeReport) && <>
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

                    {/* Fila 3: VER POR — el mismo control que el resto de los reportes */}
                    <FilaVerPor verPor={verPor} onVerPor={setVerPor}
                        ambito={filters.ambito} onAmbito={v => setF({ ambito: v })} opciones={opciones} />

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
                    </>}
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
                    ) : activeReport === 'catalogo' ? (
                        <CatalogoSectoresSection />
                    ) : activeReport === 'libro-contador' ? (
                        <LibroContadorSection />
                    ) : activeReport === 'top-clientes' ? (
                        <TopClientesSection opciones={opciones} />
                    ) : activeReport === 'top-productos' ? (
                        <TopProductosSection opciones={opciones} />
                    ) : activeReport === 'resumen-mensual' ? (
                        <ResumenMensualSection opciones={opciones} />
                    ) : activeReport === 'ventas-area' ? (
                        <>
                            {/* El nivel (sector o área) se elige arriba, en VER POR: ese
                                mismo control define el filtro y esta agrupación. */}
                            {monedasArea.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-40 gap-2">
                                    <PieChartIcon size={42} className="text-slate-200" />
                                    <p className="text-slate-400 text-sm">Sin resultados para los filtros seleccionados</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {monedasArea.map(moneda => {
                                        const items = itemsArea(moneda);
                                        const chartData = items.map((it, i) => ({
                                            label: it.label, value: it.ventas, color: AREA_COLORS[i % AREA_COLORS.length],
                                        }));
                                        return (
                                            <div key={moneda} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="font-bold text-slate-700 text-sm">{moneda}</span>
                                                    <span className="text-xs text-slate-400">
                                                        {items.length} {verPor === 'sector' ? 'sector' : 'área'}{items.length !== 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <DonutChart data={chartData} centerLabel={moneda} />
                                                    <div className="flex-1 space-y-1.5 min-w-0">
                                                        {items.map((it, i) => (
                                                            <div key={it.label} className="flex items-center gap-2 text-xs" title={it.detalle || ''}>
                                                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: AREA_COLORS[i % AREA_COLORS.length] }} />
                                                                <span className="text-slate-600 truncate flex-1">{it.label}</span>
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
                                rows={filasTablaArea}
                                cols={[
                                    { key: 'label', label: verPor === 'sector' ? 'Sector' : 'Área' },
                                    ...(verPor === 'sector' ? [{ key: 'detalle', label: 'Áreas que agrupa',
                                        render: v => <span className="text-slate-400">{v || '—'}</span> }] : []),
                                    { key: 'moneda', label: 'Moneda' },
                                    { key: 'ventas', label: 'Ventas', render: v => <span className="font-mono tabular-nums">{fmtMoney(v)}</span> },
                                    { key: 'porcentaje', label: '% del total', render: v => <span className="font-mono tabular-nums">{fmtMoney(v)}%</span> },
                                    { key: 'cantidadDocumentos', label: 'Cant. Documentos', render: v => <span className="font-mono tabular-nums">{fmtInt(v)}</span> },
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

                            {/* ── Resumen unificado en dólares (torta, maqueta del contador) ── */}
                            {Object.keys(docPorMoneda).length > 0 && (() => {
                                const tcEff = Number(tcDoc) > 0 ? Number(tcDoc) : (Number(opciones.cotizacionDolar) || 40);
                                const bY = docPorMoneda[1] || { enviado: 0, noEnviado: 0, pendiente: 0 };
                                const bU = docPorMoneda[2] || { enviado: 0, noEnviado: 0, pendiente: 0 };
                                const env = bU.enviado + bY.enviado / tcEff;
                                const noe = bU.noEnviado + bY.noEnviado / tcEff;
                                const pen = bU.pendiente + bY.pendiente / tcEff;
                                const tot = env + noe + pen;
                                const items = [
                                    { label: 'Enviadas a DGI', value: env, color: '#10b981' },
                                    { label: 'No enviadas', value: noe, color: '#f59e0b' },
                                    { label: 'Pendientes de cobro', value: pen, color: '#ef4444' },
                                ];
                                return (
                                    <div className="bg-white rounded-xl border border-emerald-200 shadow-sm ring-2 ring-emerald-500/10 p-4 space-y-3">
                                        <div className="flex items-center justify-between flex-wrap gap-2">
                                            <div>
                                                <span className="font-bold text-slate-700 text-sm">Resumen unificado en dólares</span>
                                                <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-700 align-middle">NUEVO</span>
                                                <p className="text-[11px] text-slate-400 mt-0.5">Todo convertido a USD — enviadas a DGI, no enviadas y pendientes de cobro</p>
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                                <span>Dólar del día · 1 USD =</span>
                                                <input type="number" step="0.1" value={tcDoc} placeholder={String(tcEff)}
                                                    onChange={e => setTcDoc(e.target.value)}
                                                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 w-20 outline-none focus:ring-2 focus:ring-brand-cyan/30" />
                                                <span>UYU {!tcDoc && opciones.cotizacionDolar ? '(cotización del día)' : ''}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-6 flex-wrap">
                                            <DonutChart data={items} size={150} centerLabel="US$ total" />
                                            <div className="flex-1 min-w-[260px] max-w-md space-y-1.5">
                                                {items.map(it => (
                                                    <div key={it.label} className="flex items-center gap-2 text-xs">
                                                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color }} />
                                                        <span className="text-slate-600 font-medium flex-1">{it.label}</span>
                                                        <span className="font-mono tabular-nums font-bold">US$ {fmtMoney(it.value)}</span>
                                                        <span className="font-mono tabular-nums text-slate-500 w-14 text-right">{tot ? fmtMoney((it.value / tot) * 100) : 0}%</span>
                                                    </div>
                                                ))}
                                                <div className="flex items-center gap-2 text-xs border-t border-slate-200 pt-2 mt-1">
                                                    <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-800" />
                                                    <span className="text-slate-800 font-extrabold flex-1">Total de las 3</span>
                                                    <span className="font-mono tabular-nums font-extrabold">US$ {fmtMoney(tot)}</span>
                                                    <span className="font-mono tabular-nums text-slate-500 w-14 text-right">100%</span>
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-slate-400">
                                            <b>Enviadas + no enviadas</b> cubren el total de documentos del filtro; <b>pendiente de cobro</b> es un estado de
                                            cobranza que se solapa con ambas. El "Total de las 3" resume tres indicadores, no es la suma de un universo cerrado.
                                        </p>
                                    </div>
                                );
                            })()}

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
