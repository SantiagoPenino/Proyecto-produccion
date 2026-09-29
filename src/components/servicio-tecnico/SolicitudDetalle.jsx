import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
    X, Loader2, Hand, Pause, Play, ArrowRightLeft, CheckCircle2, RotateCcw, Pencil, Cog, Paperclip,
    Send, MessageSquare, User, Clock,
} from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { comprimirImagen } from '../../utils/comprimirImagen';
import {
    categoria as categoriaInfo, prioridad as prioridadInfo, estado as estadoInfo, resultado as resultadoInfo,
    estadoEquipo, PRIORIDADES, RESULTADOS, CATEGORIAS, ACCIONES, fmtFecha, fmtDia, fmtDuracion, haceCuanto, hoyISO, mensajeError,
} from './constantes';
import { chip, label, input, btn, MiniModal, ModalMotivo, ModalEstadoMaquina, Adjunto, Dato, PanelLateral } from './ui';
import { InsumosUsados } from './Insumos';

// Detalle de una solicitud de Servicio Técnico (panel lateral). Los técnicos (área SERVICIO o
// Admin) actúan; quien la pidió puede comentar y adjuntar. Plan: docs/servicio-tecnico-plan.md.

// Derivar a otro técnico o a un servicio externo.
const ModalDerivar = ({ sol, tecnicos, onConfirmar, onCerrar }) => {
    const [destino, setDestino] = useState('tecnico');
    const [tecnicoId, setTecnicoId] = useState('');
    const [externo, setExterno] = useState('');
    const [motivo, setMotivo] = useState('');
    const [guardando, setGuardando] = useState(false);
    const valido = motivo.trim() && (destino === 'tecnico' ? tecnicoId : externo.trim());
    const ok = async () => {
        setGuardando(true);
        try { await onConfirmar(destino === 'tecnico' ? { tecnicoId, motivo: motivo.trim() } : { externo: externo.trim(), motivo: motivo.trim() }); }
        finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={`Derivar ${sol.Codigo}`} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={`${btn} text-zinc-500 hover:bg-zinc-200`}>Cancelar</button>
            <button onClick={ok} disabled={!valido || guardando} className={`${btn} bg-violet-600 text-white hover:bg-violet-700`}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <ArrowRightLeft size={15} />} Derivar
            </button>
        </>}>
            <div className="grid grid-cols-2 gap-2">
                {[['tecnico', 'A otro técnico'], ['externo', 'A un servicio externo']].map(([k, t]) => (
                    <button key={k} type="button" onClick={() => setDestino(k)}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-bold ${destino === k ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-zinc-200 text-zinc-600'}`}>{t}</button>
                ))}
            </div>
            {destino === 'tecnico' ? (
                <div>
                    <span className={label}>Técnico</span>
                    <select className={input} value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
                        <option value="">— Elegir —</option>
                        {tecnicos.filter(t => t.id !== sol.TecnicoId).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </select>
                </div>
            ) : (
                <div>
                    <span className={label}>Servicio externo</span>
                    <input className={input} value={externo} maxLength={200} onChange={(e) => setExterno(e.target.value)} placeholder="Ej: Service oficial Epson, electricista" />
                    <p className="mt-1.5 text-xs text-zinc-400">La solicitud la sigue {sol.TecnicoNombre || 'quien deriva'} hasta que vuelva.</p>
                </div>
            )}
            <div>
                <span className={label}>Motivo (obligatorio)</span>
                <textarea className={`${input} min-h-[70px]`} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)}
                    placeholder="¿Por qué se deriva?" />
            </div>
        </MiniModal>
    );
};

