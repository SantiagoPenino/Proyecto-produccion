import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, Loader2, X, Undo2, AlertTriangle } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';

/**
 * Cobros con tarjeta (POSLink) de los últimos días, para anularlos o devolverlos.
 * El sistema decide la operación mirando el lote del POS donde se hizo la venta: si la venta sigue en
 * el lote abierto → anulación (por el total); si el lote ya se cerró → devolución (total o parcial).
 * En los dos casos el cliente tiene que pasar la misma tarjeta en ese POS. El seguimiento lo muestra
 * CajaCobroPosModal (onIniciado le pasa el estado del cobro).
 *
 * Solapa "Para revisar": los casos que el sistema no puede cerrar solo (en duda, cobrado sin registrar,
 * reversa sin confirmar...). Quien mira el POS o el banco elige qué pasó y deja escrito qué verificó
 * (POST /caja/pos/cobros/:uuid/resolver). Mientras siguen abiertos, la orden no se puede cobrar por otra vía.
 */
const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esReversion = (t) => t === 'ANULACION' || t === 'DEVOLUCION';

// Qué le pasó a cada caso, en palabras de caja.
function situacion(c) {
    const rev = esReversion(c.tipo);
    switch (c.estado) {
        case 'INDETERMINADA': return { titulo: 'En duda', texto: rev
            ? 'No se sabe si la plata volvió a la tarjeta. Mirá el último ticket del POS antes de decidir.'
            : 'No se sabe si se cobró. Mirá el último ticket del POS o el banco antes de decidir.' };
        case 'PEDIR_AUTORIZACION': return { titulo: 'Pide autorización', texto: 'El emisor pidió autorización telefónica y el cobro quedó abierto.' };
        case 'PENDIENTE_BILLETERA': return { titulo: 'Billetera sin confirmar', texto: 'Pago con billetera pendiente: verificalo en el POS.' };
        case 'APROBADA_SIN_REGISTRAR': return rev
            ? { titulo: 'Devuelto sin revertir', texto: 'La plata ya volvió a la tarjeta, pero el sistema no pudo revertir la venta. Hacé la nota de crédito o la anulación a mano y cerralo acá.' }
            : { titulo: 'Cobrado sin registrar', texto: 'La tarjeta se cobró, pero el sistema no pudo registrarlo. Registralo a mano en la caja (o anulalo en el POS) y cerralo acá.' };
        case 'REVERSA_PENDIENTE': return { titulo: 'Reversa sin confirmar', texto: 'Se pidió deshacer el cobro y Resonet todavía no lo confirmó (puede tardar hasta 24 h).' };
        default: return { titulo: c.estado, texto: '' };
    }
}

// Cada destino que acepta el backend desde ese estado, con su explicación.
function opcion(c, destino) {
    const rev = esReversion(c.tipo);
    switch (destino) {
        case 'CANCELADA': return rev
            ? { label: 'No se devolvió', ayuda: 'En el POS no hay devolución: la venta sigue como estaba.' }
            : { label: 'No se cobró', ayuda: 'No hay cobro en el POS ni en el banco. La orden queda libre para cobrarla de nuevo.' };
        case 'APROBADA': return rev
            ? { label: 'Se devolvió: revertir la venta', ayuda: 'El POS devolvió el importe completo. El sistema hace la nota de crédito o la anulación.' }
            : { label: 'Se cobró: registrarlo', ayuda: 'El POS cobró el importe completo. El sistema lo registra en caja como un cobro normal.' };
        case 'REGISTRADA': return rev
            ? { label: 'Ya lo revertí a mano', ayuda: 'La nota de crédito o la anulación ya está hecha en el sistema.' }
            : { label: 'Ya lo registré a mano', ayuda: 'El cobro ya está cargado en la caja.' };
        case 'REVERSADA': return { label: 'No quedó nada cobrado', ayuda: 'La reversa se hizo o no se llegó a leer la tarjeta: el cliente no pagó. La orden queda libre.' };
        case 'ANULAR_POS': return { label: 'Devolverlo a la tarjeta', ayuda: 'Se le devuelve el total por la misma tarjeta: el cliente tiene que pasarla en el POS donde pagó. En caja no hay nada que revertir; la orden queda libre para cobrarla de nuevo.' };
        default: return { label: destino, ayuda: '' };
    }
}

