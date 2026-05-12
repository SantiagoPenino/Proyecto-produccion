import React, { useState, useEffect } from 'react';
import { areasService, workflowsService } from '../../../services/api';

const ConfigFlowsModal = ({ isOpen, onClose }) => {
    const [step, setStep] = useState('list'); // 'list' | 'create'
    const [workflows, setWorkflows] = useState([]);
    const [areas, setAreas] = useState([]);

    // Formulario Nuevo Flujo
    const [newFlowName, setNewFlowName] = useState('');
    const [selectedSteps, setSelectedSteps] = useState([]); // Array de AreaIDs
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadData();
            setStep('list');
        }
    }, [isOpen]);

    const loadData = async () => {
        try {
            const [wData, aData] = await Promise.all([
                workflowsService.getAll(),
                areasService.getAll()
            ]);
            setWorkflows(wData);
            setAreas(aData);
        } catch (e) { console.error(e); }
    };

    const handleAddStep = (areaId) => {
        if (!selectedSteps.includes(areaId)) {
            setSelectedSteps([...selectedSteps, areaId]);
        }
    };

    const handleSave = async () => {
        if (!newFlowName || selectedSteps.length === 0) return alert("Nombre y al menos 1 paso requeridos");
        setLoading(true);
        try {
            await workflowsService.create({
                nombre: newFlowName,
                descripcion: 'Creado manualmente',
                pasos: selectedSteps
            });
            alert("Ruta creada!");
            setNewFlowName('');
            setSelectedSteps([]);
            setStep('list');
            loadData();
        } catch (e) { alert("Error al crear"); }
        finally { setLoading(false); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("¿Estás seguro de eliminar esta ruta?")) return;
        try {
            await workflowsService.delete(id);
            setWorkflows(prev => prev.filter(w => w.id !== id));
        } catch (e) { alert("Error al eliminar ruta"); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                    <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><i className="fa-solid fa-diagram-project"></i></span>
                        Gestión de Rutas
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-red-500 w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-50 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-zinc-50/50">
                    {step === 'list' ? (
                        <div className="flex flex-col gap-6">
                            <div className="flex justify-between items-center">
                                <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Rutas Existentes</h4>
                                <button
                                    className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg shadow-md hover:bg-blue-700 hover:shadow-lg transition-all active:scale-95 flex items-center gap-2"
                                    onClick={() => setStep('create')}
                                >
                                    <i className="fa-solid fa-plus"></i> Nueva Ruta
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {workflows.map(w => (
                                    <div key={w.id} className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all relative group">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <i className="fa-solid fa-route text-zinc-300"></i>
                                                <span className="font-bold text-zinc-700">{w.nombre}</span>
                                            </div>
                                            <button
                                                onClick={() => handleDelete(w.id)}
                                                className="w-6 h-6 rounded flex items-center justify-center text-zinc-300 hover:bg-red-50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                                title="Eliminar Ruta"
                                            >
                                                <i className="fa-solid fa-trash-can text-xs"></i>
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {w.pasos.map((p, i) => (
                                                <div key={i} className="flex items-center">
                                                    <span className="px-2 py-1 bg-zinc-100 text-zinc-600 text-xs font-bold rounded border border-zinc-200">
                                                        {i + 1}. {p.nombre}
                                                    </span>
                                                    {i < w.pasos.length - 1 && <i className="fa-solid fa-arrow-right text-zinc-300 mx-1 text-[10px]"></i>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                {workflows.length === 0 && <p className="text-zinc-400 italic text-sm">No hay rutas configuradas.</p>}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col h-full">
                            <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">Diseñar Nueva Ruta</h4>

                            <div className="mb-6">
                                <label className="block text-xs font-bold text-zinc-400 mb-1.5 uppercase">Nombre de la Ruta</label>
                                <input
                                    className="w-full px-4 py-2 bg-white border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                    placeholder="Ej: Full Sublimación"
                                    value={newFlowName}
                                    onChange={e => setNewFlowName(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="flex gap-6 flex-1 min-h-0">
                                {/* Lista de Áreas Disponibles */}
                                <div className="flex-1 bg-white border border-zinc-200 rounded-xl overflow-hidden flex flex-col">
                                    <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-100 text-xs font-bold text-zinc-500 uppercase">Áreas Disponibles</div>
                                    <div className="overflow-y-auto p-2 flex-1 space-y-1">
                                        {areas.map(a => (
                                            <button
                                                key={a.code}
                                                onClick={() => handleAddStep(a.code)}
                                                disabled={selectedSteps.includes(a.code)}
                                                className="w-full text-left px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors flex items-center justify-between group disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-50"
                                            >
                                                <span>{a.name}</span>
                                                <i className="fa-solid fa-plus text-zinc-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Pasos Seleccionados (Visualizador) */}
                                <div className="flex-1 bg-blue-50/50 border border-blue-100 rounded-xl overflow-hidden flex flex-col">
                                    <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs font-bold text-blue-600 uppercase flex justify-between items-center">
                                        <span>Secuencia de Producción</span>
                                        {selectedSteps.length > 0 &&
                                            <button onClick={() => setSelectedSteps([])} className="text-[10px] text-red-500 hover:text-red-700 underline font-bold">Limpiar todo</button>
                                        }
                                    </div>
                                    <div className="overflow-y-auto p-4 flex-1 space-y-3 relative">
                                        {selectedSteps.length === 0 && (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-300 pointer-events-none">
                                                <i className="fa-solid fa-arrow-down-short-wide text-3xl mb-2 opacity-50"></i>
                                                <span className="text-xs font-medium">Agrega áreas desde la izquierda</span>
                                            </div>
                                        )}
                                        {selectedSteps.map((s, i) => (
                                            <div key={i} className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-300">
                                                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-sm shadow-blue-200">
                                                    {i + 1}
                                                </div>
                                                <div className="px-4 py-3 bg-white border border-zinc-200 rounded-lg shadow-sm text-sm font-bold text-zinc-700 flex-1">
                                                    {areas.find(a => a.code === s)?.name || s}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                {step === 'create' && (
                    <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-3 rounded-b-xl">
                        <button
                            className="px-4 py-2 bg-white border border-zinc-200 text-zinc-600 rounded-lg text-sm font-bold hover:bg-zinc-100 transition-colors"
                            onClick={() => setStep('list')}
                            disabled={loading}
                        >
                            Cancelar
                        </button>
                        <button
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow hover:bg-blue-700 hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={handleSave}
                            disabled={loading}
                        >
                            {loading ? 'Guardando...' : 'Guardar Ruta'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ConfigFlowsModal;