// Finalizar: resultado, lo realizado, seguimiento, repuestos y cómo queda la máquina.
const ModalFinalizar = ({ sol, estadosEquipo, onConfirmar, onCerrar }) => {
    const otrasParada = (sol.otrasAbiertasEquipo || []).some(o => o.MaquinaNoTrabaja);
    const estadoActual = String(sol.EquipoEstado || '').trim().toUpperCase();
    const [d, setD] = useState({
        resultado: 'RESUELTA',
        trabajoRealizado: sol.TrabajoRealizado || '',
        requiereSeguimiento: !!sol.RequiereSeguimiento,
        fechaSeguimiento: sol.FechaSeguimiento || '',
        seguimientoNota: sol.SeguimientoNota || '',
        necesitaRepuestos: !!sol.NecesitaRepuestos,
        repuestosDetalle: sol.RepuestosDetalle || '',
        // Si la máquina quedó en mantenimiento por esta solicitud, se propone liberarla (salvo que otra la tenga parada).
        estadoEquipo: sol.EquipoId && estadoActual === 'MANTENIMIENTO' && !otrasParada ? 'DISPONIBLE' : '',
    });
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(prev => ({ ...prev, ...c }));
    const valido = d.trabajoRealizado.trim() && (!d.requiereSeguimiento || d.fechaSeguimiento);
    const ok = async () => { setGuardando(true); try { await onConfirmar(d); } finally { setGuardando(false); } };
    return (
        <MiniModal titulo={`Finalizar ${sol.Codigo}`} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={`${btn} text-zinc-500 hover:bg-zinc-200`}>Cancelar</button>
            <button onClick={ok} disabled={!valido || guardando} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Finalizar
            </button>
        </>}>
            <div>
                <span className={label}>¿Cómo terminó?</span>
                <div className="grid grid-cols-2 gap-2">
                    {RESULTADOS.map(r => (
                        <button key={r.value} type="button" onClick={() => set({ resultado: r.value })}
                            className={`px-3 py-2 rounded-xl border text-sm font-bold ${d.resultado === r.value ? r.chip.replace('bg-', 'ring-2 ring-offset-1 ring-zinc-300 bg-') : 'border-zinc-200 text-zinc-600'}`}>{r.label}</button>
                    ))}
                </div>
            </div>
            <div>
                <span className={label}>{d.resultado === 'CANCELADA' ? 'Por qué se cancela' : 'Lo realizado'}</span>
                <textarea className={`${input} min-h-[90px]`} value={d.trabajoRealizado} maxLength={8000} autoFocus
                    onChange={(e) => set({ trabajoRealizado: e.target.value })}
                    placeholder={d.resultado === 'CANCELADA' ? 'Ej: duplicada de ST-00012' : 'Qué se hizo, qué se cambió, qué se probó'} />
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                <input type="checkbox" checked={d.necesitaRepuestos} onChange={(e) => set({ necesitaRepuestos: e.target.checked })} className="w-4 h-4 accent-brand-cyan" />
                Se necesitan repuestos
            </label>
            {d.necesitaRepuestos && (
                <input className={input} value={d.repuestosDetalle} maxLength={1000} onChange={(e) => set({ repuestosDetalle: e.target.value })} placeholder="Cuáles" />
            )}
            <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                <input type="checkbox" checked={d.requiereSeguimiento} onChange={(e) => set({ requiereSeguimiento: e.target.checked })} className="w-4 h-4 accent-brand-cyan" />
                Requiere seguimiento
            </label>
            {d.requiereSeguimiento && (
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
                    <input type="date" className={input} value={d.fechaSeguimiento} min={hoyISO()} onChange={(e) => set({ fechaSeguimiento: e.target.value })} />
                    <input className={input} value={d.seguimientoNota} maxLength={500} onChange={(e) => set({ seguimientoNota: e.target.value })} placeholder="Qué hay que revisar" />
                </div>
            )}
            {sol.EquipoId && (
                <div>
                    <span className={label}>Cómo queda la máquina ({sol.EquipoNombre})</span>
                    <select className={input} value={d.estadoEquipo} onChange={(e) => set({ estadoEquipo: e.target.value })}>
                        <option value="">No cambiar (ahora: {estadoEquipo(sol.EquipoEstado).label})</option>
                        {estadosEquipo.map(e => <option key={e} value={e}>{estadoEquipo(e).label}</option>)}
                    </select>
                    {otrasParada && (
                        <p className="mt-1.5 text-xs text-amber-700">Hay otra solicitud abierta que tiene esta máquina parada.</p>
                    )}
                </div>
            )}
        </MiniModal>
    );
};

