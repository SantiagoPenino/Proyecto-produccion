import React, { useState } from 'react';
import { rollsService, insumosService } from '../../services/api';

const CreateRollModal = ({ isOpen, onClose, areaCode, onSuccess }) => {
    const [formData, setFormData] = useState({
        name: '',
        capacity: 100,
        color: '#3b82f6',
        bobinaId: null
    });
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    // Colores predefinidos
    const colors = [
        { hex: '#3b82f6', name: 'Azul' },
        { hex: '#10b981', name: 'Verde' },
        { hex: '#ef4444', name: 'Rojo' },
        { hex: '#f59e0b', name: 'Amarillo' },
        { hex: '#8b5cf6', name: 'Morado' },
        { hex: '#ec4899', name: 'Rosa' }
    ];

    const handleSubmit = async () => {
        if (!formData.name) return alert("El nombre es obligatorio");

        setLoading(true);
        try {
            await rollsService.create({
                areaId: areaCode,
                ...formData
            });
            alert("✅ Lote creado exitosamente");
            if (onSuccess) onSuccess();
            onClose();
            // Reset
            setFormData({ name: '', capacity: 100, color: '#3b82f6', bobinaId: null });
        } catch (error) {
            alert("Error al crear el lote: " + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[1300] animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white">
                    <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-scroll text-xl shadow-sm rounded-full p-1" style={{ color: formData.color }}></i>
                        Nuevo Lote de Producción
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-red-500 w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-50 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 flex flex-col gap-5">

                    {/* Nombre */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Nombre del Lote</label>
                        <input
                            type="text"
                            className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-zinc-400"
                            placeholder="Ej: Urgentes Mañana, Pedido Nike..."
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>

                    {/* Capacidad */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Capacidad Máxima</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:border-blue-500 focus:ring-blue-500/20 transition-all"
                                value={formData.capacity}
                                onChange={e => setFormData({ ...formData, capacity: e.target.value })}
                            />
                            <span className="text-sm font-bold text-zinc-400">Metros</span>
                        </div>
                        <small className="text-[10px] text-zinc-400 font-medium">Esto define el 100% de la barra de progreso visual.</small>
                    </div>

                    {/* Color Picker */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Etiqueta de Color</label>
                        <div className="flex flex-wrap gap-3">
                            {colors.map(c => (
                                <button
                                    key={c.hex}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, color: c.hex })}
                                    className={`w-8 h-8 rounded-full shadow-sm transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 ${formData.color === c.hex ? 'ring-2 ring-zinc-400 scale-110' : ''}`}
                                    style={{ backgroundColor: c.hex }}
                                    title={c.name}
                                ></button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-zinc-200 text-zinc-600 rounded-lg text-sm font-bold hover:bg-zinc-100 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-4 py-2 text-white rounded-lg text-sm font-bold shadow-lg hover:shadow-xl hover:brightness-110 active:scale-95 transition-all text-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: formData.color }}
                        disabled={loading}
                    >
                        {loading ? (
                            <><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Creando...</>
                        ) : (
                            <><i className="fa-solid fa-check mr-2"></i>Crear Lote</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateRollModal;
