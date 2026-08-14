import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Search, Lock, CheckCircle2, MessageSquare, Image as ImageIcon, ExternalLink, Flame, Play, Pause, FlagTriangleRight, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { getBandejaService } from '../../services/modules/embBoardService';
import { usersService } from '../../services/modules/usersService';
import { useAuth } from '../../context/AuthContext';
import { ordersService } from '../../services/modules/ordersService';
import OrderRequirementsList from '../logistics/OrderRequirementsList';
import { printLabelsHelper } from '../../utils/printHelper';
import OrdenProntaModal from './components/OrdenProntaModal';

// Nombre a mostrar por área — Bordado (EMB), Estampado (EST), Corte Láser (TWC) y Taller
// Costura (TWT) comparten toda la lógica de bandeja/control, solo cambia el rótulo visible.
const AREA_META = {
    EMB: { nombre: 'Bordado', verbo: 'trabajado' },
    EST: { nombre: 'Estampado', verbo: 'trabajado' },
    TWC: { nombre: 'Corte', verbo: 'trabajado' },
    TWT: { nombre: 'Costura', verbo: 'trabajado' },
};

// [CORTE] Tarjeta de UNA TIZADA: el avance se lleva por archivo (cada tizada es un corte
// distinto, con sus propias piezas), no de a una bolsa de piezas sueltas de la orden.
// Sirve para las dos fases: `campo` decide si cuenta lo trabajado o lo controlado.
/**
 * Miniatura del arte del cliente (boceto, logo, prediseño) con link al archivo.
 *
 * La miniatura de Drive solo carga si el archivo quedó compartido; si no, devuelve
 * error y ANTES el recuadro quedaba en blanco, sin ícono ni nombre — el bordador
 * no sabía si no había arte o si no se veía. Ahora intenta en orden:
 *   1. la miniatura de Drive
 *   2. la miniatura local que genera el sistema al subir (thumbnailGenerator)
 *   3. un recuadro con el nombre del archivo, igual clickeable
 *
 * Y el link va SIEMPRE al archivo real (UbicacionStorage), no a la miniatura:
 * antes se abría la misma imagen chica y no servía para mirar el detalle.
 */
