import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Wallet, Coins, Layers, Loader2, Zap, Activity, FileText } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ClienteBilletera = ({ clienteId, clienteNombre }) => {
  const [loading, setLoading] = useState(false);
  const [cuentas, setCuentas] = useState([]);
  const [planes, setPlanes] = useState([]);
  const [deudas, setDeudas] = useState([]);

  useEffect(() => {
    if (!clienteId) return;
    const loadData = async () => {
      setLoading(true);
      try {
        const [resCuentas, resPlanes, resDeudas] = await Promise.all([
          api.get(`/contabilidad/cuentas/${clienteId}`),
          api.get(`/contabilidad/planes/${clienteId}?solo_activos=true`),
          api.get(`/contabilidad/clientes/${clienteId}/deudas-vivas`)
        ]);
        if (resCuentas.data.success) setCuentas(resCuentas.data.data);
        if (resPlanes.data.success) setPlanes(resPlanes.data.data);
        if (resDeudas.data.success) setDeudas(resDeudas.data.data);
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

  return (
    <div className="flex flex-wrap items-center gap-3 py-2 animate-in fade-in slide-in-from-top-2 duration-300">
      
      {/* Indicador de Carga */}
      {loading && <Loader2 className="animate-spin text-indigo-500 shrink-0" size={14} />}

      {/* Saldo Pesos */}
      <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl border transition-all shadow-sm ${ctaUYU?.CueSaldoActual < 0 ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-brand-cyan/10 border-brand-cyan/20 text-brand-cyan'}`}>
        <Coins size={14} className="opacity-80" />
        <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">UYU</span>
        <span className="text-sm font-black text-slate-900 font-mono italic">$ {fmt(ctaUYU?.CueSaldoActual)}</span>
      </div>

      {/* Saldo Dólares */}
      <div className="flex items-center gap-2 px-4 py-2 rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-sm">
        <Activity size={14} className="opacity-80" />
        <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">USD</span>
        <span className="text-sm font-black text-slate-900 font-mono italic">U$ {fmt(ctaUSD?.CueSaldoActual)}</span>
      </div>

      {/* Pendiente Facturar (si existe) */}
      {(Number(ctaUYU?.PendienteFacturar || 0) > 0 || Number(ctaUSD?.PendienteFacturar || 0) > 0) && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-2xl border border-amber-200 bg-amber-50 text-amber-700 shadow-[0_4px_12px_rgba(245,158,11,0.1)]">
          <FileText size={14} className="opacity-80" />
          <div className="flex flex-col">
             <span className="text-[9px] font-black uppercase tracking-tighter opacity-70">Pendiente Facturar</span>
             <div className="flex items-center gap-2 text-xs font-black text-slate-900 font-mono">
               {Number(ctaUYU?.PendienteFacturar || 0) > 0 && <span>$ {fmt(ctaUYU?.PendienteFacturar)}</span>}
               {Number(ctaUSD?.PendienteFacturar || 0) > 0 && <span>U$ {fmt(ctaUSD?.PendienteFacturar)}</span>}
             </div>
          </div>
        </div>
      )}

      {/* Alerta de Deuda Viva (Documentos Pendientes) */}
      {deudas.length > 0 && (
        <div 
          className="flex items-center gap-2 px-4 py-2 rounded-2xl border border-rose-200 bg-white text-rose-600 shadow-[0_4px_12px_rgba(225,29,72,0.1)] animate-pulse cursor-help group relative ring-1 ring-rose-500/10"
        >
          <div className="bg-rose-100 p-1 rounded-lg">
             <FileText size={14} className="group-hover:scale-125 transition-transform text-rose-600" />
          </div>
          <span className="text-[11px] font-black uppercase tracking-tight">{deudas.length} DEUDAS VIVAS</span>
          
          {/* Tooltip con resumen rápido de deudas - TEMA CLARO */}
          <div className="absolute top-full left-0 mt-3 p-4 bg-white border border-slate-200 rounded-3xl shadow-[0_30px_60px_rgba(15,23,42,0.25)] z-[9999] hidden group-hover:block min-w-[340px]  ring-8 ring-black/5 animate-in fade-in zoom-in-95 duration-200">
             <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
                <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                   <Activity size={12} className="text-rose-500" /> Detalle de Pendientes
                </h4>
                <span className="text-[10px] bg-rose-500 text-white px-2.5 py-1 rounded-full font-black shadow-lg shadow-rose-500/30">{deudas.length}</span>
             </div>
             <div className="max-h-[280px] overflow-y-auto pr-1 space-y-3 scrollbar-thin scrollbar-thumb-slate-200">
                {deudas.map(d => (
                  <div key={d.DDeIdDocumento} className="flex justify-between items-start group/row hover:bg-slate-50 p-2.5 rounded-xl transition-all border border-transparent hover:border-slate-100">
                     <div className="flex flex-col gap-0.5">
                        <span className="font-black text-slate-800 text-xs tracking-tight group-hover/row:text-indigo-600 transition-colors capitalize">
                           {d.NombreTrabajo?.toLowerCase()}
                        </span>
                        <div className="flex items-center gap-2">
                           <span className="text-[9px] bg-slate-100 px-2 py-0.5 rounded-md text-slate-500 font-black border border-slate-200 uppercase tracking-tighter shadow-sm">{d.CodigoOrden}</span>
                           <span className="text-[9px] text-slate-400 font-semibold tracking-tighter">{new Date(d.DDeFechaEmision).toLocaleDateString()}</span>
                        </div>
                        {d.DocCliNombre && d.DocCliNombre.trim().toLowerCase() !== (clienteNombre || '').trim().toLowerCase() && (
                           <div className="text-[9px] font-semibold text-amber-600 mt-1 flex items-center gap-1">
                              <span className="uppercase font-black text-[8px] bg-amber-100 px-1 py-0.2 rounded text-amber-700">Facturado a:</span>
                              <span className="truncate max-w-[150px]" title={d.DocCliNombre}>{d.DocCliNombre}</span>
                           </div>
                        )}
                     </div>
                     <div className="flex flex-col items-end gap-1">
                        <span className="font-black text-rose-600 font-mono text-xs tracking-tighter">{d.MonSimbolo} {fmt(d.DDeImportePendiente)}</span>
                        {d.DiasVencido > 0 ? (
                           <span className="text-[8px] bg-rose-600 text-white font-black px-2 py-0.5 rounded-lg shadow-md shadow-rose-500/20">VENCIDO {d.DiasVencido}D</span>
                        ) : (
                           <span className="text-[8px] bg-emerald-100/50 text-emerald-600 border border-emerald-200/50 font-black px-2 py-0.5 rounded-lg">AL DÍA</span>
                        )}
                     </div>
                  </div>
                ))}
             </div>
             <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/50 -mx-4 -mb-4 p-4 rounded-b-3xl">
                <span className="text-[9px] uppercase font-black text-slate-400">Total en Cuentas Corrientes</span>
                <button className="text-[10px] text-indigo-600 font-black tracking-widest uppercase hover:underline">Ver Estado completo</button>
             </div>
          </div>
        </div>
      )}

      {/* Recursos (Bolsas) — se muestra el saldo NETO real de la cuenta del material
          (CueSaldoActual), no el restante de cada plan por separado. Así el pill
          refleja lo que realmente queda disponible, descontando el arrastre negativo
          de planes anteriores ya cerrados. Se agrupa por cuenta (material). */}
      {(() => {
        // Saldo real por cuenta de recurso (id de cuenta -> CueSaldoActual)
        const saldoRealPorCuenta = new Map(
          cuentas.map(c => [c.CueIdCuenta, Number(c.CueSaldoActual || 0)])
        );

        // Agrupar los planes activos por cuenta (mismo material comparte cuenta)
        const materialesMap = new Map();
        planes.forEach(p => {
          const key = p.CueIdCuenta;
          if (!materialesMap.has(key)) {
            materialesMap.set(key, {
              nombre:   p.NombreArticulo || 'Recurso',
              simbolo:  p.UniSimbolo || 'MTS',
              totalCap: 0,
            });
          }
          materialesMap.get(key).totalCap += Number(p.PlaCantidadTotal || 0);
        });

        return Array.from(materialesMap.entries()).map(([cueId, mat]) => {
          // Disponible real = saldo neto de la cuenta (con arrastre de cierres previos)
          const disponible = saldoRealPorCuenta.has(cueId)
            ? saldoRealPorCuenta.get(cueId)
            : mat.totalCap; // fallback si la cuenta no vino en el listado
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
      })()}

      {!loading && cuentas.length === 0 && planes.length === 0 && (
        <span className="text-[11px] font-black text-slate-300 uppercase tracking-widest italic px-4">— Sin saldos activos —</span>
      )}

    </div>
  );
};

export default ClienteBilletera;
