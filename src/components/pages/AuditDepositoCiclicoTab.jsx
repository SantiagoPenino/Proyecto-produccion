import React, { useEffect, useState } from 'react';
import api from '../../services/apiClient';
import { toast } from 'react-hot-toast';
import { Loader2, RefreshCw, Camera } from 'lucide-react';

const fmtF = (d) => (d ? new Date(d).toLocaleDateString('es-UY') : '');
const plata = (v) => '$ ' + new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0));
const errorDe = (e) => e?.response?.data?.error || e?.message || 'Error';
const ESTADO = {
  NUNCA: { t: 'Nunca auditada', c: 'bg-red-100 text-red-800 border-red-200' },
  VENCIDO: { t: 'Vencida', c: 'bg-red-50 text-red-700 border-red-200' },
  PROXIMO: { t: 'Vence pronto', c: 'bg-amber-50 text-amber-700 border-amber-200' },
  AL_DIA: { t: 'Al día', c: 'bg-green-50 text-green-700 border-green-200' },
};
const CLASE = { A: 'bg-red-600', B: 'bg-amber-500', C: 'bg-slate-400' };

/**
 * FASE 5 — Conteo cíclico: en vez de parar el depósito una vez al año, se audita por área (prefijo) con una
 * frecuencia según su clase ABC (valor en depósito). Muestra qué áreas están vencidas y abre la auditoría parcial.
 */