export default function CajaVentasPosModal({ abierto, onCerrar, onIniciado, pestanaInicial = 'ventas', onCambioRevision }) {
    const [pestana, setPestana] = useState(pestanaInicial);
    const [ventas, setVentas] = useState([]);
    const [casos, setCasos] = useState([]);
    const [cargando, setCargando] = useState(false);
    const [elegida, setElegida] = useState(null);   // venta que se está por anular
    const [monto, setMonto] = useState('');
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [resolviendo, setResolviendo] = useState(null);   // { uuid, destino }
    const [nota, setNota] = useState('');

    const cargarCasos = () => api.get('/contabilidad/caja/pos/revisar')
        .then(r => { const d = Array.isArray(r.data?.data) ? r.data.data : []; setCasos(d); onCambioRevision?.(d.length); })
        .catch(e => { toast.error(e.response?.data?.error || 'No se pudieron leer los casos para revisar'); setCasos([]); });

    useEffect(() => {
        if (!abierto) return;
        setElegida(null);
        setResolviendo(null);
        setPestana(pestanaInicial);
        setCargando(true);
        Promise.all([
            api.get('/contabilidad/caja/pos/ventas?dias=7')
                .then(r => setVentas(Array.isArray(r.data?.data) ? r.data.data : []))
                .catch(e => { toast.error(e.response?.data?.error || 'No se pudieron leer los cobros con tarjeta'); setVentas([]); }),
            cargarCasos(),
        ]).finally(() => setCargando(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto]);

    if (!abierto) return null;

    const resolver = async () => {
        if (!resolviendo) return;
        if (nota.trim().length < 5) { toast.error('Escribí qué verificaste (POS, banco, voucher...).'); return; }
        setEnviando(true);
        try {
            if (resolviendo.destino === 'ANULAR_POS') {
                // Va al POS como cualquier anulación: el seguimiento lo muestra CajaCobroPosModal.
                const r = await api.post('/contabilidad/caja/pos/reversiones', { uuidVenta: resolviendo.uuid, motivo: nota.trim() });
                setResolviendo(null);
                setNota('');
                onIniciado?.(r.data?.data || null);
                return;
            }
            await api.post(`/contabilidad/caja/pos/cobros/${resolviendo.uuid}/resolver`, { estadoFinal: resolviendo.destino, nota: nota.trim() });
            toast.success('Caso cerrado');
            setResolviendo(null);
            setNota('');
            await cargarCasos();
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo cerrar el caso');
        } finally {
            setEnviando(false);
        }
    };

    const confirmar = async () => {
        if (!elegida) return;
        setEnviando(true);
        try {
            const r = await api.post('/contabilidad/caja/pos/reversiones', {
                uuidVenta: elegida.uuid,
                monto: monto !== '' ? Number(monto) : null,
                motivo: motivo.trim() || null,
            });
            onIniciado?.(r.data?.data || null);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo iniciar la anulación');
        } finally {
            setEnviando(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200"
            onClick={(e) => e.target === e.currentTarget && !enviando && onCerrar()}>
            <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl flex flex-col gap-4 border border-zinc-200 text-slate-800 max-h-[85vh]">
                <div className="flex justify-between items-center">
                    <h3 className="font-black text-zinc-800 text-lg uppercase tracking-wider flex items-center gap-2">
                        <CreditCard className="text-brand-cyan" size={20} />
                        Cobros con tarjeta
                    </h3>
                    <button onClick={onCerrar} disabled={enviando} className="text-zinc-400 hover:text-zinc-600"><X size={18} /></button>
                </div>
                <div className="flex gap-2 border-b border-slate-100">
                    {[['ventas', 'Ventas'], ['revisar', `Para revisar${casos.length ? ` (${casos.length})` : ''}`]].map(([k, l]) => (
                        <button key={k} onClick={() => { setPestana(k); setElegida(null); setResolviendo(null); }}
                            className={`px-3 py-2 -mb-px text-xs font-black uppercase tracking-widest border-b-2 transition-colors ${pestana === k
                                ? 'border-brand-cyan text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                            {l}
                        </button>
                    ))}
                </div>

                {pestana === 'ventas' ? (
                <>
                <p className="text-xs font-bold text-slate-500">
                    Últimos 7 días. Si la venta sigue en el lote abierto del POS se anula por el total; si el lote ya se cerró, se devuelve
                    (total o una parte). El cliente tiene que pasar la misma tarjeta en el POS donde pagó.
                </p>

                <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2">
                    {cargando ? (
                        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-brand-cyan" /></div>
                    ) : ventas.length === 0 ? (
                        <p className="py-10 text-center text-sm font-bold text-slate-400">No hay cobros con tarjeta en los últimos 7 días.</p>
                    ) : (
                        <div className="flex flex-col divide-y divide-slate-100">
                            {ventas.map(v => {
                                const sim = v.moneda === 'USD' ? 'US$' : '$';
                                const esta = elegida?.uuid === v.uuid;
                                return (
                                    <div key={v.uuid} className={`py-3 flex flex-col gap-2 ${esta ? 'bg-slate-50 -mx-2 px-2 rounded-xl' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-black text-slate-800 truncate">
                                                    {v.cliente || 'Cliente'} {v.referencia ? <span className="text-slate-400 font-bold">· {v.referencia}</span> : null}
                                                </p>
                                                <p className="text-[11px] font-bold text-slate-400">
                                                    {v.fecha} · POS {v.terminal}{v.comprobante ? ` · ${v.comprobante}` : ''}{v.tarjeta ? ` · ···· ${v.tarjeta}` : ''}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-sm font-black text-slate-800">{sim} {fmt(v.monto)}</p>
                                                {v.devuelto > 0 && <p className="text-[11px] font-bold text-rose-500">devuelto {sim} {fmt(v.devuelto)}</p>}
                                            </div>
                                            <button
                                                disabled={v.enCurso || v.disponible <= 0 || enviando}
                                                onClick={() => { setElegida(esta ? null : v); setMonto(''); setMotivo(''); }}
                                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-wide text-slate-600 hover:border-slate-300 disabled:opacity-40">
                                                <Undo2 size={14} className="text-brand-cyan" />
                                                {v.enCurso ? 'En curso' : v.disponible <= 0 ? 'Devuelta' : 'Anular / devolver'}
                                            </button>
                                        </div>
                                        {esta && (
                                            <div className="flex flex-wrap items-end gap-3">
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Importe (si se devuelve)</span>
                                                    <input type="number" step="any" min="0" max={v.disponible} value={monto} placeholder={fmt(v.disponible)}
                                                        onChange={e => setMonto(e.target.value)}
                                                        className="w-32 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-brand-cyan" />
                                                </label>
                                                <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Motivo</span>
                                                    <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={150}
                                                        placeholder="Ej: cobro duplicado, cambio de medio de pago…"
                                                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-brand-cyan" />
                                                </label>
                                                <button onClick={confirmar} disabled={enviando}
                                                    className="px-5 py-2.5 rounded-xl bg-brand-cyan hover:bg-brand-cyan/90 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 flex items-center gap-2">
                                                    {enviando ? <Loader2 size={14} className="animate-spin" /> : 'Mandar al POS'}
                                                </button>
                                                <p className="w-full text-[11px] font-bold text-slate-400">
                                                    El importe solo cuenta si la venta ya salió del lote (devolución). Una anulación es siempre por el total.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                </>
                ) : (
                <>
                <p className="text-xs font-bold text-slate-500">
                    Cobros con tarjeta que el sistema no puede cerrar solo. Mirá el POS (último ticket) o el banco, elegí qué pasó y
                    escribí qué verificaste. Mientras un caso sigue abierto, su orden no se puede cobrar por otra vía.
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2">
                    {cargando ? (
                        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-brand-cyan" /></div>
                    ) : casos.length === 0 ? (
                        <p className="py-10 text-center text-sm font-bold text-slate-400">No hay casos para revisar.</p>
                    ) : (
                        <div className="flex flex-col divide-y divide-slate-100">
                            {casos.map(c => {
                                const sim = c.moneda === 'USD' ? 'US$' : '$';
                                const sit = situacion(c);
                                const abiertoEste = resolviendo?.uuid === c.uuid;
                                return (
                                    <div key={c.uuid} className="py-3 flex flex-col gap-2">
                                        <div className="flex items-start gap-3">
                                            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-black text-slate-800">
                                                    {sit.titulo}
                                                    <span className="text-slate-400 font-bold"> · {esReversion(c.tipo) ? (c.tipo === 'ANULACION' ? 'Anulación' : 'Devolución') : 'Cobro'} #{c.id}</span>
                                                    {c.prueba && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">Prueba</span>}
                                                </p>
                                                <p className="text-[11px] font-bold text-slate-500">
                                                    {c.cliente || 'Sin cliente'}{c.referencia ? ` · ${c.referencia}` : ''}
                                                </p>
                                                <p className="text-[11px] font-bold text-slate-400">
                                                    {c.fecha} · POS {c.terminal}{c.enTotem ? ' (tótem)' : ''}{c.tarjeta ? ` · ···· ${c.tarjeta}` : ''}
                                                    {c.ticket && c.ticket !== '0' ? ` · ticket ${c.ticket}` : ''}{c.autorizacion ? ` · aut. ${c.autorizacion}` : ''}
                                                </p>
                                                <p className="text-xs font-bold text-slate-600 mt-1">{sit.texto}</p>
                                                {c.observaciones && <p className="text-[11px] font-bold text-slate-400 mt-1 break-words">{c.observaciones}</p>}
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-sm font-black text-slate-800">{sim} {fmt(c.monto)}</p>
                                                {c.autorizado != null && c.autorizado !== c.monto && (
                                                    <p className="text-[11px] font-bold text-rose-500">autorizado {sim} {fmt(c.autorizado)}</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 pl-7">
                                            {c.opciones.map(d => {
                                                const o = opcion(c, d);
                                                const activa = abiertoEste && resolviendo.destino === d;
                                                return (
                                                    <button key={d} disabled={enviando} title={o.ayuda}
                                                        onClick={() => { setResolviendo(activa ? null : { uuid: c.uuid, destino: d }); setNota(''); }}
                                                        className={`px-3 py-2 rounded-xl border text-xs font-black uppercase tracking-wide disabled:opacity-40 ${activa
                                                            ? 'border-brand-cyan text-slate-800 bg-slate-50' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                                                        {o.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {abiertoEste && (
                                            <div className="flex flex-col gap-2 pl-7">
                                                <p className="text-[11px] font-bold text-slate-500">{opcion(c, resolviendo.destino).ayuda}</p>
                                                <div className="flex flex-wrap items-end gap-3">
                                                    <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{resolviendo.destino === 'ANULAR_POS' ? 'Motivo' : 'Qué verificaste'}</span>
                                                        <input type="text" value={nota} onChange={e => setNota(e.target.value)} maxLength={300}
                                                            placeholder="Ej: en el POS el ticket 12 dice aprobada; en el banco no hay débito..."
                                                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-brand-cyan" />
                                                    </label>
                                                    <button onClick={resolver} disabled={enviando}
                                                        className="px-5 py-2.5 rounded-xl bg-brand-cyan hover:bg-brand-cyan/90 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 flex items-center gap-2">
                                                        {enviando ? <Loader2 size={14} className="animate-spin" /> : resolviendo.destino === 'ANULAR_POS' ? 'Mandar al POS' : 'Confirmar'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                </>
                )}
            </div>
        </div>,
        document.body
    );
}
