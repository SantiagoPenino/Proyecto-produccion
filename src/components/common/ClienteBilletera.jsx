import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Wallet, Coins, Layers, Loader2, Zap, Activity, FileText, ChevronDown } from 'lucide-react';
import { codigoCuenta } from '../../utils/cuentaCodigo';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ClienteBilletera = ({ clienteId, clienteNombre, agrupado = false, onElegirCuenta = null }) => {
  const [loading, setLoading] = useState(false);
  const [cuentas, setCuentas] = useState([]);
  const [planes, setPlanes] = useState([]);
  const [deudas, setDeudas] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  // Layout agrupado: qué grupo está desplegado ('UYU' | 'USD' | 'REC' | null)
  const [expandido, setExpandido] = useState(null);

  useEffect(() => {
    if (!clienteId) return;
    const loadData = async () => {
      setLoading(true);
      try {
        const [resCuentas, resPlanes, resDeudas, resOrdenes] = await Promise.all([
          api.get(`/contabilidad/cuentas/${clienteId}`),
          api.get(`/contabilidad/planes/${clienteId}?solo_activos=true`),
          api.get(`/contabilidad/clientes/${clienteId}/deudas-vivas`),
          api.get(`/contabilidad/clientes/${clienteId}/ordenes-anticipo`).catch(() => ({ data: { success: false } }))
        ]);
        if (resCuentas.data.success) setCuentas(resCuentas.data.data);
        if (resPlanes.data.success) setPlanes(resPlanes.data.data);
        if (resDeudas.data.success) setDeudas(resDeudas.data.data);
        if (resOrdenes.data.success) setOrdenes(resOrdenes.data.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [clienteId]);

  if (!clienteId) return null;

  const mCuentas = cuentas.filter(c => ['USD', 'UYU', 'DINERO_USD', 'DINERO_UYU', 'CORRIENTE', 'CREDITO'].includes(c.CueTipo?.toUpperCase()));
  // Billetera: puede haber varias cuentas por moneda — el chip grande muestra la PRINCIPAL;
  // las secundarias (con nombre / restringidas) van en chips propios más abajo.
  const dineroUYU = mCuentas.filter(c => c.CueTipo?.includes('UYU') || c.MonIdMoneda === 1);
  const dineroUSD = mCuentas.filter(c => c.CueTipo?.includes('USD') || c.MonIdMoneda === 2);
  const ctaUYU = dineroUYU.find(c => c.CueEsPrincipal) || dineroUYU[0];
  const ctaUSD = dineroUSD.find(c => c.CueEsPrincipal) || dineroUSD[0];
  const cuentasSecundarias = mCuentas.filter(c => c !== ctaUYU && c !== ctaUSD && (c.CueNombre || c.CueRestringida || !c.CueEsPrincipal));

  // Conteos por moneda (US$ vs $): órdenes pendientes por cuenta; deudas por símbolo
  const esUSD = (sym) => /US\$|USD/i.test(sym || '');
  const ordenesUSD = ctaUSD ? ordenes.filter(o => o.CueIdCuenta === ctaUSD.CueIdCuenta).length : 0;
  const ordenesUYU = ctaUYU ? ordenes.filter(o => o.CueIdCuenta === ctaUYU.CueIdCuenta).length : 0;
  const deudasUSD  = deudas.filter(d => esUSD(d.MonSimbolo)).length;
  const deudasUYU  = deudas.length - deudasUSD;
  const deudaImpUSD = deudas.filter(d => esUSD(d.MonSimbolo)).reduce((s, d) => s + Number(d.DDeImportePendiente || 0), 0);
  const deudaImpUYU = deudas.filter(d => !esUSD(d.MonSimbolo)).reduce((s, d) => s + Number(d.DDeImportePendiente || 0), 0);

  // ── Chips de saldos (dinero + pendiente facturar + deudas vivas) ───────────
  const saldoChips = [
    /* Saldo Pesos */
    <div key="uyu" className={`flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all shadow-sm ${ctaUYU?.CueSaldoActual < 0 ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-brand-cyan/10 border-brand-cyan/20 text-brand-cyan'}`}>
      <Coins size={14} className="opacity-80" />
      <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">UYU</span>
      <span className="text-sm font-black text-slate-900 font-mono italic">$ {fmt(ctaUYU?.CueSaldoActual)}</span>
    </div>,
    /* Saldo Dólares */
    <div key="usd" className="flex items-center gap-2 px-4 py-2 rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-sm">
      <Activity size={14} className="opacity-80" />
      <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">USD</span>
      <span className="text-sm font-black text-slate-900 font-mono italic">U$ {fmt(ctaUSD?.CueSaldoActual)}</span>
    </div>,
    /* Pendiente Facturar (si existe) */
    (Number(ctaUYU?.PendienteFacturar || 0) > 0 || Number(ctaUSD?.PendienteFacturar || 0) > 0) && (
      <div key="pend" className="flex items-center gap-2 px-4 py-2 rounded-2xl border border-amber-200 bg-amber-50 text-amber-700 shadow-[0_4px_12px_rgba(245,158,11,0.1)]">
        <FileText size={14} className="opacity-80" />
        <div className="flex flex-col">
           <span className="text-[9px] font-black uppercase tracking-tighter opacity-70">
             Pendiente Facturar{ordenes.length > 0 && <span className="ml-1 opacity-90">· {ordenes.length} órd.</span>}
           </span>
           <div className="flex items-center gap-2 text-xs font-black text-slate-900 font-mono">
             {Number(ctaUYU?.PendienteFacturar || 0) > 0 && <span>$ {fmt(ctaUYU?.PendienteFacturar)}{ordenesUYU > 0 && <span className="opacity-60 font-bold"> ({ordenesUYU})</span>}</span>}
             {Number(ctaUSD?.PendienteFacturar || 0) > 0 && <span>U$ {fmt(ctaUSD?.PendienteFacturar)}{ordenesUSD > 0 && <span className="opacity-60 font-bold"> ({ordenesUSD})</span>}</span>}
           </div>
        </div>
      </div>
    ),
    /* Alerta de Deuda Viva (Documentos Pendientes) */
    deudas.length > 0 && (
      <div key="deudas"
        className="flex items-center gap-2 px-4 py-2 rounded-2xl border border-rose-200 bg-white text-rose-600 shadow-[0_4px_12px_rgba(225,29,72,0.1)] animate-pulse cursor-help group relative ring-1 ring-rose-500/10"
      >
        <div className="bg-rose-100 p-1 rounded-lg">
           <FileText size={14} className="group-hover:scale-125 transition-transform text-rose-600" />
        </div>
        <div className="flex flex-col leading-tight">
           <span className="text-[11px] font-black uppercase tracking-tight">{deudas.length} DEUDAS VIVAS</span>
           {(deudasUYU > 0 || deudasUSD > 0) && (
             <span className="text-[9px] font-bold text-rose-400 tracking-tight">
               {deudasUYU > 0 && <span>{deudasUYU} en $</span>}
               {deudasUYU > 0 && deudasUSD > 0 && <span className="opacity-50"> · </span>}
               {deudasUSD > 0 && <span>{deudasUSD} en US$</span>}
             </span>
           )}
        </div>

        {/* Tooltip: solo cantidad e importe por moneda */}
        <div className="absolute top-full left-0 mt-2 p-3 bg-white border border-slate-200 rounded-2xl shadow-[0_20px_40px_rgba(15,23,42,0.18)] z-[9999] hidden group-hover:block min-w-[220px] ring-4 ring-black/5 animate-in fade-in zoom-in-95 duration-150">
           <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Deudas vivas por moneda</h4>
           <div className="flex flex-col gap-1.5">
              {deudasUYU > 0 && (
                <div className="flex items-center justify-between gap-4">
                   <span className="text-xs font-bold text-slate-600">$ · {deudasUYU} {deudasUYU === 1 ? 'deuda' : 'deudas'}</span>
                   <span className="text-sm font-black text-rose-600 font-mono tabular-nums">$ {fmt(deudaImpUYU)}</span>
                </div>
              )}
              {deudasUSD > 0 && (
                <div className="flex items-center justify-between gap-4">
                   <span className="text-xs font-bold text-slate-600">US$ · {deudasUSD} {deudasUSD === 1 ? 'deuda' : 'deudas'}</span>
                   <span className="text-sm font-black text-rose-600 font-mono tabular-nums">US$ {fmt(deudaImpUSD)}</span>
                </div>
              )}
           </div>
        </div>
      </div>
    ),
    /* Cuentas secundarias de la billetera (con nombre propio / restringidas) */
    ...cuentasSecundarias.map(c => (
      <div key={`sec-${c.CueIdCuenta}`}
        title={c.CueRestringida ? 'Cuenta restringida: su dinero solo paga los artículos permitidos' : 'Cuenta secundaria: solo se usa eligiéndola al pagar'}
        className={`flex items-center gap-2 px-4 py-2 rounded-2xl border shadow-sm ${c.CueRestringida ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-sky-50 border-sky-200 text-sky-700'}`}>
        <Wallet size={14} className="opacity-80" />
        <div className="flex flex-col leading-tight">
          <span className="text-[9px] font-black uppercase tracking-tighter opacity-70 truncate max-w-[130px]">
            {c.CueNombre || `Cuenta #${c.CueIdCuenta}`}{c.CueRestringida ? ' 🔒' : ''}
          </span>
          <span className="text-sm font-black text-slate-900 font-mono italic">
            {c.CueTipo?.includes('USD') ? 'U$' : '$'} {fmt(c.CueSaldoActual)}
          </span>
        </div>
      </div>
    )),
  ].filter(Boolean);

  // ── Chips de recursos (bolsas de material) — saldo NETO real de la cuenta ───
  const saldoRealPorCuenta = new Map(cuentas.map(c => [c.CueIdCuenta, Number(c.CueSaldoActual || 0)]));
  const materialesMap = new Map();
  planes.forEach(p => {
    const key = p.CueIdCuenta;
    if (!materialesMap.has(key)) {
      materialesMap.set(key, { nombre: p.NombreArticulo || 'Recurso', simbolo: p.UniSimbolo || 'MTS', totalCap: 0 });
    }
    materialesMap.get(key).totalCap += Number(p.PlaCantidadTotal || 0);
  });
  const recursoChips = Array.from(materialesMap.entries()).map(([cueId, mat]) => {
    const disponible = saldoRealPorCuenta.has(cueId) ? saldoRealPorCuenta.get(cueId) : mat.totalCap;
    const pctRestante = mat.totalCap > 0
      ? Math.max(0, Math.min(100, (disponible / mat.totalCap) * 100))
      : (disponible > 0 ? 100 : 0);
    const color = disponible <= 0 ? 'rose' : pctRestante < 10 ? 'rose' : pctRestante < 30 ? 'amber' : 'indigo';
    const badgeClass = color === 'rose' ? 'bg-rose-50 border-rose-100 text-rose-600' : color === 'amber' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-blue-50 border-blue-100 text-blue-700';
    const barClass = color === 'rose' ? 'bg-rose-500' : color === 'amber' ? 'bg-amber-500' : 'bg-blue-500';
    return (
      <div key={cueId} className={`flex items-center gap-3 px-4 py-2 rounded-2xl border shadow-sm ${badgeClass}`}>
        <Zap size={14} className="opacity-70" />
        <div className="flex flex-col gap-1 min-w-0">
           <div className="flex items-center gap-3">
             <span className="text-[10px] font-black uppercase tracking-tighter truncate max-w-[100px] opacity-70">{mat.nombre}</span>
             <span className={`text-sm font-black font-mono tracking-tighter italic ${disponible < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{fmt(disponible)}<span className="text-[9px] ml-1 opacity-60 font-bold uppercase">{mat.simbolo}</span></span>
           </div>
           <div className="w-full h-1 bg-white/40 rounded-full overflow-hidden shadow-inner">
             <div className={`h-full ${barClass} transition-all duration-700`} style={{ width: `${pctRestante}%` }} />
           </div>
        </div>
      </div>
    );
  });

  const vacio = !loading && cuentas.length === 0 && planes.length === 0;
  const emptyMsg = <span className="text-[11px] font-black text-slate-300 uppercase tracking-widest italic px-4">— Sin saldos activos —</span>;

  // ── Layout AGRUPADO (Panel 360): 4 indicadores fijos + desplegables ────────
  // Ya no se apila un chip por cuenta ni por recurso: Billetera $ / Billetera US$
  // muestran el TOTAL de su moneda y despliegan la lista al clic; los recursos van
  // en su propio desplegable. Clic en una fila desplegada la abre en el estado de
  // cuenta de abajo (onElegirCuenta).
  if (agrupado) {
    const totalUYU = dineroUYU.reduce((s, c) => s + Number(c.CueSaldoActual || 0), 0);
    const totalUSD = dineroUSD.reduce((s, c) => s + Number(c.CueSaldoActual || 0), 0);
    const recursosList = Array.from(materialesMap.entries()).map(([cueId, mat]) => ({
      cueId, ...mat,
      disponible: saldoRealPorCuenta.has(cueId) ? saldoRealPorCuenta.get(cueId) : mat.totalCap,
    }));
    const toggle = (k) => setExpandido(p => (p === k ? null : k));
    const elegir = (tipo, id) => { setExpandido(null); onElegirCuenta?.({ tipo, id }); };
    const nombreCta = (c) => c.CueNombre || (c.CueEsPrincipal ? `Principal ${c.CueTipo?.includes('USD') ? 'US$' : '$'}` : `Cuenta #${c.CueIdCuenta}`);

    const chipBilletera = (key, cts, total, sym, colorCls) => cts.length > 0 && (
      <button key={key} type="button" onClick={() => toggle(key)}
        title={`Total de las ${cts.length} cuenta${cts.length !== 1 ? 's' : ''} en ${sym} (principal + secundarias). Clic para ver cada cuenta.`}
        className={`flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all shadow-sm ${total < 0 ? 'bg-rose-50 border-rose-200 text-rose-600' : colorCls} ${expandido === key ? 'ring-2 ring-cyan-400/40' : ''}`}>
        <Wallet size={14} className="opacity-80" />
        <div className="flex flex-col items-start leading-tight">
          <span className="text-[9px] font-black uppercase tracking-tighter opacity-70">
            Billetera {sym} · {cts.length} cuenta{cts.length !== 1 ? 's' : ''}
          </span>
          <span className="text-sm font-black text-slate-900 font-mono italic">{sym} {fmt(total)}</span>
        </div>
        <ChevronDown size={13} className={`opacity-60 transition-transform ${expandido === key ? 'rotate-180' : ''}`} />
      </button>
    );

    const filaCuenta = (c) => (
      <button key={c.CueIdCuenta} type="button" onClick={() => elegir('D', c.CueIdCuenta)}
        title="Ver esta cuenta en el estado de cuenta de abajo"
        className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg hover:bg-cyan-50 transition-colors text-left">
        <span className="text-xs font-bold text-slate-700 truncate">
          <span className="font-mono text-[9px] text-violet-500 mr-1.5">{codigoCuenta(c)}</span>
          {nombreCta(c)}
          {c.CueRestringida ? ' 🔒' : ''}{!c.CueEsPrincipal && c.CueAutoConsumo ? ' ⚡' : ''}
          {c.CueModalidadFiscal === 'PREPAGO_FACTURADO' && <span className="ml-1 text-[9px] font-black text-emerald-600 uppercase">prepago</span>}
        </span>
        <span className={`text-xs font-black font-mono tabular-nums ${Number(c.CueSaldoActual || 0) < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
          {c.CueTipo?.includes('USD') ? 'US$' : '$'} {fmt(c.CueSaldoActual)}
        </span>
      </button>
    );

    return (
      <div className="flex flex-col gap-2 py-1 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex items-center gap-3 flex-wrap">
          {loading && <Loader2 className="animate-spin text-indigo-500 shrink-0" size={14} />}
          {chipBilletera('UYU', dineroUYU, totalUYU, '$', 'bg-brand-cyan/10 border-brand-cyan/20 text-brand-cyan')}
          {chipBilletera('USD', dineroUSD, totalUSD, 'US$', 'bg-emerald-50 border-emerald-100 text-emerald-700')}
          {saldoChips.find(ch => ch?.key === 'pend')}
          {saldoChips.find(ch => ch?.key === 'deudas')}
          {recursosList.length > 0 && (
            <button type="button" onClick={() => toggle('REC')}
              title="Planes de metros del cliente. Clic para ver cada recurso."
              className={`flex items-center gap-2 px-4 py-2 rounded-2xl border border-blue-100 bg-blue-50 text-blue-700 shadow-sm transition-all ${expandido === 'REC' ? 'ring-2 ring-cyan-400/40' : ''}`}>
              <Zap size={14} className="opacity-70" />
              <span className="text-[10px] font-black uppercase tracking-tighter">Recursos · {recursosList.length}</span>
              {recursosList.some(r => r.disponible < 0) && <span className="text-[9px] font-black text-rose-600">¡negativo!</span>}
              <ChevronDown size={13} className={`opacity-60 transition-transform ${expandido === 'REC' ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        {/* Desplegable: cuentas de la moneda elegida / recursos en metros */}
        {(expandido === 'UYU' || expandido === 'USD') && (
          <div className="max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-1.5 flex flex-col gap-0.5">
            <span className="px-3 pt-1 pb-0.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
              Cuentas en {expandido === 'USD' ? 'dólares' : 'pesos'} — clic para verla abajo
            </span>
            {(expandido === 'USD' ? dineroUSD : dineroUYU)
              .slice()
              .sort((a, b) => Number(b.CueEsPrincipal || 0) - Number(a.CueEsPrincipal || 0) || a.CueIdCuenta - b.CueIdCuenta)
              .map(filaCuenta)}
          </div>
        )}
        {expandido === 'REC' && (
          <div className="max-w-md bg-white border border-slate-200 rounded-xl shadow-sm p-1.5 flex flex-col gap-0.5">
            <span className="px-3 pt-1 pb-0.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
              Recursos en metros — clic para ver su libro abajo
            </span>
            {recursosList.map(r => (
              <button key={r.cueId} type="button" onClick={() => elegir('R', r.cueId)}
                title="Ver el libro de este recurso en el estado de cuenta de abajo"
                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg hover:bg-cyan-50 transition-colors text-left">
                <span className="text-xs font-bold text-slate-700 truncate"><span className="font-mono text-[9px] text-violet-500 mr-1.5">REC-{r.cueId}</span>{r.nombre}</span>
                <span className={`text-xs font-black font-mono tabular-nums ${r.disponible < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                  {fmt(r.disponible)} <span className="text-[9px] opacity-60 uppercase">{r.simbolo}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {vacio && emptyMsg}
      </div>
    );
  }

  // ── Layout por defecto (compatible con usos existentes): todo en una fila ──
  return (
    <div className="flex flex-wrap items-center gap-3 py-2 animate-in fade-in slide-in-from-top-2 duration-300">
      {loading && <Loader2 className="animate-spin text-indigo-500 shrink-0" size={14} />}
      {saldoChips}
      {recursoChips}
      {vacio && emptyMsg}
    </div>
  );
};

// Memoizado: sus datos dependen solo de clienteId (hace su propio fetch). Sin esto, cada
// tecla que se escribe en el modal padre lo re-renderiza entero (recalcula chips y mapas),
// lo que se siente como lag al tipear los datos del receptor. clienteNombre no se usa acá.
export default React.memo(ClienteBilletera, (prev, next) =>
  prev.clienteId === next.clienteId && prev.agrupado === next.agrupado);
