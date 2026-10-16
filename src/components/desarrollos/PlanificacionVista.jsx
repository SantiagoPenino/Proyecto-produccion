import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Plus, Search, X, GripVertical, ChevronUp, ChevronDown, ChevronsUp, CalendarPlus } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import { btnPri, btnSec, btnCancelar, input, label, campoFiltro } from '../servicio-tecnico/ui';
import { Pastilla, Desplegable, fmtD, mensajeError } from './comun';
import { useEquipo } from './tareas';
import {
    ESTADOS_TAREA, pendiente, puntaje, fmtPuntaje, recProyecto, coincide, hoy, dias, diaDe, CRITERIOS,
    estadoTanda, ETIQUETA_TANDA, tandaActual, gcalRango, nombreEtapaActual,
} from './reglas';

// Planificación (spec-C §1): tandas (períodos de 1 a 4 semanas con proyectos, grupos y las tareas
// elegidas) y la lista de desarrollo (todos los proyectos en curso, en orden manual o recomendado).
// Lo que está en una tanda abierta está planificado; el resto, dormido. La cambia el editor.

const HORIZONTES = [[14, '2 semanas'], [28, '1 mes'], [56, '2 meses'], [91, '3 meses'], [0, 'Sin límite']];
const ORDENES = [
    ['manual', 'Orden manual (arrastrando)'], ['rec', 'Recomendado para atender'], ['puntaje', 'Mayor puntaje'], ['nuevos', 'Más nuevos'],
    ['viejos', 'Más viejos'], ['limite', 'Fecha límite más cercana'], ['avance', 'Más avanzados'], ['nombre', 'Nombre'],
];
const TONO_TANDA = { cerrada: 'neutro', proxima: 'recibido', vencida: 'no', en_curso: 'desarrollo' };
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const corto = (iso) => fmtD(iso).slice(0, 5);
const leerArrastre = (e) => { try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch (_) { return null; } };

