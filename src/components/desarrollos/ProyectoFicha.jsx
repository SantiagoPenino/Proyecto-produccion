import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, ChevronDown } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import { btnPri, btnSec, btnCancelar, input, label } from '../servicio-tecnico/ui';
import { Comentarios, Historial, Adjuntos, Desplegable, mensajeError } from './comun';
import { FilaTarea, NuevaTareaEnEtapa, ArticuloBuscador, useEquipo } from './tareas';
import { puntaje, fmtPuntaje, CRITERIOS, fechasSugeridas, nombreEtapaActual } from './reglas';

// Ficha del proyecto (spec-B §3.2-3.5): datos, notas, archivos, etapas, la tarea que sigue, las tareas
// por etapa, enlaces, comentarios, historial, guardar como plantilla y cancelar / reactivar / borrar.
// Lo edita el editor; el resto del equipo la ve (y comenta).

// Texto largo que se guarda al salir; mientras se escribe no lo pisa un refresco
const AreaNotas = ({ valor, disabled, onGuardar }) => {
    const [v, setV] = useState(valor || '');
    const foco = useRef(false);
    useEffect(() => { if (!foco.current) setV(valor || ''); }, [valor]);
    return (
        <textarea className={`${input} min-h-[96px]`} value={v} disabled={disabled} maxLength={20000}
            placeholder="Qué es, para quién, decisiones tomadas, pendientes…"
            onFocus={() => { foco.current = true; }}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => { foco.current = false; if (v.trim() !== (valor || '').trim()) onGuardar(v.trim()); }} />
    );
};
const CampoCorto = ({ valor, max, disabled, onGuardar, placeholder, obligatorio = false }) => {
    const [v, setV] = useState(valor || '');
    useEffect(() => { setV(valor || ''); }, [valor]);
    return <input className={input} value={v} maxLength={max} disabled={disabled} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        onBlur={() => { const l = v.trim(); if (obligatorio && !l) { setV(valor || ''); return; } if (l !== (valor || '')) onGuardar(l); }} />;
};
const Chip = ({ titulo, valor, aviso = false, onClick }) => (
    <button type="button" onClick={onClick} disabled={!onClick}
        className={`px-2.5 py-1 rounded-lg border text-xs text-left disabled:cursor-default ${aviso ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-zinc-200 bg-white text-zinc-700'} ${onClick ? 'hover:border-brand-cyan/50' : ''}`}>
        <span className="text-zinc-400">{titulo}</span> <b>{valor}</b>
    </button>
);
const Seguro = ({ texto, confirmar, onClick, clase = '' }) => {
    const [seguro, setSeguro] = useState(false);
    return (
        <button type="button" onClick={() => (seguro ? onClick() : setSeguro(true))} onBlur={() => setSeguro(false)}
            className={`${btnSec} ${seguro ? '!border-brand-magenta !text-brand-magenta' : ''} ${clase}`}>{seguro ? confirmar : texto}</button>
    );
};

