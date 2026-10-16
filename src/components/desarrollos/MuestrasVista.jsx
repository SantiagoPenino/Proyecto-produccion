import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Search, Plus, X, ClipboardPaste, ListChecks, ArrowUp, ArrowDown, Check } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import { btnPri, btnSec, btnCancelar, campoFiltro, input, label } from '../servicio-tecnico/ui';
import { Adjuntos, Galeria, Desplegable, fmtD, mensajeError } from './comun';
import { coincide, hoy, diaDe } from './reglas';

// La misma ficha de la orden que abre la consulta de órdenes (en solo lectura); se carga recién al usarla
const OrderDetailModal = lazy(() => import('../production/components/OrderDetailModal'));

// Muestras (spec-C §4): cada muestra física mandada a producir, con sus órdenes del sistema (y el estado en
// vivo de cada orden), los proyectos a los que pertenece, estado del recorrido, tildes, ronda, fecha,
// comentario y fotos. Cargan y cambian: el equipo (también colaboradores). Las listas de estados y tildes: el editor.

const TONOS = [['gris', 'Gris'], ['azul', 'Azul'], ['ambar', 'Ámbar'], ['verde', 'Verde'], ['rojo', 'Rojo']];
const PUNTO = { azul: 'bg-brand-cyan', ambar: 'bg-amber-400', verde: 'bg-emerald-500', rojo: 'bg-brand-magenta', gris: 'bg-zinc-400' };
const BOTON_TONO = {
    azul: 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan',
    ambar: 'border-amber-300 bg-amber-50 text-amber-700',
    verde: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    rojo: 'border-brand-magenta/40 bg-brand-magenta/10 text-brand-magenta',
    gris: 'border-zinc-200 bg-zinc-50 text-zinc-600',
};
const ORDENES = [['nuevas', 'Más nuevas'], ['viejas', 'Más viejas'], ['estado', 'Por estado'], ['proyecto', 'Por proyecto']];
const SIN_ESTADO = { id: null, nombre: 'Sin estado', tono: 'gris' };
const SI_PEGADO = /^(true|verdadero|si|sí|x|✓|✔|1)$/i;

const textoOrden = (o) => [o.numero ? `#${o.numero}` : '', o.nombre || ''].filter(Boolean).join(' ');
const tituloMuestra = (m) => (m.ordenes.length ? m.ordenes.map(textoOrden).join(' · ') : 'Muestra sin orden');
const fechaDe = (m) => m.fechaEnvio || diaDe(m.creado) || '';

// Cada fila de la planilla es una muestra: número, nombre, casilla, comentario (spec-C §4.5)
const leerPegado = (txt) => String(txt || '').split(/\r?\n/).map(l => l.split('\t').map(c => c.trim()))
    .filter(c => c[0] || c[1])
    .map(c => ({ numero: c[0] || '', nombre: c[1] || '', marcada: SI_PEGADO.test(c[2] || ''), comentario: c.slice(3).filter(Boolean).join(' · ') }));

// Estado del sistema de una orden enlazada (o que no se encontró)
const EstadoOrden = ({ o }) => {
    if (!o.numero) return null;
    if (!o.ordenId) return <span className="text-[11px] text-zinc-400" title="Ese número no está en las órdenes del sistema">no está en el sistema</span>;
    return <span className="text-[11px] text-zinc-500">{[o.ordenArea, o.ordenEstado].filter(Boolean).join(' · ') || 'en el sistema'}</span>;
};

