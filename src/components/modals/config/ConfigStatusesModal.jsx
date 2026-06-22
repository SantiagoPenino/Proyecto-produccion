import React, { useState, useEffect } from 'react';
import { areasService } from '../../../services/api';

const ConfigStatusesModal = ({ isOpen, onClose, areaCode, initialStatuses, areas = [] }) => {
    // Lista local
    const [statusList, setStatusList] = useState([]);
    const [loading, setLoading] = useState(false);

    // Estado para nuevo
    const [newStatus, setNewStatus] = useState({ areaId: areaCode, nombre: '', color: '#cccccc', orden: 0, esFinal: false, tipoEstado: 'ESTADOENAREA', estadoPadreId: '' });

    // Estado edición
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ areaId: areaCode, nombre: '', color: '', orden: 0, esFinal: false, tipoEstado: 'ESTADOENAREA', estadoPadreId: '' });

    // Estado de expansión del árbol
    const [expandedNodes, setExpandedNodes] = useState({});

    useEffect(() => {
        if (initialStatuses) {
            setStatusList([...initialStatuses].sort((a, b) => a.Orden - b.Orden));
        }
    }, [initialStatuses]);

    if (!isOpen) return null;

    const toggleNode = (id) => {
        setExpandedNodes(prev => ({ ...prev, [id]: prev[id] === false ? true : false }));
    };

    const handleAreaToggle = (currentAreasStr, code) => {
        let arr = currentAreasStr ? currentAreasStr.split(',') : [];
        if (code === 'ADMIN') return 'ADMIN';
        arr = arr.filter(a => a !== 'ADMIN' && a !== '');
        if (arr.includes(code)) arr = arr.filter(a => a !== code);
        else arr.push(code);
        return arr.length > 0 ? arr.join(',') : areaCode;
    };

    // --- AGREGAR ---
    const handleAdd = async () => {
        if (!newStatus.nombre.trim()) return;
        setLoading(true);
        try {
            const response = await areasService.addStatus({
                areaId: newStatus.areaId,
                nombre: newStatus.nombre,
                colorHex: newStatus.color,
                orden: newStatus.orden,
                esFinal: newStatus.esFinal,
                tipoEstado: newStatus.tipoEstado,
                estadoPadreId: newStatus.estadoPadreId || null
            });
            alert('Estado agregado. Se actualizará al recargar.');
            setStatusList(prev => [...prev, {
                EstadoID: response.insertId || Date.now(), // Usar el ID real
                AreaID: newStatus.areaId,
                Nombre: newStatus.nombre,
                ColorHex: newStatus.color,
                Orden: newStatus.orden,
                EsFinal: newStatus.esFinal,
                TipoEstado: newStatus.tipoEstado,
                EstadoPadreID: newStatus.estadoPadreId ? parseInt(newStatus.estadoPadreId) : null,
                Temp: true
            }].sort((a, b) => a.Orden - b.Orden));
            setNewStatus({ areaId: areaCode, nombre: '', color: '#cccccc', orden: statusList.length + 1, esFinal: false, tipoEstado: 'ESTADOENAREA', estadoPadreId: '' });
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
            areaId: st.AreaID || areaCode,
            nombre: st.Nombre,
            color: st.ColorHex,
            orden: st.Orden,
            esFinal: st.EsFinal,
            tipoEstado: st.TipoEstado || 'ESTADOENAREA',
            estadoPadreId: st.EstadoPadreID || ''
        });
    };

    const saveEdit = async (id) => {
        try {
            await areasService.updateStatus(id, {
                areaId: editForm.areaId,
                nombre: editForm.nombre,
                colorHex: editForm.color,
                orden: editForm.orden,
                esFinal: editForm.esFinal,
                tipoEstado: editForm.tipoEstado,
                estadoPadreId: editForm.estadoPadreId || null
            });
            setStatusList(prev => prev.map(s => s.EstadoID === id ? {
                ...s,
                AreaID: editForm.areaId,
                Nombre: editForm.nombre,
                ColorHex: editForm.color,
                Orden: editForm.orden,
                EsFinal: editForm.esFinal,
                TipoEstado: editForm.tipoEstado,
                EstadoPadreID: editForm.estadoPadreId ? parseInt(editForm.estadoPadreId) : null
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

    const parentStates = statusList.filter(s => s.TipoEstado === 'ESTADO');

    // Agrupar para renderizado tipo árbol
    const parentMap = {};
    statusList.forEach(st => {
        if (st.EstadoPadreID) {
            if (!parentMap[st.EstadoPadreID]) parentMap[st.EstadoPadreID] = [];
            parentMap[st.EstadoPadreID].push(st);
        }
    });

    const rootElements = statusList.filter(st => st.TipoEstado === 'ESTADO' || st.TipoEstado === 'ESTADOLOGISTICA').sort((a, b) => a.Orden - b.Orden);
    
    const handledIds = [];
    rootElements.forEach(r => {
        handledIds.push(r.EstadoID);
        if (parentMap[r.EstadoID]) {
            parentMap[r.EstadoID].forEach(c => handledIds.push(c.EstadoID));
        }
    });
    
    const orphans = statusList.filter(st => !handledIds.includes(st.EstadoID)).sort((a,b) => a.Orden - b.Orden);

    return (
        <div className="fixed inset-0 bg-slate-900/60 z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-slate-50/95 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                {/* Header */}
                <div className="px-6 py-4 border-b border-zinc-200 flex justify-between items-center bg-white shrink-0 shadow-sm z-10">
                    <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-list-check text-blue-500 bg-blue-50 p-1.5 rounded-lg text-sm"></i>
                        Estructura Visual de Estados: <span className="text-blue-600">{areaCode}</span>
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">

                    {/* FORM AGREGAR */}
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm mb-8">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <i className="fa-solid fa-plus-circle"></i> Nuevo Estado
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-10 gap-3 items-end">
                            <div className="md:col-span-2">
                                <label className="text-[10px] uppercase font-bold text-slate-400 mb-1 block">Áreas Asignadas</label>
                                <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 h-[38px] overflow-y-auto flex flex-wrap gap-2 items-center hover:h-24 hover:absolute hover:z-50 hover:shadow-xl transition-all">
                                    <label className="flex items-center gap-1 cursor-pointer">
                                        <input type="checkbox" className="w-3 h-3 text-blue-600 rounded"
                                            checked={newStatus.areaId === 'ADMIN' || newStatus.areaId.split(',').includes('ADMIN')}
                                            onChange={() => setNewStatus({ ...newStatus, areaId: handleAreaToggle(newStatus.areaId, 'ADMIN') })} />
                                        <span className="text-[10px] font-bold text-slate-700">ADMIN</span>
                                    </label>
                                    {areas.filter(a => a.code !== 'ADMIN').map(a => (
                                        <label key={a.code} className="flex items-center gap-1 cursor-pointer">
                                            <input type="checkbox" className="w-3 h-3 text-blue-600 rounded"
                                                checked={newStatus.areaId.split(',').includes(a.code)}
                                                onChange={() => setNewStatus({ ...newStatus, areaId: handleAreaToggle(newStatus.areaId, a.code) })} />
                                            <span className="text-[10px] font-bold text-slate-700">{a.code}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-[10px] uppercase font-bold text-slate-400 mb-1 block">Nombre</label>
                                <input type="text" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-blue-500 transition-colors"
                                    value={newStatus.nombre} onChange={e => setNewStatus({ ...newStatus, nombre: e.target.value })} placeholder="Ej: EN PROCESO" />
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-[10px] uppercase font-bold text-slate-400 mb-1 block">Tipo</label>
                                <select className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-blue-500 transition-colors"
                                    value={newStatus.tipoEstado} onChange={e => setNewStatus({ ...newStatus, tipoEstado: e.target.value })}>
                                    <option value="ESTADOENAREA">ESTADOENAREA</option>
                                    <option value="ESTADO">ESTADO GENERAL</option>
                                    <option value="ESTADOLOGISTICA">ESTADOLOGISTICA</option>
                                </select>
                            </div>
                            
                            {(newStatus.tipoEstado === 'ESTADOENAREA' || newStatus.tipoEstado === 'ESTADOLOGISTICA') && (
                                <div className="md:col-span-2">
                                    <label className="text-[10px] uppercase font-bold text-slate-400 mb-1 block">Estado Padre</label>
                                    <select className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-blue-500 transition-colors"
                                        value={newStatus.estadoPadreId} onChange={e => setNewStatus({ ...newStatus, estadoPadreId: e.target.value })}>
                                        <option value="">-- Ninguno --</option>
                                        {parentStates.map(p => <option key={p.EstadoID} value={p.EstadoID}>{p.Nombre}</option>)}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] uppercase font-bold text-slate-400 mb-1 block">Color</label>
                                <div className="flex gap-2">
                                    <input type="color" className="w-8 h-[38px] rounded cursor-pointer border border-slate-200 shadow-sm"
                                        value={newStatus.color} onChange={e => setNewStatus({ ...newStatus, color: e.target.value })} />
                                </div>
                            </div>
                            <div className="flex items-center gap-2 pb-3">
                                <input type="checkbox" className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                                    checked={newStatus.esFinal} onChange={e => setNewStatus({ ...newStatus, esFinal: e.target.checked })} />
                                <label className="text-xs font-bold text-slate-600 cursor-pointer" onClick={() => setNewStatus({...newStatus, esFinal: !newStatus.esFinal})}>¿Final?</label>
                            </div>

                            <button onClick={handleAdd} disabled={loading} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg shadow-md hover:bg-blue-700 h-[38px] flex items-center justify-center gap-2 transition-colors">
                                <i className="fa-solid fa-plus"></i>
                            </button>
                        </div>
                    </div>

                    {/* ESTRUCTURA VISUAL ÁRBOL */}
                    <div className="flex flex-col gap-3 relative">
                        {rootElements.length === 0 && orphans.length === 0 && (
                            <div className="p-10 text-center text-slate-400 italic font-medium bg-white rounded-2xl border border-slate-200 shadow-sm">No hay estados configurados.</div>
                        )}

                        {rootElements.map((root) => {
                            const isEditing = editingId === root.EstadoID;
                            const children = parentMap[root.EstadoID] ? parentMap[root.EstadoID].sort((a,b)=>a.Orden-b.Orden) : [];
                            const hasChildren = children.length > 0;
                            const isExpanded = expandedNodes[root.EstadoID] !== false; // Default true

                            return (
                                <div key={root.EstadoID} className="flex flex-col relative group">
                                    {/* Root Card */}
                                    <div className={`bg-white rounded-2xl border ${isEditing ? 'border-blue-400 ring-4 ring-blue-50' : 'border-slate-200'} shadow-sm flex items-center p-3 z-10 hover:border-blue-300 transition-all`}>
                                        
                                        {/* Grab Icon */}
                                        <div className="w-8 flex justify-center text-slate-300">
                                            <i className="fa-solid fa-grip-vertical"></i>
                                        </div>

                                        {/* Expand/Collapse Toggle */}
                                        <button onClick={() => toggleNode(root.EstadoID)} className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} disabled={!hasChildren}>
                                            {hasChildren ? <i className="fa-solid fa-chevron-right text-xs"></i> : <i className="fa-solid fa-circle text-[4px] opacity-30"></i>}
                                        </button>

                                        {/* Icon */}
                                        <div className={`w-12 h-12 shrink-0 rounded-[14px] ${root.TipoEstado==='ESTADOLOGISTICA'?'bg-indigo-600':'bg-blue-600'} text-white flex items-center justify-center mx-3 shadow-md`}>
                                            <i className={`fa-solid ${root.TipoEstado==='ESTADOLOGISTICA'?'fa-truck-fast':'fa-house'} text-xl`}></i>
                                        </div>

                                        {/* Content / Edit Form */}
                                        {isEditing ? (
                                            <div className="flex-1 grid grid-cols-12 gap-2 items-center">
                                                <input type="number" className="col-span-1 px-2 py-1.5 border border-blue-300 rounded-lg text-center text-sm font-bold bg-slate-50 outline-none" value={editForm.orden} onChange={e=>setEditForm({...editForm, orden: parseInt(e.target.value)})} title="Orden" />
                                                <input type="text" className="col-span-3 px-3 py-1.5 border border-blue-300 rounded-lg font-bold text-sm bg-slate-50 outline-none" value={editForm.nombre} onChange={e=>setEditForm({...editForm, nombre: e.target.value})} />
                                                <select className="col-span-3 px-2 py-1.5 border border-blue-300 rounded-lg text-xs font-bold text-slate-700 bg-slate-50 outline-none" value={editForm.tipoEstado} onChange={e=>setEditForm({...editForm, tipoEstado: e.target.value})}>
                                                    <option value="ESTADOENAREA">ESTADOENAREA</option>
                                                    <option value="ESTADO">ESTADO GENERAL</option>
                                                    <option value="ESTADOLOGISTICA">ESTADOLOGISTICA</option>
                                                </select>
                                                {/* Color & Final */}
                                                <div className="col-span-2 flex items-center gap-2 px-2">
                                                    <input type="color" className="w-8 h-8 rounded-md cursor-pointer border-none" value={editForm.color} onChange={e=>setEditForm({...editForm, color: e.target.value})} />
                                                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer"><input type="checkbox" className="w-3.5 h-3.5 rounded" checked={editForm.esFinal} onChange={e=>setEditForm({...editForm, esFinal: e.target.checked})} /> Final</label>
                                                </div>
                                                <div className="col-span-3 flex gap-1.5 justify-end px-2">
                                                    <button onClick={() => saveEdit(root.EstadoID)} className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-colors"><i className="fa-solid fa-check"></i></button>
                                                    <button onClick={() => setEditingId(null)} className="w-9 h-9 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"><i className="fa-solid fa-xmark"></i></button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex-1 flex flex-col justify-center">
                                                    <span className="font-extrabold text-slate-900 text-base">{root.Nombre}</span>
                                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-bold mt-0.5">
                                                        <i className="fa-solid fa-link text-[9px]"></i> / {root.AreaID || areaCode}
                                                    </div>
                                                </div>
                                                
                                                {/* Info Badges */}
                                                <div className="flex items-center gap-5 px-4 shrink-0">
                                                    <div className="flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Ord</span>
                                                        <span className="text-sm font-mono font-bold text-slate-400">#{root.Orden}</span>
                                                    </div>
                                                    <span className={`text-[9px] font-black px-2 py-1 rounded-md uppercase border ${root.TipoEstado==='ESTADOLOGISTICA'?'bg-indigo-50 text-indigo-600 border-indigo-200':'bg-blue-50 text-blue-600 border-blue-200'}`}>
                                                        {root.TipoEstado==='ESTADOLOGISTICA'?'LOGISTICA':'GENERAL'}
                                                    </span>
                                                    <div className="w-5 h-5 rounded-full shadow-sm border-2 border-white ring-1 ring-slate-200" style={{backgroundColor: root.ColorHex}}></div>
                                                    {root.EsFinal ? <i className="fa-solid fa-flag-checkered text-emerald-500 w-5 text-center"></i> : <span className="w-5"></span>}
                                                </div>

                                                {/* Actions */}
                                                <div className="flex gap-1.5 shrink-0 px-2">
                                                    <button onClick={() => startEdit(root)} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600 transition-colors"><i className="fa-solid fa-pen-to-square"></i></button>
                                                    <button onClick={() => handleDelete(root.EstadoID)} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"><i className="fa-solid fa-trash-can"></i></button>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Children List */}
                                    {isExpanded && hasChildren && (
                                        <div className="ml-[4.5rem] mt-3 pl-8 border-l-2 border-dashed border-slate-300/70 flex flex-col gap-3 relative z-0 pb-2">
                                            {children.map((child) => {
                                                const isEditingChild = editingId === child.EstadoID;
                                                return (
                                                    <div key={child.EstadoID} className={`bg-white rounded-xl border ${isEditingChild ? 'border-emerald-300 ring-4 ring-emerald-50' : 'border-slate-200'} shadow-sm flex items-center p-2 hover:border-slate-300 transition-all relative group/child`}>
                                                        
                                                        {/* Connection Line */}
                                                        <div className="absolute -left-8 top-1/2 w-8 border-t-2 border-dashed border-slate-300/70"></div>

                                                        {/* Grab Icon */}
                                                        <div className="w-8 flex justify-center text-slate-200">
                                                            <i className="fa-solid fa-grip-vertical text-sm"></i>
                                                        </div>

                                                        {/* Icon */}
                                                        <div className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-2 border border-slate-200 shadow-sm">
                                                            <i className="fa-solid fa-list-ul"></i>
                                                        </div>

                                                        {/* Content / Edit Form */}
                                                        {isEditingChild ? (
                                                            <div className="flex-1 grid grid-cols-12 gap-2 items-center">
                                                                <input type="number" className="col-span-1 px-1.5 py-1.5 border border-emerald-300 rounded-lg text-center text-xs font-bold outline-none bg-slate-50" value={editForm.orden} onChange={e=>setEditForm({...editForm, orden: parseInt(e.target.value)})} />
                                                                <input type="text" className="col-span-3 px-2 py-1.5 border border-emerald-300 rounded-lg font-bold text-sm outline-none bg-slate-50" value={editForm.nombre} onChange={e=>setEditForm({...editForm, nombre: e.target.value})} />
                                                                <div className="col-span-4 flex flex-col gap-1.5">
                                                                    <select className="px-2 py-1 border border-emerald-300 rounded-md text-[10px] font-bold text-slate-600 outline-none bg-slate-50" value={editForm.tipoEstado} onChange={e=>setEditForm({...editForm, tipoEstado: e.target.value})}>
                                                                        <option value="ESTADOENAREA">ESTADOENAREA</option>
                                                                        <option value="ESTADO">ESTADO GENERAL</option>
                                                                        <option value="ESTADOLOGISTICA">ESTADOLOGISTICA</option>
                                                                    </select>
                                                                    <select className="px-2 py-1 border border-emerald-300 rounded-md text-[10px] font-bold text-slate-600 outline-none bg-slate-50" value={editForm.estadoPadreId} onChange={e=>setEditForm({...editForm, estadoPadreId: e.target.value})}>
                                                                        <option value="">-- Sin Padre --</option>
                                                                        {parentStates.filter(p=>p.EstadoID !== child.EstadoID).map(p=><option key={p.EstadoID} value={p.EstadoID}>{p.Nombre}</option>)}
                                                                    </select>
                                                                </div>
                                                                <div className="col-span-2 flex items-center gap-1.5 px-1">
                                                                    <input type="color" className="w-7 h-7 rounded cursor-pointer border-none" value={editForm.color} onChange={e=>setEditForm({...editForm, color: e.target.value})} />
                                                                    <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500 cursor-pointer"><input type="checkbox" className="w-3 h-3 rounded" checked={editForm.esFinal} onChange={e=>setEditForm({...editForm, esFinal: e.target.checked})} /> Final</label>
                                                                </div>
                                                                <div className="col-span-2 flex gap-1 justify-end px-1">
                                                                    <button onClick={() => saveEdit(child.EstadoID)} className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-colors"><i className="fa-solid fa-check"></i></button>
                                                                    <button onClick={() => setEditingId(null)} className="w-8 h-8 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"><i className="fa-solid fa-xmark"></i></button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className="flex-1 flex flex-col justify-center">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-bold text-slate-700 text-[15px]">{child.Nombre}</span>
                                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase bg-blue-50 text-blue-600 border border-blue-100">SUB</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold mt-0.5">
                                                                        <i className="fa-solid fa-link text-[8px]"></i> / {child.AreaID || areaCode}
                                                                    </div>
                                                                </div>

                                                                {/* Info Badges */}
                                                                <div className="flex items-center gap-4 px-4 shrink-0">
                                                                    <div className="flex items-center gap-1 opacity-0 group-hover/child:opacity-100 transition-opacity w-8 text-right">
                                                                        <span className="text-[11px] font-mono font-bold text-slate-300">#{child.Orden}</span>
                                                                    </div>
                                                                    <div className="w-4 h-4 rounded-full shadow-sm border border-slate-200" style={{backgroundColor: child.ColorHex}}></div>
                                                                    {child.EsFinal ? <i className="fa-solid fa-flag-checkered text-emerald-500 w-4 text-[11px] text-center"></i> : <span className="w-4"></span>}
                                                                </div>

                                                                {/* Actions */}
                                                                <div className="flex gap-1 shrink-0 px-2">
                                                                    <button onClick={() => startEdit(child)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-100 hover:text-emerald-500 transition-colors"><i className="fa-solid fa-pen-to-square text-xs"></i></button>
                                                                    <button onClick={() => handleDelete(child.EstadoID)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"><i className="fa-solid fa-trash-can text-xs"></i></button>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* ORPHANS BLOCK */}
                        {orphans.length > 0 && (
                            <div className="flex flex-col relative mt-6 pt-6 border-t-2 border-dashed border-slate-200">
                                <div className="bg-orange-50/80 rounded-2xl border border-orange-200 shadow-sm flex items-center p-3 z-10 hover:border-orange-300 transition-all group">
                                    <button onClick={() => toggleNode('orphans')} className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg hover:bg-orange-100 text-orange-500 transition-transform ${expandedNodes['orphans'] !== false ? 'rotate-90' : ''}`}>
                                        <i className="fa-solid fa-chevron-right text-xs"></i>
                                    </button>
                                    <div className="w-12 h-12 shrink-0 rounded-[14px] bg-orange-500 text-white flex items-center justify-center mx-3 shadow-md">
                                        <i className="fa-solid fa-triangle-exclamation text-xl"></i>
                                    </div>
                                    <div className="flex-1 flex flex-col justify-center">
                                        <span className="font-extrabold text-orange-800 text-base">Sub-estados sin asignar</span>
                                        <span className="text-[11px] text-orange-600 font-bold mt-0.5">Estos sub-estados no tienen un padre. Edítalos para organizarlos en el árbol.</span>
                                    </div>
                                </div>

                                {expandedNodes['orphans'] !== false && (
                                    <div className="ml-[4.5rem] mt-3 pl-8 border-l-2 border-dashed border-orange-200 flex flex-col gap-3 relative z-0 pb-2">
                                        {orphans.map((child) => {
                                            const isEditingChild = editingId === child.EstadoID;
                                            return (
                                                <div key={child.EstadoID} className={`bg-white rounded-xl border ${isEditingChild ? 'border-orange-300 ring-4 ring-orange-50' : 'border-orange-100'} shadow-sm flex items-center p-2 hover:border-orange-200 transition-all relative group/child`}>
                                                    
                                                    {/* Connection Line */}
                                                    <div className="absolute -left-8 top-1/2 w-8 border-t-2 border-dashed border-orange-200"></div>

                                                    <div className="w-8 flex justify-center text-orange-200">
                                                        <i className="fa-solid fa-grip-vertical text-sm"></i>
                                                    </div>

                                                    <div className="w-10 h-10 shrink-0 rounded-xl bg-orange-50 text-orange-400 flex items-center justify-center mx-2 border border-orange-100 shadow-sm">
                                                        <i className="fa-solid fa-list-ul"></i>
                                                    </div>

                                                    {/* Edit Form / Content */}
                                                    {isEditingChild ? (
                                                        <div className="flex-1 grid grid-cols-12 gap-2 items-center">
                                                                <input type="number" className="col-span-1 px-1.5 py-1.5 border border-orange-300 rounded-lg text-center text-xs font-bold outline-none bg-orange-50/50" value={editForm.orden} onChange={e=>setEditForm({...editForm, orden: parseInt(e.target.value)})} />
                                                                <input type="text" className="col-span-3 px-2 py-1.5 border border-orange-300 rounded-lg font-bold text-sm outline-none bg-orange-50/50" value={editForm.nombre} onChange={e=>setEditForm({...editForm, nombre: e.target.value})} />
                                                                <div className="col-span-4 flex flex-col gap-1.5">
                                                                    <select className="px-2 py-1 border border-orange-300 rounded-md text-[10px] font-bold text-orange-800 outline-none bg-orange-50/50" value={editForm.tipoEstado} onChange={e=>setEditForm({...editForm, tipoEstado: e.target.value})}>
                                                                        <option value="ESTADOENAREA">ESTADOENAREA</option>
                                                                        <option value="ESTADO">ESTADO GENERAL</option>
                                                                        <option value="ESTADOLOGISTICA">ESTADOLOGISTICA</option>
                                                                    </select>
                                                                    <select className="px-2 py-1 border border-orange-300 rounded-md text-[10px] font-bold text-orange-800 outline-none bg-orange-50/50" value={editForm.estadoPadreId} onChange={e=>setEditForm({...editForm, estadoPadreId: e.target.value})}>
                                                                        <option value="">-- Asignar Padre --</option>
                                                                        {parentStates.filter(p=>p.EstadoID !== child.EstadoID).map(p=><option key={p.EstadoID} value={p.EstadoID}>{p.Nombre}</option>)}
                                                                    </select>
                                                                </div>
                                                                <div className="col-span-2 flex items-center gap-1.5 px-1">
                                                                    <input type="color" className="w-7 h-7 rounded cursor-pointer border-none" value={editForm.color} onChange={e=>setEditForm({...editForm, color: e.target.value})} />
                                                                    <label className="flex items-center gap-1 text-[11px] font-bold text-orange-700 cursor-pointer"><input type="checkbox" className="w-3 h-3 rounded" checked={editForm.esFinal} onChange={e=>setEditForm({...editForm, esFinal: e.target.checked})} /> Final</label>
                                                                </div>
                                                                <div className="col-span-2 flex gap-1 justify-end px-1">
                                                                    <button onClick={() => saveEdit(child.EstadoID)} className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition-colors"><i className="fa-solid fa-check"></i></button>
                                                                    <button onClick={() => setEditingId(null)} className="w-8 h-8 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"><i className="fa-solid fa-xmark"></i></button>
                                                                </div>
                                                            </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex-1 flex flex-col justify-center">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-bold text-slate-700 text-[15px]">{child.Nombre}</span>
                                                                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase bg-orange-100 text-orange-600 border border-orange-200">SIN ASIGNAR</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold mt-0.5">
                                                                    <i className="fa-solid fa-link text-[8px]"></i> / {child.AreaID || areaCode}
                                                                </div>
                                                            </div>

                                                            {/* Info Badges */}
                                                            <div className="flex items-center gap-4 px-4 shrink-0">
                                                                <div className="flex items-center gap-1 opacity-0 group-hover/child:opacity-100 transition-opacity w-8 text-right">
                                                                    <span className="text-[11px] font-mono font-bold text-slate-300">#{child.Orden}</span>
                                                                </div>
                                                                <div className="w-4 h-4 rounded-full shadow-sm border border-slate-200" style={{backgroundColor: child.ColorHex}}></div>
                                                                {child.EsFinal ? <i className="fa-solid fa-flag-checkered text-emerald-500 w-4 text-[11px] text-center"></i> : <span className="w-4"></span>}
                                                            </div>

                                                            {/* Actions */}
                                                            <div className="flex gap-1.5 shrink-0 px-2">
                                                                <button onClick={() => startEdit(child)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-100 hover:text-orange-500 transition-colors"><i className="fa-solid fa-pen-to-square text-xs"></i></button>
                                                                <button onClick={() => handleDelete(child.EstadoID)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"><i className="fa-solid fa-trash-can text-xs"></i></button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="px-6 py-4 bg-white border-t border-slate-200 flex justify-end shrink-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <button onClick={onClose} className="px-5 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-black tracking-wide hover:bg-slate-200 transition-colors">
                        Cerrar config
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfigStatusesModal;
