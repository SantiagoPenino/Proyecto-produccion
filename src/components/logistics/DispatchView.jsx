import React, { useState, useEffect, useMemo } from 'react';
import { logisticsService, authService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import QRCode from "react-qr-code";
import { toast } from 'sonner';

const DispatchView = ({ selectedOrders: initialOrders = [], areaFilter, originArea, onClose, onSuccess, mode: viewMode = 'create' }) => {
    const { user } = useAuth();
    const currentArea = areaFilter || originArea || user?.areaKey || user?.areaId;

    // Creation Steps: 0 = Select Stock, 1 = Quick Confirm/Sign, 2 = Success (Label)
    const [step, setStep] = useState(initialOrders.length > 0 ? 0 : 0);

    // History Selection (Only used if viewMode === 'history')
    const [selectedHistoryCode, setSelectedHistoryCode] = useState(null);
    const [historyDetail, setHistoryDetail] = useState(null);

    // --- FETCH HISTORY ---
    const { data: outgoingRemitos, isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
        queryKey: ['remitos', 'outgoing', currentArea],
        queryFn: () => logisticsService.getOutgoingRemitos(currentArea),
        enabled: !!currentArea && currentArea !== 'TODOS'
    });

    // --- CREATION STATE ---
    const [selectedStockItems, setSelectedStockItems] = useState([]); // Flat list of BultoIDs or Items
    const [stockSearch, setStockSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState([]);
    const [logs, setLogs] = useState([]);
    const [credentials, setCredentials] = useState({ username: '', password: '' });
    const [targetDestinations, setTargetDestinations] = useState({});

    // --- QUERY STOCK (Step 0) ---
    const { data: areaStock, isLoading: loadingStock, refetch: refetchStock } = useQuery({
        queryKey: ['stock', currentArea],
        queryFn: () => logisticsService.getAreaStock(currentArea),
        enabled: viewMode === 'create' && step === 0 && !!currentArea && currentArea !== 'TODOS'
    });

    useEffect(() => {
        if (areaStock && areaStock.length > 0) {
            console.log("DEBUG FRONT STOCK ROW 0 KEYS:", Object.keys(areaStock[0]));
            console.log("DEBUG FRONT STOCK ROW 0 DATA:", areaStock[0]);
        }
    }, [areaStock]);

    // --- FLATTENED STOCK VIEW (Vista por Bultos) ---
    const stockRows = useMemo(() => {
        if (!areaStock) return [];

        // Prepare rows with calculated BaseCode for smart selection
        const rows = areaStock.map(item => {
            let baseCode = item.CodigoEtiqueta;
            // Regex to find Base Code (PRE-33 from PRE-33-1)
            const match = baseCode && baseCode.match(/^(PRE-\d+)(-\d+)?$/);
            if (match) baseCode = match[1];
            else if (item.OrdenID) baseCode = `ORD-${item.OrdenID}`;

            return {
                ...item,
                rowId: item.BultoID,
                baseCode: baseCode, // Used for auto-selecting siblings
                // Data mapping using the robust fields from backend
                displayCode: item.CodigoEtiqueta,
                orderCode: item.CodigoOrden,
                client: item.Cliente || '-',
                desc: item.DescripcionTrabajo || item.Descripcion,
                // Fallback date check (Reception -> Order -> Creation)
                date: item.FechaIngreso || item.FechaRecepcion || item.FechaCreacion,
                nextService: item.ProximoServicio
            };
        });

        if (!stockSearch) return rows;

        const lowerSearch = stockSearch.toLowerCase();
        return rows.filter(r =>
            r.displayCode.toLowerCase().includes(lowerSearch) ||
            (r.client && r.client.toLowerCase().includes(lowerSearch)) ||
            (r.desc && r.desc.toLowerCase().includes(lowerSearch))
        );
    }, [areaStock, stockSearch]);

    // --- TRANSFORM SELECTION ---
    const selectedOrders = useMemo(() => {
        if (initialOrders.length > 0) return initialOrders;

        // Group selected items back into Order structure for logic
        const grouped = {};

        // selectedStockItems contains the raw Stock Items (bultos)
        selectedStockItems.forEach(item => {
            // We need to keep consistency with the Grouping View Logic
            // But for the Remito creation payload, we might want to respect the OrderID if available
            // OR just group by Destination.

            const orderKey = item.OrdenID || `BULK-${item.BultoID}`;
            if (!grouped[orderKey]) {
                grouped[orderKey] = {
                    id: item.OrdenID,
                    code: item.CodigoOrden || item.CodigoEtiqueta,
                    desc: item.DescripcionTrabajo || item.Descripcion,
                    destino: item.ProximoServicio && item.ProximoServicio !== 'LOGISTICA' ? item.ProximoServicio : 'LOGISTICA',
                    bultos: []
                };
            }

            // FIX: If group has generic destination but current item has specific one, upgrade it!
            if (grouped[orderKey].destino === 'LOGISTICA' && item.ProximoServicio && item.ProximoServicio !== 'LOGISTICA') {
                grouped[orderKey].destino = item.ProximoServicio;
            }

            grouped[orderKey].bultos.push({
                id: item.BultoID,
                code: item.CodigoEtiqueta,
                desc: item.Descripcion
            });
        });
        return Object.values(grouped);
    }, [initialOrders, selectedStockItems]);

    // Dispatch Groups (by Destination)
    const dispatchGroups = useMemo(() => {
        const groups = {};
        if (!Array.isArray(selectedOrders)) return groups;
        selectedOrders.forEach(o => {
            const dest = o.destino || 'LOGISTICA';
            if (!groups[dest]) groups[dest] = [];
            groups[dest].push(o);
        });
        return groups;
    }, [selectedOrders]);

    // --- SMART SELECTION (Scan Logic) ---
    const toggleRow = (row) => {
        // 1. Identify siblings (Same Base Code)
        const siblings = stockRows.filter(r => r.baseCode === row.baseCode);
        const siblingIds = siblings.map(r => r.BultoID);

        // 2. Check if currently selected
        // If ANY of the siblings is NOT selected, we SELECT ALL. (Additive behavior preferred for scanning)
        const allSelected = siblingIds.every(id => selectedStockItems.some(s => s.BultoID === id));

        if (allSelected) {
            // Deselect all siblings
            setSelectedStockItems(prev => prev.filter(s => !siblingIds.includes(s.BultoID)));
        } else {
            // Select all siblings (that aren't already selected)
            const newItems = siblings.filter(s => !selectedStockItems.some(existing => existing.BultoID === s.BultoID));
            // We store the original item structure
            setSelectedStockItems(prev => [...prev, ...newItems]);

            // Optional: Toast feedback for scan
            if (newItems.length > 0) {
                // toast.success(`Grupo ${row.baseCode} seleccionado`);
            }
        }
    };

    // SCANNER LISTENER (Simple version: detects Enter on search or global)
    const handleKeyDown = (e) => {
        // If Enter is pressed and we have text in search, treat as SCAN
        if (e.key === 'Enter' && stockSearch) {
            const exactMatch = stockRows.find(r => r.displayCode.toUpperCase() === stockSearch.toUpperCase().trim());
            if (exactMatch) {
                toggleRow(exactMatch);
                setStockSearch(''); // Clear after scan
                toast.success(`Escaneado: ${exactMatch.displayCode}`);
            }
        }
    };

    const totalSelectedRows = selectedStockItems.length;
    const totalBultos = selectedStockItems.length; // FIX: Define totalBultos for render logic

    // --- ACTIONS ---
    // startNewDispatch removed as mode is controlled by parent prop

    const handleSelectHistory = async (code) => {
        // Mode is already history
        setSelectedHistoryCode(code);
        setLoading(true);
        try {
            const data = await logisticsService.getRemitoByCode(code);
            setHistoryDetail(data);
        } catch (err) {
            toast.error("Error cargando remito");
        } finally {
            setLoading(false);
        }
    };

    const handleCreateBatch = async (e) => {
        if (e) e.preventDefault();
        setLoading(true);
        setLogs([]);
        const createdParams = [];

        try {
            // Auth: Use current session user directly for speed
            const authUser = user;
            if (!authUser || !authUser.id) {
                toast.error("No hay sesión de usuario activa.");
                setLoading(false);
                return;
            }
            setLogs(prev => [...prev, `✅ Usuario validado: ${authUser.username}`]);

            // Create
            const destinations = Object.keys(dispatchGroups);
            for (const groupKey of destinations) {
                const finalDest = targetDestinations[groupKey] || groupKey;
                const orders = dispatchGroups[groupKey];
                const bultosIds = [];
                const newBultos = [];

                orders.forEach(o => {
                    if (o.bultos) {
                        o.bultos.forEach(b => {
                            if (b.id) bultosIds.push(b.id);
                            else newBultos.push({ ordenId: o.id, descripcion: o.desc });
                        });
                    }
                });

                if (bultosIds.length === 0 && newBultos.length === 0) continue;

                const payload = {
                    codigoRemito: 'AUTO',
                    areaOrigen: currentArea || 'PRODUCCION',
                    areaDestino: finalDest,
                    usuarioId: authUser.id,
                    transportista: authUser.username,
                    bultosIds, newBultos,
                    observations: `Generado por ${authUser.username}`
                };

                const res = await logisticsService.createDispatch(payload);
                createdParams.push({ ...res, destArea: finalDest, itemCount: bultosIds.length + newBultos.length });
            }

            setResults(createdParams);
            setStep(3);
            if (onSuccess) onSuccess();
            refetchStock();
            refetchHistory();
            setCredentials({ username: '', password: '' });

        } catch (error) {
            toast.error("Error: " + error.message);
            setLogs(prev => [...prev, `❌ Error: ${error.message}`]);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => window.print();

    const handleDirectSubmit = () => {
        const destinations = Object.keys(dispatchGroups);
        if (destinations.length === 0) return;

        // Permite múltiples destinos: Redirige al Paso 1 (Revisión)
        // El Paso 1 mostrará los grupos y el Paso 2 firmará todos en lote.
        setStep(1);
    };

    // --- RENDERERS ---

    const renderHistoryDetail = () => {
        if (loading) return <div className="p-8 text-center text-slate-400">Cargando detalle...</div>;
        if (!historyDetail) return <div className="p-8 text-center text-slate-400">Seleccione un remito para ver detalles</div>;

        const res = {
            dispatchCode: historyDetail.CodigoRemito,
            destArea: historyDetail.AreaDestinoID,
            transportista: historyDetail.UsuarioEmisor,
            itemCount: historyDetail.items?.length || 0,
            date: new Date(historyDetail.FechaSalida).toLocaleString()
        };

        return (
            <div className="flex flex-col h-full bg-slate-100 overflow-auto print:bg-white">
                <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center print:hidden">
                    <div>
                        <h2 className="font-bold text-slate-800 flex items-center gap-2">
                            {historyDetail.CodigoRemito}
                        </h2>
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold">{historyDetail.Estado?.replace('_', ' ')}</span>
                    </div>
                    <button onClick={handlePrint} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold"><i className="fa-solid fa-print mr-2"></i> Imprimir</button>
                </div>

                <div className="p-8 flex flex-col items-center print:p-0">
                    <div className="w-full max-w-2xl bg-white p-8 rounded-xl border-dashed border-2 border-slate-300 print:border-4 print:border-black print:w-full print:shadow-none shadow-sm">
                        <div className="text-center mb-6 border-b-2 border-black pb-4">
                            <h1 className="text-4xl font-black uppercase tracking-tight">Remito</h1>
                            <div className="flex justify-between mt-4 font-bold text-sm">
                                <span>ORIGEN: {historyDetail.AreaOrigenID}</span>
                                <span>DESTINO: {historyDetail.AreaDestinoID}</span>
                            </div>
                        </div>
                        <div className="flex justify-center mb-6">
                            <QRCode value={res.dispatchCode} size={128} />
                        </div>
                        <div className="text-center font-mono text-2xl font-black mb-6">{res.dispatchCode}</div>

                        <div className="text-center text-xs text-slate-500 mb-6">Emisión: {res.date}</div>

                        {/* Item List */}
                        <div className="text-center border-t-2 border-slate-200 pt-6 mt-4">
                            <h3 className="text-xs font-bold uppercase mb-2 text-slate-400">Cantidad Total</h3>
                            <div className="text-6xl font-black text-slate-900">{historyDetail.items?.length || 0}</div>
                            <div className="text-sm font-bold uppercase text-slate-500 mt-1">Bultos</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderCreationFlow = () => (
        <>
            {step === 0 && (
                <div className="flex flex-col h-full bg-slate-50">
                    {/* Header with Search and Action */}
                    <div className="bg-white p-6 border-b border-slate-200 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-slate-800">Generación de Remitos</h2>
                                <p className="text-xs text-slate-500">Gestiona al inventario físico y despachos de <strong className="text-indigo-600">{currentArea}</strong></p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="relative flex-1">
                                <i className="fa-solid fa-search absolute left-4 top-3.5 text-slate-400"></i>
                                <input
                                    className="w-full bg-slate-100 border-none rounded-xl pl-12 pr-4 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-200 outline-none transition-all placeholder:font-normal"
                                    placeholder="Escanear etiqueta o buscar cliente..."
                                    value={stockSearch}
                                    onChange={e => setStockSearch(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    autoFocus
                                />
                            </div>
                            <button
                                disabled={selectedStockItems.length === 0}
                                onClick={handleDirectSubmit}
                                className="px-8 bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 hover:bg-emerald-600 disabled:opacity-50 disabled:shadow-none transition-all flex items-center gap-2"
                            >
                                <i className="fa-solid fa-truck-fast"></i> Generar Remito
                                {selectedStockItems.length > 0 && <span className="ml-1 bg-white/20 px-2 py-0.5 rounded text-xs">{selectedStockItems.length}</span>}
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 p-6 overflow-y-auto">
                        {loadingStock ? (
                            <div className="text-center py-10 text-slate-400"><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Cargando stock...</div>
                        ) : (
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 text-xs font-bold text-slate-400 uppercase tracking-wider">
                                        <tr>
                                            <th className="p-4 w-12 text-center">
                                                {/* Global Checkbox logic could go here */}
                                                <i className="fa-regular fa-square"></i>
                                            </th>
                                            <th className="p-4">Código</th>
                                            <th className="p-4">Cliente</th>
                                            <th className="p-4">Detalle / Referencias</th>
                                            <th className="p-4">Destino</th>
                                            <th className="p-4">Antigüedad</th>
                                            <th className="p-4 text-right">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-sm">
                                        {stockRows.map(row => {
                                            // Check selection by ID directly (Flat Mode)
                                            const isSelected = selectedStockItems.some(s => s.BultoID === row.BultoID);

                                            return (
                                                <tr
                                                    key={row.rowId}
                                                    onClick={() => toggleRow(row)}
                                                    className={`hover:bg-slate-50 transition-colors cursor-pointer group ${isSelected ? 'bg-indigo-50/50' : ''}`}
                                                >
                                                    <td className="p-4 text-center">
                                                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-white border-slate-300 text-transparent group-hover:border-indigo-300'}`}>
                                                            <i className="fa-solid fa-check text-xs"></i>
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-bold font-mono text-slate-800">{row.displayCode}</div>
                                                        {row.orderCode && <div className="text-xs text-indigo-600 font-bold">{row.orderCode}</div>}
                                                    </td>
                                                    <td className="p-4 font-bold text-slate-600 uppercase">
                                                        {row.client && row.client !== '-' ? row.client : <span className="text-slate-400 italic font-normal">S/D</span>}
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-bold text-slate-700">{row.desc}</div>
                                                    </td>
                                                    <td className="p-4">
                                                        {row.nextService && row.nextService !== 'LOGISTICA' ? (
                                                            <div className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded font-bold text-xs inline-flex items-center gap-1 border border-indigo-200">
                                                                <i className="fa-solid fa-arrow-right text-[10px]"></i> {row.nextService}
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 text-xs font-bold">LOGISTICA</span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-slate-500 font-medium">
                                                        {row.date ? new Date(row.date).toLocaleDateString() : '-'}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-bold uppercase border border-emerald-200">
                                                            EN STOCK
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {stockRows.length === 0 && (
                                            <tr><td colSpan="6" className="p-10 text-center text-slate-400">No hay items en stock disponibles para despachar.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {step === 1 && (
                <div className="flex flex-col h-full bg-slate-50">
                    <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
                        <div className="space-y-4">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <div className="text-xs font-bold text-slate-400 uppercase mb-1">Total a Despachar</div>
                                <div className="text-4xl font-black text-slate-800">{totalBultos}</div>
                                <div className="text-sm text-slate-500 font-bold">Bultos</div>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <div className="text-xs font-bold text-indigo-500 uppercase mb-3">Destinos</div>
                                <div className="space-y-3">
                                    {Object.keys(dispatchGroups).map(key => (
                                        <div key={key} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs font-bold text-slate-600">Grupo: {key}</span>
                                                <span className="text-xs font-bold bg-slate-200 px-2 py-0.5 rounded">{dispatchGroups[key].length} Ordenes</span>
                                            </div>
                                            {key === 'LOGISTICA' && (
                                                <select className="w-full text-sm p-2 border rounded font-bold text-slate-700" value={targetDestinations[key] || ''} onChange={e => setTargetDestinations({ ...targetDestinations, [key]: e.target.value })}>
                                                    <option value="">Seleccionar Destino Real...</option>
                                                    {['CORTE', 'COSTURA', 'ESTAMPADO', 'BORDADO', 'TERMINACION', 'DEPOSITO'].map(a => <option key={a} value={a}>{a}</option>)}
                                                </select>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-slate-100 font-bold text-slate-600 text-sm">Review Items</div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                {selectedOrders.map((o, i) => (
                                    <div key={i} className="p-3 border rounded-lg flex justify-between items-center">
                                        <div>
                                            <div className="font-bold text-slate-800 text-sm">{o.code}</div>
                                            <div className="text-xs text-slate-500">{o.desc}</div>
                                        </div>
                                        <div className="text-right"><span className="text-xs font-bold bg-slate-100 px-2 py-1 rounded">{o.bultos.length} Bultos</span></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="p-6 border-t border-slate-200 bg-white flex justify-end gap-3 sticky bottom-0">
                        <button onClick={() => setStep(0)} className="px-6 py-3 border rounded-xl font-bold text-slate-500 hover:bg-slate-50">Atrás</button>
                        <button onClick={() => setStep(2)} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-200">Firmar Entrega</button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="flex flex-col h-full bg-slate-50 items-center justify-center p-6">
                    <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                        <div className="p-8 pb-0 text-center">
                            <h2 className="text-2xl font-black text-slate-800">Firma Digital</h2>
                            <p className="text-sm text-slate-500 mt-2">Autorizar salida de {totalBultos} bultos</p>
                        </div>
                        <form onSubmit={handleCreateBatch} className="p-8 space-y-4">
                            <input className="w-full p-3 bg-slate-50 border rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-100" placeholder="Usuario" value={credentials.username} onChange={e => setCredentials({ ...credentials, username: e.target.value })} />
                            <input className="w-full p-3 bg-slate-50 border rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-100" type="password" placeholder="Contraseña" value={credentials.password} onChange={e => setCredentials({ ...credentials, password: e.target.value })} />
                            {logs.length > 0 && <div className="p-3 bg-slate-900 text-emerald-400 text-xs rounded-lg font-mono">{logs[logs.length - 1]}</div>}
                            <button type="submit" disabled={loading} className="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors">
                                {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : 'Confirmar Salida'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="flex flex-col h-full bg-slate-100 overflow-auto print:bg-white">
                    {/* PRINT STYLES */}
                    <style>{`
                        @media print {
                            body * {
                                visibility: hidden;
                            }
                            #printable-area, #printable-area * {
                                visibility: visible;
                            }
                            #printable-area {
                                position: absolute;
                                left: 0;
                                top: 0;
                                width: 100%;
                                margin: 0;
                                padding: 0;
                                background: white;
                            }
                            @page {
                                size: auto;
                                margin: 0mm;
                            }
                        }
                    `}</style>

                    <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center print:hidden">
                        <h2 className="font-bold text-slate-800 flex items-center gap-2"><i className="fa-solid fa-check-circle text-emerald-500"></i> Remitos Generados</h2>
                        <button onClick={handlePrint} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 transition-colors"><i className="fa-solid fa-print mr-2"></i> Imprimir</button>
                    </div>

                    <div id="printable-area" className="p-8 flex flex-col items-center gap-8 print:p-0 print:block">
                        {results.map((res, i) => (
                            <div key={i} className="w-full max-w-2xl bg-white p-8 rounded-xl border-dashed border-2 border-slate-300 print:border-4 print:border-black print:w-full print:shadow-none shadow-sm relative mx-auto my-4 break-after-page print:m-0">
                                <div className="text-center mb-6 border-b-2 border-black pb-4">
                                    <h1 className="text-4xl font-black uppercase tracking-tight text-slate-900">Remito</h1>
                                    <div className="flex justify-between mt-4 font-bold text-sm">
                                        <span>ORIGEN: {currentArea || user?.areaKey}</span>
                                        <span>DESTINO: {res.destArea}</span>
                                    </div>
                                </div>
                                <div className="flex justify-center mb-6">
                                    <QRCode value={res.dispatchCode} size={150} />
                                </div>
                                <div className="text-center font-mono text-2xl font-black mb-6 text-slate-900">{res.dispatchCode}</div>

                                <div className="text-center text-xs text-slate-500 mb-6">Emisión: {new Date().toLocaleString('es-AR')}</div>

                                {/* Item List */}
                                {/* Item List replaced by Total Count */}
                                <div className="text-center border-t-2 border-slate-200 pt-6 mt-4">
                                    <h3 className="text-xs font-bold uppercase mb-2 text-slate-400">Cantidad Total</h3>
                                    <div className="text-6xl font-black text-slate-900">{res.itemCount}</div>
                                    <div className="text-sm font-bold uppercase text-slate-500 mt-1">Bultos</div>
                                </div>

                                <div className="mt-4 text-center text-[10px] text-slate-400">
                                    Transportista: {credentials.username || 'Sistema'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );

    // --- RENDER: HISTORY MODE ---
    if (viewMode === 'history') {
        return (
            <div className="flex h-full bg-slate-100 font-sans min-h-screen">
                {/* LIST SIDEBAR */}
                <div className="w-1/3 min-w-[350px] max-w-md bg-white border-r border-slate-200 flex flex-col h-full sticky top-0 print:hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h2 className="font-bold text-slate-800 text-lg">Historial de Envíos</h2>
                        <button onClick={() => refetchHistory()} className="text-slate-400 hover:text-indigo-600"><i className="fa-solid fa-sync"></i></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {loadingHistory && <div className="p-4 text-center text-slate-400"><i className="fa-solid fa-circle-notch fa-spin"></i></div>}
                        {outgoingRemitos?.length === 0 && <div className="p-4 text-center text-slate-400 text-sm">No hay envíos registrados.</div>}
                        {outgoingRemitos?.map(rem => (
                            <div
                                key={rem.EnvioID}
                                onClick={() => handleSelectHistory(rem.CodigoRemito)}
                                className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md ${selectedHistoryCode === rem.CodigoRemito ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-300' : 'bg-white border-slate-100 hover:border-slate-300'}`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-bold text-slate-800 font-mono text-lg">{rem.CodigoRemito}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${rem.Estado === 'ENTREGADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{rem.Estado?.replace('_', ' ')}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                                    <i className="fa-solid fa-arrow-right-long text-slate-300"></i>
                                    <span>Hacia: <strong className="text-slate-700 text-sm">{rem.AreaDestinoID}</strong></span>
                                </div>
                                <div className="flex justify-between items-end border-t border-slate-50 pt-2 mt-2">
                                    <div className="text-[10px] text-slate-400">{new Date(rem.FechaSalida).toLocaleString()}</div>
                                    <div className="text-[10px] font-bold text-slate-500">{rem.TotalItems || rem.items?.length || 0} bultos</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* DETAIL VIEW */}
                <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-slate-50">
                    {selectedHistoryCode ? (
                        <div className="h-full overflow-auto p-6 flex justify-center">{renderHistoryDetail()}</div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                            <i className="fa-solid fa-file-invoice text-6xl mb-4 opacity-20"></i>
                            <p>Seleccione un remito para ver su detalle</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // --- RENDER: CREATION MODE (Default) ---
    return (
        <div className="flex h-full bg-slate-50 font-sans flex-col">
            {/* Top Close Button for Modal Context (if needed) */}
            {onClose && <div className="absolute top-4 right-4 z-50 print:hidden"><button onClick={onClose}><i className="fa-solid fa-xmark text-2xl text-slate-400 hover:text-red-500"></i></button></div>}

            {renderCreationFlow()}
        </div>
    );
};

export default DispatchView;
