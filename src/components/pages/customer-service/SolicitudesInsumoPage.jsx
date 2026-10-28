import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, Clock, Inbox, Loader2, PackageSearch, RefreshCw, Scissors, Send, ShoppingBag, Store, X } from 'lucide-react';
import { solicitudesInsumoService as svc } from '../../../services/modules/solicitudesInsumoService';
import { fmtFechaHora } from '../../../utils/fechas';
import Selector from '../../ui/Selector';
import useConfirmar from '../../ui/useConfirmar';

/**
 * Spec 39 — Bandeja "Solicitudes de insumo": cuando en producción se daña tela o prendas que
 * trajo el cliente (o un producto del local), no nace ninguna orden. Acá Atención al Cliente y
 * Administración ven la solicitud, el stock que el sistema encontró de ESA tela de ESE cliente,
 * notifican por el portal (nada automático, nada por WhatsApp) y registran la decisión.
 */
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const ROTULO = 'text-[10px] font-black uppercase tracking-widest text-zinc-400';
const SUBTITULO = 'flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-zinc-500';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';

// En el celular, tarjetas en vez de la tabla de 8 columnas (una vista sola: no se dibujan las dos ocultando una).
// Desde 1280 px: más angosto la tabla no entra al lado del menú y «Abrir» quedaba fuera de la vista.
const MQ_TABLA = '(min-width: 1280px)';
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

