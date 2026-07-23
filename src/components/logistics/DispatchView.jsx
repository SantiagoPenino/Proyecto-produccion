import React, { useState, useEffect, useMemo } from 'react';
import { logisticsService, authService } from '../../services/api';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import QRCode from "react-qr-code";
import { toast } from 'sonner';
import Swal from 'sweetalert2';

const DispatchView = ({ selectedOrders: initialOrders = [], areaFilter, originArea, onClose, onSuccess, mode: viewMode = 'create', onActionOverride, selectedStockItems: extSelectedStockItems, setSelectedStockItems: extSetSelectedStockItems }) => {
    const { user } = useAuth();
    const currentArea = areaFilter || originArea || user?.areaKey || user?.areaId;

    // Creation Steps: 0 = Select Stock, 1 = Quick Confirm/Sign, 2 = Success (Label)
    const [step, setStep] = useState(() => {
        if (initialOrders.length > 0) {
            const hasLogistica = initialOrders.some(o => o.destino === 'LOGISTICA' || !o.destino);
            return hasLogistica ? 1 : 2; // Saltar directo a la firma si no hay destinos ambiguos
        }
        return 0;
    });

    // History Selection (Only used if viewMode === 'history')
    const [selectedHistoryCode, setSelectedHistoryCode] = useState(null);
    const [historyDetail, setHistoryDetail] = useState(null);

    // History Search
    const [historySearchQuery, setHistorySearchQuery] = useState('');
    const [historySearchResults, setHistorySearchResults] = useState(null);

    // --- FETCH HISTORY ---
    const { data: outgoingRemitos, isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
        queryKey: ['remitos', 'outgoing', currentArea],
        queryFn: () => logisticsService.getOutgoingRemitos(currentArea),
        enabled: !!currentArea
    });

    // --- CREATION STATE ---
    // Selección: si el padre la controla (para que persista entre tabs) usamos esa; si no, estado interno.
    const [internalSelectedStockItems, setInternalSelectedStockItems] = useState([]); // Flat list of BultoIDs or Items
    const selectedStockItems = extSelectedStockItems ?? internalSelectedStockItems;
    const setSelectedStockItems = extSetSelectedStockItems ?? setInternalSelectedStockItems;
    const [stockSearch, setStockSearch] = useState('');
    const [destinoFilter, setDestinoFilter] = useState('TODOS'); // Filtro por área destino (ProximoServicio)
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

    // Al cargar el stock (p.ej. al volver a Logística), descartar de la selección los bultos que
    // ya no están en stock (despachados por otra vía), para que el contador no quede desfasado.
    useEffect(() => {
        if (!areaStock) return; // aún no cargó: no tocar la selección
        const stockIds = new Set(areaStock.map(item => item.BultoID));
        setSelectedStockItems(prev => {
            const filtered = prev.filter(s => stockIds.has(s.BultoID));
            return filtered.length === prev.length ? prev : filtered;
        });
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
            // Producto terminado: agrupar por PEDIDO + ÁREA (NoDocERP + ubicación) → al marcar uno se
            // seleccionan las órdenes hermanas de ESA área, para que el pedido salga completo del área.
            // Importante: NO agrupar solo por NoDocERP, porque un pedido tiene órdenes en varias áreas.
            else if (item.NoDocERP && item.Tipocontenido === 'PROD_TERMINADO') baseCode = `PED-${String(item.NoDocERP).trim()}-${String(item.UbicacionActual || item.AreaID || '').trim()}`;
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

        // Ordenar por pedido → orden → bulto, para que las hermanas queden agrupadas visualmente
        rows.sort((a, b) => {
            const pa = String(a.NoDocERP || ''), pb = String(b.NoDocERP || '');
            if (pa !== pb) return pa.localeCompare(pb, undefined, { numeric: true });
            const oa = String(a.orderCode || ''), ob = String(b.orderCode || '');
            if (oa !== ob) return oa.localeCompare(ob, undefined, { numeric: true });
            return (a.BultoID || 0) - (b.BultoID || 0);
        });

        let filtered = rows;

        // Filtro por área destino (ProximoServicio; sin destino = LOGISTICA)
        if (destinoFilter && destinoFilter !== 'TODOS') {
            filtered = filtered.filter(r => (r.nextService || 'LOGISTICA') === destinoFilter);
        }

        if (!stockSearch) return filtered;

        const lowerSearch = stockSearch.toLowerCase();
        return filtered.filter(r =>
            r.displayCode.toLowerCase().includes(lowerSearch) ||
            (r.client && r.client.toLowerCase().includes(lowerSearch)) ||
            (r.desc && r.desc.toLowerCase().includes(lowerSearch))
        );
    }, [areaStock, stockSearch, destinoFilter]);

    // Opciones del filtro: destinos distintos presentes en el stock actual
    const destinoOptions = useMemo(() => {
        if (!areaStock) return [];
        const set = new Set(areaStock.map(item => item.ProximoServicio || 'LOGISTICA'));
        return [...set].sort();
    }, [areaStock]);

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
    const toggleRow = async (row) => {
        // 1. Hermanos = mismo baseCode (para producto terminado, TODO el pedido / NoDocERP)
        const siblings = stockRows.filter(r => r.baseCode === row.baseCode);
        const siblingIds = siblings.map(r => r.BultoID);

        // 2. Si ya están todos seleccionados → deseleccionar el grupo (sin modal)
        const allSelected = siblingIds.every(id => selectedStockItems.some(s => s.BultoID === id));
        if (allSelected) {
            setSelectedStockItems(prev => prev.filter(s => !siblingIds.includes(s.BultoID)));
            return;
        }

        // 3. Va a seleccionar. Si es un pedido con varios bultos, avisar cuántas órdenes/bultos lleva.
        if (row.NoDocERP && siblings.length > 1) {
            const ordenes = new Set(siblings.map(s => s.OrdenID || s.CodigoOrden)).size;
            const bultos = siblings.length;
            const resp = await Swal.fire({
                icon: 'info',
                title: `Pedido ${row.NoDocERP}`,
                html: `En esta área, el pedido lleva <strong>${ordenes} ${ordenes === 1 ? 'orden' : 'órdenes'}</strong> con <strong>${bultos} ${bultos === 1 ? 'bulto' : 'bultos'}</strong>.<br><br>Se agregan <strong>todos</strong> al remito para que el pedido salga completo del área.`,
                showCancelButton: true,
                confirmButtonText: 'Agregar el pedido completo',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#0891b2',
                cancelButtonColor: '#6b7280',
                reverseButtons: true,
            });
            if (!resp.isConfirmed) return;
        }

        // 4. Seleccionar todo el grupo
        const newItems = siblings.filter(s => !selectedStockItems.some(existing => existing.BultoID === s.BultoID));
        setSelectedStockItems(prev => [...prev, ...newItems]);
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

    const handleSearchHistory = async (e) => {
        if (e) e.preventDefault();
        if (!historySearchQuery.trim()) {
            setHistorySearchResults(null);
            return;
        }
        console.log('[BUSQUEDA] Iniciando búsqueda:', historySearchQuery.trim());
        setLoading(true);
        try {
            const res = await api.get('/logistics/remitos/search', { params: { query: historySearchQuery.trim() } }).then(r => r.data);
            console.log('[BUSQUEDA] Resultado:', res);
            setHistorySearchResults(res);
            if (res.length === 1) {
                handleSelectHistory(res[0].CodigoRemito);
            }
        } catch (err) {
            console.error('[BUSQUEDA] Error completo:', err);
            console.error('[BUSQUEDA] Response data:', err?.response?.data);
            console.error('[BUSQUEDA] Status:', err?.response?.status);
            toast.error(`Error en la búsqueda: ${err?.response?.data?.error || err.message}`);
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
                    observations: `Generado por ${authUser.username || authUser.nombre || 'Sistema'}`
                };

                let res;
                if (onActionOverride) {
                    res = await onActionOverride(payload);
                } else {
                    res = await logisticsService.createDispatch(payload);
                }
                
                createdParams.push({ ...res, destArea: finalDest, itemCount: res.createdCount || bultosIds.length + newBultos.length });
            }

            setResults(createdParams);
            setStep(3);
            if (onSuccess) onSuccess();
            refetchStock();
            refetchHistory();
            setCredentials({ username: '', password: '' });
            setSelectedStockItems([]); // limpiar selección tras generar el remito (también la elevada al padre)

        } catch (error) {
            toast.error("Error: " + error.message);
            setLogs(prev => [...prev, `❌ Error: ${error.message}`]);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
        const printContent = document.getElementById('print-detail') || document.getElementById('printable-area');
        if (!printContent) {
            window.print();
            return;
        }
        const win = window.open('', '_blank', 'width=800,height=900');
        if (win) {
            win.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Imprimir Remito</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                    <style>
                        @page { margin: 10mm; }
                        body { background: white; color: black; font-family: sans-serif; }
                        #print-detail, #printable-area { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; }
                    </style>
                </head>
                <body>
                    <div style="padding: 20px;">
                        ${printContent.outerHTML}
                    </div>
                    <script>
                        setTimeout(() => { window.print(); window.close(); }, 800);
                    </script>
                </body>
                </html>
            `);
            win.document.close();
        } else {
            window.print();
        }
    };

    const handleDirectSubmit = () => {
        const destinations = Object.keys(dispatchGroups);
        if (destinations.length === 0) return;

        // Si tenemos órdenes con destino 'LOGISTICA', pasamos al Paso 1 para obligar a elegir destino.
        // Si ya están todas mapeadas (ej. DEPOSITO), saltamos la pantalla de Review directamente a Firmar (Paso 2).
        if (destinations.includes('LOGISTICA')) {
            setStep(1);
        } else {
            setStep(2);
        }
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
            <div className="flex flex-col w-full bg-slate-100 print:bg-white h-auto rounded-xl overflow-hidden shadow-sm">
                <style>{`
                    @media print {
                        body > *:not(#print-detail) { display: none !important; }
                        #print-detail {
                            position: fixed !important;
                            inset: 0;
                            z-index: 2147483647;
                            background: white;
                            overflow: visible;
                            padding: 20px;
                            display: block !important;
                            visibility: visible !important;
                        }
                        #print-detail * { visibility: visible !important; }
                    }
                `}</style>

                <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center print:hidden">
                    <div>
                        <h2 className="font-bold text-slate-800 flex items-center gap-2">
                            {historyDetail.CodigoRemito}
                        </h2>
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold">{historyDetail.Estado?.replace('_', ' ')}</span>
                    </div>
                    <button onClick={handlePrint} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold"><i className="fa-solid fa-print mr-2"></i> Imprimir</button>
                </div>

                <div id="print-detail" className="hidden print:flex p-8 flex-col items-center print:p-0">
                    <div className="w-full bg-white p-8 rounded-xl border-dashed border-2 border-slate-300 print:border-none print:shadow-none shadow-sm pb-10">
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

                        <div className="text-center text-xs text-slate-500 mb-6 font-bold">FECHA EMISIÓN: {res.date}</div>

                        {/* ONLY Print Total Count, not the full list */}
                        <div className="text-center border-t-2 border-slate-200 pt-6 mt-4 pb-2">
                            <h3 className="text-xs font-bold uppercase mb-2 text-slate-400">Cantidad Total</h3>
                            <div className="text-5xl font-black text-slate-900">{historyDetail.items?.length || 0}</div>
                            <div className="text-sm font-bold uppercase text-slate-500 mt-1">Bultos</div>
                        </div>
                    </div>
                </div>

                {/* Detailed Item List (Screen Only, NOT printed) */}
                {historyDetail.items && historyDetail.items.length > 0 && (
                    <div className="p-4 print:hidden w-full">
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex justify-between items-center">
                                <h3 className="font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                    <i className="fa-solid fa-boxes-stacked text-indigo-500"></i>
                                    Detalle de Órdenes y Bultos ({historyDetail.items.length})
                                </h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold border-b border-slate-200">
                                        <tr>
                                            <th className="px-4 py-3 whitespace-nowrap">Código Bulto</th>
                                            <th className="px-4 py-3 whitespace-nowrap">Nro. Orden</th>
                                            <th className="px-4 py-3">Cliente</th>
                                            <th className="px-4 py-3">Trabajo</th>
                                            <th className="px-4 py-3 whitespace-nowrap">Origen / Destino</th>
                                            <th className="px-4 py-3 text-right">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {historyDetail.items.map((item, idx) => {
                                            const q = historySearchQuery.trim().toLowerCase();
                                            const isMatch = q && (
                                                String(item.OrdenID || '').includes(q) ||
                                                String(item.CodigoOrden || '').toLowerCase().includes(q) ||
                                                String(item.NoDocERP || '').toLowerCase().includes(q) ||
                                                (item.CodigoEtiqueta || '').toLowerCase().includes(q) ||
                                                (item.Cliente || '').toLowerCase().includes(q)
                                            );
                                            return (
                                            <tr key={idx} className={`transition-colors ${isMatch ? 'bg-amber-50 border-l-4 border-amber-400' : 'hover:bg-slate-50'}`}>
                                                <td className="px-4 py-3 font-mono font-bold text-slate-700">
                                                    {isMatch && <i className="fa-solid fa-circle-dot text-amber-500 mr-2 text-xs"></i>}
                                                    {item.CodigoEtiqueta || item.displayCode || item.BultoID || 'N/A'}
                                                </td>
                                                <td className={`px-4 py-3 font-bold ${isMatch ? 'text-amber-700' : ''}`}>
                                                    <div>{item.CodigoOrden || item.NoDocERP || item.RetiroAsociado || '-'}</div>
                                                    <div className="text-[10px] text-slate-400 font-normal">ID: {item.OrdenID || item.RetiroID || '-'}</div>
                                                </td>
                                                <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">
                                                    <div>{item.Cliente || item.ClienteRetiro || item.ReceptorNombre || 'S/D'}</div>
                                                    {item.IDCliente && (
                                                        <div className="text-[10px] font-black text-brand-cyan uppercase tracking-wide mt-0.5">{item.IDCliente}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate" title={item.DescripcionTrabajo || item.Descripcion}>
                                                    {item.DescripcionTrabajo || item.Descripcion || '-'}
                                                </td>
                                                <td className="px-4 py-3 text-xs">
                                                    <div className="flex items-center gap-2 font-bold text-slate-600">
                                                        <span className="uppercase">{historyDetail.AreaOrigenID}</span>
                                                        <i className="fa-solid fa-arrow-right text-slate-400"></i>
                                                        <span className="uppercase text-slate-500">{historyDetail.AreaDestinoID}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${item.BultoEstado === 'EN_TRANSITO' ? 'bg-amber-100 text-amber-700' : item.BultoEstado === 'ENTREGADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                        {item.BultoEstado?.replace('_', ' ') || historyDetail.Estado?.replace('_', ' ')}
                                                    </span>
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
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
                                    className="w-full bg-slate-100 border-none rounded-xl pl-12 pr-4 py-3 text-sm font-bold focus:ring-2 focus:ring-cyan-200 outline-none transition-all placeholder:font-normal"
                                    placeholder="Escanear etiqueta o buscar cliente..."
                                    value={stockSearch}
                                    onChange={e => setStockSearch(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    autoFocus
                                />
                            </div>
                            <div className="relative">
                                <i className="fa-solid fa-arrow-right absolute left-4 top-3.5 text-slate-400 text-xs pointer-events-none"></i>
                                <select
                                    className="bg-slate-100 border-none rounded-xl pl-10 pr-8 py-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-cyan-200 outline-none transition-all cursor-pointer"
                                    value={destinoFilter}
                                    onChange={e => setDestinoFilter(e.target.value)}
                                    title="Filtrar por área destino"
                                >
                                    <option value="TODOS">Destino: Todos</option>
                                    {destinoOptions.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                            <button
                                disabled={selectedStockItems.length === 0}
                                onClick={handleDirectSubmit}
                                className="px-8 bg-brand-cyan text-white font-bold rounded-xl shadow-lg hover:brightness-110 disabled:opacity-50 disabled:shadow-none transition-all flex items-center gap-2"
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
                                                <div
                                                    onClick={() => {
                                                        const allSelected = stockRows.length > 0 && stockRows.every(r => selectedStockItems.some(s => s.BultoID === r.BultoID));
                                                        if (allSelected) {
                                                            setSelectedStockItems([]);
                                                        } else {
                                                            const newItems = stockRows.filter(r => !selectedStockItems.some(s => s.BultoID === r.BultoID));
                                                            setSelectedStockItems(prev => [...prev, ...newItems]);
                                                        }
                                                    }}
                                                    className="w-5 h-5 rounded border flex items-center justify-center transition-all cursor-pointer mx-auto"
                                                    style={{
                                                        background: stockRows.length > 0 && stockRows.every(r => selectedStockItems.some(s => s.BultoID === r.BultoID)) ? 'var(--brand-cyan, #0097b2)' : 'white',
                                                        borderColor: stockRows.length > 0 && stockRows.some(r => selectedStockItems.some(s => s.BultoID === r.BultoID)) ? 'var(--brand-cyan, #0097b2)' : '#cbd5e1',
                                                        color: 'white'
                                                    }}
                                                >
                                                    {stockRows.length > 0 && stockRows.every(r => selectedStockItems.some(s => s.BultoID === r.BultoID))
                                                        ? <i className="fa-solid fa-check text-xs"></i>
                                                        : stockRows.length > 0 && stockRows.some(r => selectedStockItems.some(s => s.BultoID === r.BultoID))
                                                            ? <i className="fa-solid fa-minus text-xs" style={{color:'#0097b2'}}></i>
                                                            : null
                                                    }
                                                </div>
                                            </th>
                                            <th className="p-4">Código</th>
                                            <th className="p-4">Orden</th>
                                            <th className="p-4">Cliente</th>
                                            <th className="p-4">Detalle / Referencias</th>
                                            <th className="p-4">Destino</th>
                                            <th className="p-4">Antigüedad</th>
                                            <th className="p-4 text-right">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-sm">
                                        {stockRows.map(row => {
                                            const isSelected = selectedStockItems.some(s => s.BultoID === row.BultoID);
                                            return (
                                                <tr
                                                    key={row.rowId}
                                                    onClick={() => toggleRow(row)}
                                                    className={`hover:bg-slate-50 transition-colors cursor-pointer group ${isSelected ? 'bg-brand-cyan/5' : ''}`}
                                                >
                                                    <td className="p-4 text-center">
                                                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-brand-cyan border-brand-cyan text-white' : 'bg-white border-slate-300 text-transparent group-hover:border-brand-cyan/50'}`}>
                                                            <i className="fa-solid fa-check text-xs"></i>
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-bold font-mono text-slate-800">{row.displayCode}</div>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className="font-bold text-brand-cyan">{row.orderCode || '-'}</span>
                                                    </td>
                                                    <td className="p-4">
                                                        {row.IDCliente ? (
                                                            <>
                                                                <div className="font-bold font-mono text-brand-cyan">{row.IDCliente}</div>
                                                                {row.client && row.client !== '-' && (
                                                                    <div className="text-[11px] text-slate-500 uppercase font-medium mt-0.5">{row.client}</div>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <div className="font-bold text-slate-600 uppercase">
                                                                {row.client && row.client !== '-' ? row.client : <span className="text-slate-400 italic font-normal">S/D</span>}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-bold text-slate-700">{row.desc}</div>
                                                    </td>
                                                    <td className="p-4">
                                                        {row.nextService && row.nextService !== 'LOGISTICA' ? (
                                                            <div className="px-2 py-1 bg-brand-cyan/10 text-brand-cyan rounded font-bold text-xs inline-flex items-center gap-1 border border-brand-cyan/20">
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
                                                        <span className="bg-brand-cyan/10 text-brand-cyan px-3 py-1 rounded-full text-[10px] font-bold uppercase border border-brand-cyan/20">
                                                            EN STOCK
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {stockRows.length === 0 && (
                                            <tr><td colSpan="7" className="p-10 text-center text-slate-400">No hay items en stock disponibles para despachar.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {step === 1 && (
                <div className="flex flex-col h-full">
                    <div className="flex flex-1 overflow-hidden">
                        {/* Panel izquierdo - Destinos */}
                        <div className="w-72 border-r border-slate-200 bg-white flex flex-col">
                            <div className="px-5 py-4 border-b border-slate-100">
                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total a Despachar</div>
                                <div className="text-5xl font-black text-slate-800 leading-none">{totalBultos}</div>
                                <div className="text-xs text-slate-500 font-bold mt-1 uppercase">Bultos</div>
                            </div>
                            <div className="px-5 py-4 flex-1 overflow-y-auto">
                                <div className="text-[10px] font-black text-brand-cyan uppercase tracking-widest mb-3">Destinos</div>
                                <div className="space-y-2">
                                    {Object.keys(dispatchGroups).map(key => (
                                        <div key={key} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs font-bold text-slate-600">Grupo: {key}</span>
                                                <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded">{dispatchGroups[key].length} Ordenes</span>
                                            </div>
                                            {key === 'LOGISTICA' && (
                                                <select
                                                    className="w-full text-sm p-2 border border-slate-200 rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-cyan-300 outline-none"
                                                    value={targetDestinations[key] || ''}
                                                    onChange={e => setTargetDestinations({ ...targetDestinations, [key]: e.target.value })}
                                                >
                                                    <option value="">Seleccionar Destino Real...</option>
                                                    {['CORTE', 'COSTURA', 'ESTAMPADO', 'BORDADO', 'TERMINACION', 'DEPOSITO'].map(a => <option key={a} value={a}>{a}</option>)}
                                                </select>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {/* Panel derecho - Review */}
                        <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
                            <div className="px-6 py-3 border-b border-slate-200 bg-white text-xs font-black text-slate-400 uppercase tracking-widest">Review Items</div>
                            <div className="flex-1 overflow-y-auto">
                                {selectedOrders.map((o, i) => (
                                    <div key={i} className="px-6 py-4 border-b border-slate-100 bg-white flex justify-between items-center hover:bg-slate-50 transition-colors">
                                        <div>
                                            <div className="font-bold text-slate-800 text-sm">{o.code}</div>
                                            <div className="text-xs text-slate-400 mt-0.5">{o.desc}</div>
                                        </div>
                                        <span className="text-xs font-bold bg-slate-100 text-slate-600 px-3 py-1 rounded border border-slate-200">{o.bultos.length} Bultos</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-end gap-3">
                        <button onClick={() => setStep(0)} className="px-6 py-2.5 border border-slate-200 rounded-lg font-bold text-slate-500 hover:bg-slate-50 text-sm transition-colors">Atrás</button>
                        <button onClick={handleCreateBatch} disabled={loading} className="px-8 py-2.5 bg-brand-cyan text-white rounded-lg font-bold hover:brightness-110 shadow-md flex gap-2 items-center text-sm disabled:opacity-50 transition-all">
                            {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <><i className="fa-solid fa-truck-fast"></i> Confirmar Salida</>}
                        </button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="flex flex-col h-full bg-slate-50 items-center justify-center p-6">
                    <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                        <div className="p-8 pb-4 text-center">
                            <h2 className="text-2xl font-black text-slate-800">Confirmar Envío</h2>
                            <p className="text-sm text-slate-500 mt-2">Autorizar salida de {totalBultos} bultos</p>
                        </div>
                        <div className="px-8 pb-8 space-y-4">
                            {logs.length > 0 && <div className="p-3 bg-slate-900 text-emerald-400 text-xs rounded-lg font-mono text-center">{logs[logs.length - 1]}</div>}
                            <button onClick={handleCreateBatch} disabled={loading} className="w-full py-4 bg-brand-cyan text-white rounded-xl font-bold hover:brightness-110 transition-all shadow-md text-lg flex justify-center items-center gap-2">
                                {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <><i className="fa-solid fa-truck-fast"></i> Confirmar Salida</>}
                            </button>
                            <button onClick={() => setStep(step === 2 && initialOrders.length > 0 ? 1 : 1)} disabled={loading} className="w-full py-3 bg-slate-100 text-slate-500 rounded-xl font-bold hover:bg-slate-200 transition-colors">
                                Volver
                            </button>
                        </div>
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
                                position: fixed;
                                left: 0;
                                top: 0;
                                width: 100mm;
                                margin: 0;
                                padding: 0;
                                background: white;
                            }
                            @page {
                                size: 100mm 150mm;
                                margin: 2mm;
                            }
                        }
                    `}</style>

                    <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center print:hidden">
                        <h2 className="font-bold text-slate-800 flex items-center gap-2"><i className="fa-solid fa-check-circle text-emerald-500"></i> Remitos Generados</h2>
                        <button onClick={handlePrint} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 transition-colors"><i className="fa-solid fa-print mr-2"></i> Imprimir</button>
                    </div>

                    <div id="printable-area" className="p-4 flex flex-col items-center gap-4 print:p-0 print:block">
                        {results.map((res, i) => (
                            <div key={i} className="w-full max-w-xs bg-white p-4 rounded-xl border-dashed border-2 border-slate-300 print:border-2 print:border-black print:w-full print:shadow-none shadow-sm relative mx-auto my-2 break-after-page print:m-0">
                                <div className="text-center mb-3 border-b-2 border-black pb-2">
                                    <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Remito</h1>
                                    <div className="flex justify-between mt-2 font-bold text-xs">
                                        <span>ORIGEN: {currentArea || user?.areaKey}</span>
                                        <span>DESTINO: {res.destArea}</span>
                                    </div>
                                </div>
                                <div className="flex justify-center mb-3">
                                    <QRCode value={res.dispatchCode} size={90} />
                                </div>
                                <div className="text-center font-mono text-base font-black mb-3 text-slate-900">{res.dispatchCode}</div>

                                <div className="text-center text-[9px] text-slate-500 mb-3">Emisión: {new Date().toLocaleString('es-AR')}</div>

                                <div className="text-center border-t-2 border-slate-200 pt-3 mt-2">
                                    <h3 className="text-[9px] font-bold uppercase mb-1 text-slate-400">Cantidad Total</h3>
                                    <div className="text-4xl font-black text-slate-900">{res.itemCount}</div>
                                    <div className="text-xs font-bold uppercase text-slate-500 mt-1">Bultos</div>
                                </div>

                                <div className="mt-3 text-center text-[9px] text-slate-400">
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
            <div className="flex bg-slate-100 font-sans" style={{height: 'calc(100vh - 130px)'}}>
                {/* LIST SIDEBAR */}
                <div className="w-80 min-w-[300px] max-w-sm bg-white border-r border-slate-200 flex flex-col overflow-hidden print:hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <h2 className="font-bold text-slate-800 text-lg">Historial de Envíos</h2>
                            <button onClick={() => { refetchHistory(); setHistorySearchResults(null); setHistorySearchQuery(''); }} className="text-slate-400 hover:text-indigo-600"><i className="fa-solid fa-sync"></i></button>
                        </div>
                        <form onSubmit={handleSearchHistory} className="relative w-full">
                            <i className="fa-solid fa-search absolute left-3 top-3 text-slate-400 text-sm"></i>
                            <input
                                type="text"
                                value={historySearchQuery}
                                onChange={e => {
                                    setHistorySearchQuery(e.target.value);
                                    if (!e.target.value) setHistorySearchResults(null);
                                }}
                                placeholder="Ej: PRO-1332, REM-045, bulto..."
                                className="w-full pl-9 pr-20 py-2 border border-slate-200 rounded-lg text-sm focus:border-indigo-500 outline-none shadow-inner"
                            />
                            <div className="absolute right-2 top-1.5 flex items-center gap-1">
                                {historySearchQuery && (
                                    <button type="button" onClick={() => { setHistorySearchQuery(''); setHistorySearchResults(null); }} className="text-slate-400 hover:text-red-500 px-1">
                                        <i className="fa-solid fa-xmark text-xs"></i>
                                    </button>
                                )}
                                <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-2 py-1 rounded-md transition-colors">
                                    Buscar
                                </button>
                            </div>
                        </form>
                        <p className="text-[10px] text-slate-400 -mt-1">Buscá una orden para saber en qué remito se fue</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {loadingHistory && !historySearchResults && <div className="p-4 text-center text-slate-400"><i className="fa-solid fa-circle-notch fa-spin"></i></div>}
                        
                        {historySearchResults && (
                            <div className="mb-3">
                                <div className="flex items-center gap-2 border-b border-slate-200 pb-2 mb-2">
                                    <i className="fa-solid fa-magnifying-glass text-indigo-400 text-xs"></i>
                                    <h3 className="text-xs font-bold uppercase text-slate-500">
                                        {historySearchResults.length === 0
                                            ? 'Sin resultados'
                                            : `${historySearchResults.length} remito${historySearchResults.length > 1 ? 's' : ''} encontrado${historySearchResults.length > 1 ? 's' : ''}`}
                                    </h3>
                                </div>
                                {historySearchResults.length === 0 && (
                                    <div className="text-sm text-slate-400 text-center py-4">
                                        <i className="fa-solid fa-inbox text-2xl mb-2 block opacity-30"></i>
                                        La orden no aparece en ningún remito registrado
                                    </div>
                                )}
                            </div>
                        )}

                        {(!historySearchResults ? outgoingRemitos : historySearchResults)?.map(rem => (
                            <div
                                key={rem.EnvioID || rem.CodigoRemito}
                                onClick={() => handleSelectHistory(rem.CodigoRemito)}
                                className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md ${selectedHistoryCode === rem.CodigoRemito ? 'bg-brand-cyan/5 border-brand-cyan ring-1 ring-brand-cyan/30' : 'bg-white border-slate-100 hover:border-slate-300'}`}
                            >
                                {/* Orden encontrada (solo en resultados de búsqueda) */}
                                {historySearchResults && rem.OrdenEncontrada && (
                                    <div className="flex items-center gap-1.5 mb-2 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1">
                                        <i className="fa-solid fa-box text-indigo-400 text-xs"></i>
                                        <span className="text-xs font-bold text-indigo-700 font-mono">{rem.OrdenEncontrada}</span>
                                        <span className="text-[10px] text-indigo-400 ml-auto">en este remito</span>
                                    </div>
                                )}
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-bold text-slate-800 font-mono text-lg">{rem.CodigoRemito}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${rem.Estado === 'RECIBIDO_TOTAL' || rem.Estado === 'ENTREGADO' ? 'bg-green-100 text-green-700' : rem.Estado?.startsWith('EN_') ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                        {rem.Estado?.replace(/_/g, ' ')}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                                    {rem.AreaOrigenID && <span className="font-semibold text-slate-600">{rem.AreaOrigenID}</span>}
                                    <i className="fa-solid fa-arrow-right-long text-slate-300"></i>
                                    <span className="font-bold text-slate-700">{rem.AreaDestinoID || 'S/D'}</span>
                                </div>
                                <div className="flex justify-between items-end border-t border-slate-50 pt-2 mt-2">
                                    <div className="text-[10px] text-slate-400">{rem.FechaSalida ? new Date(rem.FechaSalida).toLocaleString() : '—'}</div>
                                    <div className="text-[10px] font-bold text-slate-500">{rem.TotalItems ?? rem.items?.length ?? 0} bultos</div>
                                </div>
                            </div>
                        ))}
                        
                        {!historySearchResults && outgoingRemitos?.length === 0 && <div className="p-4 text-center text-slate-400 text-sm">No hay envíos registrados.</div>}
                    </div>
                </div>

                {/* DETAIL VIEW */}
                <div className="flex-1 flex flex-col overflow-hidden relative bg-slate-50">
                    {selectedHistoryCode ? (
                        <div className="flex-1 overflow-y-auto">{renderHistoryDetail()}</div>
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
