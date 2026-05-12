import React, { useState, useEffect } from 'react';
import { areasService, insumosService } from '../../../services/api';

const ConfigInsumosModal = ({ isOpen, onClose, areaCode, insumos }) => {
    const [activeTab, setActiveTab] = useState('assign'); // 'assign' | 'manage'

    // Lista local para Asignación (Optimista)
    const [list, setList] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    // Lista para Gestión (CRUD)
    const [allInsumos, setAllInsumos] = useState([]);
    const [crudSearch, setCrudSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [newInsumo, setNewInsumo] = useState({ nombre: '', unidad: 'UN', categoria: 'GENERAL', productivo: true });
    const [editForm, setEditForm] = useState({ nombre: '', unidad: '', categoria: '', productivo: true });

    useEffect(() => {
        if (insumos) setList(insumos);
        if (isOpen && activeTab === 'manage') loadAllInsumos();
    }, [insumos, isOpen, activeTab]);

    const loadAllInsumos = async () => {
        try {
            const data = await insumosService.getAll();
            setAllInsumos(data);
        } catch (e) { console.error(e); }
    };

    if (!isOpen) return null;

    // --- LOGICA ASIGNACION ---
    const toggleInsumo = async (insumo) => {
        const newState = !insumo.Asignado;
        const newList = list.map(i => i.InsumoID === insumo.InsumoID ? { ...i, Asignado: newState } : i);
        setList(newList);
        try {
            await areasService.toggleInsumo({ areaId: areaCode, insumoId: insumo.InsumoID, asignar: newState });
        } catch (error) {
            setList(insumos);
            alert("Error al guardar cambio");
        }
    };

    const filteredList = list.filter(item => item.Nombre?.toLowerCase().includes(searchTerm.toLowerCase()));

    // --- LOGICA CRUD ---
    const handleAdd = async () => {
        if (!newInsumo.nombre) return alert("Nombre requerido");
        try {
            await insumosService.create({
                nombre: newInsumo.nombre,
                unidadDefault: newInsumo.unidad,
                categoria: newInsumo.categoria,
                esProductivo: newInsumo.productivo
            });
            setNewInsumo({ nombre: '', unidad: 'UN', categoria: 'GENERAL', productivo: true });
            loadAllInsumos();
        } catch (e) { alert("Error al crear"); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("¿Eliminar este insumo?")) return;
        try {
            await insumosService.delete(id);
            loadAllInsumos();
        } catch (e) { alert(e.response?.data?.error || "Error al eliminar"); }
    };

    const startEdit = (item) => {
        setEditingId(item.InsumoID);
        setEditForm({
            nombre: item.Nombre,
            unidad: item.UnidadDefault,
            categoria: item.Categoria,
            productivo: item.EsProductivo
        });
    };

    const saveEdit = async (id) => {
        try {
            await insumosService.update(id, {
                nombre: editForm.nombre,
                unidadDefault: editForm.unidad,
                categoria: editForm.categoria,
                esProductivo: editForm.productivo
            });
            setEditingId(null);
            loadAllInsumos();
        } catch (e) { alert("Error al actualizar"); }
    };

    const filteredCrud = allInsumos.filter(i => i.Nombre?.toLowerCase().includes(crudSearch.toLowerCase()));

    return (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className={`bg-white rounded-xl shadow-2xl w-full ${activeTab === 'manage' ? 'max-w-4xl' : 'max-w-md'} flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 max-h-[85vh] transition-all`}>

                {/* Header */}
                <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                    <h3 className="text-base font-black text-zinc-800 flex items-center gap-2">
                        <i className="fa-solid fa-boxes-packing text-amber-500 bg-amber-100 p-1.5 rounded-lg text-sm"></i>
                        Insumos
                    </h3>
                    <div className="flex bg-zinc-100 p-1 rounded-lg">
                        <button onClick={() => setActiveTab('assign')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${activeTab === 'assign' ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                            Asignar a Área
                        </button>
                        <button onClick={() => setActiveTab('manage')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${activeTab === 'manage' ? 'bg-white text-indigo-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                            Gestionar Todos
                        </button>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {activeTab === 'assign' ? (
                    <>
                        <div className="p-4 bg-zinc-50 border-b border-zinc-200">
                            <p className="text-xs text-zinc-500 mb-3 font-medium">Marca los materiales disponibles para <span className="font-bold text-zinc-700">{areaCode}</span>.</p>
                            <div className="relative">
                                <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs"></i>
                                <input type="text" className="w-full pl-9 pr-3 py-2 bg-white border border-zinc-300 rounded-lg text-xs font-semibold focus:outline-none focus:border-amber-500" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto bg-white p-2">
                            {filteredList.length === 0 ? <div className="py-8 text-center text-zinc-400 text-xs italic">Sin resultados.</div> :
                                <div className="space-y-1">
                                    {filteredList.map(item => (
                                        <label key={item.InsumoID} className={`flex items-center p-3 rounded-lg border cursor-pointer ${item.Asignado ? 'bg-amber-50 border-amber-200' : 'bg-white hover:bg-zinc-50'}`}>
                                            <input type="checkbox" checked={!!item.Asignado} onChange={() => toggleInsumo(item)} className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500" />
                                            <div className="ml-3 flex-1">
                                                <div className="text-sm font-bold text-zinc-700">{item.Nombre}</div>
                                                <div className="text-[10px] text-zinc-400">{item.UnidadDefault}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            }
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-50">
                        {/* FORM ADD */}
                        <div className="p-4 bg-white border-b border-zinc-200 shrink-0">
                            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Crear Nuevo Insumo</h4>
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                                <input type="text" placeholder="Nombre" className="px-3 py-2 border rounded text-xs w-full" value={newInsumo.nombre} onChange={e => setNewInsumo({ ...newInsumo, nombre: e.target.value })} />
                                <input type="text" placeholder="Unidad (Ej: KG, MTS)" className="px-3 py-2 border rounded text-xs w-full" value={newInsumo.unidad} onChange={e => setNewInsumo({ ...newInsumo, unidad: e.target.value })} />
                                <input type="text" placeholder="Categoría" className="px-3 py-2 border rounded text-xs w-full" value={newInsumo.categoria} onChange={e => setNewInsumo({ ...newInsumo, categoria: e.target.value })} />
                                <label className="flex items-center gap-2 px-2 py-2 text-xs font-bold text-zinc-600 bg-zinc-100 rounded cursor-pointer border border-transparent hover:border-zinc-300">
                                    <input type="checkbox" checked={newInsumo.productivo} onChange={e => setNewInsumo({ ...newInsumo, productivo: e.target.checked })} />
                                    Es Productivo
                                </label>
                                <button onClick={handleAdd} className="px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700">Agregar</button>
                            </div>
                        </div>
                        {/* TABLE */}
                        <div className="flex-1 overflow-y-auto p-4">
                            <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">
                                        <tr>
                                            <th className="px-4 py-3">Nombre</th>
                                            <th className="px-4 py-3 text-center">Unidad</th>
                                            <th className="px-4 py-3 text-center">Categoría</th>
                                            <th className="px-4 py-3 text-center">Prod.</th>
                                            <th className="px-4 py-3 text-center">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {filteredCrud.map(i => {
                                            const isEditing = editingId === i.InsumoID;
                                            return (
                                                <tr key={i.InsumoID} className={isEditing ? 'bg-indigo-50/50' : 'hover:bg-zinc-50'}>
                                                    <td className="px-4 py-2">
                                                        {isEditing ? <input className="border rounded px-1 w-full text-xs" value={editForm.nombre} onChange={e => setEditForm({ ...editForm, nombre: e.target.value })} /> : <span className="font-bold text-zinc-700">{i.Nombre}</span>}
                                                    </td>
                                                    <td className="px-4 py-2 text-center text-xs">
                                                        {isEditing ? <input className="border rounded px-1 w-16 text-center" value={editForm.unidad} onChange={e => setEditForm({ ...editForm, unidad: e.target.value })} /> : i.UnidadDefault}
                                                    </td>
                                                    <td className="px-4 py-2 text-center text-xs">
                                                        {isEditing ? <input className="border rounded px-1 w-24 text-center" value={editForm.categoria} onChange={e => setEditForm({ ...editForm, categoria: e.target.value })} /> : i.Categoria}
                                                    </td>
                                                    <td className="px-4 py-2 text-center">
                                                        {isEditing ? <input type="checkbox" checked={editForm.productivo} onChange={e => setEditForm({ ...editForm, productivo: e.target.checked })} /> : (i.EsProductivo ? <i className="fa-solid fa-check text-emerald-500"></i> : <span className="text-zinc-300">-</span>)}
                                                    </td>
                                                    <td className="px-4 py-2 text-center">
                                                        {isEditing ? (
                                                            <div className="flex justify-center gap-1">
                                                                <button onClick={() => saveEdit(i.InsumoID)} className="w-6 h-6 rounded bg-emerald-100 text-emerald-600"><i className="fa-solid fa-check text-xs"></i></button>
                                                                <button onClick={() => setEditingId(null)} className="w-6 h-6 rounded bg-zinc-100 text-zinc-500"><i className="fa-solid fa-xmark text-xs"></i></button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex justify-center gap-1">
                                                                <button onClick={() => startEdit(i)} className="w-6 h-6 rounded text-zinc-400 hover:text-indigo-500"><i className="fa-solid fa-pen-to-square"></i></button>
                                                                <button onClick={() => handleDelete(i.InsumoID)} className="w-6 h-6 rounded text-zinc-400 hover:text-red-500"><i className="fa-solid fa-trash-can"></i></button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ConfigInsumosModal;

