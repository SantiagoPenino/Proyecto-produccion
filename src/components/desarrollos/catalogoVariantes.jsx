import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Search, Plus, Check, ChevronDown } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import { btnPri, btnCancelar, campoFiltro, input, label } from '../servicio-tecnico/ui';
import { Desplegable, fmtD, mensajeError } from './comun';
import { coincide, diaDe } from './reglas';
import { useEquipo } from './tareas';

// Catálogo técnico › Variantes y Opciones de slot (spec-C §5.2 y §5.3). Tablas propias por ahora: el enlace
// con TIZADA PRO (modelos, slots y opciones de molde) se suma cuando se cierre con Yoania.

export const V_ESTADO = [['PROPUESTA', 'Propuesta'], ['EN_DESARROLLO', 'En desarrollo'], ['MUESTRA', 'En muestra'], ['LISTA', 'Lista'], ['DESCARTADA', 'Descartada']];
const V_MOLDES = [['NO', 'Sin molde'], ['GENERADA', 'Generada por el motor'], ['DE_ALTA', 'De alta en moldes']];
const V_TIZADA = [['SIN_VERIFICAR', 'Sin verificar'], ['NO', 'No cargada'], ['CARGADA', 'Cargada']];
const V_ERP = [['SIN_VERIFICAR', 'Sin verificar'], ['NO', 'No habilitada'], ['HABILITADA', 'Habilitada para la venta']];
const O_ESTADO = [['RECETA', 'Receta del motor'], ['MOLDE', 'Molde a mano'], ['FALTA', 'Falta desarrollar']];
const GAPS = [
    ['en_curso', 'Nuevas en desarrollo'], ['alta_sin_tiz', 'De alta sin cargar en TizadaPro'], ['tiz_sin_erp', 'En TizadaPro sin habilitar en el ERP'],
    ['erp_sin_tiz', 'Habilitadas en el ERP sin TizadaPro'], ['sin_verificar', 'Sin verificar en TizadaPro o ERP'],
];

// Avisos de lo que falta en una variante, en orden (el primero solo sirve de filtro)
export const gaps = (v) => {
    const g = [];
    if (['PROPUESTA', 'EN_DESARROLLO', 'MUESTRA'].includes(v.estado)) g.push('en_curso');
    if (v.estado === 'DESCARTADA') return g;
    if (v.moldes === 'DE_ALTA' && v.tizada !== 'CARGADA') g.push('alta_sin_tiz');
    if (v.tizada === 'CARGADA' && v.erp !== 'HABILITADA' && v.estado === 'LISTA') g.push('tiz_sin_erp');
    if (v.erp === 'HABILITADA' && v.tizada !== 'CARGADA') g.push('erp_sin_tiz');
    if (v.tizada === 'SIN_VERIFICAR' || v.erp === 'SIN_VERIFICAR') g.push('sin_verificar');
    return g;
};

// Texto de la combinación: «Manga: Larga · Cuello: V · algo más»
export const textoCombinacion = (v, opciones) => {
    const partes = Object.entries(v.combinacion || {}).map(([slot, codigo]) => {
        const o = opciones.find(x => x.slot === slot && x.codigo === codigo && x.proyectos.includes(v.proyectoId)) || opciones.find(x => x.slot === slot && x.codigo === codigo);
        return `${o?.slotNombre || slot}: ${o?.nombre || codigo}`;
    });
    if (v.libre) partes.push(v.libre);
    return partes.join(' · ');
};

// Texto que se guarda al salir del campo; si llega un cambio de otro mientras se escribe, no lo pisa
const CampoTexto = ({ valor, onGuardar, maxLength, placeholder, disabled, revertirVacio = false }) => {
    const [v, setV] = useState(valor || '');
    const ref = useRef(null);
    useEffect(() => { if (document.activeElement !== ref.current) setV(valor || ''); }, [valor]);
    const salir = () => {
        const t = v.trim();
        if (revertirVacio && !t) { setV(valor || ''); return; }
        if (t !== (valor || '')) onGuardar(t);
    };
    return <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onBlur={salir} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        maxLength={maxLength} placeholder={placeholder} disabled={disabled} className={input} />;
};

