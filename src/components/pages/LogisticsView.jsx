import React, { useState, useEffect, useMemo } from 'react';
import { logisticsService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { printLabels as printLabelsUtil } from '../../utils/labelPrinter';
import DispatchHistoryModal from '../modals/DispatchHistoryModal';
import ReceptionView from '../logistics/ReceptionView';
import DispatchView from '../logistics/DispatchView';

const LogisticsView = ({ areaCode }) => {
    const { user } = useAuth();

    // AREAS LIST
    const AREAS = ['TODOS', 'CORTE', 'IMPRESION', 'CALANDRA', 'CONFECCION', 'TERMINACION', 'LOGISTICA', 'DEPOSITO'];
    const [globalArea, setGlobalArea] = useState('TODOS');

    const [baskets, setBaskets] = useState([]);
    const [selectedBasketId, setSelectedBasketId] = useState(null);
    const [selectedOrders, setSelectedOrders] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    // View Mode
    const [viewMode, setViewMode] = useState('DASHBOARD');
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [loading, setLoading] = useState(true);

    // Initialize Global Area on Mount
    useEffect(() => {
        if (user) {
            const userArea = areaCode || user.areaKey || user.areaId;
            if (userArea && AREAS.includes(userArea)) {
                setGlobalArea(userArea);
            } else if (userArea) {
                // If user area not in list but exists, add it or strict filter? 
                // Let's rely on 'TODOS' for Admins or unknown areas, but try to set it.
                // If we want to force user to see only their area, we might disable the filter.
                // Assuming Admin/Supervisor usage for now based on request.
                // If user is basic user, they might not see the dropdown or it's locked.
                if (user.rol === 'ADMIN' || user.rol === 'SUPERVISOR') {
                    // Keep TODOS default or set specific?
                } else {
                    setGlobalArea(userArea);
                }
            }
        }
    }, [user, areaCode]);

    useEffect(() => {
        if (user) {
            loadDashboard();
            const interval = setInterval(loadDashboard, 30000);
            return () => clearInterval(interval);
        }
    }, [user, globalArea]); // Reload when Area changes

    // Clear orders when basket changes
    useEffect(() => {
        setSelectedOrders([]);
    }, [selectedBasketId]);

    const loadDashboard = async () => {
        try {
            // Use Global Filter if not TODOS, else use context or fetch all
            const targetArea = globalArea === 'TODOS' ? null : globalArea;

            // If targetArea is null, backend presumably returns ALL or we need to handle it.
            // LogisticsService.getDashboard usually takes an Area param. 
            // If 'TODOS', we might send 'GENERAL' or undefined. Let's send undefined/null.
            const data = await logisticsService.getDashboard(targetArea);

            const newBaskets = [];

            // ... (rest of logic) ...
            // 1. Fallas
            if (data.fallas?.length) {
                newBaskets.push({
                    id: 'basket_fallas',
                    nombre: 'Fallas / Reposición',
                    tipo: 'falla',
                    ordenes: data.fallas,
                    areaOrigin: targetArea || 'VARIOUS'
                });
            }

            // 2. Incompletos
            if (data.incompletos?.length) {
                newBaskets.push({
                    id: 'basket_incomplete',
                    nombre: 'Producción Incompleta',
                    tipo: 'incompleto',
                    ordenes: data.incompletos,
                    areaOrigin: targetArea || 'VARIOUS'
                });
            }

            // 3. Completos
            const basketKeys = Object.keys(data.completos || {});
            basketKeys.forEach(key => {
                const ords = data.completos[key];
                if (ords && ords.length > 0) {
                    const isProcessing = key.includes('En Proceso');
                    newBaskets.push({
                        id: `basket_${key.replace(/\s+/g, '_').toLowerCase()}`,
                        nombre: key,
                        tipo: isProcessing ? 'proceso' : 'logistica',
                        ordenes: ords,
                        areaOrigin: targetArea || ords[0].area // Use area from data if 'TODOS'
                    });
                }
            });

            setBaskets(newBaskets);

        } catch (error) {
            console.error('Error loading dashboard:', error);
        } finally {
            setLoading(false);
        }
    };

    // Calculate Active Basket (Stable Reference)
    const selectedBasket = useMemo(() => {
        if (baskets.length === 0) return null;
        return baskets.find(b => b.id === selectedBasketId) || baskets[0];
    }, [baskets, selectedBasketId]);


    // Calculate displayed labels based on selection and search
    // Using useMemo to prevent unnecessary recalculations
    const displayLabels = useMemo(() => {
        if (!selectedBasket) return [];

        let ordersToShow = selectedBasket.ordenes;

        // Filter by Search
        if (searchTerm) {
            const low = searchTerm.toLowerCase();
            ordersToShow = ordersToShow.filter(o =>
                (o.code || '').toLowerCase().includes(low) ||
                (o.client || '').toLowerCase().includes(low) ||
                (o.desc || '').toLowerCase().includes(low)
            );
        }

        // Flatten Labels
        return ordersToShow.flatMap(o => {
            // Si la orden no tiene bultos (error de datos), retornamos vacío
            return (o.bultos || []).map(b => ({
                ...b,
                orderId: o.id,
                orderCode: o.code,
                client: o.client,
                desc: o.desc,
                area: o.area,
                status: o.status,
                logStatus: o.logStatus,
                isSelected: selectedOrders.includes(o.id)
            }));
        });
    }, [selectedBasket, selectedOrders, searchTerm]);

    const handleToggleOrder = (orderId) => {
        setSelectedOrders(prev => {
            if (prev.includes(orderId)) return prev.filter(id => id !== orderId);
            return [...prev, orderId];
        });
    };

    const handleSelectAll = () => {
        if (!selectedBasket) return;
        // Si ya están todas seleccionadas (o hay selección), deseleccionar todo.
        // Si no hay selección, seleccionar todo.
        const allIds = selectedBasket.ordenes.map(o => o.id);
        const allSelected = allIds.every(id => selectedOrders.includes(id));

        if (allSelected) setSelectedOrders([]);
        else setSelectedOrders(allIds);
    };

    const handleGenerateRemito = async () => {
        if (selectedOrders.length === 0) {
            alert("Seleccione al menos una orden para generar el remito.");
            return;
        }

        // VALIDACIÓN PREVIA DE ESTADOS (Frontend)
        const selectedObjects = selectedBasket.ordenes.filter(o => selectedOrders.includes(o.id));
        console.log("🔍 Validando despacho para:", selectedObjects.map(o => `${o.code} [${o.status}]`));

        const validStatuses = ['PRONTO', 'EN LOGISTICA', 'FINALIZADO', 'TERMINADO', 'ENTREGADA', 'ENVIADO'];

        const invalidOrders = selectedObjects.filter(o => {
            const st = (o.status || '').toUpperCase().trim();
            // Estado válido si está en la lista o contiene "PRONTO"
            return !validStatuses.includes(st) && !st.includes('PRONTO');
        });

        if (invalidOrders.length > 0) {
            const list = invalidOrders.slice(0, 10).map(o => `- ${o.code} (Estado: ${o.status})`).join('\n');
            const more = invalidOrders.length > 10 ? `\n...y ${invalidOrders.length - 10} más.` : '';
            alert(`⛔ ACCIÓN DENEGADA.\n\nNo se puede generar remito porque hay órdenes seleccionadas que no están finalizadas:\n\n${list}${more}\n\nPor favor, finalice el control de estas órdenes antes de despachar.`);
            return;
        }

        // VALIDACIÓN DE GRUPO COMPLETO (Debes llevarte todas las partes visibles de la orden)
        const allBasketOrders = selectedBasket.ordenes;
        const selectedIds = new Set(selectedOrders);
        const partialGroups = [];

        const getBaseCode = (code) => code.split('(')[0].trim();

        // Mapa de grupos en el canasto actual
        const basketGroups = {};
        allBasketOrders.forEach(o => {
            const base = getBaseCode(o.code);
            if (!basketGroups[base]) basketGroups[base] = [];
            basketGroups[base].push(o);
        });

        // Verificar que si tocamos un grupo, lo llevemos entero (de lo que hay disponible)
        selectedObjects.forEach(sel => {
            const base = getBaseCode(sel.code);
            const groupMembers = basketGroups[base];
            // Buscar miembros no seleccionados
            const unselectedMembers = groupMembers.filter(m => !selectedIds.has(m.id));

            if (unselectedMembers.length > 0) {
                if (!partialGroups.find(p => p.base === base)) {
                    partialGroups.push({ base, missing: unselectedMembers.map(m => m.code) });
                }
            }
        });

        if (partialGroups.length > 0) {
            const msg = partialGroups.map(g =>
                `- Orden ${g.base}: Faltan agregar ${g.missing.join(', ')}`
            ).join('\n');
            alert(`⛔ SELECCIÓN INCOMPLETA.\n\nPara mantener la integridad, debe despachar TODAS las partes de la orden juntas:\n\n${msg}`);
            return;
        }

        // VALIDACIÓN SERVER-SIDE (Integridad Global)
        try {
            // Filtrar solo bultos físicos reales para validar
            // Los virtuales (nuevos) no se validan porque se crearán completos en este acto
            const physicalBultosIds = selectedObjects
                .flatMap(o => (o.bultos || []).map(b => b.id))
                .filter(id => id); // Remove nulls/undefined

            if (physicalBultosIds.length > 0) {
                const validation = await logisticsService.validateDispatch(physicalBultosIds);

                if (!validation.valid) {
                    const list = validation.errors.slice(0, 10).join('\n');
                    alert(`⛔ INTEGRIDAD GLOBAL DE PEDIDO.\n\nAunque las órdenes seleccionadas están listas, existen OTRAS órdenes del mismo pedido en esta área que NO están terminadas:\n\n${list}\n\nDebe completar TODO el pedido antes de generar el remito.`);
                    return;
                }
            }

            setViewMode('DISPATCH');

        } catch (error) {
            console.error("Validation error:", error);
            // Fallback user friendly
            alert("Error validando requisitos en servidor: " + (error.response?.data?.error || error.message));
        }
    };

    const printLabels = () => {
        if (selectedOrders.length === 0) return;
        // Filter labels belonging to selected orders
        const selectedLabels = displayLabels.filter(l => selectedOrders.includes(l.orderId));

        const normalized = selectedLabels.map(l => ({
            qrCode: l.code,
            displayTitle: `BULTO #${l.num}`,
            orderCode: l.orderCode,
            client: l.client,
            job: l.desc,
            area: l.area,
            bultoIndex: l.num,
            totalBultos: l.total,
            // Include services list (populated from backend RelatedStatus)
            services: (selectedBasket && selectedBasket.ordenes.find(o => o.id === l.orderId)?.services) || []
        }));

        console.log("🖨️ [DEBUG] Datos para Etiquetas:", normalized); // USER REQUEST: LOG BEFORE PRINT
        printLabelsUtil(normalized);
    };

    // Helper para íconos
    const getBasketIcon = (tipo) => {
        if (tipo === 'falla') return 'fa-triangle-exclamation text-red-500';
        if (tipo === 'incompleto') return 'fa-clock text-amber-500';
        if (tipo === 'proceso') return 'fa-spinner fa-spin-pulse text-blue-500';
        return 'fa-check-circle text-emerald-500';
    };

    const BasketCard = ({ basket, isSelected, onClick }) => (
        <div
            onClick={onClick}
            className={`cursor-pointer p-4 rounded-xl border transition-all ${isSelected ? 'bg-white border-blue-500 shadow-md ring-2 ring-blue-100' : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'}`}
        >
            <div className="flex justify-between items-start mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-slate-50 border border-slate-100`}>
                    <i className={`fa-solid ${getBasketIcon(basket.tipo)}`}></i>
                </div>
                <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-black uppercase">{basket.ordenes.length} Ops</span>
            </div>
            <h3 className="font-bold text-slate-700 text-sm leading-tight mb-1">{basket.nombre}</h3>
            <p className="text-[10px] text-slate-400 font-medium">{basket.ordenes.reduce((acc, o) => acc + (o.bultos?.length || 0), 0)} Bultos Totales</p>
        </div>
    );

    return (
        <div className="h-full flex flex-col font-sans text-slate-900 bg-slate-50 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 bg-white border-b border-slate-200 flex justify-between items-center shrink-0">
                <div>
                    <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-warehouse text-indigo-600"></i> Centro de Control Logístico
                    </h1>
                    <p className="text-slate-400 text-xs font-medium">Gestión de Canastos y Despachos</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* GLOBAL AREA SELECTOR */}
                    <div className="relative">
                        <select
                            value={globalArea}
                            onChange={(e) => setGlobalArea(e.target.value)}
                            className="appearance-none pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500 shadow-sm cursor-pointer hover:border-slate-300 transition-colors uppercase"
                        >
                            {AREAS.map(area => (
                                <option key={area} value={area}>{area}</option>
                            ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                            <i className="fa-solid fa-chevron-down text-[10px]"></i>
                        </div>
                    </div>

                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                        <input
                            type="text"
                            placeholder="Buscar orden/cliente..."
                            className="pl-8 pr-4 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors w-64"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={() => setIsHistoryOpen(true)}
                        className="px-4 py-2 bg-white text-slate-600 border border-slate-200 rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-slate-50 transition-colors shadow-sm mr-1"
                    >
                        <i className="fa-solid fa-clock-rotate-left mr-2"></i> Historial
                    </button>
                    <button
                        onClick={() => setViewMode('RECEPTION')}
                        className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-slate-900 transition-colors shadow-lg shadow-slate-200"
                    >
                        <i className="fa-solid fa-barcode mr-2"></i> Recepción WMS
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar Canastos */}
                <div className="w-[320px] bg-slate-50 border-r border-slate-200 flex flex-col p-4 gap-4 overflow-y-auto custom-scrollbar shrink-0">
                    <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">MIS CANASTOS</div>

                    {loading && <div className="text-center py-4 text-slate-400"><i className="fa-solid fa-circle-notch fa-spin"></i> Cargando...</div>}

                    {!loading && baskets.length === 0 && (
                        <div className="p-4 text-center text-slate-400 text-xs italic border border-dashed border-slate-300 rounded-xl">No hay órdenes en logística.</div>
                    )}

                    {baskets.map(b => (
                        <BasketCard
                            key={b.id}
                            basket={b}
                            isSelected={selectedBasket?.id === b.id}
                            onClick={() => setSelectedBasketId(b.id)}
                        />
                    ))}
                </div>

                {/* Main Content Areas */}
                <div className="flex-1 flex flex-col bg-white overflow-hidden">
                    {selectedBasket ? (
                        <>
                            {/* Toolbar Contextual */}
                            <div className="px-6 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-lg font-bold text-slate-800">{selectedBasket.nombre}</h2>
                                    <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md text-xs font-bold border border-indigo-100">
                                        {displayLabels.length} Bultos Visibles
                                    </span>
                                </div>

                                <div className="flex gap-2">
                                    {/* Select All Toggle */}
                                    <button
                                        onClick={handleSelectAll}
                                        className="px-3 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-bold transition-colors border border-slate-200 rounded hover:bg-slate-50"
                                    >
                                        {selectedOrders.length > 0 && selectedOrders.length === selectedBasket.ordenes.length ? 'Ninguno' : 'Todos'}
                                    </button>

                                    {/* Action Buttons */}
                                    {selectedBasket.tipo === 'logistica' && (
                                        <button
                                            onClick={handleGenerateRemito}
                                            disabled={selectedOrders.length === 0}
                                            className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-bold uppercase tracking-wide hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-emerald-200 flex items-center"
                                        >
                                            <i className="fa-solid fa-truck-fast mr-2"></i> Generar Remito
                                        </button>
                                    )}

                                    <button
                                        disabled={selectedOrders.length === 0}
                                        onClick={printLabels}
                                        className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-200 flex items-center"
                                    >
                                        <i className="fa-solid fa-print mr-2"></i> Etiquetas
                                    </button>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="flex-1 overflow-auto custom-scrollbar p-0">
                                {displayLabels.length > 0 ? (
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm text-[10px] font-black uppercase text-slate-400 tracking-wider">
                                            <tr>
                                                <th className="px-6 py-3 border-b border-slate-200 w-10 text-center">
                                                    <i className="fa-regular fa-square-check"></i>
                                                </th>
                                                <th className="px-6 py-3 border-b border-slate-200">Orden</th>
                                                <th className="px-6 py-3 border-b border-slate-200">Cliente</th>
                                                <th className="px-6 py-3 border-b border-slate-200">Detalle Trabajo</th>
                                                <th className="px-6 py-3 border-b border-slate-200">Bulto #</th>
                                                <th className="px-6 py-3 border-b border-slate-200">Código Etiqueta</th>
                                                <th className="px-6 py-3 border-b border-slate-200 text-right">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 text-sm bg-white">
                                            {displayLabels.map((lbl, idx) => (
                                                <tr
                                                    key={`${lbl.id}_${idx}`}
                                                    onClick={() => handleToggleOrder(lbl.orderId)}
                                                    className={`cursor-pointer transition-colors border-l-4 ${lbl.isSelected ? 'bg-indigo-50 border-indigo-500' : 'hover:bg-slate-50 border-transparent'}`}
                                                >
                                                    <td className="px-6 py-3 text-center">
                                                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${lbl.isSelected ? 'bg-indigo-500 border-indigo-500' : 'bg-white border-slate-300'}`}>
                                                            {lbl.isSelected && <i className="fa-solid fa-check text-white text-[10px]"></i>}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-3 font-bold text-slate-700">{lbl.orderCode}</td>
                                                    <td className="px-6 py-3 text-slate-600 truncate max-w-[150px]" title={lbl.client}>{lbl.client}</td>
                                                    <td className="px-6 py-3 text-slate-500 truncate max-w-[200px]" title={lbl.desc}>{lbl.desc}</td>
                                                    <td className="px-6 py-3">
                                                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-bold border border-slate-200">
                                                            {lbl.num}/{lbl.total}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-3 font-mono text-xs text-slate-400">{lbl.code || '-'}</td>
                                                    <td className="px-6 py-3 text-right">
                                                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${lbl.status === 'Retenido' ? 'bg-red-50 text-red-600 border-red-100' :
                                                            selectedBasket.tipo === 'logistica' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'
                                                            }`}>
                                                            {lbl.logStatus || lbl.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-64 text-slate-300">
                                        <i className="fa-solid fa-tags text-4xl mb-4 opacity-20"></i>
                                        <p className="text-sm font-bold">No hay etiquetas para mostrar en este canasto</p>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-300 bg-slate-50/30">
                            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4 border border-slate-200">
                                <i className="fa-solid fa-basket-shopping text-3xl opacity-30 text-slate-400"></i>
                            </div>
                            <p className="font-bold text-sm uppercase tracking-wide text-slate-400">Seleccione un Canasto para comenzar</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <footer className="h-8 border-t border-slate-200 flex items-center justify-between px-6 bg-white shrink-0">
                <div className="flex gap-6 text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-red-400 rounded-full"></div> Falla</div>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-amber-400 rounded-full"></div> Incompleto</div>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-emerald-400 rounded-full"></div> Logística</div>
                </div>
                <div className="text-[10px] font-bold text-slate-300">LOGISTICS MODULE V3.0</div>
            </footer>

            {viewMode === 'RECEPTION' && (
                <div className="fixed inset-0 z-50 bg-white overflow-auto">
                    <ReceptionView
                        onClose={() => setViewMode('DASHBOARD')}
                        areaContext={areaCode || user?.areaId}
                    />
                </div>
            )}

            {viewMode === 'DISPATCH' && (
                <div className="fixed inset-0 z-50 bg-white overflow-auto">
                    <DispatchView
                        selectedOrders={selectedBasket?.ordenes.filter(o => selectedOrders.includes(o.id)) || []}
                        originArea={selectedBasket?.areaOrigin || (selectedBasket?.ordenes?.length > 0 ? selectedBasket.ordenes[0].area : null) || user?.areaId || 'GEN'}
                        onClose={() => setViewMode('DASHBOARD')}
                        onSuccess={() => {
                            loadDashboard();
                            setSelectedOrders([]);
                            // Optionally stay in success step, but DispatchView handles its own view. 
                            // Only close if user clicks close inside DispatchView
                        }}
                    />
                </div>
            )}

            <DispatchHistoryModal
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
                areaId={areaCode || user?.areaId}
            />
        </div>
    );
};

export default LogisticsView;