const MiniaturaRef = ({ archivo, codigoOrden }) => {
    const localUrl = archivo.RefID && codigoOrden
        ? `/thumbnails/${encodeURIComponent(codigoOrden)}/${archivo.RefID}.jpg`
        : null;
    const fuentes = [archivo.previewUrl, localUrl].filter(Boolean);
    const [intento, setIntento] = useState(0);

    const src = fuentes[intento] || null;
    const destino = archivo.UbicacionStorage || archivo.previewUrl;
    const nombre = archivo.NombreOriginal || archivo.label;

    return (
        <a
            href={destino}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-center group"
            title={`Abrir "${nombre}" en tamaño completo`}
        >
            <div className="relative w-20 h-20 rounded-xl bg-white border border-zinc-200 flex items-center justify-center overflow-hidden group-hover:border-brand-cyan transition-colors">
                {src ? (
                    <img
                        src={src}
                        alt={archivo.label}
                        className="w-full h-full object-cover"
                        onError={() => setIntento(n => n + 1)}
                    />
                ) : (
                    <div className="px-1 text-center">
                        <ImageIcon size={18} className="text-zinc-300 mx-auto" />
                        <span className="block text-[8px] font-bold text-zinc-400 leading-tight mt-0.5 line-clamp-2 break-all">
                            {String(nombre).replace(/^REF-\d+-/, '')}
                        </span>
                    </div>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-zinc-900/75 text-white text-[8px] font-black uppercase tracking-wide py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    Ver grande
                </span>
            </div>
            <span className="text-[9px] font-bold text-zinc-400 uppercase mt-1 block">{archivo.label}</span>
        </a>
    );
};

const TizadaAvanceCard = ({ tizada, ordenId, service, campo, onChanged, bloqueado = false }) => {
    const total = parseInt(tizada.PiezasTotal) || 0;
    const valorInicial = parseInt(campo === 'control' ? tizada.PiezasControladas : tizada.PiezasTrabajadas) || 0;
    const [count, setCount] = useState(valorInicial);
    const [draft, setDraft] = useState(String(valorInicial));
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setCount(valorInicial);
        setDraft(String(valorInicial));
    }, [tizada.ArchivoID, valorInicial]);

    const isCompleted = total > 0 && count >= total;
    const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
    const esControl = campo === 'control';

    const commit = async (nextVal) => {
        const val = Math.max(0, Math.min(total || nextVal, nextVal));
        const previo = count;
        setLoading(true);
        setCount(val); // optimista
        try {
            if (esControl) await service.setProgresoControlArchivo(ordenId, tizada.ArchivoID, val);
            else await service.setProgresoArchivo(ordenId, tizada.ArchivoID, val);
            onChanged?.(tizada.ArchivoID, val);
        } catch (e) {
            setCount(previo);
            setDraft(String(previo));
            toast.error(e?.response?.data?.error || 'Error al guardar el conteo');
        } finally {
            setLoading(false);
        }
    };

    const commitDraft = () => {
        if (loading) return;
        let val = parseInt(draft, 10);
        if (isNaN(val)) { setDraft(String(count)); return; }
        if (val < 0) val = 0;
        if (total > 0 && val > total) val = total;
        if (val === count) { setDraft(String(val)); return; }
        commit(val);
    };

    // Nombre corto: el archivo viene con el prefijo largo de la orden
    const nombreCorto = String(tizada.NombreArchivo || '').replace(/^.*?_Archivo /, 'Archivo ');

    return (
        <div className={`p-3 rounded-xl border transition-all ${isCompleted ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-zinc-200'}`}>
            <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-zinc-700 text-sm truncate" title={tizada.NombreArchivo}>{nombreCorto}</div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                        <span className="text-[10px] font-bold text-zinc-500 bg-zinc-100 border border-zinc-200 rounded px-1.5 py-0.5">
                            {tizada.Piezas} piezas × {tizada.Copias || 1} {(tizada.Copias || 1) === 1 ? 'corte' : 'cortes'}
                        </span>
                        {tizada.MetrosCorteTotal > 0 && (
                            <span className="text-[10px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 py-0.5">
                                {tizada.MetrosCorteTotal.toFixed(2)} m de corte
                            </span>
                        )}
                        {tizada.MetrosTelaTotal > 0 && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                {tizada.MetrosTelaTotal.toFixed(2)} m de tela
                            </span>
                        )}
                        {/* [BORDADO] Medidas y puntadas del diseño */}
                        {(tizada.Ancho > 0 && tizada.Alto > 0) && (
                            <span className="text-[10px] font-bold text-zinc-600 bg-zinc-100 border border-zinc-200 rounded px-1.5 py-0.5">
                                {tizada.Ancho} × {tizada.Alto} cm
                            </span>
                        )}
                        {tizada.PuntadasEstimadas > 0 && (
                            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5"
                                title="Estimación por área y densidad. El número real sale del ponchado.">
                                ≈ {Number(tizada.PuntadasEstimadas).toLocaleString('es-UY')} puntadas
                            </span>
                        )}
                    </div>

                    {/* [BORDADO] Secuencia de hilos: en qué orden borda la máquina, con qué
                        color y con qué puntada. Es lo primero que mira el bordador antes de
                        enhebrar — antes tenía que deducirlo de una imagen. */}
                    {(tizada.Paleta || []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {tizada.Paleta.map((p, i) => (
                                <span
                                    key={p.id || i}
                                    className="flex items-center gap-1 text-[10px] font-bold text-zinc-600 bg-white border border-zinc-200 rounded px-1.5 py-0.5"
                                    title={`Parada ${i + 1}: ${p.hilo || ''} · ${p.puntada || ''}${p.relieve ? ' · EN RELIEVE 3D' : ''}`}
                                >
                                    <span className="text-zinc-400">{i + 1}</span>
                                    <span
                                        className="w-3 h-3 rounded-full border border-zinc-300 shrink-0"
                                        style={{ backgroundColor: p.colorOriginal || '#ccc' }}
                                    />
                                    <span>{p.puntada === 'TAFETA' ? 'Tafeta' : (p.puntada || '').toLowerCase()}</span>
                                    {p.relieve && <span className="text-amber-600 font-black">3D</span>}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <div className="text-right shrink-0">
                    <span className="text-[9px] font-black text-zinc-300 uppercase leading-none mb-0.5 tracking-wider block">
                        {esControl ? 'Controladas' : 'Cortadas'}
                    </span>
                    <div className="flex items-baseline justify-end gap-0.5 leading-none">
                        <input
                            type="number" min={0} max={total}
                            value={draft}
                            disabled={loading || bloqueado}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commitDraft}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                            title={esControl ? 'Piezas ya verificadas de esta tizada' : 'Piezas ya cortadas de esta tizada'}
                            className="w-14 text-right text-xl font-black text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-md px-1 py-0.5 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-sm text-zinc-300 font-bold">/{total}</span>
                    </div>
                </div>

                <div className="w-10 shrink-0 flex justify-center">
                    {isCompleted
                        ? <CheckCircle2 size={22} className="text-emerald-500" />
                        : <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); if (!loading && !isCompleted && !bloqueado) { setDraft(String(count + 1)); commit(count + 1); } }}
                            disabled={loading || bloqueado}
                            title="Sumar una pieza"
                            className="w-9 h-9 rounded-full bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30 hover:bg-brand-cyan hover:text-white transition-all flex items-center justify-center disabled:opacity-40"
                        ><Plus size={16} /></button>}
                </div>
            </div>

            <div className="mt-2 h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
                <div className={`h-full transition-all ${isCompleted ? 'bg-emerald-500' : 'bg-brand-cyan'}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

// Tarjeta de conteo de Control — mismo lenguaje visual que FileControlCard.jsx (el "+1"
// circular que usan SB/DTF/TPU para contar copias por archivo), pero contando PRENDAS de
// la orden entera en vez de copias de un archivo: acá no hay archivos que controlar uno
// por uno, la orden completa ES la unidad a contar.
const ControlPrendaCard = ({ order, service, onChanged }) => {
    const total = parseFloat(order.MagnitudEfectiva || order.Magnitud) || 0;
    const [count, setCount] = useState(parseFloat(order.CantidadControlada) || 0);
    const [draft, setDraft] = useState(String(parseFloat(order.CantidadControlada) || 0));
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const c = parseFloat(order.CantidadControlada) || 0;
        setCount(c);
        setDraft(String(c));
    }, [order.OrdenID, order.CantidadControlada]);

    const isCompleted = total > 0 && count >= total;

    const commit = async (nextVal) => {
        const val = Math.max(0, Math.min(total || nextVal, nextVal));
        setLoading(true);
        setCount(val); // optimista
        try {
            await service.setProgresoControl(order.OrdenID, val || 1);
            onChanged?.(val);
        } catch (e) {
            setCount(count); // revertir
            setDraft(String(count));
            toast.error(e?.response?.data?.error || 'Error al guardar el conteo');
        } finally {
            setLoading(false);
        }
    };

    const handleIncrement = (e) => {
        e.stopPropagation();
        if (loading || isCompleted) return;
        const next = count + 1;
        setDraft(String(next));
        commit(next);
    };

    const handleUndo = (e) => {
        e.stopPropagation();
        if (loading || count === 0) return;
        const next = count - 1;
        setDraft(String(next));
        commit(next);
    };

    const commitDraft = () => {
        if (loading) return;
        let val = parseInt(draft, 10);
        if (isNaN(val)) { setDraft(String(count)); return; }
        if (val < 0) val = 0;
        if (total > 0 && val > total) val = total;
        if (val === count) { setDraft(String(val)); return; }
        commit(val);
    };

    return (
        <div className={`relative flex items-center gap-4 p-3 rounded-xl border transition-all ${isCompleted ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-zinc-200'}`}>
            <div className="w-14 h-14 shrink-0 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center overflow-hidden">
                {order.PreviewUrl ? (
                    <img src={order.PreviewUrl} alt="" className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                ) : null}
                <ImageIcon size={16} className="text-zinc-300" style={{ display: order.PreviewUrl ? 'none' : 'flex' }} />
            </div>

            <div className="flex-1 min-w-0">
                <div className="font-bold text-zinc-700 text-sm truncate">{order.CodigoOrden}</div>
                <div className="text-xs text-zinc-400 truncate">{order.Material}</div>
            </div>

            <div className="text-right shrink-0">
                <span className="text-[9px] font-black text-zinc-300 uppercase leading-none mb-0.5 tracking-wider block">Prendas</span>
                {total > 1 && !isCompleted ? (
                    <div className="flex items-baseline justify-end gap-0.5 leading-none">
                        <input
                            type="number" min={0} max={total}
                            value={draft}
                            disabled={loading}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commitDraft}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                            title="Escribí la cantidad controlada"
                            className="w-12 text-right text-xl font-black text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-md px-1 py-0.5 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-sm text-zinc-300 font-bold">/{total}</span>
                    </div>
                ) : (
                    <div className={`text-xl font-black leading-none ${isCompleted ? 'text-emerald-600' : 'text-zinc-700'}`}>
                        {count}<span className="text-sm text-zinc-300 font-bold">/{total || '?'}</span>
                    </div>
                )}
            </div>

            <div className="w-11 h-11 shrink-0">
                {isCompleted ? (
                    <button
                        onClick={handleUndo}
                        disabled={loading}
                        title="Deshacer (restar una prenda)"
                        className="w-full h-full rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors active:scale-95"
                    >
                        {loading ? <RefreshCw size={16} className="animate-spin" /> : <Check size={18} />}
                    </button>
                ) : (
                    <button
                        onClick={handleIncrement}
                        disabled={loading}
                        className={`w-full h-full rounded-full flex items-center justify-center shadow-sm transition-all active:scale-95 ${loading ? 'bg-zinc-100 text-zinc-400' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-200'}`}
                    >
                        {loading ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={18} />}
                    </button>
                )}
            </div>
        </div>
    );
};

// Bandeja de órdenes — NO arma lotes, cada tarjeta es UNA orden. Layout tipo master-detail,
// mismo patrón que Terminaciones ECOUV (EcoUvFinishing.jsx): lista compacta a la izquierda
// (w-80), panel de detalle a la derecha — nada de modal popup al clickear una tarjeta, todo
// se ve/edita ahí mismo (máquina, operario, requisitos, notas). El botón "Ver ficha
// completa" es el único que abre el modal grande, para lo que todavía vive solo ahí (subir
// la matriz DST/EMB en Bordado, archivos de impresión). Nació para Bordado (EMB) y se
// generalizó para Estampado (EST) — misma lógica, `area` cambia qué endpoint/rótulo usa.
//
// fase='trabajo' (default): pendientes CON todos los requisitos cumplidos (+ una lista
//   aparte de las que todavía están bloqueadas, con qué les falta).
// fase='control': en 'Control y Calidad' (trabajo terminado), esperando el conteo de
//   prendas controladas (contador APARTE del de trabajo) y la cantidad de bultos antes de
//   aprobar — recién ahí se generan las etiquetas y la orden pasa a Pronto (igual patrón
//   que Terminaciones ECOUV, ver ecoUvFinishingController.controlOrder).
export default function EmbBandeja({ area = 'EMB', fase = 'trabajo', onSelectOrder }) {
    const { user } = useAuth();
    const service = getBandejaService(area);
    const meta = AREA_META[area] || { nombre: area, verbo: 'trabajado' };
    const [orders, setOrders] = useState([]);
    const [bloqueadas, setBloqueadas] = useState([]);
    const [maquinas, setMaquinas] = useState([]);
    const [operarios, setOperarios] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [completedOrderData, setCompletedOrderData] = useState(null);

    // Notas del panel de detalle
    const [notas, setNotas] = useState([]);
    const [loadingNotas, setLoadingNotas] = useState(false);
    const [nuevaNota, setNuevaNota] = useState('');
    const [guardandoNota, setGuardandoNota] = useState(false);

    const todas = [...orders, ...bloqueadas];
    const selected = todas.find(o => o.OrdenID === selectedId) || null;
    const selectedBloqueada = bloqueadas.some(o => o.OrdenID === selectedId);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [data, maqs] = await Promise.all([
                service.getOrders(fase),
                service.getMaquinas(),
            ]);
            setOrders(data || []);
            setMaquinas(maqs || []);
            if (fase === 'trabajo') {
                const bloq = await service.getOrdersBloqueadas();
                setBloqueadas(bloq || []);
            } else {
                setBloqueadas([]);
            }
        } catch (e) {
            console.error(`Error cargando bandeja ${area}`, e);
        } finally {
            setLoading(false);
        }
    }, [fase, area]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { load(); }, [load]);

    // Operarios: SOLO los del área (antes, si el área no tenía ninguno, caía en "todos" y
    // aparecían usuarios de otras áreas — ej. el genérico de ECOUV en Corte). El usuario
    // logueado se agrega siempre: es quien está trabajando acá ahora, y sin él un área sin
    // usuarios cargados quedaría trabada (no se puede iniciar sin operario).
    useEffect(() => {
        usersService.getAll().then(list => {
            const todosUsr = Array.isArray(list) ? list : (list?.data || []);
            const delArea = todosUsr.filter(u => (u.AreaUsuario || '').trim().toUpperCase() === area && u.Activo !== false);
            const yo = todosUsr.find(u => String(u.IdUsuario) === String(user?.id));
            if (yo && !delArea.some(u => String(u.IdUsuario) === String(yo.IdUsuario))) delArea.push(yo);
            setOperarios(delArea);
        }).catch(() => {});
    }, [area, user?.id]);

    // Precargar al usuario logueado como operario de la orden que se abre, si todavía no
    // tiene uno. Queda guardado (no es solo visual) para que el gate de iniciar lo tome.
    useEffect(() => {
        if (fase !== 'trabajo' || !selected || selected.OperarioAsignadoID || !user?.id) return;
        if (!operarios.some(u => String(u.IdUsuario) === String(user.id))) return;
        handleOperario(selected, user.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, operarios.length, user?.id]);

    // Cargar notas del seleccionado
    const loadNotas = useCallback(async () => {
        if (!selectedId) { setNotas([]); return; }
        setLoadingNotas(true);
        try {
            const data = await ordersService.getOrderNotes(selectedId);
            setNotas(data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingNotas(false);
        }
    }, [selectedId]);

    useEffect(() => { loadNotas(); }, [loadNotas]);

    const handleAgregarNota = async () => {
        const texto = nuevaNota.trim();
        if (!texto || !selectedId) return;
        setGuardandoNota(true);
        try {
            const res = await ordersService.addOrderNote(selectedId, texto);
            if (res.success && res.data) {
                setNotas(prev => [res.data, ...prev]);
                setNuevaNota('');
            }
        } catch (e) {
            toast.error('Error al agregar la nota');
        } finally {
            setGuardandoNota(false);
        }
    };

    const matches = (o) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return [o.CodigoOrden, o.Cliente, o.Material, o.DescripcionTrabajo].some(v => (v || '').toLowerCase().includes(q));
    };

    const filtered = orders.filter(matches);
    const filteredBloqueadas = bloqueadas.filter(matches);

    const updateLocal = (ordenId, patch) => {
        setOrders(prev => prev.map(o => o.OrdenID === ordenId ? { ...o, ...patch } : o));
    };

    const handleMaquina = async (o, maquinaId) => {
        const nombre = maquinas.find(m => String(m.EquipoID) === String(maquinaId))?.Nombre || null;
        updateLocal(o.OrdenID, { MaquinaID: maquinaId || null, MaquinaNombre: nombre });
        try { await service.asignarMaquina(o.OrdenID, maquinaId || null); }
        catch (e) { toast.error('Error al asignar máquina'); load(); }
    };

    const handleOperario = async (o, operarioId) => {
        const nombre = operarios.find(u => String(u.IdUsuario) === String(operarioId))?.Nombre || null;
        updateLocal(o.OrdenID, { OperarioAsignadoID: operarioId || null, OperarioNombre: nombre });
        try { await service.asignarOperario(o.OrdenID, operarioId || null); }
        catch (e) { toast.error('Error al asignar operario'); load(); }
    };

    // Inicio/Pausa — mismos verbos que un lote (MachineControl.jsx: Iniciar/Pausar/Finalizar).
    const handleEstadoTrabajo = async (o, estado) => {
        updateLocal(o.OrdenID, { EstadoTrabajoEmb: estado });
        try { await service.setEstadoTrabajo(o.OrdenID, estado); }
        catch (e) { toast.error('Error al actualizar el estado de trabajo'); load(); }
    };

    // "Fin" de la Bandeja: el trabajo terminó, pasa a Control y Calidad. Todavía sin
    // etiqueta/bulto — eso se decide en Control (ver handleAprobarControl).
    const [finalizando, setFinalizando] = useState(null);
    const handleFin = async (o) => {
        if (finalizando) return;
        setFinalizando(o.OrdenID);
        try {
            await service.finalizarTrabajo(o.OrdenID);
            toast.success('Trabajo terminado: la orden pasó a Control y Calidad.');
            setOrders(prev => prev.filter(x => x.OrdenID !== o.OrdenID));
            if (selectedId === o.OrdenID) setSelectedId(null);
            load();
        } catch (e) {
            toast.error('Error al finalizar: ' + (e?.response?.data?.error || e?.message || ''));
        } finally {
            setFinalizando(null);
        }
    };

    // Progreso de trabajo — cuántas prendas ya trabajadas, para el % de avance (fase trabajo).
    const [progresoInput, setProgresoInput] = useState('');
    useEffect(() => { setProgresoInput(selected?.CantidadTerminada ?? ''); }, [selectedId]); // eslint-disable-line
    const handleGuardarProgreso = async (o) => {
        const cant = parseFloat(progresoInput);
        const total = parseFloat(o.MagnitudEfectiva || o.Magnitud) || 0;
        if (isNaN(cant)) return toast.error('Cantidad inválida.');
        if (cant < 1) return toast.error('La cantidad trabajada debe ser al menos 1.');
        if (cant > total) return toast.error(`No puede superar la cantidad total de prendas (${total}).`);
        updateLocal(o.OrdenID, { CantidadTerminada: cant });
        try { await service.setProgreso(o.OrdenID, cant); toast.success('Progreso guardado.'); }
        catch (e) { toast.error(e?.response?.data?.error || 'Error al guardar el progreso'); load(); }
    };

    // Aprobar Control: pide la cantidad de bultos con un prompt explícito (no un campo que
    // se puede pasar por alto) y, al aprobar, abre la impresión de etiquetas — igual patrón
    // que Terminaciones ECOUV (EcoUvFinishing.handleFinishOrder + printLabelsHelper).
    const [aprobando, setAprobando] = useState(null);
    const handleAprobarControl = async (o) => {
        if (aprobando) return;
        const total = parseFloat(o.MagnitudEfectiva || o.Magnitud) || 0;
        const controlado = parseFloat(o.CantidadControlada) || 0;
        if (total > 0 && controlado < total) {
            return toast.error(`Controlaste ${controlado} de ${total} prenda(s): completá el conteo antes de aprobar.`);
        }
        const respuesta = window.prompt(`¿Cuántos bultos salen de la orden ${o.CodigoOrden}? Se genera una etiqueta por cada uno.`, '1');
        if (respuesta === null) return; // canceló
        const bultos = Math.max(1, parseInt(respuesta, 10) || 1);
        setAprobando(o.OrdenID);
        try {
            const res = await service.aprobarControl(o.OrdenID, bultos);
            setOrders(prev => prev.filter(x => x.OrdenID !== o.OrdenID));
            if (selectedId === o.OrdenID) setSelectedId(null);
            load();
            // Mismo modal "¡Orden Pronta!" que el área de Impresión (FilePrintControl), para
            // que la confirmación se vea/comporte igual en todas las áreas sin lotes.
            if (res.esperandoHermanaEst) {
                setCompletedOrderData({
                    mensajeEspera: `${o.CodigoOrden} aprobada. El bulto final del pedido queda pendiente hasta que se apruebe la otra hermana de Estampado (DTF/TPU) de la misma prenda.`,
                });
            } else {
                setCompletedOrderData({
                    ordenId: o.OrdenID,
                    destino: AREA_META[res.areaID]?.nombre || res.areaID || meta.nombre,
                    proximoServicio: res.proximoServicio,
                });
            }
        } catch (e) {
            toast.error('Error al aprobar: ' + (e?.response?.data?.error || e?.message || ''));
        } finally {
            setAprobando(null);
        }
    };

    const ListaCard = ({ o, bloqueada }) => {
        const isSelected = selectedId === o.OrdenID;
        const isUrgent = (o.Prioridad || '').toLowerCase() === 'urgente';
        return (
            <div
                onClick={() => setSelectedId(o.OrdenID)}
                className={`group p-4 rounded-xl border cursor-pointer transition-all duration-200 relative overflow-hidden ${
                    isSelected
                        ? 'bg-brand-cyan/5 border-brand-cyan shadow-md ring-1 ring-brand-cyan'
                        : bloqueada
                            ? 'bg-zinc-50 border-dashed border-zinc-300 opacity-80 hover:border-zinc-400'
                            : 'bg-white border-zinc-200 hover:border-brand-cyan/40 hover:shadow-sm'
                }`}
            >
                {isUrgent && <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500"></div>}
                <div className="flex gap-2.5 pl-2">
                    <div className="w-10 h-10 shrink-0 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center overflow-hidden">
                        {o.PreviewUrl ? (
                            <img src={o.PreviewUrl} alt="" className="w-full h-full object-cover"
                                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                        ) : null}
                        <ImageIcon size={14} className="text-zinc-300" style={{ display: o.PreviewUrl ? 'none' : 'flex' }} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-start mb-1">
                            <span className="font-mono text-xs font-bold text-zinc-600">{o.CodigoOrden}</span>
                            {bloqueada ? <Lock size={12} className="text-zinc-400" /> : isUrgent && <Flame size={12} className="text-amber-500" />}
                        </div>
                        <h3 className="font-bold text-zinc-800 text-sm leading-tight mb-1 line-clamp-1">{o.Cliente}</h3>
                        {o.DescripcionTrabajo && (
                            <p className="text-xs text-zinc-600 line-clamp-1 font-medium">{o.DescripcionTrabajo}</p>
                        )}
                        <p className="text-xs text-zinc-500 line-clamp-1 italic">{o.Material}</p>

                        {/* CORTE: lo que el operario necesita saber de un vistazo — cuántas
                            tizadas entran, cuántas piezas salen y cuánto láser lleva. */}
                        {(() => {
                            const tz = o.Tizadas || [];
                            if (tz.length === 0) return null;
                            const piezas = tz.reduce((s, t) => s + (parseInt(t.PiezasTotal) || 0), 0);
                            const corte = tz.reduce((s, t) => s + (parseFloat(t.MetrosCorteTotal) || 0), 0);
                            const tela = tz.reduce((s, t) => s + (parseFloat(t.MetrosTelaTotal) || 0), 0);
                            const hecho = tz.reduce((s, t) => s + (parseInt(t.PiezasTrabajadas) || 0), 0);
                            const pct = piezas > 0 ? Math.min(100, Math.round((hecho / piezas) * 100)) : 0;
                            return (
                                <div className="mt-1.5">
                                    <div className="flex flex-wrap gap-1">
                                        <span className="bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-zinc-200">
                                            {tz.length} {tz.length === 1 ? 'tizada' : 'tizadas'}
                                        </span>
                                        <span className="bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-cyan-200">
                                            {corte.toFixed(2)} m láser
                                        </span>
                                        <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-200">
                                            {tela.toFixed(2)} m tela
                                        </span>
                                    </div>
                                    {hecho > 0 && (
                                        <div className="mt-1.5 flex items-center gap-1.5">
                                            <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
                                                <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-cyan'}`} style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="text-[9px] font-black text-zinc-400">{hecho}/{piezas}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        <div className="mt-2 flex items-center gap-2">
                            {/* Las órdenes bloqueadas vienen sin magnitud (su query no la trae):
                                sin dato no se muestra el chip, antes decía "undefined u.". */}
                            {(o.MagnitudEfectiva || o.Magnitud) && (
                                <span className="bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded text-[10px] font-bold border border-zinc-200">
                                    {(o.Tizadas || []).length > 0
                                        ? `${o.MagnitudEfectiva || o.Magnitud} piezas`
                                        : `${o.MagnitudEfectiva || o.Magnitud} u.`}
                                </span>
                            )}
                            <span className="text-[10px] text-zinc-400 ml-auto">
                                {o.FechaIngreso ? new Date(o.FechaIngreso).toLocaleDateString('es-UY') : ''}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
        <div className="flex h-full bg-zinc-100 overflow-hidden rounded-2xl border border-zinc-200">
            {/* IZQUIERDA: LISTA */}
            <div className="w-80 bg-white border-r border-zinc-200 flex flex-col shrink-0">
                <div className="p-4 border-b border-zinc-100 bg-zinc-50">
                    <div className="flex items-center justify-between">
                        <h2 className="font-black text-zinc-700 uppercase tracking-wide text-sm">
                            {fase === 'control' ? `Control de ${meta.nombre}` : `Bandeja de ${meta.nombre}`}
                        </h2>
                        <button onClick={load} disabled={loading} className="text-zinc-400 hover:text-brand-cyan transition-colors">
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">
                        {fase === 'control' ? `${orders.length} listas para verificar` : `${orders.length} pendientes`}
                    </p>
                    <div className="relative mt-2">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar..."
                            className="w-full pl-8 pr-2 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-brand-cyan"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                    {loading && orders.length === 0 && (
                        <div className="text-center py-10 text-zinc-400 text-xs">Cargando...</div>
                    )}
                    {!loading && filtered.length === 0 && filteredBloqueadas.length === 0 && (
                        <div className="text-center py-10 text-zinc-400">
                            <CheckCircle2 size={28} className="mx-auto mb-2 opacity-30" />
                            <p className="text-xs">Nada acá por ahora.</p>
                        </div>
                    )}
                    {filtered.map(o => <ListaCard key={o.OrdenID} o={o} bloqueada={false} />)}

                    {fase === 'trabajo' && filteredBloqueadas.length > 0 && (
                        <>
                            <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide pt-2 pb-1 flex items-center gap-1.5">
                                <Lock size={11} /> Esperando requisitos ({filteredBloqueadas.length})
                            </div>
                            {filteredBloqueadas.map(o => <ListaCard key={o.OrdenID} o={o} bloqueada={true} />)}
                        </>
                    )}
                </div>
            </div>

            {/* DERECHA: DETALLE */}
            <div className="flex-1 overflow-y-auto bg-zinc-50/50 p-6">
                {!selected ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-300">
                        <CheckCircle2 size={48} className="mb-3 opacity-40" />
                        <p className="text-sm font-medium">Elegí una orden de la lista</p>
                    </div>
                ) : (
                    <div className="max-w-2xl">
                        {/* Previews: boceto y logo/matriz por separado, no un solo genérico */}
                        <div className="flex gap-3 mb-4">
                            {(() => {
                                const refs = selected.Referencias || [];
                                const boceto = refs.find(f => f.esBoceto);
                                const logo = refs.find(f => f.esLogo);
                                // [BORDADO] El prediseño del cliente: cómo quiere que quede.
                                // Va rotulado aparte para que nadie lo confunda con el arte
                                // original ni con la matriz.
                                const prediseno = refs.find(f => f.esPrediseno);
                                const otras = refs.filter(f => f !== boceto && f !== logo && f !== prediseno);
                                const items = [
                                    boceto && { ...boceto, label: 'Boceto' },
                                    logo && { ...logo, label: 'Logo' },
                                    prediseno && { ...prediseno, label: 'Prediseño' },
                                    ...(!boceto && !logo && !prediseno ? otras.slice(0, 2).map(f => ({ ...f, label: 'Referencia' })) : []),
                                ].filter(Boolean);
                                if (items.length === 0) {
                                    return (
                                        <div className="w-20 h-20 shrink-0 rounded-xl bg-white border border-zinc-200 flex items-center justify-center">
                                            <ImageIcon size={24} className="text-zinc-300" />
                                        </div>
                                    );
                                }
                                return items.map((f, i) => (
                                    <MiniaturaRef key={i} archivo={f} codigoOrden={selected.CodigoOrden} />
                                ));
                            })()}
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <h2 className="font-mono font-black text-xl text-zinc-800">{selected.CodigoOrden}</h2>
                                    {selected.Prioridad && selected.Prioridad.toLowerCase() !== 'normal' && (
                                        <span className="text-[10px] font-black uppercase bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full">{selected.Prioridad}</span>
                                    )}
                                </div>
                                <p className="text-zinc-600 font-medium">{selected.Cliente}</p>
                                <p className="text-sm text-zinc-400">{selected.Material} · {selected.MagnitudEfectiva || selected.Magnitud} prenda(s)</p>
                            </div>
                            <button
                                onClick={() => onSelectOrder?.({ id: selected.OrdenID, area, codigo: selected.CodigoOrden, cliente: selected.Cliente })}
                                className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-brand-cyan hover:bg-brand-cyan/5 border border-brand-cyan/30 rounded-lg px-3 py-2 transition-colors"
                            >
                                <ExternalLink size={13} /> Ficha completa
                            </button>
                        </div>

                        {/* Nota general del pedido (Ordenes.Nota — la del ingreso, distinta de las
                            Notas de producción de abajo, que son un historial aditivo aparte) */}
                        {selected.Nota && (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5">
                                <h3 className="text-[10px] font-black text-amber-600 uppercase tracking-wide mb-1">Nota general del pedido</h3>
                                <p className="text-sm text-amber-800 whitespace-pre-wrap">{selected.Nota}</p>
                            </div>
                        )}

                        {selectedBloqueada && (
                            <div className="bg-rose-50 border border-rose-200 text-rose-600 text-sm rounded-xl p-3 mb-5 flex items-center gap-2">
                                <Lock size={14} /> Falta: {selected.FaltantePendiente}
                            </div>
                        )}

                        {!selectedBloqueada && (
                            <div className="grid grid-cols-2 gap-3 mb-5">
                                <div>
                                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">Máquina</label>
                                    <select
                                        value={selected.MaquinaID || ''}
                                        onChange={(e) => handleMaquina(selected, e.target.value)}
                                        className="w-full mt-1 text-sm border border-zinc-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-brand-cyan"
                                    >
                                        <option value="">Sin máquina</option>
                                        {maquinas.map(m => <option key={m.EquipoID} value={m.EquipoID}>{m.Nombre}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">Operario</label>
                                    <select
                                        value={selected.OperarioAsignadoID || ''}
                                        onChange={(e) => handleOperario(selected, e.target.value)}
                                        className="w-full mt-1 text-sm border border-zinc-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-brand-cyan"
                                    >
                                        <option value="">Sin operario</option>
                                        {operarios.map(u => <option key={u.IdUsuario} value={u.IdUsuario}>{u.Nombre || u.Usuario}</option>)}
                                    </select>
                                </div>
                            </div>
                        )}

                        {!selectedBloqueada && fase === 'trabajo' && (() => {
                        // Sin máquina Y operario no se puede iniciar ni cargar avance (el
                        // backend también lo rechaza). Pausar/Finalizar siguen disponibles.
                        const faltaMaq = !selected.MaquinaID;
                        const faltaOp = !selected.OperarioAsignadoID;
                        const sinAsignar = faltaMaq || faltaOp;
                        const textoFalta = `Asigná ${[faltaMaq ? 'la máquina' : null, faltaOp ? 'el operario' : null].filter(Boolean).join(' y ')} para poder iniciar el trabajo y cargar las cantidades hechas.`;
                        // Finalizar solo si el trabajo se inició alguna vez (sigue disponible
                        // si quedó en pausa); si no, la orden saltaría a Control sin registro.
                        const yaIniciada = ['EN_PROCESO', 'PAUSADO'].includes(selected.EstadoTrabajoEmb);
                        return (
                            <div className="bg-white border border-zinc-200 rounded-2xl p-4 mb-5">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-black text-zinc-500 uppercase tracking-wide">Trabajo</h3>
                                    <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-200 rounded-lg p-1">
                                        <button
                                            onClick={() => handleEstadoTrabajo(selected, 'EN_PROCESO')}
                                            disabled={selected.EstadoTrabajoEmb === 'EN_PROCESO' || sinAsignar}
                                            title={sinAsignar ? textoFalta : 'Iniciar'}
                                            className={`w-8 h-8 rounded flex items-center justify-center transition-all ${(selected.EstadoTrabajoEmb === 'EN_PROCESO' || sinAsignar) ? 'text-zinc-300 cursor-not-allowed' : 'text-brand-cyan hover:bg-brand-cyan/10'}`}
                                        ><Play size={14} /></button>
                                        <button
                                            onClick={() => handleEstadoTrabajo(selected, 'PAUSADO')}
                                            disabled={selected.EstadoTrabajoEmb !== 'EN_PROCESO'}
                                            title="Pausar"
                                            className={`w-8 h-8 rounded flex items-center justify-center transition-all ${selected.EstadoTrabajoEmb !== 'EN_PROCESO' ? 'text-zinc-300 cursor-not-allowed' : 'text-amber-500 hover:bg-amber-50'}`}
                                        ><Pause size={14} /></button>
                                        {/* No se finaliza lo que nunca se inició (el backend
                                            también lo rechaza): la orden tiene que estar
                                            EN_PROCESO o PAUSADO. */}
                                        <button
                                            onClick={() => handleFin(selected)}
                                            disabled={finalizando === selected.OrdenID || !yaIniciada}
                                            title={!yaIniciada
                                                ? 'Primero iniciá el trabajo: no se puede finalizar una orden que nunca se empezó.'
                                                : 'Finalizar Tarea (pasa a Control y Calidad)'}
                                            className={`w-8 h-8 rounded flex items-center justify-center transition-all ${!yaIniciada ? 'text-zinc-300 cursor-not-allowed' : 'text-rose-500 hover:bg-rose-50'} disabled:opacity-40`}
                                        ><FlagTriangleRight size={14} /></button>
                                    </div>
                                </div>
                                <div className="text-xs mb-2">
                                    {selected.EstadoTrabajoEmb === 'EN_PROCESO' && <span className="text-brand-cyan font-bold">● Trabajando</span>}
                                    {selected.EstadoTrabajoEmb === 'PAUSADO' && <span className="text-amber-500 font-bold">● Pausado</span>}
                                    {!selected.EstadoTrabajoEmb && <span className="text-zinc-400">Sin iniciar</span>}
                                </div>

                                {/* Aviso claro de por qué está todo trabado */}
                                {sinAsignar && (
                                    <div className="mb-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                        <Lock size={14} className="text-amber-500 shrink-0 mt-0.5" />
                                        <p className="text-xs font-bold text-amber-700">{textoFalta}</p>
                                    </div>
                                )}

                                {/* Progreso de trabajo. CORTE: una fila por TIZADA (cada archivo
                                    lleva su propio conteo de piezas); el resto de las áreas
                                    mantiene el contador único de prendas de la orden. */}
                                {(() => {
                                    const total = parseFloat(selected.MagnitudEfectiva || selected.Magnitud) || 0;
                                    const hecho = parseFloat(selected.CantidadTerminada) || 0;
                                    const pct = total > 0 ? Math.min(100, Math.round((hecho / total) * 100)) : 0;
                                    const tizadas = selected.Tizadas || [];

                                    if (tizadas.length > 0) {
                                        return (
                                            <>
                                                <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden mb-1">
                                                    <div className="h-full bg-brand-cyan transition-all" style={{ width: `${pct}%` }} />
                                                </div>
                                                <p className="text-xs text-zinc-400 mb-3">{hecho} de {total} piezas cortadas ({pct}%)</p>
                                                <div className={`space-y-2 ${sinAsignar ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                                                    {tizadas.map(t => (
                                                        <TizadaAvanceCard
                                                            key={t.ArchivoID}
                                                            tizada={t}
                                                            ordenId={selected.OrdenID}
                                                            service={service}
                                                            campo="trabajo"
                                                            bloqueado={sinAsignar}
                                                            onChanged={(archivoId, val) => updateLocal(selected.OrdenID, {
                                                                Tizadas: tizadas.map(x => x.ArchivoID === archivoId ? { ...x, PiezasTrabajadas: val } : x),
                                                                CantidadTerminada: tizadas.reduce((s, x) => s + (x.ArchivoID === archivoId ? val : (parseInt(x.PiezasTrabajadas) || 0)), 0),
                                                            })}
                                                        />
                                                    ))}
                                                </div>
                                            </>
                                        );
                                    }

                                    return (
                                        <>
                                            <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden mb-2">
                                                <div className="h-full bg-brand-cyan transition-all" style={{ width: `${pct}%` }} />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max={total || undefined}
                                                    value={progresoInput}
                                                    onChange={(e) => setProgresoInput(e.target.value)}
                                                    placeholder="1"
                                                    disabled={sinAsignar}
                                                    title={sinAsignar ? textoFalta : undefined}
                                                    className="w-24 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-cyan disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed"
                                                />
                                                <span className="text-xs text-zinc-400">de {total} prendas trabajadas ({pct}%)</span>
                                                <button
                                                    onClick={() => handleGuardarProgreso(selected)}
                                                    disabled={sinAsignar}
                                                    title={sinAsignar ? textoFalta : undefined}
                                                    className="ml-auto text-xs font-bold text-brand-cyan hover:bg-brand-cyan/5 border border-brand-cyan/30 rounded-lg px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                >
                                                    Guardar
                                                </button>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        );
                        })()}

                        {/* CONTROL: tarjeta de conteo estilo FileControlCard (+1 circular) —
                            contador de prendas controladas, aparte del de trabajo. "Aprobar
                            Control" pregunta la cantidad de bultos con un prompt (no un campo
                            que se puede pasar por alto) y ahí genera las etiquetas + abre la
                            impresión. */}
                        {fase === 'control' && (() => {
                            const total = parseFloat(selected.MagnitudEfectiva || selected.Magnitud) || 0;
                            const controlado = parseFloat(selected.CantidadControlada) || 0;
                            const conteoCompleto = total === 0 || controlado >= total;
                            return (
                                <div className="bg-white border border-zinc-200 rounded-2xl p-4 mb-5">
                                    <h3 className="text-xs font-black text-emerald-600 uppercase tracking-wide mb-3">
                                        Control de Calidad
                                    </h3>

                                    {/* CORTE: se controla TIZADA POR TIZADA (cada archivo con sus
                                        piezas). El resto de las áreas cuenta la orden entera. */}
                                    <div className="mb-4 space-y-2">
                                        {(selected.Tizadas || []).length > 0 ? (
                                            (selected.Tizadas || []).map(t => (
                                                <TizadaAvanceCard
                                                    key={t.ArchivoID}
                                                    tizada={t}
                                                    ordenId={selected.OrdenID}
                                                    service={service}
                                                    campo="control"
                                                    onChanged={(archivoId, val) => {
                                                        const tz = selected.Tizadas || [];
                                                        updateLocal(selected.OrdenID, {
                                                            Tizadas: tz.map(x => x.ArchivoID === archivoId ? { ...x, PiezasControladas: val } : x),
                                                            CantidadControlada: tz.reduce((s, x) => s + (x.ArchivoID === archivoId ? val : (parseInt(x.PiezasControladas) || 0)), 0),
                                                        });
                                                    }}
                                                />
                                            ))
                                        ) : (
                                            <ControlPrendaCard
                                                order={selected}
                                                service={service}
                                                onChanged={(val) => updateLocal(selected.OrdenID, { CantidadControlada: val })}
                                            />
                                        )}
                                    </div>

                                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
                                        {conteoCompleto ? (
                                            <button
                                                onClick={() => handleAprobarControl(selected)}
                                                disabled={aprobando === selected.OrdenID}
                                                className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm shadow-emerald-200 transition-all flex items-center gap-2 disabled:opacity-50"
                                            >
                                                <CheckCircle2 size={14} /> Aprobar Control
                                            </button>
                                        ) : (
                                            <p className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                Contá todas las prendas para aprobar ({controlado}/{total})
                                            </p>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {fase === 'trabajo' && (
                            <div className="bg-white border border-zinc-200 rounded-2xl p-4 mb-5">
                                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-wide mb-3">Requisitos</h3>
                                <OrderRequirementsList ordenId={selected.OrdenID} areaId={area} />
                            </div>
                        )}

                        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
                            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                <MessageSquare size={13} /> Notas ({notas.length})
                            </h3>
                            <div className="flex gap-2 mb-3">
                                <textarea
                                    value={nuevaNota}
                                    onChange={(e) => setNuevaNota(e.target.value)}
                                    placeholder="Agregar nota..."
                                    rows={2}
                                    className="flex-1 text-sm border border-zinc-200 rounded-lg p-2 resize-none focus:outline-none focus:border-brand-cyan"
                                />
                                <button
                                    onClick={handleAgregarNota}
                                    disabled={guardandoNota || !nuevaNota.trim()}
                                    className="px-3 rounded-lg bg-brand-cyan text-white text-xs font-bold uppercase disabled:opacity-40 shrink-0"
                                >
                                    {guardandoNota ? '...' : 'Agregar'}
                                </button>
                            </div>
                            {loadingNotas ? (
                                <div className="text-xs text-zinc-400 text-center py-3">Cargando...</div>
                            ) : notas.length === 0 ? (
                                <div className="text-xs text-zinc-400 italic text-center py-3">Sin notas todavía.</div>
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                                    {notas.map(n => (
                                        <div key={n.NotaID} className="bg-zinc-50 border border-zinc-100 rounded-lg p-2.5">
                                            <p className="text-sm text-zinc-700 whitespace-pre-wrap">{n.Texto}</p>
                                            <div className="mt-1 text-[10px] font-bold text-zinc-400 uppercase">
                                                {n.UsuarioNombre || 'Sistema'} · {new Date(n.FechaCreacion).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
        <OrdenProntaModal
            data={completedOrderData}
            onImprimir={() => {
                const id = completedOrderData?.ordenId;
                setCompletedOrderData(null);
                if (id) printLabelsHelper(null, { id });
            }}
            onClose={() => setCompletedOrderData(null)}
        />
        </>
    );
}
