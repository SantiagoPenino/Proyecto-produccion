import React from 'react';

/**
 * Componente "FileItem" Simplificado para Referencias.
 * Muestra visualización del archivo (imagen/icono), nombre, tipo y botón de descarga.
 * Ideal para adjuntos, bocetos, logos y guías.
 * 
 * Props:
 * - file: Objeto de referencia con { nombre, link, tipo }
 */
const ReferenceItem = ({ file }) => {

    // Render-time URL (Best effort)
    const fileUrl = file.link || file.url || file.RutaAlmacenamiento || '#';
    const isImage = fileUrl.match(/\.(jpeg|jpg|gif|png|webp|bmp)$/i);
    const isPdf = fileUrl.match(/\.(pdf)$/i);
    const fileName = file.nombre || file.NombreArchivo || 'Referencia';

    // Helper de descarga
    const triggerDownload = (e) => {
        e.stopPropagation();
        const link = document.createElement('a');
        link.href = fileUrl;
        link.download = fileName;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl hover:shadow-sm hover:border-slate-300 transition-all group">

            {/* 1. Icono / Miniatura */}
            <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center overflow-hidden shrink-0 relative">
                {isImage ? (
                    <img src={fileUrl} alt="ref" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                ) : (
                    <i className={`fa-regular ${isPdf ? 'fa-file-pdf text-red-400' : 'fa-image text-slate-400'} text-xl`}></i>
                )}

                {/* Overlay Hover Zoom */}
                {isImage && (
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <i className="fa-solid fa-expand text-white text-xs"></i>
                    </a>
                )}
            </div>

            {/* 2. Info Principal */}
            <div className="flex-1 min-w-0">
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-sm text-slate-700 hover:text-blue-600 truncate block transition-colors" title={fileName}>
                    {fileName}
                </a>
                <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 uppercase tracking-wide">
                        {file.tipo || 'ADJUNTO'}
                    </span>
                    {file.notas && (
                        <span className="text-[10px] text-slate-400 truncate max-w-[200px]" title={file.notas}>
                            {file.notas}
                        </span>
                    )}
                </div>
            </div>

            {/* 3. Acciones (Descargar) */}
            <button
                onClick={triggerDownload}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 hover:bg-white hover:text-blue-500 hover:shadow border border-transparent hover:border-blue-100 transition-all"
                title="Descargar Original"
            >
                <i className="fa-solid fa-download text-xs"></i>
            </button>
        </div>
    );
};

export default ReferenceItem;
