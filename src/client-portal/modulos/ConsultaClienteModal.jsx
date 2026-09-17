import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquareWarning, Check, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { apiClient } from '../api/apiClient';

// =====================================================================
// CONSULTA AL CLIENTE — la pantalla donde el cliente responde
// =====================================================================
// UNA pantalla, sin caja de chat: el motivo, la pregunta del operario, las fotos, un
// comentario opcional y dos botones. Se responde UNA vez y la consulta pasa a ser
// historial — no hay a dónde seguir escribiendo. Ver docs/consultas-cliente-plan.md §6b.
//
// La confirmación dice EXACTAMENTE qué se cancela (el archivo o la orden entera): es una
// decisión que destruye trabajo real y no puede quedar en un "¿estás seguro?" genérico.

/** Una foto de la pregunta. La ruta es autenticada: hay que bajarla con el token. */
const FotoPregunta = ({ consultaId, foto, onAmpliar }) => {
    const [url, setUrl] = useState(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let vivo = true;
        let creada = null;
        apiClient.getBlob(`/web-orders/consultas/${consultaId}/foto/${foto.CFoIdFoto}`)
            .then(blob => {
                const u = URL.createObjectURL(blob);
                if (vivo) { creada = u; setUrl(u); } else URL.revokeObjectURL(u);
            })
            .catch(() => { if (vivo) setError(true); });
        return () => { vivo = false; if (creada) URL.revokeObjectURL(creada); };
    }, [consultaId, foto.CFoIdFoto]);

    if (error) return (
        <div className="w-20 h-20 rounded-lg border border-zinc-700 bg-zinc-800 flex items-center justify-center text-zinc-600">
            <ImageIcon size={16} />
        </div>
    );
    if (!url) return <div className="w-20 h-20 rounded-lg border border-zinc-700 bg-zinc-800 animate-pulse" />;

    return (
        <img
            src={url}
            alt={foto.CFoNombre || ''}
            onClick={() => onAmpliar(url)}
            className="w-20 h-20 rounded-lg border border-zinc-700 object-cover cursor-zoom-in hover:border-amber-500/50 transition-colors"
        />
    );
};

