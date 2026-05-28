import React from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';
import { CustomSelect } from '../../../pautas/CustomSelect';

export const EstampadoTechnicalUI = ({
    file, setFile,
    quantity, setQuantity,
    printsPerGarment, setPrintsPerGarment,
    origin, setOrigin,
    handleSpecializedFileUpload,
    compact = false
}) => {
    return (
        <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-0' : 'mb-8'}`}>
            <div className={`${compact ? 'bg-zinc-900/40 p-6' : 'bg-zinc-900/60 p-8'} rounded-[2rem] border border-zinc-700/50 relative`}>
                {!compact && (
                    <div className="absolute top-0 right-0 p-8 opacity-5 text-brand-gold">
                        <Layers size={compact ? 60 : 120} />
                    </div>
                )}

                <div className="flex items-center gap-3 mb-6">
                    {!compact && <span className="px-3 py-1 bg-brand-gold text-zinc-900 text-[10px] font-black rounded-lg">CONFIGURACIÓN</span>}
                    <h3 className="text-sm font-black text-zinc-100 uppercase tracking-widest">
                        {compact ? 'Detalles de Estampado' : 'Estampado'}
                    </h3>
                </div>

                <div className="space-y-6 relative z-10">
                    {/* Archivo / Croquis */}
                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Cargar Croquis / Archivo</label>
                        <FileUploadZone
                            id="estampado-file"
                            label="Seleccionar archivo"
                            onFileSelected={(f) => handleSpecializedFileUpload(f)}
                            selectedFile={file}
                            color="amber"
                        />
                        {file && (
                            <div className="mt-3 flex items-center gap-2 bg-zinc-800/50 border border-amber-500/30 px-4 py-2 rounded-xl w-fit">
                                <span className="text-[10px] font-bold text-zinc-300 max-w-[200px] truncate">{file.name}</span>
                                <button
                                    onClick={() => setFile(null)}
                                    className="text-amber-500 hover:text-red-500 transition-colors"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Cantidad Prendas */}
                        <div>
                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Cantidad de Prendas</label>
                            <input
                                type="number"
                                min="0"
                                placeholder="0"
                                className="w-full h-[50px] px-4 bg-zinc-800/50 border border-zinc-700/50 rounded-xl font-bold text-zinc-200 outline-none focus:border-brand-gold transition-all"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                            />
                        </div>

                        {/* Cantidad Estampados */}
                        <div>
                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Estampados por Prenda</label>
                            <input
                                type="number"
                                min="1"
                                placeholder="1"
                                className="w-full h-[50px] px-4 bg-zinc-800/50 border border-zinc-700/50 rounded-xl font-bold text-zinc-200 outline-none focus:border-brand-gold transition-all"
                                value={printsPerGarment}
                                onChange={(e) => setPrintsPerGarment(e.target.value)}
                            />
                        </div>

                        {/* Origen */}
                        <div>
                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Origen de las Prendas</label>
                                <CustomSelect
                                    value={origin}
                                    onChange={(val) => setOrigin(val)}
                                    options={[
                                        { value: 'Prendas del Cliente', label: 'Prendas del Cliente' },
                                        { value: 'Stock User', label: 'Stock User' }
                                    ]}
                                    variant="black"
                                    className="h-[50px]"
                                />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
