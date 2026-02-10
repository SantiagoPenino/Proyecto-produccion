import React from 'react';

export const FormInput = ({
    label,
    error,
    icon: Icon,
    className = '',
    ...props
}) => {
    return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
            {label && (
                <label className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                    {Icon && <Icon size={16} className="text-zinc-500" />}
                    {label}
                </label>
            )}
            <div className="relative">
                <input
                    className={`
            w-full px-4 py-2.5 rounded-lg border bg-white/50 backdrop-blur-sm
            text-zinc-900 placeholder-zinc-400
            focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500
            transition-all disabled:opacity-50 disabled:bg-zinc-100
            ${error ? 'border-red-500 ring-1 ring-red-500/50' : 'border-zinc-200 hover:border-zinc-300'}
          `}
                    {...props}
                />
            </div>
            {error && (
                <span className="text-xs text-red-500 font-medium animate-fade-in">
                    {error}
                </span>
            )}
        </div>
    );
};
