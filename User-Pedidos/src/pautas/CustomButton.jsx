import React from 'react';
import { motion } from 'framer-motion';

export const CustomButton = ({
    children,
    variant = 'primary',
    className = '',
    isLoading = false,
    icon: Icon,
    ...props
}) => {
    const baseStyles = "flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";

    const variants = {
        primary: "bg-zinc-900 text-white hover:bg-zinc-800 shadow-lg hover:shadow-xl focus:ring-zinc-900",
        secondary: "bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 focus:ring-zinc-300",
        danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-600",
        ghost: "bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        glass: "glass-panel text-zinc-900 hover:bg-white/50 border border-white/40"
    };

    return (
        <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`${baseStyles} ${variants[variant] || variants.primary} ${className}`}
            disabled={isLoading || props.disabled}
            {...props}
        >
            {isLoading ? (
                <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
            ) : Icon ? (
                <Icon size={18} />
            ) : null}
            {children}
        </motion.button>
    );
};
