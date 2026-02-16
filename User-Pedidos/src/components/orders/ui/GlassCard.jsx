import React from 'react';

export const GlassCard = ({ children, className = '', title }) => {
    return (
        <div className={`bg-white/60 backdrop-blur-xl border border-white/20 shadow-xl rounded-3xl p-6 ${className}`}>
            {title && (
                <h3 className="text-xl font-bold text-zinc-800 mb-6 border-b border-zinc-100 pb-4">
                    {title}
                </h3>
            )}
            {children}
        </div>
    );
};
