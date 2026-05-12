import React, { useState, useEffect } from 'react';
import { routesConfigService, areasService } from '../../../services/api';

const ConfigRouteRulesModal = ({ isOpen, onClose }) => {
    const [rules, setRules] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(false);

    // New Rule Form
    const [newRule, setNewRule] = useState({ areaOrigen: '', areaDestino: '', prioridad: 1, requiereExistencia: false });

    // Editing State
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ areaOrigen: '', areaDestino: '', prioridad: 1, requiereExistencia: false });

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [rData, aData] = await Promise.all([
                routesConfigService.getAll(),
                areasService.getAll()
            ]);
            setRules(rData);
            setAreas(aData);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newRule.areaOrigen || !newRule.areaDestino) return alert("Origen y Destino requeridos");
        try {
            await routesConfigService.create(newRule);
            setNewRule({ areaOrigen: '', areaDestino: '', prioridad: 1, requiereExistencia: false });
            loadData();
        } catch (e) { alert("Error al crear regla"); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("¿Eliminar esta regla?")) return;
        try {
            await routesConfigService.delete(id);
            setRules(prev => prev.filter(r => r.RutaID !== id));
        } catch (e) { alert("Error al eliminar"); }
    };

    const startEdit = (rule) => {
        setEditingId(rule.RutaID);
        setEditForm({
            areaOrigen: rule.AreaOrigen,
            areaDestino: rule.AreaDestino,
            prioridad: rule.Prioridad,
            requiereExistencia: rule.RequiereExistencia
        });
    };

    const saveEdit = async (id) => {
        try {
            await routesConfigService.update(id, editForm);
            setEditingId(null);
            loadData();
        } catch (e) { alert("Error al actualizar"); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                    <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-route text-indigo-500 bg-indigo-100 p-1.5 rounded-lg text-sm"></i>
                        Configuración de Rutas
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50">

                    {/* FORM ADD */}
                    <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm mb-6">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Nueva Ruta</h4>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Origen</label>
                                <select className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newRule.areaOrigen} onChange={e => setNewRule({ ...newRule, areaOrigen: e.target.value })}>
                                    <option value="">-- Seleccionar --</option>
                                    {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Destino</label>
                                <select className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newRule.areaDestino} onChange={e => setNewRule({ ...newRule, areaDestino: e.target.value })}>
                                    <option value="">-- Seleccionar --</option>
                                    {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Prioridad</label>
                                <input type="number" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newRule.prioridad} onChange={e => setNewRule({ ...newRule, prioridad: parseInt(e.target.value) })} />
                            </div>
                            <div className="flex items-center gap-2 pb-3">
                                <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded"
                                    checked={newRule.requiereExistencia} onChange={e => setNewRule({ ...newRule, requiereExistencia: e.target.checked })} />
                                <label className="text-xs font-bold text-zinc-600">Requiere Stock</label>
                            </div>
                            <button onClick={handleAdd} className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg shadow-md hover:bg-indigo-700 h-[38px] flex items-center justify-center gap-2">
                                <i className="fa-solid fa-plus"></i> Agregar
                            </button>
                        </div>
                    </div>

                    {/* TABLE */}
                    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">
                                <tr>
                                    <th className="px-4 py-3 font-bold">Origen</th>
                                    <th className="px-4 py-3 font-bold">Destino</th>
                                    <th className="px-4 py-3 font-bold text-center">Prioridad</th>
                                    <th className="px-4 py-3 font-bold text-center">Req. Stock</th>
                                    <th className="px-4 py-3 font-bold text-center">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {rules.length === 0 ? <tr><td colSpan="5" className="py-8 text-center text-zinc-400 italic">No hay rutas definidas.</td></tr> :
                                    rules.map(r => {
                                        const isEditing = editingId === r.RutaID;
                                        return (
                                            <tr key={r.RutaID} className={isEditing ? "bg-indigo-50/50" : "hover:bg-zinc-50"}>
                                                <td className="px-4 py-3">
                                                    {isEditing ? (
                                                        <select className="px-2 py-1 bg-white border border-indigo-300 rounded w-full"
                                                            value={editForm.areaOrigen} onChange={e => setEditForm({ ...editForm, areaOrigen: e.target.value })}>
                                                            {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                                                        </select>
                                                    ) : <span className="font-bold text-zinc-700">{areas.find(a => a.code === r.AreaOrigen)?.name || r.AreaOrigen}</span>}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {isEditing ? (
                                                        <select className="px-2 py-1 bg-white border border-indigo-300 rounded w-full"
                                                            value={editForm.areaDestino} onChange={e => setEditForm({ ...editForm, areaDestino: e.target.value })}>
                                                            {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                                                        </select>
                                                    ) : <span className="font-bold text-zinc-700">{areas.find(a => a.code === r.AreaDestino)?.name || r.AreaDestino}</span>}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <input type="number" className="w-16 text-center border border-indigo-300 rounded"
                                                            value={editForm.prioridad} onChange={e => setEditForm({ ...editForm, prioridad: e.target.value })} />
                                                    ) : <span className="badge bg-zinc-100 text-zinc-600 px-2 py-1 rounded border border-zinc-200 font-mono text-xs">{r.Prioridad}</span>}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <input type="checkbox" checked={editForm.requiereExistencia} onChange={e => setEditForm({ ...editForm, requiereExistencia: e.target.checked })} />
                                                    ) : (r.RequiereExistencia ? <i className="fa-solid fa-check text-emerald-500"></i> : <span className="text-zinc-300">-</span>)}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <div className="flex gap-1 justify-center">
                                                            <button onClick={() => saveEdit(r.RutaID)} className="w-7 h-7 flex items-center justify-center rounded bg-emerald-100 text-emerald-600"><i className="fa-solid fa-check"></i></button>
                                                            <button onClick={() => setEditingId(null)} className="w-7 h-7 flex items-center justify-center rounded bg-red-100 text-red-600"><i className="fa-solid fa-xmark"></i></button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-1 justify-center">
                                                            <button onClick={() => startEdit(r)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-indigo-500"><i className="fa-solid fa-pen-to-square"></i></button>
                                                            <button onClick={() => handleDelete(r.RutaID)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500"><i className="fa-solid fa-trash-can"></i></button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfigRouteRulesModal;

