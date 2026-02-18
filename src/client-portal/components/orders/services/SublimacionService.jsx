import React from 'react';
import { GlassCard } from '../ui/GlassCard';
import { ItemRow } from '../ui/ItemRow';
import { Plus } from 'lucide-react';

/**
 * Componente para Servicios de Sublimación e Impresión Gran Formato.
 * Maneja: Selección de Materiales, Carga de Archivos, Configuración de Escala/Raport.
 */
export function SublimacionService({
    items,
    addItem,
    removeItem,
    updateItem,
    materials,
    onFileSelect,
    config
}) {
    return (
        <GlassCard title="Archivos de Producción y Materiales">

            {items.length === 0 && (
                <div className="text-center p-8 bg-zinc-50 rounded-2xl border-2 border-dashed border-zinc-200 mb-4">
                    <p className="text-sm text-zinc-400 font-bold">No hay archivos cargados aún.</p>
                </div>
            )}

            <div className="space-y-6">
                {items.map((item, index) => (
                    <div key={item.id} className="relative">
                        <ItemRow
                            item={item}
                            index={index}
                            onRemove={removeItem}
                            onFileChange={(e) => onFileSelect(item.id, e.target.files[0])}
                        />

                        {/* Selección de Material Específico por Ítem */}
                        {!config.singleMaterial && (
                            <div className="mt-3 pl-4 border-l-2 border-zinc-100">
                                <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1">Material</label>
                                <select
                                    className="w-full h-[40px] px-3 border border-zinc-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-black outline-none"
                                    value={item.material}
                                    onChange={(e) => updateItem(item.id, 'material', e.target.value)}
                                >
                                    <option value="" disabled>Seleccionar material...</option>
                                    {materials.map(mat => {
                                        const label = mat.Material || mat.name || mat;
                                        const val = mat.Material || mat.name || mat;
                                        return <option key={label} value={val}>{label}</option>;
                                    })}
                                </select>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={addItem}
                className="mt-6 w-full py-4 border-2 border-dashed border-zinc-300 rounded-2xl text-zinc-500 hover:text-black hover:border-black hover:bg-zinc-50 transition-all flex items-center justify-center gap-2 font-black text-sm uppercase tracking-wide"
            >
                <Plus size={18} />
                Agregar Archivo / Pieza
            </button>
        </GlassCard>
    );
}
