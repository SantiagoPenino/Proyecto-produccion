import React, { useState, useEffect } from 'react';
import { deliveryTimesService, areasService } from '../../../services/api';

const ConfigDeliveryTimesModal = ({ isOpen, onClose }) => {
    const [times, setTimes] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(false);

    // La Prioridad es TEXTO ('Normal'/'Urgente'): el portal busca la fila por ese nombre.
    // El Texto es opcional: si se completa, el portal lo muestra tal cual en vez de "X horas".
    const PRIORIDADES = ['Normal', 'Urgente'];

    // New Rule Form
    const [newTime, setNewTime] = useState({ areaID: '', prioridad: 'Normal', horas: 0, dias: 0, texto: '' });

    // Editing State
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ areaID: '', prioridad: 'Normal', horas: 0, dias: 0, texto: '' });

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [tData, aData] = await Promise.all([
                deliveryTimesService.getAll(),
                areasService.getAll()
            ]);
            setTimes(tData);
            setAreas(aData);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newTime.areaID) return alert("Área requerida");
        try {
            await deliveryTimesService.create(newTime);
            setNewTime({ areaID: '', prioridad: 'Normal', horas: 0, dias: 0, texto: '' });
            loadData();
        } catch (e) { alert("Error al crear configuración: " + (e.response?.data?.error || e.message)); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("¿Eliminar este registro?")) return;
        try {
            await deliveryTimesService.delete(id);
            setTimes(prev => prev.filter(t => t.ConfigID !== id));
        } catch (e) { alert("Error al eliminar"); }
    };

    const startEdit = (t) => {
        setEditingId(t.ConfigID);
        setEditForm({
            areaID: (t.AreaID || '').trim(),
            prioridad: (t.Prioridad || 'Normal').trim(),
            horas: t.Horas,
            dias: t.Dias,
            texto: t.Texto || ''
        });
    };

    const saveEdit = async (id) => {
        try {
            await deliveryTimesService.update(id, editForm);
            setEditingId(null);
            loadData();
        } catch (e) { alert("Error al actualizar: " + (e.response?.data?.error || e.message)); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/60  z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                    <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-hourglass-half text-amber-500 bg-amber-100 p-1.5 rounded-lg text-sm"></i>
                        Tiempos de Entrega
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50">

                    {/* FORM ADD */}
                    <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm mb-6">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Nuevo Tiempo</h4>
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Área</label>
                                <select className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newTime.areaID} onChange={e => setNewTime({ ...newTime, areaID: e.target.value })}>
                                    <option value="">-- Seleccionar --</option>
                                    {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Prioridad</label>
                                <select className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newTime.prioridad} onChange={e => setNewTime({ ...newTime, prioridad: e.target.value })}>
                                    {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Horas</label>
                                <input type="number" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newTime.horas} onChange={e => setNewTime({ ...newTime, horas: parseInt(e.target.value) })} />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Días</label>
                                <input type="number" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newTime.dias} onChange={e => setNewTime({ ...newTime, dias: parseInt(e.target.value) })} />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block" title="Si se completa, el portal muestra este texto en vez de las horas">Texto (opcional)</label>
                                <input type="text" placeholder="Ej: En el día" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newTime.texto} onChange={e => setNewTime({ ...newTime, texto: e.target.value })} />
                            </div>
                            <button onClick={handleAdd} className="px-4 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg shadow-md hover:bg-amber-600 h-[38px] flex items-center justify-center gap-2">
                                <i className="fa-solid fa-plus"></i> Agregar
                            </button>
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-2 italic">El portal muestra: el <b>Texto</b> si está cargado, si no "<b>Horas</b> horas". La prioridad debe ser Normal o Urgente (el form del cliente la busca por ese nombre).</p>
                    </div>

                    {/* TABLE */}
                    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">
                                <tr>
                                    <th className="px-4 py-3 font-bold">Área</th>
                                    <th className="px-4 py-3 font-bold text-center">Prioridad</th>
                                    <th className="px-4 py-3 font-bold text-center">Horas</th>
                                    <th className="px-4 py-3 font-bold text-center">Días</th>
                                    <th className="px-4 py-3 font-bold text-center">Texto</th>
                                    <th className="px-4 py-3 font-bold text-center">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {times.length === 0 ? <tr><td colSpan="6" className="py-8 text-center text-zinc-400 italic">No hay tiempos definidos.</td></tr> :
                                    times.map(t => {
                                        const isEditing = editingId === t.ConfigID;
                                        return (
                                            <tr key={t.ConfigID} className={isEditing ? "bg-amber-50/50" : "hover:bg-zinc-50"}>
                                                <td className="px-4 py-3">
                                                    {isEditing ? (
                                                        <select className="px-2 py-1 bg-white border border-amber-300 rounded w-full"
                                                            value={editForm.areaID} onChange={e => setEditForm({ ...editForm, areaID: e.target.value })}>
                                                            {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                                                        </select>
                                                    ) : <span className="font-bold text-zinc-700">{areas.find(a => a.code === t.AreaID)?.name || t.AreaID}</span>}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <select className="px-2 py-1 bg-white border border-amber-300 rounded"
                                                            value={editForm.prioridad} onChange={e => setEditForm({ ...editForm, prioridad: e.target.value })}>
                                                            {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                                                        </select>
                                                    ) : <span className="text-zinc-600 font-mono">{t.Prioridad}</span>}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <input type="number" className="w-16 text-center border border-amber-300 rounded"
                                                            value={editForm.horas} onChange={e => setEditForm({ ...editForm, horas: e.target.value })} />
                                                    ) : <span className="font-bold text-zinc-700">{t.Horas} h</span>}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <input type="number" className="w-16 text-center border border-amber-300 rounded"
                                                            value={editForm.dias} onChange={e => setEditForm({ ...editForm, dias: e.target.value })} />
                                                    ) : <span className="font-bold text-zinc-700">{t.Dias} d</span>}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <input type="text" className="w-40 text-center border border-amber-300 rounded"
                                                            value={editForm.texto} onChange={e => setEditForm({ ...editForm, texto: e.target.value })} />
                                                    ) : <span className="text-zinc-500 text-xs italic">{t.Texto || '—'}</span>}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <div className="flex gap-1 justify-center">
                                                            <button onClick={() => saveEdit(t.ConfigID)} className="w-7 h-7 flex items-center justify-center rounded bg-emerald-100 text-emerald-600"><i className="fa-solid fa-check"></i></button>
                                                            <button onClick={() => setEditingId(null)} className="w-7 h-7 flex items-center justify-center rounded bg-red-100 text-red-600"><i className="fa-solid fa-xmark"></i></button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-1 justify-center">
                                                            <button onClick={() => startEdit(t)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-amber-500"><i className="fa-solid fa-pen-to-square"></i></button>
                                                            <button onClick={() => handleDelete(t.ConfigID)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500"><i className="fa-solid fa-trash-can"></i></button>
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

export default ConfigDeliveryTimesModal;

