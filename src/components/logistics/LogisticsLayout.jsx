import {
    Warehouse, ReceiptText, ShoppingBasket, Tags, PackagePlus, FilePlus2, History, Truck, ClipboardCheck, PackageOpen, Boxes, AlertTriangle,
} from 'lucide-react';
import Selector from '../ui/Selector';

// Estética nueva (22/10/2026, como Reportes y Cotización): encabezado con ícono Lucide en brand-cyan, el filtro de
// área con el Selector propio (antes un Listbox de Headless UI) y las pestañas con la elegida en negro. En el
// celular las pestañas son un selector.

const LogisticsLayout = ({ children, activeTab, setActiveTab, globalArea, setGlobalArea, areasList = [], disabled = false, isAreaContext = false }) => {
    let tabs = [
        { id: 'quotation', label: 'Cotización', icon: ReceiptText },
        { id: 'canastos', label: 'Canastos', icon: ShoppingBasket },
        { id: 'labels', label: 'Etiquetas', icon: Tags },
        { id: 'receive_sales', label: 'Órdenes de Venta', icon: PackagePlus },
        { id: 'dispatch', label: 'Crear Remito', icon: FilePlus2 },
        { id: 'history', label: 'Historial', icon: History },
        { id: 'transport', label: 'En Viaje', icon: Truck },
        { id: 'reception', label: 'Check-in', icon: ClipboardCheck },
        { id: 'esperando', label: 'Esperando Bultos', icon: PackageOpen },
        { id: 'stock', label: 'Stock', icon: Boxes },
        { id: 'lost', label: 'Extraviados', icon: AlertTriangle }
    ];

    if (isAreaContext) {
        tabs = tabs.filter(t => !['quotation'].includes(t.id));
    }

    if (globalArea === 'DEPOSITO') {
        tabs = tabs.filter(t => !['quotation', 'canastos', 'labels'].includes(t.id));
    }

    // Pedido 06/08: en las áreas de producción estas pestañas no se usan — las
    // etiquetas se imprimen desde la planilla/control del área, y Recibir órdenes
    // de venta / Esperando Bultos / Extraviados son operaciones del DEPÓSITO.
    // Se mantienen en DEPOSITO y en la vista global TODOS (consola central).
    if (globalArea && globalArea !== 'DEPOSITO' && globalArea !== 'TODOS') {
        tabs = tabs.filter(t => !['labels', 'receive_sales', 'esperando', 'lost'].includes(t.id));
    }


    // Note: AREAS are now passed via props (areasList)

    return (
        <div className="flex flex-col h-full bg-slate-50 font-sans text-zinc-800">
            {/* Encabezado y pestañas */}
            <div className="px-3 md:px-6 pt-3 md:pt-5 pb-3 flex items-center justify-between flex-wrap gap-3 border-b border-zinc-200 bg-slate-50 z-10">
                <div className="flex items-center gap-4 flex-wrap min-w-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <Warehouse size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                        <div className="min-w-0">
                            <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Gestión logística (WMS)</h1>
                            <p className="text-sm text-zinc-400">Control de bultos y envíos</p>
                        </div>
                    </div>

                    {/* Filtro global de área */}
                    {globalArea && setGlobalArea && (
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-black text-zinc-400 uppercase tracking-wide">Área</span>
                            <div className="w-44">
                                <Selector value={globalArea} onChange={e => setGlobalArea(e.target.value)} disabled={disabled}
                                    aria-label="Filtrar por área" className="font-bold uppercase">
                                    {areasList.map(area => <option key={area} value={area}>{area}</option>)}
                                </Selector>
                            </div>
                        </div>
                    )}
                </div>

                {/* Escritorio: pestañas */}
                <div className="hidden lg:flex flex-wrap items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white">
                    {tabs.map(tab => {
                        const Icono = tab.icon;
                        const activa = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                                    activa ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`}
                            >
                                <Icono size={14} className={activa ? '' : 'text-brand-cyan'} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Celular: selector */}
                <div className="w-full lg:hidden">
                    <Selector value={activeTab} onChange={e => setActiveTab(e.target.value)} aria-label="Sección" className="font-semibold" altoMax={640}>
                        {tabs.map(tab => (
                            <option key={tab.id} value={tab.id}>
                                <span className="inline-flex items-center gap-2"><tab.icon size={15} className="shrink-0 text-brand-cyan" />{tab.label}</span>
                            </option>
                        ))}
                    </Selector>
                </div>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-hidden relative">
                {children}
            </div>
        </div>
    );
};

export default LogisticsLayout;
