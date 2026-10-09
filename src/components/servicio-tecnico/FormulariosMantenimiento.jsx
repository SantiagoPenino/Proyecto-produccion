import { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, Save, ImagePlus, X } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { comprimirImagen } from '../../utils/comprimirImagen';
import BuscadorVariante from '../stock/BuscadorVariante';
import { UNIDADES, HORAS_FRANJA, DIAS_SEMANA, fmtDuracion, fmtDia, hoyISO, sumarDias, mensajeError } from './constantes';
import { label, input, btn, btnPri, btnCancelar, MiniModal, Adjunto } from './ui';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

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
                        <input className={`${input} py-2 flex-1 min-w-0`} value={p.texto} maxLength={500} placeholder="Qué hay que hacer"
                            onChange={(e) => cambiar(i, { texto: e.target.value })} />
                        {/* `input` trae w-full (le ganaba al w-20): el ancho lo da el contenedor. */}
                        <div className="w-16 sm:w-20 shrink-0">
                            <input className={`${input} py-2 px-2 text-center`} value={p.minutos} inputMode="numeric" placeholder="min" title="Minutos estimados"
                                onChange={(e) => cambiar(i, { minutos: e.target.value.replace(/\D/g, '') })} />
                        </div>
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

// ── Insumos necesarios de un procedimiento (30/09) ───────────────────────────
// Del stock (buscador) o escritos a mano si no están en el stock, por ejemplo algo que se compra en la
// ferretería para un arreglo puntual. Cantidad, unidad y foto opcionales; la foto se sube al guardar.
const nombreDelStock = (v) => `${v.Producto}${v.NombreVariante && v.NombreVariante !== v.Producto ? ` · ${v.NombreVariante}` : ''}`;
const cantidadInvalida = (c) => String(c ?? '').trim() !== '' && !(Number(String(c).replace(',', '.')) > 0);

