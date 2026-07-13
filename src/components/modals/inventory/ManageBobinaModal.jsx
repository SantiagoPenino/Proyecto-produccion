import React, { useState, useEffect } from 'react';
import { Button } from '../../ui/Button';
import { inventoryService } from '../../../services/modules/inventoryService';
import { toast } from 'sonner';
import { X, History, AlertTriangle, CheckCircle } from 'lucide-react';

const ManageBobinaModal = ({ bobina, insumoName, onClose, onSuccess }) => {
    const [activeTab, setActiveTab] = useState('adjust'); // 'adjust' | 'close' | 'history'
    const [loading, setLoading] = useState(false);

    // HISTORY STATE
    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // ADJUST STATE
    const [adjustType, setAdjustType] = useState('subtract');
    const [amount, setAmount] = useState('');
    const [orden, setOrden] = useState('');
    const [concept, setConcept] = useState('Producción');
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
    const handleAdjustSubmit = async (e) => {
        e.preventDefault();

        const finalConcept = customConcept || concept;
        const esDevolucion = finalConcept === 'Devolución al Cliente';

        // --- Metros ---
        const cant = parseFloat(amount);
        let delta = 0;
        if (amount !== '' && !isNaN(cant) && cant > 0) {
            delta = adjustType === 'subtract' ? -Math.abs(cant) : (cant - bobina.MetrosRestantes);
        }
        const metrosCambio = Math.abs(delta) >= 0.01;

        // --- Ancho ---
        const anchoNuevo = anchoReal !== '' ? parseFloat(anchoReal) : null;
        const anchoValido = anchoNuevo !== null && !isNaN(anchoNuevo) && anchoNuevo > 0;
        const anchoCambio = anchoValido && (anchoActual === null || Math.abs(anchoNuevo - anchoActual) > 0.001);

        if (!metrosCambio && !anchoCambio && !esDevolucion) {
            return toast.info("No hay cambios para aplicar");
        }

        setLoading(true);
        try {
            // 1. Ajustar metros y/o ancho
            if (metrosCambio || anchoCambio) {
                await inventoryService.adjustBobina({
                    bobinaId: bobina.BobinaID,
                    cantidad: metrosCambio ? delta : 0,
                    motivo: finalConcept,
                    orden: orden.trim() || undefined,
                    anchoReal: anchoCambio ? anchoNuevo : undefined,
                });
            }

            // 2. Si es devolución, cerrar la bobina automáticamente
            if (esDevolucion) {
                await inventoryService.closeBobina({
                    bobinaId: bobina.BobinaID,
                    metrosFinales: 0,
                    motivo: 'Devolución al Cliente',
                    finish: true
                });
                toast.success('Devolución registrada. Bobina cerrada.');
            } else if (anchoCambio && !metrosCambio) {
                toast.success('Ancho actualizado correctamente');
            } else {
                toast.success('Stock ajustado correctamente');
            }

            onSuccess?.();
            onClose();
        } catch (error) {
            console.error(error);
            toast.error(error?.response?.data?.error || 'Error al ajustar');
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIC: CLOSE ---
    const handleCalculateWaste = () => {
        const waste = bobina.MetrosRestantes - metrosFinales;
        setCalculatedWaste(waste >= 0 ? waste : 0);
    };

    const handleCloseSubmit = async (e) => {
        e.preventDefault();
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
    const concepts = [
        "Muestra / Prueba",
        "Mermas Operativas",
        "Ajuste de Inventario",
        "Venta / Salida Externa",
        "Devolución al Cliente",
        "Otro"
    ];

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">

                {/* HEADER */}
                <div className="p-4 border-b bg-zinc-50 flex justify-between items-start">
                    <div>
                        <h2 className="text-lg font-bold text-zinc-800">{insumoName}</h2>
                        <div className="flex gap-2 text-xs text-zinc-500 mt-1">
                            <span className="font-mono bg-white px-1 border rounded">{bobina.CodigoEtiqueta}</span>
                            <span>Restante Actual: <strong>{bobina.MetrosRestantes} m</strong></span>
                        </div>
                    </div>
                    <button onClick={onClose}><X className="w-5 h-5 text-zinc-400 hover:text-red-500" /></button>
                </div>

                {/* TABS */}
                <div className="flex border-b">
                    <button
                        onClick={() => setActiveTab('adjust')}
                        className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'adjust' ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
                    >
                        Ajustar / Rebajar
                    </button>
                    <button
                        onClick={() => setActiveTab('close')}
                        className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'close' ? 'border-red-600 text-red-600 bg-red-50/50' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
                    >
                        Cerrar / Terminar
                    </button>
                </div>

                {/* BODY */}
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1 relative">

                    {/* --- TAB: ADJUST --- */}
                    {activeTab === 'adjust' && (
                        <form onSubmit={handleAdjustSubmit} className="space-y-5 animate-in fade-in slide-in-from-left-4 duration-200">
                            <div className="flex gap-4 p-1 bg-zinc-100 rounded-lg">
                                <button
                                    type="button"
                                    onClick={() => setAdjustType('subtract')}
                                    className={`flex-1 py-1.5 text-sm rounded-md transition-all ${adjustType === 'subtract' ? 'bg-white shadow text-zinc-800' : 'text-zinc-500'}`}
                                >
                                    Rebajar (Consumo)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAdjustType('correction')}
                                    className={`flex-1 py-1.5 text-sm rounded-md transition-all ${adjustType === 'correction' ? 'bg-white shadow text-zinc-800' : 'text-zinc-500'}`}
                                >
                                    Corrección (Fijar)
                                </button>
                            </div>

                            {/* ORDEN — siempre visible */}
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 mb-1">
                                    Orden <span className="text-zinc-400 font-normal text-xs">(opcional)</span>
                                </label>
                                <input
                                    type="text"
                                    className="w-full border rounded p-2 text-sm font-mono text-zinc-700 bg-zinc-50 focus:bg-white focus:ring-2 focus:ring-blue-200 outline-none transition"
                                    value={orden}
                                    onChange={e => setOrden(e.target.value)}
                                    placeholder="Ej: ORD-1234 / OC-556 / Pedido..."
                                />
                                {orden.trim() && (
                                    <p className="text-[10px] text-blue-500 font-mono mt-0.5">Se guardará como: {orden.trim()} | ...</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-zinc-700 mb-1">
                                    {adjustType === 'subtract' ? 'Cantidad a Rebajar (Metros)' : 'Nuevo Valor Real (Metros)'}
                                </label>
                                <input
                                    type="number" step="0.01" min="0"
                                    className="w-full border rounded p-2 text-lg font-semibold text-zinc-700"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    autoFocus
                                />
                                {adjustType === 'subtract' && amount && (
                                    <p className="text-xs text-zinc-400 mt-1">
                                        Quedarán: {(bobina.MetrosRestantes - parseFloat(amount || 0)).toFixed(2)} m
                                    </p>
                                )}
                            </div>

                            {/* ANCHO REAL — opcional, solo para bobinas con ancho (tela) */}
                            {anchoRelevante && (
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                                        Ancho Real (m) <span className="text-zinc-400 font-normal text-xs">(opcional)</span>
                                    </label>
                                    <input
                                        type="number" step="0.01" min="0"
                                        className="w-full border rounded p-2 text-lg font-semibold text-zinc-700"
                                        value={anchoReal}
                                        onChange={e => setAnchoReal(e.target.value)}
                                        placeholder={anchoActual != null ? anchoActual.toFixed(2) : '0.00'}
                                    />
                                    <p className="text-xs text-zinc-400 mt-1">
                                        Ancho confirmado actual: <strong>{anchoActual != null ? `${anchoActual.toFixed(2)} m` : '—'}</strong>
                                        {bobina?.Ancho != null && bobina.Ancho !== '' && (
                                            <span className="text-zinc-300"> · Declarado: {parseFloat(bobina.Ancho).toFixed(2)} m</span>
                                        )}
                                    </p>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-zinc-700 mb-1">Concepto / Motivo</label>
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    {concepts.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => { setConcept(c); setCustomConcept(''); }}
                                            className={`text-xs p-2 rounded border text-left transition-colors ${concept === c && !customConcept ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-zinc-200 hover:bg-zinc-50'}`}
                                        >
                                            {c}
                                        </button>
                                    ))}
                                </div>
                                {(concept === 'Otro' || customConcept) && (
                                    <input
                                        type="text"
                                        className="w-full border rounded p-2 text-sm mt-2"
                                        placeholder="Especifique motivo..."
                                        value={customConcept}
                                        onChange={e => { setCustomConcept(e.target.value); setConcept('Otro'); }}
                                    />
                                )}
                            </div>

                            <div className="pt-4 flex justify-end">
                                <Button type="submit" disabled={loading}>
                                    Aplicar Ajuste
                                </Button>
                            </div>
                        </form>
                    )}

                    {/* --- TAB: CLOSE --- */}
                    {activeTab === 'close' && (
                        <form onSubmit={handleCloseSubmit} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                            <div className="bg-orange-50 p-3 rounded border border-orange-100 flex gap-2 items-start">
                                <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0" />
                                <p className="text-sm text-orange-800">Esta acción marcará la bobina como <strong>Agotada</strong> o finalizada. Use esta opción si el rollo ya no se utilizará.</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Metros Reales Sobrantes (Cartón)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full border rounded p-2 lg:text-lg"
                                    value={metrosFinales}
                                    onChange={(e) => {
                                        setMetrosFinales(e.target.value);
                                        setCalculatedWaste(null);
                                    }}
                                    onBlur={handleCalculateWaste}
                                    required
                                />
                                <p className="text-xs text-zinc-500 mt-1">Lo que queda físicamente (generalmente 0 o pocos metros de merma).</p>
                            </div>

                            {calculatedWaste !== null && (
                                <div className={`text-sm p-2 rounded flex justify-between ${calculatedWaste > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                                    <span>Sistema esperada: {bobina.MetrosRestantes}m</span>
                                    <strong>Desecho: {calculatedWaste.toFixed(2)} m</strong>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium mb-1">Motivo</label>
                                <select
                                    className="w-full border rounded p-2"
                                    value={closeMotivo}
                                    onChange={e => setCloseMotivo(e.target.value)}
                                >
                                    <option value="Fin de Bobina">Fin de Bobina (Ideal)</option>
                                    <option value="Desecho">Desecho / Merma Final</option>
                                    <option value="Vencimiento">Vencimiento / Deterioro</option>
                                </select>
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                <input
                                    type="checkbox"
                                    id="finishCheck"
                                    checked={finish}
                                    onChange={(e) => setFinish(e.target.checked)}
                                    className="w-4 h-4 text-red-600 rounded cursor-pointer"
                                />
                                <label htmlFor="finishCheck" className="text-sm text-zinc-700 font-medium cursor-pointer">
                                    Sacar de inventario (Agotado)
                                </label>
                            </div>

                            {finish && parseFloat(metrosFinales || 0) >= 0.5 && (
                                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">
                                    ⚠ Quedan <strong>{parseFloat(metrosFinales || 0).toFixed(2)} m</strong> útiles: al sacar la bobina del
                                    inventario esos metros dejarán de estar disponibles para el cliente. Desmarque la casilla si la tela sigue utilizable.
                                </div>
                            )}

                            <div className="pt-4 flex justify-end">
                                <Button variant="destructive" type="submit" disabled={loading}>
                                    Confirmar Cierre
                                </Button>
                            </div>
                        </form>
                    )}

                    {/* --- TAB: HISTORY --- */}
                    {activeTab === 'history' && (
                        <div className="space-y-4 animate-in fade-in duration-300">
                            {loadingHistory ? (
                                <div className="text-center py-10 text-zinc-400">Cargando movimientos...</div>
                            ) : history.length === 0 ? (
                                <div className="text-center py-10 text-zinc-400">No hay historial registrado.</div>
                            ) : (
                                <div className="space-y-3">
                                    {history.map((mov, idx) => (
                                        <div key={idx} className="flex gap-3 items-start border-b border-zinc-100 pb-3 last:border-0">
                                            <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${mov.Cantidad > 0 ? 'bg-green-500' : 'bg-red-500'}`}></div>
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
                                                                <span className="font-medium text-zinc-700 text-sm">{mov.TipoMovimiento}</span>
                                                                <span className={`font-mono text-sm font-bold ${mov.Cantidad > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                    {mov.Cantidad > 0 ? '+' : ''}{mov.Cantidad}m
                                                                </span>
                                                            </div>
                                                            {/* Fila 2: Orden (si existe) */}
                                                            {ordenPart && (
                                                                <div className="mt-1 flex items-center gap-1">
                                                                    <span className="text-[9px] font-black uppercase tracking-widest text-blue-400">Orden</span>
                                                                    <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{ordenPart}</span>
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
        </div>
    );
};

export default ManageBobinaModal;

