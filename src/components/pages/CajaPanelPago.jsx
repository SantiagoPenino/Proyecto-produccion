import React, { useMemo, useState, useEffect } from 'react';
import { Plus, X, CheckCircle, Loader2, FileText, Landmark, CreditCard, DollarSign, ChevronDown, Check, Building2, ShoppingBag, Receipt } from 'lucide-react';
import ChequeRecibirModal from './tesoreria/ChequeRecibirModal';
import { Listbox } from '@headlessui/react';
import api from '../../services/apiClient';

// Select ligero construido con Headless UI
function LightSelect({ value, onChange, options = [], placeholder = 'Seleccionar...' }) {
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative font-sans">
        <Listbox.Button className="w-full flex items-center justify-between gap-2 bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-black text-zinc-800 font-archivo outline-none hover:border-zinc-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/10 transition-all shadow-sm">
          <span className="truncate">{selected ? selected.label : <span className="text-zinc-400">{placeholder}</span>}</span>
          <ChevronDown size={13} className="text-zinc-400 shrink-0" />
        </Listbox.Button>
        <Listbox.Options className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-xl shadow-xl overflow-auto max-h-52 outline-none font-archivo">
          {options.map(opt => (
            <Listbox.Option
              key={opt.value}
              value={opt.value}
              className={({ active }) =>
                `flex items-center justify-between px-3 py-2 text-xs font-black cursor-pointer transition-colors ${
                  active ? 'bg-zinc-50 text-zinc-900' : 'text-zinc-700'
                }`
              }
            >
              {({ selected: sel }) => (
                <>
                  <span>{opt.label}</span>
                  {sel && <Check size={12} className="text-brand-cyan shrink-0" />}
                </>
              )}
            </Listbox.Option>
          ))}
        </Listbox.Options>
      </div>
    </Listbox>
  );
}