// Fila de una tarea dentro de la tanda: estado, nombre y etapa, responsable, fecha y sacarla
const FilaTareaTanda = ({ p, t, equipo, bloqueado, onTarea, onSacar }) => {
    const etapa = p.etapas.find(e => e.id === t.etapaId);
    const hecha = t.estado === 'HECHO';
    return (
        <div className="flex flex-wrap items-center gap-2 py-1.5 border-b border-zinc-100 last:border-b-0">
            <div className="w-32"><Selector value={t.estado} onChange={(e) => onTarea(t, { estado: e.target.value })} disabled={bloqueado} aria-label="Estado">
                {ESTADOS_TAREA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Selector></div>
            <span className={`flex-1 min-w-[160px] text-sm ${hecha ? 'line-through text-zinc-400' : 'text-zinc-800'}`}>{t.nombre} <span className="text-xs text-zinc-400">{etapa?.nombre}</span></span>
            <div className="w-40"><Selector value={String(t.responsableId || '')} onChange={(e) => onTarea(t, { responsableId: e.target.value ? Number(e.target.value) : null })} disabled={bloqueado} aria-label="Responsable" anchoLista={240}>
                <option value="">Sin asignar</option>
                {equipo.map(m => <option key={m.usuarioId} value={String(m.usuarioId)}>{m.nombre}</option>)}
                {t.responsable && !equipo.some(m => m.usuarioId === t.responsableId) && <option value={String(t.responsableId || '')} disabled>{t.responsable}</option>}
            </Selector></div>
            <div className="w-36">{hecha ? <span className="text-xs text-zinc-500">hecha {fmtD(diaDe(t.hechoEl) || t.fecha)}</span>
                : <SelectorFecha value={t.fecha || ''} onChange={(e) => onTarea(t, { fecha: e.target.value || null })} disabled={bloqueado} vaciable className="w-full" />}</div>
            {!bloqueado && <button type="button" onClick={() => onSacar(t)} title="Sacar de la tanda" className="p-1 text-zinc-400 hover:text-brand-magenta"><X size={15} /></button>}
        </div>
    );
};

// "Elegir tareas": por etapa, con casillero para toda la etapa y uno por tarea
const ElegirTareas = ({ p, t, tandas, onCambiar, onListo }) => {
    const enEsta = new Set(t.tareas);
    const enOtra = (tareaId) => tandas.find(o => o.id !== t.id && o.estado !== 'CERRADA' && o.tareas.includes(tareaId));
    return (
        <div className="mt-2 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-3 flex flex-col gap-2">
            <p className="text-xs text-zinc-600">Tildá las tareas que entran en «{t.nombre}». El casillero de cada etapa suma o saca todas sus tareas pendientes.</p>
            {p.etapas.map(e => {
                const ts = p.tareas.filter(x => x.etapaId === e.id && x.estado !== 'NO_APLICA');
                if (!ts.length) return null;
                const pend = ts.filter(pendiente);
                const enTanda = pend.filter(x => enEsta.has(x.id));
                const todas = pend.length > 0 && enTanda.length === pend.length;
                return (
                    <div key={e.id} className="pl-2" style={{ borderLeft: `3px solid ${e.color}` }}>
                        <label className={`flex items-center gap-2 text-sm ${pend.length ? 'text-zinc-700' : 'text-zinc-400'}`}>
                            <input type="checkbox" className="accent-brand-cyan" checked={todas} disabled={!pend.length}
                                onChange={() => onCambiar(todas ? { quitar: pend.map(x => x.id), accion: 'Sacó una etapa' } : { agregar: pend.map(x => x.id), accion: 'Sumó una etapa' })} />
                            <b>{e.nombre}</b> <span className="text-xs text-zinc-500">{enTanda.length}/{pend.length} pendientes en la tanda{e.id === p.etapaActual ? ' · etapa actual' : ''}</span>
                        </label>
                        {ts.map(x => {
                            const otra = enOtra(x.id);
                            return (
                                <label key={x.id} className={`ml-5 flex items-center gap-2 text-sm ${x.estado === 'HECHO' ? 'text-zinc-400' : 'text-zinc-700'}`}>
                                    <input type="checkbox" className="accent-brand-cyan" checked={enEsta.has(x.id)} disabled={x.estado === 'HECHO'}
                                        onChange={(ev) => onCambiar(ev.target.checked ? { agregar: [x.id], accion: 'Sumó una tarea' } : { quitar: [x.id], accion: 'Sacó una tarea' })} />
                                    {x.nombre}
                                    {x.estado === 'HECHO' && <span className="text-xs">hecha</span>}
                                    {otra && x.estado !== 'HECHO' && <span className="text-xs text-amber-700">está en {otra.nombre} (tildala para traerla)</span>}
                                </label>
                            );
                        })}
                    </div>
                );
            })}
            <button type="button" onClick={onListo} className={`${btnSec} self-start`}>Listo</button>
        </div>
    );
};

const PlanificacionVista = ({ sesion, catalogos, version }) => {
    const navigate = useNavigate();
    const equipo = useEquipo();
    const [proyectos, setProyectos] = useState(null);
    const [datos, setDatos] = useState(null); // { tandas, plan, orden }
    const [sel, setSel] = useState(null);
    const [verCerradas, setVerCerradas] = useState(false);
    const [pick, setPick] = useState(null);
    const [resp, setResp] = useState('');
    const [modo, setModo] = useState('');
    const [q, setQ] = useState('');
    const [des, setDes] = useState('');
    const [puntajeDe, setPuntajeDe] = useState(null);
    const [cerrando, setCerrando] = useState(false);
    const [seguroBorrar, setSeguroBorrar] = useState(false);
    const [sobre, setSobre] = useState(null); // destino del arrastre: { tipo, id, lado }
    const edita = !!sesion?.esEditor;
    const tipos = catalogos?.tipos || [];

    const cargarProyectos = useCallback(() => desarrollosService.proyectos().then(setProyectos).catch(e => { setProyectos([]); toast.error(mensajeError(e, 'No se pudieron cargar los proyectos.')); }), []);
    const cargarPlan = useCallback(() => desarrollosService.planificacion().then(setDatos).catch(e => toast.error(mensajeError(e, 'No se pudo cargar la planificación.'))), []);
    useEffect(() => { cargarProyectos(); cargarPlan(); }, [cargarProyectos, cargarPlan, version]);

    const hacer = async (fn, ok) => {
        try {
            const r = await fn();
            if (r?.data?.tandas) setDatos(r.data);
            if (r?.mensaje) toast.success(r.mensaje);
            else if (ok) toast.success(ok);
            cargarProyectos();
            return r;
        } catch (e) { toast.error(mensajeError(e)); return null; }
    };
    const cambiarTarea = async (t, cambios) => {
        try {
            const r = await desarrollosService.tarea(t.id, cambios);
            if (r.aviso) toast.warning(r.aviso);
            setProyectos(l => l.map(x => (x.id === r.data.id ? { ...x, ...r.data } : x)));
        } catch (e) { toast.error(mensajeError(e)); }
    };

    const tandas = datos?.tandas || [];
    const abiertas = useMemo(() => tandas.filter(t => t.estado !== 'CERRADA').sort((a, b) => a.inicio.localeCompare(b.inicio)), [tandas]);
    const cerradas = tandas.filter(t => t.estado === 'CERRADA');
    const actual = tandaActual(tandas);
    const tanda = tandas.find(t => t.id === sel && (t.estado !== 'CERRADA' || verCerradas)) || actual;
    const bloqueada = !edita || !tanda || tanda.estado === 'CERRADA';
    const porId = useMemo(() => new Map((proyectos || []).map(p => [p.id, p])), [proyectos]);
    const tareaPorId = useMemo(() => { const m = new Map(); for (const p of proyectos || []) for (const t of p.tareas || []) m.set(t.id, { p, t }); return m; }, [proyectos]);
    const tandasDe = (pid) => abiertas.filter(t => t.proyectos.some(x => x.proyectoId === pid));

    if (!datos || !proyectos) return <Loader2 size={20} className="animate-spin text-zinc-300" />;

    // ── Lista de desarrollo ──
    const universo = proyectos.filter(p => p.estado !== 'CANCELADO' && p.etapaActual !== 'TERMINADO');
    const responsables = [...new Set(universo.flatMap(p => [p.lider, ...(p.tareas || []).map(t => t.responsable)]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const modoActual = modo || (datos.orden.ids.length ? 'manual' : 'rec');
    const posManual = new Map(datos.orden.ids.map((id, i) => [id, i]));
    const filtrados = universo.filter(p => (!des || p.tipoId === Number(des))
        && (!resp || p.lider === resp || (p.tareas || []).some(t => pendiente(t) && t.responsable === resp))
        && coincide(q, p.nombre, p.codigo, p.articuloCodigo, p.refErpTexto, p.lider, p.familia));
    const creadoMs = (p) => new Date(p.creado || 0).getTime();
    const ordenados = [...filtrados].sort((a, b) => {
        if (modoActual === 'manual') {
            const pa = posManual.has(a.id) ? posManual.get(a.id) : Infinity;
            const pb = posManual.has(b.id) ? posManual.get(b.id) : Infinity;
            return pa - pb || puntaje(b) - puntaje(a);
        }
        if (modoActual === 'rec') return recProyecto(b) - recProyecto(a);
        if (modoActual === 'puntaje') return puntaje(b) - puntaje(a);
        if (modoActual === 'nuevos') return creadoMs(b) - creadoMs(a);
        if (modoActual === 'viejos') return creadoMs(a) - creadoMs(b);
        if (modoActual === 'limite') return (a.fechaLimite || '9999').localeCompare(b.fechaLimite || '9999');
        if (modoActual === 'avance') return b.avance.pct - a.avance.pct;
        return String(a.nombre).localeCompare(String(b.nombre), 'es');
    });
    const visiblesIds = ordenados.map(p => p.id);
    // Guarda el orden de lo visible, y detrás lo que ya estaba ordenado y no se ve (por los filtros)
    const guardarOrden = (idsVisibles) => hacer(() => desarrollosService.guardarOrden([...idsVisibles, ...datos.orden.ids.filter(id => !idsVisibles.includes(id))]));
    const mover = (i, dir) => { const l = [...visiblesIds]; [l[i], l[i + dir]] = [l[i + dir], l[i]]; guardarOrden(l); };
    const alPrincipio = (i) => { const l = [...visiblesIds]; const [x] = l.splice(i, 1); guardarOrden([x, ...l]); };

    // ── Arrastrar ──
    const alSoltar = async (e, destino) => {
        e.preventDefault();
        setSobre(null);
        const a = leerArrastre(e);
        if (!a || !edita) return;
        if (destino.tipo === 'fila' && a.tipo === 'lista' && a.pid !== destino.id) {
            const l = visiblesIds.filter(id => id !== a.pid);
            const i = l.indexOf(destino.id) + (destino.lado === 'despues' ? 1 : 0);
            l.splice(i, 0, a.pid);
            setModo('manual');
            guardarOrden(l);
            return;
        }
        if (!tanda || bloqueada) return;
        const vinculado = tanda.proyectos.some(x => x.proyectoId === a.pid);
        if (destino.tipo === 'grupo') {
            if (!vinculado) { await hacer(() => desarrollosService.vincular(tanda.id, a.pid, destino.id)); setPick(a.pid); }
            else hacer(() => desarrollosService.moverAGrupo(tanda.id, a.pid, destino.id));
        } else if (destino.tipo === 'tanda' && a.tipo === 'lista' && !vinculado) {
            await hacer(() => desarrollosService.vincular(tanda.id, a.pid));
            setPick(a.pid);
        }
    };
    const zonaDrop = (destino) => (bloqueada ? {} : {
        onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setSobre(destino); },
        onDragLeave: () => setSobre(s => (s && s.tipo === destino.tipo && s.id === destino.id ? null : s)),
        onDrop: (e) => { e.stopPropagation(); alSoltar(e, destino); },
    });

    // ── Panel de la tanda ──
    const panelTanda = () => {
        const t = tanda;
        const est = estadoTanda(t);
        const refs = t.tareas.map(id => tareaPorId.get(id)).filter(Boolean);
        const hechas = refs.filter(x => !pendiente(x.t)).length;
        const carga = {};
        for (const x of refs.filter(r => pendiente(r.t))) { const k = x.t.responsable || 'Sin responsable'; carga[k] = (carga[k] || 0) + 1; }
        const ps = t.proyectos.map(x => porId.get(x.proyectoId)).filter(Boolean).sort((a, b) => recProyecto(b) - recProyecto(a));
        const grupoDe = new Map(t.proyectos.map(x => [x.proyectoId, x.grupoId]));
        const detalleCal = [t.objetivo, ...ps.map(p => {
            const ts = refs.filter(r => r.p.id === p.id && pendiente(r.t) && (!resp || r.t.responsable === resp)).map(r => r.t.nombre);
            return ts.length ? `· ${p.nombre}: ${ts.join(', ')}` : null;
        })].filter(Boolean).join('\n');
        const bloque = (p) => {
            const ts = refs.filter(r => r.p.id === p.id).map(r => r.t).filter(x => !resp || x.responsable === resp);
            const deEsta = refs.filter(r => r.p.id === p.id);
            const otras = tandasDe(p.id).filter(o => o.id !== t.id);
            return (
                <div key={p.id} draggable={!bloqueada} onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'tanda', pid: p.id }))}
                    className="rounded-xl border border-zinc-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {!bloqueada && <GripVertical size={15} className="text-zinc-300 cursor-grab" />}
                        <button type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${p.id}`)} className="text-sm font-bold text-zinc-800 hover:text-brand-cyan">{p.nombre}</button>
                        <span className="flex-1 text-xs text-zinc-400">
                            {p.lider || 'sin responsable'} · {deEsta.length ? `${deEsta.filter(r => !pendiente(r.t)).length}/${deEsta.length} tareas hechas` : 'sin tareas elegidas'}
                            {otras.length > 0 && ` · también en ${otras.map(o => o.nombre).join(', ')}`}
                        </span>
                        {!bloqueada && (<>
                            <button type="button" onClick={() => setPick(x => (x === p.id ? null : p.id))} className="text-xs font-bold text-brand-cyan hover:underline">{pick === p.id ? 'Listo' : 'Elegir tareas'}</button>
                            {t.grupos.length > 0 && (
                                <div className="w-36"><Selector value={String(grupoDe.get(p.id) || '')} onChange={(e) => hacer(() => desarrollosService.moverAGrupo(t.id, p.id, e.target.value ? Number(e.target.value) : null))} aria-label="Grupo">
                                    <option value="">Sin grupo</option>
                                    {t.grupos.map(g => <option key={g.id} value={String(g.id)}>{g.nombre}</option>)}
                                </Selector></div>
                            )}
                            <button type="button" onClick={() => hacer(() => desarrollosService.desvincular(t.id, p.id))} className="text-xs text-zinc-400 hover:text-brand-magenta">desvincular</button>
                        </>)}
                    </div>
                    {/* «Elegir tareas»: la lista se pliega y el selector por etapa se despliega en su lugar */}
                    <Desplegable abierto={pick === p.id && !bloqueada}>
                        <ElegirTareas p={p} t={t} tandas={tandas} onListo={() => setPick(null)} onCambiar={(c) => hacer(() => desarrollosService.tareasTanda(t.id, c))} />
                    </Desplegable>
                    <Desplegable abierto={!(pick === p.id && !bloqueada)}>
                        {ts.length ? <div className="mt-1">{ts.map(x => <FilaTareaTanda key={x.id} p={p} t={x} equipo={equipo} bloqueado={bloqueada} onTarea={cambiarTarea}
                            onSacar={(tt) => hacer(() => desarrollosService.tareasTanda(t.id, { quitar: [tt.id], accion: 'Sacó una tarea' }))} />)}</div>
                        : <p className="mt-1 text-xs text-zinc-400">Todavía no hay tareas de este proyecto en la tanda. Tocá «Elegir tareas».</p>}
                    </Desplegable>
                </div>
            );
        };
        const grupoCaja = (g) => {
            const del = ps.filter(p => (grupoDe.get(p.id) || null) === (g?.id || null));
            const deGrupo = refs.filter(r => del.some(p => p.id === r.p.id));
            const destino = { tipo: 'grupo', id: g?.id || null };
            const encima = sobre?.tipo === 'grupo' && sobre.id === destino.id;
            return (
                <div key={g?.id || 'sin'} {...zonaDrop(destino)} className={`rounded-2xl border-2 border-dashed p-3 flex flex-col gap-2 ${encima ? 'border-brand-cyan bg-brand-cyan/5' : 'border-zinc-200'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                        {g ? <input className={`${input} !w-auto flex-1 min-w-[160px] font-bold`} defaultValue={g.nombre} key={`${g.id}-${g.nombre}`} maxLength={60} disabled={bloqueada}
                            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.nombre) hacer(() => desarrollosService.renombrarGrupo(t.id, g.id, v)); else e.target.value = g.nombre; }} />
                            : <span className="text-sm font-bold text-zinc-500">Sin grupo</span>}
                        <span className="text-xs text-zinc-400">{del.length} {del.length === 1 ? 'proyecto' : 'proyectos'}{deGrupo.length ? ` · ${deGrupo.filter(r => !pendiente(r.t)).length}/${deGrupo.length} tareas hechas` : ''}</span>
                        {g && !bloqueada && <button type="button" onClick={() => hacer(() => desarrollosService.borrarGrupo(t.id, g.id))} className="text-xs text-zinc-400 hover:text-brand-magenta">deshacer el grupo</button>}
                    </div>
                    {del.map(bloque)}
                    {g && !del.length && <p className="text-xs text-zinc-400">Arrastrá proyectos acá, o elegí este grupo en el selector de cada proyecto.</p>}
                </div>
            );
        };
        const encimaTanda = sobre?.tipo === 'tanda';
        return (
            <section {...zonaDrop({ tipo: 'tanda', id: t.id })} className={`rounded-2xl border bg-zinc-50 p-4 flex flex-col gap-3 ${encimaTanda ? 'border-brand-cyan ring-2 ring-brand-cyan/20' : 'border-zinc-200'}`}>
                <div className="flex flex-wrap items-center gap-2">
                    <input className="flex-1 min-w-[180px] bg-transparent text-lg font-black text-zinc-800 outline-none border-b border-transparent focus:border-brand-cyan disabled:cursor-default"
                        defaultValue={t.nombre} key={`${t.id}-${t.nombre}`} maxLength={60} disabled={bloqueada}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.nombre) hacer(() => desarrollosService.editarTanda(t.id, { nombre: v })); else e.target.value = t.nombre; }} />
                    <Pastilla tono={TONO_TANDA[est]}>
                        {ETIQUETA_TANDA[est]}{est === 'en_curso' ? ` · quedan ${dias(hoy(), t.fin)} ${dias(hoy(), t.fin) === 1 ? 'día' : 'días'}` : est === 'proxima' ? ` · empieza el ${fmtD(t.inicio)}` : ''}
                    </Pastilla>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <div className="w-40"><span className={label}>Desde</span><SelectorFecha value={t.inicio} disabled={bloqueada} className="w-full" onChange={(e) => e.target.value && e.target.value !== t.inicio && hacer(() => desarrollosService.editarTanda(t.id, { inicio: e.target.value }))} /></div>
                    <div className="w-40"><span className={label}>Hasta</span><SelectorFecha value={t.fin} disabled={bloqueada} className="w-full" onChange={(e) => e.target.value !== t.fin && hacer(() => desarrollosService.editarTanda(t.id, { fin: e.target.value }))} /></div>
                    {!bloqueada && [1, 2, 3, 4].map(n => (
                        <button key={n} type="button" onClick={() => hacer(() => desarrollosService.editarTanda(t.id, { fin: sumarDias(t.inicio, n * 7 - 3) }))} className="px-2 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-600 hover:border-brand-cyan/50">{n} sem.</button>
                    ))}
                    <a href={gcalRango(t.nombre, t.inicio, t.fin, detalleCal)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 pb-2 text-sm font-bold text-brand-cyan hover:underline"><CalendarPlus size={14} /> Google Calendar</a>
                </div>
                <div><span className={label}>Objetivo</span>
                    <input className={input} defaultValue={t.objetivo || ''} key={`${t.id}-obj-${t.objetivo}`} maxLength={200} disabled={bloqueada} placeholder="Ej.: muestras aprobadas de camiseta y short"
                        onBlur={(e) => { if (e.target.value.trim() !== (t.objetivo || '')) hacer(() => desarrollosService.editarTanda(t.id, { objetivo: e.target.value.trim() })); }} />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600">
                    <span><b>{t.proyectos.length}</b> proyectos · <b>{hechas}/{refs.length}</b> tareas hechas</span>
                    <div className="flex-1 min-w-[120px] h-1.5 rounded-full bg-zinc-200 overflow-hidden"><div className="h-full bg-brand-cyan" style={{ width: `${refs.length ? Math.round(hechas * 100 / refs.length) : 0}%` }} /></div>
                </div>
                {Object.keys(carga).length > 0 && (
                    <p className="text-xs text-zinc-500">Carga pendiente: {Object.entries(carga).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k} className="mr-2"><b className="text-zinc-700">{k}</b> {n} {n === 1 ? 'tarea' : 'tareas'}</span>)}</p>
                )}
                {t.estado === 'CERRADA' && t.resumen && <p className="text-sm text-zinc-600">Cerrada: {t.resumen}.</p>}
                {!ps.length ? <p className="text-sm text-zinc-500">Vinculá proyectos desde la lista de desarrollo, abajo («+ {t.nombre}» o arrastrándolos hasta acá).</p>
                    : t.grupos.length ? <div className="flex flex-col gap-2">{t.grupos.map(grupoCaja)}{grupoCaja(null)}</div>
                    : <div className="flex flex-col gap-2">{ps.map(bloque)}</div>}
                {!bloqueada && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button type="button" onClick={() => hacer(() => desarrollosService.crearGrupo(t.id))} className={btnSec}><Plus size={15} /> Grupo de proyectos</button>
                        <button type="button" onClick={() => navigate(`/desarrollos/tareas?tanda=${t.id}`)} className="text-sm font-bold text-brand-cyan hover:underline">Ver las tareas de la tanda por estado</button>
                        <div className="flex-1" />
                        <button type="button" onClick={() => setCerrando(true)} className={btnSec}>Cerrar la tanda</button>
                        <button type="button" onClick={async () => { if (!seguroBorrar) { setSeguroBorrar(true); return; } await hacer(() => desarrollosService.borrarTanda(t.id), 'Tanda borrada.'); setSel(null); setSeguroBorrar(false); }}
                            onBlur={() => setSeguroBorrar(false)} className="text-sm font-bold text-brand-magenta/80 hover:text-brand-magenta">{seguroBorrar ? '¿Borrar la tanda? Tocá de nuevo' : 'borrar la tanda'}</button>
                    </div>
                )}
                <Desplegable abierto={cerrando && !bloqueada} hueco={12}>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                        <span className="text-sm text-amber-800">Cerrar «{t.nombre}»:</span>
                        <button type="button" className={btnPri} onClick={async () => { const r = await hacer(() => desarrollosService.cerrarTanda(t.id, true)); if (r) { toast.success(`«${t.nombre}» cerrada: ${r.resumen}.`); setSel(r.destino || null); } setCerrando(false); }}>Cerrar y pasar lo pendiente a la próxima tanda</button>
                        <button type="button" className={btnSec} onClick={async () => { const r = await hacer(() => desarrollosService.cerrarTanda(t.id, false)); if (r) { toast.success(`«${t.nombre}» cerrada: ${r.resumen}.`); setSel(null); } setCerrando(false); }}>Cerrar y dejar lo pendiente sin planificar</button>
                        <button type="button" className={btnCancelar} onClick={() => setCerrando(false)}>cancelar</button>
                    </div>
                </Desplegable>
            </section>
        );
    };

    const plan = datos.plan;
    return (
        <div className="flex flex-col gap-5">
            <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                Planificamos hasta
                {edita ? <span className="w-32 inline-block"><Selector value={String(plan.horizonte)} onChange={(e) => hacer(() => desarrollosService.guardarPlan({ horizonte: Number(e.target.value) }))} aria-label="Horizonte">
                    {HORIZONTES.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}</Selector></span>
                    : <b>{HORIZONTES.find(h => h[0] === plan.horizonte)?.[1] || `${plan.horizonte} días`}</b>}
                adelante, en tandas de
                {edita ? <span className="w-32 inline-block"><Selector value={String(plan.tanda)} onChange={(e) => hacer(() => desarrollosService.guardarPlan({ tanda: Number(e.target.value) }))} aria-label="Largo de tanda">
                    {[1, 2, 3, 4].map(n => <option key={n} value={String(n)}>{n === 1 ? '1 semana' : `${n} semanas`}</option>)}</Selector></span>
                    : <b>{plan.tanda === 1 ? '1 semana' : `${plan.tanda} semanas`}</b>}
            </p>

            {/* Tandas */}
            <div className="flex flex-wrap items-center gap-2">
                {abiertas.map(t => (
                    <button key={t.id} type="button" onClick={() => { setSel(t.id); setPick(null); setCerrando(false); }}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${tanda?.id === t.id ? 'border-brand-cyan bg-white shadow-sm' : 'border-zinc-200 bg-white/60 hover:border-zinc-300'}`}>
                        <b className="text-zinc-800">{t.nombre}</b><span className="text-xs text-zinc-500">{corto(t.inicio)}–{corto(t.fin)}</span>
                        <Pastilla tono={TONO_TANDA[estadoTanda(t)]}>{ETIQUETA_TANDA[estadoTanda(t)]}</Pastilla>
                    </button>
                ))}
                {edita && (
                    <button type="button" onClick={async () => { const r = await hacer(() => desarrollosService.crearTanda()); if (r?.tandaId) setSel(r.tandaId); }} className={btnSec}>
                        <Plus size={15} /> Nueva tanda ({plan.tanda} {plan.tanda === 1 ? 'semana' : 'semanas'})
                    </button>
                )}
                {cerradas.length > 0 && <button type="button" onClick={() => setVerCerradas(v => !v)} className="text-xs font-bold text-zinc-500 hover:text-zinc-800">{verCerradas ? 'Ocultar cerradas' : `Ver cerradas (${cerradas.length})`}</button>}
            </div>
            <Desplegable abierto={verCerradas && cerradas.length > 0} hueco={20}>
                <div className="flex flex-wrap gap-1.5">
                    {cerradas.map(t => (
                        <button key={t.id} type="button" onClick={() => setSel(t.id)} className={`px-2.5 py-1 rounded-full border text-xs ${tanda?.id === t.id ? 'border-zinc-700 bg-zinc-700 text-white' : 'border-zinc-200 bg-white text-zinc-600'}`}>
                            {t.nombre} · {corto(t.inicio)}–{corto(t.fin)}{t.resumen ? ` · ${t.resumen}` : ''}
                        </button>
                    ))}
                </div>
            </Desplegable>
            {tanda ? panelTanda() : (
                <div className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <p className="font-bold text-zinc-800">Todavía no hay tandas</p>
                    <p className="text-sm text-zinc-500">Una tanda es un período de trabajo. Se le vinculan proyectos y, de cada uno, las tareas que se van a hacer en ese período. Lo que no está en una tanda queda sin planificar.</p>
                </div>
            )}

            {/* Lista de desarrollo */}
            <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-black text-zinc-800">Lista de desarrollo <span className="text-zinc-400 font-bold">{ordenados.length}</span></h3>
                    <Selector filtro resaltar={false} value={modoActual} onChange={(e) => setModo(e.target.value)} aria-label="Ordenar" anchoLista={260}>
                        {ORDENES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Selector>
                    {edita && modoActual !== 'manual' && <button type="button" onClick={() => { setModo('manual'); hacer(() => desarrollosService.guardarOrden(visiblesIds)); }} className="text-xs font-bold text-brand-cyan hover:underline">Usar este orden como manual</button>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input type="search" className={`${campoFiltro} w-full pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la lista" />
                    </div>
                    <Selector filtro value={des} onChange={(e) => setDes(e.target.value)} aria-label="Desarrollo" renderValor={o => `Desarrollo: ${o?.texto || 'Todos'}`}>
                        <option value="">Todos</option>
                        {tipos.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
                    </Selector>
                    <Selector filtro value={resp} onChange={(e) => setResp(e.target.value)} aria-label="Responsable" anchoLista={240} renderValor={o => `Responsable: ${o?.texto || 'Todos'}`}>
                        <option value="">Todos</option>
                        {responsables.map(r => <option key={r} value={r}>{r}</option>)}
                    </Selector>
                </div>
                <p className="text-xs text-zinc-400">
                    {modoActual === 'manual' ? 'El orden lo decidís vos: arrastrá las filas o usá ↑ ↓. Lo que no se ordenó va al final, por puntaje.' : 'Si arrastrás una fila, la lista pasa a orden manual.'} Los proyectos con borde celeste ya están en una tanda.
                </p>
                {!ordenados.length ? <p className="text-sm text-zinc-400">No hay proyectos en curso que coincidan.</p> : (
                    <div className="rounded-2xl border border-zinc-200 bg-white">
                        {ordenados.map((p, i) => {
                            const enTandas = tandasDe(p.id);
                            const vinculado = tanda && tanda.estado !== 'CERRADA' && tanda.proyectos.some(x => x.proyectoId === p.id);
                            const marca = sobre?.tipo === 'fila' && sobre.id === p.id ? sobre.lado : null;
                            return (
                                <div key={p.id} draggable={edita} onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'lista', pid: p.id }))}
                                    onDragOver={edita ? (e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setSobre({ tipo: 'fila', id: p.id, lado: e.clientY < r.top + r.height / 2 ? 'antes' : 'despues' }); } : undefined}
                                    onDrop={edita ? (e) => alSoltar(e, sobre?.tipo === 'fila' ? sobre : { tipo: 'fila', id: p.id, lado: 'antes' }) : undefined}
                                    className={`border-b border-zinc-100 last:border-b-0 ${enTandas.length ? 'border-l-4 border-l-brand-cyan' : 'border-l-4 border-l-transparent'} ${marca === 'antes' ? 'shadow-[inset_0_2px_0_0_#006E97]' : marca === 'despues' ? 'shadow-[inset_0_-2px_0_0_#006E97]' : ''}`}>
                                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                                        {edita && <GripVertical size={15} className="text-zinc-300 cursor-grab" />}
                                        <span className="w-6 text-right text-xs font-bold text-zinc-400">{i + 1}</span>
                                        <div className="flex-1 min-w-[180px]">
                                            <button type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${p.id}`)} className="text-sm font-bold text-zinc-800 hover:text-brand-cyan text-left">{p.nombre}</button>
                                            <span className="block text-xs text-zinc-400">{nombreEtapaActual(p)} · {p.lider || 'sin responsable'}
                                                {enTandas.map(t => <span key={t.id} className="ml-1.5 px-1.5 rounded bg-brand-cyan/10 text-[11px] font-bold text-brand-cyan">{t.nombre} · {t.tareas.filter(id => tareaPorId.get(id)?.p.id === p.id).length} tareas</span>)}
                                            </span>
                                        </div>
                                        <button type="button" onClick={() => setPuntajeDe(x => (x === p.id ? null : p.id))} title="Puntaje" className="min-w-[2.5rem] px-2 py-0.5 rounded-lg bg-zinc-100 text-sm font-black text-zinc-700 hover:bg-zinc-200">{fmtPuntaje(puntaje(p))}</button>
                                        {edita && modoActual === 'manual' && (<>
                                            <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} className="p-1 text-zinc-500 disabled:opacity-30"><ChevronUp size={16} /></button>
                                            <button type="button" disabled={i === ordenados.length - 1} onClick={() => mover(i, 1)} className="p-1 text-zinc-500 disabled:opacity-30"><ChevronDown size={16} /></button>
                                            <button type="button" disabled={i === 0} onClick={() => alPrincipio(i)} title="Arriba de todo" className="p-1 text-zinc-500 disabled:opacity-30"><ChevronsUp size={16} /></button>
                                        </>)}
                                        {edita && tanda && tanda.estado !== 'CERRADA' && (vinculado
                                            ? <button type="button" onClick={() => { setPick(p.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-xs font-bold text-brand-cyan hover:underline">Tareas en {tanda.nombre}</button>
                                            : <button type="button" onClick={async () => { await hacer(() => desarrollosService.vincular(tanda.id, p.id)); setPick(p.id); }} className={`${btnPri} !py-1 !text-xs`}>+ {tanda.nombre}</button>)}
                                    </div>
                                    <Desplegable abierto={puntajeDe === p.id}>
                                        <div className="px-4 pb-3 flex flex-col gap-2">
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                {CRITERIOS.map(([k, etiqueta, bajo, alto]) => (
                                                    <div key={k}><span className="block mb-1 text-[11px] font-bold text-zinc-500">{etiqueta}</span>
                                                        <Selector value={String(p[k] || 3)} disabled={!edita} aria-label={etiqueta}
                                                            onChange={async (e) => { try { const np = await desarrollosService.guardarProyecto(p.id, { [k]: Number(e.target.value) }); setProyectos(l => l.map(x => (x.id === np.id ? np : x))); } catch (err) { toast.error(mensajeError(err)); } }}>
                                                            {[1, 2, 3, 4, 5].map(n => <option key={n} value={String(n)}>{n === 1 ? `1 · ${bajo}` : n === 5 ? `5 · ${alto}` : String(n)}</option>)}
                                                        </Selector>
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="text-xs text-zinc-500">Puntaje {fmtPuntaje(puntaje(p))} = (3 × estratégico + 2 × comercial) ÷ (complejidad + recursos), más un extra si tiene fecha límite cerca. <button type="button" onClick={() => setPuntajeDe(null)} className="font-bold text-brand-cyan hover:underline">listo</button></p>
                                        </div>
                                    </Desplegable>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};

export default PlanificacionVista;
