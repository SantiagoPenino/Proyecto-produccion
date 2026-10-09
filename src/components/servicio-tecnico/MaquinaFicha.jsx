import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
    Loader2, Cog, Plus, Pencil, Trash2, Paperclip, User, Clock, ArrowLeft, Search, Copy, AlertTriangle, CircleAlert,
    Printer, Flame, Spool, Zap, Scissors, Shirt,
} from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import { comprimirImagen } from '../../utils/comprimirImagen';
import {
    estado as estadoInfo, prioridad as prioridadInfo, resultado as resultadoInfo, estadoEquipo,
    fmtFecha, fmtDia, fmtDuracion, hoyISO, mensajeError,
} from './constantes';
import { chip, label, input, btn, btnSec, btnPri, btnCancelar, MiniModal, ModalEstadoMaquina, Adjunto } from './ui';
import { InsumosUsados } from './Insumos';
import FichaTecnica, { ModalCabezalesFuncionando, preguntaCabezales } from './FichaTecnica';
import { PreventivoMaquina, RepuestosMaquina } from './MaquinaServicio';
import { SECCIONES, tipoLabel, sugerirTipo, completitud, capacidadHora, garantia, fmtNum, num, alertasMaquina, TONO_ALERTA } from './fichaTecnicaCampos';
import SelectorFecha from '../ui/SelectorFecha';
import Selector from '../ui/Selector';

// Página de una máquina: /servicio-tecnico/maquinas/:id (08/10; antes era un panel lateral). Plan:
// docs/servicio-tecnico/ficha-tecnica-maquinas-plan.md. Pestañas: Resumen, Ficha técnica (secciones según el
// tipo de máquina; capacidad incluida, que desde el 08/10 se edita acá y no en Configuración), Servicio
// (solicitudes, cambios, preventivo, repuestos críticos, historial e insumos) y Comercial (garantía y soporte).
// Registran cambios y editan la ficha los técnicos; borrar un cambio, solo Admin.

const ACCION_EQUIPO = {
    ESTADO: 'Cambio de estado', CAMBIO_EDITADO: 'Cambio corregido', CAMBIO_BORRADO: 'Cambio borrado',
    FICHA: 'Ficha técnica', CAPACIDAD: 'Capacidad', ALTA: 'Alta de la máquina', REPUESTO: 'Repuestos críticos', DOCUMENTO: 'Documentos',
};
const TIPOS_CON_SOFTWARE = ['IMPRESORA', 'BORDADORA', 'LASER', 'CORTE'];

