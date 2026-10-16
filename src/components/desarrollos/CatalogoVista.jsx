import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Plus, X, Check } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import { btnPri, btnSec, btnCancelar, input, label } from '../servicio-tecnico/ui';
import { Desplegable, mensajeError } from './comun';
import { VariantesSeccion, OpcionesSeccion } from './catalogoVariantes';

// Catálogo técnico (spec-C §5): Capacidades (qué necesitan los productos y cuál conviene desarrollar primero),
// Variantes de cada producto y Opciones de slot de cada molde. Lo ve el equipo; lo cambia el editor.

const SECCIONES = [['capacidades', 'Capacidades'], ['variantes', 'Variantes'], ['opciones', 'Opciones de slot']];
const AMBITOS = [['', 'Todo'], ['PRENDA', 'Prendas'], ['PLANO', 'Diseño plano']];
const NOMBRE_AMBITO = { PRENDA: 'Prendas', PLANO: 'Diseño plano' };
const chipClase = (activo) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${activo ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`;
const porNombre = (a, b) => String(a).localeCompare(String(b), 'es');

// Agrupa por familia, alfabético
const porFamilia = (lista, sinFamilia) => {
    const m = new Map();
    for (const c of lista) { const k = c.familia || sinFamilia; if (!m.has(k)) m.set(k, []); m.get(k).push(c); }
    return [...m.entries()].sort((a, b) => porNombre(a[0], b[0])).map(([f, l]) => [f, l.sort((a, b) => porNombre(a.nombre, b.nombre))]);
};

const FormCapacidad = ({ inicial, familias, onGuardada, onCancelar }) => {
    const [d, setD] = useState(inicial);
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const guardar = async () => {
        if (!d.nombre.trim()) { setError('Poné un nombre.'); return; }
        setGuardando(true);
        setError('');
        try {
            const datos = { nombre: d.nombre.trim(), familia: d.familia.trim(), ambito: d.ambito, nota: d.nota.trim() };
            const c = d.id ? await desarrollosService.editarCapacidad(d.id, datos) : await desarrollosService.crearCapacidad(datos);
            toast.success('Capacidad guardada.');
            onGuardada(c, !d.id);
        } catch (e) { setError(mensajeError(e, 'No se pudo guardar.')); }
        finally { setGuardando(false); }
    };
    return (
        <div className="rounded-2xl border-2 border-brand-cyan/30 bg-white p-4 flex flex-col gap-3" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') guardar(); }}>
            <p className="text-sm font-black text-zinc-800">{d.id ? 'Editar capacidad' : 'Nueva capacidad'}</p>
            <div className="grid gap-3 sm:grid-cols-2">
                <div><span className={label}>Nombre</span><input value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} maxLength={80} className={input} autoFocus /></div>
                <div><span className={label}>Familia</span>
                    <input value={d.familia} onChange={(e) => setD({ ...d, familia: e.target.value })} maxLength={60} list="des-familias-cap" className={input} />
                    <datalist id="des-familias-cap">{familias.map(f => <option key={f} value={f} />)}</datalist></div>
                <div><span className={label}>Ámbito</span>
                    <Selector value={d.ambito} onChange={(e) => setD({ ...d, ambito: e.target.value })} aria-label="Ámbito">
                        <option value="PRENDA">Prendas</option><option value="PLANO">Diseño plano</option>
                    </Selector></div>
                <div><span className={label}>Nota</span><input value={d.nota} onChange={(e) => setD({ ...d, nota: e.target.value })} maxLength={200} className={input} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={guardar} disabled={guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />}Guardar</button>
                <button type="button" onClick={onCancelar} className={btnCancelar}>Cancelar</button>
                {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
            </div>
        </div>
    );
};

// Botón Resuelta / Por desarrollar
const EstadoCap = ({ c, edita, onCambio }) => {
    const cambiar = async () => {
        try { await desarrollosService.editarCapacidad(c.id, { resuelta: !c.resuelta }); onCambio(); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
    };
    return (
        <button type="button" disabled={!edita} onClick={cambiar}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap disabled:cursor-default ${c.resuelta ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
            {c.resuelta ? <><Check size={11} strokeWidth={3} /> Resuelta</> : 'Por desarrollar'}
        </button>
    );
};

// Fila de la tabla «Qué destraba más» / «Todas»: botón borrar con «tocá de nuevo»
const BorrarCap = ({ c, n, onBorrada }) => {
    const [seguro, setSeguro] = useState(false);
    const borrar = async () => {
        if (!seguro) { setSeguro(true); return; }
        try { await desarrollosService.borrarCapacidad(c.id); toast.success('Capacidad borrada.'); onBorrada(); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo borrar.')); setSeguro(false); }
    };
    return (
        <button type="button" disabled={n > 0} onClick={borrar} onBlur={() => setSeguro(false)} title={n > 0 ? `La necesitan ${n}: no se puede borrar` : ''}
            className={`text-xs font-bold hover:underline disabled:opacity-30 disabled:no-underline ${seguro ? 'text-brand-magenta' : 'text-zinc-400 hover:text-brand-magenta'}`}>
            {seguro ? '¿borrar? tocá de nuevo' : 'borrar'}
        </button>
    );
};

const CapacidadesSeccion = ({ datos, proyectos, tipos, proyectoId, edita, onRecargar }) => {
    const navigate = useNavigate();
    const [vista, setVista] = useState('ranking'); // ranking | todas
    const [amb, setAmb] = useState('');
    const [resueltas, setResueltas] = useState(false);
    const [form, setForm] = useState(null);
    const formRef = useRef(null);
    const caps = datos.capacidades;
    const capPorId = useMemo(() => new Map(caps.map(c => [c.id, c])), [caps]);
    const usoDe = useCallback((entidad, id, relacion) => datos.uso.filter(u => u.entidad === entidad && u.entidadId === id && u.relacion === relacion).map(u => u.capacidadId), [datos.uso]);
    const esProducto = useCallback((p) => !!tipos.find(t => t.id === p.tipoId)?.esProducto, [tipos]);
    const faltan = useCallback((req) => req.filter(id => capPorId.has(id) && !capPorId.get(id).resuelta), [capPorId]);
    const familias = useMemo(() => [...new Set(caps.map(c => c.familia).filter(Boolean))].sort(porNombre), [caps]);
    const abrirForm = (c) => {
        setForm(c ? { id: c.id, nombre: c.nombre, familia: c.familia || '', ambito: c.ambito, nota: c.nota || '' } : { id: null, nombre: '', familia: '', ambito: amb || 'PRENDA', nota: '' });
        setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    };
    const formulario = (
        <Desplegable abierto={!!form} hueco={12}>
            <div ref={formRef}>
                {form && <FormCapacidad key={form.id || 'nueva'} inicial={form} familias={familias} onCancelar={() => setForm(null)}
                    onGuardada={(c, nueva) => { setForm(null); if (nueva) setResueltas(true); onRecargar(); }} />}
            </div>
        </Desplegable>
    );

    // Lo que está en curso: proyectos activos (no cancelados ni terminados) y pedidos sin resolver
    const pend = useMemo(() => [
        ...proyectos.filter(p => p.estado !== 'CANCELADO' && p.etapaActual !== 'TERMINADO').map(p => ({ k: 'p', id: p.id, n: p.nombre, req: usoDe('PROYECTO', p.id, 'REQUIERE') })),
        ...datos.pedidos.map(s => ({ k: 's', id: s.id, n: s.titulo || 'Pedido', req: usoDe('SOLICITUD', s.id, 'REQUIERE') })),
    ], [proyectos, datos.pedidos, usoDe]);

    // ── Vista de un proyecto: tildar lo que necesita (producto) o lo que resuelve (otros desarrollos)
    if (proyectoId) {
        const p = proyectos.find(x => x.id === proyectoId);
        if (!p) return <p className="text-sm text-zinc-400">Ese proyecto ya no existe.</p>;
        const prod = esProducto(p);
        const relacion = prod ? 'REQUIERE' : 'RESUELVE';
        const marcadas = usoDe('PROYECTO', p.id, relacion);
        const porDesarrollar = faltan(usoDe('PROYECTO', p.id, 'REQUIERE')).length;
        const alternar = async (id) => {
            const ids = marcadas.includes(id) ? marcadas.filter(x => x !== id) : [...marcadas, id];
            try { await desarrollosService.capacidadesProyecto(p.id, relacion, ids); onRecargar(); }
            catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
        };
        return (
            <div className="flex flex-col gap-3">
                <p className="text-sm text-zinc-600">
                    {prod ? <>Tildá lo que este producto necesita. {porDesarrollar ? <><b>{porDesarrollar}</b> todavía por desarrollar.</> : 'Todo lo que necesita está resuelto.'}</>
                        : 'Tildá las capacidades que este desarrollo va a resolver. Cuando el proyecto termine, acá se ofrece marcarlas como resueltas.'}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                    {porFamilia(caps, 'Otras').map(([fam, lista]) => (
                        <div key={fam} className="rounded-2xl border border-zinc-200 bg-white p-4">
                            <p className="text-xs font-black uppercase tracking-wide text-zinc-400 mb-2">{fam}</p>
                            <div className="flex flex-col gap-1.5">
                                {lista.map(c => (
                                    <label key={c.id} className={`flex items-center gap-2 text-sm text-zinc-700 ${edita ? 'cursor-pointer' : ''}`}>
                                        <input type="checkbox" checked={marcadas.includes(c.id)} disabled={!edita} onChange={() => alternar(c.id)} className="w-4 h-4 accent-brand-cyan" />
                                        <span className="flex-1">{c.nombre}</span>
                                        {!c.resuelta && <span className="text-[10px] font-black uppercase text-amber-700">por desarrollar</span>}
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                {!caps.length && <p className="text-sm text-zinc-400">No hay capacidades cargadas.</p>}
            </div>
        );
    }

    // ── «Qué destraba más»
    const enAmbito = (c) => !amb || c.ambito === amb;
    const ranking = caps.filter(c => enAmbito(c) && (resueltas || !c.resuelta)).map(c => {
        const users = pend.filter(o => o.req.includes(c.id));
        const unl = c.resuelta ? [] : users.filter(o => { const f = faltan(o.req); return f.length > 0 && f.every(x => x === c.id); });
        return { c, users, unl };
    }).filter(r => r.users.length > 0 || resueltas)
        .sort((a, b) => (a.c.resuelta - b.c.resuelta) || (b.users.length - a.users.length) || (b.unl.length - a.unl.length) || porNombre(a.c.nombre, b.c.nombre));
    // «De a dos»: pares de capacidades que, hechas juntas, dejan varios productos con todo resuelto
    const pares = (() => {
        const vistos = new Map();
        for (const o of pend) {
            const f = faltan(o.req);
            if (f.length !== 2 || !f.every(id => enAmbito(capPorId.get(id)))) continue;
            const par = [...f].sort((x, y) => x - y);
            const k = par.join('-');
            if (vistos.has(k)) continue;
            const ps = pend.filter(x => { const g = faltan(x.req); return g.length > 0 && g.every(id => par.includes(id)); });
            if (ps.length >= 2) vistos.set(k, { par, ps });
        }
        return [...vistos.values()].sort((a, b) => b.ps.length - a.ps.length).slice(0, 3);
    })();
    // Desarrollos terminados que resuelven capacidades todavía «por desarrollar» (sin filtro de ámbito)
    const listos = caps.filter(c => !c.resuelta).map(c => ({
        c, ps: proyectos.filter(p => p.estado !== 'CANCELADO' && p.etapaActual === 'TERMINADO' && usoDe('PROYECTO', p.id, 'RESUELVE').includes(c.id)),
    })).filter(x => x.ps.length);
    const marcarListos = async () => {
        try { await desarrollosService.marcarResueltas(listos.map(x => x.c.id)); toast.success('Capacidades marcadas como resueltas.'); onRecargar(); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
    };
    const resuelvenla = (c) => proyectos.filter(p => p.estado !== 'CANCELADO' && usoDe('PROYECTO', p.id, 'RESUELVE').includes(c.id));
    const linkProy = (p, verde = false) => (
        <button key={`p${p.id}`} type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${p.id}`)}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-bold hover:underline ${verde ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-zinc-200 bg-white text-brand-cyan'}`}>{p.n || p.nombre}</button>
    );

    const controles = (
        <div className="flex flex-wrap items-center gap-1.5">
            {AMBITOS.map(([k, n]) => <button key={k} type="button" onClick={() => setAmb(k)} className={chipClase(amb === k)}>{n}</button>)}
            {vista === 'ranking' && (
                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-600 ml-1 cursor-pointer">
                    <input type="checkbox" checked={resueltas} onChange={(e) => setResueltas(e.target.checked)} className="w-4 h-4 accent-brand-cyan" /> Mostrar también las resueltas
                </label>
            )}
            <div className="flex-1" />
            {edita && <button type="button" onClick={() => abrirForm(null)} className={btnSec}><Plus size={15} className="text-brand-cyan" /> Capacidad</button>}
        </div>
    );

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setVista('ranking')} className={chipClase(vista === 'ranking')}>Qué destraba más</button>
                <button type="button" onClick={() => setVista('todas')} className={chipClase(vista === 'todas')}>Todas las capacidades <span className="text-zinc-400">{caps.length}</span></button>
            </div>
            {vista === 'ranking' ? (<>
                <p className="text-sm text-zinc-600">Lo que comparten los productos: partes del molde, terminaciones, formas. Resuelta = el sistema de moldes ya la tiene; por desarrollar = hay que construirla. Resolver una sola puede destrabar varios productos. Cuentan los proyectos en curso y los pedidos sin resolver (borde punteado).</p>
                {listos.length > 0 && (
                    <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 flex flex-col gap-1.5">
                        <p className="text-sm font-bold text-emerald-800">Hay desarrollos terminados que resuelven capacidades todavía marcadas «por desarrollar»:</p>
                        {listos.map(x => <p key={x.c.id} className="text-sm text-emerald-800"><b>{x.c.nombre}</b> · {x.ps.map(p => p.nombre).join(', ')}</p>)}
                        {edita && <button type="button" onClick={marcarListos} className={`${btnSec} self-start mt-1`}>Marcarlas como resueltas</button>}
                    </div>
                )}
                {controles}
                {formulario}
                {pares.length > 0 && (
                    <div className="grid gap-3 md:grid-cols-3">
                        {pares.map(x => (
                            <div key={x.par.join('-')} className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-1">
                                <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">De a dos</p>
                                <p className="text-sm text-zinc-600"><b className="text-zinc-800">{x.ps.length}</b> quedan con todo resuelto si se hacen</p>
                                <p className="text-sm font-black text-zinc-800">{x.par.map(id => capPorId.get(id)?.nombre).join(' + ')}</p>
                                <p className="text-xs text-zinc-500">{x.ps.map(o => o.n).join(', ')}</p>
                            </div>
                        ))}
                    </div>
                )}
                {!ranking.length ? <p className="text-sm text-zinc-400">No hay capacidades por desarrollar con estos filtros.</p> : (
                    <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                        <div className="hidden md:grid grid-cols-[minmax(0,2fr)_auto_90px_90px_minmax(0,2fr)] gap-3 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-zinc-400">
                            <span>Capacidad</span><span>Estado</span><span className="text-center">La necesitan</span><span className="text-center">Destraba ya</span><span>Proyectos y pedidos</span>
                        </div>
                        {ranking.map(({ c, users, unl }) => {
                            const rs = resuelvenla(c);
                            return (
                                <div key={c.id} className="grid gap-x-3 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,2fr)_auto_90px_90px_minmax(0,2fr)] md:items-start">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-zinc-800">{c.nombre}
                                            {edita && <button type="button" onClick={() => abrirForm(c)} className="ml-2 text-xs font-bold text-brand-cyan hover:underline">editar</button>}</p>
                                        {(c.familia || c.nota) && <p className="text-xs text-zinc-500">{[c.familia, c.nota].filter(Boolean).join(' · ')}</p>}
                                        {rs.length > 0 && <p className="text-xs text-zinc-500 flex flex-wrap items-center gap-1 mt-0.5">La resuelve: {rs.map(p => linkProy(p))}</p>}
                                    </div>
                                    <div><EstadoCap c={c} edita={edita} onCambio={onRecargar} /></div>
                                    <p className="text-sm text-zinc-700 md:text-center"><span className="md:hidden text-xs text-zinc-400">La necesitan </span>{users.length}</p>
                                    <p className={`text-sm md:text-center ${unl.length ? 'font-black text-emerald-700' : 'text-zinc-500'}`}><span className="md:hidden text-xs font-normal text-zinc-400">Destraba ya </span>{c.resuelta ? '—' : unl.length}</p>
                                    <div className="flex flex-wrap gap-1">
                                        {users.length ? users.map(o => (o.k === 'p' ? linkProy(o, unl.includes(o))
                                            : <span key={`s${o.id}`} className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] font-bold text-zinc-500">{o.n}</span>))
                                            : <span className="text-xs text-zinc-400">nadie todavía</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                <p className="text-xs text-zinc-400">Para marcar qué necesita un proyecto: abrí su ficha y tocá «Capacidades». Para ver, editar o borrar cualquier capacidad: «Todas las capacidades», arriba.</p>
            </>) : (() => {
                // Quiénes la necesitan: proyectos no cancelados (cualquier etapa) y pedidos sin resolver
                const usan = (id) => proyectos.filter(p => p.estado !== 'CANCELADO' && usoDe('PROYECTO', p.id, 'REQUIERE').includes(id)).length
                    + datos.pedidos.filter(s => usoDe('SOLICITUD', s.id, 'REQUIERE').includes(id)).length;
                const lista = caps.filter(enAmbito);
                return (<>
                    <p className="text-sm text-zinc-600">Todas las capacidades técnicas, por familia: <b>{caps.filter(c => c.resuelta).length}</b> resueltas y <b>{caps.filter(c => !c.resuelta).length}</b> por desarrollar. Acá se crean, se editan, se marcan como resueltas y se borran las que nadie usa.</p>
                    {controles}
                    {formulario}
                    {!lista.length ? <p className="text-sm text-zinc-400">No hay capacidades cargadas.</p> : (
                        <div className="grid gap-3 lg:grid-cols-2">
                            {porFamilia(lista, 'Sin familia').map(([fam, l]) => (
                                <div key={fam} className="rounded-2xl border border-zinc-200 bg-white p-4">
                                    <p className="text-xs font-black uppercase tracking-wide text-zinc-400 mb-2">{fam} <span className="text-zinc-300">{l.length}</span></p>
                                    <div className="flex flex-col divide-y divide-zinc-100">
                                        {l.map(c => {
                                            const n = usan(c.id);
                                            return (
                                                <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                                                    <div className="flex-1 min-w-[160px]">
                                                        <p className="text-sm font-bold text-zinc-800">{c.nombre}</p>
                                                        <p className="text-xs text-zinc-500">{[c.nota, NOMBRE_AMBITO[c.ambito]].filter(Boolean).join(' · ')}</p>
                                                    </div>
                                                    <EstadoCap c={c} edita={edita} onCambio={onRecargar} />
                                                    <span className="text-xs text-zinc-500 w-28">{n ? `la necesitan ${n}` : 'nadie la necesita'}</span>
                                                    {edita && <button type="button" onClick={() => abrirForm(c)} className="text-xs font-bold text-brand-cyan hover:underline">editar</button>}
                                                    {edita && <BorrarCap c={c} n={n} onBorrada={onRecargar} />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>);
            })()}
        </div>
    );
};

const CatalogoVista = ({ sesion, catalogos, version, params = {} }) => {
    const [, setSearchParams] = useSearchParams();
    const [datos, setDatos] = useState(null);
    const [proyectos, setProyectos] = useState([]);
    const sec = SECCIONES.some(s => s[0] === params.sec) ? params.sec : 'capacidades';
    const proyectoId = params.proyecto ? Number(params.proyecto) : null;
    const edita = !!sesion?.esEditor;

    const cargar = useCallback(() => {
        desarrollosService.catalogo().then(setDatos).catch(e => { setDatos({ capacidades: [], uso: [], pedidos: [], variantes: [], opciones: [] }); toast.error(mensajeError(e, 'No se pudo cargar el catálogo.')); });
        desarrollosService.proyectos().then(setProyectos).catch(() => {});
    }, []);
    useEffect(() => { cargar(); }, [cargar, version]);
    useEffect(() => { window.scrollTo({ top: 0 }); }, [sec, proyectoId]);
    const irA = (s) => setSearchParams(sp => { const n = new URLSearchParams(sp); n.set('sec', s); return n; });
    const quitarProyecto = () => setSearchParams(sp => { const n = new URLSearchParams(sp); n.delete('proyecto'); return n; });

    if (!datos) return <Loader2 size={20} className="animate-spin text-zinc-300" />;
    const p = proyectoId ? proyectos.find(x => x.id === proyectoId) : null;
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-0.5">
                    {SECCIONES.map(([k, n]) => (
                        <button key={k} type="button" onClick={() => irA(k)}
                            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[13px] sm:text-sm font-bold whitespace-nowrap ${sec === k ? 'bg-brand-cyan text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>{n}</button>
                    ))}
                </div>
                {proyectoId && sec !== 'opciones' && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand-cyan bg-brand-cyan/10 pl-2.5 pr-1 py-0.5 text-xs font-bold text-brand-cyan">
                        Producto: {p?.nombre || '…'}
                        <button type="button" onClick={quitarProyecto} title="Quitar el filtro" className="p-0.5 hover:text-brand-magenta"><X size={12} /></button>
                    </span>
                )}
            </div>
            {sec === 'capacidades' && <CapacidadesSeccion key={proyectoId || 'todas'} datos={datos} proyectos={proyectos} tipos={catalogos?.tipos || []} proyectoId={proyectoId} edita={edita} onRecargar={cargar} />}
            {sec === 'variantes' && (
                <VariantesSeccion key={proyectoId || 'todas'} datos={datos} proyectos={proyectos} proyectoId={proyectoId} edita={edita}
                    onVariante={(v) => setDatos(d => ({ ...d, variantes: d.variantes.some(x => x.id === v.id) ? d.variantes.map(x => (x.id === v.id ? v : x)) : [...d.variantes, v] }))}
                    onVarianteBorrada={(id) => setDatos(d => ({ ...d, variantes: d.variantes.filter(x => x.id !== id) }))} />
            )}
            {sec === 'opciones' && <OpcionesSeccion datos={datos} edita={edita} onOpcion={(o) => setDatos(d => ({ ...d, opciones: d.opciones.map(x => (x.id === o.id ? o : x)) }))} />}
        </div>
    );
};

export default CatalogoVista;
