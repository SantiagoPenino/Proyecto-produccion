import React, { useState, useEffect } from 'react';
import { logisticsService, ordersService } from '../../services/api';

const LogisticsCartModal = ({ isOpen, onClose, areaName, areaCode, onSuccess }) => {
    const [orders, setOrders] = useState([]);
    const [selected, setSelected] = useState([]);
    const [loading, setLoading] = useState(false);
    const [cadete, setCadete] = useState('');

    useEffect(() => {
        if (isOpen && areaCode) {
            loadCandidates();
            setSelected([]);
            setCadete('');
        }
    }, [isOpen, areaCode]);

    const loadCandidates = async () => {
        setLoading(true);
        try {
            const data = await logisticsService.getCandidates(areaCode);
            setOrders(data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const toggleSelect = (id) => {
        if (selected.includes(id)) setSelected(selected.filter(s => s !== id));
        else setSelected([...selected, id]);
    };

    const toggleAll = () => {
        if (selected.length === orders.length) setSelected([]);
        else setSelected(orders.map(o => o.id));
    };

    const removeFromCart = async (orderId) => {
        if (!confirm("¿Sacar esta orden del carrito? Volverá a estado 'Pendiente'.")) return;

        try {
            await ordersService.updateStatus(orderId, 'Pendiente');
            setOrders(orders.filter(o => o.id !== orderId));
            setSelected(selected.filter(id => id !== orderId));
            if (onSuccess) onSuccess();
        } catch (error) {
            alert("Error al devolver orden");
        }
    };

    const handleDispatch = async () => {
        if (selected.length === 0) return alert("Selecciona al menos una orden.");
        setLoading(true);
        try {
            const res = await logisticsService.createDispatch({
                areaId: areaCode,
                ordenesIds: selected,
                cadete: cadete
            });
            alert(`✅ COMPROBANTE GENERADO: ${res.codigo}`);
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) { alert("Error al generar despacho"); }
        finally { setLoading(false); }
    };

    if (!isOpen) return null;

    // Tailwind Clases
    const inputClass = "w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm text-zinc-800 bg-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all placeholder:text-zinc-400";
    const labelClass = "block mb-1.5 text-xs font-bold text-zinc-500 uppercase tracking-wide";

    return (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">

                {/* HEADER ÍNDIGO */}
                <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center shrink-0">
                    <h3 className="text-lg font-bold text-indigo-900 flex items-center gap-2">
                        <i className="fa-solid fa-cart-shopping text-indigo-600"></i>
                        Carrito de Entrega: {areaName}
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-white flex flex-col">
                    {/* BARRA SUPERIOR */}
                    <div className="flex justify-between items-end mb-6 gap-6">
                        <div className="flex-1 max-w-md">
                            <label className={labelClass}>Responsable / Cadete</label>
                            <div className="relative">
                                <i className="fa-solid fa-user-tag absolute left-3 top-2.5 text-zinc-400"></i>
                                <input type="text" className={`${inputClass} pl-9 font-semibold`} placeholder="¿Quién retira?" value={cadete} onChange={e => setCadete(e.target.value)} autoFocus />
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-1">Total a Enviar</div>
                            <div className="text-3xl font-black text-zinc-800 leading-none">
                                {selected.length} <span className="text-lg font-semibold text-zinc-400">/ {orders.length}</span>
                            </div>
                        </div>
                    </div>

                    {/* TABLA */}
                    <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden bg-white shadow-sm flex flex-col">
                        <div className="overflow-y-auto flex-1">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-zinc-50 text-zinc-500 font-semibold border-b border-zinc-200 text-xs uppercase tracking-wide sticky top-0 z-10">
                                    <tr>
                                        <th className="p-3 text-center w-10 bg-zinc-50">
                                            <input type="checkbox" onChange={toggleAll} checked={orders.length > 0 && selected.length === orders.length} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300 cursor-pointer" />
                                        </th>
                                        <th className="p-3 bg-zinc-50">Orden</th>
                                        <th className="p-3 bg-zinc-50">Cliente</th>
                                        <th className="p-3 bg-zinc-50">Trabajo</th>
                                        <th className="p-3 text-center bg-zinc-50 w-20">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {orders.map(o => (
                                        <tr key={o.id} className={`hover:bg-zinc-50 transition-colors ${selected.includes(o.id) ? 'bg-indigo-50/50' : ''}`}>
                                            <td className="p-3 text-center">
                                                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSelect(o.id)} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300 cursor-pointer" />
                                            </td>
                                            <td className="p-3 font-bold text-zinc-700">#{o.id}</td>
                                            <td className="p-3 text-zinc-600 font-medium">{o.client}</td>
                                            <td className="p-3 text-zinc-500 italic">{o.description}</td>

                                            {/* BOTÓN DEVOLVER */}
                                            <td className="p-3 text-center">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); removeFromCart(o.id); }}
                                                    className="p-1.5 rounded-md text-red-500 hover:bg-red-50 hover:text-red-600 border border-transparent hover:border-red-100 transition-all"
                                                    title="Sacar del carrito"
                                                >
                                                    <i className="fa-solid fa-rotate-left"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {orders.length === 0 && !loading && (
                                        <tr><td colSpan="5" className="p-10 text-center text-zinc-400 italic">El carrito está vacío.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-end items-center gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-zinc-500 hover:text-zinc-800 font-semibold transition-colors">Cancelar</button>
                    <button
                        onClick={handleDispatch}
                        className={`px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-lg shadow-indigo-500/30 transition-all flex items-center gap-2 ${loading || selected.length === 0 ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                        disabled={loading || selected.length === 0}
                    >
                        {loading ? 'Procesando...' : <><i className="fa-solid fa-paper-plane"></i> Despachar Seleccionados</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LogisticsCartModal;
