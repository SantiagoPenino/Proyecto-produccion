import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, ChevronUp, ChevronDown, CalendarPlus, Search } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import { btnPri, btnCancelar, input, label } from '../servicio-tecnico/ui';
import { Desplegable, fmtD, mensajeError } from './comun';
import { ESTADOS_TAREA, pendiente, bloqueos, dependeDe, atrasada, gcal, diaDe } from './reglas';

// Piezas de tareas compartidas por la ficha del proyecto y la pantalla Tareas (spec-B §3.3, spec-C §2.4-2.5).
// Cada cambio se guarda al momento; el backend devuelve el proyecto entero y la pantalla lo reemplaza.

// Equipo de desarrollo (para elegir responsable): se pide una vez y queda en memoria
let equipoCache = null;
export const useEquipo = () => {
    const [equipo, setEquipo] = useState(equipoCache || []);
    useEffect(() => {
        if (equipoCache) return;
        desarrollosService.equipo().then(e => { equipoCache = e; setEquipo(e); }).catch(() => {});
    }, []);
    return equipo;
};
export const olvidarEquipo = () => { equipoCache = null; };

// Artículo del maestro: buscador por código o descripción
export const ArticuloBuscador = ({ onElegir, autoFocus = false, placeholder = 'Buscar el artículo por código o nombre' }) => {
    const [q, setQ] = useState('');
    const [lista, setLista] = useState([]);
    const [buscando, setBuscando] = useState(false);
    useEffect(() => {
        if (q.trim().length < 2) { setLista([]); return undefined; }
        setBuscando(true);
        const t = setTimeout(() => desarrollosService.articulos(q.trim()).then(setLista).catch(() => setLista([])).finally(() => setBuscando(false)), 250);
        return () => clearTimeout(t);
    }, [q]);
    return (
        <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input className={`${input} pl-9`} value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
            {(buscando || lista.length > 0) && (
                <div className="absolute z-[6300] left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
                    {buscando && !lista.length && <div className="px-3 py-2"><Loader2 size={15} className="animate-spin text-zinc-300" /></div>}
                    {lista.map(a => (
                        <button key={a.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onElegir(a); setQ(''); setLista([]); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50">
                            <span className="font-mono text-xs font-bold text-brand-cyan">{a.codigo}</span>
                            <span className="flex-1 min-w-0 truncate text-zinc-800">{a.nombre}</span>
                            {a.familia && <span className="text-xs text-zinc-400">{a.familia}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

// Texto que se guarda al salir del campo (vacío vuelve a lo que estaba si `obligatorio`)
const CampoTexto = ({ valor, max, obligatorio = false, disabled, onGuardar, placeholder }) => {
    const [v, setV] = useState(valor || '');
    useEffect(() => { setV(valor || ''); }, [valor]);
    const salir = () => {
        const limpio = v.trim();
        if (obligatorio && !limpio) { setV(valor || ''); return; }
        if (limpio !== (valor || '')) onGuardar(limpio);
    };
    return <input className={input} value={v} maxLength={max} disabled={disabled} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)} onBlur={salir} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />;
};

// Detalle de una tarea ("⋯ más"): nombre, etapa, duración, entregable, nota, dependencias, mover y quitar
export const DetalleTarea = ({ p, t, edita, sugerida, cambiar, onActualizado }) => {
    const [seguro, setSeguro] = useState(false);
    const otras = p.tareas.filter(x => x.id !== t.id);
    const etapaDe = (x) => p.etapas.find(e => e.id === x.etapaId)?.nombre || '';
    const mover = async (dir) => {
        try { onActualizado(await desarrollosService.moverTarea(t.id, dir)); } catch (e) { toast.error(mensajeError(e)); }
    };
    const quitar = async () => {
        try { onActualizado(await desarrollosService.quitarTarea(t.id)); } catch (e) { toast.error(mensajeError(e, 'No se pudo quitar.')); }
    };
    const fechaCal = t.fecha || sugerida;
    return (
        <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
                <div><span className={label}>Nombre</span><CampoTexto valor={t.nombre} max={120} obligatorio disabled={!edita} onGuardar={(v) => cambiar({ nombre: v })} /></div>
                <div>
                    <span className={label}>Etapa</span>
                    <Selector value={String(t.etapaId)} onChange={(e) => cambiar({ etapaId: Number(e.target.value) })} disabled={!edita} aria-label="Etapa">
                        {p.etapas.map(e => <option key={e.id} value={String(e.id)}>{e.nombre}</option>)}
                    </Selector>
                </div>
                <div>
                    <span className={label}>Duración (días hábiles)</span>
                    <CampoTexto valor={String(t.diasHabiles ?? 1)} max={3} disabled={!edita} onGuardar={(v) => cambiar({ diasHabiles: Math.max(0, Math.min(120, parseInt(v, 10) || 0)) })} />
                </div>
                <div><span className={label}>Entregable</span><CampoTexto valor={t.entregable} max={80} disabled={!edita} onGuardar={(v) => cambiar({ entregable: v })} /></div>
                <div className="sm:col-span-2"><span className={label}>Nota</span><CampoTexto valor={t.nota} max={300} disabled={!edita} onGuardar={(v) => cambiar({ nota: v })} /></div>
            </div>
            {otras.length > 0 && (
                <div>
                    <span className={label}>Depende de</span>
                    <p className="mb-1.5 text-xs text-zinc-500">No puede empezar hasta que estén hechas las que marques. Las fechas sugeridas se ajustan solas.</p>
                    <div className="grid gap-1 sm:grid-cols-2 max-h-48 overflow-y-auto">
                        {otras.map(x => {
                            const marcada = (t.depende || []).includes(x.id);
                            const ciclo = !marcada && dependeDe(x, t, p.tareas);
                            return (
                                <label key={x.id} title={ciclo ? 'Esa tarea ya depende de esta' : ''} className={`flex items-center gap-2 text-sm ${ciclo ? 'text-zinc-300' : 'text-zinc-700'}`}>
                                    <input type="checkbox" checked={marcada} disabled={!edita || ciclo} className="accent-brand-cyan"
                                        onChange={(e) => cambiar({ depende: e.target.checked ? [...(t.depende || []), x.id] : (t.depende || []).filter(d => d !== x.id) })} />
                                    <span className="truncate">{x.nombre}</span><span className="text-xs text-zinc-400">{etapaDe(x)}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                {edita && pendiente(t) && !t.fecha && sugerida && (
                    <button type="button" onClick={() => cambiar({ fecha: sugerida })} className="text-sm font-bold text-brand-cyan hover:underline">Usar la fecha sugerida ≈ {fmtD(sugerida)}</button>
                )}
                {pendiente(t) && fechaCal && (
                    <a href={gcal(`${t.nombre} · ${p.nombre}`, fechaCal, `Proyecto: ${p.nombre}${t.entregable ? `\nEntregable: ${t.entregable}` : ''}`)} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-bold text-brand-cyan hover:underline"><CalendarPlus size={14} /> Google Calendar</a>
                )}
                {edita && (<>
                    <div className="flex-1" />
                    <button type="button" onClick={() => mover(-1)} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"><ChevronUp size={15} /> Subir</button>
                    <button type="button" onClick={() => mover(1)} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"><ChevronDown size={15} /> Bajar</button>
                    <button type="button" onClick={() => (seguro ? quitar() : setSeguro(true))} onBlur={() => setSeguro(false)}
                        className={`text-sm font-bold ${seguro ? 'text-brand-magenta' : 'text-zinc-400 hover:text-zinc-600'}`}>
                        {seguro ? '¿Quitar esta tarea? Tocá de nuevo' : 'Quitar tarea'}
                    </button>
                </>)}
            </div>
        </div>
    );
};

// Fila de una tarea: ✓, nombre, estado, responsable y fecha, con las líneas de abajo y el detalle.
// conProyecto: en la pantalla Tareas muestra de qué proyecto es (con link).
// tandaActual + onSumarATanda: en la pantalla Tareas, el botón «+ tanda» para planificar una tarea dormida.
export const FilaTarea = ({ p, t, equipo, edita, esProducto, sugerida, conProyecto = false, onActualizado, onAbrirProyecto, tandaActual = null, onSumarATanda }) => {
    const [pideArticulo, setPideArticulo] = useState(false);
    const [articulo, setArticulo] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [detalle, setDetalle] = useState(false);
    const hecha = t.estado === 'HECHO';
    const faltaArticulo = t.pideRef && esProducto && !p.proIdProducto && !p.refErpTexto;
    const espera = bloqueos(t, p.tareas);
    const etapa = p.etapas.find(e => e.id === t.etapaId);

    const cambiar = async (cambios) => {
        if (cambios.estado === 'HECHO' && faltaArticulo) { setPideArticulo(true); return; }
        try {
            const r = await desarrollosService.tarea(t.id, cambios);
            if (r.aviso) toast.warning(r.aviso);
            onActualizado(r.data);
        } catch (e) {
            if (e?.response?.data?.codigo === 'FALTA_ARTICULO') setPideArticulo(true);
            else toast.error(mensajeError(e));
        }
    };
    const altaErp = async () => {
        if (!articulo) return;
        setGuardando(true);
        try { onActualizado(await desarrollosService.altaErp(t.id, articulo.id)); setPideArticulo(false); setArticulo(null); toast.success(`Alta en el ERP: ${articulo.codigo}.`); }
        catch (e) { toast.error(mensajeError(e)); }
        finally { setGuardando(false); }
    };

    // Responsable: el equipo, más el que tenga ahora si no es del equipo (datos viejos)
    const enEquipo = equipo.some(m => m.usuarioId === t.responsableId);
    return (
        <div className="py-2.5 border-b border-zinc-100 last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <button type="button" disabled={!edita} title={hecha ? 'Volver a pendiente' : 'Marcar como hecha'}
                    onClick={() => cambiar({ estado: hecha ? 'PENDIENTE' : 'HECHO' })}
                    className={`w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors disabled:cursor-default ${hecha ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-300 text-transparent hover:border-brand-cyan hover:text-brand-cyan'}`}>
                    <Check size={15} strokeWidth={3} />
                </button>
                <div className="flex-1 min-w-[180px]">
                    <span className={`text-sm ${hecha ? 'line-through text-zinc-400' : t.estado === 'NO_APLICA' ? 'text-zinc-400' : 'text-zinc-800 font-medium'}`}>{t.nombre}</span>
                    {conProyecto && (
                        <span className="block text-xs text-zinc-400">
                            <button type="button" onClick={() => onAbrirProyecto?.(p.id)} className="font-bold text-brand-cyan hover:underline">{p.nombre}</button>
                            {etapa && ` · ${etapa.nombre}`}
                        </span>
                    )}
                </div>
                <div className="w-36">
                    <Selector value={t.estado} onChange={(e) => cambiar({ estado: e.target.value })} disabled={!edita} aria-label="Estado">
                        {ESTADOS_TAREA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Selector>
                </div>
                <div className="w-44">
                    <Selector value={String(t.responsableId || (t.responsable ? '__actual' : ''))} onChange={(e) => cambiar({ responsableId: e.target.value && e.target.value !== '__actual' ? Number(e.target.value) : null })}
                        disabled={!edita} aria-label="Responsable" anchoLista={240}>
                        <option value="">Sin asignar</option>
                        {equipo.map(m => <option key={m.usuarioId} value={String(m.usuarioId)}>{m.nombre}</option>)}
                        {t.responsable && !enEquipo && <option value={t.responsableId ? String(t.responsableId) : '__actual'} disabled>{t.responsable}</option>}
                    </Selector>
                </div>
                <div className="w-40">
                    {hecha ? <span className="text-xs text-zinc-500">hecha {fmtD(diaDe(t.hechoEl) || t.fecha)}</span> : (
                        <div className={`rounded-xl ${atrasada(t) ? 'ring-2 ring-brand-magenta/50' : ''}`}>
                            <SelectorFecha value={t.fecha || ''} onChange={(e) => cambiar({ fecha: e.target.value || null })} disabled={!edita} vaciable className="w-full" />
                        </div>
                    )}
                </div>
                {t.tanda && <span className="px-2 py-0.5 rounded-full bg-brand-cyan/10 text-[11px] font-bold text-brand-cyan">{t.tanda.nombre}</span>}
                {!t.tanda && edita && pendiente(t) && tandaActual && onSumarATanda && (
                    <button type="button" onClick={() => onSumarATanda(t)} className="px-2 py-0.5 rounded-full border border-brand-cyan/40 text-[11px] font-bold text-brand-cyan hover:bg-brand-cyan/10">+ {tandaActual.nombre}</button>
                )}
                <button type="button" onClick={() => setDetalle(d => !d)} className="text-xs font-bold text-zinc-400 hover:text-zinc-700">⋯ más</button>
            </div>
            <div className="pl-10 flex flex-col gap-0.5">
                {espera.length > 0 && <p className="text-xs text-brand-magenta">Espera a: {espera.map(x => x.nombre).join(', ')}</p>}
                {pendiente(t) && !t.fecha && sugerida && <p className="text-xs text-zinc-400">Fecha sugerida ≈ {fmtD(sugerida)}</p>}
                {pendiente(t) && t.entregable && <p className="text-xs text-zinc-400">Entregable: {t.entregable}</p>}
                {t.nota && <p className="text-xs text-zinc-500">{t.nota}</p>}
                <Desplegable abierto={pideArticulo}>
                    <div className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-col gap-2 max-w-xl">
                        <p className="text-sm text-amber-800">Para dar el alta hace falta el artículo del ERP:</p>
                        {articulo
                            ? <p className="text-sm"><span className="font-mono font-bold text-brand-cyan">{articulo.codigo}</span> · {articulo.nombre} <button type="button" onClick={() => setArticulo(null)} className="text-xs text-zinc-500 hover:underline">cambiar</button></p>
                            : <ArticuloBuscador onElegir={setArticulo} autoFocus />}
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={altaErp} disabled={!articulo || guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />} Guardar y marcar hecha</button>
                            <button type="button" onClick={() => { setPideArticulo(false); setArticulo(null); }} className={btnCancelar}>cancelar</button>
                        </div>
                    </div>
                </Desplegable>
                <Desplegable abierto={detalle}>
                    <DetalleTarea p={p} t={t} edita={edita} sugerida={sugerida} cambiar={cambiar} onActualizado={onActualizado} />
                </Desplegable>
            </div>
        </div>
    );
};

// Agregar una tarea al final de una etapa (Enter guarda)
export const NuevaTareaEnEtapa = ({ p, etapa, onActualizado }) => {
    const [nombre, setNombre] = useState('');
    const [guardando, setGuardando] = useState(false);
    const ref = useRef(null);
    const agregar = async () => {
        const n = nombre.trim();
        if (!n) return;
        setGuardando(true);
        try { onActualizado(await desarrollosService.nuevaTarea(p.id, etapa.id, n)); setNombre(''); ref.current?.focus(); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo agregar.')); }
        finally { setGuardando(false); }
    };
    return (
        <input ref={ref} className={`${input} mt-2`} value={nombre} maxLength={120} disabled={guardando}
            onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
            placeholder={`+ Agregar una tarea en ${etapa.nombre}`} />
    );
};
