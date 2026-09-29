import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { UNIDADES, fmtDuracion, hoyISO, mensajeError } from './constantes';
import { label, input, btn, btnPri, btnCancelar, MiniModal } from './ui';

// Formularios de la etapa 3 de Servicio Técnico: procedimientos, planes y trabajos puntuales.

// ── Editor de pasos / tareas con tiempo estimado ─────────────────────────────
export const PasosEditor = ({ pasos, setPasos, conDetalle = false, textoAgregar = 'Agregar paso' }) => {
    const total = pasos.reduce((s, p) => s + (parseInt(p.minutos, 10) || 0), 0);
    const cambiar = (i, c) => setPasos(pasos.map((p, j) => (j === i ? { ...p, ...c } : p)));
    const mover = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= pasos.length) return;
        const copia = [...pasos];
        [copia[i], copia[j]] = [copia[j], copia[i]];
        setPasos(copia);
    };
    return (
        <div className="flex flex-col gap-2">
            {pasos.map((p, i) => (
                <div key={i} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-2">
                    <div className="flex items-center gap-1.5">
                        <span className="w-6 text-center text-xs font-black text-zinc-400 shrink-0">{i + 1}</span>
                        <input className={`${input} py-2`} value={p.texto} maxLength={500} placeholder="Qué hay que hacer"
                            onChange={(e) => cambiar(i, { texto: e.target.value })} />
                        <input className={`${input} py-2 w-20 shrink-0`} value={p.minutos} inputMode="numeric" placeholder="min" title="Minutos estimados"
                            onChange={(e) => cambiar(i, { minutos: e.target.value.replace(/\D/g, '') })} />
                        <div className="flex flex-col shrink-0">
                            <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-20"><ArrowUp size={14} /></button>
                            <button type="button" onClick={() => mover(i, 1)} disabled={i === pasos.length - 1} className="text-zinc-400 hover:text-zinc-700 disabled:opacity-20"><ArrowDown size={14} /></button>
                        </div>
                        <button type="button" onClick={() => setPasos(pasos.filter((_, j) => j !== i))} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-50 hover:text-red-600 shrink-0"><Trash2 size={14} /></button>
                    </div>
                    {conDetalle && (
                        <textarea className={`${input} mt-1.5 ml-7 w-[calc(100%-1.75rem)] py-1.5 text-xs min-h-[34px]`} rows={1} value={p.detalle || ''} maxLength={4000}
                            placeholder="Detalle (opcional): herramientas, cuidados, valores…" onChange={(e) => cambiar(i, { detalle: e.target.value })} />
                    )}
                </div>
            ))}
            <div className="flex items-center justify-between">
                <button type="button" onClick={() => setPasos([...pasos, { texto: '', minutos: '', detalle: '' }])}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-dashed border-zinc-200 text-xs font-bold text-zinc-400 hover:border-brand-cyan/40 hover:text-brand-cyan">
                    <Plus size={14} /> {textoAgregar}
                </button>
                <span className="text-xs text-zinc-500">Total estimado: <b>{fmtDuracion(total) || '0 min'}</b></span>
            </div>
        </div>
    );
};

const pasosParaApi = (pasos) => pasos
    .filter(p => String(p.texto || '').trim())
    .map(p => ({ texto: p.texto.trim(), minutos: parseInt(p.minutos, 10) || 0, detalle: (p.detalle || '').trim() || undefined }));

const SelectMaquina = ({ meta, value, onChange, vacio = '— Ninguna —' }) => (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{vacio}</option>
        {Object.entries((meta?.equipos || []).reduce((g, m) => { (g[m.AreaID] = g[m.AreaID] || []).push(m); return g; }, {})).map(([area, lista]) => (
            <optgroup key={area} label={area}>
                {lista.map(m => <option key={m.EquipoID} value={m.EquipoID}>{m.Nombre}</option>)}
            </optgroup>
        ))}
    </select>
);

