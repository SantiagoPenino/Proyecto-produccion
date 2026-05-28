import React, { useMemo, useState, useEffect } from 'react';
import { Plus, X, CheckCircle, Loader2, FileText, Landmark, CreditCard, DollarSign, ChevronDown, Check } from 'lucide-react';
import ChequeRecibirModal from './tesoreria/ChequeRecibirModal';
import { Listbox } from '@headlessui/react';
import api from '../../services/apiClient';

// Select ligero construido con Headless UI
function LightSelect({ value, onChange, options = [], placeholder = 'Seleccionar...' }) {
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative">
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

/**
 * PanelPago — columna izquierda fija para COBRO / VENTA / MOTOR / EGRESO
 *
 * Props:
 *   mode          'COBRO' | 'VENTA' | 'MOTOR' | 'EGRESO'
 *   totalACubrir  number   — Total calculado por el contenedor padre
 *   moneda        'UYU' | 'USD'
 *   cotizacion    number
 *   metodosPago   Array
 *
 *   // Líneas de pago (carrito)
 *   pagos         Array<{ id, metodoPagoId, moneda, monto }>
 *   onPagosChange fn(newPagos)
 *
 *   // Documento
 *   tipoDoc       string
 *   onTipoDoc     fn(val)
 *   serieDoc      string
 *   onSerieDoc    fn(val)
 *   numDoc        string | null  (preview)
 *   notas         string
 *   onNotas       fn(val)
 *
 *   // Acción principal
 *   onConfirmar   fn()
 *   procesando    bool
 *   labelBoton    string   (default según mode)
 *   disabledExtra bool     (condición extra para deshabilitar)
 */
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
    if (pagos.length === 1 && totalACubrir > 0) {
      const p = pagos[0];
      const contadoId = metodosPago.find(m => /(contado|efectivo)/i.test(m.MPaDescripcionMetodo))?.MPaIdMetodoPago || metodosPago[0]?.MPaIdMetodoPago || '';

      // Siempre usar el monto en la moneda de la deuda (sin conversión automática).
      // Si el usuario quiere pagar en otra moneda, lo cambia manualmente con el selector.
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
  }, [totalACubrir, moneda, cotizacion, metodosPago]); // Solo variables externas para no loopear

  // ── Label botón por defecto ────────────────────────────────────────
  const defaultLabel = {
    COBRO: 'REALIZAR COBRO',
    VENTA: 'PROCESAR VENTA',
    MOTOR: 'REGISTRAR OPERACIÓN',
    EGRESO: 'REGISTRAR SALIDA',
  }[mode] || 'CONFIRMAR';

  const colorBoton = {
    COBRO: 'bg-brand-cyan hover:bg-brand-cyan shadow-brand-cyan/30 text-zinc-100',
    VENTA: 'bg-[#006097] hover:bg-[#005080] shadow-brand-cyan/30 text-zinc-100',
    MOTOR: 'bg-violet-600 hover:bg-violet-500 shadow-violet-200 text-zinc-100',
    EGRESO: 'bg-brand-magenta hover:bg-brand-magenta shadow-brand-magenta/30 text-zinc-100',
  }[mode] || 'bg-brand-cyan hover:bg-brand-cyan text-zinc-100';

  const canConfirm = !procesando && !disabledExtra;

  if (layout === 'horizontal') {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 shrink-0 w-full mb-4 animate-in fade-in duration-300">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          
          {/* Medios de Pago */}
          <div className="flex flex-col gap-1.5 flex-1 min-w-[320px]">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Formas de pago recibidas</label>
              {totalACubrir > 0 && (
                <div className={`px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5
                  ${balanceOK && totalIngresado > 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : diferencia > 0
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : 'bg-zinc-100 border-zinc-200 text-zinc-500'
                  }`}
                >
                  <span>
                    {totalIngresado === 0
                      ? mode === 'VENTA' ? '💳 Factura a Crédito' : '⏳ Sin pago inicial'
                      : balanceOK
                        ? '✅ Caja Balanceada'
                        : diferencia > 0
                          ? `Falta ${simbMoneda} ${fmt(Math.abs(diferencia))}`
                          : `Excede ${simbMoneda} ${fmt(Math.abs(diferencia))}`}
                  </span>
                  {!balanceOK && totalIngresado > 0 && cotizacion && moneda === 'USD' && (
                    <span className="text-zinc-400 font-bold bg-zinc-50 px-1 py-0.5 rounded border border-zinc-200 text-[9px]">
                      ($ {fmt(Math.abs(diferencia) * cotizacion)})
                    </span>
                  )}
                </div>
              )}
            </div>

            {pagos.length === 0 && (
              <div className="bg-zinc-50 border border-dashed border-zinc-200 rounded-xl p-3 text-center">
                <p className="text-[11px] text-zinc-400 font-bold italic">
                  {mode === 'VENTA' ? 'Sin pago hoy = Factura 100% a Crédito' : 'Debe agregar al menos un medio de pago'}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {pagos.map((p) => {
                const isCheque = metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId))?.MPaDescripcionMetodo?.toLowerCase()?.includes('cheque');
                return (
                  <div key={p.id} className="flex gap-2 items-center bg-slate-50 border border-slate-200 p-2 rounded-xl">
                    <div className="w-36 shrink-0">
                      <LightSelect
                        value={p.metodoPagoId}
                        onChange={(val) => {
                          updatePago(p.id, 'metodoPagoId', val);
                          const isNowCheque = metodosPago.find(m => m.MPaIdMetodoPago === parseInt(val))?.MPaDescripcionMetodo?.toLowerCase()?.includes('cheque');
                          if (isNowCheque && !p.idCheque) setChequeIndexActivo(p.id);
                        }}
                        options={metodosPago.map(m => ({ value: m.MPaIdMetodoPago, label: m.MPaDescripcionMetodo }))}
                        placeholder="Medio..."
                      />
                    </div>
                    
                    {!lockMoneda && (
                      <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200 select-none shrink-0">
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
                            p.moneda === 'UYU' ? 'bg-[#006097] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          $ (PESOS)
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
                            p.moneda === 'USD' ? 'bg-[#006097] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          US$ (DÓLARES)
                        </button>
                      </div>
                    )}

                    <input
                      type="number"
                      placeholder="0.0"
                      value={p.monto}
                      onChange={(e) => updatePago(p.id, 'monto', e.target.value)}
                      className="w-24 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-800 text-right outline-none focus:border-brand-cyan shadow-inner"
                    />

                    {isCheque && (
                      <button
                        onClick={() => setChequeIndexActivo(p.id)}
                        className={`text-[10px] font-black px-2 py-2 rounded-xl shrink-0 transition-colors flex items-center gap-1 uppercase tracking-widest ${p.idCheque ? 'bg-emerald-500/20 text-emerald-600 border border-emerald-200' : 'bg-amber-500/20 text-amber-400 border border-amber-200 hover:bg-amber-500/30'}`}
                      >
                        <Landmark size={12} /> {p.idCheque ? 'OK' : 'INFO'}
                      </button>
                    )}

                    {pagos.length > 1 && (
                      <button
                        onClick={() => removePago(p.id)}
                        className="text-zinc-400 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition-all shrink-0"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 mt-1">
              <button
                onClick={addPago}
                className="bg-slate-50 text-slate-500 text-[10px] font-black border border-dashed border-slate-200 rounded-lg px-3 py-1.5 hover:border-slate-400 hover:text-slate-800 transition-all flex items-center gap-1 uppercase tracking-wider"
              >
                <Plus size={12} /> Agregar Medio
              </button>
              {totalACubrir > 0 && diferencia > 0.01 && (
                <button
                  onClick={autoRellenar}
                  className="bg-white text-slate-500 text-[10px] font-black border border-slate-200 rounded-lg px-3 py-1.5 hover:border-slate-300 hover:text-slate-800 transition-all uppercase tracking-wider"
                >
                  Completar Saldo
                </button>
              )}
            </div>
          </div>

          {/* Vuelto Calculator (Middle Column) */}
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
                  <div className="flex flex-col gap-1.5 min-w-[200px] max-w-[260px] flex-1 self-start bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 text-emerald-800 animate-in fade-in duration-200 shrink-0">
                    <label className="text-[9px] font-black text-emerald-600 uppercase tracking-widest px-1">Calculadora de Vuelto</label>
                    <div className="flex flex-col gap-2 mt-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-500">Efectivo:</span>
                        <span className="font-black text-emerald-700">{simbMoneda}{fmt(montoEfectivo)}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2 text-xs">
                        <span className="text-slate-500">Recibido:</span>
                        <input
                          type="number"
                          value={efectivoRecibido}
                          onChange={e => setEfectivoRecibido(e.target.value)}
                          placeholder="0.00"
                          className="w-20 bg-white border border-emerald-200 rounded-lg px-2 py-1 text-xs text-right font-black outline-none focus:border-emerald-500 shadow-inner"
                        />
                      </div>
                      {recibido > 0 && (
                        <div className="flex justify-between items-center border-t border-emerald-100/80 pt-2 text-xs">
                          <span className="font-bold text-slate-600">Vuelto:</span>
                          <span className={`font-black text-sm ${vuelto >= 0 ? 'text-emerald-600 animate-pulse' : 'text-rose-600'}`}>
                            {vuelto >= 0 ? '+' : ''}
                            {simbMoneda}{fmt(vuelto)}
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

          {/* Columna Derecha: Tipo de Comprobante + Observaciones + Botón */}
          <div className="flex flex-col gap-3 min-w-[320px] flex-[1.5] self-start">
            <div className={`grid grid-cols-1 ${onMonedaChange ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-3.5`}>
              {onMonedaChange && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                    Moneda de la Operación
                  </label>
                  <LightSelect
                    value={moneda}
                    onChange={onMonedaChange}
                    options={[
                      { value: 'UYU', label: 'UYU ($)' },
                      { value: 'USD', label: 'USD (US$)' }
                    ]}
                    placeholder="Moneda..."
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                  Tipo de Comprobante
                </label>
                <div className="flex items-center gap-2">
                  <div className="w-full">
                    <LightSelect
                      value={tipoDoc}
                      onChange={onTipoDoc}
                      options={tiposDoc}
                      placeholder="Comprobante..."
                    />
                  </div>
                  {tipoDoc !== 'NINGUNO' && (
                    <>
                      <input
                        type="text"
                        value={serieDoc}
                        onChange={(e) => onSerieDoc && onSerieDoc(e.target.value.toUpperCase())}
                        placeholder="Serie"
                        title="Serie del comprobante"
                        className="w-12 text-center bg-zinc-50 border border-zinc-200 rounded-xl px-2 py-2 text-xs font-black text-zinc-800 outline-none focus:border-brand-cyan shadow-sm"
                      />
                      <div
                        className="bg-zinc-100 border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-500 font-black italic min-w-[70px] max-w-[100px] truncate shadow-inner flex items-center justify-center"
                        title="Número del comprobante"
                      >
                        {numDoc || numDocPredict}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                  Observaciones Internas
                </label>
                <input
                  type="text"
                  value={notas}
                  onChange={(e) => onNotas && onNotas(e.target.value)}
                  placeholder="Añada notas..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold text-zinc-800 outline-none focus:border-brand-cyan transition-all shadow-sm placeholder-zinc-300"
                />
              </div>
            </div>
            
            {showSubmitButton && onConfirmar && (
              <button
                onClick={onConfirmar}
                disabled={!canConfirm}
                className={`w-full text-white font-black py-4 px-6 rounded-2xl border border-transparent shadow-lg transition-all hover:scale-[1.01] active:scale-[0.98] text-sm uppercase tracking-wider whitespace-nowrap flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${colorBoton}`}
              >
                {procesando ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <><CheckCircle size={20} /> {labelBoton || defaultLabel}</>
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

  return (
    <div className={containerClassName}>

      {/* ── Encabezado ── */}
      <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 sticky top-0 z-10 shrink-0">
        <h3 className="font-black text-zinc-800 text-base flex items-center gap-2.5">
          <div className="bg-brand-cyan/10 p-1.5 rounded-lg border border-brand-cyan/20">
            <FileText size={16} className="text-brand-cyan" />
          </div>
          Pago y Documento
        </h3>
        <p className="text-[10px] text-zinc-400 mt-1 uppercase font-black tracking-widest px-1">
          {totalACubrir > 0
            ? `Total a cubrir: ${simbMoneda} ${fmt(totalACubrir)}`
            : 'Esperando cálculo de monto...'}
        </p>
      </div>

      <div className="flex flex-col gap-4 p-4 flex-1">

        {/* ── LÍNEAS DE PAGO ────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <label className="text-[10px] uppercase font-black text-zinc-400 tracking-widest px-1">
            Formas de pago recibidas
          </label>

          {pagos.length === 0 && (
            <div className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl p-6 text-center">
              <p className="text-xs text-zinc-400 font-bold italic">
                {mode === 'VENTA'
                  ? 'Sin pago hoy = Factura 100% a Crédito'
                  : 'Debe agregar al menos un medio de pago'}
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
                  <LightSelect
                    value={p.metodoPagoId}
                    onChange={(val) => {
                      updatePago(p.id, 'metodoPagoId', val);
                      const isCheque = metodosPago.find(m => m.MPaIdMetodoPago === parseInt(val))?.MPaDescripcionMetodo?.toLowerCase().includes('cheque');
                      if (isCheque && !p.idCheque) setChequeIndexActivo(p.id);
                    }}
                    options={metodosPago.map(m => ({ value: m.MPaIdMetodoPago, label: m.MPaDescripcionMetodo }))}
                    placeholder="Medio..."
                  />
                </div>

                {/* Moneda — oculto si lockMoneda está definido */}
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
                    className="w-16 bg-slate-50 border border-slate-100 rounded-xl px-2 py-2 text-xs font-black text-slate-600 outline-none text-center"
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

                {/* Botón Cheque */}
                {
                  metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId))?.MPaDescripcionMetodo?.toLowerCase().includes('cheque') && (
                    <button
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
              onClick={addPago}
              className="flex-1 bg-zinc-50 text-zinc-500 text-[10px] font-black border-2 border-dashed border-zinc-200 rounded-2xl py-3 hover:border-zinc-600 hover:text-zinc-800 transition-all flex items-center justify-center gap-2 shadow-sm uppercase tracking-widest"
            >
              <Plus size={14} /> Agregar Medio
            </button>
            {totalACubrir > 0 && diferencia > 0.01 && (
              <button
                onClick={autoRellenar}
                className="flex-1 bg-white text-zinc-500 text-[10px] font-black border border-zinc-200 rounded-2xl py-3 hover:border-zinc-300 hover:text-zinc-800 shadow-sm transition-all uppercase tracking-widest"
              >
                Completar Saldo
              </button>
            )}
          </div>
        </div >

        {/* ── CALCULADORA DE VUELTO ─────────────────────────────────── */}
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
                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex flex-col gap-3 shadow-inner">
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

        {/* ── RESUMEN BALANCE ───────────────────────────────────────── */}
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
                    ? mode === 'VENTA' ? '💳 Factura a Crédito' : '⏳ Sin pago inicial'
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

        {/* ── MONEDA DE LA OPERACIÓN ── */}
        {onMonedaChange && (
          <div className="flex flex-col gap-3">
            <label className="text-[10px] uppercase font-black text-zinc-400 tracking-widest px-1">
              Moneda de la Operación
            </label>
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

        {/* ── DOCUMENTO A EMITIR ────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <label className="text-[10px] uppercase font-black text-zinc-400 tracking-widest px-1">
            Tipo de Comprobante
          </label>
          <LightSelect
            value={tipoDoc}
            onChange={onTipoDoc}
            options={tiposDoc}
            placeholder="Seleccionar documento..."
          />

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

        {/* ── NOTAS INTERNAS ────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <label className="text-[10px] uppercase font-black text-zinc-400 tracking-widest px-1">
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

        {/* ── BOTÓN CONFIRMAR ───────────────────────────────────────── */}
        <button
          onClick={onConfirmar}
          disabled={!canConfirm}
          className={`w-full mt-auto shrink-0 ${colorBoton} disabled:bg-zinc-100 disabled:text-zinc-400 disabled:shadow-none font-black py-4 rounded-[1.5rem] flex justify-center gap-3 items-center text-sm shadow-xl transition-all active:scale-[0.98] uppercase tracking-widest`}
        >
          {procesando ? (
            <Loader2 className="animate-spin" size={24} />
          ) : (
            <><CheckCircle size={22} /> {labelBoton || defaultLabel}</>
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
