import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Wrench, X, Paperclip, Loader2, Send, Trash2, History } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { comprimirImagen } from '../../utils/comprimirImagen';
import { CATEGORIAS, PRIORIDADES, estado as estadoInfo, estadoEquipo, fmtFecha, mensajeError } from './constantes';

// Formulario para pedir Servicio Técnico. Lo usan la pantalla /servicio-tecnico y el botón
// "Reportar falla" de cada área (con el área y "máquina" ya elegidos, y la pestaña de historial
// del área). Plan: docs/servicio-tecnico-plan.md.
const VACIO = {
    categoria: null, equipoId: '', maquinaNoTrabaja: null, equipoTexto: '', areaId: '',
    titulo: '', descripcion: '', prioridad: 'MEDIA', reporta: 'yo', reportaTexto: '',
};

const label = 'block mb-1.5 text-[11px] font-black text-zinc-500 uppercase tracking-wide';
const input = 'w-full px-3 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-800 bg-white outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/10 transition-all placeholder:text-zinc-300';

const NuevaSolicitudModal = ({ abierta, onCerrar, onCreada, areaInicial = '', categoriaInicial = null, conHistorialArea = false }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [meta, setMeta] = useState(null);
    const [usuarios, setUsuarios] = useState([]);
    const [f, setF] = useState(VACIO);
    const [archivos, setArchivos] = useState([]);
    const [enviando, setEnviando] = useState(false);
    const [sugerencias, setSugerencias] = useState([]);
    const [verSugerencias, setVerSugerencias] = useState(false);
    const [tab, setTab] = useState('nueva');
    const [historial, setHistorial] = useState(null);
    const inputArchivos = useRef(null);
    const cajaTitulo = useRef(null);

    const set = (campos) => setF((prev) => ({ ...prev, ...campos }));

    // Al abrir: datos del formulario y valores iniciales.
    useEffect(() => {
        if (!abierta) return;
        setF({ ...VACIO, categoria: categoriaInicial, areaId: String(areaInicial || user?.areaKey || '').trim().toUpperCase() });
        setArchivos([]);
        setTab('nueva');
        setHistorial(null);
        servicioTecnicoService.meta().then(setMeta).catch((e) => toast.error(mensajeError(e, 'No se pudo cargar Servicio Técnico')));
        servicioTecnicoService.usuarios().then(setUsuarios).catch(() => setUsuarios([]));
    }, [abierta, areaInicial, categoriaInicial, user?.areaKey]);

    // Sugerencias de título (las más usadas de la categoría).
    useEffect(() => {
        if (!abierta || !f.categoria || !verSugerencias) return undefined;
        const t = setTimeout(() => {
            servicioTecnicoService.tiposFalla(f.categoria, f.titulo.trim()).then(setSugerencias).catch(() => setSugerencias([]));
        }, 250);
        return () => clearTimeout(t);
    }, [abierta, f.categoria, f.titulo, verSugerencias]);

    useEffect(() => {
        if (!verSugerencias) return undefined;
        const fuera = (e) => { if (cajaTitulo.current && !cajaTitulo.current.contains(e.target)) setVerSugerencias(false); };
        document.addEventListener('mousedown', fuera);
        return () => document.removeEventListener('mousedown', fuera);
    }, [verSugerencias]);

    // Historial del área (pestaña del botón de cada área).
    useEffect(() => {
        if (!abierta || tab !== 'historial' || historial) return;
        servicioTecnicoService.listar({ area: areaInicial, estado: 'TODAS', limite: 60 })
            .then(setHistorial).catch((e) => { toast.error(mensajeError(e)); setHistorial([]); });
    }, [abierta, tab, historial, areaInicial]);

    // Máquinas: primero las del área elegida.
    const maquinas = useMemo(() => {
        const todas = meta?.equipos || [];
        const area = String(f.areaId || '').toUpperCase();
        return { delArea: todas.filter(m => String(m.AreaID).toUpperCase() === area), otras: todas.filter(m => String(m.AreaID).toUpperCase() !== area) };
    }, [meta, f.areaId]);
    const maquinaElegida = (meta?.equipos || []).find(m => String(m.EquipoID) === String(f.equipoId));

    // Quién reporta: el logueado primero, después los de su área y el resto.
    const opcionesReporta = useMemo(() => {
        const area = String(f.areaId || user?.areaKey || '').toUpperCase();
        const otros = usuarios.filter(u => String(u.id) !== String(user?.id));
        return { delArea: otros.filter(u => u.area === area), resto: otros.filter(u => u.area !== area) };
    }, [usuarios, f.areaId, user?.id, user?.areaKey]);

    const agregarArchivos = async (lista) => {
        const nuevos = await Promise.all(Array.from(lista || []).map(a => comprimirImagen(a)));
        setArchivos((prev) => [...prev, ...nuevos].slice(0, 8));
        if (inputArchivos.current) inputArchivos.current.value = '';
    };

    const faltante = !f.categoria ? 'Elegí qué tipo de problema es.'
        : f.categoria === 'MAQUINA' && !f.equipoId ? 'Elegí la máquina.'
        : f.categoria === 'MAQUINA' && f.maquinaNoTrabaja === null ? 'Indicá si la máquina puede seguir trabajando.'
        : !f.titulo.trim() ? 'Escribí qué pasa.'
        : f.reporta === 'otro' && !f.reportaTexto.trim() ? 'Escribí quién reporta.'
        : null;

    const enviar = async () => {
        if (faltante) { toast.error(faltante); return; }
        setEnviando(true);
        try {
            const campos = {
                categoria: f.categoria,
                equipoId: f.categoria === 'MAQUINA' ? f.equipoId : undefined,
                maquinaNoTrabaja: f.categoria === 'MAQUINA' ? !!f.maquinaNoTrabaja : undefined,
                equipoTexto: f.categoria !== 'MAQUINA' ? f.equipoTexto.trim() : undefined,
                areaId: f.areaId || undefined,
                titulo: f.titulo.trim(),
                descripcion: f.descripcion.trim(),
                prioridad: f.prioridad,
                solicitanteId: f.reporta !== 'yo' && f.reporta !== 'otro' ? f.reporta : undefined,
                solicitanteNombre: f.reporta === 'otro' ? f.reportaTexto.trim() : undefined,
            };
            const sol = await servicioTecnicoService.crear(campos, archivos);
            toast.success(`Solicitud ${sol.Codigo} enviada a Servicio Técnico`, {
                description: f.maquinaNoTrabaja ? 'La máquina quedó en mantenimiento: no recibe lotes hasta que la liberen.' : undefined,
            });
            onCreada?.(sol);
            onCerrar();
        } catch (e) {
            toast.error(mensajeError(e, 'No se pudo enviar la solicitud'));
        } finally {
            setEnviando(false);
        }
    };

    if (!abierta) return null;

    return createPortal(
        // Sin cerrar al tocar afuera: es un formulario y se perdería lo escrito.
        <div className="fixed inset-0 z-[1150] flex items-start sm:items-center justify-center bg-zinc-900/60 p-2 sm:p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-2 sm:my-8 flex flex-col max-h-[calc(100vh-1rem)] sm:max-h-[92vh] overflow-hidden">
                {/* Encabezado */}
                <div className="px-5 pt-4 bg-zinc-900 text-white shrink-0">
                    <div className="flex items-center justify-between gap-3 pb-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0"><Wrench size={20} /></div>
                            <div className="min-w-0">
                                <h2 className="text-lg font-black leading-tight">Pedir Servicio Técnico</h2>
                                <p className="text-xs text-zinc-400 truncate">Máquinas, PC, internet, software o instalaciones</p>
                            </div>
                        </div>
                        <button onClick={onCerrar} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-white/10 hover:text-white"><X size={20} /></button>
                    </div>
                    {conHistorialArea && areaInicial && (
                        <div className="flex gap-1">
                            {[['nueva', 'Nueva solicitud'], ['historial', 'Historial del área']].map(([k, t]) => (
                                <button key={k} onClick={() => setTab(k)}
                                    className={`px-4 py-2 text-sm font-bold rounded-t-xl transition-colors ${tab === k ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-white'}`}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {tab === 'historial' ? (
                    <div className="flex-1 overflow-y-auto p-4">
                        {!historial ? (
                            <div className="py-10 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={20} /></div>
                        ) : historial.length === 0 ? (
                            <div className="py-10 text-center text-sm text-zinc-400">Todavía no hay solicitudes de esta área.</div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {historial.map((s) => (
                                    <button key={s.SolId} onClick={() => { onCerrar(); navigate(`/servicio-tecnico?sol=${s.SolId}`); }}
                                        className="w-full text-left bg-white border border-zinc-200 rounded-xl px-3 py-2.5 hover:border-brand-cyan/40 transition-colors">
                                        <div className="flex items-center gap-2 text-[11px]">
                                            <span className="font-mono font-bold text-zinc-400">{s.Codigo}</span>
                                            <span className={`px-2 py-0.5 rounded-full border font-bold ${estadoInfo(s.Estado).chip}`}>{estadoInfo(s.Estado).label}</span>
                                            <span className="text-zinc-400 ml-auto">{fmtFecha(s.FechaSolicitud)}</span>
                                        </div>
                                        <div className="mt-1 text-sm font-bold text-zinc-800 truncate">{s.Titulo}</div>
                                        {(s.EquipoNombre || s.EquipoTexto) && <div className="text-xs text-zinc-500 truncate">{s.EquipoNombre || s.EquipoTexto}</div>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
                            {/* 1. Tipo */}
                            <div>
                                <span className={label}>¿Qué tipo de problema es?</span>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {CATEGORIAS.map(({ value, corto, Icono }) => (
                                        <button key={value} type="button" onClick={() => set({ categoria: value, equipoId: '', maquinaNoTrabaja: null })}
                                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-bold transition-colors ${f.categoria === value ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                                            <Icono size={18} className="shrink-0" /> {corto}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 2. Máquina o equipo/lugar */}
                            {f.categoria === 'MAQUINA' ? (
                                <div className="flex flex-col gap-3">
                                    <div>
                                        <span className={label}>Máquina</span>
                                        <select className={input} value={f.equipoId} onChange={(e) => {
                                            const m = (meta?.equipos || []).find(x => String(x.EquipoID) === e.target.value);
                                            set({ equipoId: e.target.value, areaId: m?.AreaID || f.areaId });
                                        }}>
                                            <option value="">— Elegir máquina —</option>
                                            {maquinas.delArea.length > 0 && (
                                                <optgroup label="De esta área">
                                                    {maquinas.delArea.map(m => <option key={m.EquipoID} value={m.EquipoID}>{m.Nombre}</option>)}
                                                </optgroup>
                                            )}
                                            <optgroup label={maquinas.delArea.length ? 'Otras áreas' : 'Máquinas'}>
                                                {maquinas.otras.map(m => <option key={m.EquipoID} value={m.EquipoID}>{m.Nombre} ({m.AreaID})</option>)}
                                            </optgroup>
                                        </select>
                                        {maquinaElegida && (
                                            <p className="mt-1.5 text-xs text-zinc-500">Estado actual:{' '}
                                                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${estadoEquipo(maquinaElegida.Estado).chip}`}>{estadoEquipo(maquinaElegida.Estado).label}</span>
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <span className={label}>¿La máquina puede seguir trabajando?</span>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button type="button" onClick={() => set({ maquinaNoTrabaja: false })}
                                                className={`px-3 py-2.5 rounded-xl border text-sm font-bold transition-colors ${f.maquinaNoTrabaja === false ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                                                Sí, sigue trabajando
                                            </button>
                                            <button type="button" onClick={() => set({ maquinaNoTrabaja: true })}
                                                className={`px-3 py-2.5 rounded-xl border text-sm font-bold transition-colors ${f.maquinaNoTrabaja === true ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                                                No, está parada
                                            </button>
                                        </div>
                                        {f.maquinaNoTrabaja === true && (
                                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                Pasa a MANTENIMIENTO: sale de la capacidad de planificación y no recibe lotes nuevos
                                                (se le pueden sacar los que tiene) hasta que Servicio Técnico la libere.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ) : f.categoria ? (
                                <div>
                                    <span className={label}>Equipo o lugar <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                                    <input className={input} value={f.equipoTexto} maxLength={150} onChange={(e) => set({ equipoTexto: e.target.value })}
                                        placeholder="Ej: PC de caja 2, router del depósito, aire de la oficina" />
                                </div>
                            ) : null}

                            {/* 3. Qué pasa */}
                            <div className="relative" ref={cajaTitulo}>
                                <span className={label}>¿Qué pasa?</span>
                                <input className={`${input} font-semibold`} value={f.titulo} maxLength={200} autoComplete="off"
                                    onChange={(e) => { set({ titulo: e.target.value }); setVerSugerencias(true); }}
                                    onFocus={() => setVerSugerencias(true)}
                                    placeholder={f.categoria ? 'Ej: cabezal tapado, no enciende, sin internet…' : 'Primero elegí el tipo de problema'}
                                    disabled={!f.categoria} />
                                {verSugerencias && sugerencias.length > 0 && (
                                    <ul className="absolute z-20 top-full mt-1 w-full bg-white border border-zinc-200 rounded-xl shadow-xl max-h-52 overflow-y-auto divide-y divide-zinc-50">
                                        {sugerencias.filter(s => s.Titulo !== f.titulo).map(s => (
                                            <li key={s.TipoId}>
                                                <button type="button" onClick={() => { set({ titulo: s.Titulo }); setVerSugerencias(false); }}
                                                    className="w-full text-left px-3 py-2.5 text-sm text-zinc-700 hover:bg-brand-cyan/5">
                                                    {s.Titulo}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div>
                                <span className={label}>Detalle <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                                <textarea className={`${input} min-h-[80px]`} value={f.descripcion} maxLength={8000}
                                    onChange={(e) => set({ descripcion: e.target.value })} placeholder="Qué se ve, desde cuándo, qué se probó…" />
                            </div>

                            {/* 4. Prioridad */}
                            <div>
                                <span className={label}>Prioridad</span>
                                <div className="grid grid-cols-4 gap-1 bg-zinc-100 p-1 rounded-xl">
                                    {PRIORIDADES.map(p => (
                                        <button key={p.value} type="button" onClick={() => set({ prioridad: p.value })}
                                            className={`py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${f.prioridad === p.value ? `${p.boton} shadow` : 'text-zinc-400 hover:bg-white/60'}`}>
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 5. Área y quién reporta */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <span className={label}>Área</span>
                                    <select className={input} value={f.areaId} onChange={(e) => set({ areaId: e.target.value })}>
                                        <option value="">— Sin área —</option>
                                        {(meta?.areas || []).map(a => <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <span className={label}>¿Quién reporta?</span>
                                    <select className={input} value={f.reporta} onChange={(e) => set({ reporta: e.target.value })}>
                                        <option value="yo">{meta?.usuario?.nombre || user?.nombre || 'Yo'} (yo)</option>
                                        {opcionesReporta.delArea.length > 0 && (
                                            <optgroup label="De esta área">
                                                {opcionesReporta.delArea.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                                            </optgroup>
                                        )}
                                        <optgroup label="Todos">
                                            {opcionesReporta.resto.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                                        </optgroup>
                                        <option value="otro">Otra persona (sin usuario)…</option>
                                    </select>
                                    {f.reporta === 'otro' && (
                                        <input className={`${input} mt-2`} value={f.reportaTexto} maxLength={150} autoFocus
                                            onChange={(e) => set({ reportaTexto: e.target.value })} placeholder="Nombre de quien reporta" />
                                    )}
                                </div>
                            </div>

                            {/* 6. Adjuntos */}
                            <div>
                                <span className={label}>Fotos o capturas <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                                <input ref={inputArchivos} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden"
                                    onChange={(e) => agregarArchivos(e.target.files)} />
                                <div className="flex flex-wrap gap-2">
                                    {archivos.map((a, i) => (
                                        <span key={`${a.name}-${i}`} className="inline-flex items-center gap-1.5 max-w-full pl-3 pr-1 py-1 rounded-full bg-zinc-100 text-xs text-zinc-600">
                                            <span className="truncate max-w-[180px]">{a.name}</span>
                                            <span className="text-zinc-400">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
                                            <button type="button" onClick={() => setArchivos(prev => prev.filter((_, j) => j !== i))}
                                                className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-200 hover:text-red-600"><Trash2 size={13} /></button>
                                        </span>
                                    ))}
                                    {archivos.length < 8 && (
                                        <button type="button" onClick={() => inputArchivos.current?.click()}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-dashed border-zinc-200 text-xs font-bold text-zinc-400 hover:border-brand-cyan/40 hover:text-brand-cyan">
                                            <Paperclip size={14} /> Agregar
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Pie */}
                        <div className="px-5 py-3 border-t border-zinc-100 bg-zinc-50 flex items-center justify-between gap-3 shrink-0">
                            <span className="text-xs text-zinc-400 hidden sm:inline">{faltante || 'Listo para enviar'}</span>
                            <div className="flex gap-2 ml-auto">
                                {conHistorialArea && areaInicial && (
                                    <button type="button" onClick={() => setTab('historial')} className="sm:hidden px-3 py-2 rounded-xl text-zinc-500 hover:bg-zinc-200"><History size={18} /></button>
                                )}
                                <button type="button" onClick={onCerrar} className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-500 hover:bg-zinc-200">Cancelar</button>
                                <button type="button" onClick={enviar} disabled={enviando || !!faltante}
                                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-cyan/90">
                                    {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
};

export default NuevaSolicitudModal;
