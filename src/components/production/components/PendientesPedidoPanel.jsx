import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Spec 39 — "Lo que falta de este pedido": por cada orden de un área anterior del pedido,
 * qué llegó, si está completa y qué reposiciones siguen abiertas (con su estado real).
 * Es lo que el operario mira antes de reportar un faltante.
 */
export default function PendientesPedidoPanel({ ordenId, service, area, refreshKey }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (!ordenId) { setData(null); return; }
        let cancel = false;
        setLoading(true);
        service.getFallaPendientes(ordenId)
            .then(d => { if (!cancel) setData(d); })
            .catch(() => { if (!cancel) setData(null); })
            .finally(() => { if (!cancel) setLoading(false); });
        return () => { cancel = true; };
    }, [ordenId, refreshKey]);

    if (!ordenId) return null;
    if (loading && !data) return <div className="text-xs text-zinc-400 flex items-center gap-1 mb-5"><Loader2 size={12} className="animate-spin" /> Cargando lo que falta del pedido...</div>;
    if (!data || !data.noDocERP || !(data.ordenes || []).length) return null;

    // En PRO el libro trae TODA la secuencia del pedido (la necesita el reporte de fallas), pero
    // acá solo tiene sentido lo que llega a PRO: un DTF que va a Estampado nunca "llega" a PRO,
    // y mostraba "Todavía no llegó nada" para siempre. Las filas viejas sin ProximoServicio se
    // muestran igual.
    const areaPanel = String(data.area || area || '').trim().toUpperCase();
    const ordenes = areaPanel === 'PRO'
        ? data.ordenes.filter(o => !o.ProximoServicio || o.ProximoServicio === 'PRO')
        : data.ordenes;
    if (!ordenes.length) return null;

    // Estado de cada fila, en palabras de lo que pasó FÍSICAMENTE con la orden. Antes el cartel
    // verde "Completo" solo quería decir "no tiene envíos parciales ni reposiciones abiertas" y
    // salía también en órdenes de las que todavía no había llegado nada.
    const estadoDe = (o) => {
        if (o.incompleta) return o.enCamino.length ? 'EN_CAMINO' : 'INCOMPLETA';
        if (o.enCamino.length) return 'EN_CAMINO';
        if (!o.recibido.envios) return 'FALTA';
        return 'LLEGO';
    };
    const ETIQUETA = {
        LLEGO:      { txt: 'Llegó',       cls: 'bg-emerald-100 text-emerald-700' },
        EN_CAMINO:  { txt: 'En camino',   cls: 'bg-sky-100 text-sky-700' },
        FALTA:      { txt: 'Falta llegar', cls: 'bg-zinc-100 text-zinc-600' },
        INCOMPLETA: { txt: 'Incompleta',  cls: 'bg-amber-100 text-amber-700' },
    };
    const sinLlegar = ordenes.filter(o => estadoDe(o) !== 'LLEGO');
    return (
        <div className="border border-amber-200 rounded-2xl overflow-hidden mb-5 bg-white">
            <div className="bg-amber-50 px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wide text-amber-700">Lo que falta de este pedido</span>
                <span className="text-[10px] text-amber-700">Pedido {data.noDocERP} · {sinLlegar.length ? `falta${sinLlegar.length === 1 ? '' : 'n'} ${sinLlegar.length} de ${ordenes.length}` : 'todo llegó'}</span>
            </div>
            {ordenes.map(o => (
                <div key={o.OrdenID} className="grid grid-cols-[1.2fr_1fr_auto] gap-3 items-center px-4 py-2 border-t border-amber-100 text-xs">
                    <div>
                        <span className="font-mono font-bold text-brand-cyan">{o.CodigoOrden}</span> <span className="text-zinc-500">· {o.AreaID}{o.DescripcionTrabajo ? ` · ${o.DescripcionTrabajo}` : ''}</span>
                        <div className="text-zinc-600">
                            {o.recibido.envios
                                ? <>Recibido <b>{o.estadoEnvio === 'COMPLETO' && !o.incompleta ? 'completo' : `${o.recibido.envios} envío(s) en ${o.recibido.bultos} bulto(s)`}</b>{o.recibido.cantidad != null ? ` · ${o.recibido.cantidad} ${(o.UM || '').trim()}` : ''}</>
                                : <>Todavía no llegó nada de esta orden</>}
                        </div>
                    </div>
                    <div className="text-zinc-600">
                        {o.reposicionesAbiertas.map((r, i) => (
                            <div key={i}>Reposición <span className="font-mono font-bold">{r.CodigoFalla || '(sin orden todavía)'}</span><br /><span className="text-zinc-500">{r.descripcion}{r.FechaCreacion ? ` · desde ${new Date(r.FechaCreacion).toLocaleDateString()}` : ''}</span></div>
                        ))}
                        {o.enCamino.map((e, i) => <div key={'c' + i}>En camino: remito {e.remito}{e.cantidad != null ? ` · ${e.cantidad}` : ''}</div>)}
                        {o.estadoEnvio === 'PARCIAL' && !o.reposicionesAbiertas.length && !o.enCamino.length && <div>Envío parcial: el resto sigue en producción en {o.AreaID}</div>}
                        {estadoDe(o) === 'LLEGO' && <div>Sin pendientes</div>}
                    </div>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${ETIQUETA[estadoDe(o)].cls}`}>{ETIQUETA[estadoDe(o)].txt}</span>
                </div>
            ))}
            {sinLlegar.length > 0 && (
                <div className="px-4 py-2 border-t border-amber-100 bg-amber-50/60 text-[11px] text-amber-800">
                    Podés empezar con lo recibido. Si lo que te falta es esto, no hace falta reportar nada: ya está en camino o en producción.
                </div>
            )}
        </div>
    );
}
