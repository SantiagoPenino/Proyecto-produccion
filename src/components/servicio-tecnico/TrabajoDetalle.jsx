import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
    X, Loader2, Play, CheckCircle2, CalendarClock, Ban, Pencil, Paperclip, Send, MessageSquare, User, Clock,
    Plus, Square, CheckSquare, Repeat, Cog,
} from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { comprimirImagen } from '../../utils/comprimirImagen';
import {
    estadoTrabajo, estadoEquipo, TIPOS_TRABAJO, ACCIONES, fmtFecha, fmtDia, fmtDuracion, hoyISO, sumarDias, mensajeError,
} from './constantes';
import { chip, label, input, btn, btnSec, btnPri, btnCancelar, MiniModal, ModalMotivo, Adjunto, Dato, PanelLateral } from './ui';
import { InsumosUsados } from './Insumos';

// Detalle de un trabajo del calendario (mantenimiento o tarea) — etapa 3 de Servicio Técnico.

const ModalPosponer = ({ t, onConfirmar, onCerrar }) => {
    const [fecha, setFecha] = useState(sumarDias(t.FechaProgramada < hoyISO() ? hoyISO() : t.FechaProgramada, 1));
    const [motivo, setMotivo] = useState('');
    const [guardando, setGuardando] = useState(false);
    const ok = async () => { setGuardando(true); try { await onConfirmar(fecha, motivo.trim()); } finally { setGuardando(false); } };
    return (
        <MiniModal titulo="Cambiar la fecha" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={ok} disabled={!fecha || !motivo.trim() || guardando} className={btnPri}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />} Guardar
            </button>
        </>}>
            <p className="text-sm text-zinc-600">Estaba para el <b>{fmtDia(t.FechaProgramada)}</b>{t.VecesPospuesto > 0 && <> · ya se pospuso {t.VecesPospuesto} {t.VecesPospuesto === 1 ? 'vez' : 'veces'}</>}.</p>
            <div className="flex flex-wrap gap-1.5">
                {[['Mañana', 1], ['En 2 días', 2], ['En una semana', 7]].map(([txt, n]) => (
                    <button key={n} type="button" onClick={() => setFecha(sumarDias(hoyISO(), n))}
                        className="px-2.5 py-1 rounded-full bg-zinc-100 text-xs font-bold text-zinc-600 hover:bg-brand-cyan/10 hover:text-brand-cyan">{txt}</button>
                ))}
            </div>
            <div><span className={label}>Nueva fecha</span><input type="date" className={input} value={fecha} min={hoyISO()} onChange={(e) => setFecha(e.target.value)} /></div>
            <div>
                <span className={label}>Motivo (obligatorio)</span>
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {['Producción urgente en la máquina', 'Falta un repuesto', 'Técnico con otra urgencia', 'Falta personal'].map(s => (
                        <button key={s} type="button" onClick={() => setMotivo(s)} className="px-2.5 py-1 rounded-full bg-zinc-100 text-xs font-bold text-zinc-600 hover:bg-brand-cyan/10 hover:text-brand-cyan">{s}</button>
                    ))}
                </div>
                <textarea className={`${input} min-h-[70px]`} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
            </div>
        </MiniModal>
    );
};

