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
  ShoppingCart, Tag, FilePlus, MoreHorizontal, Download, Printer,
  ArrowLeft, Zap, CheckCircle2, Calendar, TrendingDown, PlusCircle, X, Layers, Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router-dom';

import api from '../../services/api';
import { generarPdfEstadoCuenta, generarPdfEstadoCuentaResumen } from '../../utils/pdfGenerator';
import { exportarExcelEstadoCuenta } from '../../utils/excelGenerator';
import ClienteBilletera from '../common/ClienteBilletera';
import { fechaOrden } from '../../utils/fechas';
// Reuso directo de las piezas ya construidas y probadas de la vista de cuentas.
import {
  fetchAPI, fmt, FilaCliente, MovimientosPanel, PlanesPanel, ModalSaldoInicial,
  ModalConsumirRecurso,
} from './ContabilidadCuentasView';
// Fase 2: cobro y saldos — se montan tal cual (mismos componentes que Caja).
import CajaPagoDeudaTab from './CajaPagoDeudaTab';
import CajaSaldoAnticipoTab from './CajaSaldoAnticipoTab';
// Fase 3: venta directa (facturar órdenes reusa el flujo de /contabilidad/prefactura)
import CajaVentaDirectaTab from './CajaVentaDirectaTab';
// Menú "Más": Bandeja CFE del cliente + Nueva Factura Manual (reuso directo)
import ContabilidadBandejaCFE from './ContabilidadBandejaCFE';
import FacturacionManualModal from './FacturacionManualModal';

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

/* ── Panel de Estado de Cuenta LEGIBLE (una fila por documento) ──────────────
   Reemplaza en pantalla al libro mayor (MovimientosPanel) dentro del Panel 360.
   Consume el endpoint /clientes/:id/resumen-documentos y filtra por la moneda
   de la pestaña activa (US$ / $). */
const CHIP = {
  PAGADO:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARCIAL:   'bg-amber-50 text-amber-700 border-amber-200',
  VENCIDO:   'bg-rose-50 text-rose-600 border-rose-200',
  PENDIENTE: 'bg-rose-50 text-rose-600 border-rose-200',
  ANULADO:   'bg-slate-100 text-slate-400 border-slate-200',
};
const CHIP_DOT = {
  PAGADO: 'bg-emerald-500', PARCIAL: 'bg-amber-500', VENCIDO: 'bg-rose-500',
  PENDIENTE: 'bg-rose-500', ANULADO: 'bg-slate-400',
};
const CHIP_LABEL = { PAGADO: 'Pagado', PARCIAL: 'Parcial', VENCIDO: 'Vencido', PENDIENTE: 'Pendiente', ANULADO: 'Anulado' };
const fmtMoney = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtFechaCorta = (str) => {
  if (!str) return '—';
  const p = String(str).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : str;
};

