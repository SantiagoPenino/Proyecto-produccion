export const Card = ({ children, className = '', title }) => {
    return (
        <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-6 overflow-hidden ${className}`}>
            {title && (
                <h3 className="text-lg font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100">
                    {title}
                </h3>
            )}
            <div className="w-full">
                {children}
            </div>
        </div>
    );
};