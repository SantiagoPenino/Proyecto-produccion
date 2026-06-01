import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Search, CheckCircle, FileMinus, CreditCard, X, CheckSquare, Square,
  ArrowDownCircle, User, AlertTriangle, AlertCircle
} from 'lucide-react';
import api from '../../services/apiClient';
import CajaPanelPago from './CajaPanelPago';

const fmt  = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = (f) => f ? new Date(f).toLocaleDateString('es-UY', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';

const TIPOS_DOC_PAGO = [
  { value: '05', label: 'Recibo' },
];
export default function CajaPagoDeudaTab({ sesion, metodosPago = [], cotizacion = 1, tiposDocDisponibles = TIPOS_DOC_PAGO, onPagoCompletado, isAdminCaja, initialCliente, initialDocumento }) {

  // ─── Estado ─────────────────────────────────────────────────────────────
  const [qCliente, setQCliente]         = useState('');
  const [deudas, setDeudas]             = useState([]);
  const [cargandoDeudas, setCargandoDeudas] = useState(true);
  const [seleccionadas, setSeleccionadas]   = useState([]);

  // ─── Pago ─────────────────────────────────────────────────────────────────
  const [pagos, setPagos]         = useState([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [tipoDoc, setTipoDoc]     = useState('05');
  const [serieDoc, setSerieDoc]   = useState('A');
  const [observaciones, setObservaciones] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [pendienteParcial, setPendienteParcial] = useState(null); // { diferencia } cuando pago < deuda

  // ─── Derivados que los useEffects necesitan (deben declararse antes) ─────────────
  // NOTA: deudasSeleccionadas se recalcula debajo con más contexto,
  // pero necesitamos monedaDeuda aqui para los efectos de pago.
  const monedaDeuda = useMemo(() => {
    const sel = deudas.filter(d => seleccionadas.includes(d.DDeIdDocumento));
    return sel.some(d => (d.MonSimbolo || '').includes('US') || d.CueTipo === 'DINERO_USD') ? 'USD' : 'UYU';
  }, [deudas, seleccionadas]);
  const simboloDeuda = monedaDeuda === 'USD' ? 'US$' : '$U';

  // ─── Auto-seleccionar primer método de pago ──────────────────────────────
  useEffect(() => {
    if (metodosPago.length > 0 && !pagos[0].metodoPagoId) {
      const contado = metodosPago.find(m => /contado|efectivo/i.test(m.MPaDescripcionMetodo));
      const def = contado || metodosPago[0];
      setPagos([{ id: Date.now(), metodoPagoId: def.MPaIdMetodoPago, moneda: monedaDeuda, monedaId: monedaDeuda === 'USD' ? 2 : 1, monto: '' }]);
    }
  }, [metodosPago]);

  // ─── Sincronizar moneda del pago cuando cambia la moneda de las deudas ────
  useEffect(() => {
    // Solo sincronizar si el monto está vacío (el usuario no tocó nada aún)
    setPagos(prev => prev.map(p =>
      p.monto === '' ? { ...p, moneda: monedaDeuda, monedaId: monedaDeuda === 'USD' ? 2 : 1 } : p
    ));
  }, [monedaDeuda]);

  // ─── Cargar TODAS las deudas inicialmente ──────────────────────────────────
  const cargarDeudas = async () => {
    setCargandoDeudas(true);
    try {
      const res = await api.get(`/contabilidad/deudas-vivas`);
      setDeudas(res.data?.data || []);
      // Solo deseleccionar aquellas que ya no existen
      setSeleccionadas(prev => {
        const vivas = (res.data?.data || []).map(d => d.DDeIdDocumento);
        return prev.filter(id => vivas.includes(id));
      });
    } catch { 
      toast.error('Error cargando deudas pendientes'); 
    } finally { 
      setCargandoDeudas(false); 
    }
  };

  useEffect(() => {
    cargarDeudas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (deudas.length > 0) {
      if (initialDocumento) {
        const matchingDeuda = deudas.find(d => 
          (initialDocumento.DDeIdDocumento && d.DDeIdDocumento === initialDocumento.DDeIdDocumento) ||
          (initialDocumento.DocIdDocumento && d.DocIdDocumento === initialDocumento.DocIdDocumento) ||
          (initialDocumento.OrdIdOrden && d.OrdIdOrden === initialDocumento.OrdIdOrden)
        );
        if (matchingDeuda) {
          setSeleccionadas([matchingDeuda.DDeIdDocumento]);
          if (matchingDeuda.ClienteNombre) {
            setQCliente(matchingDeuda.ClienteNombre);
          }
        } else if (initialCliente) {
          setQCliente(initialCliente.Nombre || initialCliente.CodCliente || '');
        }
      } else if (initialCliente) {
        setQCliente(initialCliente.Nombre || initialCliente.CodCliente || '');
      }
    }
  }, [deudas, initialCliente, initialDocumento]);

  // ─── Filtrado local ───────────────────────────────────────────────────────
  const deudasFiltradas = useMemo(() => {
    if (!qCliente.trim()) return deudas;
    const q = qCliente.toLowerCase();
    return deudas.filter(d => 
      (d.ClienteNombre || '').toLowerCase().includes(q) ||
      (d.ClienteCodigo || '').toString().toLowerCase().includes(q) ||
      (d.CodigoOrden || '').toLowerCase().includes(q)
    );
  }, [deudas, qCliente]);

  // ─── Toggle selección ─────────────────────────────────────────────────────
  const toggleDeuda = (id) => {
    setSeleccionadas(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);

      const deudaNueva = deudas.find(d => d.DDeIdDocumento === id);
      if (prev.length > 0) {
        const deudaExistente = deudas.find(d => d.DDeIdDocumento === prev[0]);
        
        if (deudaNueva.CliIdCliente !== deudaExistente.CliIdCliente) {
          toast.warning('No puedes seleccionar deudas de diferentes clientes al mismo tiempo.');
          return prev;
        }

        const monedaNueva = (deudaNueva.MonSimbolo || '').includes('US') || deudaNueva.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU';
        const monedaExistente = (deudaExistente.MonSimbolo || '').includes('US') || deudaExistente.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU';

        if (monedaNueva !== monedaExistente) {
          toast.warning('No puedes mezclar deudas en Pesos y en Dólares. Cóbralas por separado.');
          return prev;
        }
      }
      return [...prev, id];
    });
  };

  const toggleTodas = () => {
    const validas = deudasFiltradas.map(d => d.DDeIdDocumento);
    const todasEstanSel = validas.length > 0 && validas.every(id => seleccionadas.includes(id));
    
    if (todasEstanSel) {
      // Desmarcar las de la vista actual
      setSeleccionadas(prev => prev.filter(id => !validas.includes(id)));
    } else {
      // Marcar todas, pero respetando moneda y cliente de la primera
      setSeleccionadas(prev => {
        let baseCliente = prev.length > 0 ? deudas.find(d => d.DDeIdDocumento === prev[0])?.CliIdCliente : deudasFiltradas[0]?.CliIdCliente;
        let baseMoneda = '';
        
        if (prev.length > 0) {
          const dEx = deudas.find(d => d.DDeIdDocumento === prev[0]);
          baseMoneda = (dEx.MonSimbolo || '').includes('US') || dEx.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU';
        } else if (deudasFiltradas.length > 0) {
          const dNueva = deudasFiltradas[0];
          baseMoneda = (dNueva.MonSimbolo || '').includes('US') || dNueva.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU';
        }

        const nuevasValidas = deudasFiltradas.filter(d => {
          if (d.CliIdCliente !== baseCliente) return false;
          const mon = (d.MonSimbolo || '').includes('US') || d.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU';
          return mon === baseMoneda;
        }).map(d => d.DDeIdDocumento);

        if (nuevasValidas.length < deudasFiltradas.length) {
          toast.info('Se seleccionaron solo las deudas que coinciden en cliente y moneda.');
        }

        return Array.from(new Set([...prev, ...nuevasValidas]));
      });
    }
  };

  // ─── Totales ─────────────────────────────────────────────────────────────
  const deudasSeleccionadas = deudas.filter(d => seleccionadas.includes(d.DDeIdDocumento));
  const totalAPagar        = deudasSeleccionadas.reduce((s, d) => s + Number(d.DDeImportePendiente), 0);
  
  const validasFiltradas   = deudasFiltradas.map(d => d.DDeIdDocumento);
  const todasSel           = validasFiltradas.length > 0 && validasFiltradas.every(id => seleccionadas.includes(id));

  // Como podemos seleccionar de varios clientes, detectamos el cliente principal para la caja
  const clientesInvolucrados = Array.from(new Set(deudasSeleccionadas.map(d => d.CliIdCliente)));
  const clientePrincipalId = clientesInvolucrados[0] || null;



  // ─── Badge de estado ─────────────────────────────────────────────────────
  const badgeEstado = (d) => {
    const dias = Number(d.DiasVencido || 0);
    if (dias > 30) return { label: `${dias}d vencida`, cls: 'bg-red-100 text-red-700 border-red-200' };
    if (dias > 0)  return { label: `${dias}d vencida`, cls: 'bg-amber-100 text-amber-700 border-amber-200' };
    return { label: 'Al día', cls: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' };
  };

  // ─── Procesar pago ────────────────────────────────────────────────────────
  const handleProcesar = async (forzarParcial = false) => {
    if (seleccionadas.length === 0) return toast.warning('Seleccione al menos una deuda.');
    if (clientesInvolucrados.length > 1) {
      return toast.warning('Solo se pueden pagar deudas de un mismo cliente a la vez.');
    }
    
    const pagosValidos = pagos.filter(p => parseFloat(p.monto) > 0 && p.metodoPagoId);
    if (!pagosValidos.length)   return toast.warning('Ingrese al menos un método de pago.');

    const totalPagado = pagosValidos.reduce((a, p) => {
      const m = parseFloat(p.monto) || 0;
      if (monedaDeuda === 'USD') {
        // Deuda en USD → normalizar pago a USD (si pago es UYU, dividir por cotización)
        return a + (p.moneda === 'USD' ? m : m / (cotizacion || 1));
      } else {
        // Deuda en UYU → normalizar pago a UYU (si pago es USD, multiplicar por cotización)
        return a + (p.moneda === 'USD' ? m * (cotizacion || 1) : m);
      }
    }, 0);

    const diferencia = totalPagado - totalAPagar;

    // Pago de más → siempre error
    if (diferencia > 0.01)
      return toast.error(`El pago excede la deuda en ${simboloDeuda} ${diferencia.toFixed(2)}. Ajuste el monto.`);

    // Pago parcial → mostrar banner de confirmación (solo si NO viene de confirmar explícito)
    if (diferencia < -0.01 && !forzarParcial) {
      setPendienteParcial({ falta: Math.abs(diferencia), totalPagado });
      return;
    }

    setProcesando(true);
    try {
      const res = await api.post('/contabilidad/caja/pago-deuda', {
        header: {
          clienteId: clientePrincipalId,
          tipoDocumento: tipoDoc,
          serieDoc,
          moneda: monedaDeuda,          // ← moneda real de la deuda (USD o UYU)
          monedaId: monedaDeuda === 'USD' ? 2 : 1,
          observaciones: observaciones || `Pago de deudas combinadas`,
          admin: isAdminCaja
        },
        aplicaciones: deudasSeleccionadas.map(d => ({
          tipo: 'PAGO_DEUDA',
          codigoRef: `${d.CodigoOrden || d.OrdIdOrden || `Deuda #${d.DDeIdDocumento}`} ${d.NombreTrabajo || ''}`.trim(),
          descripcion: d.DocIdDocumento 
            ? `${d.CodigoOrden || 'Factura'}` 
            : (d.OrdIdOrden 
                ? `Orden ${d.CodigoOrden}${d.NombreTrabajo ? ` (${d.NombreTrabajo})` : ''}` 
                : `${d.CodigoOrden || `Deuda #${d.DDeIdDocumento}`}${d.NombreTrabajo ? ` — ${d.NombreTrabajo}` : ''}`),
          montoOriginal: Number(d.DDeImportePendiente),
          ddeId: d.DDeIdDocumento,
        })),
        pagos: pagosValidos.map(p => ({
          metodoPagoId: parseInt(p.metodoPagoId, 10),
          monedaId:     parseInt(p.monedaId, 10),
          montoOriginal: parseFloat(p.monto),
          cotizacion: p.monedaId === 2 ? cotizacion : 1,
        })),
      });

      toast.success(`Pago registrado: ${seleccionadas.length} deuda(s) por ${simboloDeuda}${fmt(totalPagado)}`);
      setSeleccionadas([]); setObservaciones(''); setPendienteParcial(null);
      setPagos([{ id: Date.now(), metodoPagoId: metodosPago[0]?.MPaIdMetodoPago || '', moneda: 'UYU', monedaId: 1, monto: '' }]);
      cargarDeudas();
      if (onPagoCompletado) onPagoCompletado(res.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al procesar el pago.');
    } finally { setProcesando(false); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-1 overflow-hidden min-w-0 h-full">

      {/* ─── 1. COLUMNA IZQUIERDA: Buscador + Lista de todas las deudas ───────────── */}
      <div className="w-[440px] border-r border-slate-200 flex flex-col bg-white shrink-0 shadow-lg z-10">

        {/* Buscador */}
        <div className="p-6 border-b border-slate-100 flex flex-col gap-5 bg-slate-50/50">
          <h3 className="font-black text-slate-400 text-[10px] uppercase tracking-widest flex items-center gap-2 px-1">
            <Search size={12}/> Buscar Deudas por Cliente
          </h3>

          <div className="relative group">
            <Search size={22} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-cyan transition-colors" />
            <input
              type="text"
              placeholder="Nombre de cliente o código..."
              value={qCliente}
              onChange={e => setQCliente(e.target.value)}
              className="bg-white border-2 border-slate-200 rounded-[1.5rem] pl-14 pr-6 py-4 text-base text-slate-900 placeholder-slate-400 outline-none w-full focus:border-brand-cyan focus:ring-8 focus:ring-brand-cyan/5 transition-all font-bold shadow-sm"
            />
          </div>
        </div>

        {/* Header Seleccionar/Desmarcar */}
        <div className="px-5 py-3 bg-slate-50/50 border-b border-slate-200 flex items-center justify-between shadow-sm z-10">
          <button onClick={toggleTodas}
            className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-brand-cyan transition-colors uppercase tracking-widest">
            {todasSel ? <CheckSquare size={14} className="text-brand-cyan" /> : <Square size={14} />}
            {todasSel ? 'Desmarcar a la vista' : 'Seleccionar a la vista'}
          </button>
          <span className="text-[10px] font-black text-slate-500 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
            {deudasFiltradas.length} deuda{deudasFiltradas.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 bg-[#f8fafc]">
          {cargandoDeudas ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-50">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-cyan"></div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Cargando deudas...</p>
            </div>
          ) : deudasFiltradas.length === 0 ? (
            <div className="m-auto text-center opacity-50 py-20">
              <CheckCircle size={48} className="mx-auto mb-4 text-brand-cyan" />
              <p className="text-sm font-black text-brand-cyan uppercase tracking-widest">Sin deudas a la vista</p>
              <p className="text-xs text-slate-400 font-medium mt-2">No hay deudas que coincidan con la búsqueda.</p>
            </div>
          ) : (
            deudasFiltradas.map(d => {
              const sel = seleccionadas.includes(d.DDeIdDocumento);
              const badge = badgeEstado(d);
              return (
                <div key={d.DDeIdDocumento} onClick={() => toggleDeuda(d.DDeIdDocumento)}
                  className={`cursor-pointer shrink-0 rounded-2xl p-4 border-2 transition-all flex flex-col gap-3.5 relative overflow-hidden group shadow-sm active:scale-[0.98]
                    ${sel ? 'border-brand-cyan bg-brand-cyan/5 ring-4 ring-brand-cyan/10' : 'border-slate-200 bg-white hover:border-brand-cyan/50 hover:shadow-md hover:-translate-y-0.5'}`}>

                  {/* Datos del Cliente */}
                  <div className="flex flex-col gap-1 border-b border-zinc-100 pb-2.5">
                    <div className="flex items-start justify-between">
                      <span className="text-zinc-900 font-extrabold text-sm group-hover:text-brand-cyan transition-colors leading-snug">
                        {d.ClienteNombre}
                      </span>
                      <span className="text-[9px] bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded font-mono font-black">
                        IdCliente: {d.ClienteIDCliente || d.ClienteCodigo || d.CliIdCliente}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 text-[11px] text-zinc-500 font-medium mt-1">
                      {d.ClienteRuc && (
                        <div className="flex items-center gap-1 font-semibold text-zinc-600">
                          RUC / CI: <span className="font-mono text-[10px] text-zinc-950 font-extrabold">{d.ClienteRuc}</span>
                        </div>
                      )}
                      {d.ClienteEmail && (
                        <div className="flex items-center gap-1 truncate">
                          Email: <span className="font-mono text-[10px] text-zinc-700">{d.ClienteEmail}</span>
                        </div>
                      )}
                      {d.ClienteTelefono && (
                        <div className="flex items-center gap-1 font-semibold text-zinc-600">
                          Tel: <span className="font-mono text-[10px] text-zinc-700 font-bold">{d.ClienteTelefono}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Datos de la Deuda */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center shrink-0 transition-all
                        ${sel ? 'border-brand-cyan bg-brand-cyan shadow-md shadow-brand-cyan/20' : 'border-slate-200 bg-slate-50 group-hover:border-brand-cyan/50 group-hover:bg-white'}`}>
                        {sel && <CheckCircle size={20} className="text-white" />}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className={`font-black text-sm transition-colors leading-tight tracking-tight truncate ${sel ? 'text-brand-cyan' : 'text-slate-800 group-hover:text-brand-cyan'}`}>
                          {d.NombreTrabajo || `Deuda #${d.DDeIdDocumento}`}
                        </span>
                        
                        {/* Tipo de Documento y Número / Orden */}
                        {d.DocIdDocumento ? (
                          <span className="text-[10px] font-extrabold text-blue-600 mt-1 uppercase tracking-wide">
                            Doc: {d.CodigoOrden}
                          </span>
                        ) : (
                          <span className="text-[10px] font-extrabold text-amber-600 mt-1 uppercase tracking-wide">
                            Orden: #{d.CodigoOrden || d.OrdIdOrden}
                          </span>
                        )}
                        
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
                          Vence: {fmtFecha(d.DDeFechaVencimiento)}
                        </span>
                        
                        {d.DocCliNombre && d.DocCliNombre.trim().toLowerCase() !== (d.ClienteNombre || '').trim().toLowerCase() && (
                          <span className="text-[9px] font-bold text-amber-600 mt-1 flex items-center gap-1">
                            <span className="uppercase font-black text-[8px] bg-amber-100 px-1 py-0.2 rounded text-amber-700">Facturado a:</span>
                            <span className="truncate max-w-[180px]" title={d.DocCliNombre}>{d.DocCliNombre}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="font-black text-right flex flex-col items-end shrink-0 gap-1.5">
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded border shadow-sm ${badge.cls}`}>{badge.label}</span>
                      <span className={`text-base font-black ${sel ? 'text-brand-cyan' : 'text-slate-850'}`}>
                        {d.MonSimbolo || '$'} {fmt(d.DDeImportePendiente)}
                      </span>
                    </div>
                  </div>

                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ─── 2. ÁREA CENTRAL: Resumen ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-100 p-6 gap-4 overflow-y-auto">
        <CajaPanelPago
          layout="horizontal"
          mode="VENTA"
          labelBoton="REGISTRAR PAGO"
          metodosPago={metodosPago}
          pagos={pagos}
          onPagosChange={setPagos}
          totalACubrir={totalAPagar}
          moneda={monedaDeuda}
          lockMoneda={monedaDeuda}
          cotizacion={cotizacion}
          procesando={procesando}
          onConfirmar={handleProcesar}
          notes={observaciones}
          notas={observaciones}
          onNotas={setObservaciones}
          tipoDoc={tipoDoc}
          onTipoDoc={setTipoDoc}
          serieDoc={serieDoc}
          onSerieDoc={setSerieDoc}
          numDoc=""
          tiposDocDisponibles={tiposDocDisponibles.length > 0 ? tiposDocDisponibles : TIPOS_DOC_PAGO}
          disabledExtra={seleccionadas.length === 0}
        />

        {seleccionadas.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm flex-1 flex flex-col items-center justify-center opacity-40 gap-4">
            <ArrowDownCircle size={80} className="text-slate-300" />
            <p className="font-black text-slate-400 uppercase tracking-widest text-sm text-center">
              Seleccioná las deudas a pagar<br/>desde la lista de la izquierda
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 flex-1">
            {/* Encabezado */}
            <div className="flex justify-between items-center border-b border-slate-200 pb-4">
              <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                <CreditCard size={26} className="text-brand-cyan" />
                Resumen de Selección
              </h2>
            </div>

            {clientesInvolucrados.length > 1 && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2">
                <AlertTriangle size={18} />
                Atención: Seleccionaste deudas de múltiples clientes. Solo podés cobrar a un cliente a la vez.
              </div>
            )}

            {/* Banner de confirmación de pago parcial */}
            {pendienteParcial && (
              <div className="bg-amber-50 border-2 border-amber-400 text-amber-800 px-5 py-4 rounded-2xl flex flex-col gap-3">
                <div className="flex items-center gap-2 font-black text-sm">
                  <AlertTriangle size={18} className="text-amber-500" />
                  PAGO PARCIAL — Faltan {simboloDeuda} {pendienteParcial.falta.toFixed(2)}
                </div>
                <p className="text-xs font-medium text-amber-700">
                  El monto ingresado ({simboloDeuda} {fmt(pendienteParcial.totalPagado)}) no cubre el total de la deuda ({simboloDeuda} {fmt(totalAPagar)}).
                  La deuda quedará como <strong>PARCIALMENTE PAGADA</strong> con saldo pendiente de {simboloDeuda} {pendienteParcial.falta.toFixed(2)}.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { handleProcesar(true); }}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-black py-2 px-4 rounded-xl text-sm transition-colors">
                    ✓ Confirmar pago parcial
                  </button>
                  <button
                    onClick={() => setPendienteParcial(null)}
                    className="flex-1 bg-white border-2 border-amber-400 text-amber-700 font-black py-2 px-4 rounded-xl text-sm hover:bg-amber-50 transition-colors">
                    ✗ Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Deudas seleccionadas */}
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col gap-4">
              <h3 className="font-black text-slate-400 text-[10px] uppercase tracking-widest">
                Deudas a cancelar ({seleccionadas.length})
              </h3>

              <div className="flex flex-col gap-2">
                {deudasSeleccionadas.map(d => {
                  const badge = badgeEstado(d);
                  return (
                    <div key={d.DDeIdDocumento}
                      className="flex flex-col gap-0 rounded-3xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                      <div className="flex justify-between items-start p-5 bg-white border-b border-slate-100">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-brand-cyan/5 border-2 border-brand-cyan/10 flex items-center justify-center shrink-0">
                            <FileMinus size={20} className="text-brand-cyan/70" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-black text-slate-800 text-base truncate tracking-tight">
                              {d.NombreTrabajo || d.CodigoOrden || `Deuda #${d.DDeIdDocumento}`}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-slate-500 font-bold bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-200 uppercase tracking-widest truncate max-w-[150px]"><span className="text-slate-400">ID: {d.ClienteCodigo || '-'}</span> {d.ClienteNombre}</span>
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest ${badge.cls}`}>{badge.label}</span>
                            </div>
                            {d.DocCliNombre && d.DocCliNombre.trim().toLowerCase() !== (d.ClienteNombre || '').trim().toLowerCase() && (
                              <div className="text-[10px] font-bold text-amber-600 mt-2 flex items-center gap-1.5 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 w-fit select-none">
                                <span className="uppercase font-black text-[8px] bg-amber-200 px-1 py-0.2 rounded text-amber-800">Facturado a:</span>
                                <span>{d.DocCliNombre}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-end flex-col gap-1 shrink-0 ml-4">
                          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Saldo Base</span>
                          <span className="font-black text-slate-800 text-lg leading-none">
                            {d.MonSimbolo || '$'} {fmt(d.DDeImportePendiente)}
                          </span>
                          <button onClick={e => { e.stopPropagation(); toggleDeuda(d.DDeIdDocumento); }}
                            className="text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors p-1 mt-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest">
                            <X size={12} /> Quitar
                          </button>
                        </div>
                      </div>

                      {/* Sub-órdenes al estilo CajaTransaccionView */}
                      {d.SubOrdenes && d.SubOrdenes.length > 0 && (
                        <div className="flex flex-col gap-2 p-5 bg-slate-50/50">
                          {d.SubOrdenes.map(sub => (
                            <div key={sub.OrdIdOrden || sub.CodigoOrden || Math.random()} 
                              className="flex justify-between items-center px-4 py-3 rounded-2xl border gap-4 bg-white border-slate-200">
                              <div className="flex items-center gap-4 w-full truncate text-xs">
                                <AlertCircle size={14} className="shrink-0 text-brand-cyan/50" />
                                <span className="font-black text-slate-400 shrink-0 text-[10px]">#{sub.CodigoOrden}</span>
                                <span className="font-bold text-slate-800 truncate">Trabajo: {sub.Concepto || 'Impreso'}</span>
                              </div>
                              <div className="flex items-center gap-4 shrink-0">
                                <span className="font-black text-slate-800 min-w-[80px] text-right">{d.MonSimbolo || '$'} {fmt(sub.Importe)}</span>
                                <span className="w-20 text-center px-2 py-1 bg-brand-magenta/10 text-brand-magenta text-[9px] font-black rounded-lg border border-brand-magenta/20 uppercase tracking-widest">Pendiente</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Total */}
              <div className="flex items-center justify-between px-5 py-4 bg-brand-cyan/5 rounded-2xl border-2 border-brand-cyan/20 mt-2">
                <span className="font-black text-brand-cyan text-sm uppercase tracking-widest">Total a Cubrir</span>
                <span className="font-black text-brand-cyan text-3xl tracking-tight">{simboloDeuda} {fmt(totalAPagar)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}


