import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { io } from 'socket.io-client';
import api, { SOCKET_URL } from '../../services/apiClient';
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Plus, Trash2, RefreshCw, Loader2,
  CreditCard, CheckCircle, AlertCircle,
  FileText, User, Phone, Search, X,
  Zap, ArrowRight, ChevronRight, LayoutGrid, TrendingDown, Hash, History, Wallet, Tag, FileMinus,
  ArrowDownCircle, ArrowUpCircle, ShieldCheck, DoorClosed, LockKeyhole, DollarSign, BookOpen, Power, Calendar, ShoppingBag
} from 'lucide-react';
import CajaArqueoModal from './CajaArqueoModal';
import CajaVentaDirectaTab from './CajaVentaDirectaTab';
import CajaCobroLibreTab from './CajaCobroLibreTab';
import CajaSaldoAnticipoTab from './CajaSaldoAnticipoTab';

import CajaPagoDeudaTab from './CajaPagoDeudaTab';
import CajaOtrosIngresosTab from './CajaOtrosIngresosTab';
import CajaPanelPago from './CajaPanelPago';
import TicketImpresion from '../common/TicketImpresion';
import ClienteBilletera from '../common/ClienteBilletera';
import { CustomSelect } from '../../client-portal/pautas/CustomSelect';
import { Listbox } from '@headlessui/react';
import { ChevronDown, Check } from 'lucide-react';

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

const TIPOS_DOC = [
  { value: '40', label: 'Pedido Caja' },
  { value: '07', label: 'E-Ticket Contado -> 101' },
  { value: '08', label: 'E-Ticket Crédito -> 101' },
  { value: '01', label: 'E-Factura Contado -> 111' },
  { value: '02', label: 'E-Factura Crédito -> 111' },
  { value: '05', label: 'Recibo' },
  { value: 'NINGUNO', label: 'Sin documento' },
];

const TIPOS_DOC_EGRESO = [
  { value: '05', label: 'Recibo' },
  { value: 'NINGUNO', label: 'Sin documento' },
];

