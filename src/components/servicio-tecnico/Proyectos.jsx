import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Search, X, Pencil, TrendingUp, Paperclip, User, Clock, Save, Trash2, AlertTriangle } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import { comprimirImagen } from '../../utils/comprimirImagen';
import { ESTADOS_PROYECTO, PRIORIDADES, prioridad as prioridadInfo, ACCIONES, fmtFecha, fmtDia, haceCuanto, mensajeError } from './constantes';
import { chip, label, input, btn, btnSec, btnPri, btnCancelar, MiniModal, Adjunto, Dato, PanelLateral, campoFiltro } from './ui';
import { InsumosUsados } from './Insumos';
import SelectorFecha from '../ui/SelectorFecha';
import Selector from '../ui/Selector';

// Proyectos de Servicio Técnico con historial de avances (etapa 4).

const estadoProy = (e) => ESTADOS_PROYECTO[e] || ESTADOS_PROYECTO.PLANIFICADO;

const Barra = ({ pct }) => (
    <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden"><div className="h-full bg-brand-cyan" style={{ width: `${pct}%` }} /></div>
        <span className="text-xs font-black text-zinc-600 w-9 text-right">{pct}%</span>
    </div>
);

// ── Alta / edición ────────────────────────────────────────────────────────────
const ModalProyecto = ({ proyecto = null, meta, onGuardado, onCerrar }) => {
    const [d, setD] = useState({
        titulo: proyecto?.Titulo || '', descripcion: proyecto?.Descripcion || '', responsableId: proyecto?.ResponsableId ? String(proyecto.ResponsableId) : '',
        prioridad: proyecto?.Prioridad || 'MEDIA', fechaInicio: proyecto?.FechaInicio || '', fechaEstimadaFin: proyecto?.FechaEstimadaFin || '',
        equipoId: proyecto?.EquipoId ? String(proyecto.EquipoId) : '', equipoTexto: proyecto?.EquipoTexto || '',
    });
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    const guardar = async () => {
        setGuardando(true);
        try {
            const datos = { ...d, titulo: d.titulo.trim(), responsableId: d.responsableId || null, equipoId: d.equipoId || null };
            const r = proyecto ? await servicioTecnicoService.editarProyecto(proyecto.ProyId, datos) : await servicioTecnicoService.crearProyecto(datos);
            toast.success(proyecto ? 'Proyecto guardado' : 'Proyecto creado');
            onGuardado?.(r);
        } catch (e) { toast.error(mensajeError(e)); } finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={proyecto ? 'Editar proyecto' : 'Nuevo proyecto'} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={!d.titulo.trim() || guardando} className={btnPri}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar</button>
        </>}>
            <div><span className={label}>Título</span><input className={input} value={d.titulo} maxLength={200} autoFocus onChange={(e) => set({ titulo: e.target.value })} placeholder="Ej: Cambiar la red eléctrica de la planta" /></div>
            <div><span className={label}>Descripción</span><textarea className={`${input} min-h-[80px]`} value={d.descripcion} onChange={(e) => set({ descripcion: e.target.value })} placeholder="Qué se quiere lograr, alcance, presupuesto…" /></div>
            <div>
                <span className={label}>Prioridad</span>
                <div className="grid grid-cols-4 gap-1 bg-zinc-100 p-1 rounded-xl">
                    {PRIORIDADES.map(p => (
                        <button key={p.value} type="button" onClick={() => set({ prioridad: p.value })}
                            className={`py-2 rounded-lg text-xs font-black uppercase ${d.prioridad === p.value ? `${p.boton} shadow` : 'text-zinc-400'}`}>{p.label}</button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><span className={label}>Responsable</span>
                    <Selector value={d.responsableId} onChange={(e) => set({ responsableId: e.target.value })}>
                        <option value="">Sin asignar</option>
                        {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </Selector></div>
                <div><span className={label}>Inicio</span><SelectorFecha vaciable placeholder="Sin fecha" value={d.fechaInicio} max={d.fechaEstimadaFin || undefined} onChange={(e) => set({ fechaInicio: e.target.value })} /></div>
                <div><span className={label}>Fin estimado</span><SelectorFecha vaciable placeholder="Sin fecha" value={d.fechaEstimadaFin} min={d.fechaInicio || undefined} onChange={(e) => set({ fechaEstimadaFin: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className={label}>Máquina <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                    <Selector value={d.equipoId} onChange={(e) => set({ equipoId: e.target.value })}>
                        <option value="">Otra cosa / ninguna</option>
                        {(meta?.equipos || []).map(m => <option key={m.EquipoID} value={m.EquipoID}>{m.Nombre} ({m.AreaID})</option>)}
                    </Selector></div>
                {!d.equipoId && <div><span className={label}>Equipo o lugar</span><input className={input} value={d.equipoTexto} maxLength={150} onChange={(e) => set({ equipoTexto: e.target.value })} /></div>}
            </div>
        </MiniModal>
    );
};

// ── Cargar un avance ─────────────────────────────────────────────────────────
const ModalAvance = ({ p, onGuardado, onCerrar }) => {
    const [textoAvance, setTextoAvance] = useState('');
    const [progreso, setProgreso] = useState(p.Progreso);
    const [archivos, setArchivos] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const inputArchivos = useRef(null);
    const agregar = async (lista) => {
        const nuevos = await Promise.all(Array.from(lista || []).map(a => comprimirImagen(a)));
        setArchivos(prev => [...prev, ...nuevos].slice(0, 8));
        if (inputArchivos.current) inputArchivos.current.value = '';
    };
    const guardar = async () => {
        setGuardando(true);
        try {
            await servicioTecnicoService.avanceProyecto(p.ProyId, textoAvance.trim(), progreso !== p.Progreso ? progreso : '', archivos);
            toast.success('Avance cargado');
            onGuardado?.();
        } catch (e) { toast.error(mensajeError(e)); } finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={`Avance: ${p.Titulo}`} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={guardando || (!textoAvance.trim() && progreso === p.Progreso && !archivos.length)} className={btnPri}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <TrendingUp size={15} />} Guardar avance
            </button>
        </>}>
            <div><span className={label}>Qué se hizo</span><textarea className={`${input} min-h-[90px]`} value={textoAvance} autoFocus maxLength={8000} onChange={(e) => setTextoAvance(e.target.value)} /></div>
            <div>
                <span className={label}>Avance total: {progreso}%</span>
                <input type="range" min={0} max={100} step={5} value={progreso} onChange={(e) => setProgreso(parseInt(e.target.value, 10))} className="w-full accent-brand-cyan" />
            </div>
            <div>
                <span className={label}>Fotos o archivos <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                <input ref={inputArchivos} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden" onChange={(e) => agregar(e.target.files)} />
                <div className="flex flex-wrap gap-2">
                    {archivos.map((a, i) => (
                        <span key={`${a.name}-${i}`} className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full bg-zinc-100 text-xs text-zinc-600">
                            <span className="truncate max-w-[160px]">{a.name}</span>
                            <button type="button" onClick={() => setArchivos(x => x.filter((_, j) => j !== i))} className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:text-red-600"><Trash2 size={13} /></button>
                        </span>
                    ))}
                    <button type="button" onClick={() => inputArchivos.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-dashed border-zinc-200 text-xs font-bold text-zinc-400 hover:border-brand-cyan/40 hover:text-brand-cyan">
                        <Paperclip size={14} /> Agregar
                    </button>
                </div>
            </div>
            {p.Estado === 'PLANIFICADO' && <p className="text-xs text-zinc-500">Al cargar el primer avance el proyecto pasa a "En curso".</p>}
        </MiniModal>
    );
};

// ── Cambiar estado ───────────────────────────────────────────────────────────
const ModalEstadoProyecto = ({ p, onGuardado, onCerrar }) => {
    const opciones = Object.keys(ESTADOS_PROYECTO).filter(e => e !== p.Estado && !(e === 'PLANIFICADO'));
    const [estado, setEstado] = useState(opciones[0]);
    const [motivo, setMotivo] = useState('');
    const [guardando, setGuardando] = useState(false);
    const pideMotivo = ['EN_PAUSA', 'CANCELADO'].includes(estado);
    const guardar = async () => {
        setGuardando(true);
        try {
            await servicioTecnicoService.estadoProyecto(p.ProyId, estado, motivo.trim());
            toast.success(`Proyecto: ${estadoProy(estado).label.toLowerCase()}`);
            onGuardado?.();
        } catch (e) { toast.error(mensajeError(e)); } finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo="Cambiar estado del proyecto" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={guardando || (pideMotivo && !motivo.trim())} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />} Cambiar</button>
        </>}>
            <div className="grid grid-cols-2 gap-2">
                {opciones.map(e => (
                    <button key={e} type="button" onClick={() => setEstado(e)}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-bold ${estado === e ? `${estadoProy(e).chip} ring-2 ring-offset-1 ring-zinc-300` : 'border-zinc-200 text-zinc-600'}`}>
                        {estadoProy(e).label}
                    </button>
                ))}
            </div>
            {estado === 'TERMINADO' && <p className="text-xs text-zinc-500">Queda al 100 %.</p>}
            <div><span className={label}>Motivo {pideMotivo ? '(obligatorio)' : '(opcional)'}</span>
                <textarea className={`${input} min-h-[70px]`} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} /></div>
        </MiniModal>
    );
};

// ── Detalle ──────────────────────────────────────────────────────────────────
export const ProyectoDetalle = ({ proyId, meta, version = 0, onCerrar, onCambio }) => {
    const [p, setP] = useState(null);
    const [error, setError] = useState(null);
    const [modal, setModal] = useState(null);
    const [ocupado, setOcupado] = useState(false);
    const inputArchivos = useRef(null);
    const tec = !!meta?.esTecnico;
    const cargar = useCallback(async () => {
        try { setP(await servicioTecnicoService.proyecto(proyId)); setError(null); }
        catch (e) { setError(mensajeError(e, 'No se pudo cargar el proyecto')); }
    }, [proyId]);
    useEffect(() => { setP(null); cargar(); }, [cargar]);
    useEffect(() => { if (version) cargar(); }, [version, cargar]);
    const listo = () => { setModal(null); cargar(); onCambio?.(); };
    const subir = async (lista) => {
        const archivos = await Promise.all(Array.from(lista || []).slice(0, 8).map(a => comprimirImagen(a)));
        if (inputArchivos.current) inputArchivos.current.value = '';
        if (!archivos.length) return;
        setOcupado(true);
        try { await servicioTecnicoService.adjuntarProyecto(proyId, archivos); toast.success('Archivos agregados'); listo(); }
        catch (e) { toast.error(mensajeError(e)); } finally { setOcupado(false); }
    };
    const cerrado = p && ['TERMINADO', 'CANCELADO'].includes(p.Estado);
    return (
        <PanelLateral onCerrar={onCerrar}>
            {!p ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
                    {error ? <><span className="text-sm">{error}</span><button onClick={onCerrar} className={`${btn} bg-zinc-200 text-zinc-600`}>Cerrar</button></> : <Loader2 className="animate-spin" size={24} />}
                </div>
            ) : (
                <>
                    <div className="bg-white border-b border-zinc-200 px-5 pt-4 pb-3 shrink-0">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className={`${chip} ${estadoProy(p.Estado).chip}`}>{estadoProy(p.Estado).label}</span>
                                    <span className={`${chip} ${prioridadInfo(p.Prioridad).chip}`}>{prioridadInfo(p.Prioridad).label}</span>
                                    {p.Atrasado === 1 && <span className={`${chip} bg-red-50 text-red-700 border-red-200`}>Atrasado</span>}
                                </div>
                                <h2 className="mt-1.5 text-lg font-black text-zinc-900 leading-snug break-words">{p.Titulo}</h2>
                                <div className="mt-2"><Barra pct={p.Progreso} /></div>
                            </div>
                            <button onClick={onCerrar} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-zinc-100 shrink-0"><X size={20} /></button>
                        </div>
                        {tec && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {!cerrado && <button onClick={() => setModal('avance')} className={btnPri}><TrendingUp size={15} /> Cargar avance</button>}
                                <button onClick={() => setModal('estado')} className={btnSec}>{cerrado ? 'Reabrir' : 'Cambiar estado'}</button>
                                <button onClick={() => setModal('editar')} className={btnSec}><Pencil size={15} /> Editar</button>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                        <div className="bg-white rounded-2xl border border-zinc-200 p-4 grid grid-cols-2 gap-x-4 gap-y-3">
                            <Dato titulo="Responsable">{p.ResponsableNombre || '—'}</Dato>
                            <Dato titulo="Máquina / lugar">{p.EquipoNombre || p.EquipoTexto || '—'}</Dato>
                            <Dato titulo="Inicio">{fmtDia(p.FechaInicio) || '—'}</Dato>
                            <Dato titulo="Fin estimado">{fmtDia(p.FechaEstimadaFin) || '—'}{p.FechaFin && <span className="block text-xs text-zinc-400">cerrado {fmtFecha(p.FechaFin)}</span>}</Dato>
                            <Dato titulo="Creado">{p.CreadoPorNombre} · {fmtFecha(p.FechaCreacion)}</Dato>
                            <Dato titulo="Último avance">{p.UltimoAvance ? haceCuanto(p.UltimoAvance) : '—'}</Dato>
                        </div>
                        {p.Descripcion && (
                            <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">Descripción</div>
                                <p className="text-sm text-zinc-700 whitespace-pre-wrap break-words">{p.Descripcion}</p>
                            </div>
                        )}
                        <InsumosUsados filtro={{ proyId }} version={version} puedeUsar={tec && !cerrado}
                            contexto={{ proyId, equipoId: p.EquipoId || undefined, titulo: p.Titulo }} onCambio={listo} />
                        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Fotos y archivos ({p.adjuntos.length})</span>
                                {tec && (<>
                                    <input ref={inputArchivos} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden" onChange={(e) => subir(e.target.files)} />
                                    <button onClick={() => inputArchivos.current?.click()} disabled={ocupado} className={`${btn} py-1 text-xs text-brand-cyan hover:bg-brand-cyan/10`}><Paperclip size={14} /> Agregar</button>
                                </>)}
                            </div>
                            {p.adjuntos.length === 0 ? <p className="text-sm text-zinc-400">Sin archivos.</p> : <div className="flex flex-wrap gap-2">{p.adjuntos.map(a => <Adjunto key={a.AdjId} a={a} />)}</div>}
                        </div>
                        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                            <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-3">Historial</div>
                            <ol className="relative border-l-2 border-zinc-100 ml-2 flex flex-col gap-3">
                                {[...p.historial].reverse().map(h => (
                                    <li key={h.HisId} className="pl-4 relative">
                                        <span className={`absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-white ${h.Accion === 'AVANCE' ? 'bg-brand-cyan' : h.Accion === 'ESTADO' ? 'bg-violet-500' : 'bg-zinc-300'}`} />
                                        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                            <span className="font-black text-zinc-700">{h.Accion === 'ESTADO' ? 'Estado' : ACCIONES[h.Accion] || h.Accion}</span>
                                            <span className="text-zinc-500 inline-flex items-center gap-1"><User size={11} />{h.UsuarioNombre || '—'}</span>
                                            <span className="text-zinc-400 inline-flex items-center gap-1"><Clock size={11} />{fmtFecha(h.Fecha)}</span>
                                        </div>
                                        {h.Detalle && <p className={`mt-0.5 text-sm whitespace-pre-wrap break-words ${h.Accion === 'AVANCE' ? 'text-zinc-800 bg-zinc-50 rounded-lg px-3 py-2' : 'text-zinc-600'}`}>{h.Detalle}</p>}
                                        {h.Motivo && <p className="mt-0.5 text-xs text-zinc-500"><span className="font-bold">Motivo:</span> {h.Motivo}</p>}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                    {modal === 'avance' && <ModalAvance p={p} onCerrar={() => setModal(null)} onGuardado={listo} />}
                    {modal === 'estado' && <ModalEstadoProyecto p={p} onCerrar={() => setModal(null)} onGuardado={listo} />}
                    {modal === 'editar' && <ModalProyecto proyecto={p} meta={meta} onCerrar={() => setModal(null)} onGuardado={listo} />}
                </>
            )}
        </PanelLateral>
    );
};

// ── Lista ────────────────────────────────────────────────────────────────────
const ProyectosVista = ({ meta, onAbrir }) => {
    const [estado, setEstado] = useState('ABIERTOS');
    const [q, setQ] = useState('');
    const [lista, setLista] = useState(null);
    const [nuevo, setNuevo] = useState(false);
    const cargar = useCallback(async () => {
        try { setLista(await servicioTecnicoService.proyectos({ estado, q: q.trim() || undefined })); }
        catch (e) { toast.error(mensajeError(e, 'No se pudieron cargar los proyectos')); setLista([]); }
    }, [estado, q]);
    useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);
    const avisar = useRecargaConFreno(() => cargar());
    useEffect(() => {
        socket.on('st:updated', avisar);
        return () => socket.off('st:updated', avisar);
    }, [avisar]);
    return (
        <div>
            {/* En celular, todo en una fila como en el calendario: buscador, estado y "+" solo. */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex sm:flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proyecto, responsable, máquina…" className={`${campoFiltro} w-full pl-9`} />
                </div>
                <Selector filtro value={estado} onChange={(e) => setEstado(e.target.value)}>
                    <option value="ABIERTOS">Abiertos</option>
                    {Object.entries(ESTADOS_PROYECTO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    <option value="TODOS">Todos</option>
                </Selector>
                <button onClick={() => setNuevo(true)} className={`hidden sm:inline-flex ${btnPri} ml-auto`}><Plus size={16} /> Nuevo proyecto</button>
                <button onClick={() => setNuevo(true)} title="Nuevo proyecto" aria-label="Nuevo proyecto"
                    className="sm:hidden w-9 h-9 rounded-xl flex items-center justify-center bg-brand-cyan text-white hover:bg-brand-cyan/90 shrink-0"><Plus size={18} /></button>
            </div>
            {!lista ? <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div>
                : lista.length === 0 ? <div className="py-16 text-center text-sm text-zinc-400">No hay proyectos{estado === 'ABIERTOS' ? ' abiertos' : ''}.</div>
                : (
                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                        {lista.map(p => (
                            <button key={p.ProyId} onClick={() => onAbrir(p.ProyId)} className="text-left rounded-2xl border border-zinc-200 bg-white px-4 py-3 hover:border-brand-cyan/40 hover:shadow-sm">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className={`${chip} ${estadoProy(p.Estado).chip}`}>{estadoProy(p.Estado).label}</span>
                                    <span className={`${chip} ${prioridadInfo(p.Prioridad).chip}`}>{prioridadInfo(p.Prioridad).label}</span>
                                    {p.Atrasado === 1 && <span className={`${chip} bg-red-50 text-red-700 border-red-200 inline-flex items-center gap-1`}><AlertTriangle size={10} /> Atrasado</span>}
                                    {p.FechaEstimadaFin && <span className="ml-auto text-zinc-400">fin {fmtDia(p.FechaEstimadaFin)}</span>}
                                </div>
                                <div className="mt-1 text-sm font-black text-zinc-800">{p.Titulo}</div>
                                <div className="text-xs text-zinc-500 mb-2">{p.ResponsableNombre || 'sin responsable'}{(p.EquipoNombre || p.EquipoTexto) && ` · ${p.EquipoNombre || p.EquipoTexto}`}{p.UltimoAvance && ` · último avance ${haceCuanto(p.UltimoAvance)}`}</div>
                                <Barra pct={p.Progreso} />
                            </button>
                        ))}
                    </div>
                )}
            {nuevo && <ModalProyecto meta={meta} onCerrar={() => setNuevo(false)} onGuardado={(p) => { setNuevo(false); cargar(); if (p?.ProyId) onAbrir(p.ProyId); }} />}
        </div>
    );
};

export default ProyectosVista;
