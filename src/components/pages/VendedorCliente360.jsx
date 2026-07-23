/**
 * VendedorCliente360.jsx  —  Ruta: /vendedores/cliente-360
 *
 * Vista 360 del cliente PARA VENDEDORES. SOLO VISUALIZAR: no tiene ningún botón
 * que cobre, facture, anule ni modifique nada. Convive con
 * /contabilidad/cliente-360 (la de contabilidad, que sí opera) sin reemplazarla.
 *
 * Seis pestañas, una por cosa que el vendedor necesita saber del cliente:
 *   1. Recursos              → planes de metros comprados (comprado / usado / restante)
 *   2. Telas del cliente     → metros de tela física del cliente en el depósito
 *   3. Pendiente de pago     → documentos con saldo (deudas vivas)
 *   4. Pendiente de retirar  → órdenes que siguen en el depósito
 *   5. Tarifas aplicadas     → perfiles de precios asignados y sus escalones
 *   6. Precios especiales    → reglas de precio propias del cliente
 *
 * Reutiliza endpoints existentes; lo único nuevo es
 * GET /api/vendedor-360/clientes/:id/deposito-pendiente (solo lectura).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search, RefreshCw, Users, Eye, Layers, Package,
  Truck, Tag, ChevronDown, ChevronRight, CheckCircle2, Clock,
  History, X,
} from 'lucide-react';
import { toast } from 'sonner';

import api from '../../services/api';
import { fetchAPI, FilaCliente } from './ContabilidadCuentasView';
import { fmtFechaCorta } from '../../utils/fechas';

const fmtNum = (n, dec = 2) => new Intl.NumberFormat('es-UY', {
  minimumFractionDigits: dec, maximumFractionDigits: dec,
}).format(Number(n) || 0);

// Cartera elegida (VendedorID). Se guarda en el navegador para que cada
// vendedor entre siempre con sus clientes sin volver a elegirlos.
const LS_VENDEDOR = 'vendedor360_cartera';

/* ── Definición de pestañas ───────────────────────────────────────────── */
const TABS = [
  { key: 'RECURSOS',   label: 'Recursos',            icon: Layers },
  { key: 'TELAS',      label: 'Telas del cliente',   icon: Package },
  { key: 'DEPOSITO',   label: 'Pendiente de retirar', icon: Truck },
  { key: 'ESPECIALES', label: 'Precios especiales',  icon: Tag },
];

/* ── Piezas chicas de UI ──────────────────────────────────────────────── */
const Cargando = () => (
  <div className="flex justify-center py-12">
    <div className="animate-spin h-7 w-7 border-2 border-cyan-600 border-t-transparent rounded-full" />
  </div>
);

const Vacio = ({ children }) => (
  <p className="text-center text-slate-400 text-sm py-12">{children}</p>
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
        <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">{head}</tr>
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
    <div className="w-full min-w-[90px] h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${p}%` }} />
    </div>
  );
};