const TIPOS_AJUSTE = [
  { value: '', label: 'Sin ajuste' },
  { value: 'DESCUENTO', label: 'Descuento' },
  { value: 'REDONDEO', label: 'Redondeo' },
  { value: 'BONIFICACION', label: 'Bonificación' },
  { value: 'SALDO_CERO', label: 'Saldo cero' },
  { value: 'RECARGO', label: 'Recargo' },
];

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CajaTransaccionView({ isAdminCaja = false }) {
  const [activeTab, setActiveTab] = useState('INGRESOS');
  const [subTabIngreso, setSubTabIngreso] = useState('COBRO');

  const [sesion, setSesion] = useState(null);
  const [loadingSesion, setLoadingSesion] = useState(true);
  const [modalApertura, setModalApertura] = useState(false);
  const [montoInicial, setMontoInicial] = useState('');

  const [metodosPago, setMetodosPago] = useState([]);
  const [cuentasGastos, setCuentasGastos] = useState([]);
  const [cotizacion, setCotizacion] = useState(null);
  const [loadingCot, setLoadingCot] = useState(false);

  const [retiros, setRetiros] = useState([]);
  const [monedaExhibicion, setMonedaExhibicion] = useState('UYU');
  const [showArqueo, setShowArqueo] = useState(false);
  const [busquedaGlobalRes, setBusquedaGlobalRes] = useState(null);
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('1');
  const [seleccionados, setSeleccionados] = useState([]);
  const [ajustes, setAjustes] = useState({});
  const [carritosPago, setCarritosPago] = useState([{ id: Date.now(), metodoPagoId: 1, moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [tipoDocCobro, setTipoDocCobro] = useState('40');
  const [serieDocCobro, setSerieDocCobro] = useState('A');
  const [numDocCobro, setNumDocCobro] = useState('');
  const [numDocCobroPredict, setNumDocCobroPredict] = useState('');
  const [obsCobro, setObsCobro] = useState('');
  const [procesandoCobro, setProcesandoCobro] = useState(false);
  const [motorPagos, setMotorPagos] = useState([{ id: Date.now(), metodoPagoId: 1, moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [motorTipoDoc, setMotorTipoDoc] = useState('40');
  const [motorSerieDoc, setMotorSerieDoc] = useState('A');

  const [ventaPagos, setVentaPagos] = useState([{ id: Date.now(), metodoPagoId: 1, moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [ventaTipoDoc, setVentaTipoDoc] = useState('40');
  const [ventaSerieDoc, setVentaSerieDoc] = useState('A');
  const [ventaObs, setVentaObs] = useState('');
  const [ventaTotalACubrir, setVentaTotalACubrir] = useState(0);
  const [ventaMoneda, setVentaMoneda] = useState('UYU');
  const [procesandoVenta, setProcesandoVenta] = useState(false);

  const [egresoCuentaCodigo, setEgresoCuentaCodigo] = useState('');
  const [egresoProveedor, setEgresoProveedor] = useState('');
  const [egresoMonto, setEgresoMonto] = useState('');
  const [egresoMoneda, setEgresoMoneda] = useState('UYU');
  const [egresoMetodoId, setEgresoMetodoId] = useState('');
  const [egresoTipoDoc, setEgresoTipoDoc] = useState('05');
  const [egresoSerieDoc, setEgresoSerieDoc] = useState('A');
  const [egresoNumDocPredict, setEgresoNumDocPredict] = useState('');
  const [egresoObs, setEgresoObs] = useState('');
  const [procesandoEgreso, setProcesandoEgreso] = useState(false);

  const [retiroSelectAut, setRetiroSelectAut] = useState(null);
  const [autMotivo, setAutMotivo] = useState('');
  const [autVencimiento, setAutVencimiento] = useState('');
  const [procesandoAut, setProcesandoAut] = useState(false);
  const ticketRef = useRef(null);
  const [ticketData, setTicketData] = useState(null);

  // Imprime el ticket abriendo una ventana nueva (más confiable que window.print en el DOM)
  const printTicketData = (data) => {
    if (!data) return;
    const { empresa, sucursal, rut, direccion, fecha, comprobante, cajero, cliente, items, totales, pagos } = data;
    const fmtN = (n) => Number(n || 0).toFixed(2);
    const itemsHtml = (items || []).map(it =>
      `<tr><td style="padding:2px 0;vertical-align:top">${it.descripcion}</td><td style="text-align:center;vertical-align:top">${it.cantidad || 1}</td><td style="text-align:right;vertical-align:top">$${fmtN(it.importe)}</td></tr>`
    ).join('');
    const pagosHtml = (pagos || []).map(p =>
      `<p style="margin:2px 0;display:flex;justify-content:space-between;font-size:11px"><span>${p.metodo}</span><span>${p.moneda} ${fmtN(p.monto)}</span></p>`
    ).join('');
    const win = window.open('', '_blank', 'width=340,height=600');
    if (!win) return;
    win.document.write(`
      <html><head><title>Ticket ${comprobante || ''}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.2;padding:5mm;width:80mm;background:#fff;color:#000}
        h2{font-size:18px;font-weight:bold;text-align:center;margin:0 0 5px}
        .sep{border-bottom:1px dashed #000;margin:10px 0}
        table{width:100%;font-size:11px;margin-bottom:10px}
        th{text-align:left;border-bottom:1px dotted #000}
        th:nth-child(2){text-align:center}th:last-child{text-align:right}
        .total{font-size:14px;font-weight:bold;display:flex;justify-content:space-between;margin:5px 0}
        .pie{text-align:center;font-size:10px;color:#999;margin-top:20px}
        @page{size:80mm auto;margin:0}
      </style></head><body>
      <div style="text-align:center;margin-bottom:10px">
        <h2>${empresa || 'EMPRESA'}</h2>
        ${rut ? `<p>RUT: ${rut}</p>` : ''}
        ${direccion ? `<p>${direccion}</p>` : ''}
        ${sucursal ? `<p>${sucursal}</p>` : ''}
      </div>
      <div class="sep"></div>
      <p><strong>FECHA :</strong> ${fecha}</p>
      <p><strong>TICKET:</strong> ${comprobante || '---'}</p>
      <p><strong>CAJERO:</strong> ${cajero || 'CAJA'}</p>
      <p><strong>CLIENTE:</strong> ${cliente || 'Consumidor Final'}</p>
      <div class="sep"></div>
      <table><thead><tr><th>Detalle</th><th>Cant</th><th>Total</th></tr></thead>
      <tbody>${itemsHtml}</tbody></table>
      <div class="sep"></div>
      ${totales?.subtotal !== undefined ? `<p style="display:flex;justify-content:space-between;margin:2px 0"><span>SUBTOTAL:</span><span>$${fmtN(totales.subtotal)}</span></p>` : ''}
      <p class="total"><span>TOTAL:</span><span>${totales?.moneda || '$'} ${fmtN(totales?.total)}</span></p>
      <div class="sep"></div>
      <p style="font-weight:bold;margin:2px 0">Medios de Pago:</p>
      ${pagosHtml}
      <div class="pie"><p>GRACIAS POR SU COMPRA</p><p>Servicio brindado por Macrosoft ERP</p></div>
      <div style="height:10mm"></div>
      </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  const [resumenCierre, setResumenCierre] = useState(null);
  const [cierreMontoFisico, setCierreMontoFisico] = useState('');
  const [cierreObs, setCierreObs] = useState('');

  const [fechaDesdeAdmin, setFechaDesdeAdmin] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
  const [fechaHastaAdmin, setFechaHastaAdmin] = useState(() => { const d = new Date(); return d.toISOString().split('T')[0]; });
  const [movimientosAdmin, setMovimientosAdmin] = useState([]);
  const [cargandoMovsAdmin, setCargandoMovsAdmin] = useState(false);

  const [denominaciones, setDenominaciones] = useState({
    2000: '', 1000: '', 500: '', 200: '', 100: '', 50: '', 20: '',
    10: '', 5: '', 2: '', 1: ''
  });

  const totalDenominaciones = useMemo(() => {
    return Object.entries(denominaciones).reduce((acc, [den, qty]) => acc + (parseFloat(den) * (parseInt(qty) || 0)), 0);
  }, [denominaciones]);

  useEffect(() => {
    if (totalDenominaciones > 0) {
      setCierreMontoFisico(totalDenominaciones.toString());
    } else {
      setCierreMontoFisico('');
    }
  }, [totalDenominaciones]);

  const [operacionesCaja, setOperacionesCaja] = useState([]);
  const [opSeleccionada, setOpSeleccionada] = useState(null);
  const [opClienteId, setOpClienteId] = useState('');
  const [opClienteNombre, setOpClienteNombre] = useState('');
  const [opImporte, setOpImporte] = useState('');
  const [opMoneda, setOpMoneda] = useState('UYU');
  const [opObs, setOpObs] = useState('');
  const [opMetodoId, setOpMetodoId] = useState('');
  const [procesandoOp, setProcesandoOp] = useState(false);
  const [busquedaClientes, setBusquedaClientes] = useState([]);
  const [buscandoCliente, setBuscandoCliente] = useState(false);

  const [ventaClienteId, setVentaClienteId] = useState('');
  const [ventaClienteNombre, setVentaClienteNombre] = useState('');
  const [tiposDocumentos, setTiposDocumentos] = useState([]);

  const globalClient = useMemo(() => {
    if (subTabIngreso === 'MOTOR') return { id: opClienteId, nombre: opClienteNombre };
    if (subTabIngreso === 'VENTA') return { id: ventaClienteId, nombre: ventaClienteNombre };
    if (subTabIngreso === 'COBRO' && seleccionados.length > 0) {
      const first = seleccionados[0].retiro;
      return { id: first.CliIdCliente, nombre: first.CliNombre || first.Nombre };
    }
    return { id: null, nombre: '' };
  }, [subTabIngreso, opClienteId, opClienteNombre, ventaClienteId, ventaClienteNombre, seleccionados]);

  const filtroRef = useRef(filtroTipo);
  useEffect(() => {
    filtroRef.current = filtroTipo;
    fetchRetiros();
  }, [filtroTipo]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socket.on('retiros:update', fetchRetiros);
    socket.on('actualizado', fetchRetiros);
    verificarSesion();
    cargarDatosBasicos();
    return () => socket.disconnect();
  }, []);

  const verificarSesion = async () => {
    setLoadingSesion(true);
    try {
      const res = await api.get('/contabilidad/caja/sesion/actual');
      if (res.data?.sesion) { setSesion(res.data.sesion); setModalApertura(false); }
      else { setSesion(null); setModalApertura(true); }
    } catch (e) { console.error(e); toast.error('Error al verificar estado de caja.'); }
    setLoadingSesion(false);
  };

  const cargarDatosBasicos = async () => {
    try {
      fetchRetiros();
      const [rMet, rCot, rGastos, rOps, rNom] = await Promise.allSettled([
        api.get('/apipagos/metodos'),
        api.get('/apicotizaciones/hoy'),
        api.get('/contabilidad/erp/cuentas/gastos'),
        api.get('/contabilidad/caja/operaciones'),
        api.get('/contabilidad/cfe/nomencladores')
      ]);
      if (rMet.status === 'fulfilled') {
        const mets = Array.isArray(rMet.value.data) ? rMet.value.data : [];
        setMetodosPago(mets);
        const contadoId = mets.find(m => /(contado|efectivo)/i.test(m.MPaDescripcionMetodo))?.MPaIdMetodoPago || mets[0]?.MPaIdMetodoPago;
        if (contadoId) setVentaPagos([{ id: Date.now(), metodoPagoId: contadoId, moneda: 'UYU', monedaId: 1, monto: '' }]);
      }
      if (rCot.status === 'fulfilled' && rCot.value.data?.cotizaciones?.[0]) setCotizacion(rCot.value.data.cotizaciones[0].CotDolar);
      if (rGastos.status === 'fulfilled') setCuentasGastos(rGastos.value.data?.data || []);
      if (rOps.status === 'fulfilled') setOperacionesCaja(rOps.value.data?.data || []);
      if (rNom.status === 'fulfilled' && rNom.value.data?.success) {
        setTiposDocumentos(rNom.value.data.tiposDocumentos || []);
      }
    } catch (e) { }
  };

  const fetchRetiros = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (filtroRef.current !== 'todos') p.append('tipoCliente', filtroRef.current);
      const res = await api.get(`/apiordenesRetiro/caja?${p}`);
      setRetiros(Array.isArray(res.data) ? res.data : []);
    } catch { }
  }, []);

  const buscarCotizBCU = async () => {
    setLoadingCot(true);
    try {
      const res = await api.get('/apicotizaciones/bcu');
      if (res.data?.cotizacion) { setCotizacion(res.data.cotizacion); toast.success(`Cotización actualizada: $${res.data.cotizacion}`); }
    } catch { toast.error('Error BCU'); }
    setLoadingCot(false);
  };

  const handleAbrirCaja = async () => {
    try {
      const res = await api.post('/contabilidad/caja/sesion/abrir', { montoInicial });
      toast.success('Caja iniciada exitosamente.');
      setSesion(res.data.sesion);
      setModalApertura(false);
    } catch (e) { toast.error(e.response?.data?.error || 'Error al abrir caja'); }
  };

  const cargarResumenCierre = async () => {
    if (!sesion && !isAdminCaja) return;
    try {
      if (isAdminCaja) {
        setCargandoMovsAdmin(true);
        const resMovs = await api.get(`/contabilidad/caja/movimientos-turno?admin=true&desde=${fechaDesdeAdmin}&hasta=${fechaHastaAdmin}`);
        setMovimientosAdmin(resMovs.data.movimientos || []);
        setCargandoMovsAdmin(false);
      } else {
        const path = `/contabilidad/caja/sesion/${sesion.StuIdSesion}/resumen`;
        const res = await api.get(path);
        setResumenCierre(res.data);
      }
    } catch {
      toast.error('No se pudo cargar el resumen/movimientos.');
      if (isAdminCaja) setCargandoMovsAdmin(false);
    }
  };

  useEffect(() => {
    if (isAdminCaja && activeTab === 'OPERACIONES') {
      cargarResumenCierre();
    }
  }, [fechaDesdeAdmin, fechaHastaAdmin, activeTab]);

  const handleCerrarCaja = async () => {
    if (!cierreMontoFisico) return toast.warning('Ingrese el efectivo contado final.');
    try {
      await api.post(`/contabilidad/caja/sesion/${sesion.StuIdSesion}/cerrar`, {
        montoFinal: parseFloat(cierreMontoFisico), observaciones: cierreObs
      });
      toast.success('Sesión de caja cerrada.');
      setSesion(null); setModalApertura(true); setActiveTab('COBRO');
    } catch (e) { toast.error(e.response?.data?.error || 'Error al cerrar caja'); }
  };

  useEffect(() => { if (activeTab === 'OPERACIONES') cargarResumenCierre(); }, [activeTab]);

  const getOrdenes = r => r?.orders || [];

  const calcularMontoPorMoneda = useCallback((r, target) => {
    let t = 0;
    getOrdenes(r).forEach(o => {
      if (o.orderIdMetodoPago !== null || o.orderPago !== null) return;
      if (o.orderCobertura || o.orderEstado === 'Abonado' || o.orderEstado === 'Autorizado') return;
      const val = parseFloat((o.orderCosto || '').replace(/[^0-9.-]/g, '')) || 0;
      if (target === 'UYU') { t += (o.monedaId === 2 && cotizacion) ? val * cotizacion : val; }
      else { t += (o.monedaId === 1 && cotizacion) ? val / cotizacion : val; }
    });
    return t;
  }, [cotizacion]);

  const toggleSeleccion = (r) => {
    const id = r.OReIdOrdenRetiro || r.ordenDeRetiro;
    setSeleccionados(prev => {
      if (prev.find(s => s.retiroId === id)) return prev.filter(s => s.retiroId !== id);
      return [...prev, { retiroId: id, retiro: r, ordenesIds: getOrdenes(r).filter(o => !o.orderIdMetodoPago && !o.orderPago).map(o => o.orderId), codigoRef: r.ordenDeRetiro, descripcion: r.CliNombre || '' }];
    });
  };

  const totalesCobro = useMemo(() => {
    let b = 0, ajT = 0;
    seleccionados.forEach(s => {
      b += calcularMontoPorMoneda(s.retiro, monedaExhibicion);
      const a = parseFloat(ajustes[s.retiroId]?.ajuste || 0);
      ajT += isNaN(a) ? 0 : a;
    });
    return { bruto: b, ajusteTotal: ajT, neto: b + ajT };
  }, [seleccionados, ajustes, monedaExhibicion, calcularMontoPorMoneda]);

  const totalIngresado = useMemo(() => {
    return carritosPago.reduce((acc, p) => {
      const pMonto = parseFloat(p.monto) || 0;
      if (monedaExhibicion === 'UYU') return acc + (p.moneda === 'USD' ? pMonto * (cotizacion || 1) : pMonto);
      else return acc + (p.moneda === 'UYU' ? pMonto / (cotizacion || 1) : pMonto);
    }, 0);
  }, [carritosPago, cotizacion, monedaExhibicion]);

  const cobroBalanceado = Math.abs(totalesCobro.neto - totalIngresado) < (monedaExhibicion === 'UYU' ? 1.0 : 0.05);

  const calcularMontoRetiro = (r) => calcularMontoPorMoneda(r, 'UYU');


  const handleRealizarCobro = async () => {
    if (seleccionados.length === 0) return toast.warning('Seleccione retiros a cobrar.');
    if (!cobroBalanceado) return toast.warning('Pagos no cuadran con el total.');
    if (carritosPago.some(p => !p.metodoPagoId)) return toast.warning('Debe seleccionar Método de pago en todas las líneas.');
    const chequeFaltante = carritosPago.some(p => {
      const isCheque = metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId))?.MPaDescripcionMetodo?.toLowerCase().includes('cheque');
      return isCheque && !p.idCheque;
    });
    if (chequeFaltante) return toast.warning('Debe cargar los datos del cheque en el método de pago correspondiente.');
    if (!tipoDocCobro || tipoDocCobro === 'NINGUNO') return toast.warning('La emisión de un Documento es requerida.');
    setProcesandoCobro(true);
    try {
      let deudaPuraUSD = 0, deudaPuraUYU = 0;
      seleccionados.forEach(s => {
        getOrdenes(s.retiro).forEach(o => {
          if (o.orderIdMetodoPago !== null || o.orderPago !== null) return;
          if (o.orderCobertura || o.orderEstado === 'Abonado' || o.orderEstado === 'Autorizado') return;
          const val = parseFloat((o.orderCosto || '').replace(/[^0-9.-]/g, '')) || 0;
          if (o.monedaId === 2) deudaPuraUSD += val;
          if (o.monedaId === 1) deudaPuraUYU += val;
        });
      });
      const apps = seleccionados.map(s => {
        const montoEnMonedaSeleccionada = calcularMontoPorMoneda(s.retiro, monedaExhibicion);
        return {
          tipo: 'ORDEN_RETIRO', referenciaId: s.retiroId, codigoRef: s.codigoRef, descripcion: s.descripcion, montoOriginal: montoEnMonedaSeleccionada,
          ajuste: parseFloat(ajustes[s.retiroId]?.ajuste || 0) || 0,
          tipoAjuste: ajustes[s.retiroId]?.tipoAjuste || null, orderNumbers: s.ordenesIds
        };
      });
      const pags = carritosPago.map(p => ({ metodoPagoId: parseInt(p.metodoPagoId), moneda: p.moneda, monedaId: p.moneda === 'USD' ? 2 : 1, montoOriginal: parseFloat(p.monto), cotizacion: p.moneda === 'USD' ? cotizacion : null }));
      const res = await api.post('/contabilidad/caja/transaccion', {
        header: { clienteId: seleccionados[0]?.retiro?.CliIdCliente, tipoDocumento: tipoDocCobro, serieDoc: serieDocCobro, numeroDoc: numDocCobro || null, observaciones: obsCobro, deudaPuraUSD, deudaPuraUYU, admin: isAdminCaja, moneda: monedaExhibicion, cotizacion: cotizacion },
        aplicaciones: apps, pagos: pags
      });

      const newTicket = {
        empresa: 'MACROSOFT LTDA',
        fecha: new Date().toLocaleString('es-UY'),
        comprobante: res.data?.numeroDoc || 'TICKET CAJA',
        cajero: sesion?.usrLogin || 'Sistema',
        cliente: seleccionados[0]?.retiro?.CliNombre || 'CLIENTE',
        items: seleccionados.map(s => {
          const m = calcularMontoPorMoneda(s.retiro, monedaExhibicion);
          return { descripcion: `Orden ${s.codigoRef}`, cantidad: 1, importe: m };
        }),
        totales: {
          subtotal: totalesCobro.bruto,
          descuento: Object.values(ajustes).reduce((a, b) => a + (b.tipo === 'DESCUENTO' ? b.ajuste : 0), 0),
          ajuste: Object.values(ajustes).reduce((a, b) => a + (b.tipo !== 'DESCUENTO' ? b.ajuste : 0), 0),
          total: totalIngresado,
          moneda: monedaExhibicion === 'USD' ? 'US$' : '$'
        },
        pagos: carritosPago.map(p => ({
          metodo: metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId))?.MPaDescripcionMetodo || 'Pago',
          moneda: p.moneda,
          monto: p.monto
        }))
      };
      setTicketData(newTicket);
      printTicketData(newTicket);

      const clienteId = seleccionados[0]?.retiro?.CliIdCliente;
      toast.success(`Cobro registrado (${res.data?.numeroDoc || 'OK'})`);
      setSeleccionados([]); setAjustes({});
      setCarritosPago([{ id: Date.now(), metodoPagoId: 1, moneda: 'UYU', monedaId: 1, monto: '' }]);
      setObsCobro(''); 
      if (clienteId) {
        navigate('/contabilidad/cuentas', { state: { selectedClienteId: clienteId } });
      } else {
        fetchRetiros();
      }
    } catch (e) { toast.error(e.response?.data?.error || 'Error al cobrar'); }
    finally { setProcesandoCobro(false); }
  };

  useEffect(() => {
    if (tipoDocCobro && tipoDocCobro !== 'NINGUNO') {
      setNumDocCobroPredict('...');
      api.get(`/contabilidad/caja/siguiente-numero?tipoDoc=${tipoDocCobro}&serie=${serieDocCobro}`)
        .then(r => { if (r.data.success) setNumDocCobroPredict(r.data.NumeroFormato); })
        .catch(() => setNumDocCobroPredict('?'));
    } else {
      setNumDocCobroPredict('Sin Número');
    }
  }, [tipoDocCobro, serieDocCobro]);

  useEffect(() => {
    if (activeTab === 'EGRESOS' && egresoTipoDoc !== 'NINGUNO') {
      api.get(`/contabilidad/caja/siguiente-numero?tipoDoc=${egresoTipoDoc}&serie=${egresoSerieDoc}`)
        .then(r => { if (r.data.success) setEgresoNumDocPredict(r.data.NumeroFormato); })
        .catch(() => setEgresoNumDocPredict('...'));
    }
  }, [activeTab, egresoTipoDoc, egresoSerieDoc]);

  const handleRealizarEgreso = async () => {
    if (!egresoCuentaCodigo || !egresoMonto || !egresoMetodoId) return toast.warning('Cuenta de Gasto, método y monto obligatorios.');
    if (egresoMoneda === 'USD' && !cotizacion) return toast.warning('Falta cotiz BCU para USD.');
    setProcesandoEgreso(true);
    try {
      const ctaSelec = cuentasGastos.find(c => c.CueCodigo === egresoCuentaCodigo);
      await api.post('/contabilidad/caja/egreso', {
        stuIdSesion: isAdminCaja ? null : sesion?.StuIdSesion, cuentaGastoCodigo: egresoCuentaCodigo,
        concepto: ctaSelec?.CueNombre || 'Gasto no mapeado', proveedor: egresoProveedor,
        monto: egresoMonto, moneda: egresoMoneda, monedaId: egresoMoneda === 'USD' ? 2 : 1,
        cotizacion: egresoMoneda === 'USD' ? cotizacion : null, metodoPagoId: egresoMetodoId,
        tipoDocumento: egresoTipoDoc, serieDoc: egresoSerieDoc, observaciones: egresoObs,
        admin: isAdminCaja
      });
      toast.success('Egreso y asiento registrados.');
      setEgresoCuentaCodigo(''); setEgresoProveedor(''); setEgresoMonto(''); setEgresoObs('');
    } catch (e) { toast.error(e.response?.data?.error || 'Error al registrar egreso'); }
    finally { setProcesandoEgreso(false); }
  };

  const handleAutorizar = async () => {
    if (!retiroSelectAut || !autMotivo) return toast.warning('Seleccione orden y escriba motivo.');
    setProcesandoAut(true);
    try {
      await api.post('/contabilidad/caja/autorizar', { oreIdOrdenRetiro: retiroSelectAut.retiroId, motivo: autMotivo, montoDeuda: retiroSelectAut.deudaEstimada, fechaVencimiento: autVencimiento || null });
      toast.success('Orden autorizada para entrega.');
      setRetiroSelectAut(null); setAutMotivo(''); setAutVencimiento(''); fetchRetiros();
    } catch (e) { toast.error(e.response?.data?.error || 'Error al autorizar'); }
    finally { setProcesandoAut(false); }
  };

  const buscarClientes = async (q) => {
    if (!q || q.length < 2) { setBusquedaClientes([]); return; }
    setBuscandoCliente(true);
    try {
      const res = await api.get(`/contabilidad/clientes-activos?q=${encodeURIComponent(q)}&limit=8`);
      setBusquedaClientes(res.data?.data || []);
    } catch { setBusquedaClientes([]); }
    finally { setBuscandoCliente(false); }
  };

  const handleOperacionManual = async () => {
    if (!opSeleccionada) return toast.warning('Seleccione una operacion del Motor.');
    if (!opImporte || isNaN(parseFloat(opImporte))) return toast.warning('Ingrese el importe.');
    if (opSeleccionada.EvtUsaEntidad && !opClienteId) return toast.warning(`La operacion requiere seleccionar un cliente.`);
    setProcesandoOp(true);
    try {
      await api.post('/contabilidad/caja/operacion-manual', {
        evtCodigo: opSeleccionada.EvtCodigo, clienteId: opClienteId || null,
        importe: parseFloat(opImporte), moneda: opMoneda, monedaId: opMoneda === 'USD' ? 2 : 1,
        cotizacion: opMoneda === 'USD' ? cotizacion : null, metodoPagoId: opMetodoId || null, observaciones: opObs,
      });
      toast.success(`Operacion "${opSeleccionada.EvtNombre}" registrada correctamente.`);
      setOpSeleccionada(null); setOpClienteId(''); setOpClienteNombre(''); setOpImporte(''); setOpObs(''); setOpMetodoId(''); setBusquedaClientes([]);
    } catch (e) { toast.error(e.response?.data?.error || 'Error al procesar operacion'); }
    finally { setProcesandoOp(false); }
  };

  const retirosFiltrados = useMemo(() => {
    const t = searchTerm.toLowerCase().trim();
    if (!t) return retiros;
    return retiros.filter(r =>
      (r.ordenDeRetiro || '').toLowerCase().includes(t) ||
      (r.CliNombre || '').toLowerCase().includes(t) ||
      (r.CliCodigoCliente || '').toLowerCase().includes(t) ||
      r.orders?.some(o => (o.orderNumber || '').toLowerCase().includes(t) || String(o.orderId) === t)
    );
  }, [retiros, searchTerm]);

  if (loadingSesion && !isAdminCaja) return <div className="p-10 text-white flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  if (modalApertura && !isAdminCaja) {
    return (
      <div className="min-h-full bg-zinc-50 flex items-center justify-center p-4 text-zinc-800 font-sans">
        <div className="bg-white border border-zinc-200 rounded-2xl max-w-sm w-full p-8 shadow-2xl flex flex-col gap-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-100 border border-zinc-300 flex items-center justify-center mb-2 shadow-inner">
              <LockKeyhole size={32} className="text-brand-cyan" />
            </div>
            <h2 className="text-3xl font-black text-zinc-800 tracking-tight">Caja Cerrada</h2>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest leading-relaxed">Debes abrir una sesión de turno para registrar movimientos de dinero.</p>
          </div>
          <div className="flex flex-col gap-3">
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-1">Monto Inicial en Efectivo ($)</label>
            <input
              type="number"
              autoFocus
              placeholder="Ej: 5000.00"
              value={montoInicial}
              onChange={e => setMontoInicial(e.target.value)}
              className="bg-zinc-50 border-2 border-zinc-200 focus:border-brand-cyan rounded-2xl px-6 py-4 text-3xl font-black text-center text-zinc-800 outline-none transition-all shadow-inner placeholder-zinc-300"
            />
          </div>
          <button onClick={handleAbrirCaja} className="w-full bg-brand-cyan hover:bg-amber-500 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-brand-cyan/20 flex justify-center items-center gap-3 uppercase tracking-widest text-sm">
            Abrir Caja <ArrowRight size={20} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {createPortal(
        <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '80mm', pointerEvents: 'none', zIndex: -1 }}>
          <TicketImpresion ref={ticketRef} data={ticketData} />
        </div>,
        document.body
      )}

      <div className="min-h-full bg-[#0f1117] text-slate-200 font-sans flex flex-col h-full overflow-hidden">
        <div className="border-b border-zinc-200 bg-zinc-50 shrink-0">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-cyan/20 flex items-center justify-center text-brand-cyan font-bold">{isAdminCaja ? 'A' : 'C'}</div>
              <div>
                <h1 className="text-lg font-black text-custom-dark leading-none tracking-tight">{isAdminCaja ? 'Caja Administrativa' : 'Caja Central'}</h1>
                {!isAdminCaja && <p className="text-xs text-emerald-400 font-bold mt-0.5">Estado: ABIERTA</p>}
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <form onSubmit={async (e) => {
                e.preventDefault();
                const val = new FormData(e.target).get('q');
                if (!val || val.length < 2) return toast.warning('Ingresá al menos 2 caracteres');
                try {
                  const res = await api.get(`/apiordenesRetiro/mostrador/buscar?q=${val}`);
                  const data = res.data || {};
                  const combined = [
                    ...(data.retiroRows || []),
                    ...(data.sinRetiro || []).map(o => ({
                      OReIdOrdenRetiro: o.OrdIdOrden,
                      ordenDeRetiro: o.OrdCodigoOrden,
                      CliNombre: o.CliNombre,
                      CliCodigo: o.CliCodigo,
                      OReCostoTotalOrden: o.OrdCostoFinal,
                      Pagada: o.Pagada,
                      estadoRetiro: o.estadoOrden,
                      OReFechaAlta: o.OReFechaAlta || null,
                      orders: [{
                        orderNumber: o.OrdCodigoOrden,
                        orderEstado: o.estadoOrden,
                        orderCosto: o.MonSimbolo ? `${o.MonSimbolo} ${parseFloat(o.OrdCostoFinal).toFixed(2)}` : `$ ${parseFloat(o.OrdCostoFinal).toFixed(2)}`,
                        monedaId: (o.MonSimbolo && o.MonSimbolo.includes('US')) ? 2 : 1
                      }]
                    }))
                  ];
                  setRetiros(combined);
                  setSearchTerm(val);
                  setActiveTab('INGRESOS');
                  setSubTabIngreso('COBRO');
                  toast.success(`Resultados para "${val}"`);
                } catch { toast.error('Error en búsqueda global'); }
              }} className="relative group/topsearch flex items-center">
                <Search size={14} className="absolute left-3.5 text-zinc-400 group-focus-within/topsearch:text-brand-cyan transition-colors" />
                <input
                  name="q"
                  type="text"
                  placeholder="BUSCAR PEDIDO..."
                  className="bg-zinc-50 border border-zinc-200 hover:border-zinc-300 rounded-full pl-10 pr-4 py-1.5 text-[11px] font-black tracking-widest text-zinc-800 placeholder-zinc-300 outline-none w-64 focus:w-80 focus:border-brand-cyan focus:bg-white transition-all shadow-inner"
                />
                <button type="submit" className="hidden">Buscar</button>
              </form>
              <div className="bg-white flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 h-9">
                <RefreshCw size={14} className={`text-brand-cyan cursor-pointer hover:text-brand-cyan/80 ${loadingCot ? 'animate-spin' : ''}`} onClick={buscarCotizBCU} />
                <span className="font-bold text-custom-dark">1 US$ = <span className="text-brand-cyan">${cotizacion ? fmt(cotizacion) : '---'}</span></span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 px-4 pt-2">
            {[
              { id: 'INGRESOS', label: 'Ingresos a Caja', icon: ArrowDownCircle, color: 'text-emerald-500', bgBorder: 'bg-emerald-500' },
              { id: 'EGRESOS', label: 'Salidas / Pagos', icon: ArrowUpCircle, color: 'text-brand-magenta', bgBorder: 'bg-brand-magenta' },
              { id: 'OPERACIONES', label: 'Operaciones Turno', icon: History, color: 'text-amber-500', bgBorder: 'bg-amber-500' }
            ].map(t => (
              <button key={t.id} onClick={() => { setActiveTab(t.id); if (t.id === 'INGRESOS') setSubTabIngreso('COBRO'); }}
                className={`px-8 py-4 rounded-t-3xl text-[10px] font-black font-archivo uppercase tracking-widest flex items-center gap-3 transition-all border-x border-t relative group overflow-hidden ${activeTab === t.id ? 'bg-white border-zinc-200 text-custom-dark shadow-sm' : 'bg-transparent border-transparent text-zinc-400 hover:text-custom-dark'}`}>
                <t.icon size={18} className={`transition-transform duration-300 ${activeTab === t.id ? t.color + ' scale-110' : 'opacity-40 group-hover:opacity-100 group-hover:scale-110'}`} />
                {t.label}
                {activeTab === t.id && <div className={`absolute top-0 inset-x-0 h-1 ${t.bgBorder}`}></div>}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 bg-zinc-50 flex overflow-hidden">

          {activeTab === 'INGRESOS' && (
            <div className="flex-1 flex flex-col overflow-hidden">

              <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-1 shrink-0 shadow-sm z-10 overflow-x-auto">
                {[
                  { id: 'COBRO', label: 'Pago de Pedidos', icon: ShoppingCart },
                  { id: 'VENTA', label: 'Venta de Recursos Adelantados', icon: Plus },
                  { id: 'VENTA_DIRECTA', label: 'Venta Libre', icon: Tag },
                  { id: 'SALDO_FAVOR', label: 'Ingreso de Saldo Anticipado', icon: Wallet },
                  { id: 'OTROS_INGRESOS', label: 'Otros Ingresos', icon: ArrowDownCircle },
                  { id: 'PAGO_DEUDAS', label: 'Pago de Deudas', icon: FileMinus }
                ].map(st => (
                  <button key={st.id} onClick={() => setSubTabIngreso(st.id)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl font-black font-archivo text-[10px] uppercase tracking-widest transition-all border whitespace-nowrap ${subTabIngreso === st.id ? 'bg-brand-cyan border-brand-cyan text-white' : 'bg-transparent border-transparent text-zinc-400 hover:text-zinc-800'}`}>
                    <st.icon size={16} /> {st.label}
                  </button>
                ))}
              </div>

              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 overflow-hidden flex flex-col relative bg-[#f1f5f9]">
                  {subTabIngreso === 'COBRO' && (
                    <div className="flex-1 flex overflow-hidden">
                      <div className="w-[440px] border-r border-slate-200 flex flex-col bg-white shrink-0 shadow-lg z-0">
                        <div className="p-6 border-b border-slate-100 flex flex-col gap-5 bg-slate-50/50">
                          <h3 className="font-black font-archivo text-slate-400 text-[10px] uppercase tracking-widest flex items-center gap-2 px-1">
                            <Search size={12} /> Buscar Pedidos Disponibles
                          </h3>
                          <div className="relative group">
                            <Search size={22} className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-brand-cyan transition-colors" />
                            <input
                              type="text"
                              placeholder="Ingrese orden o cliente..."
                              value={searchTerm}
                              onChange={e => setSearchTerm(e.target.value)}
                              className="bg-zinc-100 border-2 border-zinc-300 rounded-3xl pl-14 pr-6 py-4 text-base text-zinc-100 placeholder-zinc-600 outline-none w-full focus:border-brand-cyan transition-all font-black font-archivo"
                            />
                          </div>
                          <div className="flex gap-2 flex-wrap px-1">
                            {[{ val: 'todos', l: 'Todos' }, { val: '1', l: 'Comunes' }, { val: '2', l: 'Semanales' }, { val: '3', l: 'Rollos' }].map(f => (
                              <button
                                key={f.val}
                                onClick={() => setFiltroTipo(f.val)}
                                className={`px-4 py-2 text-[10px] font-black font-archivo rounded-xl uppercase tracking-widest transition-all ${filtroTipo === f.val ? 'bg-brand-cyan text-white shadow-md' : 'text-zinc-500 hover:bg-zinc-100'}`}
                              >
                                {f.l}
                              </button>
                            ))}
                            <div className="ml-auto flex items-center gap-2">
                              {seleccionados.length > 0 && (
                                <button
                                  onClick={() => setSeleccionados([])}
                                  className="text-[10px] font-black text-brand-magenta bg-brand-magenta/10 px-3 py-1.5 rounded-xl border border-brand-magenta/20 hover:bg-brand-magenta/20 transition-colors uppercase tracking-widest flex items-center gap-1"
                                >
                                  <X size={12} /> Desmarcar Todos
                                </button>
                              )}
                              <span className="text-[10px] font-black text-zinc-400 self-center bg-zinc-100 px-3 py-1.5 rounded-xl border border-zinc-300">{retirosFiltrados.length} Registros</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                          {retirosFiltrados.length === 0 ? (
                            <div className="m-auto text-center opacity-30 px-6">
                              <Search size={48} className="mx-auto mb-3 text-zinc-300" />
                              <p className="text-sm font-black uppercase tracking-widest text-zinc-400">Sin pedidos por cobrar</p>
                            </div>
                          ) : retirosFiltrados.map(r => {
                            const sel = seleccionados.find(x => x.retiroId === (r.OReIdOrdenRetiro || r.ordenDeRetiro));
                            let sumUsd = 0, sumUyu = 0;
                            getOrdenes(r).forEach(o => {
                              if (o.orderIdMetodoPago !== null || o.orderPago !== null) return;
                              const val = parseFloat((o.orderCosto || '').replace(/[^0-9.-]/g, '')) || 0;
                              if (o.monedaId === 2) sumUsd += val; else sumUyu += val;
                            });
                            return (
                              <div key={r.ordenDeRetiro} onClick={() => toggleSeleccion(r)}
                                className={`cursor-pointer shrink-0 rounded-xl p-3 border-2 transition-all flex flex-col gap-2 relative overflow-hidden group ${sel ? 'border-brand-cyan bg-brand-cyan/10' : 'border-zinc-200 bg-white/50 hover:border-zinc-300'}`}>

                                {/* Fila superior: checkbox + cliente + pill + monto */}
                                <div className="flex items-center gap-2">
                                  {/* Checkbox */}
                                  <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${sel ? 'border-brand-cyan bg-brand-cyan shadow-md shadow-brand-cyan/20' : 'border-zinc-200 bg-zinc-100 group-hover:border-zinc-300'}`}>
                                    {sel && <CheckCircle size={12} className="text-white" />}
                                  </div>

                                  {/* Nombre + pill */}
                                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <p className="text-xs font-black text-zinc-700 group-hover:text-zinc-900 transition-colors truncate uppercase tracking-wide">{r.CliNombre || 'Consumidor Final'}</p>
                                    <span className="text-[9px] font-black text-brand-cyan bg-brand-cyan/10 px-1.5 py-0.5 rounded-md border border-brand-cyan/20 uppercase tracking-widest shrink-0">{r.CliCodigoCliente || 'S/C'}</span>
                                  </div>

                                  {/* Montos */}
                                  <div className="flex flex-col items-end shrink-0 gap-0.5">
                                    {sumUsd > 0 && <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md text-[9px] font-black border border-emerald-100">US$ {fmt(sumUsd)}</span>}
                                    {sumUyu > 0 && <span className="bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded-md text-[9px] font-black border border-brand-cyan/20">${fmt(sumUyu)}</span>}
                                  </div>
                                </div>

                                {/* Fila inferior: código orden + estado */}
                                <div className="flex items-center gap-2 pl-7">
                                  <span className={`font-black text-xs tracking-tight uppercase ${sel ? 'text-brand-cyan' : 'text-zinc-400'}`}>{r.ordenDeRetiro}</span>
                                  <span className="text-[9px] text-zinc-400 uppercase tracking-widest">{r.lugarRetiro || 'Retiro Local'}</span>
                                  {r.estadoRetiro && <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest bg-zinc-100 px-1.5 py-0.5 rounded ml-auto">{r.estadoRetiro}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col min-h-0">
                        {globalClient.id && (
                          <div className="px-6 py-2 border-b border-zinc-200 bg-white/80  z-50 shadow-sm shrink-0">
                            <ClienteBilletera
                              clienteId={globalClient.id}
                              clienteNombre={globalClient.nombre}
                            />
                          </div>
                        )}

                        <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-4">
                          {seleccionados.length === 0 ? (
                            <div className="m-auto text-center opacity-40">
                              <ShoppingCart size={80} className="mx-auto mb-4 text-zinc-300" />
                              <p className="font-black uppercase tracking-widest text-zinc-400">Selecciona órdenes para cobrar</p>
                            </div>
                          ) : (
                            <div className="animate-in fade-in slide-in-from-bottom-5 duration-500 flex flex-col gap-8">
                              <div className="flex justify-between items-center border-b border-zinc-200 pb-6">
                                <h2 className="text-2xl font-black text-zinc-800 tracking-tight">Resumen de Cobro</h2>
                                <div className="flex bg-white rounded-2xl p-1.5 border border-zinc-200 shadow-inner">
                                  <button
                                    onClick={() => setMonedaExhibicion('UYU')}
                                    className={`px-6 py-2 text-[10px] font-black font-archivo uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 ${monedaExhibicion === 'UYU' ? 'bg-brand-cyan text-white' : 'text-zinc-400 hover:text-zinc-700'}`}
                                  >
                                    Pesos ($)
                                  </button>
                                  <button
                                    onClick={() => setMonedaExhibicion('USD')}
                                    className={`px-6 py-2 text-[10px] font-black font-archivo uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 ${monedaExhibicion === 'USD' ? 'bg-brand-cyan text-white' : 'text-zinc-400 hover:text-zinc-700'}`}
                                  >
                                    Dólares (US$)
                                  </button>
                                </div>
                              </div>
                              {seleccionados.map(s => (
                                <div key={s.retiroId} className="bg-white border border-zinc-200 rounded-3xl p-6 flex flex-col gap-4 hover:border-zinc-300 transition-all">
                                  <div className="flex justify-between items-start mb-1">
                                    <div className="flex-1 flex items-center gap-4 flex-wrap">
                                      <span className="font-black text-xl text-brand-cyan tracking-tight">{s.codigoRef}</span>
                                      <span className="text-sm text-zinc-700 font-bold tracking-tight bg-zinc-50 px-3 py-1 rounded-xl border border-zinc-200">
                                        <span className="text-zinc-400">ID: {s.retiro?.CliCodigoCliente || '-'}</span> {s.descripcion}
                                      </span>
                                      <span className="text-[9px] text-zinc-400 font-black uppercase tracking-widest border border-zinc-200 px-3 py-1 rounded-full shrink-0 shadow-inner">{s.retiro?.lugarRetiro || 'Retiro en el Local'}</span>
                                    </div>
                                    <div className="flex gap-4">
                                      <div className="text-right">
                                        <p className="text-[9px] text-zinc-400 font-black uppercase tracking-widest">Saldo Base</p>
                                        <p className="font-black text-zinc-800 text-lg">{monedaExhibicion === 'USD' ? 'US$' : '$'}{fmt(calcularMontoPorMoneda(s.retiro, monedaExhibicion))}</p>
                                      </div>
                                      <div className="w-px h-10 bg-zinc-100 self-center"></div>
                                      <div>
                                        <p className="text-[9px] text-zinc-400 font-black uppercase tracking-widest">Ajuste Manual</p>
                                        <input type="number" value={ajustes[s.retiroId]?.ajuste || ''} onChange={e => setAjustes(p => ({ ...p, [s.retiroId]: { ...p[s.retiroId], ajuste: e.target.value } }))} className="bg-zinc-50 border-2 border-zinc-200 rounded-xl px-3 py-2 w-24 text-brand-cyan font-black text-sm outline-none focus:border-brand-cyan/50 transition-all shadow-inner" placeholder="0.0" />
                                      </div>
                                      <div>
                                        <p className="text-[9px] text-zinc-400 font-black uppercase tracking-widest">Motivo Ajuste</p>
                                        <LightSelect
                                          value={ajustes[s.retiroId]?.tipoAjuste || ''}
                                          onChange={val => setAjustes(p => ({ ...p, [s.retiroId]: { ...p[s.retiroId], tipoAjuste: val } }))}
                                          options={TIPOS_AJUSTE.map(t => ({ value: t.value, label: t.label }))}
                                          placeholder="Sin ajuste"
                                        />
                                      </div>
                                    </div>
                                  </div>


                                  <div className="flex flex-col gap-2 border-t border-zinc-100 pt-5">
                                    {getOrdenes(s.retiro).map(o => {
                                      const val = parseFloat((o.orderCosto || '').replace(/[^0-9.-]/g, '')) || 0;
                                      const currency = o.monedaId === 2 ? 'US$' : '$';
                                      const pagado = o.orderIdMetodoPago !== null || o.orderPago !== null;
                                      const cubierto = o.orderEstado === 'Abonado' || o.orderEstado === 'Autorizado';
                                      return (
                                        <div key={o.orderId} className={`flex justify-between items-center px-4 py-3 mt-1 rounded-2xl border gap-4 ${(pagado || cubierto) ? 'bg-zinc-50 border-zinc-900 opacity-60' : 'bg-white border-zinc-200'}`}>
                                          <div className="flex items-center gap-4 w-full truncate text-xs">
                                            <AlertCircle size={14} className={`shrink-0 ${(pagado || cubierto) ? 'text-zinc-300' : 'text-brand-cyan/50'}`} />
                                            <span className="font-black text-zinc-400 shrink-0 text-[10px]">#{o.orderNumber || o.orderId}</span>
                                            <span className="font-bold text-zinc-800 truncate">Trabajo: {o.orderNombreTrabajo || 'Impreso'}</span>
                                            <span className="font-medium text-zinc-400 truncate hidden md:block">Material: {o.orderMaterial || '-'}</span>
                                            <span className="font-black text-zinc-700 shrink-0 bg-zinc-50 px-2 py-0.5 rounded-lg text-[9px] border border-zinc-900">Cant: {o.orderCantidad || '?'}</span>
                                          </div>
                                          <div className="flex items-center gap-4 shrink-0">
                                            <span className={`font-black text-zinc-800 min-w-[80px] text-right ${cubierto ? 'line-through text-zinc-400' : ''}`}>{currency} {fmt(val)}</span>
                                            {pagado ? (
                                              <span className="w-20 text-center px-2 py-1 bg-emerald-50 text-emerald-500 text-[9px] font-black rounded-lg border border-emerald-100 uppercase tracking-widest">Facturada</span>
                                            ) : cubierto ? (
                                              <span className="w-24 text-center px-2 py-1 bg-brand-cyan/10 text-brand-cyan text-[9px] font-black rounded-lg border border-brand-cyan/20 uppercase tracking-widest">{o.orderEstado === 'Autorizado' ? 'Autorizado' : 'Abonada'}</span>
                                            ) : (
                                              <span className="w-20 text-center px-2 py-1 bg-brand-magenta/10 text-brand-magenta text-[9px] font-black rounded-lg border border-brand-magenta/20 uppercase tracking-widest">Pendiente</span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {subTabIngreso === 'VENTA' && (
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                      <CajaVentaDirectaTab
                        allowedTipos={['RECURSO']}
                        metodosPago={metodosPago}
                        cotizacion={cotizacion}
                        tiposDocDisponibles={tiposDocumentos.length > 0 ? tiposDocumentos : TIPOS_DOC}
                        isAdminCaja={isAdminCaja}
                        onVentaExitosa={() => { fetchRetiros(); setVentaPagos([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]); setVentaObs(''); setVentaTotalACubrir(0); setVentaMoneda('UYU'); setVentaClienteId(''); setVentaClienteNombre(''); }}
                        onClienteChange={(c) => {
                          setVentaClienteId(c?.CliIdCliente || '');
                          setVentaClienteNombre(c?.Nombre || '');
                        }}
                        pagos={ventaPagos}
                        onPagosChange={setVentaPagos}
                        tipoDocumento={ventaTipoDoc}
                        onTipoDocumento={setVentaTipoDoc}
                        obs={ventaObs}
                        onObs={setVentaObs}
                        procesando={procesandoVenta}
                        onConfirmar={async (payload) => {
                          if (!payload.header.clienteId) { toast.warning('Debe seleccionar un cliente.'); return; }
                          if (!payload.items.every(i => i.codigo && i.precioTotal && i.cantidad)) { toast.warning('Complete todos los campos de los ítems.'); return; }

                          const pagosFilt = ventaPagos.filter(p => p.monto && p.metodoPagoId);
                          if (pagosFilt.length === 0 && ventaTotalACubrir > 0) {
                            const confirm = await Swal.fire({
                              title: '¿Venta a Crédito?',
                              html: `No ingresaste ninguna <b>Forma de Pago</b>.<br/><br/>Esto enviará la venta 100% a la cuenta corriente del cliente como <b>deuda (-${ventaMoneda === 'USD' ? 'US$' : '$'} ${ventaTotalACubrir})</b>.<br/><br/>¿Es correcto o te olvidaste de agregar el pago?`,
                              icon: 'warning',
                              showCancelButton: true,
                              confirmButtonText: 'Sí, vender a crédito',
                              cancelButtonText: 'Uy, olvidé el pago'
                            });
                            if (!confirm.isConfirmed) return;
                          }

                          setProcesandoVenta(true);
                          try {
                            const ventaPayload = { ...payload, pagos: ventaPagos.filter(p => p.monto && p.metodoPagoId).map(p => ({ metodoPagoId: parseInt(p.metodoPagoId), montoOriginal: parseFloat(p.monto), monedaId: p.moneda === 'USD' ? 2 : 1, cotizacion: p.moneda === 'USD' ? cotizacion : null, referenciaNumero: '' })) };
                            const res = await api.post('/contabilidad/caja/venta-directa', ventaPayload);
                            toast.success(`Venta procesada. Comprobante: ${res.data.numeroDocFormato || res.data.tcaIdTransaccion}`);

                            const ventaTicket = {
                              empresa: 'MACROSOFT LTDA',
                              fecha: new Date().toLocaleString('es-UY'),
                              comprobante: res.data.numeroDocFormato || `TCA-${res.data.tcaIdTransaccion}`,
                              cajero: sesion?.usrLogin || 'Sistema',
                              cliente: payload.header.clienteId ? (payload._clienteNombre || 'Cliente') : 'Consumidor Final',
                              items: payload.items.map(it => ({
                                descripcion: it.descripcion || it.codigo,
                                cantidad: it.cantidad,
                                importe: it.precioTotal
                              })),
                              totales: {
                                subtotal: res.data.totalBruto,
                                total: res.data.totalBruto,
                                moneda: ventaMoneda === 'USD' ? 'US$' : '$'
                              },
                              pagos: ventaPagos.filter(p => p.monto && p.metodoPagoId).map(p => ({
                                metodo: metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId))?.MPaDescripcionMetodo || 'Pago',
                                moneda: p.moneda,
                                monto: p.monto
                              }))
                            };
                            setTicketData(ventaTicket);
                            printTicketData(ventaTicket);

                            fetchRetiros(); setVentaPagos([{ id: Date.now(), metodoPagoId: 1, moneda: 'UYU', monedaId: 1, monto: '' }]); setVentaObs(''); setVentaTotalACubrir(0); setVentaMoneda('UYU');
                          } catch (e) { toast.error(e.response?.data?.error || 'Error al procesar venta'); }
                          finally { setProcesandoVenta(false); }
                        }}
                        onTotalChange={(t, m) => { setVentaTotalACubrir(t); if (m) setVentaMoneda(m); }}
                      />
                    </div>
                  )}
                  {subTabIngreso === 'VENTA_DIRECTA' && (
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                      <CajaVentaDirectaTab
                        defaultTipo="VENTA_INSUMOS" allowedTipos={['VENTA_INSUMOS', 'VENTA_PRODUCTOS']}
                        metodosPago={metodosPago}
                        isAdminCaja={isAdminCaja}
                        cotizacion={cotizacion}
                        onVentaExitosa={() => { fetchRetiros(); setVentaPagos([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]); setVentaObs(''); setVentaTotalACubrir(0); setVentaMoneda('UYU'); setVentaClienteId(''); setVentaClienteNombre(''); }}
                        onClienteChange={(c) => {
                          setVentaClienteId(c?.CliIdCliente || '');
                          setVentaClienteNombre(c?.Nombre || '');
                        }}
                        pagos={ventaPagos}
                        onPagosChange={setVentaPagos}
                        tipoDocumento={ventaTipoDoc}
                        onTipoDocumento={setVentaTipoDoc}
                        obs={ventaObs}
                        onObs={setVentaObs}
                        procesando={procesandoVenta}
                        onConfirmar={async (payload) => {
                          if (!payload.header.clienteId) { toast.warning('Debe seleccionar un cliente.'); return; }
                          if (!payload.items.every(i => i.codigo && i.precioTotal && i.cantidad)) { toast.warning('Complete todos los campos de los ítems.'); return; }
                          setProcesandoVenta(true);
                          try {
                            const ventaPayload = { ...payload, pagos: ventaPagos.filter(p => p.monto && p.metodoPagoId).map(p => ({ metodoPagoId: parseInt(p.metodoPagoId), montoOriginal: parseFloat(p.monto), monedaId: p.moneda === 'USD' ? 2 : 1, cotizacion: p.moneda === 'USD' ? cotizacion : null, referenciaNumero: '' })) };
                            const res = await api.post('/contabilidad/caja/venta-directa', ventaPayload);
                            toast.success('Venta procesada');
                            fetchRetiros(); setVentaPagos([{ id: Date.now(), metodoPagoId: 1, moneda: 'UYU', monedaId: 1, monto: '' }]); setVentaObs(''); setVentaTotalACubrir(0); setVentaMoneda('UYU');
                          } catch (e) { toast.error('Error al procesar venta'); }
                          finally { setProcesandoVenta(false); }
                        }}
                        onTotalChange={(t, m) => { setVentaTotalACubrir(t); if (m) setVentaMoneda(m); }}
                      />
                    </div>
                  )}
                  {subTabIngreso === 'SALDO_FAVOR' && (
                    <CajaSaldoAnticipoTab
                      sesion={sesion}
                      metodosPago={metodosPago}
                      cotizacion={cotizacion}
                      onCobroCompletado={() => {}}
                    />
                  )}
                  {subTabIngreso === 'OTROS_INGRESOS' && (
                    <CajaOtrosIngresosTab
                      sesion={sesion}
                      metodosPago={metodosPago}
                      cotizacion={cotizacion}
                      tiposDocDisponibles={tiposDocumentos.length > 0 ? tiposDocumentos : TIPOS_DOC}
                      onCobroCompletado={() => { fetchRetiros(); }}
                      isAdminCaja={isAdminCaja}
                    />
                  )}
                  {subTabIngreso === 'PAGO_DEUDAS' && (
                    <CajaPagoDeudaTab
                      sesion={sesion}
                      metodosPago={metodosPago}
                      cotizacion={cotizacion}
                      tiposDocDisponibles={tiposDocumentos.length > 0 ? tiposDocumentos : TIPOS_DOC}
                      onPagoCompletado={() => { fetchRetiros(); }}
                      isAdminCaja={isAdminCaja}
                    />
                  )}
                  {subTabIngreso === 'MOTOR' && (
                    <div className="flex-1 p-6 flex gap-6 bg-[#f1f5f9] overflow-hidden">
                      <div className="w-80 flex flex-col gap-4 shrink-0">
                        <div className="bg-white border border-zinc-200 rounded-[2rem] overflow-hidden flex flex-col flex-1 shadow-2xl">
                          <div className="px-6 py-5 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                            <div>
                              <h3 className="font-black text-zinc-800 flex items-center gap-2 text-xs uppercase tracking-widest">
                                <Zap size={14} className="text-brand-cyan" /> Operaciones
                              </h3>
                              <p className="text-[9px] text-zinc-400 mt-1 font-black uppercase tracking-widest">Reglas del Motor</p>
                            </div>
                            <LayoutGrid size={18} className="text-zinc-300" />
                          </div>
                          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-white">
                            {operacionesCaja.length === 0 && (
                              <div className="text-center text-zinc-400 text-[10px] uppercase font-black tracking-widest py-12 px-6">
                                <AlertCircle size={32} className="mx-auto mb-3 opacity-20" />
                                Sin operaciones
                              </div>
                            )}
                            {operacionesCaja.map(op => {
                              const sel = opSeleccionada?.EvtCodigo === op.EvtCodigo;
                              const colorEfecto = op.EvtGeneraDeuda ? 'text-amber-500' : op.EvtAfectaSaldo === 1 ? 'text-emerald-500' : op.EvtAfectaSaldo === -1 ? 'text-rose-500' : op.EvtAplicaRecurso ? 'text-brand-cyan' : 'text-zinc-400';
                              return (
                                <button key={op.EvtCodigo} onClick={() => { setOpSeleccionada(op); setOpClienteId(''); setOpClienteNombre(''); setOpImporte(''); }}
                                  className={`text-left p-4 rounded-2xl border-2 transition-all group relative overflow-hidden active:scale-[0.98] ${sel ? 'border-brand-cyan bg-brand-cyan-white shadow-lg shadow-brand-cyan/20' : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50 hover:bg-white text-zinc-500'}`}>
                                  {sel && <div className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-lg bg-brand-cyan  animate-in slide-in-from-top-4 duration-200"><CheckCircle size={12} className="text-white font-black" /></div>}
                                  <div className="flex justify-between items-start gap-2">
                                    <span className={`font-black text-sm transition-colors ${sel ? 'text-zinc-800' : 'text-zinc-700 group-hover:text-brand-cyan'}`}>{op.EvtNombre}</span>
                                    {!sel && <span className="text-[8px] font-black font-mono px-1.5 py-0.5 rounded-lg border border-zinc-200 text-zinc-400 uppercase transition-all group-hover:border-zinc-300">{op.EvtCodigo}</span>}
                                  </div>
                                  <div className={`text-[9px] mt-2 font-black uppercase tracking-widest ${sel ? 'text-brand-cyan' : colorEfecto}`}>
                                    {op.EvtGeneraDeuda ? '⚡ Genera deuda' : op.EvtAfectaSaldo === 1 ? '↑ Acredita saldo' : op.EvtAfectaSaldo === -1 ? '↓ Debita saldo' : '○ Neutro'}
                                    {op.EvtAplicaRecurso && ' · Recursos'}
                                  </div>
                                  {op.EvtDescripcion && <p className={`text-[9px] mt-2 line-clamp-1 italic font-bold leading-tight ${sel ? 'text-zinc-700' : 'text-zinc-400'}`}>"{op.EvtDescripcion}"</p>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col min-h-0 bg-[#f1f5f9]">
                        {globalClient.id && (
                          <div className="px-6 py-2 border-b border-zinc-200 bg-white/80  z-20 shrink-0 shadow-sm">
                            <ClienteBilletera
                              clienteId={globalClient.id}
                              clienteNombre={globalClient.nombre}
                            />
                          </div>
                        )}

                        <div className="flex-1 p-6 overflow-y-auto flex flex-col min-w-[500px]">
                          {!opSeleccionada ? (
                            <div className="m-auto text-center opacity-40 py-20 animate-pulse">
                              <Zap size={80} className="mx-auto mb-6 text-brand-cyan/30" />
                              <p className="text-zinc-800 text-2xl font-black tracking-tight">Selecciona una Operación</p>
                              <p className="text-zinc-400 text-[10px] mt-3 max-w-sm mx-auto font-black uppercase tracking-widest leading-relaxed">Elige un tipo de movimiento contable del menú izquierdo.</p>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-8 animate-in fade-in zoom-in-95 duration-500">
                              <div className="bg-white border border-zinc-200 rounded-[2.5rem] p-10 shadow-2xl max-w-3xl w-full flex flex-col gap-8 relative group/form overflow-hidden border-t-8 border-t-brand-cyan">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="text-[9px] font-black bg-brand-cyan/10 text-brand-cyan px-3 py-1 rounded-full uppercase tracking-widest border border-brand-cyan/20 shadow-sm">Operación Motor</span>
                                      <History size={16} className="text-zinc-300" />
                                    </div>
                                    <h2 className="text-3xl font-black text-zinc-800 flex items-center gap-4 tracking-tight"><Zap size={28} className="text-brand-cyan" /> {opSeleccionada.EvtNombre}</h2>
                                    {opSeleccionada.EvtDescripcion && <p className="text-sm text-zinc-400 mt-2 font-bold italic">"{opSeleccionada.EvtDescripcion}"</p>}
                                  </div>
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="text-xs font-black font-mono bg-zinc-50 border-2 border-zinc-200 px-4 py-1.5 rounded-xl text-zinc-400 shadow-inner group-hover/form:border-brand-cyan/30 transition-colors uppercase">{opSeleccionada.EvtCodigo}</span>
                                  </div>
                                </div>

                                <div className="flex gap-3 flex-wrap pb-6 border-b border-zinc-200">
                                  {opSeleccionada.EvtGeneraDeuda && <span className="text-[9px] font-black bg-amber-50 border border-amber-100 text-amber-500 px-4 py-1.5 rounded-xl uppercase tracking-widest shadow-sm">⚡ Genera deuda</span>}
                                  {opSeleccionada.EvtAfectaSaldo === 1 && <span className="text-[9px] font-black bg-emerald-50 border border-emerald-100 text-emerald-500 px-4 py-1.5 rounded-xl uppercase tracking-widest shadow-sm">↑ Acredita Saldo</span>}
                                  {opSeleccionada.EvtAfectaSaldo === -1 && <span className="text-[9px] font-black bg-rose-50 border border-rose-100 text-rose-500 px-4 py-1.5 rounded-xl uppercase tracking-widest shadow-sm">↓ Debita Saldo</span>}
                                  {opSeleccionada.EvtAplicaRecurso && <span className="text-[9px] font-black bg-brand-cyan/10 border border-brand-cyan/20 text-brand-cyan px-4 py-1.5 rounded-xl uppercase tracking-widest shadow-sm">◎ Aplica Recursos</span>}
                                </div>

                                <div className="flex flex-col gap-8">
                                  {(opSeleccionada.EvtUsaEntidad || opSeleccionada.EvtAfectaSaldo !== 0) && (
                                    <div className="relative">
                                      <label className="flex items-center justify-between text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3 px-1">
                                        <span>Selección de Cliente {opSeleccionada.EvtUsaEntidad ? '(OBLIGATORIO)' : '(OPCIONAL)'}</span>
                                        {opClienteId && <span className="text-emerald-500 flex items-center gap-1.5 font-black bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100">Cliente Verificado <CheckCircle size={12} /></span>}
                                      </label>
                                      <div className={`relative flex items-center group/search rounded-[1.5rem] transition-all`}>
                                        <div className="absolute left-5 text-zinc-300 group-focus-within/search:text-brand-cyan transition-colors">
                                          <Search size={22} />
                                        </div>
                                        <input
                                          type="text"
                                          placeholder="Buscar por Nombre, RUT o Código..."
                                          value={opClienteNombre}
                                          onChange={e => { setOpClienteNombre(e.target.value); setOpClienteId(''); buscarClientes(e.target.value); }}
                                          className={`w-full bg-zinc-50 border-2 ${opClienteId ? 'border-emerald-500/50 bg-white' : 'border-zinc-200 hover:border-zinc-300 focus:border-brand-cyan focus:bg-white'} rounded-[1.5rem] pl-16 pr-6 py-5 text-lg font-bold text-zinc-800 placeholder-zinc-300 outline-none transition-all shadow-inner`}
                                        />
                                        {buscandoCliente && <div className="absolute right-5"><Loader2 size={24} className="animate-spin text-brand-cyan" /></div>}
                                        {opClienteId && (
                                          <button onClick={() => { setOpClienteId(''); setOpClienteNombre(''); }} className="absolute right-5 p-2 bg-zinc-100 hover:bg-rose-500/20 rounded-full transition-all text-zinc-400 hover:text-rose-500">
                                            <X size={18} />
                                          </button>
                                        )}
                                      </div>

                                      {busquedaClientes.length > 0 && !opClienteId && (
                                        <div className="absolute z-50 top-full mt-3 left-0 right-0 bg-white border border-zinc-200 rounded-[2rem] shadow-[0_30px_90px_rgba(0,0,0,0.5)] overflow-hidden max-h-96 overflow-y-auto animate-in fade-in slide-in-from-top-4 duration-300">
                                          <div className="px-6 py-4 bg-zinc-50 text-[9px] font-black text-zinc-400 uppercase border-b border-zinc-200 flex items-center justify-between">
                                            <span>Sugerencias Encontradas</span>
                                            <span className="bg-white text-zinc-400 px-3 py-1 rounded-lg text-[9px] font-black border border-zinc-200 shadow-sm">{busquedaClientes.length} registros</span>
                                          </div>
                                          {busquedaClientes.map(c => (
                                            <button key={c.CliIdCliente}
                                              onClick={() => { setOpClienteId(c.CliIdCliente); setOpClienteNombre(`${c.CodCliente || ''} - ${c.Nombre}`); setBusquedaClientes([]); }}
                                              className="w-full text-left px-6 py-5 hover:bg-white text-sm border-b border-zinc-100 last:border-0 group flex items-center justify-between transition-all">
                                              <div className="flex items-center gap-5">
                                                <div className="w-12 h-12 rounded-2xl bg-zinc-50 flex items-center justify-center font-black text-zinc-300 group-hover:bg-brand-cyan group-hover:text-white transition-all border-2 border-zinc-200 group-hover:border-brand-cyan shadow-sm">
                                                  {c.Nombre?.[0] || 'C'}
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                  <span className="font-black text-zinc-800 group-hover:text-brand-cyan transition-colors text-lg">{c.Nombre}</span>
                                                  {c.NombreFantasia && <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-tight opacity-70">"{c.NombreFantasia}"</span>}
                                                  <div className="flex items-center gap-3 mt-1.5">
                                                    <span className="text-[9px] bg-zinc-50 text-zinc-400 px-2.5 py-1 rounded-lg font-black uppercase border border-zinc-200 group-hover:border-brand-cyan/30">ID: {c.CliIdCliente}</span>
                                                    <span className="text-[9px] text-zinc-400 font-black uppercase tracking-widest">{c.CodCliente || 'SIN CÓDIGO'}</span>
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                                <div className="bg-brand-cyan p-2.5 rounded-xl shadow-lg shadow-brand-cyan/20">
                                                  <ArrowRight size={20} className="text-white" />
                                                </div>
                                              </div>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  <div className="grid grid-cols-2 gap-8">
                                    <div className="col-span-1">
                                      <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3 px-1">Importe de Operación</label>
                                      <div className="flex group/amount shadow-sm rounded-[1.5rem] overflow-hidden border-2 border-zinc-200 focus-within:border-brand-cyan transition-all bg-zinc-50 focus-within:bg-white">
                                        <select value={opMoneda} onChange={e => setOpMoneda(e.target.value)} className="bg-white border-r border-zinc-200 px-5 font-black text-zinc-700 outline-none text-lg cursor-pointer hover:bg-zinc-100 transition-colors appearance-none">
                                          <option value="UYU">$</option>
                                          <option value="USD">U$</option>
                                        </select>
                                        <input
                                          type="number"
                                          placeholder="0.00"
                                          value={opImporte}
                                          onChange={e => setOpImporte(e.target.value)}
                                          className="w-full bg-transparent px-6 py-5 text-3xl font-black text-zinc-800 outline-none text-right placeholder-zinc-900"
                                        />
                                      </div>
                                      {opMoneda === 'USD' && cotizacion && (
                                        <div className="flex items-center justify-between mt-3 px-2">
                                          <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Cotización: {fmt(cotizacion)}</span>
                                          <p className="text-[11px] font-black text-emerald-500 tracking-tighter bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100 shadow-sm">≈ $ {fmt(parseFloat(opImporte || 0) * cotizacion)} UYU</p>
                                        </div>
                                      )}
                                    </div>

                                    <div className="col-span-1">
                                      <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3 px-1">Metodo de Pago (opcional)</label>
                                      <div className="relative group/pay shadow-sm">
                                        <CreditCard className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-300 group-focus-within/pay:text-brand-cyan transition-colors" size={22} />
                                        <select
                                          value={opMetodoId}
                                          onChange={e => setOpMetodoId(e.target.value)}
                                          className="w-full bg-zinc-50 border-2 border-zinc-200 hover:border-zinc-300 focus:border-brand-cyan focus:bg-white rounded-[1.5rem] pl-16 pr-6 py-5 text-base font-bold text-zinc-700 outline-none transition-all appearance-none shadow-inner cursor-pointer"
                                        >
                                          <option value="">A elección en asiento...</option>
                                          {metodosPago.map(m => <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>)}
                                        </select>
                                        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-300">
                                          <ChevronRight size={20} className="rotate-90" />
                                        </div>
                                      </div>
                                    </div>

                                    <div className="col-span-2">
                                      <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3 px-1">Notas / Concepto / Glosa</label>
                                      <textarea
                                        value={opObs}
                                        onChange={e => setOpObs(e.target.value)}
                                        placeholder="Detalla el motivo de este movimiento para auditoría..."
                                        className="w-full bg-zinc-50 border-2 border-zinc-200 hover:border-zinc-300 focus:border-brand-cyan focus:bg-white rounded-[2rem] px-6 py-5 text-base text-zinc-700 font-bold outline-none resize-none h-32 transition-all shadow-inner placeholder-zinc-300"
                                      />
                                    </div>
                                  </div>

                                  <button
                                    onClick={handleOperacionManual}
                                    disabled={procesandoOp}
                                    className={`w-full py-6 rounded-[1.5rem] font-black text-xl flex items-center justify-center gap-4 transition-all shadow-xl active:scale-[0.98] mt-4 ${procesandoOp ? 'bg-zinc-100 cursor-not-allowed text-zinc-400' : 'bg-brand-cyan hover:bg-white text-white hover:shadow-brand-cyan/20'}`}
                                  >
                                    {procesandoOp ? <Loader2 size={28} className="animate-spin" /> : <><Zap size={28} className="fill-zinc-950/20" /> Registrar Movimiento</>}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {subTabIngreso === 'AUTORIZAR' && (
                    <div className="flex-1 flex min-h-0 bg-zinc-50">
                      <div className="w-[440px] bg-white border-r border-zinc-200 flex flex-col overflow-hidden shrink-0 shadow-lg z-10">
                        <div className="p-6 border-b border-zinc-200 bg-zinc-50">
                          <h3 className="font-black text-zinc-800 flex items-center gap-2 text-[10px] uppercase tracking-widest"><ShieldCheck className="text-brand-cyan" size={16} /> Retiros Pendientes</h3>
                          <div className="relative mt-4 group">
                            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-brand-cyan transition-colors" />
                            <input type="text" placeholder="Filtrar por nombre o ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-10 pr-4 py-2.5 text-xs text-zinc-800 font-bold outline-none focus:border-brand-cyan shadow-inner transition-all placeholder-zinc-300" />
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-white">
                          {retirosFiltrados.length === 0 ? (
                            <div className="text-center py-12 opacity-30">
                              <ShoppingCart size={40} className="mx-auto mb-2 text-zinc-300" />
                              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sin retiros pendientes</p>
                            </div>
                          ) : retirosFiltrados.map(r => (
                            <div key={r.ordenDeRetiro} onClick={() => setRetiroSelectAut({ retiroId: r.ordenDeRetiro, raw: r, deudaEstimada: calcularMontoRetiro(r) })}
                              className={`p-4 rounded-2xl border-2 cursor-pointer transition-colors ${retiroSelectAut?.retiroId === r.ordenDeRetiro ? 'border-brand-cyan bg-brand-cyan/10' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-white'}`}>
                              <div className="flex justify-between items-start mb-1">
                                <span className={`font-black text-sm tracking-tight uppercase ${retiroSelectAut?.retiroId === r.ordenDeRetiro ? 'text-brand-cyan' : 'text-zinc-700'}`}>ORDEN #{r.ordenDeRetiro}</span>
                                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">{r.OReFechaAlta ? new Date(r.OReFechaAlta).toLocaleDateString() : '-'}</span>
                              </div>
                              <div className="text-[11px] text-zinc-400 font-bold mb-3 uppercase truncate">{r.CliNombre}</div>
                              <div className="flex justify-between items-center bg-white/50 p-2 rounded-xl border border-zinc-100">
                                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Adeudado:</span>
                                <span className="font-black text-brand-magenta text-sm tracking-tighter">${fmt(calcularMontoRetiro(r))}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className={`flex-1 flex overflow-y-auto ${!retiroSelectAut ? 'items-center justify-center' : ''}`}>
                        {!retiroSelectAut ? (
                          <div className="text-center opacity-30 py-20 animate-pulse">
                            <ShieldCheck size={80} className="mx-auto mb-6 text-brand-cyan/30" />
                            <p className="text-zinc-800 text-2xl font-black tracking-tight">Autorización de Entrega</p>
                            <p className="text-zinc-400 text-[10px] mt-3 max-w-sm mx-auto font-black uppercase tracking-widest leading-relaxed">Selecciona un retiro de la lista para proceder.</p>
                          </div>
                        ) : (
                          <div className="flex-1 w-full bg-white p-10 flex flex-col gap-8 animate-in fade-in duration-300 border-t-8 border-t-brand-cyan shadow-sm">
                            <div className="text-center">
                              <div className="w-20 h-20 bg-brand-cyan/10 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-brand-cyan/20 shadow-sm">
                                <ShieldCheck size={40} className="text-brand-cyan" />
                              </div>
                              <h2 className="text-2xl font-black text-zinc-800 tracking-tight">Autorizar Entrega Sin Cobro</h2>
                              <p className="text-zinc-400 font-black mt-2 uppercase tracking-widest text-[9px]">Referencia de Retiro: <span className="text-brand-cyan">#{retiroSelectAut.retiroId}</span></p>
                            </div>

                            <div className="flex flex-col gap-6">
                              <div>
                                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-3 px-1">Motivo de la autorización <span className="text-rose-500">*</span></label>
                                <textarea autoFocus value={autMotivo} onChange={e => setAutMotivo(e.target.value)} placeholder="Ej: Autorizado por Gerencia, Cliente cuenta corriente, Paga mañana..." className="w-full bg-zinc-50 border-2 border-zinc-200 rounded-[1.5rem] p-5 text-zinc-700 font-bold outline-none focus:border-brand-cyan focus:bg-white h-32 resize-none transition-all shadow-inner placeholder-zinc-300"></textarea>
                              </div>

                              <div>
                                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-3 px-1">Vencimiento del compromiso (Opcional)</label>
                                <div className="relative group">
                                  <Calendar size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-300 group-focus-within:text-brand-cyan transition-colors" />
                                  <input type="date" value={autVencimiento} onChange={e => setAutVencimiento(e.target.value)} onClick={(e) => { try { e.target.showPicker(); } catch(err){} }} className="w-full bg-zinc-50 border-2 border-zinc-200 rounded-[1.5rem] pl-16 pr-5 py-4 text-zinc-700 font-bold outline-none focus:border-brand-cyan focus:bg-white transition-all shadow-inner cursor-pointer" />
                                </div>
                              </div>

                              <button onClick={handleAutorizar} disabled={procesandoAut} className="mt-4 w-full bg-brand-cyan hover:bg-white disabled:bg-zinc-100 text-white disabled:text-zinc-400 font-black py-6 rounded-[1.5rem] shadow-xl transition-all active:scale-[0.98] text-lg flex items-center justify-center gap-3 uppercase tracking-widest">
                                {procesandoAut ? <Loader2 className="animate-spin" size={24} /> : <><ShieldCheck size={24} /> CONFIRMAR Y AUTORIZAR</>}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {(subTabIngreso === 'COBRO' || subTabIngreso === 'MOTOR' || subTabIngreso === 'VENTA' || subTabIngreso === 'VENTA_DIRECTA') && (
                  <CajaPanelPago
                    mode={subTabIngreso}
                    tiposDocDisponibles={tiposDocumentos}
                    {...(subTabIngreso === 'COBRO' ? {
                      totalACubrir: totalesCobro.neto,
                      moneda: monedaExhibicion,
                      cotizacion: cotizacion,
                      metodosPago: metodosPago,
                      pagos: carritosPago,
                      onPagosChange: setCarritosPago,
                      tipoDoc: tipoDocCobro,
                      onTipoDoc: setTipoDocCobro,
                      serieDoc: serieDocCobro,
                      onSerieDoc: setSerieDocCobro,
                      numDoc: numDocCobro || numDocCobroPredict,
                      notas: obsCobro,
                      onNotas: setObsCobro,
                      onConfirmar: handleRealizarCobro,
                      procesando: procesandoCobro,
                      disabledExtra: seleccionados.length === 0 || !cobroBalanceado
                    } : (subTabIngreso === 'VENTA' || subTabIngreso === 'VENTA_DIRECTA') ? {
                      totalACubrir: ventaTotalACubrir,
                      moneda: ventaMoneda,
                      cotizacion: cotizacion,
                      metodosPago: metodosPago,
                      pagos: ventaPagos,
                      onPagosChange: setVentaPagos,
                      tipoDoc: ventaTipoDoc,
                      onTipoDoc: setVentaTipoDoc,
                      serieDoc: ventaSerieDoc,
                      onSerieDoc: setVentaSerieDoc,
                      numDoc: '',
                      notas: ventaObs,
                      onNotas: setVentaObs,
                      onConfirmar: () => document.dispatchEvent(new CustomEvent('caja:confirmarVenta')),
                      procesando: procesandoVenta,
                      disabledExtra: procesandoVenta
                    } : {
                      totalACubrir: parseFloat(opImporte) || 0,
                      moneda: opMoneda,
                      cotizacion: cotizacion,
                      metodosPago: metodosPago,
                      pagos: motorPagos,
                      onPagosChange: setMotorPagos,
                      tipoDoc: motorTipoDoc,
                      onTipoDoc: setMotorTipoDoc,
                      serieDoc: motorSerieDoc,
                      onSerieDoc: setMotorSerieDoc,
                      numDoc: '',
                      notas: opObs,
                      onNotas: setOpObs,
                      onConfirmar: handleOperacionManual,
                      procesando: procesandoOp,
                      disabledExtra: !opSeleccionada || !opImporte
                    })}
                  />
                )}
              </div>
            </div>
          )}

          {activeTab === 'EGRESOS' && (
            <div className="flex-1 flex overflow-hidden bg-zinc-50">
              <div className="flex-1 bg-white p-10 flex flex-col gap-8 overflow-y-auto border-t-8 border-t-brand-magenta animate-in fade-in duration-300">
                  <div className="flex items-center justify-between border-b border-zinc-200 pb-8">
                    <div>
                      <h2 className="text-2xl font-black text-zinc-800 flex items-center gap-3 tracking-tight"><ArrowUpCircle className="text-brand-magenta" size={28} /> Salida de Dinero</h2>
                      <p className="text-zinc-400 font-black mt-2 uppercase tracking-widest text-[10px]">Registro de egresos y gastos de caja chica</p>
                    </div>
                    <div className="bg-brand-magenta/10 p-3 rounded-2xl border border-brand-magenta/20 shadow-sm">
                      <DollarSign size={20} className="text-brand-magenta" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="col-span-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Concepto de Gasto (Plan de Cuentas)</label>
                      <LightSelect
                        value={egresoCuentaCodigo}
                        onChange={setEgresoCuentaCodigo}
                        options={cuentasGastos.map(c => ({ value: c.CueCodigo, label: `[${c.CueCodigo}] ${c.CueNombre}` }))}
                        placeholder="Seleccione cuenta contable..."
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Proveedor / Beneficiario / Destinatario</label>
                      <div className="relative group">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-300 group-focus-within:text-brand-magenta transition-colors" size={18} />
                        <input type="text" value={egresoProveedor} onChange={e => setEgresoProveedor(e.target.value)} placeholder="¿A quién se le entrega el dinero?" className="w-full bg-zinc-50 border-2 border-zinc-200 rounded-[1rem] pl-12 pr-4 py-3 text-sm text-zinc-800 font-bold focus:border-brand-magenta focus:bg-white outline-none transition-all shadow-inner placeholder-zinc-400" />
                      </div>
                    </div>

                    <div className="col-span-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Monto de Salida</label>
                      <div className="flex group shadow-sm rounded-[1rem] overflow-hidden border-2 border-zinc-200 focus-within:border-brand-magenta transition-all bg-zinc-50 focus-within:bg-white">
                        <select value={egresoMoneda} onChange={e => setEgresoMoneda(e.target.value)} className="bg-white border-r border-zinc-200 px-4 font-black text-zinc-700 outline-none text-base cursor-pointer hover:bg-zinc-100 transition-colors appearance-none">
                          <option value="UYU">$</option><option value="USD">U$</option>
                        </select>
                        <input type="number" value={egresoMonto} onChange={e => setEgresoMonto(e.target.value)} placeholder="0.00" className="w-full bg-transparent px-4 py-3 text-2xl font-black text-brand-magenta outline-none text-right placeholder-brand-magenta/30" />
                      </div>
                    </div>

                    <div className="col-span-1">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Método de Retiro</label>
                      <Listbox value={egresoMetodoId} onChange={setEgresoMetodoId}>
                        {({ open }) => (
                          <div className="relative group">
                            <CreditCard className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors z-10 ${open ? 'text-brand-magenta' : 'text-zinc-300 group-hover:text-zinc-400'}`} size={18} />
                            <Listbox.Button className={`w-full text-left bg-zinc-50 border-2 rounded-[1rem] pl-12 pr-10 py-3 text-sm font-bold outline-none transition-all shadow-inner cursor-pointer ${open ? 'border-brand-magenta bg-white text-zinc-800' : 'border-zinc-200 text-zinc-700 hover:border-zinc-300'}`}>
                              <span className="block truncate">
                                {egresoMetodoId 
                                  ? metodosPago.find(m => String(m.MPaIdMetodoPago) === String(egresoMetodoId))?.MPaDescripcionMetodo || "Seleccione forma..." 
                                  : "Seleccione forma..."}
                              </span>
                              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                                <ChevronDown size={18} className={`transition-transform duration-200 ${open ? 'rotate-180 text-brand-magenta' : 'text-zinc-300'}`} />
                              </span>
                            </Listbox.Button>
                            
                            <Listbox.Options className="absolute z-50 mt-2 max-h-60 w-full overflow-auto rounded-[1rem] bg-white py-2 shadow-2xl border border-zinc-200 focus:outline-none">
                              <Listbox.Option value="" className={({ active }) => `relative cursor-pointer select-none py-3 pl-12 pr-4 text-sm font-bold transition-colors ${active ? 'bg-brand-magenta/5 text-brand-magenta' : 'text-zinc-500'}`}>
                                <span className="block truncate">Seleccione forma...</span>
                              </Listbox.Option>
                              {metodosPago.filter(m => m.MPaAfectaCaja).map((m) => (
                                <Listbox.Option
                                  key={m.MPaIdMetodoPago}
                                  value={String(m.MPaIdMetodoPago)}
                                  className={({ active }) =>
                                    `relative cursor-pointer select-none py-3 pl-12 pr-4 text-sm font-bold transition-colors ${
                                      active ? 'bg-brand-magenta/5 text-brand-magenta' : 'text-zinc-700'
                                    }`
                                  }
                                >
                                  {({ selected }) => (
                                    <>
                                      <span className={`block truncate ${selected ? 'text-brand-magenta' : ''}`}>{m.MPaDescripcionMetodo}</span>
                                      {selected ? (
                                        <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-brand-magenta">
                                          <Check size={18} />
                                        </span>
                                      ) : null}
                                    </>
                                  )}
                                </Listbox.Option>
                              ))}
                            </Listbox.Options>
                          </div>
                        )}
                      </Listbox>
                    </div>

                    <div className="col-span-2">
                      <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Referencia / Observaciones de Salida</label>
                      <textarea value={egresoObs} onChange={e => setEgresoObs(e.target.value)} placeholder="Explique brevemente el destino del dinero..." className="w-full bg-zinc-50 border-2 border-zinc-200 hover:border-zinc-300 focus:border-brand-magenta focus:bg-white rounded-[1.2rem] px-5 py-4 text-sm text-zinc-700 font-bold outline-none h-24 resize-none transition-all shadow-inner placeholder-zinc-400" />
                    </div>
                  </div>
              </div>

              <CajaPanelPago
                mode="EGRESO"
                tiposDocDisponibles={tiposDocumentos}
                totalACubrir={parseFloat(egresoMonto) || 0}
                moneda={egresoMoneda}
                cotizacion={cotizacion}
                metodosPago={metodosPago.filter(m => m.MPaAfectaCaja)}
                pagos={[{ id: 1, metodoPagoId: egresoMetodoId, moneda: egresoMoneda, monedaId: egresoMoneda === 'USD' ? 2 : 1, monto: egresoMonto }]}
                onPagosChange={(newPagos) => {
                  if (newPagos[0]) {
                    setEgresoMetodoId(newPagos[0].metodoPagoId);
                    setEgresoMonto(newPagos[0].monto);
                  }
                }}
                tipoDoc={egresoTipoDoc}
                onTipoDoc={setEgresoTipoDoc}
                serieDoc={egresoSerieDoc}
                onSerieDoc={setEgresoSerieDoc}
                numDoc={egresoTipoDoc === 'NINGUNO' ? 'Sin número' : (egresoNumDocPredict || 'Generando...')}
                notas={egresoObs}
                onNotas={setEgresoObs}
                onConfirmar={handleRealizarEgreso}
                procesando={procesandoEgreso}
                disabledExtra={!egresoCuentaCodigo || !egresoMonto || !egresoMetodoId}
              />
            </div>
          )}

          {activeTab === 'OPERACIONES' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3 shrink-0 shadow-sm z-10 overflow-x-auto">
                {!isAdminCaja && (
                  <button onClick={() => setShowArqueo(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs transition-all border whitespace-nowrap bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800 hover:bg-slate-50">
                    <FileText size={16} /> Arqueo de Turno
                  </button>
                )}
                <button className="flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs transition-all border whitespace-nowrap bg-brand-cyan border-brand-cyan text-white shadow-md shadow-brand-cyan/20">
                  <DoorClosed size={16} /> {isAdminCaja ? 'Movimientos Realizados' : 'Cierre de Turno'}
                </button>
              </div>

              <div className="flex-1 bg-white flex flex-col overflow-y-auto border-t-8 border-t-brand-cyan animate-in fade-in duration-300">
                  <div className="relative w-full flex flex-col">

                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
                      <div>
                        <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3 tracking-tighter"><DoorClosed className="text-brand-cyan" size={32} /> {isAdminCaja ? 'Movimientos Administrativos' : 'Cierre de Caja'}</h2>
                        <p className="text-slate-400 font-bold mt-1 uppercase tracking-[0.2em] text-[10px]">{isAdminCaja ? 'Operaciones por rango de fecha' : 'Arqueo y finalización de jornada'}</p>
                      </div>
                      {!isAdminCaja && (
                        <div className="text-right">
                          <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-3 py-1.5 rounded-lg uppercase tracking-widest border border-slate-200 shadow-sm">Turno Actual</span>
                        </div>
                      )}
                    </div>

                    {isAdminCaja ? (
                      <div className="flex flex-col">
                        <div className="flex items-end gap-4 bg-slate-50 p-8 border-b border-slate-200">
                          <div className="flex-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">Fecha Desde</label>
                            <input type="date" value={fechaDesdeAdmin} onChange={e => setFechaDesdeAdmin(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-cyan" />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">Fecha Hasta</label>
                            <input type="date" value={fechaHastaAdmin} onChange={e => setFechaHastaAdmin(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-cyan" />
                          </div>
                        </div>

                        <div className="bg-white overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha</th>
                                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo / Ref</th>
                                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Concepto</th>
                                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Ingreso</th>
                                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Egreso</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {cargandoMovsAdmin ? (
                                  <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400 font-bold text-sm">Cargando...</td></tr>
                                ) : movimientosAdmin.length === 0 ? (
                                  <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400 font-bold text-sm">No hay movimientos en este rango.</td></tr>
                                ) : movimientosAdmin.map((m, i) => (
                                  <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="px-6 py-4 text-xs text-slate-500 font-medium whitespace-nowrap">{new Date(m.Fecha).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })}</td>
                                    <td className="px-6 py-4">
                                      <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">{m.TipoOperacion}</span>
                                      <span className="font-bold text-slate-700 text-xs">{m.Comprobante !== '-' ? m.Comprobante : m.TipoComprobante}</span>
                                    </td>
                                    <td className="px-6 py-4 text-xs text-slate-600 font-medium max-w-[300px] truncate" title={m.Concepto}>{m.Concepto}</td>
                                    <td className="px-6 py-4 text-right font-black text-emerald-600 text-sm">{m.Entrada > 0 ? `$${fmt(m.Entrada)}` : '-'}</td>
                                    <td className="px-6 py-4 text-right font-black text-brand-magenta text-sm">{m.Salida > 0 ? `$${fmt(m.Salida)}` : '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ) : !resumenCierre ? (
                      <div className="text-center py-20 flex flex-col items-center gap-4">
                        <Loader2 className="animate-spin text-brand-cyan" size={48} />
                        <p className="font-black text-zinc-400 uppercase tracking-widest text-sm animate-pulse">Consolidando transacciones...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        <div className="bg-slate-50/50 px-6 py-3 grid grid-cols-2 lg:grid-cols-4 gap-4 border-b border-slate-200">
                          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Monto Inicial Apertura</p>
                            <p className="text-xl font-black text-slate-800 tracking-tight">${fmt(resumenCierre.sesion?.StuMontoInicial || 0)}</p>
                          </div>
                          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <p className="text-[9px] text-emerald-600/60 font-black uppercase tracking-widest mb-1">Total Cobrado (+)</p>
                            <p className="text-xl font-black text-emerald-600 tracking-tight">${fmt(resumenCierre.cobros?.TotalCobrado || 0)}</p>
                          </div>
                          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <p className="text-[9px] text-brand-magenta/60 font-black uppercase tracking-widest mb-1">Gastos / Egresos (-)</p>
                            <p className="text-xl font-black text-brand-magenta tracking-tight">${fmt(resumenCierre.egresos?.TotalEgresos || 0)}</p>
                          </div>
                          <div className="col-span-1 bg-brand-cyan p-4 rounded-xl shadow-md shadow-brand-cyan/20 flex flex-col justify-center">
                            <p className="text-[9px] text-white/80 font-black uppercase tracking-widest mb-1">Saldo Esperado en Sistema</p>
                            <p className="text-2xl font-black text-white tracking-tight">${fmt((resumenCierre.sesion?.StuMontoInicial || 0) + (resumenCierre.cobros?.TotalCobrado || 0) - (resumenCierre.egresos?.TotalEgresos || 0))}</p>
                          </div>
                        </div>

                        <>
                          <div className="bg-white p-6 flex flex-col gap-6 relative border-b border-slate-200">
                            <h3 className="font-black text-slate-800 flex items-center gap-4 text-xl tracking-tight"><DollarSign size={24} className="text-brand-cyan" /> Arqueo Físico de Valores</h3>

                            <div className="flex flex-col gap-4">
                              <div className="flex justify-between items-end px-1">
                                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Desglose de Efectivo Físico en Cajón</label>
                                <span className="text-2xl font-black text-brand-cyan tracking-tighter bg-brand-cyan/10 px-4 py-1 rounded-xl border border-brand-cyan/20">Total Físico: $ {fmt(totalDenominaciones)}</span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50/50 p-4 rounded-xl border border-slate-200 shadow-inner">
                                <div className="col-span-2 md:col-span-4"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-200 pb-2">Billetes</p></div>
                                {[2000, 1000, 500, 200, 100, 50, 20].map(den => (
                                  <div key={den} className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 shadow-sm focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/20 transition-all">
                                    <div className="w-16 text-right"><span className="text-sm font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">${den}</span></div>
                                    <span className="text-slate-300 font-bold">x</span>
                                    <input type="number" min="0" value={denominaciones[den]} onChange={e => setDenominaciones(p => ({ ...p, [den]: e.target.value }))} placeholder="0" className="w-full bg-transparent text-lg font-black text-slate-800 outline-none text-center" />
                                  </div>
                                ))}
                                <div className="col-span-2 md:col-span-4 mt-2"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-200 pb-2">Monedas</p></div>
                                {[50, 10, 5, 2, 1].map(den => (
                                  <div key={den} className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 shadow-sm focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all">
                                    <div className="w-16 text-right"><span className="text-sm font-black text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-100">${den}</span></div>
                                    <span className="text-slate-300 font-bold">x</span>
                                    <input type="number" min="0" value={denominaciones[den]} onChange={e => setDenominaciones(p => ({ ...p, [den]: e.target.value }))} placeholder="0" className="w-full bg-transparent text-lg font-black text-slate-800 outline-none text-center" />
                                  </div>
                                ))}
                              </div>
                            </div>

                            {cierreMontoFisico !== '' && (() => {
                              const sis = resumenCierre.sesion.StuMontoInicial + resumenCierre.cobros.TotalCobrado - resumenCierre.egresos.TotalEgresos;
                              const real = parseFloat(cierreMontoFisico) || 0;
                              const diff = real - sis;
                              return (
                                <div className={`p-4 rounded-xl font-black flex justify-between items-center animate-in zoom-in-95 duration-300 border ${Math.abs(diff) < 2 ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-emerald-50' : diff > 0 ? 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan shadow-brand-cyan/10' : 'bg-brand-magenta/5 border-brand-magenta/20 text-brand-magenta shadow-brand-magenta/5'}`}>
                                  <div className="flex items-center gap-4">
                                    {Math.abs(diff) < 2 ? <CheckCircle size={32} /> : diff > 0 ? <TrendingUp size={32} /> : <TrendingDown size={32} />}
                                    <span className="text-xl tracking-tight uppercase">{Math.abs(diff) < 2 ? 'BALANCE MANTENIDO CON ÉXITO' : diff > 0 ? 'SOBRANTE DE CAJA DETECTADO' : 'FALTANTE DE CAJA DETECTADO'}</span>
                                  </div>
                                  <span className="text-4xl tracking-tighter font-black">{diff > 0 ? '+' : ''}{fmt(diff)}</span>
                                </div>
                              )
                            })()}

                            <div className="flex flex-col gap-2">
                              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Observaciones Finales / Justificación</label>
                              <textarea value={cierreObs} onChange={e => setCierreObs(e.target.value)} placeholder="Justifique diferencias de arqueo o anote comentarios sobre la jornada..." className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-6 text-slate-800 font-bold outline-none h-32 resize-none focus:border-brand-cyan focus:bg-white transition-all shadow-inner" />
                            </div>
                          </div>

                          <div className="p-8 bg-zinc-50/50">
                            <button onClick={handleCerrarCaja} className="w-full bg-brand-magenta hover:opacity-90 text-white font-black py-6 rounded-2xl shadow-xl shadow-brand-magenta/20 transition-all active:scale-[0.98] text-xl tracking-tighter flex items-center justify-center gap-4">
                              <Power size={28} /> FINALIZAR TURNO Y CERRAR SESIÓN
                            </button>
                          </div>
                        </>

                      </div>
                    )}
                  </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showArqueo && <CajaArqueoModal onClose={() => setShowArqueo(false)} />}

      {busquedaGlobalRes && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-900/60  p-8 animate-in fade-in duration-300" onClick={(e) => e.target === e.currentTarget && setBusquedaGlobalRes(null)}>
          <div className="bg-white border border-zinc-200 rounded-[3rem] w-full max-w-5xl max-h-[85vh] flex flex-col shadow-[0_40px_100px_rgba(0,0,0,0.3)] overflow-hidden animate-in zoom-in-95 duration-500">
            <div className="px-10 py-8 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
              <div>
                <h2 className="text-2xl font-black text-zinc-800 flex items-center gap-4 tracking-tight"><Search size={32} className="text-brand-cyan" /> Resultados de Búsqueda Global</h2>
                <p className="text-zinc-400 font-bold text-[10px] uppercase tracking-widest mt-1">Se han encontrado {busquedaGlobalRes.length} coincidencias</p>
              </div>
              <button onClick={() => setBusquedaGlobalRes(null)} className="text-zinc-400 hover:text-rose-600 bg-white hover:bg-rose-50 p-4 rounded-2xl transition-all border border-zinc-200 hover:border-rose-200 shadow-sm"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-auto p-10 flex flex-col gap-6">
              {busquedaGlobalRes.map((r, i) => (
                <div key={i} className="border border-zinc-200 rounded-[2rem] p-8 bg-white flex flex-col gap-4 shadow-sm hover:shadow-xl hover:border-brand-cyan/30 transition-all group">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 bg-zinc-100 rounded-3xl flex items-center justify-center font-black text-zinc-400 group-hover:bg-brand-cyan-white transition-all shadow-inner">
                        {r.CliNombre?.[0] || 'R'}
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-zinc-800 tracking-tight group-hover:text-brand-cyan transition-colors">Retiro: <span className="underline decoration-brand-cyan/30 decoration-4">{r.ordenDeRetiro || `R-${r.OReIdOrdenRetiro}`}</span></h3>
                        <p className="text-sm font-bold text-zinc-400 mt-1 uppercase tracking-widest flex items-center gap-2">
                          {r.CliNombre}
                          <span className="bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-lg text-[10px] border border-zinc-200 font-black">{r.CliCodigo || 'S/C'}</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-black text-zinc-900 tracking-tighter">${fmt(r.OReCostoTotalOrden || r.Costo || 0)}</p>
                      <span className={`text-[10px] font-black px-4 py-1.5 rounded-full mt-2 inline-block border-2 uppercase tracking-widest shadow-sm ${r.Pagada || r.Pago ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-rose-50 border-rose-200 text-rose-600'}`}>
                        {r.Pagada || r.Pago ? '✓ FINALIZADO' : '⚠ PENDIENTE'}
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-zinc-50 pt-6 mt-2 grid grid-cols-3 gap-8">
                    <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100 shadow-inner"><span className="text-[10px] text-zinc-400 font-black uppercase tracking-widest block mb-1">Estado de Entrega</span><p className="text-zinc-700 font-bold text-sm">{r.estadoRetiro || r.estado || 'Procesando...'}</p></div>
                    <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100 shadow-inner"><span className="text-[10px] text-zinc-400 font-black uppercase tracking-widest block mb-1">Fecha de Registro</span><p className="text-zinc-700 font-bold text-sm">{r.OReFechaAlta ? new Date(r.OReFechaAlta).toLocaleString('es-UY') : '-'}</p></div>
                    <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100 shadow-inner"><span className="text-[10px] text-zinc-400 font-black uppercase tracking-widest block mb-1">Lugar Establecido</span><p className="text-zinc-700 font-bold text-sm">{r.lugarRetiro || 'Planta Principal'}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}