// Editar datos.
const ModalEditar = ({ sol, areas, onConfirmar, onCerrar }) => {
    const [d, setD] = useState({
        titulo: sol.Titulo || '', descripcion: sol.Descripcion || '', prioridad: sol.Prioridad, categoria: sol.Categoria,
        equipoTexto: sol.EquipoTexto || '', areaId: sol.AreaId || '', trabajoRealizado: sol.TrabajoRealizado || '',
        requiereSeguimiento: !!sol.RequiereSeguimiento, fechaSeguimiento: sol.FechaSeguimiento || '', seguimientoNota: sol.SeguimientoNota || '',
        necesitaRepuestos: !!sol.NecesitaRepuestos, repuestosDetalle: sol.RepuestosDetalle || '',
    });
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(prev => ({ ...prev, ...c }));
    const ok = async () => { setGuardando(true); try { await onConfirmar(d); } finally { setGuardando(false); } };
    return (
        <MiniModal titulo={`Editar ${sol.Codigo}`} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={`${btn} text-zinc-500 hover:bg-zinc-200`}>Cancelar</button>
            <button onClick={ok} disabled={!d.titulo.trim() || guardando} className={`${btn} bg-brand-cyan text-white hover:bg-brand-cyan/90`}>
                {guardando && <Loader2 size={15} className="animate-spin" />} Guardar
            </button>
        </>}>
            <div><span className={label}>Título</span><input className={input} value={d.titulo} maxLength={200} onChange={(e) => set({ titulo: e.target.value })} /></div>
            <div><span className={label}>Detalle</span><textarea className={`${input} min-h-[70px]`} value={d.descripcion} onChange={(e) => set({ descripcion: e.target.value })} /></div>
            <div>
                <span className={label}>Prioridad</span>
                <div className="grid grid-cols-4 gap-1 bg-zinc-100 p-1 rounded-xl">
                    {PRIORIDADES.map(p => (
                        <button key={p.value} type="button" onClick={() => set({ prioridad: p.value })}
                            className={`py-2 rounded-lg text-xs font-black uppercase ${d.prioridad === p.value ? `${p.boton} shadow` : 'text-zinc-400'}`}>{p.label}</button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <span className={label}>Tipo</span>
                    <select className={input} value={d.categoria} onChange={(e) => set({ categoria: e.target.value })} disabled={!!sol.EquipoId}>
                        {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                </div>
                <div>
                    <span className={label}>Área</span>
                    <select className={input} value={d.areaId} onChange={(e) => set({ areaId: e.target.value })}>
                        <option value="">— Sin área —</option>
                        {areas.map(a => <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>)}
                    </select>
                </div>
            </div>
            {!sol.EquipoId && (
                <div><span className={label}>Equipo o lugar</span><input className={input} value={d.equipoTexto} maxLength={150} onChange={(e) => set({ equipoTexto: e.target.value })} /></div>
            )}
            <div><span className={label}>Lo realizado (avance)</span><textarea className={`${input} min-h-[70px]`} value={d.trabajoRealizado} onChange={(e) => set({ trabajoRealizado: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                <input type="checkbox" checked={d.necesitaRepuestos} onChange={(e) => set({ necesitaRepuestos: e.target.checked })} className="w-4 h-4 accent-brand-cyan" /> Se necesitan repuestos
            </label>
            {d.necesitaRepuestos && <input className={input} value={d.repuestosDetalle} maxLength={1000} onChange={(e) => set({ repuestosDetalle: e.target.value })} placeholder="Cuáles" />}
            <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                <input type="checkbox" checked={d.requiereSeguimiento} onChange={(e) => set({ requiereSeguimiento: e.target.checked })} className="w-4 h-4 accent-brand-cyan" /> Requiere seguimiento
            </label>
            {d.requiereSeguimiento && (
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
                    <input type="date" className={input} value={d.fechaSeguimiento} onChange={(e) => set({ fechaSeguimiento: e.target.value })} />
                    <input className={input} value={d.seguimientoNota} maxLength={500} onChange={(e) => set({ seguimientoNota: e.target.value })} placeholder="Qué hay que revisar" />
                </div>
            )}
        </MiniModal>
    );
};

// ── Panel ─────────────────────────────────────────────────────────────────────
const SolicitudDetalle = ({ solId, meta, version = 0, onCerrar, onCambio, onAbrir, onAbrirMaquina }) => {
    const [sol, setSol] = useState(null);
    const [error, setError] = useState(null);
    const [modal, setModal] = useState(null); // espera | derivar | finalizar | reabrir | editar | maquina
    const [comentario, setComentario] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const inputArchivos = useRef(null);

    const cargar = useCallback(async () => {
        try { setSol(await servicioTecnicoService.detalle(solId)); setError(null); }
        catch (e) { setError(mensajeError(e, 'No se pudo cargar la solicitud')); }
    }, [solId]);

    useEffect(() => { setSol(null); cargar(); }, [cargar]);
    useEffect(() => { if (version) cargar(); }, [version, cargar]);

    // Ejecuta una acción, refresca y avisa a la lista. Devuelve si salió bien.
    const accion = async (fn, exito) => {
        try {
            await fn();
            setModal(null);
            if (exito) toast.success(exito);
            await cargar();
            onCambio?.();
            return true;
        } catch (e) {
            toast.error(mensajeError(e));
            return false;
        }
    };

    const comentar = async () => {
        if (!comentario.trim()) return;
        setEnviando(true);
        if (await accion(() => servicioTecnicoService.comentar(solId, comentario.trim()))) setComentario('');
        setEnviando(false);
    };

    const subir = async (lista) => {
        const archivos = await Promise.all(Array.from(lista || []).slice(0, 8).map(a => comprimirImagen(a)));
        if (inputArchivos.current) inputArchivos.current.value = '';
        if (!archivos.length) return;
        setSubiendo(true);
        await accion(() => servicioTecnicoService.adjuntar(solId, archivos), `${archivos.length} archivo(s) adjuntado(s)`);
        setSubiendo(false);
    };

    const tec = !!sol?.puedeActuar;
    const puedeAportar = tec || !!sol?.esMia;
    const esMiaEnCurso = sol && sol.Estado === 'EN_CURSO' && meta?.usuario?.id === sol.TecnicoId;
    const cat = sol ? categoriaInfo(sol.Categoria) : null;

    return (
        <PanelLateral onCerrar={onCerrar}>
                {!sol ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
                        {error ? <><span className="text-sm">{error}</span><button onClick={onCerrar} className={`${btn} bg-zinc-200 text-zinc-600`}>Cerrar</button></>
                            : <Loader2 className="animate-spin" size={24} />}
                    </div>
                ) : (
                    <>
                        {/* Encabezado */}
                        <div className="bg-white border-b border-zinc-200 px-5 pt-4 pb-3 shrink-0">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                        <span className="font-mono font-bold text-zinc-400">{sol.Codigo}</span>
                                        <span className={`${chip} ${prioridadInfo(sol.Prioridad).chip}`}>{prioridadInfo(sol.Prioridad).label}</span>
                                        <span className={`${chip} ${estadoInfo(sol.Estado).chip}`}>{estadoInfo(sol.Estado).label}</span>
                                        {sol.Resultado && <span className={`${chip} ${resultadoInfo(sol.Resultado)?.chip}`}>{resultadoInfo(sol.Resultado)?.label}</span>}
                                        {sol.LegacyTicketId && <span className="text-zinc-400">(ticket viejo {sol.LegacyTicketId})</span>}
                                    </div>
                                    <h2 className="mt-1.5 text-lg font-black text-zinc-900 leading-snug break-words">{sol.Titulo}</h2>
                                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                                        <cat.Icono size={14} /> {cat.label}
                                    </div>
                                </div>
                                <button onClick={onCerrar} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-zinc-100 shrink-0"><X size={20} /></button>
                            </div>

                            {/* Acciones del técnico */}
                            {tec && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {sol.Estado === 'FINALIZADA' ? (
                                        <button onClick={() => setModal('reabrir')} className={`${btn} bg-zinc-800 text-white hover:bg-zinc-700`}><RotateCcw size={15} /> Reabrir</button>
                                    ) : (
                                        <>
                                            {!esMiaEnCurso && (
                                                <button onClick={() => accion(() => servicioTecnicoService.tomar(solId), 'Solicitud tomada')} className={`${btn} bg-brand-cyan text-white hover:bg-brand-cyan/90`}>
                                                    <Hand size={15} /> Tomar
                                                </button>
                                            )}
                                            {sol.Estado === 'EN_ESPERA' ? (
                                                <button onClick={() => accion(() => servicioTecnicoService.cambiarEstado(solId, 'EN_CURSO'), 'Retomada')} className={`${btn} bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100`}><Play size={15} /> Retomar</button>
                                            ) : sol.Estado === 'EN_CURSO' && (
                                                <button onClick={() => setModal('espera')} className={`${btn} bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100`}><Pause size={15} /> En espera</button>
                                            )}
                                            <button onClick={() => setModal('derivar')} className={`${btn} bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100`}><ArrowRightLeft size={15} /> Derivar</button>
                                            <button onClick={() => setModal('finalizar')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><CheckCircle2 size={15} /> Finalizar</button>
                                        </>
                                    )}
                                    <button onClick={() => setModal('editar')} className={`${btn} bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100`}><Pencil size={15} /> Editar</button>
                                    {sol.EquipoId && (
                                        <button onClick={() => setModal('maquina')} className={`${btn} bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100`}><Cog size={15} /> Estado máquina</button>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                            {/* Datos */}
                            <div className="bg-white rounded-2xl border border-zinc-200 p-4 grid grid-cols-2 gap-x-4 gap-y-3">
                                <Dato titulo={sol.EquipoId ? 'Máquina' : 'Equipo / lugar'}>
                                    {sol.EquipoId ? (
                                        <span className="flex flex-wrap items-center gap-1.5">
                                            {onAbrirMaquina
                                                ? <button onClick={() => onAbrirMaquina(sol.EquipoId)} className="font-bold text-brand-cyan hover:underline" title="Ver la ficha de la máquina">{sol.EquipoNombre || `#${sol.EquipoId}`}</button>
                                                : (sol.EquipoNombre || `#${sol.EquipoId}`)}
                                            <span className={`${chip} ${estadoEquipo(sol.EquipoEstado).chip}`}>{estadoEquipo(sol.EquipoEstado).label}</span>
                                        </span>
                                    ) : (sol.EquipoTexto || '—')}
                                    {sol.MaquinaNoTrabaja && <span className="block text-xs font-bold text-amber-700">Se reportó parada</span>}
                                </Dato>
                                <Dato titulo="Área">{sol.AreaNombre || sol.AreaId || '—'}</Dato>
                                <Dato titulo="Pedida">
                                    {fmtFecha(sol.FechaSolicitud)} <span className="text-xs text-zinc-400">({haceCuanto(sol.FechaSolicitud)})</span>
                                </Dato>
                                <Dato titulo="Reporta">
                                    {sol.SolicitanteNombre || '—'}
                                    {sol.CargadoPorNombre && sol.CargadoPorNombre !== sol.SolicitanteNombre && <span className="block text-xs text-zinc-400">cargó {sol.CargadoPorNombre}</span>}
                                </Dato>
                                <Dato titulo="Técnico">
                                    {sol.TecnicoNombre || <span className="text-zinc-400">Sin tomar</span>}
                                    {sol.FechaTomada && <span className="block text-xs text-zinc-400">tomada {fmtFecha(sol.FechaTomada)} · respuesta {fmtDuracion(sol.MinutosRespuesta)}</span>}
                                </Dato>
                                {sol.FechaFin ? (
                                    <Dato titulo="Finalizada">
                                        {fmtFecha(sol.FechaFin)}
                                        <span className="block text-xs text-zinc-400">
                                            por {sol.FinalizadaPorNombre} · resolución {fmtDuracion(sol.MinutosResolucion)}
                                            {sol.MinutosParada != null && ` · parada ${fmtDuracion(sol.MinutosParada)}`}
                                        </span>
                                    </Dato>
                                ) : <Dato titulo="Abierta hace">{fmtDuracion((Date.now() - new Date(sol.FechaSolicitud).getTime()) / 60000)}</Dato>}
                                {sol.Estado === 'EN_ESPERA' && sol.EsperaMotivo && <Dato titulo="Esperando">{sol.EsperaMotivo}</Dato>}
                                {sol.DerivadaExterno && <Dato titulo="Derivada a">{sol.DerivadaExterno}</Dato>}
                            </div>

                            {(sol.otrasAbiertasEquipo || []).length > 0 && (
                                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800">
                                    <span className="font-bold">Otras solicitudes abiertas de esta máquina:</span>{' '}
                                    {sol.otrasAbiertasEquipo.map((o, i) => (
                                        <span key={o.SolId}>{i > 0 && ', '}
                                            <button className="underline font-bold" onClick={() => onAbrir?.(o.SolId)}>{o.Codigo}</button> {o.Titulo}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {sol.Descripcion && (
                                <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                                    <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">Detalle</div>
                                    <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words">{sol.Descripcion}</p>
                                </div>
                            )}

                            {(sol.TrabajoRealizado || sol.NecesitaRepuestos || sol.RequiereSeguimiento) && (
                                <div className="bg-white rounded-2xl border border-zinc-200 p-4 flex flex-col gap-3">
                                    {sol.TrabajoRealizado && (
                                        <div>
                                            <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">Lo realizado</div>
                                            <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words">{sol.TrabajoRealizado}</p>
                                        </div>
                                    )}
                                    {sol.NecesitaRepuestos && <Dato titulo="Repuestos">{sol.RepuestosDetalle || 'Sí (sin detalle)'}</Dato>}
                                    {sol.RequiereSeguimiento && (
                                        <Dato titulo="Seguimiento">
                                            {sol.FechaSeguimiento ? fmtDia(sol.FechaSeguimiento) : 'Sin fecha'}{sol.SeguimientoNota ? ` — ${sol.SeguimientoNota}` : ''}
                                            {sol.SeguimientoHechoFecha ? (
                                                <span className="block text-xs text-emerald-700 font-bold">
                                                    Hecho el {fmtFecha(sol.SeguimientoHechoFecha)} por {sol.SeguimientoHechoPor}{sol.SeguimientoResultado ? `: ${sol.SeguimientoResultado}` : ''}
                                                </span>
                                            ) : tec && (
                                                <button onClick={() => setModal('seguimiento')} className={`${btn} mt-1 py-1 text-xs bg-violet-600 text-white hover:bg-violet-700`}>
                                                    <CheckCircle2 size={13} /> Marcar seguimiento hecho
                                                </button>
                                            )}
                                        </Dato>
                                    )}
                                </div>
                            )}

                            {/* Insumos del stock usados en esta solicitud */}
                            <InsumosUsados filtro={{ solId }} version={version} puedeUsar={tec && sol.Estado !== 'FINALIZADA'}
                                contexto={{ solId, equipoId: sol.EquipoId || undefined, titulo: sol.Codigo }} onCambio={() => { cargar(); onCambio?.(); }} />

                            {/* Adjuntos */}
                            <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Fotos y archivos ({sol.adjuntos.length})</span>
                                    {puedeAportar && (
                                        <>
                                            <input ref={inputArchivos} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden" onChange={(e) => subir(e.target.files)} />
                                            <button onClick={() => inputArchivos.current?.click()} disabled={subiendo} className={`${btn} py-1 text-xs text-brand-cyan hover:bg-brand-cyan/10`}>
                                                {subiendo ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Agregar
                                            </button>
                                        </>
                                    )}
                                </div>
                                {sol.adjuntos.length === 0 ? <p className="text-sm text-zinc-400">Sin archivos.</p> : (
                                    <div className="flex flex-wrap gap-2">{sol.adjuntos.map(a => <Adjunto key={a.AdjId} a={a} />)}</div>
                                )}
                            </div>

                            {/* Historial */}
                            <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-3">Historial</div>
                                <ol className="relative border-l-2 border-zinc-100 ml-2 flex flex-col gap-3">
                                    {sol.historial.map(h => (
                                        <li key={h.HisId} className="pl-4 relative">
                                            <span className={`absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-white ${h.Accion === 'COMENTARIO' ? 'bg-brand-cyan' : h.Accion === 'FINALIZADA' ? 'bg-emerald-500' : h.Accion === 'DERIVADA' ? 'bg-violet-500' : 'bg-zinc-300'}`} />
                                            <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                                <span className="font-black text-zinc-700">{ACCIONES[h.Accion] || h.Accion}</span>
                                                <span className="text-zinc-500 inline-flex items-center gap-1"><User size={11} />{h.UsuarioNombre || '—'}</span>
                                                <span className="text-zinc-400 inline-flex items-center gap-1"><Clock size={11} />{fmtFecha(h.Fecha)}</span>
                                            </div>
                                            {h.Detalle && <p className={`mt-0.5 text-sm whitespace-pre-wrap break-words ${h.Accion === 'COMENTARIO' ? 'text-zinc-800 bg-zinc-50 rounded-lg px-3 py-2' : 'text-zinc-600'}`}>{h.Detalle}</p>}
                                            {h.Motivo && <p className="mt-0.5 text-xs text-zinc-500"><span className="font-bold">Motivo:</span> {h.Motivo}</p>}
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        </div>

                        {/* Comentar */}
                        {puedeAportar && (
                            <div className="bg-white border-t border-zinc-200 p-3 flex items-end gap-2 shrink-0">
                                <MessageSquare size={18} className="text-zinc-300 mb-2.5 shrink-0" />
                                <textarea className={`${input} min-h-[42px] max-h-32 py-2`} rows={1} value={comentario} maxLength={4000}
                                    onChange={(e) => setComentario(e.target.value)} placeholder="Escribir un comentario…" />
                                <button onClick={comentar} disabled={!comentario.trim() || enviando} className={`${btn} bg-brand-cyan text-white hover:bg-brand-cyan/90 shrink-0`}>
                                    {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                </button>
                            </div>
                        )}

                        {/* Ventanas de acción */}
                        {modal === 'espera' && (
                            <ModalMotivo titulo="Poner en espera" textoLabel="¿Qué se está esperando?" confirmar="Poner en espera"
                                sugerencias={['Repuesto', 'Proveedor / service externo', 'Que el usuario pruebe', 'Que se libere la máquina']}
                                placeholder="Ej: repuesto pedido al proveedor" onCerrar={() => setModal(null)}
                                onConfirmar={(m) => accion(() => servicioTecnicoService.cambiarEstado(solId, 'EN_ESPERA', m), 'En espera')} />
                        )}
                        {modal === 'seguimiento' && (
                            <ModalMotivo titulo={`Seguimiento de ${sol.Codigo}`} textoLabel="¿Cómo quedó? (opcional)" confirmar="Marcar hecho" opcional
                                placeholder="Ej: anda bien, se cierra" onCerrar={() => setModal(null)}
                                onConfirmar={(nota) => accion(() => servicioTecnicoService.seguimientoHecho(solId, nota), 'Seguimiento hecho')} />
                        )}
                        {modal === 'reabrir' && (
                            <ModalMotivo titulo={`Reabrir ${sol.Codigo}`} textoLabel="¿Por qué se reabre?" confirmar="Reabrir"
                                placeholder="Ej: volvió a fallar" onCerrar={() => setModal(null)}
                                onConfirmar={(m) => accion(() => servicioTecnicoService.reabrir(solId, m), 'Reabierta')} />
                        )}
                        {modal === 'derivar' && (
                            <ModalDerivar sol={sol} tecnicos={meta?.tecnicos || []} onCerrar={() => setModal(null)}
                                onConfirmar={(d) => accion(() => servicioTecnicoService.derivar(solId, d), 'Solicitud derivada')} />
                        )}
                        {modal === 'finalizar' && (
                            <ModalFinalizar sol={sol} estadosEquipo={meta?.estadosEquipo || []} onCerrar={() => setModal(null)}
                                onConfirmar={(d) => accion(() => servicioTecnicoService.finalizar(solId, d), 'Solicitud finalizada')} />
                        )}
                        {modal === 'editar' && (
                            <ModalEditar sol={sol} areas={meta?.areas || []} onCerrar={() => setModal(null)}
                                onConfirmar={(d) => accion(() => servicioTecnicoService.editar(solId, d), 'Cambios guardados')} />
                        )}
                        {modal === 'maquina' && (
                            <ModalEstadoMaquina nombre={sol.EquipoNombre} estadoActual={sol.EquipoEstado} estadosEquipo={meta?.estadosEquipo || []} onCerrar={() => setModal(null)}
                                onConfirmar={(estado, motivo) => accion(() => servicioTecnicoService.cambiarEstadoMaquina(sol.EquipoId, estado, motivo, solId), 'Estado de la máquina actualizado')} />
                        )}
                    </>
                )}
        </PanelLateral>
    );
};

export default SolicitudDetalle;
