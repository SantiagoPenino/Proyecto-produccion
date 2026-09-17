import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import { consultasService } from '../../../services/api';

// =====================================================================
// CONSULTA AL CLIENTE — lo que se ve en el detalle de la orden
// =====================================================================
// Dos cosas distintas, por eso son dos bloques:
//  · la consulta ABIERTA (banda ámbar): por qué está frenada la orden, desde
//    cuándo, quién preguntó y el botón para retirarla.
//  · la última RESPONDIDA: la conformidad escrita del cliente, que es lo que
//    después sostiene el reclamo (docs/consultas-cliente-plan.md §7).

/** "hace 3 h" / "hace 2 días" — el dato útil es cuánto hace que espera, no la fecha exacta. */
const haceCuanto = (fecha) => {
    if (!fecha) return '';
    const ms = Date.now() - new Date(fecha).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const min = Math.floor(ms / 60000);
    if (min < 60) return `hace ${min} min`;
    const hs = Math.floor(min / 60);
    if (hs < 48) return `hace ${hs} h`;
    return `hace ${Math.floor(hs / 24)} días`;
};

/** Una foto de la consulta. La ruta es autenticada, así que va por blob (no por src directo). */
const FotoConsulta = ({ consultaId, foto, onAmpliar }) => {
    const [url, setUrl] = useState(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let vivo = true;
        let creada = null;
        consultasService.getFotoUrl(consultaId, foto.CFoIdFoto)
            .then(u => { if (vivo) { creada = u; setUrl(u); } else { URL.revokeObjectURL(u); } })
            .catch(() => { if (vivo) setError(true); });
        return () => { vivo = false; if (creada) URL.revokeObjectURL(creada); };
    }, [consultaId, foto.CFoIdFoto]);

    if (error) return (
        <div className="w-14 h-14 rounded border border-amber-200 bg-amber-50 flex items-center justify-center text-amber-400">
            <i className="fa-solid fa-image-slash text-xs" />
        </div>
    );
    if (!url) return <div className="w-14 h-14 rounded border border-amber-200 bg-amber-50 animate-pulse" />;

    return (
        <img
            src={url}
            alt={foto.CFoNombre || ''}
            onClick={() => onAmpliar(url)}
            className="w-14 h-14 rounded border border-amber-200 object-cover cursor-zoom-in hover:opacity-80 transition-opacity"
            title={foto.CFoNombre || 'Ver más grande'}
        />
    );
};

