import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Selector from '../../ui/Selector';
import { inventoryService } from '../../../services/modules/inventoryService';
import { toast } from 'sonner';
import { X, History, AlertTriangle, Settings2, SlidersHorizontal, PackageX, Undo2, Check, Loader2, RefreshCw } from 'lucide-react';

// Estética nueva (22/10/2026, como el Inventario de tela): modal blanco redondeado, encima de la barra de arriba
// (z-[6000]; antes z-50 y quedaba por debajo), pestañas con la elegida en negro, campos con foco brand-cyan y el
// motivo del cierre con el Selector propio. «Aplicar ajuste» en brand-cyan; «Confirmar cierre» en rojo (borra stock).
const ROTULO = 'block text-[11px] font-black text-zinc-400 uppercase tracking-wide mb-1';
const CAMPO = 'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none transition-colors focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_PELIGRO = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors';
const segmento = (activo) => `flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
    activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`;

const fechaCorta = (f) => (f ? new Date(f).toLocaleDateString('es-UY', { timeZone: 'America/Montevideo', day: '2-digit', month: '2-digit' }) : '');

const ManageBobinaModal = ({ bobina, insumoName, onClose, onSuccess, onVerBandeja }) => {
    const [activeTab, setActiveTab] = useState('adjust'); // 'adjust' | 'close' | 'history'
    const [loading, setLoading] = useState(false);

    // HISTORY STATE
    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // SALDO ACTUAL: el de la lista puede ser viejo (las órdenes descuentan tela solas y una cancelación
    // la devuelve). Se relee al abrir y con «Actualizar»; si el servidor rechaza una rebaja, trae el real.
    const [restante, setRestante] = useState(() => Number(bobina?.MetrosRestantes) || 0);
    const [leyendoSaldo, setLeyendoSaldo] = useState(false);
    // Devolución/descarte pedido por el cliente y todavía abierto: con eso no se cierra ni se deja en cero
    // desde acá, se resuelve en la bandeja (INF-SIS-2026-11: así se perdieron 6 pedidos del portal).
    const [solicitud, setSolicitud] = useState(() => (bobina?.SolicitudTevID
        ? { TevID: bobina.SolicitudTevID, Accion: bobina.SolicitudAccion, Fecha: null } : null));

    // ADJUST STATE
    const [adjustType, setAdjustType] = useState('subtract');
    const [amount, setAmount] = useState('');
    const [orden, setOrden] = useState('');
    // Sin motivo por defecto (antes venía «Producción», que no estaba entre los botones, y todos los
    // ajustes quedaban con ese motivo): hay que elegirlo, para que el historial diga qué fue cada ajuste.
    const [concept, setConcept] = useState('');
    const [customConcept, setCustomConcept] = useState('');
    const [anchoReal, setAnchoReal] = useState(''); // Corrección de ancho real (opcional)

    // CLOSE STATE
    const [metrosFinales, setMetrosFinales] = useState(0);
    const [closeMotivo, setCloseMotivo] = useState('Fin de Bobina');
    const [calculatedWaste, setCalculatedWaste] = useState(null);
    // Desmarcado por defecto: con metros útiles sobrantes la bobina debe quedar
    // Disponible salvo decisión explícita del operario (caso BOB-97: quedó
    // Agotada con 30.50m porque este check venía marcado). El backend igual
    // marca Agotado automáticamente si los metros finales son < 0.5.
    const [finish, setFinish] = useState(false);

    // Ancho actual de la bobina (real confirmado, o declarado como fallback)
    const anchoActual = bobina?.AnchoReal != null && bobina.AnchoReal !== ''
        ? parseFloat(bobina.AnchoReal)
        : (bobina?.Ancho != null && bobina.Ancho !== '' ? parseFloat(bobina.Ancho) : null);
    // Solo mostramos el campo de ancho cuando la bobina maneja ancho (tela)
    const anchoRelevante = (bobina?.Ancho != null && bobina.Ancho !== '')
        || (bobina?.AnchoReal != null && bobina.AnchoReal !== '');

    const releerSaldo = async () => {
        setLeyendoSaldo(true);
        try {
            const actual = await inventoryService.getBobina(bobina.BobinaID);
            setRestante(Number(actual.MetrosRestantes) || 0);
            setSolicitud(actual.SolicitudTevID
                ? { TevID: actual.SolicitudTevID, Accion: actual.SolicitudAccion, Fecha: actual.SolicitudFecha } : null);
        } catch (e) {
            toast.error('No se pudo leer el saldo actual de la bobina: ' + (e?.response?.data?.error || e.message) + '. Se muestra el de la lista.');
        } finally {
            setLeyendoSaldo(false);
        }
    };

    useEffect(() => {
        releerSaldo();
    }, [bobina.BobinaID]);

    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory();
        }
    }, [activeTab]);

    const loadHistory = async () => {
        setLoadingHistory(true);
        try {
            const data = await inventoryService.getBobinaHistory(bobina.CodigoEtiqueta);
            setHistory(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingHistory(false);
        }
    };

    // --- LOGIC: ADJUST ---
    const cantIngresada = parseFloat(amount);
    const hayCantidad = amount !== '' && !isNaN(cantIngresada) && cantIngresada > 0;
    // Una rebaja que deja la bobina en negativo: el servidor la rechaza igual, acá se frena antes.
    const noAlcanza = adjustType === 'subtract' && hayCantidad && restante - cantIngresada < -0.005;
    const finalConcept = (customConcept.trim() || (concept !== 'Otro' ? concept : '')).trim();
    // El motivo es obligatorio cuando cambian los metros (un ajuste solo de ancho no lo necesita).
    const faltaMotivo = hayCantidad && !finalConcept;
    // Un ajuste que deja la bobina en ≤ 0,5 m la agota (el servidor la pasa a Agotado): es un cierre.
    const agotaAjuste = hayCantidad && !noAlcanza
        && (adjustType === 'subtract' ? restante - cantIngresada : cantIngresada) <= 0.5;
    const ajusteBloqueado = !!solicitud && agotaAjuste;

    const handleAdjustSubmit = async (e) => {
        e.preventDefault();
        if (noAlcanza || faltaMotivo || ajusteBloqueado) return;

        // --- Metros ---
        const cant = cantIngresada;
        let delta = 0;
        if (hayCantidad) {
            delta = adjustType === 'subtract' ? -Math.abs(cant) : (cant - restante);
        }
        const metrosCambio = Math.abs(delta) >= 0.01;

        // --- Ancho ---
        const anchoNuevo = anchoReal !== '' ? parseFloat(anchoReal) : null;
        const anchoValido = anchoNuevo !== null && !isNaN(anchoNuevo) && anchoNuevo > 0;
        const anchoCambio = anchoValido && (anchoActual === null || Math.abs(anchoNuevo - anchoActual) > 0.001);

        if (!metrosCambio && !anchoCambio) {
            return toast.info("No hay cambios para aplicar");
        }

        setLoading(true);
        try {
            await inventoryService.adjustBobina({
                bobinaId: bobina.BobinaID,
                cantidad: metrosCambio ? delta : 0,
                motivo: finalConcept,
                orden: orden.trim() || undefined,
                anchoReal: anchoCambio ? anchoNuevo : undefined,
            });

            toast.success(anchoCambio && !metrosCambio ? 'Ancho actualizado correctamente' : 'Stock ajustado correctamente');
            onSuccess?.();
            onClose();
        } catch (error) {
            console.error(error);
            toast.error(error?.response?.data?.error || 'Error al ajustar');
            // El servidor rechazó la rebaja con el saldo real: se muestra ese y se recarga la lista.
            const real = error?.response?.data?.metrosRestantes;
            if (real != null) {
                setRestante(Number(real) || 0);
                onSuccess?.();
            }
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIC: CLOSE ---
    // Cerrar con «Sacar de inventario» o con menos de 0,5 m deja la bobina Agotada (ver closeBobina).
    const cierreAgota = finish || parseFloat(metrosFinales || 0) < 0.5;
    const cierreBloqueado = !!solicitud && cierreAgota;

    const avisoSolicitud = solicitud && (
        <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
            <Undo2 className="w-4 h-4 shrink-0 text-rose-600 mt-px" />
            <div>
                <p>
                    El cliente pidió {solicitud.Accion === 'DESCARTAR' ? 'el descarte' : 'la devolución'} de esta tela
                    {solicitud.Fecha ? ` el ${fechaCorta(solicitud.Fecha)}` : ''} (solicitud #{solicitud.TevID}). No se puede cerrar
                    ni dejar en cero desde acá: resolvela en la <strong>Bandeja de devoluciones</strong>
                    {solicitud.Accion === 'DESCARTAR'
                        ? ' (aprobala y la bobina se cierra sola, o rechazala).'
                        : ': aprobala y empaquetala, marcala «Ya se entregó» si se la diste en mano, o rechazala si no queda tela.'}
                </p>
                {onVerBandeja && (
                    <button type="button" onClick={onVerBandeja} className="mt-1 inline-flex items-center gap-1 font-bold text-rose-700 hover:text-rose-900">
                        Ir a la bandeja
                    </button>
                )}
            </div>
        </div>
    );

    const handleCalculateWaste = () => {
        const waste = restante - metrosFinales;
        setCalculatedWaste(waste >= 0 ? waste : 0);
    };

    const handleCloseSubmit = async (e) => {
        e.preventDefault();
        if (cierreBloqueado) return;
        setLoading(true);
        try {
            const res = await inventoryService.closeBobina({
                bobinaId: bobina.BobinaID,
                metrosFinales: parseFloat(metrosFinales || 0),
                motivo: closeMotivo,
                finish
            });

            if (res.success) {
                toast.success(`Bobina cerrada. Desecho ajustado.`);
                onSuccess?.();
                onClose();
            } else {
                toast.error(res.message || "Error al cerrar bobina");
            }
        } catch (error) {
            console.error(error);
            toast.error(error?.response?.data?.error || "Error al cerrar la bobina");
        } finally {
            setLoading(false);
        }
    };

    // CONCEPTS PRESETS
    // «Corrección de medida» primero: es el ajuste más común en tela de cliente (corregir lo medido
    // justo antes de confirmar la medida; 54 de 62 ajustes en 60 días, copia del 27/10).
    const concepts = [
        "Corrección de medida",
        "Muestra / Prueba",
        "Mermas Operativas",
        "Ajuste de Inventario",
        "Venta / Salida Externa",
        "Otro"
    ];

    // En portal: si no, queda dentro de la capa de la página y no tapa la barra de arriba ni la lateral
    return createPortal(
        <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">

                {/* HEADER */}
                <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-start gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <Settings2 className="w-6 h-6 shrink-0 text-brand-cyan mt-0.5" aria-hidden="true" />
                        <div className="min-w-0">
                            <h2 className="text-lg font-black text-zinc-800 leading-tight truncate">{insumoName || 'Administrar bobina'}</h2>
                            <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1 flex-wrap">
                                <span className="font-mono font-bold bg-zinc-100 text-zinc-700 px-1.5 py-0.5 border border-zinc-200 rounded">{bobina.CodigoEtiqueta}</span>
                                <span>Restante actual: <strong className="text-zinc-800 tabular-nums">{leyendoSaldo ? '…' : `${restante} m`}</strong></span>
                            </div>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors" aria-label="Cerrar">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* TABS */}
                <div className="px-5 pt-3">
                    <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white">
                        <button type="button" onClick={() => setActiveTab('adjust')} className={segmento(activeTab === 'adjust')}>
                            <SlidersHorizontal className="w-3.5 h-3.5" /> Ajustar / Rebajar
                        </button>
                        <button type="button" onClick={() => setActiveTab('close')} className={segmento(activeTab === 'close')}>
                            <PackageX className="w-3.5 h-3.5" /> Cerrar / Terminar
                        </button>
                    </div>
                </div>

                {/* BODY */}
                <div className="p-5 overflow-y-auto custom-scrollbar flex-1 relative">

                    {/* --- TAB: ADJUST --- */}
                    {activeTab === 'adjust' && (
                        <form onSubmit={handleAdjustSubmit} className="space-y-4">
                            <div className="flex gap-1 p-0.5 rounded-xl bg-zinc-100">
                                <button
                                    type="button"
                                    onClick={() => setAdjustType('subtract')}
                                    className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition-colors ${adjustType === 'subtract' ? 'bg-white text-zinc-800 border border-zinc-200' : 'text-zinc-500 hover:text-zinc-800'}`}
                                >
                                    Rebajar (consumo)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAdjustType('correction')}
                                    className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition-colors ${adjustType === 'correction' ? 'bg-white text-zinc-800 border border-zinc-200' : 'text-zinc-500 hover:text-zinc-800'}`}
                                >
                                    Corrección (fijar)
                                </button>
                            </div>

                            {/* ORDEN — siempre visible */}
                            <div>
                                <label className={ROTULO}>
                                    Orden <span className="normal-case font-semibold text-zinc-300">(opcional)</span>
                                </label>
                                <input
                                    type="text"
                                    className={`${CAMPO} font-mono`}
                                    value={orden}
                                    onChange={e => setOrden(e.target.value)}
                                    placeholder="Ej: ORD-1234 / OC-556 / Pedido..."
                                />
                                {orden.trim() && (
                                    <p className="text-[10px] text-brand-cyan font-mono mt-1">Se guardará como: {orden.trim()} | ...</p>
                                )}
                            </div>

                            <div>
                                <label className={ROTULO}>
                                    {adjustType === 'subtract' ? 'Cantidad a rebajar (metros)' : 'Nuevo valor real (metros)'}
                                </label>
                                <input
                                    type="number" step="0.01" min="0"
                                    className={`${CAMPO} text-lg font-bold tabular-nums`}
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    autoFocus
                                />
                                {adjustType === 'subtract' && amount && !noAlcanza && (
                                    <p className="text-xs text-zinc-400 mt-1">
                                        Quedarán: <strong className="text-zinc-700 tabular-nums">{(restante - parseFloat(amount || 0)).toFixed(2)} m</strong>
                                    </p>
                                )}
                                {noAlcanza && (
                                    <div className="mt-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                                        <p>
                                            Quedarán: <strong className="tabular-nums">{(restante - cantIngresada).toFixed(2)} m</strong>.
                                            {' '}No alcanza: la bobina tiene <strong className="tabular-nums">{restante.toFixed(2)} m</strong>.
                                            {' '}Si el rollo tiene más, usá <strong>«Corrección (fijar)»</strong> con los metros reales; si se terminó, <strong>«Cerrar / Terminar»</strong>.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={releerSaldo}
                                            disabled={leyendoSaldo}
                                            className="mt-1 inline-flex items-center gap-1 font-bold text-rose-700 hover:text-rose-900 disabled:opacity-50"
                                        >
                                            <RefreshCw className={`w-3 h-3 ${leyendoSaldo ? 'animate-spin' : ''}`} /> Actualizar
                                        </button>
                                    </div>
                                )}
                                {ajusteBloqueado && <div className="mt-1.5">{avisoSolicitud}</div>}
                            </div>

                            {/* ANCHO REAL — opcional, solo para bobinas con ancho (tela) */}
                            {anchoRelevante && (
                                <div>
                                    <label className={ROTULO}>
                                        Ancho real (m) <span className="normal-case font-semibold text-zinc-300">(opcional)</span>
                                    </label>
                                    <input
                                        type="number" step="0.01" min="0"
                                        className={`${CAMPO} text-lg font-bold tabular-nums`}
                                        value={anchoReal}
                                        onChange={e => setAnchoReal(e.target.value)}
                                        placeholder={anchoActual != null ? anchoActual.toFixed(2) : '0.00'}
                                    />
                                    <p className="text-xs text-zinc-400 mt-1">
                                        Ancho confirmado actual: <strong className="text-zinc-700">{anchoActual != null ? `${anchoActual.toFixed(2)} m` : '—'}</strong>
                                        {bobina?.Ancho != null && bobina.Ancho !== '' && (
                                            <span className="text-zinc-300"> · Declarado: {parseFloat(bobina.Ancho).toFixed(2)} m</span>
                                        )}
                                    </p>
                                </div>
                            )}

                            {bobina.ClienteID && (
                                <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                                    <Undo2 className="w-4 h-4 shrink-0 text-amber-600 mt-px" />
                                    <span>¿Es tela de este cliente y hay que devolvérsela o descartarla? Usá el botón <strong>"Solicitar devolución"</strong> de la tarjeta, no un ajuste manual acá — ese sí genera el bulto, avisa al cliente y deja todo prolijo en la bandeja.</span>
                                </div>
                            )}

                            <div>
                                <label className={ROTULO}>Concepto / motivo</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {concepts.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => { setConcept(c); setCustomConcept(''); }}
                                            className={`text-xs font-semibold px-3 py-2 rounded-xl border text-left transition-colors ${concept === c && !customConcept ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400'}`}
                                        >
                                            {c}
                                        </button>
                                    ))}
                                </div>
                                {(concept === 'Otro' || customConcept) && (
                                    <input
                                        type="text"
                                        className={`${CAMPO} mt-2`}
                                        placeholder="Especifique motivo..."
                                        value={customConcept}
                                        onChange={e => { setCustomConcept(e.target.value); setConcept('Otro'); }}
                                    />
                                )}
                                {faltaMotivo && (
                                    <p className="text-xs text-amber-700 mt-1.5">Elegí el motivo del ajuste.</p>
                                )}
                            </div>

                            <div className="pt-2 flex justify-end gap-2">
                                <button type="button" onClick={onClose} className={BTN_SECUNDARIO}>Cancelar</button>
                                <button type="submit" disabled={loading || noAlcanza || faltaMotivo || ajusteBloqueado} className={BTN_PRINCIPAL}>
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Aplicar ajuste
                                </button>
                            </div>
                        </form>
                    )}

                    {/* --- TAB: CLOSE --- */}
                    {activeTab === 'close' && (
                        <form onSubmit={handleCloseSubmit} className="space-y-4">
                            {avisoSolicitud}
                            <div className="flex gap-2 items-start text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                                <p>Esta acción marcará la bobina como <strong>Agotada</strong> o finalizada. Use esta opción si el rollo ya no se utilizará.</p>
                            </div>

                            <div>
                                <label className={ROTULO}>Metros reales sobrantes (cartón)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className={`${CAMPO} text-lg font-bold tabular-nums`}
                                    value={metrosFinales}
                                    onChange={(e) => {
                                        setMetrosFinales(e.target.value);
                                        setCalculatedWaste(null);
                                    }}
                                    onBlur={handleCalculateWaste}
                                    required
                                />
                                <p className="text-xs text-zinc-400 mt-1">Lo que queda físicamente (generalmente 0 o pocos metros de merma).</p>
                            </div>

                            {calculatedWaste !== null && (
                                <div className={`text-sm px-3 py-2 rounded-xl border flex justify-between gap-2 ${calculatedWaste > 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                    <span>Sistema esperada: {restante}m</span>
                                    <strong className="tabular-nums">Desecho: {calculatedWaste.toFixed(2)} m</strong>
                                </div>
                            )}

                            <div>
                                <label className={ROTULO}>Motivo</label>
                                <Selector value={closeMotivo} onChange={e => setCloseMotivo(e.target.value)} aria-label="Motivo del cierre">
                                    <option value="Fin de Bobina">Fin de Bobina (Ideal)</option>
                                    <option value="Desecho">Desecho / Merma Final</option>
                                    <option value="Vencimiento">Vencimiento / Deterioro</option>
                                </Selector>
                            </div>

                            <label htmlFor="finishCheck" className="flex items-center gap-2 pt-1 cursor-pointer">
                                <input
                                    type="checkbox"
                                    id="finishCheck"
                                    checked={finish}
                                    onChange={(e) => setFinish(e.target.checked)}
                                    className="w-4 h-4 rounded cursor-pointer accent-rose-600"
                                />
                                <span className="text-sm text-zinc-700 font-semibold">Sacar de inventario (Agotado)</span>
                            </label>

                            {finish && parseFloat(metrosFinales || 0) >= 0.5 && (
                                <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-xs text-rose-700">
                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                                    <span>Quedan <strong>{parseFloat(metrosFinales || 0).toFixed(2)} m</strong> útiles: al sacar la bobina del
                                    inventario esos metros dejarán de estar disponibles para el cliente. Desmarque la casilla si la tela sigue utilizable.</span>
                                </div>
                            )}

                            <div className="pt-2 flex justify-end gap-2">
                                <button type="button" onClick={onClose} className={BTN_SECUNDARIO}>Cancelar</button>
                                <button type="submit" disabled={loading || cierreBloqueado} className={BTN_PELIGRO}>
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageX className="w-4 h-4" />} Confirmar cierre
                                </button>
                            </div>
                        </form>
                    )}

                    {/* --- TAB: HISTORY --- */}
                    {activeTab === 'history' && (
                        <div className="space-y-4">
                            {loadingHistory ? (
                                <div className="flex flex-col items-center gap-3 py-10 text-zinc-400 text-sm">
                                    <Loader2 size={26} className="animate-spin text-brand-cyan" /> Cargando movimientos...
                                </div>
                            ) : history.length === 0 ? (
                                <div className="flex flex-col items-center gap-2 py-10 text-zinc-400 text-sm">
                                    <History size={36} className="text-zinc-200" /> No hay historial registrado.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {history.map((mov, idx) => (
                                        <div key={idx} className="flex gap-3 items-start border-b border-zinc-100 pb-3 last:border-0">
                                            <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${mov.Cantidad > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                                            <div className="flex-1">
                                                {/* Parsear Referencia: puede ser "ORD-xx | Ajuste BOB: Motivo" o solo "Ajuste BOB: Motivo" */}
                                                {(() => {
                                                    const ref = mov.Referencia || '';
                                                    const hasPipe = ref.includes(' | ');
                                                    const ordenPart  = hasPipe ? ref.split(' | ')[0].trim() : '';
                                                    const motivoPart = hasPipe ? ref.split(' | ').slice(1).join(' | ').trim() : ref;
                                                    return (
                                                        <>
                                                            {/* Fila 1: Tipo + Cantidad */}
                                                            <div className="flex justify-between items-center">
                                                                <span className="font-bold text-zinc-700 text-sm">{mov.TipoMovimiento}</span>
                                                                <span className={`font-mono text-sm font-bold ${mov.Cantidad > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                    {mov.Cantidad > 0 ? '+' : ''}{mov.Cantidad}m
                                                                </span>
                                                            </div>
                                                            {/* Fila 2: Orden (si existe) */}
                                                            {ordenPart && (
                                                                <div className="mt-1 flex items-center gap-1">
                                                                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Orden</span>
                                                                    <span className="text-xs font-mono font-bold text-brand-cyan bg-brand-cyan/5 px-1.5 py-0.5 rounded">{ordenPart}</span>
                                                                </div>
                                                            )}
                                                            {/* Fila 3: Motivo */}
                                                            <p className="text-xs text-zinc-500 mt-0.5">
                                                                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mr-1">Motivo</span>
                                                                {motivoPart}
                                                            </p>
                                                            {/* Fila 4: Fecha + Usuario */}
                                                            <div className="text-[10px] text-zinc-400 mt-1 flex justify-between">
                                                                <span>{new Date(mov.Fecha).toLocaleString()}</span>
                                                                <span>{mov.Usuario || 'Sistema'}</span>
                                                            </div>
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </div>,
        document.body,
    );
};

export default ManageBobinaModal;