// Totales por moneda (pesos y dólares nunca se suman entre sí)
const TotalesPorMoneda = ({ totales, etiqueta }) => (
  <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-2">
    {totales.map(t => (
      <div key={t.moneda} className="flex items-baseline gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{etiqueta} {t.moneda}</span>
        <span className="text-base font-black tracking-tight text-slate-800">{t.moneda} {fmtNum(t.total)}</span>
        <span className="text-[11px] text-slate-400">{t.cant} ítem{t.cant !== 1 ? 's' : ''}</span>
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
      .then(r => { if (alive) setMovs(r.data || []); })
      .catch(e => { if (alive) { toast.error(e.message); setMovs([]); } })
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

    // Saldo corrido: se acumula del más viejo al más nuevo.
    const ordenados = [...propios].sort((a, b) => new Date(a.MovFecha) - new Date(b.MovFecha));
    let saldo = 0;
    return ordenados.map(m => {
      const importe  = Number(m.MovImporte);
      const saldoIn  = saldo;
      saldo = Math.round((saldo + importe) * 10000) / 10000;
      const match = m.MovConcepto?.match(/[A-Z]{2,5}-\d+/i);
      const cod   = match ? match[0].toUpperCase() : '';
      let desc    = m.MovConcepto || '—';
      if (cod) desc = desc.replace(match[0], '').replace(/^[\s:\-.]+|[\s:\-.]+$/g, '').trim();
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
  }, [movs, planesDelMat, planes, plan]);

  const saldoFinal = movsConSaldo.length ? movsConSaldo[movsConSaldo.length - 1]._saldoFn : 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center px-2 sm:px-4 pt-10 pb-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[97vw] max-w-5xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-3 bg-violet-600 text-white shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Layers size={16} />
            <div className="min-w-0">
              <h3 className="text-sm font-black leading-tight truncate">
                Consumo del recurso · {plan.NombreArticulo || plan.PlaDescripcion || `Plan #${plan.PlaIdPlan}`}
              </h3>
              <p className="text-[11px] text-violet-100">
                {plan.PlaDescripcion || `Plan #${plan.PlaIdPlan}`}
                {planesDelMat.length > 1 && ` · incluye ${planesDelMat.length} planes del mismo material`}
              </p>
            </div>
          </div>
          <button onClick={onClose} title="Cerrar el estado de cuenta del recurso"
            className="p-2 rounded-lg hover:bg-white/20 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Resumen del plan */}
        <div className="px-5 py-3 bg-violet-50 border-b border-violet-100 flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">Comprado</span>
            <span className="text-sm font-black text-slate-700">{fmtNum(plan.PlaCantidadTotal)} {unidad}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">Usado</span>
            <span className="text-sm font-black text-rose-600">{fmtNum(plan.PlaCantidadUsada)} {unidad}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">Restante del plan</span>
            <span className="text-sm font-black text-emerald-600">{fmtNum(plan.PlaCantidadRestante)} {unidad}</span>
          </div>
          <div className="flex items-baseline gap-2 ml-auto">
            <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">Saldo del estado de cuenta</span>
            <span className="text-sm font-black text-violet-700">{fmtNum(saldoFinal)} {unidad}</span>
            <span className="text-[11px] text-slate-400">{movsConSaldo.length} mov.</span>
          </div>
        </div>

        {/* Movimientos */}
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? <Cargando /> : movsConSaldo.length === 0 ? (
            <Vacio>Este recurso todavía no tiene movimientos.</Vacio>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="text-[10px] text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
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
              <tbody className="divide-y divide-slate-100">
                {/* Más reciente arriba (el saldo ya viene calculado en orden cronológico) */}
                {[...movsConSaldo].reverse().map(m => (
                  <tr key={m.MovIdMovimiento} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtFechaCorta(m.MovFecha)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        m._tipo === 'RECARGO_URGENCIA' ? 'bg-rose-50 text-rose-700'
                          : m._tipo === 'ENTRADA' ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-violet-50 text-violet-700'
                      }`}>
                        {m._tipo === 'RECARGO_URGENCIA' ? 'RECARGO URGENCIA' : m._tipo}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap">{m._cod || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-[240px] truncate" title={m.MovConcepto}>{m._desc || '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{fmtNum(m._saldoIn)} {unidad}</td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${m._debe > 0 ? 'text-rose-600' : 'text-slate-300'}`}>
                      {m._debe > 0 ? `${fmtNum(m._debe)} ${unidad}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${m._haber > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                      {m._haber > 0 ? `${fmtNum(m._haber)} ${unidad}` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${m._saldoFn < 0 ? 'text-rose-600' : 'text-violet-700'}`}>
                      {fmtNum(m._saldoFn)} {unidad}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400">Vista de consulta: acá no se puede editar ni revertir ningún consumo.</span>
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors">
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
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Disponible en planes activos</span>
          <span className="text-base font-black tracking-tight text-emerald-600">{fmtNum(restanteActivo)}</span>
        </div>
        <span className="text-[11px] text-slate-400">{activos.length} activo{activos.length !== 1 ? 's' : ''} de {planes.length}</span>
      </div>

      <Tabla head={<>
        <Th>Plan</Th><Th>Artículo</Th><Th align="right">Comprado</Th><Th align="right">Usado</Th>
        <Th align="right">Restante</Th><Th>Consumo</Th><Th>Vence</Th><Th align="center">Estado</Th>
        <Th align="center">Detalle</Th>
      </>}>
        {planes.map(p => (
          <tr key={p.PlaIdPlan} className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/60 ${p.PlaActivo ? '' : 'opacity-50'}`}>
            <td className="px-4 py-3 align-top">
              <span className="font-bold text-slate-800">{p.PlaDescripcion || `Plan #${p.PlaIdPlan}`}</span>
              <span className="block text-[11px] text-slate-400">Alta {fmtFechaCorta(p.PlaFechaAlta)}</span>
            </td>
            <td className="px-4 py-3 align-top text-slate-600 text-xs">{p.NombreArticulo || '—'}</td>
            <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-700 align-top whitespace-nowrap">
              {fmtNum(p.PlaCantidadTotal)} {p.UniSimbolo || ''}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-slate-500 align-top whitespace-nowrap">{fmtNum(p.PlaCantidadUsada)}</td>
            <td className={`px-4 py-3 text-right tabular-nums font-black align-top whitespace-nowrap ${Number(p.PlaCantidadRestante) > 0.01 ? 'text-emerald-600' : 'text-slate-400'}`}>
              {fmtNum(p.PlaCantidadRestante)}
            </td>
            <td className="px-4 py-3 align-top">
              <BarraConsumo pct={p.PorcentajeUsado} />
              <span className="block text-[10px] text-slate-400 mt-1">{fmtNum(p.PorcentajeUsado, 1)}% usado</span>
            </td>
            <td className="px-4 py-3 align-top text-xs text-slate-500 whitespace-nowrap">
              {p.PlaFechaVencimiento ? (
                <>
                  {fmtFechaCorta(p.PlaFechaVencimiento)}
                  {p.DiasParaVencer != null && (
                    <span className={`block text-[10px] font-bold ${p.DiasParaVencer < 0 ? 'text-rose-600' : p.DiasParaVencer <= 15 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {p.DiasParaVencer < 0 ? `Vencido hace ${Math.abs(p.DiasParaVencer)} d` : `Faltan ${p.DiasParaVencer} d`}
                    </span>
                  )}
                </>
              ) : <span className="text-slate-300">Sin vencimiento</span>}
            </td>
            <td className="px-4 py-3 text-center align-top">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${p.PlaActivo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                {p.PlaActivo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td className="px-4 py-3 text-center align-top">
              <button onClick={() => setPlanConsumo(p)}
                title="Ver el estado de cuenta de este recurso: orden por orden, cómo se fueron consumiendo los metros"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-colors whitespace-nowrap">
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
  RESERVA_ORDEN:          { label: 'Reserva',        color: 'text-indigo-700 bg-indigo-50 border-indigo-200',    sign: '→' },
  LIBERACION_RESERVA:     { label: 'Lib. reserva',   color: 'text-teal-700 bg-teal-50 border-teal-200',          sign: '←' },
  MERMA_REIMPRESION:      { label: 'Merma reimp.',   color: 'text-orange-700 bg-orange-50 border-orange-200',    sign: '-' },
};
const getTipoTela = (t) => TIPO_MOV_TELA[t] || { label: t || '—', color: 'text-slate-500 bg-slate-50 border-slate-200', sign: '' };

// Movimientos que NO son consumo real del cliente (no se cuentan como metros gastados)
const NO_CONSUMO = ['INGRESO', 'CONFIRMACION_MEDIDA', 'LIBERACION_RESERVA'];

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
      consumido: b.movimientos.filter(m => !NO_CONSUMO.includes(m.TipoMovimiento) && Number(m.Cantidad) < 0)
        .reduce((s, m) => s + Math.abs(Number(m.Cantidad || 0)), 0),
    }));
  }, [movs, tela.TipoTela]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center px-2 sm:px-4 pt-10 pb-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[97vw] max-w-5xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3 bg-indigo-600 text-white shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Package size={16} />
            <div className="min-w-0">
              <h3 className="text-sm font-black leading-tight truncate">Consumo de tela · {tela.TipoTela || tela.InsumoNombre}</h3>
              <p className="text-[11px] text-indigo-100">
                {bobinas.length} bulto{bobinas.length !== 1 ? 's' : ''} · tocá uno para ver sus movimientos
              </p>
            </div>
          </div>
          <button onClick={onClose} title="Cerrar el estado de cuenta de la tela"
            className="p-2 rounded-lg hover:bg-white/20 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 bg-indigo-50 border-b border-indigo-100 flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Ingresados</span>
            <span className="text-sm font-black text-slate-700">{fmtNum(tela.MetrosIngresados)} m</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Consumidos</span>
            <span className="text-sm font-black text-rose-600">{fmtNum(tela.MetrosConsumidos)} m</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Disponibles</span>
            <span className="text-sm font-black text-indigo-700">{fmtNum(tela.MetrosDisponibles)} m</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-2 bg-slate-50">
          {loading ? <Cargando /> : bobinas.length === 0 ? (
            <Vacio>No hay movimientos registrados para esta tela.</Vacio>
          ) : bobinas.map(b => {
            const open = abierta === b.bobinaId;
            return (
              <div key={b.bobinaId} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <button type="button" onClick={() => setAbierta(open ? null : b.bobinaId)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left">
                  {open ? <ChevronDown size={15} className="text-slate-400 shrink-0" /> : <ChevronRight size={15} className="text-slate-400 shrink-0" />}
                  <Package size={14} className="text-indigo-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-slate-800 text-sm">{b.referencia || b.bulto}</span>
                    <span className="block text-[10px] text-slate-400 font-mono">
                      {b.bulto} · Ingreso {fmtFechaCorta(b.fechaIngreso)}
                      {b.metrosIniciales ? ` · L:${fmtNum(b.metrosIniciales)}m` : ''}
                      {b.ancho ? ` · A:${fmtNum(b.ancho)}m` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-center hidden sm:block">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ingreso</p>
                      <p className="text-sm font-black tabular-nums text-emerald-600">+{fmtNum(b.ingresado)}</p>
                    </div>
                    <div className="text-center hidden sm:block">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Consumo</p>
                      <p className="text-sm font-black tabular-nums text-rose-500">{b.consumido > 0 ? '-' : ''}{fmtNum(b.consumido)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Saldo</p>
                      <p className={`text-sm font-black tabular-nums ${b.saldo > 0 ? 'text-indigo-700' : 'text-slate-400'}`}>{fmtNum(b.saldo)}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold hidden md:block">{b.movimientos.length} mov.</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black border bg-slate-50 text-slate-500 border-slate-200 uppercase">
                      {b.estado || '—'}
                    </span>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-slate-100 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-500">
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
                            <tr key={m.MovimientoID || i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                              <td className="px-4 py-2.5 tabular-nums text-[10px] text-slate-500 whitespace-nowrap">{fmtFechaCorta(m.FechaMovimiento)}</td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${cfg.color}`}>
                                  {cfg.label}
                                </span>
                              </td>
                              <td className={`px-4 py-2.5 font-black tabular-nums text-right whitespace-nowrap ${m.TipoMovimiento === 'INGRESO' ? 'text-emerald-600' : Number(m.Cantidad) < 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                                {cfg.sign} {fmtNum(Math.abs(m.Cantidad))} m
                              </td>
                              <td className="px-4 py-2.5 font-black tabular-nums text-right text-indigo-700 whitespace-nowrap">{fmtNum(m.SaldoAcumulado || 0)} m</td>
                              <td className="px-4 py-2.5 text-[10px] text-slate-400 max-w-[200px] truncate" title={m.Referencia || ''}>
                                {m.Referencia || m.CodigoRecepcion || '—'}
                              </td>
                              <td className="px-4 py-2.5 text-[10px] text-slate-400">{m.Operario || '—'}</td>
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

        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400">Vista de consulta: acá no se puede ajustar ni cerrar ninguna bobina.</span>
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors">
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
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Metros disponibles</span>
          <span className="text-base font-black tracking-tight text-indigo-600">{fmtNum(totalDisp)} m</span>
        </div>
        <span className="text-[11px] text-slate-400">{totalBultos} bulto{totalBultos !== 1 ? 's' : ''} · {saldos.length} tipo{saldos.length !== 1 ? 's' : ''} de tela</span>
      </div>

      <Tabla head={<>
        <Th>Tipo de tela</Th><Th align="center">Bultos</Th><Th align="right">Ingresados</Th>
        <Th align="right">Consumidos</Th><Th align="right">Disponibles</Th>
        <Th align="right">Libres</Th><Th align="right">En proceso</Th><Th>Consumo</Th><Th>Último ingreso</Th>
        <Th align="center">Detalle</Th>
      </>}>
        {saldos.map((t, i) => (
          <tr key={`${t.InsumoID}_${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
            <td className="px-4 py-3 align-top">
              <span className="font-bold text-slate-800">{t.TipoTela || t.InsumoNombre}</span>
              {t.TipoTela && t.InsumoNombre && t.TipoTela !== t.InsumoNombre && (
                <span className="block text-[11px] text-slate-400">{t.InsumoNombre}</span>
              )}
            </td>
            <td className="px-4 py-3 text-center tabular-nums text-slate-600 align-top">{t.CantidadBultos}</td>
            <td className="px-4 py-3 text-right tabular-nums text-slate-600 align-top">{fmtNum(t.MetrosIngresados)}</td>
            <td className="px-4 py-3 text-right tabular-nums text-slate-500 align-top">{fmtNum(t.MetrosConsumidos)}</td>
            <td className="px-4 py-3 text-right tabular-nums font-black text-indigo-600 align-top">{fmtNum(t.MetrosDisponibles)}</td>
            <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-semibold align-top">{fmtNum(t.MetrosLibres)}</td>
            <td className="px-4 py-3 text-right tabular-nums text-amber-600 font-semibold align-top">{fmtNum(t.MetrosEnProceso)}</td>
            <td className="px-4 py-3 align-top">
              <BarraConsumo pct={t.PorcentajeConsumido} />
              <span className="block text-[10px] text-slate-400 mt-1">{fmtNum(t.PorcentajeConsumido, 1)}% consumido</span>
            </td>
            <td className="px-4 py-3 align-top text-xs text-slate-500 whitespace-nowrap">{fmtFechaCorta(t.UltimoIngreso)}</td>
            <td className="px-4 py-3 text-center align-top">
              <button onClick={() => setTelaConsumo(t)}
                title="Ver el estado de cuenta de esta tela: bulto por bulto, cómo se fueron consumiendo los metros"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors whitespace-nowrap">
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
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar orden, trabajo o material…"
            className="w-64 pl-7 pr-3 py-1.5 text-[11px] font-medium border border-slate-200 rounded-full outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/10 placeholder:text-slate-400" />
        </div>
        <span className="ml-auto text-[11px] font-semibold text-slate-400">
          {visibles.length} orden{visibles.length !== 1 ? 'es' : ''} en depósito
        </span>
      </div>

      {totales.length > 0 && <TotalesPorMoneda totales={totales} etiqueta="Valor en depósito" />}

      <Tabla head={<>
        <Th>Ingreso</Th><Th>Orden</Th><Th>Material</Th><Th align="center">Bultos</Th>
        <Th align="right">Cantidad</Th><Th align="right">Importe</Th><Th align="center">Estado</Th><Th align="center">Aviso</Th>
      </>}>
        {visibles.map(o => (
          <tr key={o.OrdIdOrden} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
            <td className="px-4 py-3 align-top text-xs whitespace-nowrap">
              <span className="tabular-nums text-slate-500">{fmtFechaCorta(o.OrdFechaIngresoOrden)}</span>
              {o.DiasEnDeposito != null && (
                <span className={`block text-[10px] font-bold ${o.DiasEnDeposito >= 30 ? 'text-rose-600' : o.DiasEnDeposito >= 15 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {o.DiasEnDeposito} día{o.DiasEnDeposito !== 1 ? 's' : ''} acá
                </span>
              )}
            </td>
            <td className="px-4 py-3 align-top">
              <span className="font-bold text-slate-800">{o.OrdCodigoOrden}</span>
              {o.OrdNombreTrabajo && (
                <span className="block text-[11px] text-slate-400 truncate max-w-[220px]" title={o.OrdNombreTrabajo}>{o.OrdNombreTrabajo}</span>
              )}
            </td>
            <td className="px-4 py-3 align-top text-xs text-slate-600">
              {o.Material ? <span className="truncate max-w-[160px] inline-block align-top" title={o.Material}>{o.Material}</span> : <span className="text-slate-300">—</span>}
            </td>
            <td className="px-4 py-3 text-center align-top text-xs tabular-nums text-slate-600">
              {o.BultosEsperados ? `${o.BultosRecibidos || 0}/${o.BultosEsperados}` : <span className="text-slate-300">—</span>}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-slate-600 align-top">{fmtNum(o.OrdCantidad)}</td>
            <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800 align-top whitespace-nowrap">{o.MonSimbolo} {fmtNum(o.OrdCostoFinal)}</td>
            <td className="px-4 py-3 text-center align-top">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-cyan-50 text-cyan-700 border-cyan-200 whitespace-nowrap">
                {o.EOrNombreEstado || `Estado ${o.OrdEstadoActual ?? '—'}`}
              </span>
            </td>
            <td className="px-4 py-3 text-center align-top">
              {o.OrdAvisoWsp ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600" title={`Avisado el ${fmtFechaCorta(o.OrdFechaAvisoWsp)}`}>
                  <CheckCircle2 size={12} /> Avisado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400">
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
  <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tarifas asignadas</span>
    {profiles.map(p => (
      <span key={p.ID} title={`Perfil de precios #${p.ID}`}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-cyan-50 text-cyan-700 border-cyan-200">
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

    let tipo = 'PRODUCTO', icono = '📦', descripcion = `Producto ${cod}`, precioBase = 0;

    if (cod === 'TOTAL' || Number(r.ProIdProducto) === 0) {
      tipo = 'GLOBAL'; icono = '🌐';
      descripcion = 'Aplica a todo el resto (Regla Global)';
    } else if (r.CodGrupo) {
      tipo = 'FAMILIA'; icono = '📁';
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

      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full">
          {filas.length} excepcion{filas.length !== 1 ? 'es' : ''} cargada{filas.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[11px] text-slate-500">
          Precios pactados <strong>solo para este cliente</strong>. El resto del catálogo se cobra a lista base.
        </span>
      </div>

      <Tabla head={<>
        <Th align="center">Tipo</Th><Th>Excepción / Referencia</Th>
        <Th align="right">Precio base</Th><Th align="right">Tarifa especial</Th><Th align="right">Desde cantidad</Th>
      </>}>
        {filas.map(f => (
          <tr key={f.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
            <td className="px-4 py-3 text-center text-lg align-top select-none"
              title={f.tipo === 'PRODUCTO' ? 'Producto' : f.tipo === 'FAMILIA' ? 'Familia de productos' : 'Regla global'}>
              {f.icono}
            </td>
            <td className="px-4 py-3 align-top">
              <span className="font-bold text-slate-800">{f.descripcion}</span>
              <span className="block text-[11px] font-mono text-slate-400 mt-0.5">Ref: {f.cod}</span>
            </td>
            <td className="px-4 py-3 text-right tabular-nums font-mono text-slate-500 align-top whitespace-nowrap">
              {f.precioBase > 0 ? `${f.simbolo} ${fmtNum(f.precioBase)}` : <span className="text-slate-300">--</span>}
            </td>
            <td className="px-4 py-3 text-right align-top whitespace-nowrap bg-indigo-50/30">
              <span className="font-mono font-black text-indigo-700">
                {f.precioFinal != null ? `${f.simbolo} ${fmtNum(f.precioFinal)}` : `${fmtNum(f.descuentoPct)}% OFF`}
              </span>
              {f.precioFinal != null && f.descuentoPct != null && (
                <span className="block text-[10px] font-bold text-emerald-600">{fmtNum(f.descuentoPct, 2)}% OFF</span>
              )}
            </td>
            <td className="px-4 py-3 text-right tabular-nums text-slate-500 text-xs align-top">
              {f.minCantidad > 0 ? fmtNum(f.minCantidad) : <span className="text-slate-300">Sin mínimo</span>}
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
  const [loadingLista, setLoadingLista]       = useState(false);
  const [clienteSel, setClienteSel]           = useState(null);
  const [tab, setTab]                         = useState('RECURSOS');
  // Cambia al refrescar: fuerza a las pestañas a volver a pedir sus datos.
  const [refresh, setRefresh]                 = useState(0);

  // ── Cartera: cada cliente tiene un vendedor asignado (Clientes.VendedorID) ──
  // Lo elegido queda guardado en este navegador, así el vendedor entra siempre
  // con SU cartera sin volver a elegirla.
  const [vendedores, setVendedores]     = useState([]);
  const [vendedorSel, setVendedorSel]   = useState(() => localStorage.getItem(LS_VENDEDOR) || '');
  const [misClienteIds, setMisClienteIds] = useState(null); // Set de CliIdCliente | null = sin filtro

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

  // Cartera del vendedor elegido → set de IDs para filtrar la lista
  useEffect(() => {
    if (!vendedorSel) { setMisClienteIds(null); return; }
    let alive = true;
    fetchAPI(`/api/vendedor-360/vendedores/${encodeURIComponent(vendedorSel)}/clientes`)
      .then(r => { if (alive) setMisClienteIds(new Set(r.data || [])); })
      .catch(e => { if (alive) { toast.error(e.message); setMisClienteIds(null); } });
    return () => { alive = false; };
  }, [vendedorSel]);

  const elegirVendedor = (id) => {
    setVendedorSel(id);
    setClienteSel(null);   // el cliente abierto puede no ser de esta cartera
    if (id) localStorage.setItem(LS_VENDEDOR, id);
    else localStorage.removeItem(LS_VENDEDOR);
  };

  const cargarClientes = useCallback(async (q = '', tipo = '') => {
    setLoadingLista(true);
    try {
      const qp = new URLSearchParams();
      if (q.trim()) qp.append('q', q.trim());
      if (tipo) qp.append('tipoCliente', tipo);
      qp.append('tipo', 'TODOS');
      qp.append('todos', 'true');
      const data = await fetchAPI(`/api/contabilidad/clientes-activos?${qp.toString()}`);
      setClientes(data.data || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingLista(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => cargarClientes(busqueda, filtroTipoCliente), 400);
    return () => clearTimeout(t);
  }, [busqueda, filtroTipoCliente, cargarClientes]);

  // Lista que se ve: si hay un vendedor elegido, solo sus clientes.
  const clientesVisibles = useMemo(
    () => (misClienteIds ? clientes.filter(c => misClienteIds.has(c.CliIdCliente)) : clientes),
    [clientes, misClienteIds],
  );
  const vendedorActual = vendedores.find(v => v.VendedorID === vendedorSel);

  const cuerpoTab = () => {
    const key = `${clienteSel.CliIdCliente}_${refresh}`;
    switch (tab) {
      case 'RECURSOS':   return <TabRecursos        key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      case 'TELAS':      return <TabTelas           key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      case 'DEPOSITO':   return <TabDeposito        key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      case 'ESPECIALES': return <TabPreciosEspeciales key={key} CliIdCliente={clienteSel.CliIdCliente} />;
      default:           return null;
    }
  };

  return (
    <div className="bg-[#f1f5f9] min-h-full text-slate-700 font-sans">
      {/* Barra superior */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <div className="w-9 h-9 rounded-xl bg-cyan-700 flex items-center justify-center text-white shrink-0">
          <Eye size={16} />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-black text-slate-800 leading-tight">Vista 360° del cliente · Vendedores</h1>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Consulta — esta pantalla no modifica nada</p>
        </div>
        <span className="ml-2 text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full font-mono">
          /vendedores/cliente-360
        </span>
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Solo lectura
        </span>
      </div>

      <div className="px-3 sm:px-4 py-3">
        <div className="flex flex-col lg:flex-row gap-4 w-full items-start">

          {/* ── Columna izquierda: clientes ── */}
          <div className="w-full md:w-80 shrink-0 flex flex-col bg-[#f1f5f9] rounded-xl border border-slate-200 shadow-sm">
            <div className="px-4 py-4 border-b border-slate-200 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Users size={16} className="text-cyan-500" />Clientes
                </h2>
                <button onClick={() => cargarClientes(busqueda, filtroTipoCliente)} title="Actualizar la lista de clientes"
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
                <select value={filtroTipoCliente} onChange={e => setFiltroTipo(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-slate-700 outline-none w-[92px]">
                  <option value="">Todos</option>
                  <option value="1">Común</option>
                  <option value="2">Semanal</option>
                  <option value="3">Rollo</option>
                </select>
              </div>

              {/* Cartera: "Mis clientes" = los que tienen a ese vendedor asignado.
                  Lo elegido queda guardado en este navegador para la próxima vez. */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cartera</label>
                <select value={vendedorSel} onChange={e => elegirVendedor(e.target.value)}
                  title="Filtrar por el vendedor que tiene asignados a los clientes"
                  className="bg-white border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold text-slate-700 outline-none focus:border-cyan-500">
                  <option value="">Todos los clientes</option>
                  {vendedores.map(v => (
                    <option key={v.VendedorID} value={v.VendedorID}>
                      {v.esMio ? '★ Mis clientes — ' : ''}{v.Etiqueta} ({v.CantClientes})
                    </option>
                  ))}
                </select>
                {vendedorSel && (
                  <span className="text-[10px] text-cyan-700 font-bold">
                    Mostrando solo la cartera de {vendedorActual?.Etiqueta || vendedorSel}
                    {' · '}
                    <button type="button" onClick={() => elegirVendedor('')}
                      className="underline hover:text-cyan-900">ver todos</button>
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[70vh]">
              {loadingLista ? (
                <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-cyan-500 border-t-transparent rounded-full" /></div>
              ) : clientesVisibles.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Users size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-xs">
                    {vendedorSel
                      ? 'Ningún cliente de esta cartera coincide con la búsqueda'
                      : busqueda.trim() ? 'No se encontraron clientes' : 'Escribí para buscar cualquier cliente'}
                  </p>
                </div>
              ) : (
                clientesVisibles.map(c => (
                  <FilaCliente key={c.CliIdCliente} c={c}
                    seleccionado={clienteSel?.CliIdCliente === c.CliIdCliente}
                    onClick={() => setClienteSel(c)} />
                ))
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-slate-200 text-[11px] text-slate-500 text-center">
              {clientesVisibles.length} clientes{vendedorSel ? ' en tu cartera' : ''}
            </div>
          </div>

          {/* ── Columna derecha: detalle ── */}
          <div className="flex-1 space-y-4 min-w-0">
            {!clienteSel ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-500 bg-white rounded-2xl border border-slate-200 border-dashed">
                <Eye size={48} className="mb-4 opacity-20" />
                <p className="text-base font-medium">Seleccioná un cliente</p>
                <p className="text-sm mt-1">para ver sus recursos, telas, deudas, depósito y precios</p>
              </div>
            ) : (
              <>
                {/* Ficha del cliente */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-600 to-cyan-800 flex items-center justify-center text-white font-black text-lg shrink-0">
                    {(clienteSel.Nombre || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-black text-slate-800 leading-tight truncate" title={clienteSel.Nombre}>{clienteSel.Nombre}</h2>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono mt-0.5">
                      ID: {clienteSel.IDCliente || clienteSel.CodCliente || clienteSel.CliIdCliente}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500 font-medium mt-2">
                      {clienteSel.CioRuc && <span>RUC/CI: <span className="font-mono font-bold text-slate-700">{clienteSel.CioRuc}</span></span>}
                      {clienteSel.Email && <span className="truncate max-w-[220px]" title={clienteSel.Email}>{clienteSel.Email}</span>}
                      {clienteSel.TelefonoTrabajo && <span>{clienteSel.TelefonoTrabajo}</span>}
                    </div>
                  </div>
                  <button onClick={() => setRefresh(v => v + 1)} title="Volver a consultar los datos de la pestaña actual"
                    className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors shrink-0">
                    <RefreshCw size={14} />
                  </button>
                </div>

                {/* Pestañas */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 pt-3 flex items-center gap-4 flex-wrap border-b border-slate-100">
                    {TABS.map(({ key, label, icon: Icon }) => (
                      <button key={key} type="button" onClick={() => setTab(key)}
                        className={`relative pb-2.5 text-xs font-bold transition-colors flex items-center gap-1.5 ${tab === key ? 'text-cyan-700' : 'text-slate-400 hover:text-slate-600'}`}>
                        <Icon size={13} /> {label}
                        {tab === key && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-cyan-600 rounded-full" />}
                      </button>
                    ))}
                  </div>
                  {cuerpoTab()}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
