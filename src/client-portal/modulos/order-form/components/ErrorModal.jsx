import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

export const ErrorModal = ({ isOpen, onClose, message }) => {
    if (!isOpen) return null;
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 border-2 border-red-100 animate-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-500 mb-2">
                        <AlertTriangle size={32} />
                    </div>
                    <h3 className="text-xl font-black text-zinc-800 uppercase tracking-tight">
                        Error de Validación
                    </h3>
                    <p className="text-sm text-zinc-600 font-medium leading-relaxed">
                        {message}
                    </p>
                    <button
                        onClick={onClose}
                        className="mt-4 w-full py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl transition-colors shadow-lg hover:shadow-red-500/30"
                    >
                        ENTENDIDO
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ErrorModal;
