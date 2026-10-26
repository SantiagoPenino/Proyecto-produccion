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

// Estética nueva (22/10/2026, como Reportes y Logística): página clara, tarjetas blancas con borde, íconos de Lucide
// en brand-cyan sin fondo; el color queda para el estado del job (OK emerald, error magenta, corriendo brand-cyan,
// esperando zinc). «Ejecutar» es botón secundario para que la lista de jobs no quede llena de botones de color.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const ROTULO = 'text-[10px] font-black uppercase tracking-widest text-zinc-400';

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
  ESPERANDO: { cls: 'bg-zinc-100 text-zinc-600 border-zinc-200',                         icon: <Clock size={12} />,        label: 'Esperando' },
  CORRIENDO: { cls: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20',             icon: <Loader2 size={12} className="animate-spin" />, label: 'Corriendo' },
  OK:        { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',                 icon: <CheckCircle2 size={12} />, label: 'OK' },
  ERROR:     { cls: 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20',    icon: <XCircle size={12} />,      label: 'Error' },
};

const EstadoBadge = ({ estado }) => {
  const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.ESPERANDO;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold uppercase tracking-wide whitespace-nowrap shrink-0 ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
};

// ── Detalle del Cuadre Nocturno de Saldos ──────────────────────────────────────
// Muestra la ÚLTIMA foto del job cuadre-saldos con sus listas (no solo los contadores):
// cuentas fuera del modelo, cargos ≠ total, documentos sin cargo, ajustes a mano,
// cobros dobles, y el histórico de los últimos 30 días para ver la tendencia.
const fmtNum = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// Fecha de día (columna Fecha del histórico) en formato uruguayo: se toma la parte AAAA-MM-DD tal cual viene,
// sin pasar por zona horaria (así no corre de día).
const fmtDia = (v) => {
  const s = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : (v ?? '—');
};

const TablaDetalle = ({ titulo, filas, cols, vacio = 'Nada para mostrar.' }) => (
  <div className="rounded-xl border border-zinc-200 overflow-hidden">
    <p className={`${ROTULO} px-4 py-2.5 border-b border-zinc-100 m-0`}>{titulo} <span className="text-zinc-300">({filas?.length || 0})</span></p>
    {!filas?.length ? <p className="text-xs text-zinc-400 px-4 py-3 m-0">{vacio}</p> : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr className="text-left">{cols.map(c => <th key={c.k} className={`px-3 py-2 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap ${c.num ? 'text-right' : ''}`}>{c.t}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filas.map((f, i) => (
              <tr key={i} className="text-zinc-700 hover:bg-zinc-50 transition-colors">
                {cols.map(c => <td key={c.k} className={`px-3 py-1.5 ${c.num ? 'text-right font-mono tabular-nums' : ''} ${c.fecha ? 'whitespace-nowrap tabular-nums' : ''}`}>{c.num ? fmtNum(f[c.k]) : c.fecha ? fmtDia(f[c.k]) : (f[c.k] ?? '—')}</td>)}
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
      className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-200 transition-colors disabled:opacity-40"
      title="Volver a leer la última foto (después de Ejecutar)">
      <RefreshCw size={12} className={`text-brand-cyan ${cargando ? 'animate-spin' : ''}`} /> Actualizar
    </button>
  );

  if (cargando) return <p className="text-xs text-zinc-500 flex items-center gap-2 border-t border-zinc-100 pt-4 m-0"><Loader2 size={14} className="animate-spin text-brand-cyan" /> Cargando detalle…</p>;
  if (!data)    return <div className="flex flex-col gap-2 border-t border-zinc-100 pt-4"><p className="text-xs text-zinc-500 m-0">{msg || 'Sin datos.'}</p>{botonActualizar}</div>;

  const c = data.contadores || {};
  const d = data.detalle || {};
  const h = data.historico || [];
  const ayer = h[1] || null;
  const delta = (k) => (ayer ? Number(c[k] || 0) - Number(ayer[k] || 0) : null);
  const Contador = ({ k, label }) => {
    const dv = delta(k);
    return (
      <div className="bg-zinc-50 rounded-xl px-3 py-2 flex flex-col min-w-0">
        <span className={`${ROTULO} leading-tight break-words`}>{label}</span>
        <span className="text-lg font-black text-zinc-900 tabular-nums">{c[k] ?? '—'}
          {dv != null && dv !== 0 && (
            <span className={`ml-2 text-xs font-bold ${dv > 0 ? 'text-brand-magenta' : 'text-emerald-600'}`}>{dv > 0 ? `+${dv}` : dv}</span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 border-t border-zinc-100 pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-zinc-500 m-0">
          Foto del <b className="text-zinc-800">{fmtFecha(c.Corrida)}</b>
        {ayer ? <> — variación contra la corrida anterior ({fmtFecha(ayer.Corrida)}) en <span className="font-bold text-brand-magenta">magenta</span> si empeoró.</> : ' — primera corrida, sin comparación.'}
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
        cols={[{k:'Fecha',t:'Fecha',fecha:true},{k:'CuentasFueraDelModelo',t:'Fuera'},{k:'DebeNoCuadra',t:'No cuadra'},{k:'DebeSinDocumento',t:'Sin doc'},{k:'AFavor',t:'A favor'},{k:'CargoDistintoTotal',t:'Cargo≠tot'},{k:'DocsSinCargo',t:'Sin cargo'},{k:'ColumnaMal',t:'Col. mal'},{k:'FalsosPositivos',t:'Falsos+'},{k:'AjustesManuales24h',t:'Ajustes'},{k:'DobleCobro',t:'Doble'}]}
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
    <div className={`bg-white rounded-2xl border p-4 sm:p-5 flex flex-col gap-4 transition-colors ${
      job.estado === 'CORRIENDO' ? 'border-brand-cyan/40'
      : job.estado === 'ERROR'   ? 'border-brand-magenta/30'
      : 'border-zinc-200'
    }`}>

      {/* Header: nombre y clave a la izquierda, estado a la derecha */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="text-base sm:text-lg font-black text-zinc-900 leading-tight m-0">{job.nombre}</h3>
            <span className="text-[11px] font-mono text-zinc-500 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-md">{job.id}</span>
          </div>
          <EstadoBadge estado={job.estado} />
        </div>
        <p className="text-sm text-zinc-500 mt-1.5 mb-0">{job.descripcion}</p>
      </div>

      {/* Datos de programación (en escritorio, Ejecutar queda al final del mismo renglón) */}
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:gap-3">

        <div className="bg-zinc-50 rounded-xl px-4 py-3 flex flex-col gap-1 min-w-0">
          <span className={`${ROTULO} flex items-center gap-1.5`}>
            <CalendarClock size={12} className="text-brand-cyan" /> Programación
          </span>
          <span className="text-sm font-bold text-zinc-800">{job.schedule}</span>
        </div>

        <div className="bg-zinc-50 rounded-xl px-4 py-3 flex flex-col gap-1 min-w-0">
          <span className={`${ROTULO} flex items-center gap-1.5`}>
            <Clock size={12} className="text-brand-cyan" /> Próxima ejecución
          </span>
          <span className="text-sm font-bold text-zinc-800 tabular-nums">{fmtFecha(job.proximaEjecucion)}</span>
          {job.proximaEjecucion && (
            <span className="text-[11px] text-brand-cyan font-bold">en {msHasta(job.proximaEjecucion)}</span>
          )}
        </div>

        <div className="bg-zinc-50 rounded-xl px-4 py-3 flex flex-col gap-1 min-w-0">
          <span className={`${ROTULO} flex items-center gap-1.5`}>
            <CheckCircle2 size={12} className="text-brand-cyan" /> Última ejecución
          </span>
          <span className="text-sm font-bold text-zinc-800 tabular-nums">{fmtFecha(job.ultimaEjecucion)}</span>
          {job.ultimoResultado && (
            <span className="text-[11px] text-emerald-700 font-bold">{job.ultimoResultado}</span>
          )}
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => onEjecutar(job.id)}
            disabled={ejecutando || job.estado === 'CORRIENDO'}
            title="Ejecutar ahora"
            className={`${BTN_SECUNDARIO} w-full sm:w-auto shrink-0 disabled:cursor-not-allowed`}
          >
            {ejecutando || job.estado === 'CORRIENDO'
              ? <><Activity size={15} className="animate-pulse text-brand-cyan" /> Corriendo</>
              : <><Play size={15} className="text-brand-cyan" /> Ejecutar</>}
          </button>
        </div>
      </div>

      {/* Error si existe */}
      {job.ultimoError && (
        <div className="flex items-start gap-3 bg-brand-magenta/5 border border-brand-magenta/20 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-brand-magenta shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-brand-magenta tracking-widest mb-1">Último Error</p>
            <p className="text-xs font-mono text-zinc-700 break-words m-0">{job.ultimoError}</p>
          </div>
        </div>
      )}

      {tieneDetalle && (
        <button
          onClick={() => setVerDetalle(v => !v)}
          className="self-start inline-flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-xs transition-colors
            bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-200"
          title="Ver las listas de la última corrida: cuentas, documentos, ajustes y cobros dobles"
        >
          <ListChecks size={14} className="text-brand-cyan" />
          {verDetalle ? 'Ocultar detalle' : 'Ver detalle (listas de la última corrida)'}
          {verDetalle ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
        </button>
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
      toast.success('Job iniciado en background. El estado se actualizará en segundos.');
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
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 font-sans">

      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Zap size={30} className="text-brand-cyan shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none m-0">Administrador de Jobs</h1>
          <p className="text-sm text-zinc-500 mt-1 mb-0">
            Estado en tiempo real de todos los procesos automáticos del servidor. Actualiza cada 15 segundos.
          </p>
        </div>
        <button
          onClick={cargar}
          disabled={loading}
          className={`${BTN_SECUNDARIO} w-full sm:w-auto shrink-0`}
        >
          <RefreshCw size={15} className={`text-brand-cyan ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        {[
          { label: 'En ejecución',   value: corriendo, Icono: Activity,     tono: 'text-brand-cyan',    borde: 'border-brand-cyan/40' },
          { label: 'Completados OK', value: ok,        Icono: CheckCircle2, tono: 'text-emerald-600',   borde: '' },
          { label: 'Con errores',    value: errores,   Icono: ServerCrash,  tono: 'text-brand-magenta', borde: 'border-brand-magenta/30' },
        ].map(({ label, value, Icono, tono, borde }) => (
          <div key={label} className={`bg-white rounded-2xl border p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0 ${value > 0 && borde ? borde : 'border-zinc-200'}`}>
            <Icono size={26} className="text-brand-cyan shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-wide text-zinc-400 leading-tight m-0">{label}</p>
              <p className={`text-2xl sm:text-3xl font-black tabular-nums leading-tight m-0 ${value > 0 ? tono : 'text-zinc-900'}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Lista de jobs */}
      {loading && jobs.length === 0 ? (
        <div className={`${CARD} flex flex-col items-center justify-center py-20 gap-3`}>
          <Loader2 size={30} className="animate-spin text-brand-cyan" />
          <p className="text-sm text-zinc-400 m-0">Cargando jobs…</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              onEjecutar={ejecutar}
              ejecutandoId={ejecutandoId}
            />
          ))}
          {jobs.length === 0 && (
            <div className={`${CARD} flex flex-col items-center justify-center text-center py-16 px-4`}>
              <Zap size={40} className="mb-3 text-brand-cyan" />
              <p className="text-sm font-bold text-zinc-700 m-0">No hay jobs registrados</p>
              <p className="text-xs text-zinc-400 mt-1 mb-0">El scheduler debe estar reiniciando.</p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