// Cabezales de la máquina que se pueden actualizar desde "Registrar cambio" (parte 2, 08/10): en las impresoras,
// las posiciones de "Cabezales de impresión" (tantas como la cantidad cargada); en las bordadoras, los cabezales
// de "Bordado" (tantos como «Cabezales / estaciones» de la capacidad). null si el tipo no tiene.
const cabezalesDeLaFicha = (equipo, tipoMaq) => {
    const datos = equipo.fichaTecnica?.Datos || {};
    const tope = (n) => Math.max(0, Math.min(64, Math.trunc(num(n) || 0)));
    if (tipoMaq === 'IMPRESORA') {
        const n = tope(datos.imp?.cantidad);
        return { seccion: 'imp', filas: Array.from({ length: n }, (_, i) => datos.imp?.posiciones?.[i] || {}), falta: 'la cantidad de cabezales en la ficha técnica (Cabezales de impresión)' };
    }
    if (tipoMaq === 'BORDADORA') {
        const n = tope(equipo.Cabezales);
        return { seccion: 'bor', filas: Array.from({ length: n }, (_, i) => datos.bor?.cabezales?.[i] || {}), falta: '«Cabezales / estaciones» en la capacidad' };
    }
    return null;
};
const fmtPlata = (n, mon) => `${mon === 'USD' ? 'US$' : '$'} ${Number(n).toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const ICONO_TIPO = { IMPRESORA: Printer, CALANDRA: Flame, BORDADORA: Spool, LASER: Zap, CORTE: Scissors, COSTURA: Shirt, OTRA: Cog };
// 'AAAA-MM-DD' de hoy más n días (para saber si la disponibilidad cubre los 90 días completos)
const sumarDiasHoy = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Horas de trabajo en horas, no en días: "31 h" se entiende; "1 d 7 h" parece un día de trabajo.
const horasTrabajo = (min) => {
    const m = Math.round(Number(min) || 0);
    if (m < 60) return `${m} min`;
    if (m < 600) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
    return `${fmtNum(m / 60, 0)} h`;
};

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

    // Parte 2 (08/10): al registrar (no al corregir) un cambio de cabezal o de firmware/software, también se
    // puede actualizar la ficha técnica. El backend lo hace junto con el cambio (stFichaEquipoController.aplicarCambioEnFicha).
    const ficha = equipo.fichaTecnica;
    const conFicha = !cambio && !!ficha?.disponible;
    const tipoMaq = ficha?.Tipo || sugerirTipo(equipo.AreaID, equipo.Nombre);
    const cabezales = conFicha ? cabezalesDeLaFicha(equipo, tipoMaq) : null;
    const sw = ficha?.Datos?.sw || {};
    const [cabezalPos, setCabezalPos] = useState('');
    const [cabezalSerie, setCabezalSerie] = useState('');
    const [firmware, setFirmware] = useState(sw.firmware || '');
    const [version, setVersion] = useState(sw.version || '');
    const verCabezal = conFicha && d.tipo === 'CABEZAL' && !!cabezales;
    const verSoftware = conFicha && d.tipo === 'SOFTWARE' && TIPOS_CON_SOFTWARE.includes(tipoMaq);
    const extraFicha = () => {
        if (verCabezal && cabezalPos !== '') {
            const pos = Number(cabezalPos);
            // Bordadora: el cabezal cambiado vuelve a andar; si cambia cuántos andan, después se pregunta (decisión 08/10).
            const pregunta = cabezales.seccion === 'bor'
                ? preguntaCabezales(equipo, cabezales.filas.map((f, i) => (i === pos ? { ...f, estado: 'Operativo' } : f))) : null;
            return { ficha: { cabezal: { seccion: cabezales.seccion, pos, serie: cabezalSerie.trim() } }, pregunta };
        }
        if (verSoftware && (firmware.trim() !== (sw.firmware || '') || version.trim() !== (sw.version || ''))) {
            return { ficha: { software: { firmware: firmware.trim(), version: version.trim() } }, pregunta: null };
        }
        return null;
    };
    const ok = async () => { setGuardando(true); try { await onGuardar(d, archivos, extraFicha()); } finally { setGuardando(false); } };
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
                    {/* altoMax: las 10 opciones con el buscador piden ~421 px; con los 320 de siempre quedaba con scroll */}
                    <Selector value={d.tipo} onChange={(e) => set({ tipo: e.target.value })} altoMax={440}>
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
            {verCabezal && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 flex flex-col gap-2">
                    <span className={label}>Actualizar la ficha técnica <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                    {cabezales.filas.length === 0 ? (
                        <p className="text-xs text-zinc-500">Para elegir el cabezal, primero cargá {cabezales.falta}.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div>
                                    <span className={label}>Cabezal que se cambió</span>
                                    <Selector value={cabezalPos} onChange={(e) => setCabezalPos(e.target.value)} aria-label="Cabezal que se cambió" altoMax={440}>
                                        <option value="">No actualizar la ficha</option>
                                        {cabezales.filas.map((f, i) => (
                                            <option key={i} value={String(i)} descripcion={[f.serie && `serie ${f.serie}`, f.estado && f.estado !== 'Operativo' && f.estado].filter(Boolean).join(' · ') || undefined}>
                                                {`Cabezal ${i + 1}${f.color ? ` · ${f.color}` : ''}`}
                                            </option>
                                        ))}
                                    </Selector>
                                </div>
                                <div>
                                    <label htmlFor="cambio-serie-cabezal" className={label}>N.º de serie del nuevo</label>
                                    <input id="cambio-serie-cabezal" className={input} value={cabezalSerie} maxLength={100} disabled={cabezalPos === ''}
                                        onChange={(e) => setCabezalSerie(e.target.value)} placeholder={cabezalPos === '' ? '' : 'Opcional'} />
                                </div>
                            </div>
                            {cabezalPos !== '' && (
                                <p className="text-xs text-zinc-500">En la ficha, el cabezal {Number(cabezalPos) + 1} queda «Operativo»{cabezales.seccion === 'imp' ? `, colocado el ${fmtDia(d.fecha)}` : ''}.</p>
                            )}
                        </>
                    )}
                </div>
            )}
            {verSoftware && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 flex flex-col gap-2">
                    <span className={label}>Versiones en la ficha técnica</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div><label htmlFor="cambio-firmware" className={label}>Firmware</label>
                            <input id="cambio-firmware" className={input} value={firmware} maxLength={100} onChange={(e) => setFirmware(e.target.value)} placeholder="Ej: 1.10" /></div>
                        <div><label htmlFor="cambio-version" className={label}>Versión del software</label>
                            <input id="cambio-version" className={input} value={version} maxLength={100} onChange={(e) => setVersion(e.target.value)} /></div>
                    </div>
                    <p className="text-xs text-zinc-500">Si las cambiás, se actualizan en la ficha técnica (Software y conectividad).</p>
                </div>
            )}
            <div className="grid grid-cols-[1fr_110px] gap-2">
                <div><span className={label}>Costo <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                    <input className={input} inputMode="decimal" value={d.costo} onChange={(e) => set({ costo: e.target.value })} placeholder="0" /></div>
                <div><span className={label}>Moneda</span>
                    {/* anchoLista: la lista del ancho del campo (110 px) y no los 220 de siempre */}
                    <Selector value={d.moneda} onChange={(e) => set({ moneda: e.target.value })} anchoLista={110}>
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

// Columna de máquinas (pantallas anchas): para saltar de una ficha a otra sin volver a la lista.
const ColumnaMaquinas = ({ equipos, actual, onAbrir }) => {
    const [q, setQ] = useState('');
    const grupos = useMemo(() => {
        const t = q.trim().toLowerCase();
        const g = new Map();
        (equipos || []).filter(e => !t || [e.Nombre, e.Marca, e.Modelo, e.AreaNombre].join(' ').toLowerCase().includes(t)).forEach(e => {
            const k = e.AreaNombre || e.AreaID || 'Sin área';
            if (!g.has(k)) g.set(k, []);
            g.get(k).push(e);
        });
        return [...g.entries()];
    }, [equipos, q]);
    return (
        <aside className="hidden xl:flex flex-col gap-2 w-[250px] shrink-0 sticky top-4 max-h-[calc(100vh-2rem)]">
            <div className="relative shrink-0">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar máquina…" aria-label="Buscar máquina"
                    className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 placeholder:text-zinc-400" />
            </div>
            <div className="overflow-y-auto flex flex-col gap-3 pr-1 pb-2">
                {!equipos ? <Loader2 className="mx-auto mt-4 animate-spin text-zinc-300" size={18} />
                    : grupos.length === 0 ? <p className="text-xs text-zinc-400 px-1">Ninguna máquina coincide.</p>
                        : grupos.map(([area, lista]) => (
                            <div key={area}>
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide px-1 mb-1">{area}</div>
                                <div className="flex flex-col gap-1">
                                    {lista.map(e => {
                                        const on = e.EquipoID === actual;
                                        const alertas = alertasMaquina(e);
                                        const roja = alertas.some(a => a.tono === 'bad');
                                        return (
                                            <button key={e.EquipoID} type="button" onClick={() => !on && onAbrir(e.EquipoID)} aria-current={on ? 'page' : undefined}
                                                className={`text-left rounded-xl border px-3 py-2 transition-colors ${on ? 'bg-white border-brand-cyan/40 shadow-[inset_3px_0_0_0_#006E97]' : 'bg-white border-zinc-200 hover:border-brand-cyan/40'}`}>
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className={`truncate text-sm font-black ${on ? 'text-brand-cyan' : 'text-zinc-800'}`}>{e.Nombre}</span>
                                                    <span className="shrink-0 flex items-center gap-1.5">
                                                        {e.Abiertas > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-700" title="Solicitudes abiertas"><AlertTriangle size={11} />{e.Abiertas}</span>}
                                                        {alertas.length > 0 && (
                                                            <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${roja ? 'text-red-600' : 'text-amber-700'}`} title={alertas.map(a => a.texto).join(' · ')}>
                                                                <CircleAlert size={11} />{alertas.length}
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="truncate text-[11px] text-zinc-400">
                                                    {[tipoLabel(e.Tipo), [e.Marca, e.Modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Sin ficha técnica'}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
            </div>
        </aside>
    );
};

const PESTANAS = [
    ['resumen', 'Resumen', 'Resumen'],
    ['ficha', 'Ficha técnica', 'Ficha'],
    ['servicio', 'Servicio', 'Servicio'],
    ['comercial', 'Comercial y documentos', 'Comercial'],
];

const MaquinaFicha = ({ equipoId, meta, version = 0, onVolver, onAbrirMaquina, onAbrirSolicitud, onAbrirTrabajo, onCambio }) => {
    const [eq, setEq] = useState(null);
    const [tiposCambio, setTiposCambio] = useState([]);
    const [catalogos, setCatalogos] = useState(null);
    const [error, setError] = useState(null);
    const [equipos, setEquipos] = useState(null);
    const [tab, setTab] = useState('resumen');
    const [sub, setSub] = useState('fallas');
    const [irA, setIrA] = useState(null); // sección a la que hay que bajar después de cambiar de pestaña
    const [modal, setModal] = useState(null); // estado | cambio | copiar | {editar: cambio} | {borrar: cambio}
    const [copiarDe, setCopiarDe] = useState('');
    const [confirmandoTipo, setConfirmandoTipo] = useState(false);
    const [preguntaBordado, setPreguntaBordado] = useState(null); // después de cambiar un cabezal de una bordadora
    const inputAdj = useRef(null);
    const [adjuntarA, setAdjuntarA] = useState(null);
    const tec = !!meta?.esTecnico;

    const cargar = useCallback(async () => {
        try {
            const r = await servicioTecnicoService.fichaEquipo(equipoId);
            setEq(r.data);
            setTiposCambio(r.tiposCambio || []);
            setCatalogos(r.catalogos || null);
            setError(null);
        } catch (e) { setError(mensajeError(e, 'No se pudo cargar la máquina')); }
    }, [equipoId]);
    useEffect(() => { setEq(null); setError(null); cargar(); }, [cargar]);
    useEffect(() => { if (version) cargar(); }, [version, cargar]);

    const cargarEquipos = useCallback(async () => {
        try { setEquipos((await servicioTecnicoService.equipos()).data); } catch (_) { setEquipos([]); }
    }, []);
    useEffect(() => { cargarEquipos(); }, [cargarEquipos]);
    const avisar = useRecargaConFreno(() => cargarEquipos());
    useEffect(() => {
        socket.on('st:updated', avisar);
        return () => socket.off('st:updated', avisar);
    }, [avisar]);

    useEffect(() => {
        if (!irA || !eq) return;
        const t = setTimeout(() => { document.getElementById(`sec-${irA}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setIrA(null); }, 60);
        return () => clearTimeout(t);
    }, [irA, tab, eq]);

    const recargarTodo = () => { cargar(); cargarEquipos(); onCambio?.(); };

    const accion = async (fn, exito) => {
        try {
            await fn();
            setModal(null);
            if (exito) toast.success(exito);
            await cargar();
            cargarEquipos();
            onCambio?.();
            return true;
        } catch (e) { toast.error(mensajeError(e)); return false; }
    };

    const guardarCambio = (cambio) => async (d, archivos, extra = null) => {
        const campos = { fecha: d.fecha, tipo: d.tipo, descripcion: d.descripcion.trim(), motivo: d.motivo.trim(), solId: d.solId || '', costo: d.costo.trim(), moneda: d.moneda };
        if (cambio) {
            await accion(() => servicioTecnicoService.editarCambio(cambio.CamId, campos), 'Cambio corregido');
            return;
        }
        if (extra?.ficha) campos.ficha = JSON.stringify(extra.ficha);
        let r = null;
        const hecho = await accion(async () => { r = await servicioTecnicoService.crearCambio(equipoId, campos, archivos); }, null);
        if (!hecho) return;
        if (r?.fichaError) toast.warning('El cambio quedó registrado, pero no se pudo actualizar la ficha técnica.');
        else toast.success(r?.fichaActualizada ? 'Cambio registrado y ficha técnica actualizada' : 'Cambio registrado');
        if (r?.fichaActualizada && extra?.pregunta) setPreguntaBordado(extra.pregunta);
    };

    const subirAdjuntos = async (lista) => {
        const archivos = await Promise.all(Array.from(lista || []).slice(0, 8).map(a => comprimirImagen(a)));
        if (inputAdj.current) inputAdj.current.value = '';
        if (!archivos.length || !adjuntarA) return;
        await accion(() => servicioTecnicoService.adjuntarCambio(adjuntarA, archivos), 'Archivos agregados');
        setAdjuntarA(null);
    };

    if (!eq) {
        return (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-zinc-400">
                {error ? <><span className="text-sm">{error}</span><button onClick={onVolver} className={btnSec}><ArrowLeft size={15} /> Máquinas</button></>
                    : <Loader2 className="animate-spin" size={24} />}
            </div>
        );
    }

    const ficha = eq.fichaTecnica || { disponible: false, Datos: {} };
    const tipoSugerido = sugerirTipo(eq.AreaID, eq.Nombre);
    const tipo = ficha.Tipo || tipoSugerido;
    const IconoTipo = ICONO_TIPO[tipo] || Cog;
    const r = eq.resumen;
    const costos = Object.entries(r.costoCambios365 || {});
    const est = estadoEquipo(eq.Estado);
    const cap = capacidadHora(eq);
    const gar = garantia(ficha.Datos?.gar);
    // "Marca Modelo · N.º de serie X · local" (los locales vienen en minúscula: van con capitalize)
    const local = ficha.LocalNombre ? (String(ficha.LocalNombre).toLowerCase() === 'otro' && ficha.LocalOtro ? ficha.LocalOtro : ficha.LocalNombre) : '';
    const identidad = [
        [ficha.Marca, ficha.Modelo].filter(Boolean).join(' '),
        ficha.Serie ? `N.º de serie ${ficha.Serie}` : '',
    ].filter(Boolean);
    // El "% completa" cuenta solo las secciones con datos principales (no los archivos ni los enlaces).
    const seccionesTodas = SECCIONES.filter(s => (!s.tipos || s.tipos.includes(tipo)) && s.principales.length > 0);
    const comp = seccionesTodas.map(s => ({ sec: s, ...completitud(s, ficha, eq) }));
    const pct = Math.round(100 * comp.reduce((a, c) => a + c.hechos, 0) / Math.max(1, comp.reduce((a, c) => a + c.total, 0)));
    const conFicha = (equipos || []).filter(e => e.TieneFicha && e.EquipoID !== eq.EquipoID);

    const irASeccion = (sec) => { setTab(sec.pestana); setIrA(sec.key); };
    // Alertas de esta máquina (parte 4): las calcula la lista (GET /equipos). "Sin capacidad" no se repite acá: ya está
    // en el encabezado y en la tarjeta de capacidad.
    const alertas = alertasMaquina((equipos || []).find(e => e.EquipoID === eq.EquipoID)).filter(a => a.clave !== 'sincap');
    const irAAlerta = (d) => { setTab(d.tab); if (d.sub) setSub(d.sub); if (d.seccion) setIrA(d.seccion); };
    // Disponibilidad: de las horas que tenía que trabajar (horario del área en Planificación, sin feriados), cuánto no
    // estuvo parada por una falla. Últimos 90 días, o desde la primera solicitud del módulo si es más nueva.
    const disp = r.disponibilidad;
    const notaDisponibilidad = !disp ? ''
        : disp.sinHorario ? 'el área no tiene horario en Planificación'
        : disp.porcentaje == null ? 'todavía no hubo horas de trabajo'
        : `${disp.desde <= sumarDiasHoy(-89) ? 'últimos 90 días' : `desde el ${fmtDia(disp.desde)}`} · ${horasTrabajo(disp.minutosParados)} parada de ${horasTrabajo(disp.minutosProgramados)} de trabajo`;
    const confirmarTipo = async () => {
        setConfirmandoTipo(true);
        try {
            await servicioTecnicoService.guardarFicha(eq.EquipoID, {
                seccion: 'ident', titulo: 'Identificación', resumen: [`Tipo de máquina: — → ${tipoLabel(tipoSugerido)}`],
                valores: {
                    tipo: tipoSugerido, marca: ficha.Marca, modelo: ficha.Modelo, serie: ficha.Serie, anio: ficha.Anio ?? '',
                    localId: ficha.LocalId ?? '', localOtro: ficha.LocalOtro, ubicacion: ficha.Datos?.ident?.ubicacion || '',
                },
            });
            toast.success(`Tipo: ${tipoLabel(tipoSugerido)}`);
            recargarTodo();
        } catch (e) { toast.error(mensajeError(e)); }
        finally { setConfirmandoTipo(false); }
    };

    const avisoTipo = !ficha.Tipo && ficha.disponible && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="flex-1 min-w-[220px]">Falta confirmar el tipo de máquina. Por el área, parece <b>{tipoLabel(tipoSugerido)}</b>: las secciones de la ficha dependen de eso.</span>
            {tec && (
                <span className="flex gap-2">
                    <button type="button" onClick={() => irASeccion(SECCIONES[0])} className={btnSec}>Elegir otro</button>
                    <button type="button" onClick={confirmarTipo} disabled={confirmandoTipo} className={btnPri}>
                        {confirmandoTipo && <Loader2 size={15} className="animate-spin" />} Es {tipoLabel(tipoSugerido).toLowerCase()}
                    </button>
                </span>
            )}
        </div>
    );

    return (
        <div className="flex gap-5 items-start">
            <ColumnaMaquinas equipos={equipos} actual={eq.EquipoID} onAbrir={onAbrirMaquina} />

            <div className="min-w-0 flex-1 flex flex-col gap-4">
                {/* Encabezado */}
                <div>
                    <button type="button" onClick={onVolver} className="inline-flex items-center gap-1.5 py-1 text-sm font-bold text-zinc-500 hover:text-brand-cyan">
                        <ArrowLeft size={16} /> Máquinas
                    </button>
                    <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                            <IconoTipo size={30} className="mt-1 shrink-0 text-brand-cyan" aria-hidden="true" />
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="font-bold text-zinc-400">{eq.AreaNombre || eq.AreaID}</span>
                                    <span className={`${chip} ${est.chip}`}>{est.label}</span>
                                    {ficha.Tipo && <span className={`${chip} bg-white text-zinc-600 border-zinc-200`}>{tipoLabel(ficha.Tipo)}</span>}
                                    {!eq.Activo && <span className={`${chip} bg-zinc-100 text-zinc-500 border-zinc-200`}>Inactiva</span>}
                                    {eq.VelocidadValor == null && <span className={`${chip} bg-amber-50 text-amber-700 border-amber-200`} title="Planificación no cuenta esta máquina hasta que tenga velocidad">Sin capacidad</span>}
                                </div>
                                <h1 className="mt-1 text-2xl font-black leading-tight text-zinc-900">{eq.Nombre}</h1>
                                {(identidad.length > 0 || local) && (
                                    <p className="text-sm text-zinc-500">
                                        {identidad.join(' · ')}{identidad.length > 0 && local ? ' · ' : ''}{local && <span className="capitalize">{local}</span>}
                                    </p>
                                )}
                            </div>
                        </div>
                        {tec && (
                            // En celular: "Registrar cambio" a todo el ancho y los otros dos abajo, mitad y mitad.
                            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                                <button onClick={() => setModal('cambio')} className={`${btnPri} justify-center whitespace-nowrap ${ficha.disponible ? 'col-span-2' : ''}`}><Plus size={15} /> Registrar cambio</button>
                                <button onClick={() => setModal('estado')} className={`${btnSec} justify-center whitespace-nowrap`}><Cog size={15} className="text-brand-cyan" /> Cambiar estado</button>
                                {ficha.disponible && (
                                    <button onClick={() => { setCopiarDe(''); setModal('copiar'); }} className={`${btnSec} justify-center whitespace-nowrap`}><Copy size={15} className="text-brand-cyan" /> Copiar ficha</button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Pestañas: en celular 4 columnas con nombres cortos; desde sm, en fila. La línea es una sombra
                    interna (con borde + -mb-px aparecía una barra de scroll). */}
                <div className="grid grid-cols-4 sm:flex sm:gap-1 shadow-[inset_0_-1px_0_0_#e4e4e7]" role="tablist">
                    {PESTANAS.map(([k, t, corto]) => (
                        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                            className={`px-1 sm:px-4 py-2.5 text-[13px] sm:text-sm font-bold whitespace-nowrap text-center border-b-2 transition-colors ${tab === k ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:border-zinc-300'}`}>
                            <span className="sm:hidden">{corto}</span><span className="hidden sm:inline">{t}</span>
                        </button>
                    ))}
                </div>

                {(tab === 'resumen' || tab === 'ficha') && avisoTipo}

                {tab === 'resumen' && (
                    <>
                        {alertas.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {alertas.map(a => (
                                    <button key={a.clave} type="button" onClick={() => irAAlerta(a.destino)}
                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold transition-colors hover:brightness-95 ${TONO_ALERTA[a.tono]}`}>
                                        <CircleAlert size={13} /> {a.texto}
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            <Tarjeta titulo="Abiertas" valor={r.abiertas} alerta={r.abiertas > 0} />
                            <Tarjeta titulo="Fallas" valor={r.fallas90} nota={`90 días · ${r.fallas30} en 30 · ${r.fallas365} en el año`} />
                            <Tarjeta titulo="Parada" valor={fmtDuracion(r.minutosParada90) || '0 min'} nota={`90 días · ${fmtDuracion(r.minutosParada365) || '0 min'} en el año`} />
                            <Tarjeta titulo="Resolución" valor={r.minutosResolucionProm != null ? fmtDuracion(r.minutosResolucionProm) : '—'} nota="promedio del año" />
                        </div>
                        {/* Indicadores (parte 4): entre fallas y reparación con las fallas del último año que no se cancelaron;
                            disponibilidad con el horario del área en Planificación (stEquiposController.disponibilidadDe). */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <Tarjeta titulo="Entre fallas" valor={r.mtbfMinutos != null ? fmtDuracion(r.mtbfMinutos) : '—'}
                                nota={r.mtbfMinutos != null ? `promedio entre ${r.mtbfFallas} fallas del año` : r.mtbfFallas === 1 ? 'una sola falla en el año' : 'sin fallas en el año'} />
                            <Tarjeta titulo="Reparación" valor={r.mttrMinutos != null ? fmtDuracion(r.mttrMinutos) : '—'}
                                nota={r.mttrMinutos != null ? `parada promedio · ${r.mttrFallas} falla${r.mttrFallas === 1 ? '' : 's'} que la pararon` : 'ninguna falla la paró en el año'} />
                            <div className="col-span-2 sm:col-span-1">
                                <Tarjeta titulo="Disponibilidad" valor={disp?.porcentaje != null ? `${fmtNum(disp.porcentaje, 1)} %` : '—'}
                                    alerta={disp?.porcentaje != null && disp.porcentaje < 95} nota={notaDisponibilidad} />
                            </div>
                        </div>
                        {costos.length > 0 && (
                            <p className="text-xs text-zinc-500">Costo de los cambios del último año: <span className="font-bold text-zinc-700">{costos.map(([m, n]) => fmtPlata(n, m)).join(' + ')}</span></p>
                        )}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <button type="button" onClick={() => irASeccion(SECCIONES.find(s => s.key === 'cap'))}
                                className="text-left bg-white border border-zinc-200 rounded-2xl p-4 hover:border-brand-cyan/40 transition-colors">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Capacidad (la que usa Planificación)</div>
                                {cap ? (
                                    <>
                                        <div className="mt-1 text-xl font-black text-zinc-800">{fmtNum(cap.porHora, 1)} <span className="text-sm font-bold text-zinc-500">{cap.base} por hora</span></div>
                                        <div className="text-xs text-zinc-500">
                                            {cap.porHora < cap.instalada ? `Instalada ${fmtNum(cap.instalada, 1)} por hora · ` : ''}
                                            Preparación {eq.MinutosPreparacionReal ?? eq.MinutosPreparacion ?? '—'} min
                                            {String(eq.Estado || '').trim().toUpperCase() === 'MANTENIMIENTO' ? ' · en mantenimiento: cuenta 0' : ''}
                                        </div>
                                    </>
                                ) : <div className="mt-1 text-sm font-bold text-amber-700">Sin velocidad cargada: Planificación no cuenta esta máquina.</div>}
                            </button>
                            <button type="button" onClick={() => irASeccion(SECCIONES.find(s => s.key === 'gar'))}
                                className="text-left bg-white border border-zinc-200 rounded-2xl p-4 hover:border-brand-cyan/40 transition-colors">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Garantía</div>
                                {gar?.texto ? (
                                    <>
                                        <div className={`mt-1 text-xl font-black ${gar.tono === 'bad' ? 'text-red-700' : gar.tono === 'warn' ? 'text-amber-700' : 'text-emerald-700'}`}>{gar.texto}</div>
                                        <div className="text-xs text-zinc-500">Vence el {gar.vence.toLocaleDateString('es-UY')} · instalada hace {gar.antiguedad}{ficha.Datos?.gar?.proveedor ? ` · ${ficha.Datos.gar.proveedor}` : ''}</div>
                                    </>
                                ) : <div className="mt-1 text-sm text-zinc-400">{gar ? `Instalada hace ${gar.antiguedad}; sin duración de garantía.` : 'Sin datos.'}</div>}
                            </button>
                        </div>
                        {ficha.disponible && (
                            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
                                <div className="flex items-baseline justify-between gap-2">
                                    <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Ficha técnica</div>
                                    <div className="text-sm font-black text-zinc-700">{pct}% completa</div>
                                </div>
                                <div className="mt-2 h-1.5 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-brand-cyan" style={{ width: `${pct}%` }} /></div>
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-1">
                                    {comp.map(({ sec, hechos, total }) => (
                                        <button key={sec.key} type="button" onClick={() => irASeccion(sec)}
                                            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50">
                                            <span className="truncate">{sec.titulo}</span>
                                            <span className={`font-mono text-xs font-bold ${hechos === total ? 'text-emerald-700' : hechos > 0 ? 'text-amber-700' : 'text-zinc-300'}`}>{hechos === 0 ? 'sin cargar' : `${hechos}/${total}`}</span>
                                        </button>
                                    ))}
                                </div>
                                {ficha.FechaModif && <p className="mt-2 text-[11px] text-zinc-400">Última modificación: {fmtFecha(ficha.FechaModif)}{ficha.UsuarioNombre ? ` · ${ficha.UsuarioNombre}` : ''}</p>}
                            </div>
                        )}
                    </>
                )}

                {tab === 'ficha' && (
                    <FichaTecnica eq={eq} meta={meta} tec={tec} pestana="ficha" catalogos={catalogos} tipo={tipo} tipoSugerido={tipoSugerido} onRecargar={recargarTodo} />
                )}
                {tab === 'comercial' && (
                    <FichaTecnica eq={eq} meta={meta} tec={tec} pestana="comercial" catalogos={catalogos} tipo={tipo} tipoSugerido={tipoSugerido} onRecargar={recargarTodo} />
                )}

                {tab === 'servicio' && (
                    <>
                        {/* Sub-secciones: lo que tenía el panel de la máquina */}
                        <div className="flex flex-wrap gap-1.5">
                            {[['fallas', `Solicitudes (${eq.solicitudes.length})`], ['cambios', `Cambios (${eq.cambios.length})`], ['preventivo', 'Preventivo'], ['repuestos', 'Repuestos'], ['historial', 'Historial'], ['insumos', 'Insumos']].map(([k, t]) => (
                                <button key={k} type="button" onClick={() => setSub(k)} aria-pressed={sub === k}
                                    className={`px-3 py-1.5 rounded-full border text-sm font-bold transition-colors ${sub === k ? 'bg-brand-cyan text-white border-brand-cyan' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'}`}>
                                    {t}
                                </button>
                            ))}
                        </div>

                        {sub === 'fallas' && (
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

                        {sub === 'cambios' && (
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

                        {/* Historial: estados, ficha técnica y capacidad (qué cambió, quién y cuándo) */}
                        {sub === 'historial' && (
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

                        {sub === 'preventivo' && <PreventivoMaquina eq={eq} meta={meta} version={version} onAbrirTrabajo={onAbrirTrabajo} />}
                        {sub === 'repuestos' && <RepuestosMaquina eq={eq} meta={meta} version={version} />}

                        {sub === 'insumos' && (
                            <InsumosUsados filtro={{ equipo: equipoId }} version={version} puedeUsar={tec}
                                contexto={{ equipoId, titulo: eq.Nombre }} onCambio={() => { cargar(); onCambio?.(); }} />
                        )}
                    </>
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
            {preguntaBordado && (
                <ModalCabezalesFuncionando eq={eq} datos={ficha.Datos} {...preguntaBordado}
                    onCerrar={() => setPreguntaBordado(null)} onHecho={() => { setPreguntaBordado(null); recargarTodo(); }} />
            )}
            {modal === 'copiar' && (
                <MiniModal titulo={`Copiar ficha técnica a ${eq.Nombre}`} onCerrar={() => setModal(null)} pie={<>
                    <button onClick={() => setModal(null)} className={btnCancelar}>Cancelar</button>
                    <button onClick={() => accion(() => servicioTecnicoService.copiarFicha(eq.EquipoID, copiarDe), 'Ficha copiada')} disabled={!copiarDe} className={btnPri}>
                        <Copy size={15} /> Copiar
                    </button>
                </>}>
                    {conFicha.length === 0 ? <p className="text-sm text-zinc-500">Ninguna otra máquina tiene ficha técnica todavía.</p> : (
                        <>
                            <div>
                                <span className={label}>Copiar de</span>
                                <Selector value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)} aria-label="Máquina de la que se copia" buscar>
                                    <option value="">Elegir máquina…</option>
                                    {[...new Set(conFicha.map(e => e.AreaNombre || e.AreaID))].map(area => (
                                        <optgroup key={area} label={area}>
                                            {conFicha.filter(e => (e.AreaNombre || e.AreaID) === area).map(e => (
                                                <option key={e.EquipoID} value={String(e.EquipoID)} descripcion={[tipoLabel(e.Tipo), [e.Marca, e.Modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || undefined}>{e.Nombre}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </Selector>
                            </div>
                            <p className="text-sm text-zinc-600">
                                Se <b>reemplaza</b> toda la ficha técnica de {eq.Nombre}{ficha.Tipo || ficha.Marca ? ' (lo que tiene ahora se pierde)' : ''}.
                            </p>
                            <p className="text-xs text-zinc-500">
                                No se copia lo que es de cada máquina: n.º de serie, ubicación, IP, licencia, fecha de instalación, factura, ni el n.º de serie, la fecha y el estado de cabezales y herramientas (quedan en «Operativo»). La capacidad tampoco: se carga aparte.
                            </p>
                        </>
                    )}
                </MiniModal>
            )}
        </div>
    );
};

export default MaquinaFicha;
