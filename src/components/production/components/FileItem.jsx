import React from 'react';
import { API_URL } from '../../../services/apiClient';

/**
 * Componente "FileItem" Unificado.
 * Representa un archivo de producción con soporte para acciones o modo solo lectura.
 * 
 * Props:
 * - file: Objeto archivo completo
 * - readOnly: true para Visualizador (sin botones), false para Panel de Control
 * - onAction: (fileId, action) => void
 * - extraInfo: Objeto opcional { roll, machine } para mostrar contexto extra
 */
const FileItem = ({ file, readOnly = false, onAction, extraInfo, actions, editingContent }) => {
    // DEBUG: Ver qué llega realmente desde el Backend
    // console.log("FileItem Debug - File Object:", file);

    // Lógica de Estado
    const status = (file.Estado || file.EstadoArchivo || file.EstadoControl || file.status || '').toUpperCase().trim();
    const isControlled = ['OK', 'FINALIZADO', 'FALLA', 'CANCELADO'].includes(status);

    // Cálculos
    const metrosUnit = parseFloat(file.Metros || file.metros || file.width || 0);
    const copias = parseInt(file.Copias || file.copias || file.cantidad || 1);
    const metrosTotal = (metrosUnit * copias).toFixed(2);
    const anchoRaw = parseFloat(file.Ancho || file.ancho || 0);
    const altoRaw = parseFloat(file.Alto || file.alto || 0);

    // Estilos dinámicos según estado
    const getStatusStyles = () => {
        switch (status) {
            case 'OK':
            case 'FINALIZADO': return { container: 'bg-emerald-50/50 border-emerald-100', text: 'text-emerald-600', dot: 'bg-emerald-500' };
            case 'FALLA': return { container: 'bg-red-50/50 border-red-100', text: 'text-red-500', dot: 'bg-red-500' };
            case 'CANCELADO': return { container: 'bg-red-50 border-red-200 opacity-75', text: 'text-red-500', dot: 'bg-red-500' };
            case 'EN PROCESO': return { container: 'bg-blue-50 border-blue-100', text: 'text-blue-600', dot: 'bg-blue-500 animate-pulse' };
            default: return { container: 'bg-white border-slate-100 hover:border-blue-200', text: 'text-slate-500', dot: 'bg-slate-300' };
        }
    };

    const styles = getStatusStyles();

    // Lógica Visual
    // Render-time URL (Best effort para UI)
    // PRIORIZAMOS PROXY DE BACKEND PARA DRIVE
    const getBaseFileUrl = () => {
        if (file.urlProxy) {
            // Si el backend envió un proxy, lo usamos inyectando el baseURL si es necesario
            const base = API_URL.endsWith('/api') ? API_URL.replace('/api', '') : API_URL;
            return `${base}${file.urlProxy}`;
        }
        return file.url || file.link || file.RutaAlmacenamiento || file.Link || '#';
    };

    const fileUrl = getBaseFileUrl();

    // Action-time URL (Evaluación en caliente para evitar problemas de reactividad/mutación)
    const getLiveUrl = () => {
        if (file.urlProxy) return fileUrl;
        // Prioridad de búsqueda (Ignorando valores títere como '#')
        const candidates = [
            file.url,
            file.link,
            file.Link,
            file.RutaAlmacenamiento,
            file.rutaAlmacenamiento,
            file.Ruta,
            fileUrl
        ];
        return candidates.find(c => c && c.trim() !== '' && c !== '#');
    };

    const isImage = fileUrl.match(/\.(jpeg|jpg|gif|png|webp|bmp)$/i);
    const isPdf = fileUrl.match(/\.(pdf)$/i);

    // Helper para intentar forzar la descarga con nombre (Best Effort)
    const triggerDownload = (url, fileName) => {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || 'archivo';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Lógica Icono Estado
    const getStatusIconInfo = () => {
        switch (status) {
            case 'OK':
            case 'FINALIZADO': return { icon: 'fa-check', color: 'text-emerald-500', border: 'border-emerald-200' };
            case 'FALLA': return { icon: 'fa-circle-exclamation', color: 'text-red-500', border: 'border-red-200' };
            case 'CANCELADO': return { icon: 'fa-ban', color: 'text-red-500', border: 'border-red-200' };
            default: return null;
        }
    };
    const statusInfo = getStatusIconInfo();

    return (
        <div className={`group flex items-center p-2.5 rounded-xl border transition-all mb-2 relative hover:z-20 ${styles.container}`}>

            {/* 1. Icono / Preview Inteligente */}
            <div className="relative shrink-0 mr-3 group/preview">
                <a
                    href={fileUrl} // Mantenemos href visual
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const realUrl = getLiveUrl();
                        if (realUrl && realUrl !== '#') triggerDownload(realUrl, file.name || file.nombre);
                    }}
                    className="w-10 h-10 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400 font-bold overflow-hidden cursor-pointer hover:border-blue-300 transition-colors block relative"
                >
                    {isImage ? (
                        <img src={fileUrl} alt="prev" className="w-full h-full object-cover opacity-80" />
                    ) : (
                        <i className={`fa-regular ${isPdf ? 'fa-file-pdf text-red-400' : 'fa-file-image'} text-lg`}></i>
                    )}

                    {/* Badge Copias */}
                    <div className="absolute top-0 right-0 bg-slate-800 text-white text-[9px] font-bold px-1 rounded-bl-md shadow-sm z-20">
                        {copias}x
                    </div>
                </a>

                {/* Status Icon Overlay (Fuera del 'a' o superpuesto posicionado relativo al contenedor padre) */}
                {statusInfo && (
                    <div className="absolute -bottom-1 -right-1 z-30 group/status cursor-help">
                        <div className={`w-5 h-5 rounded-full bg-white shadow-sm flex items-center justify-center border ${statusInfo.border}`}>
                            <i className={`fa-solid ${statusInfo.icon} ${statusInfo.color} text-[10px]`}></i>
                        </div>

                        {/* Tooltip Observaciones */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 w-max max-w-[150px] px-2 py-1 bg-slate-800 text-white text-[9px] rounded opacity-0 group-hover/status:opacity-100 pointer-events-none transition-opacity z-50 text-center shadow-lg">
                            <span className="font-bold block uppercase mb-0.5 opacity-75">{status}</span>
                            {file.Observaciones || file.MotivoFalla || 'Sin observaciones'}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                        </div>
                    </div>
                )}

                {/* HOVER PREVIEW POPUP */}
                <div className="absolute bottom-full left-0 mb-2 invisible group-hover/preview:visible opacity-0 group-hover/preview:opacity-100 transition-all duration-200 z-50">
                    <div className="w-48 bg-white rounded-xl shadow-2xl border border-slate-100 p-2 transform origin-bottom-left">
                        <div className="rounded-lg overflow-hidden bg-slate-100 border border-slate-200 mb-2 flex items-center justify-center min-h-[100px]">
                            {isImage ? (
                                <img src={fileUrl} className="w-full h-auto" alt="preview" />
                            ) : (
                                <div className="text-center py-4">
                                    <i className={`fa-solid ${isPdf ? 'fa-file-pdf text-red-400' : 'fa-file-arrow-down text-slate-300'} text-3xl mb-2`}></i>
                                    <div className="text-[10px] text-slate-400">Clic para abrir</div>
                                </div>
                            )}
                        </div>
                        <a
                            href={fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (fileUrl === '#') {
                                    e.preventDefault();
                                    alert(`No hay archivo válido asociado. (Link: "${fileUrl}")`);
                                }
                            }}
                            className="w-full py-1 bg-slate-800 text-white text-[10px] font-bold rounded hover:bg-slate-700 flex items-center justify-center gap-2"
                        >
                            <i className="fa-solid fa-download"></i> Descargar / Ver
                        </a>
                    </div>
                </div>
            </div>

            {/* 2. Información Principal */}
            <div className="min-w-0 flex-1 pr-2">
                <div className="flex items-center justify-between">
                    <div className={`font-bold text-sm truncate ${styles.text}`} title={file.NombreArchivo}>
                        {file.NombreArchivo || file.name}
                    </div>
                </div>

                {/* Metadata Row: Swappable for Editing Content */}
                {actions && typeof editingContent !== 'undefined' && editingContent ? (
                    // MODO EDICIÓN INLINE (Inyectado desde fuera)
                    <div className="mt-1 animate-in fade-in slide-in-from-left-2 duration-200">
                        {editingContent}
                    </div>
                ) : (
                    // MODO LECTURA HABITUAL
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-slate-500 mt-1 leading-tight">

                        <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-xs font-bold text-slate-700">
                            {copias} copias
                        </span>

                        {/* Medidas o Cantidad Unitaria */}
                        {(anchoRaw > 0 && altoRaw > 0) ? (
                            <div className="flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                <span className="text-[9px] font-bold text-slate-400 uppercase">Medidas:</span>
                                <span className="font-bold text-slate-700">
                                    {anchoRaw} x {altoRaw} <span className="text-[9px] text-slate-400">{extraInfo?.um || 'm'}</span>
                                </span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-slate-100">
                                <span className="text-[9px] font-bold text-slate-400 uppercase">Cant/Unit:</span>
                                <span className="font-bold text-slate-700">{metrosUnit} {extraInfo?.um || 'm'}</span>
                            </div>
                        )}

                        {/* Total */}
                        <div className="flex items-center gap-1 ml-2 pl-2 border-l border-slate-200">
                            <span className="text-slate-400 text-[9px] uppercase font-bold">Total:</span>
                            <span className="font-black text-blue-600">
                                {metrosTotal} {extraInfo?.um || 'm'}
                            </span>
                        </div>

                        {file.Material && (
                            <>
                                <span className="text-slate-300 ml-1">•</span>
                                <span className="truncate max-w-[150px]" title={file.Material}>{file.Material}</span>
                            </>
                        )}

                        {/* Información Extra (Contexto de visualizador) - ICONOS */}
                        {extraInfo && (
                            <div className="flex items-center gap-2 ml-auto lg:ml-2 pl-2 border-l border-slate-200">
                                {extraInfo.roll && (
                                    <div className="flex items-center gap-1 group/roll cursor-help relative">
                                        <i className="fa-solid fa-scroll text-indigo-400 hover:text-indigo-600 transition-colors"></i>
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-800 text-white text-[9px] rounded opacity-0 group-hover/roll:opacity-100 pointer-events-none whitespace-nowrap z-40 shadow-lg">
                                            Rollo: {extraInfo.roll}
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                                        </div>
                                    </div>
                                )}
                                {extraInfo.machine && (
                                    <div className="flex items-center gap-1 group/mac cursor-help relative">
                                        <i className="fa-solid fa-print text-cyan-500 hover:text-cyan-600 transition-colors"></i>
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-800 text-white text-[9px] rounded opacity-0 group-hover/mac:opacity-100 pointer-events-none whitespace-nowrap z-40 shadow-lg">
                                            Eq: {extraInfo.machine}
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 3. Acciones o Estado */}
            <div className="shrink-0 flex items-center gap-2 pl-2 border-l border-slate-100/50">
                {actions ? actions : (
                    !readOnly && !isControlled ? (
                        // MODO INTERACTIVO (Botones)
                        <div className="flex gap-1.5">
                            <ActionButton
                                icon="fa-ban"
                                color="slate"
                                onClick={() => onAction(file, 'CANCELADO')}
                                title="Cancelar / No Imprimir"
                            />
                            <ActionButton
                                icon="fa-triangle-exclamation"
                                color="red"
                                onClick={() => onAction(file, 'FALLA')}
                                title="Reportar Falla"
                            />
                            <ActionButton
                                icon="fa-check"
                                color="emerald"
                                onClick={() => onAction(file, 'OK')}
                                title="Marcar OK (Listo)"
                            />
                        </div>
                    ) : (
                        // MODO READONLY o YA CONTROLADO (Badge de Estado)
                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${status ? 'bg-white/60 shadow-sm' : 'bg-transparent border-transparent'}`}>
                            <div className={`w-2 h-2 rounded-full ${styles.dot}`}></div>
                            {status && <span className={`text-[9px] font-black uppercase tracking-wider ${styles.text}`}>{status}</span>}
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

// Accion Button Helper
export const ActionButton = ({ icon, color, onClick, title }) => {
    const colors = {
        slate: 'border-slate-200 text-slate-300 hover:bg-slate-100 hover:text-slate-600',
        red: 'border-red-100 text-red-300 hover:bg-red-50 hover:text-red-500 hover:border-red-200',
        emerald: 'border-emerald-100 text-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200',
        blue: 'border-blue-100 text-blue-400 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200',
        amber: 'border-amber-100 text-amber-400 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200'
    };
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 ${colors[color] || colors.slate}`}
            title={title}
        >
            <i className={`fa-solid ${icon} text-xs`}></i>
        </button>
    );
};

export default FileItem;
