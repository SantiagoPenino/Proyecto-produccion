// SIN USO (13/10): nunca se importó; sus 3 pestañas (ImportadorManualView, QuotationView, LabelGenerationPage) tienen ruta propia. Ver docs/auditoria-limpieza-2026-10-09.md.
import React, { useState } from 'react';
import ImportadorManualView from './production/ImportadorManualView';
import LabelGenerationPage from './pages/LabelGenerationPage';
import QuotationView from './logistics/QuotationView';

export default function UnifiedProductionManager() {
    const [activeTab, setActiveTab] = useState('import');

    return (
        <div className="flex flex-col h-screen bg-slate-50 relative overflow-hidden">
            {/* Header unificado estilo pestañas superiores para App */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center shadow-sm z-10 shrink-0">
                <div className="flex items-center space-x-3 mr-10">
                    <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-md">
                        <i className="fa-solid fa-industry text-xl"></i>
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-800 tracking-tight">Gestión de Producción</h1>
                        <p className="text-xs text-slate-500 font-medium">Panel Maestro Unificado</p>
                    </div>
                </div>

                <div className="flex space-x-2 bg-slate-100 p-1.5 rounded-lg border border-slate-200/60 shadow-inner">
                    <button
                        onClick={() => setActiveTab('import')}
                        className={` flex items-center px-6 py-2.5 rounded-md text-sm font-bold transition-all duration-200
                        ${activeTab === 'import'
                            ? 'bg-white text-indigo-600 shadow ring-1 ring-black/5 scale-105 transform z-10'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}
                        `}
                    >
                        <i className="fa-solid fa-file-import mr-2"></i>
                        1. Cargar Órdenes (ERP)
                    </button>
                    <button
                        onClick={() => setActiveTab('quotation')}
                        className={` flex items-center px-6 py-2.5 rounded-md text-sm font-bold transition-all duration-200
                        ${activeTab === 'quotation'
                            ? 'bg-white text-indigo-600 shadow ring-1 ring-black/5 scale-105 transform z-10'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}
                        `}
                    >
                        <i className="fa-solid fa-file-invoice-dollar mr-2"></i>
                        2. Confirmar Cotización
                    </button>
                    <button
                        onClick={() => setActiveTab('labels')}
                        className={` flex items-center px-6 py-2.5 rounded-md text-sm font-bold transition-all duration-200
                        ${activeTab === 'labels'
                            ? 'bg-white text-indigo-600 shadow ring-1 ring-black/5 scale-105 transform z-10'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}
                        `}
                    >
                        <i className="fa-solid fa-tags mr-2"></i>
                        3. Gestionar Etiquetas y Remitos
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative bg-slate-50">
                {activeTab === 'import' && (
                    <div className="absolute inset-0 overflow-y-auto">
                        <ImportadorManualView embedded={true} />
                    </div>
                )}
                {activeTab === 'quotation' && (
                    <div className="absolute inset-0">
                        <QuotationView />
                    </div>
                )}
                {activeTab === 'labels' && (
                    <div className="absolute inset-0">
                        <LabelGenerationPage embedded={true} />
                    </div>
                )}
            </div>
        </div>
    );
}
