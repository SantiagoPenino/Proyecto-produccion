import React, { useState, useEffect, Fragment } from 'react';
import { Search, Plus, Trash2, Loader2, User, CheckCircle, ArrowRight, Wallet, History, ChevronDown, Check } from 'lucide-react';
import { Listbox, Transition } from '@headlessui/react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import ClienteBilletera from '../common/ClienteBilletera';

const TIPOS_VENTA = [
  { value: 'RECURSO', label: 'Bolsa de Recursos (Plan Metros)' },
  { value: 'VENTA_INSUMOS', label: 'Insumos' },
  { value: 'VENTA_PRODUCTOS', label: 'Productos en el local' }
];

export default function CajaVentaDirectaTab({
  metodosPago, cotizacion, onVentaExitosa,
  // Props externas para integración con CajaPanelPago
  pagos: pagosExt, onPagosChange,
  tipoDocumento: tipoDocExt, onTipoDocumento,
  tiposDocDisponibles = [],
  serieDoc: serieDocExt,
  onSerieDoc,
  obs: obsExt, onObs,
  onConfirmar: onConfirmarExt,
  procesando: procesandoExt,
  onTotalChange, // notifica al padre el total cuando cambian los items
  onClienteChange,
  defaultTipo = 'RECURSO',
  allowedTipos = null,
  isAdminCaja = false,
}) {
  // Cliente
  const [qCliente, setQCliente] = useState('');
  const [clientesRes, setClientesRes] = useState([]);
  const [buscandoCli, setBuscandoCli] = useState(false);
  const [clienteSel, setClienteSel] = useState(null);

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

  // Moneda exhibición
  const [monedaExhibicion, setMonedaExhibicion] = useState('UYU');

  // Items
  const [items, setItems] = useState([
    { id: Date.now(), tipo: defaultTipo, grupo: defaultTipo === 'VENTA_INSUMOS' ? 'Insumos' : defaultTipo === 'VENTA_PRODUCTOS' ? 'Productos en el local' : '', codigo: '', descripcion: '', cantidad: 1, precioUnitario: '', precioTotal: '' }
  ]);
  const [productosBase, setProductosBase] = useState([]);

  // Estado interno para cuando NO se usan props externas
  const [pagosInternal, setPagosInternal] = useState([]);
  const [obsInternal, setObsInternal] = useState('');
  const [tipoDocInternal, setTipoDocInternal] = useState('40');
  const [serieDocInternal, setSerieDocInternal] = useState('A');
  const [procesandoInternal, setProcesandoInternal] = useState(false);

  // Resuelve qué usar: props externas o estado interno
  const pagos = pagosExt !== undefined ? pagosExt : pagosInternal;
  const setPagos = onPagosChange || setPagosInternal;
  const obs = obsExt !== undefined ? obsExt : obsInternal;
  const setObs = onObs || setObsInternal;
  const tipoDocumento = tipoDocExt !== undefined ? tipoDocExt : tipoDocInternal;
  const setTipoDocumento = onTipoDocumento || setTipoDocInternal;
  const serieDoc = serieDocExt !== undefined ? serieDocExt : serieDocInternal;
  const procesando = procesandoExt !== undefined ? procesandoExt : procesandoInternal;

  const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  useEffect(() => {
    api.get('/contabilidad/caja/productos-venta').then(r => setProductosBase(r.data?.data||[])).catch(e => console.error(e));
  }, []);

  // Limpiar controles al concretar venta
  useEffect(() => {
    const handleLimpiar = () => {
      setClienteSel(null);
      setQCliente('');
      setPagos([]);
      setItems([{ id: Date.now(), tipo: defaultTipo, grupo: defaultTipo === 'VENTA_INSUMOS' ? 'Insumos' : defaultTipo === 'VENTA_PRODUCTOS' ? 'Productos en el local' : '', codigo: '', descripcion: '', cantidad: 1, precioUnitario: '', precioTotal: '' }]);
      setObs('');
    };
    document.addEventListener('caja:limpiarVenta', handleLimpiar);
    return () => document.removeEventListener('caja:limpiarVenta', handleLimpiar);
  }, [defaultTipo]);

  // Notificar al padre cuando el cliente cambia
  useEffect(() => {
    if (onClienteChange) {
      onClienteChange(clienteSel);
    }
  }, [clienteSel, onClienteChange]);

  const productosAgrupados = React.useMemo(() => {
    const map = {};
    productosBase.forEach(p => {
      const g = p.GrupoNombre || 'OTROS';
      if (!map[g]) map[g] = [];
      map[g].push(p);
    });
    return map;
  }, [productosBase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (qCliente.length > 2) searchClientes(qCliente);
    }, 500);
    return () => clearTimeout(timer);
  }, [qCliente]);

  const searchClientes = async (q) => {
    setBuscandoCli(true);
    try {
      const res = await api.get(`/contabilidad/clientes-activos?q=${encodeURIComponent(q)}&tipo=TODOS`);
      setClientesRes(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch { toast.error('Error buscando clientes'); }
    setBuscandoCli(false);
  };

  const totalPagar = items.reduce((sum, item) => sum + (parseFloat(item.precioTotal) || 0), 0);

  // Notifica al padre el total para que CajaPanelPago lo muestre
  React.useEffect(() => { if (onTotalChange) onTotalChange(totalPagar, monedaExhibicion); }, [totalPagar, monedaExhibicion]);

  const buildPayload = () => ({
    _clienteNombre: getClienteDisplayName(clienteSel) || 'Cliente',
    header: {
      clienteId: clienteSel?.CliIdCliente,
      tipoDocumento,
      serieDoc,
      obs,
      cotizacion,
      monedaBase: monedaExhibicion,
      admin: isAdminCaja
    },
    items: items.map(i => {
      let articulosPermitidos = null;
      if (i.tipo === 'RECURSO') {
        if (i.esMixto) {
          articulosPermitidos = [247, 255]; // DTF Común (247) y DTF UV (255)
        } else if (i.proId) {
          articulosPermitidos = [i.proId];
        }
      }
      return {
        tipo: i.tipo,
        codigo: i.codigo,
        descripcion: i.descripcion,
        cantidad: parseFloat(i.cantidad),
        precioTotal: parseFloat(i.precioTotal),
        monedaId: monedaExhibicion === 'USD' ? 2 : 1,
        articulosPermitidos
      };
    }),
    pagos: pagos.filter(p => p.monto && p.metodoPagoId).map(p => ({
      metodoPagoId: parseInt(p.metodoPagoId),
      montoOriginal: parseFloat(p.monto),
      monedaId: p.moneda === 'USD' ? 2 : 1,
      cotizacion: p.moneda === 'USD' ? cotizacion : null,
      referenciaNumero: ''
    }))
  });

  const handleGuardar = async () => {
    if (onConfirmarExt) { onConfirmarExt(buildPayload()); return; }
    if (!clienteSel) return toast.warning('Debe seleccionar un cliente.');
    if (items.some(i => !i.codigo || !i.precioTotal || !i.cantidad || !i.descripcion))
      return toast.warning('Complete todos los campos de los ítems.');
      
    const payload = buildPayload();
    
    // Validar pagos
    const esCredito = tipoDocumento === '02' || tipoDocumento === '08' || tipoDocumento === 'FACT_CREDITO';
    if (!esCredito && payload.pagos.length === 0 && totalPagar > 0) {
      return toast.warning('Debe seleccionar un método de pago para completar la transacción de contado.');
    }

    setProcesandoInternal(true);
    try {
      const res = await api.post('/contabilidad/caja/venta-directa', payload);
      toast.success(`Venta procesada exitosamente. Total cobrado: ${fmt(res.data.totalCobrado)}`);
      if (onVentaExitosa) onVentaExitosa();
      setClienteSel(null); setQCliente(''); setPagos([]);
      setItems([{ id: Date.now(), tipo: defaultTipo, grupo: defaultTipo === 'VENTA_INSUMOS' ? 'Insumos' : defaultTipo === 'VENTA_PRODUCTOS' ? 'Productos en el local' : '', codigo: '', descripcion: '', cantidad: 1, precioUnitario: '', precioTotal: '' }]);
      setObs('');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al procesar la venta');
    } finally {
      setProcesandoInternal(false);
    }
  };

  useEffect(() => {
    const handler = () => handleGuardar();
    document.addEventListener('caja:confirmarVenta', handler);
    return () => document.removeEventListener('caja:confirmarVenta', handler);
  }, [clienteSel, items, tipoDocumento, obs, pagos, cotizacion, monedaExhibicion, onConfirmarExt]);

  const seleccionarCliente = (c) => {
    setClienteSel(c);
    setClientesRes([]);
    setQCliente('');
  };

  return (
    <div className="flex flex-col lg:flex-row flex-1 overflow-hidden h-full min-h-0 bg-zinc-100">
      {/* ── PANEL LATERAL DE CLIENTES ── */}
      <div className="w-full lg:w-[360px] bg-white border-b lg:border-b-0 lg:border-r border-zinc-200 flex flex-col shrink-0 overflow-y-auto p-4 client-search-container">
        <h3 className="font-black text-zinc-400 text-[11px] font-archivo uppercase tracking-widest mb-3 flex items-center justify-between">
          1. Seleccionar Cliente
          {clienteSel && <span className="text-emerald-600 flex items-center gap-1 text-[9px] font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">Verificado <CheckCircle size={10}/></span>}
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
                  className="w-full bg-zinc-50 border border-zinc-200 hover:border-zinc-300 focus:border-brand-cyan focus:bg-white rounded-xl pl-11 pr-4 py-2.5 text-sm font-bold text-zinc-800 placeholder-zinc-400 outline-none transition-all" 
              />
              {buscandoCli && <div className="absolute right-4"><Loader2 size={16} className="text-brand-cyan animate-spin" /></div>}
            </div>

            {/* Listado de tarjetas de clientes encontrados */}
            <div className="flex flex-col gap-2 mt-2">
              {clientesRes.length > 0 ? (
                clientesRes.map(c => (
                  <div key={c.CliIdCliente} 
                    onClick={()=>seleccionarCliente(c)} 
                    className="w-full text-left p-3.5 bg-zinc-50 hover:bg-brand-cyan/5 border border-zinc-200 hover:border-brand-cyan/35 rounded-xl cursor-pointer transition-all flex flex-col gap-1.5 active:scale-[0.98] group"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-zinc-900 font-extrabold text-sm group-hover:text-brand-cyan transition-colors leading-snug">{getClienteDisplayName(c)}</span>
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
          <div className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-brand-cyan border border-brand-cyan/10">
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
                onClick={()=>setClienteSel(null)} 
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
            </div>
          </div>
        )}
      </div>

      {/* ── CONTENIDO PRINCIPAL ── */}
      <div className="flex-1 flex flex-col min-h-0 h-full overflow-y-auto bg-zinc-50">
        {/* BILLETERA DE CLIENTE STICKY */}
        {clienteSel && (
          <div className="px-5 py-1 border-b border-zinc-200 bg-white/80 sticky top-0 z-20 shrink-0 shadow-sm">
            <ClienteBilletera 
              clienteId={clienteSel.CliIdCliente} 
              clienteNombre={getClienteDisplayName(clienteSel)} 
            />
          </div>
        )}

        <div className="flex-1 p-4 flex flex-col gap-4">
          <h2 className="text-lg font-black text-zinc-800 flex items-center gap-2 shrink-0">
            Nuevo Ingreso / Venta de Rollo por Adelantado
            <span className="inline-flex items-center justify-center text-[9px] leading-none bg-brand-cyan/10 text-brand-cyan px-1.5 py-0.5 rounded-full font-black uppercase tracking-widest border border-brand-cyan/20 h-4">POS Express</span>
          </h2>

        <div className="flex flex-col flex-1 gap-0 w-full">

          {/* BLOQUE ITEMS */}
          <div className="bg-white border border-zinc-200 rounded-none p-3 shadow-sm flex flex-col flex-1 gap-2 relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
              <h3 className="font-black text-zinc-400 text-[10px] font-archivo uppercase tracking-widest">2. Conceptos a Cobrar</h3>
            </div>

            <div className="flex flex-col gap-2">
              {items.map((it, idx) => (
                <div key={it.id} className="flex flex-col gap-2 bg-zinc-50/50 rounded-xl p-2 border border-zinc-100 relative group/item hover:bg-zinc-50 transition-colors">
                  {idx > 0 && <button onClick={()=>setItems(p=>p.filter(x=>x.id!==it.id))} className="absolute top-1 right-1 text-zinc-300 hover:text-rose-600 p-1 transition-all hover:bg-rose-50 rounded-lg"><Trash2 size={14} /></button>}
                             <div className={`grid ${['RECURSO', 'VENTA_INSUMOS', 'VENTA_PRODUCTOS', 'VENTA_GENERICA'].includes(it.tipo) ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-archivo uppercase font-black text-zinc-400 tracking-widest px-2">Operación</label>
                      <Listbox value={it.tipo} onChange={t=>{
                        setItems(p=>p.map(x=>x.id===it.id ? {...x, tipo:t, grupo: t === 'VENTA_INSUMOS' ? 'Insumos' : t === 'VENTA_PRODUCTOS' ? 'Productos en el local' : '', codigo: '', descripcion: ''}:x));
                      }}>
                        <div className="relative">
                          <Listbox.Button className="relative w-full cursor-pointer rounded-xl bg-white border-2 border-zinc-200 py-2 pl-3 pr-10 text-left text-sm font-bold text-zinc-800 shadow-sm focus:outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 transition-all">
                            <span className="block truncate">{TIPOS_VENTA.find(o => o.value === it.tipo)?.label || 'Seleccione'}</span>
                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                              <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                            </span>
                          </Listbox.Button>
                          <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
                            <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                              {TIPOS_VENTA.filter(o => !allowedTipos || allowedTipos.includes(o.value)).map((o) => (
                                <Listbox.Option key={o.value} className={({ active }) => `relative cursor-pointer select-none py-2 pl-8 pr-4 transition-colors text-sm ${active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-700'}`} value={o.value}>
                                  {({ selected }) => (
                                    <>
                                      <span className={`block truncate ${selected ? 'font-bold text-zinc-900' : 'font-medium'}`}>{o.label}</span>
                                      {selected ? <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-zinc-900"><Check className="h-4 w-4" aria-hidden="true" /></span> : null}
                                    </>
                                  )}
                                </Listbox.Option>
                              ))}
                            </Listbox.Options>
                          </Transition>
                        </div>
                      </Listbox>
                    </div>
                    {['RECURSO', 'VENTA_INSUMOS', 'VENTA_PRODUCTOS', 'VENTA_GENERICA'].includes(it.tipo) && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-archivo uppercase font-black text-zinc-400 tracking-widest px-2">Grupo</label>
                        <Listbox value={it.grupo || ''} onChange={val => {
                          setItems(p=>p.map(x=>x.id===it.id ? {...x, grupo: val, codigo: '', descripcion: ''} : x));
                        }} disabled={it.tipo === 'VENTA_INSUMOS' || it.tipo === 'VENTA_PRODUCTOS'}>
                          <div className="relative">
                            <Listbox.Button className="relative w-full cursor-pointer rounded-xl bg-white border-2 border-zinc-200 py-2 pl-3 pr-10 text-left text-sm font-bold text-zinc-800 shadow-sm focus:outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 transition-all ui-disabled:bg-zinc-50 ui-disabled:text-zinc-400 ui-disabled:cursor-not-allowed">
                              <span className="block truncate">{it.grupo || 'Seleccione grupo...'}</span>
                              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                              </span>
                            </Listbox.Button>
                            <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
                              <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                                {Object.keys(productosAgrupados).filter(g => {
                                   if (it.tipo === 'VENTA_INSUMOS') return g === 'Insumos';
                                   if (it.tipo === 'VENTA_PRODUCTOS') return g === 'Productos en el local';
                                   return /dtf|sublimaci/i.test(g);
                                }).map(g => (
                                  <Listbox.Option key={g} className={({ active }) => `relative cursor-pointer select-none py-2 pl-8 pr-4 transition-colors text-sm ${active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-700'}`} value={g}>
                                    {({ selected }) => (
                                      <>
                                        <span className={`block truncate ${selected ? 'font-bold text-zinc-900' : 'font-medium'}`}>{g}</span>
                                        {selected ? <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-zinc-900"><Check className="h-4 w-4" aria-hidden="true" /></span> : null}
                                      </>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-archivo uppercase font-black text-zinc-400 tracking-widest px-2">{['RECURSO', 'VENTA_INSUMOS', 'VENTA_PRODUCTOS', 'VENTA_GENERICA'].includes(it.tipo) ? 'Producto' : 'Referencia'}</label>
                      {['RECURSO', 'VENTA_INSUMOS', 'VENTA_PRODUCTOS', 'VENTA_GENERICA'].includes(it.tipo) ? (
                        <Listbox value={it.codigo} onChange={val => {
                          const prod = (productosAgrupados[it.grupo] || []).find(x => String(x.CodArticulo) === String(val));
                          
                          let currentMoneda = monedaExhibicion;
                          if (prod && it.codigo === '' && items.length === 1) {
                             currentMoneda = (prod.MonedaBase === 'DOLAR' || prod.MonedaBase === 'USD') ? 'USD' : 'UYU';
                             setMonedaExhibicion(currentMoneda);
                          }

                          setItems(p => p.map(x => {
                            if (x.id !== it.id) return x;
                            let newObj = { 
                              ...x, 
                              codigo: val, 
                              descripcion: prod ? prod.Descripcion : x.descripcion,
                              proId: prod ? prod.ProIdProducto : null,
                              esMixto: (val === '48' || val === '55') ? true : false
                            };
                            if ((x.tipo === 'RECURSO' || x.tipo === 'VENTA_GENERICA' || x.tipo === 'VENTA_INSUMOS' || x.tipo === 'VENTA_PRODUCTOS') && prod) {
                               let precio = prod.PrecioBase || 0;
                               const isProdUSD = prod.MonedaBase === 'DOLAR' || prod.MonedaBase === 'USD';
                               if (isProdUSD && currentMoneda === 'UYU') {
                                   precio = precio * (cotizacion || 40);
                               } else if (!isProdUSD && currentMoneda === 'USD') {
                                   precio = precio / (cotizacion || 40);
                               }
                               newObj.precioUnitario = Number(precio).toFixed(2);
                               newObj.precioTotal = Number(precio * (x.cantidad || 1)).toFixed(2);
                            }
                            return newObj;
                          }));
                        }} disabled={!it.grupo}>
                          <div className="relative">
                            <Listbox.Button className={`relative w-full cursor-pointer rounded-xl bg-white border-2 border-zinc-200 py-2 pl-3 pr-10 text-left text-sm font-bold text-zinc-800 shadow-sm focus:outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 transition-all ${!it.grupo ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed' : ''}`}>
                              <span className="block truncate">{it.codigo && it.descripcion ? `[${it.codigo}] ${it.descripcion}` : (it.grupo ? 'Seleccione...' : 'Elegir grupo...')}</span>
                              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                              </span>
                            </Listbox.Button>
                            <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
                              <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                                {(productosAgrupados[it.grupo] || []).map(p => (
                                  <Listbox.Option key={p.CodArticulo} className={({ active }) => `relative cursor-pointer select-none py-2 pl-8 pr-4 transition-colors text-sm ${active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-700'}`} value={p.CodArticulo}>
                                    {({ selected }) => (
                                      <>
                                        <span className={`block truncate ${selected ? 'font-bold text-zinc-900' : 'font-medium'}`}>[{p.CodArticulo}] {p.Descripcion}</span>
                                        {selected ? <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-zinc-900"><Check className="h-4 w-4" aria-hidden="true" /></span> : null}
                                      </>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      ) : (
                        <input value={it.codigo} onChange={e=>setItems(p=>p.map(x=>x.id===it.id?{...x, codigo:e.target.value}:x))} placeholder="Ej: XXX" className="bg-white border-2 border-zinc-200 rounded-xl px-4 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-brand-cyan placeholder-zinc-300 shadow-sm" />
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <div className="col-span-2 flex flex-col gap-1">
                      <label className="text-[10px] font-archivo uppercase font-black text-zinc-400 tracking-widest px-2">Descripción Visible en Documento</label>
                      <input value={it.descripcion} onChange={e=>setItems(p=>p.map(x=>x.id===it.id?{...x, descripcion:e.target.value}:x))} placeholder="Aclaración opcional..." className="bg-white border-2 border-zinc-200 rounded-xl px-4 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-brand-cyan shadow-sm" />
                    </div>
                    <div className="flex flex-col gap-1 text-center">
                      <label className="text-[10px] font-archivo uppercase font-black text-zinc-400 tracking-widest">Cantidad</label>
                      <input type="number" step="0.5" value={it.cantidad} onChange={e=>{
                          const val = e.target.value;
                          setItems(p=>p.map(x=>{
                            if (x.id !== it.id) return x;
                            let newObj = { ...x, cantidad: val };
                            const unit = Number(x.precioUnitario) || 0;
                            newObj.precioTotal = Number(unit * (val || 0)).toFixed(2);
                            return newObj;
                          }));
                      }} className="bg-zinc-100 border-2 border-zinc-200 rounded-xl px-4 py-2 text-sm font-black text-emerald-600 text-center outline-none focus:border-emerald-500 shadow-inner" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-archivo uppercase font-black text-zinc-400 tracking-widest">Precio U. {monedaExhibicion}</label>
                      <input type="number" step="0.1" value={it.precioUnitario || ''} onChange={e=>{
                          const val = e.target.value;
                          setItems(p=>p.map(x=>{
                            if(x.id===it.id) {
                               return {...x, precioUnitario: val, precioTotal: Number((val || 0) * (x.cantidad || 1)).toFixed(2)};
                            }
                            return x;
                          }));
                      }} className="bg-zinc-50 border-2 border-zinc-200 rounded-xl px-4 py-2 text-sm font-black text-zinc-900 outline-none focus:border-brand-cyan text-right shadow-sm" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-archivo uppercase font-black text-zinc-400 tracking-widest">Total {monedaExhibicion}</label>
                      <input type="number" step="0.1" value={it.precioTotal} onChange={e=>setItems(p=>p.map(x=>{
                          if(x.id===it.id) {
                             return {...x, precioTotal:e.target.value};
                         }
                         return x;
                      }))} className="bg-zinc-50 border-2 border-zinc-200 rounded-xl px-4 py-2 text-sm font-black text-zinc-900 outline-none focus:border-brand-cyan text-right placeholder-zinc-300 shadow-sm" />
                    </div>
                  </div>
                  {it.tipo === 'RECURSO' && (it.codigo === '48' || it.codigo === '55') && (
                    <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 bg-brand-cyan/5 border border-brand-cyan/25 rounded-xl">
                      <input 
                        type="checkbox" 
                        id={`mixto-${it.id}`}
                        checked={it.esMixto !== false} 
                        onChange={e => {
                          const val = e.target.checked;
                          setItems(p => p.map(x => x.id === it.id ? { ...x, esMixto: val } : x));
                        }}
                        className="rounded text-brand-cyan focus:ring-brand-cyan"
                      />
                      <label htmlFor={`mixto-${it.id}`} className="text-xs font-bold text-zinc-700 cursor-pointer">
                        Habilitar Plan Mixto (Permite consumir indistintamente DTF Común y DTF UV)
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-auto pt-4">
              <button onClick={()=>setItems(p=>[...p,{ id:Date.now(), tipo:defaultTipo, grupo: defaultTipo === 'VENTA_INSUMOS' ? 'Insumos' : defaultTipo === 'VENTA_PRODUCTOS' ? 'Productos en el local' : '', codigo:'', descripcion:'', cantidad:1, precioTotal:'' }])} 
                className="w-full py-2 border-2 border-dashed border-zinc-200 hover:border-brand-cyan hover:bg-brand-cyan/5 rounded-xl flex items-center justify-center gap-2 text-zinc-400 hover:text-brand-cyan font-black transition-all group/add">
                <div className="w-5 h-5 rounded flex items-center justify-center group-hover/add:bg-brand-cyan group-hover/add:text-white transition-all shadow-sm"><Plus size={12} /></div>
                Agregar otro concepto a cobrar
              </button>

              {/* Total resumen compacto */}
              <div className="flex justify-between items-center pt-2 border-t border-zinc-100 mt-1 px-2">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Global a Facturar</span>
                <span className="text-[10px] text-zinc-500 font-bold bg-zinc-100 px-2 py-0.5 rounded-full mt-1 border border-zinc-200">Emitiendo documento en {monedaExhibicion}</span>
              </div>
              <div className="flex items-end gap-3">
                <span className={`text-3xl font-black ${monedaExhibicion==='USD'?'text-emerald-600':'text-brand-cyan'} tracking-tighter drop-shadow-sm`}>
                  {monedaExhibicion==='USD' ? 'US$' : '$'} {fmt(totalPagar)}
                </span>
              </div>
            </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}