// ── Procedimiento (crear / editar) ───────────────────────────────────────────
export const ModalProcedimiento = ({ procId = null, meta, onGuardado, onCerrar }) => {
    const [d, setD] = useState({ titulo: '', descripcion: '', areaId: '', equipoId: '' });
    const [pasos, setPasos] = useState([{ texto: '', minutos: '', detalle: '' }]);
    const [cargando, setCargando] = useState(!!procId);
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    useEffect(() => {
        if (!procId) return;
        servicioTecnicoService.procedimiento(procId).then((p) => {
            setD({ titulo: p.Titulo, descripcion: p.Descripcion || '', areaId: p.AreaId || '', equipoId: p.EquipoId ? String(p.EquipoId) : '' });
            setPasos(p.pasos.map(x => ({ texto: x.Texto, minutos: String(x.MinutosEstimados ?? ''), detalle: x.Detalle || '' })));
        }).catch((e) => toast.error(mensajeError(e))).finally(() => setCargando(false));
    }, [procId]);
    const validos = pasosParaApi(pasos);
    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await servicioTecnicoService.guardarProcedimiento(procId, { ...d, titulo: d.titulo.trim(), equipoId: d.equipoId || null, areaId: d.areaId || null, pasos: validos });
            toast.success(procId ? 'Procedimiento guardado' : 'Procedimiento creado');
            onGuardado?.(r);
        } catch (e) { toast.error(mensajeError(e)); } finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={procId ? 'Editar procedimiento' : 'Nuevo procedimiento'} ancho="max-w-2xl" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={cargando || guardando || !d.titulo.trim() || !validos.length} className={btnPri}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
            </button>
        </>}>
            {cargando ? <div className="py-10 text-center text-zinc-400"><Loader2 className="inline animate-spin" /></div> : (
                <>
                    <div><span className={label}>Título</span><input className={input} value={d.titulo} maxLength={200} autoFocus onChange={(e) => set({ titulo: e.target.value })} placeholder="Ej: Limpieza semanal de cabezales i3200" /></div>
                    <div><span className={label}>Descripción <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                        <textarea className={`${input} min-h-[60px]`} value={d.descripcion} onChange={(e) => set({ descripcion: e.target.value })} placeholder="Para qué sirve, cuándo usarlo, materiales…" /></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div><span className={label}>Para el área <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                            <select className={input} value={d.areaId} onChange={(e) => set({ areaId: e.target.value })}>
                                <option value="">— Cualquiera —</option>
                                {(meta?.areas || []).map(a => <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>)}
                            </select></div>
                        <div><span className={label}>Para la máquina <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                            <SelectMaquina meta={meta} value={d.equipoId} onChange={(v) => set({ equipoId: v })} vacio="— Cualquiera —" /></div>
                    </div>
                    <div><span className={label}>Pasos, en orden, con su tiempo estimado</span>
                        <PasosEditor pasos={pasos} setPasos={setPasos} conDetalle /></div>
                    <p className="text-xs text-zinc-400">Los cambios valen para los trabajos que se programen desde ahora; los ya programados conservan sus tareas.</p>
                </>
            )}
        </MiniModal>
    );
};

