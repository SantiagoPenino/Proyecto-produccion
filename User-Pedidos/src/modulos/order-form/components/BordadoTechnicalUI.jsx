import React from 'react';
import { Scissors, Trash2 } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';

export const BordadoTechnicalUI = ({
    serviceId, garmentQuantity, setGarmentQuantity,
    bocetoFile, setBocetoFile,
    ponchadoFiles, setPonchadoFiles,
    globalMaterial, handleGlobalMaterialChange,
    serviceInfo, userStock,
    handleSpecializedFileUpload,
    handleMultipleSpecializedFileUpload,
    compact = false,
    // Props para modo complemento
    isComplement = false,
    compMaterial = '', setCompMaterial = null,
    compVariant = '', setCompVariant = null,
    compVariants = [], compMaterials = [],
    uniqueVariants = [], dynamicMaterials = [],
    serviceSubType = '', handleSubTypeChange = null
}) => {
    // Determinamos qué datos mostrar según si es standalone o complemento
    const isStandalone = serviceId === 'bordado';
    const displayVariants = isStandalone ? uniqueVariants : compVariants;
    const displayMaterials = isStandalone ? dynamicMaterials : compMaterials;

    const currentVariant = isStandalone ? serviceSubType : compVariant;
    const currentMaterial = isStandalone ? globalMaterial : compMaterial;

    const onVariantChange = isStandalone ? handleSubTypeChange : setCompVariant;
    const onMaterialChange = isStandalone ? handleGlobalMaterialChange : setCompMaterial;

    return (
        <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-0' : 'mb-8'}`}>
            <div className={`${compact ? 'bg-zinc-100 p-6' : 'bg-zinc-50/50 p-8'} rounded-[2rem] border border-zinc-200 relative overflow-hidden`}>
                {!compact && (
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Scissors size={120} />
                    </div>
                )}

                <div className="flex items-center gap-3 mb-6">
                    {!compact && <span className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black rounded-lg">PASO 1</span>}
                    <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">{compact ? 'Especificaciones Técnicas' : 'Especificaciones de Bordado'}</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 relative z-10">
                    <div className="md:col-span-12 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Tipo / Variante *</label>
                                <select
                                    className="w-full h-[55px] px-4 bg-white border border-zinc-200 rounded-2xl font-bold text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all"
                                    value={currentVariant}
                                    onChange={(e) => onVariantChange(e.target.value)}
                                >
                                    <option value="" disabled>Seleccionar tipo...</option>
                                    {displayVariants.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Prenda (Soporte) *</label>
                                <select
                                    className="w-full h-[55px] px-4 bg-white border border-zinc-200 rounded-2xl font-bold text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all"
                                    value={currentMaterial}
                                    onChange={(e) => onMaterialChange(e.target.value)}
                                >
                                    <option value="" disabled>Seleccionar prenda...</option>
                                    {(displayVariants.length > 0 ? displayMaterials : (isStandalone ? (serviceInfo?.materials || []) : []) || userStock || []).map(mat => {
                                        const label = mat.Material || mat.name || mat;
                                        const val = mat.Material || mat.name || mat;
                                        return <option key={label} value={val}>{label}</option>;
                                    })}
                                </select>
                            </div>

                            <div className="md:col-span-2 lg:col-span-1">
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Cantidad Total *</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="Cant."
                                    className="w-full h-[55px] px-4 bg-white border border-zinc-200 rounded-2xl font-bold text-lg text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all"
                                    value={garmentQuantity}
                                    onChange={(e) => setGarmentQuantity(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest text-center text-zinc-500">Logos a Bordar (Uno o más)</label>
                                <FileUploadZone
                                    id="bordado-logo"
                                    label="SUBIR LOGOS"
                                    onFileSelected={(f) => handleMultipleSpecializedFileUpload(f)}
                                    selectedFile={ponchadoFiles.length > 0}
                                    color="emerald"
                                    multiple={true}
                                />
                                {ponchadoFiles.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {ponchadoFiles.map((f, idx) => (
                                            <div key={idx} className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-full">
                                                <span className="text-[10px] font-bold text-emerald-700 max-w-[100px] truncate">{f.name}</span>
                                                <button
                                                    onClick={() => setPonchadoFiles(ponchadoFiles.filter((_, i) => i !== idx))}
                                                    className="text-emerald-400 hover:text-emerald-600 transition-colors"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest text-center text-zinc-500">Boceto / Ubicación</label>
                                <FileUploadZone
                                    id="bordado-boceto"
                                    label="UBICACIÓN VISUAL"
                                    onFileSelected={(f) => handleSpecializedFileUpload(f)}
                                    selectedFile={bocetoFile}
                                    color="blue"
                                />
                                {bocetoFile && (
                                    <div className="mt-3 flex justify-center">
                                        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full">
                                            <span className="text-[10px] font-bold text-blue-700 max-w-[150px] truncate">{bocetoFile.name}</span>
                                            <button
                                                onClick={() => setBocetoFile(null)}
                                                className="text-blue-400 hover:text-blue-600 transition-colors"
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

export default BordadoTechnicalUI;
