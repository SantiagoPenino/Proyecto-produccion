/**
 * ContabilidadColaEstadosView.jsx
 * Cola de estados de cuenta — revisión, previsualización y envío de emails.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Send, CheckCircle2, XCircle, Clock, AlertTriangle,
  Mail, ChevronDown, Filter, Eye, Zap, X, Printer, Trash2, Calendar
} from 'lucide-react';
import { toast } from 'sonner';

import { generarPdfEstadoCuenta } from '../../utils/pdfGenerator';

const API = import.meta.env.VITE_API_URL || '';
const tok = () => { try { return JSON.parse(localStorage.getItem('user'))?.token || ''; } catch { return ''; } };

const req = async (url, opts = {}) => {
  const r = await fetch(`${API}${url}`, {
    headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
  return json;
};

const fmtFecha = (f) =>
  f ? new Date(f).toLocaleString('es-UY', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Montevideo',
  }) : '—';

// ── Badge de estado ───────────────────────────────────────────────────────────
const BADGE = {
  PENDIENTE: { cls: 'bg-amber-100 text-amber-600 border-amber-200', icon: <Clock size={12} />, label: 'Pendiente' },
  APROBADO: { cls: 'bg-blue-100 text-blue-600 border-blue-200', icon: <CheckCircle2 size={12} />, label: 'Aprobado' },
  ENVIADO: { cls: 'bg-emerald-100 text-emerald-600 border-emerald-200', icon: <CheckCircle2 size={12} />, label: 'Enviado' },
  ERROR: { cls: 'bg-rose-100 text-rose-600 border-rose-200', icon: <XCircle size={12} />, label: 'Error' },
  RECHAZADO: { cls: 'bg-slate-200 text-slate-600 border-slate-300', icon: <XCircle size={12} />, label: 'Rechazado' },
};

const EstadoBadge = ({ estado }) => {
  const b = BADGE[estado] || BADGE.PENDIENTE;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-black uppercase tracking-wider ${b.cls}`}>
      {b.icon} {b.label}
    </span>
  );
};

// ── Modal de previsualización ─────────────────────────────────────────────────
const PreviewModal = ({ item, onClose }) => {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargar = async () => {
      try {
        const response = await fetch(`${API}/api/contabilidad/cola/${item.ColIdCola}/pdf`, {
          headers: { Authorization: `Bearer ${tok()}` }
        });
        if (!response.ok) throw new Error('Error al generar o cargar el PDF');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (e) { toast.error(e.message); onClose(); }
      finally { setLoading(false); }
    };
    cargar();
  }, [item.ColIdCola]);

  const descargarPDF = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `EstadoCuenta_${item.NombreCliente.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 ">
      {/* Barra superior */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 text-slate-800 shrink-0 shadow-xl z-10">
        <div>
          <p className="text-lg font-black text-indigo-900">{item.ColAsunto || 'Estado de Cuenta — Preview'}</p>
          <p className="text-sm font-mono text-slate-500 mt-1">{item.ColEmailDestino}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={descargarPDF} disabled={!pdfUrl}
            className="flex items-center gap-2 text-sm font-bold px-4 py-2 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 rounded-xl transition-colors shadow-lg disabled:opacity-50">
            <Printer size={16} className="text-emerald-600" /> Descargar PDF
          </button>
          <button onClick={onClose}
            className="flex items-center gap-2 text-sm font-bold px-4 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 rounded-xl transition-colors shadow-lg">
            <X size={16} /> Cerrar
          </button>
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-auto bg-[#f1f5f9] flex justify-center py-8 px-4 custom-scrollbar">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 text-slate-500 mt-20">
            <div className="animate-spin h-12 w-12 border-4 border-indigo-600 border-t-transparent rounded-full shadow-[0_0_15px_rgba(79,70,229,0.5)]" />
            <p className="text-sm font-bold tracking-widest uppercase text-indigo-600">Generando PDF del ERP...</p>
          </div>
        ) : (
          <div className="w-full max-w-4xl bg-white rounded-xl shadow-2xl overflow-hidden ring-1 ring-slate-200 h-full min-h-[850px]">
            {pdfUrl && (
              <iframe
                src={pdfUrl}
                title="Vista previa Estado de Cuenta PDF"
                className="w-full h-full border-0"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Fila de la cola ───────────────────────────────────────────────────────────
const FilaCola = ({ item, seleccionado, onToggle, onCambiarEstado, onEnviar, onPreview, onEliminar, loadingId }) => {
  const [expandido, setExpandido] = useState(false);
  const loading = loadingId === item.ColIdCola;

  return (
    <>
      <tr className={`border-b border-slate-200 transition-colors ${seleccionado ? 'bg-indigo-50' : 'hover:bg-slate-50'} ${item.ColEstado === 'ERROR' ? 'bg-rose-50' : ''}`}>
        <td className="px-5 py-4">
          <input type="checkbox" checked={seleccionado} onChange={() => onToggle(item.ColIdCola)}
            className="rounded border-slate-300 bg-white text-indigo-600 focus:ring-indigo-600 focus:ring-offset-white w-4 h-4 cursor-pointer" />
        </td>
        <td className="px-5 py-4">
          <p className="text-sm font-bold text-slate-800">{item.NombreCliente}</p>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{item.ColEmailDestino}</p>
        </td>
        <td className="px-5 py-4 text-xs font-medium text-slate-600">{fmtFecha(item.ColFechaGeneracion)}</td>
        <td className="px-5 py-4"><EstadoBadge estado={item.ColEstado} /></td>
        <td className="px-5 py-4 text-xs font-medium text-slate-500">
          {item.ColEstado === 'ENVIADO' && <span className="text-emerald-600 font-bold">{fmtFecha(item.ColFechaEnvio)}</span>}
          {item.ColEstado === 'ERROR' && (
            <span className="text-rose-600 flex items-center gap-1.5 font-bold">
              <AlertTriangle size={14} /> {item.ColErrorEnvio?.substring(0, 45) || 'Error general en envío'}...
            </span>
          )}
          {['PENDIENTE', 'APROBADO', 'RECHAZADO'].includes(item.ColEstado) && '—'}
        </td>
        <td className="px-5 py-4">
          <div className="flex items-center gap-2">
            {['PENDIENTE', 'RECHAZADO', 'ERROR'].includes(item.ColEstado) && (
              <button onClick={() => onCambiarEstado(item.ColIdCola, 'APROBADO')} title="Aprobar para envío"
                className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors border border-blue-200 shadow-sm">
                <CheckCircle2 size={16} />
              </button>
            )}
            {['PENDIENTE', 'APROBADO'].includes(item.ColEstado) && (
              <button onClick={() => onCambiarEstado(item.ColIdCola, 'RECHAZADO')} title="Rechazar y archivar"
                className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-colors border border-slate-200 shadow-sm">
                <XCircle size={16} />
              </button>
            )}
            {['APROBADO', 'ERROR', 'PENDIENTE'].includes(item.ColEstado) && (
              <button onClick={() => onEnviar(item.ColIdCola)} disabled={loading} title="Forzar envío individual ahora"
                className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors border border-emerald-200 shadow-sm disabled:opacity-50">
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            )}
            {/* Vista previa del documento */}
            <button onClick={() => onPreview(item)} title="Ver Preview PDF"
              className="p-2 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-200 shadow-sm">
              <Eye size={16} />
            </button>
            {/* Eliminar registro */}
            <button onClick={() => onEliminar(item.ColIdCola)} title="Eliminar registro"
              className="p-2 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors border border-rose-200 shadow-sm ml-2">
              <Trash2 size={16} />
            </button>
            {/* Expandir detalle técnico */}
            <button onClick={() => setExpandido(e => !e)} title="Ver info técnica extendida"
              className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors border border-slate-200 shadow-sm ml-2">
              <ChevronDown size={16} className={`transition-transform duration-300 ${expandido ? 'rotate-180 text-slate-900' : ''}`} />
            </button>
          </div>
        </td>
      </tr>
      {expandido && (
        <tr className="bg-slate-50/50 border-b border-slate-200 shadow-inner">
          <td colSpan={6} className="px-8 py-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Asunto Generado</span>
                <span className="text-indigo-800 font-semibold">{item.ColAsunto}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Período de Corte</span>
                <span className="text-slate-700 font-mono text-xs">{fmtFecha(item.ColFechaDesde)} → {fmtFecha(item.ColFechaHasta)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Tipo Disparo</span>
                <span className="text-slate-700"><span className="bg-slate-200 border border-slate-300 text-slate-700 px-2 py-0.5 rounded text-xs font-bold">{item.ColTipoDisparo}</span></span>
              </div>
              {item.ColErrorEnvio && (
                <div className="flex flex-col gap-1 col-span-2 lg:col-span-1 border-l-2 border-rose-500/30 pl-3">
                  <span className="text-[10px] font-black uppercase text-rose-500 tracking-wider">Traceback de Error</span>
                  <span className="text-rose-600 text-xs font-mono bg-rose-100/50 p-2 rounded">{item.ColErrorEnvio}</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

// ── Modal de Generación Manual ───────────────────────────────────────────────
const ManualGenerationModal = ({ onClose, onGenerar }) => {
  const [clientes, setClientes] = useState([]);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [seleccionados, setSeleccionados] = useState([]);
  const [todos, setTodos] = useState(true);

  useEffect(() => {
    req('/api/contabilidad/clientes-activos').then(res => setClientes(res.data || []));
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    onGenerar({ fechaDesde, fechaHasta, clientesIds: todos ? [] : seleccionados });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white p-8 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200">
        <h2 className="text-2xl font-black text-indigo-900 mb-6 flex items-center gap-3">
          <Calendar className="text-indigo-600" /> Generación Manual
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex gap-4">
            <label className="flex-1 text-sm font-bold text-slate-700">Desde:
              <input type="date" required={!todos} className="w-full mt-2 border border-slate-300 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
            </label>
            <label className="flex-1 text-sm font-bold text-slate-700">Hasta:
              <input type="date" required className="w-full mt-2 border border-slate-300 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-3 mt-2 bg-slate-50 p-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100">
            <input type="checkbox" className="w-5 h-5 text-indigo-600 rounded" checked={todos} onChange={e => setTodos(e.target.checked)} />
            <span className="font-bold text-slate-700">Generar para todos los clientes activos</span>
          </label>
          {!todos && (
            <label className="text-sm font-bold text-slate-700">Seleccionar Clientes <span className="text-xs text-slate-400 font-normal">(Ctrl+Click para múltiples)</span>:
              <select multiple className="w-full mt-2 border border-slate-300 rounded-xl p-3 h-48 focus:ring-2 focus:ring-indigo-500 custom-scrollbar" value={seleccionados} onChange={e => setSeleccionados([...e.target.selectedOptions].map(o => o.value))}>
                {clientes.map(c => <option key={c.CliIdCliente} value={c.CliIdCliente} className="p-2 border-b border-slate-100 last:border-0 hover:bg-indigo-50">{c.Nombre}</option>)}
              </select>
            </label>
          )}
          <div className="flex justify-end gap-3 mt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors">Cancelar</button>
            <button type="submit" className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2">
              <Zap size={18} /> Poner en Cola
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── VISTA PRINCIPAL ────────────────────────────────────────────────────────────
export default function ContabilidadColaEstadosView() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [page, setPage] = useState(1);
  const [previewItem, setPreviewItem] = useState(null);
  const [showManualModal, setShowManualModal] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (filtroEstado) params.append('estado', filtroEstado);
      const data = await req(`/api/contabilidad/cola?${params}`);
      setItems(data.data || []);
      setTotal(data.total || 0);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [filtroEstado, page]);

  useEffect(() => { cargar(); }, [cargar]);

  const toggleSeleccion = (id) => setSeleccionados(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleTodos = () => {
    if (seleccionados.size === items.length) setSeleccionados(new Set());
    else setSeleccionados(new Set(items.map(i => i.ColIdCola)));
  };

  const cambiarEstado = async (id, estado) => {
    try {
      await req(`/api/contabilidad/cola/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado }) });
      toast.success(`Marcado como ${estado}`);
      cargar();
    } catch (e) { toast.error(e.message); }
  };

  const enviarUno = async (id) => {
    setLoadingId(id);
    try {
      const result = await req(`/api/contabilidad/cola/${id}/enviar`, { method: 'POST' });
      toast.success(result.success ? '✉️ Despacho SMTP exitoso' : `Error: ${result.data?.error}`);
      cargar();
    } catch (e) { toast.error(e.message); }
    finally { setLoadingId(null); }
  };

  const enviarSeleccionados = async () => {
    if (!seleccionados.size) return toast.warning('Seleccioná al menos un registro en la grilla.');
    for (const id of seleccionados) {
      await req(`/api/contabilidad/cola/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: 'APROBADO' }) });
    }
    setLoadingBatch(true);
    try {
      const result = await req('/api/contabilidad/cola/enviar-aprobados', { method: 'POST', body: JSON.stringify({ ids: [...seleccionados] }) });
      toast.success(`✅ Despachados: ${result.data?.enviados ?? 0} | Rebotados: ${result.data?.errores ?? 0}`);
      setSeleccionados(new Set());
      cargar();
    } catch (e) { toast.error(e.message); }
    finally { setLoadingBatch(false); }
  };

  const ejecutarCron = async () => {
    setLoadingBatch(true);
    try {
      const r = await req('/api/contabilidad/cola/run-batch', { method: 'POST' });
      toast.success(r.message || 'Cron ejecutado correctamente');
      setTimeout(cargar, 3000);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingBatch(false); }
  };

  const handleGenerarManual = async (payload) => {
    setShowManualModal(false);
    setLoadingBatch(true);
    try {
      const r = await req('/api/contabilidad/cola/manual', { method: 'POST', body: JSON.stringify(payload) });
      toast.success(`Generación manual exitosa. Se encolaron ${r.generados} estados de cuenta.`);
      cargar();
    } catch (e) { toast.error(e.message); }
    finally { setLoadingBatch(false); }
  };

  const eliminarItemCola = async (id) => {
    if (!window.confirm('¿Seguro que deseas eliminar este registro de la cola? No se enviará.')) return;
    try {
      await req(`/api/contabilidad/cola/${id}`, { method: 'DELETE' });
      toast.success('Registro eliminado');
      cargar();
    } catch (e) { toast.error(e.message); }
  };

  const ESTADOS = ['', 'PENDIENTE', 'APROBADO', 'ENVIADO', 'ERROR', 'RECHAZADO'];
  const contadores = ESTADOS.slice(1).reduce((acc, e) => {
    acc[e] = items.filter(i => i.ColEstado === e).length;
    return acc;
  }, {});

  return (
    <>
      {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}

      <div className="h-full bg-[#f1f5f9] p-4 sm:p-8 overflow-y-auto text-slate-700 font-sans custom-scrollbar">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">

          {/* Encabezado */}
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-2">
            <div>
              <h1 className="text-3xl sm:text-4xl font-black text-slate-800 flex items-center gap-3">
                <Mail className="text-indigo-600" size={36} /> Cola de Mailing Contable
              </h1>
              <p className="text-slate-500 text-sm mt-2 max-w-2xl">
                Auditoría, validación y disparo de notificaciones automáticas de Estado de Cuenta a deudores.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowManualModal(true)} disabled={loadingBatch}
                className="flex items-center gap-2 px-5 py-2.5 text-sm border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl transition-all shadow-sm font-bold">
                <Calendar size={16} /> Generación Manual
              </button>
              <button onClick={ejecutarCron} disabled={loadingBatch}
                className="flex items-center gap-2 px-5 py-2.5 text-sm border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-xl transition-all shadow-md disabled:opacity-50 font-bold">
                <Zap size={16} className={loadingBatch ? 'animate-pulse text-yellow-500' : 'text-yellow-500'} />
                Forzar CRON Total
              </button>
              <button onClick={cargar} disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refrescar Spool
              </button>
            </div>
          </div>

          {/* KPIs Visuales Re-estilizados */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'En Cola (Pendiente)', key: 'PENDIENTE', color: 'amber' },
              { label: 'Listos (Aprobados)', key: 'APROBADO', color: 'blue' },
              { label: 'Despachados OK', key: 'ENVIADO', color: 'emerald' },
              { label: 'Fallos Críticos', key: 'ERROR', color: 'rose' },
              { label: 'Archivados', key: 'RECHAZADO', color: 'slate' },
            ].map(k => (
              <button key={k.key}
                onClick={() => { setFiltroEstado(filtroEstado === k.key ? '' : k.key); setPage(1); }}
                className={`flex flex-col justify-between text-left px-5 py-4 rounded-2xl border transition-all ${filtroEstado === k.key
                    ? `bg-white border-${k.color}-500 shadow-md`
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}>
                <p className={`text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2`}>{k.label}</p>
                <div className="flex items-baseline gap-2">
                  <p className={`text-3xl font-black text-${k.color}-600 drop-shadow-sm`}>{contadores[k.key] || 0}</p>
                  <span className="text-xs text-slate-500 font-bold">/ {total}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Bulk action bar */}
          <div className={`transition-all duration-300 ease-in-out ${seleccionados.size > 0 ? 'opacity-100 max-h-20 scale-100' : 'opacity-0 max-h-0 scale-95 overflow-hidden'}`}>
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-6 py-4 flex items-center justify-between shadow-sm backdrop-blur-sm">
              <span className="text-sm text-indigo-800 font-bold flex items-center gap-3">
                <span className="bg-indigo-600 text-white px-3 py-1 rounded-lg shadow-sm text-xs">{seleccionados.size}</span>
                registros marcados para acción masiva
              </span>
              <div className="flex items-center gap-4">
                <button onClick={() => setSeleccionados(new Set())}
                  className="text-xs px-4 py-2 font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors">
                  Anular Selección
                </button>
                <button onClick={enviarSeleccionados} disabled={loadingBatch}
                  className="flex items-center gap-2 text-sm px-6 py-2.5 bg-indigo-600 text-white rounded-xl border border-indigo-500 hover:bg-indigo-500 focus:ring-4 focus:ring-indigo-500/30 transition-all font-black shadow-md disabled:opacity-50">
                  {loadingBatch ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                  Disparar Emails Masivamente
                </button>
              </div>
            </div>
          </div>

          {/* Tabla principal */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-md overflow-hidden flex flex-col mt-2">
            {/* Barra de Filtros Internos */}
            <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row items-center gap-4 bg-slate-50/80">
              <div className="flex items-center gap-3 text-slate-500 font-bold text-xs uppercase tracking-widest mr-2">
                <Filter size={16} className="text-indigo-500" />
                Filtrar Vista
              </div>
              <div className="flex gap-2 flex-wrap flex-1">
                {ESTADOS.map(e => (
                  <button key={e || 'todos'}
                    onClick={() => { setFiltroEstado(e); setPage(1); }}
                    className={`text-xs px-4 py-1.5 rounded-full border transition-all font-bold ${filtroEstado === e
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-[0_0_10px_rgba(79,70,229,0.4)]'
                        : 'text-slate-600 bg-white border-slate-300 hover:border-slate-400 hover:text-slate-900'
                      }`}>
                    {e || 'Mostrar Todos'}
                  </button>
                ))}
              </div>
              <span className="text-xs font-mono font-bold tracking-wider text-slate-500 bg-slate-100 px-4 py-1.5 rounded-lg border border-slate-200 shadow-inner">
                {total} LÍNEAS
              </span>
            </div>

            {loading ? (
              <div className="flex justify-center py-32 bg-white flex-1">
                <div className="animate-spin h-12 w-12 border-4 border-indigo-600 border-t-transparent rounded-full shadow-lg" />
              </div>
            ) : (
              <div className="overflow-x-auto custom-scrollbar flex-1 bg-slate-50/50">
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-slate-100/80 sticky top-0 z-10 backdrop-blur-md shadow-sm">
                    <tr className="text-[10px] text-slate-500 uppercase tracking-widest font-black">
                      <th className="px-6 py-4 w-12 border-b border-slate-200">
                        <input type="checkbox"
                          checked={items.length > 0 && seleccionados.size === items.length}
                          onChange={toggleTodos}
                          className="rounded border-slate-300 bg-white text-indigo-600 focus:ring-indigo-600 focus:ring-offset-white w-4 h-4 cursor-pointer" />
                      </th>
                      <th className="px-5 py-4 border-b border-slate-200">Identidad del Cliente</th>
                      <th className="px-5 py-4 border-b border-slate-200">Corte Generado</th>
                      <th className="px-5 py-4 border-b border-slate-200 text-center">Status</th>
                      <th className="px-5 py-4 border-b border-slate-200">Bitácora / Log</th>
                      <th className="px-5 py-4 border-b border-slate-200 text-center">Operaciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {items.map(item => (
                      <FilaCola
                        key={item.ColIdCola}
                        item={item}
                        seleccionado={seleccionados.has(item.ColIdCola)}
                        onToggle={toggleSeleccion}
                        onCambiarEstado={cambiarEstado}
                        onEnviar={enviarUno}
                        onPreview={setPreviewItem}
                        onEliminar={eliminarItemCola}
                        loadingId={loadingId}
                      />
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-24 text-slate-500">
                          <Mail size={48} className="mx-auto mb-4 text-slate-400" />
                          <p className="text-lg font-bold text-slate-600">La cola de spool está vacía</p>
                          <p className="text-sm mt-2 text-slate-500">El proceso CRON de consolidación despierta todos los domingos o manualmente usando el Rayo Amarillo.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {total > 50 && (
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="text-xs px-5 py-2 font-bold bg-white border border-slate-300 text-slate-700 rounded-xl disabled:opacity-30 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                  ← Bloque Anterior
                </button>
                <div className="flex gap-2">
                  <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-100 border border-indigo-200 px-3 py-1 rounded shadow-inner">PÁGINA {page}</span>
                  <span className="text-xs font-mono font-bold text-slate-500 bg-slate-200 border border-slate-300 px-3 py-1 rounded shadow-inner">DE {Math.ceil(total / 50)}</span>
                </div>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)}
                  className="text-xs px-5 py-2 font-bold bg-white border border-slate-300 text-slate-700 rounded-xl disabled:opacity-30 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                  Próximo Bloque →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showManualModal && <ManualGenerationModal onClose={() => setShowManualModal(false)} onGenerar={handleGenerarManual} />}
    </>
  );
}
