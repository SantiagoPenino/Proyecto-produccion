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
  ArrowLeft, Zap, CheckCircle2, Calendar, TrendingDown, PlusCircle, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router-dom';

import api from '../../services/api';
import { generarPdfEstadoCuenta, generarPdfEstadoCuentaResumen } from '../../utils/pdfGenerator';
import { exportarExcelEstadoCuenta } from '../../utils/excelGenerator';
import ClienteBilletera from '../common/ClienteBilletera';
// Reuso directo de las piezas ya construidas y probadas de la vista de cuentas.
import {
  fetchAPI, fmt, FilaCliente, MovimientosPanel, PlanesPanel, ModalSaldoInicial,
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

function ResumenDocumentosPanel({ CliIdCliente, monSimbolo, saldoCuenta = 0, desde, hasta, trigger, incluirAnulados, onResumen }) {
  const [docs, setDocs]       = useState([]);
  const [pagos, setPagos]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [vista, setVista]     = useState('DOCS'); // 'DOCS' | 'PAGOS' | 'ORDENES'
  const [ordenesMov, setOrdenesMov]   = useState([]);
  const [loadingOrd, setLoadingOrd]   = useState(false);
  const [ordCargadas, setOrdCargadas] = useState(false);
  // Filtros de la pestaña Órdenes
  const [fOrden, setFOrden] = useState('');
  const [fDoc, setFDoc]     = useState('');
  const [fFact, setFFact]   = useState('TODAS');   // TODAS | FACT | SINFACT
  const [fMon, setFMon]     = useState('TODAS');   // TODAS | $ | US$
  const [fSit, setFSit]     = useState('TODAS');   // TODAS | PAGADO | PENDIENTE | SIN_FACTURAR | ANULADO

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
  }, [vista, CliIdCliente, desde, hasta, trigger, incluirAnulados]);

  const visibles     = docs.filter(d => d.MonSimbolo === monSimbolo && (incluirAnulados || d.estado !== 'ANULADO'));
  const pagosVisibles = pagos.filter(p => p.MonSimbolo === monSimbolo);
  const totalPend    = visibles.reduce((s, d) => s + Number(d.pendiente || 0), 0);
  const pagados      = visibles.filter(d => d.estado === 'PAGADO').length;
  // Imputado = pago aplicado a un documento; Anticipado = a favor / sin imputar
  const esImputado   = (p) => !p.esFavor && !!p.aplicadoA;
  const totalImputado   = pagosVisibles.filter(esImputado).reduce((s, p) => s + Number(p.importe || 0), 0);
  const totalAnticipado = pagosVisibles.filter(p => !esImputado(p)).reduce((s, p) => s + Number(p.importe || 0), 0);
  const totalCobrado    = pagosVisibles.reduce((s, p) => s + Number(p.importe || 0), 0);

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

  // Reporta los saldos al padre (se muestran arriba, en la barra de filtros, no acá)
  useEffect(() => {
    if (onResumen) onResumen({ totalPend, pagados, total: visibles.length, saldoCuenta: Number(saldoCuenta) || 0, monSimbolo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPend, pagados, visibles.length, saldoCuenta, monSimbolo]);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-2 border-cyan-600 border-t-transparent rounded-full" /></div>;
  }
  if (error) {
    return <p className="text-center text-rose-500 text-sm py-8 bg-white rounded-xl border border-rose-200">No se pudo cargar el estado de cuenta: {error}</p>;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Los saldos (pendiente / a favor) se muestran arriba en la barra de filtros (elevados vía onResumen) */}

      {/* Sub-pestañas: Documentos / Pagos */}
      <div className="px-4 pt-3 flex items-center gap-4 border-b border-slate-100">
        {[['DOCS', 'Documentos', visibles.length], ['PAGOS', 'Pagos', pagosVisibles.length], ['ORDENES', 'Órdenes', ordCargadas ? ordenesFiltradas.length : null]].map(([key, label, count]) => (
          <button key={key} type="button" onClick={() => setVista(key)}
            className={`relative pb-2.5 text-xs font-bold transition-colors ${vista === key ? 'text-cyan-700' : 'text-slate-400 hover:text-slate-600'}`}>
            {label} {count != null && <span className="text-[10px] font-semibold text-slate-400">({count})</span>}
            {vista === key && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-cyan-600 rounded-full" />}
          </button>
        ))}
      </div>

      {/* ── Vista DOCUMENTOS ── */}
      {vista === 'DOCS' && (
        visibles.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-10">Sin documentos en {monSimbolo} para el período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                  <th className="text-left font-bold px-4 py-2.5">Fecha</th>
                  <th className="text-left font-bold px-4 py-2.5">Documento</th>
                  <th className="text-right font-bold px-4 py-2.5">Importe doc.</th>
                  <th className="text-right font-bold px-4 py-2.5">Pago</th>
                  <th className="text-right font-bold px-4 py-2.5">Pendiente</th>
                  <th className="text-center font-bold px-4 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(d => {
                  const anulado = d.estado === 'ANULADO';
                  const pend = Number(d.pendiente || 0);
                  return (
                    <tr key={d.DocIdDocumento} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3 tabular-nums text-slate-500 whitespace-nowrap align-top">{fmtFechaCorta(d.fecha)}</td>
                      <td className="px-4 py-3 align-top">
                        <span className={`font-bold ${anulado ? 'text-slate-400' : 'text-slate-800'}`}>{d.documento}</span>
                        {d.factura && (
                          <span className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                            e-Ticket {d.factura}
                            {d.cfeEstado === 'ACEPTADO_DGI' ? (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 uppercase tracking-wide">DGI ✓</span>
                            ) : d.cfeEstado ? (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wide" title="No enviado a DGI">Borrador</span>
                            ) : null}
                          </span>
                        )}
                        {d.descripcion && <span className="block text-[11px] text-slate-400 truncate max-w-[240px]" title={d.descripcion}>{d.descripcion}</span>}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-bold align-top ${anulado ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {monSimbolo} {fmtMoney(d.total)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums align-top">
                        {anulado || Number(d.pagado) <= 0.01 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <>
                            <span className="font-semibold text-emerald-600">{monSimbolo} {fmtMoney(d.pagado)}</span>
                            <span className="block text-[11px] text-slate-400">{d.reciboPago ? `Recibo ${d.reciboPago}` : 'Cobro en caja'}</span>
                          </>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-bold align-top ${pend > 0.01 ? 'text-rose-600' : 'text-slate-300'}`}>
                        {anulado ? '—' : `${monSimbolo} ${fmtMoney(pend)}`}
                      </td>
                      <td className="px-4 py-3 text-center align-top"><EstadoChip estado={d.estado} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Vista PAGOS (centrada en el pago: a qué documento se imputó y cuánto) ── */}
      {vista === 'PAGOS' && (
        pagosVisibles.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-10">Sin pagos en {monSimbolo} para el período.</p>
        ) : (
          <>
            {/* Resumen: imputado vs anticipado */}
            <div className="px-4 py-3 flex flex-wrap gap-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-cyan-200 bg-cyan-50">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-700/70">Imputado a documentos</span>
                <span className="text-sm font-black text-cyan-700 tabular-nums">{monSimbolo} {fmtMoney(totalImputado)}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700/70">Pago anticipado / a favor</span>
                <span className="text-sm font-black text-emerald-700 tabular-nums">{monSimbolo} {fmtMoney(totalAnticipado)}</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                    <th className="text-left font-bold px-4 py-2.5">Fecha</th>
                    <th className="text-left font-bold px-4 py-2.5">Tipo</th>
                    <th className="text-left font-bold px-4 py-2.5">Imputado a</th>
                    <th className="text-right font-bold px-4 py-2.5">Queda del pago</th>
                    <th className="text-right font-bold px-4 py-2.5">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {pagosVisibles.map((p, i) => {
                    const imputado = esImputado(p);
                    const docPago = docs.find(d => d.documento === p.aplicadoA);
                    return (
                      <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-4 py-3 tabular-nums text-slate-500 whitespace-nowrap">{fmtFechaCorta(p.fecha)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${imputado ? 'bg-cyan-50 text-cyan-700 border-cyan-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${imputado ? 'bg-cyan-500' : 'bg-emerald-500'}`} />
                            {p.tipo}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-slate-700">{p.aplicadoA || '—'}</span>
                          {!imputado && <span className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider">anticipo</span>}
                          {docPago?.reciboPago && <span className="block text-[11px] text-slate-400">Recibo {docPago.reciboPago}</span>}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          {(() => {
                            // "Queda del pago" = sobrante del pago tras imputarlo (NO lo que resta de la deuda)
                            const sobrante = !imputado
                              ? Number(p.importe || 0)                                   // anticipo: todo queda a favor (hasta imputar)
                              : Math.max(0, Number(p.importe || 0) - Number(docPago?.total || 0)); // cobro: excedente sobre el doc
                            return sobrante > 0.01 ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 tabular-nums">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {p.MonSimbolo} {fmtMoney(sobrante)} a favor
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold text-slate-400">{p.MonSimbolo} 0,00 · imputado</span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-600">{p.MonSimbolo} {fmtMoney(p.importe)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td colSpan={4} className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Total pagos en {monSimbolo}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-black text-emerald-700">{monSimbolo} {fmtMoney(totalCobrado)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )
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
                    <th className="text-left font-bold px-4 py-2.5">Documento</th>
                    <th className="text-center font-bold px-4 py-2.5">Facturación</th>
                    <th className="text-center font-bold px-4 py-2.5">Moneda</th>
                    <th className="text-right font-bold px-4 py-2.5">Importe</th>
                    <th className="text-center font-bold px-4 py-2.5">Pago</th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
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

                  {/* Barra de filtros unificada: [moneda] · [switch anulados] · [fechas] */}
                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-3">
                    {/* Selector de cuenta / moneda */}
                    <div className="flex bg-white rounded-lg border border-slate-200 p-0.5 gap-0.5">
                      {['UYU', 'USD', 'RECURSOS'].map(t => (
                        <button key={t} type="button" onClick={() => setTabCuentas(t)}
                          className={`px-3 py-1.5 text-[11px] font-black rounded-md transition-colors uppercase tracking-wider ${
                            tabCuentas === t
                              ? (t === 'USD' ? 'bg-emerald-50 text-emerald-600' : t === 'RECURSOS' ? 'bg-violet-50 text-violet-600' : 'bg-cyan-50 text-cyan-700')
                              : 'text-slate-400 hover:text-slate-600'
                          }`}>
                          {t === 'RECURSOS' ? 'Recursos' : t}
                        </button>
                      ))}
                    </div>

                    {/* Mostrar anulados — switch (entre el selector de moneda y las fechas) */}
                    <label title="Incluir documentos anulados"
                      className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer select-none">
                      <span className="relative inline-flex items-center">
                        <input type="checkbox" checked={incluirAnulados}
                          onChange={e => setIncluirAnulados(e.target.checked)} className="peer sr-only" />
                        <span className="w-9 h-5 rounded-full bg-slate-300 peer-checked:bg-cyan-600 transition-colors" />
                        <span className="absolute left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                      </span>
                      Mostrar anulados
                    </label>

                    {/* Saldos del cliente (subidos desde el panel de estado de cuenta) */}
                    {tabCuentas !== 'RECURSOS' && cuentaActiva && resumenSaldos && (
                      <div className="flex items-baseline gap-2.5 flex-wrap">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Saldo pendiente</span>
                        <span className={`text-base font-black tracking-tight ${resumenSaldos.totalPend > 0.01 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {resumenSaldos.monSimbolo} {fmtMoney(resumenSaldos.totalPend)}
                        </span>
                        <span className="text-[11px] text-slate-400">{resumenSaldos.pagados}/{resumenSaldos.total} pagados</span>
                        {resumenSaldos.saldoCuenta > 0.01 && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                            Saldo a favor: {resumenSaldos.monSimbolo} {fmtMoney(resumenSaldos.saldoCuenta)}
                          </span>
                        )}
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
                  <ResumenDocumentosPanel
                    CliIdCliente={clienteSel.CliIdCliente}
                    monSimbolo={cuentaActiva.MonSimbolo || '$'}
                    saldoCuenta={cuentaActiva.CueSaldoActual}
                    desde={globalDesde}
                    hasta={globalHasta}
                    trigger={globalFiltroTrigger}
                    incluirAnulados={incluirAnulados}
                    onResumen={setResumenSaldos}
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
