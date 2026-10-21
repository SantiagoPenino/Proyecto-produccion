import React from 'react';
import { Layers, Trash2, Lock } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';
import { CustomSelect } from '../../../pautas/CustomSelect';
import { idArchivo } from '../utils/idArchivo';

// [DTF] Un archivo = un arte = un estampado en cada prenda que lo lleva. Los artes tienen que cubrir
// justo los estampados del pedido: prendas × estampados por prenda (10 prendas × 2 = frente en 10 y
// espalda en 10, o dos frentes en 6 y 4 más la espalda en 10). Las copias de un arte (veces que se
// imprime el archivo) no pueden superar las prendas que lo llevan. La usan el panel y el envío del pedido.
export const revisarArtesDtf = ({ archivos = [], meta = {}, clave = idArchivo, prendas, porPrenda }) => {
    const total = parseInt(prendas, 10) || 0;
    const xPrenda = parseInt(porPrenda, 10) || 0;
    const prendasDe = (f) => {
        const v = meta[clave(f)]?.prendas;
        return v === undefined || v === '' ? total : (parseInt(v, 10) || 0);
    };
    const errores = [];
    archivos.forEach(f => {
        const m = meta[clave(f)] || {};
        const p = prendasDe(f);
        const c = parseInt(m.copias ?? 1, 10) || 0;
        if (!(m.anchoM > 0 && m.altoM > 0)) errores.push(`«${f.name}» no tiene medida: volvé a subirlo (PDF o PNG con DPI).`);
        if (p < 1 || (total > 0 && p > total)) errores.push(`«${f.name}»: las prendas que lo llevan tienen que ser entre 1 y ${total}.`);
        else if (c < 1 || c > p) errores.push(`«${f.name}»: las copias tienen que ser entre 1 y ${p} (las prendas que lo llevan).`);
    });
    const estampados = archivos.reduce((s, f) => s + prendasDe(f), 0);
    const requeridos = total * xPrenda;
    if (archivos.length && xPrenda < 1) errores.push('Indicá los estampados por prenda.');
    else if (archivos.length && estampados !== requeridos) {
        errores.push(`Los artes suman ${estampados} estampados y ${total} prendas × ${xPrenda} por prenda son ${requeridos}: ajustá «Estampados por prenda» o en cuántas prendas va cada arte.`);
    }
    return { estampados, requeridos, prendasDe, errores };
};