// ── Variantes ───────────────────────────────────────────────────────────────
const TarjetaVariante = ({ v, p, opciones, edita, abierta, onAlternar, onCambio, onBorrada }) => {
    const navigate = useNavigate();
    const equipo = useEquipo();
    const [seguro, setSeguro] = useState(false);
    const guardar = async (patch) => {
        try { onCambio(await desarrollosService.editarVariante(v.id, patch)); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
    };
    const tarea = async (t) => {
        try { onCambio(await desarrollosService.tareaVariante(v.id, t.id, t.estado !== 'HECHO')); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
    };
    const borrar = async () => {
        if (!seguro) { setSeguro(true); return; }
        try { await desarrollosService.borrarVariante(v.id); toast.success('Variante borrada.'); onBorrada(v.id); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo borrar.')); setSeguro(false); }
    };
    const avisos = gaps(v).filter(g => g !== 'en_curso').map(g => GAPS.find(x => x[0] === g)[1]);
    const comb = textoCombinacion(v, opciones);
    const hechas = v.tareas.filter(t => t.estado === 'HECHO' || t.estado === 'NO_APLICA').length;
    const enEquipo = equipo.some(m => m.usuarioId === v.responsableId);
    const sel = (campo, lista, titulo) => (
        <div className="min-w-[150px] flex-1">
            <span className={label}>{titulo}</span>
            <Selector value={v[campo]} onChange={(e) => guardar({ [campo]: e.target.value })} disabled={!edita} aria-label={titulo} anchoLista={240}>
                {lista.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </Selector>
        </div>
    );
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-[220px]">
                    <p className="text-sm font-bold text-zinc-800">
                        {v.nombre || 'Sin nombre'}
                        {v.origen === 'solicitud' && <span className="ml-2 rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] font-black uppercase text-zinc-500">pedida</span>}
                    </p>
                    <p className="text-xs text-zinc-500">
                        <button type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${v.proyectoId}`)} className="font-bold text-brand-cyan hover:underline">{p?.nombre || 'Producto'}</button>
                        {' · '}{comb || 'sin combinación cargada'}
                    </p>
                    {avisos.length > 0 && <p className="text-xs font-bold text-amber-700 mt-0.5">{avisos.join(' · ')}</p>}
                </div>
                <button type="button" onClick={onAlternar} className="text-xs font-bold text-brand-cyan hover:underline inline-flex items-center gap-1">
                    {abierta ? 'cerrar' : `más${v.tareas.length ? ` · tareas ${hechas}/${v.tareas.length}` : ''}`}
                    <ChevronDown size={13} className={abierta ? 'rotate-180' : ''} />
                </button>
            </div>
            <div className="flex flex-wrap gap-3">
                {sel('estado', V_ESTADO, 'Estado')}
                {sel('moldes', V_MOLDES, 'Sistema de moldes')}
                {sel('tizada', V_TIZADA, 'TizadaPro')}
                {sel('erp', V_ERP, 'ERP')}
            </div>
            <Desplegable abierto={abierta} hueco={12}>
                <div className="border-t border-zinc-100 pt-3 flex flex-col gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div><span className={label}>Nombre</span><CampoTexto valor={v.nombre} maxLength={120} disabled={!edita} revertirVacio onGuardar={(t) => guardar({ nombre: t })} /></div>
                        <div><span className={label}>Nombre en TizadaPro</span><CampoTexto valor={v.tizadaNombre} maxLength={80} disabled={!edita} onGuardar={(t) => guardar({ tizadaNombre: t })} /></div>
                        <div>
                            <span className={label}>Responsable</span>
                            <Selector value={String(v.responsableId || (v.responsable ? '__actual' : ''))} disabled={!edita} aria-label="Responsable"
                                onChange={(e) => e.target.value !== '__actual' && guardar({ responsableId: e.target.value ? Number(e.target.value) : null })}>
                                <option value="">Sin asignar</option>
                                {equipo.map(m => <option key={m.usuarioId} value={String(m.usuarioId)}>{m.nombre}</option>)}
                                {v.responsable && !enEquipo && <option value={v.responsableId ? String(v.responsableId) : '__actual'} disabled>{v.responsable}</option>}
                            </Selector>
                        </div>
                        <div><span className={label}>Fecha</span><SelectorFecha value={v.fecha || ''} onChange={(e) => guardar({ fecha: e.target.value || null })} disabled={!edita} vaciable className="w-full" /></div>
                    </div>
                    <div><span className={label}>Nota</span><CampoTexto valor={v.nota} maxLength={300} disabled={!edita} onGuardar={(t) => guardar({ nota: t })} /></div>
                    {v.tareas.length > 0 && (
                        <div>
                            <span className={label}>Tareas de la variante</span>
                            <div className="flex flex-col gap-1">
                                {v.tareas.map(t => {
                                    const hecha = t.estado === 'HECHO';
                                    return (
                                        <div key={t.id} className="flex items-center gap-2 text-sm">
                                            <button type="button" disabled={!edita} onClick={() => tarea(t)} title={hecha ? 'Marcar pendiente' : 'Marcar hecha'}
                                                className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${hecha ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-zinc-300 text-transparent hover:border-brand-cyan hover:text-brand-cyan'} disabled:cursor-default`}>
                                                <Check size={11} strokeWidth={3} />
                                            </button>
                                            <span className={`flex-1 ${hecha ? 'text-zinc-400 line-through' : 'text-zinc-700'}`}>{t.nombre}{t.estado === 'EN_CURSO' && <span className="ml-1.5 text-xs font-bold text-brand-cyan">en curso</span>}</span>
                                            <span className="text-xs text-zinc-400">{hecha && t.hechoEl ? `hecha ${fmtD(diaDe(t.hechoEl))}` : t.responsable || ''}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {edita && (
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={borrar} onBlur={() => setSeguro(false)} className={`${btnCancelar} ${seguro ? '!text-brand-magenta' : ''}`}>
                                {seguro ? '¿Borrar esta variante? Tocá de nuevo' : 'Borrar la variante'}
                            </button>
                            <span className="text-xs text-zinc-400">Si se probó y no va, conviene dejarla como «Descartada» para que quede el registro.</span>
                        </div>
                    )}
                </div>
            </Desplegable>
        </div>
    );
};

const NuevaVariante = ({ proyectos, opciones, proyectoInicial, onCreada, onCancelar }) => {
    const [pid, setPid] = useState(proyectoInicial ? String(proyectoInicial) : '');
    const [nombre, setNombre] = useState('');
    const [comb, setComb] = useState({});
    const [libre, setLibre] = useState('');
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    // Un selector por cada parte (slot) que tienen las opciones vinculadas al producto
    const slots = useMemo(() => {
        const m = new Map();
        for (const o of opciones.filter(x => x.proyectos.includes(Number(pid)))) {
            if (!m.has(o.slot)) m.set(o.slot, { slot: o.slot, nombre: o.slotNombre || o.slot, opciones: [] });
            m.get(o.slot).opciones.push(o);
        }
        return [...m.values()];
    }, [opciones, pid]);
    const agregar = async () => {
        if (!pid) { setError('Elegí el producto.'); return; }
        if (!nombre.trim()) { setError('Poné un nombre.'); return; }
        setGuardando(true);
        setError('');
        try {
            const v = await desarrollosService.crearVariante({ proyectoId: Number(pid), nombre: nombre.trim(), combinacion: comb, libre: libre.trim() });
            toast.success('Variante agregada.');
            onCreada(v);
        } catch (e) { setError(mensajeError(e, 'No se pudo guardar.')); }
        finally { setGuardando(false); }
    };
    return (
        <div className="rounded-2xl border-2 border-brand-cyan/30 bg-white p-4 flex flex-col gap-3">
            <p className="text-sm font-black text-zinc-800">Nueva variante</p>
            <div className="grid gap-3 sm:grid-cols-2">
                <div>
                    <span className={label}>Producto</span>
                    <Selector value={pid} onChange={(e) => { setPid(e.target.value); setComb({}); }} aria-label="Producto" anchoLista={340}>
                        <option value="">— elegir —</option>
                        {proyectos.map(p => <option key={p.id} value={String(p.id)}>{p.nombre}</option>)}
                    </Selector>
                </div>
                <div><span className={label}>Nombre de la variante</span>
                    <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} placeholder="Ej.: manga larga, cuello V" className={input} autoFocus /></div>
            </div>
            {pid && (
                <div className="grid gap-3 sm:grid-cols-3">
                    {slots.map(s => (
                        <div key={s.slot}>
                            <span className={label}>{s.nombre}</span>
                            <Selector value={comb[s.slot] || ''} onChange={(e) => setComb(c => { const n = { ...c }; if (e.target.value) n[s.slot] = e.target.value; else delete n[s.slot]; return n; })} aria-label={s.nombre} anchoLista={280}>
                                <option value="">—</option>
                                {s.opciones.map(o => <option key={o.id} value={o.codigo}>{o.nombre || o.codigo}{o.estado === 'FALTA' ? ' (falta desarrollar)' : ''}</option>)}
                            </Selector>
                        </div>
                    ))}
                    <div className={slots.length ? '' : 'sm:col-span-3'}>
                        <span className={label}>{slots.length ? 'Algo más (opcional)' : 'En qué cambia'}</span>
                        <input value={libre} onChange={(e) => setLibre(e.target.value)} maxLength={200} placeholder="Descripción libre de la variante" className={input} />
                    </div>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={agregar} disabled={guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />}Agregar</button>
                <button type="button" onClick={onCancelar} className={btnCancelar}>Cancelar</button>
                {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
            </div>
        </div>
    );
};

export const VariantesSeccion = ({ datos, proyectos, proyectoId, edita, onVariante, onVarianteBorrada }) => {
    const [gap, setGap] = useState('');
    const [q, setQ] = useState('');
    const [abierta, setAbierta] = useState(null);
    const [nueva, setNueva] = useState(false);
    const vivos = useMemo(() => new Map(proyectos.filter(p => p.estado !== 'CANCELADO').map(p => [p.id, p])), [proyectos]);
    const universo = useMemo(() => datos.variantes.filter(v => vivos.has(v.proyectoId) && (!proyectoId || v.proyectoId === proyectoId)), [datos.variantes, vivos, proyectoId]);
    const base = useMemo(() => universo.filter(v => coincide(q, v.nombre, vivos.get(v.proyectoId)?.nombre, textoCombinacion(v, datos.opciones), v.responsable, v.tizadaNombre)),
        [universo, q, vivos, datos.opciones]);
    const visibles = gap ? base.filter(v => gaps(v).includes(gap)) : base;
    const chip = (activo) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${activo ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por variante, producto u opción" className={`${campoFiltro} w-full pl-9`} />
                </div>
                {edita && <button type="button" onClick={() => setNueva(x => !x)} className={btnPri}><Plus size={15} /> Variante</button>}
            </div>
            <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setGap('')} className={chip(!gap)}>Todas <span className="text-zinc-400">{base.length}</span></button>
                {GAPS.map(([k, n]) => {
                    const c = base.filter(v => gaps(v).includes(k)).length;
                    return <button key={k} type="button" onClick={() => setGap(k)} className={chip(gap === k)}>{n} <span className="text-zinc-400">{c}</span></button>;
                })}
            </div>
            <Desplegable abierto={nueva} hueco={12}>
                <NuevaVariante proyectos={[...vivos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))} opciones={datos.opciones} proyectoInicial={proyectoId}
                    onCancelar={() => setNueva(false)} onCreada={(v) => { onVariante(v); setNueva(false); setAbierta(v.id); }} />
            </Desplegable>
            {!visibles.length ? (
                <p className="text-sm text-zinc-400">{universo.length ? 'Ninguna variante coincide.'
                    : `Todavía no hay variantes cargadas${proyectoId ? ' para este producto' : ''}. Una variante es un modelo del mismo producto: otra manga, otro cuello, otro largo.`}</p>
            ) : visibles.map(v => (
                <TarjetaVariante key={v.id} v={v} p={vivos.get(v.proyectoId)} opciones={datos.opciones} edita={edita}
                    abierta={abierta === v.id} onAlternar={() => setAbierta(a => (a === v.id ? null : v.id))}
                    onCambio={onVariante} onBorrada={onVarianteBorrada} />
            ))}
        </div>
    );
};

// ── Opciones de slot ────────────────────────────────────────────────────────
export const OpcionesSeccion = ({ datos, edita, onOpcion }) => {
    const [abierto, setAbierto] = useState(null);
    const grupos = useMemo(() => {
        const m = new Map();
        for (const o of datos.opciones) {
            const k = o.moldeNombre || o.molde || 'Sin molde';
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(o);
        }
        return [...m.entries()];
    }, [datos.opciones]);
    // Uso: variantes no descartadas de los productos de la opción que la eligieron en esa parte
    const usos = (o) => datos.variantes.filter(v => v.estado !== 'DESCARTADA' && o.proyectos.includes(v.proyectoId) && v.combinacion?.[o.slot] === o.codigo).length;
    const guardar = async (o, patch) => {
        try { await desarrollosService.editarOpcion(o.id, patch); onOpcion({ ...o, ...patch }); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
    };
    if (!datos.opciones.length) return <p className="text-sm text-zinc-400">Sin opciones cargadas.</p>;
    return (
        <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-600">Lo que el sistema de moldes ofrece en cada parte de la prenda. «Habilitada» = el maestro la ofrece hoy. Una opción que falta se pide desde la Bandeja, con un pedido de tipo «Variante».</p>
            {grupos.map(([molde, lista]) => (
                <div key={molde} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                    <button type="button" onClick={() => setAbierto(a => (a === molde ? null : molde))} className="w-full flex items-center gap-2 p-3 sm:p-4 text-left hover:bg-zinc-50">
                        <span className="flex-1 text-sm text-zinc-600"><b className="text-zinc-800">{molde}</b> {lista.length} opciones · {lista.filter(o => o.estado === 'FALTA').length} por desarrollar · {lista.filter(o => o.habilitada).length} habilitadas</span>
                        <ChevronDown size={16} className={`text-zinc-400 transition-transform ${abierto === molde ? 'rotate-180' : ''}`} />
                    </button>
                    <Desplegable abierto={abierto === molde}>
                        <div className="border-t border-zinc-100 overflow-x-auto">
                            <table className="w-full min-w-[760px] text-sm">
                                <thead><tr className="text-left text-[11px] font-black uppercase tracking-wide text-zinc-400">
                                    {['Parte', 'Código', 'Opción', 'Estado', 'Habilitada', 'Variantes', 'Nota'].map(t => <th key={t} className="px-3 py-2">{t}</th>)}
                                </tr></thead>
                                <tbody>
                                    {lista.map(o => (
                                        <tr key={o.id} className="border-t border-zinc-100 align-top">
                                            <td className="px-3 py-2 text-zinc-700">{o.slotNombre || o.slot}</td>
                                            <td className="px-3 py-2 font-mono text-xs text-zinc-700">{o.codigo}{o.codigoCasa && <span className="block text-zinc-400">{o.codigoCasa}</span>}</td>
                                            <td className="px-3 py-2 text-zinc-800">{o.nombre}{o.porDefecto && <span className="ml-1.5 text-[10px] font-black uppercase text-zinc-400">por defecto</span>}</td>
                                            <td className="px-3 py-2 w-48">
                                                <Selector value={o.estado} onChange={(e) => guardar(o, { estado: e.target.value })} disabled={!edita} aria-label="Estado">
                                                    {O_ESTADO.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                                                </Selector>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <input type="checkbox" checked={!!o.habilitada} disabled={!edita} onChange={(e) => guardar(o, { habilitada: e.target.checked })} className="w-4 h-4 accent-brand-cyan" />
                                            </td>
                                            <td className="px-3 py-2 text-center text-zinc-600">{usos(o) || '—'}</td>
                                            <td className="px-3 py-2 w-56"><CampoTexto valor={o.nota} maxLength={200} disabled={!edita} onGuardar={(t) => guardar(o, { nota: t || null })} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Desplegable>
                </div>
            ))}
        </div>
    );
};
