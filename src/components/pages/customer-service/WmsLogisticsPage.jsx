import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Package, Clock, PlayCircle, CheckCircle, MapPin, Search, ChevronDown, ChevronUp, AlertTriangle, RefreshCw, XCircle, Save, Edit2, Trash2 } from 'lucide-react';
import { wmsService } from '../../../services/modules/wmsService';

const WmsLogisticsPage = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('PENDIENTE');
    const [expandedOrder, setExpandedOrder] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [cancelDialog, setCancelDialog] = useState(null);
    const [deleteItemDialog, setDeleteItemDialog] = useState(null);
    const [editingItem, setEditingItem] = useState(null);

    useEffect(() => {
        loadOrders();
        const interval = setInterval(loadOrders, 30000); // Auto-refresh every 30s
        return () => clearInterval(interval);
    }, []);

    const loadOrders = async () => {
        try {
            const data = await wmsService.getPendingOrders();
            setOrders(data || []);
        } catch (error) {
            console.error('Error cargando pedidos:', error);
            // toast.error('Error sincronizando con servidor'); // Silenced for auto-refresh
        }
    };

    const handleStartPrep = async (pedidoId) => {
        try {
            await wmsService.startPreparation(pedidoId);
            toast.success('Preparación iniciada. A buscar los productos!');
            loadOrders();
        } catch (error) {
            toast.error('Error al iniciar preparación');
        }
    };

    const handleCancelOrder = async (pedidoId) => {
        try {
            setCancelDialog(null);
            const loadingToast = toast.loading('Cancelando pedido...');
            const res = await wmsService.cancelOrder(pedidoId);
            toast.success(res.message || 'Pedido cancelado', { id: loadingToast });
            loadOrders();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al cancelar');
        }
    };

    const handleSaveQuantity = async () => {
        if (!editingItem) return;
        try {
            const loadingToast = toast.loading('Actualizando cantidad...');
            await wmsService.updateItemQuantity(editingItem.pedidoId, {
                wms_variante_id: editingItem.wms_variante_id,
                nuevaCantidad: editingItem.nuevaCantidad
            });
            toast.success('Cantidad actualizada', { id: loadingToast });
            setEditingItem(null);
            loadOrders();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al actualizar cantidad');
        }
    };

    const handleDeleteItem = async (pedidoId, wms_variante_id) => {
        try {
            setDeleteItemDialog(null);
            const loadingToast = toast.loading('Eliminando artículo...');
            await wmsService.deleteItem(pedidoId, wms_variante_id);
            toast.success('Artículo eliminado', { id: loadingToast });
            loadOrders();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al eliminar artículo');
        }
    };

    const handleConfirmPrep = async (pedidoId) => {
        try {
            setConfirmDialog(null);
            const loadingToast = toast.loading('Confirmando preparación...');
            const res = await wmsService.confirmPreparation(pedidoId);
            toast.success(res.message || 'Pedido confirmado correctamente', { id: loadingToast });
            loadOrders();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al confirmar');
        }
    };

    const filteredOrders = orders.filter(o => {
        if (activeTab === 'TODOS') return true;
        return o.estado === activeTab;
    });

    const pendingCount = orders.filter(o => o.estado === 'PENDIENTE').length;
    const inPrepCount = orders.filter(o => o.estado === 'EN_PREPARACION').length;

    const tabs = [
        { id: 'PENDIENTE', label: 'Pendientes', count: pendingCount, color: 'text-amber-600 bg-amber-100' },
        { id: 'EN_PREPARACION', label: 'En Preparación', count: inPrepCount, color: 'text-blue-600 bg-blue-100' },
        { id: 'TODOS', label: 'Todos los Activos', count: orders.length, color: 'text-slate-600 bg-slate-200' }
    ];

    const getStatusConfig = (estado) => {
        switch(estado) {
            case 'PENDIENTE': return { color: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', label: 'Pendiente', icon: Clock };
            case 'EN_PREPARACION': return { color: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50', label: 'En Preparación', icon: PlayCircle };
            case 'PREPARADO': return { color: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Preparado', icon: CheckCircle };
            default: return { color: 'bg-slate-500', text: 'text-slate-700', bg: 'bg-slate-50', label: estado, icon: Package };
        }
    };

    return (
        <div className="p-6 bg-slate-50 min-h-screen relative">
            
            {/* Confirmation Dialog */}
            {confirmDialog && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-4 mb-4 text-amber-600">
                            <div className="bg-amber-100 p-3 rounded-full">
                                <AlertTriangle size={24} />
                            </div>
                            <h2 className="text-xl font-bold text-slate-800">¿Confirmar Preparación?</h2>
                        </div>
                        <p className="text-slate-600 mb-6">
                            Estás a punto de confirmar el pedido <strong>{confirmDialog.codigo}</strong>. 
                            Esta acción marcará el pedido como preparado y avisará al cliente. Esta acción no se puede deshacer.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button 
                                onClick={() => setConfirmDialog(null)}
                                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={() => handleConfirmPrep(confirmDialog.id)}
                                className="px-5 py-2.5 rounded-xl font-bold text-white bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-2"
                            >
                                <CheckCircle size={18} />
                                Sí, Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Dialog */}
            {cancelDialog && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-4 mb-4 text-red-600">
                            <div className="bg-red-100 p-3 rounded-full">
                                <XCircle size={24} />
                            </div>
                            <h2 className="text-xl font-bold text-slate-800">¿Cancelar Pedido?</h2>
                        </div>
                        <p className="text-slate-600 mb-6">
                            Estás a punto de CANCELAR el pedido <strong>{cancelDialog.codigo}</strong>. 
                            Esta acción no se puede deshacer y el pedido será removido.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button 
                                onClick={() => setCancelDialog(null)}
                                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                                Volver
                            </button>
                            <button 
                                onClick={() => handleCancelOrder(cancelDialog.id)}
                                className="px-5 py-2.5 rounded-xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all flex items-center gap-2"
                            >
                                <XCircle size={18} />
                                Sí, Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Item Dialog */}
            {deleteItemDialog && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-4 mb-4 text-red-600">
                            <div className="bg-red-100 p-3 rounded-full">
                                <Trash2 size={24} />
                            </div>
                            <h2 className="text-xl font-bold text-slate-800">¿Eliminar Artículo?</h2>
                        </div>
                        <p className="text-slate-600 mb-6">
                            Estás a punto de eliminar <strong>{deleteItemDialog.nombre_variante}</strong> de este pedido.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button 
                                onClick={() => setDeleteItemDialog(null)}
                                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={() => handleDeleteItem(deleteItemDialog.pedidoId, deleteItemDialog.wms_variante_id)}
                                className="px-5 py-2.5 rounded-xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all flex items-center gap-2"
                            >
                                <Trash2 size={18} />
                                Sí, Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="bg-gradient-to-tr from-brand-cyan to-cyan-400 p-4 rounded-2xl text-white shadow-lg shadow-cyan-200">
                            <Package size={28} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Logística WMS</h1>
                            <p className="text-slate-500 font-medium">Preparación y despacho de pedidos de inventario</p>
                        </div>
                    </div>
                    
                    <button 
                        onClick={loadOrders}
                        className="self-start md:self-auto flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold shadow-sm transition-colors"
                    >
                        <RefreshCw size={18} />
                        Actualizar
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-3 mb-8 overflow-x-auto pb-2">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-3 px-6 py-3 rounded-full font-bold transition-all whitespace-nowrap ${
                                activeTab === tab.id 
                                ? 'bg-slate-800 text-white shadow-md shadow-slate-300' 
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            {tab.label}
                            {tab.count > 0 && (
                                <span className={`px-2 py-0.5 rounded-full text-xs ${activeTab === tab.id ? 'bg-white/20 text-white' : tab.color}`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Orders List */}
                <div className="space-y-4">
                    {filteredOrders.length === 0 ? (
                        <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center">
                            <CheckCircle size={48} className="mx-auto text-emerald-400 mb-4" />
                            <h3 className="text-xl font-bold text-slate-700 mb-2">¡Todo al día!</h3>
                            <p className="text-slate-500">No hay pedidos en este estado por el momento.</p>
                        </div>
                    ) : (
                        filteredOrders.map(order => {
                            const conf = getStatusConfig(order.estado);
                            const StatusIcon = conf.icon;
                            const isExpanded = expandedOrder === order.id;

                            return (
                                <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                                    {/* Card Header (Always visible) */}
                                    <div 
                                        className="p-5 flex items-center justify-between cursor-pointer"
                                        onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                                    >
                                        <div className="flex items-center gap-6 flex-1">
                                            {/* Accent Bar */}
                                            <div className={`w-1.5 h-12 rounded-full ${conf.color}`}></div>
                                            
                                            <div>
                                                <div className="flex items-center gap-3 mb-1">
                                                    <span className="font-mono text-lg font-bold text-slate-800">{order.codigo}</span>
                                                    <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${conf.bg} ${conf.text}`}>
                                                        <StatusIcon size={14} />
                                                        {conf.label}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-slate-500 font-medium">
                                                    {order.cliente} • {new Date(order.fecha).toLocaleDateString('es-UY', { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-6">
                                            <div className="text-right hidden sm:block">
                                                <p className="text-xs text-slate-400 font-bold uppercase mb-0.5">Total</p>
                                                <p className="font-bold text-slate-800">${order.total}</p>
                                            </div>
                                            <div className="bg-slate-50 p-2 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                                                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Detail View */}
                                    <div className={`overflow-hidden transition-all duration-300 border-t border-slate-100 ${isExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                        <div className="p-6 bg-slate-50/50">
                                            
                                            <div className="flex items-center justify-between mb-4">
                                                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Detalle de Artículos a Preparar</h4>
                                                
                                                <button 
                                                    onClick={() => setCancelDialog(order)}
                                                    className="flex items-center gap-1.5 text-red-500 hover:text-red-700 text-sm font-bold transition-colors"
                                                >
                                                    <XCircle size={16} />
                                                    Cancelar Pedido
                                                </button>
                                            </div>
                                            
                                            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6">
                                                {order.items.map((item, idx) => {
                                                    const isEditing = editingItem?.pedidoId === order.id && editingItem?.wms_variante_id === item.wms_variante_id;
                                                    return (
                                                        <div key={idx} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                            <div className="flex items-center gap-4 flex-1">
                                                                {isEditing ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <input 
                                                                            type="number" 
                                                                            min="0"
                                                                            value={editingItem.nuevaCantidad}
                                                                            onChange={(e) => setEditingItem({...editingItem, nuevaCantidad: Number(e.target.value)})}
                                                                            className="w-20 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                                        />
                                                                        <button 
                                                                            onClick={handleSaveQuantity}
                                                                            className="p-2 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg transition-colors"
                                                                            title="Guardar Cantidad"
                                                                        >
                                                                            <Save size={18} />
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => setEditingItem(null)}
                                                                            className="p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                                                                            title="Cancelar Edición"
                                                                        >
                                                                            <XCircle size={18} />
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="bg-slate-100 w-10 h-10 rounded-lg flex items-center justify-center font-bold text-slate-600">
                                                                            x{item.cantidad}
                                                                        </div>
                                                                        <button 
                                                                            onClick={() => setEditingItem({ pedidoId: order.id, wms_variante_id: item.wms_variante_id, nuevaCantidad: item.cantidad })}
                                                                            className="text-slate-400 hover:text-blue-500 transition-colors"
                                                                            title="Editar Cantidad"
                                                                        >
                                                                            <Edit2 size={16} />
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => setDeleteItemDialog({ pedidoId: order.id, wms_variante_id: item.wms_variante_id, nombre_variante: item.nombre_variante })}
                                                                            className="text-slate-400 hover:text-red-500 transition-colors"
                                                                            title="Eliminar Artículo"
                                                                        >
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                <div>
                                                                    <p className="font-bold text-slate-800">{item.nombre_variante}</p>
                                                                    <p className="text-xs text-slate-500 font-mono">SKU: {item.sku || 'N/A'}</p>
                                                                </div>
                                                        </div>
                                                        
                                                        {/* Ubicacion Badge */}
                                                        <div className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg text-sm font-semibold border border-indigo-100 mt-2 sm:mt-0 whitespace-nowrap">
                                                            <MapPin size={16} />
                                                            {item.ubicacion?.pasillo ? `Pasillo ${item.ubicacion.pasillo}, Estante ${item.ubicacion.estante}` : 'Ubicación no asignada'}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                            {/* Action Bar */}
                                            <div className="flex justify-end pt-2 border-t border-slate-200">
                                                {order.estado === 'PENDIENTE' && (
                                                    <button 
                                                        onClick={() => handleStartPrep(order.id)}
                                                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2"
                                                    >
                                                        <PlayCircle size={20} />
                                                        Iniciar Preparación
                                                    </button>
                                                )}
                                                
                                                {order.estado === 'EN_PREPARACION' && (
                                                    <button 
                                                        onClick={() => setConfirmDialog(order)}
                                                        className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-2"
                                                    >
                                                        <CheckCircle size={20} />
                                                        Confirmar Preparación
                                                    </button>
                                                )}
                                            </div>

                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

            </div>
        </div>
    );
};

export default WmsLogisticsPage;
