import React, { useState, useEffect } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import api from '../../services/api';

const LabelGenerationPage = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [areaFilter, setAreaFilter] = useState(''); // Default empty (all or auto-detect)
    const [selection, setSelection] = useState([]);
    const [generating, setGenerating] = useState(false);

    // Fetch orders on mount or area change
    useEffect(() => {
        fetchOrders();
    }, [areaFilter]);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            // Reutilizamos el endpoint existente que trae ordenes con métricas
            // Podríamos pasar un flag especial o simplemente filtrar en cliente
            const response = await api.get('/production-files/orders', {
                params: {
                    area: areaFilter || undefined,
                    search: '', // Traer todo
                    rolloId: 'todo' // Hack para que el backend traiga todo sin filtrar por rollo específico
                }
            });

            // Filtramos en cliente para mostrar solo las que tienen sentido etiquetar
            // - Magnitud > 0 (Condición necesaria)
            // - Estado no cancelado
            // - Quizás priorizar las que ya están "Pronto" o "Produccion" avanzada
            const candidates = response.data.filter(o => {
                // Parse Magnitud
                let magVal = 0;
                if (o.Magnitud) {
                    const m = o.Magnitud.toString().match(/[\d\.]+/);
                    if (m) magVal = parseFloat(m[0]);
                }

                return magVal > 0 && o.Estado !== 'CANCELADO' && o.Estado !== 'Pendiente';
            });

            setOrders(candidates);
        } catch (error) {
            console.error("Error fetching orders:", error);
            toast.error("Error cargando órdenes");
        } finally {
            setLoading(false);
        }
    };

    const toggleSelect = (orderId) => {
        setSelection(prev => {
            if (prev.includes(orderId)) return prev.filter(id => id !== orderId);
            return [...prev, orderId];
        });
    };

    const toggleSelectAll = () => {
        if (selection.length === orders.length) setSelection([]);
        else setSelection(orders.map(o => o.OrdenID));
    };

    const handleGenerate = async () => {
        if (selection.length === 0) return;

        if (!confirm(`¿Generar etiquetas para ${selection.length} órdenes seleccionadas?\nSe borrarán las etiquetas anteriores de estas órdenes.`)) return;

        setGenerating(true);
        let successCount = 0;
        let failCount = 0;

        for (const orderId of selection) {
            try {
                // Llamamos sin 'cantidad', para que el backend calcule automático
                await api.post(`/production-files/${orderId}/regenerate-labels`, {});
                successCount++;
            } catch (error) {
                console.error(`Error order ${orderId}:`, error);
                failCount++;
            }
        }

        setGenerating(false);
        toast.success(`Proceso finalizado.\nGeneradas: ${successCount}\nFallos: ${failCount}`);
        setSelection([]); // Clear selection
        fetchOrders(); // Refresh data to see new label counts if applicable (backend doesn't return count in list immediately unless updated, but good practice)
    };

    return (
        <div className="p-6 bg-slate-50 min-h-screen">
            <Toaster position="top-right" />

            <div className="flexjustify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Generador Masivo de Etiquetas</h1>
                    <p className="text-slate-500">Selecciona las órdenes listas para etiquetar.</p>
                </div>

                <div className="flex gap-4">
                    <select
                        value={areaFilter}
                        onChange={(e) => setAreaFilter(e.target.value)}
                        className="p-2 border rounded shadow-sm"
                    >
                        <option value="">-- Todas las Áreas --</option>
                        <option value="IMPRESION">Impresión</option>
                        <option value="SUBLIMACION">Sublimación</option>
                        <option value="CONFECCION">Confección</option>
                        <option value="CALIDAD">Calidad</option>
                        <option value="DEPOSITO">Depósito</option>
                    </select>

                    <button
                        onClick={fetchOrders}
                        className="bg-white border p-2 rounded shadow-sm hover:bg-slate-100"
                        title="Recargar"
                    >
                        <i className="fa-solid fa-sync text-slate-600"></i>
                    </button>
                </div>
            </div>

            {/* Actions Bar */}
            {selection.length > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 p-4 rounded mb-4 flex justify-between items-center animate-fade-in">
                    <span className="font-bold text-indigo-800">{selection.length} órdenes seleccionadas</span>
                    <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className={`bg-indigo-600 text-white px-6 py-2 rounded shadow hover:bg-indigo-700 transition flex items-center gap-2 ${generating ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {generating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-qrcode"></i>}
                        {generating ? 'Procesando...' : 'Generar Etiquetas'}
                    </button>
                </div>
            )}

            {loading ? (
                <div className="text-center py-20">
                    <i className="fa-solid fa-circle-notch fa-spin text-4xl text-slate-300"></i>
                    <p className="mt-4 text-slate-500">Cargando órdenes...</p>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-100 text-slate-600 text-sm uppercase tracking-wider">
                                <th className="p-4 border-b w-12 text-center">
                                    <input
                                        type="checkbox"
                                        checked={selection.length > 0 && selection.length === orders.length}
                                        onChange={toggleSelectAll}
                                        className="rounded border-slate-300 transform scale-125 cursor-pointer"
                                    />
                                </th>
                                <th className="p-4 border-b">Orden</th>
                                <th className="p-4 border-b">Cliente / Trabajo</th>
                                <th className="p-4 border-b">Área</th>
                                <th className="p-4 border-b">Magnitud</th>
                                <th className="p-4 border-b">Próx. Servicio</th>
                                <th className="p-4 border-b w-24 text-center">Etiquetas</th>
                                <th className="p-4 border-b w-32 text-center">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {orders.length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="p-8 text-center text-slate-400 italic">
                                        No se encontraron órdenes candidatas
                                    </td>
                                </tr>
                            ) : (
                                orders.map(order => {
                                    const isSelected = selection.includes(order.OrdenID);
                                    // Determinar tipo de etiqueta que se generaria
                                    const prox = (order.ProximoServicio || 'DEPOSITO').toUpperCase();
                                    const isFinal = prox.includes('DEPOSITO') || prox === '';
                                    const labelType = isFinal ? 'FINAL (3 QR)' : 'PROCESO';
                                    const labelColor = isFinal ? 'text-green-600 bg-green-50 border-green-200' : 'text-amber-600 bg-amber-50 border-amber-200';

                                    return (
                                        <tr key={order.OrdenID} className={`hover:bg-slate-50 transition border-l-4 ${isSelected ? 'border-l-indigo-500 bg-indigo-50/30' : 'border-l-transparent'}`}>
                                            <td className="p-4 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelect(order.OrdenID)}
                                                    className="rounded border-slate-300 transform scale-125 cursor-pointer text-indigo-600 focus:ring-indigo-500"
                                                />
                                            </td>
                                            <td className="p-4 font-mono font-bold text-slate-700">
                                                {order.CodigoOrden}
                                            </td>
                                            <td className="p-4">
                                                <div className="font-bold text-slate-800">{order.Cliente}</div>
                                                <div className="text-xs text-slate-500 truncate max-w-[200px]" title={order.Descripcion}>{order.Descripcion}</div>
                                            </td>
                                            <td className="p-4">
                                                <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold">
                                                    {order.AreaID}
                                                </span>
                                            </td>
                                            <td className="p-4 font-mono text-sm">
                                                {order.Magnitud || '-'}
                                            </td>
                                            <td className="p-4">
                                                <div className={`text-xs px-2 py-1 rounded border inline-block font-bold ${labelColor}`}>
                                                    <i className={`fa-solid ${isFinal ? 'fa-box-open' : 'fa-arrow-right'} mr-1`}></i>
                                                    {labelType}
                                                </div>
                                                <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">
                                                    Dest: {prox}
                                                </div>
                                            </td>
                                            <td className="p-4 text-center">
                                                {order.CantidadEtiquetas > 0 ? (
                                                    <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm">
                                                        {order.CantidadEtiquetas}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-300 text-xs">-</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${order.Estado === 'Pronto' ? 'bg-green-100 text-green-700' :
                                                        order.Estado === 'Produccion' ? 'bg-blue-100 text-blue-700' :
                                                            'bg-gray-100 text-gray-500'
                                                    }`}>
                                                    {order.Estado}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default LabelGenerationPage;
