/**
 * CobranzasSection.jsx — Reportes de Contabilidad → "Cobranzas"
 * Los reportes que pidió administración (documento de control de cobranzas, 17-sep-2026)
 * y que no estaban en Antigüedad de Deuda:
 *   · Bloque ATENCIÓN (cartera + crédito + alertas)
 *   · Panel de vencimientos: una fila por deuda, con prioridad y acción sugerida
 *   · Informe semanal / mensual / trimestral: facturado, cobrado, pendiente, vencido, % cobranza
 *     (y abierto por condición de pago)
 *   · Ficha financiera por cliente: último pago, días que demora en pagar, vencido, facturas vencidas
 * Backend: controllers/cobranzasReportesController.js (sin SQL nuevo).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, Download, Search, AlertTriangle, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../services/apiClient';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDia = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const SIM = { UYU: '$', USD: 'US$' };

// Prioridad de una deuda según los días que faltan para vencer (negativo = vencida)
const prioridadDe = (dpv) => {
    if (dpv < -30) return { nivel: 5, key: 'V30', txt: `Vencida +30 d (${-dpv} d)`, accion: 'Contactar', cls: 'bg-slate-800 text-white border-slate-800' };
    if (dpv < 0)   return { nivel: 4, key: 'V',   txt: `Vencida (${-dpv} d)`,       accion: 'Contactar', cls: 'bg-rose-100 text-rose-700 border-rose-200' };
    if (dpv === 0) return { nivel: 3, key: 'HOY', txt: 'Vence hoy',                  accion: 'Contactar', cls: 'bg-rose-50 text-rose-600 border-rose-200' };
    if (dpv <= 3)  return { nivel: 2, key: 'D3',  txt: `Vence en ${dpv} d`,          accion: 'Avisar',     cls: 'bg-orange-100 text-orange-700 border-orange-200' };
    if (dpv <= 7)  return { nivel: 1, key: 'D7',  txt: `Vence en ${dpv} d`,          accion: 'Seguimiento', cls: 'bg-amber-100 text-amber-700 border-amber-200' };
    if (dpv <= 15) return { nivel: 0, key: 'D15', txt: `Vence en ${dpv} d`,          accion: '—', cls: 'bg-sky-50 text-sky-700 border-sky-200' };
    if (dpv <= 30) return { nivel: 0, key: 'D30', txt: `Vence en ${dpv} d`,          accion: '—', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    return { nivel: 0, key: 'MAS', txt: `Vence en ${dpv} d`, accion: '—', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
};
const TRAMOS = [
    { key: '',    label: 'Todos' },
    { key: 'V30', label: 'Vencidas +30 d' },
    { key: 'V',   label: 'Vencidas' },
    { key: 'HOY', label: 'Vencen hoy' },
    { key: 'D3',  label: '1–3 días' },
    { key: 'D7',  label: '4–7 días' },
    { key: 'D15', label: '8–15 días' },
    { key: 'D30', label: '16–30 días' },
    { key: 'MAS', label: '+30 días' },
];

// Semáforo de crédito (mismas reglas que Antigüedad de Deuda y la pestaña Límites del 360)
const nivelCredito = (utilizado, limite) => {
    if (!(limite > 0)) return -1;
    const p = utilizado / limite * 100;
    return p > 100 ? 4 : p >= 100 ? 3 : p >= 86 ? 2 : p >= 71 ? 1 : 0;
};

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const etiquetaPeriodo = (ymd, agrupar) => {
    const [y, m, d] = ymd.split('-').map(Number);
    if (agrupar === 'mes') return `${MESES[m - 1]} ${y}`;
    if (agrupar === 'trimestre') return `T${Math.floor((m - 1) / 3) + 1} ${y}`;
    const ini = new Date(y, m - 1, d), fin = new Date(y, m - 1, d + 6);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(ini.getDate())}/${p2(ini.getMonth() + 1)} – ${p2(fin.getDate())}/${p2(fin.getMonth() + 1)}`;
};

const bajarCSV = (nombre, cols, filas) => {
    const q = (s) => (typeof s === 'number' ? s : `"${String(s ?? '').replace(/"/g, '""')}"`);
    const csv = [cols.join(','), ...filas.map(f => f.map(q).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
};

const Chip = ({ active, onClick, children, title }) => (
    <button onClick={onClick} title={title}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${active ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
        {children}
    </button>
);
const pctCls = (p) => (p == null ? 'text-slate-400' : p >= 90 ? 'text-emerald-600' : p >= 75 ? 'text-amber-600' : 'text-rose-600');
const selCls = 'text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-brand-cyan/30 outline-none';

// ─── Gráfico de barras apiladas, uno por moneda ──────────────────────────────
// $ y US$ nunca comparten eje: cada moneda tiene su gráfico con su propia escala.
// Los colores siguen al concepto en todos los gráficos de la sección.
const SERIES = {
    cobrado:   { label: 'Cobrado',    color: '#1baf7a' },
    porVencer: { label: 'Por vencer', color: '#2a78d6' },
    vencido:   { label: 'Vencido',    color: '#e34948' },
};
const NOMBRE_MONEDA = { UYU: 'Pesos ($)', USD: 'Dólares (US$)' };
const compacto = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toLocaleString('es-UY', { maximumFractionDigits: 1 }) + ' M';
    if (a >= 1e3) return (v / 1e3).toLocaleString('es-UY', { maximumFractionDigits: 0 }) + ' k';
    return v.toLocaleString('es-UY', { maximumFractionDigits: 0 });
};
const recortar = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

function TooltipGrafico({ active, payload, series, moneda, pieTooltip }) {
    if (!active || !payload || !payload.length) return null;
    const fila = payload[0].payload;
    const total = series.reduce((t, k) => t + Number(fila[k] || 0), 0);
    return (
        <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
            <p className="font-bold text-slate-700 mb-1">{fila.titulo || fila.etiqueta}</p>
            {series.map(k => (
                <p key={k} className="flex items-center gap-2 text-slate-600 tabular-nums">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SERIES[k].color }} />
                    <span className="w-20">{SERIES[k].label}</span>
                    <span className="ml-auto font-bold text-slate-800">{SIM[moneda]} {fmt(fila[k])}</span>
                    <span className="w-10 text-right text-slate-400">{total > 0 ? Math.round(Number(fila[k] || 0) / total * 100) + '%' : ''}</span>
                </p>
            ))}
            <p className="flex gap-2 border-t border-slate-100 mt-1 pt-1 text-slate-500 tabular-nums">
                <span>Total</span><span className="ml-auto font-bold text-slate-800">{SIM[moneda]} {fmt(total)}</span><span className="w-10" />
            </p>
            {pieTooltip && <p className="text-[10px] text-slate-400 mt-1">{pieTooltip(fila)}</p>}
        </div>
    );
}

function GraficoMonedas({ titulo, nota, porMoneda, series, horizontal = false, porcentaje = false, onBarra, pieTooltip }) {
    const monedas = ['UYU', 'USD'].filter(m => (porMoneda[m] || []).some(f => series.some(k => Number(f[k] || 0) > 0)));
    return (
        <div className="px-4 py-3">
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mb-2">
                <p className="text-xs font-bold text-slate-600">{titulo}</p>
                <span className="flex items-center gap-3 ml-auto">
                    {series.map(k => (
                        <span key={k} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SERIES[k].color }} />{SERIES[k].label}
                        </span>
                    ))}
                </span>
            </div>
            {monedas.length === 0 ? <p className="text-xs text-slate-400 py-6 text-center">Sin datos para graficar</p> : (
                <div className={`grid gap-4 ${monedas.length > 1 ? 'lg:grid-cols-2' : ''}`}>
                    {monedas.map(m => {
                        const filas = porMoneda[m];
                        const alto = horizontal ? Math.max(120, filas.length * 30 + 40) : 220;
                        const ejeValor = { type: 'number', tick: { fontSize: 10, fill: '#64748b' }, axisLine: false, tickLine: false,
                            tickFormatter: porcentaje ? (v) => Math.round(v * 100) + '%' : compacto };
                        const ejeCat = { type: 'category', dataKey: 'etiqueta', tick: { fontSize: 10, fill: '#64748b' }, tickLine: false, axisLine: { stroke: '#cbd5e1' } };
                        return (
                            <div key={m}>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{NOMBRE_MONEDA[m]}</p>
                                <div style={{ height: alto }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={filas} layout={horizontal ? 'vertical' : 'horizontal'} stackOffset={porcentaje ? 'expand' : 'none'}
                                            margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barCategoryGap={horizontal ? '25%' : '30%'}>
                                            <CartesianGrid stroke="#e2e8f0" vertical={horizontal} horizontal={!horizontal} />
                                            {horizontal ? <XAxis {...ejeValor} /> : <XAxis {...ejeCat} interval={0} />}
                                            {horizontal ? <YAxis {...ejeCat} width={150} tickFormatter={(t) => recortar(t, 24)} /> : <YAxis {...ejeValor} width={48} />}
                                            <Tooltip cursor={{ fill: 'rgba(100,116,139,0.08)' }} content={<TooltipGrafico series={series} moneda={m} pieTooltip={pieTooltip} />} />
                                            {series.map((k, i) => (
                                                <Bar key={k} dataKey={k} name={SERIES[k].label} stackId="a" fill={SERIES[k].color} stroke="#ffffff" strokeWidth={2} maxBarSize={44}
                                                    radius={i === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
                                                    isAnimationActive={false}
                                                    onClick={onBarra ? (d) => onBarra(d?.payload || d) : undefined} style={onBarra ? { cursor: 'pointer' } : undefined} />
                                            ))}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {nota && <p className="text-[11px] text-slate-400 mt-1">{nota}</p>}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function CobranzasSection() {
    const [tab, setTab] = useState('vencimientos'); // 'vencimientos' | 'periodos' | 'clientes'
    const [deudas, setDeudas] = useState([]);
    const [credito, setCredito] = useState({ excedidos: 0, cerca: 0, conLimite: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // La lista de deudas alimenta el bloque ATENCIÓN y el panel de vencimientos
    const cargarDeudas = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const [rv, ra] = await Promise.all([
                api.get('/contabilidad/reportes/cobranzas-vencimientos'),
                api.get('/contabilidad/reportes/antiguedad-deuda', { params: { modo: 'TODO' } }),
            ]);
            setDeudas(rv.data.data || []);
            // Crédito por cliente: un límite en una moneda vs. la deuda de las dos monedas al TC
            const tc = Number(ra.data.cotizacion?.dolar) || 0, porCli = {};
            for (const d of (ra.data.data || [])) {
                const x = porCli[d.CliIdCliente] = porCli[d.CliIdCliente] || { limite: 0, moneda: 'UYU', uyu: 0, usd: 0 };
                if (Number(d.LimiteCredito) > 0 && !x.limite) { x.limite = Number(d.LimiteCredito); x.moneda = d.LimiteMoneda || 'UYU'; }
                if (String(d.Moneda || '').includes('USD')) x.usd += Number(d.TotalDeuda || 0); else x.uyu += Number(d.TotalDeuda || 0);
            }
            const res = { excedidos: 0, cerca: 0, conLimite: 0 };
            for (const x of Object.values(porCli)) {
                const ut = x.moneda === 'USD' ? x.usd + (tc > 0 ? x.uyu / tc : 0) : x.uyu + x.usd * tc;
                const n = nivelCredito(ut, x.limite);
                if (n >= 0) res.conLimite++;
                if (n === 4) res.excedidos++; else if (n >= 2) res.cerca++;
            }
            setCredito(res);
        } catch (e) { setError(e.response?.data?.error || e.message); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { cargarDeudas(); }, [cargarDeudas]);

    // ── Bloque ATENCIÓN ──────────────────────────────────────────────────────
    const atencion = useMemo(() => {
        const z = () => ({ UYU: 0, USD: 0, n: 0 });
        const a = { total: z(), vencido: z(), hoy: z(), d7: z(), d15: z(), d30: z(), d3: z() };
        for (const d of deudas) {
            const imp = Number(d.DDeImportePendiente || 0), m = d.Moneda === 'USD' ? 'USD' : 'UYU', dpv = Number(d.DiasParaVencer);
            const sumar = (k) => { a[k][m] += imp; a[k].n++; };
            sumar('total');
            if (dpv < 0) sumar('vencido');
            else {
                if (dpv === 0) sumar('hoy');
                if (dpv >= 0 && dpv <= 3) sumar('d3');
                if (dpv >= 0 && dpv <= 7) sumar('d7');
                if (dpv >= 0 && dpv <= 15) sumar('d15');
                if (dpv >= 0 && dpv <= 30) sumar('d30');
            }
        }
        return a;
    }, [deudas]);

    return (
        <div className="space-y-4">
            {/* ── ATENCIÓN — COBRANZAS ── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <AlertTriangle size={14} className="text-rose-500" /> Atención — Cobranzas
                    </p>
                    <button onClick={cargarDeudas} disabled={loading} title="Actualizar"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-all">
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
                {error && <p className="text-xs text-rose-600 mb-2">No se pudo cargar: {error}</p>}
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                    {[
                        { label: 'Total pendiente',  v: atencion.total,   cls: 'text-indigo-600' },
                        { label: 'Vencido',          v: atencion.vencido, cls: 'text-rose-600' },
                        { label: 'Vence hoy',        v: atencion.hoy,     cls: 'text-rose-500' },
                        { label: 'Próximos 7 días',  v: atencion.d7,      cls: 'text-orange-600' },
                        { label: 'Próximos 15 días', v: atencion.d15,     cls: 'text-amber-600' },
                        { label: 'Próximos 30 días', v: atencion.d30,     cls: 'text-emerald-600' },
                    ].map(k => (
                        <div key={k.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{k.label}</p>
                            <p className={`text-sm font-black tabular-nums ${k.cls}`}>$ {fmt(k.v.UYU)}</p>
                            <p className={`text-sm font-black tabular-nums ${k.cls}`}>US$ {fmt(k.v.USD)}</p>
                            <p className="text-[10px] text-slate-400">{k.v.n} deuda(s)</p>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs">
                    <span className="text-rose-700"><b>{atencion.vencido.n}</b> deudas vencidas</span>
                    <span className="text-orange-700"><b>{atencion.d3.n}</b> vencen en los próximos 3 días</span>
                    <span className="text-rose-700"><b>{credito.excedidos}</b> clientes excedieron su límite de crédito</span>
                    <span className="text-amber-700"><b>{credito.cerca}</b> clientes cerca del límite</span>
                    <span className="text-slate-400">{credito.conLimite} clientes con límite cargado (se cargan en el 360 → Límites)</span>
                </div>
            </div>

            {/* ── Sub-reportes ── */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5 w-fit">
                {[['vencimientos', 'Panel de vencimientos'], ['periodos', 'Informe semanal / mensual / trimestral'], ['clientes', 'Ficha por cliente']].map(([k, l]) => (
                    <button key={k} onClick={() => setTab(k)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${tab === k ? 'bg-brand-cyan text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}>
                        {l}
                    </button>
                ))}
            </div>

            {tab === 'vencimientos' && <PanelVencimientos deudas={deudas} loading={loading} />}
            {tab === 'periodos' && <InformePeriodos />}
            {tab === 'clientes' && <FichaClientes />}
        </div>
    );
}

