import React from 'react';
import { GlassCard } from '../ui/GlassCard';
import { UploadCloud, Scissors } from 'lucide-react';

/**
 * Componente para Servicio de Corte y Confección.
 * Maneja: Carga de Archivos de Tizada (HPGL/PLT), Configuración de Corte.
 */
export function CorteService({ tizadaFiles, setTizadaFiles, moldType, setMoldType }) {

    // Función helper para manejar selección
    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setTizadaFiles(Array.from(e.target.files));
        }
    };

    return (
        <GlassCard title="Archivos de Tizada y Moldería">
            <div className="space-y-8">

                {/* 1. Archivos de Tizada */}
                <div className="bg-zinc-50 p-8 rounded-3xl border-2 border-dashed border-zinc-200 hover:border-zinc-400 transition-colors group">
                    <div className="flex flex-col items-center justify-center gap-4 text-center">
                        <div className="p-4 bg-white rounded-full shadow-sm text-zinc-400 group-hover:text-black transition-colors">
                            <UploadCloud size={32} />
                        </div>
                        <div>
                            <h4 className="font-bold text-sm text-zinc-600 uppercase tracking-widest group-hover:text-black">Subir Archivos de Tizada</h4>
                            <p className="text-xs text-zinc-400 mt-2 max-w-xs mx-auto leading-relaxed">
                                Formatos aceptados: .PLT, .HPGL, .DXF
                                <br />(Archivos vectores para corte automático)
                            </p>
                        </div>

                        <label
                            className="mt-4 px-6 py-3 bg-zinc-900 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-black cursor-pointer shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 block"
                        >
                            SELECCIONAR ARCHIVOS
                            <input
                                type="file"
                                multiple
                                className="hidden"
                                onChange={handleFileChange}
                                accept=".plt,.hpgl,.dxf"
                            />
                        </label>
                    </div>

                    {tizadaFiles && tizadaFiles.length > 0 && (
                        <div className="mt-8 space-y-2 border-t border-zinc-200 pt-6">
                            <p className="text-[10px] font-bold text-zinc-400 uppercase mb-2">Archivos Seleccionados ({tizadaFiles.length})</p>
                            {tizadaFiles.map((file, idx) => (
                                <div key={idx} className="bg-white p-3 rounded-xl border border-zinc-100 shadow-sm flex items-center justify-between text-xs font-bold text-zinc-600">
                                    <span className="flex items-center gap-3">
                                        <Scissors size={14} className="text-purple-500" />
                                        {file.name}
                                    </span>
                                    <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg text-[10px] uppercase font-black tracking-wide">
                                        PENDIENTE
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 2. Configuración de Moldería */}
                <div>
                    <label className="block text-xs font-bold text-zinc-500 mb-3 uppercase flex items-center gap-2">
                        <i className="fa-solid fa-ruler-combined"></i>
                        Método de Entrega de Moldería
                    </label>
                    <div className="flex bg-zinc-100 p-1 rounded-xl gap-1">
                        {[
                            { id: 'digital', label: 'DIGITAL (.PLT / .DXF)' },
                            { id: 'fisica', label: 'FÍSICA (CARTÓN/PAPEL)' },
                            { id: 'desarrollo', label: 'SOLICITAR DESARROLLO (+COSTO)' }
                        ].map(opt => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setMoldType && setMoldType(opt.id)}
                                className={`flex-1 py-3 px-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${moldType === opt.id ? 'bg-white shadow-sm text-black ring-1 ring-black/5' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200/50'}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

            </div>
        </GlassCard>
    );
}
