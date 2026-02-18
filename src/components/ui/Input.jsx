export const Input = ({ label, error, icon, endIcon, onEndIconClick, className = '', ...props }) => {
    return (
        <div className="w-full mb-4">
            {label && <label className="block text-sm font-bold text-slate-700 mb-1.5">{label}</label>}

            <div className="relative flex items-center">
                {/* Icono Izquierdo */}
                {icon && (
                    <div className="absolute left-3 text-slate-400 pointer-events-none flex items-center">
                        {icon}
                    </div>
                )}

                <input
                    className={`
                        w-full bg-white border border-slate-300 rounded-lg py-2.5 px-3 text-sm text-slate-800 
                        transition-all duration-200 outline-none
                        focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 focus:shadow-sm
                        placeholder:text-slate-400
                        ${icon ? 'pl-10' : ''} 
                        ${endIcon ? 'pr-10' : ''} 
                        ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/10' : ''} 
                        ${className}
                    `}
                    {...props}
                />

                {/* Icono Derecho (Ojo de contraseña) */}
                {endIcon && (
                    <div
                        onClick={onEndIconClick}
                        className={`absolute right-3 text-slate-400 flex items-center ${onEndIconClick ? 'cursor-pointer hover:text-slate-600' : ''}`}
                    >
                        {endIcon}
                    </div>
                )}
            </div>

            {error && <p className="mt-1 text-xs font-bold text-red-500 flex items-center gap-1"><i className="fa-solid fa-circle-exclamation"></i> {error}</p>}
        </div>
    );
};