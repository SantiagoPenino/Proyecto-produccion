export const Button = ({
    children,
    variant = 'primary',
    isLoading,
    className = '',
    ...props
}) => {
    const baseStyles = "inline-flex items-center justify-center px-5 py-2.5 rounded-lg font-medium transition-all duration-200 cursor-pointer gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-offset-1";

    const variants = {
        primary: "bg-blue-600 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 focus:ring-blue-500 active:scale-95",
        secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus:ring-slate-200 shadow-sm active:scale-95",
        danger: "bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 hover:text-red-700 focus:ring-red-200 active:scale-95",
        ghost: "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700"
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant] || variants.primary} ${className}`}
            disabled={isLoading || props.disabled}
            {...props}
        >
            {isLoading && (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {children}
        </button>
    );
};