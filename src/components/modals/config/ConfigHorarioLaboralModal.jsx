import React, { useState, useEffect } from 'react';
import { horarioLaboralService, areasService } from '../../../services/api';

const ConfigHorarioLaboralModal = ({ isOpen, onClose }) => {
    const [horarios, setHorarios] = useState([]);
    const [areas, setAreas] = useState([]);
    const [loading, setLoading] = useState(false);

    // DiaSemana ISO: 1=Lunes ... 7=Domingo (mismo criterio que usa sp_CalcularFechaEntrega)
    const DIAS = [
        { valor: 1, label: 'Lunes' }, { valor: 2, label: 'Martes' }, { valor: 3, label: 'Miércoles' },
        { valor: 4, label: 'Jueves' }, { valor: 5, label: 'Viernes' }, { valor: 6, label: 'Sábado' },
        { valor: 7, label: 'Domingo' }
    ];
    const nombreDia = (valor) => DIAS.find(d => d.valor === Number(valor))?.label || valor;

    const [newHorario, setNewHorario] = useState({ areaID: '', diaSemana: 1, turno: '', horaInicio: '08:00', horaFin: '17:00' });

    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ areaID: '', diaSemana: 1, turno: '', horaInicio: '08:00', horaFin: '17:00', activo: true });

    useEffect(() => {
        if (isOpen) loadData();
    }, [isOpen]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [hData, aData] = await Promise.all([horarioLaboralService.getAll(), areasService.getAll()]);
            setHorarios(hData);
            setAreas(aData);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newHorario.areaID) return alert("Área requerida");
        try {
            await horarioLaboralService.create(newHorario);
            setNewHorario({ areaID: newHorario.areaID, diaSemana: 1, turno: '', horaInicio: '08:00', horaFin: '17:00' });
            loadData();
        } catch (e) { alert("Error al crear horario: " + (e.response?.data?.error || e.message)); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("¿Eliminar este horario?")) return;
        try {
            await horarioLaboralService.delete(id);
            setHorarios(prev => prev.filter(h => h.HorarioID !== id));
        } catch (e) { alert("Error al eliminar"); }
    };

    const startEdit = (h) => {
        setEditingId(h.HorarioID);
        setEditForm({
            areaID: (h.AreaID || '').trim(),
            diaSemana: h.DiaSemana,
            turno: h.Turno || '',
            horaInicio: (h.HoraInicio || '08:00:00').slice(0, 5),
            horaFin: (h.HoraFin || '17:00:00').slice(0, 5),
            activo: h.Activo !== false
        });
    };

    const saveEdit = async (id) => {
        try {
            await horarioLaboralService.update(id, editForm);
            setEditingId(null);
            loadData();
        } catch (e) { alert("Error al actualizar: " + (e.response?.data?.error || e.message)); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/60 z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                    <h3 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-calendar-days text-teal-500 bg-teal-100 p-1.5 rounded-lg text-sm"></i>
                        Horario Laboral
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50">
                    <p className="text-xs text-zinc-500 mb-4">
                        Días y horario en que trabaja cada área. <b>sp_CalcularFechaEntrega</b> usa esto para saber
                        qué días saltear al calcular la fecha de entrega — si un área no tiene ningún día cargado
                        acá, se sigue calculando como antes (Lunes a Viernes fijo).
                    </p>

                    {/* FORM ADD */}
                    <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm mb-6">
                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Nuevo Día/Turno</h4>
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Área</label>
                                <select className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newHorario.areaID} onChange={e => setNewHorario({ ...newHorario, areaID: e.target.value })}>
                                    <option value="">-- Seleccionar --</option>
                                    {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Día</label>
                                <select className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newHorario.diaSemana} onChange={e => setNewHorario({ ...newHorario, diaSemana: parseInt(e.target.value) })}>
                                    {DIAS.map(d => <option key={d.valor} value={d.valor}>{d.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block" title="Opcional, ej: T1, T2">Turno</label>
                                <input type="text" placeholder="Ej: T1" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newHorario.turno} onChange={e => setNewHorario({ ...newHorario, turno: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Hora Inicio</label>
                                <input type="time" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newHorario.horaInicio} onChange={e => setNewHorario({ ...newHorario, horaInicio: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Hora Fin</label>
                                <input type="time" className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 outline-none"
                                    value={newHorario.horaFin} onChange={e => setNewHorario({ ...newHorario, horaFin: e.target.value })} />
                            </div>
                            <button onClick={handleAdd} className="px-4 py-2 bg-teal-500 text-white text-sm font-bold rounded-lg shadow-md hover:bg-teal-600 h-[38px] flex items-center justify-center gap-2">
                                <i className="fa-solid fa-plus"></i> Agregar
                            </button>
                        </div>
                    </div>

                    {/* TABLE */}
                    <div className="bg-white border border-zinc-200 rounded-xl overflow-x-auto shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">
                                <tr>
                                    <th className="px-4 py-3 font-bold w-12 text-center">Act</th>
                                    <th className="px-4 py-3 font-bold">Área</th>
                                    <th className="px-4 py-3 font-bold text-center">Día</th>
                                    <th className="px-4 py-3 font-bold text-center">Turno</th>
                                    <th className="px-4 py-3 font-bold text-center">Hora Inicio</th>
                                    <th className="px-4 py-3 font-bold text-center">Hora Fin</th>
                                    <th className="px-4 py-3 font-bold text-center">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {loading ? (
                                    <tr><td colSpan="7" className="py-8 text-center text-zinc-400 italic text-xs">Cargando...</td></tr>
                                ) : horarios.length === 0 ? (
                                    <tr><td colSpan="7" className="py-8 text-center text-zinc-400 italic text-xs">No hay horarios definidos.</td></tr>
                                ) : (
                                    [...horarios]
                                        .sort((a, b) => (a.AreaID || '').localeCompare(b.AreaID || '') || a.DiaSemana - b.DiaSemana)
                                        .map(h => {
                                            const isEditing = editingId === h.HorarioID;
                                            return (
                                                <tr key={h.HorarioID} className={isEditing ? "bg-teal-50/50" : (h.Activo ? "hover:bg-zinc-50" : "opacity-50 hover:bg-zinc-50")}>
                                                    <td className="px-4 py-3 align-middle text-center">
                                                        {isEditing ? (
                                                            <input type="checkbox" checked={editForm.activo}
                                                                onChange={e => setEditForm({ ...editForm, activo: e.target.checked })}
                                                                className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500" />
                                                        ) : (
                                                            <div className={`w-3 h-3 rounded-full mx-auto ${h.Activo ? 'bg-emerald-500' : 'bg-zinc-300'}`} title={h.Activo ? 'Activo' : 'Inactivo'}></div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {isEditing ? (
                                                            <select className="px-2 py-1 bg-white border border-teal-300 rounded w-full"
                                                                value={editForm.areaID} onChange={e => setEditForm({ ...editForm, areaID: e.target.value })}>
                                                                {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                                                            </select>
                                                        ) : <span className="font-bold text-zinc-700">{areas.find(a => a.code === (h.AreaID || '').trim())?.name || h.AreaID}</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {isEditing ? (
                                                            <select className="px-2 py-1 bg-white border border-teal-300 rounded"
                                                                value={editForm.diaSemana} onChange={e => setEditForm({ ...editForm, diaSemana: parseInt(e.target.value) })}>
                                                                {DIAS.map(d => <option key={d.valor} value={d.valor}>{d.label}</option>)}
                                                            </select>
                                                        ) : <span className="text-zinc-600 font-semibold">{nombreDia(h.DiaSemana)}</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {isEditing ? (
                                                            <input type="text" className="w-20 text-center border border-teal-300 rounded"
                                                                value={editForm.turno} onChange={e => setEditForm({ ...editForm, turno: e.target.value })} />
                                                        ) : <span className="text-zinc-500 text-xs italic">{h.Turno || '—'}</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {isEditing ? (
                                                            <input type="time" className="border border-teal-300 rounded px-1"
                                                                value={editForm.horaInicio} onChange={e => setEditForm({ ...editForm, horaInicio: e.target.value })} />
                                                        ) : <span className="font-mono text-zinc-700">{(h.HoraInicio || '').toString().slice(0, 5)}</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {isEditing ? (
                                                            <input type="time" className="border border-teal-300 rounded px-1"
                                                                value={editForm.horaFin} onChange={e => setEditForm({ ...editForm, horaFin: e.target.value })} />
                                                        ) : <span className="font-mono text-zinc-700">{(h.HoraFin || '').toString().slice(0, 5)}</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {isEditing ? (
                                                            <div className="flex gap-1 justify-center">
                                                                <button onClick={() => saveEdit(h.HorarioID)} className="w-7 h-7 flex items-center justify-center rounded bg-emerald-100 text-emerald-600"><i className="fa-solid fa-check"></i></button>
                                                                <button onClick={() => setEditingId(null)} className="w-7 h-7 flex items-center justify-center rounded bg-red-100 text-red-600"><i className="fa-solid fa-xmark"></i></button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-1 justify-center">
                                                                <button onClick={() => startEdit(h)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-teal-500"><i className="fa-solid fa-pen-to-square"></i></button>
                                                                <button onClick={() => handleDelete(h.HorarioID)} className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500"><i className="fa-solid fa-trash-can"></i></button>
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

export default ConfigHorarioLaboralModal;
