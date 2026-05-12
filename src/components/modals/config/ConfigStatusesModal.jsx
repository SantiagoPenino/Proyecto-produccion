import React, { useState, useEffect } from 'react';
import { areasService } from '../../../services/api';

const ConfigStatusesModal = ({ isOpen, onClose, areaCode, initialStatuses }) => {
    // Lista local
    const [statusList, setStatusList] = useState([]);
    const [loading, setLoading] = useState(false);

    // Estado para nuevo
    const [newStatus, setNewStatus] = useState({ nombre: '', color: '#cccccc', orden: 0, esFinal: false, tipoEstado: 'ESTADOENAREA' });

    // Estado edición
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ nombre: '', color: '', orden: 0, esFinal: false, tipoEstado: 'ESTADOENAREA' });

    useEffect(() => {
        if (initialStatuses) {
            setStatusList([...initialStatuses].sort((a, b) => a.Orden - b.Orden));
        }
    }, [initialStatuses]);

    if (!isOpen) return null;

    // --- AGREGAR ---
    const handleAdd = async () => {
        if (!newStatus.nombre.trim()) return;
        setLoading(true);
        try {
            await areasService.addStatus({
                areaId: areaCode,
                nombre: newStatus.nombre,
                colorHex: newStatus.color,
                orden: newStatus.orden,
                esFinal: newStatus.esFinal,
                tipoEstado: newStatus.tipoEstado
            });
            alert('Estado agregado. Se actualizará al recargar.');
            setStatusList(prev => [...prev, {
                EstadoID: Date.now(), // Temp
                Nombre: newStatus.nombre,
                ColorHex: newStatus.color,
                Orden: newStatus.orden,
                EsFinal: newStatus.esFinal,
                TipoEstado: newStatus.tipoEstado,
                Temp: true
            }].sort((a, b) => a.Orden - b.Orden));
            setNewStatus({ nombre: '', color: '#cccccc', orden: statusList.length + 1, esFinal: false, tipoEstado: 'ESTADOENAREA' });
        } catch (e) {
            console.error(e);
            alert('Error al agregar');
        } finally {
            setLoading(false);
        }
    };

    // --- EDITAR ---
    const startEdit = (st) => {
        setEditingId(st.EstadoID);
        setEditForm({
            nombre: st.Nombre,
            color: st.ColorHex,
            orden: st.Orden,
            esFinal: st.EsFinal,
            tipoEstado: st.TipoEstado || 'ESTADOENAREA'
        });
    };

    const saveEdit = async (id) => {
        try {
            await areasService.updateStatus(id, {
                nombre: editForm.nombre,
                colorHex: editForm.color,
                orden: editForm.orden,
                esFinal: editForm.esFinal,
                tipoEstado: editForm.tipoEstado
            });
            setStatusList(prev => prev.map(s => s.EstadoID === id ? {
                ...s,
                Nombre: editForm.nombre,
                ColorHex: editForm.color,
                Orden: editForm.orden,
                EsFinal: editForm.esFinal,
                TipoEstado: editForm.tipoEstado
            } : s).sort((a, b) => a.Orden - b.Orden));
            setEditingId(null);
        } catch (e) {
            alert('Error al actualizar');
        }
    };

    // --- ELIMINAR ---
    const handleDelete = async (id) => {
        if (!window.confirm("¿Seguro de eliminar este estado?")) return;
        try {
            await areasService.deleteStatus(id);
            setStatusList(prev => prev.filter(s => s.EstadoID !== id));
        } catch (e) {
            alert('Error al eliminar');
        }
    };

    return (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                    <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-list-check text-emerald-500 bg-emerald-100 p-1.5 rounded-lg text-sm"></i>
                        Configurar Estados: <span className="text-emerald-600">{areaCode}</span>
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50">

                    {/* FORM AGREGAR */}
                    <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm mb-6">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Nuevo Estado</h4>
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                            <div className="md:col-span-2">
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Nombre</label>
                                <input type="text" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none focus:border-emerald-500"
                                    value={newStatus.nombre} onChange={e => setNewStatus({ ...newStatus, nombre: e.target.value })} placeholder="Ej: EN PROCESO" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Tipo</label>
                                <select className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newStatus.tipoEstado} onChange={e => setNewStatus({ ...newStatus, tipoEstado: e.target.value })}>
                                    <option value="ESTADOENAREA">ESTADOENAREA</option>
                                    <option value="ESTADO">ESTADO</option>
                                    <option value="ESTADOLOGISTICA">ESTADOLOGISTICA</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Color</label>
                                <div className="flex gap-2">
                                    <input type="color" className="w-8 h-[38px] rounded cursor-pointer border-none"
                                        value={newStatus.color} onChange={e => setNewStatus({ ...newStatus, color: e.target.value })} />
                                    <input type="text" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-mono text-zinc-600 outline-none"
                                        value={newStatus.color} onChange={e => setNewStatus({ ...newStatus, color: e.target.value })} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 pb-3">
                                <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded"
                                    checked={newStatus.esFinal} onChange={e => setNewStatus({ ...newStatus, esFinal: e.target.checked })} />
                                <label className="text-xs font-bold text-zinc-600">¿Es Final?</label>
                            </div>

                            <button onClick={handleAdd} disabled={loading} className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg shadow-md hover:bg-emerald-700 h-[38px] flex items-center justify-center gap-2">
                                <i className="fa-solid fa-plus"></i> Crear
                            </button>
                        </div>
                    </div>

                    {/* TABLA */}
                    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">
                                <tr>
                                    <th className="px-4 py-3 font-bold text-center w-16">Ord.</th>
                                    <th className="px-4 py-3 font-bold">Nombre</th>
                                    <th className="px-4 py-3 font-bold text-center w-32">Tipo</th>
                                    <th className="px-4 py-3 font-bold text-center w-32">Color</th>
                                    <th className="px-4 py-3 font-bold text-center w-24">Final</th>
                                    <th className="px-4 py-3 font-bold text-center w-28">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {statusList.length === 0 ? (
                                    <tr><td colSpan="6" className="py-8 text-center text-zinc-400 italic">No hay estados configurados.</td></tr>
                                ) : (
                                    statusList.map((st) => {
                                        const isEditing = editingId === st.EstadoID;
                                        return (
                                            <tr key={st.EstadoID || Math.random()} className={isEditing ? "bg-emerald-50/50" : "hover:bg-zinc-50"}>
                                                {/* ORDEN */}
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <input type="number" className="w-full px-1 py-1 text-center bg-white border border-emerald-300 rounded"
                                                            value={editForm.orden} onChange={e => setEditForm({ ...editForm, orden: parseInt(e.target.value) })} />
                                                    ) : (
                                                        <span className="font-mono font-bold text-zinc-400">#{st.Orden}</span>
                                                    )}
                                                </td>
                                                {/* NOMBRE */}
                                                <td className="px-4 py-3">
                                                    {isEditing ? (
                                                        <input type="text" className="w-full px-2 py-1 bg-white border border-emerald-300 rounded focus:outline-none"
                                                            value={editForm.nombre} onChange={e => setEditForm({ ...editForm, nombre: e.target.value })} />
                                                    ) : (
                                                        <span className="font-bold text-zinc-700">{st.Nombre}</span>
                                                    )}
                                                </td>
                                                {/* TIPO */}
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <select className="w-full px-1 py-1 bg-white border border-emerald-300 rounded text-xs"
                                                            value={editForm.tipoEstado} onChange={e => setEditForm({ ...editForm, tipoEstado: e.target.value })}>
                                                            <option value="ESTADOENAREA">ESTADOENAREA</option>
                                                            <option value="ESTADO">ESTADO</option>
                                                            <option value="ESTADOLOGISTICA">ESTADOLOGISTICA</option>
                                                        </select>
                                                    ) : (
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase border ${st.TipoEstado === 'ESTADO' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                                            st.TipoEstado === 'ESTADOENAREA' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                                                st.TipoEstado === 'ESTADOLOGISTICA' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                                                    'bg-zinc-50 text-zinc-500 border-zinc-200'
                                                            }`}>{st.TipoEstado || 'ESTADOENAREA'}</span>
                                                    )}
                                                </td>
                                                {/* COLOR */}
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <input type="color" className="w-full h-6 rounded cursor-pointer"
                                                            value={editForm.color} onChange={e => setEditForm({ ...editForm, color: e.target.value })} />
                                                    ) : (
                                                        <div className="flex items-center justify-center gap-2">
                                                            <div className="w-4 h-4 rounded-full border border-zinc-200 shadow-sm" style={{ backgroundColor: st.ColorHex }}></div>
                                                            <span className="text-xs font-mono text-zinc-400">{st.ColorHex}</span>
                                                        </div>
                                                    )}
                                                </td>
                                                {/* FINAL */}
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <input type="checkbox" className="w-4 h-4 text-emerald-600"
                                                            checked={editForm.esFinal} onChange={e => setEditForm({ ...editForm, esFinal: e.target.checked })} />
                                                    ) : (
                                                        st.EsFinal ? <i className="fa-solid fa-flag-checkered text-emerald-500"></i> : <span className="text-zinc-300">-</span>
                                                    )}
                                                </td>
                                                {/* ACCIONES */}
                                                <td className="px-4 py-3 text-center">
                                                    {isEditing ? (
                                                        <div className="flex gap-1 justify-center">
                                                            <button onClick={() => saveEdit(st.EstadoID)} className="w-7 h-7 flex items-center justify-center rounded bg-emerald-100 text-emerald-600 hover:bg-emerald-200">
                                                                <i className="fa-solid fa-check text-xs"></i>
                                                            </button>
                                                            <button onClick={() => setEditingId(null)} className="w-7 h-7 flex items-center justify-center rounded bg-red-100 text-red-600 hover:bg-red-200">
                                                                <i className="fa-solid fa-xmark text-xs"></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-1 justify-center">
                                                            <button onClick={() => startEdit(st)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-emerald-500">
                                                                <i className="fa-solid fa-pen-to-square"></i>
                                                            </button>
                                                            <button onClick={() => handleDelete(st.EstadoID)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500">
                                                                <i className="fa-solid fa-trash-can"></i>
                                                            </button>
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

                <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-end shrink-0">
                    <button onClick={onClose} className="px-4 py-2 bg-white border border-zinc-200 text-zinc-600 rounded-lg text-sm font-bold hover:bg-zinc-100">
                        Cerrar config
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfigStatusesModal;
