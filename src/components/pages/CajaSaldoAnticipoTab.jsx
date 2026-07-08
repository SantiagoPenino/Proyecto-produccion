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
export default function CajaSaldoAnticipoTab({ sesion, metodosPago, cotizacion, onCobroCompletado, initialCliente, empresaId = null, isAdminCaja = false, hideClienteSelector = false, hideBilletera = false }) {
  /* ── cliente ─────────────────────────────────────────────────────────────── */
  const [qCliente, setQCliente]             = useState('');
  const [buscandoCli, setBuscandoCli]       = useState(false);
  const [clientesRes, setClientesRes]       = useState([]);
  const [clienteSel, setClienteSel]         = useState(initialCliente || null);
  const [cuentaId, setCuentaId]             = useState(null);
  const [buscandoCuenta, setBuscandoCuenta] = useState(false);

  const getClienteDisplayName = (c) => {
    if (!c) return '';
    const nom = c.Nombre?.trim();
    const fan = c.NombreFantasia?.trim();
    return nom || fan || 'Cliente sin nombre';
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.client-search-container')) {
        setClientesRes([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* ── formulario ──────────────────────────────────────────────────────────── */
  const [importe, setImporte]       = useState('');
  const [moneda, setMoneda]         = useState('UYU');
  const [concepto, setConcepto]     = useState('');
  const [procesando, setProcesando] = useState(false);

  /* ── panel de pago ───────────────────────────────────────────────────────── */
  const [pagos, setPagos]                 = useState([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [observaciones, setObservaciones] = useState('');
  const [tipoComprobante, setTipoComprobante] = useState('RECIBO_ANTICIPO');
  const [serieDoc, setSerieDoc]           = useState('RC');

  const handlePagosChange = (newPagos) => {
    setPagos(newPagos);
    const primaryMon = newPagos[0]?.moneda;
    if (primaryMon && primaryMon !== moneda) {
      setMoneda(primaryMon);
    }
  };

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

  useEffect(() => {
    if (initialCliente) {
      setClienteSel(initialCliente);
      buscarCuenta(initialCliente.CliIdCliente, moneda);
    }
  }, [initialCliente, buscarCuenta, moneda]);

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
        empresaId,
        admin:        isAdminCaja,   // true → EsCajaAdmin=1 (Caja Administrativa, fuera del arqueo central)
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
    <div className="flex flex-col lg:flex-row flex-1 overflow-hidden h-full min-h-0 bg-zinc-100">
      {/* ── PANEL LATERAL DE CLIENTES ── (se oculta cuando el cliente ya viene fijo, ej. Panel 360) */}
      <div className={`w-full lg:w-[360px] bg-white border-b lg:border-b-0 lg:border-r border-zinc-200 flex-col shrink-0 overflow-y-auto p-4 client-search-container ${hideClienteSelector ? 'hidden' : 'flex'}`}>
        <h3 className="font-black text-zinc-400 text-[11px] font-archivo uppercase tracking-widest mb-3 flex items-center justify-between">
          1. Seleccionar Cliente
          {clienteSel && <span className="text-emerald-600 flex items-center gap-1 text-[9px] font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Verificado <CheckCircle2 size={10}/></span>}
        </h3>

        {!clienteSel ? (
          <div className="flex flex-col gap-3">
            <div className="relative flex items-center group/search">
              <div className="absolute left-4 text-zinc-400 group-focus-within/search:text-brand-cyan transition-colors">
                <Search size={18} />
              </div>
              <input 
                  value={qCliente} 
                  onChange={e=>setQCliente(e.target.value)} 
                  placeholder="Buscar por Nombre, RUC/CI, Tel, IdCliente..." 
                  className="w-full bg-zinc-50 border border-zinc-200 hover:border-zinc-300 focus:border-blue-400 focus:bg-white rounded-xl pl-11 pr-4 py-2.5 text-sm font-bold text-zinc-800 placeholder-zinc-400 outline-none transition-all" 
              />
              {buscandoCli && <div className="absolute right-4"><Loader2 size={16} className="text-blue-400 animate-spin" /></div>}
            </div>

            {/* Listado de tarjetas de clientes encontrados */}
            <div className="flex flex-col gap-2 mt-2">
              {clientesRes.length > 0 ? (
                clientesRes.map(c => (
                  <div key={c.CliIdCliente} 
                    onClick={()=>seleccionarCliente(c)} 
                    className="w-full text-left p-3.5 bg-zinc-50 hover:bg-blue-50/5 border border-zinc-200 hover:border-blue-300/35 rounded-xl cursor-pointer transition-all flex flex-col gap-1.5 active:scale-[0.98] group"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-zinc-900 font-extrabold text-sm group-hover:text-blue-500 transition-colors leading-snug">{getClienteDisplayName(c)}</span>
                      <span className="text-[9px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded font-mono font-black">IdCliente: {c.IDCliente || c.CodCliente || c.CliIdCliente}</span>
                    </div>
                    {c.Nombre && c.NombreFantasia && c.Nombre.trim() !== c.NombreFantasia.trim() && (
                      <span className="text-[11px] text-zinc-500 font-semibold italic">"{c.NombreFantasia}"</span>
                    )}
                    <div className="flex flex-col gap-1 text-[11px] text-zinc-500 font-medium border-t border-zinc-200/60 pt-1.5 mt-0.5">
                      {c.CioRuc && <div className="flex items-center gap-1 font-semibold text-zinc-600">RUC / CI: <span className="font-mono text-[10px] text-zinc-950 font-extrabold">{c.CioRuc}</span></div>}
                      {c.Email && <div className="flex items-center gap-1 truncate">Email: <span className="font-mono text-[10px] text-zinc-700">{c.Email}</span></div>}
                      {c.TelefonoTrabajo && <div className="flex items-center gap-1 font-semibold text-zinc-600">Tel: <span className="font-mono text-[10px] text-zinc-700 font-bold">{c.TelefonoTrabajo}</span></div>}
                    </div>
                  </div>
                ))
              ) : qCliente.trim() ? (
                <div className="text-center py-6 text-zinc-400 text-xs font-semibold">No se encontraron clientes.</div>
              ) : (
                <div className="text-center py-6 text-zinc-400 text-xs font-semibold">Use el buscador para listar clientes...</div>
              )}
            </div>
          </div>
        ) : (
          /* Cliente Seleccionado */
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-blue-500 border border-blue-500/10">
                  <User size={20} />
                </div>
                <div>
                  <p className="text-zinc-900 text-sm font-extrabold leading-tight tracking-tight">{getClienteDisplayName(clienteSel)}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5 font-mono">
                    IdCliente: {clienteSel.IDCliente || clienteSel.CodCliente || clienteSel.CliIdCliente}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setClienteSel(null); setCuentaId(null); }} 
                className="bg-white hover:bg-rose-50 text-zinc-400 hover:text-rose-600 p-1.5 rounded-lg transition-all border border-zinc-200 hover:border-rose-200 shadow-sm"
                title="Quitar cliente"
              >
                <Trash2 size={16} />
              </button>
            </div>
            
            <div className="flex flex-col gap-1 text-[11px] text-zinc-500 font-medium border-t border-zinc-200/80 pt-2.5">
              {clienteSel.CioRuc && <div>RUC / CI: <span className="font-mono font-bold text-zinc-800">{clienteSel.CioRuc}</span></div>}
              {clienteSel.Email && <div className="truncate">Email: <span className="font-mono text-zinc-700">{clienteSel.Email}</span></div>}
              {clienteSel.TelefonoTrabajo && <div>Teléfono: <span className="font-mono text-zinc-700">{clienteSel.TelefonoTrabajo}</span></div>}
              {clienteSel.DireccionTrabajo && <div className="leading-tight">Dirección: <span className="text-zinc-700">{clienteSel.DireccionTrabajo}</span></div>}
              <div className="mt-1 pt-1.5 border-t border-zinc-100">
                {buscandoCuenta ? (
                  <p className="text-[11px] text-blue-500 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Buscando cuenta...</p>
                ) : cuentaId ? (
                  <p className="text-[11px] text-emerald-600 flex items-center gap-1 font-semibold"><CheckCircle2 size={11} /> Cuenta {moneda} #{cuentaId}</p>
                ) : (
                  <p className="text-[11px] text-amber-600 font-semibold">⚠ Se creará cuenta {moneda} automáticamente</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── CONTENIDO PRINCIPAL ── */}
      <div className="flex-1 flex flex-col min-h-0 h-full overflow-y-auto bg-zinc-50 p-4 gap-4">
        {/* BILLETERA DE CLIENTE STICKY */}
        {clienteSel && !hideBilletera && (
          <div className="px-5 py-1 border-b border-zinc-200 bg-white/80 sticky top-0 z-20 shrink-0 shadow-sm rounded-2xl mb-2">
            <ClienteBilletera 
              clienteId={clienteSel.CliIdCliente} 
              clienteNombre={getClienteDisplayName(clienteSel)} 
            />
          </div>
        )}

        {/* ── 2. PANEL DE COBRO (HORIZONTAL) ── */}
        <CajaPanelPago
          layout="horizontal"
          mode="VENTA"
          metodosPago={metodosPago}
          pagos={pagos}
          onPagosChange={handlePagosChange}
          totalACubrir={importeNum}
          moneda={moneda}
          cotizacion={cotizacion}
          procesando={procesando}
          onConfirmar={handleProcesar}
          notas={observaciones}
          onNotas={setObservaciones}
          tipoDoc={tipoComprobante}
          onTipoDoc={setTipoComprobante}
          serieDoc={serieDoc}
          onSerieDoc={setSerieDoc}
          tiposDocDisponibles={[
            { value: 'RECIBO_ANTICIPO', label: 'Recibo' },
          ]}
          labelBoton="REGISTRAR ANTICIPO"
        />

        {/* ── 1. FORMULARIO DE IMPORTE A ACREDITAR ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col gap-6">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <h2 className="text-xl font-black text-zinc-800 flex items-center gap-3">
              <div className="bg-blue-500/10 p-2 rounded-xl border border-blue-500/20">
                <Wallet size={20} className="text-blue-500" />
              </div>
              Ingreso de Saldo Anticipado
            </h2>
          </div>

          {/* Aviso */}
          <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3 flex items-start gap-3">
            <AlertCircle className="text-blue-500 shrink-0 mt-0.5" size={18} />
            <p className="text-blue-700 text-xs font-medium leading-relaxed">
              Registra dinero a <strong>favor del cliente</strong> (anticipo / seña).{' '}
              El saldo queda disponible para descontarse de futuras facturas o deudas.{' '}
              <strong>No genera deuda — genera crédito.</strong>
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                Importe
              </label>
              <input
                type="number"
                value={importe}
                onChange={e => setImporte(e.target.value)}
                placeholder="0.00"
                className="w-full border-2 border-zinc-200 bg-white rounded-2xl px-5 py-4 focus:border-blue-400 focus:ring-4 focus:ring-blue-400/5 outline-none font-black text-2xl text-zinc-800 transition-all placeholder-zinc-300"
                min="0.01"
                step="0.01"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