// [PRENDAS] DTF como servicio complementario — un solo toggle con dos archivos:
// el arte a imprimir (uno o más) y el boceto que muestra dónde va en la prenda.
// Espejo de BordadoTechnicalUI.jsx (mismo layout, mismos props "isComplement").
export const DtfTechnicalUI = ({
    garmentQuantity, setGarmentQuantity,
    dtfArchivos, removeDtfArchivo,
    // [DTF COMO PORTAL] copias, prendas y medida por archivo (las carga PrendaOrderForm al medir)
    dtfMeta = {}, setDtfMeta, dtfKey = idArchivo,
    dtfBocetoFile, setDtfBocetoFile,
    dtfMaterial, dtfMaterials, setDtfMaterial,
    handleSpecializedFileUpload,
    handleMultipleSpecializedFileUpload,
    // [PRENDAS] Estampado fusionado: DTF ES una forma de estampar, así que "Estampados
    // por Prenda" viaja acá — PROPIO de DTF, no el mismo que el de TPU. Variante ("DTF Textil")
    // ya no se elige, y el origen de las prendas sale de lo que se eligió arriba.
    printsPerGarment, setPrintsPerGarment,
    compact = true,
    // [COMBOS] Técnica FIJADA por el Configurador — reemplaza el selector de material.
    lockedSpec = '',
    // [COMBOS] Cantidad derivada (combo × cantidad por combo) — mismo candado visual que
    // lockedSpec, en vez de un input que parece editable pero no hace nada al tocarlo.
    lockedQuantity = false,
}) => {
    const totalPrendas = parseInt(garmentQuantity, 10) || 0;
    const revision = revisarArtesDtf({ archivos: dtfArchivos, meta: dtfMeta, clave: dtfKey, prendas: garmentQuantity, porPrenda: printsPerGarment });
    // Prendas que llevan el arte: entre 1 y las del pedido. Si bajan por debajo de las copias, las copias bajan con ellas.
    const cambiarPrendas = (f, valor) => {
        let v = valor;
        const n = parseInt(v, 10);
        if (totalPrendas > 0 && n > totalPrendas) v = String(totalPrendas);
        const patch = { prendas: v };
        const copias = parseInt(dtfMeta[dtfKey(f)]?.copias ?? 1, 10);
        if (parseInt(v, 10) >= 1 && copias > parseInt(v, 10)) patch.copias = v;
        setDtfMeta(dtfKey(f), patch);
    };
    // Copias de ESE archivo: no más que las prendas que lo llevan
    const cambiarCopias = (f, valor) => {
        let v = valor;
        const tope = revision.prendasDe(f);
        if (tope > 0 && parseInt(v, 10) > tope) v = String(tope);
        setDtfMeta(dtfKey(f), { copias: v });
    };
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
                            {lockedSpec ? (
                                <div>
                                    <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Técnica</label>
                                    <div className="w-full h-[55px] px-4 flex items-center gap-2 bg-zinc-800/30 border border-zinc-700/50 rounded-2xl font-bold text-zinc-300">
                                        <Lock size={14} className="text-brand-gold shrink-0" />
                                        <span className="truncate">{lockedSpec}</span>
                                    </div>
                                </div>
                            ) : (
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
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest text-center">Archivo pronto para imprimir (uno o más)</label>
                                <p className="text-[10px] text-zinc-500 text-center mb-2">Igual que en el portal: el archivo va tal cual a la impresora y decís cuántas <b>copias</b> de ese archivo se imprimen (ej: 100 prendas, un archivo con 50 escudos → 2 copias). Se mide al subirlo. Cada archivo es un arte: indicá en cuántas <b>prendas</b> va; cada arte sale con su orden de Estampado.</p>
                                <FileUploadZone
                                    id="dtf-archivo"
                                    label="SUBIR ARCHIVO"
                                    onFileSelected={(f) => handleMultipleSpecializedFileUpload(f)}
                                    selectedFile={dtfArchivos.length > 0}
                                    color="emerald"
                                    multiple={true}
                                />
                                {dtfArchivos.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2 justify-center">
                                        {dtfArchivos.map((f, idx) => {
                                            const m = dtfMeta[dtfKey(f)] || {};
                                            const prendasArte = m.prendas ?? (totalPrendas || '');
                                            return (
                                            <div key={dtfKey(f) || idx} className="flex items-center gap-2 bg-zinc-800/50 border border-emerald-500/30 px-4 py-2 rounded-xl">
                                                <span className="text-[10px] font-bold text-zinc-300 max-w-[140px] truncate" title={f.name}>{f.name}</span>
                                                {/* [DTF COMO PORTAL] medida del archivo, prendas que lo llevan y copias de ESE archivo */}
                                                <span className="text-[10px] text-zinc-500 whitespace-nowrap">{m.anchoM > 0 && m.altoM > 0 ? `${Number(m.anchoM).toFixed(2)} × ${Number(m.altoM).toFixed(2)} m` : 'sin medida'}</span>
                                                {setDtfMeta && (
                                                    <>
                                                        <label className="flex items-center gap-1 text-[10px] text-zinc-400 whitespace-nowrap" title="En cuántas prendas va este arte">prendas
                                                            <input type="number" min="1" max={totalPrendas || undefined} value={prendasArte} onChange={(e) => cambiarPrendas(f, e.target.value)}
                                                                className="w-14 h-7 px-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 text-xs font-bold text-center" />
                                                        </label>
                                                        <label className="flex items-center gap-1 text-[10px] text-zinc-400 whitespace-nowrap" title="Cuántas veces se imprime este archivo (no más que sus prendas)">copias
                                                            <input type="number" min="1" max={revision.prendasDe(f) || undefined} value={m.copias ?? 1} onChange={(e) => cambiarCopias(f, e.target.value)}
                                                                className="w-14 h-7 px-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 text-xs font-bold text-center" />
                                                        </label>
                                                    </>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => removeDtfArchivo(idx)}
                                                    className="text-emerald-500 hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {/* Estampados por prenda contra los artes subidos */}
                                {setDtfMeta && dtfArchivos.length > 0 && parseInt(printsPerGarment, 10) >= 1 && (
                                    revision.estampados === revision.requeridos ? (
                                        <p className="mt-2 text-[10px] text-emerald-400 text-center">Los artes cubren los {revision.requeridos} estampados ({totalPrendas} prendas × {printsPerGarment} por prenda).</p>
                                    ) : (
                                        <p className="mt-2 text-[10px] text-amber-400 text-center">Los artes suman {revision.estampados} estampados y {totalPrendas} prendas × {printsPerGarment} por prenda son {revision.requeridos}: ajustá «Estampados por prenda» o en cuántas prendas va cada arte.</p>
                                    )
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
