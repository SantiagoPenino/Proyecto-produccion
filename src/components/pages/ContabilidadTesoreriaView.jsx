import React, { useState, useEffect } from 'react';
import { Landmark, ArrowDownRight, ArrowUpRight, Search, Plus, Send, XCircle, CheckCircle2, ChevronRight, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import ChequeRecibirModal from './tesoreria/ChequeRecibirModal';
import ChequeEmitirModal from './tesoreria/ChequeEmitirModal';
import ChequeDetalleModal from './tesoreria/ChequeDetalleModal';
// Las fechas del cheque son columnas DATE: formatearlas con toLocaleDateString las
// retrocedía un día (ver src/utils/fechas.js).
import { fmtFecha, porFechaDesc } from '../../utils/fechas';

export default function ContabilidadTesoreriaView() {
  const [bancos, setBancos] = useState([]);
  const [cheques, setCheques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('CARTERA'); // CARTERA, PROPIOS, HISTORIAL

  const [showRecibirModal, setShowRecibirModal] = useState(false);
  const [showEmitirModal, setShowEmitirModal] = useState(false);
  const [accionando, setAccionando] = useState(null);  // IdCheque en curso
  const [aAnular, setAAnular] = useState(null);        // cheque en el diálogo de anulación
  const [motivoAnular, setMotivoAnular] = useState('');
  const [detalle, setDetalle] = useState(null);        // cheque abierto en el modal de detalle/edición

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [resBancos, resCheques] = await Promise.all([
        api.get('/tesoreria/bancos'),
        api.get('/tesoreria/cheques')
      ]);
      setBancos(resBancos.data.data);
      setCheques(resCheques.data.data);
    } catch (error) {
      toast.error('Error cargando datos de Tesorería');
    } finally {
      setLoading(false);
    }
  };

  // Los anulados no son cartera ni cheques vivos: solo se ven en el historial.
  const getFilteredCheques = () => {
    const base =
      tab === 'CARTERA' ? cheques.filter(c => c.Tipo === 'TERCERO' && c.Estado === 'EN_CARTERA')
      : tab === 'PROPIOS' ? cheques.filter(c => c.Tipo === 'PROPIO' && c.Estado === 'EMITIDO')
      : cheques;
    return [...base].sort(porFechaDesc(c => c.FechaVencimiento));
  };

  // ─── Acciones ────────────────────────────────────────────────────────────
  // El endpoint PATCH existía desde siempre; los botones nunca lo llamaban.
  const cambiarEstado = async (cheque, Estado, etiqueta) => {
    setAccionando(cheque.IdCheque);
    try {
      await api.patch(`/tesoreria/cheques/${cheque.IdCheque}/estado`, { Estado });
      toast.success(`Cheque N° ${cheque.NumeroCheque} → ${etiqueta}`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.error || `No se pudo marcar como ${etiqueta}`);
    } finally {
      setAccionando(null);
    }
  };

  const anularCheque = async () => {
    if (!aAnular) return;
    setAccionando(aAnular.IdCheque);
    try {
      await api.delete(`/tesoreria/cheques/${aAnular.IdCheque}`, { data: { Motivo: motivoAnular } });
      toast.success(`Cheque N° ${aAnular.NumeroCheque} anulado — asiento revertido`);
      setAAnular(null); setMotivoAnular('');
      fetchData();
    } catch (error) {
      // Si está vinculado a un cobro, el backend lo frena: hay que anular el cobro primero.
      toast.error(error.response?.data?.mensaje || error.response?.data?.error || 'No se pudo anular el cheque');
    } finally {
      setAccionando(null);
    }
  };

  const formatCurrency = (val) => new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU' }).format(val);

  const getStateColor = (estado) => {
    const colors = {
      'EN_CARTERA': 'bg-emerald-100 text-emerald-800 border-emerald-200',
      'DEPOSITADO': 'bg-blue-100 text-blue-800 border-blue-200',
      'ENDOSADO': 'bg-indigo-100 text-indigo-800 border-indigo-200',
      'EMITIDO': 'bg-amber-100 text-amber-800 border-amber-200',
      'RECHAZADO': 'bg-red-100 text-red-800 border-red-200',
      'COBRADO': 'bg-slate-100 text-slate-800 border-slate-200',
      'ANULADO': 'bg-slate-100 text-slate-400 border-slate-200 line-through',
    };
    return colors[estado] || 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] overflow-hidden">
      {/* HEADER */}
      <div className="bg-white border-b border-slate-200 px-8 py-6 shrink-0 z-10 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
            <div className="bg-indigo-100 text-indigo-600 p-2 rounded-xl">
              <Landmark size={28} />
            </div>
            Tesorería & Cartera
          </h1>
          <p className="text-slate-500 font-medium mt-1">Gestión de cheques propios y de terceros</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowRecibirModal(true)}
            className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-100 transition-colors border border-emerald-200">
            <ArrowDownRight size={20} /> Recibir Cheque
          </button>
          <button 
            onClick={() => setShowEmitirModal(true)}
            className="flex items-center gap-2 bg-amber-50 text-amber-700 px-5 py-2.5 rounded-xl font-bold hover:bg-amber-100 transition-colors border border-amber-200">
            <ArrowUpRight size={20} /> Emitir Cheque
          </button>
        </div>
      </div>

      {/* TABS */}
      <div className="px-8 pt-6">
        <div className="flex gap-4 border-b border-slate-200">
          <TabButton active={tab === 'CARTERA'} onClick={() => setTab('CARTERA')} label="Cartera (Terceros)" count={cheques.filter(c => c.Tipo === 'TERCERO' && c.Estado === 'EN_CARTERA').length} />
          <TabButton active={tab === 'PROPIOS'} onClick={() => setTab('PROPIOS')} label="Cheques Emitidos" count={cheques.filter(c => c.Tipo === 'PROPIO' && c.Estado === 'EMITIDO').length} />
          <TabButton active={tab === 'HISTORIAL'} onClick={() => setTab('HISTORIAL')} label="Historial Completo" />
        </div>
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-auto p-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-500 uppercase tracking-wider">
                <th className="p-4 pl-6">Nº Cheque / Banco</th>
                <th className="p-4">Importe</th>
                <th className="p-4">Fechas</th>
                <th className="p-4">Estado</th>
                <th className="p-4 text-right pr-6">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan="5" className="p-8 text-center text-slate-400">Cargando...</td></tr>
              ) : getFilteredCheques().length === 0 ? (
                <tr><td colSpan="5" className="p-8 text-center text-slate-400 font-medium">No hay cheques en esta vista</td></tr>
              ) : (
                getFilteredCheques().map(cheque => (
                  <tr key={cheque.IdCheque} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-4 pl-6">
                      <div className="font-bold text-slate-800 text-base">{cheque.NumeroCheque}</div>
                      <div className="text-sm text-slate-500">{cheque.NombreBanco}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-black text-slate-800 text-lg">{formatCurrency(cheque.Monto)}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-medium text-slate-700 flex items-center gap-1">
                        <span className="text-slate-400 w-8">Emi:</span> {fmtFecha(cheque.FechaEmision)}
                      </div>
                      <div className="text-sm font-bold text-indigo-700 flex items-center gap-1">
                        <span className="text-slate-400 w-8 font-medium">Vto:</span> {fmtFecha(cheque.FechaVencimiento)}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-black border uppercase tracking-wider ${getStateColor(cheque.Estado)}`}>
                        {cheque.Estado.replace('_', ' ')}
                      </span>
                    </td>
                    {/* Los botones ya no dependen del hover: se ven siempre, si no la
                        columna parece vacía y nadie sabe que hay acciones. */}
                    <td className="p-4 text-right pr-6">
                      {accionando === cheque.IdCheque ? (
                        <span className="inline-flex items-center gap-2 text-slate-400 font-bold text-sm">
                          <Loader2 size={16} className="animate-spin" /> Procesando…
                        </span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          {/* Ver / editar: disponible siempre. Sirve para completar el cliente
                              que lo depositó, el librador, etc. sin anular y recargar. */}
                          <button onClick={() => setDetalle(cheque)}
                            className="bg-slate-100 text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-200 font-bold text-sm" title="Ver y editar los datos del cheque">
                            {cheque.Estado === 'EN_CARTERA' || cheque.Estado === 'EMITIDO' ? 'Ver / Editar' : 'Ver'}
                          </button>
                          {cheque.Estado === 'EN_CARTERA' && (
                            <>
                              <button onClick={() => cambiarEstado(cheque, 'DEPOSITADO', 'Depositado')}
                                className="bg-blue-50 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-100 font-bold text-sm" title="Lo llevaste al banco">
                                Depositar
                              </button>
                              <button onClick={() => cambiarEstado(cheque, 'ENDOSADO', 'Endosado')}
                                className="bg-indigo-50 text-indigo-700 px-3 py-2 rounded-lg hover:bg-indigo-100 font-bold text-sm" title="Se lo pasaste a un proveedor">
                                Endosar
                              </button>
                              <button onClick={() => cambiarEstado(cheque, 'RECHAZADO', 'Rechazado')}
                                className="bg-red-50 text-red-700 px-3 py-2 rounded-lg hover:bg-red-100 font-bold text-sm" title="El banco lo rebotó">
                                Rechazar
                              </button>
                            </>
                          )}
                          {cheque.Estado === 'EMITIDO' && (
                            <button onClick={() => cambiarEstado(cheque, 'COBRADO', 'Cobrado')}
                              className="bg-emerald-50 text-emerald-700 px-3 py-2 rounded-lg hover:bg-emerald-100 font-bold text-sm" title="El banco te lo debitó">
                              Cobrado (Débito)
                            </button>
                          )}
                          {/* Anular: para el cheque cargado por error. Revierte el asiento. */}
                          {cheque.Estado !== 'ANULADO' && (
                            <button onClick={() => { setAAnular(cheque); setMotivoAnular(''); }}
                              className="bg-slate-50 text-slate-500 border border-slate-200 px-3 py-2 rounded-lg hover:bg-red-50 hover:text-red-700 hover:border-red-200 font-bold text-sm"
                              title="Cargado por error: lo da de baja y revierte el asiento">
                              Anular
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {showRecibirModal && (
        <ChequeRecibirModal 
          onClose={() => setShowRecibirModal(false)} 
          onSuccess={() => {
            setShowRecibirModal(false);
            fetchData();
          }} 
        />
      )}
      {showEmitirModal && (
        <ChequeEmitirModal
          onClose={() => setShowEmitirModal(false)}
          onSuccess={() => {
            setShowEmitirModal(false);
            fetchData();
          }}
        />
      )}

      {/* Ver / editar detalle del cheque */}
      {detalle && (
        <ChequeDetalleModal
          cheque={detalle}
          onClose={() => setDetalle(null)}
          onSaved={() => { setDetalle(null); fetchData(); }}
        />
      )}

      {/* Anular cheque — pide motivo y explica qué se revierte */}
      {aAnular && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle size={22} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-lg leading-tight">Anular cheque N° {aAnular.NumeroCheque}</h3>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  {aAnular.NombreBanco} · {formatCurrency(aAnular.Monto)} · vto {fmtFecha(aAnular.FechaVencimiento)}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-600 font-medium leading-relaxed">
              El cheque sale de la cartera y <strong>se revierte su asiento contable</strong> (se genera la
              contrapartida; el asiento original no se borra). La fila queda como <strong>ANULADO</strong> en
              el historial, no se elimina. Si el cheque está vinculado a un cobro, primero hay que anular ese cobro.
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Motivo</label>
              <input
                autoFocus
                value={motivoAnular}
                onChange={e => setMotivoAnular(e.target.value)}
                placeholder="Ej: cargado dos veces por error"
                className="w-full mt-1 bg-white border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setAAnular(null); setMotivoAnular(''); }}
                className="flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-white border-2 border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={anularCheque}
                disabled={!motivoAnular.trim() || accionando === aAnular.IdCheque}
                className="flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {accionando === aAnular.IdCheque ? 'Anulando…' : 'Anular y revertir asiento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TabButton = ({ active, onClick, label, count }) => (
  <button
    onClick={onClick}
    className={`pb-4 px-2 font-bold text-base transition-colors relative ${
      active ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
    }`}
  >
    {label}
    {count !== undefined && (
      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
        {count}
      </span>
    )}
    {active && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full" />}
  </button>
);
