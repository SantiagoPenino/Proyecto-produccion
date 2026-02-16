import React from 'react';
import { GlassCard } from '../ui/GlassCard';
import { ItemRow } from '../ui/ItemRow';
import { Plus, Info } from 'lucide-react';

/**
 * Componente para Servicios DTF y DTG (Impresión Directa).
 * Maneja: Archivos PNG sin fondo (transparencia), dimensionamiento exacto.
 */
export function DTFService({
    items,
    addItem,
    removeItem,
    onFileSelect,
    config
}) {
    return (
        <GlassCard title="Archivos para Impresión DTF / DTG">

            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6 rounded-r-xl">
                <div className="flex gap-3">
                    <Info className="text-blue-500 shrink-0" size={20} />
                    <div className="text-sm text-blue-800">
                        <h4 className="font-bold mb-1">Requisitos de Archivo</h4>
                        <ul className="list-disc pl-4 space-y-1 text-xs">
                            <li>Formato PNG com fondo transparente (canal alfa).</li>
                            <li>Resolución recomendada: 300 DPI.</li>
                            <li>Tamaño real de impresión (Escala 1:1).</li>
                            <li>No espejar la imagen (nosotros lo hacemos).</li>
                        </ul>
                    </div>
                </div>
            </div>

            {items.length === 0 && (
                <div className="text-center py-12 px-6 bg-zinc-50 rounded-3xl border-2 border-dashed border-zinc-200 mb-6 group hover:border-blue-400 transition-colors cursor-pointer" onClick={addItem}>
                    <div className="mb-4 text-zinc-300 group-hover:text-blue-500 transition-colors">
                        <Plus size={48} className="mx-auto" />
                    </div>
                    <p className="text-sm text-zinc-500 font-bold uppercase tracking-wide">
                        No hay diseños cargados
                    </p>
                    <p className="text-xs text-zinc-400 mt-2">
                        Haz clic para agregar tu primer archivo de impresión
                    </p>
                </div>
            )}

            <div className="space-y-6">
                {items.map((item, index) => (
                    <div key={item.id} className="relative transition-all duration-300 hover:transform hover:scale-[1.01]">
                        <ItemRow
                            item={item}
                            index={index}
                            onRemove={removeItem}
                            onFileChange={(e) => onFileSelect(item.id, e.target.files[0])}
                            acceptedFormats=".png,.pdf,.ai,.psd,.tiff"
                        />

                        {/* Validación Visual de Transparencia (Simulada) */}
                        {item.file && !item.file.hasTransparency && (
                            <div className="mt-2 text-[10px] text-amber-600 font-bold bg-amber-50 p-2 rounded flex items-center gap-2">
                                <Info size={12} />
                                ADVERTENCIA: No detectamos transparencia. Si es DTF, asegúrate que el fondo sea transparente.
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {items.length > 0 && (
                <button
                    type="button"
                    onClick={addItem}
                    className="mt-8 w-full py-4 bg-white border-2 border-dashed border-zinc-200 rounded-2xl text-zinc-500 hover:text-blue-600 hover:border-blue-500 hover:bg-blue-50/50 transition-all flex items-center justify-center gap-3 font-black text-xs uppercase tracking-widest shadow-sm hover:shadow-md"
                >
                    <Plus size={16} />
                    Agregar Otro Diseño / Pliego
                </button>
            )}
        </GlassCard>
    );
}
