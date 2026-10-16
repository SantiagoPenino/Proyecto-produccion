import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Plus, ChevronUp, ChevronDown, X } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import { btnPri, btnSec, btnCancelar, input, label } from '../servicio-tecnico/ui';
import { Desplegable, mensajeError } from './comun';

// Plantillas (spec-B §4): flujos guardados (etapas y tareas) que se eligen al aprobar un pedido o al crear
// un proyecto, y la lista de tipos de desarrollo. Las cambia el editor; cambiar una plantilla no toca los
// proyectos que ya existen.

const PARA = { PRODUCTO: 'Proyectos de producto', CORRECCION: 'Correcciones', VARIANTE: 'Variantes' };
// El input base trae w-full: para los campos de ancho fijo de una fila, la misma clase sin el ancho
const inputFila = input.replace('w-full ', '');
let claveLocal = 0;
const k = (pref) => `${pref}${++claveLocal}`;

const borradorDe = (pl, etapasFabrica) => {
    if (!pl) return { id: null, fija: false, nombre: '', para: 'PRODUCTO', tipoId: null, descripcion: '', etapas: etapasFabrica.map(e => ({ k: k('e'), clave: e.clave, nombre: e.nombre, color: e.color })), tareas: [] };
    const etapas = pl.etapas.map(e => ({ k: `e${e.id}`, clave: e.clave, nombre: e.nombre, color: e.color }));
    const orden = new Map(pl.etapas.map((e, i) => [e.id, i]));
    const tareas = [...pl.tareas].sort((a, b) => (orden.get(a.etapaId) - orden.get(b.etapaId)) || (a.orden - b.orden))
        .map(t => ({ k: `t${t.id}`, etapaK: `e${t.etapaId}`, nombre: t.nombre, dias: t.dias, entregable: t.entregable || '', pideRef: !!t.pideRef, marcaErp: !!t.marcaErp }));
    return { id: pl.id, fija: !!pl.fija, nombre: pl.nombre, para: pl.para, tipoId: pl.tipoId, descripcion: pl.descripcion || '', etapas, tareas };
};

