import React from 'react';
import { Box, Trash2, Lock } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';
import { CustomSelect } from '../../../pautas/CustomSelect';

// [TPU COMO PORTAL] El tope de medida viene en el NOMBRE del tipo de TPU ("Parche (De hasta 10x8)",
// "Hasta 4x4"): primer número = alto, segundo = ancho. Sin medida en el nombre no se piden. Mismo
// criterio que /portal/order/tpu (OrderForm.jsx).
export const medidaMaximaTPU = (nombreMaterial) => {
    const m = String(nombreMaterial || '').match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
    if (!m) return null;
    const alto = parseFloat(m[1].replace(',', '.'));
    const ancho = parseFloat(m[2].replace(',', '.'));
    if (!(alto > 0) || !(ancho > 0)) return null;
    return { alto, ancho };
};
const opcionesCm = (max) => Array.from({ length: Math.floor(max) }, (_, i) => ({ value: String(i + 1), label: `${i + 1} cm` }));

// [PRENDAS] TPU como servicio complementario — mismo criterio que DTF (DtfTechnicalUI.jsx):
// un solo toggle con dos archivos, el arte a imprimir y el boceto de dónde va.
export const TpuTechnicalUI = ({
    garmentQuantity, setGarmentQuantity,
    tpuArchivos, removeTpuArchivo,
    // [UNA ORDEN POR ARCHIVO] (opcional, solo la página interna): prendas por diseño cuando hay más de uno
    prendasDeArchivo = null, setPrendasArchivo = null,
    tpuBocetoFile, setTpuBocetoFile,
    tpuVariant, tpuVariants, handleTpuVariantChange,
    tpuMaterial, tpuMaterials, setTpuMaterial,
    // [TPU COMO PORTAL] medida del parche (solo si el tipo de TPU trae tope en el nombre)
    tpuAlto = '', tpuAncho = '', setTpuAlto, setTpuAncho,
    handleSpecializedFileUpload,
    handleMultipleSpecializedFileUpload,
    // [PRENDAS] Estampado fusionado: TPU ES una forma de estampar, así que sus campos
    // de estampado (por prenda / origen) viajan acá, mismo estado que el panel Estampado.
    printsPerGarment, setPrintsPerGarment,
    origin, setOrigin,
    compact = true,
    // [COMBOS] Técnica FIJADA por el Configurador — reemplaza Tipo/Variante + Tipo de TPU.
    lockedSpec = '',
    // [COMBOS] Cantidad derivada (combo × cantidad por combo) — mismo candado visual que
    // lockedSpec, en vez de un input que parece editable pero no hace nada al tocarlo.
    lockedQuantity = false,
}) => {
    return (
        <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-0' : 'mb-8'}`}>
            <div className={`${compact ? 'bg-zinc-900/40 p-6' : 'bg-zinc-900/60 p-8'} rounded-[2rem] border border-zinc-700/50 relative`}>
                {!compact && (
                    <div className="absolute top-0 right-0 p-8 opacity-5 text-brand-gold">
                        <Box size={120} />
                    </div>
                )}

                <div className="flex items-center gap-3 mb-6">
                    <h3 className="text-sm font-black text-zinc-100 uppercase tracking-widest">Especificaciones de TPU</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 relative z-10">
                    <div className="md:col-span-12 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {lockedSpec ? (
                                <div className="md:col-span-2">
                                    <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Técnica</label>
                                    <div className="w-full h-[55px] px-4 flex items-center gap-2 bg-zinc-800/30 border border-zinc-700/50 rounded-2xl font-bold text-zinc-300">
                                        <Lock size={14} className="text-brand-gold shrink-0" />
                                        <span className="truncate">{lockedSpec}</span>
                                    </div>
                                </div>
                            ) : (
                            <>
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Tipo / Variante *</label>
                                <CustomSelect
                                    value={tpuVariant}
                                    onChange={(val) => handleTpuVariantChange(val)}
                                    options={(tpuVariants || []).map(v => ({ value: v, label: v }))}
                                    placeholder="Seleccionar tipo..."
                                    variant="black"
                                    className="h-[55px]"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Tipo de TPU *</label>
                                <CustomSelect
                                    value={tpuMaterial}
                                    onChange={(val) => setTpuMaterial(val)}
                                    options={(tpuMaterials || []).map(mat => {
                                        const label = mat.Material || mat.name || mat;
                                        const val = mat.Material || mat.name || mat;
                                        return { value: val, label: label };
                                    })}
                                    placeholder="Seleccionar material..."
                                    variant="black"
                                    className="h-[55px]"
                                />
                            </div>
                            {/* [TPU COMO PORTAL] Alto y ancho del parche, acotados por el tipo elegido */}
                            {(() => {
                                const max = medidaMaximaTPU(tpuMaterial);
                                if (!max || !setTpuAlto || !setTpuAncho) return null;
                                return (
                                    <>
                                        <div>
                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Alto * <span className="normal-case font-bold text-zinc-600">(máx. {max.alto} cm)</span></label>
                                            <CustomSelect value={tpuAlto} onChange={(v) => setTpuAlto(v)} options={opcionesCm(max.alto)} placeholder="Alto..." variant="black" className="h-[55px]" />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Ancho * <span className="normal-case font-bold text-zinc-600">(máx. {max.ancho} cm)</span></label>
                                            <CustomSelect value={tpuAncho} onChange={(v) => setTpuAncho(v)} options={opcionesCm(max.ancho)} placeholder="Ancho..." variant="black" className="h-[55px]" />
                                        </div>
                                    </>
                                );
                            })()}
                            </>
                            )}

                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Cantidad Total *</label>
                                {lockedQuantity ? (
                                    <div className="w-full h-[55px] px-4 flex items-center gap-2 bg-zinc-800/30 border border-zinc-700/50 rounded-2xl font-black text-lg text-zinc-300">
                                        <Lock size={14} className="text-brand-gold shrink-0" />
                                        <span>{garmentQuantity}</span>
                                    </div>
                                ) : (
                                    <input
                                        type="number"
                                        min="1"
                                        placeholder="Cant."
                                        className="w-full h-[55px] px-4 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl font-black text-lg text-zinc-100 outline-none focus:border-brand-gold transition-all"
                                        value={garmentQuantity}
                                        onChange={(e) => setGarmentQuantity(e.target.value)}
                                    />
                                )}
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
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Origen de las Prendas *</label>
                                <CustomSelect
                                    value={origin}
                                    onChange={(val) => setOrigin(val)}
                                    options={[
                                        { value: 'Prendas del Cliente', label: 'Prendas del Cliente' },
                                        { value: 'Stock User', label: 'Stock User' }
                                    ]}
                                    variant="black"
                                    className="h-[55px]"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                {/* [TPU COMO PORTAL] Lo que sube el cliente es un BOCETO: el área diseña el arte y arma la
                                    matriz a partir de él (igual que "Trabajo nuevo" en /portal/order/tpu). Va como referencia,
                                    nunca como archivo de impresión: si fuera impresión contaría como capa y la orden pasaría
                                    a "Diseñado" antes de tiempo. */}
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest text-center">Boceto de tu diseño (uno o más)</label>
                                <FileUploadZone
                                    id="tpu-archivo"
                                    label="SUBIR BOCETO"
                                    onFileSelected={(f) => handleMultipleSpecializedFileUpload(f)}
                                    selectedFile={tpuArchivos.length > 0}
                                    color="emerald"
                                    multiple={true}
                                />
                                {setPrendasArchivo && tpuArchivos.length > 1 && (
                                    <p className="mt-2 text-[10px] text-emerald-400 text-center">Cada diseño sale como una orden TPU propia, con su matriz y su Estampado. Indicá cuántas prendas lleva cada uno (por defecto, todas).</p>
                                )}
                                {tpuArchivos.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2 justify-center">
                                        {tpuArchivos.map((f, idx) => (
                                            <div key={idx} className="flex items-center gap-2 bg-zinc-800/50 border border-emerald-500/30 px-4 py-2 rounded-xl">
                                                <span className="text-[10px] font-bold text-zinc-300 max-w-[100px] truncate">{f.name}</span>
                                                {setPrendasArchivo && tpuArchivos.length > 1 && (
                                                    <input
                                                        type="number" min="1" title="Prendas que llevan este diseño"
                                                        value={prendasDeArchivo ? prendasDeArchivo(f) : ''}
                                                        onChange={(e) => setPrendasArchivo(f, e.target.value)}
                                                        className="w-14 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px] font-mono text-zinc-200 text-right"
                                                    />
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => removeTpuArchivo(idx)}
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
                                    id="tpu-boceto"
                                    label="UBICACIÓN VISUAL"
                                    onFileSelected={(f) => handleSpecializedFileUpload(f)}
                                    selectedFile={tpuBocetoFile}
                                    color="blue"
                                />
                                {tpuBocetoFile && (
                                    <div className="mt-3 flex justify-center">
                                        <div className="flex items-center gap-2 bg-zinc-800/50 border border-blue-500/30 px-4 py-2 rounded-xl">
                                            <span className="text-[10px] font-bold text-zinc-300 max-w-[150px] truncate">{tpuBocetoFile.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => setTpuBocetoFile(null)}
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

export default TpuTechnicalUI;
