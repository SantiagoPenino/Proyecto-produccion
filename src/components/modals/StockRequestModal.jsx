import React, { useState, useEffect, useRef } from 'react';
import { stockService } from '../../services/api';
import CreateItemModal from './CreateItemModal.jsx';

const StockRequestModal = ({ isOpen, onClose, areaName, areaCode }) => {
    const [activeTab, setActiveTab] = useState('new');
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const [formData, setFormData] = useState({
        item: '',
        cantidad: '',
        unidad: 'Unidades',
        prioridad: 'Normal',
        observaciones: ''
    });

    // COMBOBOX LOGIC
    const [suggestions, setSuggestions] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);

    // Cargar historial
    useEffect(() => {
        if (activeTab === 'history' && isOpen) loadHistory();
    }, [activeTab, isOpen]);

    const loadHistory = async () => {
        try {
            const data = await stockService.getHistory(areaCode);
            setHistory(data);
        } catch (e) { console.error(e); }
    };

    // Cerrar dropdown click fuera
    useEffect(() => {
        const handleClick = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    // Modificación para cargar items al principio o al enfocar
    const searchItems = async (query) => {
        try {
            const items = await stockService.searchItems(query, areaCode);
            setSuggestions(items);
            if (items.length > 0) setShowDropdown(true);
        } catch (err) { console.error(err); }
    };

    const handleItemInput = (e) => {
        const val = e.target.value;
        setFormData({ ...formData, item: val });
        // Buscar siempre que cambie, incluso si es vacío (trae todos)
        searchItems(val);
    };

    const handleFocus = () => {
        // Al enfocar, buscar todo lo del área si no hay nada escrito
        if (suggestions.length === 0) {
            searchItems(formData.item);
        } else {
            setShowDropdown(true);
        }
    };

    const selectItem = (item) => {
        setFormData({ ...formData, item: item.Nombre, unidad: item.UnidadDefault });
        setShowDropdown(false);
    };

    const openCreateModal = () => {
        setShowDropdown(false);
        setIsCreateOpen(true);
    };

    const handleItemCreated = (newItem) => {
        setFormData({ ...formData, item: newItem.nombre, unidad: newItem.unidad });
    };

    const handleSubmit = async () => {
        if (!formData.item || !formData.cantidad) return alert("Faltan datos");
        setLoading(true);
        try {
            await stockService.create({ areaId: areaCode, ...formData });
            alert("✅ Solicitud enviada!");
            setFormData({ item: '', cantidad: '', unidad: 'Unidades', prioridad: 'Normal', observaciones: '' });
            onClose();
        } catch (error) { alert("Error al enviar"); }
        finally { setLoading(false); }
    };

    if (!isOpen) return null;

    // -- Clases Reutilizables --
    const inputClass = "w-full px-3 py-2 border border-orange-200 rounded-lg text-sm text-zinc-800 bg-white outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10 transition-all placeholder:text-zinc-400";
    const labelClass = "block mb-1.5 text-xs font-bold text-zinc-500 uppercase tracking-wide";
    const tabBtnClass = (active) => `px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${active ? 'text-orange-600 border-orange-600 bg-orange-50/50' : 'text-zinc-500 border-transparent hover:text-zinc-700 hover:bg-zinc-50'}`;

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-zinc-900/60 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

                {/* HEADER AMARILLO/NARANJA */}
                <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex justify-between items-center shrink-0">
                    <div className="flex flex-col">
                        <h2 className="text-lg font-bold text-amber-900 flex items-center gap-2">
                            <i className="fa-solid fa-boxes-stacked text-amber-600"></i> Insumos: {areaName}
                        </h2>
                        <div className="flex gap-1 mt-3 -mb-4">
                            <button className={tabBtnClass(activeTab === 'new')} onClick={() => setActiveTab('new')}>Nueva Solicitud</button>
                            <button className={tabBtnClass(activeTab === 'history')} onClick={() => setActiveTab('history')}>Historial</button>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-amber-800/60 hover:bg-amber-100 hover:text-amber-800 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-white">

                    {activeTab === 'new' && (
                        <div className="flex flex-col gap-5">

                            {/* INPUT COMBOBOX */}
                            <div className="relative" ref={dropdownRef}>
                                <label className={labelClass}>Insumo / Material</label>
                                <div className="relative">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        className={`${inputClass} font-bold`}
                                        placeholder="Escribe para buscar..."
                                        value={formData.item}
                                        onChange={handleItemInput}
                                        onFocus={handleFocus}
                                        autoComplete="off"
                                    />
                                    <i
                                        className="fa-solid fa-chevron-down absolute right-3 top-2.5 text-zinc-400 cursor-pointer hover:text-zinc-600"
                                        onClick={() => { inputRef.current?.focus(); handleFocus(); }}
                                    ></i>
                                </div>

                                {/* LISTA DESPLEGABLE */}
                                {showDropdown && (
                                    <ul className="absolute top-[105%] left-0 w-full bg-white border border-zinc-200 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-zinc-50 animate-in slide-in-from-top-1">
                                        {suggestions.length > 0 ? (
                                            suggestions.map((s, i) => (
                                                <li key={i} onClick={() => selectItem(s)} className="px-4 py-3 cursor-pointer hover:bg-orange-50 flex justify-between items-center text-sm text-zinc-700">
                                                    <span className="font-semibold">{s.Nombre}</span>
                                                    <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded">{s.UnidadDefault}</span>
                                                </li>
                                            ))
                                        ) : (
                                            <li className="p-3 text-center text-orange-600 font-bold bg-orange-50 hover:bg-orange-100 cursor-pointer transition-colors" onClick={openCreateModal}>
                                                <div className="flex flex-col items-center gap-1">
                                                    <i className="fa-solid fa-plus-circle text-lg"></i>
                                                    <span>Crear "{formData.item}"</span>
                                                </div>
                                            </li>
                                        )}
                                    </ul>
                                )}
                            </div>

                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className={labelClass}>Cantidad</label>
                                    <input type="number" className={inputClass} value={formData.cantidad} onChange={e => setFormData({ ...formData, cantidad: e.target.value })} />
                                </div>
                                <div className="flex-1">
                                    <label className={labelClass}>Unidad</label>
                                    <select className={inputClass} value={formData.unidad} onChange={e => setFormData({ ...formData, unidad: e.target.value })}>
                                        <option>Unidades</option><option>Litros</option><option>Metros</option><option>Rollos</option><option>Cajas</option><option>Conos</option>
                                    </select>
                                </div>
                            </div>

                            {/* STEPPER PRIORIDAD */}
                            <div>
                                <label className={labelClass}>Prioridad</label>
                                <div className="flex bg-zinc-100 p-1 rounded-lg gap-1">
                                    {['Normal', 'Alta', 'Urgente'].map((level, idx) => (
                                        <div
                                            key={level}
                                            className={`flex-1 flex flex-col items-center justify-center py-2 rounded-md cursor-pointer transition-all ${formData.prioridad === level
                                                ? (level === 'Urgente' ? 'bg-red-500 text-white shadow-md' :
                                                    level === 'Alta' ? 'bg-orange-500 text-white shadow-md' :
                                                        'bg-white text-zinc-800 shadow-sm border border-zinc-200')
                                                : 'text-zinc-400 hover:bg-white/50'
                                                }`}
                                            onClick={() => setFormData({ ...formData, prioridad: level })}
                                        >
                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] mb-1 font-bold ${formData.prioridad === level ? 'bg-white/20' : 'bg-zinc-200 text-zinc-500'}`}>{idx + 1}</div>
                                            <span className="text-xs font-bold">{level}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className={labelClass}>Observaciones</label>
                                <textarea className={`${inputClass} min-h-[80px]`} placeholder="Detalles adicionales..." value={formData.observaciones} onChange={e => setFormData({ ...formData, observaciones: e.target.value })}></textarea>
                            </div>

                            <div className="flex justify-end pt-4 border-t border-zinc-100">
                                <button onClick={onClose} className="px-4 py-2 mr-2 text-zinc-500 hover:text-zinc-800 font-semibold transition-colors">Cancelar</button>
                                <button className="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg shadow-lg shadow-orange-500/30 transition-all flex items-center gap-2" onClick={handleSubmit} disabled={loading}>
                                    {loading ? 'Enviando...' : <><i className="fa-solid fa-paper-plane"></i> Confirmar Pedido</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="border border-zinc-200 rounded-lg overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-zinc-50 text-zinc-500 font-semibold border-b border-zinc-200 text-xs uppercase tracking-wide">
                                    <tr><th className="p-3">Fecha</th><th className="p-3">Detalle</th><th className="p-3">Estado</th></tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {history.length === 0 ? (
                                        <tr><td colSpan="3" className="p-8 text-center text-zinc-400 italic">Sin historial reciente.</td></tr>
                                    ) : (
                                        history.map(h => (
                                            <tr key={h.SolicitudID} className="hover:bg-zinc-50 transition-colors">
                                                <td className="p-3 text-zinc-500">{new Date(h.FechaSolicitud).toLocaleDateString()}</td>
                                                <td className="p-3">
                                                    <div className="font-bold text-zinc-700">{h.Item}</div>
                                                    <div className="text-xs text-zinc-500">{h.Cantidad} {h.Unidad} - <span className="italic">{h.Observaciones}</span></div>
                                                </td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${h.Estado === 'Pendiente' ? 'bg-orange-100 text-orange-600' :
                                                        h.Estado === 'Entregado' ? 'bg-green-100 text-green-600' : 'bg-zinc-100 text-zinc-500'
                                                        }`}>
                                                        {h.Estado}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <CreateItemModal
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                initialName={formData.item}
                onSuccess={handleItemCreated}
            />
        </div>
    );
};

export default StockRequestModal;
