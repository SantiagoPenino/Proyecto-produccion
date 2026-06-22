import React, { useState, useEffect, useMemo } from 'react';
import { ordersService, areasService } from '../../services/api';
// import OrderTrackingModal from '../common/OrderTrackingModal'; // DEPRECATED
import OrderDetailModal from '../production/components/OrderDetailModal'; // NEW MODAL
import IntegralOrderView from './IntegralOrderView';

const OrderCard = ({ order, onClick }) => {
    return (
        <div 
            onClick={onClick}
            className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer flex flex-col h-full"
        >
            {/* ORDER TOP SECTION */}
            <div className="p-4 flex justify-between items-start border-b border-gray-100 bg-slate-50/50 rounded-t-xl">
                <div>
                    <div className="text-[10px] text-gray-400 font-bold mb-0.5 tracking-wider">CÓDIGO</div>
                    <div className="text-xl font-black text-slate-800">{order.code}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold tracking-wide shadow-sm ${order.status === 'FALLA' ? 'bg-red-100 text-red-700 border border-red-200' : order.status === 'PENDIENTE' ? 'bg-orange-100 text-orange-700 border border-orange-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
                        ESTADO: {order.status}
                    </span>
                    {order.estadoArea && (
                        <span className="bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm">
                            ESTADO EN ÁREA: {order.estadoArea}
                        </span>
                    )}
                    <span className="bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm">
                        ÁREA: {order.area}
                    </span>
                </div>
            </div>

            {/* CLIENT SECTION */}
            <div className="p-4 flex-1">
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shrink-0">
                            <i className="fa-solid fa-user"></i>
                        </div>
                        <div className="min-w-0">
                            <div className="font-bold text-slate-800 leading-tight truncate">{order.nombreFantasia || order.client}</div>
                            {order.idCliente && <div className="text-[10px] font-mono text-gray-400 mt-0.5 truncate">IDCLIENTE: {order.idCliente}</div>}
                        </div>
                    </div>
                    {/* Badge */}
                    <div className="flex flex-col gap-1 items-end shrink-0 ml-2">
                        {order.idCliente && (
                            <span className="px-2 py-0.5 bg-green-50 text-green-600 border border-green-200 rounded-full text-[9px] font-bold flex items-center gap-1">
                                VERIFICADO <i className="fa-solid fa-circle-check"></i>
                            </span>
                        )}
                        <span className="px-2 py-0.5 bg-gray-50 text-gray-500 border border-gray-200 rounded-full text-[9px] font-bold">
                            COMÚN
                        </span>
                    </div>
                </div>

                <div className="space-y-1.5 text-xs text-gray-600 mt-4 border-t border-gray-50 pt-3">
                    {order.email && <div><span className="text-gray-400 w-16 inline-block">Email:</span> <span className="font-medium truncate">{order.email}</span></div>}
                    {order.telefono && <div><span className="text-gray-400 w-16 inline-block">Teléfono:</span> <span className="font-medium">{order.telefono}</span></div>}
                    {order.direccion && <div><span className="text-gray-400 w-16 inline-block">Dirección:</span> <span className="font-medium truncate block">{order.direccion}</span></div>}
                    {!order.email && !order.telefono && !order.direccion && (
                        <div className="text-gray-400 italic text-[11px]">Sin datos de contacto adicionales</div>
                    )}
                </div>
            </div>
            
            <div className="px-4 py-2 bg-slate-50 border-t border-gray-100 rounded-b-xl flex justify-between items-center text-[11px] text-gray-500 font-medium">
                <div><i className="fa-regular fa-calendar mr-1"></i> {order.entryDate ? new Date(order.entryDate).toLocaleDateString() : '-'}</div>
                <div><i className="fa-solid fa-boxes-packing mr-1"></i> Prox: {order.nextService || '-'}</div>
            </div>
        </div>
    );
};

const OrdersQueryView = () => {
    const getTodayStr = () => {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    const [viewMode, setViewMode] = useState('grid');
    const [filters, setFilters] = useState({
        fechaDesde: getTodayStr(),
        fechaHasta: getTodayStr(),
        areas: [],
        mode: 'all',
        search: ''
    });
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [areasDisponibles, setAreasDisponibles] = useState([]);
    const [configEstados, setConfigEstados] = useState([]);
    const [selectedOrder, setSelectedOrder] = useState(null);

    useEffect(() => {
        areasService.getAll({ productive: true }).then(res => setAreasDisponibles(res)).catch(e => console.error(e));
        ordersService.getEstados().then(data => {
            if (data && data.length > 0) setConfigEstados(data);
        }).catch(err => console.error("Error loading estados:", err));
    }, []);

    const visibleStates = useMemo(() => {
        if (!configEstados || configEstados.length === 0) return ['PENDIENTE', 'EN PROCESO', 'FINALIZADO', 'ENTREGADO', 'CANCELADO', 'FALLA'];
        let validStates = configEstados.filter(s => s.TipoEstado === 'ESTADO');
        if (filters.areas && filters.areas.length > 0) {
            validStates = validStates.filter(s => 
                s.AreaID === 'ADMIN' || 
                filters.areas.some(area => s.AreaID === area || (s.AreaID && s.AreaID.split(',').includes(area)))
            );
        }
        return [...new Set(validStates.map(s => s.Nombre))].sort((a, b) => a.localeCompare(b));
    }, [configEstados, filters.areas]);

    const handleSearch = async () => {
        setLoading(true);
        try {
            const payload = {
                filters: {
                    search: filters.search,
                    status: filters.mode === 'all' ? null : filters.mode.toUpperCase(),
                    area: filters.areas.length > 0 ? filters.areas : null,
                    dateFrom: filters.fechaDesde,
                    dateTo: filters.fechaHasta
                }
            };
            const data = await ordersService.advancedSearch(payload);
            setResults(data || []);
        } catch (error) {
            console.error("Error buscando:", error);
            alert("Error al buscar: " + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    const toggleArea = (areaId) => {
        setFilters(prev => {
            const exists = prev.areas.includes(areaId);
            return {
                ...prev,
                areas: exists ? prev.areas.filter(a => a !== areaId) : [...prev.areas, areaId]
            };
        });
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            {/* TOOLBAR */}
            <div className="bg-white border-b border-gray-200 p-4 shadow-sm z-10">
                <h1 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-magnifying-glass-chart text-blue-600"></i> Consulta Histórica de Órdenes
                </h1>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                    <div className="md:col-span-3 grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-xs font-bold text-gray-500 block mb-1">Desde</label>
                            <input type="date" className="w-full text-sm border-gray-300 rounded-lg"
                                value={filters.fechaDesde} onChange={e => setFilters({ ...filters, fechaDesde: e.target.value })} />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 block mb-1">Hasta</label>
                            <input type="date" className="w-full text-sm border-gray-300 rounded-lg"
                                value={filters.fechaHasta} onChange={e => setFilters({ ...filters, fechaHasta: e.target.value })} />
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <label className="text-xs font-bold text-gray-500 block mb-1">Estado</label>
                        <select className="w-full text-sm border-gray-300 rounded-lg bg-white"
                            value={filters.mode} onChange={e => setFilters({ ...filters, mode: e.target.value })}>
                            <option value="all">Todos</option>
                            {visibleStates.map(st => (
                                <option key={st} value={st}>{st}</option>
                            ))}
                        </select>
                    </div>

                    <div className="md:col-span-3">
                        <label className="text-xs font-bold text-gray-500 block mb-1">Búsqueda</label>
                        <div className="relative">
                            <i className="fa-solid fa-search absolute left-3 top-2.5 text-gray-400"></i>
                            <input type="text" className="w-full pl-9 text-sm border-gray-300 rounded-lg" placeholder="Cliente, Código..."
                                value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
                        </div>
                    </div>

                    <div className="md:col-span-4 flex gap-2 justify-end pb-0.5 items-center">
                        <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                            <button 
                                onClick={() => setViewMode('list')}
                                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors flex items-center gap-1 ${viewMode === 'list' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                <i className="fa-solid fa-list"></i> Lista
                            </button>
                            <button 
                                onClick={() => setViewMode('cards')}
                                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors flex items-center gap-1 ${viewMode === 'cards' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                <i className="fa-solid fa-grip"></i> Tarjetas
                            </button>
                        </div>
                        <button onClick={handleSearch} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow flex items-center gap-2 text-xs h-[38px] ml-2">
                            {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-magnifying-glass"></i>} Buscar
                        </button>
                    </div>

                    <div className="md:col-span-12 mt-4 border-t pt-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-gray-500">Filtrar por Áreas</label>
                            <button onClick={() => setFilters({ ...filters, areas: [] })} className="text-[10px] text-blue-600 hover:underline">Limpiar Selección</button>
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-[80px] overflow-y-auto border border-gray-200 rounded-lg p-2 bg-slate-50">
                            {areasDisponibles.map((a, idx) => {
                                const areaId = a.code || a.AreaID;
                                const isSelected = filters.areas.includes(areaId);
                                return (
                                    <button key={areaId || idx} onClick={() => toggleArea(areaId)}
                                        className={`text-xs px-3 py-1 rounded-full border transition-all ${isSelected ? 'bg-blue-600 border-blue-600 text-white font-bold' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
                                        {a.name || a.Nombre}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                {viewMode === 'list' ? (
                    <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden relative">
                        <table className="w-full text-sm text-left border-collapse">
                            <thead className="bg-slate-100 text-slate-500 text-xs uppercase font-bold sticky top-0 z-20 shadow-sm">
                                <tr>
                                    <th className="px-4 py-3">Código</th>
                                    <th className="px-4 py-3">Cliente</th>
                                    <th className="px-4 py-3">Área</th>
                                    <th className="px-4 py-3">Ingreso</th>
                                    <th className="px-4 py-3">Estado</th>
                                    <th className="px-4 py-3">Prox. Servicio</th>
                                    <th className="px-4 py-3">Archivos</th>
                                    <th className="px-4 py-3 text-right">Ver</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {results.length === 0 && !loading && (
                                    <tr><td colSpan="8" className="text-center py-10 text-gray-400">Sin resultados.</td></tr>
                                )}
                                {results.map(order => (
                                    <tr key={order.id} className="hover:bg-blue-50/50 transition-colors">
                                        <td className="px-4 py-3 font-bold text-slate-700">{order.code}</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            <div className="font-semibold">{order.nombreFantasia || order.client}</div>
                                            {order.idCliente && <div className="text-[10px] text-blue-600 font-mono mt-0.5">{order.idCliente}</div>}
                                            <div className="text-xs text-slate-400 truncate max-w-[200px] mt-0.5">{order.desc}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold border border-gray-200">{order.area}</span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-500">{order.entryDate ? new Date(order.entryDate).toLocaleDateString() : '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col gap-1 items-start">
                                                <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold shadow-sm ${order.status === 'FALLA' ? 'bg-red-100 text-red-700 border border-red-200' : order.status === 'PENDIENTE' ? 'bg-orange-100 text-orange-700 border border-orange-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
                                                    ESTADO: {order.status}
                                                </span>
                                                {order.estadoArea && (
                                                    <span className="bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm">
                                                        ESTADO EN ÁREA: {order.estadoArea}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{order.nextService || '-'}</td>
                                        <td className="px-4 py-3 text-slate-400 text-xs">{order.filesCount} arch.</td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => setSelectedOrder(order)} className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors">
                                                <i className="fa-solid fa-eye"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {results.length === 0 && !loading && (
                            <div className="col-span-full text-center py-10 text-gray-400">Sin resultados.</div>
                        )}
                        {results.map(order => (
                            <OrderCard key={order.id} order={order} onClick={() => setSelectedOrder(order)} />
                        ))}
                    </div>
                )}
            </div>

            {selectedOrder && (
                <OrderDetailModal
                    order={selectedOrder}
                    readOnly={true}
                    onClose={() => setSelectedOrder(null)}
                />
            )}
        </div>
    );
};

export default OrdersQueryView;
