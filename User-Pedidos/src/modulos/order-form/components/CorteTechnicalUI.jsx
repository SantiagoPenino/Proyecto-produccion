import React from 'react';
import { Zap, Trash2 } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';

export const CorteTechnicalUI = ({ serviceId, moldType, setMoldType, fabricOrigin, setFabricOrigin, clientFabricName, setClientFabricName, selectedSubOrderId, setSelectedSubOrderId, activeSubOrders, tizadaFiles, setTizadaFiles, handleMultipleSpecializedFileUpload, compact = false }) => (
    <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-4' : 'mb-12'}`}>
        <div className={`${compact ? 'bg-zinc-100/50 p-6' : 'bg-zinc-50/50 p-8'} rounded-[2rem] border border-zinc-200 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-8 opacity-5">
                <Zap size={compact ? 60 : 120} />
            </div>

            <div className="flex items-center gap-3 mb-6">
                <span className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black rounded-lg">PASO 1</span>
                <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">Especificaciones de Corte</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Tipo de Molde</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {['SUBLIMACION', 'MOLDES CLIENTES'].map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                        setMoldType(m);
                                        if (m === 'MOLDES CLIENTES' && fabricOrigin === 'TELA SUBLIMADA EN USER') setFabricOrigin('TELA CLIENTE');
                                        if (m === 'SUBLIMACION') setFabricOrigin('TELA SUBLIMADA EN USER');
                                    }}
                                    className={`p-3 rounded-xl text-[9px] font-black border-2 transition-all ${moldType === m ? 'bg-white text-black border-black shadow-md' : 'bg-transparent text-zinc-400 border-zinc-200'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Origen de la Tela</label>
                        <select
                            className="w-full p-3 bg-white border border-zinc-200 rounded-xl font-bold text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all text-xs"
                            value={fabricOrigin}
                            onChange={(e) => setFabricOrigin(e.target.value)}
                            disabled={moldType === 'SUBLIMACION'}
                        >
                            {moldType !== 'MOLDES CLIENTES' && <option value="TELA SUBLIMADA EN USER">TELA SUBLIMADA EN USER</option>}
                            <option value="TELA CLIENTE">TELA CLIENTE</option>
                            <option value="TELA STOCK USER">TELA STOCK USER</option>
                        </select>

                        {fabricOrigin === 'TELA CLIENTE' && moldType !== 'SUBLIMACION' && (
                            <div className="mt-3 animate-fade-in bg-white p-3 rounded-xl border border-zinc-200">
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-1 tracking-widest">Nombre de la Tela *</label>
                                <input
                                    type="text"
                                    placeholder="Ej: Tropical Mecánico..."
                                    className="w-full p-2 border border-zinc-100 rounded-lg font-bold bg-zinc-50 outline-none text-xs"
                                    value={clientFabricName}
                                    onChange={(e) => setClientFabricName(e.target.value)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col justify-center">
                    {moldType === 'SUBLIMACION' ? null : (
                        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                            <label className="block text-[10px] uppercase font-black text-amber-600 mb-2 tracking-widest text-center">Archivos de Tizada</label>
                            <FileUploadZone
                                id="tizada-upload-tree"
                                label="Subir Tizadas"
                                onFileSelected={(files) => handleMultipleSpecializedFileUpload(files)}
                                selectedFile={tizadaFiles.length > 0}
                                multiple={true}
                                color="amber"
                            />
                            {tizadaFiles.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1">
                                    {tizadaFiles.map((tf, i) => (
                                        <div key={i} className="bg-white/80 border border-amber-200 rounded-md py-1 px-2 flex items-center gap-1">
                                            <span className="text-[9px] font-black text-amber-900 truncate max-w-[60px]">{tf.name}</span>
                                            <button type="button" onClick={() => setTizadaFiles(tizadaFiles.filter((_, idx) => idx !== i))} className="text-amber-400 hover:text-red-500"><Trash2 size={10} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    </div>
);

export default CorteTechnicalUI;
