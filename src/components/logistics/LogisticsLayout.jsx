const LogisticsLayout = ({ children, activeTab, setActiveTab, globalArea, setGlobalArea, areasList = [], disabled = false, isAreaContext = false }) => {
    let tabs = [
        { id: 'import', label: 'Cargar Órdenes', icon: 'fa-file-import' },
        { id: 'quotation', label: 'Cotización', icon: 'fa-file-invoice-dollar' },
        { id: 'labels', label: 'Etiquetas', icon: 'fa-tags' },
        { id: 'dispatch', label: 'Crear Remito', icon: 'fa-file-invoice' },
        { id: 'history', label: 'Historial', icon: 'fa-clock-rotate-left' },
        { id: 'transport', label: 'En Viaje', icon: 'fa-truck-arrow-right' },
        { id: 'reception', label: 'Check-in', icon: 'fa-clipboard-check' },
        { id: 'stock', label: 'Stock', icon: 'fa-boxes-stacked' },
        { id: 'lost', label: 'Extraviados', icon: 'fa-triangle-exclamation' }
    ];

    if (isAreaContext) {
        tabs = tabs.filter(t => !['import', 'quotation'].includes(t.id));
    }


    // Note: AREAS are now passed via props (areasList)

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header / Tabs */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
                <div className="flex items-center space-x-6">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                            <i className="fa-solid fa-warehouse text-xl"></i>
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-800 tracking-tight">Gestión Logística (WMS)</h1>
                            <p className="text-xs text-gray-500 font-medium">Control de Bultos y Envíos</p>
                        </div>
                    </div>

                    {/* GLOBAL AREA SELECTOR */}
                    {globalArea && setGlobalArea && (
                        <div className="relative border-l border-gray-200 pl-6">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Filtrar por Área</label>
                            <div className="relative">
                                <select
                                    value={globalArea}
                                    onChange={(e) => setGlobalArea(e.target.value)}
                                    disabled={disabled}
                                    className={`appearance-none pl-3 pr-8 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-gray-700 focus:outline-none focus:border-indigo-500 focus:bg-white shadow-sm transition-colors uppercase w-48 ${disabled ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:border-gray-300'}`}
                                >
                                    {areasList.map(area => (
                                        <option key={area} value={area}>{area}</option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                                    <i className="fa-solid fa-chevron-down text-[10px]"></i>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                                flex items-center px-4 py-2 rounded-md text-sm font-semibold transition-all duration-200
                                ${activeTab === tab.id
                                    ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5'
                                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}
                            `}
                        >
                            <i className={`fa-solid ${tab.icon} mr-2`}></i>
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">
                {children}
            </div>
        </div>
    );
};

export default LogisticsLayout;
