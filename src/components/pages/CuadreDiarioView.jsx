// ─────────────────────────────────────────────────────────────────────────────
// Cuadre diario (/caja/cuadre): retiros entregados en un período y su situación de pago (pagado, autorizado con
// deuda o sin pago), con el detalle de órdenes de cada retiro y la exportación a PDF.
// Estética nueva (28/10/2026): encabezado, filtros con SelectorFecha / Selector (antes, los del navegador y con
// emojis en las opciones), resumen y tabla claros (en el celular, una tarjeta por retiro) y la lista de a 50. La
// búsqueda, el filtro en los resultados y el PDF impreso no se tocaron.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useMemo, useRef, useEffect } from 'react';
import api from '../../services/apiClient';
import {
    Search, RefreshCw, ChevronDown, ChevronRight, Package, CheckCircle, AlertTriangle, XCircle, Printer, FileText,
    X, CreditCard
} from 'lucide-react';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }) : '—';

// El PDF impreso usa solo el label
const SITUACION = {
    pagado:   { label: 'Pagado',       color: 'bg-emerald-50 text-emerald-700 border-emerald-200',                   icon: <CheckCircle size={11} /> },
    deuda:    { label: 'Autorizado',   color: 'bg-amber-50 text-amber-700 border-amber-200',                         icon: <AlertTriangle size={11} /> },
    sin_pago: { label: 'Sin pago',     color: 'bg-brand-magenta/5 text-brand-magenta border-brand-magenta/20',       icon: <XCircle size={11} /> },
};

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 whitespace-nowrap';

// En el celular y la tablet, tarjetas en vez de la tabla de 7 columnas (una vista sola: no se dibujan las dos)
const MQ_TABLA = '(min-width: 1024px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}

