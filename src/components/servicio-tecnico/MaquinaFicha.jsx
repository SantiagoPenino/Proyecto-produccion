import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { X, Loader2, Cog, Plus, Pencil, Trash2, Paperclip, User, Clock } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { comprimirImagen } from '../../utils/comprimirImagen';
import {
    estado as estadoInfo, prioridad as prioridadInfo, resultado as resultadoInfo, estadoEquipo,
    fmtFecha, fmtDia, fmtDuracion, hoyISO, mensajeError,
} from './constantes';
import { chip, label, input, btn, btnSec, btnPri, btnCancelar, MiniModal, ModalEstadoMaquina, Adjunto, Dato, PanelLateral } from './ui';
import { InsumosUsados } from './Insumos';
import SelectorFecha from '../ui/SelectorFecha';
import Selector from '../ui/Selector';

// Ficha de una máquina (etapa 2 de Servicio Técnico — docs/servicio-tecnico-plan.md): estado,
// solicitudes (historial de fallas), historial de cambios (qué se cambió, cuándo y por qué) e
// historial de estados. Registran y editan cambios los técnicos; borrar, solo Admin.

const ACCION_EQUIPO = { ESTADO: 'Cambio de estado', CAMBIO_EDITADO: 'Cambio corregido', CAMBIO_BORRADO: 'Cambio borrado' };
const fmtPlata = (n, mon) => `${mon === 'USD' ? 'US$' : '$'} ${Number(n).toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Alta / edición de un cambio.
const ModalCambio = ({ equipo, tiposCambio, cambio, onGuardar, onCerrar }) => {
    const [d, setD] = useState({
        fecha: cambio?.Fecha || hoyISO(), tipo: cambio?.Tipo || '', descripcion: cambio?.Descripcion || '',
        motivo: cambio?.Motivo || '', solId: cambio?.SolId ? String(cambio.SolId) : '',
        costo: cambio?.Costo != null ? String(cambio.Costo) : '', moneda: cambio?.Moneda || 'UYU',
    });
    const [archivos, setArchivos] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const inputArchivos = useRef(null);
    const set = (c) => setD(prev => ({ ...prev, ...c }));
    const valido = d.fecha && d.tipo && d.descripcion.trim();
    const ok = async () => { setGuardando(true); try { await onGuardar(d, archivos); } finally { setGuardando(false); } };
    const agregar = async (lista) => {
        const nuevos = await Promise.all(Array.from(lista || []).map(a => comprimirImagen(a)));
        setArchivos(prev => [...prev, ...nuevos].slice(0, 8));
        if (inputArchivos.current) inputArchivos.current.value = '';
    };
    return (
        <MiniModal titulo={cambio ? 'Corregir cambio' : `Registrar cambio en ${equipo.Nombre}`} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={ok} disabled={!valido || guardando} className={btnPri}>
                {guardando && <Loader2 size={15} className="animate-spin" />} Guardar
            </button>
        </>}>
            <div className="grid grid-cols-2 gap-2">
                <div><span className={label}>Fecha</span><SelectorFecha value={d.fecha} max={hoyISO()} onChange={(e) => set({ fecha: e.target.value })} /></div>
                <div>
                    <span className={label}>Tipo de cambio</span>
                    <Selector value={d.tipo} onChange={(e) => set({ tipo: e.target.value })}>
                        <option value="">Elegir…</option>
                        {tiposCambio.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Selector>
                </div>
            </div>
            <div><span className={label}>Qué se cambió</span>
                <textarea className={`${input} min-h-[80px]`} value={d.descripcion} maxLength={8000} autoFocus onChange={(e) => set({ descripcion: e.target.value })}
                    placeholder="Ej: cabezal i3200 del canal 2, firmware 1.08 → 1.10" /></div>
            <div><span className={label}>Por qué</span>
                <textarea className={`${input} min-h-[60px]`} value={d.motivo} maxLength={1000} onChange={(e) => set({ motivo: e.target.value })}
                    placeholder="Ej: canal tapado que no se recuperó con limpiezas" /></div>
            <div>
                <span className={label}>Solicitud relacionada <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                <Selector value={d.solId} onChange={(e) => set({ solId: e.target.value })}>
                    <option value="">Ninguna</option>
                    {(equipo.solicitudes || []).map(s => <option key={s.SolId} value={s.SolId}>{s.Codigo} · {s.Titulo}</option>)}
                </Selector>
            </div>
            <div className="grid grid-cols-[1fr_110px] gap-2">
                <div><span className={label}>Costo <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                    <input className={input} inputMode="decimal" value={d.costo} onChange={(e) => set({ costo: e.target.value })} placeholder="0" /></div>
                <div><span className={label}>Moneda</span>
                    <Selector value={d.moneda} onChange={(e) => set({ moneda: e.target.value })}>
                        <option value="UYU">$ (UYU)</option><option value="USD">US$</option>
                    </Selector></div>
            </div>
            {!cambio && (
                <div>
                    <span className={label}>Fotos, facturas <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                    <input ref={inputArchivos} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden" onChange={(e) => agregar(e.target.files)} />
                    <div className="flex flex-wrap gap-2">
                        {archivos.map((a, i) => (
                            <span key={`${a.name}-${i}`} className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full bg-zinc-100 text-xs text-zinc-600">
                                <span className="truncate max-w-[160px]">{a.name}</span>
                                <button type="button" onClick={() => setArchivos(p => p.filter((_, j) => j !== i))} className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:text-red-600"><Trash2 size={13} /></button>
                            </span>
                        ))}
                        <button type="button" onClick={() => inputArchivos.current?.click()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-dashed border-zinc-200 text-xs font-bold text-zinc-400 hover:border-brand-cyan/40 hover:text-brand-cyan">
                            <Paperclip size={14} /> Agregar
                        </button>
                    </div>
                </div>
            )}
        </MiniModal>
    );
};

const Tarjeta = ({ titulo, valor, nota, alerta = false }) => (
    <div className={`rounded-2xl border px-3 py-2.5 ${alerta ? 'bg-amber-50 border-amber-200' : 'bg-white border-zinc-200'}`}>
        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">{titulo}</div>
        <div className={`text-xl font-black leading-tight ${alerta ? 'text-amber-700' : 'text-zinc-800'}`}>{valor}</div>
        {nota && <div className="text-[11px] text-zinc-400">{nota}</div>}
    </div>
);

const MaquinaFicha = ({ equipoId, meta, version = 0, onCerrar, onAbrirSolicitud, onCambio }) => {
    const [eq, setEq] = useState(null);
    const [tiposCambio, setTiposCambio] = useState([]);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState('fallas');
    const [modal, setModal] = useState(null); // estado | cambio | {editar: cambio} | {borrar: cambio}
    const inputAdj = useRef(null);
    const [adjuntarA, setAdjuntarA] = useState(null);
    const tec = !!meta?.esTecnico;

    const cargar = useCallback(async () => {
        try {
            const r = await servicioTecnicoService.fichaEquipo(equipoId);
            setEq(r.data);
            setTiposCambio(r.tiposCambio || []);
            setError(null);
        } catch (e) { setError(mensajeError(e, 'No se pudo cargar la máquina')); }
    }, [equipoId]);
    useEffect(() => { setEq(null); cargar(); }, [cargar]);
    useEffect(() => { if (version) cargar(); }, [version, cargar]);

    const accion = async (fn, exito) => {
        try {
            await fn();
            setModal(null);
            if (exito) toast.success(exito);
            await cargar();
            onCambio?.();
            return true;
        } catch (e) { toast.error(mensajeError(e)); return false; }
    };

    const guardarCambio = (cambio) => async (d, archivos) => {
        const campos = { fecha: d.fecha, tipo: d.tipo, descripcion: d.descripcion.trim(), motivo: d.motivo.trim(), solId: d.solId || '', costo: d.costo.trim(), moneda: d.moneda };
        await accion(
            () => (cambio ? servicioTecnicoService.editarCambio(cambio.CamId, campos) : servicioTecnicoService.crearCambio(equipoId, campos, archivos)),
            cambio ? 'Cambio corregido' : 'Cambio registrado',
        );
    };

    const subirAdjuntos = async (lista) => {
        const archivos = await Promise.all(Array.from(lista || []).slice(0, 8).map(a => comprimirImagen(a)));
        if (inputAdj.current) inputAdj.current.value = '';
        if (!archivos.length || !adjuntarA) return;
        await accion(() => servicioTecnicoService.adjuntarCambio(adjuntarA, archivos), 'Archivos agregados');
        setAdjuntarA(null);
    };

    const r = eq?.resumen;
    const costos = r ? Object.entries(r.costoCambios365 || {}) : [];
    // [clave, texto, texto en celular]: en celular las 5 entran sin scroll, con nombres cortos.
    const pestanas = [
        ['fallas', `Fallas (${eq?.solicitudes?.length || 0})`, 'Fallas'],
        ['cambios', `Cambios (${eq?.cambios?.length || 0})`, 'Cambios'],
        ['estados', 'Estados', 'Estados'],
        ['insumos', 'Insumos', 'Insumos'],
        ['ficha', 'Ficha técnica', 'Ficha'],
    ];

    return (
        <PanelLateral onCerrar={onCerrar}>
            {!eq ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
                    {error ? <><span className="text-sm">{error}</span><button onClick={onCerrar} className={`${btn} bg-zinc-200 text-zinc-600`}>Cerrar</button></>
                        : <Loader2 className="animate-spin" size={24} />}
                </div>
            ) : (
                <>
                    <div className="bg-white border-b border-zinc-200 px-5 pt-4 shrink-0">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="font-bold text-zinc-400">{eq.AreaNombre || eq.AreaID}</span>
                                    <span className={`${chip} ${estadoEquipo(eq.Estado).chip}`}>{estadoEquipo(eq.Estado).label}</span>
                                    {!eq.Activo && <span className={`${chip} bg-zinc-100 text-zinc-500 border-zinc-200`}>Inactiva</span>}
                                </div>
                                <h2 className="mt-1 text-xl font-black text-zinc-900 leading-tight">{eq.Nombre}</h2>
                            </div>
                            <button onClick={onCerrar} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-zinc-100 shrink-0"><X size={20} /></button>
                        </div>
                        {tec && (
                            // En celular los dos botones ocupan todo el ancho (mitad y mitad).
                            <div className="mt-3 flex sm:flex-wrap gap-1.5">
                                <button onClick={() => setModal('cambio')} className={`${btnPri} flex-1 sm:flex-none justify-center`}><Plus size={15} /> Registrar cambio</button>
                                <button onClick={() => setModal('estado')} className={`${btnSec} flex-1 sm:flex-none justify-center`}><Cog size={15} /> Cambiar estado</button>
                            </div>
                        )}
                        {/* Pestañas: en celular 5 columnas iguales con nombres cortos (sin scroll); desde sm, en fila. */}
                        <div className="mt-3 grid grid-cols-5 sm:flex sm:gap-1 sm:overflow-x-auto no-scrollbar">
                            {pestanas.map(([k, t, corto]) => (
                                <button key={k} onClick={() => setTab(k)}
                                    className={`px-1 sm:px-3 py-2 text-[13px] sm:text-sm font-bold whitespace-nowrap text-center border-b-2 transition-colors ${tab === k ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-zinc-400 hover:text-zinc-600'}`}>
                                    <span className="sm:hidden">{corto}</span><span className="hidden sm:inline">{t}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                        {/* Resumen */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Tarjeta titulo="Abiertas" valor={r.abiertas} alerta={r.abiertas > 0} />
                            <Tarjeta titulo="Fallas" valor={r.fallas90} nota={`90 días · ${r.fallas30} en 30 · ${r.fallas365} en el año`} />
                            <Tarjeta titulo="Parada" valor={fmtDuracion(r.minutosParada90) || '0 min'} nota={`90 días · ${fmtDuracion(r.minutosParada365) || '0 min'} en el año`} />
                            <Tarjeta titulo="Resolución" valor={r.minutosResolucionProm != null ? fmtDuracion(r.minutosResolucionProm) : '—'} nota="promedio del año" />
                        </div>
                        {costos.length > 0 && (
                            <p className="text-xs text-zinc-500">Costo de los cambios del último año: <span className="font-bold text-zinc-700">{costos.map(([m, n]) => fmtPlata(n, m)).join(' + ')}</span></p>
                        )}

                        {tab === 'fallas' && (
                            eq.solicitudes.length === 0 ? <p className="text-sm text-zinc-400 text-center py-8">Esta máquina no tiene solicitudes.</p> : (
                                <div className="flex flex-col gap-2">
                                    {eq.solicitudes.map(s => (
                                        <button key={s.SolId} onClick={() => onAbrirSolicitud?.(s.SolId)}
                                            className="w-full text-left bg-white border border-zinc-200 rounded-xl px-3 py-2.5 hover:border-brand-cyan/40">
                                            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                                <span className="font-mono font-bold text-zinc-400">{s.Codigo}</span>
                                                <span className={`${chip} ${prioridadInfo(s.Prioridad).chip}`}>{prioridadInfo(s.Prioridad).label}</span>
                                                <span className={`${chip} ${estadoInfo(s.Estado).chip}`}>{estadoInfo(s.Estado).label}</span>
                                                {s.Resultado && <span className={`${chip} ${resultadoInfo(s.Resultado)?.chip}`}>{resultadoInfo(s.Resultado)?.label}</span>}
                                                <span className="ml-auto text-zinc-400">{fmtFecha(s.FechaSolicitud)}</span>
                                            </div>
                                            <div className="mt-1 text-sm font-bold text-zinc-800">{s.Titulo}</div>
                                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                                                {s.TecnicoNombre && <span>Técnico: {s.TecnicoNombre}</span>}
                                                {s.MinutosParada != null && <span className="text-amber-700">Parada {fmtDuracion(s.MinutosParada)}</span>}
                                                {s.MinutosResolucion != null && <span>Resuelta en {fmtDuracion(s.MinutosResolucion)}</span>}
                                            </div>
                                            {s.TrabajoRealizado && <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{s.TrabajoRealizado}</p>}
                                        </button>
                                    ))}
                                </div>
                            )
                        )}

                        {tab === 'cambios' && (
                            <>
                                <input ref={inputAdj} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden" onChange={(e) => subirAdjuntos(e.target.files)} />
                                {eq.cambios.length === 0 ? <p className="text-sm text-zinc-400 text-center py-8">Todavía no se registraron cambios en esta máquina.</p> : (
                                    <ol className="relative border-l-2 border-zinc-200 ml-2 flex flex-col gap-4">
                                        {eq.cambios.map(c => (
                                            <li key={c.CamId} className="pl-4 relative">
                                                <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-white bg-brand-cyan" />
                                                <div className="bg-white border border-zinc-200 rounded-xl p-3">
                                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                                        <span className="font-black text-zinc-700">{fmtDia(c.Fecha)}</span>
                                                        <span className={`${chip} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30`}>{c.TipoLabel}</span>
                                                        {c.Costo != null && <span className="font-bold text-zinc-600">{fmtPlata(c.Costo, c.Moneda)}</span>}
                                                        {c.SolCodigo && (
                                                            <button onClick={() => onAbrirSolicitud?.(c.SolId)} className="font-mono font-bold text-brand-cyan hover:underline">{c.SolCodigo}</button>
                                                        )}
                                                        {tec && (
                                                            <span className="ml-auto flex gap-0.5">
                                                                <button title="Adjuntar" onClick={() => { setAdjuntarA(c.CamId); inputAdj.current?.click(); }} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><Paperclip size={14} /></button>
                                                                <button title="Corregir" onClick={() => setModal({ editar: c })} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><Pencil size={14} /></button>
                                                                {meta?.esAdmin && <button title="Borrar" onClick={() => setModal({ borrar: c })} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap break-words">{c.Descripcion}</p>
                                                    {c.Motivo && <p className="mt-1 text-xs text-zinc-500"><span className="font-bold">Por qué:</span> {c.Motivo}</p>}
                                                    {c.adjuntos.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{c.adjuntos.map(a => <Adjunto key={a.AdjId} a={a} chico />)}</div>}
                                                    <div className="mt-1.5 text-[11px] text-zinc-400 inline-flex items-center gap-1"><User size={11} />{c.UsuarioNombre} · cargado {fmtFecha(c.FechaRegistro)}</div>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </>
                        )}

                        {tab === 'estados' && (
                            eq.estados.length === 0 ? <p className="text-sm text-zinc-400 text-center py-8">Sin movimientos registrados por Servicio Técnico.</p> : (
                                <ol className="relative border-l-2 border-zinc-100 ml-2 flex flex-col gap-3">
                                    {[...eq.estados].reverse().map(h => (
                                        <li key={h.HisId} className="pl-4 relative">
                                            <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-white bg-zinc-300" />
                                            <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                                <span className="font-black text-zinc-700">{ACCION_EQUIPO[h.Accion] || h.Accion}</span>
                                                <span className="text-zinc-500 inline-flex items-center gap-1"><User size={11} />{h.UsuarioNombre || '—'}</span>
                                                <span className="text-zinc-400 inline-flex items-center gap-1"><Clock size={11} />{fmtFecha(h.Fecha)}</span>
                                            </div>
                                            {h.Detalle && <p className="mt-0.5 text-sm text-zinc-600 break-words">{h.Detalle}</p>}
                                            {h.Motivo && <p className="text-xs text-zinc-500"><span className="font-bold">Motivo:</span> {h.Motivo}</p>}
                                        </li>
                                    ))}
                                </ol>
                            )
                        )}

                        {tab === 'insumos' && (
                            <InsumosUsados filtro={{ equipo: equipoId }} version={version} puedeUsar={tec}
                                contexto={{ equipoId, titulo: eq.Nombre }} onCambio={() => { cargar(); onCambio?.(); }} />
                        )}

                        {tab === 'ficha' && (
                            <div className="bg-white rounded-2xl border border-zinc-200 p-4 grid grid-cols-2 gap-x-4 gap-y-3">
                                <Dato titulo="Cabezales">{eq.Cabezales ?? '—'}{eq.CabezalesReal != null && eq.CabezalesReal !== eq.Cabezales && <span className="text-amber-700"> (funcionando {eq.CabezalesReal})</span>}</Dato>
                                <Dato titulo="Velocidad">{eq.VelocidadValor != null ? `${Number(eq.VelocidadValor)} ${eq.VelocidadUnidad || ''}` : '—'}
                                    {eq.VelocidadValorReal != null && Number(eq.VelocidadValorReal) !== Number(eq.VelocidadValor) && <span className="text-amber-700"> (real {Number(eq.VelocidadValorReal)})</span>}</Dato>
                                <Dato titulo="Preparación">{eq.MinutosPreparacion != null ? `${eq.MinutosPreparacion} min` : '—'}
                                    {eq.MinutosPreparacionReal != null && eq.MinutosPreparacionReal !== eq.MinutosPreparacion && <span className="text-amber-700"> (real {eq.MinutosPreparacionReal} min)</span>}</Dato>
                                <Dato titulo="Estado de proceso">{eq.EstadoProceso || '—'}</Dato>
                                <p className="col-span-2 text-xs text-zinc-400">Estos datos se editan en Configuración → Equipos.</p>
                            </div>
                        )}
                    </div>

                    {modal === 'estado' && (
                        <ModalEstadoMaquina nombre={eq.Nombre} estadoActual={eq.Estado} estadosEquipo={meta?.estadosEquipo || []} onCerrar={() => setModal(null)}
                            onConfirmar={(estado, motivo) => accion(() => servicioTecnicoService.cambiarEstadoMaquina(equipoId, estado, motivo), 'Estado actualizado')} />
                    )}
                    {modal === 'cambio' && <ModalCambio equipo={eq} tiposCambio={tiposCambio} onGuardar={guardarCambio(null)} onCerrar={() => setModal(null)} />}
                    {modal?.editar && <ModalCambio equipo={eq} tiposCambio={tiposCambio} cambio={modal.editar} onGuardar={guardarCambio(modal.editar)} onCerrar={() => setModal(null)} />}
                    {modal?.borrar && (
                        <MiniModal titulo="Borrar cambio" onCerrar={() => setModal(null)} pie={<>
                            <button onClick={() => setModal(null)} className={btnCancelar}>Cancelar</button>
                            <button onClick={() => accion(() => servicioTecnicoService.borrarCambio(modal.borrar.CamId), 'Cambio borrado')} className={`${btn} bg-red-600 text-white hover:bg-red-700`}><Trash2 size={15} /> Borrar</button>
                        </>}>
                            <p className="text-sm text-zinc-700">¿Borrar el cambio del {fmtDia(modal.borrar.Fecha)} ({modal.borrar.TipoLabel})? Queda anotado en el historial de la máquina.</p>
                            <p className="text-sm text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2">{modal.borrar.Descripcion}</p>
                        </MiniModal>
                    )}
                </>
            )}
        </PanelLateral>
    );
};

export default MaquinaFicha;
