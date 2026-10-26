/**
 * VendedorCliente360.jsx  —  Ruta: /vendedores/cliente-360
 *
 * Vista 360 del cliente PARA VENDEDORES. SOLO VISUALIZAR: no tiene ningún botón
 * que cobre, facture, anule ni modifique nada. Convive con
 * /contabilidad/cliente-360 (la de contabilidad, que sí opera) sin reemplazarla.
 *
 * Pestañas, una por cosa que el vendedor necesita saber del cliente:
 *   0. Resumen               → servicios más usados, y órdenes y costo final por área (22/10/2026)
 *   1. Recursos              → planes de metros comprados (comprado / usado / restante)
 *   2. Telas del cliente     → metros de tela física del cliente en el depósito
 *   3. Pendiente de pago     → documentos con saldo (deudas vivas)
 *   4. Pendiente de retirar  → órdenes que siguen en el depósito
 *   5. Tarifas aplicadas     → perfiles de precios asignados y sus escalones
 *   6. Precios especiales    → reglas de precio propias del cliente
 *
 * Reutiliza endpoints existentes; lo único nuevo es
 * GET /api/vendedor-360/clientes/:id/deposito-pendiente y .../resumen (solo lectura).
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search, RefreshCw, Users, Eye, Layers, Package,
  Truck, Tag, ChevronDown, ChevronRight, CheckCircle2, Clock,
  History, X, BadgePercent, LayoutDashboard, IdCard, Mail, Phone, Folder, Globe,
} from 'lucide-react';
import { toast } from 'sonner';

import api from '../../services/api';
import { fetchAPI } from './cuentasComunes';
import Selector from '../ui/Selector';
import { fmtFechaCorta } from '../../utils/fechas';
import TabBeneficiosCliente from '../beneficios/TabBeneficiosCliente';

const fmtNum = (n, dec = 2) => new Intl.NumberFormat('es-UY', {
  minimumFractionDigits: dec, maximumFractionDigits: dec,
}).format(Number(n) || 0);

// Cartera elegida (VendedorID). Se guarda en el navegador para que cada
// vendedor entre siempre con sus clientes sin volver a elegirlos.
const LS_VENDEDOR = 'vendedor360_cartera';

/* ── Definición de pestañas ───────────────────────────────────────────── */
const TABS = [
  { key: 'RESUMEN',    label: 'Resumen',             icon: LayoutDashboard },
  { key: 'RECURSOS',   label: 'Recursos',            icon: Layers },
  { key: 'TELAS',      label: 'Telas del cliente',   icon: Package },
  { key: 'DEPOSITO',   label: 'Pendiente de retirar', icon: Truck },
  { key: 'ESPECIALES', label: 'Precios especiales',  icon: Tag },
  // Beneficios pactados (specs/40): única pestaña que PROPONE (pactar) en una vista
  // de consulta; no cambia precios: el pacto va a aprobación y se habilita al cargar.
  { key: 'BENEFICIOS', label: 'Beneficios',          icon: BadgePercent },
];

/* ── Piezas chicas de UI ──────────────────────────────────────────────── */
const ChipCliente = ({ tono, children }) => (
  <span className={`inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-bold ${tono}`}>{children}</span>
);

const FilaClienteVendedor = ({ c, seleccionado, onClick }) => (
  <button type="button" onClick={onClick}
    className={`w-full text-left px-4 py-3 border-b border-zinc-100 last:border-b-0 border-l-[3px] transition-colors flex items-center gap-3 ${seleccionado ? 'bg-brand-cyan/5 border-l-brand-cyan' : 'border-l-transparent hover:bg-zinc-50'}`}>
    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${seleccionado ? 'bg-brand-cyan text-white' : 'bg-zinc-100 text-zinc-500'}`}>
      {(c.Nombre || '?').trim().charAt(0).toUpperCase()}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-bold text-zinc-800 truncate" title={c.Nombre}>{c.Nombre}</span>
      <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
        <span className="text-[10px] font-mono text-zinc-400">#{c.IDCliente || c.CodCliente || c.CliIdCliente}</span>
        {c.EsSemanal == 1 && <ChipCliente tono="bg-brand-cyan/10 text-brand-cyan">Semanal</ChipCliente>}
        {c.TieneCicloAbierto == 1 && <ChipCliente tono="bg-emerald-50 text-emerald-700">Ciclo</ChipCliente>}
        {c.DocsVencidos > 0 && <ChipCliente tono="bg-brand-magenta/10 text-brand-magenta">{c.DocsVencidos} venc.</ChipCliente>}
      </span>
    </span>
  </button>
);

const etiquetaCampo = 'block mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-400';
const Cargando = () => (
  <div className="flex justify-center py-12">
    <div className="animate-spin h-7 w-7 border-2 border-brand-cyan border-t-transparent rounded-full" />
  </div>
);

const Vacio = ({ children }) => (
  <p className="text-center text-zinc-400 text-sm py-12">{children}</p>
);

// OJO: las clases van completas (text-left / text-right / text-center) porque
// Tailwind no genera clases armadas con template strings.
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' };
const Th = ({ children, align = 'left' }) => (
  <th className={`${ALIGN[align]} font-bold px-4 py-2.5 whitespace-nowrap`}>{children}</th>
);

const Tabla = ({ head, children }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-200">{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

// Barra de progreso de consumo (recursos y telas usan la misma lectura visual)
const BarraConsumo = ({ pct }) => {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = p >= 90 ? 'bg-rose-500' : p >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="w-full min-w-[90px] h-1.5 bg-zinc-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${p}%` }} />
    </div>
  );
};

// Totales por moneda (pesos y dólares nunca se suman entre sí)
const TotalesPorMoneda = ({ totales, etiqueta }) => (
  <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-200 flex flex-wrap items-center gap-x-6 gap-y-2">
    {totales.map(t => (
      <div key={t.moneda} className="flex items-baseline gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{etiqueta} {t.moneda}</span>
        <span className="text-base font-black tracking-tight text-zinc-800">{t.moneda} {fmtNum(t.total)}</span>
        <span className="text-[11px] text-zinc-400">{t.cant} ítem{t.cant !== 1 ? 's' : ''}</span>
      </div>
    ))}
  </div>
);

/* ══════════════════════════════════════════════════════════════════════
   MODAL — Estado de cuenta de un recurso / rollo (cómo se fue consumiendo)
   Misma lectura que el libro del plan en /contabilidad/cuentas (PlanesPanel):
   los movimientos se agrupan por MATERIAL (todos los planes del mismo
   artículo comparten estado de cuenta) para que los saldos den igual que allá.
   Acá es SOLO LECTURA: no están los botones de editar / revertir / eliminar.
   ══════════════════════════════════════════════════════════════════════ */
