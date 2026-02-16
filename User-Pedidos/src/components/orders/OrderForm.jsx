import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';

// Hooks
import { useOrderLogic } from './hooks/useOrderLogic';
import { useFileUploader } from './hooks/useFileUploader';

// Componentes
import { GlassCard } from './ui/GlassCard';
import { CorteTechnicalUI } from './services/CorteTechnicalUI';
import { ItemRow } from './ui/ItemRow'; // Asumimos que existe o lo creas después

/**
 * OrderForm Refactorizado (Clean Architecture).
 * Actúa como orquestador entre hooks lógicos y componentes UI.
 */
export default function OrderForm() {
    const { serviceId } = useParams();
    const navigate = useNavigate();

    // 1. Lógica de Negocio (State & Handlers)
    const {
        state,
        handlers: { setField, addItem, removeItem, updateItem, toggleService }
    } = useOrderLogic(serviceId);

    // 2. Lógica de Archivos (Upload & Validation)
    const { processFile, isUploading } = useFileUploader();

    // Efecto inicial: Cargar configuración según serviceId (CMS simulado)
    useEffect(() => {
        // Aquí podrías cargar nomencladores o configs desde API
    }, [serviceId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        // Lógica de validación final y llamada a uploadStream...
        console.log("Enviando pedido...", state);
        // ...
    };

    return (
        <div className="min-h-screen bg-zinc-50 p-6 md:p-12 font-sans text-zinc-900 pb-32">

            {/* Header */}
            <div className="max-w-7xl mx-auto flex items-center justify-between mb-8">
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-zinc-500 hover:text-black transition-colors">
                    <ArrowLeft size={20} /> Volver
                </button>
                <h1 className="text-3xl font-black tracking-tighter uppercase">
                    Nuevo Pedido: <span className="text-blue-600">{serviceId}</span>
                </h1>
            </div>

            <form onSubmit={handleSubmit} className="max-w-5xl mx-auto space-y-8">

                {/* 1. Configuración General */}
                <GlassCard title="1. Datos del Trabajo">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-bold text-zinc-500 mb-1">Nombre del Proyecto</label>
                            <input
                                type="text"
                                className="w-full p-3 rounded-xl bg-zinc-100 border-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Ej: Camisetas Verano 2024"
                                value={state.jobName}
                                onChange={(e) => setField('jobName', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-zinc-500 mb-1">Prioridad</label>
                            <select
                                className="w-full p-3 rounded-xl bg-zinc-100 border-none"
                                value={state.urgency}
                                onChange={(e) => setField('urgency', e.target.value)}
                            >
                                <option>Normal</option>
                                <option>Urgente (+15%)</option>
                                <option>Express (+30%)</option>
                            </select>
                        </div>
                    </div>
                </GlassCard>

                {/* 2. Configuración Técnica (Condicional) */}
                {(serviceId === 'corte-confeccion' || state.complementaryServices.corte?.active) && (
                    <CorteTechnicalUI
                        isActive={true} // O bindear a state.technicalSpecs.corte.active
                        onToggle={() => toggleService('corte')}
                        moldType={state.technicalSpecs.corte.moldType}
                        setMoldType={(val) => setField('corte_mold', val)} // Necesitaría adaptar setField o usar dispatch directo
                        fabricOrigin={state.technicalSpecs.corte.fabricOrigin}
                        setFabricOrigin={(val) => setField('corte_origin', val)}
                    />
                )}

                {/* 3. Items / Archivos */}
                <GlassCard title="2. Archivos de Producción">
                    <div className="space-y-4">
                        {state.items.map((item, index) => (
                            <div key={item.id} className="p-4 bg-white rounded-2xl border border-zinc-100 shadow-sm">
                                <div className="flex justify-between mb-2">
                                    <h4 className="font-bold text-sm">Archivo #{index + 1}</h4>
                                    <button onClick={() => removeItem(item.id)} className="text-red-500 text-xs font-bold">ELIMINAR</button>
                                </div>
                                {/* Aquí iría el FileUploadZone conectado a processFile */}
                                <input
                                    type="file"
                                    onChange={async (e) => {
                                        const res = await processFile(e.target.files[0], { maxMaterialWidth: 1.60 });
                                        if (res.success) updateItem(item.id, 'file', res.meta);
                                    }}
                                />
                                {item.file && (
                                    <div className="mt-2 text-xs bg-green-50 text-green-700 p-2 rounded">
                                        Listo: {item.file.width} x {item.file.height} {item.file.unit}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={addItem}
                        className="mt-4 w-full py-3 bg-zinc-900 text-white rounded-xl font-bold hover:bg-black transition-all"
                    >
                        + AGREGAR OTRO ARCHIVO
                    </button>
                </GlassCard>

                {/* Footer Actions */}
                <div className="fixed bottom-0 left-0 w-full bg-white/80 backdrop-blur-md border-t border-zinc-200 p-4 flex justify-end gap-4 z-50">
                    <button
                        type="submit"
                        disabled={isUploading}
                        className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-500/30 transition-all"
                    >
                        {isUploading ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                        {isUploading ? 'SUBIENDO...' : 'CONFIRMAR PEDIDO'}
                    </button>
                </div>

            </form>
        </div>
    );
}