const BandaConsultaCliente = ({ consultas = [], readOnly = false, onCambio }) => {
    const [ampliada, setAmpliada] = useState(null);
    const [retirando, setRetirando] = useState(false);

    const abierta = consultas.find(c => c.ConEstado === 'ENVIADA');
    const respondida = consultas.find(c => c.ConEstado === 'RESPONDIDA');

    if (!abierta && !respondida) return null;

    const retirar = async () => {
        const r = await Swal.fire({
            title: '¿Retirar la consulta?',
            html: 'La orden vuelve al estado que tenía antes y el cliente deja de verla.<br/>Queda registrada en el historial.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, retirar',
            cancelButtonText: 'Volver',
            confirmButtonColor: '#d97706',
            cancelButtonColor: '#71717a',
            customClass: { container: '!z-[99999]' },
        });
        if (!r.isConfirmed) return;

        setRetirando(true);
        try {
            await consultasService.retirar(abierta.ConIdConsulta, 'Retirada por el operario desde el detalle de la orden');
            toast.success('Consulta retirada. La orden quedó liberada.');
            onCambio?.();
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo retirar la consulta.');
        } finally {
            setRetirando(false);
        }
    };

    return (
        <>
            {abierta && (
                <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                                <i className="fa-solid fa-comment-dots text-amber-600" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded">
                                        Esperando al cliente
                                    </span>
                                    <span className="text-xs font-bold text-zinc-700">{abierta.Motivo || 'Consulta'}</span>
                                    <span className="text-[11px] text-amber-700">{haceCuanto(abierta.ConFechaAlta)}</span>
                                </div>
                                <p className="text-sm text-zinc-700 font-medium mt-1.5 whitespace-pre-wrap break-words">
                                    {abierta.ConPregunta}
                                </p>
                                <p className="text-[11px] text-zinc-500 mt-1.5">
                                    La mandó <b>{abierta.UsuarioNombre || 'un operario'}</b>
                                    {abierta.NombreArchivo
                                        ? <> sobre el archivo <b>{abierta.NombreArchivo}</b></>
                                        : <> sobre la orden completa</>}
                                    {abierta.ConFechaVence && <> · vence el {new Date(abierta.ConFechaVence).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                                </p>
                                {abierta.fotos?.length > 0 && (
                                    <div className="flex gap-2 mt-2.5">
                                        {abierta.fotos.map(f => (
                                            <FotoConsulta key={f.CFoIdFoto} consultaId={abierta.ConIdConsulta} foto={f} onAmpliar={setAmpliada} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {!readOnly && (
                            <button
                                onClick={retirar}
                                disabled={retirando}
                                className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-700 text-xs font-bold hover:bg-amber-100 transition-colors shrink-0 disabled:opacity-50"
                                title="Dar de baja la consulta y liberar la orden"
                            >
                                <i className={`fa-solid ${retirando ? 'fa-circle-notch fa-spin' : 'fa-rotate-left'} mr-1.5`} />
                                Retirar
                            </button>
                        )}
                    </div>
                </div>
            )}

            {!abierta && respondida && (() => {
                // El archivo se editó después de que el cliente aprobó: la conformidad ya no
                // cubre lo que se va a imprimir, así que NO se muestra en verde. La respuesta
                // no se borra nunca — es el registro de lo que el cliente dijo y cuándo.
                const aprobado = respondida.ConRespuesta === 'APROBADO';
                const vencida = aprobado && !!respondida.ConArteCambiado;
                return (
                <div className={`mb-3 rounded-xl p-3 border shadow-sm ${
                    vencida ? 'bg-amber-50 border-amber-200'
                        : aprobado ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-brand-magenta/5 border-brand-magenta/20'
                }`}>
                    <div className="flex items-start gap-2.5">
                        <i className={`fa-solid ${
                            vencida ? 'fa-triangle-exclamation text-amber-600'
                                : aprobado ? 'fa-circle-check text-emerald-600'
                                : 'fa-circle-xmark text-brand-magenta'} mt-0.5`} />
                        <div className="min-w-0">
                            <p className="text-xs font-bold text-zinc-700">
                                {aprobado ? 'El cliente aprobó continuar' : 'El cliente pidió cancelar'}
                                {respondida.ConFechaRespuesta && (
                                    <span className="font-medium text-zinc-500">
                                        {' '}el {new Date(respondida.ConFechaRespuesta).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </p>
                            {vencida && (
                                <p className="text-[11px] font-bold text-amber-700 mt-1">
                                    El archivo se editó después. Esta aprobación NO cubre el arte actual.
                                </p>
                            )}
                            <p className="text-[11px] text-zinc-500 mt-0.5">
                                Consulta: {respondida.Motivo || '—'} · «{respondida.ConPregunta}»
                            </p>
                            {respondida.ConComentarioCli && (
                                <p className="text-xs text-zinc-700 font-medium mt-1.5 bg-white/70 border border-zinc-200 rounded-lg px-2.5 py-1.5">
                                    <i className="fa-solid fa-quote-left text-zinc-300 text-[9px] mr-1.5" />
                                    {respondida.ConComentarioCli}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* Foto ampliada */}
            {ampliada && (
                <div
                    className="fixed inset-0 z-[100000] bg-zinc-900/85 flex items-center justify-center p-6 cursor-zoom-out"
                    onClick={() => setAmpliada(null)}
                >
                    <img src={ampliada} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
                </div>
            )}
        </>
    );
};

export default BandaConsultaCliente;
