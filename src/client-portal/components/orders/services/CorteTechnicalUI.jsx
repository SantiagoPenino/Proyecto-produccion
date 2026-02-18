import React from 'react';
import { Scissors, Ruler } from 'lucide-react';
import { GlassCard } from '../ui/GlassCard';

/**
 * Componente UI Específico para Servicio de Corte.
 * Contiene selectores de moldería y origen de tela.
 */
export function CorteTechnicalUI({
    isActive,
    onToggle,
    moldType,
    setMoldType,
    fabricOrigin,
    setFabricOrigin
}) {
    return (
        <GlassCard className="transition-all duration-300">
            <div className="flex items-center justify-between mb-4 cursor-pointer" onClick={onToggle}>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl transition-colors ${isActive ? 'bg-black text-white' : 'bg-zinc-100 text-zinc-400'}`}>
                        <Scissors size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-lg text-zinc-800">Corte Automatizado</h3>
                        <p className="text-xs text-zinc-500">Servicio de corte láser / cuchilla</p>
                    </div>
                </div>

                {/* Toggle Switch Simple */}
                <div className={`w-12 h-6 rounded-full p-1 transition-colors ${isActive ? 'bg-green-500' : 'bg-zinc-200'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${isActive ? 'translate-x-6' : 'translate-x-0'}`} />
                </div>
            </div>

            {/* Configuración Desplegable */}
            <div className={`overflow-hidden transition-all duration-500 ${isActive ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-zinc-100">

                    {/* Selector de Moldería */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-1">
                            <Ruler size={14} /> Tipo de Moldería
                        </label>
                        <select
                            className="w-full p-2 text-sm border border-zinc-200 rounded-lg bg-white focus:ring-2 focus:ring-black outline-none"
                            value={moldType}
                            onChange={(e) => setMoldType(e.target.value)}
                        >
                            <option value="">Seleccionar...</option>
                            <option value="digital">Digital (Proporcionada por Cliente)</option>
                            <option value="fisica">Física (Cartón/Papel)</option>
                            <option value="desarrollo">Desarrollo de Moldería (Servicio Extra)</option>
                        </select>
                    </div>

                    {/* Selector de Origen Tela */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Origen de Tela</label>
                        <select
                            className="w-full p-2 text-sm border border-zinc-200 rounded-lg bg-white focus:ring-2 focus:ring-black outline-none"
                            value={fabricOrigin}
                            onChange={(e) => setFabricOrigin(e.target.value)}
                        >
                            <option value="">Seleccionar...</option>
                            <option value="propia">Taller (Stock Interno)</option>
                            <option value="cliente">Cliente (Trae su tela)</option>
                        </select>
                    </div>

                </div>
            </div>
        </GlassCard>
    );
}
