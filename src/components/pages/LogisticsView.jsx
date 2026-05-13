import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Warehouse, Truck } from 'lucide-react';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    createColumnHelper,
} from '@tanstack/react-table';
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
            if (userArea) {
                setGlobalArea(userArea.toUpperCase());
            }
        }
    }, [user, areaCode]);

    const debounceRef = useRef(null);
    const loadingRef = useRef(false); // Evita fetches solapados

    useEffect(() => {
        if (!user) return;

        // Cancelar el debounce anterior si el área cambió rápido
        if (debounceRef.current) clearTimeout(debounceRef.current);

        debounceRef.current = setTimeout(() => {
            loadDashboard();
        }, 300); // 300ms de debounce al cambiar área

        // Polling cada 30s (sin debounce, ya es un intervalo)
        const interval = setInterval(loadDashboard, 30000);
        return () => {
            clearTimeout(debounceRef.current);
            clearInterval(interval);
        };
    }, [user, globalArea]); // Reload when Area changes

    // Clear orders when basket changes
    useEffect(() => {
        setSelectedOrders([]);
    }, [selectedBasketId]);

    const loadDashboard = async () => {
        // Evitar fetches solapados
        if (loadingRef.current) return;
        loadingRef.current = true;
        try {
            // Use Global Filter if not TODOS, else use context or fetch all
            const targetArea = globalArea === 'TODOS' ? null : globalArea;

            // If targetArea is null, backend presumably returns ALL or we need to handle it.
            // LogisticsService.getDashboard usually takes an Area param. 
            // If 'TODOS', we might send 'GENERAL' or undefined. Let's send undefined/null.
            const data = await logisticsService.getDashboard(targetArea);
            console.log("🚀 [DEBUG] Dashboard response data:", data);

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
            loadingRef.current = false;
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
        const allIds = selectedBasket.ordenes.map(o => o.id);
        setSelectedOrders(prev => {
            const allSelected = allIds.every(id => prev.includes(id));
            return allSelected ? [] : allIds;
        });
    };

    const handleGenerateRemito = async () => {
        if (selectedOrders.length === 0) {
            alert("Seleccione al menos una orden para generar el remito.");
            return;
        }

        // VALIDACIÓN PREVIA DE ESTADOS (Frontend)
        const selectedObjects = selectedBasket.ordenes.filter(o => selectedOrders.includes(o.id));

        // Identificar cuáles órdenes son FINALES (requieren validación estricta)
        // Las intermedias (tipoBulto = 'EN_PROCESO') pueden viajar parcial e independientemente.
        const isFinal = (b) => !b.tipoBulto || b.tipoBulto.toUpperCase() === 'PROD_TERMINADO';
        const finalObjects = selectedObjects.filter(o => (o.bultos || []).some(isFinal));

        console.log("🔍 Validando despacho estricto para órdenes FINALES:", finalObjects.map(o => `${o.code} [${o.status}]`));

        const validStatuses = ['PRONTO', 'EN LOGISTICA', 'FINALIZADO', 'TERMINADO', 'ENTREGADA', 'ENVIADO'];

        const invalidOrders = finalObjects.filter(o => {
            const st = (o.status || '').toUpperCase().trim();
            // Estado válido si está en la lista o contiene "PRONTO"
            return !validStatuses.includes(st) && !st.includes('PRONTO');
        });

        if (invalidOrders.length > 0) {
            const list = invalidOrders.slice(0, 10).map(o => `- ${o.code} (Estado: ${o.status})`).join('\n');
            const more = invalidOrders.length > 10 ? `\n...y ${invalidOrders.length - 10} más.` : '';
            alert(`⛔ ACCIÓN DENEGADA.\n\nHay órdenes seleccionadas DE PRODUCTO FINAL que no están terminadas:\n\n${list}${more}\n\nPor favor, finalice el control antes de despacharlas. (Las intermedias no tienen este bloqueo).`);
            return;
        }

        // VALIDACIÓN DE GRUPO COMPLETO (Solo aplicable a órdenes finales)
        const allBasketOrders = selectedBasket.ordenes;
        const selectedIds = new Set(selectedOrders);
        const partialGroups = [];

        const getBaseCode = (code) => code.split('(')[0].trim();

        // Armamos los grupos, peros SOLO considerando partes finales de la orden
        const basketGroups = {};
        allBasketOrders.forEach(o => {
            if ((o.bultos || []).some(isFinal)) {
                const base = getBaseCode(o.code);
                if (!basketGroups[base]) basketGroups[base] = [];
                basketGroups[base].push(o);
            }
        });

        finalObjects.forEach(sel => {
            const base = getBaseCode(sel.code);
            const groupMembers = basketGroups[base];
            if (groupMembers) {
                const unselectedMembers = groupMembers.filter(m => !selectedIds.has(m.id));

                if (unselectedMembers.length > 0) {
                    if (!partialGroups.find(p => p.base === base)) {
                        partialGroups.push({ base, missing: unselectedMembers.map(m => m.code) });
                    }
                }
            }
        });

        if (partialGroups.length > 0) {
            const msg = partialGroups.map(g =>
                `- Orden ${g.base}: Faltan ${g.missing.join(', ')}`
            ).join('\n');
            alert(`⛔ INCOMPLETO (TIPO FINAL).\n\nLos productos FINALES exigen llevarse TODAS sus partes juntas:\n\n${msg}\n\nSelecciónelas también para continuar.`);
            return;
        }

        // VALIDACIÓN SERVER-SIDE (Integridad Global) - Solo Finales físicos
        try {
            const physicalBultosIds = finalObjects
                .flatMap(o => (o.bultos || []).map(b => b.id))
                .filter(id => id); // Remove nulls/undefined

            if (physicalBultosIds.length > 0) {
                const validation = await logisticsService.validateDispatch(physicalBultosIds);

                if (!validation.valid) {
                    const list = validation.errors.slice(0, 10).join('\n');
                    alert(`⛔ INTEGRIDAD GLOBAL DE PEDIDO.\n\nExisten OTRAS órdenes asociadas a este PRODUCTO FINAL en esta área que NO están terminadas:\n\n${list}\n\nDebe completar TODO el pedido antes de generar el remito.`);
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
        if (tipo === 'falla') return 'fa-triangle-exclamation text-brand-magenta';
        if (tipo === 'incompleto') return 'fa-clock text-brand-gold';
        if (tipo === 'proceso') return 'fa-spinner fa-spin-pulse text-brand-cyan';
        return 'fa-check-circle text-brand-cyan';
    };

    const BasketCard = ({ basket, isSelected, onClick }) => (
        <div
            onClick={onClick}
            className={`cursor-pointer px-3 py-2 rounded-lg border transition-all flex items-center gap-2 ${
                isSelected
                    ? 'bg-brand-cyan/5 border-brand-cyan shadow-sm ring-1 ring-brand-cyan/20'
                    : 'bg-white border-zinc-200 hover:border-brand-cyan/40 hover:shadow-sm'
            }`}
        >
            <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-zinc-100">
                <i className={`fa-solid ${getBasketIcon(basket.tipo)} text-xs`}></i>
            </div>
            <div className="flex-1 min-w-0">
                <p className={`font-bold text-xs leading-tight truncate ${isSelected ? 'text-brand-cyan' : 'text-zinc-700'}`}>{basket.nombre}</p>
                <p className="text-[10px] text-zinc-400">{basket.ordenes.reduce((acc, o) => acc + (o.bultos?.length || 0), 0)} bultos</p>
            </div>
            <span className="bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded text-[10px] font-black shrink-0">{basket.ordenes.length} ops</span>
        </div>
    );

    return (
        <div className="h-full flex flex-col font-sans text-zinc-900 bg-white overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 bg-white flex justify-between items-center shrink-0">
                <div>
                    <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
                        <Warehouse size={22} className="text-brand-cyan" /> Centro de Control Logístico
                    </h1>
                    <p className="text-slate-400 text-xs font-medium">Gestión de Canastos y Despachos</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* GLOBAL AREA SELECTOR */}
                    {(user?.rol === 'ADMIN' || user?.rol === 'SUPERVISOR') && (
                        <select
                            className="bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors shadow-sm"
                            value={globalArea}
                            onChange={(e) => setGlobalArea(e.target.value)}
                        >
                            {AREAS.map(area => (
                                <option key={area} value={area}>{area}</option>
                            ))}
                        </select>
                    )}                    <div className="relative">
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

                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar Canastos */}
                <div className="w-[220px] bg-white border-r border-zinc-100 flex flex-col gap-1.5 p-2 overflow-y-auto overflow-x-hidden custom-scrollbar shrink-0">
                    <div className="text-[10px] font-black uppercase text-zinc-400 tracking-widest px-1 py-1">MIS CANASTOS</div>

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
                            <div className="px-4 py-2.5 border-b border-zinc-100 flex justify-between items-center bg-zinc-50">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-lg font-bold text-slate-800">{selectedBasket.nombre}</h2>
                                    <span className="bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded-md text-xs font-bold border border-brand-cyan/20">
                                        {displayLabels.length} Bultos Visibles
                                    </span>
                                </div>

                                <div className="flex gap-2">
                                    {selectedBasket.tipo === 'logistica' && (
                                        <button
                                            onClick={handleGenerateRemito}
                                            disabled={selectedOrders.length === 0}
                                            className="px-4 py-1.5 bg-brand-cyan text-white rounded-lg text-xs font-bold uppercase tracking-wide hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md flex items-center gap-2"
                                        >
                                            <Truck size={14} /> Generar Remito
                                        </button>
                                    )}
                                </div>
                            </div>

                            <BasketTable
                                data={displayLabels}
                                basketTipo={selectedBasket.tipo}
                                onToggle={handleToggleOrder}
                                onSelectAll={handleSelectAll}
                                allSelected={selectedBasket.ordenes.length > 0 && selectedBasket.ordenes.every(o => selectedOrders.includes(o.id))}
                                someSelected={selectedOrders.length > 0 && !selectedBasket.ordenes.every(o => selectedOrders.includes(o.id))}
                            />
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
            <footer className="h-8 flex items-center justify-between px-6 bg-white shrink-0">
                <div className="flex gap-6 text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-brand-magenta rounded-full"></div> Falla</div>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-brand-gold rounded-full"></div> Incompleto</div>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-brand-cyan rounded-full"></div> Logística</div>
                </div>
                <div className="text-[10px] font-bold text-slate-300">LOGISTICS MODULE V3.0</div>
            </footer>

            {viewMode === 'RECEPTION' && createPortal(
                <div className="fixed inset-0 z-[9999] bg-white overflow-auto">
                    <ReceptionView
                        onClose={() => setViewMode('DASHBOARD')}
                        areaContext={globalArea}
                    />
                </div>,
                document.body
            )}

            {viewMode === 'DISPATCH' && createPortal(
                <div className="fixed inset-0 z-[9999] bg-white overflow-auto">
                    <DispatchView
                        selectedOrders={selectedBasket?.ordenes.filter(o => selectedOrders.includes(o.id)) || []}
                        originArea={selectedBasket?.areaOrigin || (selectedBasket?.ordenes?.length > 0 ? selectedBasket.ordenes[0].area : null) || user?.areaId || 'GEN'}
                        onClose={() => setViewMode('DASHBOARD')}
                        onSuccess={() => {
                            loadDashboard();
                            setSelectedOrders([]);
                        }}
                    />
                </div>,
                document.body
            )}

            <DispatchHistoryModal
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
                areaId={globalArea}
            />
        </div>
    );
};

// ─── BasketTable (TanStack Table v8) ───────────────────────────────────────
const columnHelper = createColumnHelper();

function BasketTable({ data, basketTipo, onToggle, onSelectAll, allSelected, someSelected }) {
    const selectAllRef = React.useRef(null);

    React.useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = someSelected;
        }
    }, [someSelected]);
    const columns = useMemo(() => [
        columnHelper.display({
            id: 'select',
            size: 1,
            header: ({ table: t }) => (
                <div
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-all mx-auto cursor-pointer ${
                        allSelected ? 'bg-brand-cyan border-brand-cyan' : someSelected ? 'bg-brand-cyan/40 border-brand-cyan' : 'bg-white border-slate-300 hover:border-brand-cyan'
                    }`}
                    onClick={onSelectAll}
                    ref={selectAllRef}
                >
                    {allSelected && <i className="fa-solid fa-check text-white text-[10px]"></i>}
                    {someSelected && !allSelected && <i className="fa-solid fa-minus text-white text-[10px]"></i>}
                </div>
            ),
            cell: ({ row }) => {
                const lbl = row.original;
                return (
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all mx-auto ${
                        lbl.isSelected ? 'bg-brand-cyan border-brand-cyan' : 'bg-white border-slate-300'
                    }`}>
                        {lbl.isSelected && <i className="fa-solid fa-check text-white text-[10px]"></i>}
                    </div>
                );
            },
        }),
        columnHelper.accessor('orderCode', {
            header: 'Orden',
            size: 1,
            cell: info => <span className="font-bold text-slate-700">{info.getValue()}</span>,
        }),
        columnHelper.accessor('client', {
            header: 'Cliente',
            size: 1,
            cell: info => (
                <span className="text-slate-600 truncate block" title={info.getValue()}>
                    {info.getValue()}
                </span>
            ),
        }),
        columnHelper.accessor('desc', {
            header: 'Detalle Trabajo',
            size: 1,
            cell: info => (
                <span className="text-slate-500 truncate block" title={info.getValue()}>
                    {info.getValue()}
                </span>
            ),
        }),
        columnHelper.display({
            id: 'bulto',
            header: 'Bulto #',
            size: 1,
            cell: ({ row }) => {
                const { num, total } = row.original;
                return (
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-bold border border-slate-200">
                        {num}/{total}
                    </span>
                );
            },
        }),
        columnHelper.accessor('code', {
            header: 'Código Etiqueta',
            size: 1,
            cell: info => <span className="font-mono text-xs text-slate-400">{info.getValue() || '-'}</span>,
        }),
        columnHelper.display({
            id: 'estado',
            header: () => <span className="block text-center">Estado</span>,
            size: 1,
            cell: ({ row }) => {
                const lbl = row.original;
                const status = (lbl.logStatus || lbl.status || '').toUpperCase();
                let cls = 'bg-zinc-100 text-zinc-500 border-zinc-200'; // default
                if (status === 'RETENIDO') cls = 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20';
                else if (status.includes('PENDIENTE')) cls = 'bg-amber-50 text-amber-600 border-amber-200';
                else if (status.includes('PRONTO') || status.includes('FINALIZADO') || status.includes('ENTREGADO')) cls = 'bg-emerald-50 text-emerald-600 border-emerald-200';
                else if (basketTipo === 'logistica') cls = 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20';
                else if (basketTipo === 'falla') cls = 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20';
                else if (basketTipo === 'incompleto') cls = 'bg-amber-50 text-amber-600 border-amber-200';
                return (
                    <div className="flex justify-center">
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-md border ${cls}`}>
                            {lbl.logStatus || lbl.status}
                        </span>
                    </div>
                );
            },
        }),
    ], [basketTipo, allSelected, someSelected, onSelectAll]);

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    if (!data.length) return (
        <div className="flex flex-col items-center justify-center h-64 text-slate-300">
            <i className="fa-solid fa-tags text-4xl mb-4 opacity-20"></i>
            <p className="text-sm font-bold">No hay etiquetas para mostrar en este canasto</p>
        </div>
    );

    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full table-fixed text-left border-collapse text-sm">
                <thead className="bg-zinc-50 sticky top-0 z-10 border-b border-zinc-200">
                    {table.getHeaderGroups().map(hg => (
                        <tr key={hg.id}>
                            {hg.headers.map(header => (
                                <th
                                    key={header.id}
                                    style={header.id === 'select' ? { width: '44px' } : undefined}
                                    className={`py-2.5 text-center text-[10px] font-black uppercase text-zinc-400 tracking-wider ${header.id === 'select' ? 'px-3' : 'px-4'}`}
                                >
                                    {flexRender(header.column.columnDef.header, header.getContext())}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody className="bg-white divide-y divide-zinc-100">
                    {table.getRowModel().rows.map(row => {
                        const lbl = row.original;
                        return (
                            <tr
                                key={row.id}
                                onClick={() => onToggle(lbl.orderId)}
                                className={`cursor-pointer transition-colors ${
                                    lbl.isSelected ? 'bg-brand-cyan/5' : 'hover:bg-zinc-50'
                                }`}
                            >
                                {row.getVisibleCells().map(cell => (
                                    <td
                                        key={cell.id}
                                        style={cell.column.id === 'select' ? { width: '44px' } : undefined}
                                        className={`py-2.5 text-center ${
                                            cell.column.id === 'select'
                                                ? `px-3 ${lbl.isSelected ? 'border-l-[3px] border-brand-cyan' : 'border-l-[3px] border-transparent'}`
                                                : 'px-4'
                                        }`}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default LogisticsView;
