import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import { consultasService } from '../../../services/api';

// =====================================================================
// CONSULTA AL CLIENTE — lo que se ve en el detalle de la orden
// =====================================================================
// Tres bloques:
//  · la consulta ABIERTA (banda ámbar): por qué está frenada la orden, desde
//    cuándo, quién preguntó y el botón para retirarla.
//  · la última RESPONDIDA: la conformidad escrita del cliente, que es lo que
//    después sostiene el reclamo (docs/consultas-cliente-plan.md §7).
//  · las ANTERIORES (retiradas, vencidas y respondidas más viejas), plegadas.
// Las fotos se abren en los tres con un link "Ver adjunto": son parte de lo que se le
// preguntó al cliente, y antes desaparecían del detalle apenas la consulta se cerraba.

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

const fechaCorta = (fecha) => fecha
    ? new Date(fecha).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

/** Cómo terminó una consulta que ya no está abierta. */
const comoTermino = (c) => {
    if (c.ConEstado === 'RESPONDIDA') {
        return c.ConRespuesta === 'APROBADO'
            ? { texto: 'El cliente aprobó continuar', icono: 'fa-circle-check text-emerald-600' }
            : { texto: 'El cliente pidió cancelar', icono: 'fa-circle-xmark text-brand-magenta' };
    }
    if (c.ConEstado === 'RETIRADA') return { texto: 'Retirada', icono: 'fa-rotate-left text-zinc-400' };
    if (c.ConEstado === 'VENCIDA') return { texto: 'Venció sin respuesta', icono: 'fa-hourglass-end text-zinc-400' };
    return { texto: c.ConEstado, icono: 'fa-circle text-zinc-300' };
};

/**
 * Link "Ver adjunto". La foto se baja recién al tocarlo: la ruta es autenticada, así que
 * va por blob (un <img src="/api/..."> pelado da 401).
 */
const LinkAdjunto = ({ consultaId, foto, texto, onAbrir }) => {
    const [cargando, setCargando] = useState(false);

    const abrir = async () => {
        if (cargando) return;
        setCargando(true);
        try {
            onAbrir(await consultasService.getFotoUrl(consultaId, foto.CFoIdFoto));
        } catch (e) {
            toast.error('No se pudo abrir el adjunto.');
        } finally {
            setCargando(false);
        }
    };

    return (
        <button
            type="button"
            onClick={abrir}
            disabled={cargando}
            className="text-[11px] font-bold text-brand-cyan hover:underline disabled:opacity-60"
            title={foto.CFoNombre || undefined}
        >
            <i className={`fa-solid ${cargando ? 'fa-circle-notch fa-spin' : 'fa-paperclip'} mr-1`} />
            {texto}
        </button>
    );
};

/**
 * Los adjuntos de una consulta, en cualquier estado. Van a la derecha de la primera línea
 * de cada consulta (por eso es un span: puede ir dentro de un <p>). Si hay más de uno, numerados.
 */
const AdjuntosConsulta = ({ consulta, onAbrir, className = '' }) => {
    const fotos = consulta?.fotos || [];
    if (!fotos.length) return null;
    return (
        <span className={`inline-flex flex-wrap items-baseline gap-x-3 gap-y-1 ${className}`}>
            {fotos.map((f, i) => (
                <LinkAdjunto
                    key={f.CFoIdFoto}
                    consultaId={consulta.ConIdConsulta}
                    foto={f}
                    texto={fotos.length === 1 ? 'Ver adjunto' : `Ver adjunto ${i + 1}`}
                    onAbrir={onAbrir}
                />
            ))}
        </span>
    );
};

const BandaConsultaCliente = ({ consultas = [], readOnly = false, onCambio }) => {
    const [ampliada, setAmpliada] = useState(null);
    const [retirando, setRetirando] = useState(false);
    const [verAnteriores, setVerAnteriores] = useState(false);

    // Vienen de la más nueva a la más vieja.
    const abierta = consultas.find(c => c.ConEstado === 'ENVIADA');
    // La conformidad se muestra sola solo si no hay otra consulta abierta.
    const respondida = abierta ? null : consultas.find(c => c.ConEstado === 'RESPONDIDA');
    // Todo lo demás es historial. Sin esto, una consulta retirada o vencida no se veía en
    // ningún lado, y con ella la foto que el operario había mandado.
    const anteriores = consultas.filter(c => c !== abierta && c !== respondida);
    const adjuntosAnteriores = anteriores.reduce((n, c) => n + (c.fotos?.length || 0), 0);

    // La foto abierta es un blob URL: se libera al cerrarla, al abrir otra o si se cierra el detalle.
    useEffect(() => () => { if (ampliada) URL.revokeObjectURL(ampliada); }, [ampliada]);

    if (!consultas.length) return null;

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
                                    <AdjuntosConsulta consulta={abierta} onAbrir={setAmpliada} className="ml-1" />
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
                                <AdjuntosConsulta consulta={respondida} onAbrir={setAmpliada} className="ml-3" />
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

            {/* Consultas ya cerradas, plegadas. */}
            {anteriores.length > 0 && (
                <div className="mb-3 rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <button
                        type="button"
                        onClick={() => setVerAnteriores(v => !v)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-bold text-zinc-600 hover:bg-zinc-50 transition-colors"
                    >
                        <span>
                            <i className="fa-solid fa-clock-rotate-left text-zinc-400 mr-1.5" />
                            {anteriores.length === 1 ? 'Consulta anterior' : `Consultas anteriores (${anteriores.length})`}
                            {adjuntosAnteriores > 0 && (
                                <span className="ml-2 font-medium text-zinc-400">
                                    <i className="fa-solid fa-paperclip mr-1" />
                                    {adjuntosAnteriores} {adjuntosAnteriores === 1 ? 'adjunto' : 'adjuntos'}
                                </span>
                            )}
                        </span>
                        <i className={`fa-solid ${verAnteriores ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px] text-zinc-400`} />
                    </button>

                    {verAnteriores && (
                        <ul className="border-t border-zinc-100 divide-y divide-zinc-100">
                            {anteriores.map(c => {
                                const fin = comoTermino(c);
                                return (
                                    <li key={c.ConIdConsulta} className="px-3 py-2.5">
                                        <p className="text-xs font-bold text-zinc-700">
                                            <i className={`fa-solid ${fin.icono} mr-1.5`} />
                                            {fin.texto}
                                            {c.ConFechaRespuesta && (
                                                <span className="font-medium text-zinc-500"> el {fechaCorta(c.ConFechaRespuesta)}</span>
                                            )}
                                            <AdjuntosConsulta consulta={c} onAbrir={setAmpliada} className="ml-3" />
                                        </p>
                                        <p className="text-[11px] text-zinc-500 mt-0.5 break-words">
                                            {c.Motivo || 'Consulta'} · «{c.ConPregunta}»
                                        </p>
                                        <p className="text-[11px] text-zinc-500 mt-0.5">
                                            La mandó <b>{c.UsuarioNombre || 'un operario'}</b> el {fechaCorta(c.ConFechaAlta)}
                                            {c.NombreArchivo
                                                ? <> sobre el archivo <b>{c.NombreArchivo}</b></>
                                                : <> sobre la orden completa</>}
                                        </p>
                                        {c.ConComentarioCli && (
                                            <p className="text-[11px] text-zinc-600 mt-1 italic break-words">«{c.ConComentarioCli}»</p>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

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