const ConsultaClienteModal = ({ consulta, onClose, onRespondida }) => {
    const [comentario, setComentario] = useState('');
    const [confirmando, setConfirmando] = useState(null);   // null | 'APROBADO' | 'CANCELADO'
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [ampliada, setAmpliada] = useState(null);

    if (!consulta) return null;

    const esDeArchivo = !!consulta.ArchivoID;

    const responder = async (respuesta) => {
        setEnviando(true);
        setError('');
        try {
            await apiClient.post(`/web-orders/consultas/${consulta.ConIdConsulta}/responder`, {
                respuesta,
                comentario: comentario.trim() || null,
            });
            onRespondida?.(respuesta);
            onClose?.();
        } catch (e) {
            setError(e.message || 'No se pudo enviar tu respuesta. Probá de nuevo.');
            setConfirmando(null);
        } finally {
            setEnviando(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[92vh]">

                <div className="px-5 py-4 border-b border-zinc-800 flex items-start gap-3 shrink-0">
                    <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                        <MessageSquareWarning className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-white font-semibold text-base leading-tight">Necesitamos que revises algo</h3>
                        <p className="text-zinc-400 text-xs mt-1">
                            Pedido <b className="text-zinc-300">{consulta.CodigoOrden}</b>
                            {consulta.DescripcionTrabajo && <> · {consulta.DescripcionTrabajo}</>}
                        </p>
                    </div>
                    {!enviando && (
                        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
                            <X size={18} />
                        </button>
                    )}
                </div>

                <div className="px-5 py-4 space-y-4 overflow-y-auto">

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            {consulta.Motivo || 'Consulta'}
                        </span>
                        {esDeArchivo && consulta.NombreArchivo && (
                            <span className="text-[11px] text-zinc-500 truncate">sobre <b className="text-zinc-400">{consulta.NombreArchivo}</b></span>
                        )}
                    </div>

                    <div className="bg-zinc-800/70 border border-zinc-700 rounded-xl p-4">
                        <p className="text-sm text-zinc-100 font-medium whitespace-pre-wrap break-words leading-relaxed">
                            {consulta.ConPregunta}
                        </p>
                    </div>

                    {consulta.fotos?.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {consulta.fotos.map(f => (
                                <FotoPregunta key={f.CFoIdFoto} consultaId={consulta.ConIdConsulta} foto={f} onAmpliar={setAmpliada} />
                            ))}
                        </div>
                    )}

                    {!confirmando && (
                        <div>
                            <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-wider mb-2">
                                Querés agregar algo? <span className="text-zinc-600 normal-case font-medium">(opcional)</span>
                            </label>
                            <textarea
                                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-500 resize-none focus:outline-none focus:border-amber-500/60 transition-colors"
                                rows={2}
                                placeholder="Ej: dale, imprimilo así / te mando el archivo en alta por mail"
                                value={comentario}
                                onChange={e => setComentario(e.target.value)}
                                maxLength={1000}
                            />
                        </div>
                    )}

                    {error && (
                        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-zinc-800 shrink-0">
                    {confirmando === 'APROBADO' ? (
                        <>
                            <p className="text-sm text-zinc-300 mb-3">
                                Confirmás que <b className="text-emerald-400">seguimos adelante tal como está</b>. Tu aprobación
                                queda registrada y el trabajo vuelve a producción.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setConfirmando(null)}
                                    disabled={enviando}
                                    className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-700 text-zinc-300 text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-40"
                                >Volver</button>
                                <button
                                    onClick={() => responder('APROBADO')}
                                    disabled={enviando}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    {enviando ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} strokeWidth={3} />}
                                    Sí, continuar
                                </button>
                            </div>
                        </>
                    ) : confirmando === 'CANCELADO' ? (
                        <>
                            <p className="text-sm text-zinc-300 mb-3">
                                {esDeArchivo ? (
                                    <>Se va a cancelar <b className="text-brand-magenta">el archivo {consulta.NombreArchivo || 'consultado'}</b> del
                                    pedido {consulta.CodigoOrden}. Si era el único que quedaba, se cancela la orden entera.</>
                                ) : (
                                    <>Se va a cancelar <b className="text-brand-magenta">toda la orden {consulta.CodigoOrden}</b>.</>
                                )}
                                <span className="block mt-2 text-zinc-400">Esto no se puede deshacer desde el portal.</span>
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setConfirmando(null)}
                                    disabled={enviando}
                                    className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-700 text-zinc-300 text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-40"
                                >Volver</button>
                                <button
                                    onClick={() => responder('CANCELADO')}
                                    disabled={enviando}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-brand-magenta text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    {enviando ? <Loader2 size={15} className="animate-spin" /> : <X size={15} strokeWidth={3} />}
                                    Sí, cancelar
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col sm:flex-row gap-2.5">
                            <button
                                onClick={() => setConfirmando('APROBADO')}
                                className="flex-1 px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
                            >
                                <Check size={16} strokeWidth={3} />
                                Está correcto, continuar
                            </button>
                            <button
                                onClick={() => setConfirmando('CANCELADO')}
                                className="flex-1 sm:flex-none sm:px-5 px-4 py-3 rounded-lg border border-brand-magenta/40 text-brand-magenta text-sm font-semibold hover:bg-brand-magenta/10 transition-colors flex items-center justify-center gap-2"
                            >
                                <X size={16} strokeWidth={3} />
                                Cancelar
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {ampliada && (
                <div
                    className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-6 cursor-zoom-out"
                    onClick={() => setAmpliada(null)}
                >
                    <img src={ampliada} alt="" className="max-h-full max-w-full rounded-lg" />
                </div>
            )}
        </div>,
        document.body
    );
};

export default ConsultaClienteModal;
