import React, { useState, useEffect } from 'react';
import { stockService } from '../../services/api';

const CreateItemModal = ({ isOpen, onClose, initialName, onSuccess }) => {
    const [formData, setFormData] = useState({
        nombre: '',
        unidad: 'Unidades',
        categoria: 'General'
    });
    const [loading, setLoading] = useState(false);

    // Al abrir, precargamos lo que el usuario estaba escribiendo
    useEffect(() => {
        if (isOpen) {
            setFormData(prev => ({ ...prev, nombre: initialName || '' }));
        }
    }, [isOpen, initialName]);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!formData.nombre) return alert("El nombre es obligatorio");

        try {
            setLoading(true);
            await stockService.createItem(formData); // Guarda en BD
            alert("✅ Insumo creado exitosamente");
            onSuccess(formData); // Pasamos el nuevo item al modal padre
            onClose();
        } catch (error) {
            alert("Error al crear: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] z-[1500] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-zinc-200">
                {/* Header */}
                <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50">
                    <h3 className="text-base font-black text-zinc-800 flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm shadow-sm">
                            <i className="fa-solid fa-magic-wand-sparkles"></i>
                        </span>
                        Nuevo Insumo
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-red-500 w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 transition-colors"
                    >
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 flex flex-col gap-4">
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-3">
                        <i className="fa-solid fa-circle-info text-blue-500 mt-0.5 text-sm"></i>
                        <p className="text-xs text-blue-700 leading-snug">
                            Estás registrando un nuevo ítem en el catálogo global de insumos.
                        </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Nombre del Insumo</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm font-bold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-zinc-400"
                            value={formData.nombre}
                            onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                            autoFocus
                            placeholder="Ej: Tornillos M4, Lija Grano 80..."
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Unidad de Medida por Defecto</label>
                        <div className="relative">
                            <select
                                className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all appearance-none cursor-pointer"
                                value={formData.unidad}
                                onChange={(e) => setFormData({ ...formData, unidad: e.target.value })}
                            >
                                <option>Unidades</option>
                                <option>Litros</option>
                                <option>Metros</option>
                                <option>Rollos</option>
                                <option>Cajas</option>
                                <option>Paquetes</option>
                                <option>Conos</option>
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 text-xs">
                                <i className="fa-solid fa-chevron-down"></i>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200 rounded-lg transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow-md hover:bg-indigo-700 hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        disabled={loading}
                    >
                        {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check"></i>}
                        Guardar Insumo
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateItemModal;

