import React, { useState, useEffect } from 'react';

import { Plus, Trash2, Loader2 } from 'lucide-react';
import { apiClient } from '../api/apiClient';
// import { toast } from 'react-hot-toast'; // Not used yet

const EcouvTerminacionesUI = ({ serviceInfo, value, onChange }) => {
    const [availableMaterials, setAvailableMaterials] = useState([]);
    const [loading, setLoading] = useState(false);

    const [selectedMaterial, setSelectedMaterial] = useState('');
    const [quantity, setQuantity] = useState(1);

    // Value IS directly the array of items
    const items = Array.isArray(value) ? value : [];

    useEffect(() => {
        const fetchMaterials = async () => {
            if (!serviceInfo?.areaId) return;
            setLoading(true);
            try {
                // Fetch materials for variant 'Materiales Extra Gran Formato'
                const variantName = encodeURIComponent('Materiales Extra Gran Formato');
                const areaId = serviceInfo.areaId;
                const res = await apiClient.get(`/nomenclators/materials/${areaId}/${variantName}`);

                if (res.success) {
                    setAvailableMaterials(res.data);
                }
            } catch (error) {
                console.error("Error fetching extra materials", error);
            } finally {
                setLoading(false);
            }
        };
        fetchMaterials();
    }, [serviceInfo?.areaId]);

    const handleAddItem = () => {
        if (!selectedMaterial) return;

        const newItem = {
            id: Date.now(),
            material: selectedMaterial,
            cantidad: parseInt(quantity) || 1
        };

        const newItems = [...items, newItem];
        onChange(newItems); // Return array

        // Reset inputs
        setSelectedMaterial('');
        setQuantity(1);
    };

    const handleRemoveItem = (id) => {
        const newItems = items.filter(it => it.id !== id);
        onChange(newItems); // Return array
    };

    return (
        <div className="mt-4 p-4 bg-white rounded-xl border border-zinc-200 shadow-sm animate-in slide-in-from-top-2">
            <h4 className="font-bold text-zinc-800 mb-3 flex items-center gap-2">
                <i className="fa-solid fa-list-check text-indigo-500"></i> Selección de Materiales Extra
            </h4>

            {loading ? (
                <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
                    <Loader2 className="animate-spin w-4 h-4" /> Cargando materiales...
                </div>
            ) : availableMaterials.length === 0 ? (
                <p className="text-zinc-400 text-sm italic">No se encontraron materiales extra disponibles.</p>
            ) : (
                <div className="flex flex-col md:flex-row gap-3 items-end mb-4 bg-zinc-50 p-3 rounded-lg border border-zinc-100">
                    <div className="flex-1 w-full">
                        <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Material Extra</label>
                        <select
                            className="w-full p-2 border border-zinc-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                            value={selectedMaterial}
                            onChange={(e) => setSelectedMaterial(e.target.value)}
                        >
                            <option value="">-- Seleccionar --</option>
                            {availableMaterials.map(m => (
                                <option key={m.CodArticulo || m.Material} value={m.Material}>
                                    {m.Material}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="w-24">
                        <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Cant.</label>
                        <input
                            type="number"
                            min="1"
                            className="w-full p-2 border border-zinc-300 rounded-lg text-sm bg-white text-center focus:ring-2 focus:ring-indigo-500"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handleAddItem}
                        disabled={!selectedMaterial}
                        className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Agregar Material"
                    >
                        <Plus size={20} />
                    </button>
                </div>
            )}

            {/* List of Added Items */}
            {items.length > 0 && (
                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                    {items.map((item, idx) => (
                        <div key={item.id || idx} className="flex items-center justify-between p-2 bg-zinc-50 border border-zinc-200 rounded-lg group hover:border-indigo-200 transition-colors">
                            <div className="flex items-center gap-3">
                                <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-1 rounded-md min-w-[30px] text-center">
                                    {item.cantidad}
                                </span>
                                <span className="text-sm font-medium text-zinc-700">{item.material}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleRemoveItem(item.id)}
                                className="text-zinc-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Eliminar"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {items.length === 0 && !loading && availableMaterials.length > 0 && (
                <p className="text-center text-xs text-zinc-400 py-2">Agregue materiales a la lista si es necesario.</p>
            )}
        </div>
    );
};

export default EcouvTerminacionesUI;