const EstadoChip = ({ estado }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${CHIP[estado] || CHIP.PENDIENTE}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${CHIP_DOT[estado] || CHIP_DOT.PENDIENTE}`} />
    {CHIP_LABEL[estado] || estado}
  </span>
);

function ResumenDocumentosPanel({ CliIdCliente, desde, hasta, trigger, incluirAnulados, onIncluirAnulados, saldosPorMoneda, recursoCuentas = [], cuentas = [], cliente, recargarCuentas, onResumen }) {
  const [docs, setDocs]       = useState([]);
  const [pagos, setPagos]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [vista, setVista]     = useState('ESTADO'); // 'ESTADO' | 'DOCS' | 'PAGOS' | 'ORDENES'
  const [fTipoEC, setFTipoEC] = useState('TODOS');  // filtro de tipo en Estado de Cuenta
  const [fMonEC, setFMonEC]   = useState('TODAS');  // filtro de moneda en Estado de Cuenta (símbolo $ / US$)
  const [fConceptoEC, setFConceptoEC] = useState(''); // búsqueda por concepto en Estado de Cuenta
  const [ordenesMov, setOrdenesMov]   = useState([]);
  const [loadingOrd, setLoadingOrd]   = useState(false);
  const [ordCargadas, setOrdCargadas] = useState(false);
  // Filtros de la pestaña Órdenes
  const [fOrden, setFOrden] = useState('');
  const [fDoc, setFDoc]     = useState('');
  const [fFact, setFFact]   = useState('TODAS');   // TODAS | FACT | SINFACT
  const [fMon, setFMon]     = useState('TODAS');   // TODAS | $ | US$
  const [fSit, setFSit]     = useState('TODAS');   // TODAS | PAGADO | PENDIENTE | SIN_FACTURAR | ANULADO
  // Acciones sobre órdenes pendientes de facturar (reuso de ContabilidadCuentasView)
  const [modalConsumir, setModalConsumir] = useState(null); // orden a consumir desde recurso
  const [modalCancelar, setModalCancelar] = useState(null); // orden a cancelar/anular
  const [cancelWorking, setCancelWorking] = useState(false);
  const [ordRefresh, setOrdRefresh]       = useState(0);    // bump para recargar órdenes tras una acción

  // Orden ya cubierta por un plan → no se ofrece "Recurso" (la reversa se hace desde el libro del plan).
  const estaCubierta = (o) => (o.MovObservaciones || '').startsWith('CUBIERTO') || (o.MovObservaciones || '').startsWith('MATERIAL_CUBIERTO');

  const cancelarOrden = async () => {
    if (!modalCancelar) return;
    setCancelWorking(true);
    try {
      const res = await api.post(`/contabilidad/movimientos/${modalCancelar.MovIdMovimiento}/anular-orden`);
      toast.success(res.data?.message || 'Orden cancelada correctamente');
      setModalCancelar(null);
      setOrdRefresh(v => v + 1);
      recargarCuentas?.();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setCancelWorking(false);
    }
  };

  // ¿La orden tiene un recurso (plan de metros) con saldo para consumir de su material?
  // Solo con esto se ofrece el botón "Recurso".
  const tieneRecurso = (o) => !!o.ProIdProducto && recursoCuentas.some(
    rc => rc.ProIdProducto != null && rc.ProIdProducto === o.ProIdProducto && Number(rc.CueSaldoActual || 0) > 0.01
  );

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    const p = new URLSearchParams();
    if (desde) p.append('desde', desde);
    if (hasta) p.append('hasta', hasta);
    fetchAPI(`/api/contabilidad/clientes/${CliIdCliente}/resumen-documentos?${p}`)
      .then(r => { if (alive) { setDocs(r.data?.documentos || []); setPagos(r.data?.pagos || []); } })
      .catch(e => { if (alive) { setError(e.message); setDocs([]); setPagos([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [CliIdCliente, desde, hasta, trigger]);

  // Movimientos de órdenes — se cargan al abrir la pestaña Órdenes (y al cambiar período/anulados)
  useEffect(() => {
    if (vista !== 'ORDENES') return;
    let alive = true;
    setLoadingOrd(true);
    const p = new URLSearchParams();
    if (desde) p.append('desde', desde);
    if (hasta) p.append('hasta', hasta);
    if (incluirAnulados) p.append('incluirAnulados', 'true');
    fetchAPI(`/api/contabilidad/clientes/${CliIdCliente}/movimientos-ordenes?${p}`)
      .then(r => { if (alive) { setOrdenesMov(r.data || []); setOrdCargadas(true); } })
      .catch(e => { if (alive) { toast.error(e.message); setOrdenesMov([]); } })
      .finally(() => { if (alive) setLoadingOrd(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, CliIdCliente, desde, hasta, trigger, incluirAnulados, ordRefresh]);

  // KPIs de la barra de saldos, POR MONEDA (antes dependían del toggle UYU/USD, que ya
  // no existe). Pendiente = suma de lo que resta de los documentos de esa moneda;
  // "a favor" = saldo de la cuenta de dinero de esa moneda (lo sabe el padre → saldosPorMoneda).
  const resumenKPI = useMemo(() => {
    const map = {};
    docs.forEach(d => {
      if (!incluirAnulados && d.estado === 'ANULADO') return;
      const m = d.MonSimbolo || '$';
      if (!map[m]) map[m] = { moneda: m, totalPend: 0, pagados: 0, total: 0, aFavor: 0 };
      map[m].totalPend += Number(d.pendiente || 0);
      map[m].total += 1;
      if (d.estado === 'PAGADO') map[m].pagados += 1;
    });
    // Sumar el saldo a favor de cada moneda; incluir monedas que solo tienen saldo a favor.
    Object.entries(saldosPorMoneda || {}).forEach(([m, v]) => {
      if (!map[m]) map[m] = { moneda: m, totalPend: 0, pagados: 0, total: 0, aFavor: 0 };
      map[m].aFavor = Number(v) || 0;
    });
    return Object.values(map);
  }, [docs, incluirAnulados, saldosPorMoneda]);

  // ── ESTADO DE CUENTA: documentos + pagos en una sola línea de tiempo ──────────
  // A diferencia de las otras pestañas, NO se filtra por el toggle UYU/USD de arriba:
  // muestra AMBAS monedas juntas (con filtro propio). Un documento es un CARGO (debe:
  // crea deuda), un pago es un ABONO (haber: la cancela). El "pagado" del documento y las
  // filas de Pagos son el MISMO dinero (verificado), así que el doc va SOLO como cargo y
  // el pago SOLO como abono, nunca los dos, o se contaría el cobro dos veces.
  const prefijoDoc = (d) => (d.documento || '').split('-')[0].toUpperCase() || 'OTRO';
  const movimientos = useMemo(() => {
    const docsEC = docs.filter(d => incluirAnulados || d.estado !== 'ANULADO');
    const filas = [
      ...docsEC.map(d => ({
        clase: 'DOC', key: 'D' + d.DocIdDocumento, fecha: d.fecha, moneda: d.MonSimbolo,
        tipoKey: prefijoDoc(d), tipoLabel: d.tipo, etiqueta: d.documento,
        descripcion: d.descripcion, factura: d.factura, cfeEstado: d.cfeEstado,
        cargo: Number(d.total || 0), abono: 0, estado: d.estado,
      })),
      ...pagos.map((p, i) => ({
        clase: 'PAGO', key: 'P' + i, fecha: p.fecha, moneda: p.MonSimbolo,
        tipoKey: 'PAGO', tipoLabel: p.tipo, etiqueta: p.aplicadoA || null,
        esFavor: !!p.esFavor, medioPago: p.medioPago, cheques: p.cheques, recibo: p.recibo,
        cargo: 0, abono: Number(p.importe || 0), estado: p.esFavor ? 'A FAVOR' : 'COBRO',
      })),
    ];
    let filtradas = filas;
    if (fTipoEC !== 'TODOS') filtradas = filtradas.filter(f => f.tipoKey === fTipoEC);
    if (fMonEC !== 'TODAS')  filtradas = filtradas.filter(f => f.moneda === fMonEC);
    // Búsqueda por concepto: matchea documento, tipo, e-Ticket, descripción o medio de pago.
    const q = fConceptoEC.trim().toLowerCase();
    if (q) {
      filtradas = filtradas.filter(f => (
        `${f.etiqueta || ''} ${f.tipoLabel || ''} ${f.descripcion || ''} ${f.factura || ''} ${f.medioPago || ''}`
          .toLowerCase().includes(q)
      ));
    }

    // Saldo acumulado (cartola) POR MONEDA: pesos y dólares llevan su propio saldo, no se
    // mezclan. Se acumula CRONOLÓGICO (viejo→nuevo) y, a igual fecha, el cargo (te
    // facturan) ANTES que el abono (después pagás), para que una venta contado no
    // "parpadee a favor". Un documento anulado no crea deuda: no suma.
    filtradas.sort((a, b) => {
      const d = fechaOrden(a.fecha) - fechaOrden(b.fecha);   // ascendente
      if (d !== 0) return d;
      return (a.clase === 'DOC' ? 0 : 1) - (b.clase === 'DOC' ? 0 : 1); // cargo primero
    });
    const acums = {};
    for (const m of filtradas) {
      if (m.estado !== 'ANULADO') acums[m.moneda] = (acums[m.moneda] || 0) + m.cargo - m.abono;
      m.saldo = acums[m.moneda] || 0;
    }
    // Display: más reciente arriba.
    filtradas.reverse();
    return filtradas;
  }, [docs, pagos, incluirAnulados, fTipoEC, fMonEC, fConceptoEC]);
  // El saldo corriente solo es legible con TODOS los movimientos: un subconjunto (por tipo
  // o por búsqueda de concepto) daría un acumulado parcial sin sentido. La moneda no lo
  // afecta: el saldo es por moneda.
  const mostrarSaldo = fTipoEC === 'TODOS' && !fConceptoEC.trim();

  // Opciones del filtro de tipo (las que existen en los datos, ambas monedas, + Pagos)
  const tiposDisponibles = useMemo(() => {
    const set = new Map();
    docs.filter(d => incluirAnulados || d.estado !== 'ANULADO').forEach(d => set.set(prefijoDoc(d), d.tipo));
    const opts = [...set.entries()].map(([key, label]) => ({ key, label }));
    if (pagos.length) opts.push({ key: 'PAGO', label: 'Pagos / Cobros' });
    return opts;
  }, [docs, pagos, incluirAnulados]);

  // Monedas presentes (para el filtro y los subtotales del pie)
  const monedasPresentes = useMemo(() => {
    const s = new Set();
    docs.forEach(d => s.add(d.MonSimbolo));
    pagos.forEach(p => s.add(p.MonSimbolo));
    return [...s].filter(Boolean);
  }, [docs, pagos]);

  // Subtotales por moneda (una fila de totales por cada moneda visible)
  const resumenPorMoneda = useMemo(() => {
    const m = {};
    for (const f of movimientos) {
      if (!m[f.moneda]) m[f.moneda] = { cargos: 0, abonos: 0 };
      m[f.moneda].cargos += f.cargo;
      m[f.moneda].abonos += f.abono;
    }
    return Object.entries(m).map(([moneda, v]) => ({ moneda, ...v, saldo: v.cargos - v.abonos }));
  }, [movimientos]);

  // Órdenes filtradas (pestaña Órdenes) — filtros por orden, documento, facturación, moneda y situación de pago
  const ordenesFiltradas = ordenesMov.filter(o => {
    if (fFact === 'FACT' && !o.facturada) return false;
    if (fFact === 'SINFACT' && o.facturada) return false;
    if (fMon !== 'TODAS' && o.MonSimbolo !== fMon) return false;
    if (fSit !== 'TODAS' && o.situacion !== fSit) return false;
    if (fOrden.trim() && !`${o.orden} ${o.trabajo || ''}`.toLowerCase().includes(fOrden.trim().toLowerCase())) return false;
    if (fDoc.trim() && !(o.documento || '').toLowerCase().includes(fDoc.trim().toLowerCase())) return false;
    return true;
  });

  // Reporta los saldos POR MONEDA al padre (se muestran arriba, en la barra de saldos).
  useEffect(() => {
    if (onResumen) onResumen(resumenKPI);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumenKPI]);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-2 border-cyan-600 border-t-transparent rounded-full" /></div>;
  }
  if (error) {
    return <p className="text-center text-rose-500 text-sm py-8 bg-white rounded-xl border border-rose-200">No se pudo cargar el estado de cuenta: {error}</p>;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Los saldos (pendiente / a favor) se muestran arriba en la barra de filtros (elevados vía onResumen) */}

      {/* Sub-pestañas: Estado de cuenta / Órdenes / Recursos */}
      <div className="px-4 pt-3 flex items-center gap-4 border-b border-slate-100">
        {[['ESTADO', 'Estado de cuenta', movimientos.length], ['ORDENES', 'Órdenes', ordCargadas ? ordenesFiltradas.length : null], ['RECURSOS', 'Recursos', recursoCuentas.length || null]].map(([key, label, count]) => (
          <button key={key} type="button" onClick={() => setVista(key)}
            className={`relative pb-2.5 text-xs font-bold transition-colors ${vista === key ? 'text-cyan-700' : 'text-slate-400 hover:text-slate-600'}`}>
            {label} {count != null && <span className="text-[10px] font-semibold text-slate-400">({count})</span>}
            {vista === key && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-cyan-600 rounded-full" />}
          </button>
        ))}
      </div>

      {/* ── Vista ESTADO DE CUENTA (documentos + pagos, cronológico) ── */}
      {vista === 'ESTADO' && (
        <>
          {/* Filtros propios del estado de cuenta: moneda + tipo. Muestra AMBAS monedas
              juntas (no depende del toggle UYU/USD de arriba). */}
          <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
            {monedasPresentes.length > 1 && (
              <>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1">Moneda</span>
                {[{ key: 'TODAS', label: 'Todas' }, ...monedasPresentes.map(s => ({ key: s, label: s }))].map(t => (
                  <button key={t.key} type="button" onClick={() => setFMonEC(t.key)}
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${fMonEC === t.key ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-500 border-slate-200 hover:border-cyan-300'}`}>
                    {t.label}
                  </button>
                ))}
                <span className="w-px h-4 bg-slate-200 mx-1" />
              </>
            )}
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1">Tipo</span>
            {[{ key: 'TODOS', label: 'Todos' }, ...tiposDisponibles].map(t => (
              <button key={t.key} type="button" onClick={() => setFTipoEC(t.key)}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${fTipoEC === t.key ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-500 border-slate-200 hover:border-cyan-300'}`}>
                {t.label}
              </button>
            ))}
            {/* Mostrar anulados — movido acá desde la barra de arriba */}
            <label title="Incluir documentos anulados"
              className="ml-auto flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer select-none">
              <span className="relative inline-flex items-center">
                <input type="checkbox" checked={!!incluirAnulados}
                  onChange={e => onIncluirAnulados?.(e.target.checked)} className="peer sr-only" />
                <span className="w-9 h-5 rounded-full bg-slate-300 peer-checked:bg-cyan-600 transition-colors" />
                <span className="absolute left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
              </span>
              Anulados
            </label>
            {/* Buscar por concepto: documento, e-Ticket, descripción, medio de pago */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={fConceptoEC}
                onChange={e => setFConceptoEC(e.target.value)}
                placeholder="Buscar concepto…"
                className="w-48 pl-7 pr-7 py-1.5 text-[11px] font-medium border border-slate-200 rounded-full outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/10 placeholder:text-slate-400"
              />
              {fConceptoEC && (
                <button type="button" onClick={() => setFConceptoEC('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" title="Limpiar">
                  <X size={13} />
                </button>
              )}
            </div>
            <span className="text-[11px] font-semibold text-slate-400">{movimientos.length} movimiento{movimientos.length !== 1 ? 's' : ''}</span>
          </div>
          {mostrarSaldo && (desde || hasta) && (
            <div className="px-4 pb-2 -mt-1">
              <span className="text-[10px] text-amber-600 font-semibold">
                El saldo arranca en cero al inicio del período — no incluye la deuda anterior a {desde ? fmtFechaCorta(desde) : 'la fecha'}.
              </span>
            </div>
          )}

          {movimientos.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">Sin movimientos para el período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                    <th className="text-left font-bold px-4 py-2.5">Fecha</th>
                    <th className="text-left font-bold px-4 py-2.5">Tipo</th>
                    <th className="text-left font-bold px-4 py-2.5">Documento</th>
                    <th className="text-right font-bold px-4 py-2.5">Cargo</th>
                    <th className="text-right font-bold px-4 py-2.5">Abono</th>
                    {mostrarSaldo && <th className="text-right font-bold px-4 py-2.5">Saldo</th>}
                    <th className="text-center font-bold px-4 py-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map(m => {
                    const anulado = m.estado === 'ANULADO';
                    const esDoc = m.clase === 'DOC';
                    return (
                      <tr key={m.key} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/60 ${esDoc ? '' : 'bg-emerald-50/20'}`}>
                        <td className="px-4 py-3 tabular-nums text-slate-500 whitespace-nowrap align-middle">{fmtFechaCorta(m.fecha)}</td>
                        {/* TIPO y DOCUMENTO en columnas separadas: así los códigos de
                            documento quedan alineados uno debajo del otro (como la vista de
                            cuentas), sin importar el largo del badge de tipo. */}
                        <td className="px-4 py-3 align-middle whitespace-nowrap">
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide border ${esDoc ? 'bg-slate-50 text-slate-500 border-slate-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
                            {esDoc ? m.tipoLabel : (m.esFavor ? 'A favor' : 'Cobro')}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-bold ${anulado ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                              {m.etiqueta || (esDoc ? '' : (m.recibo || 'Cobro'))}
                            </span>
                            {/* Estado DGI del propio documento (dato fiable). NO se muestra la
                                referencia al e-Ticket: se derivaba por texto y podía traer el
                                número de otro documento (bug del campo 'factura'). */}
                            {esDoc && m.cfeEstado === 'ACEPTADO_DGI' && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 uppercase tracking-wide">DGI ✓</span>
                            )}
                            {esDoc && m.cfeEstado && m.cfeEstado !== 'ACEPTADO_DGI' && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wide">Borrador</span>
                            )}
                            {/* Cobro: recibo · forma de pago · N° cheque, en la misma línea */}
                            {!esDoc && m.recibo && m.etiqueta && (
                              <span className="text-[11px] font-bold text-slate-500">{m.recibo}</span>
                            )}
                            {!esDoc && m.medioPago && (
                              <span className="text-[11px] font-semibold text-slate-500">
                                · {m.medioPago}{m.cheques ? ` · Cheque N° ${m.cheques}` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums font-bold align-middle whitespace-nowrap ${anulado ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                          {m.cargo > 0 ? `${m.moneda} ${fmtMoney(m.cargo)}` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-600 align-middle whitespace-nowrap">
                          {m.abono > 0 ? `${m.moneda} ${fmtMoney(m.abono)}` : <span className="text-slate-300">—</span>}
                        </td>
                        {mostrarSaldo && (
                          <td className={`px-4 py-3 text-right tabular-nums font-black align-middle whitespace-nowrap ${Math.abs(m.saldo) < 0.01 ? 'text-slate-400' : m.saldo > 0 ? 'text-slate-800' : 'text-emerald-700'}`}>
                            {m.moneda} {fmtMoney(Math.abs(m.saldo))}
                            {m.saldo < -0.01 && <span className="block text-[9px] font-bold text-emerald-600 uppercase tracking-wide">a favor</span>}
                          </td>
                        )}
                        <td className="px-4 py-3 text-center align-middle">
                          {esDoc ? <EstadoChip estado={m.estado} /> : (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${m.esFavor ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-cyan-50 text-cyan-700 border-cyan-200'}`}>
                              {m.esFavor ? 'A favor' : 'Cobro'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {/* Un subtotal por moneda: pesos y dólares no se suman entre sí. */}
                  {resumenPorMoneda.map((r, i) => (
                    <tr key={r.moneda} className={`bg-slate-50 ${i === 0 ? 'border-t border-slate-200' : ''}`}>
                      <td colSpan={3} className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Totales del período · {r.moneda}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-black text-slate-700 whitespace-nowrap">{r.moneda} {fmtMoney(r.cargos)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-black text-emerald-700 whitespace-nowrap">{r.moneda} {fmtMoney(r.abonos)}</td>
                      {mostrarSaldo && (
                        <td className={`px-4 py-2.5 text-right tabular-nums font-black whitespace-nowrap ${r.saldo >= -0.01 ? 'text-slate-800' : 'text-emerald-700'}`}>
                          {r.moneda} {fmtMoney(Math.abs(r.saldo))}{r.saldo < -0.01 ? ' a favor' : ''}
                        </td>
                      )}
                      <td></td>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}


      {/* ── Vista ÓRDENES (todos los movimientos de órdenes con filtros) ── */}
      {vista === 'ORDENES' && (
        <>
          {/* Filtros: orden · documento · facturación · moneda · situación de pago */}
          <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
            <input value={fOrden} onChange={e => setFOrden(e.target.value)} placeholder="Buscar orden / trabajo…"
              className="flex-1 min-w-[150px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-cyan-500" />
            <input value={fDoc} onChange={e => setFDoc(e.target.value)} placeholder="Documento…"
              className="w-[120px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-cyan-500" />
            <select value={fFact} onChange={e => setFFact(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 outline-none">
              <option value="TODAS">Facturación: todas</option>
              <option value="FACT">Facturadas</option>
              <option value="SINFACT">Sin facturar</option>
            </select>
            <select value={fMon} onChange={e => setFMon(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 outline-none">
              <option value="TODAS">Moneda: todas</option>
              <option value="$">$</option>
              <option value="US$">US$</option>
            </select>
            <select value={fSit} onChange={e => setFSit(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 outline-none">
              <option value="TODAS">Pago: todos</option>
              <option value="PAGADO">Pagado</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="SIN_FACTURAR">Sin facturar</option>
              <option value="ANULADO">Anulado</option>
            </select>
          </div>

          {loadingOrd ? (
            <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-2 border-cyan-600 border-t-transparent rounded-full" /></div>
          ) : ordenesFiltradas.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">{ordCargadas ? 'Sin órdenes para los filtros elegidos.' : 'Sin datos.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                    <th className="text-left font-bold px-4 py-2.5">Fecha</th>
                    <th className="text-left font-bold px-4 py-2.5">Orden</th>
                    <th className="text-left font-bold px-4 py-2.5">Material</th>
                    <th className="text-left font-bold px-4 py-2.5">Documento</th>
                    <th className="text-center font-bold px-4 py-2.5">Facturación</th>
                    <th className="text-center font-bold px-4 py-2.5">Moneda</th>
                    <th className="text-right font-bold px-4 py-2.5">Importe</th>
                    <th className="text-center font-bold px-4 py-2.5">Pago</th>
                    <th className="text-center font-bold px-4 py-2.5">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenesFiltradas.map(o => (
                    <tr key={o.MovIdMovimiento} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3 tabular-nums text-slate-500 whitespace-nowrap align-top">{fmtFechaCorta(o.fecha)}</td>
                      <td className="px-4 py-3 align-top">
                        <span className="font-bold text-slate-800">{o.orden}</span>
                        {o.trabajo && <span className="block text-[11px] text-slate-400 truncate max-w-[220px]" title={o.trabajo}>{o.trabajo}</span>}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-600 text-xs">
                        {o.material ? <span className="truncate max-w-[160px] inline-block align-top" title={o.material}>{o.material}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {o.documento
                          ? <><span className="font-semibold text-slate-700">{o.documento}</span>{o.DocTipo && <span className="block text-[11px] text-slate-400">{o.DocTipo}</span>}</>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center align-top">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${o.facturada ? 'bg-cyan-50 text-cyan-700 border-cyan-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          {o.facturada ? 'Facturada' : 'Sin facturar'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center align-top text-slate-500 font-bold">{o.MonSimbolo}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800 align-top">{o.MonSimbolo} {fmtMoney(o.importe)}</td>
                      <td className="px-4 py-3 text-center align-top">
                        {o.situacion === 'SIN_FACTURAR' ? <span className="text-slate-300 text-xs">—</span> : <EstadoChip estado={o.situacion} />}
                      </td>
                      <td className="px-4 py-3 text-center align-top whitespace-nowrap">
                        {o.situacion === 'SIN_FACTURAR' ? (
                          <div className="flex items-center justify-center gap-1.5">
                            {!estaCubierta(o) && tieneRecurso(o) && (
                              <button onClick={() => setModalConsumir(o)} title="Consumir desde recurso (plan de metros)"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-colors">
                                <Layers size={12} /> Recurso
                              </button>
                            )}
                            <button onClick={() => setModalCancelar(o)} title="Cancelar esta orden"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors">
                              <Ban size={12} /> Cancelar
                            </button>
                          </div>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Modales de acciones sobre órdenes pendientes de facturar (reuso de ContabilidadCuentasView) ── */}
          {modalConsumir && (
            <ModalConsumirRecurso
              mov={{
                MovIdMovimiento:  modalConsumir.MovIdMovimiento,
                MovImporte:       modalConsumir.importe,
                OrdCodigoOrden:   modalConsumir.orden,
                MovConcepto:      modalConsumir.orden,
                OrdNombreTrabajo: modalConsumir.trabajo,
                MovObservaciones: modalConsumir.MovObservaciones,
                OrdCantidad:      0,
              }}
              cuenta={cuentas.find(c => c.CueIdCuenta === modalConsumir.CueIdCuenta)
                      || { CueIdCuenta: modalConsumir.CueIdCuenta, MonSimbolo: modalConsumir.MonSimbolo, CueDiasCiclo: 0 }}
              cliente={cliente}
              onClose={() => setModalConsumir(null)}
              onSuccess={() => { setModalConsumir(null); setOrdRefresh(v => v + 1); recargarCuentas?.(); }}
            />
          )}

          {modalCancelar && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-rose-100 overflow-hidden">
                <div className="px-6 py-4 bg-gradient-to-r from-rose-600 to-rose-500 text-white flex items-center gap-2">
                  <Ban size={18} /> <h2 className="font-bold text-base">Cancelar orden</h2>
                </div>
                <div className="px-6 py-5 space-y-3">
                  <p className="text-sm font-bold text-slate-800">{modalCancelar.orden}</p>
                  {modalCancelar.trabajo && <p className="text-xs text-slate-500">{modalCancelar.trabajo}</p>}
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                    Se revertirá el saldo de <strong>{modalCancelar.MonSimbolo} {fmtMoney(modalCancelar.importe)}</strong> y la orden no podrá facturarse. Esta acción no se puede deshacer.
                  </div>
                </div>
                <div className="px-6 pb-5 flex gap-3">
                  <button onClick={() => setModalCancelar(null)} disabled={cancelWorking}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">Volver</button>
                  <button onClick={cancelarOrden} disabled={cancelWorking}
                    className="flex-1 px-4 py-2.5 text-sm font-black text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center justify-center gap-2">
                    {cancelWorking ? <RefreshCw size={14} className="animate-spin" /> : <Ban size={14} />}
                    {cancelWorking ? 'Cancelando...' : 'Cancelar orden'}
                  </button>
                </div>
              </div>
            </div>
          )}

        </>
      )}

      {/* ── Vista RECURSOS (planes de metros / recursos del cliente) ── */}
      {vista === 'RECURSOS' && (
        recursoCuentas.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-10">Sin planes ni recursos para este cliente.</p>
        ) : (
          <div className="p-4 flex flex-col gap-4">
            {recursoCuentas.map(cuenta => (
              <PlanesPanel key={cuenta.CueIdCuenta} cuenta={cuenta} CliIdCliente={CliIdCliente}
                cliente={cliente} desde={desde} hasta={hasta} onClose={() => {}} onChanged={recargarCuentas} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

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
  const [resumenSaldos, setResumenSaldos]         = useState(null); // saldos reportados por el ResumenDocumentosPanel → se muestran en la barra de filtros
  const [refreshBilletera, setRefreshBilletera]   = useState(0);
  const [hasAutoSelected, setHasAutoSelected]     = useState(false);
  const [generandoPdf, setGenerandoPdf]           = useState(false);
  const [generandoResumen, setGenerandoResumen]   = useState(false);
  const [incluirAnulados, setIncluirAnulados]     = useState(false);
  const [exportandoExcel, setExportandoExcel]     = useState(false);
  const [showMasMenu, setShowMasMenu]             = useState(false);
  const [showBandejaCFE, setShowBandejaCFE]       = useState(false);
  const [showFacturaManual, setShowFacturaManual] = useState(false);
  const [showSaldoInicial, setShowSaldoInicial]   = useState(false);

  const [globalDesde, setGlobalDesde] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]; });
  const [globalHasta, setGlobalHasta] = useState(() => new Date().toISOString().split('T')[0]);
  const [globalFiltroTrigger, setGlobalFiltroTrigger] = useState(0);

  // Fase 2 — operación de dinero (Caja Administrativa, sin sesión de mostrador)
  const [opModal, setOpModal]         = useState(null); // 'COBRO' | 'ANTICIPO' | 'VENTA'
  const [cobroPaso, setCobroPaso]     = useState('seleccion'); // paso del cobro, controlado desde acá para el botón Cerrar
  const [anticipoPaso, setAnticipoPaso] = useState('operacion'); // paso del anticipo (mismo patrón que el cobro)
  const [ventaPaso, setVentaPaso]     = useState('conceptos');   // paso de la venta (mismo patrón)
  const [ventaTipo, setVentaTipo]     = useState('recursos');    // 'recursos' (RECURSO) | 'libre' (insumos/productos)
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
  // Al volver de la pre-factura tras emitir → aviso (el auto-select por selectedClienteId ya recarga los datos)
  useEffect(() => {
    if (location.state?.facturaEmitida) toast.success('Factura emitida — estado de cuenta actualizado.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFacturarOrdenes = () => {
    // Preferir las órdenes de la cuenta activa; si no hay en esta moneda, tomar la cuenta que sí tenga órdenes.
    let ordenes = ordenesFiltradas;
    let cuentaFact = cuentaActiva;
    if (!ordenes.length && ordenesAnticipo.length) {
      const primera = ordenesAnticipo[0];
      cuentaFact = cuentas.find(c => c.CueIdCuenta === primera.CueIdCuenta) || cuentas[0];
      ordenes = ordenesAnticipo.filter(o => o.CueIdCuenta === cuentaFact?.CueIdCuenta);
    }
    if (!ordenes.length) {
      toast('No hay órdenes pendientes de facturar para este cliente.');
      return;
    }
    navigate('/contabilidad/prefactura', {
      state: {
        ciclo: { CicIdCiclo: (cuentaFact && Number(cuentaFact.CueSaldoActual || 0) > 0) ? 'ANTICIPO' : 'CREDITO', CicFechaInicio: new Date().toISOString(), CicFechaCierre: new Date().toISOString() },
        cliente: clienteSel,
        cuenta: cuentaFact || cuentas[0],
        movsOriginales: ordenes.map(m => ({ ...m, MovImporte: m.MovImporte < 0 ? m.MovImporte : -Math.abs(m.MovImporte) })),
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
      // Modo TODOS: trae cualquier cliente, tenga o no cuenta abierta (la cuenta se abre con la 1ª operación)
      qp.append('tipo', 'TODOS');
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

  // Saldo a favor por moneda (para los KPIs del estado de cuenta, que ya no dependen del
  // toggle): símbolo → CueSaldoActual de la cuenta de dinero de esa moneda.
  const saldosPorMoneda = useMemo(() => {
    const m = {};
    cuentas.filter(c => !esRecurso(c)).forEach(c => {
      const sim = c.MonSimbolo || (c.CueTipo === 'DINERO_USD' ? 'US$' : '$');
      m[sim] = (m[sim] || 0) + Number(c.CueSaldoActual ?? 0);
    });
    return m;
  }, [cuentas]);

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

  // Estado de cuenta LEGIBLE (una fila por documento, con estado pagado/pendiente).
  const handleResumenLegible = async () => {
    if (!clienteSel || cuentas.length === 0) return;
    setGenerandoResumen(true);
    const toastId = toast.loading('Generando resumen de estado de cuenta...');
    try {
      const p = new URLSearchParams();
      if (globalDesde) p.append('desde', globalDesde);
      if (globalHasta) p.append('hasta', globalHasta);
      // Documentos (endpoint nuevo) + secciones (para las órdenes pendientes de facturar)
      const [resDocs, { secciones }] = await Promise.all([
        fetchAPI(`/api/contabilidad/clientes/${clienteSel.CliIdCliente}/resumen-documentos?${p}`),
        construirSecciones(),
      ]);
      const documentos = resDocs.data?.documentos || [];

      // Órdenes pendientes de facturar: mismo criterio que el PDF detallado.
      const ordenesPendientes = [];
      cuentas.forEach(c => {
        const movs = secciones[c.CueIdCuenta]?.movs || [];
        movs.filter(m =>
          (m.MovTipo === 'ORDEN' || m.MovTipo === 'ORDEN_ANTICIPO') &&
          !m.MovAnulado && !m.DocIdDocumento &&
          !(m.MovObservaciones && m.MovObservaciones.startsWith('CUBIERTO'))
        ).forEach(m => ordenesPendientes.push({
          fecha: m.MovFecha,
          orden: m.OrdCodigoOrden || m.CodigoOrdenStr || '—',
          trabajo: m.OrdNombreTrabajo || '—',
          importe: m.MovImporte,
          sym: c.MonSimbolo || '$',
        }));
      });

      generarPdfEstadoCuentaResumen(clienteSel, documentos, ordenesPendientes, {
        desde: globalDesde, hasta: globalHasta, incluirAnulados,
      });
      toast.success('Resumen generado.', { id: toastId });
    } catch (e) { toast.error('Error al generar el resumen: ' + e.message, { id: toastId }); }
    finally { setGenerandoResumen(false); }
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
                  <p className="text-xs">{busqueda.trim() ? 'No se encontraron clientes' : 'Escribí para buscar cualquier cliente'}</p>
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

                    {/* Billetera organizada (saldos + recursos) — reemplaza a los KPIs */}
                    <div className="flex-1 min-w-0">
                      <ClienteBilletera key={`${clienteSel.CliIdCliente}_${refreshBilletera}`} clienteId={clienteSel.CliIdCliente} clienteNombre={clienteSel.Nombre} agrupado />
                    </div>
                  </div>

                  {/* Toolbar de acciones (dinero = próxima fase) */}
                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    <button onClick={() => { setCobroPaso('seleccion'); setOpModal('COBRO'); }}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">
                      <DollarSign size={14} /> Registrar pago
                    </button>
                    <button onClick={() => { setAnticipoPaso('operacion'); setOpModal('ANTICIPO'); }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <Wallet size={14} /> Saldo Anticipado
                    </button>
                    <button onClick={() => setShowSaldoInicial(true)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <PlusCircle size={14} /> Saldo Inicial
                    </button>
                    <button onClick={() => { setVentaTipo('recursos'); setVentaPaso('conceptos'); setOpModal('VENTA'); }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <ShoppingCart size={14} /> Venta de recursos
                    </button>
                    <button onClick={() => { setVentaTipo('libre'); setVentaPaso('conceptos'); setOpModal('VENTA'); }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <Tag size={14} /> Venta insumos y productos
                    </button>
                    <button onClick={handleFacturarOrdenes}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <Calendar size={14} /> Facturar semanales
                      {ordenesAnticipo.length > 0 && <span className="text-[9px] bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded-full font-black">{ordenesAnticipo.length}</span>}
                    </button>
                    <button onClick={() => setShowBandejaCFE(true)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <FileText size={14} /> Bandeja CFE
                    </button>
                    <button onClick={() => setShowFacturaManual(true)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors">
                      <FilePlus size={14} /> Nueva Factura Manual
                    </button>

                    <div className="flex-1" />

                    {/* Utilidades (disponibles en Fase 1) */}
                    <button onClick={handleResumenLegible} disabled={cuentas.length === 0 || generandoResumen}
                      title="Estado de cuenta resumido (una fila por documento, con estado pagado/pendiente)"
                      className="flex items-center gap-1.5 px-3 py-2 text-cyan-700 hover:bg-white hover:text-cyan-800 text-xs font-bold rounded-lg transition-colors disabled:opacity-40">
                      {generandoResumen ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />} Resumen
                    </button>
                    <button onClick={handleImprimirEstadoCuenta} disabled={cuentas.length === 0 || generandoPdf}
                      title="Estado de cuenta detallado (libro mayor)"
                      className="flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:bg-white hover:text-slate-800 text-xs font-bold rounded-lg transition-colors disabled:opacity-40">
                      {generandoPdf ? <RefreshCw size={14} className="animate-spin" /> : <Printer size={14} />} PDF detallado
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

                  {/* Barra superior: saldos por moneda · período. La moneda y los anulados
                      ahora se manejan dentro del Estado de cuenta. */}
                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-3">
                    {/* Saldos del cliente POR MONEDA (reportados por el estado de cuenta) */}
                    {Array.isArray(resumenSaldos) && resumenSaldos.length > 0 && (
                      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
                        {resumenSaldos.map(r => (
                          <div key={r.moneda} className="flex items-baseline gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              Pendiente{resumenSaldos.length > 1 ? ` ${r.moneda}` : ''}
                            </span>
                            <span className={`text-base font-black tracking-tight ${r.totalPend > 0.01 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {r.moneda} {fmtMoney(r.totalPend)}
                            </span>
                            <span className="text-[11px] text-slate-400">{r.pagados}/{r.total} pagados</span>
                            {r.aFavor > 0.01 && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                                A favor: {r.moneda} {fmtMoney(r.aFavor)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Período (fechas) */}
                    <div className="flex items-center gap-2 ml-auto">
                      <Calendar size={14} className="text-slate-400" />
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

                {/* Estado de cuenta (documentos + pagos) · Órdenes · Recursos, en pestañas.
                    La moneda, los anulados y los tipos se filtran adentro del panel. */}
                <ResumenDocumentosPanel
                  CliIdCliente={clienteSel.CliIdCliente}
                  desde={globalDesde}
                  hasta={globalHasta}
                  trigger={globalFiltroTrigger}
                  incluirAnulados={incluirAnulados}
                  onIncluirAnulados={setIncluirAnulados}
                  saldosPorMoneda={saldosPorMoneda}
                  recursoCuentas={recursoCuentas}
                  cuentas={cuentas}
                  cliente={clienteSel}
                  recargarCuentas={recargarCuentas}
                  onResumen={setResumenSaldos}
                />
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
                    {opModal === 'COBRO' ? 'Cobrar / Registrar pago' : opModal === 'VENTA' ? (ventaTipo === 'libre' ? 'Venta libre' : 'Venta de recursos') : 'Anticipo / Saldo a favor'}
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
                  pasoExterno={cobroPaso}
                  onPasoExterno={setCobroPaso}
                  metodosPago={metodosPago}
                  cotizacion={cotizacion || 1}
                  initialCliente={clienteSel}
                  onPagoCompletado={onOperacionOk}
                />
              ) : opModal === 'VENTA' ? (
                <CajaVentaDirectaTab
                  isAdminCaja={true}
                  hideClienteSelector={true}
                  hideBilletera={true}
                  defaultTipo={ventaTipo === 'libre' ? 'VENTA_INSUMOS' : 'RECURSO'}
                  allowedTipos={ventaTipo === 'libre' ? ['VENTA_INSUMOS', 'VENTA_PRODUCTOS'] : ['RECURSO']}
                  pasoExterno={ventaPaso}
                  onPasoExterno={setVentaPaso}
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
                  pasoExterno={anticipoPaso}
                  onPasoExterno={setAnticipoPaso}
                  metodosPago={metodosPago}
                  cotizacion={cotizacion || 1}
                  initialCliente={clienteSel}
                  onCobroCompletado={onOperacionOk}
                />
              )}
            </div>
            <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-400">Al confirmar, el estado de cuenta se actualiza automáticamente.</span>
              {(opModal === 'COBRO' && cobroPaso === 'pago') || (opModal === 'ANTICIPO' && anticipoPaso === 'pago') || (opModal === 'VENTA' && ventaPaso === 'pago') ? (
                <button onClick={() => { if (opModal === 'COBRO') setCobroPaso('seleccion'); else if (opModal === 'ANTICIPO') setAnticipoPaso('operacion'); else setVentaPaso('conceptos'); }}
                  className="px-4 py-2 text-xs font-bold text-cyan-700 bg-white border border-cyan-200 hover:bg-cyan-50 rounded-lg transition-colors flex items-center gap-1.5">
                  <span className="text-base leading-none">←</span> {opModal === 'COBRO' ? 'Volver a las deudas' : 'Volver'}
                </button>
              ) : (
                <button onClick={cerrarOp}
                  className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors">
                  Cerrar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Menú "Más" → Bandeja CFE del cliente (reusa ContabilidadBandejaCFE, fijada al cliente) */}
      {showBandejaCFE && clienteSel && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center px-2 sm:px-4 pt-10 pb-4">
          <div className="bg-white rounded-2xl shadow-2xl w-[97vw] max-w-7xl h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-700 text-white flex items-center justify-center"><FileText size={16} /></div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 leading-tight">Bandeja CFE del cliente</h3>
                  <p className="text-[11px] text-slate-500">{clienteSel.Nombre} · Facturación electrónica</p>
                </div>
              </div>
              <button onClick={() => setShowBandejaCFE(false)} title="Cerrar"
                className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <ContabilidadBandejaCFE initialCliente={clienteSel} embedded />
            </div>
          </div>
        </div>
      )}

      {/* Cargar Saldo Inicial (reusa ModalSaldoInicial de la vista de Cuentas) */}
      {showSaldoInicial && clienteSel && (
        <ModalSaldoInicial
          cliente={clienteSel}
          onClose={() => setShowSaldoInicial(false)}
          onSuccess={() => { setShowSaldoInicial(false); recargarCuentas(); setRefreshBilletera(v => v + 1); }}
        />
      )}

      {/* Menú "Más" → Nueva Factura Manual (prellenada con el cliente) */}
      {showFacturaManual && clienteSel && (
        <FacturacionManualModal
          initialData={{
            CliIdCliente: clienteSel.CliIdCliente,
            DocCliNombre: clienteSel.Nombre || clienteSel.NombreFantasia || '',
            DocCliDocumento: clienteSel.CioRuc || clienteSel.CodCliente || '',
            lineas: [],
          }}
          onClose={() => setShowFacturaManual(false)}
          onSuccess={() => { setShowFacturaManual(false); recargarCuentas(); }}
        />
      )}
    </div>
  );
}
