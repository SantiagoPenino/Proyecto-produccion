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
// MEDIDA CON DECIMALES (21/10, pedido de Santiago). Antes eran selectores de cm enteros: un escudo de
// 9,2 cm de alto se pedía a 10 y el sistema lo agrandaba (TPU-34617, de 5,8 a 6,3 de ancho), y los
// clientes escribían "EL TAMAÑO ES EL DEL ARCHIVO QUE ES 8 X 7,8" en la nota. Ahora alto y ancho son
// campos de cm con UN decimal (coma o punto), de 1 al tope del producto.
export const MEDIDA_MIN_CM = 1;
// '6,3' / '6.3' / 6.3 → 6.3; vacío o basura → NaN
export const aCm = (v) => { const n = parseFloat(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
// 6.3 → '6,3'; 6 → '6' (con coma, como se escribe acá)
export const fmtCm = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
// ¿Medida válida para un tope? Devuelve el mensaje de error o '' si está bien.
export const errorMedidaCm = (alto, ancho, max) => {
    const a = aCm(alto), b = aCm(ancho);
    if (!(a > 0) || !(b > 0)) return 'Indicá el alto y el ancho del parche.';
    if (a < MEDIDA_MIN_CM || b < MEDIDA_MIN_CM) return `La medida mínima es ${MEDIDA_MIN_CM} cm.`;
    if (max && (a > max.alto + 1e-9 || b > max.ancho + 1e-9)) return `La medida máxima de este producto es ${fmtCm(max.alto)} cm de alto por ${fmtCm(max.ancho)} cm de ancho.`;
    return '';
};

// Campo de cm con un decimal. Mientras escribe acepta lo que sea un número a medio escribir ("6,");
// al salir lo deja prolijo (6,3) y lo acota a [MEDIDA_MIN_CM, max].
export const CampoCm = ({ value, onChange, onBlurValor, max, name, 'aria-label': ariaLabel, placeholder, className = '' }) => (
    <div className="relative">
        <input
            type="text"
            inputMode="decimal"
            name={name}
            aria-label={ariaLabel}
            placeholder={placeholder}
            value={value ?? ''}
            onChange={(e) => {
                const v = e.target.value.replace(/[^\d.,]/g, '');
                if (/^\d{0,3}([.,]\d?)?$/.test(v)) onChange(v);
            }}
            onBlur={() => {
                const n = aCm(value);
                if (!Number.isFinite(n)) return;
                const acotado = Math.min(max ?? Infinity, Math.max(MEDIDA_MIN_CM, Math.round(n * 10) / 10));
                const txt = fmtCm(acotado);
                if (txt !== value) onChange(txt);
                if (onBlurValor) onBlurValor(acotado);
            }}
            className={`w-full p-3 pr-10 text-base rounded-[10px] border border-[#3f3f46] bg-[#111] hover:border-[#00AEEF] font-medium text-zinc-200 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-[#00AEEF]/30 focus:border-[#00AEEF] transition-all duration-200 ${className}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-zinc-500">cm</span>
    </div>
);

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
    // de estampado viajan acá. "Por prenda" es PROPIO de TPU (no el de DTF). El origen de
    // las prendas solo se pide si se pasa setOrigin: en el pedido de prendas sale de lo
    // elegido arriba (prenda del cliente o de stock) y no se vuelve a preguntar.
    printsPerGarment, setPrintsPerGarment,
    origin, setOrigin = null,
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
                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Alto * <span className="normal-case font-bold text-zinc-600">(máx. {fmtCm(max.alto)} cm)</span></label>
                                            <CampoCm value={tpuAlto} onChange={setTpuAlto} max={max.alto} aria-label="Alto del parche" placeholder="Ej. 6,5" className="h-[55px]" />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Ancho * <span className="normal-case font-bold text-zinc-600">(máx. {fmtCm(max.ancho)} cm)</span></label>
                                            <CampoCm value={tpuAncho} onChange={setTpuAncho} max={max.ancho} aria-label="Ancho del parche" placeholder="Ej. 5,8" className="h-[55px]" />
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
                            {setOrigin && (
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
                            )}
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
                                                {/* Prendas que llevan este diseño: entre 1 y las del pedido / artículo (mismo rótulo que DTF) */}
                                                {setPrendasArchivo && tpuArchivos.length > 1 && (
                                                    <label className="flex items-center gap-1 text-[10px] text-zinc-400 whitespace-nowrap" title="En cuántas prendas va este diseño">prendas
                                                        <input
                                                            type="number" min="1" max={parseInt(garmentQuantity, 10) || undefined}
                                                            value={prendasDeArchivo ? prendasDeArchivo(f) : ''}
                                                            onChange={(e) => {
                                                                const tope = parseInt(garmentQuantity, 10) || 0;
                                                                setPrendasArchivo(f, tope > 0 && parseInt(e.target.value, 10) > tope ? String(tope) : e.target.value);
                                                            }}
                                                            className="w-14 h-7 px-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 text-xs font-bold text-center"
                                                        />
                                                    </label>
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
