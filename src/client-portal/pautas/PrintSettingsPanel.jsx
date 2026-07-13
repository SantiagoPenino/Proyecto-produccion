import React, { useState, useEffect } from 'react';
import { FormInput } from './FormInput'; // Asumiendo que existe
import { GlassCard } from './GlassCard'; // Asumiendo que existe
import { AlertCircle, Maximize, Repeat, Image as ImageIcon } from 'lucide-react';
import { CustomSelect } from './CustomSelect';

// TABLA DE ESCALAS SEGÚN REQUERIMIENTO
const SCALE_TABLE = [
    { scale: 10, factor: 1000, label: "1:10" },
    { scale: 25, factor: 400, label: "1:4" },
    { scale: 50, factor: 200, label: "1:2" }
];

export const PrintSettingsPanel = ({
    originalWidthM,
    originalHeightM,
    materialMaxWidthM,
    values = {},
    copies = 1,
    onCopiesChange,
    onChange,
    disableScaling = false,
    hideRaport = false,   // oculta el modo Raport (servicios que no lo usan, ej: EcoUV)
    hideHeader = false
}) => {
    // ... (rest of vars)
    const mode = values.mode || 'normal';
    const selectedScale = values.scale || '';
    const customScaleWidth = values.customWidth || '';
    const raportWidth = values.raportWidth || '';
    const raportHeight = values.raportHeight || '';

    // Lógica de cálculo 
    const calculateSettings = (vals, wM, hM, maxM) => {
        const currentMode = vals.mode || 'normal';
        let res = {
            ...vals,
            mode: currentMode,
            isValid: true,
            observation: '',
            finalWidthM: wM,
            finalHeightM: hM,
            repeatsX: 1,
            repeatsY: 1,
            error: null
        };

        const w = parseFloat(wM) || 0;
        const h = parseFloat(hM) || 0;
        const maxRaw = parseFloat(maxM) || 0;
        // Anchos medidos: redondeo SIEMPRE PARA ARRIBA al cm (1.5701 → 1.58; 1.57 → 1.57), así el valor
        // validado coincide con el mostrado (antes 1.5701 fallaba contra 1.57 y el error decía "1.57 vs 1.57").
        // toFixed(6) limpia ruido de float para que un 1.57 "sucio" no suba injustamente a 1.58.
        const ceil2 = (v) => Math.ceil(Number((v * 100).toFixed(6))) / 100;
        // Sin material (maxRaw<=0) → max = Infinity, así no se valida el ancho hasta elegir material.
        const max = maxRaw > 0.03 ? Math.round((maxRaw - 0.03) * 100) / 100 : (maxRaw > 0 ? maxRaw : Infinity);

        if (currentMode === 'normal') {
            const wR = ceil2(w);
            if (wR > max + 1e-9) {
                res.isValid = false;
                res.error = `El archivo (${wR.toFixed(2)}m) excede el ancho máximo (${max.toFixed(2)}m) para este tipo de material.`;
            }
        }
        else if (currentMode === 'scale') {
            if (!vals.scale) {
                res.isValid = false;
            } else {
                const scaleInfo = SCALE_TABLE.find(s => s.scale === parseInt(vals.scale));
                const factor = scaleInfo ? scaleInfo.factor : 100;

                // Cálculo teórico basado en factor
                // Calculation based purely on scale factor
                const theoreticalWidth = w * (factor / 100);
                const theoreticalHeight = h * (factor / 100);

                let finalW = theoreticalWidth;
                let finalH = theoreticalHeight;
                // Custom Width Input Removed per requirement

                res.finalWidthM = finalW;
                res.finalHeightM = finalH;

                if (ceil2(finalW) > max + 1e-9) {
                    res.isValid = false;
                    res.error = `Ancho final (${ceil2(finalW).toFixed(2)}m) excede máximo (${max.toFixed(2)}m).`;
                }

                // OBSERVACIÓN ACTUALIZADA CON % ZOOM
                res.observation = `[ESCALA] ORIG: ${w.toFixed(2)}x${h.toFixed(2)}m -> TRANSF: Escala ${scaleInfo?.label || ''} (${vals.scale}%) ZOOM: ${factor}% -> FINAL: ${finalW.toFixed(2)}x${finalH.toFixed(2)}m`;
            }
        }
        else if (currentMode === 'raport') {
            // ... (raport logic same as before)
            const rw = parseFloat(vals.raportWidth) || 0;
            const rh = parseFloat(vals.raportHeight) || 0;
            res.finalWidthM = rw;
            res.finalHeightM = rh;

            if (rw <= 0 || rh <= 0) {
                res.isValid = false;
            } else if (ceil2(rw) > max + 1e-9) {
                res.isValid = false;
                res.error = `Ancho raport (${ceil2(rw).toFixed(2)}m) excede máximo (${max.toFixed(2)}m).`;
            } else if (ceil2(w) > max + 1e-9) {
                res.isValid = false;
                res.error = `Patrón original (${ceil2(w).toFixed(2)}m) ancho > material.`;
            }

            if (w > 0 && h > 0) {
                res.repeatsX = rw / w;
                res.repeatsY = rh / h;
                res.observation = `[RAPORT] ORIG: ${w.toFixed(2)}x${h.toFixed(2)}m -> TRANSF: Repetición ${res.repeatsX.toFixed(1)}H x ${res.repeatsY.toFixed(1)}V -> FINAL: ${rw.toFixed(2)}x${rh.toFixed(2)}m`;
            }
        }
        return res;
    };

    // Auto-validate and synchronize state whenever material width, original file dimensions, or input values change
    useEffect(() => {
        const calculated = calculateSettings(values, originalWidthM, originalHeightM, materialMaxWidthM);
        if (
            calculated.isValid !== values.isValid ||
            calculated.error !== values.error ||
            calculated.finalWidthM !== values.finalWidthM ||
            calculated.finalHeightM !== values.finalHeightM ||
            calculated.repeatsX !== values.repeatsX ||
            calculated.repeatsY !== values.repeatsY ||
            calculated.observation !== values.observation
        ) {
            onChange(calculated);
        }
    }, [materialMaxWidthM, originalWidthM, originalHeightM, values.mode, values.scale, values.raportWidth, values.raportHeight]);

    // Handler para cambios de Input
    const handleInputChange = (field, value) => {
        // Objeto con los nuevos valores RAW
        const nextValues = {
            mode,
            scale: selectedScale,
            customWidth: customScaleWidth,
            raportWidth: raportWidth,
            raportHeight: raportHeight,
            [field]: value
        };

        // Si cambia el modo, reiniciar algunos valores por UX
        if (field === 'mode') {
            if (value === 'scale') {
                nextValues.scale = '';
                nextValues.customWidth = '';
            }
            if (value === 'raport') {
                nextValues.raportWidth = '';
                nextValues.raportHeight = '';
            }
        }

        // Si cambia la escala, reiniciar customWidth
        if (field === 'scale') {
            nextValues.customWidth = '';
        }

        const calculated = calculateSettings(nextValues, originalWidthM, originalHeightM, materialMaxWidthM);
        onChange(calculated);
    };

    return (
        <div className="bg-custom-dark md:rounded-xl rounded-none shadow-sm border-y border-x-0 md:border-x border-zinc-700/50 -mx-4 md:mx-0">
            {!hideHeader && (
                <div className="bg-custom-dark px-4 py-3 border-b border-zinc-700/50 flex items-center gap-2">
                    <AlertCircle size={14} className="text-cyan-400/60" />
                    <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Configuración de Impresión</h4>
                    <div className="h-px bg-zinc-700 flex-1"></div>
                </div>
            )}

            {/* Selector de Modo */}
            {!disableScaling && (
                <div className="flex bg-zinc-900/60 p-1 md:rounded-xl rounded-none gap-1 border-y border-x-0 md:border-x border-zinc-700/30">
                    <button
                        type="button"
                        onClick={() => handleInputChange('mode', 'normal')}
                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${mode === 'normal' ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-500/30' : 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'}`}
                    >
                        <ImageIcon size={16} />
                        Normal
                    </button>
                    <button
                        type="button"
                        onClick={() => handleInputChange('mode', 'scale')}
                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${mode === 'scale' ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-500/30' : 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'}`}
                    >
                        <Maximize size={16} />
                        A Escala
                    </button>
                    {!hideRaport && (
                        <button
                            type="button"
                            onClick={() => handleInputChange('mode', 'raport')}
                            className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${mode === 'raport' ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-500/30' : 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'}`}
                        >
                            <Repeat size={16} />
                            Raport
                        </button>
                    )}
                </div>
            )}

            {/* Panel de Configuración según Modo */}
            <div className="bg-zinc-800/40 md:rounded-xl rounded-none p-4 relative">

                {/* MODO NORMAL: Incluye Copias */}
                {mode === 'normal' && (
                    <div className="flex flex-row items-center gap-4 py-2">
                        {/* Copias */}
                        <div className="flex flex-col items-center flex-shrink-0">
                            <label className="block text-xs font-black text-zinc-400 mb-1 uppercase tracking-wider">Copias</label>
                            <input
                                type="number"
                                min="1"
                                value={copies}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => onCopiesChange && onCopiesChange(parseInt(e.target.value) || 1)}
                                className="w-20 text-center p-2 border border-zinc-600 rounded-lg text-lg font-bold text-zinc-100 bg-zinc-800 focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 outline-none"
                            />
                        </div>

                        <div className="w-px self-stretch bg-zinc-700/50"></div>

                        <div className="flex flex-col items-start cursor-help group flex-1">
                            <p className="font-medium text-zinc-300 text-sm">Impresión Estándar (1:1)</p>
                            <p className="text-xs mt-0.5 text-zinc-500">Se imprimirá tal cual el archivo.</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <div className="font-mono bg-brand-dark px-3 py-1.5 rounded text-[10px] border border-zinc-700 text-zinc-400 group-hover:bg-cyan-400/10 group-hover:border-cyan-500/30 group-hover:text-cyan-300 transition-colors">
                                    Dim: {originalWidthM.toFixed(2)}m x {originalHeightM.toFixed(2)}m
                                </div>
                                <div className="font-mono bg-brand-dark px-3 py-1.5 rounded text-[10px] border border-cyan-500/30 text-cyan-400">
                                    Largo total: {(originalHeightM * copies).toFixed(2)}m
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* MODO ESCALA — mismo layout que Normal: Copias | divisor | contenido */}
                {mode === 'scale' && (
                    <div className="flex flex-row items-start gap-4 py-2">
                        {/* Copias (mismo estilo que Normal) */}
                        <div className="flex flex-col items-center flex-shrink-0">
                            <label className="block text-xs font-black text-zinc-400 mb-1 uppercase tracking-wider">Copias</label>
                            <input
                                type="number"
                                min="1"
                                value={copies}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => onCopiesChange && onCopiesChange(parseInt(e.target.value) || 1)}
                                className="w-20 text-center p-2 border border-zinc-600 rounded-lg text-lg font-bold text-zinc-100 bg-zinc-800 focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 outline-none"
                            />
                        </div>

                        <div className="w-px self-stretch bg-zinc-700/50"></div>

                        {/* Contenido Escala */}
                        <div className="flex-1 min-w-0">
                            <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase">Escala del Diseño</label>
                            <CustomSelect
                                value={selectedScale}
                                onChange={(val) => handleInputChange('scale', val)}
                                options={[
                                    ...SCALE_TABLE.map(s => ({
                                        value: s.scale.toString(),
                                        label: `Escala ${s.label} (${s.scale}%)`
                                    }))
                                ]}
                                placeholder="Seleccionar Escala..."
                                variant="dark"
                                size="small"
                            />
                            {/* Medidas del archivo + dimensiones finales (mismo estilo de chips que Normal) */}
                            <div className="mt-2 flex flex-wrap gap-2">
                                <div className="font-mono bg-brand-dark px-3 py-1.5 rounded text-[10px] border border-zinc-700 text-zinc-400">
                                    Dim: {originalWidthM.toFixed(2)}m x {originalHeightM.toFixed(2)}m
                                </div>
                                {selectedScale && (() => {
                                    const factor = (SCALE_TABLE.find(s => s.scale == parseInt(selectedScale))?.factor || 100) / 100;
                                    const finalH = originalHeightM * factor;
                                    return (
                                        <>
                                            <div className="font-mono bg-brand-dark px-3 py-1.5 rounded text-[10px] border border-zinc-700 text-zinc-400">
                                                Ancho final: <strong className="text-cyan-300">{(originalWidthM * factor).toFixed(2)}m</strong>
                                            </div>
                                            <div className="font-mono bg-brand-dark px-3 py-1.5 rounded text-[10px] border border-cyan-500/30 text-cyan-400">
                                                Largo total: {(finalH * copies).toFixed(2)}m
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                )}

                {/* MODO RAPORT */}
                {mode === 'raport' && (
                    <div className="py-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase">Ancho Total (m)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full p-2 border border-zinc-600 rounded-lg text-sm bg-zinc-800 text-zinc-200 focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 outline-none"
                                    value={raportWidth}
                                    onChange={(e) => handleInputChange('raportWidth', e.target.value)}
                                    placeholder="Ej: 1.50"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase">Largo Total (m)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full p-2 border border-zinc-600 rounded-lg text-sm bg-zinc-800 text-zinc-200 focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 outline-none"
                                    value={raportHeight}
                                    onChange={(e) => handleInputChange('raportHeight', e.target.value)}
                                    placeholder="Ej: 5.00"
                                />
                            </div>
                            <div className="col-span-2 text-xs text-zinc-500 bg-zinc-900/60 p-2 rounded border border-zinc-700/50">
                                {(raportWidth && raportHeight && originalWidthM > 0) ? (
                                    <p className="text-cyan-300 font-bold text-center">
                                        <i className="fa-solid fa-calculator mr-1"></i>
                                        Repeticiones: {(parseFloat(raportWidth) / originalWidthM).toFixed(1)} Horiz. x {(parseFloat(raportHeight) / originalHeightM).toFixed(1)} Vert.
                                    </p>
                                ) : (
                                    <p className="text-center italic text-zinc-500">Define área para ver repeticiones</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Mensaje de Error / Info Global */}
            {values.error && (
                <div className="flex items-center gap-2 text-red-400 bg-red-500/10 p-3 rounded-lg text-xs font-bold animate-pulse border border-red-500/20">
                    <AlertCircle size={16} />
                    {values.error}
                </div>
            )}
            {values.isValid && values.observation && (
                <div className="flex items-start gap-2 text-emerald-300 bg-emerald-500/10 p-3 rounded-lg text-xs font-medium border border-emerald-500/20">
                    <div className="mt-0.5"><i className="fa-solid fa-check-circle"></i></div>
                    <div>
                        <span className="font-bold block text-emerald-300 mb-0.5">Configuración Válida</span>
                        <span className="text-zinc-400">{values.observation}</span>
                    </div>
                </div>
            )}
        </div>
    );
};
