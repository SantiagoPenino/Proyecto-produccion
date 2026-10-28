import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Landmark, Calendar, User, Hash, DollarSign, Building2, PenTool, Book, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../../../services/apiClient';
import { toast } from 'sonner';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';

// Estética nueva (27/10/2026): ventana clara, propio/tercero y común/diferido en pastillas, moneda, banco, cliente y
// rubro con el Selector propio, fechas con SelectorFecha y «Aceptar y cargar» en brand-cyan. La lógica no cambió.
// También la abren la Caja y su panel de pago.
const ETIQUETA = 'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const CAMPO = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';

/**
 * origenCaja: true cuando el cheque se da de alta desde un cobro de caja. En ese caso el
 * cobro genera su propio asiento (Valores a Depositar / Deudores), así que acá NO se
 * contabiliza: si no, el mismo cheque se asienta dos veces.
 */
export default function ChequeRecibirModal({ onClose, onSuccess, initialMonto = '', initialMonedaId = 1, initialCotizacion = null, origenCaja = false }) {
  const [bancos, setBancos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [loadingBancos, setLoadingBancos] = useState(true);
  const [procesando, setProcesando] = useState(false);
  // Aviso de cheque repetido (409 del backend): trae el cheque que ya estaba cargado.
  const [avisoDuplicado, setAvisoDuplicado] = useState(null);

  const [formData, setFormData] = useState({
    NumeroCheque: '',
    IdBanco: '',
    Monto: initialMonto,
    // 1 = $ (peso uruguayo), 2 = US$. Antes no se preguntaba y el alta lo escribía fijo
    // en pesos: un cheque en dólares entraba a cartera con el importe leído como pesos.
    IdMoneda: String(initialMonedaId || 1),
    // TC del día. Solo se usa si el cheque es en US$: el asiento se lleva en pesos, así
    // que sin cotización un cheque de US$ 1.000 entra al mayor como $ 1.000.
    Cotizacion: initialCotizacion ? String(initialCotizacion) : '',
    FechaEmision: new Date().toISOString().split('T')[0],
    FechaVencimiento: new Date().toISOString().split('T')[0],
    IdClienteOrigen: '',
    Agencia: '',
    EmitidoPor: '',
    EndosadoPor: '',
    EsPagoParcial: false,
    CategoriaPropiedad: 'Tercero',
    ClasificacionPlazo: 'Común',
    RubroContableId: ''
  });

  useEffect(() => {
    fetchBancos();
    fetchClientes();
    fetchCuentas();
    // TC del día para los cheques en US$ (desde caja lo manda el panel del cobro).
    if (!initialCotizacion) {
      api.get('/contabilidad/cotizacion-hoy')
        .then(r => {
          const tc = r.data?.cotizacion ?? r.data?.data?.cotizacion;
          if (tc) setFormData(f => (f.Cotizacion ? f : { ...f, Cotizacion: String(tc) }));
        })
        .catch(() => {});
    }
  }, []);

  const fetchBancos = async () => {
    try {
      const res = await api.get('/tesoreria/bancos');
      setBancos(res.data.data || []);
    } catch (e) {
      toast.error('Error cargando bancos');
    } finally {
      setLoadingBancos(false);
    }
  };

  const fetchClientes = async () => {
    try {
      const res = await api.get('/clients');
      setClientes(res.data || []);
    } catch (e) {
      console.error('Error cargando clientes:', e);
    }
  };

  const fetchCuentas = async () => {
    try {
      const res = await api.get('/contabilidad/erp/cuentas');
      setCuentas(res.data.data || []);
    } catch (e) {
      console.error('Error cargando rubros:', e);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
  };

  const handleSubmit = async (e, confirmarDuplicado = false) => {
    e.preventDefault();
    if (!formData.NumeroCheque || !formData.IdBanco || !formData.Monto) {
      return toast.error('Completar campos obligatorios');
    }
    // Sin TC el cheque en dólares entra al Libro Mayor (que lleva pesos) por el importe
    // en dólares, sin convertir.
    if (String(formData.IdMoneda) === '2' && !(parseFloat(formData.Cotizacion) > 0)) {
      return toast.error('Falta la cotización del dólar: sin ella el cheque en US$ se contabiliza como si fueran pesos.');
    }
    setProcesando(true);
    try {
      const payload = {
        ...formData,
        Monto: parseFloat(formData.Monto),
        IdMoneda: parseInt(formData.IdMoneda) || 1,
        Cotizacion: parseFloat(formData.Cotizacion) || 1,
        IdClienteOrigen: formData.IdClienteOrigen ? parseInt(formData.IdClienteOrigen) : null,
        RubroContableId: formData.RubroContableId ? parseInt(formData.RubroContableId) : null,
        contabilizar: !origenCaja,
        confirmarDuplicado,
      };

      const res = await api.post('/tesoreria/cheques/recibir', payload);
      toast.success(res.data.message || 'Cheque ingresado correctamente');
      onSuccess(res.data.data.IdCheque);
    } catch (error) {
      // El backend frena el cheque repetido: se le muestra el que ya está cargado y decide.
      if (error.response?.status === 409 && error.response?.data?.requiereConfirmacion) {
        setProcesando(false);
        setAvisoDuplicado(error.response.data);
        return;
      }
      toast.error(error.response?.data?.error || 'Error al guardar el cheque');
    } finally {
      setProcesando(false);
    }
  };


  // ── Piezas del render ───────────────────────────────────────────────────────
  // Las opciones (propio/tercero, común/diferido, pago parcial) llaman al mismo handleChange que los inputs.
  const elegir = (name, value) => handleChange({ target: { name, value } });
  const Segmento = ({ name, opciones }) => (
    <div className="grid grid-cols-2 rounded-xl border border-zinc-200 bg-white p-1 gap-1" role="radiogroup">
      {opciones.map(o => (
        <button key={o} type="button" role="radio" aria-checked={formData[name] === o} onClick={() => elegir(name, o)}
          className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${formData[name] === o ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
          {o}
        </button>
      ))}
    </div>
  );

  return (
    // z-[6000]: con z-50 quedaba debajo de la barra de arriba (5010) y el título se tapaba (27/10)
    <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3">
            <Landmark size={24} className="text-brand-cyan shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-black text-zinc-900 tracking-tight">Recibir cheque</h2>
              <p className="text-sm text-zinc-500">Datos detallados del documento</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5 overflow-y-auto">

          {/* Fila superior: opciones y montos */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start">

            {/* Opciones de tipo */}
            <div className="sm:col-span-4 flex flex-col gap-3">
              <div>
                <span className={ETIQUETA}>Cheque</span>
                <Segmento name="CategoriaPropiedad" opciones={['Propio', 'Tercero']} />
              </div>
              <div>
                <span className={ETIQUETA}>Plazo</span>
                <Segmento name="ClasificacionPlazo" opciones={['Común', 'Diferido']} />
              </div>
            </div>

            {/* Monto y cheque */}
            <div className="sm:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="recibir-numero" className={ETIQUETA}>
                  <Hash size={12} /> Cheque Nº *
                </label>
                <input id="recibir-numero" type="text" name="NumeroCheque" value={formData.NumeroCheque} onChange={handleChange} required placeholder="Ej. 12345678" className={`${CAMPO} font-mono`} />
              </div>
              <div>
                <label htmlFor="recibir-monto" className={ETIQUETA}>
                  <DollarSign size={12} /> Importe *
                </label>
                <div className="flex gap-2">
                  {/* Moneda del cheque: sin esto un cheque en dólares entraba a cartera
                      con el importe contado como pesos.
                      Desde caja NO se elige: es la moneda de la línea de pago. Si se
                      pudiera cambiar acá, el cheque quedaría en US$ y el recibo y el
                      saldo del cliente en $ (o al revés). */}
                  {origenCaja ? (
                    <div className="w-[84px] shrink-0 border border-zinc-200 bg-zinc-50 rounded-xl px-2 py-2.5 text-sm font-black text-zinc-500 text-center"
                      title="Moneda del cobro. Para cargar un cheque en otra moneda, cambiá la moneda de la operación.">
                      {String(formData.IdMoneda) === '2' ? 'US$' : '$'}
                    </div>
                  ) : (
                    <Selector filtro resaltar={false} name="IdMoneda" className="w-[84px] shrink-0" value={String(formData.IdMoneda)} onChange={handleChange}
                      title="Moneda en la que está escrito el cheque" aria-label="Moneda del cheque" anchoLista={120}>
                      <option value="1">$</option>
                      <option value="2">US$</option>
                    </Selector>
                  )}
                  <input id="recibir-monto" type="number" step="0.01" name="Monto" value={formData.Monto} onChange={handleChange} required placeholder="0.00" className={`${CAMPO} font-black tabular-nums`} />
                </div>
                {origenCaja && (
                  <p className="text-[11px] text-zinc-400 mt-1.5">
                    Se carga en {String(formData.IdMoneda) === '2' ? 'US$' : '$'} porque es la moneda del cobro. Si el
                    cheque está en la otra moneda, cerrá y cambiá la moneda de la operación.
                  </p>
                )}
                {/* El asiento del cheque se lleva en pesos: sin TC, US$ 1.000 entran al mayor como $ 1.000. */}
                {String(formData.IdMoneda) === '2' && (
                  <div className="mt-2.5">
                    <label htmlFor="recibir-cotizacion" className="block text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1.5">
                      Cotización del día * <span className="normal-case tracking-normal font-semibold text-amber-600/80">(1 US$ = $ …)</span>
                    </label>
                    <input id="recibir-cotizacion" type="number" step="0.01" name="Cotizacion" value={formData.Cotizacion} onChange={handleChange}
                      placeholder="Ej. 40.50"
                      className="w-full px-3 py-2 bg-amber-50/60 border border-amber-200 rounded-xl text-sm font-black text-amber-900 tabular-nums focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
                    <p className="text-[11px] text-amber-700/80 mt-1">
                      Con este tipo de cambio se contabiliza el cheque.
                      {parseFloat(formData.Monto) > 0 && parseFloat(formData.Cotizacion) > 0
                        ? ` US$ ${formData.Monto} = $ ${(parseFloat(formData.Monto) * parseFloat(formData.Cotizacion)).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
                        : ''}
                    </p>
                  </div>
                )}
              </div>

              <div className="sm:col-span-2">
                <button type="button" role="checkbox" aria-checked={!!formData.EsPagoParcial}
                  onClick={() => handleChange({ target: { name: 'EsPagoParcial', type: 'checkbox', checked: !formData.EsPagoParcial } })}
                  className={`w-full flex items-center gap-2.5 text-left text-sm font-bold p-3 rounded-xl border transition-colors ${formData.EsPagoParcial ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'}`}>
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${formData.EsPagoParcial ? 'bg-amber-500 border-amber-500 text-white' : 'border-zinc-300 bg-white'}`}>
                    {formData.EsPagoParcial && <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>}
                  </span>
                  El importe corresponde a un pago parcial y no al total del cheque
                </button>
              </div>
            </div>

          </div>

          <hr className="border-zinc-100" />

          {/* Datos bancarios */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-8">
              <span className={ETIQUETA}>
                <Landmark size={12} /> Banco emisor *
              </span>
              <Selector name="IdBanco" className="w-full" value={String(formData.IdBanco)} onChange={handleChange} aria-label="Banco emisor" anchoLista={260}>
                <option value="">{loadingBancos ? 'Cargando bancos…' : 'Seleccione un banco...'}</option>
                {bancos.map(b => <option key={b.IdBanco} value={String(b.IdBanco)}>{b.NombreBanco}</option>)}
              </Selector>
            </div>
            <div className="sm:col-span-4">
              <label htmlFor="recibir-agencia" className={ETIQUETA}>
                <Building2 size={12} /> Agencia
              </label>
              <input id="recibir-agencia" type="text" name="Agencia" value={formData.Agencia} onChange={handleChange} placeholder="Ej. Casa Central" className={CAMPO} />
            </div>
          </div>

          {/* Firmantes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="recibir-emitido" className={ETIQUETA}>
                <PenTool size={12} /> Emitido por
              </label>
              <input id="recibir-emitido" type="text" name="EmitidoPor" value={formData.EmitidoPor} onChange={handleChange} placeholder="Titular de la cuenta" className={CAMPO} />
            </div>
            <div>
              <label htmlFor="recibir-endosado" className={ETIQUETA}>
                <PenTool size={12} /> Endosado por
              </label>
              <input id="recibir-endosado" type="text" name="EndosadoPor" value={formData.EndosadoPor} onChange={handleChange} placeholder="Si aplica" className={CAMPO} />
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className={ETIQUETA}>
                <Calendar size={12} /> Emisión *
              </span>
              <SelectorFecha name="FechaEmision" className="w-full" value={formData.FechaEmision} onChange={handleChange} aria-label="Fecha de emisión" />
            </div>
            <div>
              <span className={ETIQUETA}>
                <Calendar size={12} className="text-brand-cyan" /> Vencimiento *
              </span>
              <SelectorFecha name="FechaVencimiento" className="w-full" value={formData.FechaVencimiento} onChange={handleChange} aria-label="Fecha de vencimiento" />
            </div>
          </div>

          {/* Rubros contables */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-4">
            <h4 className="text-[11px] font-black text-zinc-500 mb-3 uppercase tracking-widest flex items-center gap-2"><Book size={14} className="text-brand-cyan" /> Rubros contables</h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className={ETIQUETA}>
                  <User size={12} /> Cliente / origen
                </span>
                <Selector name="IdClienteOrigen" className="w-full" value={String(formData.IdClienteOrigen)} onChange={handleChange} aria-label="Cliente u origen" anchoLista={320}>
                  <option value="">(Opcional) Seleccione cliente...</option>
                  {/* /clients devuelve CliIdCliente / Nombre / NombreFantasia. Con los
                      nombres viejos (IdCliente / RazonSocial) la lista salía en blanco. */}
                  {clientes.map(c => (
                    <option key={c.CliIdCliente} value={String(c.CliIdCliente)}>
                      {(c.Nombre || '').trim()}{c.NombreFantasia && c.NombreFantasia.trim() !== (c.Nombre || '').trim() ? ` — ${c.NombreFantasia.trim()}` : ''}
                    </option>
                  ))}
                </Selector>
              </div>
              <div>
                <span className={ETIQUETA}>
                  <Book size={12} /> Rubro debe
                </span>
                <Selector name="RubroContableId" className="w-full" value={String(formData.RubroContableId)} onChange={handleChange} aria-label="Rubro debe" anchoLista={340}>
                  <option value="">(Opcional) Seleccione rubro...</option>
                  {cuentas.map(c => <option key={c.CueIdCuenta} value={String(c.CueIdCuenta)}>[{c.CueCodigo}] {c.CueNombre}</option>)}
                </Selector>
              </div>
            </div>
          </div>

        </form>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-100 bg-white flex justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className={BTN_SECUNDARIO}>
            Cancelar
          </button>
          <button type="button" onClick={handleSubmit} disabled={procesando} className={BTN_PRINCIPAL}>
            {procesando ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : <><CheckCircle size={15} /> Aceptar y cargar</>}
          </button>
        </div>
      </div>

      {/* Cheque repetido — se avisa antes de duplicarlo en cartera */}
      {avisoDuplicado && (
        <div className="fixed inset-0 z-[6010] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={22} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-black text-zinc-900 text-lg leading-tight">Este cheque ya está cargado</h3>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mt-0.5">N° <span className="font-mono">{formData.NumeroCheque}</span></p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 leading-relaxed">
              {avisoDuplicado.mensaje}
              <div className="mt-2 font-bold">
                Si es el mismo cheque, cargarlo de nuevo lo va a contar dos veces en cartera
                {!origenCaja && ' y le va a cancelar al cliente una deuda que no pagó'}.
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => { setAvisoDuplicado(null); handleSubmit({ preventDefault: () => {} }, true); }}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-white text-sm font-bold text-amber-700 hover:bg-amber-50 transition-colors"
              >
                Es otro cheque, cargarlo igual
              </button>
              <button type="button" onClick={() => setAvisoDuplicado(null)} className={BTN_PRINCIPAL}>
                Volver y revisar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
