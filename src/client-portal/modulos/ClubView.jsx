import React from 'react';
import { Crown } from 'lucide-react';
import { CustomButton } from '../pautas/CustomButton';

export const ClubView = () => {
    return (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-black via-zinc-900 to-black text-white min-h-[500px] p-8 md:p-12 animate-fade-in shadow-2xl">
            <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-amber-500 rounded-full opacity-10 blur-3xl"></div>

            <div className="relative z-10 max-w-2xl">
                <div className="inline-flex items-center gap-2 bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full text-sm font-bold border border-amber-500/30 mb-6">
                    <Crown size={16} /> MIEMBRO VIP
                </div>

                <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Club User Exclusivo</h2>
                <p className="text-zinc-300 text-lg mb-8 leading-relaxed">
                    Como miembro Gold, accedes a beneficios exclusivos diseñados para maximizar tu producción y reducir costos.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div className="bg-white/5 backdrop-blur-sm p-4 rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
                        <h4 className="font-bold text-amber-400 mb-1 text-xl">15% OFF</h4>
                        <p className="text-sm text-zinc-300">En cortes de alto volumen (+100u)</p>
                    </div>
                    <div className="bg-white/5 backdrop-blur-sm p-4 rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
                        <h4 className="font-bold text-amber-400 mb-1 text-xl">Prioridad Alta</h4>
                        <p className="text-sm text-zinc-300">Tus pedidos pasan primero a fila</p>
                    </div>
                </div>

                <button className="bg-gradient-to-r from-amber-500 to-yellow-600 text-white font-bold py-4 px-8 rounded-lg shadow-lg hover:shadow-amber-500/25 transition-all transform hover:-translate-y-1">
                    Ver Catálogo Premium
                </button>
            </div>
        </div>
    );
};
