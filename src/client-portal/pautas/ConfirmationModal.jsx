import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, Check, Info } from 'lucide-react';

export const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, type = 'warning', confirmText = 'Aceptar', cancelText = 'Cancelar' }) => {
    if (!isOpen) return null;

    // Colores e Iconos según el tipo
    const styles = {
        danger: {
            icon: <AlertTriangle size={32} className="text-rose-500" />,
            bgIcon: 'bg-rose-500/15',
            btnConfirm: 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-900/40',
            border: 'border-rose-500/30'
        },
        warning: {
            icon: <AlertTriangle size={32} className="text-brand-magenta" />,
            bgIcon: 'bg-brand-magenta/15',
            btnConfirm: 'bg-brand-magenta hover:bg-brand-magenta/90 text-white shadow-brand-magenta/20',
            border: 'border-brand-magenta/30'
        },
        info: {
            icon: <Info size={32} className="text-blue-500" />,
            bgIcon: 'bg-blue-500/15',
            btnConfirm: 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-900/40',
            border: 'border-blue-500/30'
        },
        success: {
            icon: <Check size={32} className="text-emerald-500" />,
            bgIcon: 'bg-emerald-500/15',
            btnConfirm: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-900/40',
            border: 'border-emerald-500/30'
        }
    };

    const currentStyle = styles[type] || styles.warning;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">

            {/* Overlay Oscuro con Blur */}
            <div
                className="absolute inset-0 bg-black/70 transition-opacity"
                onClick={onClose}
            ></div>

            {/* Modal Card */}
            <div className={`relative bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 border ${currentStyle.border}`}>

                {/* Botón cerrar esquina */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 p-1 rounded-full transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="p-8 flex flex-col items-center text-center">

                    {/* Icono Grande */}
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 ${currentStyle.bgIcon}`}>
                        {currentStyle.icon}
                    </div>

                    {/* Título y Mensaje */}
                    <h3 className="text-xl font-black text-white tracking-tight mb-3">
                        {title}
                    </h3>

                    <p className="text-sm font-medium text-zinc-400 leading-relaxed mb-8 whitespace-pre-line">
                        {message}
                    </p>

                    {/* Botones de Acción */}
                    <div className="flex gap-3 w-full">
                        <button
                            onClick={onClose}
                            className="flex-1 py-2.5 px-4 bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm font-bold rounded-xl hover:bg-zinc-800 hover:border-zinc-600 transition-all focus:ring-2 focus:ring-zinc-700 focus:outline-none"
                        >
                            {cancelText}
                        </button>

                        <button
                            onClick={() => {
                                onConfirm();
                                onClose();
                            }}
                            className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-900 focus:outline-none ${currentStyle.btnConfirm}`}
                        >
                            {confirmText}
                        </button>
                    </div>

                </div>
            </div>
        </div>,
        document.body
    );
};
