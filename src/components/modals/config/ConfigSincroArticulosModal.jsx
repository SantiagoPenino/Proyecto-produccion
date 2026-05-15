import React, { useState, useEffect, useCallback } from 'react';
import api from '../../../services/apiClient';
import toast from 'react-hot-toast';

const API = '/sincro/articulos';

const AREAS = ['DTF', 'ECOUV', 'EMB', 'EST', 'IMD', 'SB', 'TPU', 'TWC', 'TWT'];

const EMPTY_ROW = {
    PRODUCTO: '',
    codStock: '',
    VARIANTE: '',
    PROIDPRODUCTO: '',
    Material: '',
    codArticulo: '',
    IDREACT: '',
    AREA: '',
};

export default function ConfigSincroArticulosModal({ isOpen, onClose }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [areaFilter, setAreaFilter] = useState('');
    const [dirty, setDirty] = useState(false);
    const [selected, setSelected] = useState(new Set());
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await api.get(API);
            setRows(data.map((r, i) => ({ ...r, _id: i })));
            setDirty(false);
            setSelected(new Set());
        } catch (e) {
            const msg = e.response?.data?.error || e.message;
            setError(msg);
            toast.error('Error cargando SINCRO-ARTICULOS: ' + msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

    if (!isOpen) return null;

    const visible = rows.filter(r => {
        const matchSearch = !search || Object.values(r).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()));
        const matchArea = !areaFilter || r.AREA === areaFilter;
        return matchSearch && matchArea;
    });

    const updateCell = (id, field, value) => {
        setRows(prev => prev.map(r => r._id === id ? { ...r, [field]: value } : r));
        setDirty(true);
    };

    const addRow = () => {
        const newId = Date.now();
        setRows(prev => [...prev, { ...EMPTY_ROW, _id: newId, AREA: areaFilter || '' }]);
        setDirty(true);
    };

    const deleteSelected = () => {
        if (selected.size === 0) return;
        setRows(prev => prev.filter(r => !selected.has(r._id)));
        setSelected(new Set());
        setDirty(true);
    };

    const toggleSelect = (id) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selected.size === visible.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(visible.map(r => r._id)));
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            const payload = rows.map(({ _id, ...rest }) => ({
                PRODUCTO: rest.PRODUCTO || null,
                codStock: rest.codStock || null,
                VARIANTE: rest.VARIANTE || null,
                PROIDPRODUCTO: rest.PROIDPRODUCTO !== '' ? Number(rest.PROIDPRODUCTO) : null,
                Material: rest.Material || null,
                codArticulo: rest.codArticulo !== '' ? Number(rest.codArticulo) : null,
                IDREACT: rest.IDREACT !== '' ? Number(rest.IDREACT) : null,
                AREA: rest.AREA || null,
            }));
            await api.put(API, payload);
            toast.success(`✅ ${payload.length} registros guardados`);
            setDirty(false);
        } catch (e) {
            toast.error('Error guardando: ' + (e.response?.data?.error || e.message));
        } finally {
            setSaving(false);
        }
    };

    const allVisibleSelected = visible.length > 0 && visible.every(r => selected.has(r._id));
    const someSelected = selected.size > 0;

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/70 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden border border-slate-200">

                {/* HEADER */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-8 py-5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-cyan-400/20 rounded-xl flex items-center justify-center">
                            <i className="fa-solid fa-table-columns text-cyan-300 text-lg"></i>
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white">SINCRO-ARTICULOS</h2>
                            <p className="text-slate-400 text-xs">{rows.length} registros · {visible.length} visibles</p>
                        </div>
                        {dirty && (
                            <span className="px-2 py-0.5 bg-amber-400/20 text-amber-300 text-xs font-bold rounded-full border border-amber-400/30 animate-pulse">
                                ● Cambios sin guardar
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* TOOLBAR */}
                <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap gap-3 items-center shrink-0">
                    {/* Search */}
                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 flex-1 min-w-[200px] max-w-xs shadow-sm">
                        <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
                        <input
                            className="bg-transparent text-sm outline-none text-slate-700 w-full placeholder:text-slate-400"
                            placeholder="Buscar en todos los campos..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>

                    {/* Area filter */}
                    <select
                        className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 shadow-sm outline-none"
                        value={areaFilter}
                        onChange={e => setAreaFilter(e.target.value)}
                    >
                        <option value="">Todas las áreas</option>
                        {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>

                    <div className="flex-1"></div>

                    {/* Actions */}
                    {someSelected && (
                        <button
                            onClick={deleteSelected}
                            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 text-sm font-bold rounded-xl hover:bg-red-100 transition-colors border border-red-200"
                        >
                            <i className="fa-solid fa-trash-can"></i>
                            Eliminar ({selected.size})
                        </button>
                    )}

                    <button
                        onClick={addRow}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-bold rounded-xl hover:bg-slate-700 transition-colors"
                    >
                        <i className="fa-solid fa-plus"></i>
                        Nueva fila
                    </button>

                    <button
                        onClick={save}
                        disabled={saving || !dirty}
                        className={`flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-xl transition-all ${
                            dirty
                                ? 'bg-cyan-500 hover:bg-cyan-600 text-white shadow-lg shadow-cyan-500/30'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        {saving
                            ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Guardando...</>
                            : <><i className="fa-solid fa-floppy-disk"></i> Guardar cambios</>
                        }
                    </button>
                </div>

                {/* TABLE */}
                <div className="flex-1 overflow-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-full gap-3 text-slate-400">
                            <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                            <span className="font-medium">Cargando datos...</span>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-red-400">
                            <i className="fa-solid fa-circle-exclamation text-3xl"></i>
                            <p className="font-bold">Error al cargar datos</p>
                            <p className="text-sm text-slate-500">{error}</p>
                            <button onClick={load} className="mt-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100">
                                <i className="fa-solid fa-rotate-right mr-2"></i>Reintentar
                            </button>
                        </div>
                    ) : (
                        <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 bg-slate-100 z-10">
                                <tr>
                                    <th className="p-2 w-10 text-center border-b border-slate-200">
                                        <div
                                            onClick={toggleAll}
                                            className="w-4 h-4 rounded border flex items-center justify-center cursor-pointer mx-auto transition-colors"
                                            style={{
                                                background: allVisibleSelected ? '#0e7490' : 'white',
                                                borderColor: someSelected ? '#0e7490' : '#cbd5e1',
                                            }}
                                        >
                                            {allVisibleSelected
                                                ? <i className="fa-solid fa-check text-white" style={{ fontSize: '8px' }}></i>
                                                : someSelected
                                                    ? <i className="fa-solid fa-minus text-cyan-600" style={{ fontSize: '8px' }}></i>
                                                    : null
                                            }
                                        </div>
                                    </th>
                                    {['PRODUCTO', 'codStock', 'VARIANTE', 'PROIDPRODUCTO', 'Material', 'codArticulo', 'IDREACT', 'AREA'].map(col => (
                                        <th key={col} className="p-2 text-left font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 whitespace-nowrap">
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {visible.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="text-center py-16 text-slate-400">
                                            <i className="fa-solid fa-inbox text-3xl mb-3 block"></i>
                                            No hay registros que coincidan
                                        </td>
                                    </tr>
                                ) : visible.map((row, idx) => (
                                    <tr
                                        key={row._id}
                                        className={`border-b border-slate-100 transition-colors ${
                                            selected.has(row._id)
                                                ? 'bg-cyan-50'
                                                : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                                        } hover:bg-cyan-50/50`}
                                    >
                                        <td className="p-1 text-center">
                                            <div
                                                onClick={() => toggleSelect(row._id)}
                                                className="w-4 h-4 rounded border flex items-center justify-center cursor-pointer mx-auto transition-colors"
                                                style={{
                                                    background: selected.has(row._id) ? '#0e7490' : 'white',
                                                    borderColor: selected.has(row._id) ? '#0e7490' : '#cbd5e1',
                                                }}
                                            >
                                                {selected.has(row._id) && <i className="fa-solid fa-check text-white" style={{ fontSize: '8px' }}></i>}
                                            </div>
                                        </td>
                                        {['PRODUCTO', 'codStock', 'VARIANTE', 'Material'].map(field => (
                                            <td key={field} className="p-1">
                                                <input
                                                    className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-cyan-400 rounded px-2 py-1 outline-none transition-colors min-w-[100px]"
                                                    value={row[field] ?? ''}
                                                    onChange={e => updateCell(row._id, field, e.target.value)}
                                                />
                                            </td>
                                        ))}
                                        {['PROIDPRODUCTO', 'codArticulo', 'IDREACT'].map(field => (
                                            <td key={field} className="p-1">
                                                <input
                                                    type="number"
                                                    className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-cyan-400 rounded px-2 py-1 outline-none transition-colors w-20"
                                                    value={row[field] ?? ''}
                                                    onChange={e => updateCell(row._id, field, e.target.value)}
                                                />
                                            </td>
                                        ))}
                                        <td className="p-1">
                                            <select
                                                className="bg-transparent border border-transparent hover:border-slate-300 focus:border-cyan-400 rounded px-2 py-1 outline-none transition-colors text-xs"
                                                value={row.AREA ?? ''}
                                                onChange={e => updateCell(row._id, 'AREA', e.target.value)}
                                            >
                                                <option value="">--</option>
                                                {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* FOOTER */}
                <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
                    <span>
                        <span className="font-bold text-slate-700">{visible.length}</span> registros visibles ·
                        <span className="font-bold text-slate-700 ml-1">{selected.size}</span> seleccionados
                    </span>
                    <span className="text-slate-400">Los cambios se aplican en toda la tabla al guardar</span>
                </div>
            </div>
        </div>
    );
}