// ── Editor de una muestra (nueva o existente), en línea ─────────────────────
const EditorMuestra = ({ inicial, estados, tildes, proyectos, onGuardada, onCancelar, onBorrada }) => {
    const [d, setD] = useState(inicial);
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [seguro, setSeguro] = useState(false);
    const [fotosNuevas, setFotosNuevas] = useState([]); // muestra nueva: se suben después de guardar
    const [enSistema, setEnSistema] = useState({}); // numero → { ordenId, area, estado } | false
    const fotoRef = useRef(null);
    const esNueva = !d.id;
    const cambiar = (k, v) => setD(x => ({ ...x, [k]: v }));
    const cambiarOrden = (i, k, v) => setD(x => ({ ...x, ordenes: x.ordenes.map((o, j) => (j === i ? { ...o, [k]: v } : o)) }));

    // Al salir del número: se busca la orden en el sistema; si existe y no tiene nombre, se completa con su descripción
    const buscarOrden = async (i) => {
        const num = String(d.ordenes[i]?.numero || '').trim();
        if (!num || enSistema[num] !== undefined) return;
        try {
            const o = await desarrollosService.orden(num);
            setEnSistema(m => ({ ...m, [num]: o }));
            if (o.descripcion) setD(x => ({ ...x, ordenes: x.ordenes.map((y, j) => (j === i && !String(y.nombre || '').trim() ? { ...y, nombre: o.descripcion.slice(0, 120) } : y)) }));
        } catch (e) {
            if (e?.response?.status === 404) setEnSistema(m => ({ ...m, [num]: false }));
        }
    };

    const guardar = async () => {
        const ordenes = d.ordenes.map(o => ({ numero: String(o.numero || '').trim(), nombre: String(o.nombre || '').trim() })).filter(o => o.numero || o.nombre);
        if (!ordenes.length) { setError('Poné al menos un número o nombre de orden.'); return; }
        setGuardando(true);
        setError('');
        try {
            const m = await desarrollosService.guardarMuestra(d.id, {
                ordenes, proyectos: d.proyectos, estadoId: d.estadoId, fechaEnvio: d.fechaEnvio || null,
                ronda: d.ronda === '' ? null : Number(d.ronda), tildes: d.tildes, comentario: d.comentario,
            });
            let final = m;
            for (const f of fotosNuevas) {
                try { await desarrollosService.adjuntar('muestra', m.id, [f]); }
                catch (e) { toast.error(mensajeError(e, `No se pudo subir ${f.name}.`)); break; }
            }
            if (fotosNuevas.length) final = (await desarrollosService.muestras()).find(x => x.id === m.id) || m;
            toast.success(esNueva ? 'Muestra registrada.' : 'Muestra guardada.');
            onGuardada(final, esNueva);
        } catch (e) { setError(mensajeError(e, 'No se pudo guardar.')); }
        finally { setGuardando(false); }
    };
    const borrar = async () => {
        if (!seguro) { setSeguro(true); return; }
        try { await desarrollosService.borrarMuestra(d.id); toast.success('Muestra borrada.'); onBorrada(d.id); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo borrar.')); setSeguro(false); }
    };
    const alTeclear = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); guardar(); } };

    const vinculables = proyectos.filter(p => p.estado !== 'CANCELADO' && !d.proyectos.includes(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return (
        <div className="rounded-2xl border-2 border-brand-cyan/30 bg-white p-4 flex flex-col gap-4" onKeyDown={alTeclear}>
            <p className="text-sm font-black text-zinc-800">{esNueva ? 'Nueva muestra' : 'Editar muestra'}</p>
            <div>
                <span className={label}>Órdenes del sistema</span>
                <div className="flex flex-col gap-2">
                    {d.ordenes.map((o, i) => {
                        const num = String(o.numero || '').trim();
                        const info = enSistema[num];
                        return (
                            <div key={i} className="flex flex-col gap-0.5">
                                <div className="flex gap-2">
                                    <input value={o.numero} onChange={(e) => cambiarOrden(i, 'numero', e.target.value)} onBlur={() => buscarOrden(i)} maxLength={40}
                                        placeholder="N.º de orden" className={`${input} !w-40 shrink-0 font-mono`} autoFocus={esNueva && i === 0} />
                                    <input value={o.nombre} onChange={(e) => cambiarOrden(i, 'nombre', e.target.value)} maxLength={120} placeholder="Nombre de la orden" className={input} />
                                    {d.ordenes.length > 1 && (
                                        <button type="button" onClick={() => cambiar('ordenes', d.ordenes.filter((_, j) => j !== i))} title="Quitar" className="px-2 text-zinc-400 hover:text-brand-magenta"><X size={16} /></button>
                                    )}
                                </div>
                                {num && info && <span className="text-[11px] text-emerald-700 pl-1">En el sistema: {[info.area, info.estado].filter(Boolean).join(' · ')}</span>}
                                {num && info === false && <span className="text-[11px] text-zinc-400 pl-1">Ese número no está en las órdenes del sistema: queda cargado igual.</span>}
                            </div>
                        );
                    })}
                    <button type="button" onClick={() => cambiar('ordenes', [...d.ordenes, { numero: '', nombre: '' }])} className="self-start text-xs font-bold text-brand-cyan hover:underline">+ Otra orden</button>
                </div>
            </div>
            <div>
                <span className={label}>Proyectos</span>
                <div className="flex flex-wrap items-center gap-2">
                    {d.proyectos.map(pid => {
                        const p = proyectos.find(x => x.id === pid);
                        return (
                            <span key={pid} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 pl-2.5 pr-1 py-0.5 text-xs font-bold text-zinc-700">
                                {p?.nombre || 'proyecto borrado'}
                                <button type="button" onClick={() => cambiar('proyectos', d.proyectos.filter(x => x !== pid))} title="Desvincular" className="p-0.5 text-zinc-400 hover:text-brand-magenta"><X size={12} /></button>
                            </span>
                        );
                    })}
                    {vinculables.length > 0 && (
                        <div className="min-w-[240px]">
                            <Selector value="" onChange={(e) => e.target.value && cambiar('proyectos', [...d.proyectos, Number(e.target.value)])} aria-label="Vincular un proyecto" anchoLista={340}>
                                <option value="">{d.proyectos.length ? '+ Vincular otro proyecto…' : '+ Vincular un proyecto…'}</option>
                                {vinculables.map(p => <option key={p.id} value={String(p.id)}>{p.nombre}{p.codigo ? ` · ${p.codigo}` : ''}</option>)}
                            </Selector>
                        </div>
                    )}
                </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
                <div>
                    <span className={label}>Estado</span>
                    <Selector value={String(d.estadoId || '')} onChange={(e) => cambiar('estadoId', e.target.value ? Number(e.target.value) : null)} aria-label="Estado">
                        {!d.estadoId && <option value="">Sin estado</option>}
                        {estados.map(e => <option key={e.id} value={String(e.id)}>{e.nombre}</option>)}
                    </Selector>
                </div>
                <div><span className={label}>Fecha de envío</span><SelectorFecha value={d.fechaEnvio || ''} onChange={(e) => cambiar('fechaEnvio', e.target.value)} vaciable className="w-full" /></div>
                <div>
                    <span className={label}>Ronda</span>
                    <input type="number" min={1} max={99} value={d.ronda} placeholder="1" className={input}
                        onChange={(e) => { const v = e.target.value; cambiar('ronda', v === '' ? '' : String(Math.min(99, Math.max(1, parseInt(v, 10) || 1)))); }} />
                </div>
            </div>
            {tildes.length > 0 && (
                <div>
                    <span className={label}>Tildes</span>
                    <div className="flex flex-wrap gap-2">
                        {tildes.map(t => {
                            const on = d.tildes.includes(t.id);
                            return (
                                <button key={t.id} type="button" onClick={() => cambiar('tildes', on ? d.tildes.filter(x => x !== t.id) : [...d.tildes, t.id])}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${on ? 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300'}`}>
                                    {on && <Check size={12} strokeWidth={3} />}{t.nombre}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            <div>
                <span className={label}>Comentario</span>
                <textarea value={d.comentario} onChange={(e) => cambiar('comentario', e.target.value)} maxLength={2000} rows={3}
                    placeholder="Qué se espera, qué respondieron, qué falta…" className={`${input} resize-y`} />
            </div>
            <div>
                <span className={label}>Fotos</span>
                {esNueva ? (
                    <div className="flex flex-wrap items-center gap-2">
                        {fotosNuevas.map((f, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 pl-2.5 pr-1 py-0.5 text-xs text-zinc-600">
                                {f.name}
                                <button type="button" onClick={() => setFotosNuevas(l => l.filter((_, j) => j !== i))} title="Quitar" className="p-0.5 text-zinc-400 hover:text-brand-magenta"><X size={12} /></button>
                            </span>
                        ))}
                        <input ref={fotoRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { setFotosNuevas(l => [...l, ...e.target.files]); e.target.value = ''; }} />
                        <button type="button" onClick={() => fotoRef.current?.click()} className={btnSec}>Elegir fotos</button>
                        <span className="text-xs text-zinc-400">Se suben al guardar.</span>
                    </div>
                ) : <Adjuntos entidad="muestra" id={d.id} editable accept="image/*" textoBoton="Subir fotos" ayuda="Fotos de la muestra." />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={guardar} disabled={guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />}Guardar</button>
                <button type="button" onClick={onCancelar} className={btnCancelar}>Cancelar</button>
                {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
                <div className="flex-1" />
                {!esNueva && (
                    <button type="button" onClick={borrar} onBlur={() => setSeguro(false)} className={`${btnCancelar} ${seguro ? '!text-brand-magenta' : ''}`}>
                        {seguro ? '¿Borrar esta muestra? Tocá de nuevo' : 'Borrar'}
                    </button>
                )}
            </div>
        </div>
    );
};

// ── Pegar desde planilla ───────────────────────────────────────────────────
const PanelPegar = ({ estados, proyectoId, onListo, onCerrar }) => {
    const [txt, setTxt] = useState('');
    const [si, setSi] = useState(String((estados[1] || estados[0])?.id || ''));
    const [no, setNo] = useState(String(estados[0]?.id || ''));
    const [error, setError] = useState('');
    const [cargando, setCargando] = useState(false);
    const filas = useMemo(() => leerPegado(txt), [txt]);
    const cargar = async () => {
        if (!filas.length) { setError('No encontré filas para cargar.'); return; }
        setCargando(true);
        setError('');
        try {
            const r = await desarrollosService.pegarMuestras({ filas, estadoSi: Number(si) || null, estadoNo: Number(no) || null, proyectoId: proyectoId || null });
            toast.success(`${r.cargadas} ${r.cargadas === 1 ? 'muestra cargada' : 'muestras cargadas'}${r.repetidas ? ` · ${r.repetidas} ya estaban (mismo número de orden)` : ''}.`);
            onListo();
        } catch (e) { setError(mensajeError(e, 'No se pudieron cargar.')); }
        finally { setCargando(false); }
    };
    return (
        <div className="rounded-2xl border-2 border-brand-cyan/30 bg-white p-4 flex flex-col gap-3">
            <p className="text-sm font-black text-zinc-800">Pegar desde planilla</p>
            <p className="text-sm text-zinc-600">Copiá filas de la planilla (columnas: número de orden, nombre, casilla, comentario) y pegalas acá. Cada fila es una muestra; las órdenes que ya están cargadas no se repiten.</p>
            <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={6} autoFocus placeholder={'SUB-31584⇥Windflags tela bandera⇥FALSE⇥avisado'} className={`${input} font-mono text-xs resize-y`} />
            <div className="grid gap-3 sm:grid-cols-2">
                <div><span className={label}>Casilla tildada =</span>
                    <Selector value={si} onChange={(e) => setSi(e.target.value)} aria-label="Casilla tildada">{estados.map(e => <option key={e.id} value={String(e.id)}>{e.nombre}</option>)}</Selector></div>
                <div><span className={label}>Sin tildar =</span>
                    <Selector value={no} onChange={(e) => setNo(e.target.value)} aria-label="Sin tildar">{estados.map(e => <option key={e.id} value={String(e.id)}>{e.nombre}</option>)}</Selector></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={cargar} disabled={cargando} className={btnPri}>{cargando && <Loader2 size={15} className="animate-spin" />}Cargar{filas.length ? ` ${filas.length}` : ''}</button>
                <button type="button" onClick={onCerrar} className={btnCancelar}>Cancelar</button>
                {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
            </div>
        </div>
    );
};

// ── Estados y tildes (editor) ──────────────────────────────────────────────
const PanelListas = ({ onGuardadas, onCerrar }) => {
    const [l, setL] = useState(null);
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    useEffect(() => {
        desarrollosService.listasMuestras().then(setL).catch(e => { toast.error(mensajeError(e, 'No se pudieron cargar las listas.')); onCerrar(); });
    }, [onCerrar]);
    if (!l) return <Loader2 size={18} className="animate-spin text-zinc-300" />;
    const cambiarE = (i, k, v) => setL(x => ({ ...x, estados: x.estados.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }));
    const mover = (i, dir) => setL(x => { const a = [...x.estados]; [a[i], a[i + dir]] = [a[i + dir], a[i]]; return { ...x, estados: a }; });
    const guardar = async () => {
        if ([...l.estados, ...l.tildes].some(x => !String(x.nombre || '').trim())) { setError('Hay un nombre vacío.'); return; }
        setGuardando(true);
        setError('');
        try {
            await desarrollosService.guardarListasMuestras({
                estados: l.estados.map(e => ({ id: e.id || null, nombre: e.nombre.trim(), tono: e.tono || 'gris' })),
                tildes: l.tildes.map(t => ({ id: t.id || null, nombre: t.nombre.trim() })),
            });
            toast.success('Listas guardadas.');
            onGuardadas();
        } catch (e) { setError(mensajeError(e, 'No se pudo guardar: solo quien edita Desarrollos puede cambiar estas listas.')); }
        finally { setGuardando(false); }
    };
    return (
        <div className="rounded-2xl border-2 border-brand-cyan/30 bg-white p-4 flex flex-col gap-4">
            <div>
                <p className="text-sm font-black text-zinc-800">Estados</p>
                <p className="text-xs text-zinc-500 mb-2">En qué punto del recorrido está la muestra. El orden de esta lista es el orden del recorrido.</p>
                <div className="flex flex-col gap-2">
                    {l.estados.map((e, i) => (
                        <div key={e.id || e.k} className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PUNTO[e.tono] || PUNTO.gris}`} />
                            <input value={e.nombre} onChange={(ev) => cambiarE(i, 'nombre', ev.target.value)} maxLength={60} className={`${input} !w-auto flex-1 min-w-0`} />
                            <div className="w-28 shrink-0"><Selector value={e.tono} onChange={(ev) => cambiarE(i, 'tono', ev.target.value)} aria-label="Color">{TONOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Selector></div>
                            <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} title="Subir" className="p-1.5 text-zinc-400 hover:text-brand-cyan disabled:opacity-30"><ArrowUp size={15} /></button>
                            <button type="button" disabled={i === l.estados.length - 1} onClick={() => mover(i, 1)} title="Bajar" className="p-1.5 text-zinc-400 hover:text-brand-cyan disabled:opacity-30"><ArrowDown size={15} /></button>
                            <button type="button" disabled={!!e.usos || l.estados.length === 1} onClick={() => setL(x => ({ ...x, estados: x.estados.filter((_, j) => j !== i) }))}
                                title={e.usos ? `Lo usan ${e.usos} muestras: cambialas de estado antes de quitarlo` : 'Quitar'} className="p-1.5 text-zinc-400 hover:text-brand-magenta disabled:opacity-30"><X size={15} /></button>
                        </div>
                    ))}
                    <button type="button" onClick={() => setL(x => ({ ...x, estados: [...x.estados, { k: `n${Date.now()}`, nombre: '', tono: 'gris', usos: 0 }] }))} className="self-start text-xs font-bold text-brand-cyan hover:underline">+ Estado</button>
                </div>
            </div>
            <div>
                <p className="text-sm font-black text-zinc-800">Tildes</p>
                <p className="text-xs text-zinc-500 mb-2">Marcas sueltas que no son un paso del recorrido. Una muestra puede tener varias.</p>
                <div className="flex flex-col gap-2">
                    {l.tildes.map((t, i) => (
                        <div key={t.id || t.k} className="flex items-center gap-2">
                            <input value={t.nombre} onChange={(ev) => setL(x => ({ ...x, tildes: x.tildes.map((y, j) => (j === i ? { ...y, nombre: ev.target.value } : y)) }))} maxLength={40} className={`${input} !w-auto flex-1 min-w-0 sm:max-w-sm`} />
                            <button type="button" disabled={!!t.usos} onClick={() => setL(x => ({ ...x, tildes: x.tildes.filter((_, j) => j !== i) }))}
                                title={t.usos ? `Lo tienen ${t.usos} muestras: destildalas antes de quitarlo` : 'Quitar'} className="p-1.5 text-zinc-400 hover:text-brand-magenta disabled:opacity-30"><X size={15} /></button>
                        </div>
                    ))}
                    <button type="button" onClick={() => setL(x => ({ ...x, tildes: [...x.tildes, { k: `n${Date.now()}`, nombre: '', usos: 0 }] }))} className="self-start text-xs font-bold text-brand-cyan hover:underline">+ Tilde</button>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={guardar} disabled={guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />}Guardar listas</button>
                <button type="button" onClick={onCerrar} className={btnCancelar}>Cancelar</button>
                {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
            </div>
        </div>
    );
};

// ── Tarjeta ────────────────────────────────────────────────────────────────
const Tarjeta = ({ m, estados, tildes, proyectos, puede, onCambio, onEditar, onVerOrden }) => {
    const navigate = useNavigate();
    const estado = estados.find(e => e.id === m.estadoId) || SIN_ESTADO;
    const cambiarEstado = async (v) => {
        try { onCambio(await desarrollosService.estadoMuestra(m.id, Number(v))); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
    };
    const tildar = async (t) => {
        try { onCambio(await desarrollosService.tildeMuestra(m.id, t.id, !m.tildes.includes(t.id))); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
    };
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-[220px] flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {m.ordenes.length ? m.ordenes.map((o, i) => (o.ordenId ? (
                            <button key={i} type="button" onClick={() => onVerOrden(o)} title="Ver la orden"
                                className="inline-flex flex-wrap items-baseline gap-x-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-sm text-zinc-700 text-left hover:border-brand-cyan/50">
                                <b className="font-mono text-brand-cyan">#{o.numero}</b>{o.nombre}<EstadoOrden o={o} />
                            </button>
                        ) : (
                            <span key={i} className="inline-flex flex-wrap items-baseline gap-x-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-sm text-zinc-700"
                                title={o.numero ? 'Ese número no está en las órdenes del sistema' : ''}>
                                {o.numero && <b className="font-mono">#{o.numero}</b>}{o.nombre}<EstadoOrden o={o} />
                            </span>
                        ))) : <span className="text-sm text-zinc-400">sin orden</span>}
                        {m.ronda && <span className="text-xs font-bold text-zinc-500">Ronda {m.ronda}</span>}
                    </div>
                    <p className="text-xs text-zinc-500 flex flex-wrap gap-x-2">
                        {m.proyectos.length ? m.proyectos.map(pid => {
                            const p = proyectos.find(x => x.id === pid);
                            return p ? <button key={pid} type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${pid}`)} className="font-bold text-brand-cyan hover:underline">{p.nombre}</button>
                                : <span key={pid}>proyecto borrado</span>;
                        }) : <span>sin proyecto</span>}
                        <span className="text-zinc-400">{m.fechaEnvio ? `enviada el ${fmtD(m.fechaEnvio)}` : `cargada el ${fmtD(diaDe(m.creado))}`}{m.quien ? ` · ${m.quien}` : ''}</span>
                    </p>
                </div>
                <div className="w-56 max-w-full">
                    <Selector value={String(m.estadoId || '')} onChange={(e) => cambiarEstado(e.target.value)} disabled={!puede} aria-label="Estado"
                        claseBoton={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold text-left outline-none disabled:cursor-default ${BOTON_TONO[estado.tono] || BOTON_TONO.gris}`}>
                        {!m.estadoId && <option value="">Sin estado</option>}
                        {estados.map(e => <option key={e.id} value={String(e.id)}>{e.nombre}</option>)}
                    </Selector>
                </div>
                {puede && <button type="button" onClick={onEditar} className={btnSec}>Editar</button>}
            </div>
            {tildes.length > 0 && (puede || m.tildes.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                    {tildes.filter(t => puede || m.tildes.includes(t.id)).map(t => {
                        const on = m.tildes.includes(t.id);
                        return (
                            <button key={t.id} type="button" disabled={!puede} onClick={() => tildar(t)}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${on ? 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300'} disabled:cursor-default`}>
                                {on && <Check size={11} strokeWidth={3} />}{t.nombre}
                            </button>
                        );
                    })}
                </div>
            )}
            {m.comentario && <p className="whitespace-pre-wrap text-sm text-zinc-700">{m.comentario}</p>}
            {m.fotos.length > 0 && <Galeria lista={m.fotos} />}
        </div>
    );
};

const MuestrasVista = ({ sesion, catalogos, version, params = {}, onCatalogos }) => {
    const [, setSearchParams] = useSearchParams();
    const [muestras, setMuestras] = useState(null);
    const [proyectos, setProyectos] = useState([]);
    const [q, setQ] = useState(params.q || '');
    const [orden, setOrden] = useState('nuevas');
    const [estadoF, setEstadoF] = useState(undefined); // undefined = todas; null = sin estado
    const [tildesF, setTildesF] = useState([]);
    const [panel, setPanel] = useState(params.nueva && sesion?.esEquipo ? 'nueva' : null); // nueva | pegar | listas
    const [editando, setEditando] = useState(null);
    const [verOrden, setVerOrden] = useState(null); // { id, area }
    const puede = !!sesion?.esEquipo;
    const adm = !!sesion?.esEditor;
    const proyectoF = params.proyecto ? Number(params.proyecto) : null;
    const estados = catalogos?.muestraEstados || [];
    const tildes = catalogos?.muestraTildes || [];

    const cargar = useCallback(() => {
        desarrollosService.muestras().then(setMuestras).catch(e => { setMuestras([]); toast.error(mensajeError(e, 'No se pudieron cargar las muestras.')); });
        desarrollosService.proyectosOpciones().then(setProyectos).catch(() => {});
    }, []);
    useEffect(() => { cargar(); }, [cargar, version]);
    // Llegar con parámetros: {q} busca y limpia filtros; {proyecto} filtra y limpia la búsqueda; {nueva} abre el alta
    useEffect(() => { if (params.q !== undefined) { setQ(params.q); setEstadoF(undefined); setTildesF([]); } }, [params.q]);
    useEffect(() => { if (params.proyecto) { setQ(''); setEstadoF(undefined); setTildesF([]); } }, [params.proyecto]);
    useEffect(() => { if (params.nueva && puede) setPanel('nueva'); }, [params.nueva, puede]);
    const quitarProyecto = () => setSearchParams(sp => { const n = new URLSearchParams(sp); n.delete('proyecto'); return n; });
    const cerrarPanel = useCallback(() => {
        setPanel(null);
        if (params.nueva) setSearchParams(sp => { const n = new URLSearchParams(sp); n.delete('nueva'); return n; });
    }, [params.nueva, setSearchParams]);

    const nombreProy = useCallback((pid) => proyectos.find(p => p.id === pid)?.nombre || '', [proyectos]);
    const base = useMemo(() => (muestras || []).filter(m => (!proyectoF || m.proyectos.includes(proyectoF))
        && coincide(q, ...m.ordenes.flatMap(o => [o.numero, o.nombre]), ...m.proyectos.map(nombreProy), m.comentario, (estados.find(e => e.id === m.estadoId) || SIN_ESTADO).nombre)),
    [muestras, proyectoF, q, nombreProy, estados]);
    const huerfanos = useMemo(() => (base.some(m => !estados.some(e => e.id === m.estadoId)) ? [SIN_ESTADO] : []), [base, estados]);
    const visibles = useMemo(() => {
        const l = base.filter(m => (estadoF === undefined || (estadoF === null ? !estados.some(e => e.id === m.estadoId) : m.estadoId === estadoF))
            && tildesF.every(t => m.tildes.includes(t)));
        const porFecha = (a, b) => fechaDe(b).localeCompare(fechaDe(a)) || b.id - a.id;
        const idx = (m) => { const i = estados.findIndex(e => e.id === m.estadoId); return i < 0 ? 99 : i; };
        if (orden === 'viejas') return l.sort((a, b) => -porFecha(a, b));
        if (orden === 'estado') return l.sort((a, b) => (idx(a) - idx(b)) || porFecha(a, b));
        if (orden === 'proyecto') {
            // Sin proyecto, al final (en el prototipo quedaban primeras: spec-C §7.27)
            const clave = (m) => nombreProy(m.proyectos[0]);
            return l.sort((a, b) => (!clave(a) - !clave(b)) || clave(a).localeCompare(clave(b), 'es') || porFecha(a, b));
        }
        return l.sort(porFecha);
    }, [base, estadoF, tildesF, orden, estados, nombreProy]);

    const reemplazar = (m) => setMuestras(l => l.map(x => (x.id === m.id ? m : x)));
    const nuevoBorrador = () => ({
        id: null, ordenes: [{ numero: '', nombre: '' }], proyectos: proyectoF ? [proyectoF] : [], estadoId: estados[0]?.id || null,
        fechaEnvio: hoy(), ronda: '', tildes: [], comentario: '',
    });
    const borradorDe = (m) => ({ id: m.id, ordenes: m.ordenes.length ? m.ordenes.map(o => ({ numero: o.numero || '', nombre: o.nombre || '' })) : [{ numero: '', nombre: '' }],
        proyectos: [...m.proyectos], estadoId: m.estadoId, fechaEnvio: m.fechaEnvio || '', ronda: m.ronda ? String(m.ronda) : '', tildes: [...m.tildes], comentario: m.comentario || '' });

    if (!muestras) return <Loader2 size={20} className="animate-spin text-zinc-300" />;
    const chip = (activo) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${activo ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`;
    const cuenta = (fn) => base.filter(fn).length;
    const proyFiltro = proyectoF ? proyectos.find(p => p.id === proyectoF) : null;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 text-sm text-zinc-500"><b className="text-zinc-800">{muestras.length}</b> {muestras.length === 1 ? 'muestra' : 'muestras'}</p>
                {puede && (<>
                    {adm && <button type="button" onClick={() => setPanel(p => (p === 'listas' ? null : 'listas'))} className={btnSec}><ListChecks size={15} className="text-brand-cyan" /> Estados y tildes</button>}
                    <button type="button" onClick={() => setPanel(p => (p === 'pegar' ? null : 'pegar'))} className={btnSec}><ClipboardPaste size={15} className="text-brand-cyan" /> Pegar desde planilla</button>
                    <button type="button" onClick={() => setPanel('nueva')} className={btnPri}><Plus size={15} /> Nueva muestra</button>
                </>)}
            </div>

            <Desplegable abierto={panel === 'listas'} hueco={16}>
                <PanelListas onCerrar={cerrarPanel} onGuardadas={() => { cerrarPanel(); onCatalogos?.(); cargar(); }} />
            </Desplegable>
            <Desplegable abierto={panel === 'pegar'} hueco={16}>
                <PanelPegar estados={estados} proyectoId={proyectoF} onCerrar={cerrarPanel} onListo={() => { cerrarPanel(); cargar(); }} />
            </Desplegable>
            <Desplegable abierto={panel === 'nueva'} hueco={16}>
                <EditorMuestra key="nueva" inicial={nuevoBorrador()} estados={estados} tildes={tildes} proyectos={proyectos}
                    onCancelar={cerrarPanel} onBorrada={() => {}}
                    onGuardada={(m) => { setMuestras(l => [m, ...l]); cerrarPanel(); }} />
            </Desplegable>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número u orden del sistema, proyecto o comentario" className={`${campoFiltro} w-full pl-9`} />
                </div>
                <Selector filtro resaltar={false} value={orden} onChange={(e) => setOrden(e.target.value)} aria-label="Ordenar" renderValor={o => `Ordenar: ${o?.texto || ''}`}>
                    {ORDENES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </Selector>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => setEstadoF(undefined)} className={chip(estadoF === undefined)}>Todas <span className="text-zinc-400">{base.length}</span></button>
                {[...estados, ...huerfanos].map(e => (
                    <button key={e.id ?? 'sin'} type="button" onClick={() => setEstadoF(e.id)} className={chip(estadoF === e.id)}>
                        <span className={`w-2 h-2 rounded-full ${PUNTO[e.tono] || PUNTO.gris}`} />{e.nombre}
                        <span className="text-zinc-400">{cuenta(m => (e.id === null ? !estados.some(x => x.id === m.estadoId) : m.estadoId === e.id))}</span>
                    </button>
                ))}
                {proyectoF && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand-cyan bg-brand-cyan/10 pl-2.5 pr-1 py-0.5 text-xs font-bold text-brand-cyan">
                        Proyecto: {proyFiltro?.nombre || '…'}
                        <button type="button" onClick={quitarProyecto} title="Quitar el filtro" className="p-0.5 hover:text-brand-magenta"><X size={12} /></button>
                    </span>
                )}
            </div>
            {tildes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wide text-zinc-400">Tildes</span>
                    {tildes.map(t => {
                        const on = tildesF.includes(t.id);
                        return (
                            <button key={t.id} type="button" onClick={() => setTildesF(l => (on ? l.filter(x => x !== t.id) : [...l, t.id]))} className={chip(on)}>
                                <Check size={11} strokeWidth={3} />{t.nombre} <span className="text-zinc-400">{cuenta(m => m.tildes.includes(t.id))}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {!visibles.length ? (
                <p className="text-sm text-zinc-400">{muestras.length ? 'Ninguna muestra coincide con el filtro.' : 'Todavía no hay muestras. Cargá la primera con «+ Nueva muestra».'}</p>
            ) : visibles.map(m => (
                // Editar: la tarjeta se pliega y el editor se despliega en su lugar
                <div key={m.id} className="flex flex-col">
                    <Desplegable abierto={editando === m.id}>
                        <EditorMuestra inicial={borradorDe(m)} estados={estados} tildes={tildes} proyectos={proyectos}
                            onCancelar={() => { setEditando(null); cargar(); }}
                            onBorrada={(id) => { setMuestras(l => l.filter(x => x.id !== id)); setEditando(null); }}
                            onGuardada={(n) => { reemplazar(n); setEditando(null); cargar(); }} />
                    </Desplegable>
                    <Desplegable abierto={editando !== m.id}>
                        <Tarjeta m={m} estados={estados} tildes={tildes} proyectos={proyectos} puede={puede}
                            onCambio={reemplazar} onEditar={() => setEditando(m.id)} onVerOrden={(o) => setVerOrden({ id: o.ordenId, area: o.ordenArea })} />
                    </Desplegable>
                </div>
            ))}
            {verOrden && (
                <Suspense fallback={null}>
                    <OrderDetailModal order={verOrden} readOnly onClose={() => { setVerOrden(null); cargar(); }} />
                </Suspense>
            )}
        </div>
    );
};

export default MuestrasVista;
