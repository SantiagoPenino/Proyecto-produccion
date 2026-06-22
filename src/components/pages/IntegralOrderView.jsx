import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ordersService } from '../../services/modules/ordersService';
import OrderRouteTracker from '../orders/OrderRouteTracker';
import OrderDetailModal from '../production/components/OrderDetailModal'; // Importar Modal

const IntegralOrderView = () => {
    const [searchParams] = useSearchParams();
    const [searchRef, setSearchRef] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedOrder, setSelectedOrder] = useState(null); // Estado para Modal

    // Auto-search if ?ref= is in the URL
    useEffect(() => {
        const ref = searchParams.get('ref');
        if (ref) {
            setSearchRef(ref);
            doSearch(ref);
        }
    }, []);

    const doSearch = async (ref) => {
        if (!ref?.trim()) return;
        setLoading(true);
        setError(null);
        setData(null);
        try {
            const res = await ordersService.getIntegralDetails(ref);
            setData(res);
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || "Error buscando el pedido");
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async (e) => {
        e?.preventDefault();
        doSearch(searchRef);
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 p-4 gap-4 overflow-y-auto">
            {/* BUSCADOR CENTRADO */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center gap-4">
                <h2 className="text-xl font-bold text-slate-700">
                    <i className="fa-solid fa-boxes-packing mr-2 text-blue-600"></i>
                    Búsqueda Integral de Pedido
                </h2>
                <form onSubmit={handleSearch} className="flex gap-2 w-full max-w-md">
                    <input
                        type="text"
                        value={searchRef}
                        onChange={(e) => setSearchRef(e.target.value)}
                        placeholder="Ej: 37, 1055 (1/2)..."
                        className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <button type="submit" disabled={loading} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors disabled:opacity-50">
                        {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Buscar'}
                    </button>
                </form>
                {error && <div className="text-red-500 text-sm font-medium bg-red-50 px-4 py-2 rounded-lg border border-red-100">{error}</div>}
            </div>

            {data && (
                <div className="flex flex-col gap-6 animate-fade-in-up">

                    {/* 1. HEADER & PROGRESO */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-start">
                            <div>
                                <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Pedido Ref: {data.header.pedidoRef}</div>
                                <h1 className="text-2xl font-black text-slate-800">{data.header.cliente}</h1>
                                <p className="text-slate-500 mt-1">{data.header.descripcion}</p>
                            </div>
                            <div className="text-right">
                                <div className="text-3xl font-black text-slate-800">{data.header.avance}%</div>
                                <div className={`text-xs font-bold px-2 py-1 rounded-full inline-block mt-1 ${data.header.estadoGlobal === 'COMPLETADO' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {data.header.estadoGlobal}
                                </div>
                            </div>
                        </div>

                        {/* LINEA DE TIEMPO / BARRA DE PROGRESO VISUAL */}
                        <div className="w-full h-2 bg-slate-100 relative">
                            <div className="h-full bg-blue-600 transition-all duration-1000" style={{ width: `${data.header.avance}%` }}></div>
                        </div>
                    </div>

                    {/* 2. HOJA DE RUTA (FLUJO DE ÁREAS) - REUTILIZABLE */}
                    <OrderRouteTracker steps={data.ruta} />

                    {/* 3. LOGISTICA Y BULTOS */}
                    {data.logistica.bultos.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <h3 className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2">
                                    <i className="fa-solid fa-dolly text-orange-500"></i> Logística (Bultos)
                                </h3>
                                <div className="space-y-3 max-h-60 overflow-y-auto">
                                    {data.logistica.bultos.map(b => (
                                        <div key={b.BultoID} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                                            <div>
                                                <div className="font-bold text-slate-700 text-sm">{b.CodigoEtiqueta}</div>
                                                <div className="text-xs text-slate-500">{b.Descripcion} ({b.Tipo})</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded">
                                                    <i className="fa-solid fa-location-dot mr-1"></i> {b.Ubicacion}
                                                </div>
                                                {b.CodigoRemito && (
                                                    <div className="text-[10px] mt-1 font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded">
                                                        <i className="fa-solid fa-file-invoice mr-1"></i> Remito: {b.CodigoRemito}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* INCIDENCIAS */}
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <h3 className="text-sm font-bold text-slate-400 uppercase mb-4 flex items-center gap-2">
                                    <i className="fa-solid fa-triangle-exclamation text-red-500"></i> Incidencias / Reposiciones
                                </h3>
                                {data.fallas.length === 0 ? (
                                    <div className="text-center text-slate-400 py-10 flex flex-col items-center">
                                        <i className="fa-regular fa-circle-check text-4xl mb-2 text-green-200"></i>
                                        Sin incidencias registradas
                                    </div>
                                ) : (
                                    <div className="space-y-3 max-h-60 overflow-y-auto">
                                        {data.fallas.map(f => (
                                            <div key={f.FallaID} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                                                <div className="flex justify-between font-bold text-red-700 text-xs">
                                                    <span>{f.TipoFalla}</span>
                                                    <span>{new Date(f.FechaFalla).toLocaleDateString()}</span>
                                                </div>
                                                <p className="text-xs text-red-600 mt-1">{f.Observaciones}</p>
                                                <div className="mt-2 text-[10px] bg-white px-2 py-1 rounded border border-red-100 inline-block text-red-400">
                                                    Orden: {f.CodigoOrden}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 4. DETALLE DE ORDENES (SUB-ORDENES) */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="bg-slate-100 px-6 py-3 border-b border-slate-200">
                            <h3 className="text-sm font-bold text-slate-500 uppercase">Detalle de Órdenes ({data.ordenes.length})</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase">
                                    <tr>
                                        <th className="px-6 py-3">Código</th>
                                        <th className="px-6 py-3">Área Actual</th>
                                        <th className="px-6 py-3">Material</th>
                                        <th className="px-6 py-3">Ingreso</th>
                                        <th className="px-6 py-3">Estado</th>
                                        <th className="px-6 py-3 text-center">Magnitud</th>
                                        <th className="px-6 py-3">Prox. Servicio</th>
                                        <th className="px-6 py-3 text-center">Ver</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {data.ordenes.map(o => (
                                        <tr key={o.OrdenID} className="hover:bg-blue-50/50 transition-colors">
                                            <td className="px-6 py-3 font-bold text-slate-700">{o.CodigoOrden}</td>
                                            <td className="px-6 py-3">
                                                <span className="bg-white border border-slate-200 px-2 py-1 rounded text-xs font-semibold text-slate-600">
                                                    {o.AreaID}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-slate-500 text-xs">{o.Material || '-'}</td>
                                            <td className="px-6 py-3 text-slate-400 text-xs">{new Date(o.FechaIngreso).toLocaleDateString()}</td>
                                            <td className="px-6 py-3">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${['FINALIZADA', 'ENTREGADA', 'TERMINADO'].includes(o.Estado) ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                                                    }`}>
                                                    {o.Estado}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-center font-mono text-slate-600">
                                                {o.Magnitud || 0} <span className="text-xs text-slate-400">{o.AreaUM || ''}</span>
                                            </td>
                                            <td className="px-6 py-3 text-xs text-slate-500 font-medium">
                                                {o.ProximoServicio || '-'}
                                            </td>
                                            <td className="px-6 py-3 text-center">
                                                <button
                                                    onClick={() => setSelectedOrder({ id: o.OrdenID, area: o.AreaID })}
                                                    className="w-8 h-8 rounded-full bg-slate-50 hover:bg-blue-100 text-slate-400 hover:text-blue-600 transition-all flex items-center justify-center border border-slate-200 hover:border-blue-200"
                                                    title="Ver Detalle"
                                                >
                                                    <i className="fa-regular fa-eye"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* 5. HISTORIAL UNIFICADO - TABLA LISTA COMPACTA */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 px-6 py-3 border-b border-slate-100">
                            <h3 className="text-sm font-bold text-slate-500 uppercase">Historial Reciente</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left table-fixed">
                                <thead className="bg-white text-slate-400 font-bold border-b border-slate-100">
                                    <tr>
                                        <th className="px-3 py-1.5 w-32">Fecha</th>
                                        <th className="px-3 py-1.5 w-32">Usuario</th>
                                        <th className="px-3 py-1.5 w-24">Orden</th>
                                        <th className="px-3 py-1.5 w-32">Estado</th>
                                        <th className="px-3 py-1.5">Detalle</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {data.historial.filter(h => !h.Estado.startsWith('SNAPSHOT_')).slice(0, 20).map((h, i) => (
                                        <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                                            <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                                                {new Date(h.Fecha).toLocaleString('es-AR', {
                                                    day: '2-digit', month: '2-digit', year: 'numeric',
                                                    hour: '2-digit', minute: '2-digit'
                                                })}
                                            </td>
                                            <td className="px-3 py-1.5 font-medium text-slate-700 truncate">
                                                {h.NombreUsuario || h.Usuario || 'Sistema'}
                                            </td>
                                            <td className="px-3 py-1.5 font-bold text-blue-600">
                                                {h.CodigoOrden}
                                            </td>
                                            <td className="px-3 py-1.5">
                                                <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-slate-200 inline-block truncate w-full" title={h.Estado}>
                                                    {h.Estado}
                                                </span>
                                            </td>
                                            <td className="px-3 py-1.5 text-slate-600 truncate" title={h.Detalle}>
                                                {h.Detalle}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            )}

            {/* MODAL DETALLE DE ORDEN */}
            {selectedOrder && (
                <OrderDetailModal
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                />
            )}
        </div>
    );
};

export default IntegralOrderView;
