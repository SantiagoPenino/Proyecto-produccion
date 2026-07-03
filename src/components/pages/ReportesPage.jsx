import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/apiClient';
import {
    Printer, FileSpreadsheet, ChevronRight, Search,
    BarChart2, Package, ClipboardList, RefreshCw,
    AlertTriangle, XCircle,
} from 'lucide-react';

// ─── Reportes disponibles ────────────────────────────────────────────────────
const REPORTS = [
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
    'Pendiente': 'bg-slate-100 text-slate-500',
};

function EstadoBadge({ estado }) {
    if (!estado) return <span className="text-slate-400">—</span>;
    const matchKey = Object.keys(ESTADO_CLS).find(k => k.toLowerCase() === estado.toLowerCase());
    const cls = ESTADO_CLS[matchKey] || 'bg-slate-100 text-slate-600';
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
    return <span className="text-slate-600">{tipo}</span>;
}

function PrioridadBadge({ prioridad }) {
    if (!prioridad) return <span className="text-slate-400">—</span>;
    const p = prioridad.toUpperCase();
    if (p === 'U' || p === 'URGENTE')
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">URGENTE</span>;
    if (p === 'F' || p === 'FALLA')
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">FALLA</span>;
    if (p === 'R' || p === 'REPOSICION' || p === 'REPOSICIÓN')
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">REPOS.</span>;
    return <span className="text-slate-500">{prioridad}</span>;
}

// ─── Componente KPI strip dinámico ────────────────────────────────────────────
function KpisStrip({ activeReport, totales }) {
    if (!totales || !Object.keys(totales).length) return null;

    if (activeReport === 'fallas-reposiciones') return (
        <div className="bg-white border-b border-slate-100 px-5 py-2 flex items-center gap-6 text-xs shrink-0 flex-wrap">
            <KpiChip label="Fallas"          value={Number(totales.totalFallas || 0).toLocaleString()} cls="text-orange-600" />
            <KpiChip label="Reposiciones"    value={Number(totales.totalReposiciones || 0).toLocaleString()} cls="text-violet-600" />
            <KpiChip label="Metros en falla" value={`${Number(totales.metrosFalla || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })} m lin.`} cls="text-orange-600" />
            <KpiChip label="Metros repos."   value={`${Number(totales.metrosReposicion || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })} m lin.`} cls="text-violet-600" />
        </div>
    );

    if (activeReport === 'cancelaciones') return (
        <div className="bg-white border-b border-slate-100 px-5 py-2 flex items-center gap-6 text-xs shrink-0 flex-wrap">
            <KpiChip label="Total canceladas" value={Number(totales.total || 0).toLocaleString()} cls="text-red-600" />
            <KpiChip label="Metros totales"   value={`${Number(totales.totalMetros || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })} m lin.`} cls="text-slate-700" />
            <KpiChip label="Con motivo"       value={Number(totales.conMotivo || 0).toLocaleString()} cls="text-emerald-600" />
            <KpiChip label="Sin motivo"       value={Number(totales.sinMotivo || 0).toLocaleString()} cls="text-amber-600" />
        </div>
    );

    if (activeReport === 'ordenes') return (
        <div className="bg-white border-b border-slate-100 px-5 py-2 flex items-center gap-6 text-xs shrink-0 flex-wrap">
            <KpiChip label="Total"       value={Number(totales.total || 0).toLocaleString()} cls="text-slate-700" />
            <KpiChip label="Metros"      value={`${Number(totales.totalMetros || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })} m lin.`} cls="text-brand-cyan" />
            <KpiChip label="Activas"     value={Number(totales.activas || 0).toLocaleString()} cls="text-amber-600" />
            <KpiChip label="Completadas" value={Number(totales.completadas || 0).toLocaleString()} cls="text-emerald-600" />
        </div>
    );

    return null;
}

function KpiChip({ label, value, cls }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-slate-400">{label}:</span>
            <span className={`font-bold ${cls}`}>{value}</span>
        </div>
    );
}

// ─── Celda de tabla ───────────────────────────────────────────────────────────
const METRO_KEYS = new Set(['Metros', 'MetrosAfectados', 'TotalMetros', 'PromedioMetros']);

const TEXT_WRAP_KEYS = new Set(['Causa', 'Observaciones', 'DetallesCancelacion', 'MotivoCancelacion']);

function MotivoCancelBadge({ value, detalles }) {
    const combined = `${value || ''} ${detalles || ''}`.toLowerCase();
    const esPorCliente = combined.includes('client');
    if (!value && !esPorCliente) return <span className="text-slate-400">—</span>;
    return (
        <span className="flex flex-col gap-0.5">
            {esPorCliente && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 w-fit whitespace-nowrap">
                    Por cliente
                </span>
            )}
            {value && <span className={esPorCliente ? 'text-blue-700 font-medium text-[11px]' : 'text-slate-600 text-[11px]'}>{value}</span>}
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
        <span className="block text-slate-500 italic whitespace-normal leading-snug min-w-[160px]">
            {value || '—'}
        </span>
    );
    return <span className="text-slate-700">{value ?? '—'}</span>;
}

