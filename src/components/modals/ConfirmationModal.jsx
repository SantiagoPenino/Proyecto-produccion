import React from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirmar", cancelText = "Cancelar", isDestructive = false }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-zinc-900/60 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-zinc-100">
                <div className="px-5 py-4 flex justify-between items-center border-b border-zinc-50">
                    <h3 className="text-[15px] font-bold text-zinc-800 flex items-center gap-2">
                        <HelpCircle size={18} className={isDestructive ? "text-brand-magenta" : "text-brand-cyan"} />
                        {title}
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-400 transition-colors">
                        <X size={16} />
                    </button>
                </div>
                <div className="p-5">
                    <p className="text-sm text-zinc-600 mb-6 whitespace-pre-line leading-relaxed">
                        {message}
                    </p>
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-500 hover:bg-zinc-100 transition-colors"
                        >
                            {cancelText}
                        </button>
                        <button
                            onClick={() => {
                                onConfirm();
                                onClose();
                            }}
                            className={`px-4 py-2 rounded-xl text-sm font-bold text-white shadow-lg transition-all transform active:scale-95 hover:-translate-y-0.5 ${isDestructive ? 'bg-brand-magenta hover:bg-brand-magenta/90 shadow-brand-magenta/30' : 'bg-brand-cyan hover:bg-brand-cyan/90 shadow-brand-cyan/30'}`}
                        >
                            {confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
