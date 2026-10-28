import React, { useState, useEffect } from 'react';
import { Landmark, ArrowDownRight, ArrowUpRight, Search, Plus, Send, XCircle, CheckCircle2, ChevronRight, Clock, AlertTriangle, Loader2,
  Eye, SquarePen, Forward, Ban, BadgeCheck, Trash2, CircleHelp, X } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import ChequeRecibirModal from './tesoreria/ChequeRecibirModal';
import ChequeEmitirModal from './tesoreria/ChequeEmitirModal';
import ChequeDetalleModal from './tesoreria/ChequeDetalleModal';
// Las fechas del cheque son columnas DATE: formatearlas con toLocaleDateString las
// retrocedía un día (ver src/utils/fechas.js).
import { fmtFecha, porFechaDesc, toInputDate } from '../../utils/fechas';

// Acciones sobre un cheque: lo que dice su tooltip (titulo + desc) y el detalle de la ayuda
// ("?"). Una sola fuente para que los dos textos no se contradigan. Los asientos son las
// reglas de Cont_ReglasAsiento de cada evento (tesoreriaController.cambiarEstadoCheque).
const AYUDA_ACCIONES = {
  editar: {
    icon: SquarePen, tono: 'slate', titulo: 'Ver / editar',
    desc: 'Abre el detalle del cheque para completar el cliente, el librador, la agencia o las notas. No cambia el importe ni el estado.',
    cuando: 'Cheques en cartera (de terceros) o emitidos (propios).',
    estado: 'No cambia.',
    asiento: 'Ninguno. Ojo: asignarle acá el cliente no le aplica el cheque a su cuenta corriente.',
  },
  ver: {
    icon: Eye, tono: 'slate', titulo: 'Ver',
    desc: 'Abre el detalle del cheque. Ya salió de la cartera, así que no se puede editar.',
    cuando: 'Cheques depositados, endosados, rechazados, cobrados o anulados.',
    estado: 'No cambia.',
    asiento: 'Ninguno.',
  },
  depositar: {
    icon: Landmark, tono: 'blue', titulo: 'Depositar',
    desc: 'Lo llevaste al banco. Pasa a Depositado y se genera el asiento: entra a Bancos y sale de Valores a depositar.',
    cuando: 'Cheques de terceros en cartera.',
    estado: 'En cartera → Depositado. Si después el banco lo rebota, se puede marcar como rechazado.',
    asiento: 'Debe 1.1.3 Bancos Moneda Nacional / Haber 1.1.5 Valores a Depositar (Cheques).',
  },
  endosar: {
    icon: Forward, tono: 'indigo', titulo: 'Endosar',
    desc: 'Se lo diste a un proveedor como pago. Pasa a Endosado y se genera el asiento: baja la deuda con Proveedores y sale de Valores a depositar.',
    cuando: 'Cheques de terceros en cartera.',
    estado: 'En cartera → Endosado.',
    asiento: 'Debe 2.1.1 Acreedores por Compras (Proveedores) / Haber 1.1.5 Valores a Depositar (Cheques).',
  },
  rechazar: {
    icon: Ban, tono: 'red', titulo: 'Rechazar',
    desc: 'El banco lo rebotó. Pasa a Rechazado y sale de la cartera.',
    cuando: 'Cheques de terceros en cartera.',
    estado: 'En cartera → Rechazado (estado final).',
    asiento: 'Se registra solo si está cargada la regla contable TES_CHEQUE_REB (Debe Deudores por Ventas: el cliente vuelve a deber / Haber 1.1.5 Valores a Depositar). Si no, cambia el estado sin asiento.',
  },
  cobrado: {
    icon: BadgeCheck, tono: 'emerald', titulo: 'Cobrado',
    desc: 'El banco ya debitó este cheque que emitiste. Pasa a Cobrado.',
    cuando: 'Cheques propios emitidos.',
    estado: 'Emitido → Cobrado (estado final).',
    asiento: 'Se registra solo si está cargada la regla contable TES_CHEQUE_COB (Debe 2.1.3 Cheques Diferidos a Pagar / Haber 1.1.3 Bancos Moneda Nacional). Si no, cambia el estado sin asiento.',
  },
  anular: {
    icon: Trash2, tono: 'anular', titulo: 'Anular',
    desc: 'Para un cheque cargado por error. Lo da de baja (queda Anulado) y revierte su asiento. Si se usó en un cobro, primero hay que anular el cobro.',
    cuando: 'Cheques en cartera o emitidos. Pide el motivo.',
    estado: '→ Anulado. No se borra: queda en el historial.',
    asiento: 'Revierte el asiento con que se dio de alta el cheque.',
  },
};

