import React from 'react';
import { Zap, Trash2 } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';
import { CustomSelect } from '../../../pautas/CustomSelect';

export const CorteTechnicalUI = ({ serviceId, moldType, setMoldType, fabricOrigin, setFabricOrigin, clientFabricName, setClientFabricName, selectedSubOrderId, setSelectedSubOrderId, activeSubOrders, tizadaFiles, setTizadaFiles, handleMultipleSpecializedFileUpload, compact = false, bobinasDisponibles = [], selectedBobinaId = null, setSelectedBobina = () => {} }) => (
    <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-4' : 'mb-12'}`}>
        <div className={`${compact ? 'bg-zinc-900/40 p-6' : 'bg-zinc-900/60 p-8'} rounded-[2rem] border border-zinc-700/50 relative`}>
            <div className="absolute top-0 right-0 p-8 opacity-5 text-brand-gold">
                <Zap size={compact ? 60 : 120} />
            </div>

            <div className="flex items-center gap-3 mb-6">
                <span className="px-3 py-1 bg-brand-gold text-zinc-900 text-[10px] font-black rounded-lg">PASO 1</span>
                <h3 className="text-sm font-black text-zinc-100 uppercase tracking-widest">Especificaciones de Corte</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Tipo de Molde</label>
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
                                    className={`p-3 rounded-xl text-[9px] font-black border-2 transition-all ${moldType === m ? 'bg-brand-cyan text-zinc-100 border-brand-cyan shadow-lg shadow-brand-cyan/20' : 'bg-zinc-800/50 text-zinc-500 border-zinc-700/50 hover:border-zinc-600'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Origen de la Tela</label>
                        <CustomSelect
                            value={fabricOrigin}
                            onChange={(val) => setFabricOrigin(val)}
                            options={[
                                ...(moldType !== 'MOLDES CLIENTES' ? [{ value: 'TELA SUBLIMADA EN USER', label: 'TELA SUBLIMADA EN USER' }] : []),
                                { value: 'TELA CLIENTE', label: 'TELA CLIENTE' },
                                { value: 'TELA STOCK USER', label: 'TELA STOCK USER' }
                            ]}
                            disabled={moldType === 'SUBLIMACION'}
                            variant="black"
                            size="small"
                        />

                        {fabricOrigin === 'TELA CLIENTE' && moldType !== 'SUBLIMACION' && (
                            <div className="mt-3 animate-fade-in bg-zinc-800/30 p-4 rounded-xl border border-zinc-700/50">
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Bobina de Tela *</label>
                                {bobinasDisponibles.length === 0 ? (
                                    <p className="text-[11px] font-bold text-amber-500/90">
                                        Sin bobinas de tela disponibles. Entregá tu tela en recepción para poder usarla en pedidos.
                                    </p>
                                ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                        {bobinasDisponibles.map(b => (
                                            <button
                                                key={b.BobinaID}
                                                type="button"
                                                onClick={() => setSelectedBobina(selectedBobinaId === b.BobinaID ? null : b)}
                                                className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                                                    selectedBobinaId === b.BobinaID
                                                        ? 'border-brand-gold bg-brand-gold/10'
                                                        : 'border-zinc-700/50 bg-zinc-900/40 hover:border-zinc-500'
                                                }`}
                                            >
                                                <div className="font-black text-xs text-zinc-100">{b.DescripcionTela || 'Tela sin descripción'}</div>
                                                <div className="flex gap-3 mt-1 text-[10px] font-bold text-zinc-500 flex-wrap">
                                                    {b.FechaIngreso && <span>📅 {new Date(b.FechaIngreso).toLocaleDateString()}</span>}
                                                    <span className="font-mono">{b.CodigoEtiqueta}</span>
                                                    <span className="text-emerald-400">▸ {parseFloat(b.MetrosRestantes).toFixed(2)} m largo</span>
                                                    {/* Ancho REAL (confirmado); fallback al declarado */}
                                                    {(b.AnchoReal ?? b.Ancho) && <span>↔ {parseFloat(b.AnchoReal ?? b.Ancho).toFixed(2)} m ancho</span>}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col justify-center">
                    {moldType === 'SUBLIMACION' ? null : (
                        <div className="bg-zinc-800/20 p-5 rounded-2xl border border-zinc-700/30">
                            <label className="block text-[10px] uppercase font-black text-brand-gold mb-3 tracking-widest text-center">Archivos de Tizada</label>
                            <FileUploadZone
                                id="tizada-upload-tree"
                                label="Subir Tizadas"
                                onFileSelected={(files) => handleMultipleSpecializedFileUpload(files)}
                                selectedFile={tizadaFiles.length > 0}
                                multiple={true}
                                color="amber"
                            />
                            {tizadaFiles.length > 0 && (
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {tizadaFiles.map((tf, i) => (
                                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-lg py-1.5 px-3 flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-zinc-300 truncate max-w-[100px]">{tf.name}</span>
                                            <button type="button" onClick={() => setTizadaFiles(tizadaFiles.filter((_, idx) => idx !== i))} className="text-zinc-500 hover:text-red-500 transition-colors"><Trash2 size={12} /></button>
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
