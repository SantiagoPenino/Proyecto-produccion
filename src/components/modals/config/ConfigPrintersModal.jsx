import React, { useState, useEffect } from 'react';
import { areasService } from '../../../services/api';

const ConfigPrintersModal = ({ isOpen, onClose, areaCode, equipos }) => {
    // Estado para nuevo equipo
    const [newPrinter, setNewPrinter] = useState({ nombre: '', cap: 100, vel: 10, estado: 'DISPONIBLE', estadoProceso: 'DETENIDO' });
    const [loading, setLoading] = useState(false);

    // Lista local
    const [localList, setLocalList] = useState([]);

    // Estado de Edición
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ nombre: '', cap: 0, vel: 0, estado: 'DISPONIBLE', estadoProceso: 'DETENIDO', activo: true });

    useEffect(() => {
        if (equipos) setLocalList(equipos);
    }, [equipos]);

    if (!isOpen) return null;

    // --- AGREGAR NUEVO ---
    const handleAdd = async () => {
        if (!newPrinter.nombre.trim()) return;
        setLoading(true);
        try {
            await areasService.addPrinter({
                areaId: areaCode,
                nombre: newPrinter.nombre,
                capacidad: newPrinter.cap,
                velocidad: newPrinter.vel,
                estado: newPrinter.estado,
                estadoProceso: newPrinter.estadoProceso
            });

            alert('Equipo agregado. La lista se actualizará al cerrar.');
            // Actualización optimista
            setLocalList(prev => [...prev, {
                EquipoID: Date.now(), // Temp ID
                Nombre: newPrinter.nombre,
                Capacidad: newPrinter.cap,
                Velocidad: newPrinter.vel,
                Estado: newPrinter.estado,
                EstadoProceso: newPrinter.estadoProceso,
                Activo: true,
                Temp: true
            }]);
            setNewPrinter({ nombre: '', cap: 100, vel: 10, estado: 'DISPONIBLE', estadoProceso: 'DETENIDO' });
        } catch (error) {
            alert('Error al agregar equipo');
        } finally {
            setLoading(false);
        }
    };

    // --- EDITAR ---
    const startEdit = (eq) => {
        setEditingId(eq.EquipoID);
        setEditForm({
            nombre: eq.Nombre,
            cap: eq.Capacidad || 100,
            vel: eq.Velocidad || 10,
            estado: eq.Estado || 'DISPONIBLE',
            estadoProceso: eq.EstadoProceso || 'DETENIDO',
            activo: eq.Activo !== false
        });
    };

    const saveEdit = async (id) => {
        try {
            await areasService.updatePrinter(id, {
                nombre: editForm.nombre,
                capacidad: editForm.cap,
                velocidad: editForm.vel,
                estado: editForm.estado,
                estadoProceso: editForm.estadoProceso,
                activo: editForm.activo
            });

            // Actualizar lista local visualmente
            setLocalList(prev => prev.map(eq =>
                eq.EquipoID === id
                    ? {
                        ...eq,
                        Nombre: editForm.nombre,
                        Capacidad: editForm.cap,
                        Velocidad: editForm.vel,
                        Estado: editForm.estado,
                        EstadoProceso: editForm.estadoProceso,
                        Activo: editForm.activo
                    }
                    : eq
            ));

            setEditingId(null);
        } catch (e) {
            alert("Error al guardar cambios");
        }
    };

    // --- ELIMINAR ---
    const handleDelete = async (id) => {
        if (!window.confirm("¿Seguro que deseas eliminar este equipo?")) return;
        try {
            await areasService.deletePrinter(id);
            setLocalList(prev => prev.filter(eq => eq.EquipoID !== id));
        } catch (e) {
            alert("Error al eliminar equipo");
        }
    };

    return (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                    <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-industry text-zinc-400 bg-zinc-100 p-1.5 rounded-lg text-sm"></i>
                        Gestión de Equipos: <span className="text-blue-600">{areaCode}</span>
                    </h3>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors"
                    >
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50">

                    {/* BARRA DE AGREGAR */}
                    <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm mb-6">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Nuevo Equipo</h4>
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                            <div className="md:col-span-2">
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Nombre</label>
                                <input
                                    type="text"
                                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none focus:border-blue-500"
                                    placeholder="Ej: DTF-03"
                                    value={newPrinter.nombre}
                                    onChange={(e) => setNewPrinter({ ...newPrinter, nombre: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Est. Config</label>
                                <select
                                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newPrinter.estado}
                                    onChange={(e) => setNewPrinter({ ...newPrinter, estado: e.target.value })}
                                >
                                    <option value="DISPONIBLE">DISPONIBLE</option>
                                    <option value="MANTENIMIENTO">MANTENIMIENTO</option>
                                    <option value="OCUPADO">OCUPADO</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Est. Proceso</label>
                                <input
                                    type="text"
                                    placeholder="Ej: DETENIDO"
                                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none focus:border-blue-500"
                                    value={newPrinter.estadoProceso}
                                    onChange={(e) => setNewPrinter({ ...newPrinter, estadoProceso: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Cap. (u/día)</label>
                                <input
                                    type="number"
                                    className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none focus:border-blue-500"
                                    value={newPrinter.cap}
                                    onChange={(e) => setNewPrinter({ ...newPrinter, cap: e.target.value })}
                                />
                            </div>
                            <button
                                className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg shadow-md hover:bg-blue-700 active:scale-95 disabled:opacity-50 h-[38px] flex items-center justify-center gap-2"
                                onClick={handleAdd}
                                disabled={loading}
                            >
                                {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-plus"></i>}
                                Crear
                            </button>
                        </div>
                    </div>

                    {/* TABLA DE EQUIPOS */}
                    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">
                                <tr>
                                    <th className="px-4 py-3 font-bold w-12 text-center">Act</th>
                                    <th className="px-4 py-3 font-bold">Nombre Equipo</th>
                                    <th className="px-4 py-3 font-bold text-center w-32">Est. Config</th>
                                    <th className="px-4 py-3 font-bold text-center w-32">Est. Proceso</th>
                                    <th className="px-4 py-3 font-bold text-center w-24">Vel <span className="normal-case text-[9px] text-zinc-400 block font-normal">(u/h)</span></th>
                                    <th className="px-4 py-3 font-bold text-center w-24">Cap <span className="normal-case text-[9px] text-zinc-400 block font-normal">(u/día)</span></th>
                                    <th className="px-4 py-3 font-bold text-center w-28">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {localList.length === 0 ? (
                                    <tr><td colSpan="6" className="py-8 text-center text-zinc-400 italic text-xs">No hay equipos configurados.</td></tr>
                                ) : (
                                    localList.map((eq) => {
                                        const isEditing = editingId === eq.EquipoID;

                                        return (
                                            <tr key={eq.EquipoID || Math.random()} className={isEditing ? "bg-blue-50/50" : "hover:bg-zinc-50 transition-colors"}>

                                                {/* ACTIVO CHECKBOX */}
                                                <td className="px-4 py-3 align-middle text-center">
                                                    {isEditing ? (
                                                        <input
                                                            type="checkbox"
                                                            checked={editForm.activo}
                                                            onChange={e => setEditForm({ ...editForm, activo: e.target.checked })}
                                                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                                        />
                                                    ) : (
                                                        <div className={`w-3 h-3 rounded-full mx-auto ${eq.Activo ? 'bg-emerald-500' : 'bg-zinc-300'}`} title={eq.Activo ? 'Activo' : 'Inactivo'}></div>
                                                    )}
                                                </td>

                                                {/* NOMBRE */}
                                                <td className="px-4 py-3 align-middle">
                                                    {isEditing ? (
                                                        <input
                                                            type="text"
                                                            className="w-full px-2 py-1 bg-white border border-blue-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                            value={editForm.nombre}
                                                            onChange={e => setEditForm({ ...editForm, nombre: e.target.value })}
                                                        />
                                                    ) : (
                                                        <span className={`font-bold ${eq.Activo ? 'text-zinc-700' : 'text-zinc-400'}`}>{eq.Nombre}</span>
                                                    )}
                                                </td>

                                                {/* ESTADO CONFIG */}
                                                <td className="px-4 py-3 align-middle text-center">
                                                    {isEditing ? (
                                                        <select
                                                            className="w-full px-2 py-1 bg-white border border-blue-300 rounded text-sm focus:outline-none"
                                                            value={editForm.estado}
                                                            onChange={e => setEditForm({ ...editForm, estado: e.target.value })}
                                                        >
                                                            <option value="DISPONIBLE">DISPONIBLE</option>
                                                            <option value="MANTENIMIENTO">MANTENIMIENTO</option>
                                                            <option value="OCUPADO">OCUPADO</option>
                                                        </select>
                                                    ) : (
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase
                                                            ${eq.Estado === 'DISPONIBLE' ? 'bg-emerald-100 text-emerald-600' :
                                                                eq.Estado === 'MANTENIMIENTO' ? 'bg-amber-100 text-amber-600' :
                                                                    'bg-zinc-100 text-zinc-500'}`}>
                                                            {eq.Estado || 'N/A'}
                                                        </span>
                                                    )}
                                                </td>

                                                {/* ESTADO PROCESO */}
                                                <td className="px-4 py-3 align-middle text-center">
                                                    {isEditing ? (
                                                        <input
                                                            type="text"
                                                            className="w-full px-2 py-1 bg-white border border-blue-300 rounded text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                            value={editForm.estadoProceso}
                                                            onChange={e => setEditForm({ ...editForm, estadoProceso: e.target.value })}
                                                        />
                                                    ) : (
                                                        <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase">
                                                            {eq.EstadoProceso || 'DETENIDO'}
                                                        </span>
                                                    )}
                                                </td>

                                                {/* VELOCIDAD */}
                                                <td className="px-4 py-3 align-middle text-center">
                                                    {isEditing ? (
                                                        <input
                                                            type="number"
                                                            className="w-full px-2 py-1 bg-white border border-blue-300 rounded text-sm text-center focus:outline-none"
                                                            value={editForm.vel}
                                                            onChange={e => setEditForm({ ...editForm, vel: e.target.value })}
                                                        />
                                                    ) : (
                                                        <span className="font-mono text-zinc-600 font-medium">{eq.Velocidad || 0}</span>
                                                    )}
                                                </td>

                                                {/* CAPACIDAD */}
                                                <td className="px-4 py-3 align-middle text-center">
                                                    {isEditing ? (
                                                        <input
                                                            type="number"
                                                            className="w-full px-2 py-1 bg-white border border-blue-300 rounded text-sm text-center focus:outline-none"
                                                            value={editForm.cap}
                                                            onChange={e => setEditForm({ ...editForm, cap: e.target.value })}
                                                        />
                                                    ) : (
                                                        <span className="font-mono text-zinc-600 font-medium">{eq.Capacidad || 0}</span>
                                                    )}
                                                </td>

                                                {/* ACCIONES */}
                                                <td className="px-4 py-3 align-middle text-center">
                                                    {isEditing ? (
                                                        <div className="flex gap-1 justify-center">
                                                            <button
                                                                onClick={() => saveEdit(eq.EquipoID)}
                                                                className="w-7 h-7 flex items-center justify-center rounded bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-colors"
                                                            >
                                                                <i className="fa-solid fa-check text-xs"></i>
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingId(null)}
                                                                className="w-7 h-7 flex items-center justify-center rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                                                            >
                                                                <i className="fa-solid fa-xmark text-xs"></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-1 justify-center">
                                                            <button
                                                                onClick={() => startEdit(eq)}
                                                                className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-blue-500 transition-colors"
                                                                title="Editar"
                                                            >
                                                                <i className="fa-solid fa-pen-to-square"></i>
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(eq.EquipoID)}
                                                                className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                                                                title="Eliminar"
                                                            >
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
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-zinc-200 text-zinc-600 rounded-lg text-sm font-bold hover:bg-zinc-100 transition-colors"
                    >
                        Cerrar Monitor
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfigPrintersModal;