const fmt = (n) =>
  Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CajaPanelPago({
  mode = 'COBRO',
  totalACubrir = 0,
  moneda = 'UYU',
  onMonedaChange,
  cotizacion = 1,
  metodosPago = [],
  pagos = [],
  onPagosChange,
  tipoDoc,
  onTipoDoc,
  serieDoc,
  onSerieDoc,
  numDoc,
  notes = '', // fallback
  notas = '',
  onNotas,
  onConfirmar,
  procesando = false,
  labelBoton,
  disabledExtra = false,
  tiposDocDisponibles = [],
  containerClassName = "w-[400px] shrink-0 border-l border-zinc-200 bg-white flex flex-col h-full overflow-y-auto",
  lockMoneda = null,   // Si viene 'UYU' o 'USD', oculta el selector de moneda por línea
  layout = 'vertical',
  showSubmitButton = true,
}) {
  const esEgreso = mode === 'EGRESO';
  const tiposDoc = tiposDocDisponibles.length > 0
    ? tiposDocDisponibles
    : [{ value: 'NINGUNO', label: 'Sin documento / Cargando...' }];
  const [efectivoRecibido, setEfectivoRecibido] = useState('');
  const [chequeIndexActivo, setChequeIndexActivo] = useState(null);
  const [numDocPredict, setNumDocPredict] = useState('...');

  // Mapeo bidireccional entre tipoDoc y los botones interactivos
  const { derivedTipoCliente, derivedCondicion } = useMemo(() => {
    if (tipoDoc === '40') {
      return { derivedTipoCliente: 'PEDIDO_CAJA', derivedCondicion: 'CONTADO' };
    }
    if (tipoDoc === '07') {
      return { derivedTipoCliente: 'ETICKET', derivedCondicion: 'CONTADO' };
    }
    if (tipoDoc === '08') {
      return { derivedTipoCliente: 'ETICKET', derivedCondicion: 'CREDITO' };
    }
    if (tipoDoc === '01') {
      return { derivedTipoCliente: 'CON_RUT', derivedCondicion: 'CONTADO' };
    }
    if (tipoDoc === '02') {
      return { derivedTipoCliente: 'CON_RUT', derivedCondicion: 'CREDITO' };
    }
    // Fallback general por defecto
    return { derivedTipoCliente: 'PEDIDO_CAJA', derivedCondicion: 'CONTADO' };
  }, [tipoDoc]);

  const handleSelectVoucherType = (type) => {
    let targetDoc = '40';
    if (type === 'PEDIDO_CAJA') {
      targetDoc = '40';
    } else if (type === 'ETICKET') {
      targetDoc = derivedCondicion === 'CONTADO' ? '07' : '08';
    } else if (type === 'CON_RUT') {
      targetDoc = derivedCondicion === 'CONTADO' ? '01' : '02';
    }
    if (onTipoDoc) {
      onTipoDoc(targetDoc);
    }
  };

  const handleSelectCondicion = (cond) => {
    let targetDoc = tipoDoc;
    if (derivedTipoCliente === 'PEDIDO_CAJA') {
      targetDoc = '40';
    } else if (derivedTipoCliente === 'ETICKET') {
      targetDoc = cond === 'CONTADO' ? '07' : '08';
    } else if (derivedTipoCliente === 'CON_RUT') {
      targetDoc = cond === 'CONTADO' ? '01' : '02';
    }
    if (onTipoDoc) {
      onTipoDoc(targetDoc);
    }
    
    // Si cambia a CRÉDITO, limpia los pagos. Si cambia a CONTADO, inicializa el pago por defecto
    if (cond === 'CREDITO') {
      if (onPagosChange) {
        onPagosChange([]);
      }
    } else {
      if (pagos.length === 0 && onPagosChange) {
        const contadoId = metodosPago.find(m => /(contado|efectivo)/i.test(m.MPaDescripcionMetodo))?.MPaIdMetodoPago || metodosPago[0]?.MPaIdMetodoPago || '';
        onPagosChange([{
          id: Date.now(),
          metodoPagoId: contadoId,
          moneda,
          monto: totalACubrir > 0 ? totalACubrir.toFixed(2) : ''
        }]);
      }
    }
  };

  const hasStandardVouchers = !esEgreso && tiposDoc.some(t => ['40', '07', '08', '01', '02'].includes(t.value));
  const hasReciboVouchers = !esEgreso && !hasStandardVouchers && tiposDoc.some(t => ['05', 'RECIBO_ANTICIPO'].includes(t.value));

  const resultingDocDescription = useMemo(() => {
    if (tipoDoc === '40') return 'PEDIDO CAJA';
    if (tipoDoc === '07') return 'E-TICKET CONTADO';
    if (tipoDoc === '08') return 'E-TICKET CRÉDITO';
    if (tipoDoc === '01') return 'E-FACTURA CONTADO';
    if (tipoDoc === '02') return 'E-FACTURA CRÉDITO';
    if (tipoDoc === '05') return 'RECIBO';
    if (tipoDoc === 'RECIBO_ANTICIPO') return 'RECIBO DE ANTICIPO';
    if (tipoDoc === 'NINGUNO') return 'SIN DOCUMENTO';
    
    const matched = tiposDoc.find(t => t.value === tipoDoc);
    return matched ? String(matched.label).toUpperCase() : 'COMPROBANTE';
  }, [tipoDoc, tiposDoc]);

  useEffect(() => {
    if (tipoDoc && tipoDoc !== 'NINGUNO') {
      setNumDocPredict('...');
      api.get(`/contabilidad/caja/siguiente-numero?tipoDoc=${tipoDoc}`)
        .then(r => {
          if (r.data.success) {
            setNumDocPredict(r.data.NumeroFormato);
            if (r.data.Serie && onSerieDoc) {
              onSerieDoc(r.data.Serie);
            }
          }
        })
        .catch(() => setNumDocPredict('?'));
    } else {
      setNumDocPredict('Sin Número');
    }
  }, [tipoDoc]);

  // ── Totales ──────────────────────────────────────────────────────
  const totalIngresado = useMemo(() => {
    return pagos.reduce((acc, p) => {
      const m = parseFloat(p.monto) || 0;
      if (moneda === 'UYU') return acc + (p.moneda === 'USD' ? m * (cotizacion || 1) : m);
      return acc + (p.moneda === 'UYU' ? m / (cotizacion || 1) : m);
    }, 0);
  }, [pagos, moneda, cotizacion]);

  const diferencia = totalACubrir - totalIngresado;
  const tolerancia = moneda === 'USD' ? 0.05 : 1.0;
  const balanceOK = Math.abs(diferencia) <= tolerancia || totalIngresado === 0; // 0 = 100% crédito/deuda
  const simbMoneda = moneda === 'USD' ? 'US$' : '$';

  // ── Helpers carrito ───────────────────────────────────────────────
  const addPago = () => {
    const contadoId = metodosPago.find(m => /(contado|efectivo)/i.test(m.MPaDescripcionMetodo))?.MPaIdMetodoPago || metodosPago[0]?.MPaIdMetodoPago || '';
    onPagosChange([...pagos, { id: Date.now(), metodoPagoId: contadoId, moneda, monto: '' }]);
  };

  const removePago = (id) => onPagosChange(pagos.filter((p) => p.id !== id));

  const updatePago = (id, field, value) =>
    onPagosChange(pagos.map((p) => (p.id === id ? { ...p, [field]: value } : p)));

  const autoRellenar = () => {
    if (diferencia <= 0) return;
    const last = pagos[pagos.length - 1];
    if (!last) {
      addPago();
      return;
    }
    let fill = diferencia;
    if (moneda === 'UYU' && last.moneda === 'USD') fill = diferencia / (cotizacion || 1);
    if (moneda === 'USD' && last.moneda === 'UYU') fill = diferencia * (cotizacion || 1);
    onPagosChange(
      pagos.map((p, i) =>
        i === pagos.length - 1
          ? { ...p, monto: ((parseFloat(p.monto) || 0) + fill).toFixed(2) }
          : p
      )
    );
  };

  // ── Auto-rellenar cuando cambia el total o la moneda base ──
  useEffect(() => {
    if (pagos.length === 1 && totalACubrir > 0 && derivedCondicion === 'CONTADO') {
      const p = pagos[0];
      const contadoId = metodosPago.find(m => /(contado|efectivo)/i.test(m.MPaDescripcionMetodo))?.MPaIdMetodoPago || metodosPago[0]?.MPaIdMetodoPago || '';

      const fill = totalACubrir;
      const monedaCorrecta = moneda; // la moneda de la deuda es la referencia

      const yaEsCorrecto =
        p.moneda === monedaCorrecta &&
        parseFloat(p.monto) === parseFloat(fill.toFixed(2)) &&
        (p.metodoPagoId || !contadoId);

      if (!yaEsCorrecto) {
        onPagosChange([{
          ...p,
          metodoPagoId: p.metodoPagoId || contadoId,
          moneda: monedaCorrecta,
          monto: fill.toFixed(2)
        }]);
      }
    }
  }, [totalACubrir, moneda, cotizacion, metodosPago, derivedCondicion]); // Solo variables externas para no loopear

  // ── Label botón por defecto ────────────────────────────────────────
  const defaultLabel = {
    COBRO: 'PROCESAR EMISIÓN',
    VENTA: 'PROCESAR VENTA',
    MOTOR: 'REGISTRAR OPERACIÓN',
    EGRESO: 'REGISTRAR SALIDA',
  }[mode] || 'CONFIRMAR';

  const colorBoton = {
    COBRO: 'bg-[#006097] hover:bg-[#005080] shadow-[#006097]/25 text-white',
    VENTA: 'bg-[#006097] hover:bg-[#005080] shadow-[#006097]/25 text-white',
    MOTOR: 'bg-violet-600 hover:bg-violet-500 shadow-violet-200 text-white',
    EGRESO: 'bg-brand-magenta hover:bg-brand-magenta/90 shadow-brand-magenta/30 text-white',
  }[mode] || 'bg-[#006097] hover:bg-[#005080] text-white';

  const canConfirm = !procesando && !disabledExtra;

  // Render label o botón dinámico según condición de venta
  const confirmBtnText = labelBoton
    ? labelBoton
    : `${defaultLabel} (${derivedCondicion === 'CONTADO' ? 'CONTADO' : 'CRÉDITO'})`;

  // ==========================================
  // LAYOUT HORIZONTAL (Diseño Compacto de 3 Columnas)
  // ==========================================
  if (layout === 'horizontal') {
    return (
      <div className="bg-white rounded-3xl border border-zinc-200 shadow-lg p-6 w-full mb-4 animate-in fade-in duration-300 font-sans select-none text-zinc-700">
        
        {/* Cabecera del Documento Resultante y Balance */}
        <div className="flex justify-between items-center mb-5 border-b border-zinc-100 pb-3 gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-black text-zinc-450 uppercase tracking-widest leading-none">Documento a Generar:</span>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-600 animate-pulse shrink-0" />
              <span className="text-xl lg:text-2xl font-black tracking-tight text-zinc-900 uppercase">
                {resultingDocDescription}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
            {/* TC siempre visible */}
            {cotizacion && cotizacion > 1 && (
              <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 shrink-0">
                <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest">TC</span>
                <span className="text-xs font-black text-amber-800 font-mono">${fmt(cotizacion)}</span>
              </div>
            )}

            {totalACubrir > 0 && (
              <div className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm shrink-0
                ${balanceOK && totalIngresado > 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : diferencia > 0
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-zinc-100 border-zinc-200 text-zinc-500'
                }`}
              >
                <span>
                  {totalIngresado === 0
                    ? derivedCondicion === 'CREDITO' ? '💳 Factura a Crédito' : '⏳ Sin pago inicial'
                    : balanceOK
                      ? '✓ Caja Balanceada'
                      : diferencia > 0
                        ? `Falta ${simbMoneda} ${fmt(Math.abs(diferencia))}`
                        : `Excede ${simbMoneda} ${fmt(Math.abs(diferencia))}`}
                </span>
                {!balanceOK && totalIngresado > 0 && cotizacion && moneda === 'USD' && (
                  <span className="text-zinc-400 font-bold bg-white px-1.5 py-0.5 rounded border border-zinc-200 text-[9px]">
                    ($ {fmt(Math.abs(diferencia) * cotizacion)})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Rejilla de 3 Columnas */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
          
          {/* COLUMNA 1: Toggles de Comprobantes & Condición (Sin Etiquetas) */}
          <div className="flex flex-col gap-4">
            
            {hasStandardVouchers ? (
              <div className="flex bg-zinc-100 border border-zinc-200 rounded-2xl p-1 gap-1">
                <button
                  type="button"
                  onClick={() => handleSelectVoucherType('PEDIDO_CAJA')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                    derivedTipoCliente === 'PEDIDO_CAJA'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                  }`}
                >
                  <ShoppingBag size={14} />
                  Pedido Caja
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectVoucherType('ETICKET')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                    derivedTipoCliente === 'ETICKET'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                  }`}
                >
                  <Receipt size={14} />
                  e-Ticket
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectVoucherType('CON_RUT')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                    derivedTipoCliente === 'CON_RUT'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                  }`}
                >
                  <Building2 size={14} />
                  Con RUT
                </button>
              </div>
            ) : hasReciboVouchers ? (
              <div className="flex bg-zinc-100 border border-zinc-200 rounded-2xl p-1 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const target = tiposDoc.find(t => ['05', 'RECIBO_ANTICIPO'].includes(t.value))?.value || '05';
                    onTipoDoc && onTipoDoc(target);
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                    ['05', 'RECIBO_ANTICIPO'].includes(tipoDoc)
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                  }`}
                >
                  <Receipt size={14} />
                  Recibo
                </button>
                {tiposDoc.some(t => t.value === 'NINGUNO') && (
                  <button
                    type="button"
                    onClick={() => onTipoDoc && onTipoDoc('NINGUNO')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                      tipoDoc === 'NINGUNO'
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                    }`}
                  >
                    <X size={14} />
                    Sin Documento
                  </button>
                )}
              </div>
            ) : (
              <LightSelect
                value={tipoDoc}
                onChange={onTipoDoc}
                options={tiposDoc}
                placeholder="Seleccionar comprobante..."
              />
            )}

            {/* SERIE & NÚMERO */}
            {tipoDoc !== 'NINGUNO' && (
              <div className="flex gap-3">
                <div className="flex-1 flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2 shadow-inner">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0 select-none">Serie:</span>
                  <input
                    type="text"
                    value={serieDoc}
                    onChange={(e) => onSerieDoc && onSerieDoc(e.target.value.toUpperCase())}
                    placeholder="Serie"
                    className="w-full bg-transparent border-none text-xs font-black text-zinc-800 outline-none p-0 focus:ring-0"
                  />
                </div>
                <div
                  className="bg-zinc-100 border border-zinc-200 rounded-xl px-4 py-2 text-xs text-zinc-500 font-black italic flex-[2.5] truncate shadow-inner flex items-center justify-center h-[38px] select-all cursor-copy"
                  title="Siguiente número de documento correlativo"
                >
                  {numDoc || numDocPredict}
                </div>
              </div>
            )}

            {/* CONDICIÓN DE VENTA TABS (Solo para facturas estándar) */}
            {!esEgreso && hasStandardVouchers && (
              <div className="flex bg-zinc-100 border border-zinc-200 rounded-2xl p-1 gap-1">
                <button
                  type="button"
                  onClick={() => handleSelectCondicion('CONTADO')}
                  className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                    derivedCondicion === 'CONTADO'
                      ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200'
                      : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                  }`}
                >
                  Contado
                </button>
                <button
                  type="button"
                  disabled={derivedTipoCliente === 'PEDIDO_CAJA'}
                  onClick={() => handleSelectCondicion('CREDITO')}
                  className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                    derivedCondicion === 'CREDITO'
                      ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200'
                      : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  Crédito
                </button>
              </div>
            )}

            {/* Selector de Moneda de la Operación */}
            {onMonedaChange && (
              <LightSelect
                value={moneda}
                onChange={onMonedaChange}
                options={[
                  { value: 'UYU', label: 'UYU ($)' },
                  { value: 'USD', label: 'USD (US$)' }
                ]}
                placeholder="Moneda de la Operación..."
              />
            )}
          </div>

          {/* COLUMNA 2: Formas de Pago & Calculadora de Vuelto */}
          <div className="flex flex-col gap-4">
            
            {pagos.length === 0 && (
              <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-6 text-center shadow-inner">
                <p className="text-xs text-zinc-400 font-bold italic">
                  {derivedCondicion === 'CREDITO' ? 'Sin pago hoy = Factura 100% a Crédito' : 'Debe agregar al menos un medio de pago'}
                </p>
              </div>
            )}

            {/* Listado de Pagos */}
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
              {pagos.map((p) => {
                const isCheque = metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId))?.MPaDescripcionMetodo?.toLowerCase()?.includes('cheque');
                return (
                  <div key={p.id} className="flex gap-2 items-center bg-zinc-50 border border-zinc-200 p-2.5 rounded-2xl shadow-sm transition-all hover:border-zinc-300">
                    
                    {/* Medio select */}
                    <div className="w-36 shrink-0">
                      <select
                        value={p.metodoPagoId}
                        onChange={(e) => {
                          const val = e.target.value;
                          updatePago(p.id, 'metodoPagoId', val);
                          const isNowCheque = metodosPago.find(m => m.MPaIdMetodoPago === parseInt(val))?.MPaDescripcionMetodo?.toLowerCase()?.includes('cheque');
                          if (isNowCheque && !p.idCheque) setChequeIndexActivo(p.id);
                        }}
                        className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-black text-zinc-800 font-archivo outline-none hover:border-zinc-300 focus:border-brand-cyan transition-all shadow-sm cursor-pointer appearance-none pr-8"
                        style={{
                          backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E")`,
                          backgroundPosition: `right 0.5rem center`,
                          backgroundSize: `1.25em 1.25em`,
                          backgroundRepeat: `no-repeat`
                        }}
                      >
                        <option value="" disabled>Medio...</option>
                        {metodosPago.map(m => (
                          <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>
                            {m.MPaDescripcionMetodo}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Toggles de moneda sin tipo de cambio arriba (User Request #5) */}
                    {!lockMoneda && (
                      <div className="flex bg-zinc-200 rounded-lg p-0.5 border border-zinc-300 select-none shrink-0 text-[10px] shadow-sm">
                        <button
                          type="button"
                          onClick={() => {
                            const newMoneda = 'UYU';
                            if (p.moneda === newMoneda) return;
                            if (pagos.length === 1 && totalACubrir > 0) {
                              let fill = totalACubrir;
                              if (moneda === 'USD') fill = totalACubrir * (cotizacion || 1);
                              onPagosChange([{ ...p, moneda: newMoneda, monto: fill.toFixed(2) }]);
                            } else {
                              updatePago(p.id, 'moneda', newMoneda);
                            }
                          }}
                          className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all ${
                            p.moneda === 'UYU' ? 'bg-[#006097] text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                          }`}
                        >
                          $
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const newMoneda = 'USD';
                            if (p.moneda === newMoneda) return;
                            if (pagos.length === 1 && totalACubrir > 0) {
                              let fill = totalACubrir;
                              if (moneda === 'UYU') fill = totalACubrir / (cotizacion || 1);
                              onPagosChange([{ ...p, moneda: newMoneda, monto: fill.toFixed(2) }]);
                            } else {
                              updatePago(p.id, 'moneda', newMoneda);
                            }
                          }}
                          className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all ${
                            p.moneda === 'USD' ? 'bg-[#006097] text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                          }`}
                        >
                          US$
                        </button>
                      </div>
                    )}

                    {/* Monto */}
                    <input
                      type="number"
                      placeholder="0.00"
                      value={p.monto}
                      onChange={(e) => updatePago(p.id, 'monto', e.target.value)}
                      className="w-24 bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-black text-zinc-800 text-right outline-none focus:border-brand-cyan shadow-inner"
                    />

                    {isCheque && (
                      <button
                        type="button"
                        onClick={() => setChequeIndexActivo(p.id)}
                        className={`text-[10px] font-black px-2 py-2 rounded-xl shrink-0 transition-colors flex items-center gap-1 uppercase tracking-widest ${p.idCheque ? 'bg-emerald-500/20 text-emerald-600 border border-emerald-200 shadow-sm' : 'bg-amber-500/20 text-amber-500 border border-amber-200 hover:bg-amber-500/30'}`}
                      >
                        <Landmark size={12} /> {p.idCheque ? 'OK' : 'INFO'}
                      </button>
                    )}

                    {pagos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePago(p.id)}
                        className="text-zinc-400 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition-all shrink-0 border border-transparent shadow-sm"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Agregar medio / Completar saldo */}
            <div className="flex gap-2 items-center flex-wrap">
              <button
                type="button"
                onClick={addPago}
                className="bg-zinc-50 text-zinc-500 text-[10px] font-black border border-dashed border-zinc-200 rounded-xl px-3 py-1.5 hover:border-zinc-400 hover:text-zinc-800 transition-all flex items-center gap-1 uppercase tracking-wider shadow-sm"
              >
                <Plus size={12} /> Agregar Medio
              </button>
              {totalACubrir > 0 && diferencia > 0.01 && (
                <button
                  type="button"
                  onClick={autoRellenar}
                  className="bg-white text-zinc-500 text-[10px] font-black border border-zinc-200 rounded-xl px-3 py-1.5 hover:border-zinc-300 hover:text-zinc-800 transition-all uppercase tracking-wider shadow-sm"
                >
                  Completar Saldo
                </button>
              )}
            </div>

            {/* CALCULADORA DE VUELTO */}
            {(() => {
              const cashPayments = pagos.filter(p => {
                const m = metodosPago.find(met => met.MPaIdMetodoPago === parseInt(p.metodoPagoId));
                return m && /efectivo|contado/i.test(m.MPaDescripcionMetodo);
              });
              if (cashPayments.length > 0 && !esEgreso) {
                const totalEfectivoUYU = cashPayments.reduce((acc, p) => {
                  const val = parseFloat(p.monto) || 0;
                  return acc + (p.moneda === 'USD' ? val * (cotizacion || 1) : val);
                }, 0);
                const totalEfectivoUSD = totalEfectivoUYU / (cotizacion || 1);
                const montoEfectivo = moneda === 'USD' ? totalEfectivoUSD : totalEfectivoUYU;

                if (montoEfectivo > 0) {
                  const recibido = parseFloat(efectivoRecibido) || 0;
                  const vuelto = recibido - montoEfectivo;
                  return (
                    <div className="flex flex-col gap-1.5 bg-emerald-50/20 border border-emerald-200 rounded-xl p-3 text-emerald-800 animate-in fade-in duration-200 shrink-0 w-full">
                      <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest px-1">
                        Calculadora de Vuelto
                      </label>
                      <div className="flex flex-col gap-2 mt-0.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-500">Total:</span>
                          <span className="font-black text-emerald-700 text-sm">{simbMoneda} {fmt(montoEfectivo)}</span>
                        </div>
                        <div className="flex justify-between items-center gap-2 text-xs">
                          <span className="text-slate-500">Recibido:</span>
                          <input
                            type="number"
                            value={efectivoRecibido}
                            onChange={e => setEfectivoRecibido(e.target.value)}
                            placeholder="0.00"
                            className="w-24 bg-white border border-emerald-300 rounded-lg px-2.5 py-1 text-xs text-right font-black outline-none focus:border-emerald-500 shadow-inner text-emerald-800"
                          />
                        </div>
                        {recibido > 0 && (
                          <div className="flex justify-between items-center border-t border-emerald-100 pt-2 text-xs">
                            <span className="font-bold text-slate-600">Vuelto:</span>
                            <span className={`font-black text-sm ${vuelto >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {vuelto >= 0 ? '+' : ''}
                              {simbMoneda} {fmt(vuelto)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              }
              return null;
            })()}
          </div>

          {/* COLUMNA 3: Observaciones Internas & Botón de Procesar (Arriba y Abajo, User Request #4) */}
          <div className="flex flex-col justify-between gap-4 h-full min-h-[170px] self-stretch">
            
            {/* Observaciones (En un bloque/cuadradito) */}
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                Observaciones Internas
              </label>
              <textarea
                value={notas}
                onChange={(e) => onNotas && onNotas(e.target.value)}
                placeholder="Añada notas informativas..."
                className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-xs font-bold text-zinc-800 outline-none resize-none focus:border-brand-cyan transition-all shadow-sm placeholder-zinc-300 flex-1 min-h-[96px] h-full"
              />
            </div>

            {/* Botón Procesar abajo */}
            {showSubmitButton && onConfirmar && (
              <button
                type="button"
                onClick={onConfirmar}
                disabled={!canConfirm}
                className={`w-full text-white font-black py-4 px-6 rounded-2xl border border-transparent shadow-lg transition-all hover:scale-[1.01] active:scale-[0.98] text-xs uppercase tracking-wider whitespace-nowrap flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${colorBoton}`}
              >
                {procesando ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <>
                    <CheckCircle size={16} /> 
                    {confirmBtnText}
                  </>
                )}
              </button>
            )}
          </div>

        </div>

        {chequeIndexActivo !== null && (
          <ChequeRecibirModal
            initialMonto={pagos.find(p => p.id === chequeIndexActivo)?.monto || ''}
            onClose={() => setChequeIndexActivo(null)}
            onSuccess={(idCheque) => {
              updatePago(chequeIndexActivo, 'idCheque', idCheque);
              setChequeIndexActivo(null);
            }}
          />
        )}
      </div>
    );
  }

  // ==========================================
  // LAYOUT VERTICAL (Diseño Barra Lateral)
  // ==========================================
  return (
    <div className={containerClassName}>

      {/* Encabezado con Nombre del Documento Resultante */}
      <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 sticky top-0 z-10 shrink-0">
        <h3 className="font-black text-zinc-800 text-sm flex items-center gap-2.5 font-archivo uppercase">
          <div className="bg-brand-cyan/10 p-1.5 rounded-lg border border-brand-cyan/20 shrink-0">
            <FileText size={16} className="text-brand-cyan" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-zinc-400 tracking-wider">DOC RESULTANTE:</span>
            <span className="text-purple-600 text-xs font-black truncate">{resultingDocDescription}</span>
          </div>
        </h3>
        {totalACubrir > 0 && (
          <p className="text-[10px] text-zinc-400 mt-1.5 uppercase font-black tracking-widest px-1 font-archivo">
            Total a cubrir: {simbMoneda} {fmt(totalACubrir)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 p-4 flex-1">

        {/* LÍNEAS DE PAGO */}
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-center px-1">
            <label className="text-[10px] uppercase font-black text-zinc-400 tracking-widest font-archivo">
              Formas de pago recibidas
            </label>
            
            {totalACubrir > 0 && (
              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border shadow-sm
                ${balanceOK && totalIngresado > 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-rose-50 border-rose-100 text-rose-600'}`}
              >
                {balanceOK ? 'OK' : 'Pte'}
              </span>
            )}
          </div>

          {pagos.length === 0 && (
            <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl p-6 text-center">
              <p className="text-xs text-zinc-400 font-bold italic">
                {derivedCondicion === 'CREDITO' ? 'Sin pago hoy = Factura 100% a Crédito' : 'Debe agregar al menos un medio de pago'}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {pagos.map((p) => (
              <div
                key={p.id}
                className="flex gap-2 items-center bg-zinc-50 border border-zinc-200 p-2 rounded-2xl shadow-sm animate-in slide-in-from-right-4 duration-200"
              >
                {/* Método */}
                <div className="flex-1 min-w-0">
                  <select
                    value={p.metodoPagoId}
                    onChange={(e) => {
                      const val = e.target.value;
                      updatePago(p.id, 'metodoPagoId', val);
                      const isCheque = metodosPago.find(m => m.MPaIdMetodoPago === parseInt(val))?.MPaDescripcionMetodo?.toLowerCase().includes('cheque');
                      if (isCheque && !p.idCheque) setChequeIndexActivo(p.id);
                    }}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-black text-zinc-800 font-archivo outline-none hover:border-zinc-300 focus:border-brand-cyan transition-all shadow-sm cursor-pointer appearance-none pr-8"
                    style={{
                      backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E")`,
                      backgroundPosition: `right 0.5rem center`,
                      backgroundSize: `1.25em 1.25em`,
                      backgroundRepeat: `no-repeat`
                    }}
                  >
                    <option value="" disabled>Medio...</option>
                    {metodosPago.map(m => (
                      <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>
                        {m.MPaDescripcionMetodo}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Moneda */}
                {!lockMoneda && (
                  <select
                    value={p.moneda}
                    onChange={(e) => {
                      const newMoneda = e.target.value;
                      if (pagos.length === 1 && totalACubrir > 0) {
                        let fill = totalACubrir;
                        if (moneda === 'UYU' && newMoneda === 'USD') fill = totalACubrir / (cotizacion || 1);
                        if (moneda === 'USD' && newMoneda === 'UYU') fill = totalACubrir * (cotizacion || 1);
                        onPagosChange([{ ...p, moneda: newMoneda, monto: fill.toFixed(2) }]);
                      } else {
                        updatePago(p.id, 'moneda', newMoneda);
                      }
                    }}
                    className="w-16 bg-white border border-zinc-200 rounded-xl px-2 py-2 text-xs font-black text-zinc-600 outline-none text-center"
                  >
                    <option value="UYU">$</option>
                    <option value="USD">U$</option>
                  </select>
                )}

                {/* Monto */}
                <input
                  type="number"
                  placeholder="0.0"
                  value={p.monto}
                  onChange={(e) => updatePago(p.id, 'monto', e.target.value)}
                  className="w-24 bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-black text-zinc-800 text-right outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 shadow-inner"
                />

                {/* Cheque */}
                {
                  metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId))?.MPaDescripcionMetodo?.toLowerCase().includes('cheque') && (
                    <button
                      type="button"
                      onClick={() => setChequeIndexActivo(p.id)}
                      className={`text-[10px] font-black px-2 py-2 rounded-xl shrink-0 transition-colors flex items-center gap-1 uppercase tracking-widest ${p.idCheque ? 'bg-emerald-500/20 text-emerald-600 border border-emerald-200' : 'bg-amber-500/20 text-amber-400 border border-amber-200 hover:bg-amber-500/30'}`}
                      title={p.idCheque ? 'Cheque vinculado' : 'Cargar datos del cheque'}
                    >
                      <Landmark size={12} /> {p.idCheque ? 'OK' : 'INFO'}
                    </button>
                  )
                }

                {/* Eliminar */}
                <button
                  type="button"
                  onClick={() => removePago(p.id)}
                  className="text-zinc-400 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition-all shrink-0"
                >
                  <X size={16} />
                </button>
              </div >
            ))
            }
          </div >

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={addPago}
              className="flex-1 bg-zinc-50 text-zinc-500 text-[10px] font-black border border-zinc-200 rounded-2xl py-3 hover:border-zinc-450 hover:text-zinc-800 hover:bg-zinc-105 transition-all flex items-center justify-center gap-2 shadow-sm uppercase tracking-widest"
            >
              <Plus size={14} /> Agregar Medio
            </button>
            {totalACubrir > 0 && diferencia > 0.01 && (
              <button
                type="button"
                onClick={autoRellenar}
                className="flex-1 bg-white text-zinc-500 text-[10px] font-black border border-zinc-200 rounded-2xl py-3 hover:border-zinc-300 hover:text-zinc-800 shadow-sm transition-all uppercase tracking-widest"
              >
                Completar Saldo
              </button>
            )}
          </div>
        </div >

        {/* CALCULADORA DE VUELTO */}
        {
          (() => {
            const cashPayments = pagos.filter(p => {
              const m = metodosPago.find(met => met.MPaIdMetodoPago === parseInt(p.metodoPagoId));
              return m && /efectivo|contado/i.test(m.MPaDescripcionMetodo);
            });
            if (cashPayments.length > 0 && !esEgreso) {
              const totalEfectivoUYU = cashPayments.reduce((acc, p) => {
                const val = parseFloat(p.monto) || 0;
                return acc + (p.moneda === 'USD' ? val * (cotizacion || 1) : val);
              }, 0);
              const totalEfectivoUSD = totalEfectivoUYU / (cotizacion || 1);
              const montoEfectivo = moneda === 'USD' ? totalEfectivoUSD : totalEfectivoUYU;

              if (montoEfectivo > 0) {
                const recibido = parseFloat(efectivoRecibido) || 0;
                const vuelto = recibido - montoEfectivo;
                return (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex flex-col gap-3 shadow-inner text-emerald-800">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Calculadora de Vuelto</span>
                      <span className="text-[10px] font-black text-emerald-500 bg-emerald-500/20 px-2 py-0.5 rounded-lg border border-emerald-100">Total Efvo: {simbMoneda} {fmt(montoEfectivo)}</span>
                    </div>
                    <div className="flex gap-3 items-center">
                      <div className="flex-1">
                        <label className="text-[10px] font-black text-emerald-600/70 uppercase block mb-1 tracking-widest">Recibido</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-black">{simbMoneda}</span>
                          <input type="number" value={efectivoRecibido} onChange={e => setEfectivoRecibido(e.target.value)} placeholder="0.00" className={`w-full bg-zinc-50 border border-emerald-200 rounded-xl pr-3 py-2 text-sm font-black text-zinc-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all shadow-sm ${simbMoneda === 'US$' ? 'pl-12' : 'pl-9'}`} />
                        </div>
                      </div>
                      {recibido > 0 && (
                        <div className="flex-1 text-right">
                          <label className="text-[10px] font-black text-emerald-600/70 uppercase block mb-1 tracking-widest">Cambio</label>
                          <span className={`text-xl font-black ${vuelto >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{vuelto >= 0 ? '+' : ''}{fmt(vuelto)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
            }
            return null;
          })()
        }

        {/* RESUMEN BALANCE */}
        {
          totalACubrir > 0 && (
            <div className="flex flex-col gap-3 bg-zinc-50 border border-zinc-200 rounded-3xl p-5 shadow-sm">
              <div className="flex justify-between text-[10px] font-black px-1">
                <span className="text-zinc-400 uppercase tracking-widest">A Cobrar</span>
                <span className="text-zinc-800 font-mono">{simbMoneda} {fmt(totalACubrir)}</span>
              </div>
              <div className="flex justify-between text-[10px] font-black px-1">
                <span className="text-zinc-400 uppercase tracking-widest">Recibido</span>
                <span className="text-emerald-600 font-mono">- {simbMoneda} {fmt(totalIngresado)}</span>
              </div>
              <div
                className={`flex justify-between items-center px-4 py-3 rounded-2xl border text-[10px] font-black mt-1 uppercase tracking-widest
                ${balanceOK && totalIngresado > 0
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-600'
                    : diferencia > 0
                      ? 'bg-rose-50 border-rose-100 text-rose-600'
                      : 'bg-white border-zinc-200 text-zinc-400'
                  }`}
              >
                <span className="flex items-center gap-2">
                  {totalIngresado === 0
                    ? derivedCondicion === 'CREDITO' ? '💳 Factura a Crédito' : '⏳ Sin pago inicial'
                    : balanceOK
                      ? '✅ Caja Balanceada'
                      : diferencia > 0
                        ? `❌ Falta ${simbMoneda} ${fmt(Math.abs(diferencia))}`
                        : `⚡ Excede ${simbMoneda} ${fmt(Math.abs(diferencia))}`}
                </span>
                {!balanceOK && totalIngresado > 0 && cotizacion && moneda === 'USD' && (
                  <span className="text-zinc-400 font-black bg-zinc-50 px-2 py-0.5 rounded-md text-[9px] border border-zinc-200">
                    ($ {fmt(Math.abs(diferencia) * cotizacion)})
                  </span>
                )}
              </div>
            </div>
          )
        }

        {/* MONEDA DE LA OPERACIÓN (Vertical) */}
        {onMonedaChange && (
          <div className="flex flex-col gap-3">
            <LightSelect
              value={moneda}
              onChange={onMonedaChange}
              options={[
                { value: 'UYU', label: 'UYU ($)' },
                { value: 'USD', label: 'USD (US$)' }
              ]}
              placeholder="Seleccionar moneda..."
            />
          </div>
        )}

        {/* DOCUMENTO A EMITIR (Vertical) */}
        <div className="flex flex-col gap-3">
          {hasStandardVouchers ? (
            <div className="flex bg-zinc-100 border border-zinc-200 rounded-2xl p-1 gap-1">
              <button
                type="button"
                onClick={() => handleSelectVoucherType('PEDIDO_CAJA')}
                className={`flex-1 flex items-center justify-center gap-1 px-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                  derivedTipoCliente === 'PEDIDO_CAJA'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                }`}
              >
                Pedido Caja
              </button>
              <button
                type="button"
                onClick={() => handleSelectVoucherType('ETICKET')}
                className={`flex-1 flex items-center justify-center gap-1 px-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                  derivedTipoCliente === 'ETICKET'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                }`}
              >
                e-Ticket
              </button>
              <button
                type="button"
                onClick={() => handleSelectVoucherType('CON_RUT')}
                className={`flex-1 flex items-center justify-center gap-1 px-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                  derivedTipoCliente === 'CON_RUT'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                }`}
              >
                Con RUT
              </button>
            </div>
          ) : hasReciboVouchers ? (
            <div className="flex bg-zinc-100 border border-zinc-200 rounded-2xl p-1 gap-1">
              <button
                type="button"
                onClick={() => {
                  const target = tiposDoc.find(t => ['05', 'RECIBO_ANTICIPO'].includes(t.value))?.value || '05';
                  onTipoDoc && onTipoDoc(target);
                }}
                className={`flex-1 flex items-center justify-center gap-1 px-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                  ['05', 'RECIBO_ANTICIPO'].includes(tipoDoc)
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                }`}
              >
                Recibo
              </button>
              {tiposDoc.some(t => t.value === 'NINGUNO') && (
                <button
                  type="button"
                  onClick={() => onTipoDoc && onTipoDoc('NINGUNO')}
                  className={`flex-1 flex items-center justify-center gap-1 px-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                    tipoDoc === 'NINGUNO'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                  }`}
                >
                  Sin Documento
                </button>
              )}
            </div>
          ) : (
            <LightSelect
              value={tipoDoc}
              onChange={onTipoDoc}
              options={tiposDoc}
              placeholder="Seleccionar documento..."
            />
          )}

          {tipoDoc !== 'NINGUNO' && (
            <div className="flex gap-2.5">
              <input
                type="text"
                value={serieDoc}
                onChange={(e) => onSerieDoc && onSerieDoc(e.target.value.toUpperCase())}
                placeholder="Serie"
                className="w-20 text-center bg-zinc-50 border border-zinc-200 rounded-2xl px-3 py-3 text-sm font-black text-zinc-800 outline-none focus:border-brand-cyan transition-all shadow-sm"
              />
              <div className="flex-1 bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-[10px] text-zinc-400 font-black flex items-center justify-center italic uppercase tracking-widest">
                {numDoc || numDocPredict}
              </div>
            </div>
          )}
        </div>

        {/* CONDICIÓN DE VENTA (Vertical) */}
        {!esEgreso && hasStandardVouchers && (
          <div className="flex flex-col gap-3">
            <div className="flex bg-zinc-100 border border-zinc-200 rounded-2xl p-1 gap-1">
              <button
                type="button"
                onClick={() => handleSelectCondicion('CONTADO')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  derivedCondicion === 'CONTADO'
                    ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50'
                }`}
              >
                Contado
              </button>
              <button
                type="button"
                disabled={derivedTipoCliente === 'PEDIDO_CAJA'}
                onClick={() => handleSelectCondicion('CREDITO')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  derivedCondicion === 'CREDITO'
                    ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-700 bg-transparent hover:bg-zinc-200/50 disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                Crédito
              </button>
            </div>
          </div>
        )}

        {/* NOTAS INTERNAS */}
        <div className="flex flex-col gap-3">
          <label className="text-[10px] uppercase font-black text-zinc-400 tracking-widest px-1 font-archivo">
            Observaciones Internas
          </label>
          <textarea
            value={notas}
            onChange={(e) => onNotas(e.target.value)}
            placeholder="Añada notas para el arqueo de caja..."
            rows={3}
            className="bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 text-sm font-bold text-zinc-800 outline-none resize-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 transition-all shadow-sm placeholder-zinc-300"
          />
        </div>

        {/* BOTÓN CONFIRMAR */}
        <button
          type="button"
          onClick={onConfirmar}
          disabled={!canConfirm}
          className={`w-full mt-auto shrink-0 ${colorBoton} disabled:bg-zinc-100 disabled:text-zinc-400 disabled:shadow-none font-black py-4 rounded-[1.5rem] flex justify-center gap-3 items-center text-sm shadow-xl transition-all active:scale-[0.98] uppercase tracking-widest`}
        >
          {procesando ? (
            <Loader2 className="animate-spin" size={24} />
          ) : (
            <>
              <CheckCircle size={22} /> 
              {confirmBtnText}
            </>
          )}
        </button>

      </div >

      {chequeIndexActivo !== null && (
        <ChequeRecibirModal
          initialMonto={pagos.find(p => p.id === chequeIndexActivo)?.monto || ''}
          onClose={() => setChequeIndexActivo(null)}
          onSuccess={(idCheque) => {
            updatePago(chequeIndexActivo, 'idCheque', idCheque);
            setChequeIndexActivo(null);
          }}
        />
      )}
    </div >
  );
}
