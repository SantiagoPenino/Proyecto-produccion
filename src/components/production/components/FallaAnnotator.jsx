import React, { useState, useEffect } from 'react';
import FallaZoomModal from './FallaZoomModal';

/**
 * Vista previa del archivo en el modal de falla. Al hacer click se abre un modal grande
 * (90% del viewport) con zoom/paneo para marcar con precisión las zonas de la falla.
 * Al guardar, llama onAnnotated(dataUrl|null) con la imagen compuesta (thumbnail + recuadros)
 * en resolución natural, lista para persistir.
 */
// onDisponible(true|false): avisa si hay vista previa para marcar. Con ella, el modal de falla de
// Sublimación exige marcar la zona (13/10/2026: solo 202 de 459 fallas del último mes la tenían).
export default function FallaAnnotator({ thumbUrl, onAnnotated, onDisponible }) {
    const [imgOk, setImgOk] = useState(true);
    const [annotated, setAnnotated] = useState(null);   // dataURL compuesto
    const [rects, setRects] = useState([]);             // zonas (coords naturales) para reeditar
    const [open, setOpen] = useState(false);

    // Si cambia el archivo, arrancar limpio (no arrastrar marcas de otro archivo).
    useEffect(() => {
        setImgOk(true); setAnnotated(null); setRects([]); setOpen(false);
        onAnnotated && onAnnotated(null);
        onDisponible && onDisponible(false);   // hasta que la vista previa cargue
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thumbUrl]);

    if (!imgOk) {
        return (
            <div className="text-xs text-slate-400 italic py-6 text-center border border-dashed border-slate-200 rounded-xl">
                Sin vista previa disponible para este archivo.
            </div>
        );
    }

    const handleSave = (url, savedRects) => {
        setAnnotated(url);
        setRects(savedRects || []);
        onAnnotated && onAnnotated(url);
        setOpen(false);
    };
    const clear = () => { setAnnotated(null); setRects([]); onAnnotated && onAnnotated(null); };

    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="relative block w-full rounded-lg overflow-hidden bg-slate-100 border border-slate-200 group"
                title="Click para ampliar y marcar zonas"
            >
                <img
                    src={annotated || thumbUrl}
                    alt="archivo"
                    className="max-w-full max-h-[240px] mx-auto block object-contain"
                    onLoad={() => { if (!annotated) onDisponible && onDisponible(true); }}
                    onError={() => { setImgOk(false); onDisponible && onDisponible(false); }}
                    draggable={false}
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                    <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-bold bg-[#EC008C] px-3 py-1.5 rounded-full shadow-lg">
                        🔍 Ampliar y marcar zonas
                    </span>
                </span>
            </button>

            <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-slate-400">
                    {rects.length > 0 ? `${rects.length} zona(s) marcada(s)` : 'Click en la imagen para marcar la zona de la falla.'}
                </span>
                {annotated && (
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-bold text-slate-500 hover:text-[#BD0C7E]">Editar</button>
                        <button type="button" onClick={clear} className="text-[11px] font-bold text-slate-500 hover:text-[#BD0C7E]">Limpiar</button>
                    </div>
                )}
            </div>

            {open && (
                <FallaZoomModal
                    thumbUrl={thumbUrl}
                    initialRects={rects}
                    onSave={handleSave}
                    onClose={() => setOpen(false)}
                />
            )}
        </div>
    );
}
