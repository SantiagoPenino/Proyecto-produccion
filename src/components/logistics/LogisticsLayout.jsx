import { Listbox } from '@headlessui/react';

const LogisticsLayout = ({ children, activeTab, setActiveTab, globalArea, setGlobalArea, areasList = [], disabled = false, isAreaContext = false }) => {
    let tabs = [
        { id: 'import', label: 'Cargar Órdenes', icon: 'fa-file-import' },
        { id: 'quotation', label: 'Cotización', icon: 'fa-file-invoice-dollar' },
        { id: 'canastos', label: 'Canastos', icon: 'fa-basket-shopping' },
        { id: 'labels', label: 'Etiquetas', icon: 'fa-tags' },
        { id: 'receive_sales', label: 'Recibir órdenes de venta', icon: 'fa-boxes-packing' },
        { id: 'dispatch', label: 'Crear Remito', icon: 'fa-file-invoice' },
        { id: 'history', label: 'Historial', icon: 'fa-clock-rotate-left' },
        { id: 'transport', label: 'En Viaje', icon: 'fa-truck-arrow-right' },
        { id: 'reception', label: 'Check-in', icon: 'fa-clipboard-check' },
        { id: 'esperando', label: 'Esperando Bultos', icon: 'fa-box-open' },
        { id: 'stock', label: 'Stock', icon: 'fa-boxes-stacked' },
        { id: 'lost', label: 'Extraviados', icon: 'fa-triangle-exclamation' }
    ];

    if (isAreaContext) {
        tabs = tabs.filter(t => !['import', 'quotation'].includes(t.id));
    }

    if (globalArea === 'DEPOSITO') {
        tabs = tabs.filter(t => !['import', 'quotation', 'canastos', 'labels'].includes(t.id));
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

                    {/* GLOBAL AREA SELECTOR — Headless UI Listbox */}
                    {globalArea && setGlobalArea && (
                        <div className="relative border-l border-gray-200 pl-6">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Filtrar por Área</label>
                            <Listbox value={globalArea} onChange={setGlobalArea} disabled={disabled}>
                                <div className="relative w-48">
                                    <Listbox.Button className={`w-full flex items-center justify-between pl-3 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-gray-700 focus:outline-none focus:border-brand-cyan focus:bg-white shadow-sm transition-colors uppercase text-left ${disabled ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:border-brand-cyan/50'}`}>
                                        <span>{globalArea}</span>
                                        <i className="fa-solid fa-chevron-down text-[10px] text-gray-400 ml-2" />
                                    </Listbox.Button>
                                    <Listbox.Options className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl overflow-auto max-h-60 focus:outline-none">
                                        {areasList.map(area => (
                                            <Listbox.Option key={area} value={area} className={({ active, selected }) =>
                                                `cursor-pointer select-none px-3 py-2 text-sm font-bold uppercase transition-colors ${selected ? 'bg-brand-cyan/10 text-brand-cyan' : active ? 'bg-gray-50 text-gray-800' : 'text-gray-600'}`
                                            }>
                                                {({ selected }) => (
                                                    <div className="flex items-center justify-between">
                                                        <span>{area}</span>
                                                        {selected && <i className="fa-solid fa-check text-brand-cyan text-[10px]" />}
                                                    </div>
                                                )}
                                            </Listbox.Option>
                                        ))}
                                    </Listbox.Options>
                                </div>
                            </Listbox>
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
