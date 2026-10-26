import { useState, useEffect, useCallback, useRef, memo } from 'react';
import api from '../../services/apiClient';
import {
    Printer, FileSpreadsheet, Search,
    BarChart2, Package, ClipboardList, RefreshCw,
    AlertTriangle, XCircle, LayoutDashboard, Loader2, X,
} from 'lucide-react';
import ProduccionPanelSection from './ProduccionPanelSection';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

// Estética nueva (22/10/2026, como Panel de Control y Servicio Técnico): fondo claro, tarjetas blancas con
// borde, íconos de Lucide en brand-cyan (sin un color por reporte), pestañas con la elegida en negro. En el
// celular la lista de reportes y los filtros son selectores.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const ROTULO = 'text-[11px] font-black text-zinc-400 uppercase tracking-wide shrink-0';
const FILA_CHIPS = 'flex items-center gap-2 flex-wrap';
const chip = (activo) => `shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${
    activo ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`;
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

// ─── Reportes disponibles ────────────────────────────────────────────────────
const REPORTS = [
    {
        // Panel completo con sus propios filtros (no usa el encabezado ni la tabla de esta página)
        id: 'dashboard',
        label: 'Dashboard de Producción',
        icon: LayoutDashboard,
        desc: 'Panel de producción: cumplimiento, órdenes en proceso y en cola, capacidad consumida, fallas, máquinas y producción por sector',
        color: 'text-indigo-500',
    },
    {
        id: 'fallas-reposiciones',
        label: 'Fallas y Reposiciones',
        icon: AlertTriangle,
        desc: 'Órdenes con falla (causa, máquina, metros) y órdenes de reposición',
        color: 'text-orange-500',
    },
    {
        id: 'cancelaciones',
        label: 'Cancelaciones',
        icon: XCircle,
        desc: 'Órdenes canceladas / anuladas con motivo y detalles',
        color: 'text-red-500',
    },
    {
        id: 'ordenes',
        label: 'Órdenes',
        icon: ClipboardList,
        desc: 'Listado completo de órdenes con filtros',
        color: 'text-sky-500',
    },
    {
        id: 'metros-material',
        label: 'Metros por Material',
        icon: Package,
        desc: 'Agrupado por tipo de material',
        color: 'text-violet-500',
    },
    {
        id: 'clientes',
        label: 'Volumen por Cliente',
        icon: BarChart2,
        desc: 'Ranking de clientes por volumen',
        color: 'text-brand-cyan',
    },
];

// ─── Columnas por reporte ─────────────────────────────────────────────────────
const COLUMNS = {
    'fallas-reposiciones': [
        { key: 'Fecha',        label: 'Fecha' },
        { key: 'CodigoOrden',  label: 'Código Orden' },
        { key: 'Cliente',      label: 'Cliente' },
        { key: 'Metros',       label: 'Metros' },
        { key: 'Material',     label: 'Material' },
        { key: 'TipoFalla',    label: 'Tipo de Falla' },
        { key: 'Causa',        label: 'Causa / Observación' },
        { key: 'Estado',       label: 'Estado' },
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
        { key: 'DetallesCancelacion', label: 'Detalles' },
        { key: 'CanceladoPor',        label: 'Cancelado Por' },
    ],
    ordenes: [
        { key: 'CodigoOrden',   label: 'Código' },
        { key: 'FechaIngreso',  label: 'Fecha Ingreso' },
        { key: 'Estado',        label: 'Estado' },
        { key: 'Area',          label: 'Área' },
        { key: 'Material',      label: 'Material' },
        { key: 'Prioridad',     label: 'Prioridad' },
        { key: 'Metros',        label: 'Metros' },
        { key: 'Cliente',       label: 'Cliente' },
        { key: 'Observaciones', label: 'Observaciones' },
    ],
    'metros-material': [
        { key: 'Material',       label: 'Material' },
        { key: 'Ordenes',        label: 'Órdenes' },
        { key: 'TotalMetros',    label: 'Total m lin.' },
        { key: 'Activas',        label: 'Activas' },
        { key: 'Completadas',    label: 'Completadas' },
        { key: 'PromedioMetros', label: 'Prom. m lin.' },
    ],
    clientes: [
        { key: 'Cliente',     label: 'Cliente' },
        { key: 'Ordenes',     label: 'Órdenes' },
        { key: 'TotalMetros', label: 'Total m lin.' },
        { key: 'Activas',     label: 'Activas' },
        { key: 'Completadas', label: 'Completadas' },
        { key: 'UltimaOrden', label: 'Última Orden' },
    ],
};

// ─── Utilidades ───────────────────────────────────────────────────────────────
const FECHA_PRESETS = [
    { label: 'Hoy',           value: 'hoy' },
    { label: 'Ayer',          value: 'ayer' },
    { label: '7 días',        value: '7d' },
    { label: '30 días',       value: '30d' },
    { label: '90 días',       value: '90d' },
    { label: 'Personalizado', value: 'custom' },
];

