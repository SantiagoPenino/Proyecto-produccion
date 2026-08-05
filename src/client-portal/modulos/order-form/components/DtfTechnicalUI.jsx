import React from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';
import { CustomSelect } from '../../../pautas/CustomSelect';

// [PRENDAS] DTF como servicio complementario — un solo toggle con dos archivos:
// el arte a imprimir (uno o más) y el boceto que muestra dónde va en la prenda.
// Espejo de BordadoTechnicalUI.jsx (mismo layout, mismos props "isComplement").
export const DtfTechnicalUI = ({
    garmentQuantity, setGarmentQuantity,
    dtfArchivos, removeDtfArchivo,
    dtfBocetoFile, setDtfBocetoFile,
    dtfMaterial, dtfMaterials, setDtfMaterial,
    handleSpecializedFileUpload,
    handleMultipleSpecializedFileUpload,
    // [PRENDAS] Estampado fusionado: DTF ES una forma de estampar, así que "Estampados
    // por Prenda" viaja acá, mismo estado que el panel Estampado. Variante ("DTF Textil")
    // y Origen ("Stock User") son siempre los mismos — ya no se eligen, no hay campo.
    printsPerGarment, setPrintsPerGarment,
    compact = true,
}) => {
    return (
        <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-0' : 'mb-8'}`}>
            <div className={`${compact ? 'bg-zinc-900/40 p-6' : 'bg-zinc-900/60 p-8'} rounded-[2rem] border border-zinc-700/50 relative`}>
                {!compact && (
                    <div className="absolute top-0 right-0 p-8 opacity-5 text-brand-gold">
                        <Layers size={120} />
                    </div>
                )}

                <div className="flex items-center gap-3 mb-6">
                    <h3 className="text-sm font-black text-zinc-100 uppercase tracking-widest">Especificaciones de DTF</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 relative z-10">
                    <div className="md:col-span-12 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Film / Material *</label>
                                <CustomSelect
                                    value={dtfMaterial}
                                    onChange={(val) => setDtfMaterial(val)}
                                    options={(dtfMaterials || []).map(mat => {
                                        const label = mat.Material || mat.name || mat;
                                        const val = mat.Material || mat.name || mat;
                                        return { value: val, label: label };
                                    })}
                                    placeholder="Seleccionar material..."
                                    variant="black"
                                    className="h-[55px]"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Cantidad Total *</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="Cant."
                                    className="w-full h-[55px] px-4 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl font-black text-lg text-zinc-100 outline-none focus:border-brand-gold transition-all"
                                    value={garmentQuantity}
                                    onChange={(e) => setGarmentQuantity(e.target.value)}
                                />
                            </div>

                            {/* [PRENDAS] Estampado fusionado: cuánto estampa por prenda y de dónde
                                salen las prendas — mismos campos que el panel Estampado. */}
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Estampados por Prenda *</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="1"
                                    className="w-full h-[55px] px-4 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl font-black text-lg text-zinc-100 outline-none focus:border-brand-gold transition-all"
                                    value={printsPerGarment}
                                    onChange={(e) => setPrintsPerGarment(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest text-center">Archivo a Imprimir (Uno o más)</label>
                                <FileUploadZone
                                    id="dtf-archivo"
                                    label="SUBIR ARTE"
                                    onFileSelected={(f) => handleMultipleSpecializedFileUpload(f)}
                                    selectedFile={dtfArchivos.length > 0}
                                    color="emerald"
                                    multiple={true}
                                />
                                {dtfArchivos.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2 justify-center">
                                        {dtfArchivos.map((f, idx) => (
                                            <div key={idx} className="flex items-center gap-2 bg-zinc-800/50 border border-emerald-500/30 px-4 py-2 rounded-xl">
                                                <span className="text-[10px] font-bold text-zinc-300 max-w-[100px] truncate">{f.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removeDtfArchivo(idx)}
                                                    className="text-emerald-500 hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest text-center">Boceto / Ubicación</label>
                                <FileUploadZone
                                    id="dtf-boceto"
                                    label="UBICACIÓN VISUAL"
                                    onFileSelected={(f) => handleSpecializedFileUpload(f)}
                                    selectedFile={dtfBocetoFile}
                                    color="blue"
                                />
                                {dtfBocetoFile && (
                                    <div className="mt-3 flex justify-center">
                                        <div className="flex items-center gap-2 bg-zinc-800/50 border border-blue-500/30 px-4 py-2 rounded-xl">
                                            <span className="text-[10px] font-bold text-zinc-300 max-w-[150px] truncate">{dtfBocetoFile.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => setDtfBocetoFile(null)}
                                                className="text-blue-500 hover:text-red-500 transition-colors"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DtfTechnicalUI;