// Color de estado: falta avisar = pendiente (ámbar), avisada = en curso (cian), vencida = magenta, resuelta = verde
const ESTADO = {
    NUEVA: { txt: 'Nueva · sin avisar al cliente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    NOTIFICADA: { txt: 'Avisada · esperando al cliente', cls: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' },
    SIN_RESPUESTA: { txt: 'Venció sin respuesta', cls: 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20' },
    RESUELTA: { txt: 'Resuelta', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};
const TIPO = {
    TELA_CLIENTE: { txt: 'Tela del cliente', icon: Scissors },
    PRENDA_CLIENTE: { txt: 'Prendas del cliente', icon: ShoppingBag },
    PRODUCTO_LOCAL: { txt: 'Producto del local', icon: Store },
};
const DECISION_TXT = { USA_STOCK: 'Usa su stock', TRAE_MAS: 'Trae más', ACEPTA_PARCIAL: 'Se lleva lo producido', COMPRA_ADMIN: 'Compra Administración', VEN_INTERNA: 'VEN interna' };

// Producto del local: al cliente no se le avisa ni decide; solo se aprueba la reposición.
const esLocal = (s) => s?.Tipo === 'PRODUCTO_LOCAL';
const Pill = ({ e, local }) => { const s = (local && e === 'NUEVA') ? { txt: 'Nueva · falta aprobar', cls: ESTADO.NUEVA.cls } : ESTADO[e] ||{ txt: e, cls: 'bg-zinc-50 text-zinc-600 border-zinc-200' }; return <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${s.cls}`}>{s.txt}</span>; };
const cant = (s) => s.Cantidad != null ? `${Number(s.Cantidad)} ${String(s.Unidad || '').trim()}` : 'cantidad a confirmar';

// Estética nueva (27/10/2026): encabezado, filtros en pastillas con su número (Selector en el celular), tabla clara
// (en el celular, una tarjeta por solicitud), panel de detalle claro en z-[6000] y confirmaciones con useConfirmar
// en vez de window.confirm. La lógica no cambió.
export default function SolicitudesInsumoPage() {
    const [filtro, setFiltro] = useState('ABIERTAS');
    const [data, setData] = useState({ solicitudes: [], resumen: {} });
    const [loading, setLoading] = useState(false);
    const [sel, setSel] = useState(null);
    const conTabla = useConTabla();

    const cargar = useCallback(async () => {
        setLoading(true);
        try { setData(await svc.listar(filtro)); }
        catch (e) { toast.error(e.response?.data?.error || e.message); }
        finally { setLoading(false); }
    }, [filtro]);
    useEffect(() => { cargar(); }, [cargar]);

    const abiertas = (data.resumen.NUEVA || 0) + (data.resumen.NOTIFICADA || 0) + (data.resumen.SIN_RESPUESTA || 0);

    // ── Piezas del render (tabla en escritorio, tarjetas en el celular) ─────────
    const celdaCliente = (s) => (<>
        <div className="font-bold text-zinc-900">{s.Cliente}</div>
        <div className="font-mono text-xs text-zinc-600">{s.CodigoMadre}{s.NoDocERP ? ` · pedido ${s.NoDocERP}` : ''}</div>
        <div className="text-[11px] text-zinc-400">reportó {s.AreaReporta}{s.CodigoReporta ? ` (${String(s.CodigoReporta).trim()})` : ''}</div>
    </>);
    const celdaInsumo = (s, T) => (<>
        <span className="inline-flex items-center gap-1.5 font-bold text-zinc-800 whitespace-nowrap"><T.icon size={14} className="text-brand-cyan shrink-0" /> {T.txt}</span>
        {s.StockEncontrado?.insumo?.descripcion && <div className="text-[11px] text-zinc-500 mt-0.5">{s.StockEncontrado.insumo.descripcion}</div>}
    </>);
    const celdaDanio = (s) => (<>
        <div className="font-bold text-zinc-800 tabular-nums">{cant(s)}</div>
        <div className="text-xs text-zinc-500">{s.Motivo}</div>
    </>);
    const celdaStock = (s) => (s.StockEncontrado?.encontrado?.length
        ? <span className="text-emerald-700 font-bold">{s.StockEncontrado.resumen}</span>
        : <span className="text-zinc-400">{s.StockEncontrado?.resumen || 'Sin stock'}</span>);
    const celdaPlazo = (vence) => (vence == null ? <span className="text-zinc-400">—</span> : vence < 0
        ? <span className="text-brand-magenta font-bold whitespace-nowrap">Vencida hace {-vence} d</span>
        : <span className={`whitespace-nowrap ${vence <= 2 ? 'text-amber-600 font-bold' : 'text-zinc-600'}`}>{vence} día(s)</span>);
    const celdaDecision = (s) => (<>
        {s.Decision ? <span className="font-bold text-zinc-800">{DECISION_TXT[s.Decision] || s.Decision}</span> : <span className="text-zinc-400">{esLocal(s) ? 'Falta aprobar' : s.NotificadaPortal ? 'Avisado, sin respuesta' : 'Sin avisar'}</span>}
        {s.CodigoFalla && <div className="font-mono text-[11px] font-bold text-brand-cyan">{String(s.CodigoFalla).trim()}</div>}
    </>);

    const sinFilas = data.solicitudes.length > 0 ? null : loading ? (
        <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando solicitudes...
        </span>
    ) : (
        <div className="flex flex-col items-center justify-center text-center">
            <Inbox size={40} className="mb-3 text-brand-cyan" />
            <span className="text-sm font-bold text-zinc-700">No hay solicitudes{filtro === 'ABIERTAS' ? ' abiertas' : ''}.</span>
            <span className="text-xs text-zinc-400 mt-1">Aparecen cuando en producción se daña tela o prendas del cliente, o un producto del local.</span>
        </div>
    );

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3">
                <PackageSearch size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-[220px] md:min-w-[380px] flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Solicitudes de insumo del cliente</h1>
                    <p className="text-sm text-zinc-500 mt-1">Insumo del cliente o del local dañado en producción. Nada se crea solo: acá se avisa al cliente por el portal y se registra su decisión.</p>
                </div>
                <div className="flex items-stretch gap-2 w-full sm:w-auto sm:ml-auto">
                    {/* Filtros: pastillas con su número en escritorio, Selector en el celular */}
                    <div className="hidden md:inline-flex rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                        {['ABIERTAS', 'RESUELTAS', 'TODAS'].map(f => {
                            const n = f === 'ABIERTAS' ? abiertas : f === 'RESUELTAS' ? (data.resumen.RESUELTA || 0) : null;
                            return (
                                <button key={f} onClick={() => setFiltro(f)}
                                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${filtro === f ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
                                    {f === 'ABIERTAS' ? 'Abiertas' : f === 'RESUELTAS' ? 'Resueltas' : 'Todas'}
                                    {n != null && <span className={`min-w-[22px] px-1.5 py-0.5 rounded-full text-[11px] font-black tabular-nums ${filtro === f ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{n}</span>}
                                </button>
                            );
                        })}
                    </div>
                    <div className="md:hidden flex-1 min-w-0 sm:flex-none sm:w-56">
                        <Selector className="w-full" value={filtro} onChange={e => setFiltro(e.target.value)} aria-label="Qué solicitudes ver">
                            {['ABIERTAS', 'RESUELTAS', 'TODAS'].map(f => <option key={f} value={f}>{f === 'ABIERTAS' ? `Abiertas (${abiertas})` : f === 'RESUELTAS' ? `Resueltas (${data.resumen.RESUELTA || 0})` : 'Todas'}</option>)}
                        </Selector>
                    </div>
                    <button onClick={cargar} className={`${BTN_SECUNDARIO} shrink-0`} title="Actualizar" aria-label="Actualizar">
                        <RefreshCw size={15} className={`text-brand-cyan ${loading ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">Actualizar</span>
                    </button>
                </div>
            </div>

            {/* Tabla / tarjetas */}
            {conTabla ? (
                <div className={`${CARD} overflow-hidden`}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-zinc-50 border-b border-zinc-200">
                                <tr>
                                    <th className={TH}>Estado</th>
                                    <th className={TH}>Cliente / orden</th>
                                    <th className={TH}>Insumo</th>
                                    <th className={TH}>Qué se dañó</th>
                                    <th className={TH}>Stock del cliente</th>
                                    <th className={TH}>Plazo</th>
                                    <th className={TH}>Decisión</th>
                                    <th className={TH}></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {sinFilas ? (
                                    <tr><td colSpan={8} className="px-4 py-14 text-center">{sinFilas}</td></tr>
                                ) : data.solicitudes.map(s => {
                                    const T = TIPO[s.Tipo] || { txt: s.Tipo, icon: PackageSearch };
                                    const vence = s.Estado === 'RESUELTA' || esLocal(s) ? null : s.DiasParaVencer;
                                    return (
                                        <tr key={s.SolicitudID} className="align-top hover:bg-zinc-50 cursor-pointer transition-colors" onClick={() => setSel(s.SolicitudID)}>
                                            <td className="px-4 py-3"><Pill e={s.Estado} local={esLocal(s)} /><div className="text-[11px] text-zinc-400 mt-1.5 tabular-nums">#{s.SolicitudID} · {fmtFechaHora(s.FechaCreacion)}</div></td>
                                            <td className="px-4 py-3 min-w-[170px]">{celdaCliente(s)}</td>
                                            <td className="px-4 py-3">{celdaInsumo(s, T)}</td>
                                            <td className="px-4 py-3 min-w-[140px]">{celdaDanio(s)}</td>
                                            <td className="px-4 py-3 text-xs min-w-[160px]">{celdaStock(s)}</td>
                                            <td className="px-4 py-3 text-xs">{celdaPlazo(vence)}</td>
                                            <td className="px-4 py-3 text-xs">{celdaDecision(s)}</td>
                                            <td className="px-4 py-3 text-right"><button className="inline-flex items-center gap-0.5 text-sm font-bold text-brand-cyan hover:underline whitespace-nowrap">Abrir <ChevronRight size={15} /></button></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-2.5">
                    {sinFilas ? <div className={`${CARD} px-4 py-12 text-center`}>{sinFilas}</div> : data.solicitudes.map(s => {
                        const T = TIPO[s.Tipo] || { txt: s.Tipo, icon: PackageSearch };
                        const vence = s.Estado === 'RESUELTA' || esLocal(s) ? null : s.DiasParaVencer;
                        return (
                            <div key={s.SolicitudID} className={`${CARD} p-3.5 flex flex-col gap-2.5 cursor-pointer hover:bg-zinc-50 transition-colors`} onClick={() => setSel(s.SolicitudID)}>
                                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                    <Pill e={s.Estado} local={esLocal(s)} />
                                    <span className="text-[11px] text-zinc-400 tabular-nums">#{s.SolicitudID} · {fmtFechaHora(s.FechaCreacion)}</span>
                                </div>
                                <div className="min-w-0 text-sm">{celdaCliente(s)}</div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 bg-zinc-50 rounded-xl p-3 text-sm">
                                    <div className="min-w-0"><div className={`${ROTULO} mb-0.5`}>Qué se dañó</div>{celdaDanio(s)}</div>
                                    <div className="min-w-0 text-xs"><div className={`${ROTULO} mb-0.5`}>Stock del cliente</div>{celdaStock(s)}</div>
                                    <div className="min-w-0 text-xs"><div className={`${ROTULO} mb-0.5`}>Plazo</div>{celdaPlazo(vence)}</div>
                                    <div className="min-w-0 text-xs"><div className={`${ROTULO} mb-0.5`}>Decisión</div>{celdaDecision(s)}</div>
                                </div>
                                <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-zinc-100">
                                    <div className="min-w-0 text-sm">{celdaInsumo(s, T)}</div>
                                    <button className={`${BTN_SECUNDARIO} shrink-0 text-xs px-2.5 py-1.5`}>Abrir <ChevronRight size={14} className="text-brand-cyan" /></button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

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
    const [confirmar, ventanaConfirmar] = useConfirmar();

    const cargar = useCallback(async () => {
        try { const d = await svc.detalle(id); setS(d); if (!decision) setDecision(d.Decision || (esLocal(d) ? 'VEN_INTERNA' : '')); }
        catch (e) { toast.error(e.response?.data?.error || e.message); }
    }, [id]);
    useEffect(() => { cargar(); }, [cargar]);

    const stock = useMemo(() => s?.StockActual?.encontrado?.length ? s.StockActual : s?.StockEncontrado, [s]);
    const candidatas = stock?.encontrado || [];
    const resuelta = s?.Estado === 'RESUELTA';

    const notificar = async () => {
        if (!(await confirmar({ titulo: '¿Avisar al cliente por el portal?', texto: `Se va a crear un ticket visible en el portal del cliente ${s.Cliente} pidiendo su decisión por ${s.CodigoMadre}. No se envía WhatsApp.`, confirmar: 'Avisar' }))) return;
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
        if (!(await confirmar(esLocal(s)
            ? { titulo: '¿Aprobar la reposición?', texto: <>{textoConfirm()}<span className="block mt-2">Al cliente no se le avisa.</span></>, confirmar: 'Aprobar' }
            : { titulo: '¿Registrar la decisión?', texto: <>{textoConfirm()}<span className="block mt-2">Confirmación del cliente: {medio}.</span></>, confirmar: 'Registrar' }))) return;
        setBusy(true);
        try {
            const r = await svc.decidir(id, { decision, medioConfirmacion: esLocal(s) ? 'interno' : medio, detalle: detalle.trim() ? detalle.trim() + ' ' : undefined, bobinaId: bobinaId || undefined, prendaId: prendaId || undefined, cantidadProducida: decision === 'ACEPTA_PARCIAL' ? Number(cantidadProducida) : undefined });
            toast.success(r.message, { duration: 8000 });
            await cargar(); onChange();
        } catch (e) { toast.error(e.response?.data?.error || e.message); }
        finally { setBusy(false); }
    };

    if (!s) return <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center"><div className="bg-white rounded-2xl p-4 shadow-2xl"><Loader2 size={22} className="animate-spin text-brand-cyan" /></div></div>;
    const T = TIPO[s.Tipo] || { txt: s.Tipo, icon: PackageSearch };

    // Opciones de la decisión: tarjetas que hacen de radio y llaman al mismo setDecision que los radios de antes.
    // Lo que depende de la opción (bobina, cantidad producida) aparece abajo cuando está elegida.
    const opcion = (valor, texto, extra = null) => {
        const elegida = decision === valor;
        return (
            <div className={`rounded-xl border transition-colors ${elegida ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}>
                <button type="button" role="radio" aria-checked={elegida} onClick={() => setDecision(valor)} className="w-full flex items-start gap-3 p-3 text-left text-sm text-zinc-600">
                    <span className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${elegida ? 'border-zinc-900 bg-zinc-900' : 'border-zinc-300 bg-white'}`}>
                        {elegida && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </span>
                    <span>{texto}</span>
                </button>
                {elegida && extra && <div className="px-3 pb-3 pl-10">{extra}</div>}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-[6000] flex justify-end" onClick={onClose}>
            <div className="w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto sm:rounded-l-2xl" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b border-zinc-100 px-5 py-4 flex items-start justify-between gap-3 z-10">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><Pill e={s.Estado} local={esLocal(s)} /><span className="text-[11px] font-bold text-zinc-400 tabular-nums">#{s.SolicitudID}</span></div>
                        <h2 className="text-lg font-black text-zinc-900 mt-1.5 leading-tight">{s.Cliente} · <span className="font-mono">{s.CodigoMadre}</span></h2>
                    </div>
                    <button onClick={onClose} aria-label="Cerrar" className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors"><X size={18} /></button>
                </div>

                <div className="p-5 flex flex-col gap-4 text-sm">
                    <section className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 bg-zinc-50 border border-zinc-100 rounded-xl p-4">
                        <Info l="Insumo" v={<span className="inline-flex items-center gap-1.5 font-bold text-zinc-800"><T.icon size={14} className="text-brand-cyan shrink-0" /> {T.txt}{stock?.insumo?.descripcion ? ` · ${stock.insumo.descripcion}` : ''}</span>} />
                        <Info l="Qué se dañó" v={<><b className="text-zinc-900">{cant(s)}</b> · {s.Motivo}{s.Nota ? <div className="text-zinc-500">{s.Nota}</div> : null}</>} />
                        <Info l="Reportó" v={`${s.AreaReporta}${s.CodigoReporta ? ` · ${String(s.CodigoReporta).trim()}` : ''} · ${fmtFechaHora(s.FechaReporte)}`} />
                        <Info l="Trabajo" v={`${s.DescripcionTrabajo || ''} (${s.MagnitudMadre} ${String(s.UMMadre || '').trim()})${s.NoDocERP ? ` · pedido ${s.NoDocERP}` : ''}`} />
                        {!esLocal(s) && <Info l="Plazo" v={s.Vencimiento ? `${fmtFechaHora(s.Vencimiento)} (${s.DiasParaVencer < 0 ? `venció hace ${-s.DiasParaVencer} d` : `${s.DiasParaVencer} día(s)`})` : '—'} />}
                        {esLocal(s) ? <Info l="Aviso al cliente" v={<span className="text-zinc-500">No corresponde: es un producto del local</span>} /> : <Info l="Aviso al cliente" v={s.NotificadaPortal ? <span className="text-emerald-700 font-bold inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="shrink-0" /> Por el portal el {fmtFechaHora(s.FechaNotificacion)}</span> : <span className="text-amber-700 font-bold">Todavía no se avisó</span>} />}
                        {s.DetallePiezas?.length > 0 && <Info l="Piezas" v={s.DetallePiezas.map((p, i) => <div key={i}>{p.cantidad} × {p.parte}{p.talle ? ` · talle ${p.talle}` : ''}</div>)} />}
                        {s.ImagenPath && <Info l="Foto" v={<a className="font-bold text-brand-cyan underline" href={s.ImagenPath} target="_blank" rel="noreferrer">ver imagen</a>} />}
                        {s.DetalleDecision && <Info l="Historial" v={<span className="text-zinc-600">{s.DetalleDecision}</span>} />}
                        {s.CodigoFalla && <Info l="Orden de falla" v={<span className="font-mono text-brand-cyan font-bold">{String(s.CodigoFalla).trim()} · {s.EstadoFalla}</span>} />}
                    </section>

                    <section className={`${CARD} p-4`}>
                        <h3 className={`${ROTULO} mb-2.5`}>{esLocal(s) ? 'Stock del local' : `Stock de ${s.Tipo === 'PRENDA_CLIENTE' ? 'estas prendas' : 'esta tela'} de este cliente (buscado por el sistema)`}</h3>
                        {candidatas.length === 0 ? <p className="text-sm text-zinc-500">{stock?.resumen || 'Sin stock. El cliente tiene que traer más o llevarse lo producido.'}</p> : (
                            <ul className="space-y-1.5">
                                {candidatas.map(c => (
                                    <li key={c.BobinaID || c.PrendaClienteID} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2 text-xs">
                                        <span className="font-mono font-bold text-zinc-900">{c.CodigoEtiqueta || c.CodigoRecepcion || `#${c.PrendaClienteID}`}</span>
                                        <span className="text-zinc-600 tabular-nums">{c.MetrosRestantes != null ? `${Number(c.MetrosRestantes).toFixed(2)} m` : `${c.CantidadDisponible} u`}{c.AreaID ? ` · en ${String(c.AreaID).trim()}` : ''}{c.Estado ? ` · ${c.Estado}` : ''}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {!resuelta && esLocal(s) && (
                        <section className={`${CARD} p-4 flex flex-col gap-3`}>
                            <h3 className={SUBTITULO}><CheckCircle2 size={14} className="text-brand-cyan" /> Aprobar la reposición</h3>
                            <p className="text-sm text-zinc-600">Es un producto del local: al cliente no se le avisa. Al aprobar, {textoConfirm().replace(/^S/, 's')}</p>
                            <div>
                                <label htmlFor="solicitud-detalle-local" className={ETIQUETA}>Detalle (opcional)</label>
                                <input id="solicitud-detalle-local" value={detalle} onChange={e => setDetalle(e.target.value)} className={CAMPO} />
                            </div>
                            <div className="flex justify-end">
                                <button disabled={busy} onClick={decidir} className={BTN_PRINCIPAL}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Aprobar reposición (crear VEN interna)</button>
                            </div>
                        </section>
                    )}

                    {!resuelta && !esLocal(s) && (
                        <section className={`${CARD} p-4 flex flex-col gap-3`}>
                            <h3 className={SUBTITULO}><Bell size={14} className="text-brand-cyan" /> 1. Avisar al cliente por el portal</h3>
                            <p className="text-sm text-zinc-600">Crea un ticket que el cliente ve en su portal (y una notificación push si la tiene activa). No se manda WhatsApp ni se crea ninguna orden.</p>
                            <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={3} aria-label="Mensaje para el cliente" placeholder="Mensaje personalizado (opcional). Si lo dejás vacío, el sistema arma uno con la orden, lo dañado y el stock encontrado." className={`${CAMPO} resize-y`} />
                            <div className="flex justify-end">
                                <button disabled={busy} onClick={notificar} className={s.NotificadaPortal ? BTN_SECUNDARIO : BTN_PRINCIPAL}><Send size={15} className={s.NotificadaPortal ? 'text-brand-cyan' : ''} /> {s.NotificadaPortal ? 'Volver a avisar por el portal' : 'Avisar al cliente por el portal'}</button>
                            </div>
                        </section>
                    )}

                    {!resuelta && !esLocal(s) && (
                        <section className={`${CARD} p-4 flex flex-col gap-3`}>
                            <h3 className={SUBTITULO}><CheckCircle2 size={14} className="text-brand-cyan" /> 2. Registrar la decisión del cliente</h3>
                            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Decisión del cliente">
                                {candidatas.length > 0 && opcion('USA_STOCK', <><b className="text-zinc-900">Usa su stock</b>: se crea la orden de falla ahora con la bobina / prendas elegidas.</>, (
                                    <Selector className="w-full" value={String(bobinaId || prendaId)} onChange={e => { if (s.Tipo === 'PRENDA_CLIENTE') setPrendaId(e.target.value); else setBobinaId(e.target.value); }} aria-label="Bobina o prendas del cliente" anchoLista={300}>
                                        <option value="">Elegí cuál…</option>
                                        {candidatas.map(c => <option key={c.BobinaID || c.PrendaClienteID} value={String(c.BobinaID || c.PrendaClienteID)}>{c.CodigoEtiqueta || c.CodigoRecepcion || `#${c.PrendaClienteID}`} · {c.MetrosRestantes != null ? `${Number(c.MetrosRestantes).toFixed(2)} m` : `${c.CantidadDisponible} u`}</option>)}
                                    </Selector>
                                ))}
                                {s.Tipo !== 'PRODUCTO_LOCAL' && opcion('TRAE_MAS', <><b className="text-zinc-900">Trae más {s.Tipo === 'PRENDA_CLIENTE' ? 'prendas' : 'tela'}</b>: no se crea nada ahora. La orden de falla nace cuando Ingreso de materiales cargue la PRE y la vincule a esta solicitud.</>)}
                                {opcion('ACEPTA_PARCIAL', <><b className="text-zinc-900">Se lleva lo producido</b>: la orden se redimensiona a lo real, se recotiza y la falla se cierra sin reposición.</>, (
                                    <div className="text-sm text-zinc-600 leading-9">
                                        Cantidad realmente producida de <span className="font-mono font-bold text-zinc-800">{s.CodigoMadre}</span>:{' '}
                                        <input type="number" min="0" step="0.01" value={cantidadProducida} onChange={e => setCantidadProducida(e.target.value)} aria-label="Cantidad realmente producida"
                                            className="inline-block align-middle w-28 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 tabular-nums focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />{' '}
                                        {String(s.UMMadre || '').trim()} <span className="text-zinc-400">(hoy: {s.MagnitudMadre})</span>
                                    </div>
                                ))}
                                {s.Tipo !== 'PRODUCTO_LOCAL' && opcion('COMPRA_ADMIN', <><b className="text-zinc-900">Administración compra el insumo</b>: igual que "trae más", nace con la PRE vinculada.</>)}
                                {s.Tipo === 'PRODUCTO_LOCAL' && opcion('VEN_INTERNA', <><b className="text-zinc-900">Reponer del stock del local (VEN interna)</b>: venta interna a precio 0, sin costo para el cliente; descuenta stock y viaja al área como complemento.</>)}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <span className={ETIQUETA}>Cómo confirmó el cliente</span>
                                    <Selector className="w-full" value={medio} onChange={e => setMedio(e.target.value)} aria-label="Cómo confirmó el cliente" anchoLista={300}>
                                        <option value="portal">Por el portal (ticket)</option><option value="teléfono">Por teléfono</option><option value="mostrador">En mostrador</option><option value="email">Por email</option><option value="interno">Decisión interna (sin respuesta del cliente)</option>
                                    </Selector>
                                </div>
                                <div>
                                    <label htmlFor="solicitud-detalle" className={ETIQUETA}>Detalle (opcional)</label>
                                    <input id="solicitud-detalle" value={detalle} onChange={e => setDetalle(e.target.value)} className={CAMPO} placeholder="Ej: trae 20 m el lunes" />
                                </div>
                            </div>
                            {decision && <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3"><AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" /> <span>{textoConfirm()}</span></p>}
                            <div className="flex justify-end">
                                <button disabled={busy || !decision} onClick={decidir} className={BTN_PRINCIPAL}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Registrar decisión</button>
                            </div>
                        </section>
                    )}
                    {resuelta && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={16} className="shrink-0" /> Resuelta: {DECISION_TXT[s.Decision] || s.Decision} · {s.MedioConfirmacion} · {fmtFechaHora(s.FechaDecision)}</p>}
                    {!resuelta && (s.Decision === 'TRAE_MAS' || s.Decision === 'COMPRA_ADMIN') && <p className="text-sm text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl p-3 flex items-start gap-2"><Clock size={16} className="text-brand-cyan shrink-0 mt-0.5" /> Esperando la PRE nueva. En Ingreso de materiales, al cargar la tela/prendas de este cliente, elegir "Repone la solicitud #{s.SolicitudID}".</p>}
                </div>
                {/* La confirmación va en portal, pero sus clics suben por acá: dentro del panel (que corta la propagación) no cierran el detalle */}
                {ventanaConfirmar}
            </div>
        </div>
    );
}

const Info = ({ l, v }) => <div className="min-w-0"><div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-0.5">{l}</div><div className="text-sm text-zinc-700 break-words">{v}</div></div>;
