import React, { useState, useEffect } from 'react';
import { Landmark, ArrowDownRight, ArrowUpRight, AlertTriangle, Loader2, SearchX, Search, XCircle,
  Eye, SquarePen, Forward, Ban, BadgeCheck, Trash2, CircleHelp, X } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import ChequeRecibirModal from './tesoreria/ChequeRecibirModal';
import ChequeEmitirModal from './tesoreria/ChequeEmitirModal';
import ChequeDetalleModal from './tesoreria/ChequeDetalleModal';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
// Las fechas del cheque son columnas DATE: formatearlas con toLocaleDateString las
// retrocedía un día (ver src/utils/fechas.js).
import { fmtFecha, porFechaDesc, toInputDate } from '../../utils/fechas';

// Estética nueva (27/10/2026): encabezado, pestañas en pastillas (Selector en el celular), tabla clara (en el
// celular, una tarjeta por cheque), estados con color de estado y acciones parejas. La lógica no cambió.
// 28/10: con lo de Yoania (filtros, columna «Cliente · Qué paga», acciones con ícono y tooltip, ayuda de las
// acciones) en las mismas piezas: Selector / SelectorFecha en vez de los del navegador, colores con significado
// y la ventana de ayuda por encima de la barra de arriba.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5';

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
  const [showAyuda, setShowAyuda] = useState(false);   // "?" de la columna Acciones
  const conTabla = useConTabla();

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

  const librador = (cheque) => cheque.EmitidoPor && (
    <div className="text-[11px] text-zinc-400 mt-0.5" title="Quién firmó el cheque">Librador: {cheque.EmitidoPor}</div>
  );

  // Quién lo entregó y qué pagó (del cobro donde se usó el cheque)
  const clienteCobro = (cheque) => {
    const paga = [cheque.DocsPagados, cheque.DocsVenta, cheque.Retiros].filter(Boolean).join(' · ');
    if (cheque.Tipo === 'PROPIO') return <span className="text-zinc-300">—</span>;
    return (
      <>
        {cheque.ClienteNombre ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-zinc-800 text-sm">{cheque.ClienteNombre}</span>
            {cheque.ClienteCodigo && (
              <span className="text-[10px] font-bold text-brand-cyan bg-brand-cyan/5 border border-brand-cyan/20 px-1.5 py-0.5 rounded-md">{cheque.ClienteCodigo}</span>
            )}
            {!!cheque.ClienteDelCobro && (
              <span className="text-[10px] font-bold text-amber-700" title="No se cargó al recibir el cheque: sale del cobro donde se usó. Se puede completar en Ver / Editar.">(del cobro)</span>
            )}
          </div>
        ) : (
          <div className="text-sm text-zinc-400">Sin cliente <span className="text-xs">· completar en Ver / Editar</span></div>
        )}
        {cheque.CobroPagId ? (
          <div className="text-xs text-zinc-600 mt-1 space-y-0.5">
            {paga && <div><span className="text-zinc-400">Paga:</span> <span className="font-semibold">{paga}</span></div>}
            <div className="text-zinc-500">
              {cheque.Recibos ? `Recibo ${cheque.Recibos}` : 'Cobro sin recibo'}
              {cheque.CobroFecha ? ` · ${fmtFecha(cheque.CobroFecha)}` : ''}
              {Number(cheque.ChequesDelCobro) > 1 && (
                <span className="font-bold text-brand-cyan"> · {cheque.OrdenEnCobro} de {cheque.ChequesDelCobro} cheques del cobro</span>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-zinc-400 mt-1">Sin cobro asociado</div>
        )}
      </>
    );
  };

  // Los botones no dependen del hover: se ven siempre, si no la columna parece vacía y nadie sabe que hay acciones.
  const acciones = (cheque, alinear = 'justify-end') => accionando === cheque.IdCheque ? (
    <span className="inline-flex items-center gap-2 text-zinc-400 font-bold text-xs">
      <Loader2 size={15} className="animate-spin text-brand-cyan" /> Procesando…
    </span>
  ) : (
    <div className={`flex flex-wrap ${alinear} items-center gap-1.5`}>
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
          <span className="w-px h-6 bg-zinc-200 mx-1" aria-hidden="true" />
          <IconBtn a={AYUDA_ACCIONES.anular} onClick={() => { setAAnular(cheque); setMotivoAnular(''); }} />
        </>
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
      <span className="text-sm font-bold text-zinc-700">{hayFiltros ? 'Ningún cheque cumple los filtros' : 'No hay cheques en esta vista'}</span>
    </div>
  ) : null;

  const botonAyuda = (
    <button type="button" onClick={() => setShowAyuda(true)} aria-label="¿Qué hace cada acción?" title="¿Qué hace cada acción?"
      className="text-zinc-400 hover:text-brand-cyan transition-colors">
      <CircleHelp size={16} />
    </button>
  );

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

      {/* FILTROS */}
      <div className={`${CARD} p-4 grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-end`}>
        <div className="col-span-2 sm:col-span-1 min-w-0 lg:w-48">
          <span className={ETIQUETA}>Banco</span>
          <Selector filtro className="w-full" value={fBanco} onChange={e => setFBanco(e.target.value)} aria-label="Banco">
            <option value="">Todos</option>
            {bancosDelTab.map(b => <option key={b.IdBanco} value={b.IdBanco}>{b.NombreBanco}</option>)}
          </Selector>
        </div>
        <div className="col-span-2 lg:flex-1 min-w-0 lg:min-w-[240px]">
          <span className={ETIQUETA}>Cliente / librador / Nº / documento</span>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input type="text" value={fTexto} onChange={e => setFTexto(e.target.value)} aria-label="Cliente, librador, número o documento"
              placeholder="Ej. SABONIS, ENI SA, 494790, FA-2158…" className={CAMPO} />
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 min-w-0 lg:w-40">
          <span className={ETIQUETA}>Fecha de</span>
          <Selector filtro resaltar={false} className="w-full" value={fCampoFecha} onChange={e => setFCampoFecha(e.target.value)} aria-label="Fecha de">
            {CAMPOS_FECHA.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Selector>
        </div>
        <div className="min-w-0 lg:w-40">
          <span className={ETIQUETA}>Desde</span>
          <SelectorFecha filtro vaciable className="w-full" value={fDesde} onChange={e => setFDesde(e.target.value)} placeholder="Desde" aria-label="Desde" />
        </div>
        <div className="min-w-0 lg:w-40">
          <span className={ETIQUETA}>Hasta</span>
          <SelectorFecha filtro vaciable className="w-full" value={fHasta} onChange={e => setFHasta(e.target.value)} placeholder="Hasta" aria-label="Hasta" />
        </div>
        <div className="col-span-2 flex items-end justify-between gap-3 lg:ml-auto">
          {hayFiltros && (
            <button onClick={limpiarFiltros} className={BTN_SECUNDARIO}>
              <XCircle size={15} className="text-brand-magenta" /> Limpiar
            </button>
          )}
          <div className="ml-auto text-right text-sm">
            <div className="font-bold text-zinc-700 tabular-nums">{lista.length} cheque{lista.length === 1 ? '' : 's'}</div>
            <div className="text-zinc-500 font-semibold tabular-nums">
              {[totalesVista[1] ? formatCurrency(totalesVista[1], 1) : null, totalesVista[2] ? formatCurrency(totalesVista[2], 2) : null].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      {!conTabla ? (
        <div className="flex flex-col gap-2.5">
          {!sinFilas && (
            <button type="button" onClick={() => setShowAyuda(true)} className="self-end inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-brand-cyan">
              <CircleHelp size={14} /> ¿Qué hace cada acción?
            </button>
          )}
          {sinFilas ? <div className={`${CARD} px-4 py-12 text-center`}>{sinFilas}</div> : lista.map(cheque => (
            <div key={cheque.IdCheque} className={`${CARD} p-3.5 flex flex-col gap-2.5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono font-bold text-zinc-900">{cheque.NumeroCheque}</div>
                  <div className="text-xs text-zinc-500">{cheque.NombreBanco}</div>
                  {librador(cheque)}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-black text-zinc-900 tabular-nums whitespace-nowrap">{formatCurrency(cheque.Monto, cheque.IdMoneda)}</div>
                  <div className="mt-1">{estado(cheque)}</div>
                </div>
              </div>
              {cheque.Tipo !== 'PROPIO' && <div className="pt-2.5 border-t border-zinc-100">{clienteCobro(cheque)}</div>}
              <div className="text-xs text-zinc-500 tabular-nums">
                Emitido {fmtFecha(cheque.FechaEmision)} · <span className="font-bold text-zinc-800">vence {fmtFecha(cheque.FechaVencimiento)}</span>
              </div>
              <div className="pt-2.5 border-t border-zinc-100">{acciones(cheque, 'justify-start')}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={CARD}>
          <table className="w-full text-left border-collapse">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className={`${TH} rounded-tl-2xl`}>Nº cheque / Banco</th>
                <th className={TH}>Cliente · Qué paga</th>
                <th className={TH}>Importe</th>
                <th className={TH}>Fechas</th>
                <th className={TH}>Estado</th>
                <th className={`${TH} text-right rounded-tr-2xl`}>
                  <span className="inline-flex items-center gap-1.5">Acciones {botonAyuda}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {sinFilas ? (
                <tr><td colSpan="6" className="px-4 py-14 text-center">{sinFilas}</td></tr>
              ) : (
                lista.map(cheque => (
                  <tr key={cheque.IdCheque} className="hover:bg-zinc-50 transition-colors align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-zinc-900">{cheque.NumeroCheque}</div>
                      <div className="text-xs text-zinc-500">{cheque.NombreBanco}</div>
                      {librador(cheque)}
                    </td>
                    <td className="px-4 py-3 max-w-[340px]">{clienteCobro(cheque)}</td>
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

      {/* Ayuda: qué hace cada acción */}
      {showAyuda && <AyudaAccionesModal onClose={() => setShowAyuda(false)} />}

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

// Botón de acción con ícono y tooltip propio: el nombre de la acción y qué hace.
// (El title nativo tarda en aparecer y no admite dos renglones.) Colores con significado: depositar y endosar en
// cian, rechazar en magenta, cobrado en verde; anular gris que pasa a magenta.
const TONOS_ICONBTN = {
  slate:   'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900',
  blue:    'bg-white text-brand-cyan border-brand-cyan/30 hover:bg-brand-cyan/5',
  indigo:  'bg-white text-brand-cyan border-brand-cyan/30 hover:bg-brand-cyan/5',
  red:     'bg-white text-brand-magenta border-brand-magenta/30 hover:bg-brand-magenta/5',
  emerald: 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  anular:  'bg-white text-zinc-400 border-zinc-200 hover:bg-brand-magenta/5 hover:text-brand-magenta hover:border-brand-magenta/30',
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
      className="pointer-events-none absolute bottom-full right-0 mb-2 w-64 z-30 rounded-xl bg-zinc-900 px-3 py-2 text-left shadow-lg
                 opacity-0 translate-y-1 transition duration-150 group-hover/accion:opacity-100 group-hover/accion:translate-y-0
                 group-focus-within/accion:opacity-100 group-focus-within/accion:translate-y-0">
      <span className="block text-xs font-black text-white">{titulo}</span>
      {desc && <span className="block mt-0.5 text-[11px] leading-snug font-medium text-zinc-300">{desc}</span>}
    </span>
  </span>
);

// Ventana de ayuda: el detalle de cada acción (mismos textos que los tooltips)
const AyudaAccionesModal = ({ onClose }) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[6000] p-4" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100">
        <h3 className="text-lg font-black text-zinc-900 flex items-center gap-2">
          <CircleHelp size={20} className="text-brand-cyan" /> ¿Qué hace cada acción?
        </h3>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-xl hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700 transition-colors shrink-0">
          <X size={18} />
        </button>
      </div>
      <div className="overflow-auto px-5 py-4 space-y-4">
        {Object.values(AYUDA_ACCIONES).map(a => {
          const Icon = a.icon;
          return (
            <div key={a.titulo} className="flex gap-3">
              <span className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border ${TONOS_ICONBTN[a.tono] || TONOS_ICONBTN.slate}`}>
                <Icon size={17} strokeWidth={2.2} />
              </span>
              <div className="text-sm min-w-0">
                <div className="font-black text-zinc-900">{a.titulo}</div>
                <div className="text-zinc-600 mt-0.5">{a.desc}</div>
                <dl className="mt-1.5 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-xs">
                  <dt className="font-bold text-zinc-400">Cuándo</dt><dd className="text-zinc-600">{a.cuando}</dd>
                  <dt className="font-bold text-zinc-400">Estado</dt><dd className="text-zinc-600">{a.estado}</dd>
                  <dt className="font-bold text-zinc-400">Asiento</dt><dd className="text-zinc-600">{a.asiento}</dd>
                </dl>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-5 py-3 border-t border-zinc-100 flex justify-end">
        <button type="button" onClick={onClose} className={BTN_PRINCIPAL}>Entendido</button>
      </div>
    </div>
  </div>
);
