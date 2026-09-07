/**
 * CronAdminView.jsx
 * Administración visual de los jobs programados del servidor.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Clock, RefreshCw, Play, CheckCircle2, XCircle,
  AlertTriangle, Loader2, CalendarClock, Activity, Zap, ServerCrash,
  ListChecks, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';

const API = import.meta.env.VITE_API_URL || '';
const tok = () => { try { return JSON.parse(localStorage.getItem('user'))?.token || ''; } catch { return ''; } };

const req = async (url, opts = {}) => {
  const r = await fetch(`${API}${url}`, {
    headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
  return json;
};

const fmtFecha = (f) =>
  f ? new Date(f).toLocaleString('es-UY', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'America/Montevideo',
  }) : '—';

const msHasta = (f) => {
  if (!f) return null;
  const diff = new Date(f) - new Date();
  if (diff <= 0) return 'Ahora';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0)  return `${h}h ${m}m`;
  return `${m}m`;
};

// ── Badge de estado ────────────────────────────────────────────────────────────
const ESTADO_CONFIG = {
  ESPERANDO: { cls: 'bg-slate-700 text-slate-300 border-slate-600',         icon: <Clock size={12} />,        label: 'Esperando' },
  CORRIENDO: { cls: 'bg-blue-500/20 text-blue-300 border-blue-500/40',      icon: <Loader2 size={12} className="animate-spin" />, label: 'Corriendo' },
  OK:        { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: <CheckCircle2 size={12} />, label: 'OK' },
  ERROR:     { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',      icon: <XCircle size={12} />,      label: 'Error' },
};

const EstadoBadge = ({ estado }) => {
  const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.ESPERANDO;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-black uppercase tracking-wider ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
};

// ── Detalle del Cuadre Nocturno de Saldos ──────────────────────────────────────
// Muestra la ÚLTIMA foto del job cuadre-saldos con sus listas (no solo los contadores):
// cuentas fuera del modelo, cargos ≠ total, documentos sin cargo, ajustes a mano,
// cobros dobles, y el histórico de los últimos 30 días para ver la tendencia.
const fmtNum = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const TablaDetalle = ({ titulo, filas, cols, vacio = 'Nada para mostrar.' }) => (
  <div className="bg-slate-800/40 rounded-xl p-4">
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">{titulo} <span className="text-slate-600">({filas?.length || 0})</span></p>
    {!filas?.length ? <p className="text-xs text-slate-500">{vacio}</p> : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-slate-500 text-left">{cols.map(c => <th key={c.k} className={`py-1 pr-3 font-bold ${c.num ? 'text-right' : ''}`}>{c.t}</th>)}</tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-t border-slate-800 text-slate-300">
                {cols.map(c => <td key={c.k} className={`py-1 pr-3 ${c.num ? 'text-right font-mono' : ''}`}>{c.num ? fmtNum(f[c.k]) : (f[c.k] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const DetalleCuadre = () => {
  const [data, setData]       = useState(null);
  const [msg, setMsg]         = useState('');
  const [cargando, setCargando] = useState(true);

  const cargarDetalle = useCallback(async () => {
    setCargando(true);
    try {
      const r = await req('/api/sysadmin/cron/cuadre-saldos/detalle');
      setData(r.data); setMsg(r.message || '');
    } catch (e) { setMsg(e.message); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { cargarDetalle(); }, [cargarDetalle]);

  const botonActualizar = (
    <button onClick={cargarDetalle} disabled={cargando}
      className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40"
      title="Volver a leer la última foto (después de Ejecutar)">
      <RefreshCw size={12} className={cargando ? 'animate-spin' : ''} /> Actualizar
    </button>
  );

  if (cargando) return <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando detalle…</p>;
  if (!data)    return <div className="flex flex-col gap-2"><p className="text-xs text-slate-400">{msg || 'Sin datos.'}</p>{botonActualizar}</div>;

  const c = data.contadores || {};
  const d = data.detalle || {};
  const h = data.historico || [];
  const ayer = h[1] || null;
  const delta = (k) => (ayer ? Number(c[k] || 0) - Number(ayer[k] || 0) : null);
  const Contador = ({ k, label }) => {
    const dv = delta(k);
    return (
      <div className="bg-slate-800/60 rounded-xl px-3 py-2 flex flex-col">
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-black">{label}</span>
        <span className="text-lg font-black text-white">{c[k] ?? '—'}
          {dv != null && dv !== 0 && (
            <span className={`ml-2 text-xs font-bold ${dv > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{dv > 0 ? `+${dv}` : dv}</span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 border-t border-slate-800 pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-400 m-0">
          Foto del <b className="text-slate-200">{fmtFecha(c.Corrida)}</b>
        {ayer ? <> — variación contra la corrida anterior ({fmtFecha(ayer.Corrida)}) en <span className="text-rose-400">rojo</span> si empeoró.</> : ' — primera corrida, sin comparación.'}
        </p>
        {botonActualizar}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Contador k="CuentasFueraDelModelo" label="Fuera del modelo" />
        <Contador k="DebeNoCuadra"          label="Debe y no cuadra" />
        <Contador k="DebeSinDocumento"      label="Debe sin documento" />
        <Contador k="AFavor"                label="A favor" />
        <Contador k="AFavorConDeuda"        label="A favor c/ deuda viva" />
        <Contador k="CargoDistintoTotal"    label="Cargo ≠ total" />
        <Contador k="DocsSinCargo"          label="Docs sin cargo" />
        <Contador k="ColumnaMal"            label="CueSaldoActual mal" />
        <Contador k="FalsosPositivos"       label="Falsos positivos" />
        <Contador k="AjustesManuales24h"    label="Ajustes a mano 24h" />
        <Contador k="DobleCobro"            label="Cobro doble" />
      </div>

      <TablaDetalle titulo="Ajustes a mano (últimas 24 hs)" filas={d.ajustes}
        cols={[{k:'Cliente',t:'Cliente'},{k:'Moneda',t:'Mon.'},{k:'MovTipo',t:'Tipo'},{k:'Importe',t:'Importe',num:true},{k:'Usuario',t:'Usuario'},{k:'Motivo',t:'Motivo'}]} />
      <TablaDetalle titulo="Cobro doble: pago por orden y por documento" filas={d.dobleCobro}
        cols={[{k:'Cliente',t:'Cliente'},{k:'Doc',t:'Documento'},{k:'Moneda',t:'Mon.'},{k:'PagoOrden',t:'Pago por orden',num:true},{k:'PagoDoc',t:'Pago por documento',num:true}]} />
      <TablaDetalle titulo="Cuentas fuera del modelo (top 40)" filas={d.cuentas}
        cols={[{k:'Cliente',t:'Cliente'},{k:'Tipo',t:'Tipo'},{k:'Moneda',t:'Mon.'},{k:'Situacion',t:'Situación'},{k:'Saldo',t:'Libro',num:true},{k:'VivaDoc',t:'Deuda doc.',num:true},{k:'Guardado',t:'Columna',num:true}]} />
      <TablaDetalle titulo="Documentos con cargo ≠ total (top 20)" filas={d.cargoVsTotal}
        cols={[{k:'Cliente',t:'Cliente'},{k:'Doc',t:'Documento'},{k:'CfeEstado',t:'CFE'},{k:'DocTotal',t:'Total',num:true},{k:'Cargo',t:'Cargo libro',num:true},{k:'Esperado',t:'Esperado',num:true}]} />
      <TablaDetalle titulo="Documentos sin ningún cargo (top 20)" filas={d.sinCargo}
        cols={[{k:'Cliente',t:'Cliente'},{k:'Doc',t:'Documento'},{k:'CfeEstado',t:'CFE'},{k:'Moneda',t:'Mon.'},{k:'DocTotal',t:'Total',num:true}]} />

      <TablaDetalle titulo="Histórico (últimas corridas)" filas={h}
        cols={[{k:'Fecha',t:'Fecha'},{k:'CuentasFueraDelModelo',t:'Fuera'},{k:'DebeNoCuadra',t:'No cuadra'},{k:'DebeSinDocumento',t:'Sin doc'},{k:'AFavor',t:'A favor'},{k:'CargoDistintoTotal',t:'Cargo≠tot'},{k:'DocsSinCargo',t:'Sin cargo'},{k:'ColumnaMal',t:'Col. mal'},{k:'FalsosPositivos',t:'Falsos+'},{k:'AjustesManuales24h',t:'Ajustes'},{k:'DobleCobro',t:'Doble'}]}
        vacio="Sin corridas todavía." />
    </div>
  );
};

// ── Tarjeta de Job ─────────────────────────────────────────────────────────────
const JobCard = ({ job, onEjecutar, ejecutandoId }) => {
  const ejecutando = ejecutandoId === job.id;
  // Solo el cuadre de saldos tiene detalle (listas) además del resumen.
  const tieneDetalle = job.id === 'cuadre-saldos';
  const [verDetalle, setVerDetalle] = useState(false);

  return (
    <div className={`rounded-2xl border p-6 flex flex-col gap-5 transition-all ${
      job.estado === 'CORRIENDO' ? 'bg-blue-900/10 border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.08)]'
      : job.estado === 'ERROR'   ? 'bg-rose-900/10 border-rose-500/30'
      : job.estado === 'OK'      ? 'bg-emerald-900/5 border-emerald-500/20'
      : 'bg-slate-900 border-slate-800'
    }`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1.5">
            <EstadoBadge estado={job.estado} />
            <span className="text-[10px] font-mono text-slate-600 border border-slate-800 px-2 py-0.5 rounded bg-slate-900">{job.id}</span>
          </div>
          <h3 className="text-lg font-black text-white">{job.nombre}</h3>
          <p className="text-sm text-slate-400 mt-0.5">{job.descripcion}</p>
        </div>
        <button
          onClick={() => onEjecutar(job.id)}
          disabled={ejecutando || job.estado === 'CORRIENDO'}
          title="Ejecutar ahora"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed
            bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
        >
          {ejecutando || job.estado === 'CORRIENDO'
            ? <><Activity size={15} className="animate-pulse" /> Corriendo</>
            : <><Play size={15} /> Ejecutar</>}
        </button>
      </div>

      {tieneDetalle && (
        <button
          onClick={() => setVerDetalle(v => !v)}
          className="self-start flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all
            bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
          title="Ver las listas de la última corrida: cuentas, documentos, ajustes y cobros dobles"
        >
          <ListChecks size={14} />
          {verDetalle ? 'Ocultar detalle' : 'Ver detalle (listas de la última corrida)'}
          {verDetalle ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}

      {/* Datos de programación */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        <div className="bg-slate-800/60 rounded-xl px-4 py-3 flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <CalendarClock size={11} /> Programación
          </span>
          <span className="text-sm font-bold text-slate-200">{job.schedule}</span>
        </div>

        <div className="bg-slate-800/60 rounded-xl px-4 py-3 flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <Clock size={11} /> Próxima ejecución
          </span>
          <span className="text-sm font-bold text-slate-200">{fmtFecha(job.proximaEjecucion)}</span>
          {job.proximaEjecucion && (
            <span className="text-[11px] text-indigo-400 font-bold">en {msHasta(job.proximaEjecucion)}</span>
          )}
        </div>

        <div className="bg-slate-800/60 rounded-xl px-4 py-3 flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 size={11} /> Última ejecución
          </span>
          <span className="text-sm font-bold text-slate-200">{fmtFecha(job.ultimaEjecucion)}</span>
          {job.ultimoResultado && (
            <span className="text-[11px] text-emerald-400 font-bold">{job.ultimoResultado}</span>
          )}
        </div>
      </div>

      {/* Error si existe */}
      {job.ultimoError && (
        <div className="flex items-start gap-3 bg-rose-900/20 border border-rose-500/20 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase text-rose-500 tracking-widest mb-1">Último Error</p>
            <p className="text-xs font-mono text-rose-300">{job.ultimoError}</p>
          </div>
        </div>
      )}

      {/* Detalle del cuadre de saldos (listas de la última corrida) */}
      {tieneDetalle && verDetalle && <DetalleCuadre />}
    </div>
  );
};