// ── Plan (crear / editar) ────────────────────────────────────────────────────
export const ModalPlan = ({ plan = null, meta, procedimientos, onGuardado, onCerrar }) => {
    const [d, setD] = useState({
        procId: plan?.ProcId ? String(plan.ProcId) : '', titulo: plan?.Titulo || '', descripcion: plan?.Descripcion || '',
        equipoId: plan?.EquipoId ? String(plan.EquipoId) : '', equipoTexto: plan?.EquipoTexto || '',
        cadaValor: String(plan?.CadaValor || 1), cadaUnidad: plan?.CadaUnidad || 'SEMANA',
        tecnicoId: plan?.TecnicoId ? String(plan.TecnicoId) : '', proximaFecha: plan?.ProximaFecha || hoyISO(),
        paraMaquina: !!plan?.ParaMaquina,
    });
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    const proc = (procedimientos || []).find(p => String(p.ProcId) === d.procId);
    const valido = (d.titulo.trim() || proc) && parseInt(d.cadaValor, 10) >= 1;
    const guardar = async () => {
        setGuardando(true);
        try {
            const datos = { ...d, titulo: d.titulo.trim(), procId: d.procId || null, equipoId: d.equipoId || null, tecnicoId: d.tecnicoId || null, cadaValor: parseInt(d.cadaValor, 10) };
            if (plan) await servicioTecnicoService.editarPlan(plan.PlanId, datos);
            else await servicioTecnicoService.crearPlan(datos);
            toast.success(plan ? 'Plan guardado' : 'Plan creado: ya está en el calendario');
            onGuardado?.();
        } catch (e) { toast.error(mensajeError(e)); } finally { setGuardando(false); }
    };
    const unidad = UNIDADES.find(u => u.value === d.cadaUnidad);
    return (
        <MiniModal titulo={plan ? 'Editar plan de mantenimiento' : 'Nuevo plan de mantenimiento'} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={!valido || guardando} className={btnPri}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar</button>
        </>}>
            <div><span className={label}>Procedimiento</span>
                <select className={input} value={d.procId} onChange={(e) => set({ procId: e.target.value })}>
                    <option value="">— Sin procedimiento —</option>
                    {(procedimientos || []).map(p => <option key={p.ProcId} value={p.ProcId}>{p.Titulo} ({p.Pasos} pasos · {fmtDuracion(p.MinutosTotal) || '0 min'})</option>)}
                </select></div>
            <div><span className={label}>Título</span>
                <input className={input} value={d.titulo} maxLength={200} onChange={(e) => set({ titulo: e.target.value })} placeholder={proc ? proc.Titulo : 'Ej: Revisión de la UPS'} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className={label}>Máquina</span><SelectMaquina meta={meta} value={d.equipoId} onChange={(v) => set({ equipoId: v, paraMaquina: v ? d.paraMaquina : false })} vacio="— Otro equipo o lugar —" /></div>
                {!d.equipoId && <div><span className={label}>Equipo o lugar</span><input className={input} value={d.equipoTexto} maxLength={150} onChange={(e) => set({ equipoTexto: e.target.value })} placeholder="Ej: compresor, aire del taller" /></div>}
            </div>
            {d.equipoId && (
                <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                    <input type="checkbox" checked={d.paraMaquina} onChange={(e) => set({ paraMaquina: e.target.checked })} className="w-4 h-4 accent-brand-cyan" />
                    Hay que parar la máquina (al empezarlo pasa a mantenimiento y no recibe lotes)
                </label>
            )}
            <div className="grid grid-cols-[90px_1fr] gap-2 items-end">
                <div><span className={label}>Cada</span><input className={input} inputMode="numeric" value={d.cadaValor} onChange={(e) => set({ cadaValor: e.target.value.replace(/\D/g, '') })} /></div>
                <select className={input} value={d.cadaUnidad} onChange={(e) => set({ cadaUnidad: e.target.value })}>
                    {UNIDADES.map(u => <option key={u.value} value={u.value}>{parseInt(d.cadaValor, 10) === 1 ? u.singular : u.plural}</option>)}
                </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className={label}>{plan ? 'Próxima vez' : 'Primera vez'}</span><input type="date" className={input} value={d.proximaFecha} min={hoyISO()} onChange={(e) => set({ proximaFecha: e.target.value })} /></div>
                <div><span className={label}>Técnico</span>
                    <select className={input} value={d.tecnicoId} onChange={(e) => set({ tecnicoId: e.target.value })}>
                        <option value="">Sin asignar</option>
                        {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </select></div>
            </div>
            <div><span className={label}>Detalle <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                <textarea className={`${input} min-h-[60px]`} value={d.descripcion} onChange={(e) => set({ descripcion: e.target.value })} /></div>
            <p className="text-xs text-zinc-500">
                Se programa {unidad ? `cada ${parseInt(d.cadaValor, 10) === 1 ? unidad.singular : `${d.cadaValor} ${unidad.plural}`}` : ''}: al terminar uno se agenda el siguiente
                (contando desde el día en que se hizo).
            </p>
        </MiniModal>
    );
};

