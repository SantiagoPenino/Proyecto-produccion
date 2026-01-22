import React, { useState, useEffect } from 'react';
import { ordersService, areasService } from '../../services/api';
import OrderTrackingModal from '../common/OrderTrackingModal';

// OrderDetailsModal has been replaced by OrderTrackingModal in common components
// See import at the top of the file.

import IntegralOrderView from './IntegralOrderView';

const OrdersQueryView = () => {
    const [viewMode, setViewMode] = useState('list'); // 'list' | 'integral'
    const [filters, setFilters] = useState({
        fechaDesde: '',
        fechaHasta: '',
        areas: [],
        mode: 'all',
        search: ''
    });
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [areasDisponibles, setAreasDisponibles] = useState([]);
    const [selectedOrder, setSelectedOrder] = useState(null);

    useEffect(() => {
        areasService.getAll().then(res => setAreasDisponibles(res)).catch(e => console.error(e));
    }, []);

    const handleSearch = async () => {
        setLoading(true);
        try {
            // Transformar filtros de UI al formato del Backend
            const payload = {
                filters: {
                    client: filters.search, // Usamos el campo search para cliente o código (el backend busca ambos si se implementara asi, pero aqui lo mandamos a client/code)
                    code: filters.search,
                    status: filters.mode === 'all' ? null : filters.mode.toUpperCase(), // backend espera mayusculas o null
                    area: filters.areas.length > 0 ? filters.areas[0] : null, // Por ahora el backend soporta 1 area, mandamos la primera o null
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
            {/* TABS SELECTOR */}
            <div className="bg-white px-6 pt-4 border-b border-gray-200 flex gap-6 z-20 shadow-sm shrink-0">
                <button onClick={() => setViewMode('list')} className={`pb-3 text-sm font-bold border-b-2 transition-all ${viewMode === 'list' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                    <i className="fa-solid fa-list-ul mr-2"></i> Listado de Órdenes
                </button>
                <button onClick={() => setViewMode('integral')} className={`pb-3 text-sm font-bold border-b-2 transition-all ${viewMode === 'integral' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                    <i className="fa-solid fa-diagram-project mr-2"></i> Búsqueda Integral (Pedido)
                </button>
            </div>

            {viewMode === 'integral' ? <IntegralOrderView /> : (
                <>
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
                                    <option value="PENDIENTE">Pendientes</option>
                                    <option value="FINALIZADO">Finalizados</option>
                                    <option value="CANCELADO">Cancelados</option>
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

                            <div className="md:col-span-4 flex gap-2 justify-end pb-0.5">
                                <button onClick={handleSearch} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow flex items-center gap-2 text-xs h-[38px]">
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

                    {/* TABLA DE RESULTADOS */}
                    <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                        <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden relative">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead className="bg-slate-100 text-slate-500 text-xs uppercase font-bold sticky top-0 z-20 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-3">Código</th>
                                        <th className="px-4 py-3">Cliente</th>
                                        <th className="px-4 py-3">Área</th>
                                        <th className="px-4 py-3">Ingreso</th>
                                        <th className="px-4 py-3">Estado</th>
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
                                                <div className="font-semibold">{order.client}</div>
                                                <div className="text-xs text-slate-400 truncate max-w-[200px]">{order.desc}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold border border-gray-200">{order.area}</span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-500">{order.entryDate ? new Date(order.entryDate).toLocaleDateString() : '-'}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${order.status === 'FALLA' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                                    {order.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-xs text-slate-500 font-medium">
                                                    {order.filesCount || 0}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => setSelectedOrder(order.id)}
                                                    className="w-8 h-8 inline-flex items-center justify-center bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-full transition-all"
                                                >
                                                    <i className="fa-solid fa-eye text-sm"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* MODAL */}
                    {selectedOrder && (
                        <OrderTrackingModal orderId={selectedOrder} onClose={() => setSelectedOrder(null)} />
                    )}
                </>
            )}
        </div>
    );
};

export default OrdersQueryView;