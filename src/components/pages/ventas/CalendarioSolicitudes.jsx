import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { errorDe } from './solicitudesComunes';

/**
 * Calendario del mes, como el de la maqueta "Ingreso a producción":
 *   rojo  = entrega comprometida con el cliente (tachada si ya es pedido completo)
 *   ámbar = ventana de entrega (los días previos, cuando se cargó un rango)
 *   azul  = trabajo planificado: la fecha prometida de cada orden del pedido en su sector
 * Al hacer clic en un día se ve todo lo que cae ese día. Abajo, las solicitudes sin fecha de entrega.
 */
const NOMBRE_AREA = { SB: 'Sublimación', TWC: 'Corte', TWT: 'Costura', EMB: 'Bordado', DF: 'DTF', TPU: 'TPU', EST: 'Estampado' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = (d) => d.toISOString().slice(0, 10);
const addDias = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

export default function CalendarioSolicitudes({ onAbrir }) {
    const [mes, setMes] = useState(() => { const h = new Date(); return new Date(Date.UTC(h.getFullYear(), h.getMonth(), 1)); });
    const [data, setData] = useState({ entregas: [], trabajo: [], sinFecha: [] });
    const [loading, setLoading] = useState(false);
    const [dia, setDia] = useState(null);

    const primero = iso(mes);
    const ultimo = iso(new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 0)));
    useEffect(() => {
        setLoading(true);
        svc.calendario(primero, ultimo).then(setData).catch(e => toast.error(errorDe(e))).finally(() => setLoading(false));
    }, [primero, ultimo]);

    // Qué cae en cada día
    const porDia = useMemo(() => {
        const m = {};
        const add = (f, k, x) => { if (!f) return; (m[f] = m[f] || { entregas: [], ventana: [], trabajo: [], unidades: 0 })[k].push(x); };
        data.entregas.forEach(e => {
            add(e.FechaEntrega, 'entregas', e);
            if (m[e.FechaEntrega]) m[e.FechaEntrega].unidades += Number(e.Unidades) || 0;
            if (e.FechaEntregaHasta && e.FechaEntregaHasta > e.FechaEntrega) { for (let f = addDias(e.FechaEntrega, 1); f <= e.FechaEntregaHasta; f = addDias(f, 1)) add(f, 'ventana', e); }
        });
        data.trabajo.forEach(t => add(t.Fecha, 'trabajo', t));
        return m;
    }, [data]);

    // Grilla del mes (lunes a domingo)
    const celdas = useMemo(() => {
        const out = [];
        const dow = (new Date(primero + 'T00:00:00Z').getUTCDay() + 6) % 7;   // 0 = lunes
        for (let i = 0; i < dow; i++) out.push(null);
        for (let f = primero; f <= ultimo; f = addDias(f, 1)) out.push(f);
        while (out.length % 7) out.push(null);
        return out;
    }, [primero, ultimo]);
    const hoy = iso(new Date());
    const sel = dia ? porDia[dia] : null;

    return (
        <div className="space-y-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1">
                        <button onClick={() => setMes(new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() - 1, 1)))} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><ChevronLeft size={14} /></button>
                        <button onClick={() => setMes(new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 1)))} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><ChevronRight size={14} /></button>
                        <button onClick={() => { const h = new Date(); setMes(new Date(Date.UTC(h.getFullYear(), h.getMonth(), 1))); setDia(hoy); }} className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold hover:bg-slate-50">Hoy</button>
                        <h2 className="text-lg font-black text-slate-800 ml-2 capitalize">{MESES[mes.getUTCMonth()]} {mes.getUTCFullYear()}</h2>
                        {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
                    </div>
                    <div className="flex flex-wrap gap-3 text-[10px] text-slate-600">
                        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500 align-middle mr-1" />entrega</span>
                        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 align-middle mr-1" />ventana de entrega</span>
                        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500 align-middle mr-1" />trabajo planificado (fecha prometida de cada orden)</span>
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <div key={d} className="text-[10px] font-black uppercase text-slate-400 text-center">{d}</div>)}
                    {celdas.map((f, i) => {
                        if (!f) return <div key={`v${i}`} />;
                        const c = porDia[f];
                        const finde = i % 7 >= 5;
                        return (
                            <button key={f} type="button" onClick={() => setDia(f)}
                                className={`text-left min-h-[76px] rounded-lg border p-1 align-top ${dia === f ? 'border-brand-cyan ring-1 ring-brand-cyan' : 'border-slate-200'} ${finde ? 'bg-slate-50' : 'bg-white'} hover:border-brand-cyan/50`}>
                                <div className="flex items-center justify-between">
                                    {/* Hoy y el día elegido en brand-cyan (06/10; antes índigo, que el tema oscuro pasaba a amarillo) */}
                                    <span className={`text-[11px] font-bold ${f === hoy ? 'bg-brand-cyan text-white rounded-full px-1.5' : 'text-slate-600'}`}>{Number(f.slice(8, 10))}</span>
                                    {c?.unidades > 0 && <span className="text-[9px] text-slate-400">{c.unidades} u</span>}
                                </div>
                                <div className="space-y-0.5 mt-0.5">
                                    {(c?.entregas || []).slice(0, 2).map(e => <div key={`e${e.SolicitudID}`} className={`truncate text-[10px] rounded px-1 bg-rose-500 text-white ${e.Convertidos >= e.Productos && e.Productos > 0 ? 'line-through opacity-70' : ''}`}>{e.NombreTrabajo}</div>)}
                                    {(c?.ventana || []).slice(0, 1).map(e => <div key={`v${e.SolicitudID}`} className="truncate text-[10px] rounded px-1 bg-amber-100 text-amber-800">ventana: {e.NombreTrabajo}</div>)}
                                    {(c?.trabajo || []).slice(0, 2).map(t => <div key={`t${t.OrdenID}`} className="truncate text-[10px] rounded px-1 bg-sky-100 text-sky-800" title={t.NombreTrabajo}>{NOMBRE_AREA[t.AreaID] || t.AreaID} · {t.CodigoOrden}</div>)}
                                    {c && (() => { const ocultos = Math.max(0, c.entregas.length - 2) + Math.max(0, c.ventana.length - 1) + Math.max(0, c.trabajo.length - 2); return ocultos > 0 ? <div className="text-[9px] text-slate-400">+{ocultos} más (tocá el día)</div> : null; })()}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {dia && (
                <div className="bg-white border border-slate-200 rounded-2xl p-3 text-xs space-y-3">
                    <div className="flex items-center justify-between"><b className="text-slate-800">{dia.split('-').reverse().join('/')}</b><button onClick={() => setDia(null)} className="text-slate-400 hover:text-slate-600">Cerrar</button></div>
                    {!sel && <div className="text-slate-400">Nada cae este día.</div>}
                    {sel?.entregas.length > 0 && <div><div className="text-[10px] font-black uppercase text-rose-700 mb-1">Entregas de este día</div>{sel.entregas.map(e => <div key={e.SolicitudID} className="flex items-center justify-between gap-2 py-0.5 border-t border-slate-100"><span><b>{e.NombreTrabajo}</b> · {e.ClienteNombre} · {e.Unidades || 0} u · {e.Convertidos}/{e.Productos} en producción</span><button onClick={() => onAbrir(e.SolicitudID)} className="text-brand-cyan font-bold hover:underline">Abrir</button></div>)}</div>}
                    {sel?.ventana.length > 0 && <div><div className="text-[10px] font-black uppercase text-amber-700 mb-1">Dentro de la ventana de entrega</div>{sel.ventana.map(e => <div key={e.SolicitudID} className="flex items-center justify-between gap-2 py-0.5 border-t border-slate-100"><span>{e.NombreTrabajo} · {e.ClienteNombre} (entrega {e.FechaEntrega.split('-').reverse().join('/')} → {e.FechaEntregaHasta.split('-').reverse().join('/')})</span><button onClick={() => onAbrir(e.SolicitudID)} className="text-brand-cyan font-bold hover:underline">Abrir</button></div>)}</div>}
                    {sel?.trabajo.length > 0 && <div><div className="text-[10px] font-black uppercase text-sky-700 mb-1">Trabajo planificado (fecha prometida de cada orden)</div>{sel.trabajo.map(t => <div key={t.OrdenID} className="flex items-center justify-between gap-2 py-0.5 border-t border-slate-100"><span><b>{NOMBRE_AREA[t.AreaID] || t.AreaID}</b> · {t.CodigoOrden} · {t.NombreTrabajo} · {t.ClienteNombre} · {t.EstadoenArea || t.Estado}</span><button onClick={() => onAbrir(t.SolicitudID)} className="text-brand-cyan font-bold hover:underline">Abrir</button></div>)}</div>}
                </div>
            )}

            {data.sinFecha.length > 0 && (
                <div className="bg-white border border-rose-200 rounded-2xl p-3 text-xs">
                    <div className="text-[10px] font-black uppercase text-rose-700 mb-1">Sin fecha de entrega ({data.sinFecha.length}) — es un requisito pendiente</div>
                    <div className="flex flex-wrap gap-2">{data.sinFecha.map(e => <button key={e.SolicitudID} onClick={() => onAbrir(e.SolicitudID)} className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">#{e.SolicitudID} {e.NombreTrabajo} <span className="text-slate-400">· {e.ClienteNombre}</span></button>)}</div>
                </div>
            )}
        </div>
    );
}
