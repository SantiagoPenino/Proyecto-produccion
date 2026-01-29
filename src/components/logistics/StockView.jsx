import React, { useState, useEffect } from 'react';
import { logisticsService } from '../../services/modules/logisticsService';
import { toast } from 'sonner';
import OrderRequirementsList from './OrderRequirementsList';

const StockView = ({ areaFilter }) => {
    const [stock, setStock] = useState([]);
    const [loading, setLoading] = useState(false);

    // If Global Filter exists, use it. Otherwise default to TODOS.
    const [localArea, setLocalArea] = useState('TODOS');

    // Effective Area: Global takes precedence over Local
    const effectiveArea = (areaFilter && areaFilter !== 'TODOS') ? areaFilter : localArea;

    const [expandedBultoId, setExpandedBultoId] = useState(null);

    // Mapped Areas (Ideally fetched from backend, but hardcoded for now or use areasService)
    const areas = ['TODOS', 'RECEPCION', 'COSTURA', 'CORTE', 'BORDADO', 'ESTAMPADO', 'TERMINACION', 'DEPOSITO'];

    useEffect(() => {
        loadStock();
    }, [effectiveArea]); // Listen to effectiveArea changes

    const loadStock = async () => {
        setLoading(true);
        try {
            const data = await logisticsService.getAreaStock(effectiveArea);
            setStock(data);
        } catch (error) {
            console.error(error);
            toast.error("Error cargando inventario");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50 p-6 space-y-6">
            {/* Header / Filter */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <i className="fa-solid fa-boxes-stacked text-indigo-600"></i>
                        Inventario de Bultos
                    </h2>
                    <p className="text-xs text-gray-500">
                        {effectiveArea !== 'TODOS' ? `Stock en ${effectiveArea}` : 'Stock Global'}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Only show local filter if NO Global Filter is active */}
                    {(!areaFilter || areaFilter === 'TODOS') && (
                        <>
                            <span className="text-sm font-bold text-gray-400 uppercase">Filtrar:</span>
                            <select
                                className="p-2 border rounded-lg font-bold text-gray-700 focus:ring-2 focus:ring-indigo-100 outline-none"
                                value={localArea}
                                onChange={e => setLocalArea(e.target.value)}
                            >
                                {areas.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                        </>
                    )}

                    {/* Refresh Button always visible */}
                    <button
                        onClick={loadStock}
                        className="p-2 ml-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors"
                        title="Actualizar"
                    >
                        <i className={`fa-solid fa-rotate ${loading ? 'fa-spin' : ''}`}></i>
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                {stock.length === 0 && !loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                        <i className="fa-solid fa-box-open text-6xl mb-4"></i>
                        <p className="text-lg font-medium">No hay bultos en esta ubicación</p>
                    </div>
                ) : (
                    <div className="overflow-y-auto p-2">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50 sticky top-0 z-10 text-xs font-bold text-gray-400 uppercase tracking-wider">
                                <tr>
                                    <th className="p-3 border-b">Código</th>
                                    <th className="p-3 border-b">Ubicación</th>
                                    <th className="p-3 border-b">Contenido / Descripción</th>
                                    <th className="p-3 border-b text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 text-sm">
                                {stock.map((item) => (
                                    <React.Fragment key={item.BultoID}>
                                        <tr className="hover:bg-indigo-50/50 transition-colors">
                                            <td className="p-3 font-mono font-bold text-indigo-700">
                                                <div className="flex items-center gap-2">
                                                    {item.OrdenID && (
                                                        <button
                                                            onClick={() => setExpandedBultoId(expandedBultoId === item.BultoID ? null : item.BultoID)}
                                                            className="text-gray-400 hover:text-indigo-600 focus:outline-none"
                                                        >
                                                            <i className={`fa-solid fa-chevron-${expandedBultoId === item.BultoID ? 'down' : 'right'}`}></i>
                                                        </button>
                                                    )}
                                                    <i className="fa-solid fa-box text-indigo-300"></i>
                                                    {item.CodigoEtiqueta}
                                                </div>
                                            </td>
                                            <td className="p-3">
                                                <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold border border-gray-200">
                                                    {item.UbicacionActual}
                                                </span>
                                            </td>
                                            <td className="p-3 text-gray-600">
                                                {item.Descripcion || '-'}
                                                {item.OrdenID && <span className="ml-2 text-xs bg-indigo-100 text-indigo-600 px-1 rounded">Ord: {item.OrdenID}</span>}
                                            </td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border ${item.Estado === 'EN_STOCK' ? 'bg-green-100 text-green-700 border-green-200' :
                                                    item.Estado === 'EN_TRANSITO' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                                        'bg-gray-100 text-gray-500'
                                                    }`}>
                                                    {item.Estado.replace('_', ' ')}
                                                </span>
                                            </td>
                                        </tr>
                                        {expandedBultoId === item.BultoID && item.OrdenID && (
                                            <tr className="bg-gray-50/50">
                                                <td colSpan="4" className="p-3 pl-10 border-b border-indigo-100">
                                                    <OrderRequirementsList
                                                        ordenId={item.OrdenID}
                                                        areaId={item.UbicacionActual}
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Footer Metrics */}
            <div className="bg-white p-3 rounded-xl border border-gray-200 flex justify-between items-center text-xs font-bold text-gray-500">
                <div>Total Bultos: <span className="text-indigo-600 text-base ml-1">{stock.length}</span></div>
                <div>Ultima Actualización: {new Date().toLocaleTimeString()}</div>
            </div>
        </div>
    );
};

export default StockView;
