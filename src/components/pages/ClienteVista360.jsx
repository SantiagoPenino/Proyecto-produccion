/**
 * ClienteVista360.jsx  —  Ruta: /contabilidad/cliente-360
 *
 * Vista unificada ("Panel 360") centrada en el cliente. CONVIVE con
 * /contabilidad/cuentas sin reemplazarla.
 *
 * FASE 1 (esta entrega): solo lectura. Cabecera del cliente + KPIs + estado de
 * cuenta + movimientos + planes de recursos. NO reimplementa nada: reutiliza los
 * mismos componentes y endpoints de ContabilidadCuentasView.
 *   - MovimientosPanel / PlanesPanel / FilaCliente   (importados)
 *   - ClienteBilletera                                (importado)
 *   - fetchAPI / fmt / fmtNum                         (importados)
 *   - generarPdfEstadoCuenta / exportarExcelEstadoCuenta (utils existentes)
 *
 * FASE 2+ (siguiente): los botones de dinero (Cobrar, Anticipo, Venta, Facturar)
 * montarán CajaPagoDeudaTab / CajaSaldoAnticipoTab / CajaVentaDirectaTab /
 * FacturacionManualModal. Por ahora avisan "próxima fase" para mantener la
 * Fase 1 en modo solo-lectura.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Search, RefreshCw, Users, CreditCard, DollarSign, FileText, Wallet,
  ShoppingCart, FilePlus, MoreHorizontal, Download, Printer,
  ArrowLeft, Zap, CheckCircle2, Calendar, TrendingDown, PlusCircle, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router-dom';

import api from '../../services/api';
import { generarPdfEstadoCuenta } from '../../utils/pdfGenerator';
import { exportarExcelEstadoCuenta } from '../../utils/excelGenerator';
import ClienteBilletera from '../common/ClienteBilletera';
// Reuso directo de las piezas ya construidas y probadas de la vista de cuentas.
import {
  fetchAPI, fmt, FilaCliente, MovimientosPanel, PlanesPanel,
} from './ContabilidadCuentasView';
// Fase 2: cobro y saldos — se montan tal cual (mismos componentes que Caja).
import CajaPagoDeudaTab from './CajaPagoDeudaTab';
import CajaSaldoAnticipoTab from './CajaSaldoAnticipoTab';
// Fase 3: venta directa (facturar órdenes reusa el flujo de /contabilidad/prefactura)
import CajaVentaDirectaTab from './CajaVentaDirectaTab';

const TIPOS_MONETARIOS = ['USD', 'UYU', 'ARS', 'EUR', 'PYG', 'BRL', 'CORRIENTE', 'CREDITO', 'DEBITO', 'CAJA', 'DINERO_USD', 'DINERO_UYU'];
const esRecurso = (c) => c.ProIdProducto != null || !TIPOS_MONETARIOS.includes(c.CueTipo?.toUpperCase());

/* ── KPI card ─────────────────────────────────────────────────────────── */
const Kpi = ({ label, value, sub, tone = 'slate', icon: Icon, children }) => {
  const tones = {
    slate:   'border-l-slate-300',
    cyan:    'border-l-cyan-600',
    rose:    'border-l-rose-500',
    emerald: 'border-l-emerald-500',
    amber:   'border-l-amber-500',
  };
  const valueTone = {
    slate: 'text-slate-800', cyan: 'text-slate-800', rose: 'text-rose-600',
    emerald: 'text-emerald-600', amber: 'text-amber-600',
  };
  return (
    <div className={`bg-slate-50 border border-slate-200 border-l-[3px] ${tones[tone]} rounded-xl px-4 py-3 flex flex-col gap-1`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className={`text-2xl font-black tracking-tight ${valueTone[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      {children}
    </div>
  );
};

export default function ClienteVista360() {
  const location = useLocation();
  const navigate = useNavigate();

  const [busqueda, setBusqueda]                   = useState('');
  const [filtroTipoCliente, setFiltroTipoCliente] = useState('');
  const [clientesActivos, setClientesActivos]     = useState([]);
  const [clienteSel, setClienteSel]               = useState(null);
  const [cuentas, setCuentas]                     = useState([]);
  const [ordenesAnticipo, setOrdenesAnticipo]     = useState([]);
  const [loadingLista, setLoadingLista]           = useState(false);
  const [loadingCuentas, setLoadingCuentas]       = useState(false);
  const [tabCuentas, setTabCuentas]               = useState('UYU');
  const [refreshBilletera, setRefreshBilletera]   = useState(0);
  const [hasAutoSelected, setHasAutoSelected]     = useState(false);
  const [generandoPdf, setGenerandoPdf]           = useState(false);
  const [exportandoExcel, setExportandoExcel]     = useState(false);

  const [globalDesde, setGlobalDesde] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]; });
  const [globalHasta, setGlobalHasta] = useState(() => new Date().toISOString().split('T')[0]);
  const [globalFiltroTrigger, setGlobalFiltroTrigger] = useState(0);

  // Fase 2 — operación de dinero (Caja Administrativa, sin sesión de mostrador)
  const [opModal, setOpModal]         = useState(null); // 'COBRO' | 'ANTICIPO'
  const [metodosPago, setMetodosPago] = useState([]);
  const [cotizacion, setCotizacion]   = useState(null);

  // Datos base para el cobro (mismos endpoints que CajaTransaccionView)
  useEffect(() => {
    (async () => {
      try {
        const [rMet, rCot] = await Promise.allSettled([
          api.get('/apipagos/metodos'),
          api.get('/apicotizaciones/hoy'),
        ]);
        if (rMet.status === 'fulfilled') setMetodosPago(Array.isArray(rMet.value.data) ? rMet.value.data : []);
        if (rCot.status === 'fulfilled' && rCot.value.data?.cotizaciones?.[0]) setCotizacion(rCot.value.data.cotizaciones[0].CotDolar);
      } catch { /* no bloquea la vista de lectura */ }
    })();
  }, []);

  const onOperacionOk = () => recargarCuentas();
  const cerrarOp = () => { setOpModal(null); recargarCuentas(); };

  // Facturar órdenes pendientes → reusa la página de pre-factura (mismo flujo que la vista de cuentas)
  const handleFacturarOrdenes = () => {
    if (!ordenesFiltradas.length) {
      toast('No hay órdenes pendientes de facturar en la cuenta activa.', { description: 'Probá cambiar de moneda (UYU/USD).' });
      return;
    }
    navigate('/contabilidad/prefactura', {
      state: {
        ciclo: { CicIdCiclo: (cuentaActiva && Number(cuentaActiva.CueSaldoActual || 0) > 0) ? 'ANTICIPO' : 'CREDITO', CicFechaInicio: new Date().toISOString(), CicFechaCierre: new Date().toISOString() },
        cliente: clienteSel,
        cuenta: cuentaActiva || cuentas[0],
        movsOriginales: ordenesFiltradas.map(m => ({ ...m, MovImporte: m.MovImporte < 0 ? m.MovImporte : -Math.abs(m.MovImporte) })),
        returnTo: '/contabilidad/cliente-360',
      },
    });
  };

  /* ── Datos: mismos endpoints que la vista de cuentas ────────────────── */
  const cargarClientesActivos = useCallback(async (q = '', tipo = '') => {
    setLoadingLista(true);
    try {
      const qp = new URLSearchParams();
      if (q.trim()) qp.append('q', q.trim());
      if (tipo) qp.append('tipoCliente', tipo);
      qp.append('todos', 'true');
      const data = await fetchAPI(`/api/contabilidad/clientes-activos?${qp.toString()}`);
      setClientesActivos(data.data || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingLista(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => cargarClientesActivos(busqueda, filtroTipoCliente), 400);
    return () => clearTimeout(timer);
  }, [busqueda, filtroTipoCliente, cargarClientesActivos]);

  const seleccionarCliente = async (cli) => {
    if (clienteSel?.CliIdCliente === cli.CliIdCliente) return;
    setClienteSel(cli);
    setLoadingCuentas(true);
    setOrdenesAnticipo([]);
    try {
      const [data, anticiposRes] = await Promise.all([
        fetchAPI(`/api/contabilidad/cuentas/${cli.CliIdCliente}`),
        fetchAPI(`/api/contabilidad/clientes/${cli.CliIdCliente}/ordenes-anticipo`).catch(() => ({ data: [] })),
      ]);
      setCuentas(data.data || []);
      setOrdenesAnticipo(anticiposRes.data || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingCuentas(false); }
  };

  const recargarCuentas = async () => {
    if (!clienteSel) return;
    setLoadingCuentas(true);
    try {
      const [data, anticiposRes] = await Promise.all([
        fetchAPI(`/api/contabilidad/cuentas/${clienteSel.CliIdCliente}`),
        fetchAPI(`/api/contabilidad/clientes/${clienteSel.CliIdCliente}/ordenes-anticipo`).catch(() => ({ data: [] })),
      ]);
      setCuentas(data.data || []);
      setOrdenesAnticipo(anticiposRes.data || []);
      setRefreshBilletera(p => p + 1);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingCuentas(false); }
  };

  // Preselección al llegar desde /contabilidad/cuentas (botón "Panel 360").
  useEffect(() => {
    if (location.state?.selectedClienteId && clientesActivos.length > 0 && !hasAutoSelected) {
      const targetId = Number(location.state.selectedClienteId);
      const found = clientesActivos.find(c => c.CliIdCliente === targetId);
      if (found) { setHasAutoSelected(true); seleccionarCliente(found); }
    }
  }, [location.state, clientesActivos, hasAutoSelected]);

  /* ── KPIs (mismo cálculo que la vista de cuentas) ───────────────────── */
  const saldoTotal        = cuentas.reduce((s, c) => s + Number(c.CueSaldoActual ?? 0), 0);
  const deudaTotal        = cuentas.reduce((s, c) => s + Number(c.DeudaPendienteTotal ?? 0), 0);
  const docsVencidos      = cuentas.reduce((s, c) => s + Number(c.DocumentosVencidos ?? 0), 0);
  const pendienteFacturar = cuentas.reduce((s, c) => s + Number(c.PendienteFacturar ?? 0), 0);

  const cuentaActiva = useMemo(() => {
    if (!cuentas.length || tabCuentas === 'RECURSOS') return null;
    return cuentas.find(c => {
      if (esRecurso(c)) return false;
      if (tabCuentas === 'USD') return c.MonSimbolo === 'US$' || c.CueTipo === 'DINERO_USD';
      return c.MonSimbolo !== 'US$' && c.CueTipo !== 'DINERO_USD';
    });
  }, [cuentas, tabCuentas]);

  const ordenesFiltradas = useMemo(() => {
    if (!cuentaActiva) return [];
    return ordenesAnticipo.filter(o => o.CueIdCuenta === cuentaActiva.CueIdCuenta);
  }, [ordenesAnticipo, cuentaActiva]);

  const recursoCuentas = useMemo(() => cuentas.filter(esRecurso), [cuentas]);

  /* ── PDF / Excel: reutilizan los utils existentes ───────────────────── */
  const construirSecciones = async () => {
    const p = new URLSearchParams({ top: 300 });
    if (globalDesde) p.append('desde', globalDesde);
    if (globalHasta) p.append('hasta', globalHasta);
    const [planesRes, ...movsRes] = await Promise.all([
      fetchAPI(`/api/contabilidad/planes/${clienteSel.CliIdCliente}`).catch(() => ({ data: [] })),
      ...cuentas.map(c =>
        fetchAPI(`/api/contabilidad/cuentas/${c.CueIdCuenta}/movimientos?${p}`)
          .then(d => ({ cue: c, movs: d.data || [], saldoArrastre: d.saldoArrastre ?? 0 }))
          .catch(() => ({ cue: c, movs: [], saldoArrastre: 0 }))),
    ]);
    const secciones = {};
    movsRes.forEach(({ cue, movs, saldoArrastre }) => { secciones[cue.CueIdCuenta] = { cue, movs, saldoArrastre }; });
    return { planes: planesRes.data || [], secciones };
  };

  const handleImprimirEstadoCuenta = async () => {
    if (!clienteSel || cuentas.length === 0) return;
    setGenerandoPdf(true);
    const toastId = toast.loading('Generando PDF del Estado de Cuenta...');
    try {
      const { planes, secciones } = await construirSecciones();
      await generarPdfEstadoCuenta(clienteSel, cuentas, secciones, planes, globalDesde, globalHasta);
      toast.success('PDF descargado con éxito.', { id: toastId });
    } catch (e) { toast.error('Error al generar el PDF: ' + e.message, { id: toastId }); }
    finally { setGenerandoPdf(false); }
  };

  const handleExportarExcel = async () => {
    if (!clienteSel || cuentas.length === 0) return;
    setExportandoExcel(true);
    const toastId = toast.loading('Generando Excel del Estado de Cuenta...');
    try {
      const { planes, secciones } = await construirSecciones();
      await exportarExcelEstadoCuenta(clienteSel, cuentas, secciones, planes, globalDesde, globalHasta);
      toast.success('Excel descargado con éxito.', { id: toastId });
    } catch (e) { toast.error('Error al generar Excel: ' + e.message, { id: toastId }); }
    finally { setExportandoExcel(false); }
  };

  // Acciones de escritura: se integran en fases siguientes (esta vista es solo lectura).
  const proximaFase = (n, nombre) => toast(`"${nombre}" se integra en la Fase ${n}.`, {
    description: 'El Panel 360 (Fase 1) es solo lectura del estado de cuenta.',
    icon: '🔧',
  });

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="bg-[#f1f5f9] min-h-full text-slate-700 font-sans">
      {/* Barra superior de la vista */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/contabilidad/cuentas')} title="Volver a Cuentas"
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div className="w-9 h-9 rounded-xl bg-cyan-700 flex items-center justify-center text-white shrink-0">
          <Zap size={16} />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-black text-slate-800 leading-tight">Panel 360° del cliente</h1>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Todas las operaciones desde el cliente</p>
        </div>
        <span className="ml-2 text-[10px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-100 px-2.5 py-1 rounded-full font-mono">
          nueva · /contabilidad/cliente-360
        </span>
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Operaciones activas
        </span>
      </div>

      <div className="px-3 sm:px-4 py-3">
        <div className="flex flex-col lg:flex-row gap-4 w-full items-start">

          {/* ── Columna izquierda: lista de clientes (FilaCliente reutilizado) ── */}
          <div className="w-full md:w-80 shrink-0 flex flex-col bg-[#f1f5f9] rounded-xl border border-slate-200 shadow-sm">
            <div className="px-4 py-4 border-b border-slate-200 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Users size={16} className="text-cyan-500" />Clientes
                </h2>
                <button onClick={() => cargarClientesActivos(busqueda, filtroTipoCliente)} title="Actualizar"
                  className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors text-slate-500">
                  <RefreshCw size={13} className={loadingLista ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1 flex items-center">
                  <div className="absolute left-3 text-slate-400"><Search size={14} /></div>
                  <input type="text" placeholder="Buscar por nombre, RUC o código..." value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-cyan-500 focus:bg-white rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-slate-800 placeholder-slate-400 outline-none transition-all" />
                </div>
                <select value={filtroTipoCliente} onChange={e => setFiltroTipoCliente(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-slate-700 outline-none w-[92px]">
                  <option value="">Todos</option>
                  <option value="1">Común</option>
                  <option value="2">Semanal</option>
                  <option value="3">Rollo</option>
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[70vh]">
              {loadingLista ? (
                <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-cyan-500 border-t-transparent rounded-full" /></div>
              ) : clientesActivos.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Zap size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Sin clientes con saldo activo</p>
                </div>
              ) : (
                clientesActivos.map(c => (
                  <FilaCliente key={c.CliIdCliente} c={c}
                    seleccionado={clienteSel?.CliIdCliente === c.CliIdCliente}
                    onClick={() => seleccionarCliente(c)} />
                ))
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-slate-200 text-[11px] text-slate-500 text-center">
              {clientesActivos.length} clientes
            </div>
          </div>

          {/* ── Columna derecha: detalle 360 ──────────────────────────────── */}
          <div className="flex-1 space-y-4 min-w-0">
            {!clienteSel ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-500 bg-white rounded-2xl border border-slate-200 border-dashed">
                <CreditCard size={48} className="mb-4 opacity-20" />
                <p className="text-base font-medium">Seleccioná un cliente</p>
                <p className="text-sm mt-1">para ver todo su estado de cuenta en un solo lugar</p>
              </div>
            ) : (
              <>
                {/* Cabecera del cliente + KPIs */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-5 flex flex-col xl:flex-row gap-5">
                    {/* Identidad */}
                    <div className="flex items-start gap-3 w-full xl:w-80 shrink-0">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-600 to-cyan-800 flex items-center justify-center text-white font-black text-lg shrink-0">
                        {(clienteSel.Nombre || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-black text-slate-800 leading-tight truncate max-w-[190px]" title={clienteSel.Nombre}>{clienteSel.Nombre}</h2>
                          <span className="text-emerald-600 flex items-center gap-0.5 text-[8px] font-black bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">
                            <CheckCircle2 size={9} /> OK
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono mt-0.5">
                          ID: {clienteSel.IDCliente || clienteSel.CodCliente || clienteSel.CliIdCliente}
                        </p>
                        <div className="flex flex-col gap-0.5 text-[11px] text-slate-500 font-medium mt-2">
                          {clienteSel.CioRuc && <div>RUC/CI: <span className="font-mono font-bold text-slate-700">{clienteSel.CioRuc}</span></div>}
                          {clienteSel.Email && <div className="truncate" title={clienteSel.Email}>{clienteSel.Email}</div>}
                          {clienteSel.TelefonoTrabajo && <div>{clienteSel.TelefonoTrabajo}</div>}
                        </div>
                      </div>
                    </div>

                    {/* KPIs */}
                    <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <Kpi label="Saldo de cuenta" tone={saldoTotal < 0 ? 'rose' : 'cyan'} icon={Wallet}
                        value={fmt(saldoTotal)} sub={saldoTotal < 0 ? 'Saldo deudor' : saldoTotal > 0 ? 'Saldo a favor' : 'Sin saldo'} />
                      <Kpi label="Deuda viva" tone={deudaTotal > 0 ? 'rose' : 'slate'} icon={TrendingDown}
                        value={fmt(deudaTotal)} sub={`${docsVencidos} doc. vencido${docsVencidos === 1 ? '' : 's'}`} />
                      <Kpi label="Pend. facturar" tone={pendienteFacturar > 0 ? 'amber' : 'slate'} icon={FileText}
                        value={fmt(pendienteFacturar)} sub={`${ordenesAnticipo.length} orden(es)`} />
                      <Kpi label="Cuentas" tone="slate" icon={CreditCard}
                        value={cuentas.length} sub={`${recursoCuentas.length} de recursos`} />
                    </div>
                  </div>

                  {/* Toolbar de acciones (dinero = próxima fase) */}
                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    <button onClick={() => setOpModal('COBRO')}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">
                      <DollarSign size={14} /> Cobrar / Registrar pago
                    </button>
                    <button onClick={() => setOpModal('ANTICIPO')}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <PlusCircle size={14} /> Anticipo
                    </button>
                    <button onClick={() => setOpModal('VENTA')}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <ShoppingCart size={14} /> Venta directa
                    </button>
                    <button onClick={handleFacturarOrdenes}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <FilePlus size={14} /> Facturar órdenes
                      {ordenesAnticipo.length > 0 && <span className="text-[9px] bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded-full font-black">{ordenesAnticipo.length}</span>}
                    </button>
                    <button onClick={() => proximaFase(3, 'Más operaciones')}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <MoreHorizontal size={14} /> Más
                    </button>

                    <div className="flex-1" />

                    {/* Utilidades (disponibles en Fase 1) */}
                    <button onClick={handleImprimirEstadoCuenta} disabled={cuentas.length === 0 || generandoPdf}
                      title="Estado de cuenta PDF"
                      className="flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:bg-white hover:text-slate-800 text-xs font-bold rounded-lg transition-colors disabled:opacity-40">
                      {generandoPdf ? <RefreshCw size={14} className="animate-spin" /> : <Printer size={14} />} PDF
                    </button>
                    <button onClick={handleExportarExcel} disabled={cuentas.length === 0 || exportandoExcel}
                      title="Exportar a Excel"
                      className="flex items-center gap-1.5 px-3 py-2 text-emerald-700 hover:bg-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40">
                      {exportandoExcel ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} Excel
                    </button>
                    <button onClick={recargarCuentas} disabled={loadingCuentas} title="Actualizar"
                      className="p-2 text-slate-500 hover:bg-white rounded-lg transition-colors disabled:opacity-40">
                      <RefreshCw size={14} className={loadingCuentas ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  {/* Billetera en tiempo real (reutilizada) */}
                  <div className="px-5 py-3 border-t border-slate-100">
                    <ClienteBilletera key={`${clienteSel.CliIdCliente}_${refreshBilletera}`} clienteId={clienteSel.CliIdCliente} clienteNombre={clienteSel.Nombre} />
                  </div>

                  {/* Filtro de período */}
                  <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                      <Calendar size={14} /> Período
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="date" value={globalDesde} onChange={e => setGlobalDesde(e.target.value)}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-cyan-500/30 font-medium text-slate-700 bg-white" />
                      <span className="text-slate-400 text-xs font-black">→</span>
                      <input type="date" value={globalHasta} onChange={e => setGlobalHasta(e.target.value)}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-cyan-500/30 font-medium text-slate-700 bg-white" />
                      <button onClick={() => setGlobalFiltroTrigger(t => t + 1)}
                        className="text-xs font-bold uppercase tracking-widest px-4 py-1.5 bg-cyan-700 text-white hover:bg-cyan-800 rounded-lg transition-colors">Aplicar</button>
                    </div>
                  </div>
                </div>

                {/* Tabs de moneda / recursos */}
                <div className="flex bg-slate-100 rounded-xl border border-slate-200 p-0.5 gap-0.5 w-max">
                  {['UYU', 'USD', 'RECURSOS'].map(t => (
                    <button key={t} type="button" onClick={() => setTabCuentas(t)}
                      className={`px-4 py-2 text-xs font-black rounded-lg transition-colors uppercase tracking-widest ${
                        tabCuentas === t ? (t === 'USD' ? 'bg-white text-emerald-600 shadow-sm' : t === 'RECURSOS' ? 'bg-white text-violet-600 shadow-sm' : 'bg-white text-cyan-700 shadow-sm') : 'text-slate-500 hover:text-slate-700'
                      }`}>
                      {t === 'RECURSOS' ? 'Recursos' : t}
                    </button>
                  ))}
                </div>

                {/* Estado de cuenta / movimientos — MovimientosPanel reutilizado */}
                {loadingCuentas ? (
                  <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-2 border-cyan-600 border-t-transparent rounded-full" /></div>
                ) : cuentas.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                    <CreditCard size={32} className="mx-auto mb-3 text-slate-400" />
                    <p className="text-sm text-slate-400">Sin cuentas contables registradas</p>
                  </div>
                ) : tabCuentas === 'RECURSOS' ? (
                  recursoCuentas.length === 0 ? (
                    <p className="text-center text-slate-400 text-sm py-8 bg-white rounded-xl border border-slate-200 border-dashed">Sin planes ni recursos para este cliente.</p>
                  ) : (
                    recursoCuentas.map(cuenta => (
                      <PlanesPanel key={cuenta.CueIdCuenta} cuenta={cuenta} CliIdCliente={clienteSel.CliIdCliente}
                        cliente={clienteSel} desde={globalDesde} hasta={globalHasta} onClose={() => {}} onChanged={recargarCuentas} />
                    ))
                  )
                ) : cuentaActiva ? (
                  <MovimientosPanel
                    CueIdCuenta={cuentaActiva.CueIdCuenta}
                    simbolo={cuentaActiva.MonSimbolo || '$'}
                    onClose={() => {}}
                    cuenta={cuentaActiva}
                    CliIdCliente={clienteSel.CliIdCliente}
                    cliente={clienteSel}
                    onRegistrarPago={() => setOpModal('COBRO')}
                    desde={globalDesde}
                    hasta={globalHasta}
                    trigger={globalFiltroTrigger}
                    ordenesPendientes={ordenesFiltradas}
                  />
                ) : (
                  <p className="text-center text-slate-400 text-sm py-8 bg-white rounded-xl border border-slate-200 border-dashed">No hay cuenta activa en {tabCuentas}.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Fase 2 — operación de dinero (Cobrar / Anticipo) sobre el cliente activo.
          Monta los MISMOS componentes de Caja en modo administrativo (sin sesión). */}
      {opModal && clienteSel && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center px-2 sm:px-4 pt-16 pb-4">
          <div className="bg-white rounded-2xl shadow-2xl w-[97vw] max-w-6xl h-[calc(100vh-5rem)] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-700 text-white flex items-center justify-center">
                  {opModal === 'COBRO' ? <DollarSign size={16} /> : opModal === 'VENTA' ? <ShoppingCart size={16} /> : <PlusCircle size={16} />}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 leading-tight">
                    {opModal === 'COBRO' ? 'Cobrar / Registrar pago' : opModal === 'VENTA' ? 'Venta directa' : 'Anticipo / Saldo a favor'}
                  </h3>
                  <p className="text-[11px] text-slate-500">{clienteSel.Nombre} · Caja Administrativa</p>
                </div>
              </div>
              <button onClick={() => setOpModal(null)} title="Cerrar"
                className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {opModal === 'COBRO' ? (
                <CajaPagoDeudaTab
                  sesion={null}
                  isAdminCaja={true}
                  clienteFijo={true}
                  deudaLayout="tabla"
                  metodosPago={metodosPago}
                  cotizacion={cotizacion || 1}
                  initialCliente={clienteSel}
                  onPagoCompletado={onOperacionOk}
                />
              ) : opModal === 'VENTA' ? (
                <CajaVentaDirectaTab
                  isAdminCaja={true}
                  hideClienteSelector={true}
                  metodosPago={metodosPago}
                  cotizacion={cotizacion || 1}
                  initialCliente={clienteSel}
                  onVentaExitosa={onOperacionOk}
                />
              ) : (
                <CajaSaldoAnticipoTab
                  sesion={null}
                  isAdminCaja={true}
                  hideClienteSelector={true}
                  hideBilletera={true}
                  metodosPago={metodosPago}
                  cotizacion={cotizacion || 1}
                  initialCliente={clienteSel}
                  onCobroCompletado={onOperacionOk}
                />
              )}
            </div>
            <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-400">Al confirmar, el estado de cuenta se actualiza automáticamente.</span>
              <button onClick={cerrarOp}
                className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
