import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

const Toast = ({ message, type = 'info', onClose, duration = 3000 }) => {
    useEffect(() => {
        if (duration) {
            const timer = setTimeout(() => {
                onClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [duration, onClose]);

    const bgColors = {
        success: 'bg-emerald-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        warning: 'bg-amber-500'
    };

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-circle-exclamation',
        info: 'fa-circle-info',
        warning: 'fa-triangle-exclamation'
    };

    const content = (
        <div className={`fixed top-5 right-5 z-[999999] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-white transform transition-all duration-300 animate-in slide-in-from-top-5 fade-in ${bgColors[type] || bgColors.info} min-w-[300px]`}>
            <i className={`fa-solid ${icons[type] || icons.info} text-xl`}></i>
            <div className="flex-1 font-bold text-sm">{message}</div>
            <button onClick={onClose} className="opacity-70 hover:opacity-100 transition-opacity">
                <i className="fa-solid fa-xmark"></i>
            </button>
        </div>
    );

    // Solo renderizar si el documento está disponible (para evitar problemas en SSR si existieran)
    if (typeof document === 'undefined') return null;

    return createPortal(content, document.body);
};

export default Toast;