// Campo de fecha por el que se filtra
const CAMPOS_FECHA = [
  { id: 'VTO', label: 'Vencimiento', get: c => c.FechaVencimiento },
  { id: 'EMI', label: 'Emisión',     get: c => c.FechaEmision },
  { id: 'ING', label: 'Ingreso',     get: c => c.FechaRegistro },
];

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
  const [showAyuda, setShowAyuda] = useState(false);   // "?" de la columna Acciones

  // Filtros (sobre la lista ya cargada: la cartera son pocos cheques)
  const [fBanco, setFBanco] = useState('');
  const [fTexto, setFTexto] = useState('');            // cliente, librador, Nº de cheque o documento que pagó
  const [fCampoFecha, setFCampoFecha] = useState('VTO');
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const hayFiltros = !!(fBanco || fTexto.trim() || fDesde || fHasta);
  const limpiarFiltros = () => { setFBanco(''); setFTexto(''); setFDesde(''); setFHasta(''); };

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
  const getChequesDelTab = () =>
      tab === 'CARTERA' ? cheques.filter(c => c.Tipo === 'TERCERO' && c.Estado === 'EN_CARTERA')
      : tab === 'PROPIOS' ? cheques.filter(c => c.Tipo === 'PROPIO' && c.Estado === 'EMITIDO')
      : cheques;

  const getFilteredCheques = () => {
    let base = getChequesDelTab();
    if (fBanco) base = base.filter(c => String(c.IdBanco) === String(fBanco));
    const t = fTexto.trim().toLowerCase();
    if (t) base = base.filter(c => [c.ClienteNombre, c.ClienteCodigo, c.EmitidoPor, c.NumeroCheque,
      c.DocsPagados, c.DocsVenta, c.Retiros, c.Recibos].some(v => String(v || '').toLowerCase().includes(t)));
    if (fDesde || fHasta) {
      const campo = CAMPOS_FECHA.find(x => x.id === fCampoFecha) || CAMPOS_FECHA[0];
      base = base.filter(c => {
        const f = toInputDate(campo.get(c));
        if (!f) return false;
        return (!fDesde || f >= fDesde) && (!fHasta || f <= fHasta);
      });
    }
    return [...base].sort(porFechaDesc(c => c.FechaVencimiento));
  };

  // Bancos que aparecen en los cheques del tab (incluye bancos dados de baja con cheques vivos)
  const bancosDelTab = Object.values(getChequesDelTab().reduce((acc, c) => {
    acc[c.IdBanco] = { IdBanco: c.IdBanco, NombreBanco: c.NombreBanco };
    return acc;
  }, {})).sort((a, b) => String(a.NombreBanco || '').localeCompare(String(b.NombreBanco || '')));

  // Total de lo que se está viendo, por moneda
  const totalesVista = getFilteredCheques().reduce((acc, c) => {
    const k = Number(c.IdMoneda) === 2 ? 2 : 1;
    acc[k] = (acc[k] || 0) + Number(c.Monto || 0);
    return acc;
  }, {});

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
        {/* FILTROS */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[170px]">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Banco</label>
            <select value={fBanco} onChange={e => setFBanco(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm outline-none focus:border-indigo-500">
              <option value="">Todos</option>
              {bancosDelTab.map(b => <option key={b.IdBanco} value={b.IdBanco}>{b.NombreBanco}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente / librador / Nº / documento</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={fTexto} onChange={e => setFTexto(e.target.value)}
                placeholder="Ej. SABONIS, ENI SA, 494790, FA-2158…"
                className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fecha de</label>
            <select value={fCampoFecha} onChange={e => setFCampoFecha(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm outline-none focus:border-indigo-500">
              {CAMPOS_FECHA.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Desde</label>
            <input type="date" value={fDesde} onChange={e => setFDesde(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-indigo-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hasta</label>
            <input type="date" value={fHasta} onChange={e => setFHasta(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-indigo-500" />
          </div>
          {hayFiltros && (
            <button onClick={limpiarFiltros} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100">
              <XCircle size={14} /> Limpiar
            </button>
          )}
          <div className="ml-auto text-right text-sm">
            <div className="font-bold text-slate-700">{getFilteredCheques().length} cheque{getFilteredCheques().length === 1 ? '' : 's'}</div>
            <div className="text-slate-500 font-semibold">
              {[totalesVista[1] ? formatCurrency(totalesVista[1], 1) : null, totalesVista[2] ? formatCurrency(totalesVista[2], 2) : null].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-sm font-bold text-slate-500 uppercase tracking-wider">
                <th className="p-4 pl-6">Nº Cheque / Banco</th>
                <th className="p-4">Cliente · Qué paga</th>
                <th className="p-4">Importe</th>
                <th className="p-4">Fechas</th>
                <th className="p-4">Estado</th>
                <th className="p-4 text-right pr-6">
                  <span className="inline-flex items-center gap-1.5">
                    Acciones
                    <button type="button" onClick={() => setShowAyuda(true)} aria-label="¿Qué hace cada acción?" title="¿Qué hace cada acción?"
                      className="text-slate-400 hover:text-indigo-600 transition-colors">
                      <CircleHelp size={17} />
                    </button>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400">Cargando...</td></tr>
              ) : getFilteredCheques().length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400 font-medium">{hayFiltros ? 'Ningún cheque cumple los filtros' : 'No hay cheques en esta vista'}</td></tr>
              ) : (
                getFilteredCheques().map(cheque => {
                  const paga = [cheque.DocsPagados, cheque.DocsVenta, cheque.Retiros].filter(Boolean).join(' · ');
                  return (
                  <tr key={cheque.IdCheque} className="hover:bg-slate-50 transition-colors group">
                    <td className="p-4 pl-6">
                      <div className="font-bold text-slate-800 text-base">{cheque.NumeroCheque}</div>
                      <div className="text-sm text-slate-500">{cheque.NombreBanco}</div>
                      {cheque.EmitidoPor && (
                        <div className="text-xs text-slate-400 mt-0.5" title="Quién firmó el cheque">Librador: {cheque.EmitidoPor}</div>
                      )}
                    </td>
                    {/* Quién lo entregó y qué pagó (del cobro donde se usó el cheque) */}
                    <td className="p-4 max-w-[340px]">
                      {cheque.Tipo === 'PROPIO' ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <>
                          {cheque.ClienteNombre ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-800 text-sm">{cheque.ClienteNombre}</span>
                              {cheque.ClienteCodigo && (
                                <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">{cheque.ClienteCodigo}</span>
                              )}
                              {!!cheque.ClienteDelCobro && (
                                <span className="text-[10px] font-semibold text-amber-600" title="No se cargó al recibir el cheque: sale del cobro donde se usó. Se puede completar en Ver / Editar.">(del cobro)</span>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-slate-400">Sin cliente <span className="text-xs">· completar en Ver / Editar</span></div>
                          )}
                          {cheque.CobroPagId ? (
                            <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                              {paga && <div><span className="text-slate-400">Paga:</span> <span className="font-semibold">{paga}</span></div>}
                              <div className="text-slate-500">
                                {cheque.Recibos ? `Recibo ${cheque.Recibos}` : 'Cobro sin recibo'}
                                {cheque.CobroFecha ? ` · ${fmtFecha(cheque.CobroFecha)}` : ''}
                                {Number(cheque.ChequesDelCobro) > 1 && (
                                  <span className="font-bold text-indigo-600"> · {cheque.OrdenEnCobro} de {cheque.ChequesDelCobro} cheques del cobro</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 mt-1">Sin cobro asociado</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="font-black text-slate-800 text-lg">{formatCurrency(cheque.Monto, cheque.IdMoneda)}</div>
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
                        <div className="flex justify-end items-center gap-1.5">
                          {/* Ver / editar: disponible siempre. Sirve para completar el cliente
                              que lo depositó, el librador, etc. sin anular y recargar. */}
                          {cheque.Estado === 'EN_CARTERA' || cheque.Estado === 'EMITIDO'
                            ? <IconBtn a={AYUDA_ACCIONES.editar} onClick={() => setDetalle(cheque)} />
                            : <IconBtn a={AYUDA_ACCIONES.ver} onClick={() => setDetalle(cheque)} />}
                          {cheque.Estado === 'EN_CARTERA' && (
                            <>
                              <IconBtn a={AYUDA_ACCIONES.depositar} onClick={() => cambiarEstado(cheque, 'DEPOSITADO', 'Depositado')} />
                              <IconBtn a={AYUDA_ACCIONES.endosar} onClick={() => cambiarEstado(cheque, 'ENDOSADO', 'Endosado')} />
                              <IconBtn a={AYUDA_ACCIONES.rechazar} onClick={() => cambiarEstado(cheque, 'RECHAZADO', 'Rechazado')} />
                            </>
                          )}
                          {cheque.Estado === 'EMITIDO' && (
                            <IconBtn a={AYUDA_ACCIONES.cobrado} onClick={() => cambiarEstado(cheque, 'COBRADO', 'Cobrado')} />
                          )}
                          {/* Anular: para el cheque cargado por error. Revierte el asiento. Solo en su
                              estado inicial: depositado, endosado o cobrado ya existió afuera.
                              Separado del resto: es la acción que no se deshace con un clic. */}
                          {(cheque.Estado === 'EN_CARTERA' || cheque.Estado === 'EMITIDO') && (
                            <>
                              <span className="w-px h-6 bg-slate-200 mx-1" aria-hidden="true" />
                              <IconBtn a={AYUDA_ACCIONES.anular} onClick={() => { setAAnular(cheque); setMotivoAnular(''); }} />
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })
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

      {/* Ayuda: qué hace cada acción */}
      {showAyuda && <AyudaAccionesModal onClose={() => setShowAyuda(false)} />}

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
                  {aAnular.NombreBanco} · {formatCurrency(aAnular.Monto, aAnular.IdMoneda)} · vto {fmtFecha(aAnular.FechaVencimiento)}
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

// Botón de acción con ícono y tooltip propio: el nombre de la acción y qué hace.
// (El title nativo tarda en aparecer y no admite dos renglones.)
const TONOS_ICONBTN = {
  slate:   'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900',
  blue:    'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100 hover:text-blue-800',
  indigo:  'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100 hover:text-indigo-800',
  red:     'bg-red-50 text-red-600 border-red-100 hover:bg-red-100 hover:text-red-800',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100 hover:text-emerald-800',
  anular:  'bg-white text-slate-400 border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200',
};
const IconBtn = ({ a: { icon: Icon, tono = 'slate', titulo, desc }, onClick }) => (
  // Grupo CON NOMBRE (group/accion): la fila de la tabla también es "group" y, con un
  // group-hover común, pasar el mouse por la fila abría los tooltips de TODOS los botones.
  <span className="relative inline-flex group/accion">
    <button type="button" onClick={onClick} aria-label={desc ? `${titulo}: ${desc}` : titulo}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border transition-colors ${TONOS_ICONBTN[tono] || TONOS_ICONBTN.slate}`}>
      <Icon size={17} strokeWidth={2.2} />
    </button>
    {/* Tooltip: arriba del botón y alineado a la derecha (la columna está pegada al borde) */}
    <span role="tooltip"
      className="pointer-events-none absolute bottom-full right-0 mb-2 w-64 z-30 rounded-lg bg-slate-900 px-3 py-2 text-left shadow-lg
                 opacity-0 translate-y-1 transition duration-150 group-hover/accion:opacity-100 group-hover/accion:translate-y-0
                 group-focus-within/accion:opacity-100 group-focus-within/accion:translate-y-0">
      <span className="block text-xs font-black text-white">{titulo}</span>
      {desc && <span className="block mt-0.5 text-[11px] leading-snug font-medium text-slate-300">{desc}</span>}
    </span>
  </span>
);

// Ventana de ayuda: el detalle de cada acción (mismos textos que los tooltips)
const AyudaAccionesModal = ({ onClose }) => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
          <CircleHelp size={20} className="text-indigo-600" /> ¿Qué hace cada acción?
        </h3>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100">
          <X size={18} />
        </button>
      </div>
      <div className="overflow-auto px-6 py-4 space-y-4">
        {Object.values(AYUDA_ACCIONES).map(a => {
          const Icon = a.icon;
          return (
            <div key={a.titulo} className="flex gap-3">
              <span className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border ${TONOS_ICONBTN[a.tono] || TONOS_ICONBTN.slate}`}>
                <Icon size={17} strokeWidth={2.2} />
              </span>
              <div className="text-sm">
                <div className="font-black text-slate-800">{a.titulo}</div>
                <div className="text-slate-600 mt-0.5">{a.desc}</div>
                <dl className="mt-1.5 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-xs">
                  <dt className="font-bold text-slate-400">Cuándo</dt><dd className="text-slate-600">{a.cuando}</dd>
                  <dt className="font-bold text-slate-400">Estado</dt><dd className="text-slate-600">{a.estado}</dd>
                  <dt className="font-bold text-slate-400">Asiento</dt><dd className="text-slate-600">{a.asiento}</dd>
                </dl>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-800 text-white font-semibold hover:bg-slate-900">Entendido</button>
      </div>
    </div>
  </div>
);

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
