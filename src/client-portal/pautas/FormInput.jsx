import React from 'react';

export const FormInput = ({
    label,
    error,
    icon: Icon,
    className = '',
    id,
    ...props
}) => {
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);

    return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
            {label && (
                <label htmlFor={inputId} className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                    {Icon && <Icon size={16} className="text-zinc-500" />}
                    {label}
                </label>
            )}
            <div className="relative">
                <input
                    id={inputId}
                    className={`
            w-full px-4 py-2.5 rounded-lg border bg-brand-dark
            text-zinc-100 placeholder-zinc-500
            focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500
            transition-all disabled:opacity-50 disabled:bg-zinc-900
            ${error ? 'border-red-500 ring-1 ring-red-500/50' : 'border-zinc-600 hover:border-zinc-500'}
          `}
                    {...props}
                />
            </div>
            {error && (
                <span className="text-xs text-red-400 font-medium animate-fade-in">
                    {error}
                </span>
            )}
        </div>
    );
};