// Lista de a 50 (patrón useDeAPoco de Pagos con deuda): un período largo trae cientos de retiros. Al acercarse al
// final se agregan 50 más; vuelve a 50 cuando cambia la lista. El margen se mide contra el contenedor que scrollea.
const DE_A = 50;
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};
function useDeAPoco(lista) {
    const [cuantos, setCuantos] = useState(DE_A);
    useEffect(() => { setCuantos(DE_A); }, [lista]);
    const centinela = useRef(null);
    const total = lista.length;
    useEffect(() => {
        const el = centinela.current;
        if (!el || cuantos >= total) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setCuantos(c => c + DE_A);
        }, { root: contenedorConScroll(el), rootMargin: '0px 0px 600px 0px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, [cuantos, total]);
    return [Math.min(cuantos, total), centinela];
}

// ─── BADGE ────────────────────────────────────────────────────────────────────

const SituacionBadge = ({ s }) => {
    const cfg = SITUACION[s] || SITUACION.sin_pago;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${cfg.color}`}>
            {cfg.icon} {cfg.label}
        </span>
    );
};

// ─── RESUMEN STATS ────────────────────────────────────────────────────────────

const kpi = (titulo, valor, sub, colorNum) => (
    <div className={`${CARD} px-4 py-3.5 min-w-0`}>
        <div className={ETIQUETA}>{titulo}</div>
        <div className={`text-2xl font-black tabular-nums ${Number(valor) > 0 ? colorNum : 'text-zinc-300'}`}>{valor}</div>
        <div className="text-[11px] text-zinc-500 leading-snug">{sub}</div>
    </div>
);

const Stats = ({ data }) => {
    const totales = useMemo(() => {
        const r = { pagado: 0, deuda: 0, sin_pago: 0, total: data.length };
        data.forEach(d => { r[d.SituacionPago] = (r[d.SituacionPago] || 0) + 1; });
        return r;
    }, [data]);

    const monedas = useMemo(() => {
        const m = {};
        data.forEach(d => {
            if (d.SituacionPago === 'pagado' && d.MonedaPago) {
                m[d.MonedaPago] = (m[d.MonedaPago] || 0) + Number(d.MontoPago || 0);
            }
        });
        return m;
    }, [data]);

    const cobrado = Object.entries(monedas).map(([sym, tot]) => `${sym} ${fmt(tot)}`).join(' · ');
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpi('Total entregados', totales.total, 'Retiros en el período', 'text-zinc-900')}
            {kpi('Pagados', totales.pagado, cobrado || 'Sin cobros', 'text-emerald-700')}
            {kpi('Autorizados (deuda)', totales.deuda, 'Entregados con deuda autorizada', 'text-amber-700')}
            {kpi('Sin pago', totales.sin_pago, 'Sin pago ni deuda registrados', 'text-brand-magenta')}
        </div>
    );
};

// ─── VISTA PRINCIPAL ──────────────────────────────────────────────────────────

const CuadreDiarioView = () => {
    const hoy = new Date().toISOString().split('T')[0];
    const [datos, setDatos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [filters, setFilters] = useState({ startDate: hoy, endDate: hoy, clientFilter: '', estado: '' });
    const printRef = useRef(null);

    const fetchDatos = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            Object.entries(filters).forEach(([k, v]) => { if (v) params.append(k, v); });
            const res = await api.get(`/web-retiros/cuadre-diario?${params}`);
            setDatos(res.data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const filtered = useMemo(() => {
        if (!busqueda.trim()) return datos;
        const t = busqueda.toLowerCase();
        return datos.filter(r => [
            r.OrdenRetiro, r.NombreCliente, String(r.CodigoCliente || ''),
            r.TipoCliente, r.MetodoPago, r.DeudaEstado,
            ...(r.Ordenes || []).map(o => o.codigo),
            ...(r.Ordenes || []).map(o => o.producto),
        ].some(v => String(v || '').toLowerCase().includes(t)));
    }, [datos, busqueda]);

    const handlePrint = () => {
        const win = window.open('', '_blank');
        const desde = filters.startDate || hoy;
        const hasta = filters.endDate || hoy;
        const rows = filtered.map(r => {
            const ordenes = (r.Ordenes || []).map(o =>
                `<tr style="font-size:10px;color:#555">
                    <td style="padding:3px 8px">${o.codigo || ''}</td>
                    <td style="padding:3px 8px">${o.producto || ''}</td>
                    <td style="padding:3px 8px;text-align:center">${o.cantidad != null ? Number(o.cantidad).toFixed(2) : ''}</td>
                    <td style="padding:3px 8px;text-align:right">${o.moneda || ''} ${fmt(o.monto)}</td>
                </tr>`
            ).join('');
            const situacion = SITUACION[r.SituacionPago] || SITUACION.sin_pago;
            const badgeColor = r.SituacionPago === 'pagado' ? '#065f46' : r.SituacionPago === 'deuda' ? '#92400e' : '#991b1b';
            const badgeBg = r.SituacionPago === 'pagado' ? '#d1fae5' : r.SituacionPago === 'deuda' ? '#fef3c7' : '#fee2e2';
            return `
                <tr style="border-top:1px solid #e2e8f0">
                    <td style="padding:6px 8px;font-weight:bold;color:#1e40af">${r.OrdenRetiro}</td>
                    <td style="padding:6px 8px">
                        <div style="font-weight:bold">${r.NombreCliente || '—'}</div>
                        <div style="font-size:11px;color:#64748b">${r.TipoCliente || ''} · Cód: ${r.CodigoCliente || ''}</div>
                    </td>
                    <td style="padding:6px 8px;font-size:11px;color:#475569">${fmtDate(r.FechaEntrega)}</td>
                    <td style="padding:6px 8px;text-align:center">
                        <span style="background:${badgeBg};color:${badgeColor};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:bold">${situacion.label}</span>
                    </td>
                    <td style="padding:6px 8px;font-size:11px">
                        ${r.MetodoPago ? `<div>${r.MetodoPago}</div>` : ''}
                        ${r.MontoPago ? `<div style="font-weight:bold">${r.MonedaPago} ${fmt(r.MontoPago)}</div>` : ''}
                        ${r.DeudaId ? `<div style="color:#92400e;font-size:10px">${r.DeudaExplicacion || 'Deuda autorizada'}</div>` : ''}
                    </td>
                    <td style="padding:6px 8px;text-align:center">${r.CantOrdenes}</td>
                </tr>
                ${ordenes ? `<tr><td colspan="6" style="padding:0 8px 8px 32px;background:#f8fafc">
                    <table style="width:100%;border-collapse:collapse;font-size:10px">
                        <thead><tr style="background:#e2e8f0;color:#475569">
                            <th style="padding:3px 8px;text-align:left">Código</th>
                            <th style="padding:3px 8px;text-align:left">Producto</th>
                            <th style="padding:3px 8px;text-align:center">Cantidad</th>
                            <th style="padding:3px 8px;text-align:right">Monto</th>
                        </tr></thead>
                        <tbody>${ordenes}</tbody>
                    </table>
                </td></tr>` : ''}
            `;
        }).join('');

        const totPagados = filtered.filter(r => r.SituacionPago === 'pagado').length;
        const totDeuda   = filtered.filter(r => r.SituacionPago === 'deuda').length;
        const totSinPago = filtered.filter(r => r.SituacionPago === 'sin_pago').length;
        const monedas = {};
        filtered.forEach(d => { if (d.SituacionPago === 'pagado' && d.MonedaPago) monedas[d.MonedaPago] = (monedas[d.MonedaPago] || 0) + Number(d.MontoPago || 0); });

        win.document.write(`<!DOCTYPE html><html lang="es"><head>
            <meta charset="UTF-8" />
            <title>Cuadre Diario ${desde} al ${hasta}</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; margin: 0; padding: 20px; }
                h1 { font-size: 20px; font-weight: 900; margin: 0; color: #1e293b; }
                .subtitle { color: #64748b; font-size: 12px; margin-bottom: 16px; }
                .stats { display: flex; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }
                .stat { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 18px; }
                .stat-n { font-size: 22px; font-weight: 900; }
                .stat-l { font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; }
                thead tr { background: #f1f5f9; }
                th { padding: 8px; text-align: left; font-size: 11px; color: #475569; text-transform: uppercase; }
                @media print { body { padding: 0; } .no-print { display: none; } }
            </style>
        </head><body>
            <h1>🧾 Cuadre Diario — USER</h1>
            <p class="subtitle">Período: ${desde === hasta ? desde : `${desde} al ${hasta}`} · Generado: ${new Date().toLocaleString('es-UY')}</p>
            <div class="stats">
                <div class="stat"><div class="stat-l">Total entregados</div><div class="stat-n">${filtered.length}</div></div>
                <div class="stat" style="border-color:#a7f3d0"><div class="stat-l">Pagados</div><div class="stat-n" style="color:#065f46">${totPagados}</div>${Object.entries(monedas).map(([s, t]) => `<div style="font-size:11px;color:#065f46;font-weight:bold">${s} ${fmt(t)}</div>`).join('')}</div>
                <div class="stat" style="border-color:#fde68a"><div class="stat-l">Autorizados</div><div class="stat-n" style="color:#92400e">${totDeuda}</div></div>
                <div class="stat" style="border-color:#fecaca"><div class="stat-l">Sin pago</div><div class="stat-n" style="color:#991b1b">${totSinPago}</div></div>
            </div>
            <table>
                <thead><tr>
                    <th>Retiro</th><th>Cliente</th><th>Entrega</th>
                    <th style="text-align:center">Situación</th><th>Pago / Detalle</th>
                    <th style="text-align:center">Órdenes</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <p style="margin-top:24px;font-size:10px;color:#94a3b8;text-align:center">
                Reporte generado por USER — Sistema de Gestión
            </p>
        </body></html>`);
        win.document.close();
        win.focus();
        setTimeout(() => { win.print(); }, 400);
    };

    // ── Piezas del render ───────────────────────────────────────────────────────
    const conTabla = useConTabla();
    const [cuantos, centinela] = useDeAPoco(filtered);
    const visibles = filtered.slice(0, cuantos);
    const faltan = filtered.length - cuantos;

    // En pantalla, la hora de 24 h (fmtDate, con a. m. / p. m., queda para el PDF impreso)
    const fmtFecha = (d) => (d ? new Date(d).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—');
    const cantidad = (o) => (o.cantidad != null ? fmt(o.cantidad) : '—');

    const tipo = (r) => (r.TipoCliente
        ? <span className={CHIP}>{r.TipoCliente}</span>
        : <span className="text-zinc-300">—</span>);

    const pago = (r) => (r.SituacionPago === 'pagado' ? (
        <div className="flex flex-col gap-0.5 items-start">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-600">
                <CreditCard size={12} className="text-brand-cyan shrink-0" /> {r.MetodoPago}
            </span>
            <span className="text-emerald-700 font-black text-sm tabular-nums whitespace-nowrap">{r.MonedaPago} {fmt(r.MontoPago)}</span>
            <span className="text-[11px] text-zinc-400">{fmtFecha(r.FechaPago)}</span>
        </div>
    ) : r.SituacionPago === 'deuda' ? (
        <div className="flex flex-col gap-0.5 items-start">
            <span className="text-amber-700 font-bold text-xs">{r.DeudaEstado || 'Pendiente'}</span>
            {r.MontoDeuda > 0 && <span className="text-amber-800 font-black text-sm tabular-nums whitespace-nowrap">$ {fmt(r.MontoDeuda)}</span>}
            {r.DeudaExplicacion && <span className="text-xs text-zinc-500 italic max-w-[220px] truncate" title={r.DeudaExplicacion}>{r.DeudaExplicacion}</span>}
        </div>
    ) : (
        <span className="text-xs text-zinc-400 italic">Sin registro</span>
    ));

    const botonOrdenes = (r, isExp, hasOrd, conTexto = false) => (hasOrd ? (
        <button type="button" onClick={() => setExpandedId(isExp ? null : r.OReIdOrdenRetiro)} aria-expanded={isExp}
            title={isExp ? 'Ocultar las órdenes' : 'Ver las órdenes del retiro'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${isExp ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'}`}>
            {isExp ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {r.Ordenes.length}{conTexto ? (r.Ordenes.length !== 1 ? ' órdenes' : ' orden') : ''}
        </button>
    ) : (
        <span className="text-zinc-300 text-xs">{conTexto ? 'Sin órdenes' : '0'}</span>
    ));

    const detalleOrdenes = (r) => (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
            <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50 text-xs font-black text-zinc-700 flex items-center gap-2">
                <Package size={13} className="text-brand-cyan shrink-0" /> Detalle de órdenes · {r.OrdenRetiro}
            </div>
            {conTabla ? (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-zinc-100">
                            <th className={TH}>Código</th>
                            <th className={TH}>Material / producto</th>
                            <th className={TH}>Modo</th>
                            <th className={`${TH} text-center`}>Cantidad</th>
                            <th className={`${TH} text-right`}>Monto</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                        {r.Ordenes.map((o, i) => (
                            <tr key={i}>
                                <td className="px-4 py-2 font-mono font-bold text-zinc-900 whitespace-nowrap">{o.codigo}</td>
                                <td className="px-4 py-2 text-zinc-700">{o.producto || '—'}</td>
                                <td className="px-4 py-2">{o.modo ? <span className={CHIP}>{o.modo}</span> : <span className="text-zinc-300">—</span>}</td>
                                <td className="px-4 py-2 text-center font-bold text-zinc-600 tabular-nums">{cantidad(o)}</td>
                                <td className="px-4 py-2 text-right font-bold text-zinc-800 tabular-nums whitespace-nowrap">{o.moneda || '$'} {fmt(o.monto)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <div className="divide-y divide-zinc-100">
                    {r.Ordenes.map((o, i) => (
                        <div key={i} className="px-3 py-2.5 flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="font-mono text-[13px] font-bold text-zinc-900">{o.codigo}</div>
                                <div className="text-sm text-zinc-600 break-words">{o.producto || '—'}</div>
                                {o.modo && <span className={`${CHIP} inline-block mt-1`}>{o.modo}</span>}
                            </div>
                            <div className="text-right shrink-0">
                                <div className="font-bold text-zinc-800 tabular-nums whitespace-nowrap">{o.moneda || '$'} {fmt(o.monto)}</div>
                                <div className="text-[11px] text-zinc-400 tabular-nums">Cant. {cantidad(o)}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const masAbajo = faltan > 0 && (
        <div ref={centinela} className="py-3 text-center text-xs text-zinc-400">Cargando {Math.min(faltan, DE_A)} más…</div>
    );

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3">
                <FileText size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-[220px] flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Cuadre diario</h1>
                    <p className="text-sm text-zinc-500 mt-1">Retiros entregados y su situación de pago.</p>
                </div>
                <button type="button" onClick={handlePrint} disabled={filtered.length === 0} className={`${BTN_SECUNDARIO} w-full sm:w-auto sm:ml-auto`}>
                    <Printer size={15} className="text-brand-cyan" /> Exportar PDF
                </button>
            </div>

            {/* Filtros */}
            <div className={`${CARD} p-4 grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-end`}>
                <div className="min-w-0 lg:w-40">
                    <span className={ETIQUETA}>Desde</span>
                    <SelectorFecha filtro resaltar={false} className="w-full" value={filters.startDate} onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))} aria-label="Desde" />
                </div>
                <div className="min-w-0 lg:w-40">
                    <span className={ETIQUETA}>Hasta</span>
                    <SelectorFecha filtro resaltar={false} className="w-full" value={filters.endDate} onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))} aria-label="Hasta" />
                </div>
                <div className="col-span-2 lg:flex-1 min-w-0 lg:min-w-[220px]">
                    <span className={ETIQUETA}>Cliente</span>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input type="text" placeholder="Nombre o código" aria-label="Cliente" value={filters.clientFilter}
                            onChange={e => setFilters(f => ({ ...f, clientFilter: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && fetchDatos()}
                            className={CAMPO} />
                    </div>
                </div>
                <div className="col-span-2 sm:col-span-1 min-w-0 lg:w-56">
                    <span className={ETIQUETA}>Situación</span>
                    <Selector filtro className="w-full" value={filters.estado} onChange={e => setFilters(f => ({ ...f, estado: e.target.value }))} aria-label="Situación">
                        <option value="">Todas</option>
                        <option value="pagado">Pagados</option>
                        <option value="deuda">Autorizados (deuda)</option>
                        <option value="sin_pago">Sin pago</option>
                    </Selector>
                </div>
                <button type="button" onClick={fetchDatos} disabled={loading} className={`${BTN_PRINCIPAL} col-span-2 sm:col-span-1 self-end`}>
                    {loading ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />} Buscar
                </button>
            </div>

            {/* Buscador en los resultados */}
            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                <input type="text" placeholder="Buscar en los resultados: retiro, cliente, orden, producto" aria-label="Buscar en los resultados"
                    value={busqueda} onChange={e => setBusqueda(e.target.value)}
                    className={CAMPO.replace('pr-4', 'pr-9')} />
                {busqueda && (
                    <button type="button" onClick={() => setBusqueda('')} aria-label="Borrar la búsqueda" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700">
                        <X size={15} />
                    </button>
                )}
            </div>

            {/* Resumen */}
            {filtered.length > 0 && <Stats data={filtered} />}

            {/* Retiros */}
            {loading ? (
                <div className={`${CARD} py-12 text-center text-sm text-zinc-400`}>
                    <RefreshCw className="inline animate-spin mr-2 text-brand-cyan" size={16} />Cargando cuadre…
                </div>
            ) : filtered.length === 0 ? (
                <div className={`${CARD} px-6 py-12 flex flex-col items-center text-center`}>
                    {datos.length === 0 ? (
                        <>
                            <FileText size={40} className="text-zinc-300 mb-3" />
                            <h3 className="text-base font-black text-zinc-800">Elegí un período y tocá Buscar</h3>
                            <p className="text-sm text-zinc-500 mt-1">Se listan los retiros entregados en esas fechas, con su pago o su deuda.</p>
                        </>
                    ) : (
                        <p className="text-sm text-zinc-500">No hay resultados con esa búsqueda.</p>
                    )}
                </div>
            ) : conTabla ? (
                <div className={`${CARD} overflow-hidden`}>
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                            <tr>
                                <th className={TH}>Retiro</th>
                                <th className={TH}>Cliente</th>
                                <th className={TH}>Tipo</th>
                                <th className={TH}>Entrega</th>
                                <th className={`${TH} text-center`}>Situación</th>
                                <th className={TH}>Pago / deuda</th>
                                <th className={`${TH} text-center`}>Órdenes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {visibles.map(r => {
                                const isExp = expandedId === r.OReIdOrdenRetiro;
                                const hasOrd = r.Ordenes?.length > 0;
                                const rowBg = r.SituacionPago === 'pagado' ? '' : r.SituacionPago === 'deuda' ? 'bg-amber-50/40' : 'bg-brand-magenta/[0.03]';
                                return (
                                    <React.Fragment key={r.OReIdOrdenRetiro}>
                                        <tr className={`hover:bg-zinc-50 transition-colors align-top ${isExp ? 'bg-brand-cyan/5' : rowBg}`}>
                                            <td className="px-4 py-3 font-mono font-black text-zinc-900 whitespace-nowrap">{r.OrdenRetiro}</td>
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-zinc-800">{r.NombreCliente || '—'}</div>
                                                <div className="text-xs text-zinc-400">Cód. {r.CodigoCliente || '—'}</div>
                                            </td>
                                            <td className="px-4 py-3">{tipo(r)}</td>
                                            <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">{fmtFecha(r.FechaEntrega)}</td>
                                            <td className="px-4 py-3 text-center"><SituacionBadge s={r.SituacionPago} /></td>
                                            <td className="px-4 py-3">{pago(r)}</td>
                                            <td className="px-4 py-3 text-center">{botonOrdenes(r, isExp, hasOrd)}</td>
                                        </tr>
                                        {isExp && hasOrd && (
                                            <tr className="bg-brand-cyan/5">
                                                <td colSpan={7} className="px-6 pb-4 pt-1">{detalleOrdenes(r)}</td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                    {masAbajo}
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {visibles.map(r => {
                        const isExp = expandedId === r.OReIdOrdenRetiro;
                        const hasOrd = r.Ordenes?.length > 0;
                        const borde = r.SituacionPago === 'pagado' ? '' : r.SituacionPago === 'deuda' ? 'border-amber-200' : 'border-brand-magenta/20';
                        return (
                            <div key={r.OReIdOrdenRetiro} className={`${CARD} ${borde} p-3.5 flex flex-col gap-2.5`}>
                                <div className="flex items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-mono font-black text-zinc-900">{r.OrdenRetiro}</div>
                                        <div className="font-bold text-zinc-800 break-words">{r.NombreCliente || '—'}</div>
                                        <div className="text-xs text-zinc-400">Cód. {r.CodigoCliente || '—'} · {fmtFecha(r.FechaEntrega)}</div>
                                    </div>
                                    <SituacionBadge s={r.SituacionPago} />
                                </div>
                                <div className="flex items-end justify-between gap-3">
                                    <div className="min-w-0">{pago(r)}</div>
                                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                                        {r.TipoCliente && tipo(r)}
                                        {botonOrdenes(r, isExp, hasOrd, true)}
                                    </div>
                                </div>
                                {isExp && hasOrd && detalleOrdenes(r)}
                            </div>
                        );
                    })}
                    {masAbajo}
                </div>
            )}
            <div className="text-xs text-zinc-400 text-right">{filtered.length} retiro{filtered.length !== 1 ? 's' : ''} en el período</div>
        </div>
    );
};

export default CuadreDiarioView;
