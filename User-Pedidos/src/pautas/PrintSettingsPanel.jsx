import React, { useState, useEffect } from 'react';
import { FormInput } from './FormInput'; // Asumiendo que existe
import { GlassCard } from './GlassCard'; // Asumiendo que existe
import { AlertCircle, Maximize, Repeat, Image as ImageIcon } from 'lucide-react';

// TABLA DE ESCALAS SEGÚN REQUERIMIENTO
const SCALE_TABLE = [
    { scale: 10, factor: 1000, label: "1:10" },
    { scale: 20, factor: 500, label: "1:5" },
    { scale: 30, factor: 333.33, label: "1:3.33" },
    { scale: 40, factor: 250, label: "1:2.5" },
    { scale: 50, factor: 200, label: "1:2" },
    { scale: 60, factor: 166.67, label: "1:1.66" },
    { scale: 70, factor: 142.86, label: "1:1.42" },
    { scale: 80, factor: 125, label: "1:1.25" },
    { scale: 90, factor: 111.11, label: "1:1.11" }
];

export const PrintSettingsPanel = ({
    originalWidthM,
    originalHeightM,
    materialMaxWidthM,
    values = {},
    copies = 1,
    onCopiesChange,
    onChange,
    disableScaling = false
}) => {
    // ... (rest of vars)
    const mode = values.mode || 'normal';
    const selectedScale = values.scale || '';
    const customScaleWidth = values.customWidth || '';
    const raportWidth = values.raportWidth || '';
    const raportHeight = values.raportHeight || '';

    // Lógica de cálculo 
    const calculateSettings = (vals, wM, hM, maxM) => {
        // ... (init res)
        let res = {
            ...vals,
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
        const max = parseFloat(maxM) || 0;

        if (vals.mode === 'normal') {
            if (w > max) {
                res.isValid = false;
                res.error = `El archivo (${w.toFixed(2)}m) excede el ancho máximo (${max.toFixed(2)}m).`;
            }
        }
        else if (vals.mode === 'scale') {
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

                if (finalW > max) {
                    res.isValid = false;
                    res.error = `Ancho final (${finalW.toFixed(2)}m) excede máximo (${max.toFixed(2)}m).`;
                }

                // OBSERVACIÓN ACTUALIZADA CON % ZOOM
                res.observation = `[ESCALA] ORIG: ${w.toFixed(2)}x${h.toFixed(2)}m -> TRANSF: Escala ${scaleInfo?.label || ''} (${vals.scale}%) ZOOM: ${factor}% -> FINAL: ${finalW.toFixed(2)}x${finalH.toFixed(2)}m`;
            }
        }
        else if (vals.mode === 'raport') {
            // ... (raport logic same as before)
            const rw = parseFloat(vals.raportWidth) || 0;
            const rh = parseFloat(vals.raportHeight) || 0;
            res.finalWidthM = rw;
            res.finalHeightM = rh;

            if (rw <= 0 || rh <= 0) {
                res.isValid = false;
            } else if (rw > max) {
                res.isValid = false;
                res.error = `Ancho raport (${rw.toFixed(2)}m) excede máximo (${max.toFixed(2)}m).`;
            } else if (w > max) {
                res.isValid = false;
                res.error = `Patrón original (${w.toFixed(2)}m) ancho > material.`;
            }

            if (w > 0 && h > 0) {
                res.repeatsX = rw / w;
                res.repeatsY = rh / h;
                res.observation = `[RAPORT] ORIG: ${w.toFixed(2)}x${h.toFixed(2)}m -> TRANSF: Repetición ${res.repeatsX.toFixed(1)}H x ${res.repeatsY.toFixed(1)}V -> FINAL: ${rw.toFixed(2)}x${rh.toFixed(2)}m`;
            }
        }
        return res;
    };

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
        <div className="bg-white rounded-xl shadow-sm border border-zinc-100 overflow-hidden">
            <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
                <AlertCircle size={14} className="text-zinc-400" />
                <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Configuración de Impresión</h4>
                <div className="h-px bg-zinc-200 flex-1"></div>
            </div>

            {/* Selector de Modo */}
            {!disableScaling && (
                <div className="flex bg-zinc-100 p-1 rounded-xl gap-1">
                    <button
                        type="button"
                        onClick={() => handleInputChange('mode', 'normal')}
                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${mode === 'normal' ? 'bg-white shadow-sm ring-1 ring-zinc-200 text-indigo-600' : 'text-zinc-500 hover:bg-zinc-200'}`}
                    >
                        <ImageIcon size={16} />
                        Normal
                    </button>
                    <button
                        type="button"
                        onClick={() => handleInputChange('mode', 'scale')}
                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${mode === 'scale' ? 'bg-white shadow-sm ring-1 ring-zinc-200 text-indigo-600' : 'text-zinc-500 hover:bg-zinc-200'}`}
                    >
                        <Maximize size={16} />
                        A Escala
                    </button>
                    <button
                        type="button"
                        onClick={() => handleInputChange('mode', 'raport')}
                        className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${mode === 'raport' ? 'bg-white shadow-sm ring-1 ring-zinc-200 text-indigo-600' : 'text-zinc-500 hover:bg-zinc-200'}`}
                    >
                        <Repeat size={16} />
                        Raport
                    </button>
                </div>
            )}

            {/* Panel de Configuración según Modo */}
            <div className="bg-white border boundary-zinc-200 rounded-xl p-4 shadow-sm relative overflow-hidden">

                {/* MODO NORMAL: Incluye Copias */}
                {mode === 'normal' && (
                    <div className="text-sm text-zinc-500 flex flex-col items-center text-center py-2 space-y-4">
                        <div className="w-full flex flex-col items-center">
                            <label className="block text-xs font-black text-zinc-500 mb-1 uppercase tracking-wider">Copias Impresas</label>
                            <input
                                type="number"
                                min="1"
                                value={copies}
                                onChange={(e) => onCopiesChange && onCopiesChange(parseInt(e.target.value) || 1)}
                                className="w-24 text-center p-2 border border-zinc-300 rounded-lg text-lg font-bold text-zinc-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>

                        <div className="w-full h-px bg-zinc-100 my-2"></div>

                        <div className="flex flex-col items-center cursor-help group">
                            <p className="font-medium text-zinc-800">Impresión Estándar (1:1)</p>
                            <p className="text-xs mt-1">Se imprimirá tal cual el archivo.</p>
                            <div className="mt-2 font-mono bg-zinc-50 px-3 py-1.5 rounded text-[10px] border border-zinc-200 group-hover:bg-indigo-50 group-hover:border-indigo-100 transition-colors">
                                Dim: {originalWidthM.toFixed(2)}m x {originalHeightM.toFixed(2)}m
                            </div>
                        </div>
                    </div>
                )}

                {/* MODO ESCALA */}
                {mode === 'scale' && (
                    <div className="space-y-4">
                        <div className="flex gap-4 items-start">
                            <div className="flex-1 space-y-3">
                                {/* Copies Input for Scale Mode */}
                                <div className="bg-zinc-50 p-2 rounded-lg border border-zinc-100 flex items-center justify-between">
                                    <label className="text-xs font-black text-zinc-500 uppercase tracking-wider">Copias:</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={copies}
                                        onChange={(e) => onCopiesChange && onCopiesChange(parseInt(e.target.value) || 1)}
                                        className="w-16 text-center p-1 border border-zinc-300 rounded font-bold text-zinc-800 focus:ring-2 focus:ring-indigo-500 outline-none h-8"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Escala del Diseño</label>
                                    <select
                                        value={selectedScale}
                                        onChange={(e) => handleInputChange('scale', e.target.value)}
                                        className="w-full p-2 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                                    >
                                        <option value="">Seleccionar Escala...</option>
                                        {SCALE_TABLE.map(s => (
                                            <option key={s.scale} value={s.scale}>
                                                Escala {s.label} ({s.scale}%)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {/* Reduced Final Width Display instead of Input */}
                                {selectedScale && (
                                    <div className="text-[10px] text-zinc-500 bg-zinc-50 p-2 rounded border border-zinc-100">
                                        Ancho Final: <strong>{(originalWidthM * (SCALE_TABLE.find(s => s.scale == parseInt(selectedScale))?.factor || 100) / 100).toFixed(2)}m</strong>
                                    </div>
                                )}
                            </div>

                            {/* Info Visual Escala */}
                            <div className="w-1/3 bg-indigo-50 rounded-lg p-3 hidden md:block border border-indigo-100">
                                <div className="flex justify-center mb-2 text-indigo-400">
                                    <Maximize size={24} />
                                </div>
                                <p className="text-[10px] text-indigo-800 leading-tight text-center font-bold">
                                    A Escala
                                </p>
                                <p className="text-[9px] text-indigo-600/80 text-center mt-1 leading-tight">
                                    Diseña en pequeño, nosotros lo ampliamos automáticamente.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* MODO RAPORT */}
                {mode === 'raport' && (
                    <div className="space-y-4">
                        <div className="flex gap-4 items-start">
                            <div className="flex-1 grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Ancho Total (m)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full p-2 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={raportWidth}
                                        onChange={(e) => handleInputChange('raportWidth', e.target.value)}
                                        placeholder={`Máx: ${materialMaxWidthM}`}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Largo Total (m)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full p-2 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={raportHeight}
                                        onChange={(e) => handleInputChange('raportHeight', e.target.value)}
                                        placeholder="Ej: 5.00"
                                    />
                                </div>
                                <div className="col-span-2 text-xs text-zinc-500 bg-zinc-50 p-2 rounded border border-zinc-200/50">
                                    {(raportWidth && raportHeight && originalWidthM > 0) ? (
                                        <p className="text-indigo-600 font-bold text-center">
                                            <i className="fa-solid fa-calculator mr-1"></i>
                                            Repeticiones: {(parseFloat(raportWidth) / originalWidthM).toFixed(1)} Horiz. x {(parseFloat(raportHeight) / originalHeightM).toFixed(1)} Vert.
                                        </p>
                                    ) : (
                                        <p className="text-center italic">Define área para ver repeticiones</p>
                                    )}
                                </div>
                            </div>

                            {/* Info Visual Raport */}
                            <div className="w-1/3 bg-purple-50 rounded-lg p-3 hidden md:block border border-purple-100">
                                <div className="flex justify-center mb-2 text-purple-400">
                                    <Repeat size={24} />
                                </div>
                                <p className="text-[10px] text-purple-800 leading-tight text-center font-bold">
                                    Raport Infinito
                                </p>
                                <p className="text-[9px] text-purple-600/80 text-center mt-1 leading-tight">
                                    Tu patrón se repetirá en mosaico hasta llenar el área.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Mensaje de Error / Info Global */}
            {values.error && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-xs font-bold animate-pulse">
                    <AlertCircle size={16} />
                    {values.error}
                </div>
            )}
            {values.isValid && values.observation && (
                <div className="flex items-start gap-2 text-emerald-700 bg-emerald-50 p-3 rounded-lg text-xs font-medium border border-emerald-100">
                    <div className="mt-0.5"><i className="fa-solid fa-check-circle"></i></div>
                    <div>
                        <span className="font-bold block text-emerald-800 mb-0.5">Configuración Válida</span>
                        {values.observation}
                    </div>
                </div>
            )}
        </div>
    );
};
