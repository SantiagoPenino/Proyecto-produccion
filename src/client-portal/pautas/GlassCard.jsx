import React from 'react';
import { motion } from 'framer-motion';

export const GlassCard = ({ title, children, className = '', noPadding = false, ...props }) => {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`glass-panel rounded-xl ${noPadding ? '' : 'p-6'} ${className}`}
            {...props}
        >
            {title && (
                <div className="mb-6">
                    <h3 className="text-xl font-extrabold text-neutral-900 flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center text-sm shadow-lg">
                            {title.split('.')[0]}
                        </span>
                        {title.split('.').slice(1).join('.').trim()}
                    </h3>
                    <div className="h-[2px] w-full bg-gradient-to-r from-black/10 via-white/5 to-transparent mt-3" />
                </div>
            )}
            {children}
        </motion.div>
    );
};
