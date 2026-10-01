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
    // [ACCESORIOS] en PRO, además de las órdenes anteriores, los accesorios de stock que salen con el producto
    const accesorios = Array.isArray(data?.accesorios) ? data.accesorios : [];
    if (!data || !data.noDocERP || (!(data.ordenes || []).length && !accesorios.length)) return null;

    // En PRO el libro trae TODA la secuencia del pedido (la necesita el reporte de fallas), pero
    // acá solo tiene sentido lo que llega a PRO: un DTF que va a Estampado nunca "llega" a PRO,
    // y mostraba "Todavía no llegó nada" para siempre. Las filas viejas sin ProximoServicio se
    // muestran igual.
    const areaPanel = String(data.area || area || '').trim().toUpperCase();
    const ordenes = areaPanel === 'PRO'
        ? data.ordenes.filter(o => !o.ProximoServicio || o.ProximoServicio === 'PRO')
        : data.ordenes;
    if (!ordenes.length && !accesorios.length) return null;

    // Estado de cada fila, en palabras de lo que pasó FÍSICAMENTE con la orden. Antes el cartel
    // verde "Completo" solo quería decir "no tiene envíos parciales ni reposiciones abiertas" y
    // salía también en órdenes de las que todavía no había llegado nada.
    const estadoDe = (o) => {
        if (o.incompleta) return o.enCamino.length ? 'EN_CAMINO' : 'INCOMPLETA';
        if (o.enCamino.length) return 'EN_CAMINO';
        if (!o.recibido.envios) {
            // [PENDIENTES] Si esa orden ya ENTREGÓ TODO (envío completo recibido en otra área, o quedó
            // "Recibido en Destino"/Finalizada), no falta nada: viene dentro de lo que sí llega acá
            // (ej. en Costura, la Sublimación ya está dentro del Corte). Con envío parcial o
            // reposición abierta sigue mostrándose como incompleta, que es lo que importa.
            const entregoTodo = o.estadoEnvio === 'COMPLETO'
                || /RECIBIDO EN DESTINO|ENTREGADO/i.test(String(o.EstadoenArea || ''))
                || /FINALIZADO|ENTREGADO/i.test(String(o.Estado || ''));
            return entregoTodo ? 'ENTREGADA' : 'FALTA';
        }
        return 'LLEGO';
    };
    const ETIQUETA = {
        LLEGO:      { txt: 'Llegó',       cls: 'bg-emerald-100 text-emerald-700' },
        EN_CAMINO:  { txt: 'En camino',   cls: 'bg-sky-100 text-sky-700' },
        FALTA:      { txt: 'Falta llegar', cls: 'bg-zinc-100 text-zinc-600' },
        INCOMPLETA: { txt: 'Incompleta',  cls: 'bg-amber-100 text-amber-700' },
        ENTREGADA:  { txt: 'Entregó todo', cls: 'bg-emerald-100 text-emerald-700' },
    };
    const sinLlegar = ordenes.filter(o => !['LLEGO', 'ENTREGADA'].includes(estadoDe(o)));
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
                            {estadoDe(o) === 'ENTREGADA'
                                ? <>Ya entregó completo{(o.entregadoA || []).length ? ` a ${o.entregadoA.join(', ')}` : ''}: viene dentro de lo que llega acá</>
                                : o.recibido.envios && o.viajaEnBultoDe
                                ? <>Recibido: viene <b>en el mismo bulto que {o.viajaEnBultoDe}</b> (misma prenda)</>
                                : o.viajaEnBultoDe
                                ? <>No lleva bulto propio: viaja <b>en el bulto de {o.viajaEnBultoDe}</b> (misma prenda)</>
                                : o.recibido.envios
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
                        {['LLEGO', 'ENTREGADA'].includes(estadoDe(o)) && <div>Sin pendientes</div>}
                    </div>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${ETIQUETA[estadoDe(o)].cls}`}>{ETIQUETA[estadoDe(o)].txt}</span>
                </div>
            ))}
            {sinLlegar.length > 0 && (
                <div className="px-4 py-2 border-t border-amber-100 bg-amber-50/60 text-[11px] text-amber-800">
                    Podés empezar con lo recibido. Si lo que te falta es esto, no hace falta reportar nada: ya está en camino o en producción.
                </div>
            )}
            {/* [ACCESORIOS] artículos de stock que salen con el producto: cada uno es un retiro VEN- que
                Logística WMS prepara y Producción recibe. Sin todos recibidos, el pedido no entra a Depósito. */}
            {accesorios.length > 0 && (() => {
                const unidades = parseFloat(data.orden?.Magnitud) || null;
                const ACC = {
                    RECIBIDO:     { txt: 'Recibido en PRO',         cls: 'bg-emerald-100 text-emerald-700' },
                    EN_CAMINO:    { txt: 'En camino: recibir remito', cls: 'bg-sky-100 text-sky-700' },
                    FALTA_RETIRO: { txt: 'Falta retirar del stock', cls: 'bg-amber-100 text-amber-700' },
                    CANCELADO:    { txt: 'Venta cancelada',          cls: 'bg-zinc-100 text-zinc-600' },
                };
                const faltan = accesorios.filter(a => a.estado !== 'RECIBIDO');
                return (
                    <>
                        <div className="px-4 py-2 border-t border-amber-200 bg-amber-50 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-wide text-amber-700">Accesorios de stock que salen con el producto</span>
                            <span className="text-[10px] text-amber-700">{faltan.length ? `falta${faltan.length === 1 ? '' : 'n'} ${faltan.length} de ${accesorios.length}` : 'todos recibidos'}</span>
                        </div>
                        {accesorios.map(a => {
                            const et = ACC[a.estado] || ACC.FALTA_RETIRO;
                            const cantidadOk = unidades == null || a.cantidad == null || a.cantidad >= unidades;
                            return (
                                <div key={a.ordenId} className="grid grid-cols-[1.2fr_1fr_auto] gap-3 items-center px-4 py-2 border-t border-amber-100 text-xs">
                                    <div>
                                        <span className="font-bold text-zinc-700">{a.nombre}</span> <span className="text-zinc-500">· <span className="font-mono">{a.ven}</span></span>
                                        <div className="text-zinc-600">
                                            Cantidad para el pedido: <b>{a.cantidad ?? '—'}</b>{unidades != null ? ` (pedido de ${unidades} unidades)` : ''}{a.cobro ? ` · se cobra aparte: ${a.cobro}` : ' · incluido en el precio'}
                                        </div>
                                    </div>
                                    <div className="text-zinc-600">
                                        {a.estado === 'RECIBIDO'
                                            ? <>Retiro confirmado en Logística WMS{a.bultosEnPro ? ` · ${a.bultosEnPro} bulto(s) en PRO` : ''}</>
                                            : a.estado === 'EN_CAMINO' ? <>Retirado del stock: viene con remito de Depósito a PRO. Recibilo en Logística de PRO.</>
                                            : a.estado === 'CANCELADO' ? <>La venta se canceló: el accesorio no viene</>
                                            : <>Pendiente de preparar y confirmar en Logística WMS</>}
                                        {!cantidadOk && <div className="text-rose-600 font-bold">La cantidad no cubre las unidades del pedido.</div>}
                                    </div>
                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${et.cls}`}>{et.txt}</span>
                                </div>
                            );
                        })}
                        {faltan.length > 0 && (
                            <div className="px-4 py-2 border-t border-amber-100 bg-amber-50/60 text-[11px] text-amber-800">
                                Producción los recibe cuando Logística confirma el retiro. Hasta que estén todos, el pedido no puede entrar a Depósito.
                            </div>
                        )}
                    </>
                );
            })()}
        </div>
    );
}
