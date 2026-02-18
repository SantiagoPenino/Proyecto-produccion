import React from 'react';
import { Scissors } from 'lucide-react';

export const CosturaTechnicalUI = ({ isCorteActive, costuraNote, setCosturaNote, compact = false }) => (
    <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-4' : 'mb-12'}`}>
        <div className={`${compact ? 'bg-zinc-100/50 p-6' : 'bg-zinc-50/50 p-8'} rounded-[2rem] border border-zinc-200 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-8 opacity-5">
                <Scissors size={compact ? 60 : 120} />
            </div>

            <div className="flex items-center gap-3 mb-6">
                <span className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black rounded-lg">PASO {isCorteActive ? '2' : '1'}</span>
                <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">Especificaciones de Costura / Confección</h3>
            </div>

            <div className="relative z-10 bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm">
                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Instrucciones Especiales de Costura</label>
                <textarea
                    className="w-full p-3 bg-zinc-50 border border-zinc-100 rounded-xl font-bold text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all min-h-[100px] text-xs"
                    placeholder="Ej: Tipo de hilo, refuerzos, terminaciones específicas..."
                    value={costuraNote || ''}
                    onChange={(e) => setCosturaNote(e.target.value)}
                />
            </div>
        </div>
    </div>
);

export default CosturaTechnicalUI;