// ── Trabajo puntual (mantenimiento suelto o tarea) ──────────────────────────
export const ModalNuevoTrabajo = ({ meta, procedimientos, fechaInicial, onGuardado, onCerrar }) => {
    const [d, setD] = useState({
        tipo: 'TAREA', titulo: '', descripcion: '', fecha: fechaInicial || hoyISO(), tecnicoId: meta?.esTecnico && meta?.usuario?.id ? String(meta.usuario.id) : '',
        procId: '', equipoId: '', equipoTexto: '', paraMaquina: false, minutosEstimados: '',
    });
    const [tareas, setTareas] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    const proc = (procedimientos || []).find(p => String(p.ProcId) === d.procId);
    const totalTareas = useMemo(() => tareas.reduce((s, x) => s + (parseInt(x.minutos, 10) || 0), 0), [tareas]);
    const valido = (d.titulo.trim() || proc) && d.fecha;
    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await servicioTecnicoService.crearTrabajo({
                ...d, titulo: d.titulo.trim(), procId: d.procId || null, equipoId: d.equipoId || null, tecnicoId: d.tecnicoId || null,
                tareas: d.procId ? undefined : pasosParaApi(tareas),
                minutosEstimados: d.minutosEstimados === '' ? undefined : parseInt(d.minutosEstimados, 10),
            });
            toast.success('Trabajo programado');
            onGuardado?.(r);
        } catch (e) { toast.error(mensajeError(e)); } finally { setGuardando(false); }
    };
    const pasos = proc ? `${proc.Pasos} pasos · ${fmtDuracion(proc.MinutosTotal) || '0 min'}` : null;
    return (
        <MiniModal titulo="Programar trabajo" ancho="max-w-2xl" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={!valido || guardando} className={btnPri}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Programar</button>
        </>}>
            <div className="grid grid-cols-2 gap-2">
                {[['TAREA', 'Tarea'], ['MANTENIMIENTO', 'Mantenimiento']].map(([k, t]) => (
                    <button key={k} type="button" onClick={() => set({ tipo: k })}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-bold ${d.tipo === k ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 text-zinc-600'}`}>{t}</button>
                ))}
            </div>
            <div><span className={label}>Procedimiento <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                <select className={input} value={d.procId} onChange={(e) => set({ procId: e.target.value })}>
                    <option value="">— Sin procedimiento —</option>
                    {(procedimientos || []).map(p => <option key={p.ProcId} value={p.ProcId}>{p.Titulo}</option>)}
                </select>
                {pasos && <p className="mt-1 text-xs text-zinc-500">Se copian sus {pasos} como tareas.</p>}
            </div>
            <div><span className={label}>Título</span><input className={input} value={d.titulo} maxLength={200} onChange={(e) => set({ titulo: e.target.value })} placeholder={proc ? proc.Titulo : 'Qué hay que hacer'} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><span className={label}>Fecha</span><input type="date" className={input} value={d.fecha} onChange={(e) => set({ fecha: e.target.value })} /></div>
                <div><span className={label}>Técnico</span>
                    <select className={input} value={d.tecnicoId} onChange={(e) => set({ tecnicoId: e.target.value })}>
                        <option value="">Sin asignar</option>
                        {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </select></div>
                <div><span className={label}>Tiempo estimado</span>
                    <input className={input} inputMode="numeric" value={d.minutosEstimados} onChange={(e) => set({ minutosEstimados: e.target.value.replace(/\D/g, '') })}
                        placeholder={proc ? `${proc.MinutosTotal} min` : totalTareas ? `${totalTareas} min` : 'min'} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className={label}>Máquina</span><SelectMaquina meta={meta} value={d.equipoId} onChange={(v) => set({ equipoId: v, paraMaquina: v ? d.paraMaquina : false })} vacio="— Otro equipo o lugar —" /></div>
                {!d.equipoId && <div><span className={label}>Equipo o lugar</span><input className={input} value={d.equipoTexto} maxLength={150} onChange={(e) => set({ equipoTexto: e.target.value })} /></div>}
            </div>
            {d.equipoId && (
                <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                    <input type="checkbox" checked={d.paraMaquina} onChange={(e) => set({ paraMaquina: e.target.checked })} className="w-4 h-4 accent-brand-cyan" />
                    Hay que parar la máquina
                </label>
            )}
            {!d.procId && (
                <div><span className={label}>Tareas <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                    <PasosEditor pasos={tareas} setPasos={setTareas} textoAgregar="Agregar tarea" /></div>
            )}
            <div><span className={label}>Detalle <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                <textarea className={`${input} min-h-[60px]`} value={d.descripcion} onChange={(e) => set({ descripcion: e.target.value })} /></div>
        </MiniModal>
    );
};

export const botonNuevo = `${btn} bg-brand-cyan text-white hover:bg-brand-cyan/90`;
