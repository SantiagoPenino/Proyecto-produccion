import React, { useState, useEffect } from 'react';
import { Landmark, ArrowDownRight, ArrowUpRight, AlertTriangle, Loader2, SearchX } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import ChequeRecibirModal from './tesoreria/ChequeRecibirModal';
import ChequeEmitirModal from './tesoreria/ChequeEmitirModal';
import ChequeDetalleModal from './tesoreria/ChequeDetalleModal';
import Selector from '../ui/Selector';
// Las fechas del cheque son columnas DATE: formatearlas con toLocaleDateString las
// retrocedía un día (ver src/utils/fechas.js).
import { fmtFecha, porFechaDesc } from '../../utils/fechas';

// Estética nueva (27/10/2026): encabezado, pestañas en pastillas (Selector en el celular), tabla clara (en el
// celular, una tarjeta por cheque), estados con color de estado y acciones parejas. La lógica no cambió.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
// Botón de acción de la fila: gris, se pone cian al pasar (magenta en los que dan de baja o rechazan)
const ACCION = 'px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 transition-colors whitespace-nowrap';
const ACCION_CIAN = `${ACCION} hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5`;
const ACCION_PELIGRO = `${ACCION} hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`;

// En el celular, tarjetas en vez de la tabla (una vista sola: no se dibujan las dos ocultando una)
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
  const conTabla = useConTabla();

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
      const res = await api.delete(`/tesoreria/cheques/${aAnular.IdCheque}`, { data: { Motivo: motivoAnular } });
      // El backend dice si revirtió el asiento o no (ej: cheque entrado por caja, sin asiento propio).
      if (res.data?.asientoRevertido === false) toast.warning(res.data.message, { duration: 10000 });
      else toast.success(res.data?.message || `Cheque N° ${aAnular.NumeroCheque} anulado`);
      setAAnular(null); setMotivoAnular('');
      fetchData();
    } catch (error) {
      // Si está vinculado a un cobro, el backend lo frena: hay que anular el cobro primero.
      toast.error(error.response?.data?.mensaje || error.response?.data?.error || 'No se pudo anular el cheque');
    } finally {
      setAccionando(null);
    }
  };

  // El importe se muestra en la moneda del cheque (IdMoneda: 1 = $, 2 = US$). Antes se
  // formateaba siempre como pesos y un cheque en dólares se leía como si fuera en $.
  const formatCurrency = (val, idMoneda = 1) =>
    new Intl.NumberFormat('es-UY', { style: 'currency', currency: Number(idMoneda) === 2 ? 'USD' : 'UYU' }).format(val);

  // Color de estado: en cartera verde, depositado cian, emitido (falta el débito) ámbar, rechazado magenta;
  // endosado, cobrado y anulado en gris (ya salieron de la cartera).
  const getStateColor = (estado) => {
    const colors = {
      'EN_CARTERA': 'bg-emerald-50 text-emerald-700 border-emerald-200',
      'DEPOSITADO': 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20',
      'ENDOSADO': 'bg-zinc-50 text-zinc-600 border-zinc-200',
      'EMITIDO': 'bg-amber-50 text-amber-700 border-amber-200',
      'RECHAZADO': 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20',
      'COBRADO': 'bg-zinc-50 text-zinc-600 border-zinc-200',
      'ANULADO': 'bg-zinc-50 text-zinc-400 border-zinc-200 line-through',
    };
    return colors[estado] || 'bg-zinc-50 text-zinc-600 border-zinc-200';
  };

  const TABS = [
    { id: 'CARTERA', label: 'Cartera (terceros)', count: cheques.filter(c => c.Tipo === 'TERCERO' && c.Estado === 'EN_CARTERA').length },
    { id: 'PROPIOS', label: 'Cheques emitidos', count: cheques.filter(c => c.Tipo === 'PROPIO' && c.Estado === 'EMITIDO').length },
    { id: 'HISTORIAL', label: 'Historial completo' },
  ];
  const lista = getFilteredCheques();

  const estado = (cheque) => (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wide whitespace-nowrap ${getStateColor(cheque.Estado)}`}>
      {cheque.Estado.replace('_', ' ')}
    </span>
  );

  // Los botones no dependen del hover: se ven siempre, si no la columna parece vacía y nadie sabe que hay acciones.
  const acciones = (cheque) => accionando === cheque.IdCheque ? (
    <span className="inline-flex items-center gap-2 text-zinc-400 font-bold text-xs">
      <Loader2 size={15} className="animate-spin text-brand-cyan" /> Procesando…
    </span>
  ) : (
    <div className="flex flex-wrap justify-end gap-1.5">
      {/* Ver / editar: disponible siempre. Sirve para completar el cliente
          que lo depositó, el librador, etc. sin anular y recargar. */}
      <button onClick={() => setDetalle(cheque)} className={ACCION_CIAN} title="Ver y editar los datos del cheque">
        {cheque.Estado === 'EN_CARTERA' || cheque.Estado === 'EMITIDO' ? 'Ver / Editar' : 'Ver'}
      </button>
      {cheque.Estado === 'EN_CARTERA' && (
        <>
          <button onClick={() => cambiarEstado(cheque, 'DEPOSITADO', 'Depositado')} className={ACCION_CIAN} title="Lo llevaste al banco">
            Depositar
          </button>
          <button onClick={() => cambiarEstado(cheque, 'ENDOSADO', 'Endosado')} className={ACCION_CIAN} title="Se lo pasaste a un proveedor">
            Endosar
          </button>
          <button onClick={() => cambiarEstado(cheque, 'RECHAZADO', 'Rechazado')} className={ACCION_PELIGRO} title="El banco lo rebotó">
            Rechazar
          </button>
        </>
      )}
      {cheque.Estado === 'EMITIDO' && (
        <button onClick={() => cambiarEstado(cheque, 'COBRADO', 'Cobrado')} className={ACCION_CIAN} title="El banco te lo debitó">
          Cobrado (Débito)
        </button>
      )}
      {/* Anular: para el cheque cargado por error. Revierte el asiento. Solo en su
          estado inicial: depositado, endosado o cobrado ya existió afuera. */}
      {(cheque.Estado === 'EN_CARTERA' || cheque.Estado === 'EMITIDO') && (
        <button onClick={() => { setAAnular(cheque); setMotivoAnular(''); }} className={ACCION_PELIGRO}
          title="Cargado por error: lo da de baja y revierte el asiento">
          Anular
        </button>
      )}
    </div>
  );

  const sinFilas = loading ? (
    <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
      <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando cheques...
    </span>
  ) : lista.length === 0 ? (
    <div className="flex flex-col items-center justify-center text-center">
      <SearchX size={40} className="mb-3 text-brand-cyan" />
      <span className="text-sm font-bold text-zinc-700">No hay cheques en esta vista</span>
    </div>
  ) : null;

  return (
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
      {/* HEADER */}
      <div className="flex flex-wrap items-center gap-3">
        <Landmark size={30} className="text-brand-cyan shrink-0" />
        <div className="min-w-[220px] flex-1">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Tesorería y cartera</h1>
          <p className="text-sm text-zinc-500 mt-1">Gestión de cheques propios y de terceros</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          <button onClick={() => setShowRecibirModal(true)} className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}>
            <ArrowDownRight size={16} /> Recibir cheque
          </button>
          <button onClick={() => setShowEmitirModal(true)} className={`${BTN_SECUNDARIO} flex-1 sm:flex-none`}>
            <ArrowUpRight size={16} className="text-brand-magenta" /> Emitir cheque
          </button>
        </div>
      </div>

      {/* TABS: pastillas en escritorio, Selector en el celular */}
      <div className="hidden md:inline-flex self-start rounded-xl border border-zinc-200 bg-white p-1 gap-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${tab === t.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
            {t.label}
            {t.count !== undefined && (
              <span className={`min-w-[22px] px-1.5 py-0.5 rounded-full text-[11px] font-black tabular-nums ${tab === t.id ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>
      <div className="md:hidden">
        <Selector className="w-full" value={tab} onChange={e => setTab(e.target.value)} aria-label="Vista">
          {TABS.map(t => <option key={t.id} value={t.id}>{t.label}{t.count !== undefined ? ` (${t.count})` : ''}</option>)}
        </Selector>
      </div>

      {/* CONTENT */}
      {!conTabla ? (
        <div className="flex flex-col gap-2.5">
          {sinFilas ? <div className={`${CARD} px-4 py-12 text-center`}>{sinFilas}</div> : lista.map(cheque => (
            <div key={cheque.IdCheque} className={`${CARD} p-3.5 flex flex-col gap-2.5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono font-bold text-zinc-900">{cheque.NumeroCheque}</div>
                  <div className="text-xs text-zinc-500">{cheque.NombreBanco}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-black text-zinc-900 tabular-nums whitespace-nowrap">{formatCurrency(cheque.Monto, cheque.IdMoneda)}</div>
                  <div className="mt-1">{estado(cheque)}</div>
                </div>
              </div>
              <div className="text-xs text-zinc-500 tabular-nums">
                Emitido {fmtFecha(cheque.FechaEmision)} · <span className="font-bold text-zinc-800">vence {fmtFecha(cheque.FechaVencimiento)}</span>
              </div>
              <div className="pt-2.5 border-t border-zinc-100">{acciones(cheque)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className={TH}>Nº cheque / Banco</th>
                  <th className={TH}>Importe</th>
                  <th className={TH}>Fechas</th>
                  <th className={TH}>Estado</th>
                  <th className={`${TH} text-right`}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sinFilas ? (
                  <tr><td colSpan="5" className="px-4 py-14 text-center">{sinFilas}</td></tr>
                ) : (
                  lista.map(cheque => (
                    <tr key={cheque.IdCheque} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-zinc-900">{cheque.NumeroCheque}</div>
                        <div className="text-xs text-zinc-500">{cheque.NombreBanco}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-black text-zinc-900 tabular-nums">{formatCurrency(cheque.Monto, cheque.IdMoneda)}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                        <div className="text-xs text-zinc-500 flex items-center gap-1">
                          <span className="text-zinc-400 w-8">Emi:</span> {fmtFecha(cheque.FechaEmision)}
                        </div>
                        <div className="text-xs font-bold text-zinc-800 flex items-center gap-1">
                          <span className="text-zinc-400 w-8 font-medium">Vto:</span> {fmtFecha(cheque.FechaVencimiento)}
                        </div>
                      </td>
                      <td className="px-4 py-3">{estado(cheque)}</td>
                      <td className="px-4 py-3 text-right">{acciones(cheque)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
        <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={22} className="text-brand-magenta shrink-0 mt-0.5" />
              <div>
                <h3 className="font-black text-zinc-900 text-lg leading-tight">Anular cheque N° {aAnular.NumeroCheque}</h3>
                <p className="text-sm text-zinc-500 mt-0.5 tabular-nums">
                  {aAnular.NombreBanco} · {formatCurrency(aAnular.Monto, aAnular.IdMoneda)} · vto {fmtFecha(aAnular.FechaVencimiento)}
                </p>
              </div>
            </div>

            <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-xs text-zinc-600 leading-relaxed">
              El cheque sale de la cartera y <strong>se revierte su asiento contable</strong> (se genera la
              contrapartida; el asiento original no se borra). La fila queda como <strong>ANULADO</strong> en
              el historial, no se elimina. Si el cheque está vinculado a un cobro, primero hay que anular ese cobro.
            </div>

            <div>
              <label htmlFor="motivo-anular-cheque" className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">Motivo</label>
              <input
                id="motivo-anular-cheque"
                autoFocus
                value={motivoAnular}
                onChange={e => setMotivoAnular(e.target.value)}
                placeholder="Ej: cargado dos veces por error"
                className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => { setAAnular(null); setMotivoAnular(''); }} className={BTN_SECUNDARIO}>
                Cancelar
              </button>
              <button
                onClick={anularCheque}
                disabled={!motivoAnular.trim() || accionando === aAnular.IdCheque}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-magenta text-white text-sm font-bold hover:bg-brand-magenta/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {accionando === aAnular.IdCheque ? <><Loader2 size={15} className="animate-spin" /> Anulando…</> : 'Anular y revertir asiento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
