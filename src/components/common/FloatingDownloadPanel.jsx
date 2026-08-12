import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadManager } from '../../utils/downloadManager';
import { socket } from '../../services/socketService';

const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const FloatingDownloadPanel = () => {
    const [state, setState] = useState(downloadManager.state);
    const [speedBytes, setSpeedBytes] = useState(0);
    const [lastBytes, setLastBytes] = useState(0);
    const [minimized, setMinimized] = useState(false);
    // null = posición default (abajo a la derecha); {x, y} cuando el usuario lo arrastró.
    // Va en un ref, no en estado: durante el drag se mueve el DOM directo (un setState por
    // pointermove renderiza el panel entero 60 veces por segundo y se siente con lag), y los
    // re-renders que dispara el progreso leen de acá, así no pisan la posición mientras arrastrás.
    const posRef = useRef(null);
    const panelRef = useRef(null);
    const dragCleanupRef = useRef(null);
    const wasActiveRef = useRef(false);

    useEffect(() => {
        const unsubscribe = downloadManager.subscribe(setState);

        const handleZipProgress = (data) => {
            if (downloadManager.state.phase === 'downloading') {
                downloadManager.updateSubTask(`Empaquetando: ${data.currentFile} de ${data.totalFiles}`);
            }
        };

        socket.on('zip:progress', handleZipProgress);

        return () => {
            unsubscribe();
            socket.off('zip:progress', handleZipProgress);
            // Si el panel se desmonta en pleno arrastre, descolgar los listeners de window
            if (dragCleanupRef.current) dragCleanupRef.current();
        };
    }, []);

    // Una descarga nueva siempre arranca restaurada (si quedó minimizado de la anterior)
    useEffect(() => {
        if (state.isActive && !wasActiveRef.current) setMinimized(false);
        wasActiveRef.current = state.isActive;
    }, [state.isActive]);

    // Calcular velocidad de descarga
    useEffect(() => {
        // También en 'processing': la descarga archivo-por-archivo reporta bytes en esa fase y sin
        // esto la velocidad quedaba siempre en 0.
        if (state.phase !== 'downloading' && state.phase !== 'processing') {
            setSpeedBytes(0);
            setLastBytes(0);
            return;
        }

        const interval = setInterval(() => {
            // Al pasar al archivo siguiente los bytes vuelven a 0 → el delta da negativo: se ignora.
            setSpeedBytes(Math.max(0, state.bytesDownloaded - lastBytes));
            setLastBytes(state.bytesDownloaded);
        }, 1000);

        return () => clearInterval(interval);
    }, [state.phase, state.bytesDownloaded, lastBytes]);

    // Arrastre desde el header (pointer events: cubre mouse y touch)
    const startDrag = (e) => {
        if (e.target.closest('button')) return; // los botones del header no arrastran
        const el = panelRef.current;
        if (!el) return;
        e.preventDefault(); // sin selección de texto ni drag nativo mientras se mueve
        const rect = el.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const onMove = (ev) => {
            const x = Math.min(Math.max(ev.clientX - dx, 8), window.innerWidth - rect.width - 8);
            const y = Math.min(Math.max(ev.clientY - dy, 8), window.innerHeight - rect.height - 8);
            posRef.current = { x, y };
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            dragCleanupRef.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        dragCleanupRef.current = onUp;
    };

    if (!state.isActive) return null;

    const isWorking = state.phase === 'downloading' || state.phase === 'processing';

    // Calcular porcentaje de descarga
    const unknownTotal = state.phase === 'downloading' && state.totalBytes === 0;
    let percentage = 0;
    if (state.phase === 'downloading' && state.totalBytes > 0) {
        percentage = Math.round((state.bytesDownloaded / state.totalBytes) * 100);
    } else if (state.phase === 'processing' && state.totalFiles > 0) {
        percentage = Math.round((state.currentFile / state.totalFiles) * 100);
    } else if (state.phase === 'done') {
        percentage = 100;
    }

    // Calcular ETA
    let etaSeconds = 0;
    if (state.phase === 'downloading' && speedBytes > 0 && state.totalBytes > 0) {
        const remainingBytes = state.totalBytes - state.bytesDownloaded;
        etaSeconds = Math.max(0, Math.round(remainingBytes / speedBytes));
    }

    const formatSpeed = (bps) => {
        if (bps <= 0) return '';
        if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
        return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    };

    const formatETA = (seconds) => {
        if (seconds === 0 || !isFinite(seconds)) return '';
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    };

    const pos = posRef.current;
    const posStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {};

    // ── Minimizado: pastilla compacta, click para restaurar ──
    if (minimized) {
        return createPortal(
            <button
                onClick={() => setMinimized(false)}
                style={posStyle}
                title="Restaurar panel de descarga"
                className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-full border border-slate-100 pl-2 pr-4 py-2 hover:bg-slate-50 transition-colors"
            >
                {state.phase === 'error' ? (
                    <span className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-red-500">
                        <i className="fa-solid fa-xmark text-xs"></i>
                    </span>
                ) : state.phase === 'done' ? (
                    <span className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-500">
                        <i className="fa-solid fa-check text-xs"></i>
                    </span>
                ) : (
                    <span className="w-7 h-7 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-600 animate-pulse">
                        <i className="fa-solid fa-cloud-arrow-down text-xs"></i>
                    </span>
                )}
                <span className="text-xs font-bold text-slate-700">
                    {state.phase === 'error' ? 'Error' :
                     state.phase === 'done' ? 'Listo' :
                     state.phase === 'processing' && state.totalFiles > 0 ? `${state.currentFile}/${state.totalFiles}` :
                     unknownTotal ? 'Descargando…' : `${percentage}%`}
                </span>
            </button>,
            document.body
        );
    }

    // Sin transition-all en el contenedor: animaba cada cambio de posición con 300ms
    // de easing y el drag se sentía con lag (el panel "perseguía" al mouse).
    return createPortal(
        <div ref={panelRef} style={posStyle} className="fixed bottom-6 right-6 z-[9999] w-80 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-2xl border border-slate-100 overflow-hidden flex flex-col">
            {/* Header — arrastrable para mover el panel */}
            <div onPointerDown={startDrag} style={{ touchAction: 'none' }} className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center cursor-move select-none">
                <div className="flex items-center gap-2">
                    {state.phase === 'error' ? (
                        <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-500">
                            <i className="fa-solid fa-xmark"></i>
                        </div>
                    ) : state.phase === 'done' ? (
                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-500">
                            <i className="fa-solid fa-check"></i>
                        </div>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-600 animate-pulse">
                            <i className="fa-solid fa-cloud-arrow-down"></i>
                        </div>
                    )}
                    <div>
                        <h4 className="text-sm font-bold text-slate-800 leading-tight">
                            {state.phase === 'error' ? 'Error en la descarga' :
                             state.phase === 'done' ? 'Descarga Completada' :
                             state.taskName || 'Descargando Archivos...'}
                        </h4>
                        <p className="text-[11px] font-medium text-slate-500">
                            {state.subTaskName ? state.subTaskName : (
                             state.phase === 'downloading' ? 'Obteniendo del servidor...' :
                             state.phase === 'processing' ? 'Guardando en PC...' :
                             state.phase === 'done' ? 'Listo' : 'Ocurrió un problema')}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setMinimized(true)} title="Minimizar" className="text-slate-400 hover:text-slate-600 transition-colors h-6 w-6 flex justify-center items-center rounded-full hover:bg-slate-200">
                        <i className="fa-solid fa-minus text-sm"></i>
                    </button>
                    <button onClick={() => downloadManager.close()} title="Ocultar" className="text-slate-400 hover:text-slate-600 transition-colors h-6 w-6 flex justify-center items-center rounded-full hover:bg-slate-200">
                        <i className="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3">
                {state.phase === 'error' ? (
                    <p className="text-xs text-red-600 font-medium">{state.errorMsg}</p>
                ) : (
                    <>
                        {/* Progress Bar */}
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            {unknownTotal ? (
                                // Barra indeterminada animada cuando no se conoce el total
                                <div
                                    className="h-full bg-cyan-500 rounded-full"
                                    style={{
                                        width: '40%',
                                        animation: 'indeterminate-progress 1.5s ease-in-out infinite',
                                    }}
                                />
                            ) : (
                                <div
                                    className={`h-full transition-all duration-300 ease-out ${state.phase === 'done' ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                                    style={{ width: `${percentage}%` }}
                                />
                            )}
                        </div>
                        <style>{`
                            @keyframes indeterminate-progress {
                                0% { transform: translateX(-150%); }
                                100% { transform: translateX(350%); }
                            }
                        `}</style>

                        {/* Details */}
                        <div className="flex justify-between items-center text-[11px] font-bold text-slate-500">
                            {state.phase === 'downloading' ? (
                                <>
                                    <span>{formatBytes(state.bytesDownloaded)}{state.totalBytes > 0 ? ` / ${formatBytes(state.totalBytes)}` : ' descargados'}</span>
                                    {speedBytes > 0 && <span className="text-cyan-600">{formatSpeed(speedBytes)}</span>}
                                    {etaSeconds > 0 && <span className="text-cyan-600">Faltan {formatETA(etaSeconds)}</span>}
                                </>
                            ) : state.phase === 'processing' ? (
                                <>
                                    <span>Archivo {state.currentFile} de {state.totalFiles}</span>
                                    {/* Bytes del archivo EN CURSO: sin esto, bajando uno pesado el panel
                                        quedaba clavado en "Archivo 3 de 11" y parecía colgado. */}
                                    {state.bytesDownloaded > 0 && (
                                        <span className="text-cyan-600">
                                            {formatBytes(state.bytesDownloaded)}{state.totalBytes > 0 ? ` / ${formatBytes(state.totalBytes)}` : ''}
                                        </span>
                                    )}
                                    {speedBytes > 0 && <span className="text-cyan-600">{formatSpeed(speedBytes)}</span>}
                                    <span>{percentage}%</span>
                                </>
                            ) : state.phase === 'done' ? (
                                <span className="text-emerald-600">Todo guardado correctamente.</span>
                            ) : null}
                        </div>

                        {/* Cancelar la descarga en curso (aborta de verdad, no solo esconde el panel) */}
                        {isWorking && state.cancellable && (
                            <button
                                onClick={() => downloadManager.cancel()}
                                className="w-full text-[11px] font-bold text-red-500 hover:text-red-600 hover:bg-red-50 border border-red-100 rounded-lg py-1.5 transition-colors"
                            >
                                <i className="fa-solid fa-ban mr-1.5"></i>Cancelar descarga
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>,
        document.body
    );
};
