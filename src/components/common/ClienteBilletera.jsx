import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Wallet, Coins, Layers, Loader2, Zap, Activity, FileText } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ClienteBilletera = ({ clienteId, clienteNombre, agrupado = false }) => {
  const [loading, setLoading] = useState(false);
  const [cuentas, setCuentas] = useState([]);
  const [planes, setPlanes] = useState([]);
  const [deudas, setDeudas] = useState([]);
  const [ordenes, setOrdenes] = useState([]);

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
  const ctaUYU = mCuentas.find(c => c.CueTipo?.includes('UYU') || c.MonIdMoneda === 1);
  const ctaUSD = mCuentas.find(c => c.CueTipo?.includes('USD') || c.MonIdMoneda === 2);

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

  // ── Layout AGRUPADO: Saldos y Recursos en secciones separadas y prolijas ───
  if (agrupado) {
    const Eyebrow = ({ children }) => (
      <span className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 shrink-0 w-16">{children}</span>
    );
    return (
      <div className="flex flex-col gap-2.5 py-1 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex items-center gap-3 flex-wrap">
          <Eyebrow>Saldos</Eyebrow>
          {loading && <Loader2 className="animate-spin text-indigo-500 shrink-0" size={14} />}
          {saldoChips}
        </div>
        {recursoChips.length > 0 && (
          <div className="flex items-start gap-3 flex-wrap pt-2.5 border-t border-slate-100">
            <Eyebrow>Recursos</Eyebrow>
            {recursoChips}
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

export default ClienteBilletera;
