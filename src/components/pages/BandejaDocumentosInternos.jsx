import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowDownCircle, ArrowUpCircle, Search, RefreshCw,
  FileText, ChevronLeft, ChevronRight, Receipt, TrendingDown, TrendingUp, Printer,
  Ban, Pencil, X, AlertTriangle, Loader2, SearchX
} from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import { generarPdfReciboCobro } from '../../utils/pdfGenerator';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

// Estética nueva (27/10/2026): encabezado, totales en tarjetas blancas, filtros con Selector/SelectorFecha, tabla
// clara (en el celular, una tarjeta por documento) y ventana de anular / editar monto clara. Ingreso en verde,
// egreso en magenta. La lógica no cambió; el ticket que se imprime tampoco.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide whitespace-nowrap';

// En el celular, tarjetas en vez de la tabla de 8 columnas (una vista sola: no se dibujan las dos ocultando una)
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
// En pantalla, hora de 24 h; fmtTime queda como estaba porque es la del ticket impreso
const fmtHora = (d) => d ? new Date(d).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
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
// Botón de icono de la columna Acciones (el color del hover lo pone cada uno)
const btnAccion = 'inline-flex items-center justify-center w-7 h-7 rounded-lg border border-zinc-200 bg-white text-zinc-400 transition-colors';

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
    moneda: 'TODOS',
  });
  const [page, setPage]         = useState(1);
  const LIMIT = 50;
  const conTabla = useConTabla();

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
        tipo:   f.tipo,
        caja:   f.caja,
        moneda: f.moneda,
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

  // Recibo A4 de un ingreso (modelo único: mismo papel que Caja y el Panel 360)
  const [imprimiendoA4, setImprimiendoA4] = useState(null); // DocId en curso
  const handleReciboA4 = async (doc) => {
    if (imprimiendoA4) return;
    setImprimiendoA4(doc.DocId);
    try {
      const res = await api.get(`/contabilidad/cobros/${doc.DocId}/recibo`);
      await generarPdfReciboCobro(res.data?.data);
    } catch (err) {
      toast.error('No se pudo generar el recibo: ' + (err.response?.data?.error || err.message));
    } finally {
      setImprimiendoA4(null);
    }
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
      const { data } = await api.post('/contabilidad/caja/documentos/anular', {
        tipoOperacion: modal.doc.TipoOperacion,
        docId: modal.doc.DocId,
        motivo: motivo.trim() || undefined,
      });
      // Si el cobro estaba imputado a facturas, esas facturas vuelven a deber: hay que
      // decirlo, no dejar que el usuario se entere cuando cobranzas las reclame.
      toast.success(data?.mensaje || 'Documento anulado correctamente',
        data?.deudasRepuestas ? { duration: 8000 } : undefined);
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


  // ── Piezas del render (tabla en escritorio, tarjetas en el celular) ─────────
  const chipsTipo = (doc) => {
    const isIngreso = doc.TipoOperacion === 'INGRESO';
    // Anulado viene como 0/1: con `&&` directo React pintaba el "0"
    const anulado = Number(doc.Anulado) === 1;
    return (
      <div className="flex flex-wrap gap-1 items-start">
        <span className={`${CHIP} ${isIngreso
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20'} ${anulado ? 'opacity-50' : ''}`}>
          {isIngreso ? <ArrowDownCircle size={11}/> : <ArrowUpCircle size={11}/>}
          {getTipoLabel(doc.TipoDoc || doc.CodTipoDoc)}
        </span>
        {anulado && (
          <span className={`${CHIP} bg-zinc-800 text-white border-zinc-800`}>
            <Ban size={10}/> Anulado
          </span>
        )}
        <span className={`${CHIP} ${Number(doc.EsCajaAdmin) === 1
          ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20'
          : 'bg-zinc-50 text-zinc-500 border-zinc-200'}`}>
          {Number(doc.EsCajaAdmin) === 1 ? 'Administrativa' : 'Central'}
        </span>
      </div>
    );
  };

  const total = (doc) => {
    const isIngreso = doc.TipoOperacion === 'INGRESO';
    const anulado = Number(doc.Anulado) === 1;
    return (
      <span className={`font-black text-sm tabular-nums whitespace-nowrap ${isIngreso ? 'text-emerald-700' : 'text-brand-magenta'} ${anulado ? 'line-through opacity-50' : ''}`}>
        {doc.Moneda === 'USD' ? 'US$' : '$'} {fmt(doc.Total)}
      </span>
    );
  };

  const acciones = (doc) => {
    const isIngreso = doc.TipoOperacion === 'INGRESO';
    const anulado = Number(doc.Anulado) === 1;
    return (
      <div className="flex items-center justify-center gap-1">
        <button onClick={() => handleImprimir(doc)} title="Ticket (impresora térmica)" aria-label="Ticket"
          className={`${btnAccion} hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5`}>
          <Printer size={14} />
        </button>
        {/* Recibo A4: mismo modelo que Caja y el Panel 360 (DocId = transacción de caja) */}
        {isIngreso && (
          <button onClick={() => handleReciboA4(doc)} disabled={imprimiendoA4 === doc.DocId} title="Recibo A4" aria-label="Recibo A4"
            className={`${btnAccion} hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5 disabled:opacity-50`}>
            {imprimiendoA4 === doc.DocId ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          </button>
        )}
        {!anulado && doc.CodTipoDoc !== 'ANTICIPO' && (
          <button onClick={() => abrirEditar(doc)} title="Editar monto" aria-label="Editar monto"
            className={`${btnAccion} hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5`}>
            <Pencil size={14} />
          </button>
        )}
        {!anulado && (
          <button onClick={() => abrirAnular(doc)} title="Anular documento" aria-label="Anular"
            className={`${btnAccion} hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`}>
            <Ban size={14} />
          </button>
        )}
      </div>
    );
  };

  const sinFilas = loading ? (
    <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
      <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando documentos...
    </span>
  ) : docs.length === 0 ? (
    <div className="flex flex-col items-center justify-center text-center">
      <SearchX size={40} className="mb-3 text-brand-cyan" />
      <span className="text-sm font-bold text-zinc-700">Sin documentos para el período seleccionado</span>
      <span className="text-xs text-zinc-400 mt-1">Probá con otras fechas, otro tipo u otra caja.</span>
    </div>
  ) : null;

  const paginacion = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-zinc-100">
      <span className="text-xs text-zinc-400 font-bold tabular-nums">
        Página {page} · {docs.length} registro{docs.length !== 1 ? 's' : ''}
      </span>
      <div className="flex gap-2">
        <button onClick={handlePrev} disabled={page === 1} className={`${BTN_SECUNDARIO} text-xs px-2.5 py-1.5 disabled:cursor-not-allowed`}>
          <ChevronLeft size={14}/> Anterior
        </button>
        <button onClick={handleNext} disabled={!hasMore} className={`${BTN_SECUNDARIO} text-xs px-2.5 py-1.5 disabled:cursor-not-allowed`}>
          Siguiente <ChevronRight size={14}/>
        </button>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">

        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <Receipt size={30} className="text-brand-cyan shrink-0" />
          <div className="min-w-[220px] flex-1">
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Bandeja de documentos internos</h1>
            <p className="text-sm text-zinc-500 mt-1">Recibos de cobro, egresos y comprobantes no-CFE</p>
          </div>
          <button onClick={() => fetchDocs(page, filtros)} disabled={loading} className={BTN_SECUNDARIO}>
            <RefreshCw size={15} className={`text-brand-cyan ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        {/* Tarjetas de resumen (sobre la página que se está viendo) */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2 px-1">Totales de esta página · los anulados no suman</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="Ingresos $" value={`$ ${fmt(totales.ingUYU)}`} ingreso />
            <SummaryCard label="Ingresos US$" value={`US$ ${fmt(totales.ingUSD)}`} ingreso />
            <SummaryCard label="Egresos $" value={`$ ${fmt(totales.egrUYU)}`} />
            <SummaryCard label="Egresos US$" value={`US$ ${fmt(totales.egrUSD)}`} />
          </div>
        </div>

        {/* Filtros */}
        <div className={`${CARD} p-4 grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-end`}>
          <div className="min-w-0 lg:w-40">
            <span className={ETIQUETA}>Desde</span>
            <SelectorFecha filtro className="w-full" value={filtros.desde} placeholder="Desde" aria-label="Fecha desde"
              onChange={e => setFiltros(f => ({...f, desde: e.target.value}))} />
          </div>
          <div className="min-w-0 lg:w-40">
            <span className={ETIQUETA}>Hasta</span>
            <SelectorFecha filtro className="w-full" value={filtros.hasta} placeholder="Hasta" aria-label="Fecha hasta"
              onChange={e => setFiltros(f => ({...f, hasta: e.target.value}))} />
          </div>
          <div className="min-w-0 lg:w-48">
            <span className={ETIQUETA}>Tipo</span>
            <Selector filtro className="w-full" value={filtros.tipo} aria-label="Tipo"
              onChange={e => setFiltros(f => ({...f, tipo: e.target.value}))}>
              <option value="TODOS">Todos</option>
              <option value="INGRESO">Ingresos / Recibos</option>
              <option value="EGRESO">Egresos / Gastos</option>
            </Selector>
          </div>
          <div className="min-w-0 lg:w-44">
            <span className={ETIQUETA}>Caja</span>
            <Selector filtro className="w-full" value={filtros.caja} aria-label="Caja"
              onChange={e => setFiltros(f => ({...f, caja: e.target.value}))}>
              <option value="TODOS">Todas</option>
              <option value="ADMIN">Administrativa</option>
              <option value="CENTRAL">Central</option>
            </Selector>
          </div>
          <div className="min-w-0 col-span-2 lg:col-span-1 lg:w-36">
            <span className={ETIQUETA}>Moneda</span>
            <Selector filtro className="w-full" value={filtros.moneda} aria-label="Moneda"
              onChange={e => setFiltros(f => ({...f, moneda: e.target.value}))}>
              <option value="TODOS">Todas</option>
              <option value="UYU">$ Pesos</option>
              <option value="USD">US$ Dólares</option>
            </Selector>
          </div>
          <div className="min-w-0 col-span-2 lg:flex-1 lg:min-w-[200px]">
            <span className={ETIQUETA}>Cliente / proveedor</span>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              <input type="text" value={filtros.cliente}
                placeholder="Buscar por nombre..."
                aria-label="Cliente o proveedor"
                onChange={e => setFiltros(f => ({...f, cliente: e.target.value}))}
                onKeyDown={e => e.key === 'Enter' && handleBuscar()}
                className={CAMPO} />
            </div>
          </div>
          <button onClick={handleBuscar} disabled={loading} className={`${BTN_PRINCIPAL} col-span-2 lg:col-span-1`}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Buscar
          </button>
        </div>

        {/* Tabla / tarjetas */}
        {!conTabla ? (
          <div className="flex flex-col gap-2.5">
            {sinFilas ? <div className={`${CARD} px-4 py-12 text-center`}>{sinFilas}</div> : docs.map((doc, i) => {
              const anulado = Number(doc.Anulado) === 1;
              return (
                <div key={`${doc.TipoOperacion}-${doc.DocId}-${i}`} className={`${CARD} p-3.5 flex flex-col gap-2.5 ${anulado ? 'bg-zinc-50' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-zinc-900 text-sm">{nroDoc(doc.Serie, doc.Numero)}</div>
                      <div className="text-sm font-bold text-zinc-800 mt-0.5">{doc.ClienteNombre || '—'}</div>
                      {doc.ClienteId != null && <div className="text-[10px] text-zinc-400 font-mono">ID #{doc.ClienteId}</div>}
                    </div>
                    <div className="text-right shrink-0">{total(doc)}</div>
                  </div>
                  {chipsTipo(doc)}
                  {doc.Observaciones && <div className="text-xs text-zinc-500 line-clamp-3">{doc.Observaciones}</div>}
                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-zinc-100">
                    <div className="min-w-0 text-[11px] text-zinc-500">
                      <span className={`tabular-nums font-semibold text-zinc-700 ${anulado ? 'line-through opacity-60' : ''}`}>{fmtDate(doc.Fecha)} {fmtHora(doc.Fecha)}</span>
                      <span> · {doc.MetodoPago || '—'} · {doc.Usuario || '—'}</span>
                    </div>
                    <div className="shrink-0">{acciones(doc)}</div>
                  </div>
                </div>
              );
            })}
            {!loading && docs.length > 0 && <div className={CARD}>{paginacion}</div>}
          </div>
        ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Tipo</th>
                  <th className={TH}>N° doc.</th>
                  <th className={TH}>Cliente / proveedor</th>
                  <th className={TH}>Concepto</th>
                  <th className={TH}>Medio de pago</th>
                  <th className={`${TH} text-right`}>Total</th>
                  {/* Fija a la derecha: las opciones se ven siempre, aunque la tabla scrollee */}
                  <th className={`${TH} text-center sticky right-0 bg-zinc-50 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]`}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sinFilas ? (
                  <tr><td colSpan={8} className="px-4 py-14 text-center">{sinFilas}</td></tr>
                ) : docs.map((doc, i) => {
                  // Anulado viene como 0/1: con `&&` directo React pintaba el "0"
                  const anulado = Number(doc.Anulado) === 1;
                  // Fondo sólido para la columna fija de acciones (si no, se transparenta al scrollear)
                  const fondoFila = anulado ? 'bg-zinc-50' : 'bg-white group-hover:bg-zinc-50';
                  return (
                    <tr key={`${doc.TipoOperacion}-${doc.DocId}-${i}`}
                      className={`transition-colors group ${anulado ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}>
                      {/* Fecha + usuario */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className={`font-semibold text-zinc-800 text-xs tabular-nums ${anulado ? 'line-through opacity-60' : ''}`}>{fmtDate(doc.Fecha)}</div>
                        <div className="text-[11px] text-zinc-400 tabular-nums">{fmtHora(doc.Fecha)}</div>
                        <div className="text-[11px] text-zinc-400 font-semibold max-w-[110px] truncate" title={doc.Usuario || ''}>{doc.Usuario || '—'}</div>
                      </td>
                      {/* Tipo */}
                      <td className="px-4 py-3">{chipsTipo(doc)}</td>
                      {/* Nro */}
                      <td className="px-4 py-3 whitespace-nowrap font-mono font-bold text-xs text-zinc-900">
                        {nroDoc(doc.Serie, doc.Numero)}
                      </td>
                      {/* Cliente */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-zinc-800 text-sm max-w-[180px] truncate" title={doc.ClienteNombre || ''}>{doc.ClienteNombre || '—'}</div>
                        {doc.ClienteId != null && (
                          <div className="text-[10px] text-zinc-400 font-mono mt-0.5">ID #{doc.ClienteId}</div>
                        )}
                      </td>
                      {/* Concepto (hasta 2 renglones; el texto completo en el tooltip) */}
                      <td className="px-4 py-3">
                        <div className="text-xs text-zinc-500 max-w-[240px] line-clamp-2" title={doc.Observaciones}>
                          {doc.Observaciones || '—'}
                        </div>
                      </td>
                      {/* Medio pago */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-zinc-600 font-semibold">{doc.MetodoPago || '—'}</span>
                      </td>
                      {/* Total */}
                      <td className="px-4 py-3 whitespace-nowrap text-right">{total(doc)}</td>
                      {/* Acciones (columna fija a la derecha) */}
                      <td className={`px-4 py-3 sticky right-0 transition-colors shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)] ${fondoFila}`}>
                        {acciones(doc)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {paginacion}
        </div>
        )}

      {/* Modal: Anular / Editar monto */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[6000]" onClick={cerrarModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 flex items-center justify-between border-b border-zinc-100">
              <div className="flex items-center gap-2">
                {modal.tipo === 'anular'
                  ? <Ban size={18} className="text-brand-magenta" />
                  : <Pencil size={18} className="text-brand-cyan" />}
                <h3 className="text-lg font-black text-zinc-900">{modal.tipo === 'anular' ? 'Anular documento' : 'Editar monto'}</h3>
              </div>
              <button onClick={cerrarModal} aria-label="Cerrar"
                className="text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Resumen del documento */}
              <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs space-y-1">
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-400 font-bold">Documento</span>
                  <span className="font-mono font-bold text-zinc-800">{nroDoc(modal.doc.Serie, modal.doc.Numero)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-400 font-bold">{modal.doc.TipoOperacion === 'INGRESO' ? 'Cliente' : 'Proveedor'}</span>
                  <span className="font-bold text-zinc-800 truncate max-w-[200px]">{modal.doc.ClienteNombre || '—'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-400 font-bold">Total actual</span>
                  <span className="font-black text-zinc-900 tabular-nums">{modal.doc.Moneda === 'USD' ? 'US$' : '$'} {fmt(modal.doc.Total)}</span>
                </div>
              </div>

              {modal.tipo === 'editar' && (
                <div>
                  <label htmlFor="nuevo-monto" className={ETIQUETA}>Nuevo monto</label>
                  <input id="nuevo-monto" type="number" step="0.01" min="0" value={nuevoMonto} autoFocus
                    onChange={e => setNuevoMonto(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 tabular-nums focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
                </div>
              )}

              <div>
                <label htmlFor="motivo-doc" className={ETIQUETA}>
                  Motivo {modal.tipo === 'editar' ? '(opcional)' : ''}
                </label>
                <textarea id="motivo-doc" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
                  placeholder="Motivo de la operación..."
                  className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 resize-none" />
              </div>

              {modal.tipo === 'editar' && (
                <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>Se anulará el documento actual y se generará uno nuevo con el monto corregido (nuevo N°).</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={cerrarModal} disabled={submitting} className={BTN_SECUNDARIO}>
                  Cancelar
                </button>
                <button onClick={modal.tipo === 'anular' ? confirmarAnular : confirmarEditar} disabled={submitting}
                  className={modal.tipo === 'anular'
                    ? 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-magenta text-white text-sm font-bold hover:bg-brand-magenta/90 transition-colors disabled:opacity-50'
                    : BTN_PRINCIPAL}>
                  {submitting ? <><Loader2 size={15} className="animate-spin" /> Procesando...</> : (modal.tipo === 'anular' ? 'Anular' : 'Guardar cambios')}
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
function SummaryCard({ label, value, ingreso = false }) {
  const Icono = ingreso ? TrendingUp : TrendingDown;
  return (
    <div className={`${CARD} px-4 py-3.5 flex flex-col gap-1.5 min-w-0`}>
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
        <Icono size={15} className={ingreso ? 'text-emerald-600' : 'text-brand-magenta'} /> {label}
      </div>
      <div className="text-lg font-black text-zinc-900 tabular-nums truncate">{value}</div>
    </div>
  );
}
