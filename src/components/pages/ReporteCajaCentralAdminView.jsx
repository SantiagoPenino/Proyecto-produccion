import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import api from '../../services/apiClient';
import {
    Calendar, Search, RefreshCw, Printer, Building2, Landmark,
    AlertTriangle, Wallet, FileText, Filter, Loader2
} from 'lucide-react';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }) : '—';

// Un movimiento en Caja Central se marca como "sospechoso" (posible contaminación
// administrativa) si no debería estar en un arqueo físico de mostrador:
//  · huérfano  → sin sesión (StuIdSesion NULL) = invisible a todo arqueo
//  · anticipo  → operación administrativa (adelanto de plata)
//  · online    → cobro Handy/MercadoPago que debería ir a la caja administrativa
const esOnline = (m) => /venta online autom|cobro handy|cobro mercado\s?pago/i.test(`${m.Usuario || ''} ${m.Concepto || ''}`);
const esAnticipo = (m) => /anticipo/i.test(`${m.TipoDoc || ''} ${m.TipoComprobante || ''}`);
const esHuerfano = (m) => m.TipoOperacion === 'INGRESO' && (m.Sesion === null || m.Sesion === undefined);
const esSospechoso = (m) => esHuerfano(m) || esAnticipo(m) || esOnline(m);

const emptyTot = { UYU_in: 0, UYU_out: 0, USD_in: 0, USD_out: 0, cant: 0 };

// ─── TOTALES DE UN BUCKET ──────────────────────────────────────────────────────
const TotalesBucket = ({ t }) => (
    <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <p className="text-emerald-600 font-bold uppercase text-[10px]">Ingresos</p>
            <p className="font-black text-emerald-800">$ {fmt(t.UYU_in)}</p>
            <p className="font-black text-emerald-800">U$S {fmt(t.USD_in)}</p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            <p className="text-rose-600 font-bold uppercase text-[10px]">Egresos</p>
            <p className="font-black text-rose-800">$ {fmt(t.UYU_out)}</p>
            <p className="font-black text-rose-800">U$S {fmt(t.USD_out)}</p>
        </div>
    </div>
);

