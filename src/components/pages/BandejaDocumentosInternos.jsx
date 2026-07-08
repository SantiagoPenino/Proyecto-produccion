import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowDownCircle, ArrowUpCircle, Search, RefreshCw,
  FileText, ChevronLeft, ChevronRight, Receipt, TrendingDown, TrendingUp, Printer,
  Ban, Pencil, X, AlertTriangle
} from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtTime = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
};
const numSinCeros = (n) => n ? String(parseInt(n, 10) || n) : '';
const nroDoc = (serie, numero) => {
  const s = serie || '';
  const n = numSinCeros(numero);
  if (!s && !n) return '—';
  if (!n) return s;
  return `${s}-${n}`;
};

const TIPO_LABELS = {
  '05': 'Recibo Caja',
  '40': 'Recibo Cobro',
  'Recibo': 'Recibo',
  'RECIBO': 'Recibo',
  'RECIBO_ANTICIPO': 'Recibo Anticipo',
  'EGRESO': 'Egreso',
  'GASTO': 'Gasto',
  'NINGUNO': 'Sin Doc.',
};
const getTipoLabel = (tipo) => TIPO_LABELS[String(tipo||'').trim()] || String(tipo||'').trim() || '—';

// ──────────────────────────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────────────────────────
export default function BandejaDocumentosInternos() {
  // Filtros
  const hoy = new Date().toISOString().split('T')[0];
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [filtros, setFiltros] = useState({
    desde: hace30,
    hasta: hoy,
    tipo: 'TODOS',
    cliente: '',
    caja: 'TODOS',
  });
  const [page, setPage]         = useState(1);
  const LIMIT = 50;

  // Data
  const [docs, setDocs]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [hasMore, setHasMore]   = useState(false);

  // Modal de acción (anular / editar monto)
  const [modal, setModal]           = useState(null); // { tipo:'anular'|'editar', doc }
  const [motivo, setMotivo]         = useState('');
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Totales calculados localmente sobre la página actual (los anulados no suman)
  const totales = docs.reduce((acc, d) => {
    if (d.Anulado) return acc;
    const t = Number(d.Total) || 0;
    if (d.TipoOperacion === 'INGRESO') {
      if (d.Moneda === 'USD') acc.ingUSD += t; else acc.ingUYU += t;
    } else {
      if (d.Moneda === 'USD') acc.egrUSD += t; else acc.egrUYU += t;
    }
    return acc;
  }, { ingUYU: 0, ingUSD: 0, egrUYU: 0, egrUSD: 0 });

  const fetchDocs = useCallback(async (p = 1, f = filtros) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        desde: f.desde,
        hasta: f.hasta,
        tipo:  f.tipo,
        caja:  f.caja,
        page:  p,
        limit: LIMIT,
      });
      if (f.cliente.trim()) params.set('cliente', f.cliente.trim());
      const res = await api.get(`/contabilidad/caja/documentos?${params}`);
      const data = res.data?.data || [];
      setDocs(data);
      setHasMore(data.length === LIMIT);
    } catch (err) {
      toast.error('Error al cargar documentos: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => { fetchDocs(1, filtros); }, []);

  const handleBuscar = () => { setPage(1); fetchDocs(1, filtros); };
  const handlePrev   = () => { const p = Math.max(1, page - 1); setPage(p); fetchDocs(p, filtros); };
  const handleNext   = () => { const p = page + 1; setPage(p); fetchDocs(p, filtros); };

  const handleImprimir = (doc) => {
    const isIngreso = doc.TipoOperacion === 'INGRESO';
    const simb = doc.Moneda === 'USD' ? 'U$S' : '$';
    const nro  = nroDoc(doc.Serie, doc.Numero);
    const tipo = getTipoLabel(doc.TipoDoc || doc.CodTipoDoc);
    const win = window.open('', '_blank', 'width=360,height=520');
    if (!win) return toast.error('El navegador bloqueó la ventana emergente');
    win.document.write(`
      <html><head><title>${tipo} ${nro}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.4;padding:8mm;width:80mm;background:#fff;color:#000}
        h2{font-size:15px;font-weight:bold;text-align:center;margin-bottom:4px}
        .sub{text-align:center;font-size:10px;color:#555;margin-bottom:8px}
        .sep{border-bottom:1px dashed #000;margin:8px 0}
        .row{display:flex;justify-content:space-between;font-size:11px;margin:3px 0}
        .lbl{color:#555}
        .total{font-size:14px;font-weight:bold;display:flex;justify-content:space-between;margin:6px 0}
        .dir{text-align:center;font-size:10px;padding:6px 0;font-weight:bold;color:${isIngreso?'#059669':'#e11d48'}}
        .pie{text-align:center;font-size:9px;color:#999;margin-top:16px}
        @media print{@page{size:80mm auto;margin:0}}
      </style></head><body>
      <h2>USER ERP</h2>
      <div class="sub">${tipo}</div>
      <div class="sep"></div>
      <div class="row"><span class="lbl">Fecha:</span><span>${fmtDate(doc.Fecha)} ${fmtTime(doc.Fecha)}</span></div>
      <div class="row"><span class="lbl">N° Doc:</span><span><b>${nro}</b></span></div>
      <div class="row"><span class="lbl">${isIngreso?'Cliente':'Proveedor'}:</span><span>${doc.ClienteNombre||'—'}</span></div>
      <div class="row"><span class="lbl">Medio Pago:</span><span>${doc.MetodoPago||'—'}</span></div>
      ${doc.Observaciones ? `<div class="row"><span class="lbl">Concepto:</span><span style="max-width:160px;word-break:break-word">${doc.Observaciones}</span></div>` : ''}
      <div class="sep"></div>
      <div class="total"><span>TOTAL:</span><span>${simb} ${fmt(doc.Total)}</span></div>
      <div class="sep"></div>
      <div class="dir">${isIngreso ? '↓ INGRESO' : '↑ EGRESO'}</div>
      <div class="row"><span class="lbl">Usuario:</span><span>${doc.Usuario||'—'}</span></div>
      <div class="pie"><p>Comprobante interno — USER ERP</p></div>
      </body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.addEventListener('afterprint', () => win.close()); }, 600);
  };

  // ── Acciones: anular / editar monto ──────────────────────────────────────────
  const abrirAnular = (doc) => { setMotivo(''); setModal({ tipo: 'anular', doc }); };
  const abrirEditar = (doc) => {
    setMotivo('');
    setNuevoMonto(String(Number(doc.Total) || ''));
    setModal({ tipo: 'editar', doc });
  };
  const cerrarModal = () => { if (!submitting) setModal(null); };

  const confirmarAnular = async () => {
    if (!modal?.doc) return;
    setSubmitting(true);
    try {
      await api.post('/contabilidad/caja/documentos/anular', {
        tipoOperacion: modal.doc.TipoOperacion,
        docId: modal.doc.DocId,
        motivo: motivo.trim() || undefined,
      });
      toast.success('Documento anulado correctamente');
      setModal(null);
      fetchDocs(page, filtros);
    } catch (err) {
      toast.error('Error al anular: ' + (err.response?.data?.error || err.message));
    } finally { setSubmitting(false); }
  };

  const confirmarEditar = async () => {
    if (!modal?.doc) return;
    const monto = parseFloat(nuevoMonto);
    if (isNaN(monto) || monto <= 0) { toast.error('Ingresá un monto válido'); return; }
    setSubmitting(true);
    try {
      const res = await api.post('/contabilidad/caja/documentos/modificar-monto', {
        tipoOperacion: modal.doc.TipoOperacion,
        docId: modal.doc.DocId,
        nuevoMonto: monto,
        motivo: motivo.trim() || undefined,
      });
      const nuevoNro = res.data?.nuevo?.numeroDoc;
      toast.success('Monto modificado' + (nuevoNro ? ` — nuevo N° ${nuevoNro}` : ''));
      setModal(null);
      fetchDocs(page, filtros);
    } catch (err) {
      toast.error('Error al modificar: ' + (err.response?.data?.error || err.message));
    } finally { setSubmitting(false); }
  };

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <Receipt size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-zinc-900">Bandeja de Documentos Internos</h1>
              <p className="text-xs text-zinc-500">Recibos de cobro, egresos y comprobantes no-CFE</p>
            </div>
          </div>
          <button
            onClick={() => fetchDocs(page, filtros)}
            className="flex items-center gap-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-bold text-xs px-4 py-2 rounded-xl shadow-sm transition-all"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {/* Tarjetas de resumen */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SummaryCard label="Ingresos UYU" value={`$ ${fmt(totales.ingUYU)}`} icon={<TrendingUp size={18}/>} color="emerald" />
          <SummaryCard label="Ingresos USD" value={`U$S ${fmt(totales.ingUSD)}`} icon={<TrendingUp size={18}/>} color="blue" />
          <SummaryCard label="Egresos UYU" value={`$ ${fmt(totales.egrUYU)}`} icon={<TrendingDown size={18}/>} color="rose" />
          <SummaryCard label="Egresos USD" value={`U$S ${fmt(totales.egrUSD)}`} icon={<TrendingDown size={18}/>} color="orange" />
        </div>

        {/* Filtros */}
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm mb-5">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Fecha Desde</label>
              <input type="date" value={filtros.desde}
                onChange={e => setFiltros(f => ({...f, desde: e.target.value}))}
                className="border border-zinc-200 rounded-lg px-3 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-indigo-500 bg-white" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Fecha Hasta</label>
              <input type="date" value={filtros.hasta}
                onChange={e => setFiltros(f => ({...f, hasta: e.target.value}))}
                className="border border-zinc-200 rounded-lg px-3 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-indigo-500 bg-white" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Tipo</label>
              <select value={filtros.tipo}
                onChange={e => setFiltros(f => ({...f, tipo: e.target.value}))}
                className="border border-zinc-200 rounded-lg px-3 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-indigo-500 bg-white cursor-pointer min-w-[140px]">
                <option value="TODOS">Todos</option>
                <option value="INGRESO">Ingresos / Recibos</option>
                <option value="EGRESO">Egresos / Gastos</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Caja</label>
              <select value={filtros.caja}
                onChange={e => setFiltros(f => ({...f, caja: e.target.value}))}
                className="border border-zinc-200 rounded-lg px-3 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-indigo-500 bg-white cursor-pointer min-w-[150px]">
                <option value="TODOS">Todas</option>
                <option value="ADMIN">Administrativa</option>
                <option value="CENTRAL">Central</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cliente / Proveedor</label>
              <input type="text" value={filtros.cliente}
                placeholder="Buscar por nombre..."
                onChange={e => setFiltros(f => ({...f, cliente: e.target.value}))}
                onKeyDown={e => e.key === 'Enter' && handleBuscar()}
                className="border border-zinc-200 rounded-lg px-3 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-indigo-500 bg-white" />
            </div>
            <button onClick={handleBuscar}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm px-5 py-2 rounded-xl shadow-md transition-all">
              <Search size={15} />
              Buscar
            </button>
          </div>
        </div>

        {/* Tabla */}
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200">
                  <th className="px-4 py-3 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">Fecha</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">Tipo</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">N° Documento</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">Cliente / Proveedor</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">Concepto</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">Medio Pago</th>
                  <th className="px-4 py-3 text-right text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total</th>
                  <th className="px-4 py-3 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">Usuario</th>
                  <th className="px-4 py-3 text-center text-[10px] font-black text-zinc-400 uppercase tracking-widest">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {loading && (
                  <tr><td colSpan={9} className="text-center py-16 text-zinc-400 font-bold text-sm">
                    <RefreshCw size={24} className="animate-spin inline mr-2" />Cargando...
                  </td></tr>
                )}
                {!loading && docs.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-16 text-zinc-400">
                    <FileText size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="font-bold">Sin documentos para el período seleccionado</p>
                  </td></tr>
                )}
                {!loading && docs.map((doc, i) => {
                  const isIngreso = doc.TipoOperacion === 'INGRESO';
                  const simb = doc.Moneda === 'USD' ? 'U$S' : '$';
                  return (
                    <tr key={`${doc.TipoOperacion}-${doc.DocId}-${i}`}
                      className={`transition-colors group ${doc.Anulado ? 'bg-rose-50/40' : 'hover:bg-zinc-50/50'}`}>
                      {/* Fecha */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className={`font-bold text-zinc-800 text-xs ${doc.Anulado ? 'line-through opacity-60' : ''}`}>{fmtDate(doc.Fecha)}</div>
                        <div className="text-[10px] text-zinc-400">{fmtTime(doc.Fecha)}</div>
                      </td>
                      {/* Tipo */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${
                            isIngreso
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-100 text-rose-700'
                          } ${doc.Anulado ? 'opacity-50' : ''}`}>
                            {isIngreso
                              ? <ArrowDownCircle size={11}/>
                              : <ArrowUpCircle size={11}/>}
                            {getTipoLabel(doc.TipoDoc || doc.CodTipoDoc)}
                          </span>
                          {doc.Anulado && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-zinc-800 text-white">
                              <Ban size={9}/> Anulado
                            </span>
                          )}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                            Number(doc.EsCajaAdmin) === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {Number(doc.EsCajaAdmin) === 1 ? 'Administrativa' : 'Central'}
                          </span>
                        </div>
                      </td>
                      {/* Nro */}
                      <td className="px-4 py-3 whitespace-nowrap font-black text-xs text-zinc-800">
                        {nroDoc(doc.Serie, doc.Numero)}
                      </td>
                      {/* Cliente */}
                      <td className="px-4 py-3">
                        <div className="font-bold text-zinc-800 text-xs max-w-[160px] truncate">{doc.ClienteNombre || '—'}</div>
                        {doc.ClienteId != null && (
                          <div className="text-[10px] text-zinc-400 font-mono mt-0.5">ID #{doc.ClienteId}</div>
                        )}
                      </td>
                      {/* Concepto */}
                      <td className="px-4 py-3">
                        <div className="text-xs text-zinc-500 max-w-[200px] truncate" title={doc.Observaciones}>
                          {doc.Observaciones || '—'}
                        </div>
                      </td>
                      {/* Medio pago */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs text-zinc-500 font-bold">{doc.MetodoPago || '—'}</span>
                      </td>
                      {/* Total */}
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span className={`font-black text-sm ${isIngreso ? 'text-emerald-700' : 'text-rose-700'} ${doc.Anulado ? 'line-through opacity-60' : ''}`}>
                          {simb} {fmt(doc.Total)}
                        </span>
                      </td>
                      {/* Usuario */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-[10px] text-zinc-400 font-bold">{doc.Usuario || '—'}</span>
                      </td>
                      {/* Acciones */}
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleImprimir(doc)}
                            title="Imprimir / Ver documento"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-600 text-zinc-400 transition-all shadow-sm"
                          >
                            <Printer size={15} />
                          </button>
                          {!doc.Anulado && (
                            <>
                              <button
                                onClick={() => abrirEditar(doc)}
                                title="Editar monto"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 text-zinc-400 transition-all shadow-sm"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={() => abrirAnular(doc)}
                                title="Anular documento"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-rose-50 hover:border-rose-400 hover:text-rose-600 text-zinc-400 transition-all shadow-sm"
                              >
                                <Ban size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 bg-zinc-50/50">
            <span className="text-xs text-zinc-400 font-bold">
              Página {page} · {docs.length} registro{docs.length !== 1 ? 's' : ''}
            </span>
            <div className="flex gap-2">
              <button onClick={handlePrev} disabled={page === 1}
                className="flex items-center gap-1 text-xs font-black px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                <ChevronLeft size={14}/> Anterior
              </button>
              <button onClick={handleNext} disabled={!hasMore}
                className="flex items-center gap-1 text-xs font-black px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                Siguiente <ChevronRight size={14}/>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Anular / Editar monto */}
      {modal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[1200]" onClick={cerrarModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className={`px-6 py-4 flex items-center justify-between ${modal.tipo === 'anular' ? 'bg-rose-50' : 'bg-amber-50'}`}>
              <div className="flex items-center gap-2">
                {modal.tipo === 'anular'
                  ? <Ban size={18} className="text-rose-600" />
                  : <Pencil size={18} className="text-amber-600" />}
                <h3 className="font-black text-zinc-800">{modal.tipo === 'anular' ? 'Anular documento' : 'Editar monto'}</h3>
              </div>
              <button onClick={cerrarModal} className="text-zinc-400 hover:text-zinc-700"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* Resumen del documento */}
              <div className="bg-zinc-50 rounded-xl p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400 font-bold">Documento</span>
                  <span className="font-black text-zinc-700">{nroDoc(modal.doc.Serie, modal.doc.Numero)}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-zinc-400 font-bold">{modal.doc.TipoOperacion === 'INGRESO' ? 'Cliente' : 'Proveedor'}</span>
                  <span className="font-bold text-zinc-700 truncate max-w-[180px]">{modal.doc.ClienteNombre || '—'}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-zinc-400 font-bold">Total actual</span>
                  <span className="font-black text-zinc-700">{modal.doc.Moneda === 'USD' ? 'U$S' : '$'} {fmt(modal.doc.Total)}</span>
                </div>
              </div>

              {modal.tipo === 'editar' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Nuevo monto</label>
                  <input type="number" step="0.01" min="0" value={nuevoMonto} autoFocus
                    onChange={e => setNuevoMonto(e.target.value)}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-amber-500" />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                  Motivo {modal.tipo === 'editar' ? '(opcional)' : ''}
                </label>
                <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
                  placeholder="Motivo de la operación..."
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 resize-none" />
              </div>

              {modal.tipo === 'editar' && (
                <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>Se anulará el documento actual y se generará uno nuevo con el monto corregido (nuevo N°).</span>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={cerrarModal} disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-200 font-black text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={modal.tipo === 'anular' ? confirmarAnular : confirmarEditar} disabled={submitting}
                  className={`flex-1 py-2.5 rounded-xl font-black text-sm text-white disabled:opacity-50 ${modal.tipo === 'anular' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                  {submitting ? 'Procesando...' : (modal.tipo === 'anular' ? 'Anular' : 'Guardar cambios')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tarjeta de resumen ────────────────────────────────────────────────────────
function SummaryCard({ label, value, icon, color }) {
  const colors = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    rose:    'bg-rose-50 border-rose-200 text-rose-700',
    orange:  'bg-orange-50 border-orange-200 text-orange-700',
  };
  return (
    <div className={`border rounded-2xl p-4 shadow-sm flex items-center gap-3 ${colors[color]}`}>
      <div className="shrink-0 opacity-80">{icon}</div>
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</div>
        <div className="font-black text-sm">{value}</div>
      </div>
    </div>
  );
}