// ─── Panel de vencimientos ───────────────────────────────────────────────────
function PanelVencimientos({ deudas, loading }) {
    const [tramo, setTramo] = useState('');
    const [vendedor, setVendedor] = useState('');
    const [moneda, setMoneda] = useState('');
    const [tipo, setTipo] = useState('');
    const [txt, setTxt] = useState('');
    const [pagina, setPagina] = useState(1);
    const POR_PAGINA = 100;

    const vendedores = useMemo(() => [...new Set(deudas.map(d => d.Vendedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [deudas]);
    const q = txt.trim().toLowerCase();
    // "base" aplica todos los filtros menos el tramo: alimenta el gráfico por tramo
    const base = useMemo(() => deudas
        .map(d => ({ ...d, _p: prioridadDe(Number(d.DiasParaVencer)) }))
        .filter(d => (!vendedor || d.Vendedor === vendedor) && (!moneda || d.Moneda === moneda) && (!tipo || d.Tipo === tipo)
            && (!q || [d.Cliente, d.Documento, d.Vendedor, d.Telefono].some(v => String(v || '').toLowerCase().includes(q)))),
    [deudas, vendedor, moneda, tipo, q]);
    const filtradas = useMemo(() => base.filter(d => !tramo || d._p.key === tramo), [base, tramo]);
    const graficoTramos = useMemo(() => {
        const out = {};
        for (const m of ['UYU', 'USD']) out[m] = TRAMOS.filter(t => t.key).map(t => ({ key: t.key, etiqueta: t.label, vencido: 0, porVencer: 0, n: 0 }));
        for (const d of base) {
            const f = out[d.Moneda === 'USD' ? 'USD' : 'UYU'].find(x => x.key === d._p.key);
            f[d._p.key === 'V30' || d._p.key === 'V' ? 'vencido' : 'porVencer'] += Number(d.DDeImportePendiente || 0); f.n++;
        }
        return out;
    }, [base]);
    useEffect(() => { setPagina(1); }, [tramo, vendedor, moneda, tipo, q]);

    const sub = filtradas.reduce((t, d) => { t[d.Moneda === 'USD' ? 'USD' : 'UYU'] += Number(d.DDeImportePendiente || 0); return t; }, { UYU: 0, USD: 0 });
    const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
    const visibles = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
    const hayFiltro = !!(tramo || vendedor || moneda || tipo || q);

    const exportar = () => bajarCSV('panel_vencimientos',
        ['Prioridad', 'Cliente', 'Teléfono', 'Documento', 'Tipo', 'Emisión', 'Vencimiento', 'Días para vencer', 'Moneda', 'Importe original', 'Pendiente', 'Vendedor', 'Condición', 'Acción sugerida'],
        filtradas.map(d => [d._p.txt, d.Cliente, d.Telefono, d.Documento, d.Tipo, fmtDia(d.DDeFechaEmision), fmtDia(d.DDeFechaVencimiento), Number(d.DiasParaVencer), d.Moneda,
            Number(d.DDeImporteOriginal || 0), Number(d.DDeImportePendiente || 0), d.Vendedor || '', d.CondicionPago || '', d._p.accion]));

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 tracking-wide">VENCE</span>
                    {TRAMOS.map(t => <Chip key={t.key || 'todos'} active={tramo === t.key} onClick={() => setTramo(t.key)}>{t.label}</Chip>)}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="Buscar cliente, documento, teléfono…"
                            className="text-xs border border-slate-300 rounded-lg pl-7 pr-2 py-1.5 w-64 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                    </div>
                    <select value={vendedor} onChange={e => setVendedor(e.target.value)} className={selCls}>
                        <option value="">Vendedor: todos</option>
                        {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <select value={moneda} onChange={e => setMoneda(e.target.value)} className={selCls}>
                        <option value="">$ y US$</option><option value="UYU">Solo $</option><option value="USD">Solo US$</option>
                    </select>
                    <select value={tipo} onChange={e => setTipo(e.target.value)} className={selCls} title="Factura = ya documentada · Orden = en cuenta corriente, todavía sin facturar">
                        <option value="">Facturas y órdenes</option><option value="FACTURA">Solo facturas</option><option value="ORDEN">Solo órdenes sin facturar</option><option value="OTRO">Saldo inicial / otros</option>
                    </select>
                    {hayFiltro && <button onClick={() => { setTramo(''); setVendedor(''); setMoneda(''); setTipo(''); setTxt(''); }} className="flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-800"><X size={12} /> Limpiar</button>}
                    <button onClick={exportar} disabled={!filtradas.length}
                        className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg">
                        <Download size={13} /> Exportar CSV
                    </button>
                </div>
                <p className="text-[11px] text-slate-500"><b>{filtradas.length.toLocaleString('es-UY')}</b> deuda(s) · pendiente <b>$ {fmt(sub.UYU)}</b> · <b>US$ {fmt(sub.USD)}</b></p>
            </div>
            {!loading && (
                <div className="border-b border-slate-100">
                    <GraficoMonedas titulo="Pendiente por tramo de vencimiento" series={['vencido', 'porVencer']} porMoneda={graficoTramos}
                        onBarra={(f) => f?.key && setTramo(t => (t === f.key ? '' : f.key))}
                        pieTooltip={(f) => `${f.n} deuda(s) · clic para ${tramo === f.key ? 'quitar el filtro' : 'filtrar la tabla por este tramo'}`}
                        nota={tramo ? 'La tabla está filtrada por un tramo; el gráfico sigue mostrando todos (respeta vendedor, moneda, tipo y búsqueda).' : 'Clic en una barra filtra la tabla por ese tramo.'} />
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                            {['Prioridad', 'Cliente', 'Documento', 'Vencimiento', 'Pendiente', 'Vendedor', 'Condición', 'Acción'].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? <tr><td colSpan={8} className="text-center py-10 text-slate-400">Cargando…</td></tr>
                            : visibles.length === 0 ? <tr><td colSpan={8} className="text-center py-10 text-slate-400">Sin deudas para los filtros elegidos</td></tr>
                            : visibles.map(d => (
                                <tr key={d.DDeIdDocumento} className="hover:bg-slate-50/70">
                                    <td className="px-3 py-2"><span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md border whitespace-nowrap ${d._p.cls}`}>{d._p.txt}</span></td>
                                    <td className="px-3 py-2"><span className="font-bold text-slate-700">{d.Cliente}</span>{d.Telefono && <span className="block text-[10px] text-slate-400">{d.Telefono}</span>}</td>
                                    <td className="px-3 py-2 whitespace-nowrap"><span className="font-mono font-bold text-indigo-700">{d.Documento}</span>
                                        <span className="block text-[10px] text-slate-400">{d.Tipo === 'FACTURA' ? 'facturado' : d.Tipo === 'ORDEN' ? 'orden sin facturar' : 'sin documento'} · emitido {fmtDia(d.DDeFechaEmision)}</span></td>
                                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDia(d.DDeFechaVencimiento)}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right font-black tabular-nums text-slate-800">{SIM[d.Moneda]} {fmt(d.DDeImportePendiente)}
                                        {Number(d.DDeImporteOriginal) > Number(d.DDeImportePendiente) + 0.009 && <span className="block text-[10px] font-normal text-slate-400">de {fmt(d.DDeImporteOriginal)}</span>}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{d.Vendedor || <span className="text-slate-300">sin vendedor</span>}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">{d.CondicionPago || '—'}</td>
                                    <td className="px-3 py-2 whitespace-nowrap font-bold text-slate-600">{d._p.accion}</td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
            {paginas > 1 && (
                <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Página {pagina} de {paginas} · {POR_PAGINA} por página (el CSV exporta todo lo filtrado)</span>
                    <span className="flex gap-2">
                        <button disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)} className="px-2 py-1 rounded bg-white border border-slate-200 font-bold disabled:opacity-40">‹ Anterior</button>
                        <button disabled={pagina >= paginas} onClick={() => setPagina(p => p + 1)} className="px-2 py-1 rounded bg-white border border-slate-200 font-bold disabled:opacity-40">Siguiente ›</button>
                    </span>
                </div>
            )}
        </div>
    );
}

// ─── Informe semanal / mensual / trimestral ──────────────────────────────────
function InformePeriodos() {
    const [agrupar, setAgrupar] = useState('mes');
    const [desde, setDesde] = useState('');
    const [hasta, setHasta] = useState('');
    const [vendedor, setVendedor] = useState('');
    const [moneda, setMoneda] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const cargar = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const params = { agrupar, ...(desde && { desde }), ...(hasta && { hasta }), ...(vendedor && { vendedor }) };
            const r = await api.get('/contabilidad/reportes/cobranzas-periodos', { params });
            setData(r.data);
        } catch (e) { setError(e.response?.data?.error || e.message); }
        finally { setLoading(false); }
    }, [agrupar, desde, hasta, vendedor]);
    useEffect(() => { cargar(); }, [cargar]);

    const periodos = (data?.periodos || []).filter(p => !moneda || p.Moneda === moneda);
    const condiciones = (data?.porCondicion || []).filter(p => !moneda || p.Moneda === moneda);
    const NOMBRE = { semana: 'semanal', mes: 'mensual', trimestre: 'trimestral' };

    // Gráficos: Cobrado + Por vencer + Vencido = Facturado (Por vencer = Pendiente − Vencido)
    const partes = (x) => ({ cobrado: Math.max(0, Number(x.Cobrado || 0)), porVencer: Math.max(0, Number(x.Pendiente || 0) - Number(x.Vencido || 0)), vencido: Math.max(0, Number(x.Vencido || 0)) });
    const etiquetaCorta = (ymd) => {
        const [y, m, d] = ymd.split('-').map(Number), p2 = (n) => String(n).padStart(2, '0');
        if (agrupar === 'mes') return `${MESES[m - 1].slice(0, 3)} ${String(y).slice(2)}`;
        if (agrupar === 'trimestre') return `T${Math.floor((m - 1) / 3) + 1} ${y}`;
        return `${p2(d)}/${p2(m)}`;
    };
    const graficoPeriodos = { UYU: [], USD: [] }, graficoCondiciones = { UYU: [], USD: [] };
    for (const p of [...periodos].sort((a, b) => String(a.Periodo).localeCompare(String(b.Periodo))))
        graficoPeriodos[p.Moneda === 'USD' ? 'USD' : 'UYU'].push({ etiqueta: etiquetaCorta(p.Periodo), titulo: etiquetaPeriodo(p.Periodo, agrupar), pct: p.PctCobranza, ...partes(p) });
    for (const c of condiciones)
        graficoCondiciones[c.Moneda === 'USD' ? 'USD' : 'UYU'].push({ etiqueta: c.Condicion, pct: c.PctCobranza, ...partes(c) });
    const piePct = (f) => (f.pct == null ? '' : `% de cobranza: ${f.pct.toLocaleString('es-UY')}%`);

    const exportar = () => bajarCSV(`cobranza_${NOMBRE[agrupar]}`,
        ['Período', 'Moneda', 'Documentos', 'Clientes', 'Facturado', 'Cobrado', 'Pendiente', 'Vencido', '% cobranza', 'Ingresos de caja en el período'],
        periodos.map(p => [etiquetaPeriodo(p.Periodo, agrupar), p.Moneda, p.Documentos, p.Clientes, p.Facturado, p.Cobrado, p.Pendiente, p.Vencido, p.PctCobranza ?? '', p.Ingresos]));

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 tracking-wide">INFORME</span>
                    {[['semana', 'Semanal'], ['mes', 'Mensual'], ['trimestre', 'Trimestral']].map(([k, l]) => <Chip key={k} active={agrupar === k} onClick={() => setAgrupar(k)}>{l}</Chip>)}
                    <div className="h-4 w-px bg-slate-200 mx-1" />
                    <span className="text-[11px] font-bold text-slate-500 tracking-wide">FACTURAS DEL</span>
                    <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1 outline-none" />
                    <span className="text-slate-400 text-xs">—</span>
                    <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1 outline-none" />
                    {(desde || hasta) && <button onClick={() => { setDesde(''); setHasta(''); }} className="text-xs font-bold text-rose-600">✕ rango por defecto</button>}
                    <select value={vendedor} onChange={e => setVendedor(e.target.value)} className={selCls}>
                        <option value="">Vendedor: todos</option>
                        {(data?.vendedores || []).map(v => <option key={v.Cedula} value={v.Cedula}>{v.Nombre}</option>)}
                    </select>
                    <select value={moneda} onChange={e => setMoneda(e.target.value)} className={selCls}>
                        <option value="">$ y US$</option><option value="UYU">Solo $</option><option value="USD">Solo US$</option>
                    </select>
                    <button onClick={exportar} disabled={!periodos.length}
                        className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg">
                        <Download size={13} /> Exportar CSV
                    </button>
                </div>
                <p className="text-[11px] text-slate-500">
                    Cada fila son las <b>facturas emitidas en ese período</b>: <b>Pendiente</b> = lo que de esas facturas todavía se debe · <b>Vencido</b> = la parte ya vencida · <b>Cobrado</b> = Facturado − Pendiente.
                    "Ingresos de caja" es aparte: la plata que <b>entró</b> en el período por fecha de pago (incluye cobros de facturas viejas, anticipos y ventas de saldo, por eso no coincide con Cobrado).
                    {!desde && !hasta && data && <> Sin fechas trae {agrupar === 'semana' ? 'las últimas 8 semanas' : agrupar === 'mes' ? 'los últimos 6 meses' : 'los últimos 4 trimestres'}.</>}
                </p>
            </div>

            {error && <p className="text-xs text-rose-600">No se pudo cargar: {error}</p>}

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {!loading && periodos.length > 0 && (
                    <div className="border-b border-slate-100">
                        <GraficoMonedas titulo={`Facturado por ${agrupar === 'semana' ? 'semana' : agrupar === 'mes' ? 'mes' : 'trimestre'}: cuánto se cobró, cuánto falta y cuánto está vencido`}
                            series={['cobrado', 'porVencer', 'vencido']} porMoneda={graficoPeriodos} pieTooltip={piePct}
                            nota={agrupar === 'semana' ? 'Cada barra es una semana (la fecha es el día en que empieza). El alto total es lo facturado.' : 'El alto total de cada barra es lo facturado en el período.'} />
                    </div>
                )}
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            <tr>
                                {[NOMBRE[agrupar] === 'semanal' ? 'Semana' : NOMBRE[agrupar] === 'mensual' ? 'Mes' : 'Trimestre', 'Moneda', 'Docs', 'Clientes', 'Facturado', 'Cobrado', 'Pendiente', 'Vencido', '% Cobranza', 'Ingresos de caja'].map((h, i) =>
                                    <th key={h} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {loading ? <tr><td colSpan={10} className="text-center py-10 text-slate-400">Cargando…</td></tr>
                                : periodos.length === 0 ? <tr><td colSpan={10} className="text-center py-10 text-slate-400">Sin facturas en el rango</td></tr>
                                : periodos.map(p => (
                                    <tr key={p.Periodo + p.Moneda} className="hover:bg-slate-50/70">
                                        <td className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap">{etiquetaPeriodo(p.Periodo, agrupar)}</td>
                                        <td className="px-3 py-2 text-slate-500">{p.Moneda}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{p.Documentos.toLocaleString('es-UY')}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{p.Clientes.toLocaleString('es-UY')}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-800">{SIM[p.Moneda]} {fmt(p.Facturado)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(p.Cobrado)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">{fmt(p.Pendiente)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-rose-700">{fmt(p.Vencido)}</td>
                                        <td className={`px-3 py-2 text-right tabular-nums font-black ${pctCls(p.PctCobranza)}`}>{p.PctCobranza == null ? '—' : p.PctCobranza.toLocaleString('es-UY') + '%'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmt(p.Ingresos)}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <p className="px-4 py-2.5 text-xs font-bold text-slate-600 border-b border-slate-100">Por condición de pago del cliente — mismo rango <span className="font-normal text-slate-400">(la condición se carga en el 360 → Límites)</span></p>
                {condiciones.length > 0 && (
                    <div className="border-b border-slate-100">
                        <GraficoMonedas titulo="De lo facturado a cada condición, qué parte se cobró" series={['cobrado', 'porVencer', 'vencido']} porMoneda={graficoCondiciones}
                            horizontal porcentaje pieTooltip={piePct}
                            nota="Cada barra es el 100% de lo facturado a esa condición, para poder comparar condiciones con montos muy distintos." />
                    </div>
                )}
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            <tr>{['Condición', 'Moneda', 'Clientes', 'Facturado', 'Cobrado', 'Pendiente', 'Vencido', '% Cobranza'].map((h, i) => <th key={h} className={`px-3 py-2.5 font-semibold ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {condiciones.length === 0 ? <tr><td colSpan={8} className="text-center py-6 text-slate-400">Sin datos</td></tr>
                                : condiciones.map(c => (
                                    <tr key={c.Condicion + c.Moneda} className="hover:bg-slate-50/70">
                                        <td className="px-3 py-2 font-bold text-slate-700">{c.Condicion}</td>
                                        <td className="px-3 py-2 text-slate-500">{c.Moneda}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{c.Clientes.toLocaleString('es-UY')}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-bold">{SIM[c.Moneda]} {fmt(c.Facturado)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(c.Cobrado)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">{fmt(c.Pendiente)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-rose-700">{fmt(c.Vencido)}</td>
                                        <td className={`px-3 py-2 text-right tabular-nums font-black ${pctCls(c.PctCobranza)}`}>{c.PctCobranza == null ? '—' : c.PctCobranza.toLocaleString('es-UY') + '%'}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// ─── Ficha financiera por cliente ────────────────────────────────────────────
function FichaClientes() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [txt, setTxt] = useState('');
    const [vendedor, setVendedor] = useState('');
    const [soloVencidos, setSoloVencidos] = useState(false);

    useEffect(() => {
        setLoading(true);
        api.get('/contabilidad/reportes/cobranzas-clientes')
            .then(r => setRows(r.data.data || []))
            .catch(e => setError(e.response?.data?.error || e.message))
            .finally(() => setLoading(false));
    }, []);

    const vendedores = useMemo(() => [...new Set(rows.map(r => r.Vendedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [rows]);
    const q = txt.trim().toLowerCase();
    const filtrados = useMemo(() => rows.filter(r => (!q || String(r.Cliente || '').toLowerCase().includes(q)) && (!vendedor || r.Vendedor === vendedor) && (!soloVencidos || Number(r.Vencido) > 0)),
        [rows, q, vendedor, soloVencidos]);
    const graficoTop = useMemo(() => {
        const out = { UYU: [], USD: [] };
        for (const r of [...filtrados].sort((a, b) => Number(b.Pendiente || 0) - Number(a.Pendiente || 0))) {
            const m = r.Moneda === 'USD' ? 'USD' : 'UYU';
            if (out[m].length >= 10) continue;
            const venc = Math.max(0, Number(r.Vencido || 0));
            out[m].push({ etiqueta: String(r.Cliente || '').trim(), vencido: venc, porVencer: Math.max(0, Number(r.Pendiente || 0) - venc), atraso: r.MaxDiasAtraso });
        }
        return out;
    }, [filtrados]);

    const exportar = () => bajarCSV('ficha_financiera_clientes',
        ['Cliente', 'Teléfono', 'Vendedor', 'Moneda', 'Pendiente', 'Vencido', 'Deudas vivas', 'Deudas vencidas', 'Máx. días de atraso', 'Último pago', 'Monto último pago', 'Moneda último pago', 'Días promedio en pagar', 'Deudas cobradas (base del promedio)'],
        filtrados.map(r => [r.Cliente, r.Telefono, r.Vendedor || '', r.Moneda, Number(r.Pendiente || 0), Number(r.Vencido || 0), r.DeudasVivas, r.DeudasVencidas, r.MaxDiasAtraso,
            r.UltimoPagoFecha ? fmtDia(r.UltimoPagoFecha) : '', r.UltimoPagoMonto ?? '', r.UltimoPagoMoneda || '', r.DiasPromedioPago != null ? Math.round(r.DiasPromedioPago * 10) / 10 : '', r.DeudasCobradas || 0]));

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                <div className="relative">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="Buscar cliente…"
                        className="text-xs border border-slate-300 rounded-lg pl-7 pr-2 py-1.5 w-56 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                </div>
                <select value={vendedor} onChange={e => setVendedor(e.target.value)} className={selCls}>
                    <option value="">Vendedor: todos</option>
                    {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={soloVencidos} onChange={e => setSoloVencidos(e.target.checked)} className="rounded" /> Solo con deuda vencida
                </label>
                <span className="text-[11px] text-slate-400">{filtrados.length} fila(s) · solo clientes que hoy deben algo · una fila por moneda</span>
                <button onClick={exportar} disabled={!filtrados.length}
                    className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg">
                    <Download size={13} /> Exportar CSV
                </button>
            </div>
            {error && <p className="px-4 py-2 text-xs text-rose-600">No se pudo cargar: {error}</p>}
            {!loading && filtrados.length > 0 && (
                <div className="border-b border-slate-100">
                    <GraficoMonedas titulo="Los 10 clientes que más deben (según los filtros de arriba)" series={['vencido', 'porVencer']} porMoneda={graficoTop} horizontal
                        pieTooltip={(f) => (f.atraso > 0 ? `Atraso máximo: ${f.atraso} días` : 'Sin atraso')} />
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>{['Cliente', 'Vendedor', 'Pendiente', 'Vencido', 'Facturas vencidas', 'Máx. atraso', 'Último pago', 'Demora en pagar'].map((h, i) =>
                            <th key={h} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i >= 2 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? <tr><td colSpan={8} className="text-center py-10 text-slate-400">Cargando…</td></tr>
                            : filtrados.length === 0 ? <tr><td colSpan={8} className="text-center py-10 text-slate-400">Sin clientes para los filtros elegidos</td></tr>
                            : filtrados.slice(0, 300).map(r => (
                                <tr key={r.CliIdCliente + r.Moneda} className="hover:bg-slate-50/70">
                                    <td className="px-3 py-2"><span className="font-bold text-slate-700">{r.Cliente}</span>{r.Telefono && <span className="block text-[10px] text-slate-400">{r.Telefono}</span>}</td>
                                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.Vendedor || <span className="text-slate-300">sin vendedor</span>}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-800 whitespace-nowrap">{SIM[r.Moneda]} {fmt(r.Pendiente)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-700 whitespace-nowrap">{Number(r.Vencido) > 0 ? `${SIM[r.Moneda]} ${fmt(r.Vencido)}` : <span className="text-slate-300 font-normal">—</span>}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{r.DeudasVencidas} <span className="text-slate-400">de {r.DeudasVivas}</span></td>
                                    <td className="px-3 py-2 text-right tabular-nums">{r.MaxDiasAtraso > 0 ? `${r.MaxDiasAtraso} d` : '—'}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.UltimoPagoFecha ? <>{fmtDia(r.UltimoPagoFecha)} <span className="text-slate-400">· {SIM[r.UltimoPagoMoneda] || ''} {fmt(r.UltimoPagoMonto)}</span></> : <span className="text-slate-300">sin pagos</span>}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.DiasPromedioPago != null ? <>{Math.round(r.DiasPromedioPago)} d <span className="text-slate-400">promedio · {r.DeudasCobradas} cobradas</span></> : <span className="text-slate-300">sin historial</span>}</td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
            {filtrados.length > 300 && <p className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500">Mostrando los primeros 300 (ordenados por vencido). El CSV exporta todos.</p>}
        </div>
    );
}