const InsumosEditor = ({ insumos, setInsumos }) => {
    const inputFoto = useRef(null);
    const fotoPara = useRef(null);
    const urls = useRef([]);
    useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), []);
    const cambiar = (i, c) => setInsumos(prev => prev.map((x, j) => (j === i ? { ...x, ...c } : x)));
    const sinFoto = { foto: null, fotoUrl: null, adjId: null, adjMime: null, adjNombre: null };
    const pedirFoto = (i) => { fotoPara.current = i; inputFoto.current?.click(); };
    const elegirFoto = async (archivo) => {
        const i = fotoPara.current;
        if (inputFoto.current) inputFoto.current.value = '';
        if (i === null || !archivo) return;
        if (!String(archivo.type || '').startsWith('image/')) { toast.error('Tiene que ser una foto o una imagen.'); return; }
        const f = await comprimirImagen(archivo);
        const url = URL.createObjectURL(f);
        urls.current.push(url);
        cambiar(i, { ...sinFoto, foto: f, fotoUrl: url });
    };
    const agregarDelStock = (v) => {
        if (insumos.some(x => x.varId === v.VarId)) { toast.info('Ese insumo ya está en la lista.'); return; }
        setInsumos(prev => [...prev, { varId: v.VarId, nombre: nombreDelStock(v), unidad: v.UnidadBase || '', cantidad: '' }]);
    };
    return (
        <div className="flex flex-col gap-2">
            <input ref={inputFoto} type="file" accept="image/*" className="hidden" onChange={(e) => elegirFoto(e.target.files?.[0])} />
            {insumos.map((x, i) => (
                <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-2">
                    {x.fotoUrl || x.adjId ? (
                        <div className="relative shrink-0">
                            {x.fotoUrl
                                ? <img src={x.fotoUrl} alt="" className="w-16 h-16 rounded-xl border border-zinc-200 object-cover" />
                                : <Adjunto a={{ AdjId: x.adjId, Mime: x.adjMime || 'image/', NombreOriginal: x.adjNombre }} chico />}
                            <button type="button" onClick={() => cambiar(i, sinFoto)} title="Quitar la foto"
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-zinc-200 text-zinc-500 hover:text-red-600 flex items-center justify-center shadow-sm">
                                <X size={11} />
                            </button>
                        </div>
                    ) : (
                        <button type="button" onClick={() => pedirFoto(i)} title="Agregar una foto o imagen"
                            className="w-16 h-16 shrink-0 rounded-xl border-2 border-dashed border-zinc-200 text-zinc-400 hover:border-brand-cyan/40 hover:text-brand-cyan flex flex-col items-center justify-center gap-0.5">
                            <ImagePlus size={17} /><span className="text-[10px] font-bold">Foto</span>
                        </button>
                    )}
                    <div className="flex-1 min-w-[160px]">
                        {x.varId ? (
                            <>
                                <p className="text-sm font-bold text-zinc-700 break-words">{x.nombre}</p>
                                <p className="text-[11px] text-zinc-400">Del stock</p>
                            </>
                        ) : (
                            <input className={`${input} py-2`} value={x.nombre} maxLength={300} placeholder="Qué hace falta (ej: bulones de 8 mm, de ferretería)"
                                onChange={(e) => cambiar(i, { nombre: e.target.value })} />
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <div className="w-16">
                            <input className={`${input} py-2 px-2 text-center ${cantidadInvalida(x.cantidad) ? '!border-red-400' : ''}`} value={x.cantidad}
                                inputMode="decimal" placeholder="cant." title="Cantidad (opcional)" onChange={(e) => cambiar(i, { cantidad: e.target.value })} />
                        </div>
                        <div className="w-20">
                            {x.varId
                                ? <span className="block px-1 text-xs text-zinc-500">{x.unidad || '—'}</span>
                                : <input className={`${input} py-2 px-2`} value={x.unidad} maxLength={30} placeholder="unidad" title="Unidad (opcional)"
                                    onChange={(e) => cambiar(i, { unidad: e.target.value })} />}
                        </div>
                        <button type="button" onClick={() => setInsumos(prev => prev.filter((_, j) => j !== i))} title="Quitar el insumo"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[220px]"><BuscadorVariante placeholder="Agregar del stock…" onElegir={agregarDelStock} /></div>
                <button type="button" onClick={() => setInsumos(prev => [...prev, { varId: null, nombre: '', unidad: '', cantidad: '' }])}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border-2 border-dashed border-zinc-200 text-xs font-bold text-zinc-400 hover:border-brand-cyan/40 hover:text-brand-cyan">
                    <Plus size={14} /> Otro que no está en el stock
                </button>
            </div>
        </div>
    );
};

// Franja horaria de un trabajo (30/09): desde / hasta, de 06:00 a 22:00, de al menos 1 hora. Opcional.
export const SelectorFranja = ({ desde, hasta, onChange }) => (
    <div className="grid grid-cols-2 gap-2">
        <Selector value={desde} renderValor={(o) => (o?.value ? `Desde ${o.value}` : 'Sin horario')}
            onChange={(e) => {
                const d = e.target.value;
                const siguiente = HORAS_FRANJA[HORAS_FRANJA.indexOf(d) + 1];
                onChange({ horaDesde: d, horaHasta: !d ? '' : (hasta && hasta > d ? hasta : siguiente) });
            }}>
            <option value="">Sin horario</option>
            {HORAS_FRANJA.slice(0, -1).map(h => <option key={h} value={h}>{h}</option>)}
        </Selector>
        <Selector value={desde ? hasta : ''} disabled={!desde} renderValor={(o) => (o?.value ? `Hasta ${o.value}` : 'Hasta')}
            onChange={(e) => onChange({ horaDesde: desde, horaHasta: e.target.value })}>
            {!desde && <option value="">Hasta</option>}
            {HORAS_FRANJA.filter(h => desde && h > desde).map(h => <option key={h} value={h}>{h}</option>)}
        </Selector>
    </div>
);

// Días de la semana de un mantenimiento (30/09): 1 = lunes … 7 = domingo. Se marcan tocándolos; queda al menos uno.
const diaDeSemana = (iso) => { const [y, m, dd] = iso.split('-').map(Number); return ((new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7) + 1; };
const ordenarDias = (l) => [...l].sort((a, b) => a - b);
// Las veces por semana son los días marcados
const vecesTexto = (dias) => (dias.length === 7 ? 'todos los días' : `${dias.length} ${dias.length === 1 ? 'vez' : 'veces'} por semana`);
// Primer día marcado desde `desde` (incluido)
const primerDiaMarcado = (desde, dias) => {
    for (let i = 0; i < 7; i++) { const f = sumarDias(desde, i); if (dias.includes(diaDeSemana(f))) return f; }
    return desde;
};
const SelectorDias = ({ dias, onChange }) => (
    <div className="grid grid-cols-7 gap-1.5">
        {DIAS_SEMANA.map((nombre, i) => {
            const n = i + 1;
            const marcado = dias.includes(n);
            return (
                <button key={n} type="button" aria-pressed={marcado} title={nombre}
                    onClick={() => onChange(marcado ? (dias.length > 1 ? dias.filter(x => x !== n) : dias) : ordenarDias([...dias, n]))}
                    className={`py-2.5 rounded-xl border text-xs font-black uppercase tracking-wide transition-colors ${marcado
                        ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-zinc-200 text-zinc-600 hover:border-brand-cyan/50 hover:bg-brand-cyan/5'}`}>
                    {nombre.slice(0, 3)}
                </button>
            );
        })}
    </div>
);

const SelectMaquina = ({ meta, value, onChange, vacio = 'Ninguna' }) => (
    <Selector value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{vacio}</option>
        {Object.entries((meta?.equipos || []).reduce((g, m) => { (g[m.AreaID] = g[m.AreaID] || []).push(m); return g; }, {})).map(([area, lista]) => (
            <optgroup key={area} label={area}>
                {lista.map(m => <option key={m.EquipoID} value={m.EquipoID}>{m.Nombre}</option>)}
            </optgroup>
        ))}
    </Selector>
);

// ── Procedimiento (crear / editar) ───────────────────────────────────────────
export const ModalProcedimiento = ({ procId = null, meta, onGuardado, onCerrar }) => {
    const [d, setD] = useState({ titulo: '', descripcion: '', areaId: '', equipoId: '' });
    const [pasos, setPasos] = useState([{ texto: '', minutos: '', detalle: '' }]);
    const [insumos, setInsumos] = useState([]);
    const [cargando, setCargando] = useState(!!procId);
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    useEffect(() => {
        if (!procId) return;
        servicioTecnicoService.procedimiento(procId).then((p) => {
            setD({ titulo: p.Titulo, descripcion: p.Descripcion || '', areaId: p.AreaId || '', equipoId: p.EquipoId ? String(p.EquipoId) : '' });
            setPasos(p.pasos.map(x => ({ texto: x.Texto, minutos: String(x.MinutosEstimados ?? ''), detalle: x.Detalle || '' })));
            setInsumos((p.insumos || []).map(x => ({
                varId: x.VarId || null, nombre: x.Nombre || '', unidad: x.Unidad || '',
                cantidad: x.Cantidad != null ? String(Number(x.Cantidad)) : '',
                adjId: x.AdjId || null, adjMime: x.AdjMime || null, adjNombre: x.AdjNombre || null,
            })));
        }).catch((e) => toast.error(mensajeError(e))).finally(() => setCargando(false));
    }, [procId]);
    const validos = pasosParaApi(pasos);
    // Los insumos sin nada escrito no cuentan. El servidor recibe hasta 8 fotos por vez.
    const insumosCargados = insumos.filter(x => x.varId || x.nombre.trim());
    const errorInsumos = insumos.some(x => !x.varId && !x.nombre.trim() && (String(x.cantidad).trim() || x.foto || x.adjId)) ? 'Falta decir qué es uno de los insumos.'
        : insumosCargados.some(x => cantidadInvalida(x.cantidad)) ? 'Hay una cantidad inválida en los insumos.'
        : insumosCargados.filter(x => x.foto).length > 8 ? 'Se pueden subir hasta 8 fotos nuevas por vez: guardá y agregá las demás después.'
        : null;
    const guardar = async () => {
        setGuardando(true);
        try {
            const fotos = [];
            const insumosApi = insumosCargados.map(x => ({
                varId: x.varId || undefined,
                nombre: x.varId ? undefined : x.nombre.trim(),
                unidad: x.varId ? undefined : (x.unidad.trim() || undefined),
                cantidad: String(x.cantidad).trim() === '' ? null : Number(String(x.cantidad).replace(',', '.')),
                adjId: x.foto ? undefined : (x.adjId || undefined),
                foto: x.foto ? fotos.push(x.foto) - 1 : undefined,   // índice de la foto nueva en "adjuntos"
            }));
            const r = await servicioTecnicoService.guardarProcedimiento(procId,
                { ...d, titulo: d.titulo.trim(), equipoId: d.equipoId || null, areaId: d.areaId || null, pasos: validos, insumos: insumosApi }, fotos);
            toast.success(procId ? 'Procedimiento guardado' : 'Procedimiento creado');
            onGuardado?.(r);
        } catch (e) { toast.error(mensajeError(e)); } finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={procId ? 'Editar procedimiento' : 'Nuevo procedimiento'} ancho="max-w-2xl" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={cargando || guardando || !d.titulo.trim() || !validos.length || !!errorInsumos} className={btnPri}>
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
                            <Selector value={d.areaId} onChange={(e) => set({ areaId: e.target.value })}>
                                <option value="">Cualquiera</option>
                                {(meta?.areas || []).map(a => <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>)}
                            </Selector></div>
                        <div><span className={label}>Para la máquina <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                            <SelectMaquina meta={meta} value={d.equipoId} onChange={(v) => set({ equipoId: v })} vacio="Cualquiera" /></div>
                    </div>
                    <div><span className={label}>Pasos, en orden, con su tiempo estimado</span>
                        <PasosEditor pasos={pasos} setPasos={setPasos} conDetalle /></div>
                    <div><span className={label}>Insumos necesarios <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                        <InsumosEditor insumos={insumos} setInsumos={setInsumos} />
                        {errorInsumos && <p className="mt-1.5 text-xs font-bold text-red-600">{errorInsumos}</p>}</div>
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
        horaDesde: plan?.HoraDesde || '', horaHasta: plan?.HoraHasta || '',
    });
    // Los mantenimientos por días de la semana (creados desde Programar trabajo) se editan con sus días
    const porDias = !!plan?.DiasSemana;
    const [dias, setDias] = useState(porDias ? String(plan.DiasSemana).split(',').map(Number).filter(n => n >= 1 && n <= 7) : []);
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    const proc = (procedimientos || []).find(p => String(p.ProcId) === d.procId);
    const valido = (d.titulo.trim() || proc) && (porDias ? dias.length > 0 : parseInt(d.cadaValor, 10) >= 1);
    const guardar = async () => {
        setGuardando(true);
        try {
            const datos = {
                ...d, titulo: d.titulo.trim(), procId: d.procId || null, equipoId: d.equipoId || null, tecnicoId: d.tecnicoId || null,
                cadaValor: parseInt(d.cadaValor, 10), ...(porDias ? { diasSemana: dias } : {}),
            };
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
                <Selector value={d.procId} onChange={(e) => set({ procId: e.target.value })}>
                    <option value="">Sin procedimiento</option>
                    {(procedimientos || []).map(p => <option key={p.ProcId} value={p.ProcId}>{p.Titulo} ({p.Pasos} pasos · {fmtDuracion(p.MinutosTotal) || '0 min'})</option>)}
                </Selector></div>
            <div><span className={label}>Título</span>
                <input className={input} value={d.titulo} maxLength={200} onChange={(e) => set({ titulo: e.target.value })} placeholder={proc ? proc.Titulo : 'Ej: Revisión de la UPS'} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className={label}>Máquina</span><SelectMaquina meta={meta} value={d.equipoId} onChange={(v) => set({ equipoId: v, paraMaquina: v ? d.paraMaquina : false })} vacio="Otro equipo o lugar" /></div>
                {!d.equipoId && <div><span className={label}>Equipo o lugar</span><input className={input} value={d.equipoTexto} maxLength={150} onChange={(e) => set({ equipoTexto: e.target.value })} placeholder="Ej: compresor, aire del taller" /></div>}
            </div>
            {d.equipoId && (
                <label className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                    <input type="checkbox" checked={d.paraMaquina} onChange={(e) => set({ paraMaquina: e.target.checked })} className="w-4 h-4 accent-brand-cyan" />
                    Hay que parar la máquina (al empezarlo pasa a mantenimiento y no recibe lotes)
                </label>
            )}
            {porDias ? (
                <>
                    <div><span className={label}>Días <span className="normal-case font-bold text-zinc-400">· {vecesTexto(dias)}</span></span>
                        <SelectorDias dias={dias} onChange={setDias} /></div>
                    <div className="sm:w-1/2"><span className={label}>Franja horaria <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                        <SelectorFranja desde={d.horaDesde} hasta={d.horaHasta} onChange={set} /></div>
                </>
            ) : (
                <>
                    <div className="grid grid-cols-[90px_1fr] gap-2 items-end">
                        <div><span className={label}>Cada</span><input className={input} inputMode="numeric" value={d.cadaValor} onChange={(e) => set({ cadaValor: e.target.value.replace(/\D/g, '') })} /></div>
                        <Selector value={d.cadaUnidad} onChange={(e) => set({ cadaUnidad: e.target.value })}>
                            {UNIDADES.map(u => <option key={u.value} value={u.value}>{parseInt(d.cadaValor, 10) === 1 ? u.singular : u.plural}</option>)}
                        </Selector>
                    </div>
                    <div><span className={label}>Franja horaria <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                        <SelectorFranja desde={d.horaDesde} hasta={d.horaHasta} onChange={set} /></div>
                </>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {!porDias && <div><span className={label}>{plan ? 'Próxima vez' : 'Primera vez'}</span><SelectorFecha value={d.proximaFecha} min={hoyISO()} onChange={(e) => set({ proximaFecha: e.target.value })} /></div>}
                <div><span className={label}>Técnico</span>
                    <Selector value={d.tecnicoId} onChange={(e) => set({ tecnicoId: e.target.value })}>
                        <option value="">Sin asignar</option>
                        {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </Selector></div>
            </div>
            <div><span className={label}>Detalle <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                <textarea className={`${input} min-h-[60px]`} value={d.descripcion} onChange={(e) => set({ descripcion: e.target.value })} /></div>
            <p className="text-xs text-zinc-500">
                {porDias
                    ? 'Se repite todas las semanas los días marcados: al terminar uno se agenda el siguiente día marcado.'
                    : <>Se programa {unidad ? `cada ${parseInt(d.cadaValor, 10) === 1 ? unidad.singular : `${d.cadaValor} ${unidad.plural}`}` : ''}: al terminar uno se agenda el siguiente
                        (contando desde el día en que se hizo, o desde su fecha si se hizo antes).</>}
            </p>
        </MiniModal>
    );
};

// ── Trabajo puntual (mantenimiento suelto o tarea) ──────────────────────────
// equipoInicial / tipoInicial (08/10): desde el preventivo de una máquina se abre con esa máquina y en Mantenimiento.
export const ModalNuevoTrabajo = ({ meta, procedimientos, fechaInicial, equipoInicial = null, tipoInicial = 'TAREA', onGuardado, onCerrar }) => {
    const fechaBase = fechaInicial && fechaInicial > hoyISO() ? fechaInicial : hoyISO();
    const [d, setD] = useState({
        tipo: tipoInicial, titulo: '', descripcion: '', fecha: fechaBase, tecnicoId: meta?.esTecnico && meta?.usuario?.id ? String(meta.usuario.id) : '',
        procId: '', equipoId: equipoInicial ? String(equipoInicial) : '', equipoTexto: '', paraMaquina: false, minutosEstimados: '',
        horaDesde: '', horaHasta: '',
    });
    const [tareas, setTareas] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const set = (c) => setD(p => ({ ...p, ...c }));
    const proc = (procedimientos || []).find(p => String(p.ProcId) === d.procId);
    const totalTareas = useMemo(() => tareas.reduce((s, x) => s + (parseInt(x.minutos, 10) || 0), 0), [tareas]);
    const esMant = d.tipo === 'MANTENIMIENTO';
    // Mantenimiento: se repite todas las semanas los días marcados, como un plan (lo es: se crea un plan).
    // Las veces por semana son los días marcados. El primero, desde el día elegido en el calendario.
    const [dias, setDias] = useState([diaDeSemana(fechaBase)]);
    const primero = primerDiaMarcado(fechaBase, dias);
    const valido = (d.titulo.trim() || proc) && (esMant ? dias.length > 0 : d.fecha);
    const comunes = () => ({
        titulo: d.titulo.trim(), descripcion: d.descripcion, procId: d.procId || null,
        equipoId: d.equipoId || null, equipoTexto: d.equipoTexto, paraMaquina: d.paraMaquina, tecnicoId: d.tecnicoId || null,
        horaDesde: d.horaDesde || '', horaHasta: d.horaHasta || '',
        tareas: d.procId ? undefined : pasosParaApi(tareas),
        minutosEstimados: d.minutosEstimados === '' ? undefined : parseInt(d.minutosEstimados, 10),
    });
    const guardar = async () => {
        setGuardando(true);
        try {
            if (esMant) {
                const r = await servicioTecnicoService.crearPlan({ ...comunes(), diasSemana: dias, desde: fechaBase });
                toast.success(`Mantenimiento creado: se repite ${r?.CadaTexto || 'cada semana'}`,
                    { description: r?.ProximaFecha ? `El primero es el ${fmtDia(r.ProximaFecha)}. Queda también en Planes.` : undefined });
                onGuardado?.(null);
            } else {
                const r = await servicioTecnicoService.crearTrabajo({ ...comunes(), tipo: 'TAREA', fecha: d.fecha });
                toast.success('Trabajo programado');
                onGuardado?.(r);
            }
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
                <Selector value={d.procId} onChange={(e) => set({ procId: e.target.value })}>
                    <option value="">Sin procedimiento</option>
                    {(procedimientos || []).map(p => <option key={p.ProcId} value={p.ProcId}>{p.Titulo}</option>)}
                </Selector>
                {pasos && <p className="mt-1 text-xs text-zinc-500">Se copian sus {pasos} como tareas.</p>}
            </div>
            <div><span className={label}>Título</span><input className={input} value={d.titulo} maxLength={200} onChange={(e) => set({ titulo: e.target.value })} placeholder={proc ? proc.Titulo : 'Qué hay que hacer'} /></div>
            {esMant ? (
                <>
                    <div><span className={label}>Días <span className="normal-case font-bold text-zinc-400">· {vecesTexto(dias)}</span></span>
                        <SelectorDias dias={dias} onChange={setDias} />
                        <p className="mt-1.5 text-xs text-zinc-500">
                            Se repite todas las semanas: al terminar uno se agenda el siguiente día marcado. El primero es el <b>{fmtDia(primero)}</b>.
                        </p>
                    </div>
                    <div className="sm:w-1/2"><span className={label}>Franja horaria <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                        <SelectorFranja desde={d.horaDesde} hasta={d.horaHasta} onChange={set} /></div>
                </>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div><span className={label}>Fecha</span><SelectorFecha value={d.fecha} min={hoyISO()} onChange={(e) => set({ fecha: e.target.value })} /></div>
                    <div><span className={label}>Franja horaria <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                        <SelectorFranja desde={d.horaDesde} hasta={d.horaHasta} onChange={set} /></div>
                </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className={label}>Técnico</span>
                    <Selector value={d.tecnicoId} onChange={(e) => set({ tecnicoId: e.target.value })}>
                        <option value="">Sin asignar</option>
                        {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </Selector></div>
                <div><span className={label}>Tiempo estimado</span>
                    <input className={input} inputMode="numeric" value={d.minutosEstimados} onChange={(e) => set({ minutosEstimados: e.target.value.replace(/\D/g, '') })}
                        placeholder={proc ? `${proc.MinutosTotal} min` : totalTareas ? `${totalTareas} min` : 'min'} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className={label}>Máquina</span><SelectMaquina meta={meta} value={d.equipoId} onChange={(v) => set({ equipoId: v, paraMaquina: v ? d.paraMaquina : false })} vacio="Otro equipo o lugar" /></div>
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
