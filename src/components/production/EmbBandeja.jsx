import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Search, Lock, CheckCircle2, MessageSquare, Image as ImageIcon, ExternalLink, Flame, Play, Pause, FlagTriangleRight, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { getBandejaService } from '../../services/modules/embBoardService';
import { usersService } from '../../services/modules/usersService';
import { useAuth } from '../../context/AuthContext';
import { ordersService } from '../../services/modules/ordersService';
import OrderRequirementsList from '../logistics/OrderRequirementsList';
import { printLabelsHelper } from '../../utils/printHelper';
import { fmtFechaCorta } from '../../utils/fechas';
import OrdenProntaModal from './components/OrdenProntaModal';
import ReportarFallaModal from './components/ReportarFallaModal';
import PendientesPedidoPanel from './components/PendientesPedidoPanel';
import { logisticsService } from '../../services/modules/logisticsService';

// Mismos 3 colores que usa el semáforo de PlanificacionPage.jsx (duplicado acá a propósito:
// son 2 líneas, no vale la pena acoplar este archivo a otro solo para reusarlas).
const SEMAFORO_DOT = { rojo: 'bg-red-500', amarillo: 'bg-amber-400', verde: 'bg-emerald-500' };
const SEMAFORO_TEXTO = { rojo: 'text-red-600', amarillo: 'text-amber-600', verde: 'text-emerald-600' };

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
    // Spec 39 (validación cruzada): Control de ESTA tizada no puede superar lo que Trabajo
    // marcó hecho en la misma tizada. Clampeado en el contador, no rechazo en silencio.
    // Trabajo NULL (nunca se usó) no es 0: sin dato no hay tope, se deja el de `total`.
    const trabajadasTz = tizada.PiezasTrabajadas != null ? parseInt(tizada.PiezasTrabajadas) : null;
    const tope = esControl && trabajadasTz != null ? Math.min(total || trabajadasTz, trabajadasTz) : total;

    const commit = async (nextVal) => {
        const val = Math.max(0, Math.min(tope || nextVal, nextVal));
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
        if (tope > 0 && val > tope) val = tope;
        else if (total > 0 && val > total) val = total;
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
    // Spec 39 (validación cruzada): no se puede controlar más de lo que Trabajo marcó hecho.
    const trabajado = order.CantidadTerminada != null ? (parseFloat(order.CantidadTerminada) || 0) : null;
    const tope = trabajado != null ? Math.min(total > 0 ? total : trabajado, trabajado) : total;
    const count = parseFloat(order.CantidadControlada) || 0;
    // Patrón de 3 campos (pedido del usuario, 10-sep): "controlás ahora" / "llevás" / "total".
    // El campo SIEMPRE arranca en blanco (es un incremento, no el acumulado); un negativo corrige
    // de más sin tener que deshacer de a una.
    const [incInput, setIncInput] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => { setIncInput(''); }, [order.OrdenID]);

    const isCompleted = total > 0 && count >= total;

    const guardar = async () => {
        const inc = parseFloat(incInput);
        if (isNaN(inc) || inc === 0) return toast.error('Ingresá cuánto controlás ahora (podés poner un negativo para corregir de más).');
        const nuevo = count + inc;
        if (nuevo < 0) return toast.error(`Eso dejaría el total en negativo (llevás ${count}).`);
        const topeReal = tope > 0 ? tope : total;
        if (topeReal > 0 && nuevo > topeReal) {
            return toast.error(tope < total
                ? `No podés controlar más de lo trabajado (${tope}). Como mucho podés sumar ${tope - count}.`
                : `Llevás ${count} de ${total}: como mucho podés sumar ${total - count}.`);
        }
        setLoading(true);
        try {
            await service.setProgresoControl(order.OrdenID, nuevo);
            onChanged?.(nuevo);
            setIncInput('');
            toast.success(`${inc > 0 ? 'Sumaste' : 'Restaste'} ${Math.abs(inc)}. Llevás ${nuevo} de ${total}.`);
        } catch (e) {
            toast.error(e?.response?.data?.error || 'Error al guardar el conteo');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`rounded-xl border transition-all ${isCompleted ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-zinc-200'}`}>
        <div className="relative flex items-center gap-3 p-3">
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

            {/* Con total >= 1 se cuenta. Antes era "> 1": una orden de UNA sola prenda mostraba
                "0/1" sin casillero ni botón y no había forma de controlarla (BOR-20947 2/2). */}
            {total >= 1 ? (
                <div className="flex items-end gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <div>
                        <label className="block text-[8px] font-black text-emerald-500 uppercase tracking-wide mb-0.5">Controlás</label>
                        <input
                            type="number"
                            value={incInput}
                            disabled={loading}
                            onChange={(e) => setIncInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } }}
                            placeholder="0"
                            title="Cuánto controlaste desde la última vez que guardaste (negativo para corregir de más)"
                            className="w-14 text-center text-sm font-black border border-emerald-400/50 bg-emerald-50 rounded-md px-1 py-1 outline-none focus:border-emerald-500 disabled:bg-zinc-100 disabled:text-zinc-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                    </div>
                    <div>
                        <label className="block text-[8px] font-black text-zinc-400 uppercase tracking-wide mb-0.5">Llevás</label>
                        <div className="w-12 text-center text-sm font-bold text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-1 py-1">{count}</div>
                    </div>
                    <span className="text-zinc-300 text-xs pb-1.5">/</span>
                    <div className="w-12 text-center text-sm font-bold text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-1 py-1 mb-0">{total}</div>
                    <button
                        onClick={guardar}
                        disabled={loading}
                        title="Guardar"
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-95 ${loading ? 'bg-zinc-100 text-zinc-400' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}`}
                    >
                        {loading ? <RefreshCw size={14} className="animate-spin" /> : <Check size={16} />}
                    </button>
                </div>
            ) : (
                <div className="text-right shrink-0">
                    <span className="text-[9px] font-black text-zinc-300 uppercase leading-none mb-0.5 tracking-wider block">Prendas</span>
                    <div className={`text-xl font-black leading-none ${isCompleted ? 'text-emerald-600' : 'text-zinc-700'}`}>
                        {count}<span className="text-sm text-zinc-300 font-bold">/{total || '?'}</span>
                    </div>
                </div>
            )}
            </div>
        {tope < total && (
            <div className="text-[10px] font-bold text-amber-600 bg-amber-50 border-t border-amber-200 rounded-b-xl px-3 py-1.5">
                Tope: no podés controlar más de lo trabajado ({trabajado ?? tope})
            </div>
        )}
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
// [DISEÑO] Etapa de diseño de una orden de BORDADO, con los MISMOS rótulos que usa TPU en su planilla
// (Falta diseño → Esperando aprobación del cliente → Diseñado). Es SOLO visual: Bordado sigue
// funcionando con sus requisitos (Matriz / Aprobación del Cliente / Prendas); acá se leen de
// FaltantePendiente para mostrar en qué etapa está. No cambia ninguna regla ni ningún dato.
const etapaDisenoBordado = (o, bloqueada) => {
    const falta = String(o?.FaltantePendiente || '');
    if (bloqueada && /^Esperando/i.test(falta)) return null;   // bloqueo de otro tipo (retiro, reposición…): no es de diseño
    if (bloqueada && /matriz/i.test(falta)) return { txt: 'Falta diseño (matriz)', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    if (bloqueada && /aprobaci/i.test(falta)) return { txt: 'Esperando aprobación del cliente', cls: 'bg-sky-50 text-sky-700 border-sky-200' };
    return { txt: 'Diseñado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
};

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
    // Spec 39: modal de falla/faltante y refresco del panel "lo que falta de este pedido"
    const [fallaOpen, setFallaOpen] = useState(false);
    const [pendRefresh, setPendRefresh] = useState(0);
    // Spec 39: "aprobar por tandas" en Control solo está disponible en áreas con envío
    // parcial habilitado (mismo interruptor que el despacho — AREAS_DESPACHO_PARCIAL).
    const [permiteParcial, setPermiteParcial] = useState(false);
    useEffect(() => {
        logisticsService.getLibroConfig()
            .then(cfg => setPermiteParcial((cfg?.areasParcial || []).includes(String(area).toUpperCase())))
            .catch(() => setPermiteParcial(false));
    }, [area]);

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
    // Patrón de 3 campos (pedido del usuario, 10-sep): "sumás ahora" / "llevás" / "total" —
    // ej. tipeás 5, ves 20 y 30, guardás y queda 0, 25, 30. El campo SIEMPRE arranca en blanco
    // (es un incremento, no el acumulado) — para corregir un error de más, sumá un negativo.
    const [progresoInput, setProgresoInput] = useState('');
    useEffect(() => { setProgresoInput(''); }, [selectedId]);
    const handleGuardarProgreso = async (o) => {
        const inc = parseFloat(progresoInput);
        const actual = parseFloat(o.CantidadTerminada) || 0;
        const total = parseFloat(o.MagnitudEfectiva || o.Magnitud) || 0;
        if (isNaN(inc) || inc === 0) return toast.error('Ingresá cuánto sumás ahora (podés poner un negativo para corregir de más).');
        const nuevo = actual + inc;
        if (nuevo < 0) return toast.error(`Eso dejaría el total en negativo (llevás ${actual}).`);
        if (total > 0 && nuevo > total) return toast.error(`Llevás ${actual} de ${total}: como mucho podés sumar ${total - actual}.`);
        updateLocal(o.OrdenID, { CantidadTerminada: nuevo });
        setProgresoInput('');
        try { await service.setProgreso(o.OrdenID, nuevo); toast.success(`${inc > 0 ? 'Sumaste' : 'Restaste'} ${Math.abs(inc)}. Llevás ${nuevo} de ${total}.`); }
        catch (e) { toast.error(e?.response?.data?.error || 'Error al guardar el progreso'); setProgresoInput(String(inc)); load(); }
    };

    // Aprobar Control: pide la cantidad de bultos con un prompt explícito (no un campo que
    // se puede pasar por alto) y, al aprobar, abre la impresión de etiquetas — igual patrón
    // que Terminaciones ECOUV (EcoUvFinishing.handleFinishOrder + printLabelsHelper).
    const [aprobando, setAprobando] = useState(null);
    // Spec 39: `parcial=true` aprueba solo lo YA controlado (ej. 10 de 30) y genera bultos
    // para esa tanda; la orden sigue en producción para el resto, no pasa a Pronto.
    const handleAprobarControl = async (o, parcial = false) => {
        if (aprobando) return;
        const total = parseFloat(o.MagnitudEfectiva || o.Magnitud) || 0;
        const controlado = parseFloat(o.CantidadControlada) || 0;
        if (!parcial && total > 0 && controlado < total) {
            return toast.error(`Controlaste ${controlado} de ${total} prenda(s): completá el conteo antes de aprobar.`);
        }
        if (parcial) {
            if (!(controlado > 0)) return toast.error('Contá al menos una prenda antes de aprobar una tanda.');
            // Nuevo en ESTA tanda = lo controlado ahora menos lo que ya se había aprobado en
            // tandas anteriores (no confundir con el total controlado acumulado).
            const aprobadoPrevio = parseFloat(o.CantidadAprobadaBultos) || 0;
            // [CONTROL] Con prendas en reposición solo se aprueban las sanas (total − en reposición).
            const cantRepos = Number(o.ReposicionesAbiertas) > 0 ? (Number(o.CantidadEnReposicion) || 0) : 0;
            const aprobable = cantRepos > 0 && total > 0 ? Math.max(0, Math.min(controlado, total - cantRepos)) : controlado;
            const nuevo = aprobable - aprobadoPrevio;
            const previoTxt = aprobadoPrevio > 0 ? ` (ya habías aprobado ${aprobadoPrevio} en tanda(s) anterior(es))` : '';
            const ok = window.confirm(cantRepos > 0
                ? `Vas a aprobar ${nuevo} prenda(s) sanas de ${o.CodigoOrden}${previoTxt}: se generan sus bultos. Las ${cantRepos} en reposición se aprueban cuando lleguen; la orden sigue en Control. ¿Confirmás?`
                : `Vas a aprobar ${nuevo} prenda(s) NUEVAS de ${o.CodigoOrden}${previoTxt}: se generan sus bultos. Llevás ${controlado} de ${total} controladas en total; quedan ${total - controlado} por controlar. ¿Confirmás?`);
            if (!ok) return;
        }
        const respuesta = window.prompt(`¿Cuántos bultos salen de ${parcial ? 'esta tanda de' : ''} la orden ${o.CodigoOrden}? Se genera una etiqueta por cada uno.`, '1');
        if (respuesta === null) return; // canceló
        const bultos = Math.max(1, parseInt(respuesta, 10) || 1);
        setAprobando(o.OrdenID);
        try {
            const res = await service.aprobarControl(o.OrdenID, bultos, parcial);
            if (res.parcial) {
                // Tanda parcial: la orden sigue viva (no pasa a Pronto). No se saca de la
                // lista; se recarga para que refleje el nuevo estado y el resto por controlar.
                toast.success(res.message || `Tanda aprobada: ${bultos} bulto(s).`, { duration: 6000 });
                load();
                return;
            }
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
                        {area === 'EMB' && fase === 'trabajo' && (() => {
                            const et = etapaDisenoBordado(o, bloqueada);
                            return et ? <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${et.cls}`}>{et.txt}</span> : null;
                        })()}

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
                            {/* Spec 39: de un vistazo en la lista — ya salió una tanda, sin
                                tener que abrir la orden para enterarse. */}
                            {parseFloat(o.CantidadAprobadaBultos) > 0 && (
                                <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold border border-amber-200" title="Ya se aprobaron y enviaron tandas de esta orden">
                                    {o.CantidadAprobadaBultos} enviadas
                                </span>
                            )}
                            {/* Señalética minimalista: punto + fecha proyectada, contra la fecha
                                comprometida (o la fija si esta orden todavía no tiene una real
                                calculada) — mismo motor que la pantalla de Planificación. Sin
                                capacidad cargada para el área, o.semaforo no viene y no se muestra
                                nada acá (no-op). */}
                            {o.semaforo && (
                                <span
                                    className="flex items-center gap-1 ml-auto"
                                    title={`Se proyecta terminar: ${fmtFechaCorta(o.diaProyectado)} · Comprometido: ${fmtFechaCorta(o.FechaPrometidaEfectiva)}`}
                                >
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEMAFORO_DOT[o.semaforo]}`} />
                                    <span className={`text-[10px] font-bold ${SEMAFORO_TEXTO[o.semaforo]}`}>
                                        {fmtFechaCorta(o.diaProyectado)}
                                    </span>
                                </span>
                            )}
                            <span className={`text-[10px] text-zinc-400 ${o.semaforo ? '' : 'ml-auto'}`}>
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
                            <div className="shrink-0 flex flex-col gap-1.5 items-end">
                                <button
                                    onClick={() => onSelectOrder?.({ id: selected.OrdenID, area, codigo: selected.CodigoOrden, cliente: selected.Cliente })}
                                    className="flex items-center gap-1.5 text-xs font-bold text-brand-cyan hover:bg-brand-cyan/5 border border-brand-cyan/30 rounded-lg px-3 py-2 transition-colors"
                                >
                                    <ExternalLink size={13} /> Ficha completa
                                </button>
                                {/* Spec 39: falla propia o faltante de insumo, con el mismo botón (antes las bandejas no podían reportar) */}
                                <button
                                    onClick={() => setFallaOpen(true)}
                                    title="Reportar una falla de esta área o un faltante del insumo que vino de un área anterior"
                                    className="flex items-center gap-1.5 text-xs font-bold text-[#BD0C7E] hover:bg-pink-50 border border-pink-300 rounded-lg px-3 py-2 transition-colors"
                                >
                                    <FlagTriangleRight size={13} /> Reportar falla / faltante
                                </button>
                            </div>
                        </div>

                        {/* Spec 39: retenida por una falla o faltante reportado — sigue operable con lo que tiene */}
                        {String(selected.EstadoenArea || '').trim() === 'Retenido' && (
                            <div className="bg-pink-50 border border-pink-200 text-[#8a0a5c] text-sm rounded-xl p-3 mb-5 flex items-center gap-2">
                                <Lock size={14} /> Retenida: hay una reposición en proceso para esta orden. Podés seguir trabajando con lo que tenés; se libera sola cuando llegue.
                            </div>
                        )}

                        {/* Spec 39: lo que falta de este pedido (libro de entregas de las áreas anteriores) */}
                        <PendientesPedidoPanel ordenId={selected.OrdenID} service={service} area={area} refreshKey={pendRefresh} />

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
                                                : permiteParcial
                                                    ? 'Pasar a Control: ahí podés aprobar todo, o solo la tanda que ya llevás controlada y seguir con el resto después.'
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
                                {permiteParcial && yaIniciada && (() => {
                                    // Spec 39: mismo desglose que en Control, pero visible acá en Trabajo
                                    // — el que corta/produce también tiene que ver cuánto ya salió en
                                    // tandas anteriores, no solo el que controla calidad.
                                    const totalTr = parseFloat(selected.MagnitudEfectiva || selected.Magnitud) || 0;
                                    const aprobadoTr = parseFloat(selected.CantidadAprobadaBultos) || 0;
                                    return aprobadoTr > 0 ? (
                                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-2 font-bold">
                                            Ya salieron {aprobadoTr}{totalTr > 0 ? ` de ${totalTr}` : ''} en tanda(s) anteriores.
                                            {totalTr > 0 && ` Faltan ${Math.max(totalTr - aprobadoTr, 0)} por producir y aprobar.`}
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-2">
                                            Esta área permite mandar tandas: tocá la banderita para pasar a Control y ahí vas a poder aprobar solo lo que ya controlaste, sin terminar toda la orden.
                                        </p>
                                    );
                                })()}

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
                                            <div className="flex items-end gap-2">
                                                <div>
                                                    <label className="block text-[9px] font-black text-brand-cyan uppercase tracking-wide mb-0.5">Sumás ahora</label>
                                                    <input
                                                        type="number"
                                                        value={progresoInput}
                                                        onChange={(e) => setProgresoInput(e.target.value)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' && !sinAsignar) handleGuardarProgreso(selected); }}
                                                        placeholder="0"
                                                        disabled={sinAsignar}
                                                        title={sinAsignar ? textoFalta : 'Cuánto hiciste desde la última vez que guardaste (negativo para corregir de más)'}
                                                        className="w-20 text-sm font-black text-center border border-brand-cyan/40 bg-brand-cyan/5 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-cyan disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed disabled:border-zinc-200"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-black text-zinc-400 uppercase tracking-wide mb-0.5">Llevás</label>
                                                    <div className="w-16 text-sm font-bold text-center text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5">{parseFloat(selected.CantidadTerminada) || 0}</div>
                                                </div>
                                                <span className="text-zinc-300 text-xs pb-2">/</span>
                                                <div>
                                                    <label className="block text-[9px] font-black text-zinc-400 uppercase tracking-wide mb-0.5">Total</label>
                                                    <div className="w-16 text-sm font-bold text-center text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5">{total || '?'}</div>
                                                </div>
                                                <button
                                                    onClick={() => handleGuardarProgreso(selected)}
                                                    disabled={sinAsignar}
                                                    title={sinAsignar ? textoFalta : undefined}
                                                    className="ml-auto h-[34px] text-xs font-bold text-brand-cyan hover:bg-brand-cyan/5 border border-brand-cyan/30 rounded-lg px-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                >
                                                    Guardar
                                                </button>
                                            </div>
                                            <div className="text-[10px] text-zinc-400 mt-1">{pct}% trabajado</div>
                                        </>
                                    );
                                })()}
                            </div>
                        );
                        })()}

                        {/* CONTROL: contador de prendas controladas (3 campos: sumás ahora /
                            llevás / total — igual patrón que Trabajo), aparte del de trabajo.
                            "Aprobar Control" pregunta la cantidad de bultos con un prompt (no
                            un campo que se puede pasar por alto) y ahí genera las etiquetas +
                            abre la impresión. */}
                        {fase === 'control' && (() => {
                            const total = parseFloat(selected.MagnitudEfectiva || selected.Magnitud) || 0;
                            const controlado = parseFloat(selected.CantidadControlada) || 0;
                            // [CONTROL] Con prendas en reposición no se aprueba el total: aunque el conteo
                            // esté completo, se ofrece la tanda de las sanas (total − en reposición).
                            const enReposicion = Number(selected.ReposicionesAbiertas) > 0;
                            const cantRepos = Number(selected.CantidadEnReposicion) || 0;
                            const conteoCompleto = !enReposicion && (total === 0 || controlado >= total);
                            // Spec 39: cuánto de lo controlado todavía no se aprobó en ninguna tanda anterior.
                            const aprobadoPrevio = parseFloat(selected.CantidadAprobadaBultos) || 0;
                            const aprobable = enReposicion && total > 0 && cantRepos > 0 ? Math.max(0, Math.min(controlado, total - cantRepos)) : controlado;
                            const nuevoParaTanda = aprobable - aprobadoPrevio;
                            return (
                                <div className="bg-white border border-zinc-200 rounded-2xl p-4 mb-5">
                                    <h3 className="text-xs font-black text-emerald-600 uppercase tracking-wide mb-3">
                                        Control de Calidad
                                    </h3>

                                    {/* [CONTROL] Falla reportada desde acá y todavía sin reponer: la orden
                                        sigue en Control para aprobar lo sano por tandas; el total recién
                                        cuando llegue la reposición (el backend lo bloquea igual). */}
                                    {Number(selected.ReposicionesAbiertas) > 0 && (
                                        <div className="mb-3 text-[11px] bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-amber-800">
                                            <b>Esperando reposición{Number(selected.CantidadEnReposicion) > 0 ? ` de ${Number(selected.CantidadEnReposicion)} prenda(s)` : ''}.</b>{' '}
                                            Contá solo las prendas sanas y aprobalas como tanda (salen con su bulto).
                                            La orden completa se aprueba cuando llegue la reposición y la controles.
                                        </div>
                                    )}

                                    {/* Spec 39: desglose fijo de tandas — cuánto ya se aprobó en tandas
                                        anteriores, cuánto es nuevo para aprobar ahora, y cuánto falta
                                        contar. Visible siempre (no solo en el cartel de confirmación). */}
                                    {aprobadoPrevio > 0 && (
                                        <div className="mb-3 text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600">
                                            Ya aprobaste <span className="font-bold text-emerald-600">{aprobadoPrevio}</span> en tanda(s) anterior(es).
                                            {' '}{nuevoParaTanda > 0 ? <>Tenés <span className="font-bold text-amber-600">{nuevoParaTanda}</span> nueva(s) para aprobar ahora.</> : 'Contá más para tener una tanda nueva.'}
                                            {' '}Faltan <span className="font-bold">{Math.max(total - controlado, 0)}</span> por controlar.
                                        </div>
                                    )}

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
                                            <>
                                                {/* Un solo mensaje de estado — el panel de arriba (aprobadoPrevio > 0) ya
                                                    explica "cuánto aprobaste / cuánto falta"; acá no se repite. */}
                                                {aprobadoPrevio === 0 && !enReposicion && (
                                                    <p className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex-1">
                                                        Contá todas las prendas para aprobar ({controlado}/{total})
                                                    </p>
                                                )}
                                                {/* Spec 39: aprobar por tandas — solo en áreas con envío parcial habilitado,
                                                    y solo si hay algo nuevo controlado desde la última tanda aprobada. */}
                                                {permiteParcial && nuevoParaTanda > 0 && (
                                                    <button
                                                        onClick={() => handleAprobarControl(selected, true)}
                                                        disabled={aprobando === selected.OrdenID}
                                                        title={enReposicion
                                                            ? `Genera bultos para las ${nuevoParaTanda} prenda(s) sanas; las ${cantRepos} en reposición se aprueban cuando lleguen`
                                                            : `Genera bultos para las ${nuevoParaTanda} prenda(s) nuevas controladas y la orden sigue en producción por el resto`}
                                                        className="bg-white hover:bg-amber-50 text-amber-700 border border-amber-300 px-3 py-2 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
                                                    >
                                                        <CheckCircle2 size={13} /> Aprobar esta tanda ({nuevoParaTanda})
                                                    </button>
                                                )}
                                                {enReposicion && permiteParcial && nuevoParaTanda <= 0 && (
                                                    <p className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex-1">
                                                        {aprobadoPrevio > 0 ? 'Ya aprobaste todas las prendas sanas. El resto se aprueba cuando llegue la reposición.' : 'Contá las prendas sanas para aprobarlas como tanda.'}
                                                    </p>
                                                )}
                                                {/* Claridad máxima: si no aparece el botón de tanda, decir por qué —
                                                    no dejarlo en un silencio que parezca un error. */}
                                                {!permiteParcial && controlado > 0 && (
                                                    <p className="text-[10px] text-zinc-400 w-full">
                                                        Esta área no tiene habilitado el envío por tandas: hay que controlar y aprobar las {total} de una vez.
                                                    </p>
                                                )}
                                            </>
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
        <ReportarFallaModal
            open={fallaOpen}
            onClose={() => setFallaOpen(false)}
            orden={selected}
            area={area}
            service={service}
            onDone={() => { setPendRefresh(k => k + 1); load(); }}
        />
        </>
    );
}
