import React from 'react';
import { createPortal } from 'react-dom';
import { UploadCloud, AlertTriangle, Zap } from 'lucide-react';

export const UploadProgressModal = ({ isOpen, progress, isError, onRetry }) => {
    if (!isOpen) return null;
    const percentage = Math.round((progress.current / progress.total) * 100) || 0;

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 border border-zinc-100 relative overflow-hidden">
                {/* Background Decoration */}
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 animate-gradient-x" />

                <div className="flex flex-col items-center text-center gap-6 relative z-10">
                    {isError ? (
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-2 animate-bounce">
                            <AlertTriangle size={40} />
                        </div>
                    ) : (
                        <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 mb-2 relative">
                            <UploadCloud size={40} className="animate-pulse" />
                            <div className="absolute inset-0 rounded-full border-4 border-blue-100 border-t-blue-500 animate-spin" />
                        </div>
                    )}

                    <div>
                        <h3 className="text-2xl font-black text-zinc-800 tracking-tight mb-2">
                            {isError ? '¡Ups! Algo falló' : 'Subiendo tus archivos'}
                        </h3>
                        <p className="text-sm text-zinc-500 font-medium">
                            {isError
                                ? 'Hubo un problema al subir uno de los archivos. No te preocupes, puedes reintentar.'
                                : `Por favor no cierres esta ventana. Estamos enviando ${progress.current} de ${progress.total} archivos a producción.`}
                        </p>
                    </div>

                    {!isError && (
                        <div className="w-full space-y-2">
                            <div className="flex justify-between text-xs font-bold text-zinc-400 uppercase tracking-wider">
                                <span>Progreso Total</span>
                                <span>{percentage}%</span>
                            </div>
                            <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500 ease-out"
                                    style={{ width: `${percentage}%` }}
                                />
                            </div>
                            <p className="text-xs text-zinc-400 truncate mt-2 font-mono bg-zinc-50 py-1 px-2 rounded-lg border border-zinc-100">
                                {progress.filename || 'Preparando...'}
                            </p>
                        </div>
                    )}

                    {isError && (
                        <button
                            onClick={onRetry}
                            className="mt-2 w-full py-4 bg-zinc-900 hover:bg-black text-white font-black rounded-2xl transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-2"
                        >
                            <Zap size={20} />
                            REINTENTAR AHORA
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default UploadProgressModal;