function ModalConsumoPlan({ plan, planes, onClose }) {
  const [movs, setMovs]       = useState([]);
  const [loading, setLoading] = useState(true);
  // arrastre = saldo de los movimientos que el TOP dejó afuera (lo calcula el
  // backend). Sin esto el saldo corrido arrancaba en 0 y todas las columnas
  // "Saldo Ini./Saldo Fn." quedaban desplazadas cuando la cuenta era larga.
  const [arrastre, setArrastre]   = useState(0);
  const [recorte, setRecorte]     = useState(null); // { mostrados, total }

  const unidad = plan.UniSimbolo || plan.PlaUnidad || plan.UnidadLabel || '';

  // Planes que comparten cuenta y material con el que se abrió (mismo estado de cuenta)
  const planesDelMat = useMemo(() => {
    const deCuenta = planes.filter(p => !p.CueIdCuenta || String(p.CueIdCuenta) === String(plan.CueIdCuenta));
    return deCuenta.filter(p => (
      plan.ProIdProducto != null
        ? String(p.ProIdProducto) === String(plan.ProIdProducto)
        : p.PlaIdPlan === plan.PlaIdPlan
    ));
  }, [planes, plan]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAPI(`/api/contabilidad/cuentas/${plan.CueIdCuenta}/movimientos?top=500`)
      .then(r => {
        if (!alive) return;
        setMovs(r.data || []);
        setArrastre(Number(r.saldoArrastre || 0));
        setRecorte(r.recortado ? { mostrados: (r.data || []).length, total: r.totalMovimientos } : null);
      })
      .catch(e => { if (alive) { toast.error(e.message); setMovs([]); setArrastre(0); setRecorte(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [plan.CueIdCuenta]);

  // Qué movimientos son de estos planes — mismo criterio que PlanesPanel:
  // el concepto/observación dice "Plan #N"; si no lo dice, entra si el plan
  // está activo o si es el único plan de la cuenta.
  const movsConSaldo = useMemo(() => {
    const idsDelMat = new Set(planesDelMat.map(p => p.PlaIdPlan));
    const soloUno = planes.filter(p => !p.CueIdCuenta || String(p.CueIdCuenta) === String(plan.CueIdCuenta)).length === 1;

    const propios = movs.filter(m => {
      const match = m.MovConcepto?.match(/Plan\s*#?\s*(\d+)/i) || m.MovObservaciones?.match(/Plan\s*#?\s*(\d+)/i);
      if (match) return idsDelMat.has(parseInt(match[1]));
      return planesDelMat.some(p => p.PlaActivo) || soloUno;
    });

    // Saldo corrido: se acumula del más viejo al más nuevo, arrancando del
    // arrastre. Si el filtro por plan dejó movimientos afuera no se puede
    // arrancar del arrastre (daría un saldo que no es ni el del plan ni el de
    // la cuenta): en ese caso arranca en 0 y es el saldo DE ESTOS movimientos.
    const ordenados = [...propios].sort((a, b) => new Date(a.MovFecha) - new Date(b.MovFecha));
    let saldo = propios.length === movs.length ? arrastre : 0;
    return ordenados.map(m => {
      const importe  = Number(m.MovImporte);
      const saldoIn  = saldo;
      saldo = Math.round((saldo + importe) * 10000) / 10000;
      const match = m.MovConcepto?.match(/[A-Z]{2,5}-\d+/i);
      // La columna "Documento" salía de leer el código adentro del concepto, y las
      // ENTREGA de cobertura retroactiva se guardan como "CR- <nombre del trabajo>",
      // sin el código: quedaban en "—" aunque el movimiento SÍ tiene la orden colgada
      // (OrdIdOrden). El backend ya resuelve ese código en CodigoOrdenStr, así que se
      // usa primero y el regex del concepto queda de respaldo.
      // Se le exige forma de orden (LETRAS-NÚMERO) porque CodigoOrdenStr cae a
      // MovRefExterna, que en las ENTRADA es el id suelto de la transacción de caja
      // (ej. "9194") y no una orden.
      const codBD = String(m.CodigoOrdenStr || m.OrdCodigoOrden || '').trim();
      const cod   = /^[A-Z]{2,5}-\d+/i.test(codBD)
        ? codBD.toUpperCase()
        : (match ? match[0].toUpperCase() : '');
      let desc    = m.MovConcepto || '—';
      if (match) desc = desc.replace(match[0], '').replace(/^[\s:\-.]+|[\s:\-.]+$/g, '').trim();
      if (m.MovTipo === 'RECARGO_URGENCIA' && m.MovObservaciones) desc = m.MovObservaciones;
      return {
        ...m,
        _saldoIn: saldoIn,
        _saldoFn: saldo,
        _debe:  importe < 0 ? Math.abs(importe) : 0,
        _haber: importe > 0 ? importe : 0,
        _cod:   cod,
        _desc:  desc,
        _tipo:  m.MovTipo === 'RECARGO_URGENCIA' ? 'RECARGO_URGENCIA' : (importe >= 0 ? 'ENTRADA' : 'ENTREGA'),
      };
    });
  }, [movs, planesDelMat, planes, plan, arrastre]);

  // Saldo REAL de la cuenta del material: arrastre + TODOS los movimientos, sin
  // filtrar por plan. Es lo que el cliente tiene de verdad y lo que muestra el
  // chip de recursos; el "restante del plan" puede diferir cuando se consumieron
  // metros de más contra planes anteriores.
  const saldoCuenta = useMemo(() => (
    Math.round((movs.reduce((acc, m) => acc + Number(m.MovImporte || 0), 0) + arrastre) * 10000) / 10000
  ), [movs, arrastre]);

  const restantePlan = Number(plan.PlaCantidadRestante ?? (plan.PlaCantidadTotal - plan.PlaCantidadUsada));
  const difPlanCuenta = Math.round((restantePlan - saldoCuenta) * 10000) / 10000;
  const hayDesfasaje = !loading && movs.length > 0 && Math.abs(difPlanCuenta) > 0.01;

  return (
    <div className="fixed inset-0 z-[6000] bg-zinc-900/60 flex items-start justify-center px-2 sm:px-4 pt-10 pb-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[97vw] max-w-5xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-zinc-200 text-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Layers size={18} className="text-brand-cyan shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-black leading-tight truncate">
                Consumo del recurso · {plan.NombreArticulo || plan.PlaDescripcion || `Plan #${plan.PlaIdPlan}`}
              </h3>
              <p className="text-[11px] text-zinc-500">
                {plan.PlaDescripcion || `Plan #${plan.PlaIdPlan}`}
                {planesDelMat.length > 1 && ` · incluye ${planesDelMat.length} planes del mismo material`}
              </p>
            </div>
          </div>
          <button onClick={onClose} title="Cerrar el estado de cuenta del recurso"
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Resumen del plan */}
        <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Comprado</span>
            <span className="text-sm font-black text-zinc-700">{fmtNum(plan.PlaCantidadTotal)} {unidad}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Usado</span>
            <span className="text-sm font-black text-rose-600">{fmtNum(plan.PlaCantidadUsada)} {unidad}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Restante del plan</span>
            <span className="text-sm font-black text-emerald-600">{fmtNum(plan.PlaCantidadRestante)} {unidad}</span>
          </div>
          <div className="flex items-baseline gap-2 ml-auto">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Saldo real de la cuenta</span>
            <span className={`text-sm font-black ${saldoCuenta < 0 ? 'text-rose-600' : 'text-brand-cyan'}`}>{fmtNum(saldoCuenta)} {unidad}</span>
            <span className="text-[11px] text-zinc-400">{movsConSaldo.length} mov.</span>
          </div>
        </div>

        {/* El plan y la cuenta pueden no coincidir: cuando una orden consumió más
            metros de los que le quedaban al plan, el movimiento entró completo en
            la cuenta pero el plan se cerró en "restante 0". Vale la cuenta. */}
        {hayDesfasaje && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 shrink-0">
            <strong>El plan y la cuenta no coinciden.</strong> La barra del plan muestra{' '}
            <strong>{fmtNum(restantePlan)} {unidad}</strong> pero en la cuenta hay{' '}
            <strong>{fmtNum(saldoCuenta)} {unidad}</strong>.{' '}
            {difPlanCuenta > 0
              ? <>Son <strong>{fmtNum(difPlanCuenta)} {unidad}</strong> que ya se consumieron contra planes anteriores y el plan nunca reflejó.</>
              : <>Hay <strong>{fmtNum(Math.abs(difPlanCuenta))} {unidad}</strong> comprados que ningún plan activo está mostrando.</>}
            {' '}Para lo que el cliente puede usar, vale el saldo de la cuenta.
          </div>
        )}

        {recorte && (
          <div className="px-5 py-2 bg-zinc-50 border-b border-zinc-200 text-[11px] text-zinc-600 shrink-0">
            Se muestran los <strong>{recorte.mostrados}</strong> movimientos más recientes de{' '}
            <strong>{recorte.total}</strong>. Los saldos ya incluyen el arrastre de los anteriores.
          </div>
        )}

        {/* Movimientos */}
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? <Cargando /> : movsConSaldo.length === 0 ? (
            <Vacio>Este recurso todavía no tiene movimientos.</Vacio>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="text-[10px] text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-200">
                  <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                  <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                  <th className="px-3 py-2 text-left font-semibold">Documento</th>
                  <th className="px-3 py-2 text-left font-semibold">Concepto</th>
                  <th className="px-3 py-2 text-right font-semibold">Saldo Ini.</th>
                  <th className="px-3 py-2 text-right font-semibold">Debe</th>
                  <th className="px-3 py-2 text-right font-semibold">Haber</th>
                  <th className="px-3 py-2 text-right font-semibold">Saldo Fn.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {/* Más reciente arriba (el saldo ya viene calculado en orden cronológico) */}
                {[...movsConSaldo].reverse().map(m => (
                  <tr key={m.MovIdMovimiento} className="hover:bg-zinc-50/60 transition-colors">
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{fmtFechaCorta(m.MovFecha)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        m._tipo === 'RECARGO_URGENCIA' ? 'bg-rose-50 text-rose-700'
                          : m._tipo === 'ENTRADA' ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-brand-cyan/10 text-brand-cyan'
                      }`}>
                        {m._tipo === 'RECARGO_URGENCIA' ? 'RECARGO URGENCIA' : m._tipo}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-bold text-zinc-700 whitespace-nowrap">{m._cod || '—'}</td>
                    <td className="px-3 py-2 text-zinc-600 max-w-[240px] truncate" title={m.MovConcepto}>{m._desc || '—'}</td>
                    <td className="px-3 py-2 text-right text-zinc-500 whitespace-nowrap">{fmtNum(m._saldoIn)} {unidad}</td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${m._debe > 0 ? 'text-rose-600' : 'text-zinc-300'}`}>
                      {m._debe > 0 ? `${fmtNum(m._debe)} ${unidad}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${m._haber > 0 ? 'text-emerald-600' : 'text-zinc-300'}`}>
                      {m._haber > 0 ? `${fmtNum(m._haber)} ${unidad}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${m._saldoFn < 0 ? 'text-rose-600' : 'text-brand-cyan'}`}>
                      {fmtNum(m._saldoFn)} {unidad}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-zinc-400">Vista de consulta: acá no se puede editar ni revertir ningún consumo.</span>
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-lg transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PESTAÑA 1 — RECURSOS (planes de metros del cliente)
   ══════════════════════════════════════════════════════════════════════ */
function TabRecursos({ CliIdCliente }) {
  const [planes, setPlanes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [planConsumo, setPlanConsumo] = useState(null); // plan abierto en el modal de consumo

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAPI(`/api/contabilidad/planes/${CliIdCliente}`)
      .then(r => { if (alive) setPlanes(r.data || []); })
      .catch(e => { if (alive) { toast.error(e.message); setPlanes([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [CliIdCliente]);

  if (loading) return <Cargando />;
  if (!planes.length) return <Vacio>Este cliente no tiene recursos (planes de metros) cargados.</Vacio>;

  const activos = planes.filter(p => p.PlaActivo);
  const restanteActivo = activos.reduce((s, p) => s + Number(p.PlaCantidadRestante || 0), 0);

  return (
    <>
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Disponible en planes activos</span>
          <span className="text-base font-black tracking-tight text-emerald-600">{fmtNum(restanteActivo)}</span>
        </div>
        <span className="text-[11px] text-zinc-400">{activos.length} activo{activos.length !== 1 ? 's' : ''} de {planes.length}</span>
      </div>

      <Tabla head={<>
        <Th>Plan</Th><Th>Artículo</Th><Th align="right">Comprado</Th><Th align="right">Usado</Th>
        <Th align="right">Restante</Th><Th>Consumo</Th><Th>Vence</Th><Th align="center">Estado</Th>
        <Th align="center">Detalle</Th>
      </>}>
        {planes.map(p => (
          <tr key={p.PlaIdPlan} className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60 ${p.PlaActivo ? '' : 'opacity-50'}`}>
            <td className="px-4 py-3 align-top">
              <span className="font-bold text-zinc-800">{p.PlaDescripcion || `Plan #${p.PlaIdPlan}`}</span>
              <span className="block text-[11px] text-zinc-400">Alta {fmtFechaCorta(p.PlaFechaAlta)}</span>
            </td>
            <td className="px-4 py-3 align-top text-zinc-600 text-xs">{p.NombreArticulo || '—'}</td>
            <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-700 align-top whitespace-nowrap">
              {fmtNum(p.PlaCantidadTotal)} {p.UniSimbolo || ''}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-zinc-500 align-top whitespace-nowrap">{fmtNum(p.PlaCantidadUsada)}</td>
            <td className={`px-4 py-3 text-right tabular-nums font-black align-top whitespace-nowrap ${Number(p.PlaCantidadRestante) > 0.01 ? 'text-emerald-600' : 'text-zinc-400'}`}>
              {fmtNum(p.PlaCantidadRestante)}
            </td>
            <td className="px-4 py-3 align-top">
              <BarraConsumo pct={p.PorcentajeUsado} />
              <span className="block text-[10px] text-zinc-400 mt-1">{fmtNum(p.PorcentajeUsado, 1)}% usado</span>
            </td>
            <td className="px-4 py-3 align-top text-xs text-zinc-500 whitespace-nowrap">
              {p.PlaFechaVencimiento ? (
                <>
                  {fmtFechaCorta(p.PlaFechaVencimiento)}
                  {p.DiasParaVencer != null && (
                    <span className={`block text-[10px] font-bold ${p.DiasParaVencer < 0 ? 'text-rose-600' : p.DiasParaVencer <= 15 ? 'text-amber-600' : 'text-zinc-400'}`}>
                      {p.DiasParaVencer < 0 ? `Vencido hace ${Math.abs(p.DiasParaVencer)} d` : `Faltan ${p.DiasParaVencer} d`}
                    </span>
                  )}
                </>
              ) : <span className="text-zinc-300">Sin vencimiento</span>}
            </td>
            <td className="px-4 py-3 text-center align-top">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${p.PlaActivo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-400 border-zinc-200'}`}>
                {p.PlaActivo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td className="px-4 py-3 text-center align-top">
              <button onClick={() => setPlanConsumo(p)}
                title="Ver el estado de cuenta de este recurso: orden por orden, cómo se fueron consumiendo los metros"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-brand-cyan bg-white hover:bg-brand-cyan/5 border border-zinc-200 hover:border-brand-cyan/40 transition-colors whitespace-nowrap">
                <History size={12} /> Ver consumo
              </button>
            </td>
          </tr>
        ))}
      </Tabla>

      {planConsumo && (
        <ModalConsumoPlan plan={planConsumo} planes={planes} onClose={() => setPlanConsumo(null)} />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   MODAL — Estado de cuenta de una tela del cliente (bobina por bobina)
   Mismos datos que /atencion-cliente → Estado de Cuenta de Tela, filtrados
   al tipo de tela que se tocó. SOLO LECTURA.
   ══════════════════════════════════════════════════════════════════════ */
const TIPO_MOV_TELA = {
  INGRESO:                { label: 'Ingreso',        color: 'text-emerald-700 bg-emerald-50 border-emerald-200', sign: '+' },
  CONSUMO_ORDEN:          { label: 'Consumo orden',  color: 'text-rose-700 bg-rose-50 border-rose-200',          sign: '-' },
  CONSUMO_PRODUCCION:     { label: 'Consumo',        color: 'text-rose-700 bg-rose-50 border-rose-200',          sign: '-' },
  AJUSTE_DESECHO:         { label: 'Merma',          color: 'text-amber-700 bg-amber-50 border-amber-200',       sign: '±' },
  AJUSTE_MANUAL:          { label: 'Ajuste manual',  color: 'text-amber-700 bg-amber-50 border-amber-200',       sign: '±' },
  AJUSTE_ANCHO:           { label: 'Ajuste ancho',   color: 'text-amber-700 bg-amber-50 border-amber-200',       sign: '±' },
  CONFIRMACION_MEDIDA:    { label: 'Confirm. medida', color: 'text-sky-700 bg-sky-50 border-sky-200',            sign: '✓' },
  DEVOLUCION_CANCELACION: { label: 'Devolución',     color: 'text-teal-700 bg-teal-50 border-teal-200',          sign: '+' },
  RESERVA_ORDEN:          { label: 'Reserva',        color: 'text-brand-cyan bg-brand-cyan/10 border-brand-cyan/20',    sign: '→' },
  LIBERACION_RESERVA:     { label: 'Lib. reserva',   color: 'text-teal-700 bg-teal-50 border-teal-200',          sign: '←' },
  MERMA_REIMPRESION:      { label: 'Merma reimp.',   color: 'text-orange-700 bg-orange-50 border-orange-200',    sign: '-' },
};
const getTipoTela = (t) => TIPO_MOV_TELA[t] || { label: t || '—', color: 'text-zinc-500 bg-zinc-50 border-zinc-200', sign: '' };

// (Existía una lista NO_CONSUMO para excluir tipos de movimiento del consumo. Se eliminó:
// clasificar por tipo era el origen del error — el consumo ahora se deriva del saldo.)

function ModalConsumoTela({ CliIdCliente, tela, onClose }) {
  const [movs, setMovs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [abierta, setAbierta] = useState(null); // BobinaID desplegada

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams();
    if (tela.InsumoID) p.append('insumoId', tela.InsumoID);
    api.get(`/tela-cliente/${encodeURIComponent(CliIdCliente)}/estado-cuenta?${p}`)
      .then(r => { if (alive) setMovs(r.data?.data || []); })
      .catch(e => { if (alive) { toast.error(e.message); setMovs([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [CliIdCliente, tela.InsumoID]);

  // El endpoint filtra por insumo; acá afinamos al tipo de tela exacto de la fila
  // (un mismo insumo genérico puede tener varias descripciones de tela).
  const bobinas = useMemo(() => {
    const propios = movs.filter(m => !tela.TipoTela || m.TipoTela === tela.TipoTela);
    const map = new Map();
    propios.forEach(m => {
      if (!map.has(m.BobinaID)) {
        map.set(m.BobinaID, {
          bobinaId: m.BobinaID, bulto: m.Bulto, estado: m.EstadoBulto,
          saldo: Number(m.SaldoBulto || 0), metrosIniciales: Number(m.MetrosIniciales || 0),
          ancho: m.Ancho, peso: m.Peso,
          referencia: m.ReferenciaOrden || m.CodigoRecepcion || '',
          fechaIngreso: null, movimientos: [],
        });
      }
      const b = map.get(m.BobinaID);
      b.movimientos.push(m);
      if (m.TipoMovimiento === 'INGRESO' && !b.fechaIngreso) b.fechaIngreso = m.FechaMovimiento;
    });
    return [...map.values()].map(b => ({
      ...b,
      ingresado: b.movimientos.filter(m => m.TipoMovimiento === 'INGRESO')
        .reduce((s, m) => s + Math.abs(Number(m.Cantidad || 0)), 0),
      // Consumo NETO = ingresado − saldo. Sumar solo los movimientos negativos daba números
      // imposibles (BOB-73: −14 m de una bobina de 10): contaba devoluciones al cliente y
      // ajustes de saneo como consumo, e ignoraba los créditos (devolución por cancelación),
      // así que los mismos metros se descontaban dos veces.
      // Un bulto AGOTADO se cuenta entero: su remanente es merma no usable y no figura como
      // disponible (misma regla que MetrosConsumidos en telaClienteController).
      consumido: (() => {
        const ing = b.movimientos.filter(m => m.TipoMovimiento === 'INGRESO')
          .reduce((s, m) => s + Math.abs(Number(m.Cantidad || 0)), 0);
        if (String(b.estado || '').toLowerCase() === 'agotado') return ing;
        return Math.max(0, ing - Number(b.saldo || 0));
      })(),
    }));
  }, [movs, tela.TipoTela]);

  return (
    <div className="fixed inset-0 z-[6000] bg-zinc-900/60 flex items-start justify-center px-2 sm:px-4 pt-10 pb-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[97vw] max-w-5xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-zinc-200 text-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Package size={18} className="text-brand-cyan shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-black leading-tight truncate">Consumo de tela · {tela.TipoTela || tela.InsumoNombre}</h3>
              <p className="text-[11px] text-zinc-500">
                {bobinas.length} bulto{bobinas.length !== 1 ? 's' : ''} · tocá uno para ver sus movimientos
              </p>
            </div>
          </div>
          <button onClick={onClose} title="Cerrar el estado de cuenta de la tela"
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Ingresados</span>
            <span className="text-sm font-black text-zinc-700">{fmtNum(tela.MetrosIngresados)} m</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Consumidos</span>
            <span className="text-sm font-black text-rose-600">{fmtNum(tela.MetrosConsumidos)} m</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Disponibles</span>
            <span className="text-sm font-black text-brand-cyan">{fmtNum(tela.MetrosDisponibles)} m</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-2 bg-zinc-50">
          {loading ? <Cargando /> : bobinas.length === 0 ? (
            <Vacio>No hay movimientos registrados para esta tela.</Vacio>
          ) : bobinas.map(b => {
            const open = abierta === b.bobinaId;
            return (
              <div key={b.bobinaId} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
                <button type="button" onClick={() => setAbierta(open ? null : b.bobinaId)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors text-left">
                  {open ? <ChevronDown size={15} className="text-zinc-400 shrink-0" /> : <ChevronRight size={15} className="text-zinc-400 shrink-0" />}
                  <Package size={14} className="text-brand-cyan shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-zinc-800 text-sm">{b.referencia || b.bulto}</span>
                    <span className="block text-[10px] text-zinc-400 font-mono">
                      {b.bulto} · Ingreso {fmtFechaCorta(b.fechaIngreso)}
                      {b.metrosIniciales ? ` · L:${fmtNum(b.metrosIniciales)}m` : ''}
                      {b.ancho ? ` · A:${fmtNum(b.ancho)}m` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-center hidden sm:block">
                      <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Ingreso</p>
                      <p className="text-sm font-black tabular-nums text-emerald-600">+{fmtNum(b.ingresado)}</p>
                    </div>
                    <div className="text-center hidden sm:block">
                      <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Consumo</p>
                      <p className="text-sm font-black tabular-nums text-rose-500">{b.consumido > 0 ? '-' : ''}{fmtNum(b.consumido)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Saldo</p>
                      <p className={`text-sm font-black tabular-nums ${b.saldo > 0 ? 'text-brand-cyan' : 'text-zinc-400'}`}>{fmtNum(b.saldo)}</p>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-bold hidden md:block">{b.movimientos.length} mov.</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black border bg-zinc-50 text-zinc-500 border-zinc-200 uppercase">
                      {b.estado || '—'}
                    </span>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-zinc-100 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                          <th className="px-4 py-2 text-left">Fecha</th>
                          <th className="px-4 py-2 text-left">Tipo</th>
                          <th className="px-4 py-2 text-right">Cantidad</th>
                          <th className="px-4 py-2 text-right">Saldo acum.</th>
                          <th className="px-4 py-2 text-left">Referencia</th>
                          <th className="px-4 py-2 text-left">Operario</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.movimientos.map((m, i) => {
                          const cfg = getTipoTela(m.TipoMovimiento);
                          return (
                            <tr key={m.MovimientoID || i} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60">
                              <td className="px-4 py-2.5 tabular-nums text-[10px] text-zinc-500 whitespace-nowrap">{fmtFechaCorta(m.FechaMovimiento)}</td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${cfg.color}`}>
                                  {cfg.label}
                                </span>
                              </td>
                              <td className={`px-4 py-2.5 font-black tabular-nums text-right whitespace-nowrap ${m.TipoMovimiento === 'INGRESO' ? 'text-emerald-600' : Number(m.Cantidad) < 0 ? 'text-rose-600' : 'text-zinc-600'}`}>
                                {cfg.sign} {fmtNum(Math.abs(m.Cantidad))} m
                              </td>
                              <td className="px-4 py-2.5 font-black tabular-nums text-right text-brand-cyan whitespace-nowrap">{fmtNum(m.SaldoAcumulado || 0)} m</td>
                              <td className="px-4 py-2.5 text-[10px] text-zinc-400 max-w-[200px] truncate" title={m.Referencia || ''}>
                                {m.Referencia || m.CodigoRecepcion || '—'}
                              </td>
                              <td className="px-4 py-2.5 text-[10px] text-zinc-400">{m.Operario || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-zinc-400">Vista de consulta: acá no se puede ajustar ni cerrar ninguna bobina.</span>
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-lg transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PESTAÑA 2 — TELAS DEL CLIENTE (metros físicos en depósito)
   ══════════════════════════════════════════════════════════════════════ */
function TabTelas({ CliIdCliente }) {
  const [saldos, setSaldos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [telaConsumo, setTelaConsumo] = useState(null); // tela abierta en el modal

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/tela-cliente/${encodeURIComponent(CliIdCliente)}/saldo`)
      .then(r => { if (alive) setSaldos(r.data?.data || []); })
      .catch(e => { if (alive) { toast.error(e.message); setSaldos([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [CliIdCliente]);

  if (loading) return <Cargando />;
  if (!saldos.length) return <Vacio>Este cliente no tiene telas propias en el depósito.</Vacio>;

  const totalDisp = saldos.reduce((s, t) => s + Number(t.MetrosDisponibles || 0), 0);
  const totalBultos = saldos.reduce((s, t) => s + Number(t.CantidadBultos || 0), 0);

  return (
    <>
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Metros disponibles</span>
          <span className="text-base font-black tracking-tight text-brand-cyan">{fmtNum(totalDisp)} m</span>
        </div>
        <span className="text-[11px] text-zinc-400">{totalBultos} bulto{totalBultos !== 1 ? 's' : ''} · {saldos.length} tipo{saldos.length !== 1 ? 's' : ''} de tela</span>
      </div>

      <Tabla head={<>
        <Th>Tipo de tela</Th><Th align="center">Bultos</Th><Th align="right">Ingresados</Th>
        <Th align="right">Consumidos</Th><Th align="right">Disponibles</Th>
        <Th align="right">Libres</Th><Th align="right">En proceso</Th><Th>Consumo</Th><Th>Último ingreso</Th>
        <Th align="center">Detalle</Th>
      </>}>
        {saldos.map((t, i) => (
          <tr key={`${t.InsumoID}_${i}`} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
            <td className="px-4 py-3 align-top">
              <span className="font-bold text-zinc-800">{t.TipoTela || t.InsumoNombre}</span>
              {t.TipoTela && t.InsumoNombre && t.TipoTela !== t.InsumoNombre && (
                <span className="block text-[11px] text-zinc-400">{t.InsumoNombre}</span>
              )}
            </td>
            <td className="px-4 py-3 text-center tabular-nums text-zinc-600 align-top">{t.CantidadBultos}</td>
            <td className="px-4 py-3 text-right tabular-nums text-zinc-600 align-top">{fmtNum(t.MetrosIngresados)}</td>
            <td className="px-4 py-3 text-right tabular-nums text-zinc-500 align-top">{fmtNum(t.MetrosConsumidos)}</td>
            <td className="px-4 py-3 text-right tabular-nums font-black text-brand-cyan align-top">{fmtNum(t.MetrosDisponibles)}</td>
            <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-semibold align-top">{fmtNum(t.MetrosLibres)}</td>
            <td className="px-4 py-3 text-right tabular-nums text-amber-600 font-semibold align-top">{fmtNum(t.MetrosEnProceso)}</td>
            <td className="px-4 py-3 align-top">
              <BarraConsumo pct={t.PorcentajeConsumido} />
              <span className="block text-[10px] text-zinc-400 mt-1">{fmtNum(t.PorcentajeConsumido, 1)}% consumido</span>
            </td>
            <td className="px-4 py-3 align-top text-xs text-zinc-500 whitespace-nowrap">{fmtFechaCorta(t.UltimoIngreso)}</td>
            <td className="px-4 py-3 text-center align-top">
              <button onClick={() => setTelaConsumo(t)}
                title="Ver el estado de cuenta de esta tela: bulto por bulto, cómo se fueron consumiendo los metros"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-brand-cyan bg-white hover:bg-brand-cyan/5 border border-zinc-200 hover:border-brand-cyan/40 transition-colors whitespace-nowrap">
                <History size={12} /> Ver consumo
              </button>
            </td>
          </tr>
        ))}
      </Tabla>

      {telaConsumo && (
        <ModalConsumoTela CliIdCliente={CliIdCliente} tela={telaConsumo} onClose={() => setTelaConsumo(null)} />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PESTAÑA 0 — RESUMEN (22/10/2026)
   Servicios más usados, y por área: cuántas órdenes y su costo final. Solo las áreas con órdenes, sin
   las canceladas. Sale de GET /api/vendedor-360/clientes/:id/resumen (OrdenesDeposito). Los importes
   van por moneda, sin convertir.
   ══════════════════════════════════════════════════════════════════════ */
const PERIODOS_RESUMEN = [['1m', 'Último mes'], ['3m', 'Últimos 3 meses'], ['12m', 'Últimos 12 meses'], ['todo', 'Todo']];
const costosTexto = (costos = []) => costos.map(c => `${c.moneda} ${fmtNum(c.total)}`).join(' · ') || '—';

function TabResumen({ CliIdCliente }) {
  const [periodo, setPeriodo] = useState('12m');
  const [datos, setDatos]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAPI(`/api/vendedor-360/clientes/${CliIdCliente}/resumen?periodo=${periodo}`)
      .then(r => { if (alive) setDatos(r.data || null); })
      .catch(e => { if (alive) { toast.error(e.message); setDatos(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [CliIdCliente, periodo]);

  const maxOrdenes = Math.max(1, ...((datos?.areas || []).map(a => a.ordenes)));

  return (
    <>
      <div className="px-4 py-3 border-b border-zinc-100 flex flex-wrap items-center gap-2">
        <div className="sm:hidden w-full">
          <Selector value={periodo} onChange={e => setPeriodo(e.target.value)} aria-label="Período">
            {PERIODOS_RESUMEN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Selector>
        </div>
        <div className="hidden sm:inline-flex rounded-full border border-zinc-200 p-0.5">
          {PERIODOS_RESUMEN.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriodo(k)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${periodo === k ? 'bg-brand-cyan text-white' : 'text-zinc-500 hover:text-zinc-700'}`}>
              {l}
            </button>
          ))}
        </div>
        {datos?.totalOrdenes > 0 && (
          <span className="ml-auto text-[11px] font-semibold text-zinc-400">
            {datos.totalOrdenes} orden{datos.totalOrdenes !== 1 ? 'es' : ''} · {costosTexto(datos.totales)}
          </span>
        )}
      </div>

      {loading ? <Cargando /> : !datos?.totalOrdenes ? (
        <Vacio>Este cliente no tiene órdenes en este período.</Vacio>
      ) : (
        <div className="p-4 space-y-6">
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Servicios más usados</h3>
            <div className="rounded-xl border border-zinc-200 overflow-hidden">
              <Tabla head={<>
                <Th>Servicio</Th><Th align="center">Área</Th><Th align="right">Órdenes</Th><Th align="right">Cantidad</Th><Th align="right">Costo final</Th>
              </>}>
                {datos.servicios.map((sv, i) => (
                  <tr key={`${sv.servicio}-${i}`} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                    <td className="px-4 py-2.5 font-bold text-zinc-800">{sv.servicio}</td>
                    <td className="px-4 py-2.5 text-center">
                      {sv.area ? <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-[10px] font-black text-zinc-600">{sv.area}</span> : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-zinc-700">{sv.ordenes}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600 whitespace-nowrap">{fmtNum(sv.cantidad)}{sv.unidad ? ` ${sv.unidad}` : ''}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 whitespace-nowrap">{costosTexto(sv.costos)}</td>
                  </tr>
                ))}
              </Tabla>
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Órdenes y costo final por área</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {datos.areas.map(a => (
                <div key={a.area} className="rounded-xl border border-zinc-200 p-3">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-black text-zinc-800">{a.codigo}</span>
                    {a.nombre && <span className="text-[11px] text-zinc-400 truncate">{a.nombre}</span>}
                  </div>
                  <p className="mt-1 text-2xl font-black tracking-tight text-zinc-800 tabular-nums">
                    {a.ordenes}<span className="ml-1 text-[11px] font-bold text-zinc-400">orden{a.ordenes !== 1 ? 'es' : ''}</span>
                  </p>
                  <div className="mt-2 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                    <div className="h-full bg-brand-cyan rounded-full" style={{ width: `${Math.round(a.ordenes * 100 / maxOrdenes)}%` }} />
                  </div>
                  <p className="mt-2 text-xs font-bold text-zinc-700 tabular-nums">{costosTexto(a.costos)}</p>
                  <p className="text-[10px] text-zinc-400">costo final</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PESTAÑA 4 — PENDIENTE DE RETIRAR EN DEPÓSITO
   ══════════════════════════════════════════════════════════════════════ */
function TabDeposito({ CliIdCliente }) {
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAPI(`/api/vendedor-360/clientes/${CliIdCliente}/deposito-pendiente`)
      .then(r => { if (alive) setOrdenes(r.data || []); })
      .catch(e => { if (alive) { toast.error(e.message); setOrdenes([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [CliIdCliente]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return ordenes;
    return ordenes.filter(o => `${o.OrdCodigoOrden || ''} ${o.OrdNombreTrabajo || ''} ${o.Material || ''}`.toLowerCase().includes(q));
  }, [ordenes, busqueda]);

  const totales = useMemo(() => {
    const m = {};
    visibles.forEach(o => {
      const s = o.MonSimbolo || '$';
      if (!m[s]) m[s] = { moneda: s, total: 0, cant: 0 };
      m[s].total += Number(o.OrdCostoFinal || 0);
      m[s].cant += 1;
    });
    return Object.values(m);
  }, [visibles]);

  if (loading) return <Cargando />;
  if (!ordenes.length) return <Vacio>Este cliente no tiene órdenes esperando retiro en el depósito.</Vacio>;

  return (
    <>
      <div className="px-4 py-3 border-b border-zinc-100 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar orden, trabajo o material…"
            className="w-64 pl-7 pr-3 py-1.5 text-[11px] font-medium border border-zinc-200 rounded-full outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 placeholder:text-zinc-400" />
        </div>
        <span className="ml-auto text-[11px] font-semibold text-zinc-400">
          {visibles.length} orden{visibles.length !== 1 ? 'es' : ''} en depósito
        </span>
      </div>

      {totales.length > 0 && <TotalesPorMoneda totales={totales} etiqueta="Valor en depósito" />}

      <Tabla head={<>
        <Th>Ingreso</Th><Th>Orden</Th><Th>Material</Th><Th align="center">Bultos</Th>
        <Th align="right">Cantidad</Th><Th align="right">Importe</Th><Th align="center">Estado</Th><Th align="center">Aviso</Th>
      </>}>
        {visibles.map(o => (
          <tr key={o.OrdIdOrden} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
            <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
              <span className="tabular-nums text-zinc-500">{fmtFechaCorta(o.OrdFechaIngresoOrden)}</span>
              {o.DiasEnDeposito != null && (
                <span className={`block text-[10px] font-bold ${o.DiasEnDeposito >= 30 ? 'text-rose-600' : o.DiasEnDeposito >= 15 ? 'text-amber-600' : 'text-zinc-400'}`}>
                  {o.DiasEnDeposito} día{o.DiasEnDeposito !== 1 ? 's' : ''} acá
                </span>
              )}
            </td>
            <td className="px-4 py-3 align-top">
              <span className="font-bold text-zinc-800">{o.OrdCodigoOrden}</span>
              {o.OrdNombreTrabajo && (
                <span className="block text-[11px] text-zinc-400 truncate max-w-[220px]" title={o.OrdNombreTrabajo}>{o.OrdNombreTrabajo}</span>
              )}
            </td>
            <td className="px-4 py-3 align-top text-xs text-zinc-600">
              {o.Material ? <span className="truncate max-w-[160px] inline-block align-top" title={o.Material}>{o.Material}</span> : <span className="text-zinc-300">—</span>}
            </td>
            <td className="px-4 py-3 text-center align-top text-xs tabular-nums text-zinc-600">
              {o.BultosEsperados ? `${o.BultosRecibidos || 0}/${o.BultosEsperados}` : <span className="text-zinc-300">—</span>}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-zinc-600 align-top">{fmtNum(o.OrdCantidad)}</td>
            <td className="px-4 py-3 text-right tabular-nums font-bold text-zinc-800 align-top whitespace-nowrap">{o.MonSimbolo} {fmtNum(o.OrdCostoFinal)}</td>
            <td className="px-4 py-3 text-center align-top">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20 whitespace-nowrap">
                {o.EOrNombreEstado || `Estado ${o.OrdEstadoActual ?? '—'}`}
              </span>
            </td>
            <td className="px-4 py-3 text-center align-top">
              {o.OrdAvisoWsp ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600" title={`Avisado el ${fmtFechaCorta(o.OrdFechaAvisoWsp)}`}>
                  <CheckCircle2 size={12} /> Avisado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-400">
                  <Clock size={12} /> Sin avisar
                </span>
              )}
            </td>
          </tr>
        ))}
      </Tabla>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PESTAÑA 5 — PRECIOS ESPECIALES
   Mismo formato que la pantalla de Gestión de Precios (SpecialPrices):
   Tipo · Excepción/Referencia · Precio Base · Tarifa Especial.
   Cruza las reglas del cliente (/special-prices/:id) contra el catálogo
   de precios base (/prices/base) para poder mostrar el precio final y el
   % de descuento. SOLO LECTURA: sin editar ni borrar.
   ══════════════════════════════════════════════════════════════════════ */

// Perfiles de precio asignados al cliente: se muestran como contexto arriba de
// las excepciones (antes eran una pestaña aparte).
const ResumenTarifas = ({ profiles }) => (
  <div className="px-4 py-3 border-b border-zinc-100 flex flex-wrap items-center gap-2">
    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Tarifas asignadas</span>
    {profiles.map(p => (
      <span key={p.ID} title={`Perfil de precios #${p.ID}`}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20">
        {p.NombrePerfil}
      </span>
    ))}
  </div>
);

function TabPreciosEspeciales({ CliIdCliente }) {
  const [rules, setRules]         = useState([]);
  const [profiles, setProfiles]   = useState([]);
  const [productos, setProductos] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.get(`/special-prices/${CliIdCliente}`).catch(e => {
        // 404 = cliente sin ficha de precios especiales: no es un error para el vendedor.
        if (e.response?.status !== 404) toast.error(e.message);
        return { data: {} };
      }),
      api.get('/prices/base').catch(() => ({ data: [] })),
    ]).then(([rRules, rBase]) => {
      if (!alive) return;
      setRules(rRules.data?.rules || []);
      setProfiles(rRules.data?.profiles || []);
      setProductos(Array.isArray(rBase.data) ? rBase.data : []);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [CliIdCliente]);

  // Catálogo indexado por código. Un artículo puede venir repetido (un precio por
  // moneda), así que guardamos todas las filas y después elegimos la que coincide
  // con la moneda de la regla.
  const catalogo = useMemo(() => {
    const m = new Map();
    productos.forEach(p => {
      const cod = String(p.CodArticulo || '').trim();
      if (!m.has(cod)) m.set(cod, []);
      m.get(cod).push(p);
    });
    return m;
  }, [productos]);

  // Nombre lindo de cada familia (Grupo) para las reglas que aplican a toda una familia
  const nombreGrupo = useMemo(() => {
    const m = new Map();
    productos.forEach(p => {
      if (!p.Grupo || m.has(p.Grupo)) return;
      const nom = p.NombreReferenciaGrupo || p.GrupoNombre;
      m.set(p.Grupo, nom ? `${p.Grupo} - ${nom}` : p.Grupo);
    });
    return m;
  }, [productos]);

  // Una fila por regla, ya resuelta: qué es, cuánto vale de lista y cuánto paga el cliente.
  const filas = useMemo(() => rules.map((r, i) => {
    const cod     = String(r.CodArticulo || '').trim();
    const monId   = Number(r.Moneda) === 2 ? 2 : 1;
    const simbolo = monId === 2 ? 'USD' : 'UYU';

    let tipo = 'PRODUCTO', icono = Package, descripcion = `Producto ${cod}`, precioBase = 0;

    if (cod === 'TOTAL' || Number(r.ProIdProducto) === 0) {
      tipo = 'GLOBAL'; icono = Globe;
      descripcion = 'Aplica a todo el resto (Regla Global)';
    } else if (r.CodGrupo) {
      tipo = 'FAMILIA'; icono = Folder;
      descripcion = `Toda la familia: ${nombreGrupo.get(String(r.CodGrupo).trim()) || r.CodGrupo}`;
    } else {
      const filasCat = catalogo.get(cod) || [];
      // Preferimos el precio base de la MISMA moneda que la regla.
      const prod = filasCat.find(p => Number(p.MonIdMoneda) === monId) || filasCat[0];
      if (prod) {
        descripcion = prod.Descripcion || descripcion;
        precioBase  = Number(prod.Precio) || 0;
      }
    }

    // Texto de la tarifa especial — mismo cálculo que la pantalla de precios.
    const valor = Number(r.Valor) || 0;
    const esPorcentaje = String(r.TipoRegla || '').includes('percentage');
    let precioFinal = null, descuentoPct = null;
    if (esPorcentaje) {
      descuentoPct = valor;
      if (precioBase > 0) precioFinal = precioBase * (1 - valor / 100);
    } else {
      precioFinal = valor;
      if (precioBase > 0) descuentoPct = ((precioBase - valor) / precioBase) * 100;
    }

    return {
      key: `${cod}_${r.TipoRegla}_${valor}_${i}`,
      tipo, icono, descripcion, cod, simbolo, precioBase, precioFinal, descuentoPct,
      minCantidad: Number(r.CantidadMinima) || 0,
    };
  }), [rules, catalogo, nombreGrupo]);

  if (loading) return <Cargando />;

  if (!filas.length) {
    return (
      <>
        {profiles.length > 0 && <ResumenTarifas profiles={profiles} />}
        <Vacio>Este cliente no tiene excepciones de precio cargadas: paga la lista base.</Vacio>
      </>
    );
  }

  return (
    <>
      {profiles.length > 0 && <ResumenTarifas profiles={profiles} />}

      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 bg-white border border-zinc-200 px-2.5 py-1 rounded-full">
          {filas.length} excepcion{filas.length !== 1 ? 'es' : ''} cargada{filas.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[11px] text-zinc-500">
          Precios pactados <strong>solo para este cliente</strong>. El resto del catálogo se cobra a lista base.
        </span>
      </div>

      <Tabla head={<>
        <Th align="center">Tipo</Th><Th>Excepción / Referencia</Th>
        <Th align="right">Precio base</Th><Th align="right">Tarifa especial</Th><Th align="right">Desde cantidad</Th>
      </>}>
        {filas.map(f => (
          <tr key={f.key} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
            <td className="px-4 py-3 text-center align-top"
              title={f.tipo === 'PRODUCTO' ? 'Producto' : f.tipo === 'FAMILIA' ? 'Familia de productos' : 'Regla global'}>
              <f.icono size={16} className="text-brand-cyan mx-auto" />
            </td>
            <td className="px-4 py-3 align-top">
              <span className="font-bold text-zinc-800">{f.descripcion}</span>
              <span className="block text-[11px] font-mono text-zinc-400 mt-0.5">Ref: {f.cod}</span>
            </td>
            <td className="px-4 py-3 text-right tabular-nums font-mono text-zinc-500 align-top whitespace-nowrap">
              {f.precioBase > 0 ? `${f.simbolo} ${fmtNum(f.precioBase)}` : <span className="text-zinc-300">--</span>}
            </td>
            <td className="px-4 py-3 text-right align-top whitespace-nowrap bg-brand-cyan/5">
              <span className="font-mono font-black text-brand-cyan">
                {f.precioFinal != null ? `${f.simbolo} ${fmtNum(f.precioFinal)}` : `${fmtNum(f.descuentoPct)}% OFF`}
              </span>
              {f.precioFinal != null && f.descuentoPct != null && (
                <span className="block text-[10px] font-bold text-emerald-600">{fmtNum(f.descuentoPct, 2)}% OFF</span>
              )}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-zinc-500 text-xs align-top">
              {f.minCantidad > 0 ? fmtNum(f.minCantidad) : <span className="text-zinc-300">Sin mínimo</span>}
            </td>
          </tr>
        ))}
      </Tabla>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   VISTA PRINCIPAL
   ══════════════════════════════════════════════════════════════════════ */
export default function VendedorCliente360() {
  const [busqueda, setBusqueda]               = useState('');
  const [filtroTipoCliente, setFiltroTipo]    = useState('');
  const [clientes, setClientes]               = useState([]);
  const [totalClientes, setTotalClientes]     = useState(0);     // cuántos cumplen la búsqueda (la lista llega de a 50)
  const [cargandoMas, setCargandoMas]         = useState(false);
  const pedidoListaRef                        = useRef(0);       // descarta respuestas de una búsqueda que ya cambió
  const [loadingLista, setLoadingLista]       = useState(false);
  const [clienteSel, setClienteSel]           = useState(null);
  const [tab, setTab]                         = useState('RESUMEN');
  // Cambia al refrescar: fuerza a las pestañas a volver a pedir sus datos.
  const [refresh, setRefresh]                 = useState(0);

  // ── Cartera: cada cliente tiene un vendedor asignado (Clientes.VendedorID) ──
  // Lo elegido queda guardado en este navegador, así el vendedor entra siempre
  // con SU cartera sin volver a elegirla.
  const [vendedores, setVendedores]     = useState([]);
  const [vendedorSel, setVendedorSel]   = useState(() => localStorage.getItem(LS_VENDEDOR) || '');

  useEffect(() => {
    fetchAPI('/api/vendedor-360/vendedores')
      .then(r => {
        const lista = r.data || [];
        setVendedores(lista);
        // Si nunca eligió y el sistema pudo reconocerlo por nombre, arranca con su cartera.
        if (!localStorage.getItem(LS_VENDEDOR)) {
          const mio = lista.find(v => v.esMio);
          if (mio) setVendedorSel(mio.VendedorID);
        }
      })
      .catch(() => setVendedores([]));
  }, []);

  const elegirVendedor = (id) => {
    setVendedorSel(id);
    setClienteSel(null);   // el cliente abierto puede no ser de esta cartera
    if (id) localStorage.setItem(LS_VENDEDOR, id);
    else localStorage.removeItem(LS_VENDEDOR);
  };

  // La cartera (vendedor) la filtra el servidor: la lista llega de a 50 y filtrar
  // una página en el navegador dejaba afuera clientes del vendedor.
  // offset > 0 = "Cargar más": suma la página siguiente en vez de reemplazar la lista.
  const cargarClientes = useCallback(async (q = '', tipo = '', vendedor = '', offset = 0) => {
    const mas = offset > 0;
    const pedido = mas ? pedidoListaRef.current : ++pedidoListaRef.current;
    if (mas) setCargandoMas(true); else setLoadingLista(true);
    try {
      const qp = new URLSearchParams();
      if (q.trim()) qp.append('q', q.trim());
      if (tipo) qp.append('tipoCliente', tipo);
      if (vendedor) qp.append('vendedorId', vendedor);
      qp.append('tipo', 'TODOS');
      qp.append('todos', 'true');
      if (mas) qp.append('offset', String(offset));
      const data = await fetchAPI(`/api/contabilidad/clientes-activos?${qp.toString()}`);
      if (pedido !== pedidoListaRef.current) return; // se cambió la búsqueda o la cartera mientras cargaba
      const filas = data.data || [];
      setClientes(prev => {
        if (!mas) return filas;
        const ya = new Set(prev.map(c => c.CliIdCliente));
        return [...prev, ...filas.filter(c => !ya.has(c.CliIdCliente))];
      });
      setTotalClientes(data.total ?? filas.length);
    } catch (e) { toast.error(e.message); }
    finally {
      if (pedido === pedidoListaRef.current) { setLoadingLista(false); setCargandoMas(false); }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => cargarClientes(busqueda, filtroTipoCliente, vendedorSel), 400);
    return () => clearTimeout(t);
  }, [busqueda, filtroTipoCliente, vendedorSel, cargarClientes]);

  const hayMasClientes = !loadingLista && clientes.length > 0 && clientes.length < totalClientes;
  const cargarMasClientes = () => {
    if (!hayMasClientes || cargandoMas) return;
    cargarClientes(busqueda, filtroTipoCliente, vendedorSel, clientes.length);
  };
  const vendedorActual = vendedores.find(v => v.VendedorID === vendedorSel);

  const cuerpoTab = () => {
    const key = `${clienteSel.CliIdCliente}_${refresh}`;
    switch (tab) {
      case 'RESUMEN':    return <TabResumen         key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      case 'RECURSOS':   return <TabRecursos        key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      case 'TELAS':      return <TabTelas           key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      case 'DEPOSITO':   return <TabDeposito        key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      case 'ESPECIALES': return <TabPreciosEspeciales key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      case 'BENEFICIOS': return <TabBeneficiosCliente key={key} cliente={clienteSel} />;
      default:           return null;
    }
  };

  return (
    <div className="min-h-full text-zinc-700 px-3 sm:px-6 py-5">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Eye size={30} className="text-brand-cyan shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Vista 360° del cliente</h1>
          <p className="text-sm text-zinc-500 mt-1">Vendedores · solo consulta. Desde «Beneficios» se pueden proponer pactos.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-200 bg-white text-[11px] font-bold text-zinc-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Solo lectura
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 w-full items-start">

        {/* ── Columna izquierda: clientes ── */}
        <aside className="w-full lg:w-[340px] shrink-0 bg-white rounded-2xl border border-zinc-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-zinc-100 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wide text-zinc-800 flex items-center gap-2">
                <Users size={16} className="text-brand-cyan" /> Clientes
              </h2>
              <button type="button" onClick={() => cargarClientes(busqueda, filtroTipoCliente, vendedorSel)} title="Actualizar la lista de clientes"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
                <RefreshCw size={14} className={loadingLista ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              <input type="text" placeholder="Buscar por nombre, RUC o código…" value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-xl text-sm text-zinc-800 bg-white outline-none transition-colors hover:border-zinc-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 placeholder:text-zinc-400" />
            </div>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
              <div>
                <span className={etiquetaCampo}>Tipo</span>
                <Selector filtro className="w-full" value={filtroTipoCliente} onChange={e => setFiltroTipo(e.target.value)} aria-label="Tipo de cliente">
                  <option value="">Todos</option>
                  <option value="1">Común</option>
                  <option value="2">Semanal</option>
                  <option value="3">Rollo</option>
                </Selector>
              </div>
              {/* Cartera: los clientes que tienen a ese vendedor asignado. Queda guardada en este navegador. */}
              <div className="min-w-0">
                <span className={etiquetaCampo}>Cartera</span>
                <Selector filtro className="w-full" value={vendedorSel} onChange={e => elegirVendedor(e.target.value)} aria-label="Cartera" anchoLista={280}>
                  <option value="">Todos los clientes</option>
                  {vendedores.map(v => (
                    <option key={v.VendedorID} value={v.VendedorID} descripcion={`${v.CantClientes} cliente${v.CantClientes !== 1 ? 's' : ''}${v.esMio ? ' · tu cartera' : ''}`}>
                      {v.Etiqueta}
                    </option>
                  ))}
                </Selector>
              </div>
            </div>
            {vendedorSel && (
              <p className="text-[11px] text-zinc-500">
                Solo la cartera de <b className="text-zinc-700">{vendedorActual?.Etiqueta || vendedorSel}</b>
                {' · '}
                <button type="button" onClick={() => elegirVendedor('')} className="font-bold text-brand-cyan hover:underline">ver todos</button>
              </p>
            )}
          </div>

          {/* Llega de a 50: al acercarse al final del scroll se pide la página siguiente sola */}
          <div className="flex-1 overflow-y-auto max-h-[65vh]"
            onScroll={e => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) cargarMasClientes();
            }}>
            {loadingLista ? (
              <Cargando />
            ) : clientes.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Users size={26} className="mx-auto mb-2 text-brand-cyan" />
                <p className="text-xs text-zinc-500">
                  {vendedorSel
                    ? 'Ningún cliente de esta cartera coincide con la búsqueda'
                    : busqueda.trim() ? 'No se encontraron clientes' : 'Escribí para buscar cualquier cliente'}
                </p>
              </div>
            ) : (
              <>
                {clientes.map(c => (
                  <FilaClienteVendedor key={c.CliIdCliente} c={c}
                    seleccionado={clienteSel?.CliIdCliente === c.CliIdCliente}
                    onClick={() => setClienteSel(c)} />
                ))}
                {hayMasClientes && (
                  <button type="button" onClick={cargarMasClientes} disabled={cargandoMas}
                    className="w-full py-3 text-xs font-bold text-brand-cyan hover:bg-brand-cyan/5 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors">
                    {cargandoMas
                      ? <><RefreshCw size={12} className="animate-spin" /> Cargando más clientes…</>
                      : `Cargar más clientes (quedan ${totalClientes - clientes.length})`}
                  </button>
                )}
              </>
            )}
          </div>
          <div className="px-4 py-2.5 border-t border-zinc-100 text-[11px] text-zinc-400 text-center">
            {clientes.length < totalClientes
              ? `${clientes.length} de ${totalClientes} clientes`
              : `${clientes.length} clientes`}
            {vendedorSel ? ' en la cartera' : ''}
          </div>
        </aside>

        {/* ── Columna derecha: detalle ── */}
        <div className="flex-1 space-y-4 min-w-0 w-full">
          {!clienteSel ? (
            <div className="flex flex-col items-center justify-center py-24 px-4 text-center bg-white rounded-2xl border border-dashed border-zinc-300">
              <Eye size={36} className="mb-3 text-brand-cyan" />
              <p className="text-base font-bold text-zinc-800">Elegí un cliente</p>
              <p className="text-sm text-zinc-500 mt-1">para ver su resumen, recursos, telas, depósito y precios</p>
            </div>
          ) : (
            <>
              {/* Ficha del cliente */}
              <div className="bg-white rounded-2xl border border-zinc-200 p-4 sm:p-5 flex items-start gap-4">
                <span className="w-12 h-12 rounded-2xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center font-black text-lg shrink-0">
                  {(clienteSel.Nombre || '?').trim().slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-black text-zinc-900 leading-tight truncate" title={clienteSel.Nombre}>{clienteSel.Nombre}</h2>
                  <p className="text-[11px] font-mono text-zinc-400 mt-0.5">#{clienteSel.IDCliente || clienteSel.CodCliente || clienteSel.CliIdCliente}</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600 mt-2">
                    {clienteSel.CioRuc && (
                      <span className="inline-flex items-center gap-1.5"><IdCard size={14} className="text-brand-cyan" /> RUC/CI <b className="font-mono text-zinc-800">{clienteSel.CioRuc}</b></span>
                    )}
                    {clienteSel.Email && (
                      <span className="inline-flex items-center gap-1.5 min-w-0"><Mail size={14} className="text-brand-cyan shrink-0" /> <span className="truncate max-w-[240px]" title={clienteSel.Email}>{clienteSel.Email}</span></span>
                    )}
                    {clienteSel.TelefonoTrabajo && (
                      <span className="inline-flex items-center gap-1.5"><Phone size={14} className="text-brand-cyan" /> {clienteSel.TelefonoTrabajo}</span>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => setRefresh(v => v + 1)} title="Volver a consultar los datos de la pestaña actual"
                  className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0">
                  <RefreshCw size={15} />
                </button>
              </div>

              {/* Pestañas: pastillas en escritorio, selector en el celular */}
              <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                <div className="px-3 py-3 border-b border-zinc-100">
                  <div className="hidden md:flex flex-wrap gap-1.5">
                    {TABS.map(({ key, label, icon: Icon }) => (
                      <button key={key} type="button" onClick={() => setTab(key)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${tab === key ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
                        <Icon size={14} className={tab === key ? 'text-white' : 'text-brand-cyan'} /> {label}
                      </button>
                    ))}
                  </div>
                  <div className="md:hidden">
                    <Selector value={tab} onChange={e => setTab(e.target.value)} aria-label="Pestaña">
                      {TABS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                    </Selector>
                  </div>
                </div>
                {cuerpoTab()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