// ── Datos del proyecto ───────────────────────────────────────────────────────
const DatosProyecto = ({ p, edita, esProducto, catalogos, equipo, guardar, foco }) => {
    const [cambiarArticulo, setCambiarArticulo] = useState(false);
    const familias = catalogos?.familias || [];
    const etiquetas = catalogos?.etiquetas || [];
    const etiquetaDelArticulo = p.proIdProducto && p.etiquetaId && p.etiquetaId !== p.etiquetaPropiaId;
    const ref = useRef(null);
    useEffect(() => { if (foco) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [foco]);
    return (
        <div ref={ref} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
                <span className={label}>Desarrollo de</span>
                <Selector value={String(p.tipoId)} onChange={(e) => guardar({ tipoId: Number(e.target.value) })} disabled={!edita} aria-label="Desarrollo de">
                    {(catalogos?.tipos || []).map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
                </Selector>
            </div>
            <div><span className={label}>Código</span><CampoCorto valor={p.codigo} max={20} obligatorio disabled={!edita} onGuardar={(v) => guardar({ codigo: v })} /></div>
            <div>
                <span className={label}>Línea</span>
                <Selector value={p.lineaAreaId || ''} onChange={(e) => guardar({ lineaAreaId: e.target.value || null })} disabled={!edita} aria-label="Línea">
                    <option value="">Sin línea</option>
                    {(catalogos?.lineas || []).map(l => <option key={l.areaId} value={l.areaId}>{l.nombre}</option>)}
                </Selector>
            </div>
            <div>
                <span className={label}>Responsable</span>
                <Selector value={String(p.liderId || '')} onChange={(e) => guardar({ liderId: e.target.value ? Number(e.target.value) : null })} disabled={!edita} aria-label="Responsable" anchoLista={240}>
                    <option value="">Sin asignar</option>
                    {equipo.map(m => <option key={m.usuarioId} value={String(m.usuarioId)}>{m.nombre}</option>)}
                    {p.lider && !equipo.some(m => m.usuarioId === p.liderId) && <option value={String(p.liderId || '')} disabled>{p.lider}</option>}
                </Selector>
                <p className="mt-1 text-xs text-zinc-400">Cambiarlo no cambia el responsable de las tareas.</p>
            </div>
            {esProducto ? (
                <div className="sm:col-span-2">
                    <span className={label}>Artículo del ERP</span>
                    {/* «cambiar»: la línea del artículo se pliega y el buscador se despliega */}
                    <Desplegable abierto={!!p.proIdProducto && !cambiarArticulo}>
                        <p className="text-sm">
                            <span className="font-mono font-bold text-brand-cyan">{p.articuloCodigo}</span> · {p.articuloNombre}
                            {edita && <> <button type="button" onClick={() => setCambiarArticulo(true)} className="text-xs text-zinc-500 hover:underline">cambiar</button>
                                {' · '}<button type="button" onClick={() => guardar({ proIdProducto: null })} className="text-xs text-zinc-500 hover:underline">quitar</button></>}
                        </p>
                    </Desplegable>
                    <Desplegable abierto={edita && !(p.proIdProducto && !cambiarArticulo)}>
                        <ArticuloBuscador onElegir={(a) => { guardar({ proIdProducto: a.id }); setCambiarArticulo(false); }} />
                    </Desplegable>
                    {!edita && !p.proIdProducto && <p className="text-sm text-zinc-400">Sin artículo.</p>}
                    {!p.proIdProducto && p.refErpTexto && <p className="mt-1 text-xs text-amber-700">REF del prototipo: «{p.refErpTexto}» (no está en el maestro).</p>}
                </div>
            ) : (<>
                <div><span className={label}>Proveedor</span><CampoCorto valor={p.proveedor} max={80} disabled={!edita} onGuardar={(v) => guardar({ proveedor: v })} /></div>
                <div><span className={label}>Costo estimado</span><CampoCorto valor={p.costoEstimado} max={40} disabled={!edita} placeholder="Ej.: USD 4.500" onGuardar={(v) => guardar({ costoEstimado: v })} /></div>
            </>)}
            <div><span className={label}>Inicio</span><SelectorFecha value={p.fechaInicio || ''} onChange={(e) => guardar({ fechaInicio: e.target.value || null })} disabled={!edita} vaciable className="w-full" /></div>
            <div><span className={label}>Fecha límite</span><SelectorFecha value={p.fechaLimite || ''} onChange={(e) => guardar({ fechaLimite: e.target.value || null })} disabled={!edita} vaciable className="w-full" /></div>
            <div>
                <span className={label}>Estado</span>
                {p.estado === 'CANCELADO' ? <p className="text-sm font-bold text-zinc-500">Cancelado</p> : (
                    <Selector value={p.estado} onChange={(e) => guardar({ estado: e.target.value })} disabled={!edita} aria-label="Estado">
                        <option value="ACTIVO">Activo</option>
                        <option value="PAUSADO">En pausa</option>
                    </Selector>
                )}
            </div>
            {esProducto && (<>
                <div>
                    <span className={label}>Familia del ERP</span>
                    {p.proIdProducto ? <p className="text-sm text-zinc-700">{p.familia || '—'} <span className="text-xs text-zinc-400">(del artículo)</span></p> : (
                        <Selector value={p.familiaPropia || ''} onChange={(e) => guardar({ familia: e.target.value || null })} disabled={!edita} aria-label="Familia" anchoLista={260}>
                            <option value="">Sin familia</option>
                            {familias.map(f => <option key={f.codStock} value={f.nombre}>{f.nombre}</option>)}
                            {p.familiaPropia && !familias.some(f => f.nombre === p.familiaPropia) && <option value={p.familiaPropia}>{p.familiaPropia}</option>}
                        </Selector>
                    )}
                </div>
                <div>
                    <span className={label}>Etiqueta del ERP</span>
                    {etiquetaDelArticulo ? <p className="text-sm text-zinc-700">{p.etiqueta} <span className="text-xs text-zinc-400">(del artículo)</span></p> : (
                        <Selector value={String(p.etiquetaPropiaId || '')} onChange={(e) => guardar({ etiquetaId: e.target.value ? Number(e.target.value) : null })} disabled={!edita} aria-label="Etiqueta">
                            <option value="">Sin etiqueta</option>
                            {etiquetas.map(et => <option key={et.id} value={String(et.id)}>{et.nombre}</option>)}
                        </Selector>
                    )}
                </div>
            </>)}
            <div className="sm:col-span-2 lg:col-span-3">
                <span className={label}>Puntaje <span className="text-brand-cyan">{fmtPuntaje(puntaje(p))}</span> · se calcula con los cuatro criterios de abajo</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {CRITERIOS.map(([k, etiqueta, bajo, alto]) => (
                        <div key={k}>
                            <span className="block mb-1 text-[11px] font-bold text-zinc-500">{etiqueta}</span>
                            <Selector value={String(p[k] || 3)} onChange={(e) => guardar({ [k]: Number(e.target.value) })} disabled={!edita} aria-label={etiqueta}>
                                {[1, 2, 3, 4, 5].map(n => <option key={n} value={String(n)}>{n === 1 ? `1 · ${bajo}` : n === 5 ? `5 · ${alto}` : String(n)}</option>)}
                            </Selector>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ── Ficha ────────────────────────────────────────────────────────────────────
const ProyectoFicha = ({ id, sesion, catalogos, version, onVolver, onCambio }) => {
    const navigate = useNavigate();
    const equipo = useEquipo();
    const [p, setP] = useState(null);
    const [error, setError] = useState('');
    const [verDatos, setVerDatos] = useState(false);
    const [etapasAbiertas, setEtapasAbiertas] = useState({});
    const [plantilla, setPlantilla] = useState(null); // nombre mientras se guarda como plantilla
    const edita = !!sesion?.esEditor;

    const cargar = useCallback(async () => {
        try { setP(await desarrollosService.proyecto(id)); setError(''); }
        catch (e) { setError(mensajeError(e, 'No se pudo cargar el proyecto.')); }
    }, [id]);
    useEffect(() => { cargar(); }, [cargar, version]);
    useEffect(() => { setEtapasAbiertas({}); setVerDatos(false); setPlantilla(null); }, [id]);
    // Si falta el responsable o la línea, "Datos del proyecto" arranca abierto (como el prototipo)
    useEffect(() => { if (p && (!p.liderId || !p.lineaAreaId) && edita) setVerDatos(true); }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const actualizar = (nuevo) => { setP(nuevo); onCambio?.(nuevo); };
    const guardar = async (cambios) => {
        try { actualizar(await desarrollosService.guardarProyecto(id, cambios)); }
        catch (e) { toast.error(mensajeError(e)); }
    };
    const tipo = catalogos?.tipos?.find(t => t.id === p?.tipoId);
    const esProducto = !!tipo?.esProducto;
    const sugeridas = useMemo(() => (p ? fechasSugeridas(p) : {}), [p]);

    if (error) return <div className="flex flex-col gap-3"><button type="button" onClick={onVolver} className={`${btnSec} self-start`}><ArrowLeft size={15} /> Proyectos</button><p className="text-sm text-brand-magenta">{error}</p></div>;
    if (!p) return <Loader2 size={20} className="animate-spin text-zinc-300" />;

    const actual = p.tareaActual ? p.tareas.find(t => t.id === p.tareaActual.id) : null;
    const etapaAbierta = (e) => (etapasAbiertas[e.id] ?? e.id === p.etapaActual);
    const abrirEtapa = (e) => {
        setEtapasAbiertas(x => ({ ...x, [e.id]: true }));
        setTimeout(() => document.getElementById(`etapa-${e.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    };
    const fila = (t) => (
        <FilaTarea key={t.id} p={p} t={t} equipo={equipo} edita={edita} esProducto={esProducto} sugerida={sugeridas[t.id]} onActualizado={actualizar} />
    );
    const accion = async (fn, ok) => {
        try { const r = await fn(); if (r?.id) actualizar(r); toast.success(ok); return true; }
        catch (e) { toast.error(mensajeError(e)); return false; }
    };

    return (
        <div className="flex flex-col gap-5">
            {/* Encabezado */}
            <div className="flex flex-col gap-3">
                <button type="button" onClick={onVolver} className="self-start inline-flex items-center gap-1 text-sm font-bold text-zinc-500 hover:text-zinc-800"><ArrowLeft size={15} /> Proyectos</button>
                {edita
                    ? <input className="w-full bg-transparent text-xl sm:text-2xl font-black text-zinc-800 outline-none border-b border-transparent focus:border-brand-cyan" defaultValue={p.nombre} key={`${p.id}-${p.nombre}`} maxLength={120}
                        onBlur={(e) => { const v = e.target.value.trim(); if (!v) e.target.value = p.nombre; else if (v !== p.nombre) guardar({ nombre: v }); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    : <h2 className="text-xl sm:text-2xl font-black text-zinc-800">{p.nombre}</h2>}
                <div className="flex flex-wrap gap-1.5">
                    <Chip titulo="Código" valor={p.codigo || '—'} onClick={edita ? () => setVerDatos(true) : null} />
                    {esProducto
                        ? <Chip titulo="Artículo" valor={p.articuloCodigo || p.refErpTexto || 'sin artículo'} aviso={!p.proIdProducto} onClick={edita ? () => setVerDatos(true) : null} />
                        : <Chip titulo="Desarrollo de" valor={tipo?.nombre || '—'} onClick={edita ? () => setVerDatos(true) : null} />}
                    <Chip titulo="Responsable" valor={p.lider || 'sin asignar'} aviso={!p.lider} onClick={edita ? () => setVerDatos(true) : null} />
                    <Chip titulo="Avance" valor={`${p.avance.h}/${p.avance.t}`} />
                    {p.tandas.map(t => <Chip key={t.id} titulo="Tanda" valor={t.nombre} />)}
                    {p.estado !== 'ACTIVO' && <Chip titulo="Estado" valor={p.estado === 'PAUSADO' ? 'En pausa' : 'Cancelado'} aviso />}
                    {p.solicitudId && (
                        <button type="button" onClick={() => navigate(`/desarrollos/bandeja?abrir=${p.solicitudId}`)} className="px-2.5 py-1 text-xs font-bold text-brand-cyan hover:underline">
                            viene de {p.codigoSolicitud || 'un pedido'}
                        </button>
                    )}
                    {edita && <button type="button" onClick={() => setVerDatos(v => !v)} className="px-2.5 py-1 text-xs font-bold text-zinc-500 hover:text-zinc-800">Editar datos</button>}
                </div>
            </div>

            <Desplegable abierto={verDatos} hueco={20}>
                <section className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <h3 className="mb-3 text-sm font-black text-zinc-700">Datos del proyecto</h3>
                    <DatosProyecto p={p} edita={edita} esProducto={esProducto} catalogos={catalogos} equipo={equipo} guardar={guardar} foco={verDatos} />
                </section>
            </Desplegable>

            <section className="flex flex-col gap-2">
                <span className={label}>Descripción y notas</span>
                <AreaNotas valor={p.notas} disabled={!edita} onGuardar={(v) => guardar({ notas: v })} />
            </section>

            <section className="flex flex-col gap-2">
                <span className={label}>Imágenes y archivos</span>
                <Adjuntos entidad="proyecto" id={p.id} editable={edita} version={version} />
                {p.archivosPedido > 0 && (<>
                    <span className="text-xs text-zinc-500">Del pedido {p.codigoSolicitud}:</span>
                    <Adjuntos entidad="solicitud" id={p.solicitudId} version={version} />
                </>)}
            </section>

            {/* Etapas */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
                {p.etapas.map((e, i) => {
                    const ts = p.tareas.filter(t => t.etapaId === e.id && t.estado !== 'NO_APLICA');
                    const h = ts.filter(t => t.estado === 'HECHO').length;
                    const estado = !ts.length ? 'na' : h === ts.length ? 'ok' : e.id === p.etapaActual ? 'cur' : 'pend';
                    return (
                        <button key={e.id} type="button" onClick={() => abrirEtapa(e)}
                            className={`min-w-[120px] flex-1 rounded-xl border px-3 py-2 text-left ${estado === 'cur' ? 'border-2 bg-white' : 'border-zinc-200 bg-white'} ${estado === 'na' ? 'opacity-50' : ''}`}
                            style={{ borderColor: estado === 'cur' ? e.color : undefined, borderTopColor: e.color, borderTopWidth: 3 }}>
                            <span className="block text-xs font-black text-zinc-700">{estado === 'ok' ? `✓ ${e.nombre}` : `${i + 1} · ${e.nombre}`}</span>
                            <span className="block text-[11px] text-zinc-400">{estado === 'na' ? 'no aplica' : `${h} de ${ts.length}`}</span>
                        </button>
                    );
                })}
            </div>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
                {actual ? (<>
                    <span className="text-[11px] font-black uppercase tracking-wide text-brand-cyan">Ahora · {nombreEtapaActual(p)}</span>
                    {fila(actual)}
                </>) : (
                    <p className="text-sm text-zinc-600">{p.estado === 'CANCELADO' ? 'Proyecto cancelado.' : 'Proyecto terminado: todas las tareas están hechas. Queda en «Archivo».'}</p>
                )}
            </section>

            {/* Tareas por etapa */}
            <section className="flex flex-col gap-2">
                {p.etapas.map(e => {
                    const ts = p.tareas.filter(t => t.etapaId === e.id);
                    const aplican = ts.filter(t => t.estado !== 'NO_APLICA');
                    const h = aplican.filter(t => t.estado === 'HECHO').length;
                    const abierta = etapaAbierta(e);
                    return (
                        <div key={e.id} id={`etapa-${e.id}`} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                            <button type="button" onClick={() => setEtapasAbiertas(x => ({ ...x, [e.id]: !abierta }))}
                                className="w-full flex items-center gap-2 px-4 py-3 text-left" style={{ borderLeft: `4px solid ${e.color}` }}>
                                <span className="flex-1 text-sm font-black text-zinc-800">{e.nombre}</span>
                                <span className="text-xs text-zinc-400">{aplican.length ? `${h}/${aplican.length}` : 'no aplica'}</span>
                                <ChevronDown size={16} className={`text-zinc-400 transition-transform ${abierta ? 'rotate-180' : ''}`} />
                            </button>
                            <Desplegable abierto={abierta}>
                                <div className="px-4 pb-3">
                                    {ts.map(fila)}
                                    {!ts.length && <p className="py-2 text-sm text-zinc-400">Sin tareas.</p>}
                                    {edita && <NuevaTareaEnEtapa p={p} etapa={e} onActualizado={actualizar} />}
                                </div>
                            </Desplegable>
                        </div>
                    );
                })}
            </section>

            {/* Enlaces */}
            <div className="flex flex-wrap gap-1.5">
                {esProducto ? (<>
                    <Chip titulo="Muestras ·" valor={p.muestras} onClick={() => navigate(`/desarrollos/muestras?proyecto=${p.id}`)} />
                    <Chip titulo="Variantes ·" valor={p.variantes} onClick={() => navigate(`/desarrollos/catalogo?sec=variantes&proyecto=${p.id}`)} />
                    <Chip titulo="Capacidades ·" valor={p.requiere} onClick={() => navigate(`/desarrollos/catalogo?sec=capacidades&proyecto=${p.id}`)} />
                </>) : (
                    <Chip titulo="Capacidades que resuelve ·" valor={p.resuelve} onClick={() => navigate(`/desarrollos/catalogo?sec=capacidades&proyecto=${p.id}`)} />
                )}
                <button type="button" onClick={() => navigate(`/desarrollos/tareas?proyecto=${p.id}`)} className="px-2.5 py-1 text-xs font-bold text-brand-cyan hover:underline">Sus tareas en la pantalla Tareas</button>
            </div>

            {edita && (
                <section className="flex flex-col">
                    <Desplegable abierto={plantilla === null}>
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => setPlantilla('')} className={btnSec}>Guardar como plantilla</button>
                            <button type="button" onClick={() => navigate('/desarrollos/plantillas')} className="text-sm font-bold text-brand-cyan hover:underline">Ver las plantillas</button>
                            <span className="text-xs text-zinc-400">Guarda este flujo (etapas y tareas) para usarlo en proyectos nuevos.</span>
                        </div>
                    </Desplegable>
                    <Desplegable abierto={plantilla !== null}>
                        {plantilla !== null && <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-zinc-600">Guardar las etapas y tareas de este proyecto como plantilla:</span>
                            <input className={`${input} max-w-xs`} value={plantilla} maxLength={60} autoFocus onChange={(e) => setPlantilla(e.target.value)} placeholder="Nombre de la plantilla" />
                            <button type="button" disabled={!plantilla.trim()} className={btnPri} onClick={async () => {
                                try { await desarrollosService.guardarComoPlantilla(p.id, plantilla.trim()); toast.success(`Plantilla «${plantilla.trim()}» guardada. Ya se puede elegir al crear un proyecto.`); setPlantilla(null); }
                                catch (e) { toast.error(mensajeError(e)); }
                            }}>Guardar plantilla</button>
                            <button type="button" onClick={() => setPlantilla(null)} className={btnCancelar}>cancelar</button>
                        </div>}
                    </Desplegable>
                </section>
            )}

            <section><span className={label}>Comentarios</span><Comentarios entidad="proyecto" id={p.id} puede={!!sesion?.esEquipo} version={version} /></section>
            <Historial entidad="proyecto" id={p.id} version={version} />

            {edita && (
                <section className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4">
                    {p.estado === 'CANCELADO'
                        ? <button type="button" className={btnSec} onClick={() => accion(() => desarrollosService.reactivarProyecto(p.id), `«${p.nombre}» vuelve a la lista.`)}>Reactivar el proyecto</button>
                        : <Seguro texto="Cancelar el proyecto" confirmar="¿Cancelar el proyecto? Tocá de nuevo" onClick={() => accion(() => desarrollosService.cancelarProyecto(p.id), `«${p.nombre}» cancelado.`)} />}
                    <Seguro texto="Borrar el proyecto" confirmar="¿Borrar el proyecto? Tocá de nuevo" onClick={async () => {
                        if (await accion(() => desarrollosService.borrarProyecto(p.id), `«${p.nombre}» borrado.`)) { onCambio?.({ ...p, borrado: true }); onVolver(); }
                    }} />
                    <span className="text-xs text-zinc-400">Cancelar lo guarda fuera de las listas; borrar lo saca del sistema (queda en el historial).</span>
                </section>
            )}
        </div>
    );
};

export default ProyectoFicha;
