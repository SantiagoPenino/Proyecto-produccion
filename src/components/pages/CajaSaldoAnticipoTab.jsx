import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Loader2, User, Trash2, Wallet, AlertCircle, CheckCircle2, Printer } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import ClienteBilletera from '../common/ClienteBilletera';
import CajaPanelPago from './CajaPanelPago';

/* ── Pill switch de moneda ────────────────────────────────────────────────── */
function MonedaSwitch({ value, onChange }) {
  const opts = [
    { id: 'UYU', label: 'UYU', sub: '($)' },
    { id: 'USD', label: 'USD', sub: '(US$)' },
  ];
  return (
    <div className="inline-flex items-center bg-zinc-100 border border-zinc-200 rounded-2xl p-1 gap-1 shadow-inner">
      {opts.map(o => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`
              flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-black tracking-wide transition-all duration-200
              ${active
                ? 'bg-white text-zinc-900 shadow-md shadow-zinc-200/80 border border-zinc-200 scale-[1.02]'
                : 'text-zinc-400 hover:text-zinc-600 hover:bg-white/50'
              }
            `}
          >
            <span>{o.label}</span>
            <span className={`text-[10px] font-bold ${active ? 'text-zinc-400' : 'text-zinc-300'}`}>{o.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * CajaSaldoAnticipoTab
 * Registra un ANTICIPO (saldo a favor) usando /caja/pago-anticipo.
 * La moneda se elige UNA sola vez con el pill-switch; el panel de pago
 * hereda esa moneda y no muestra el selector por-línea (lockMoneda).
 */
export default function CajaSaldoAnticipoTab({ sesion, metodosPago, cotizacion, onCobroCompletado }) {
  /* ── cliente ─────────────────────────────────────────────────────────────── */
  const [qCliente, setQCliente]             = useState('');
  const [buscandoCli, setBuscandoCli]       = useState(false);
  const [clientesRes, setClientesRes]       = useState([]);
  const [clienteSel, setClienteSel]         = useState(null);
  const [cuentaId, setCuentaId]             = useState(null);
  const [buscandoCuenta, setBuscandoCuenta] = useState(false);

  /* ── formulario ──────────────────────────────────────────────────────────── */
  const [importe, setImporte]       = useState('');
  const [moneda, setMoneda]         = useState('UYU');
  const [concepto, setConcepto]     = useState('');
  const [procesando, setProcesando] = useState(false);

  /* ── panel de pago ───────────────────────────────────────────────────────── */
  const [pagos, setPagos]                 = useState([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [observaciones, setObservaciones] = useState('');
  const [tipoComprobante, setTipoComprobante] = useState('RECIBO_ANTICIPO');

  const searchTimeout = useRef(null);

  /* ── inicializar método de pago ─────────────────────────────────────────── */
  useEffect(() => {
    if (metodosPago?.length > 0 && !pagos[0].metodoPagoId) {
      const mp = metodosPago.find(m => /contado/i.test(m.MPaDescripcionMetodo)) || metodosPago[0];
      setPagos([{ id: Date.now(), metodoPagoId: mp.MPaIdMetodoPago, moneda, monedaId: moneda === 'USD' ? 2 : 1, monto: '' }]);
    }
  }, [metodosPago]);

  /* ── cuando cambia la moneda → sincronizar todos los pagos ──────────────── */
  useEffect(() => {
    setPagos(prev => prev.map(p => ({ ...p, moneda, monedaId: moneda === 'USD' ? 2 : 1 })));
    if (clienteSel) buscarCuenta(clienteSel.CliIdCliente, moneda);
  }, [moneda]);

  /* ── búsqueda de clientes ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!qCliente.trim()) { setClientesRes([]); return; }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setBuscandoCli(true);
      try {
        const res = await api.get(`/contabilidad/clientes-activos?q=${encodeURIComponent(qCliente)}&tipo=TODOS`);
        setClientesRes(Array.isArray(res.data?.data) ? res.data.data : []);
      } catch { toast.error('Error buscando clientes'); }
      finally { setBuscandoCli(false); }
    }, 400);
  }, [qCliente]);

  /* ── buscar cuenta corriente del cliente ─────────────────────────────────── */
  const buscarCuenta = useCallback(async (cliId, monStr) => {
    setBuscandoCuenta(true);
    setCuentaId(null);
    try {
      const tipo = monStr === 'USD' ? 'DINERO_USD' : 'DINERO_UYU';
      const res = await api.get(`/contabilidad/cuentas/${cliId}`);
      const cuentas = Array.isArray(res.data?.data) ? res.data.data : (res.data || []);
      const cuenta = cuentas.find(c => c.CueTipo === tipo);
      if (cuenta) setCuentaId(cuenta.CueIdCuenta);
    } catch { /* el backend crea la cuenta si no existe */ }
    finally { setBuscandoCuenta(false); }
  }, []);

  const seleccionarCliente = (c) => {
    setClienteSel(c);
    setClientesRes([]);
    setQCliente('');
    buscarCuenta(c.CliIdCliente, moneda);
  };

  /* ── procesar anticipo ───────────────────────────────────────────────────── */
  const handleProcesar = async () => {
    if (!clienteSel) return toast.warning('Debe seleccionar un cliente.');
    const importeNum = parseFloat(importe) || 0;
    if (importeNum <= 0) return toast.warning('El importe debe ser mayor a 0.');

    const pagosValidos = pagos.filter(p => parseFloat(p.monto) > 0 && p.metodoPagoId);
    if (pagosValidos.length === 0) return toast.warning('Debe ingresar al menos un método de pago.');

    const totalPagado = pagosValidos.reduce((acc, p) => acc + (parseFloat(p.monto) || 0), 0);
    const diferencia  = importeNum - totalPagado;
    const tolerancia  = moneda === 'USD' ? 0.05 : 1.0;
    if (diferencia > tolerancia) {
      return toast.warning(`Falta cubrir ${moneda === 'USD' ? 'U$S' : '$'} ${diferencia.toFixed(2)}.`);
    }

    setProcesando(true);
    try {
      const res = await api.post('/contabilidad/caja/pago-anticipo', {
        clienteId:    clienteSel.CliIdCliente,
        cuentaId:     cuentaId || null,
        importe:      importeNum,
        metodoPagoId: parseInt(pagosValidos[0].metodoPagoId),
        monedaId:     moneda === 'USD' ? 2 : 1,
        concepto:     observaciones || concepto || 'Ingreso de saldo anticipado',
      });

      toast.success(res.data?.message || '✅ Anticipo registrado como saldo a favor.');

      // ── Generar y abrir el recibo en PDF automáticamente (solo si eligieron "Recibo") ───
      if (res.data?.movId && tipoComprobante === 'RECIBO_ANTICIPO') {
        try {
          const pdfRes = await api.get(`/contabilidad/movimientos/${res.data.movId}/recibo/pdf`, {
            responseType: 'blob'
          });
          const blob = new Blob([pdfRes.data], { type: 'application/pdf' });
          const url  = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Recibo-Anticipo-${res.data.movId}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          toast.success('📄 Recibo descargado correctamente.');
        } catch {
          // Si falla el PDF, solo avisamos — el anticipo ya se registró OK
          toast.warning('Anticipo registrado. No se pudo generar el PDF del recibo.');
        }
      }

      setImporte('');
      setConcepto('');
      setObservaciones('');
      const mp = metodosPago.find(m => /contado/i.test(m.MPaDescripcionMetodo)) || metodosPago?.[0];
      setPagos([{ id: Date.now(), metodoPagoId: mp?.MPaIdMetodoPago || '', moneda, monedaId: moneda === 'USD' ? 2 : 1, monto: '' }]);
      if (onCobroCompletado) onCobroCompletado(res.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al registrar el anticipo');
    } finally {
      setProcesando(false);
    }
  };

  const importeNum = parseFloat(importe) || 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-zinc-50">
      {clienteSel && (
        <div className="px-5 py-1 border-b border-zinc-200 bg-white/80 sticky top-0 z-20 shrink-0 shadow-sm">
          <ClienteBilletera clienteId={clienteSel.CliIdCliente} clienteNombre={clienteSel.Nombre} />
        </div>
      )}

      <div className="flex-1 p-0 overflow-y-auto w-full flex flex-col">
        <div className="flex flex-col md:flex-row gap-0 w-full flex-1 bg-white">

          {/* ── COLUMNA IZQUIERDA ──────────────────────────────────────────── */}
          <div className="flex flex-col flex-1 border-r border-zinc-200 min-w-0">

            {/* Encabezado con título y pill-switch de moneda */}
            <div className="flex items-center justify-between px-6 pt-6 pb-2 shrink-0 flex-wrap gap-3">
              <h2 className="text-2xl font-black text-zinc-800 flex items-center gap-3">
                <div className="bg-blue-500/10 p-2 rounded-xl border border-blue-500/20">
                  <Wallet size={24} className="text-blue-500" />
                </div>
                Ingreso de Saldo Anticipado
              </h2>
              {/* ── PILL SWITCH MONEDA ── */}
              <MonedaSwitch value={moneda} onChange={setMoneda} />
            </div>

            {/* Aviso */}
            <div className="mx-6 mb-4 mt-2 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3 flex items-start gap-3">
              <AlertCircle className="text-blue-500 shrink-0 mt-0.5" size={18} />
              <p className="text-blue-700 text-xs font-medium leading-relaxed">
                Registra dinero a <strong>favor del cliente</strong> (anticipo / seña).{' '}
                El saldo queda disponible para descontarse de futuras facturas o deudas.{' '}
                <strong>No genera deuda — genera crédito.</strong>
              </p>
            </div>

            {/* 1. Cliente */}
            <div className="bg-white border-b border-zinc-200 p-6 shrink-0">
              <h3 className="font-black text-zinc-400 text-[11px] uppercase tracking-widest mb-6 font-archivo">
                1. Seleccionar Cliente
              </h3>

              {!clienteSel ? (
                <div className="relative">
                  <div className="flex items-center bg-zinc-50 border-2 border-zinc-100 rounded-2xl px-5 py-2 focus-within:border-blue-400 focus-within:bg-white focus-within:ring-8 focus-within:ring-blue-400/5 transition-all">
                    <Search size={22} className="text-zinc-400" />
                    <input
                      value={qCliente}
                      onChange={e => setQCliente(e.target.value)}
                      placeholder="Buscar por Nombre, RUC o Código..."
                      className="w-full bg-transparent text-zinc-800 px-4 py-3 outline-none text-base font-bold placeholder-zinc-400"
                    />
                    {buscandoCli && <Loader2 size={20} className="text-blue-400 animate-spin" />}
                  </div>

                  {clientesRes.length > 0 && (
                    <div className="absolute top-full mt-3 left-0 right-0 bg-white border border-zinc-200 rounded-3xl shadow-xl z-50 max-h-96 overflow-y-auto">
                      {clientesRes.map(c => (
                        <div key={c.CliIdCliente} onClick={() => seleccionarCliente(c)}
                          className="w-full text-left px-6 py-5 hover:bg-blue-50 cursor-pointer border-b border-zinc-50 last:border-0 flex items-center gap-5 transition-all group">
                          <div className="w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center font-black text-zinc-400 border border-zinc-200 group-hover:bg-white group-hover:border-blue-300 group-hover:text-blue-500 transition-all shrink-0">
                            {c.Nombre?.[0] || 'C'}
                          </div>
                          <div>
                            <span className="text-zinc-900 font-black text-lg group-hover:text-blue-600 transition-colors">{c.Nombre}</span>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] bg-zinc-100 text-zinc-500 px-2.5 py-1 rounded-md font-mono font-black uppercase border border-zinc-200">
                                ID: {c.CliIdCliente}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between bg-blue-500/5 border-2 border-blue-500/20 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-3xl bg-white flex items-center justify-center text-blue-500 shadow-xl border border-blue-500/20 ring-4 ring-blue-500/10">
                      <User size={32} />
                    </div>
                    <div>
                      <p className="text-zinc-900 text-xl font-black leading-tight tracking-tight">{clienteSel.Nombre}</p>
                      <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1">ID: {clienteSel.CodCliente || clienteSel.CliIdCliente}</p>
                      {buscandoCuenta ? (
                        <p className="text-xs text-blue-400 mt-1 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Buscando cuenta...</p>
                      ) : cuentaId ? (
                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={11} /> Cuenta {moneda} #{cuentaId}</p>
                      ) : (
                        <p className="text-xs text-amber-600 mt-1">⚠ Se creará cuenta {moneda} automáticamente</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => { setClienteSel(null); setCuentaId(null); }}
                    className="bg-white hover:bg-rose-50 text-zinc-400 hover:text-rose-600 p-4 rounded-2xl transition-all border border-zinc-200 hover:border-rose-200 shadow-sm hover:shadow-md"
                  >
                    <Trash2 size={24} />
                  </button>
                </div>
              )}
            </div>

            {/* 2. Importe y Concepto */}
            <div className="bg-white p-6 flex flex-col gap-6 flex-1">
              <h3 className="font-black text-zinc-400 text-[11px] uppercase tracking-widest font-archivo">
                2. Importe a Acreditar
              </h3>

              <div>
                <label className="text-[10px] font-black tracking-widest uppercase text-zinc-400 ml-2 mb-2 block font-archivo">
                  Concepto / Servicio
                </label>
                <input
                  type="text"
                  value={concepto}
                  onChange={e => setConcepto(e.target.value)}
                  placeholder="Ej: Seña para pedido de junio, Anticipo cuota..."
                  className="w-full border-2 border-zinc-200 bg-white rounded-2xl px-5 py-4 focus:border-blue-400 focus:ring-4 focus:ring-blue-400/5 outline-none text-base font-bold text-zinc-800 transition-all placeholder-zinc-400"
                />
              </div>

              <div>
                <label className="text-[10px] font-black tracking-widest uppercase text-zinc-400 ml-2 mb-2 block font-archivo">
                  Importe ({moneda === 'USD' ? 'U$S' : '$'})
                </label>
                {/* Input de monto sin selector de moneda — ya está el pill-switch arriba */}
                <div className="flex rounded-2xl overflow-hidden border-2 border-zinc-200 bg-white focus-within:border-blue-400 transition-colors focus-within:ring-4 focus-within:ring-blue-400/5">
                  {/* Badge de moneda fija — reflejo del switch */}
                  <div className="flex items-center px-4 bg-zinc-50 border-r border-zinc-200 shrink-0">
                    <span className="text-sm font-black text-zinc-500">
                      {moneda === 'USD' ? 'U$S' : '$'}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={importe}
                    onChange={e => setImporte(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-5 py-4 bg-transparent flex-1 outline-none font-black text-2xl text-zinc-800 placeholder-zinc-300"
                    min="0.01"
                    step="0.01"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── COLUMNA DERECHA: Panel de Pago (sin selector de moneda por línea) ── */}
          <div className="flex flex-col flex-1 bg-white min-w-0">
            <div className="bg-white rounded-none p-6 relative overflow-hidden flex flex-col justify-between flex-1">
              <h3 className="font-black text-zinc-400 text-[11px] uppercase tracking-widest mb-6 font-archivo">
                3. Cobro y Documentación
              </h3>

              <div className="flex-1 flex flex-col -mx-6 -mb-6 mt-4 border-t border-zinc-200">
                <CajaPanelPago
                  containerClassName="w-full flex flex-col h-full bg-zinc-50/50"
                  mode="VENTA"
                  metodosPago={metodosPago}
                  pagos={pagos}
                  onPagosChange={setPagos}
                  totalACubrir={importeNum}
                  moneda={moneda}
                  cotizacion={cotizacion}
                  procesando={procesando}
                  onConfirmar={handleProcesar}
                  notas={observaciones}
                  onNotas={setObservaciones}
                  tipoDoc={tipoComprobante}
                  onTipoDoc={setTipoComprobante}
                  tiposDocDisponibles={[
                    { value: 'RECIBO_ANTICIPO', label: 'Recibo de Pago (RC)' },
                    { value: 'NINGUNO',         label: 'Sin Comprobante Fiscal (Anticipo)' },
                  ]}
                  lockMoneda={moneda}
                  labelBoton="REGISTRAR ANTICIPO"
                />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
