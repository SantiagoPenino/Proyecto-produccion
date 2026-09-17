import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Bell, CheckCircle2, Clock, Loader2, PackageSearch, RefreshCw, Scissors, Send, ShoppingBag, Store, X } from 'lucide-react';
import { solicitudesInsumoService as svc } from '../../../services/modules/solicitudesInsumoService';
import { fmtFechaHora } from '../../../utils/fechas';

/**
 * Spec 39 — Bandeja "Solicitudes de insumo": cuando en producción se daña tela o prendas que
 * trajo el cliente (o un producto del local), no nace ninguna orden. Acá Atención al Cliente y
 * Administración ven la solicitud, el stock que el sistema encontró de ESA tela de ESE cliente,
 * notifican por el portal (nada automático, nada por WhatsApp) y registran la decisión.
 */
const ESTADO = {
    NUEVA: { txt: 'Nueva · sin avisar al cliente', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    NOTIFICADA: { txt: 'Avisada · esperando al cliente', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    SIN_RESPUESTA: { txt: 'Venció sin respuesta', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
    RESUELTA: { txt: 'Resuelta', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};
const TIPO = {
    TELA_CLIENTE: { txt: 'Tela del cliente', icon: Scissors },
    PRENDA_CLIENTE: { txt: 'Prendas del cliente', icon: ShoppingBag },
    PRODUCTO_LOCAL: { txt: 'Producto del local', icon: Store },
};
const DECISION_TXT = { USA_STOCK: 'Usa su stock', TRAE_MAS: 'Trae más', ACEPTA_PARCIAL: 'Se lleva lo producido', COMPRA_ADMIN: 'Compra Administración', VEN_INTERNA: 'VEN interna' };

// Producto del local: al cliente no se le avisa ni decide; solo se aprueba la reposición.
const esLocal = (s) => s?.Tipo === 'PRODUCTO_LOCAL';
const Pill = ({ e, local }) => { const s = (local && e === 'NUEVA') ? { txt: 'Nueva · falta aprobar', cls: ESTADO.NUEVA.cls } : ESTADO[e] ||{ txt: e, cls: 'bg-slate-100 text-slate-600 border-slate-200' }; return <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wide ${s.cls}`}>{s.txt}</span>; };
const cant = (s) => s.Cantidad != null ? `${Number(s.Cantidad)} ${String(s.Unidad || '').trim()}` : 'cantidad a confirmar';

export default function SolicitudesInsumoPage() {
    const [filtro, setFiltro] = useState('ABIERTAS');
    const [data, setData] = useState({ solicitudes: [], resumen: {} });
    const [loading, setLoading] = useState(false);
    const [sel, setSel] = useState(null);

    const cargar = useCallback(async () => {
        setLoading(true);
        try { setData(await svc.listar(filtro)); }
        catch (e) { toast.error(e.response?.data?.error || e.message); }
        finally { setLoading(false); }
    }, [filtro]);
    useEffect(() => { cargar(); }, [cargar]);

    const abiertas = (data.resumen.NUEVA || 0) + (data.resumen.NOTIFICADA || 0) + (data.resumen.SIN_RESPUESTA || 0);

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-black text-slate-800 flex items-center gap-2"><PackageSearch size={22} className="text-indigo-500" /> Solicitudes de insumo del cliente</h1>
                    <p className="text-xs text-slate-500 mt-1">Insumo del cliente o del local dañado en producción. Nada se crea solo: acá se avisa al cliente por el portal y se registra su decisión.</p>
                </div>
                <div className="flex items-center gap-2">
                    {['ABIERTAS', 'RESUELTAS', 'TODAS'].map(f => (
                        <button key={f} onClick={() => setFiltro(f)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${filtro === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                            {f === 'ABIERTAS' ? `Abiertas (${abiertas})` : f === 'RESUELTAS' ? `Resueltas (${data.resumen.RESUELTA || 0})` : 'Todas'}
                        </button>
                    ))}
                    <button onClick={cargar} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500" title="Actualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="text-left px-3 py-2">Estado</th>
                                <th className="text-left px-3 py-2">Cliente / orden</th>
                                <th className="text-left px-3 py-2">Insumo</th>
                                <th className="text-left px-3 py-2">Qué se dañó</th>
                                <th className="text-left px-3 py-2">Stock del cliente</th>
                                <th className="text-left px-3 py-2">Plazo</th>
                                <th className="text-left px-3 py-2">Decisión</th>
                                <th className="px-3 py-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && data.solicitudes.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">No hay solicitudes {filtro === 'ABIERTAS' ? 'abiertas' : ''}.</td></tr>}
                            {data.solicitudes.map(s => {
                                const T = TIPO[s.Tipo] || { txt: s.Tipo, icon: PackageSearch };
                                const vence = s.Estado === 'RESUELTA' || esLocal(s) ? null : s.DiasParaVencer;
                                return (
                                    <tr key={s.SolicitudID} className="border-t border-slate-100 hover:bg-indigo-50/40 cursor-pointer" onClick={() => setSel(s.SolicitudID)}>
                                        <td className="px-3 py-2"><Pill e={s.Estado} local={esLocal(s)} /><div className="text-[10px] text-slate-400 mt-1">#{s.SolicitudID} · {fmtFechaHora(s.FechaCreacion)}</div></td>
                                        <td className="px-3 py-2"><div className="font-bold text-slate-800">{s.Cliente}</div><div className="font-mono text-slate-500">{s.CodigoMadre}{s.NoDocERP ? ` · pedido ${s.NoDocERP}` : ''}</div><div className="text-[10px] text-slate-400">reportó {s.AreaReporta}{s.CodigoReporta ? ` (${String(s.CodigoReporta).trim()})` : ''}</div></td>
                                        <td className="px-3 py-2"><span className="inline-flex items-center gap-1 font-bold text-slate-700"><T.icon size={12} /> {T.txt}</span>{s.StockEncontrado?.insumo?.descripcion && <div className="text-[10px] text-slate-500">{s.StockEncontrado.insumo.descripcion}</div>}</td>
                                        <td className="px-3 py-2"><div className="font-bold">{cant(s)}</div><div className="text-slate-500">{s.Motivo}</div></td>
                                        <td className="px-3 py-2">{s.StockEncontrado?.encontrado?.length ? <span className="text-emerald-700 font-bold">{s.StockEncontrado.resumen}</span> : <span className="text-slate-400">{s.StockEncontrado?.resumen || 'Sin stock'}</span>}</td>
                                        <td className="px-3 py-2">{vence == null ? '—' : vence < 0 ? <span className="text-rose-600 font-bold">Vencida hace {-vence} d</span> : <span className={vence <= 2 ? 'text-amber-600 font-bold' : 'text-slate-600'}>{vence} día(s)</span>}</td>
                                        <td className="px-3 py-2">{s.Decision ? <span className="font-bold text-slate-700">{DECISION_TXT[s.Decision] || s.Decision}</span> : <span className="text-slate-400">{esLocal(s) ? 'Falta aprobar' : s.NotificadaPortal ? 'Avisado, sin respuesta' : 'Sin avisar'}</span>}{s.CodigoFalla && <div className="font-mono text-[10px] text-indigo-600">{String(s.CodigoFalla).trim()}</div>}</td>
                                        <td className="px-3 py-2 text-right"><button className="text-indigo-600 font-bold hover:underline">Abrir</button></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {sel && <DetalleSolicitud id={sel} onClose={() => setSel(null)} onChange={() => { cargar(); }} />}
        </div>
    );
}

function DetalleSolicitud({ id, onClose, onChange }) {
    const [s, setS] = useState(null);
    const [busy, setBusy] = useState(false);
    const [mensaje, setMensaje] = useState('');
    const [decision, setDecision] = useState('');
    const [medio, setMedio] = useState('portal');
    const [detalle, setDetalle] = useState('');
    const [bobinaId, setBobinaId] = useState('');
    const [prendaId, setPrendaId] = useState('');
    const [cantidadProducida, setCantidadProducida] = useState('');

    const cargar = useCallback(async () => {
        try { const d = await svc.detalle(id); setS(d); if (!decision) setDecision(d.Decision || (esLocal(d) ? 'VEN_INTERNA' : '')); }
        catch (e) { toast.error(e.response?.data?.error || e.message); }
    }, [id]);
    useEffect(() => { cargar(); }, [cargar]);

    const stock = useMemo(() => s?.StockActual?.encontrado?.length ? s.StockActual : s?.StockEncontrado, [s]);
    const candidatas = stock?.encontrado || [];
    const resuelta = s?.Estado === 'RESUELTA';

    const notificar = async () => {
        if (!window.confirm(`Se va a crear un ticket visible en el portal del cliente ${s.Cliente} pidiendo su decisión por ${s.CodigoMadre}. No se envía WhatsApp. ¿Confirmás?`)) return;
        setBusy(true);
        try { const r = await svc.notificar(id, mensaje.trim() || undefined); toast.success(r.message); await cargar(); onChange(); }
        catch (e) { toast.error(e.response?.data?.error || e.message); }
        finally { setBusy(false); }
    };

    const textoConfirm = () => {
        switch (decision) {
            case 'USA_STOCK': { const b = candidatas.find(c => String(c.BobinaID || c.PrendaClienteID) === String(bobinaId || prendaId)); return `Se crea la orden de falla ${s.CodigoMadre}-F… usando ${b ? (b.CodigoEtiqueta ? `la bobina ${b.CodigoEtiqueta} (${Number(b.MetrosRestantes).toFixed(2)} m)` : `las prendas ${b.CodigoRecepcion || ''}`) : 'el stock elegido'} del cliente, y las que sigan en la cadena. La orden que reportó se libera cuando llegue la reposición.`; }
            case 'TRAE_MAS': return `Se registra que el cliente trae más ${s.Tipo === 'PRENDA_CLIENTE' ? 'prendas' : 'tela'}. NO se crea ninguna orden ahora: nace cuando Ingreso de materiales cargue la PRE nueva y la vincule a esta solicitud #${id}.`;
            case 'COMPRA_ADMIN': return `Se registra que Administración compra el insumo. NO se crea ninguna orden ahora: nace cuando ingrese como PRE vinculada a esta solicitud #${id}.`;
            case 'ACEPTA_PARCIAL': return `El cliente se lleva lo producido: ${s.CodigoMadre} pasa a ${cantidadProducida} ${String(s.UMMadre || '').trim()}, se recotiza con el mismo precio unitario, la falla se cierra sin costo y la orden que reportó se libera. No se repone nada.`;
            case 'VEN_INTERNA': return `Se crea una VEN interna a precio 0 por ${cant(s)} del producto del local: descuenta stock, no genera deuda ni factura, y viaja a ${s.AreaReporta} como complemento de ${s.CodigoMadre}.`;
            default: return '';
        }
    };

    const decidir = async () => {
        if (!decision) return toast.warning('Elegí qué decidió el cliente.');
        if (decision === 'USA_STOCK' && !(bobinaId || prendaId)) return toast.warning('Elegí qué bobina o prendas del cliente se usan.');
        if (decision === 'ACEPTA_PARCIAL' && !(Number(cantidadProducida) >= 0 && cantidadProducida !== '')) return toast.warning('Indicá cuánto se produjo realmente.');
        if (!window.confirm(esLocal(s) ? `${textoConfirm()}\n\nAl cliente no se le avisa. ¿Aprobar la reposición?` : `${textoConfirm()}\n\nConfirmación del cliente: ${medio}. ¿Registrar?`)) return;
        setBusy(true);
        try {
            const r = await svc.decidir(id, { decision, medioConfirmacion: esLocal(s) ? 'interno' : medio, detalle: detalle.trim() ? detalle.trim() + ' ' : undefined, bobinaId: bobinaId || undefined, prendaId: prendaId || undefined, cantidadProducida: decision === 'ACEPTA_PARCIAL' ? Number(cantidadProducida) : undefined });
            toast.success(r.message, { duration: 8000 });
            await cargar(); onChange();
        } catch (e) { toast.error(e.response?.data?.error || e.message); }
        finally { setBusy(false); }
    };

    if (!s) return <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center"><Loader2 className="animate-spin text-white" /></div>;
    const T = TIPO[s.Tipo] || { txt: s.Tipo, icon: PackageSearch };
    return (
        <div className="fixed inset-0 bg-black/30 z-40 flex justify-end" onClick={onClose}>
            <div className="w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between z-10">
                    <div>
                        <div className="flex items-center gap-2"><Pill e={s.Estado} local={esLocal(s)} /><span className="text-[10px] text-slate-400">#{s.SolicitudID}</span></div>
                        <h2 className="text-lg font-black text-slate-800 mt-1">{s.Cliente} · <span className="font-mono">{s.CodigoMadre}</span></h2>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-5 text-sm">
                    <section className="grid grid-cols-2 gap-3 text-xs">
                        <Info l="Insumo" v={<span className="inline-flex items-center gap-1 font-bold"><T.icon size={12} /> {T.txt}{stock?.insumo?.descripcion ? ` · ${stock.insumo.descripcion}` : ''}</span>} />
                        <Info l="Qué se dañó" v={<><b>{cant(s)}</b> · {s.Motivo}{s.Nota ? <div className="text-slate-500">{s.Nota}</div> : null}</>} />
                        <Info l="Reportó" v={`${s.AreaReporta}${s.CodigoReporta ? ` · ${String(s.CodigoReporta).trim()}` : ''} · ${fmtFechaHora(s.FechaReporte)}`} />
                        <Info l="Trabajo" v={`${s.DescripcionTrabajo || ''} (${s.MagnitudMadre} ${String(s.UMMadre || '').trim()})${s.NoDocERP ? ` · pedido ${s.NoDocERP}` : ''}`} />
                        {!esLocal(s) && <Info l="Plazo" v={s.Vencimiento ? `${fmtFechaHora(s.Vencimiento)} (${s.DiasParaVencer < 0 ? `venció hace ${-s.DiasParaVencer} d` : `${s.DiasParaVencer} día(s)`})` : '—'} />}
                        {esLocal(s) ? <Info l="Aviso al cliente" v={<span className="text-slate-500">No corresponde: es un producto del local</span>} /> : <Info l="Aviso al cliente" v={s.NotificadaPortal ? <span className="text-emerald-700 font-bold flex items-center gap-1"><CheckCircle2 size={12} /> Por el portal el {fmtFechaHora(s.FechaNotificacion)}</span> : <span className="text-rose-600 font-bold">Todavía no se avisó</span>} />}
                        {s.DetallePiezas?.length > 0 && <Info l="Piezas" v={s.DetallePiezas.map((p, i) => <div key={i}>{p.cantidad} × {p.parte}{p.talle ? ` · talle ${p.talle}` : ''}</div>)} />}
                        {s.ImagenPath && <Info l="Foto" v={<a className="text-indigo-600 underline" href={s.ImagenPath} target="_blank" rel="noreferrer">ver imagen</a>} />}
                        {s.DetalleDecision && <Info l="Historial" v={<span className="text-slate-600">{s.DetalleDecision}</span>} />}
                        {s.CodigoFalla && <Info l="Orden de falla" v={<span className="font-mono text-indigo-700 font-bold">{String(s.CodigoFalla).trim()} · {s.EstadoFalla}</span>} />}
                    </section>

                    <section className="border border-slate-200 rounded-xl p-4">
                        <h3 className="text-[10px] font-black uppercase tracking-wide text-slate-500 mb-2">{esLocal(s) ? 'Stock del local' : `Stock de ${s.Tipo === 'PRENDA_CLIENTE' ? 'estas prendas' : 'esta tela'} de este cliente (buscado por el sistema)`}</h3>
                        {candidatas.length === 0 ? <p className="text-slate-500 text-xs">{stock?.resumen || 'Sin stock. El cliente tiene que traer más o llevarse lo producido.'}</p> : (
                            <ul className="space-y-1 text-xs">
                                {candidatas.map(c => (
                                    <li key={c.BobinaID || c.PrendaClienteID} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-1.5">
                                        <span className="font-mono font-bold">{c.CodigoEtiqueta || c.CodigoRecepcion || `#${c.PrendaClienteID}`}</span>
                                        <span>{c.MetrosRestantes != null ? `${Number(c.MetrosRestantes).toFixed(2)} m` : `${c.CantidadDisponible} u`}{c.AreaID ? ` · en ${String(c.AreaID).trim()}` : ''}{c.Estado ? ` · ${c.Estado}` : ''}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {!resuelta && esLocal(s) && (
                        <section className="border border-indigo-200 rounded-xl p-4 space-y-3">
                            <h3 className="text-[10px] font-black uppercase tracking-wide text-indigo-700">Aprobar la reposición</h3>
                            <p className="text-xs text-slate-600">Es un producto del local: al cliente no se le avisa. Al aprobar, {textoConfirm().replace(/^S/, 's')}</p>
                            <label className="block text-xs">Detalle (opcional)<input value={detalle} onChange={e => setDetalle(e.target.value)} className="block w-full border border-slate-200 rounded-lg p-1.5 mt-1" /></label>
                            <button disabled={busy} onClick={decidir} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Aprobar reposición (crear VEN interna)</button>
                        </section>
                    )}

                    {!resuelta && !esLocal(s) && (
                        <section className="border border-amber-200 bg-amber-50/50 rounded-xl p-4 space-y-2">
                            <h3 className="text-[10px] font-black uppercase tracking-wide text-amber-700 flex items-center gap-1"><Bell size={12} /> 1. Avisar al cliente por el portal</h3>
                            <p className="text-xs text-slate-600">Crea un ticket que el cliente ve en su portal (y una notificación push si la tiene activa). No se manda WhatsApp ni se crea ninguna orden.</p>
                            <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={3} placeholder="Mensaje personalizado (opcional). Si lo dejás vacío, el sistema arma uno con la orden, lo dañado y el stock encontrado." className="w-full text-xs border border-slate-200 rounded-lg p-2" />
                            <button disabled={busy} onClick={notificar} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"><Send size={12} /> {s.NotificadaPortal ? 'Volver a avisar por el portal' : 'Avisar al cliente por el portal'}</button>
                        </section>
                    )}

                    {!resuelta && !esLocal(s) && (
                        <section className="border border-indigo-200 rounded-xl p-4 space-y-3">
                            <h3 className="text-[10px] font-black uppercase tracking-wide text-indigo-700">2. Registrar la decisión del cliente</h3>
                            <div className="space-y-2 text-xs">
                                {candidatas.length > 0 && (
                                    <label className="flex items-start gap-2"><input type="radio" name="dec" checked={decision === 'USA_STOCK'} onChange={() => setDecision('USA_STOCK')} className="mt-0.5" />
                                        <span><b>Usa su stock</b>: se crea la orden de falla ahora con la bobina / prendas elegidas.
                                            {decision === 'USA_STOCK' && (
                                                <select className="block mt-1 border border-slate-200 rounded-lg p-1.5 text-xs" value={bobinaId || prendaId} onChange={e => { if (s.Tipo === 'PRENDA_CLIENTE') setPrendaId(e.target.value); else setBobinaId(e.target.value); }}>
                                                    <option value="">Elegí cuál…</option>
                                                    {candidatas.map(c => <option key={c.BobinaID || c.PrendaClienteID} value={c.BobinaID || c.PrendaClienteID}>{c.CodigoEtiqueta || c.CodigoRecepcion || `#${c.PrendaClienteID}`} · {c.MetrosRestantes != null ? `${Number(c.MetrosRestantes).toFixed(2)} m` : `${c.CantidadDisponible} u`}</option>)}
                                                </select>
                                            )}
                                        </span></label>
                                )}
                                {s.Tipo !== 'PRODUCTO_LOCAL' && <label className="flex items-start gap-2"><input type="radio" name="dec" checked={decision === 'TRAE_MAS'} onChange={() => setDecision('TRAE_MAS')} className="mt-0.5" /><span><b>Trae más {s.Tipo === 'PRENDA_CLIENTE' ? 'prendas' : 'tela'}</b>: no se crea nada ahora. La orden de falla nace cuando Ingreso de materiales cargue la PRE y la vincule a esta solicitud.</span></label>}
                                <label className="flex items-start gap-2"><input type="radio" name="dec" checked={decision === 'ACEPTA_PARCIAL'} onChange={() => setDecision('ACEPTA_PARCIAL')} className="mt-0.5" />
                                    <span><b>Se lleva lo producido</b>: la orden se redimensiona a lo real, se recotiza y la falla se cierra sin reposición.
                                        {decision === 'ACEPTA_PARCIAL' && <span className="block mt-1">Cantidad realmente producida de {s.CodigoMadre}: <input type="number" min="0" step="0.01" value={cantidadProducida} onChange={e => setCantidadProducida(e.target.value)} className="w-28 border border-slate-200 rounded-lg p-1 text-xs" /> {String(s.UMMadre || '').trim()} (hoy: {s.MagnitudMadre})</span>}
                                    </span></label>
                                {s.Tipo !== 'PRODUCTO_LOCAL' && <label className="flex items-start gap-2"><input type="radio" name="dec" checked={decision === 'COMPRA_ADMIN'} onChange={() => setDecision('COMPRA_ADMIN')} className="mt-0.5" /><span><b>Administración compra el insumo</b>: igual que "trae más", nace con la PRE vinculada.</span></label>}
                                {s.Tipo === 'PRODUCTO_LOCAL' && <label className="flex items-start gap-2"><input type="radio" name="dec" checked={decision === 'VEN_INTERNA'} onChange={() => setDecision('VEN_INTERNA')} className="mt-0.5" /><span><b>Reponer del stock del local (VEN interna)</b>: venta interna a precio 0, sin costo para el cliente; descuenta stock y viaja al área como complemento.</span></label>}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <label className="block">Cómo confirmó el cliente
                                    <select value={medio} onChange={e => setMedio(e.target.value)} className="block w-full border border-slate-200 rounded-lg p-1.5 mt-1">
                                        <option value="portal">Por el portal (ticket)</option><option value="teléfono">Por teléfono</option><option value="mostrador">En mostrador</option><option value="email">Por email</option><option value="interno">Decisión interna (sin respuesta del cliente)</option>
                                    </select>
                                </label>
                                <label className="block">Detalle (opcional)<input value={detalle} onChange={e => setDetalle(e.target.value)} className="block w-full border border-slate-200 rounded-lg p-1.5 mt-1" placeholder="Ej: trae 20 m el lunes" /></label>
                            </div>
                            {decision && <p className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2 flex gap-2"><AlertTriangle size={14} className="text-amber-500 shrink-0" /> {textoConfirm()}</p>}
                            <button disabled={busy || !decision} onClick={decidir} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Registrar decisión</button>
                        </section>
                    )}
                    {resuelta && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={14} /> Resuelta: {DECISION_TXT[s.Decision] || s.Decision} · {s.MedioConfirmacion} · {fmtFechaHora(s.FechaDecision)}</p>}
                    {!resuelta && (s.Decision === 'TRAE_MAS' || s.Decision === 'COMPRA_ADMIN') && <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center gap-2"><Clock size={14} /> Esperando la PRE nueva. En Ingreso de materiales, al cargar la tela/prendas de este cliente, elegir "Repone la solicitud #{s.SolicitudID}".</p>}
                </div>
            </div>
        </div>
    );
}

const Info = ({ l, v }) => <div><div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{l}</div><div className="text-slate-700">{v}</div></div>;