// ─── TABLA DE MOVIMIENTOS ──────────────────────────────────────────────────────
const TablaMovs = ({ movs, marcarSospechosos }) => (
    <div className="overflow-auto max-h-[420px] rounded-lg border border-slate-200">
        <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-600 font-black uppercase tracking-wide z-10">
                <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Comprobante</th>
                    <th className="px-3 py-2 text-left">Concepto</th>
                    <th className="px-3 py-2 text-left">Usuario</th>
                    <th className="px-3 py-2 text-right">Entrada</th>
                    <th className="px-3 py-2 text-right">Salida</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {movs.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-slate-400">Sin movimientos</td></tr>
                ) : movs.map((m, i) => {
                    const susp = marcarSospechosos && esSospechoso(m);
                    return (
                        <tr key={`${m.TipoOperacion}-${m.Id}-${i}`} className={susp ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                            <td className="px-3 py-2 whitespace-nowrap text-slate-500">{fmtDate(m.Fecha)}</td>
                            <td className="px-3 py-2 font-mono font-bold text-indigo-700 whitespace-nowrap">
                                {susp && <AlertTriangle size={11} className="inline mr-1 text-amber-500" />}
                                {m.TipoComprobante} {m.Comprobante}
                            </td>
                            <td className="px-3 py-2 text-slate-600 max-w-[220px] truncate" title={m.Concepto}>{m.Concepto}</td>
                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{m.Usuario}</td>
                            <td className="px-3 py-2 text-right font-bold text-emerald-700 whitespace-nowrap">{m.Entrada > 0 ? `${m.Moneda} ${fmt(m.Entrada)}` : '—'}</td>
                            <td className="px-3 py-2 text-right font-bold text-rose-700 whitespace-nowrap">{m.Salida > 0 ? `${m.Moneda} ${fmt(m.Salida)}` : '—'}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    </div>
);

// ─── CIERRES DE LA CAJA CENTRAL (con PDF) ───────────────────────────────────────
const CierresCentral = ({ cierres, onVerPdf, onGenerarPdf, cargando, generando }) => {
    if (!cierres || cierres.length === 0) return null;
    return (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
            <p className="text-[11px] font-black text-indigo-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                <FileText size={12} /> Cierres de caja del período
            </p>
            <div className="flex flex-col gap-1.5">
                {cierres.map(c => {
                    const abierta = c.StuEstado === 'ABIERTA';
                    const dif = Number(c.StuDiferencia || 0);
                    return (
                        <div key={c.StuIdSesion} className="flex items-center justify-between gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2 text-xs">
                            <div className="flex flex-col">
                                <span className="font-black text-slate-700">Sesión #{c.StuIdSesion}
                                    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${abierta ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{c.StuEstado}</span>
                                </span>
                                <span className="text-slate-400">{fmtDate(c.StuFechaApertura)}{c.StuFechaCierre ? ` → ${fmtDate(c.StuFechaCierre)}` : ''}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {!abierta && (
                                    <span className={`font-bold ${dif < 0 ? 'text-rose-600' : dif > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                        Dif: $ {fmt(dif)}
                                    </span>
                                )}
                                <button
                                    onClick={() => onGenerarPdf(c.StuIdSesion)}
                                    disabled={generando === c.StuIdSesion}
                                    title={abierta ? 'Generar un PDF de vista previa con lo cargado hasta ahora (la sesión sigue abierta)' : 'Regenerar el PDF de este cierre'}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50 transition-all">
                                    {generando === c.StuIdSesion ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                    {abierta ? 'Vista previa PDF' : (c.tienePdf ? 'Regenerar' : 'Generar PDF')}
                                </button>
                                <button
                                    onClick={() => onVerPdf(c.StuIdSesion)}
                                    disabled={!c.tienePdf || cargando === c.StuIdSesion}
                                    title={c.tienePdf ? 'Ver PDF del cierre' : 'No hay PDF de cierre guardado para esta sesión'}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all">
                                    {cargando === c.StuIdSesion ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                                    {c.tienePdf ? 'Ver PDF' : 'Sin PDF'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─── VISTA PRINCIPAL ────────────────────────────────────────────────────────────
const ReporteCajaCentralAdminView = () => {
    const hoy = new Date().toISOString().split('T')[0];
    const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const [desde, setDesde] = useState(ayer);
    const [hasta, setHasta] = useState(hoy);
    const [caja, setCaja] = useState('ambas');       // 'ambas' | 'central' | 'admin'
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const [cierres, setCierres] = useState([]);      // sesiones + PDF de cierre disponible
    const [pdfCargando, setPdfCargando] = useState(null);  // StuIdSesion en descarga
    const [pdfGenerando, setPdfGenerando] = useState(null); // StuIdSesion generándose

    const fetchDatos = async () => {
        setLoading(true);
        try {
            const [rep, cie] = await Promise.all([
                api.get(`/contabilidad/caja/reporte-central-admin?desde=${desde}&hasta=${hasta}`),
                api.get(`/contabilidad/caja/cierres?desde=${desde}&hasta=${hasta}`),
            ]);
            setData(rep.data);
            setCierres(cie.data?.cierres || []);
        } catch (e) { console.error(e); toast.error('No se pudo cargar el reporte.'); }
        finally { setLoading(false); }
    };

    // Trae el PDF de cierre como blob (la ruta va protegida por JWT → no sirve window.open directo)
    const verPdfCierre = async (sesionId) => {
        setPdfCargando(sesionId);
        try {
            const res = await api.get(`/contabilidad/caja/cierre-pdf/${sesionId}`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) {
            toast.error(`No hay PDF de cierre guardado para la sesión ${sesionId}.`);
        } finally { setPdfCargando(null); }
    };

    // Genera (o regenera) el PDF de una sesión, esté abierta o cerrada, y lo abre.
    const generarPdfCierre = async (sesionId) => {
        setPdfGenerando(sesionId);
        try {
            await api.post(`/contabilidad/caja/cierre-pdf/${sesionId}/generar`);
            toast.success('PDF generado correctamente.');
            const cie = await api.get(`/contabilidad/caja/cierres?desde=${desde}&hasta=${hasta}`);
            setCierres(cie.data?.cierres || []);
            await verPdfCierre(sesionId);
        } catch (e) {
            toast.error('No se pudo generar el PDF: ' + (e.response?.data?.error || e.message));
        } finally { setPdfGenerando(null); }
    };

    const central = data?.central || { movimientos: [], totales: emptyTot };
    const admin = data?.admin || { movimientos: [], totales: emptyTot };
    const sospechosos = useMemo(() => central.movimientos.filter(esSospechoso), [central.movimientos]);

    const handlePrint = () => {
        if (!data) return;
        const win = window.open('', '_blank');
        const filaHtml = (m, susp) => `
            <tr style="border-top:1px solid #e2e8f0;${susp ? 'background:#fef3c7' : ''}">
                <td style="padding:4px 8px;color:#64748b">${fmtDate(m.Fecha)}</td>
                <td style="padding:4px 8px;font-weight:bold;color:#4338ca">${susp ? '⚠ ' : ''}${m.TipoComprobante || ''} ${m.Comprobante || ''}</td>
                <td style="padding:4px 8px">${m.Concepto || ''}</td>
                <td style="padding:4px 8px;color:#64748b">${m.Usuario || ''}</td>
                <td style="padding:4px 8px;text-align:right;color:#065f46">${m.Entrada > 0 ? m.Moneda + ' ' + fmt(m.Entrada) : ''}</td>
                <td style="padding:4px 8px;text-align:right;color:#991b1b">${m.Salida > 0 ? m.Moneda + ' ' + fmt(m.Salida) : ''}</td>
            </tr>`;
        const bloque = (titulo, b, marcar) => `
            <h2 style="font-size:15px;margin:18px 0 6px">${titulo} <span style="font-weight:400;color:#64748b;font-size:12px">(${b.totales.cant} movs · Ingresos $ ${fmt(b.totales.UYU_in)} / U$S ${fmt(b.totales.USD_in)} · Egresos $ ${fmt(b.totales.UYU_out)} / U$S ${fmt(b.totales.USD_out)})</span></h2>
            <table style="width:100%;border-collapse:collapse;font-size:11px">
                <thead><tr style="background:#f1f5f9;color:#475569">
                    <th style="padding:6px 8px;text-align:left">Fecha</th><th style="padding:6px 8px;text-align:left">Comprobante</th>
                    <th style="padding:6px 8px;text-align:left">Concepto</th><th style="padding:6px 8px;text-align:left">Usuario</th>
                    <th style="padding:6px 8px;text-align:right">Entrada</th><th style="padding:6px 8px;text-align:right">Salida</th>
                </tr></thead>
                <tbody>${b.movimientos.map(m => filaHtml(m, marcar && esSospechoso(m))).join('') || '<tr><td colspan=6 style="padding:8px;color:#94a3b8">Sin movimientos</td></tr>'}</tbody>
            </table>`;
        win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
            <title>Caja Central vs Administrativa ${desde} al ${hasta}</title>
            <style>body{font-family:Arial,sans-serif;color:#1e293b;margin:0;padding:20px}h1{font-size:20px;margin:0}</style>
            </head><body>
            <h1>🏦 Caja Central vs Administrativa</h1>
            <p style="color:#64748b;font-size:12px">Período: ${desde} al ${hasta} · Generado: ${new Date().toLocaleString('es-UY')}</p>
            ${sospechosos.length ? `<p style="background:#fef3c7;border:1px solid #fde68a;padding:8px 12px;border-radius:8px;font-size:12px;color:#92400e">⚠ ${sospechosos.length} movimiento(s) en Caja Central que no son cobros online — posible contaminación administrativa.</p>` : ''}
            ${bloque('🏦 Caja Central', central, true)}
            ${bloque('🏢 Caja Administrativa', admin, false)}
            </body></html>`);
        win.document.close(); win.focus();
        setTimeout(() => win.print(), 400);
    };

    return (
        <div className="min-h-full flex flex-col p-4 lg:p-8 gap-4 font-sans bg-[#f6f8fb]">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <Wallet size={24} className="text-indigo-600" /> Caja Central vs Administrativa
                    </h2>
                    <p className="text-sm text-slate-400 mt-0.5">Auditoría de movimientos por bucket — detectá pagos administrativos que caen en el arqueo central</p>
                </div>
                <button onClick={handlePrint} disabled={!data}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md disabled:opacity-40 transition-all text-sm">
                    <Printer size={15} /> Exportar PDF
                </button>
            </div>

            {/* Filtros */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3 shadow-sm">
                <div className="flex flex-col gap-1 min-w-[140px]">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><Calendar size={11} /> Desde</label>
                    <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="flex flex-col gap-1 min-w-[140px]">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><Calendar size={11} /> Hasta</label>
                    <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500" />
                </div>
                <div className="flex flex-col gap-1 min-w-[170px]">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><Filter size={11} /> Caja</label>
                    <select value={caja} onChange={e => setCaja(e.target.value)}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500 bg-white">
                        <option value="ambas">Ambas (comparar)</option>
                        <option value="central">Solo Caja Central</option>
                        <option value="admin">Solo Caja Administrativa</option>
                    </select>
                </div>
                <button onClick={fetchDatos} disabled={loading}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50">
                    {loading ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />} Buscar
                </button>
            </div>

            {/* Alerta de contaminación */}
            {data && sospechosos.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-black text-amber-800">{sospechosos.length} movimiento(s) sospechoso(s) en la Caja Central</p>
                        <p className="text-amber-700">No son cobros online (Handy/MercadoPago). Revisá si en realidad eran de la Caja Administrativa y contaminaron el arqueo central.</p>
                    </div>
                </div>
            )}

            {/* Buckets */}
            {!data ? (
                <div className="text-center py-20 text-slate-400 bg-white rounded-xl border border-slate-200">
                    <Wallet size={32} className="mx-auto mb-2 opacity-30" /><p>Seleccioná un período y presioná Buscar</p>
                </div>
            ) : (
                <div className={`grid grid-cols-1 gap-4 ${caja === 'ambas' ? 'xl:grid-cols-2' : ''}`}>
                    {/* CENTRAL */}
                    {caja !== 'admin' && (
                        <div className="bg-white rounded-xl border-2 border-indigo-200 p-4 shadow-sm flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h3 className="font-black text-slate-800 flex items-center gap-2"><Landmark size={18} className="text-indigo-600" /> Caja Central</h3>
                                <span className="text-xs font-bold text-slate-400">{central.totales.cant} movs</span>
                            </div>
                            <TotalesBucket t={central.totales} />
                            {/* Cierres del período con su PDF */}
                            <CierresCentral cierres={cierres} onVerPdf={verPdfCierre} onGenerarPdf={generarPdfCierre} cargando={pdfCargando} generando={pdfGenerando} />
                            <TablaMovs movs={central.movimientos} marcarSospechosos />
                        </div>
                    )}
                    {/* ADMINISTRATIVA */}
                    {caja !== 'central' && (
                        <div className="bg-white rounded-xl border-2 border-slate-200 p-4 shadow-sm flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h3 className="font-black text-slate-800 flex items-center gap-2"><Building2 size={18} className="text-slate-600" /> Caja Administrativa</h3>
                                <span className="text-xs font-bold text-slate-400">{admin.totales.cant} movs</span>
                            </div>
                            <TotalesBucket t={admin.totales} />
                            <TablaMovs movs={admin.movimientos} marcarSospechosos={false} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ReporteCajaCentralAdminView;