export default function AuditDepositoCiclicoTab({ estado, onChange, refreshKey }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const sesionAbierta = !!(estado && estado.sesion);

  const cargar = () => {
    setLoading(true);
    api.get('/audit-deposito/ciclico').then(({ data }) => { if (data.success) setPlan(data.data); })
      .catch(e => toast.error('No se pudo cargar el plan: ' + errorDe(e))).finally(() => setLoading(false));
  };
  useEffect(cargar, [refreshKey]);

  const abrirArea = async (a) => {
    if (sesionAbierta) return toast.error('Ya hay una auditoría abierta. Cerrala o anulala primero.');
    const msg = `Abrir una auditoría SOLO del área ${a.prefijo}.\n\nSe toma la fotografía de sus ${a.n} órdenes activas (${plata(a.pesos)}). Los casos de las otras áreas no se tocan: ni se crean ni se cierran solos.\n\n¿Abrir ahora?`;
    if (!window.confirm(msg)) return;
    setBusy(a.prefijo);
    try {
      const { data } = await api.post('/audit-deposito/sesion/abrir', { alcanceTipo: 'PREFIJO', alcanceValor: a.prefijo, observaciones: `Conteo cíclico · clase ${a.clase}` });
      toast.success(data.message, { duration: 7000 });
      onChange && onChange();
    } catch (e) { toast.error('No se pudo abrir: ' + errorDe(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-bold text-teal-800">Conteo cíclico por área</h3>
          <p className="text-xs text-teal-700/80 mt-1 font-medium">Cada área se audita con una frecuencia según su <b>clase ABC</b> por valor en depósito. Así se cuenta por partes, sin parar el depósito entero. La lista está ordenada por urgencia.</p>
        </div>
        <button onClick={cargar} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm font-bold rounded shadow-sm hover:bg-slate-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
      </div>

      {!plan ? <div className="text-sm text-slate-400 py-8 text-center"><Loader2 size={18} className="inline animate-spin" /> Calculando el plan…</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
            {[
              { l: 'Áreas', v: plan.totales.areas, p: `${plan.totales.ordenes} órdenes · ${plata(plan.totales.pesos)}`, c: 'border-slate-200' },
              { l: 'Nunca auditadas', v: plan.totales.nunca, p: 'sin fotografía', c: 'border-red-200' },
              { l: 'Vencidas', v: plan.totales.vencidas, p: 'pasaron su frecuencia', c: 'border-red-200' },
              { l: 'Vencen pronto', v: plan.totales.proximas, p: 'en 2 días o menos', c: 'border-amber-200' },
              { l: 'Al día', v: plan.totales.alDia, p: 'dentro de la frecuencia', c: 'border-green-200' },
              { l: 'Cobertura', v: `${plan.totales.coberturaOrdenes}%`, p: 'órdenes en áreas al día', c: 'border-teal-200' },
            ].map(k => (
              <div key={k.l} className={`rounded-xl border bg-white p-3 ${k.c}`}>
                <div className="text-[10px] font-bold uppercase text-slate-500">{k.l}</div>
                <div className="text-2xl font-extrabold font-mono text-slate-800">{k.v}</div>
                <div className="text-[10px] text-slate-400">{k.p}</div>
              </div>
            ))}
          </div>

          <div className="mb-3 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>Clase <b className="text-red-700">A</b> = hasta el {plan.parametros.corteA}% del valor acumulado → cada <b>{plan.parametros.diasA}</b> días</span>
            <span>Clase <b className="text-amber-700">B</b> = hasta el {plan.parametros.corteB}% → cada <b>{plan.parametros.diasB}</b> días</span>
            <span>Clase <b className="text-slate-600">C</b> = el resto → cada <b>{plan.parametros.diasC}</b> días</span>
            <span className="text-slate-400">(claves AUDIT_DEP_CICLICO_DIAS_A/B/C y AUDIT_DEP_ABC_CORTES en ConfiguracionGlobal · cotización {plan.parametros.cotizacion})</span>
          </div>
          {plan.sugeridas.length > 0 && !sesionAbierta && (
            <div className="mb-3 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
              Sugerido para esta semana: {plan.sugeridas.map(p => <b key={p} className="font-mono mx-1">{p}</b>)} (las más atrasadas con más valor).
            </div>
          )}
          {plan.auditoriaAbierta && (
            <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              Hay una auditoría abierta ({plan.auditoriaAbierta.codigo}, alcance {plan.auditoriaAbierta.alcance}). Cerrala para que cuente en el plan.
            </div>
          )}

          <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 text-xs">
                <tr>
                  <th className="px-3 py-2">Área</th><th className="px-3 py-2">Clase</th><th className="px-3 py-2 text-right">Órdenes</th><th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-right">% valor acum.</th><th className="px-3 py-2 text-right">Caducadas</th><th className="px-3 py-2 text-right">Casos abiertos</th>
                  <th className="px-3 py-2">Última auditoría</th><th className="px-3 py-2 text-right">Hace</th><th className="px-3 py-2 text-right">Cada</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Próxima</th><th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.areas.map(a => (
                  <tr key={a.prefijo} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-mono font-bold text-indigo-800">{a.prefijo}{a.enAuditoriaAbierta && <span className="ml-1 text-[9px] text-indigo-600 bg-indigo-100 px-1 rounded">en curso</span>}</td>
                    <td className="px-3 py-2"><span className={`text-white text-[10px] font-bold px-2 py-0.5 rounded-full ${CLASE[a.clase]}`}>{a.clase}</span></td>
                    <td className="px-3 py-2 text-right font-mono">{a.n} <span className="text-[10px] text-slate-400">({a.pct}%)</span></td>
                    <td className="px-3 py-2 text-right font-mono">{plata(a.pesos)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{a.pctAcumulado}%</td>
                    <td className={`px-3 py-2 text-right font-mono ${a.caducadas ? 'text-purple-700 font-bold' : 'text-slate-400'}`}>{a.caducadas}</td>
                    <td className={`px-3 py-2 text-right font-mono ${a.casosAbiertos ? 'text-red-700 font-bold' : 'text-slate-400'}`}>{a.casosAbiertos}</td>
                    <td className="px-3 py-2 text-xs">{a.ultimaAuditoria ? <><b className="font-mono">{a.ultimaAuditoria.codigo}</b><div className="text-[10px] text-slate-400">{fmtF(a.ultimaAuditoria.fecha)} · {a.ultimaAuditoria.alcance}</div></> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2 text-right font-mono">{a.diasDesde != null ? `${a.diasDesde} d` : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{a.frecuenciaDias} d</td>
                    <td className="px-3 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ESTADO[a.estado].c}`}>{ESTADO[a.estado].t}{a.atraso ? ` (+${a.atraso} d)` : ''}</span></td>
                    <td className="px-3 py-2 text-xs">{fmtF(a.proximaFecha)}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => abrirArea(a)} disabled={sesionAbierta || busy === a.prefijo} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white">
                        {busy === a.prefijo ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Auditar solo {a.prefijo}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Una auditoría con alcance "depósito completo" cubre todas las áreas a la vez. La cobertura cuenta las órdenes de áreas auditadas dentro de su frecuencia.</p>
        </>
      )}
    </div>
  );
}
