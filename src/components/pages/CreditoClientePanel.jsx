/**
 * CreditoClientePanel.jsx
 * Pestaña "Límites" del 360: UN límite de crédito por cliente (en $ o US$) y la condición
 * de pago (fija el vencimiento de las deudas nuevas). Todo lo que debe el cliente, en las
 * dos monedas, se compara contra ese límite convertido al tipo de cambio.
 *
 * Dónde se guarda (sin tablas nuevas): el límite va en la cuenta PRINCIPAL de la moneda
 * elegida (CueLimiteCredito) y la otra principal queda en 0; la condición de pago se
 * escribe en las dos principales. Mismo PATCH .../configuracion de siempre.
 * El límite SOLO ALERTA (Antigüedad de Deuda y acá): no bloquea ventas ni retiros.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { CreditCard, Save, Scale } from 'lucide-react';
import api from '../../services/api';

const fmt = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));

// Mismas reglas que Antigüedad de Deuda: 0–70 normal · 71–85 atención · 86–99 cerca · 100 alcanzado · +100 excedido
const estadoCredito = (utilizado, limite) => {
  if (!(limite > 0)) return { nivel: -1, txt: 'Sin límite cargado', pct: null, cls: 'text-slate-400', bar: 'bg-slate-300' };
  const pct = utilizado / limite * 100;
  if (pct > 100)  return { nivel: 4, txt: `Excedido en ${fmt(utilizado - limite)}`, pct, cls: 'text-rose-700', bar: 'bg-rose-600' };
  if (pct >= 100) return { nivel: 3, txt: 'Límite alcanzado', pct, cls: 'text-rose-600', bar: 'bg-rose-500' };
  if (pct >= 86)  return { nivel: 2, txt: 'Cerca del límite', pct, cls: 'text-orange-600', bar: 'bg-orange-500' };
  if (pct >= 71)  return { nivel: 1, txt: 'Atención', pct, cls: 'text-amber-600', bar: 'bg-amber-400' };
  return { nivel: 0, txt: 'Normal', pct, cls: 'text-emerald-600', bar: 'bg-emerald-500' };
};

const esDinero = (c) => ['DINERO_UYU', 'DINERO_USD'].includes(c?.CueTipo);

export default function CreditoClientePanel({ cliente, cuentas = [], recargarCuentas }) {
  const principales = useMemo(
    () => (cuentas || []).filter(c => c.CueEsPrincipal && c.CueActiva !== false && esDinero(c)),
    [cuentas],
  );
  const pUYU = principales.find(c => c.CueTipo === 'DINERO_UYU');
  const pUSD = principales.find(c => c.CueTipo === 'DINERO_USD');
  const conLimite = principales.find(c => Number(c.CueLimiteCredito) > 0);
  const limiteActual = conLimite ? Number(conLimite.CueLimiteCredito) : 0;
  const monedaActual = conLimite ? (conLimite.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU') : 'UYU';
  const condActual   = pUYU?.CPaIdCondicion || pUSD?.CPaIdCondicion || '';
  const condNombreActual = pUYU?.CondicionPago || pUSD?.CondicionPago || '';

  const [limite, setLimite]         = useState(limiteActual > 0 ? String(limiteActual) : '');
  const [moneda, setMoneda]         = useState(monedaActual);
  const [condicion, setCondicion]   = useState(condActual ? String(condActual) : '');
  const [condiciones, setCondiciones] = useState([]);
  const [tc, setTc]                 = useState('');
  const [tcFecha, setTcFecha]       = useState(null);
  const [saving, setSaving]         = useState(false);

  // Cuando las cuentas se recargan (después de guardar), el formulario refleja lo guardado
  useEffect(() => {
    setLimite(limiteActual > 0 ? String(limiteActual) : '');
    setMoneda(monedaActual);
    setCondicion(condActual ? String(condActual) : '');
  }, [limiteActual, monedaActual, condActual]);

  useEffect(() => {
    api.get('/contabilidad/condiciones-pago').then(r => setCondiciones(r.data?.data || [])).catch(() => {});
    api.get('/contabilidad/cotizacion-hoy').then(r => {
      const d = r.data?.data;
      if (d?.promedio > 0) { setTc(String(d.promedio)); setTcFecha(d.fecha); }
    }).catch(() => {});
  }, []);

  // Deuda pendiente por moneda (DeudaDocumento vivas: facturado + órdenes sin facturar),
  // sumando todas las cuentas de dinero de esa moneda.
  const deudaUYU = (cuentas || []).filter(c => c.CueTipo === 'DINERO_UYU').reduce((s, c) => s + Number(c.DeudaPendienteTotal || 0), 0);
  const deudaUSD = (cuentas || []).filter(c => c.CueTipo === 'DINERO_USD').reduce((s, c) => s + Number(c.DeudaPendienteTotal || 0), 0);
  const tcNum  = Number(String(tc).replace(',', '.')) || 0;
  const limNum = String(limite).trim() === '' ? 0 : Number(String(limite).replace(',', '.'));
  const sim    = moneda === 'USD' ? 'US$' : '$';
  const utilizado = moneda === 'USD'
    ? deudaUSD + (tcNum > 0 ? deudaUYU / tcNum : 0)
    : deudaUYU + deudaUSD * tcNum;
  const faltaTc = !(tcNum > 0) && (moneda === 'USD' ? deudaUYU > 0 : deudaUSD > 0);
  const est = estadoCredito(utilizado, limNum);
  const cpSel = condiciones.find(c => String(c.CPaIdCondicion) === String(condicion));
  const hayCambios = limNum !== limiteActual || moneda !== monedaActual || String(condicion) !== String(condActual || '');

  const guardar = async () => {
    if (!(limNum >= 0)) { toast.error('El límite de crédito debe ser un número mayor o igual a 0 (vacío = sin límite).'); return; }
    if (!condicion) { toast.error('Elegí la condición de pago.'); return; }
    const destino = moneda === 'USD' ? pUSD : pUYU;
    const otra    = moneda === 'USD' ? pUYU : pUSD;
    if (!destino) { toast.error(`El cliente no tiene cuenta principal en ${sim}: no se puede guardar el límite en esa moneda.`); return; }
    setSaving(true);
    try {
      await api.patch(`/contabilidad/cuentas/${destino.CueIdCuenta}/configuracion`, { CueLimiteCredito: limNum, CPaIdCondicion: Number(condicion) });
      if (otra) await api.patch(`/contabilidad/cuentas/${otra.CueIdCuenta}/configuracion`, { CueLimiteCredito: 0, CPaIdCondicion: Number(condicion) });
      toast.success(`✅ Crédito guardado: límite ${limNum > 0 ? `${sim} ${fmt(limNum)}` : 'sin límite'} · condición de pago "${cpSel?.CPaNombre || condicion}" para todas las cuentas del cliente.`);
      recargarCuentas?.();
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'No se pudo guardar');
    } finally { setSaving(false); }
  };

  const nombre = cliente?.Nombre || cliente?.NombreFantasia || '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* ── Qué tiene aprobado el cliente ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-indigo-600" />
          <h3 className="text-sm font-black text-slate-800">Límites aprobados{nombre ? ` · ${String(nombre).trim()}` : ''}</h3>
        </div>
        <p className="text-[11px] text-slate-500">
          Un solo límite para el cliente, en la moneda que elijas. Contra ese límite se compara <b>todo lo que debe en $ y en US$</b>, convertido al tipo de cambio. <b>Solo alerta</b> (acá y en Antigüedad de Deuda): no bloquea ventas ni retiros.
        </p>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Límite de crédito</label>
          <div className="flex items-stretch gap-2">
            <div className="flex bg-slate-100 p-1 rounded-lg shrink-0">
              {[['UYU', '$'], ['USD', 'US$']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setMoneda(v)}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${moneda === v ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {l}
                </button>
              ))}
            </div>
            <input type="number" min="0" step="0.01" value={limite} onChange={e => setLimite(e.target.value)} placeholder="Vacío = sin límite"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30" />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Hoy: {limiteActual > 0 ? `${monedaActual === 'USD' ? 'US$' : '$'} ${fmt(limiteActual)}` : 'sin límite cargado'}.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Condición de pago</label>
          <select value={condicion} onChange={e => setCondicion(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30">
            <option value="">Elegir…</option>
            {condiciones.map(c => (
              <option key={c.CPaIdCondicion} value={c.CPaIdCondicion}>
                {c.CPaNombre} — {Number(c.CPaDiasVencimiento) > 0 ? `vence a los ${c.CPaDiasVencimiento} días` : 'contado'}{c.CPaPermiteCuotas ? ` · ${c.CPaCantidadCuotas} cuotas cada ${c.CPaDiasEntreCuotas} días` : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">Hoy: {condNombreActual || 'sin definir'}. Define el vencimiento de las deudas <b>nuevas</b> (fecha del comprobante + días) en todas las cuentas del cliente; las deudas que ya existen no cambian.</p>
        </div>

        <button type="button" onClick={guardar} disabled={saving || !hayCambios}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-indigo-700 text-white rounded-lg hover:bg-indigo-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <Save size={14} /> {saving ? 'Guardando…' : hayCambios ? 'Guardar crédito y condición' : 'Sin cambios'}
        </button>
        {(!pUYU || !pUSD) && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Este cliente no tiene cuenta principal en {!pUYU ? '$' : 'US$'}: el límite solo se puede guardar en {pUYU ? '$' : 'US$'}.
          </p>
        )}
      </div>

      {/* ── Situación de hoy contra ese límite ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Scale size={16} className="text-indigo-600" />
          <h3 className="text-sm font-black text-slate-800">Situación de hoy</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Debe en $</p>
            <p className="text-lg font-black text-slate-800 tabular-nums">$ {fmt(deudaUYU)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Debe en US$</p>
            <p className="text-lg font-black text-slate-800 tabular-nums">US$ {fmt(deudaUSD)}</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-400">Deudas vivas (facturas pendientes + órdenes en cuenta corriente sin facturar), en todas las cuentas de dinero del cliente.</p>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600 shrink-0">Tipo de cambio</label>
          <input type="number" min="0" step="0.01" value={tc} onChange={e => setTc(e.target.value)}
            className="w-28 text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30 tabular-nums" />
          <span className="text-[11px] text-slate-400">$ por US${tcFecha ? ` · cotización del ${new Date(tcFecha).toLocaleDateString('es-UY')}` : ''} · se puede pisar a mano</span>
        </div>

        <div className="rounded-xl border border-slate-200 px-4 py-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total que debe en {sim}</p>
            <p className={`text-xs font-bold ${est.cls}`}>{est.pct != null ? `${Math.round(est.pct)}% · ` : ''}{est.txt}</p>
          </div>
          <p className="text-2xl font-black text-slate-800 tabular-nums mt-1">{sim} {fmt(utilizado)}{limNum > 0 ? <span className="text-sm font-bold text-slate-400"> de {sim} {fmt(limNum)}</span> : null}</p>
          {limNum > 0 && (
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
              <div className={`h-full ${est.bar}`} style={{ width: `${Math.min(est.pct || 0, 100)}%` }} />
            </div>
          )}
          {faltaTc && <p className="text-[11px] text-rose-600 mt-2">Falta el tipo de cambio: sin él no se puede convertir la deuda de la otra moneda.</p>}
          {limNum > 0 && !faltaTc && (
            <p className="text-[11px] text-slate-400 mt-2">
              Disponible: <b className={utilizado > limNum ? 'text-rose-600' : 'text-emerald-700'}>{sim} {fmt(limNum - utilizado)}</b>
              {(moneda === 'USD' ? deudaUYU : deudaUSD) > 0 && tcNum > 0 ? ` · incluye ${moneda === 'USD' ? `$ ${fmt(deudaUYU)} → US$ ${fmt(deudaUYU / tcNum)}` : `US$ ${fmt(deudaUSD)} → $ ${fmt(deudaUSD * tcNum)}`} al TC ${fmt(tcNum)}` : ''}
            </p>
          )}
          {!(limNum > 0) && <p className="text-[11px] text-slate-400 mt-2">Cargá un límite a la izquierda para ver el % utilizado y las alertas.</p>}
        </div>
      </div>
    </div>
  );
}
