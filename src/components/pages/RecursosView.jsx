// SIN USO (13/10): nunca tuvo ruta. Es la única UI para crear, recargar o cerrar un plan de recursos a mano. Ver docs/auditoria-limpieza-2026-10-09.md.
/**
 * RecursosView.jsx
 * Gestión de Planes de Recursos (Metros, KG, Unidades).
 * Permite buscar clientes con cuentas de recursos, ver sus planes activos, crear,
 * recargar y cerrar planes, y ver el historial de consumo.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Search, RefreshCw, Package, Layers, PlusCircle, X,
  AlertTriangle, CheckCircle2, TrendingDown, TrendingUp,
  RotateCcw, Archive, DollarSign,
  BarChart3, Users, Inbox, Settings, Zap,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Config ────────────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || '';
const tok = () => { try { return JSON.parse(localStorage.getItem('user'))?.token || ''; } catch { return ''; } };
const fetchAPI = async (url, opts = {}) => {
  const r = await fetch(`${API}${url}`, {
    headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!r.ok) throw new Error((await r.json()).error || `Error ${r.status}`);
  return r.json();
};

const fmtNum   = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));
const fmtFecha = (f) => f ? new Date(f).toLocaleDateString('es-UY') : '—';
const diasRestantes = (fc) => fc ? Math.ceil((new Date(fc) - new Date()) / 86400000) : null;

// ── Helpers UI ────────────────────────────────────────────────────────────────
const Badge = ({ children, color = 'slate' }) => {
  const c = {
    slate:  'bg-slate-100 text-slate-600 border-slate-200',
    green:  'bg-green-100 text-green-700 border-green-200',
    amber:  'bg-amber-100 text-amber-700 border-amber-200',
    red:    'bg-red-100 text-red-700 border-red-200',
    violet: 'bg-violet-100 text-violet-700 border-violet-200',
    blue:   'bg-blue-100 text-blue-700 border-blue-200',
  }[color] || 'bg-slate-100 text-slate-600 border-slate-200';
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${c}`}>{children}</span>;
};

// ── Barra de consumo ──────────────────────────────────────────────────────────
const BarraConsumo = ({ usado, total, unit }) => {
  const pct = total > 0 ? Math.min((usado / total) * 100, 100) : 0;
  const libre = total - usado;
  const color =
    pct >= 90 ? 'bg-red-500' :
    pct >= 70 ? 'bg-amber-500' :
    pct >= 40 ? 'bg-blue-500' :
    'bg-emerald-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>Usado: <strong className="text-slate-700">{fmtNum(usado)} {unit}</strong></span>
        <span>Libre: <strong className={pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-emerald-600'}>{fmtNum(libre)} {unit}</strong></span>
        <span className="font-mono">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-slate-400">Total: {fmtNum(total)} {unit}</div>
    </div>
  );
};

// ── Modal Nuevo Plan ──────────────────────────────────────────────────────────
const ModalNuevoPlan = ({ cuenta, CliIdCliente, onClose, onSuccess }) => {
  const [form, setForm]    = useState({
    PlaCantidadTotal:     '',
    PlaImportePagado:     '',
    PlaDescripcion:       '',
    PlaFechaVencimiento:  '',
    MetodoPagoId:         '',
    MonedaPagoId:         '',
  });
  const [metodos, setMetodos]     = useState([]);
  const [monedas, setMonedas]     = useState([]);
  const [cotizacion, setCotizacion] = useState(null);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    Promise.all([
      fetchAPI('/api/apipagos/metodos').then(d => Array.isArray(d) ? d : (d.data || [])).catch(() => []),
      fetchAPI('/api/contabilidad/monedas').then(d => d.data || []).catch(() => []),
      fetchAPI('/api/contabilidad/cotizacion-hoy').then(d => d.data || null).catch(() => null),
    ]).then(([met, mon, cot]) => {
      setMetodos(met);
      setMonedas(mon);
      setCotizacion(cot);
      if (met.length > 0) setForm(f => ({ ...f, MetodoPagoId: String(met[0].MPaIdMetodoPago) }));
      if (mon.length > 0) setForm(f => ({ ...f, MonedaPagoId: String(mon[0].MonIdMoneda) }));
    });
  }, []);

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.PlaCantidadTotal || Number(form.PlaCantidadTotal) <= 0) {
      toast.error('La cantidad debe ser mayor a 0'); return;
    }
    setSaving(true);
    try {
      await fetchAPI('/api/contabilidad/planes', {
        method: 'POST',
        body: JSON.stringify({
          CueIdCuenta:         cuenta.CueIdCuenta,
          CliIdCliente,
          ProIdProducto:       cuenta.ProIdProducto,
          PlaCantidadTotal:    Number(form.PlaCantidadTotal),
          PlaDescripcion:      form.PlaDescripcion || null,
          PlaFechaVencimiento: form.PlaFechaVencimiento || null,
          PlaImportePagado:    form.PlaImportePagado ? Number(form.PlaImportePagado) : null,
          MonedaPagoId:        form.MonedaPagoId  || null,
          MetodoPagoId:        form.MetodoPagoId  || null,
        }),
      });
      toast.success('✅ Plan creado correctamente');
      onSuccess();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const unit = cuenta.CueTipo;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 "
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[92vh] overflow-y-auto">

        <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-r from-violet-500 to-purple-600 text-white sticky top-0">
          <div>
            <p className="text-xs uppercase tracking-widest opacity-80">Cuenta #{cuenta.CueIdCuenta} · {unit}</p>
            <h2 className="text-lg font-bold mt-0.5">Nuevo Plan de Recursos</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg"><X size={16} /></button>
        </div>

        <form onSubmit={guardar} className="px-6 py-5 space-y-4">

          {/* Cantidad */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Cantidad a comprar ({unit}) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Package size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-400" />
              <input type="number" min="0.01" step="0.01" required
                value={form.PlaCantidadTotal}
                onChange={e => setForm(f => ({ ...f, PlaCantidadTotal: e.target.value }))}
                placeholder={`Ej: 500`}
                className="w-full pl-8 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 font-mono" />
            </div>
          </div>

          {/* Vencimiento */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de vencimiento (opcional)</label>
            <input type="date"
              value={form.PlaFechaVencimiento}
              onChange={e => setForm(f => ({ ...f, PlaFechaVencimiento: e.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400" />
          </div>

          {/* Pago */}
          <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 space-y-3">
            <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
              <DollarSign size={12} /> Pago asociado (opcional)
            </p>

            <div>
              <label className="block text-xs text-slate-600 mb-1">Importe pagado</label>
              <input type="number" min="0" step="0.01"
                value={form.PlaImportePagado}
                onChange={e => setForm(f => ({ ...f, PlaImportePagado: e.target.value }))}
                placeholder="0,00"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 font-mono bg-white" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Moneda</label>
                <select value={form.MonedaPagoId}
                  onChange={e => setForm(f => ({ ...f, MonedaPagoId: e.target.value }))}
                  className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400">
                  {monedas.map(m => (
                    <option key={m.MonIdMoneda} value={m.MonIdMoneda}>{m.MonSimbolo} — {m.MonNombre}</option>
                  ))}
                  {monedas.length === 0 && <option value="">Cargando...</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Forma de pago</label>
                <select value={form.MetodoPagoId}
                  onChange={e => setForm(f => ({ ...f, MetodoPagoId: e.target.value }))}
                  className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400">
                  {metodos.map(m => (
                    <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>
                  ))}
                  {metodos.length === 0 && <option value="">Cargando...</option>}
                </select>
              </div>
            </div>

            {cotizacion && (
              <p className="text-[10px] text-emerald-600 bg-emerald-100 px-2 py-1 rounded">
                TC del día — Compra: {cotizacion.compra} / Venta: {cotizacion.venta} / Prom: {cotizacion.promedio}
              </p>
            )}
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Descripción / Referencia (opcional)</label>
            <input type="text"
              value={form.PlaDescripcion}
              onChange={e => setForm(f => ({ ...f, PlaDescripcion: e.target.value }))}
              placeholder={`Ej: Rollo Mar-2026, Compra mayo...`}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm text-white font-semibold bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <PlusCircle size={14} />}
              Crear Plan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Modal Recarga ─────────────────────────────────────────────────────────────
const ModalRecarga = ({ plan, onClose, onSuccess }) => {
  const [form, setForm]  = useState({ CantidadAdicional: '', ImportePagado: '', MetodoPagoId: '', MonedaPagoId: '' });
  const [metodos, setMetodos] = useState([]);
  const [monedas, setMonedas] = useState([]);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    Promise.all([
      fetchAPI('/api/apipagos/metodos').then(d => Array.isArray(d) ? d : (d.data || [])).catch(() => []),
      fetchAPI('/api/contabilidad/monedas').then(d => d.data || []).catch(() => []),
    ]).then(([met, mon]) => {
      setMetodos(met);
      setMonedas(mon);
      if (met.length > 0) setForm(f => ({ ...f, MetodoPagoId: String(met[0].MPaIdMetodoPago) }));
      if (mon.length > 0) setForm(f => ({ ...f, MonedaPagoId: String(mon[0].MonIdMoneda) }));
    });
  }, []);

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.CantidadAdicional || Number(form.CantidadAdicional) <= 0) {
      toast.error('La cantidad debe ser mayor a 0'); return;
    }
    setSaving(true);
    try {
      await fetchAPI(`/api/contabilidad/planes/${plan.PlaIdPlan}/recargar`, {
        method: 'POST',
        body: JSON.stringify({
          CantidadAdicional: Number(form.CantidadAdicional),
          ImportePagado:     form.ImportePagado ? Number(form.ImportePagado) : null,
          MetodoPagoId:      form.MetodoPagoId || null,
          MonedaPagoId:      form.MonedaPagoId || null,
        }),
      });
      toast.success('✅ Plan recargado');
      onSuccess();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const libre = (plan.PlaCantidadTotal - plan.PlaCantidadUsada) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 "
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
          <div>
            <p className="text-xs uppercase tracking-widest opacity-80">Plan #{plan.PlaIdPlan}</p>
            <h2 className="text-lg font-bold mt-0.5">Recargar Plan</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg"><X size={16} /></button>
        </div>

        <div className="px-6 pt-4">
          <div className="bg-blue-50 rounded-xl p-3 border border-blue-200 text-sm">
            <p className="text-xs text-blue-600 font-semibold mb-1">Estado actual</p>
            <div className="flex gap-4 text-xs">
              <span>Total: <strong>{fmtNum(plan.PlaCantidadTotal)} {plan.PlaUnidad}</strong></span>
              <span>Usado: <strong>{fmtNum(plan.PlaCantidadUsada)} {plan.PlaUnidad}</strong></span>
              <span>Libre: <strong className={libre < (plan.PlaCantidadTotal * 0.1) ? 'text-red-600' : 'text-emerald-600'}>{fmtNum(libre)} {plan.PlaUnidad}</strong></span>
            </div>
          </div>
        </div>

        <form onSubmit={guardar} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Cantidad a agregar ({plan.PlaUnidad}) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Package size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400" />
              <input type="number" min="0.01" step="0.01" required
                value={form.CantidadAdicional}
                onChange={e => setForm(f => ({ ...f, CantidadAdicional: e.target.value }))}
                placeholder="Ej: 500"
                className="w-full pl-8 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-mono" />
            </div>
            {form.CantidadAdicional && Number(form.CantidadAdicional) > 0 && (
              <p className="text-[11px] text-blue-600 mt-1">
                Nuevo total: <strong>{fmtNum(Number(plan.PlaCantidadTotal) + Number(form.CantidadAdicional))} {plan.PlaUnidad}</strong>
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Importe pagado (opcional)</label>
              <input type="number" min="0" step="0.01"
                value={form.ImportePagado}
                onChange={e => setForm(f => ({ ...f, ImportePagado: e.target.value }))}
                placeholder="0,00"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Moneda</label>
                <select value={form.MonedaPagoId}
                  onChange={e => setForm(f => ({ ...f, MonedaPagoId: e.target.value }))}
                  className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none">
                  {monedas.map(m => (
                    <option key={m.MonIdMoneda} value={m.MonIdMoneda}>{m.MonSimbolo} — {m.MonNombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Forma de pago</label>
                <select value={form.MetodoPagoId}
                  onChange={e => setForm(f => ({ ...f, MetodoPagoId: e.target.value }))}
                  className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none">
                  {metodos.map(m => (
                    <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm text-white font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Recargar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Tarjeta de Plan ───────────────────────────────────────────────────────────
const PlanCard = ({ plan, onRecargar, onDesactivar, onHistorial }) => {
  const usado     = Number(plan.PlaCantidadUsada  ?? 0);
  const total     = Number(plan.PlaCantidadTotal  ?? 0);
  const libre     = total - usado;
  const pct       = total > 0 ? (usado / total) * 100 : 0;
  const dias      = diasRestantes(plan.PlaFechaVencimiento);
  const vencido   = dias !== null && dias < 0;
  const urgente   = dias !== null && dias >= 0 && dias <= 7;
  const agotado   = libre <= 0;

  const estado = vencido ? 'VENCIDO' : agotado ? 'AGOTADO' : pct >= 90 ? 'CRÍTICO' : pct >= 70 ? 'BAJO' : 'ACTIVO';
  const colorEstado = {
    VENCIDO: 'red', AGOTADO: 'red', CRÍTICO: 'amber', BAJO: 'amber', ACTIVO: 'green',
  }[estado];

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${
      vencido || agotado ? 'border-red-200 opacity-75' : pct >= 90 ? 'border-amber-200' : 'border-slate-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${
        vencido || agotado ? 'bg-red-50' : pct >= 90 ? 'bg-amber-50' : 'bg-violet-50'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            vencido || agotado ? 'bg-red-100' : 'bg-violet-100'
          }`}>
            <Package size={15} className={vencido || agotado ? 'text-red-600' : 'text-violet-600'} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">Plan #{plan.PlaIdPlan}</p>
            {plan.PlaDescripcion && <p className="text-[11px] text-slate-500">{plan.PlaDescripcion}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge color={colorEstado}>{estado}</Badge>
          {plan.NombreArticulo && (
            <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-2 py-0.5 rounded">
              {plan.NombreArticulo}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Barra de consumo */}
        <BarraConsumo usado={usado} total={total} unit={plan.PlaUnidad || 'u'} />

        {/* Fechas y pago */}
        <div className="grid grid-cols-3 gap-2 text-center border-t border-slate-100 pt-3">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Inicio</p>
            <p className="text-xs font-semibold text-slate-700">{fmtFecha(plan.PlaFechaInicio)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Vencimiento</p>
            <p className={`text-xs font-semibold ${vencido ? 'text-red-600' : urgente ? 'text-amber-600' : 'text-slate-700'}`}>
              {plan.PlaFechaVencimiento ? (
                <>
                  {fmtFecha(plan.PlaFechaVencimiento)}
                  {dias !== null && (
                    <span className="ml-1 text-[10px]">({dias < 0 ? `${Math.abs(dias)}d venc.` : `${dias}d`})</span>
                  )}
                </>
              ) : 'Sin límite'}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Pagado</p>
            <p className="text-xs font-semibold text-slate-700">
              {plan.PlaImportePagado ? `${plan.MonSimbolo || '$U'} ${Number(plan.PlaImportePagado).toLocaleString('es-UY')}` : '—'}
            </p>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <button onClick={() => onHistorial(plan)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
            <BarChart3 size={11} /> Historial
          </button>
          <button onClick={() => onRecargar(plan)}
            disabled={vencido}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <RotateCcw size={11} /> Recargar
          </button>
          <button onClick={() => onDesactivar(plan)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors ml-auto">
            <Archive size={11} /> Cerrar plan
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Panel Historial de consumo ────────────────────────────────────────────────
const HistorialPanel = ({ plan, onClose }) => {
  const [movs, setMovs]       = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchAPI(`/api/contabilidad/cuentas/${plan.CueIdCuenta}/movimientos?top=50`)
      .then(d => setMovs(d.data || []))
      .catch(() => setMovs([]))
      .finally(() => setLoading(false));
  }, [plan.CueIdCuenta]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 "
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-r from-slate-700 to-slate-800 text-white">
          <div>
            <p className="text-xs uppercase tracking-widest opacity-60">Plan #{plan.PlaIdPlan}</p>
            <h2 className="text-lg font-bold mt-0.5">Historial de consumo</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <RefreshCw size={18} className="animate-spin mr-2" /> Cargando...
            </div>
          ) : movs.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Inbox size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin movimientos aún</p>
            </div>
          ) : (
            movs.map((m, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  m.MovTipo === 'ENTREGA' ? 'bg-amber-100' :
                  m.MovTipo === 'RECARGA' ? 'bg-blue-100' :
                  'bg-violet-100'
                }`}>
                  {m.MovTipo === 'ENTREGA' ? <TrendingDown size={12} className="text-amber-600" /> :
                   m.MovTipo === 'RECARGA' ? <RotateCcw size={12} className="text-blue-600" /> :
                   <PlusCircle size={12} className="text-violet-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">{m.MovConcepto}</p>
                  <p className="text-[10px] text-slate-400">{fmtFecha(m.MovFecha)}</p>
                </div>
                <span className={`text-xs font-bold font-mono shrink-0 ${
                  m.MovImporte > 0 ? 'text-emerald-600' : 'text-red-600'
                }`}>
                  {m.MovImporte > 0 ? '+' : ''}{fmtNum(m.MovImporte)} {plan.PlaUnidad}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ── Modal Nueva Cuenta de Recursos ──────────────────────────────────────────
const ModalNuevaCuenta = ({ CliIdCliente, onClose, onSuccess }) => {
  const [grupos, setGrupos]           = useState([]);
  const [grupSel, setGrupSel]         = useState('');      // CodigoERP seleccionado
  const [articulos, setArticulos]     = useState([]);
  const [artSel, setArtSel]           = useState(null);
  const [unidadManual, setUnidadManual] = useState('');
  const [loadingGrupos, setLoadingGrupos] = useState(false);
  const [loadingArts, setLoadingArts] = useState(false);
  const [saving, setSaving]           = useState(false);

  const unidad = artSel?.UnidadMedida?.trim() || unidadManual;

  // Cargar grupos al montar
  useEffect(() => {
    setLoadingGrupos(true);
    fetchAPI('/api/contabilidad/grupos-erp')
      .then(d => setGrupos(d.data || []))
      .catch(() => setGrupos([]))
      .finally(() => setLoadingGrupos(false));
  }, []);

  // Cuando cambia el grupo → cargar artículos
  useEffect(() => {
    if (!grupSel) { setArticulos([]); setArtSel(null); return; }
    setArtSel(null);
    setLoadingArts(true);
    fetchAPI(`/api/contabilidad/articulos?grupo=${encodeURIComponent(grupSel)}`)
      .then(d => setArticulos(d.data || []))
      .catch(() => setArticulos([]))
      .finally(() => setLoadingArts(false));
  }, [grupSel]);

  const guardar = async (e) => {
    e.preventDefault();
    if (!artSel)  { toast.error('Seleccioná un artículo'); return; }
    if (!unidad)  { toast.error('Ingresá la unidad de medida'); return; }
    setSaving(true);
    try {
      await fetchAPI('/api/contabilidad/cuentas', {
        method: 'POST',
        body: JSON.stringify({
          CliIdCliente,
          // Guardamos el nombre completo de la unidad como tipo
          // (ej: "Metros" en vez de "mts") para que sea descriptivo
          CueTipo:       artSel.UniNombre || unidad.toUpperCase(),
          ProIdProducto: artSel.IDArticulo,
        }),
      });
      toast.success(`✅ Cuenta ${artSel.NombreArticulo} (${artSel.UniNombre || unidad}) creada`);
      onSuccess();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const grupoObj = grupos.find(g => g.CodigoERP === grupSel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 "
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-r from-indigo-500 to-violet-600 text-white">
          <div>
            <p className="text-xs uppercase tracking-widest opacity-80">Cliente #{CliIdCliente}</p>
            <h2 className="text-lg font-bold mt-0.5">Nueva cuenta de recursos</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg"><X size={16} /></button>
        </div>

        <form onSubmit={guardar} className="px-6 py-5 space-y-4">

          {/* PASO 1 — Grupo ERP */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Grupo / Familia <span className="text-red-500">*</span>
            </label>
            {loadingGrupos ? (
              <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                <RefreshCw size={11} className="animate-spin" /> Cargando grupos...
              </div>
            ) : (
              <select value={grupSel}
                onChange={e => { setGrupSel(e.target.value); }}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-white">
                <option value="">— Seleccioná un grupo —</option>
                {grupos.map(g => (
                  <option key={g.CodigoERP} value={g.CodigoERP}>
                    {g.CodigoERP} — {g.NombreReferencia}
                  </option>
                ))}
              </select>
            )}
            {grupoObj && (
              <p className="text-[10px] text-violet-600 mt-1 font-semibold">
                Área: {grupoObj.AreaID_Interno}
              </p>
            )}
          </div>

          {/* PASO 2 — Artículo del grupo */}
          {grupSel && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Artículo <span className="text-red-500">*</span>
                <span className="ml-1 text-slate-400 font-normal">({articulos.length} disponibles)</span>
              </label>
              {loadingArts ? (
                <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                  <RefreshCw size={11} className="animate-spin" /> Cargando artículos...
                </div>
              ) : (
                <select value={artSel?.IDArticulo || ''}
                  onChange={e => {
                    const found = articulos.find(a => String(a.IDArticulo) === e.target.value);
                    setArtSel(found || null);
                    setUnidadManual('');
                  }}
                  size={Math.min(articulos.length + 1, 6)}
                  className="w-full border border-slate-200 rounded-lg text-xs py-1 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/30">
                  <option value="">— Elegí un artículo —</option>
                  {articulos.map(a => (
                    <option key={a.IDArticulo} value={a.IDArticulo}>
                      {a.CodigoArticulo} — {a.NombreArticulo}
                      {a.UnidadMedida ? ` (${a.UnidadMedida})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {articulos.length === 0 && !loadingArts && (
                <p className="text-[11px] text-amber-600 mt-1">⚠️ Sin artículos en este grupo</p>
              )}
            </div>
          )}

          {/* Artículo seleccionado — resumen */}
          {artSel && (
            <div className="flex items-center justify-between px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg">
              <div>
                <p className="text-xs font-bold text-violet-800">{artSel.NombreArticulo}</p>
                <p className="text-[10px] text-violet-500">{artSel.CodigoArticulo} · Grupo: {artSel.Grupo}</p>
              </div>
              {artSel.UnidadMedida ? (
                <span className="px-2 py-0.5 bg-violet-200 text-violet-800 text-xs font-bold rounded-full">
                  {artSel.UnidadMedida}
                </span>
              ) : (
                <span className="text-[10px] text-amber-500">sin unidad</span>
              )}
            </div>
          )}

          {/* Unidad manual si el artículo no la tiene */}
          {artSel && !artSel.UnidadMedida?.trim() && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Unidad de medida <span className="text-red-500">*</span>
                <span className="ml-1 text-amber-500 text-[10px] font-normal">⚠️ No registrada en el artículo</span>
              </label>
              <input type="text"
                value={unidadManual}
                onChange={e => setUnidadManual(e.target.value.toUpperCase())}
                placeholder="Ej: M, KG, UN, HRS..."
                maxLength={10}
                className="w-full px-3 py-2.5 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300/50 font-mono uppercase" />
            </div>
          )}

          {/* Resumen final */}
          {artSel && unidad && (
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs text-slate-600 space-y-1">
              <p>📦 <strong>Artículo:</strong> {artSel.NombreArticulo}</p>
              <p>📏 <strong>Unidad / Tipo cuenta:</strong> <span className="font-bold text-violet-700">{unidad.toUpperCase()}</span></p>
              <p className="text-[10px] text-slate-400 pt-1">Luego podrás cargar el primer plan con la cantidad inicial.</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving || !artSel || !unidad}
              className="flex-1 py-2.5 rounded-lg text-sm text-white font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Settings size={14} />}
              Crear Cuenta
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Vista Principal ───────────────────────────────────────────────────────────
export default function RecursosView() {
  const [busqueda, setBusqueda]             = useState('');
  const [clientes, setClientes]             = useState([]);
  const [clienteSel, setClienteSel]         = useState(null);
  const [cuentasRecurso, setCuentasRecurso] = useState([]);
  const [planesMap, setPlanesMap]           = useState({});
  const [loadingLista, setLoadingLista]     = useState(false);
  const [loadingPlanes, setLoadingPlanes]   = useState(false);
  const [modalNuevoPlan, setModalNuevoPlan] = useState(null);
  const [modalRecarga, setModalRecarga]     = useState(null);
  const [modalHistorial, setModalHistorial] = useState(null);
  const [modalNuevaCuenta, setModalNuevaCuenta] = useState(false);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);

  // Cargar clientes con cuentas de recursos
  const cargarClientes = useCallback(async (q = '') => {
    setLoadingLista(true);
    try {
      const params = new URLSearchParams({ tipo: 'RECURSOS' });
      if (q.trim()) params.set('q', q.trim());
      const data = await fetchAPI(`/api/contabilidad/clientes-activos?${params}`);
      // Filtrar solo los que tienen cuentas de tipo METROS/KG/UNIDADES
      const todos = data.data || [];
      setClientes(todos);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingLista(false); }
  }, []);

  useEffect(() => { cargarClientes(); }, [cargarClientes]);

  // Seleccionar cliente → cargar sus cuentas de recursos y planes
  const seleccionarCliente = async (cli) => {
    if (clienteSel?.CliIdCliente === cli.CliIdCliente) {
      setClienteSel(null); setCuentasRecurso([]); setPlanesMap({}); return;
    }
    setClienteSel(cli);
    setCuentasRecurso([]);
    setPlanesMap({});
    setLoadingPlanes(true);
    try {
      const cuentasData = await fetchAPI(`/api/contabilidad/cuentas/${cli.CliIdCliente}`);
      // Excluir cuentas monetarias — divisas y tipos de cuenta corriente/crédito
      const TIPOS_MONETARIOS = ['USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA'];
      const cuentas = (cuentasData.data || []).filter(c => {
        const t = c.CueTipo?.toUpperCase();
        // Excluir si es divisa o tipo monetario conocido
        if (TIPOS_MONETARIOS.includes(t)) return false;
        // Excluir si CueTipo == null o vacío
        if (!t) return false;
        // Incluir todo lo demás (MTS, UNI, KG, metros, etc.)
        return true;
      });
      setCuentasRecurso(cuentas);

      // Cargar planes de cada cuenta en paralelo
      const mapa = {};
      await Promise.all(cuentas.map(async (c) => {
        try {
          const planes = await fetchAPI(`/api/contabilidad/planes/${cli.CliIdCliente}?CueIdCuenta=${c.CueIdCuenta}`);
          mapa[c.CueIdCuenta] = planes.data || [];
        } catch { mapa[c.CueIdCuenta] = []; }
      }));
      setPlanesMap(mapa);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingPlanes(false); }
  };

  const recargar = async () => {
    if (!clienteSel) return;
    await seleccionarCliente(clienteSel);
  };

  const desactivarPlan = async (plan) => {
    if (!confirm(`¿Cerrar el Plan #${plan.PlaIdPlan}? Esta acción no se puede deshacer.`)) return;
    try {
      await fetchAPI(`/api/contabilidad/planes/${plan.PlaIdPlan}/desactivar`, { method: 'PATCH' });
      toast.success('Plan cerrado correctamente');
      recargar();
    } catch (err) { toast.error(err.message); }
  };

  // Estadísticas del cliente seleccionado
  const statsCliente = () => {
    const todos = Object.values(planesMap).flat();
    const activos = todos.filter(p => p.PlaActivo);
    const totalLibre = activos.reduce((a, p) => a + (Number(p.PlaCantidadTotal) - Number(p.PlaCantidadUsada)), 0);
    return { totalPlanes: todos.length, planesActivos: activos.length, totalLibre };
  };

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden">

      {/* ── Panel izquierdo: lista clientes ──────────────────────────────────── */}
      <div className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col">

        <div className="px-4 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
              <Layers size={16} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Planes de Recursos</h2>
              <p className="text-[10px] text-slate-400">Metros · KG · Unidades</p>
            </div>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={busqueda}
              onChange={e => { setBusqueda(e.target.value); cargarClientes(e.target.value); }}
              placeholder="Buscar cliente..."
              className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingLista ? (
            <div className="flex items-center justify-center py-10 text-slate-400 text-xs gap-2">
              <RefreshCw size={13} className="animate-spin" /> Cargando...
            </div>
          ) : clientes.length === 0 ? (
            <div className="text-center py-10 text-slate-400 px-4">
              <Users size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-xs">No hay clientes con cuentas de recursos</p>
            </div>
          ) : (
            clientes.map(cli => {
              const sel = clienteSel?.CliIdCliente === cli.CliIdCliente;
              return (
                <button key={cli.CliIdCliente} onClick={() => seleccionarCliente(cli)}
                  className={`w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors border-b border-slate-100
                    ${sel ? 'bg-violet-50 border-l-4 border-l-violet-500' : 'border-l-4 border-l-transparent'}`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-700 shrink-0">
                      {cli.Nombre?.[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm font-semibold text-slate-800 truncate flex-1">{cli.Nombre}</span>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">#{cli.CodCliente || cli.CliIdCliente}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Panel derecho: planes del cliente ────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">

        {!clienteSel ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Layers size={48} className="mb-4 opacity-20" />
            <p className="text-lg font-semibold">Seleccioná un cliente</p>
            <p className="text-sm mt-1">Para ver y gestionar sus planes de recursos</p>
          </div>
        ) : loadingPlanes ? (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2">
            <RefreshCw size={18} className="animate-spin" /> Cargando planes...
          </div>
        ) : (
          <div className="space-y-6">

            {/* Header cliente */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-black text-slate-800">{clienteSel.Nombre}</h1>
                <p className="text-sm text-slate-500">#{clienteSel.CodCliente || clienteSel.CliIdCliente}</p>
              </div>
              <div className="flex items-center gap-2">
                {/* ── Botón Nueva cuenta SIEMPRE visible ─────────────────── */}
                <button onClick={() => setModalNuevaCuenta(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors font-semibold shadow-sm">
                  <PlusCircle size={11} /> Nueva cuenta
                </button>
                <button onClick={recargar}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors">
                  <RefreshCw size={11} /> Actualizar
                </button>
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={mostrarInactivos} onChange={e => setMostrarInactivos(e.target.checked)}
                    className="rounded" />
                  Ver inactivos
                </label>
              </div>
            </div>

            {/* Stats */}
            {(() => { const s = statsCliente(); return (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Planes activos', value: s.planesActivos, icon: <CheckCircle2 size={16} />, color: 'green' },
                  { label: 'Total planes',   value: s.totalPlanes,   icon: <Layers size={16} />,       color: 'violet' },
                  { label: 'Saldo libre',    value: `${fmtNum(s.totalLibre)} u`, icon: <Package size={16} />, color: 'blue' },
                ].map((st, i) => (
                  <div key={i} className={`bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      st.color === 'green' ? 'bg-green-100 text-green-600' :
                      st.color === 'violet' ? 'bg-violet-100 text-violet-600' : 'bg-blue-100 text-blue-600'
                    }`}>{st.icon}</div>
                    <div>
                      <p className="text-[11px] text-slate-400">{st.label}</p>
                      <p className="text-base font-black text-slate-800">{st.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            ); })()}

            {/* Cuentas + Planes */}
            {cuentasRecurso.length === 0 ? (
              // ── Sin cuentas: panel de alta ───────────────────────────────
              <div className="bg-white rounded-2xl border-2 border-dashed border-violet-200 p-8 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto">
                  <Layers size={28} className="text-violet-500" />
                </div>
                <div>
                  <p className="text-base font-bold text-slate-700">Sin cuentas de recursos</p>
                  <p className="text-sm text-slate-500 mt-1">Este cliente aún no tiene configurada ninguna cuenta de metros, KG o unidades.</p>
                </div>
                <div className="flex flex-col gap-2 max-w-xs mx-auto">
                  <button onClick={() => setModalNuevaCuenta(true)}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 transition-colors shadow-sm">
                    <PlusCircle size={15} /> Configurar cuenta de recursos
                  </button>
                  <p className="text-[11px] text-slate-400">Podrás elegir el tipo (Metros / KG / Unidades) y el artículo asociado.</p>
                </div>
              </div>
            ) : (
              cuentasRecurso.map(cuenta => {
                const planes = (planesMap[cuenta.CueIdCuenta] || [])
                  .filter(p => mostrarInactivos ? true : p.PlaActivo);

                return (
                  <div key={cuenta.CueIdCuenta} className="space-y-3">

                    {/* Encabezado cuenta */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-px flex-1 w-8 bg-violet-200" />
                        <span className="text-xs font-bold text-violet-700 uppercase tracking-widest px-2">
                          {cuenta.UnidadLabel || cuenta.CueTipo} {cuenta.NombreArticulo && `— ${cuenta.NombreArticulo}`}
                        </span>
                        <div className="h-px flex-1 w-8 bg-violet-200" />
                      </div>
                      <button onClick={() => setModalNuevoPlan(cuenta)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors font-semibold">
                        <PlusCircle size={11} /> Nuevo plan
                      </button>
                    </div>

                    {/* Lista de planes */}
                    {planes.length === 0 ? (
                      <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-400">
                        <Package size={24} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Sin planes {mostrarInactivos ? '' : 'activos'}</p>
                        <button onClick={() => setModalNuevoPlan(cuenta)}
                          className="mt-2 text-xs text-violet-600 hover:underline">
                          + Crear primer plan
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {planes.map(plan => (
                          <PlanCard key={plan.PlaIdPlan} plan={plan}
                            onRecargar={p => setModalRecarga(p)}
                            onDesactivar={desactivarPlan}
                            onHistorial={p => setModalHistorial(p)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── Modales ──────────────────────────────────────────────────────────── */}
      {modalNuevaCuenta && clienteSel && (
        <ModalNuevaCuenta
          CliIdCliente={clienteSel.CliIdCliente}
          onClose={() => setModalNuevaCuenta(false)}
          onSuccess={recargar} />
      )}
      {modalNuevoPlan && (
        <ModalNuevoPlan
          cuenta={modalNuevoPlan}
          CliIdCliente={clienteSel.CliIdCliente}
          onClose={() => setModalNuevoPlan(null)}
          onSuccess={recargar} />
      )}
      {modalRecarga && (
        <ModalRecarga
          plan={modalRecarga}
          onClose={() => setModalRecarga(null)}
          onSuccess={recargar} />
      )}
      {modalHistorial && (
        <HistorialPanel
          plan={modalHistorial}
          onClose={() => setModalHistorial(null)} />
      )}
    </div>
  );
}
