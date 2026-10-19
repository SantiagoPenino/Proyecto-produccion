import React from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';

// Pantalla del visor 3D mientras todavía no hay visor: se baja el código del visor (three.js,
// pdf.js) y, en las órdenes de matriz propia, el backend trae de Drive el vector del cliente y
// lo analiza. Son varios segundos; sin esto el botón parecía no hacer nada. Va en un archivo
// aparte (liviano) para poder usarla como fallback del React.lazy del visor.
const Tpu3DCargando = ({ onClose }) => createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center gap-3 text-zinc-400">
        {onClose && (
            <button type="button" onClick={onClose} aria-label="Cerrar"
                className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors">
                <X size={22} />
            </button>
        )}
        <Loader2 size={28} className="animate-spin text-cyan-400" />
        <span className="text-xs font-bold uppercase tracking-wide">Abriendo el visor 3D…</span>
    </div>,
    document.body
);

export default Tpu3DCargando;