// ─── Tabla pivot Órdenes por Día ─────────────────────────────────────────────
const pct  = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) + '%' : '—';
const mlin = v => Number(v || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function OrdenesPorDiaTable({ rows }) {
    if (!rows.length) return (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
            <FileSpreadsheet size={36} className="text-slate-200" />
            <p className="text-slate-400 text-sm">Sin resultados</p>
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
        <th className={`px-3 py-2 text-center text-[10px] font-bold whitespace-nowrap border-b border-slate-200 ${cls}`}>{children}</th>;
    const TD = ({ children, cls='' }) =>
        <td className={`px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums ${cls}`}>{children}</td>;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr>
                            <th rowSpan={2} className="px-3 py-2 text-left text-slate-500 font-bold text-[10px] border-b border-r border-slate-200 bg-slate-50 whitespace-nowrap">Día</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-amber-700 bg-amber-50 border-b border-r border-slate-200">T 1</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-blue-700 bg-blue-50 border-b border-r border-slate-200">T 2</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-slate-700 bg-slate-100 border-b border-r border-slate-200">TOTALES</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-slate-600 bg-slate-50 border-b border-r border-slate-200">% Órdenes</th>
                            <th colSpan={2} className="px-3 py-2 text-center text-[10px] font-bold text-slate-600 bg-slate-50 border-b border-slate-200">% Metros</th>
                        </tr>
                        <tr className="bg-slate-50">
                            <TH cls="text-amber-700 bg-amber-50">Órdenes</TH>
                            <TH cls="text-amber-700 bg-amber-50 border-r border-slate-200">m lin.</TH>
                            <TH cls="text-blue-700 bg-blue-50">Órdenes</TH>
                            <TH cls="text-blue-700 bg-blue-50 border-r border-slate-200">m lin.</TH>
                            <TH cls="text-slate-700">Órdenes</TH>
                            <TH cls="text-slate-700 border-r border-slate-200">Metros</TH>
                            <TH cls="text-amber-600">T1</TH>
                            <TH cls="text-blue-600 border-r border-slate-200">T2</TH>
                            <TH cls="text-amber-600">T1</TH>
                            <TH cls="text-blue-600">T2</TH>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((r, i) => (
                            <tr key={i} className={`hover:bg-slate-50/70 ${i % 2 !== 0 ? 'bg-slate-50/40' : ''}`}>
                                <td className="px-3 py-2 text-slate-700 font-medium border-r border-slate-100 whitespace-nowrap">{r.Dia}</td>
                                <TD cls="text-amber-700">{r.T1_Ordenes}</TD>
                                <TD cls="text-amber-700 border-r border-slate-100">{mlin(r.T1_Metros)}</TD>
                                <TD cls="text-blue-700">{r.T2_Ordenes}</TD>
                                <TD cls="text-blue-700 border-r border-slate-100">{mlin(r.T2_Metros)}</TD>
                                <TD cls="text-slate-800 font-semibold">{r.Total_Ordenes}</TD>
                                <TD cls="text-slate-800 font-semibold border-r border-slate-100">{mlin(r.Total_Metros)}</TD>
                                <TD cls="text-amber-600">{pct(r.T1_Ordenes, r.Total_Ordenes)}</TD>
                                <TD cls="text-blue-600 border-r border-slate-100">{pct(r.T2_Ordenes, r.Total_Ordenes)}</TD>
                                <TD cls="text-amber-600">{pct(r.T1_Metros, r.Total_Metros)}</TD>
                                <TD cls="text-blue-600">{pct(r.T2_Metros, r.Total_Metros)}</TD>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                            <td className="px-3 py-2.5 text-slate-800 text-xs font-bold border-r border-slate-200">TOTALES</td>
                            <TD cls="text-amber-700">{tot.T1_Ordenes}</TD>
                            <TD cls="text-amber-700 border-r border-slate-200">{mlin(tot.T1_Metros)}</TD>
                            <TD cls="text-blue-700">{tot.T2_Ordenes}</TD>
                            <TD cls="text-blue-700 border-r border-slate-200">{mlin(tot.T2_Metros)}</TD>
                            <TD cls="text-slate-900">{tot.Total_Ordenes}</TD>
                            <TD cls="text-slate-900 border-r border-slate-200">{mlin(tot.Total_Metros)}</TD>
                            <TD cls="text-amber-700">{pct(tot.T1_Ordenes, tot.Total_Ordenes)}</TD>
                            <TD cls="text-blue-700 border-r border-slate-200">{pct(tot.T2_Ordenes, tot.Total_Ordenes)}</TD>
                            <TD cls="text-amber-700">{pct(tot.T1_Metros, tot.Total_Metros)}</TD>
                            <TD cls="text-blue-700">{pct(tot.T2_Metros, tot.Total_Metros)}</TD>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-400">
                {rows.length} días · órdenes que pasaron por Control de Calidad
            </div>
        </div>
    );
}

// ─── Tabla simple (otros reportes) ───────────────────────────────────────────
function SimpleTable({ rows, cols }) {
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
                                    <td key={c.key} className={`px-3 py-2 ${TEXT_WRAP_KEYS.has(c.key) ? 'max-w-[280px]' : 'whitespace-nowrap'}`}>
                                        <Cell col={c} value={row[c.key]} row={row} />
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

// ─── Tabla agrupada con header de sección ────────────────────────────────────
function GroupedTable({ title, rows, cols, headerCls, titleCls, dotCls }) {
    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${headerCls}`}>
                <span className={`w-2 h-2 rounded-full ${dotCls} shrink-0`} />
                <span className={`font-bold text-xs ${titleCls}`}>{title}</span>
                <span className="text-[11px] text-slate-400 ml-1">— {rows.length.toLocaleString()} registros</span>
            </div>
            {rows.length === 0 ? (
                <div className="px-4 py-5 text-center text-xs text-slate-400">Sin resultados</div>
            ) : (
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
                                        <td key={c.key} className={`px-3 py-2 ${TEXT_WRAP_KEYS.has(c.key) ? 'max-w-[280px]' : 'whitespace-nowrap'}`}>
                                            <Cell col={c} value={row[c.key]} row={row} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

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
            if (clienteBoxRef.current && !clienteBoxRef.current.contains(e.target)) setSuggs([]);
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

            const params = {
                ...(filters.area !== 'Todas' && { area: filters.area }),
                ...(dateRange.desde && { fechaDesde: toISO(dateRange.desde) }),
                ...(dateRange.hasta && { fechaHasta: toISO(dateRange.hasta) }),
                ...(filters.turno !== 'Ambos' && { turno: filters.turno === 'T1 · 00-14 h' ? '1' : '2' }),
                ...(filters.material && { material: filters.material }),
                ...(filters.clienteSearch && { clienteSearch: filters.clienteSearch }),
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
    }, [activeReport, filters]);

    useEffect(() => { fetchReport(); }, [fetchReport]);

    const handleReportChange = id => {
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
    const cols = COLUMNS[activeReport] || [];
    const activeRep = REPORTS.find(r => r.id === activeReport);

    return (
        <div className="flex h-full bg-slate-50 overflow-hidden">

            {/* ── Sidebar ─────────────────────────────────────────────────── */}
            <aside className="w-52 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm">
                <div className="px-4 py-3.5 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <FileSpreadsheet size={17} className="text-brand-cyan" />
                        <span className="font-bold text-slate-800 text-sm">Reportes</span>
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
                                <Icon
                                    size={14}
                                    className={active ? 'text-white shrink-0' : `${r.color} shrink-0 opacity-80`}
                                />
                                <span className="text-xs font-medium truncate flex-1">{r.label}</span>
                                {active && <ChevronRight size={11} className="text-white/70 shrink-0" />}
                            </button>
                        );
                    })}
                </nav>

                <div className="px-3 py-2.5 border-t border-slate-100">
                    <p className="text-[10px] text-slate-400 text-center">
                        {loading ? 'Cargando...' : data.length > 0 ? `${data.length.toLocaleString()} registros` : 'Sin datos'}
                    </p>
                </div>
            </aside>

            {/* ── Contenido ───────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden">

                {/* ── Header filtros ──────────────────────────────────────── */}
                <div className="bg-white border-b border-slate-200 px-5 py-3 shadow-sm shrink-0 space-y-2.5">

                    {/* Fila 1: ÁREA + título + botones */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1.5">
                                {activeRep && (() => { const I = activeRep.icon; return <I size={15} className={activeRep.color} />; })()}
                                <span className="font-bold text-slate-700 text-sm">{activeRep?.label}</span>
                            </div>
                            <div className="h-4 w-px bg-slate-200" />
                            <span className="text-[11px] font-bold text-slate-500 tracking-wide">ÁREA</span>
                            {['Todas', ...opciones.areas.map(a => a.nombre)].map(a => (
                                <button
                                    key={a}
                                    onClick={() => setF({ area: a })}
                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                        filters.area === a
                                            ? 'bg-brand-cyan text-white shadow-sm'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    {a}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={fetchReport}
                                disabled={loading}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-all"
                                title="Actualizar"
                            >
                                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button
                                onClick={handlePrint}
                                disabled={!data.length || loading}
                                className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-all shadow-sm"
                            >
                                <Printer size={13} />
                                Imprimir PDF
                            </button>
                        </div>
                    </div>

                    {/* Fila 2: FECHA */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-slate-500 w-11 shrink-0 tracking-wide">FECHA</span>
                        {FECHA_PRESETS.map(p => (
                            <button
                                key={p.value}
                                onClick={() => setF({ fechaPreset: p.value })}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                    filters.fechaPreset === p.value
                                        ? 'bg-brand-cyan text-white shadow-sm'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                        {filters.fechaPreset === 'custom' && (
                            <div className="flex items-center gap-2 ml-1">
                                <input type="date" value={filters.fechaDesde}
                                    onChange={e => setF({ fechaDesde: e.target.value })}
                                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                                <span className="text-slate-400 text-xs">—</span>
                                <input type="date" value={filters.fechaHasta}
                                    onChange={e => setF({ fechaHasta: e.target.value })}
                                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                            </div>
                        )}
                    </div>

                    {/* Fila 3: TURNO + MATERIAL + CLIENTE */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">TURNO</span>
                            {['Ambos', 'T1 · 00-14 h', 'T2 · 14-24 h'].map(t => (
                                <button key={t} onClick={() => setF({ turno: t })}
                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                        filters.turno === t ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}>
                                    {t}
                                </button>
                            ))}
                        </div>

                        <div className="h-4 w-px bg-slate-200 hidden sm:block" />

                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">MATERIAL</span>
                            <select value={filters.material} onChange={e => setF({ material: e.target.value })}
                                className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-brand-cyan/30 outline-none bg-white min-w-[150px]">
                                <option value="">Todos los materiales</option>
                                {opciones.materiales.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                            </select>
                        </div>

                        <div className="h-4 w-px bg-slate-200 hidden sm:block" />

                        <div className="flex items-center gap-2 relative" ref={clienteBoxRef}>
                            <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">CLIENTE</span>
                            <div className="relative">
                                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input type="text" placeholder="Buscar cliente..." value={filters.clienteSearch}
                                    onChange={e => setF({ clienteSearch: e.target.value, idCliente: null })}
                                    className="text-xs border border-slate-300 rounded-lg pl-7 pr-2 py-1.5 focus:ring-2 focus:ring-brand-cyan/30 outline-none w-44" />
                                {suggs.length > 0 && (
                                    <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 min-w-full max-h-44 overflow-y-auto">
                                        {suggs.map(c => (
                                            <button key={c.id}
                                                className="w-full text-left px-3 py-2 text-xs hover:bg-brand-cyan/10 hover:text-brand-cyan transition-colors first:rounded-t-xl last:rounded-b-xl"
                                                onClick={() => { setF({ clienteSearch: c.nombre }); setSuggs([]); }}>
                                                {c.nombre}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {filters.clienteSearch && (
                                <button onClick={() => setF({ clienteSearch: '' })}
                                    className="text-xs text-red-500 hover:text-red-700 font-bold leading-none" title="Limpiar">✕</button>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── KPIs ───────────────────────────────────────────────── */}
                <KpisStrip activeReport={activeReport} totales={totales} />

                {/* ── Tabla ──────────────────────────────────────────────── */}
                <div className="flex-1 overflow-auto p-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-cyan" />
                            <p className="text-sm text-slate-400">Cargando reporte...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2">
                            <p className="text-red-500 font-semibold text-sm">Error al cargar el reporte</p>
                            <p className="text-slate-400 text-xs max-w-sm text-center">{error}</p>
                            <button onClick={fetchReport}
                                className="mt-2 px-4 py-1.5 bg-brand-cyan text-white text-xs rounded-lg font-medium">
                                Reintentar
                            </button>
                        </div>
                    ) : data.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2">
                            <FileSpreadsheet size={42} className="text-slate-200" />
                            <p className="text-slate-400 text-sm">Sin resultados para los filtros seleccionados</p>
                        </div>
                    ) : activeReport === 'ordenes' ? (
                        <OrdenesPorDiaTable rows={data} />
                    ) : groupedData ? (
                        /* ── Vista agrupada: Fallas / Reposiciones ── */
                        <div className="space-y-5">
                            <GroupedTable
                                title="Fallas"
                                rows={groupedData.fallas}
                                cols={cols}
                                headerCls="bg-orange-50 border-orange-200"
                                titleCls="text-orange-700"
                                dotCls="bg-orange-500"
                            />
                            <GroupedTable
                                title="Reposiciones"
                                rows={groupedData.reposiciones}
                                cols={cols}
                                headerCls="bg-violet-50 border-violet-200"
                                titleCls="text-violet-700"
                                dotCls="bg-violet-500"
                            />
                        </div>
                    ) : (
                        <SimpleTable rows={data} cols={cols} />
                    )}
                </div>
            </div>
        </div>
    );
}
