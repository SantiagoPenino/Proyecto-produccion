import React from 'react';

export const StatusBadge = ({ status, className = '' }) => {
    const getStatusStyles = (s) => {
        switch (s?.toLowerCase()) {
            case 'completed':
            case 'completado':
            case 'entregado':
                return 'bg-green-100 text-green-700 border-green-200';
            case 'pending':
            case 'pendiente':
                return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'processing':
            case 'en proceso':
            case 'produccion':
                return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'cancelled':
            case 'cancelado':
                return 'bg-red-100 text-red-700 border-red-200';
            default:
                return 'bg-zinc-100 text-zinc-600 border-zinc-200';
        }
    };

    return (
        <span className={`
      inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border
      ${getStatusStyles(status)} ${className}
    `}>
            {status}
        </span>
    );
};