// value = lo que se guarda en el filtro (y define el turno que se manda); corto en la pestaña, largo en el selector
const TURNOS = [
    { value: 'Ambos',        corto: 'Ambos',          largo: 'Ambos turnos' },
    { value: 'T1 · 00-14 h', corto: 'T1 · 00 a 14 h', largo: 'T1 · 00 a 14 h' },
    { value: 'T2 · 14-24 h', corto: 'T2 · 14 a 24 h', largo: 'T2 · 14 a 24 h' },
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

function buildTableHTML(title, rows, columns, accentColor = '#0891b2') {
    const thead = columns.map(c => `<th>${c.label}</th>`).join('');
    const tbody = rows.map((row, i) =>
        `<tr class="${i % 2 === 0 ? 'even' : ''}">
            <td class="num">${i + 1}</td>
            ${columns.map(c => `<td>${row[c.key] ?? ''}</td>`).join('')}
        </tr>`
    ).join('');
    return `
        <div class="section">
            <div class="section-title" style="border-left:4px solid ${accentColor}; padding-left:8px; margin:18px 0 6px; font-size:13px; font-weight:700; color:${accentColor};">
                ${title} <span style="font-weight:400; color:#888; font-size:11px;">— ${rows.length.toLocaleString()} registros</span>
            </div>
            <table>
                <thead><tr><th>#</th>${thead}</tr></thead>
                <tbody>${tbody}</tbody>
            </table>
        </div>`;
}

function printReport({ reportLabel, cols, data, groupedData }) {
    const fecha = new Date().toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });
    let body = '';
    if (groupedData) {
        body = buildTableHTML('Fallas', groupedData.fallas, cols, '#ea580c')
             + buildTableHTML('Reposiciones', groupedData.reposiciones, cols, '#7c3aed');
    } else {
        body = buildTableHTML(reportLabel, data, cols, '#0891b2');
    }

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>${reportLabel}</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; font-size: 10px; color: #222; padding: 20px; }
            h1  { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
            .meta { color: #888; font-size: 10px; margin-bottom: 14px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
            th { background: #f1f5f9; padding: 5px 7px; text-align: left; border: 1px solid #cbd5e1; font-size: 9px; font-weight: 700; color: #475569; white-space: nowrap; }
            td { padding: 4px 7px; border: 1px solid #e2e8f0; font-size: 9px; vertical-align: top; }
            tr.even td { background: #f8fafc; }
            td.num { color: #94a3b8; width: 28px; text-align: right; }
            @media print { body { padding: 10px; } }
        </style>
    </head><body>
        <h1>${reportLabel}</h1>
        <div class="meta">Generado el ${fecha}</div>
        ${body}
        <script>window.onload = function(){ window.print(); }<\/script>
    </body></html>`);
    win.document.close();
}

// ─── Badges ───────────────────────────────────────────────────────────────────
const ESTADO_CLS = {
    'Entregado': 'bg-emerald-100 text-emerald-700',
    'Finalizado': 'bg-emerald-100 text-emerald-700',
    'Pronto': 'bg-emerald-100 text-emerald-700',
    'Listo para retiro': 'bg-cyan-100 text-cyan-700',
    'Cancelado': 'bg-red-100 text-red-600',
    'Anulado': 'bg-red-100 text-red-600',
    'Rechazado': 'bg-red-100 text-red-600',
    'Con Falla': 'bg-orange-100 text-orange-700',
    'CON FALLA': 'bg-orange-100 text-orange-700',
    'En Proceso': 'bg-blue-100 text-blue-700',
    'En Máquina': 'bg-blue-100 text-blue-700',
    'Pendiente': 'bg-zinc-100 text-zinc-500',
};

function EstadoBadge({ estado }) {
    if (!estado) return <span className="text-zinc-400">—</span>;
    const matchKey = Object.keys(ESTADO_CLS).find(k => k.toLowerCase() === estado.toLowerCase());
    const cls = ESTADO_CLS[matchKey] || 'bg-zinc-100 text-zinc-600';
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>{estado}</span>;
}

function TipoBadge({ tipo }) {
    if (!tipo) return null;
    if (tipo === 'Falla')
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700 flex items-center gap-1 w-fit">
            <AlertTriangle size={9} /> Falla
        </span>;
    if (tipo === 'Reposición')
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700 w-fit block">
            Reposición
        </span>;
    return <span className="text-zinc-600">{tipo}</span>;
}

function PrioridadBadge({ prioridad }) {
    if (!prioridad) return <span className="text-zinc-400">—</span>;
    const p = prioridad.toUpperCase();
    if (p === 'U' || p === 'URGENTE')
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">URGENTE</span>;
    if (p === 'F' || p === 'FALLA')
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">FALLA</span>;
    if (p === 'R' || p === 'REPOSICION' || p === 'REPOSICIÓN')
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">REPOS.</span>;
    return <span className="text-zinc-500">{prioridad}</span>;
}

// ─── Componente KPI strip dinámico ────────────────────────────────────────────
const mm = v => `${Number(v || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })} m`;
function KpisStrip({ activeReport, totales }) {
    if (!totales || !Object.keys(totales).length) return null;
    let kpis = null;
    if (activeReport === 'fallas-reposiciones') kpis = [
        { label: 'Fallas', value: Number(totales.totalFallas || 0).toLocaleString('es-UY'), cls: 'text-orange-600' },
        { label: 'Reposiciones', value: Number(totales.totalReposiciones || 0).toLocaleString('es-UY'), cls: 'text-violet-600' },
        { label: 'Metros en falla', value: mm(totales.metrosFalla), cls: 'text-orange-600' },
        { label: 'Metros de reposición', value: mm(totales.metrosReposicion), cls: 'text-violet-600' },
    ];
    if (activeReport === 'cancelaciones') kpis = [
        { label: 'Canceladas', value: Number(totales.total || 0).toLocaleString('es-UY'), cls: 'text-rose-600' },
        { label: 'Metros', value: mm(totales.totalMetros), cls: 'text-zinc-800' },
        { label: 'Con motivo', value: Number(totales.conMotivo || 0).toLocaleString('es-UY'), cls: 'text-emerald-600' },
        { label: 'Sin motivo', value: Number(totales.sinMotivo || 0).toLocaleString('es-UY'), cls: 'text-amber-600' },
    ];
    if (activeReport === 'ordenes') kpis = [
        { label: 'Órdenes', value: Number(totales.total || 0).toLocaleString('es-UY'), cls: 'text-zinc-800' },
        { label: 'Metros', value: mm(totales.totalMetros), cls: 'text-brand-cyan' },
        { label: 'Activas', value: Number(totales.activas || 0).toLocaleString('es-UY'), cls: 'text-amber-600' },
        { label: 'Completadas', value: Number(totales.completadas || 0).toLocaleString('es-UY'), cls: 'text-emerald-600' },
    ];
    if (!kpis) return null;
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.map(k => (
                <div key={k.label} className={`${CARD} px-4 py-3 min-w-0`}>
                    <div className="text-[11px] font-black text-zinc-400 uppercase tracking-wide truncate">{k.label}</div>
                    <div className={`mt-1 text-xl md:text-2xl font-black tabular-nums leading-tight ${k.cls}`}>{k.value}</div>
                </div>
            ))}
        </div>
    );
}

// ─── Celda de tabla ───────────────────────────────────────────────────────────
const METRO_KEYS = new Set(['Metros', 'MetrosAfectados', 'TotalMetros', 'PromedioMetros']);

const TEXT_WRAP_KEYS = new Set(['Causa', 'Observaciones', 'DetallesCancelacion', 'MotivoCancelacion']);
// En la tabla también bajan de renglón (si no, la tabla no entraba y el estado quedaba cortado a la derecha)
const DOBLAN_KEYS = new Set(['Fecha', 'FechaIngreso', 'FechaCancelacion', 'UltimaOrden', 'Cliente', 'Material', 'TipoFalla', 'Area', 'CanceladoPor']);
// El estado, si es la última columna, queda pegado a la derecha: si la tabla igual no entra (pantallas angostas),
// el resto se scrollea por debajo
const PEGADA = 'sticky right-0 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)]';
const pegada = (c, cols) => c.key === 'Estado' && cols[cols.length - 1] === c;
const claseCelda = (c, cols) => TEXT_WRAP_KEYS.has(c.key) ? 'max-w-[360px]'
    : DOBLAN_KEYS.has(c.key) ? 'min-w-[90px]'
    : pegada(c, cols) ? `whitespace-nowrap ${PEGADA} bg-white group-hover:bg-zinc-50` : 'whitespace-nowrap';

function MotivoCancelBadge({ value, detalles }) {
    const combined = `${value || ''} ${detalles || ''}`.toLowerCase();
    const esPorCliente = combined.includes('client');
    if (!value && !esPorCliente) return <span className="text-zinc-400">—</span>;
    return (
        <span className="flex flex-col gap-0.5">
            {esPorCliente && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 w-fit whitespace-nowrap">
                    Por cliente
                </span>
            )}
            {value && <span className={esPorCliente ? 'text-blue-700 font-medium text-[11px]' : 'text-zinc-600 text-[11px]'}>{value}</span>}
        </span>
    );
}

function Cell({ col, value, row }) {
    if (col.key === 'Estado')    return <EstadoBadge estado={value} />;
    if (col.key === 'Tipo')      return <TipoBadge tipo={value} />;
    if (col.key === 'Prioridad') return <PrioridadBadge prioridad={value} />;
    if (col.key === 'MotivoCancelacion') return <MotivoCancelBadge value={value} detalles={row?.DetallesCancelacion} />;
    if (METRO_KEYS.has(col.key)) return (
        <span className="font-mono tabular-nums">
            {Number(value || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })}
        </span>
    );
    if (TEXT_WRAP_KEYS.has(col.key)) return (
        <span className="block text-zinc-500 whitespace-normal leading-snug min-w-[200px]">
            {value || '—'}
        </span>
    );
    return <span className="text-zinc-700">{value ?? '—'}</span>;
}

// ─── Tabla pivot Órdenes por Día ─────────────────────────────────────────────
const pct  = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) + '%' : '—';
const mlin = v => Number(v || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function OrdenesPorDiaTable({ rows }) {
    if (!rows.length) return (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
            <FileSpreadsheet size={36} className="text-zinc-200" />
            <p className="text-zinc-400 text-sm">Sin resultados</p>
        </div>
    );

    const tot = rows.reduce((acc, r) => ({
        T1_Ordenes:    acc.T1_Ordenes    + Number(r.T1_Ordenes    || 0),
        T1_Metros:     acc.T1_Metros     + Number(r.T1_Metros     || 0),
        T2_Ordenes:    acc.T2_Ordenes    + Number(r.T2_Ordenes    || 0),
        T2_Metros:     acc.T2_Metros     + Number(r.T2_Metros     || 0),
        Total_Ordenes: acc.Total_Ordenes + Number(r.Total_Ordenes || 0),
        Total_Metros:  acc.Total_Metros  + Number(r.Total_Metros  || 0),
    }), { T1_Ordenes:0, T1_Metros:0, T2_Ordenes:0, T2_Metros:0, Total_Ordenes:0, Total_Metros:0 });

    const TH = ({ children, cls='' }) =>
        <th className={`px-3 py-2 text-center text-[10px] font-bold whitespace-nowrap border-b border-zinc-200 ${cls}`}>{children}</th>;
    const TD = ({ children, cls='' }) =>
        <td className={`px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums ${cls}`}>{children}</td>;

    return (
        <div className={`${CARD} overflow-hidden`}>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr>
                            <th rowSpan={2} className="px-3 py-2 text-left text-zinc-500 font-bold text-[10px] border-b border-r border-zinc-200 bg-zinc-50 whitespace-nowrap">Día</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-brand-cyan bg-cyan-50/60 border-b border-r border-zinc-200">T 1</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-cyan-700 bg-cyan-50 border-b border-r border-zinc-200">T 2</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-zinc-700 bg-zinc-100 border-b border-r border-zinc-200">TOTALES</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-zinc-600 bg-zinc-50 border-b border-r border-zinc-200">% Órdenes</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-zinc-600 bg-zinc-50 border-b border-zinc-200">% Metros</th>
                        </tr>
                        <tr className="bg-zinc-50">
                            <TH cls="text-brand-cyan bg-cyan-50/60">Órdenes</TH>
                            <TH cls="text-brand-cyan bg-cyan-50/60 border-r border-zinc-200">m lin.</TH>
                            <TH cls="text-cyan-700 bg-cyan-50">Órdenes</TH>
                            <TH cls="text-cyan-700 bg-cyan-50 border-r border-zinc-200">m lin.</TH>
                            <TH cls="text-zinc-700">Órdenes</TH>
                            <TH cls="text-zinc-700 border-r border-zinc-200">Metros</TH>
                            <TH cls="text-brand-cyan">T1</TH>
                            <TH cls="text-cyan-700 border-r border-zinc-200">T2</TH>
                            <TH cls="text-brand-cyan">T1</TH>
                            <TH cls="text-cyan-700">T2</TH>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                        {rows.map((r, i) => (
                            <tr key={i} className={`hover:bg-zinc-50/70 ${i % 2 !== 0 ? 'bg-zinc-50/40' : ''}`}>
                                <td className="px-3 py-2 text-zinc-700 font-medium border-r border-zinc-100 whitespace-nowrap">{r.Dia}</td>
                                <TD cls="text-brand-cyan">{r.T1_Ordenes}</TD>
                                <TD cls="text-brand-cyan border-r border-zinc-100">{mlin(r.T1_Metros)}</TD>
                                <TD cls="text-cyan-700">{r.T2_Ordenes}</TD>
                                <TD cls="text-cyan-700 border-r border-zinc-100">{mlin(r.T2_Metros)}</TD>
                                <TD cls="text-zinc-800 font-semibold">{r.Total_Ordenes}</TD>
                                <TD cls="text-zinc-800 font-semibold border-r border-zinc-100">{mlin(r.Total_Metros)}</TD>
                                <TD cls="text-brand-cyan">{pct(r.T1_Ordenes, r.Total_Ordenes)}</TD>
                                <TD cls="text-cyan-700 border-r border-zinc-100">{pct(r.T2_Ordenes, r.Total_Ordenes)}</TD>
                                <TD cls="text-brand-cyan">{pct(r.T1_Metros, r.Total_Metros)}</TD>
                                <TD cls="text-cyan-700">{pct(r.T2_Metros, r.Total_Metros)}</TD>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-zinc-100 border-t-2 border-zinc-300 font-bold">
                            <td className="px-3 py-2.5 text-zinc-800 text-xs font-bold border-r border-zinc-200">TOTALES</td>
                            <TD cls="text-brand-cyan">{tot.T1_Ordenes}</TD>
                            <TD cls="text-brand-cyan border-r border-zinc-200">{mlin(tot.T1_Metros)}</TD>
                            <TD cls="text-cyan-700">{tot.T2_Ordenes}</TD>
                            <TD cls="text-cyan-700 border-r border-zinc-200">{mlin(tot.T2_Metros)}</TD>
                            <TD cls="text-zinc-900">{tot.Total_Ordenes}</TD>
                            <TD cls="text-zinc-900 border-r border-zinc-200">{mlin(tot.Total_Metros)}</TD>
                            <TD cls="text-brand-cyan">{pct(tot.T1_Ordenes, tot.Total_Ordenes)}</TD>
                            <TD cls="text-cyan-700 border-r border-zinc-200">{pct(tot.T2_Ordenes, tot.Total_Ordenes)}</TD>
                            <TD cls="text-brand-cyan">{pct(tot.T1_Metros, tot.Total_Metros)}</TD>
                            <TD cls="text-cyan-700">{pct(tot.T2_Metros, tot.Total_Metros)}</TD>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div className="px-4 py-2 bg-zinc-50 border-t border-zinc-100 text-[11px] text-zinc-400">
                {rows.length} días · órdenes que pasaron por Control de Calidad
            </div>
        </div>
    );
}

// ─── Registros: tarjetas en el celular, tabla en escritorio, de a 50 ──────────
// Se dibuja una sola de las dos vistas (antes iban las dos y una quedaba oculta) y solo los primeros 50
// registros; cuando el final de la lista se acerca a la pantalla se agregan 50 más. Con 90 días eran
// más de 60.000 elementos en la página.
const MQ_TABLA = '(min-width: 768px)';
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

const DE_A = 50;
// El contenedor que scrollea de verdad (el del layout): el margen de 600 px se mide contra él. El envoltorio
// de la tabla tiene overflow-x:auto (y por eso overflow-y:auto) pero no scrollea en vertical: no sirve.
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};
function useDeAPoco(total) {
    const [cuantos, setCuantos] = useState(DE_A);
    const centinela = useRef(null);
    useEffect(() => {
        const el = centinela.current;
        if (!el || cuantos >= total) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setCuantos(c => c + DE_A);
        },
            { root: contenedorConScroll(el), rootMargin: '0px 0px 600px 0px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, [cuantos, total]);
    return [Math.min(cuantos, total), centinela];
}

// Celular: un registro por tarjeta. Arriba el código (o la primera columna) y el estado; abajo el resto en
// dos columnas, y los textos largos (causa, observaciones, detalles) a lo ancho.
const CLAVE_TITULO = ['CodigoOrden', 'Material', 'Cliente'];
function Tarjeta({ row, titulo, estado, resto }) {
    return (
        <li className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-black text-zinc-800 break-all">{row[titulo?.key] ?? '—'}</span>
                {estado && <span className="shrink-0"><Cell col={estado} value={row.Estado} row={row} /></span>}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {resto.map(c => (
                    <div key={c.key} className={`min-w-0 ${TEXT_WRAP_KEYS.has(c.key) ? 'col-span-2' : ''}`}>
                        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">{c.label}</dt>
                        <dd className={`text-zinc-700 ${TEXT_WRAP_KEYS.has(c.key) ? 'line-clamp-4' : 'truncate'}`}>
                            <Cell col={c} value={row[c.key]} row={row} />
                        </dd>
                    </div>
                ))}
            </dl>
        </li>
    );
}

const Registros = memo(function Registros({ rows, cols }) {
    const conTabla = useConTabla();
    const [cuantos, centinela] = useDeAPoco(rows.length);
    const visibles = rows.slice(0, cuantos);
    const faltan = rows.length - cuantos;
    const aviso = `Mostrando ${cuantos.toLocaleString('es-UY')} de ${rows.length.toLocaleString('es-UY')}…`;

    if (!conTabla) {
        const titulo = cols.find(c => CLAVE_TITULO.includes(c.key)) || cols[0];
        const estado = cols.find(c => c.key === 'Estado');
        const resto = cols.filter(c => c !== titulo && c !== estado);
        return (
            <ul className="divide-y divide-zinc-100">
                {visibles.map((row, i) => <Tarjeta key={i} row={row} titulo={titulo} estado={estado} resto={resto} />)}
                {faltan > 0 && <li ref={centinela} className="px-4 py-3 text-center text-xs text-zinc-400">{aviso}</li>}
            </ul>
        );
    }
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                    <tr>
                        <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 w-8">#</th>
                        {cols.map(c => (
                            <th key={c.key} className={`px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap ${pegada(c, cols) ? `${PEGADA} bg-zinc-50` : ''}`}>{c.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                    {visibles.map((row, i) => (
                        <tr key={i} className="group hover:bg-zinc-50 transition-colors">
                            <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{i + 1}</td>
                            {cols.map(c => (
                                <td key={c.key} className={`px-3 py-2 ${claseCelda(c, cols)}`}>
                                    <Cell col={c} value={row[c.key]} row={row} />
                                </td>
                            ))}
                        </tr>
                    ))}
                    {faltan > 0 && (
                        <tr ref={centinela}><td colSpan={cols.length + 1} className="px-3 py-3 text-center text-zinc-400">{aviso}</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
});

// ─── Tabla simple (otros reportes) ───────────────────────────────────────────
const SimpleTable = memo(function SimpleTable({ rows, cols }) {
    return (
        <div className={`${CARD} overflow-hidden`}>
            <Registros rows={rows} cols={cols} />
            <div className="px-4 py-2 bg-zinc-50 border-t border-zinc-100 text-[11px] text-zinc-400">
                {rows.length.toLocaleString()} registros
            </div>
        </div>
    );
});

// ─── Tabla agrupada con header de sección ────────────────────────────────────
const GroupedTable = memo(function GroupedTable({ title, rows, cols, titleCls, dotCls }) {
    return (
        <div className={`${CARD} overflow-hidden`}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200">
                <span className={`w-2.5 h-2.5 rounded-full ${dotCls} shrink-0`} />
                <span className={`font-black text-sm ${titleCls}`}>{title}</span>
                <span className="text-xs text-zinc-400">{rows.length.toLocaleString('es-UY')} {rows.length === 1 ? 'registro' : 'registros'}</span>
            </div>
            {rows.length === 0
                ? <div className="px-4 py-5 text-center text-xs text-zinc-400">Sin resultados</div>
                : <Registros rows={rows} cols={cols} />}
        </div>
    );
});

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ReportesPage() {
    const [activeReport, setActiveReport] = useState('fallas-reposiciones');
    const [opciones, setOpciones]         = useState({ areas: [], materiales: [], clientes: [] });
    const [filters, setFilters]           = useState({
        area: 'Todas', fechaPreset: '30d', fechaDesde: '', fechaHasta: '',
        turno: 'Ambos', material: '', clienteSearch: '',
    });
    const [data, setData]               = useState([]);
    const [groupedData, setGroupedData] = useState(null);
    const [totales, setTotales]         = useState({});
    const [loading, setLoading]         = useState(false);
    const [error, setError]             = useState(null);
    const [suggs, setSuggs]     = useState([]);
    const clienteBoxRef         = useRef(null);
    // El reporte se pide cuando se deja de tipear el cliente (antes, una consulta por letra)
    const [clienteBuscado, setClienteBuscado] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setClienteBuscado(filters.clienteSearch), 400);
        return () => clearTimeout(t);
    }, [filters.clienteSearch]);

    useEffect(() => {
        api.get('/reportes/filtros').then(r => setOpciones(r.data)).catch(() => {});
    }, []);

    useEffect(() => {
        const q = filters.clienteSearch.toLowerCase().trim();
        if (!q) { setSuggs([]); return; }
        setSuggs(opciones.clientes.filter(c => c.nombre?.toLowerCase().includes(q)).slice(0, 8));
    }, [filters.clienteSearch, opciones.clientes]);

    useEffect(() => {
        const handler = e => {
            // Solo si hay sugerencias: un [] nuevo redibujaba toda la página (cientos de filas) en cada clic.
            if (clienteBoxRef.current && !clienteBoxRef.current.contains(e.target)) setSuggs(s => (s.length ? [] : s));
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const fetchReport = useCallback(async () => {
        if (activeReport === 'dashboard') return; // el panel carga solo, con sus propios filtros
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

            const params = {
                ...(filters.area !== 'Todas' && { area: filters.area }),
                ...(dateRange.desde && { fechaDesde: toISO(dateRange.desde) }),
                ...(dateRange.hasta && { fechaHasta: toISO(dateRange.hasta) }),
                ...(filters.turno !== 'Ambos' && { turno: filters.turno === 'T1 · 00-14 h' ? '1' : '2' }),
                ...(filters.material && { material: filters.material }),
                ...(clienteBuscado && { clienteSearch: clienteBuscado }),
                pageSize: 500,
            };

            const endpoint = activeReport === 'ordenes'
                ? '/reportes/ordenes-por-dia'
                : `/reportes/${activeReport}`;
            const r = await api.get(endpoint, { params });
            if (activeReport === 'fallas-reposiciones') {
                const fallas      = r.data.fallas      || [];
                const reposiciones = r.data.reposiciones || [];
                setGroupedData({ fallas, reposiciones });
                setData([...fallas, ...reposiciones]);
            } else {
                setGroupedData(null);
                setData(r.data.data || []);
            }
            setTotales(r.data.totales || {});
        } catch (e) {
            setError(e.response?.data?.error || e.message || 'Error al cargar reporte');
            setData([]);
        } finally {
            setLoading(false);
        }
    }, [activeReport, filters.area, filters.fechaPreset, filters.fechaDesde, filters.fechaHasta, filters.turno, filters.material, clienteBuscado]);

    useEffect(() => { fetchReport(); }, [fetchReport]);

    const handleReportChange = id => {
        if (id === activeReport) return; // volver a tocar el elegido lo vaciaba (no se vuelve a pedir)
        setActiveReport(id);
        setData([]);
        setGroupedData(null);
        setTotales({});
    };

    const handlePrint = () => {
        const rep = REPORTS.find(r => r.id === activeReport);
        printReport({ reportLabel: rep?.label || activeReport, cols, data, groupedData });
    };

    const setF = patch => setFilters(f => ({ ...f, ...patch }));
    // El selector devuelve texto: se vuelve al id de número que usan las pestañas
    const elegirArea = v => setF({ area: opciones.areas.find(a => String(a.id) === v)?.id ?? 'Todas' });
    const selectorMaterial = (
        <Selector filtro className="w-full" aria-label="Material" value={filters.material} onChange={e => setF({ material: e.target.value })}>
            <option value="">Todos los materiales</option>
            {opciones.materiales.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </Selector>
    );
    const fechasPersonalizadas = (<>
        <SelectorFecha filtro value={filters.fechaDesde} onChange={e => setF({ fechaDesde: e.target.value })} placeholder="Desde" max={filters.fechaHasta || undefined} />
        <SelectorFecha filtro value={filters.fechaHasta} onChange={e => setF({ fechaHasta: e.target.value })} placeholder="Hasta" min={filters.fechaDesde || undefined} />
    </>);
    const cols = COLUMNS[activeReport] || [];
    const activeRep = REPORTS.find(r => r.id === activeReport);

    const areaSel = opciones.areas.find(a => a.id === filters.area);
    const listaReportes = (claseItem) => REPORTS.map(r => {
        const Icon = r.icon;
        const active = activeReport === r.id;
        return (
            <button
                key={r.id}
                type="button"
                onClick={() => handleReportChange(r.id)}
                title={r.desc}
                className={claseItem(active)}
            >
                <Icon size={15} className={`shrink-0 ${active ? '' : 'text-brand-cyan'}`} />
                <span className="truncate">{r.label}</span>
            </button>
        );
    });

    return (
        <div className="p-3 md:p-6 font-sans text-zinc-800 space-y-4">

            {/* ── Encabezado ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <FileSpreadsheet size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Reportes</h1>
                        <p className="text-sm text-zinc-400 truncate">{activeRep?.desc}</p>
                    </div>
                </div>
                {activeReport !== 'dashboard' && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400 hidden sm:inline">
                            {loading ? 'Cargando…' : data.length > 0 ? `${data.length.toLocaleString('es-UY')} registros` : ''}
                        </span>
                        <button type="button" onClick={fetchReport} disabled={loading} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar">
                            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button type="button" onClick={handlePrint} disabled={!data.length || loading} className={BTN_PRINCIPAL}>
                            <Printer size={15} /> Imprimir PDF
                        </button>
                    </div>
                )}
            </div>

            {/* ── Reportes: selector en el celular ───────────────────────── */}
            <div className="lg:hidden">
                <Selector value={activeReport} onChange={e => handleReportChange(e.target.value)} aria-label="Reporte" className="font-semibold" altoMax={640}>
                    {REPORTS.map(r => (
                        <option key={r.id} value={r.id} descripcion={r.desc}>
                            <span className="inline-flex items-center gap-2"><r.icon size={15} className="shrink-0 text-brand-cyan" />{r.label}</span>
                        </option>
                    ))}
                </Selector>
            </div>

            <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-4 lg:items-start">

                {/* ── Lista de reportes (escritorio) ─────────────────────── */}
                <nav className={`${CARD} hidden lg:flex flex-col gap-0.5 p-2 sticky top-0`}>
                    {listaReportes(active => `w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm transition-colors ${
                        active ? 'bg-zinc-900 text-white font-bold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800'}`)}
                </nav>

                <div className="space-y-4 min-w-0">

                    {/* ── Filtros (el dashboard trae los suyos) ──────────── */}
                    {activeReport !== 'dashboard' && (
                    <div className={`${CARD} p-3 md:p-4 space-y-3`}>
                        {/* Celular: selectores */}
                        <div className="grid grid-cols-2 gap-2 sm:hidden">
                            <Selector filtro className="w-full" aria-label="Área" value={filters.area} onChange={e => elegirArea(e.target.value)}
                                renderValor={o => (o?.value === 'Todas' ? o.contenido : `Área ${o?.texto ?? ''}`)}>
                                <option value="Todas">Todas las áreas</option>
                                {opciones.areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                            </Selector>
                            <Selector filtro resaltar={false} className="w-full" aria-label="Fecha" value={filters.fechaPreset} onChange={e => setF({ fechaPreset: e.target.value })}>
                                {FECHA_PRESETS.map(p => <option key={p.value} value={p.value}>{p.value.endsWith('d') ? `Últimos ${p.label}` : p.label}</option>)}
                            </Selector>
                            <Selector filtro className="w-full" aria-label="Turno" value={filters.turno} onChange={e => setF({ turno: e.target.value })}>
                                {TURNOS.map(t => <option key={t.value} value={t.value}>{t.largo}</option>)}
                            </Selector>
                            {selectorMaterial}
                            {filters.fechaPreset === 'custom' && <div className="col-span-2 grid grid-cols-2 gap-2">{fechasPersonalizadas}</div>}
                        </div>

                        {/* Escritorio: pestañas */}
                        <div className="hidden sm:block space-y-3">
                            <div className={FILA_CHIPS}>
                                <span className={`${ROTULO} w-16`}>Área</span>
                                {[{ id: 'Todas', nombre: 'Todas' }, ...opciones.areas].map(a => (
                                    <button key={a.id} type="button" onClick={() => setF({ area: a.id })} className={chip(filters.area === a.id)}>
                                        {a.nombre}
                                    </button>
                                ))}
                            </div>

                            <div className={FILA_CHIPS}>
                                <span className={`${ROTULO} w-16`}>Fecha</span>
                                {FECHA_PRESETS.map(p => (
                                    <button key={p.value} type="button" onClick={() => setF({ fechaPreset: p.value })} className={chip(filters.fechaPreset === p.value)}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            {filters.fechaPreset === 'custom' && (
                                <div className="flex gap-2 items-center pl-[4.5rem]">{fechasPersonalizadas}</div>
                            )}

                            <div className={FILA_CHIPS}>
                                <span className={`${ROTULO} w-16`}>Turno</span>
                                {TURNOS.map(t => (
                                    <button key={t.value} type="button" onClick={() => setF({ turno: t.value })} className={chip(filters.turno === t.value)}>
                                        {t.corto}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-2">
                            <span className={`${ROTULO} w-16 hidden sm:block`}>Material</span>
                            <div className="hidden sm:block sm:w-64">{selectorMaterial}</div>
                            <div className="relative sm:w-64" ref={clienteBoxRef}>
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                                <input type="text" placeholder="Buscar cliente…" aria-label="Cliente" value={filters.clienteSearch}
                                    onChange={e => setF({ clienteSearch: e.target.value, idCliente: null })}
                                    className="w-full border border-zinc-200 rounded-xl pl-9 pr-9 py-2 text-sm bg-white focus:outline-none focus:border-brand-cyan" />
                                {filters.clienteSearch && (
                                    <button type="button" onClick={() => setF({ clienteSearch: '' })}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-700" title="Limpiar" aria-label="Limpiar cliente">
                                        <X size={14} />
                                    </button>
                                )}
                                {suggs.length > 0 && (
                                    <div className="absolute top-full left-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 w-full max-h-52 overflow-y-auto py-1">
                                        {suggs.map(c => (
                                            <button key={c.id} type="button"
                                                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 transition-colors"
                                                onClick={() => { setF({ clienteSearch: c.nombre }); setSuggs([]); }}>
                                                {c.nombre}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    )}

                    {/* ── KPIs ───────────────────────────────────────────── */}
                    {activeReport !== 'dashboard' && !loading && <KpisStrip activeReport={activeReport} totales={totales} />}

                    {/* ── Tabla / panel ──────────────────────────────────── */}
                    {activeReport === 'dashboard' ? (
                        <ProduccionPanelSection />
                    ) : loading ? (
                        <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-3`}>
                            <Loader2 size={30} className="animate-spin text-brand-cyan" />
                            <p className="text-sm text-zinc-400">Cargando reporte…</p>
                        </div>
                    ) : error ? (
                        <div className={`${CARD} flex flex-col items-center justify-center py-12 gap-2 px-4`}>
                            <p className="text-rose-600 font-bold text-sm">No se pudo cargar el reporte</p>
                            <p className="text-zinc-400 text-xs max-w-sm text-center">{error}</p>
                            <button type="button" onClick={fetchReport} className={`${BTN_PRINCIPAL} mt-2`}>Reintentar</button>
                        </div>
                    ) : data.length === 0 ? (
                        <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-2 px-4`}>
                            <FileSpreadsheet size={40} className="text-zinc-200" />
                            <p className="text-zinc-400 text-sm text-center">
                                Sin resultados{areaSel ? ` en ${areaSel.nombre}` : ''} para los filtros elegidos
                            </p>
                        </div>
                    ) : activeReport === 'ordenes' ? (
                        <OrdenesPorDiaTable rows={data} />
                    ) : groupedData ? (
                        /* ── Vista agrupada: Fallas / Reposiciones ── */
                        <div className="space-y-4">
                            <GroupedTable title="Fallas" rows={groupedData.fallas} cols={cols} titleCls="text-orange-700" dotCls="bg-orange-500" />
                            <GroupedTable title="Reposiciones" rows={groupedData.reposiciones} cols={cols} titleCls="text-violet-700" dotCls="bg-violet-500" />
                        </div>
                    ) : (
                        <SimpleTable rows={data} cols={cols} />
                    )}
                </div>
            </div>
        </div>
    );
}
