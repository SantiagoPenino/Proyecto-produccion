const ImportLogModal = ({ isOpen, onClose, logs, isImporting }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-zinc-900/70 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-zinc-200">
                <div className="bg-zinc-50 px-8 py-6 border-b border-zinc-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-black text-zinc-800 tracking-tight">Consola de Importación</h2>
                        <p className="text-zinc-500 text-sm font-medium">Comunicación directa con el ERP</p>
                    </div>
                    {isImporting && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold animate-pulse">
                            <i className="fa-solid fa-spinner fa-spin"></i> PROCESANDO
                        </div>
                    )}
                </div>

                {/* LA CONSOLA ESTILO TERMINAL */}
                <div className="p-6">
                    <div className="bg-zinc-900 rounded-2xl p-6 h-80 overflow-y-auto font-mono text-sm shadow-inner">
                        {logs.map((log, index) => (
                            <div key={index} className="mb-2 flex gap-3 animate-fade-in">
                                <span className="text-zinc-600 shrink-0">[{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>
                                <span className={
                                    log.includes('✅') ? 'text-emerald-400' : 
                                    log.includes('❌') ? 'text-red-400' : 
                                    log.includes('📊') ? 'text-sky-400' : 'text-zinc-300'
                                }>
                                    {log}
                                </span>
                            </div>
                        ))}
                        {isImporting && (
                            <div className="text-indigo-400 animate-pulse">_</div>
                        )}
                    </div>
                </div>

                <div className="p-6 bg-zinc-50 border-t border-zinc-100 flex justify-end">
                    <button
                        onClick={onClose}
                        disabled={isImporting}
                        className={`px-8 py-3 rounded-xl font-bold transition-all ${
                            isImporting 
                            ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' 
                            : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'
                        }`}
                    >
                        {isImporting ? 'Procesando datos...' : 'Entendido'}
                    </button>
                </div>
            </div>
        </div>
    );
};