// ── Vista Principal ────────────────────────────────────────────────────────────
export default function CronAdminView() {
  const [jobs, setJobs]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [ejecutandoId, setEjecutandoId] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await req('/api/sysadmin/cron');
      setJobs(data.data || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    // Auto-refrescar cada 15 segundos para ver el estado actualizado
    const interval = setInterval(cargar, 15000);
    return () => clearInterval(interval);
  }, [cargar]);

  const ejecutar = async (jobId) => {
    setEjecutandoId(jobId);
    try {
      await req(`/api/sysadmin/cron/${jobId}/ejecutar`, { method: 'POST' });
      toast.success('✅ Job iniciado en background. El estado se actualizará en segundos.');
      setTimeout(cargar, 2500);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTimeout(() => setEjecutandoId(null), 3000);
    }
  };

  const corriendo = jobs.filter(j => j.estado === 'CORRIENDO').length;
  const errores   = jobs.filter(j => j.estado === 'ERROR').length;
  const ok        = jobs.filter(j => j.estado === 'OK').length;

  return (
    <div className="h-full bg-[#0f1117] p-4 sm:p-8 overflow-y-auto text-slate-200 font-sans custom-scrollbar">
      <div className="max-w-[1100px] mx-auto flex flex-col gap-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-white flex items-center gap-3">
              <Zap className="text-yellow-400" size={36} />
              Administrador de Jobs
            </h1>
            <p className="text-slate-400 text-sm mt-2">
              Estado en tiempo real de todos los procesos automáticos del servidor. Actualiza cada 15 segundos.
            </p>
          </div>
          <button
            onClick={cargar}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 text-sm border border-slate-700 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all shadow-lg text-slate-300 disabled:opacity-50 font-bold shrink-0"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refrescar
          </button>
        </div>

        {/* KPIs rápidos */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'En ejecución', value: corriendo, color: 'blue',    icon: <Activity size={22} className="text-blue-400" /> },
            { label: 'Completados OK', value: ok,      color: 'emerald', icon: <CheckCircle2 size={22} className="text-emerald-400" /> },
            { label: 'Con errores',  value: errores,   color: 'rose',    icon: <ServerCrash size={22} className="text-rose-400" /> },
          ].map(k => (
            <div key={k.label} className={`rounded-2xl border p-5 flex items-center gap-4 bg-slate-900 border-slate-800 ${k.value > 0 && k.color !== 'emerald' ? `border-${k.color}-500/30 bg-${k.color}-900/5` : ''}`}>
              <div className={`p-3 rounded-xl bg-${k.color}-500/10`}>{k.icon}</div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{k.label}</p>
                <p className={`text-3xl font-black text-${k.color}-300`}>{k.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Lista de jobs */}
        {loading && jobs.length === 0 ? (
          <div className="flex justify-center py-24">
            <div className="animate-spin h-10 w-10 border-4 border-yellow-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                onEjecutar={ejecutar}
                ejecutandoId={ejecutandoId}
              />
            ))}
            {jobs.length === 0 && (
              <div className="text-center py-20 text-slate-500">
                <Zap size={44} className="mx-auto mb-4 text-slate-700" />
                <p className="text-lg font-bold text-slate-400">No hay jobs registrados</p>
                <p className="text-sm mt-1">El scheduler debe estar reiniciando.</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
