import React, { useState, useEffect } from 'react';
import { feriadosService } from '../../../services/api';

const ConfigFeriadosModal = ({ isOpen, onClose }) => {
    const [feriados, setFeriados] = useState([]);
    const [loading, setLoading] = useState(false);

    const [newFeriado, setNewFeriado] = useState({ fecha: '', descripcion: '' });

    const [editingFecha, setEditingFecha] = useState(null);
    const [editForm, setEditForm] = useState({ fecha: '', descripcion: '' });

    useEffect(() => {
        if (isOpen) loadData();
    }, [isOpen]);

    const loadData = async () => {
        setLoading(true);
        try {
            setFeriados(await feriadosService.getAll());
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newFeriado.fecha) return alert("Fecha requerida");
        try {
            await feriadosService.create(newFeriado);
            setNewFeriado({ fecha: '', descripcion: '' });
            loadData();
        } catch (e) { alert("Error al crear feriado: " + (e.response?.data?.error || e.message)); }
    };

    const handleDelete = async (fecha) => {
        if (!window.confirm("¿Eliminar este feriado?")) return;
        try {
            await feriadosService.delete(fecha);
            setFeriados(prev => prev.filter(f => f.Fecha !== fecha));
        } catch (e) { alert("Error al eliminar"); }
    };

    const startEdit = (f) => {
        setEditingFecha(f.Fecha);
        setEditForm({ fecha: f.Fecha, descripcion: f.Descripcion || '' });
    };

    const saveEdit = async (fechaOriginal) => {
        try {
            await feriadosService.update(fechaOriginal, editForm);
            setEditingFecha(null);
            loadData();
        } catch (e) { alert("Error al actualizar: " + (e.response?.data?.error || e.message)); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/60 z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                    <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-umbrella-beach text-rose-500 bg-rose-100 p-1.5 rounded-lg text-sm"></i>
                        Feriados
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50">
                    <p className="text-xs text-zinc-500 mb-4">
                        Días en que NO se trabaja en ninguna área — <b>sp_CalcularFechaEntrega</b> los saltea al calcular
                        la fecha de entrega, y la Planificación los marca como "Feriado". Vienen precargados los 9
                        feriados no laborables oficiales de Uruguay 2026; si tu planta cierra algún otro día (ej. un
                        feriado laborable, o un cierre propio), agregalo acá.
                    </p>

                    {/* FORM ADD */}
                    <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm mb-6">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Nuevo Feriado</h4>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                            <div className="md:col-span-1">
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Fecha</label>
                                <input type="date" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newFeriado.fecha} onChange={e => setNewFeriado({ ...newFeriado, fecha: e.target.value })} />
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Descripción</label>
                                <input type="text" placeholder="Ej: Navidad" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newFeriado.descripcion} onChange={e => setNewFeriado({ ...newFeriado, descripcion: e.target.value })} />
                            </div>
                            <button onClick={handleAdd} className="px-4 py-2 bg-rose-500 text-white text-sm font-bold rounded-lg shadow-md hover:bg-rose-600 h-[38px] flex items-center justify-center gap-2">
                                <i className="fa-solid fa-plus"></i> Agregar
                            </button>
                        </div>
                    </div>

                    {/* TABLE */}
                    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">
                                <tr>
                                    <th className="px-4 py-3 font-bold">Fecha</th>
                                    <th className="px-4 py-3 font-bold">Descripción</th>
                                    <th className="px-4 py-3 font-bold text-center w-24">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {loading ? (
                                    <tr><td colSpan="3" className="py-8 text-center text-zinc-400 italic text-xs">Cargando...</td></tr>
                                ) : feriados.length === 0 ? (
                                    <tr><td colSpan="3" className="py-8 text-center text-zinc-400 italic text-xs">No hay feriados cargados.</td></tr>
                                ) : (
                                    feriados.map(f => {
                                        const isEditing = editingFecha === f.Fecha;
                                        return (
                                            <tr key={f.Fecha} className={isEditing ? "bg-rose-50/50" : "hover:bg-zinc-50"}>
                                                <td className="px-4 py-3">
                                                    {isEditing ? (
                                                        <input type="date" className="px-2 py-1 bg-white border border-rose-300 rounded"
                                                            value={editForm.fecha} onChange={e => setEditForm({ ...editForm, fecha: e.target.value })} />
                                                    ) : <span className="font-mono font-bold text-zinc-700">{f.Fecha}</span>}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {isEditing ? (
                                                        <input type="text" className="w-full px-2 py-1 bg-white border border-rose-300 rounded"
                                                            value={editForm.descripcion} onChange={e => setEditForm({ ...editForm, descripcion: e.target.value })} />
                                                    ) : <span className="text-zinc-600">{f.Descripcion || '—'}</span>}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <div className="flex gap-1 justify-center">
                                                            <button onClick={() => saveEdit(f.Fecha)} className="w-7 h-7 flex items-center justify-center rounded bg-emerald-100 text-emerald-600"><i className="fa-solid fa-check"></i></button>
                                                            <button onClick={() => setEditingFecha(null)} className="w-7 h-7 flex items-center justify-center rounded bg-red-100 text-red-600"><i className="fa-solid fa-xmark"></i></button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-1 justify-center">
                                                            <button onClick={() => startEdit(f)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-rose-500"><i className="fa-solid fa-pen-to-square"></i></button>
                                                            <button onClick={() => handleDelete(f.Fecha)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500"><i className="fa-solid fa-trash-can"></i></button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfigFeriadosModal;
