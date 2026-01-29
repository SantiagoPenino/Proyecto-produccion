import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logisticsService } from '../../services/modules/logisticsService';
import { ordersService } from '../../services/modules/ordersService'; // Reusing for search
import QRCode from 'react-qr-code';

const PackingView = ({ areaFilter }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [parcelDescription, setParcelDescription] = useState('');
    const [parcelType, setParcelType] = useState('PROD_TERMINADO');
    const [scannedLabels, setScannedLabels] = useState([]); // Mock for now, intended for history

    // 1. Search Active Orders
    const { data: searchResults, isLoading: isSearching } = useQuery({
        queryKey: ['orders', 'search', searchQuery, areaFilter],
        queryFn: () => ordersService.getOrdersByArea(areaFilter || 'admin', { q: searchQuery }),
        enabled: !!areaFilter || searchQuery.length > 2,
        keepPreviousData: true,
        staleTime: 1000 * 60
    });

    // 2. Mutation: Create Parcel
    const createParcelMutation = useMutation({
        mutationFn: logisticsService.createParcel,
        onSuccess: (data) => {
            alert(`✅ Bulto Creado! ID: ${data.bultoId}`);
            setParcelDescription('');
            // TODO: Add to local list or refetch history
            setScannedLabels(prev => [{
                id: data.bultoId,
                code: generateLabelCode(selectedOrder?.CodigoOrden, prev.length + 1), // Mock code gen
                desc: parcelDescription || selectedOrder?.DescripcionTrabajo,
                time: new Date()
            }, ...prev]);
        },
        onError: (err) => alert(`❌ Error: ${err.message}`)
    });

    // Helper: Generate a temporary code for preview (The backend generates the real unique QR)
    // Actually the backend expects us to send the code? Let's check SP.
    // SP: @CodigoEtiqueta NVARCHAR(50). So Frontend DOES decide the code?
    // "sp_CrearBulto: @CodigoEtiqueta, @Tipo..."
    // Yes, usually frontend or trigger. Let's make Frontend generate a smart code: "ORD-123-B1"

    const PROPOSED_CODE = selectedOrder
        ? `${selectedOrder.CodigoOrden}-B${(selectedOrder.ArchivosCount || 0) + scannedLabels.length + 1}`
        : `GEN-${Date.now()}`;

    const handleCreate = () => {
        if (!selectedOrder && parcelType === 'PROD_TERMINADO') {
            alert("Seleccione una orden para productos terminados");
            return;
        }

        createParcelMutation.mutate({
            codigoEtiqueta: PROPOSED_CODE,
            tipo: parcelType,
            ordenId: selectedOrder?.OrdenID,
            descripcion: parcelDescription || (selectedOrder ? `Parte de Orden ${selectedOrder.CodigoOrden}` : 'Bulto Genérico'),
            ubicacion: 'LOGISTICA_PACKING',
            usuarioId: 1 // TODO: Get real user
        });
    };

    return (
        <div className="flex h-full">
            {/* LEFT PANEL: BUSCADOR */}
            <div className="w-1/3 bg-white border-r border-gray-200 flex flex-col">
                <div className="p-4 border-b border-gray-100 bg-gray-50">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                        {areaFilter && areaFilter !== 'TODOS' ? `Pendientes en ${areaFilter}` : 'Buscar Orden'}
                    </label>
                    <div className="relative">
                        <i className={`fa-solid ${areaFilter ? 'fa-filter' : 'fa-search'} absolute left-3 top-3 text-gray-400`}></i>
                        <input
                            type="text"
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                            placeholder="Cliente, Orden #, Material..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    {isSearching && <div className="p-4 text-center text-gray-400"><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Buscando...</div>}

                    {searchResults?.map(order => (
                        <div
                            key={order.OrdenID}
                            onClick={() => setSelectedOrder(order)}
                            className={`p-3 mb-2 rounded-lg border cursor-pointer hover:shadow-md transition-all ${selectedOrder?.OrdenID === order.OrdenID ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-300' : 'bg-white border-gray-100'}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-gray-800 text-sm">#{order.CodigoOrden}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${order.Estado === 'Terminado' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {order.Estado}
                                </span>
                            </div>
                            <h4 className="text-sm font-semibold text-gray-700 truncate">{order.Cliente}</h4>
                            <p className="text-xs text-gray-500 line-clamp-2 mt-1">{order.DescripcionTrabajo || order.Material}</p>
                        </div>
                    ))}

                    {!isSearching && searchResults?.length === 0 && (
                        <div className="text-center p-8 text-gray-400 text-sm">
                            {areaFilter ?
                                (searchQuery ? "No se encontraron resultados." : "👍 Al día! No hay órdenes pendientes.")
                                :
                                (searchQuery.length > 2 ? "No se encontraron órdenes." : "Use el buscador para comenzar.")
                            }
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT PANEL: WORKSPACE */}
            <div className="flex-1 bg-gray-50/50 p-6 flex flex-col overflow-y-auto">
                {selectedOrder ? (
                    <div className="max-w-4xl mx-auto w-full space-y-6">
                        {/* 1. ORDER SUMMARY CARD */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex justify-between items-start">
                            <div>
                                <h2 className="text-2xl font-bold text-gray-800 mb-1">{selectedOrder.Cliente}</h2>
                                <div className="flex items-center space-x-3 text-sm text-gray-500 mb-4">
                                    <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold">#{selectedOrder.CodigoOrden}</span>
                                    <span>•</span>
                                    <span>{selectedOrder.Material}</span>
                                </div>
                                <p className="text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm max-w-2xl">
                                    {selectedOrder.DescripcionTrabajo || "Sin descripción detallada."}
                                </p>
                            </div>
                            <div className="text-right">
                                <div className="text-4xl font-bold text-gray-300">{selectedOrder.ArchivosCount || 0}</div>
                                <div className="text-xs text-gray-400 uppercase font-bold">Bultos Previos</div>
                            </div>
                        </div>

                        {/* 2. GENERATOR FORM */}
                        <div className="bg-white rounded-xl shadow-lg border border-indigo-100 overflow-hidden">
                            <div className="bg-indigo-600 px-6 py-3 flex justify-between items-center">
                                <h3 className="text-white font-bold flex items-center">
                                    <i className="fa-solid fa-print mr-2 bg-indigo-500 p-1.5 rounded-full text-xs"></i>
                                    Generador de Etiquetas
                                </h3>
                                <div className="text-indigo-200 text-xs font-mono">{PROPOSED_CODE}</div>
                            </div>

                            <div className="p-6 grid grid-cols-12 gap-6">
                                <div className="col-span-8 space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de Contenido</label>
                                        <div className="flex space-x-2">
                                            {[
                                                { id: 'PROD_TERMINADO', label: 'Producto Terminado', icon: 'fa-shirt' },
                                                { id: 'INSUMO', label: 'Insumo / Material', icon: 'fa-ruler-combined' },
                                                { id: 'TELA_CLIENTE', label: 'Tela de Cliente', icon: 'fa-scissors' }
                                            ].map(type => (
                                                <button
                                                    key={type.id}
                                                    onClick={() => setParcelType(type.id)}
                                                    className={`px-4 py-2 rounded-lg text-sm font-medium border flex items-center flex-1 justify-center transition-all ${parcelType === type.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                                >
                                                    <i className={`fa-solid ${type.icon} mr-2`}></i>
                                                    {type.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descripción Adicional (Opcional)</label>
                                        <input
                                            type="text"
                                            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                                            placeholder="Ej. Caja con accesorios, Rollo sobrante..."
                                            value={parcelDescription}
                                            onChange={(e) => setParcelDescription(e.target.value)}
                                        />
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            onClick={handleCreate}
                                            disabled={createParcelMutation.isLoading}
                                            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {createParcelMutation.isLoading ? (
                                                <><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Generando...</>
                                            ) : (
                                                <><i className="fa-solid fa-plus mr-2"></i>Generar Inmediatamente</>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* PREVIEW QR */}
                                <div className="col-span-4 flex flex-col items-center justify-center p-4 bg-gray-50 rounded-lg border border-gray-200 border-dashed">
                                    <div className="bg-white p-3 rounded shadow-sm mb-3">
                                        <QRCode value={PROPOSED_CODE} size={120} />
                                    </div>
                                    <span className="text-xs font-mono text-gray-500">{PROPOSED_CODE}</span>
                                    <span className="text-[10px] text-gray-400 mt-1 uppercase text-center">Vista previa<br />Etiqueta ZEBRA 4x2</span>
                                </div>
                            </div>
                        </div>

                        {/* 3. RECENT PARCELS LIST */}
                        <div>
                            <h3 className="text-sm font-bold text-gray-500 uppercase mb-3">Bultos de esta sesión</h3>
                            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                                {scannedLabels.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400 text-sm">
                                        No se han generado bultos aún.
                                    </div>
                                ) : (
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">QR</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contenido</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hora</th>
                                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acción</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {scannedLabels.map((lbl, idx) => (
                                                <tr key={idx}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-indigo-600 font-bold">{lbl.code}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{lbl.desc}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                        {lbl.time.toLocaleTimeString()}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                        <button className="text-indigo-600 hover:text-indigo-900 border border-indigo-200 px-3 py-1 rounded hover:bg-indigo-50 transition-colors">
                                                            <i className="fa-solid fa-print mr-1"></i> Imprimir
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>

                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <i className="fa-solid fa-box text-3xl text-gray-300"></i>
                        </div>
                        <h3 className="text-lg font-medium text-gray-600">Seleccione una orden para comenzar</h3>
                        <p className="text-sm">Utilice el buscador de la izquierda para encontrar órdenes pendientes de empaque.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

// Simple ID Generator helper for Mock
const generateLabelCode = (orderCode, idx) => {
    return `${orderCode || 'GEN'}-B${idx}`;
};

export default PackingView;