const ModalTerminar = ({ t, estadosEquipo, onConfirmar, onCerrar }) => {
    const transcurridos = t.FechaInicio ? Math.max(1, Math.round((Date.now() - new Date(t.FechaInicio).getTime()) / 60000)) : null;
    const [d, setD] = useState({
        resultado: 'REALIZADO', minutosReales: String(transcurridos ?? t.MinutosEstimados ?? ''), observaciones: '', motivo: '',
        estadoEquipo: t.EquipoId && String(t.EquipoEstado || '').trim().toUpperCase() === 'MANTENIMIENTO' ? 'DISPONIBLE' : '',
    });
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    const faltanTareas = t.TareasTotal - t.TareasHechas;
    const valido = d.resultado === 'REALIZADO' || d.motivo.trim();
    const ok = async () => { setGuardando(true); try { await onConfirmar(d); } finally { setGuardando(false); } };
    return (
        <MiniModal titulo={`Terminar: ${t.Titulo}`} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={ok} disabled={!valido || guardando} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Terminar
            </button>
        </>}>
            <div className="grid grid-cols-2 gap-2">
                {[['REALIZADO', 'Realizado', 'border-emerald-500 bg-emerald-50 text-emerald-700'], ['NO_REALIZADO', 'No se pudo hacer', 'border-red-500 bg-red-50 text-red-700']].map(([k, txt, cls]) => (
                    <button key={k} type="button" onClick={() => set({ resultado: k })}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-bold ${d.resultado === k ? cls : 'border-zinc-200 text-zinc-600'}`}>{txt}</button>
                ))}
            </div>
            {d.resultado === 'REALIZADO' && faltanTareas > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Quedan {faltanTareas} tarea{faltanTareas === 1 ? '' : 's'} sin tildar.</p>
            )}
            {d.resultado === 'REALIZADO' ? (
                <div className="grid grid-cols-[140px_1fr] gap-2 items-end">
                    <div><span className={label}>Tiempo real (min)</span>
                        <input className={input} inputMode="numeric" value={d.minutosReales} onChange={(e) => set({ minutosReales: e.target.value.replace(/\D/g, '') })} /></div>
                    <p className="text-xs text-zinc-400 pb-2.5">Estimado: {fmtDuracion(t.MinutosEstimados)}{transcurridos != null && ` · desde que se empezó: ${fmtDuracion(transcurridos)}`}</p>
                </div>
            ) : (
                <div><span className={label}>¿Por qué no se hizo?</span>
                    <textarea className={`${input} min-h-[70px]`} value={d.motivo} maxLength={500} autoFocus onChange={(e) => set({ motivo: e.target.value })} /></div>
            )}
            <div><span className={label}>Observaciones <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                <textarea className={`${input} min-h-[60px]`} value={d.observaciones} maxLength={8000} onChange={(e) => set({ observaciones: e.target.value })} /></div>
            {t.EquipoId && (
                <div>
                    <span className={label}>Cómo queda la máquina ({t.EquipoNombre})</span>
                    <select className={input} value={d.estadoEquipo} onChange={(e) => set({ estadoEquipo: e.target.value })}>
                        <option value="">No cambiar (ahora: {estadoEquipo(t.EquipoEstado).label})</option>
                        {estadosEquipo.map(e => <option key={e} value={e}>{estadoEquipo(e).label}</option>)}
                    </select>
                </div>
            )}
            {t.PlanId && <p className="text-xs text-zinc-500 inline-flex items-center gap-1"><Repeat size={12} /> Es de un plan: al terminar se programa el próximo.</p>}
        </MiniModal>
    );
};

const ModalEditarTrabajo = ({ t, tecnicos, onConfirmar, onCerrar }) => {
    const [d, setD] = useState({
        titulo: t.Titulo, descripcion: t.Descripcion || '', tecnicoId: t.TecnicoId ? String(t.TecnicoId) : '',
        minutosEstimados: String(t.MinutosEstimados ?? ''), equipoTexto: t.EquipoTexto || '',
    });
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    const ok = async () => { setGuardando(true); try { await onConfirmar(d); } finally { setGuardando(false); } };
    return (
        <MiniModal titulo="Editar trabajo" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={ok} disabled={!d.titulo.trim() || guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />} Guardar</button>
        </>}>
            <div><span className={label}>Título</span><input className={input} value={d.titulo} maxLength={200} onChange={(e) => set({ titulo: e.target.value })} /></div>
            <div><span className={label}>Detalle</span><textarea className={`${input} min-h-[70px]`} value={d.descripcion} onChange={(e) => set({ descripcion: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
                <div><span className={label}>Técnico</span>
                    <select className={input} value={d.tecnicoId} onChange={(e) => set({ tecnicoId: e.target.value })}>
                        <option value="">Sin asignar</option>
                        {tecnicos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    </select></div>
                <div><span className={label}>Tiempo estimado (min)</span>
                    <input className={input} inputMode="numeric" value={d.minutosEstimados} onChange={(e) => set({ minutosEstimados: e.target.value.replace(/\D/g, '') })} /></div>
            </div>
            {!t.EquipoId && <div><span className={label}>Equipo o lugar</span><input className={input} value={d.equipoTexto} maxLength={150} onChange={(e) => set({ equipoTexto: e.target.value })} /></div>}
            <p className="text-xs text-zinc-400">La fecha se cambia con "Cambiar fecha" (queda el motivo).</p>
        </MiniModal>
    );
};

const TrabajoDetalle = ({ trabId, meta, version = 0, onCerrar, onCambio, onAbrirMaquina }) => {
    const [t, setT] = useState(null);
    const [error, setError] = useState(null);
    const [modal, setModal] = useState(null); // posponer | terminar | cancelar | editar
    const [nuevaTarea, setNuevaTarea] = useState({ texto: '', minutos: '' });
    const [comentario, setComentario] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const inputArchivos = useRef(null);
    const tec = !!meta?.esTecnico;

    const cargar = useCallback(async () => {
        try { setT(await servicioTecnicoService.trabajo(trabId)); setError(null); }
        catch (e) { setError(mensajeError(e, 'No se pudo cargar el trabajo')); }
    }, [trabId]);
    useEffect(() => { setT(null); cargar(); }, [cargar]);
    useEffect(() => { if (version) cargar(); }, [version, cargar]);

    const accion = async (fn, exito) => {
        try {
            const r = await fn();
            setModal(null);
            if (exito) toast.success(typeof exito === 'function' ? exito(r) : exito);
            await cargar();
            onCambio?.();
            return true;
        } catch (e) { toast.error(mensajeError(e)); return false; }
    };

    const tildar = async (tarea) => {
        setT(prev => ({ ...prev, tareas: prev.tareas.map(x => (x.TareaId === tarea.TareaId ? { ...x, Hecha: !x.Hecha } : x)) }));
        const ok = await accion(() => servicioTecnicoService.marcarTarea(trabId, tarea.TareaId, { hecha: !tarea.Hecha }));
        if (!ok) cargar();
    };

    const agregarTarea = async () => {
        if (!nuevaTarea.texto.trim()) return;
        if (await accion(() => servicioTecnicoService.agregarTarea(trabId, nuevaTarea.texto.trim(), parseInt(nuevaTarea.minutos, 10) || 0))) {
            setNuevaTarea({ texto: '', minutos: '' });
        }
    };

    const comentar = async () => {
        if (!comentario.trim()) return;
        setOcupado(true);
        if (await accion(() => servicioTecnicoService.comentarTrabajo(trabId, comentario.trim()))) setComentario('');
        setOcupado(false);
    };

    const subir = async (lista) => {
        const archivos = await Promise.all(Array.from(lista || []).slice(0, 8).map(a => comprimirImagen(a)));
        if (inputArchivos.current) inputArchivos.current.value = '';
        if (!archivos.length) return;
        setOcupado(true);
        await accion(() => servicioTecnicoService.adjuntarTrabajo(trabId, archivos), 'Archivos agregados');
        setOcupado(false);
    };

    const abierto = t && ['PENDIENTE', 'EN_CURSO'].includes(t.Estado);
    const est = t ? estadoTrabajo(t) : null;

    return (
        <PanelLateral onCerrar={onCerrar}>
            {!t ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
                    {error ? <><span className="text-sm">{error}</span><button onClick={onCerrar} className={`${btn} bg-zinc-200 text-zinc-600`}>Cerrar</button></>
                        : <Loader2 className="animate-spin" size={24} />}
                </div>
            ) : (
                <>
                    <div className="bg-white border-b border-zinc-200 px-5 pt-4 pb-3 shrink-0">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className={`${chip} bg-zinc-800 text-white border-zinc-800`}>{TIPOS_TRABAJO[t.Tipo] || t.Tipo}</span>
                                    <span className={`${chip} ${est.chip}`}>{est.label}</span>
                                    {t.PlanId && <span className="inline-flex items-center gap-1 text-zinc-500"><Repeat size={12} />{t.PlanTitulo}</span>}
                                </div>
                                <h2 className="mt-1.5 text-lg font-black text-zinc-900 leading-snug break-words">{t.Titulo}</h2>
                                <p className="text-xs text-zinc-500 mt-0.5">
                                    {fmtDia(t.FechaProgramada)}{t.FechaOriginal !== t.FechaProgramada && <> (era el {fmtDia(t.FechaOriginal)})</>}
                                    {' · '}{t.TecnicoNombre || 'sin asignar'}{' · '}estimado {fmtDuracion(t.MinutosEstimados) || '—'}
                                </p>
                            </div>
                            <button onClick={onCerrar} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-zinc-100 shrink-0"><X size={20} /></button>
                        </div>
                        {tec && abierto && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {t.Estado === 'PENDIENTE' && (
                                    <button onClick={() => accion(() => servicioTecnicoService.empezarTrabajo(trabId), t.ParaMaquina ? 'Empezado: la máquina pasó a mantenimiento' : 'Empezado')} className={btnPri}><Play size={15} /> Empezar</button>
                                )}
                                <button onClick={() => setModal('terminar')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><CheckCircle2 size={15} /> Terminar</button>
                                <button onClick={() => setModal('posponer')} className={btnSec}><CalendarClock size={15} /> Cambiar fecha</button>
                                <button onClick={() => setModal('editar')} className={btnSec}><Pencil size={15} /> Editar</button>
                                <button onClick={() => setModal('cancelar')} className={`${btn} text-zinc-500 hover:bg-zinc-100`}><Ban size={15} /> Cancelar</button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                        <div className="bg-white rounded-2xl border border-zinc-200 p-4 grid grid-cols-2 gap-x-4 gap-y-3">
                            <Dato titulo={t.EquipoId ? 'Máquina' : 'Equipo / lugar'}>
                                {t.EquipoId ? (
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        {onAbrirMaquina ? <button onClick={() => onAbrirMaquina(t.EquipoId)} className="font-bold text-brand-cyan hover:underline">{t.EquipoNombre}</button> : t.EquipoNombre}
                                        <span className={`${chip} ${estadoEquipo(t.EquipoEstado).chip}`}>{estadoEquipo(t.EquipoEstado).label}</span>
                                    </span>
                                ) : (t.EquipoTexto || '—')}
                                {t.ParaMaquina && <span className="flex items-center gap-1 text-xs font-bold text-amber-700"><Cog size={11} /> Hay que parar la máquina</span>}
                            </Dato>
                            <Dato titulo="Procedimiento">{t.ProcTitulo || '—'}</Dato>
                            {t.FechaInicio && <Dato titulo="Empezado">{fmtFecha(t.FechaInicio)}</Dato>}
                            {t.FechaFin && <Dato titulo="Cerrado">{fmtFecha(t.FechaFin)}{t.MinutosReales != null && <span className="block text-xs text-zinc-400">tardó {fmtDuracion(t.MinutosReales)} (estimado {fmtDuracion(t.MinutosEstimados)})</span>}</Dato>}
                            {t.Motivo && <Dato titulo="Motivo">{t.Motivo}</Dato>}
                            <Dato titulo="Programado por">{t.CreadoPorNombre || '—'}</Dato>
                        </div>

                        {t.Descripcion && (
                            <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">Detalle</div>
                                <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words">{t.Descripcion}</p>
                            </div>
                        )}

                        {/* Tareas */}
                        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Tareas ({t.TareasHechas}/{t.TareasTotal})</span>
                                {t.TareasTotal > 0 && (
                                    <div className="w-32 h-1.5 bg-zinc-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${Math.round((t.TareasHechas / t.TareasTotal) * 100)}%` }} /></div>
                                )}
                            </div>
                            {t.tareas.length === 0 ? <p className="text-sm text-zinc-400">Sin tareas.</p> : (
                                <ul className="flex flex-col divide-y divide-zinc-100">
                                    {t.tareas.map(x => (
                                        <li key={x.TareaId} className="py-2 flex items-start gap-2.5">
                                            <button disabled={!tec || !abierto} onClick={() => tildar(x)}
                                                className={`mt-0.5 shrink-0 ${x.Hecha ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500'} disabled:cursor-default`}>
                                                {x.Hecha ? <CheckSquare size={20} /> : <Square size={20} />}
                                            </button>
                                            <div className="min-w-0 flex-1">
                                                <div className={`text-sm ${x.Hecha ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{x.Texto}</div>
                                                {x.Detalle && <div className="text-xs text-zinc-500 whitespace-pre-wrap">{x.Detalle}</div>}
                                                {x.Hecha && x.HechaPorNombre && <div className="text-[11px] text-zinc-400">{x.HechaPorNombre} · {fmtFecha(x.FechaHecha)}{x.Nota ? ` · ${x.Nota}` : ''}</div>}
                                            </div>
                                            {x.MinutosEstimados > 0 && <span className="text-xs text-zinc-400 shrink-0">{fmtDuracion(x.MinutosEstimados)}</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {tec && abierto && (
                                <div className="mt-2 flex gap-2">
                                    <input className={`${input} py-2`} value={nuevaTarea.texto} maxLength={500} placeholder="Agregar tarea…"
                                        onChange={(e) => setNuevaTarea(p => ({ ...p, texto: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') agregarTarea(); }} />
                                    <input className={`${input} py-2 w-20`} value={nuevaTarea.minutos} inputMode="numeric" placeholder="min"
                                        onChange={(e) => setNuevaTarea(p => ({ ...p, minutos: e.target.value.replace(/\D/g, '') }))} />
                                    <button onClick={agregarTarea} disabled={!nuevaTarea.texto.trim()} className={`${btnSec} shrink-0`}><Plus size={15} /></button>
                                </div>
                            )}
                        </div>

                        {t.Observaciones && (
                            <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">Observaciones</div>
                                <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words">{t.Observaciones}</p>
                            </div>
                        )}

                        <InsumosUsados filtro={{ trabId }} version={version} puedeUsar={tec && abierto}
                            contexto={{ trabId, equipoId: t.EquipoId || undefined, titulo: t.Titulo }} onCambio={() => { cargar(); onCambio?.(); }} />

                        {/* Adjuntos */}
                        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Fotos y archivos ({t.adjuntos.length})</span>
                                {tec && (
                                    <>
                                        <input ref={inputArchivos} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden" onChange={(e) => subir(e.target.files)} />
                                        <button onClick={() => inputArchivos.current?.click()} disabled={ocupado} className={`${btn} py-1 text-xs text-brand-cyan hover:bg-brand-cyan/10`}><Paperclip size={14} /> Agregar</button>
                                    </>
                                )}
                            </div>
                            {t.adjuntos.length === 0 ? <p className="text-sm text-zinc-400">Sin archivos.</p> : <div className="flex flex-wrap gap-2">{t.adjuntos.map(a => <Adjunto key={a.AdjId} a={a} />)}</div>}
                        </div>

                        {/* Historial */}
                        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                            <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-3">Historial</div>
                            <ol className="relative border-l-2 border-zinc-100 ml-2 flex flex-col gap-3">
                                {t.historial.map(h => (
                                    <li key={h.HisId} className="pl-4 relative">
                                        <span className={`absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-white ${h.Accion === 'COMENTARIO' ? 'bg-brand-cyan' : h.Accion === 'REALIZADO' ? 'bg-emerald-500' : ['POSPUESTO', 'REPROGRAMADO'].includes(h.Accion) ? 'bg-amber-500' : 'bg-zinc-300'}`} />
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

                    {tec && (
                        <div className="bg-white border-t border-zinc-200 p-3 flex items-end gap-2 shrink-0">
                            <MessageSquare size={18} className="text-zinc-300 mb-2.5 shrink-0" />
                            <textarea className={`${input} min-h-[42px] max-h-32 py-2`} rows={1} value={comentario} maxLength={4000}
                                onChange={(e) => setComentario(e.target.value)} placeholder="Escribir un comentario…" />
                            <button onClick={comentar} disabled={!comentario.trim() || ocupado} className={`${btnPri} shrink-0`}><Send size={15} /></button>
                        </div>
                    )}

                    {modal === 'posponer' && (
                        <ModalPosponer t={t} onCerrar={() => setModal(null)}
                            onConfirmar={(fecha, motivo) => accion(() => servicioTecnicoService.posponerTrabajo(trabId, fecha, motivo), `Ahora es para el ${fmtDia(fecha)}`)} />
                    )}
                    {modal === 'terminar' && (
                        <ModalTerminar t={t} estadosEquipo={meta?.estadosEquipo || []} onCerrar={() => setModal(null)}
                            onConfirmar={(d) => accion(
                                () => servicioTecnicoService.terminarTrabajo(trabId, { ...d, minutosReales: d.resultado === 'REALIZADO' ? d.minutosReales : '' }),
                                (r) => (r?.siguiente ? `Terminado. El próximo es el ${fmtDia(r.siguiente.FechaProgramada)}` : 'Terminado'),
                            )} />
                    )}
                    {modal === 'cancelar' && (
                        <ModalMotivo titulo="Cancelar trabajo" textoLabel="¿Por qué se cancela?" confirmar="Cancelar trabajo" onCerrar={() => setModal(null)}
                            onConfirmar={(m) => accion(() => servicioTecnicoService.cancelarTrabajo(trabId, m), 'Trabajo cancelado')} />
                    )}
                    {modal === 'editar' && (
                        <ModalEditarTrabajo t={t} tecnicos={meta?.tecnicos || []} onCerrar={() => setModal(null)}
                            onConfirmar={(d) => accion(() => servicioTecnicoService.editarTrabajo(trabId, d), 'Cambios guardados')} />
                    )}
                </>
            )}
        </PanelLateral>
    );
};

export default TrabajoDetalle;
