/**
 * ContabilidadReconciliacionView.jsx
 * Auditoría y reparación de órdenes en depósito sin contabilizar.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2,
  Wrench, Clock, PackageSearch, Activity, Loader2, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

const API = import.meta.env.VITE_API_URL || '';
const tok = () => { try { return JSON.parse(localStorage.getItem('user'))?.token || ''; } catch { return ''; } };

const req = async (url, opts = {}) => {
  const r = await fetch(`${API}${url}`, {
    headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  // Un 502/504 del proxy viene en HTML: antes reventaba en r.json() con «Unexpected token <». El 401/403 de
  // verifyToken trae `message`, no `error`.
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(json?.error || json?.message || `Error ${r.status}`);
  if (!json) throw new Error('El servidor respondió algo que no se pudo leer.');
  return json;
};

// 24 horas (antes salía «12:54 p. m.»)
const fmtFecha = (f) =>
  f ? new Date(f).toLocaleString('es-UY', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Montevideo',
  }) : '—';

const fmtMonto = (m) =>
  m != null ? `$${parseFloat(m).toLocaleString('es-UY', { minimumFractionDigits: 2 })}` : '—';

// Estética nueva (28/10/2026): encabezado con ícono brand-cyan sin fondo, tarjetas blancas, botones brand-cyan y,
// en el celular, una lista de tarjetas en vez de la tabla de 5 columnas.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const ETIQUETA = 'text-[10px] font-black uppercase tracking-widest text-zinc-400';
const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide whitespace-nowrap';

// Tabla en pantallas anchas; en el celular, tarjetas. Se dibuja una sola de las dos vistas.
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
  const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
  useEffect(() => {
    const mq = window.matchMedia(MQ_TABLA);
    const cambio = () => setConTabla(mq.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);
  return conTabla;
}

const chipEstado = (item) => (
  item.MontoContabilizado != null
    ? <span className={`${CHIP} bg-emerald-50 border-emerald-200 text-emerald-700`}><CheckCircle2 size={11} /> Contabilizado</span>
    : <span className={`${CHIP} bg-amber-50 border-amber-200 text-amber-700`}><AlertTriangle size={11} /> Pendiente</span>
);

// Tarjeta «Estado del sistema». Antes había solo dos estados y, como los datos arrancan en 0, si la auditoría
// fallaba (o mientras cargaba) la pantalla decía «Todo en orden» sin haber auditado nada.
const ESTADO = {
  cargando:   { caja: 'bg-white border-zinc-200',                   Icono: Loader2,       icono: 'text-brand-cyan animate-spin', texto: 'text-zinc-500',      titulo: 'Auditando…' },
  error:      { caja: 'bg-brand-magenta/5 border-brand-magenta/20', Icono: XCircle,       icono: 'text-brand-magenta',           texto: 'text-brand-magenta', titulo: 'No se pudo auditar' },
  pendientes: { caja: 'bg-amber-50 border-amber-200',               Icono: AlertTriangle, icono: 'text-amber-600',               texto: 'text-amber-700',     titulo: 'Requiere atención' },
  ok:         { caja: 'bg-emerald-50 border-emerald-200',           Icono: CheckCircle2,  icono: 'text-emerald-600',             texto: 'text-emerald-700',   titulo: 'Todo en orden' },
};

// ── Vista Principal ────────────────────────────────────────────────────────────
export default function ContabilidadReconciliacionView() {
  const [datos, setDatos]             = useState({ inconsistencias: 0, detalle: [] });
  const [loading, setLoading]         = useState(true); // true de entrada: si no, el primer cuadro mostraba «Todo en orden»
  const [error, setError]             = useState(null);
  const [ejecutando, setEjecutando]   = useState(false);
  const [ultimaRevision, setUltimaRevision] = useState(null);
  const conTabla = useConTabla();

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await req('/api/contabilidad/reconciliacion/audit');
      if (typeof data.inconsistencias !== 'number' || !Array.isArray(data.detalle)) {
        throw new Error('La auditoría no devolvió el detalle de órdenes.');
      }
      setDatos(data);
      setUltimaRevision(new Date());
    } catch (e) {
      // fetch tira TypeError cuando no llega al servidor («Failed to fetch»)
      const msg = e instanceof TypeError ? 'No hay conexión con el servidor.' : e.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const ejecutarReconciliacion = async () => {
    setEjecutando(true);
    try {
      await req('/api/contabilidad/reconciliacion/ejecutar', { method: 'POST' });
      toast.success('✅ Reconciliación iniciada. Revisá los logs o refrescá en unos segundos.');
      // Refrescar después de 4 segundos para dar tiempo al job
      setTimeout(() => { cargar(); setEjecutando(false); }, 4000);
    } catch (e) {
      toast.error(e.message);
      setEjecutando(false);
    }
  };

  const hayInconsistencias = datos.inconsistencias > 0;
  const estado = loading ? 'cargando' : error ? 'error' : hayInconsistencias ? 'pendientes' : 'ok';
  const { caja, Icono, icono, texto, titulo } = ESTADO[estado];
  const conDato = estado === 'ok' || estado === 'pendientes';

  return (
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">

      {/* Encabezado */}
      <div className="flex flex-col lg:flex-row justify-between lg:items-start gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <ShieldCheck size={30} className="text-brand-cyan shrink-0" />
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">
              Reconciliación contable WMS
            </h1>
          </div>
          <p className="text-zinc-500 text-sm mt-2 max-w-2xl">
            Detecta órdenes que ingresaron al depósito sin que el motor contable haya ejecutado correctamente.
            El sistema ejecuta esto automáticamente a las <strong className="text-zinc-700">09:00</strong> y <strong className="text-zinc-700">21:00</strong> cada día.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button onClick={cargar} disabled={loading} className={`${BTN_SECUNDARIO} flex-1 lg:flex-none whitespace-nowrap`}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Auditar ahora
          </button>
          <button onClick={ejecutarReconciliacion} disabled={ejecutando || loading} className={`${BTN_PRINCIPAL} flex-1 lg:flex-none whitespace-nowrap`}>
            {ejecutando
              ? <><Activity size={15} className="animate-pulse" /> Ejecutando...</>
              : <><Wrench size={15} /> Ejecutar reparación</>}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* Estado general */}
        <div className={`rounded-2xl border p-4 sm:p-5 flex items-center gap-4 ${caja}`}>
          <Icono size={28} className={`shrink-0 ${icono}`} />
          <div className="min-w-0">
            <p className={ETIQUETA}>Estado del sistema</p>
            <p className={`text-lg font-black mt-0.5 ${texto}`}>{titulo}</p>
          </div>
        </div>

        {/* Inconsistencias detectadas (sin auditoría hecha, «—» en vez de un 0 que no se sabe) */}
        <div className={`${CARD} p-4 sm:p-5 flex items-center gap-4`}>
          <PackageSearch size={28} className={`shrink-0 ${conDato && hayInconsistencias ? 'text-brand-magenta' : 'text-zinc-300'}`} />
          <div className="min-w-0">
            <p className={ETIQUETA}>Sin contabilizar</p>
            <p className={`text-3xl font-black mt-0.5 leading-none ${!conDato ? 'text-zinc-300' : hayInconsistencias ? 'text-brand-magenta' : 'text-zinc-900'}`}>
              {conDato ? datos.inconsistencias : '—'}
            </p>
            <p className="text-xs text-zinc-400 mt-1">
              {!conDato
                ? (estado === 'error' ? 'sin datos' : 'auditando…')
                : datos.inconsistencias === 0 ? 'órdenes en depósito' : datos.inconsistencias === 1 ? 'orden en depósito' : 'órdenes en depósito'}
            </p>
          </div>
        </div>

        {/* Última revisión */}
        <div className={`${CARD} p-4 sm:p-5 flex items-center gap-4`}>
          <Clock size={28} className="text-brand-cyan shrink-0" />
          <div className="min-w-0">
            <p className={ETIQUETA}>Última revisión</p>
            <p className="text-sm font-bold text-zinc-800 mt-1">
              {ultimaRevision ? fmtFecha(ultimaRevision.toISOString()) : '—'}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">Automática: 09:00 y 21:00</p>
          </div>
        </div>
      </div>

      {/* Auditando */}
      {estado === 'cargando' && (
        <div className={`${CARD} flex flex-col items-center justify-center text-center px-4 py-14 gap-3`}>
          <Loader2 size={32} className="animate-spin text-brand-cyan" />
          <p className="text-sm text-zinc-500">Revisando las órdenes en depósito…</p>
        </div>
      )}

      {/* La auditoría falló: no se sabe si hay órdenes sin contabilizar */}
      {estado === 'error' && (
        <div className={`${CARD} flex flex-col items-center justify-center text-center px-4 py-12 gap-3`}>
          <XCircle size={44} className="text-brand-magenta" />
          <p className="text-lg font-black text-zinc-900">No se pudo hacer la auditoría</p>
          <p className="text-sm text-zinc-500 max-w-md">
            Hasta que se pueda auditar no se sabe si hay órdenes en depósito sin contabilizar.
          </p>
          <p className="text-xs font-mono text-brand-magenta bg-brand-magenta/5 border border-brand-magenta/20 rounded-lg px-3 py-1.5 max-w-full break-words">
            {error}
          </p>
          <button onClick={cargar} className={`${BTN_SECUNDARIO} mt-1`}>
            <RefreshCw size={15} /> Reintentar
          </button>
        </div>
      )}

      {/* Banner de todo OK */}
      {estado === 'ok' && (
        <div className={`${CARD} flex flex-col items-center justify-center text-center px-4 py-14 gap-3`}>
          <CheckCircle2 size={44} className="text-emerald-500" />
          <p className="text-lg font-black text-zinc-900">Sistema contable íntegro</p>
          <p className="text-sm text-zinc-500">
            Todas las órdenes en depósito tienen su contabilidad registrada correctamente.
          </p>
        </div>
      )}

      {/* Tabla de inconsistencias */}
      {estado === 'pendientes' && (
        <div className={`${CARD} overflow-hidden`}>

          {/* Header tabla */}
          <div className="px-4 sm:px-5 py-3 border-b border-zinc-100 flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <span className="text-sm font-black text-zinc-900 uppercase tracking-tight">
                Órdenes pendientes de contabilización
              </span>
              <span className={`${CHIP} bg-amber-50 border-amber-200 text-amber-700`}>
                {datos.inconsistencias} registro{datos.inconsistencias !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {conTabla ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    <th className={TH}>Código orden</th>
                    <th className={TH}>PC#</th>
                    <th className={`${TH} text-right`}>Monto total</th>
                    <th className={TH}>Estado contable</th>
                    <th className={TH}>Ingreso a depósito</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {datos.detalle.map((item) => (
                    <tr key={item.PCId} className="hover:bg-zinc-50/60 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-sm text-zinc-900 whitespace-nowrap">{item.CodigoOrden}</td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500 whitespace-nowrap">#{item.PCId}</td>
                      <td className="px-4 py-3 text-sm font-bold text-zinc-800 text-right whitespace-nowrap">{fmtMonto(item.MontoTotal)}</td>
                      <td className="px-4 py-3">{chipEstado(item)}</td>
                      <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">{fmtFecha(item.FechaDeposito)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {datos.detalle.map((item) => (
                <li key={item.PCId} className="px-4 py-3 flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono font-bold text-sm text-zinc-900 truncate">{item.CodigoOrden}</span>
                    <span className="text-sm font-bold text-zinc-800 whitespace-nowrap">{fmtMonto(item.MontoTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-zinc-500 truncate">
                      <span className="font-mono">PC #{item.PCId}</span> · {fmtFecha(item.FechaDeposito)}
                    </span>
                    {chipEstado(item)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Footer con acción */}
          {!loading && hayInconsistencias && (
            <div className="px-4 sm:px-5 py-4 border-t border-zinc-100 bg-zinc-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                Al ejecutar la reparación, el sistema procesará cada orden listada{' '}
                <span className="text-zinc-800 font-bold">aplicando la lógica de prepago si corresponde</span>.
              </p>
              <button onClick={ejecutarReconciliacion} disabled={ejecutando} className={`${BTN_PRINCIPAL} shrink-0`}>
                {ejecutando
                  ? <><Activity size={15} className="animate-pulse" /> Procesando...</>
                  : <><Wrench size={15} /> Reparar {datos.inconsistencias} {datos.inconsistencias !== 1 ? 'órdenes' : 'orden'}</>}
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