const Editor = ({ inicial, catalogos, edita, onGuardado, onVolver, onBorrado }) => {
    const [d, setD] = useState(inicial);
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [seguro, setSeguro] = useState(false);
    const etapasFabrica = catalogos?.etapasFabrica || [];
    const colores = catalogos?.colores || ['#8a94a6'];
    const set = (cambios) => { setD(x => ({ ...x, ...cambios })); setError(''); };
    const setEtapa = (ek, cambios) => set({ etapas: d.etapas.map(e => (e.k === ek ? { ...e, ...cambios } : e)) });
    const setTarea = (tk, cambios) => set({ tareas: d.tareas.map(t => (t.k === tk ? { ...t, ...cambios } : t)) });
    const moverEtapa = (i, dir) => { const e = [...d.etapas]; [e[i], e[i + dir]] = [e[i + dir], e[i]]; set({ etapas: e }); };
    const moverTarea = (tk, dir) => {
        const t = d.tareas.find(x => x.k === tk);
        const mismas = d.tareas.filter(x => x.etapaK === t.etapaK);
        const vecina = mismas[mismas.indexOf(t) + dir];
        if (!vecina) return;
        const l = [...d.tareas];
        const a = l.indexOf(t);
        const b = l.indexOf(vecina);
        [l[a], l[b]] = [l[b], l[a]];
        set({ tareas: l });
    };
    const volverACinco = () => {
        if (d.tareas.some(t => !d.etapas.find(e => e.k === t.etapaK)?.clave)) {
            setError('Antes mové las tareas a etapas que vayas a conservar, o quitá las etapas propias una por una.');
            return;
        }
        const nuevas = etapasFabrica.map(e => ({ k: k('e'), clave: e.clave, nombre: e.nombre, color: e.color }));
        set({ etapas: nuevas, tareas: d.tareas.map(t => ({ ...t, etapaK: nuevas.find(n => n.clave === d.etapas.find(e => e.k === t.etapaK).clave).k })) });
    };
    const guardar = async () => {
        if (!d.nombre.trim()) { setError('Falta el nombre de la plantilla.'); return; }
        setGuardando(true);
        try {
            const tareas = [];
            d.etapas.forEach((e, i) => d.tareas.filter(t => t.etapaK === e.k).forEach(t => tareas.push({ etapa: i, nombre: t.nombre, dias: Number(t.dias) || 0, entregable: t.entregable, pideRef: t.pideRef, marcaErp: t.marcaErp })));
            const pl = await desarrollosService.guardarPlantilla(d.id, { nombre: d.nombre, para: d.para, tipoId: d.tipoId, descripcion: d.descripcion, etapas: d.etapas.map(e => ({ clave: e.clave, nombre: e.nombre, color: e.color })), tareas });
            toast.success('Plantilla guardada.');
            onGuardado(pl);
        } catch (e) { setError(mensajeError(e, 'No se pudo guardar.')); }
        finally { setGuardando(false); }
    };
    const borrar = async () => {
        try { await desarrollosService.borrarPlantilla(d.id); toast.success('Plantilla borrada.'); onBorrado(d.id); }
        catch (e) { setError(mensajeError(e, 'No se pudo borrar.')); }
    };

    return (
        <div className="flex flex-col gap-4 pb-20">
            <button type="button" onClick={onVolver} className="self-start inline-flex items-center gap-1 text-sm font-bold text-zinc-500 hover:text-zinc-800"><ArrowLeft size={15} /> Plantillas</button>
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 grid gap-4 sm:grid-cols-2">
                <div><span className={label}>Nombre</span><input className={input} value={d.nombre} maxLength={60} disabled={!edita} onChange={(e) => set({ nombre: e.target.value })} /></div>
                <div>
                    <span className={label}>Se usa para</span>
                    <Selector value={d.para} onChange={(e) => set({ para: e.target.value })} disabled={!edita || d.fija} aria-label="Se usa para">
                        {Object.entries(PARA).filter(([v]) => v !== 'VARIANTE' || d.para === 'VARIANTE').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Selector>
                    {d.fija && <p className="mt-1 text-xs text-zinc-400">La usa el sistema: se edita, pero no cambia de uso ni se borra.</p>}
                </div>
                <div>
                    <span className={label}>Tipo de desarrollo</span>
                    <Selector value={String(d.tipoId || '')} onChange={(e) => set({ tipoId: Number(e.target.value) || null })} disabled={!edita} aria-label="Tipo de desarrollo">
                        {(catalogos?.tipos || []).map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
                    </Selector>
                </div>
                <div><span className={label}>Descripción</span><input className={input} value={d.descripcion} maxLength={200} disabled={!edita} placeholder="Para qué tipo de producto sirve" onChange={(e) => set({ descripcion: e.target.value })} /></div>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-2">
                <h3 className="text-sm font-black text-zinc-700">Etapas</h3>
                <p className="text-xs text-zinc-500">El recorrido del proyecto, en orden. Podés renombrarlas, reordenarlas, agregar o quitar. Una etapa con tareas no se puede quitar: mové o quitá antes sus tareas.</p>
                {d.etapas.map((e, i) => {
                    const n = d.tareas.filter(t => t.etapaK === e.k).length;
                    return (
                        <div key={e.k} className="flex flex-wrap items-center gap-2">
                            <input type="color" value={e.color} disabled={!edita} onChange={(ev) => setEtapa(e.k, { color: ev.target.value })} className="w-8 h-8 rounded border border-zinc-200 bg-white p-0.5" aria-label="Color" />
                            <input className={`${inputFila} flex-1 min-w-[160px]`} value={e.nombre} maxLength={40} disabled={!edita} onChange={(ev) => setEtapa(e.k, { nombre: ev.target.value })} />
                            <span className="text-xs text-zinc-400 w-16">{n} {n === 1 ? 'tarea' : 'tareas'}</span>
                            {edita && (<>
                                <button type="button" disabled={i === 0} onClick={() => moverEtapa(i, -1)} className="p-1 text-zinc-500 disabled:opacity-30"><ChevronUp size={16} /></button>
                                <button type="button" disabled={i === d.etapas.length - 1} onClick={() => moverEtapa(i, 1)} className="p-1 text-zinc-500 disabled:opacity-30"><ChevronDown size={16} /></button>
                                <button type="button" disabled={n > 0 || d.etapas.length === 1} onClick={() => set({ etapas: d.etapas.filter(x => x.k !== e.k) })} className="p-1 text-zinc-500 hover:text-brand-magenta disabled:opacity-30"><X size={16} /></button>
                            </>)}
                        </div>
                    );
                })}
                {edita && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" onClick={() => set({ etapas: [...d.etapas, { k: k('e'), clave: null, nombre: '', color: colores[d.etapas.length % colores.length] }] })} className={btnSec}><Plus size={15} /> Etapa</button>
                        <button type="button" onClick={volverACinco} className="text-sm font-bold text-brand-cyan hover:underline">Volver a las cinco etapas de siempre</button>
                    </div>
                )}
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-3">
                <h3 className="text-sm font-black text-zinc-700">Tareas de cada etapa</h3>
                <p className="text-xs text-zinc-500">Días = duración estimada en días hábiles. «Pide artículo» = al marcarla hecha pide el artículo del ERP.</p>
                {d.etapas.map(e => (
                    <div key={e.k} className="flex flex-col gap-1.5 pl-3" style={{ borderLeft: `3px solid ${e.color}` }}>
                        <span className="text-xs font-black text-zinc-600">{e.nombre || 'Etapa sin nombre'}</span>
                        {d.tareas.filter(t => t.etapaK === e.k).map(t => (
                            <div key={t.k} className="flex flex-wrap items-center gap-2">
                                <input className={`${inputFila} flex-1 min-w-[200px]`} value={t.nombre} maxLength={120} disabled={!edita} placeholder="Nombre de la tarea" onChange={(ev) => setTarea(t.k, { nombre: ev.target.value })} />
                                <input type="number" min={0} max={120} className={`${inputFila} w-20`} value={t.dias} disabled={!edita} title="Días hábiles" onChange={(ev) => setTarea(t.k, { dias: ev.target.value })} />
                                <input className={`${inputFila} w-44`} value={t.entregable} maxLength={80} disabled={!edita} placeholder="Entregable (opcional)" onChange={(ev) => setTarea(t.k, { entregable: ev.target.value })} />
                                <label className="flex items-center gap-1 text-xs text-zinc-600"><input type="checkbox" className="accent-brand-cyan" checked={t.pideRef} disabled={!edita} onChange={(ev) => setTarea(t.k, { pideRef: ev.target.checked })} /> Pide artículo</label>
                                {edita && (<>
                                    <div className="w-40">
                                        <Selector value={t.etapaK} onChange={(ev) => setTarea(t.k, { etapaK: ev.target.value })} aria-label="Mover a la etapa">
                                            {d.etapas.map(x => <option key={x.k} value={x.k}>{x.nombre || 'Etapa sin nombre'}</option>)}
                                        </Selector>
                                    </div>
                                    <button type="button" onClick={() => moverTarea(t.k, -1)} className="p-1 text-zinc-500"><ChevronUp size={16} /></button>
                                    <button type="button" onClick={() => moverTarea(t.k, 1)} className="p-1 text-zinc-500"><ChevronDown size={16} /></button>
                                    <button type="button" onClick={() => set({ tareas: d.tareas.filter(x => x.k !== t.k) })} className="p-1 text-zinc-500 hover:text-brand-magenta"><X size={16} /></button>
                                </>)}
                            </div>
                        ))}
                        {edita && <button type="button" onClick={() => set({ tareas: [...d.tareas, { k: k('t'), etapaK: e.k, nombre: '', dias: 1, entregable: '', pideRef: false, marcaErp: false }] })}
                            className="self-start text-sm font-bold text-brand-cyan hover:underline">+ Tarea en {e.nombre || 'esta etapa'}</button>}
                    </div>
                ))}
            </section>

            <div className="sticky bottom-0 z-10 -mx-3 md:mx-0 flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-white/95 px-3 py-3 md:rounded-2xl md:border">
                {edita ? (<>
                    <button type="button" onClick={guardar} disabled={guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />} Guardar plantilla</button>
                    <button type="button" onClick={onVolver} className={btnCancelar}>Cancelar</button>
                    {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
                    {d.id && !d.fija && (
                        <button type="button" onClick={() => (seguro ? borrar() : setSeguro(true))} onBlur={() => setSeguro(false)}
                            className={`ml-auto text-sm font-bold ${seguro ? 'text-brand-magenta' : 'text-zinc-400 hover:text-zinc-600'}`}>
                            {seguro ? '¿Borrar esta plantilla? Tocá de nuevo' : 'Borrar plantilla'}
                        </button>
                    )}
                </>) : <span className="text-sm text-zinc-500">Las plantillas las cambia un editor del equipo.</span>}
            </div>
        </div>
    );
};

const TiposDesarrollo = ({ catalogos, edita, onGuardados }) => {
    const [editando, setEditando] = useState(null);
    const [error, setError] = useState('');
    const tipos = catalogos?.tipos || [];
    const guardar = async () => {
        if (editando.some(t => !t.nombre.trim())) { setError('Hay un tipo sin nombre.'); return; }
        try {
            const r = await desarrollosService.guardarTipos(editando.map(t => ({ id: t.id || null, nombre: t.nombre.trim(), esProducto: t.esProducto })));
            toast.success('Tipos de desarrollo guardados.');
            setEditando(null);
            onGuardados(r);
        } catch (e) { setError(mensajeError(e, 'No se pudo guardar.')); }
    };
    return (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-2 max-w-2xl">
            <h3 className="text-sm font-black text-zinc-700">Tipos de desarrollo</h3>
            <p className="text-xs text-zinc-500">Qué clases de desarrollo se manejan. Los marcados como «producto» usan artículo del ERP, familia, variantes y muestras; el resto usa proveedor y costo estimado.</p>
            {/* «Editar la lista»: la lista se pliega y el editor se despliega en su lugar */}
            <Desplegable abierto={!editando} hueco={8}>
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-zinc-700">{tipos.map(t => `${t.nombre}${t.esProducto ? ' (producto)' : ''}`).join(' · ')}</p>
                    {edita && <button type="button" onClick={() => { setEditando(tipos.map(t => ({ ...t }))); setError(''); }} className={`${btnSec} self-start`}>Editar la lista</button>}
                </div>
            </Desplegable>
            <Desplegable abierto={!!editando} hueco={8}>
                {editando && <div className="flex flex-col gap-2">
                {editando.map((t, i) => (
                    <div key={t.id || `n${i}`} className="flex items-center gap-2">
                        <input className={`${input} flex-1`} value={t.nombre} maxLength={60} onChange={(e) => setEditando(l => l.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} />
                        <label className="flex items-center gap-1 text-xs text-zinc-600 whitespace-nowrap">
                            <input type="checkbox" className="accent-brand-cyan" checked={!!t.esProducto} disabled={t.clave === 'producto'} onChange={(e) => setEditando(l => l.map((x, j) => (j === i ? { ...x, esProducto: e.target.checked } : x)))} /> es producto
                        </label>
                        <button type="button" disabled={t.clave === 'producto'} onClick={() => setEditando(l => l.filter((_, j) => j !== i))} className="p-1 text-zinc-500 hover:text-brand-magenta disabled:opacity-30"><X size={16} /></button>
                    </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setEditando(l => [...l, { id: null, nombre: '', esProducto: false }])} className={btnSec}><Plus size={15} /> Tipo</button>
                    <button type="button" onClick={guardar} className={btnPri}>Guardar tipos</button>
                    <button type="button" onClick={() => setEditando(null)} className={btnCancelar}>Cancelar</button>
                    {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
                </div>
                </div>}
            </Desplegable>
        </section>
    );
};

const PlantillasVista = ({ sesion, catalogos, version, onCatalogos }) => {
    const [lista, setLista] = useState(null);
    const [editando, setEditando] = useState(null); // borrador
    const edita = !!sesion?.esEditor;
    const cargar = useCallback(async () => {
        try { setLista(await desarrollosService.plantillas()); }
        catch (e) { setLista([]); toast.error(mensajeError(e, 'No se pudieron cargar las plantillas.')); }
    }, []);
    useEffect(() => { cargar(); }, [cargar, version]);
    const tipos = catalogos?.tipos || [];

    if (editando) {
        return <Editor inicial={editando} catalogos={catalogos} edita={edita} onVolver={() => setEditando(null)}
            onGuardado={() => { setEditando(null); cargar(); onCatalogos?.(); }} onBorrado={() => { setEditando(null); cargar(); onCatalogos?.(); }} />;
    }
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-brand-cyan/10 text-sm font-black text-brand-cyan">{lista?.length ?? ''} plantillas</span>
                <div className="flex-1" />
                {edita && <button type="button" onClick={() => setEditando({ ...borradorDe(null, catalogos?.etapasFabrica || []), tipoId: tipos.find(t => t.clave === 'producto')?.id || null })} className={btnPri}><Plus size={15} /> Nueva plantilla</button>}
            </div>
            <p className="text-sm text-zinc-500">Cada plantilla es un flujo guardado: sus etapas y las tareas de cada etapa. Se elige al aprobar un pedido o al crear un proyecto. Cambiar una plantilla no modifica los proyectos que ya existen.</p>
            {lista === null ? <Loader2 size={20} className="animate-spin text-zinc-300" /> : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {lista.map(pl => {
                        const tipo = tipos.find(t => t.id === pl.tipoId);
                        const propias = pl.etapas.some(e => !e.clave);
                        return (
                            <button key={pl.id} type="button" onClick={() => setEditando(borradorDe(pl, catalogos?.etapasFabrica || []))}
                                className="rounded-2xl border border-zinc-200 bg-white p-4 text-left flex flex-col gap-2 hover:border-brand-cyan/40">
                                <span className="text-sm font-black text-zinc-800">{pl.nombre}</span>
                                <span className="text-xs text-zinc-500">{tipo && !tipo.esProducto && <><b>{tipo.nombre}</b> · </>}{PARA[pl.para]} · {pl.tareas.length} tareas{propias ? ' · etapas propias' : ''}</span>
                                <span className="flex flex-wrap gap-x-3 gap-y-1">
                                    {pl.etapas.map(e => (
                                        <span key={e.id} className="inline-flex items-center gap-1 text-[11px] text-zinc-600">
                                            <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />{e.nombre} {pl.tareas.filter(t => t.etapaId === e.id).length}
                                        </span>
                                    ))}
                                </span>
                                {pl.descripcion && <span className="text-xs text-zinc-500">{pl.descripcion}</span>}
                            </button>
                        );
                    })}
                </div>
            )}
            <TiposDesarrollo catalogos={catalogos} edita={edita} onGuardados={() => onCatalogos?.()} />
        </div>
    );
};

export default PlantillasVista;
