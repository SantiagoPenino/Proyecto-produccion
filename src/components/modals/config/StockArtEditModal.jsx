import React, { useState, useEffect, useCallback } from 'react';
import api from '../../../services/apiClient';
import toast from 'react-hot-toast';
import {
    X, Plus, Loader2, RefreshCw, ChevronDown, ChevronRight,
    Package, Eye, EyeOff, Save, ArrowRightLeft, Boxes
} from 'lucide-react';

const API = '/stockart';

const TIPOS = [
    { value: 'MATERIAL', label: 'Material', color: 'bg-cyan-100 text-cyan-700' },
    { value: 'PRODUCTO_TERMINADO', label: 'Prod. Terminado', color: 'bg-purple-100 text-purple-700' },
    { value: 'TERMINACION', label: 'Terminación', color: 'bg-amber-100 text-amber-700' },
];

const tipoBadge = (tipo) => TIPOS.find(t => t.value === tipo) || TIPOS[0];

const EMPTY_NEW = { grupo: '', codStock: '', articulo: '', um: 'M2', tipoStock: 'MATERIAL' };

export default function StockArtEditModal({ isOpen, onClose }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [grupoFilter, setGrupoFilter] = useState('');
    const [savingCod, setSavingCod] = useState(null);
    const [edits, setEdits] = useState({});           // { codStock: {articulo, um, tipoStock} }
    const [expanded, setExpanded] = useState(null);   // codStock expandido
    const [articulos, setArticulos] = useState([]);
    const [artLoading, setArtLoading] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [newRow, setNewRow] = useState(EMPTY_NEW);
    const [creating, setCreating] = useState(false);
    const [movingArt, setMovingArt] = useState(null);

    // Pestaña Terminaciones (catálogo)
    const [view, setView] = useState('variantes');           // 'variantes' | 'terminaciones'
    const [termList, setTermList] = useState([]);
    const [termArts, setTermArts] = useState([]);             // artículos vinculables (variantes tipo TERMINACION)
    const [termEdits, setTermEdits] = useState({});           // { id: {nombre, unidadCobro, codArticulo} }
    const [termLoading, setTermLoading] = useState(false);
    const [termSavingId, setTermSavingId] = useState(null);
    const [showNewTerm, setShowNewTerm] = useState(false);
    const [newTerm, setNewTerm] = useState({ nombre: '', unidadCobro: 'U', codArticulo: '' });
    const [creatingTerm, setCreatingTerm] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get(API);
            setRows(data.data || []);
            setEdits({});
        } catch (e) {
            toast.error('Error cargando StockArt: ' + (e.response?.data?.error || e.message));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (isOpen) { load(); setExpanded(null); setShowNew(false); setView('variantes'); } }, [isOpen, load]);

    const loadTerminaciones = useCallback(async () => {
        setTermLoading(true);
        try {
            const [cat, arts] = await Promise.all([
                api.get(`${API}/terminaciones?all=1`),
                api.get(`${API}/terminaciones/articulos-disponibles`)
            ]);
            setTermList(cat.data?.data || []);
            setTermArts(arts.data?.data || []);
            setTermEdits({});
        } catch (e) {
            toast.error('Error cargando terminaciones: ' + (e.response?.data?.error || e.message));
        } finally {
            setTermLoading(false);
        }
    }, []);

    useEffect(() => { if (isOpen && view === 'terminaciones') loadTerminaciones(); }, [isOpen, view, loadTerminaciones]);

    if (!isOpen) return null;

    const getTermVal = (t, field, orig) => termEdits[t.TerminacionID]?.[field] ?? orig;
    const setTermEdit = (id, field, value) => {
        setTermEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    };

    const saveTerminacion = async (t) => {
        const e = termEdits[t.TerminacionID];
        if (!e) return;
        setTermSavingId(t.TerminacionID);
        try {
            await api.put(`${API}/terminaciones/${t.TerminacionID}`, e);
            toast.success(`✅ Terminación guardada`);
            loadTerminaciones();
        } catch (err) {
            toast.error('Error guardando: ' + (err.response?.data?.error || err.message));
        } finally {
            setTermSavingId(null);
        }
    };

    const toggleTermActivo = async (t) => {
        setTermSavingId(t.TerminacionID);
        try {
            await api.put(`${API}/terminaciones/${t.TerminacionID}`, { activo: !t.Activo });
            loadTerminaciones();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally {
            setTermSavingId(null);
        }
    };

    const crearTerminacion = async () => {
        if (!newTerm.nombre.trim()) { toast.error('El nombre es obligatorio'); return; }
        setCreatingTerm(true);
        try {
            await api.post(`${API}/terminaciones`, {
                nombre: newTerm.nombre,
                unidadCobro: newTerm.unidadCobro,
                codArticulo: newTerm.codArticulo || null
            });
            toast.success(`✅ Terminación '${newTerm.nombre}' creada`);
            setNewTerm({ nombre: '', unidadCobro: 'U', codArticulo: '' });
            setShowNewTerm(false);
            loadTerminaciones();
        } catch (err) {
            toast.error('Error creando: ' + (err.response?.data?.error || err.message));
        } finally {
            setCreatingTerm(false);
        }
    };

    const grupos = [...new Set(rows.map(r => r.Grupo))].sort();
    const visible = rows.filter(r => !grupoFilter || r.Grupo === grupoFilter);

    const getVal = (row, field, orig) => edits[row.CodStock]?.[field] ?? orig;

    const setEdit = (codStock, field, value) => {
        setEdits(prev => ({ ...prev, [codStock]: { ...prev[codStock], [field]: value } }));
    };

    const saveRow = async (row) => {
        const e = edits[row.CodStock];
        if (!e) return;
        setSavingCod(row.CodStock);
        try {
            await api.put(`${API}/${encodeURIComponent(row.CodStock)}`, e);
            toast.success(`✅ ${row.CodStock} guardado`);
            setEdits(prev => { const n = { ...prev }; delete n[row.CodStock]; return n; });
            load();
        } catch (err) {
            toast.error('Error guardando: ' + (err.response?.data?.error || err.message));
        } finally {
            setSavingCod(null);
        }
    };

    const toggleMostrar = async (row) => {
        setSavingCod(row.CodStock);
        try {
            await api.put(`${API}/${encodeURIComponent(row.CodStock)}`, { mostrar: !row.Mostrar });
            load();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally {
            setSavingCod(null);
        }
    };

    const toggleExpand = async (row) => {
        if (expanded === row.CodStock) { setExpanded(null); return; }
        setExpanded(row.CodStock);
        setArtLoading(true);
        try {
            const { data } = await api.get(`${API}/${encodeURIComponent(row.CodStock)}/articulos`);
            setArticulos(data.data || []);
        } catch (err) {
            toast.error('Error cargando artículos: ' + (err.response?.data?.error || err.message));
            setArticulos([]);
        } finally {
            setArtLoading(false);
        }
    };

    const moverArticulo = async (codArticulo, codStockDestino) => {
        if (!codStockDestino) return;
        setMovingArt(codArticulo);
        try {
            await api.put(`${API}/articulos/${encodeURIComponent(codArticulo)}/mover`, { codStockDestino });
            toast.success(`✅ Artículo ${codArticulo} movido a ${codStockDestino}`);
            setArticulos(prev => prev.filter(a => a.CodArticulo !== codArticulo));
            load();
        } catch (err) {
            toast.error('Error moviendo: ' + (err.response?.data?.error || err.message));
        } finally {
            setMovingArt(null);
        }
    };

    const sugerirCodStock = (grupo) => {
        // Grupo '1.3' -> CodStock '1.1.3.N' (patrón existente: 1.1.<ref grupo>.<n>)
        const delGrupo = rows.filter(r => r.Grupo === grupo).map(r => r.CodStock);
        if (delGrupo.length === 0) return '';
        const base = delGrupo[0].split('.').slice(0, -1).join('.');
        const maxN = Math.max(...delGrupo.map(c => parseInt(c.split('.').pop()) || 0));
        return `${base}.${maxN + 1}`;
    };

    const crearVariante = async () => {
        if (!newRow.grupo || !newRow.codStock || !newRow.articulo) {
            toast.error('Grupo, CodStock y Nombre son obligatorios');
            return;
        }
        setCreating(true);
        try {
            await api.post(API, newRow);
            toast.success(`✅ Variante '${newRow.articulo}' creada`);
            setNewRow(EMPTY_NEW);
            setShowNew(false);
            load();
        } catch (err) {
            toast.error('Error creando: ' + (err.response?.data?.error || err.message));
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/70 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden border border-slate-200">

                {/* HEADER */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-8 py-5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-cyan-400/20 rounded-xl flex items-center justify-center">
                            <Boxes className="text-cyan-300" size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white">EDITOR STOCKART</h2>
                            <p className="text-slate-400 text-xs">Variantes por grupo · tipo de comportamiento · artículos</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                        <X className="text-white" size={20} />
                    </button>
                </div>

                {/* TOOLBAR */}
                <div className="px-8 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap shrink-0">
                    {/* Pestañas */}
                    <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                        <button onClick={() => setView('variantes')}
                            className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-all ${view === 'variantes' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            Variantes
                        </button>
                        <button onClick={() => setView('terminaciones')}
                            className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-all ${view === 'terminaciones' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            Terminaciones
                        </button>
                    </div>

                    {view === 'variantes' ? (
                        <>
                            <div className="relative">
                                <select value={grupoFilter} onChange={e => setGrupoFilter(e.target.value)}
                                    className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-2 pr-8 text-xs font-bold text-slate-700 appearance-none outline-none focus:border-cyan-400">
                                    <option value="">Todos los grupos</option>
                                    {grupos.map(g => <option key={g} value={g}>Grupo {g}</option>)}
                                </select>
                                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase">{visible.length} variantes</span>
                            <div className="flex-1" />
                            <button onClick={load} disabled={loading}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold text-slate-600 transition-all">
                                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            </button>
                            <button onClick={() => { setShowNew(s => !s); setNewRow({ ...EMPTY_NEW, grupo: grupoFilter || '' }); }}
                                className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-all">
                                <Plus size={14} /> Nueva Variante
                            </button>
                        </>
                    ) : (
                        <>
                            <span className="text-[10px] text-slate-400 font-bold uppercase">{termList.length} terminaciones · catálogo global</span>
                            <div className="flex-1" />
                            <button onClick={loadTerminaciones} disabled={termLoading}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold text-slate-600 transition-all">
                                {termLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            </button>
                            <button onClick={() => setShowNewTerm(s => !s)}
                                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all">
                                <Plus size={14} /> Nueva Terminación
                            </button>
                        </>
                    )}
                </div>

                {/* ALTA NUEVA TERMINACIÓN */}
                {view === 'terminaciones' && showNewTerm && (
                    <div className="px-8 py-4 bg-amber-50/60 border-b border-amber-100 flex items-end gap-3 flex-wrap shrink-0">
                        <div className="flex-1 min-w-[180px]">
                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Nombre</label>
                            <input value={newTerm.nombre} onChange={e => setNewTerm(p => ({ ...p, nombre: e.target.value }))}
                                placeholder="Ej: Laminado mate"
                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-amber-400" />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Se cobra por</label>
                            <select value={newTerm.unidadCobro} onChange={e => setNewTerm(p => ({ ...p, unidadCobro: e.target.value }))}
                                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-amber-400">
                                <option value="U">Unidad</option>
                                <option value="M">Metro lineal</option>
                                <option value="M2">Metro cuadrado</option>
                            </select>
                        </div>
                        <div className="min-w-[220px]">
                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Artículo para facturar (opcional)</label>
                            <select value={newTerm.codArticulo} onChange={e => setNewTerm(p => ({ ...p, codArticulo: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-amber-400">
                                <option value="">— Sin artículo —</option>
                                {termArts.map(a => <option key={a.CodArticulo} value={a.CodArticulo}>{a.CodArticulo} · {a.Descripcion}</option>)}
                            </select>
                        </div>
                        <button onClick={crearTerminacion} disabled={creatingTerm}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all">
                            {creatingTerm ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Crear
                        </button>
                    </div>
                )}

                {/* ALTA NUEVA VARIANTE */}
                {view === 'variantes' && showNew && (
                    <div className="px-8 py-4 bg-cyan-50/60 border-b border-cyan-100 flex items-end gap-3 flex-wrap shrink-0">
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Grupo</label>
                            <select value={newRow.grupo}
                                onChange={e => setNewRow(p => ({ ...p, grupo: e.target.value, codStock: sugerirCodStock(e.target.value) }))}
                                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-cyan-400 w-32">
                                <option value="">Elegir...</option>
                                {grupos.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">CodStock</label>
                            <input value={newRow.codStock} onChange={e => setNewRow(p => ({ ...p, codStock: e.target.value }))}
                                placeholder="1.1.3.8"
                                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-cyan-400 w-28" />
                        </div>
                        <div className="flex-1 min-w-[180px]">
                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Nombre (variante)</label>
                            <input value={newRow.articulo} onChange={e => setNewRow(p => ({ ...p, articulo: e.target.value }))}
                                placeholder="Cuadros Canvas"
                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-cyan-400" />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">UM</label>
                            <select value={newRow.um} onChange={e => setNewRow(p => ({ ...p, um: e.target.value }))}
                                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-cyan-400">
                                <option value="M2">M2</option>
                                <option value="M">M</option>
                                <option value="U">U</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Tipo</label>
                            <select value={newRow.tipoStock} onChange={e => setNewRow(p => ({ ...p, tipoStock: e.target.value }))}
                                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-cyan-400">
                                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>
                        <button onClick={crearVariante} disabled={creating}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all">
                            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Crear
                        </button>
                    </div>
                )}

                {/* TABLA */}
                <div className="flex-1 overflow-y-auto px-8 py-4">
                    {view === 'terminaciones' ? (
                        termLoading ? (
                            <div className="flex items-center justify-center h-40 text-slate-400">
                                <Loader2 className="animate-spin mr-2" size={20} /> Cargando...
                            </div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-white z-10">
                                    <tr className="text-slate-400 uppercase tracking-wider border-b border-slate-200">
                                        <th className="py-2 text-left font-bold">Nombre</th>
                                        <th className="py-2 text-left font-bold w-36">Se cobra por</th>
                                        <th className="py-2 text-left font-bold w-64">Artículo para facturar</th>
                                        <th className="py-2 text-center font-bold w-20">Activa</th>
                                        <th className="py-2 text-center font-bold w-20"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {termList.map(t => {
                                        const dirty = !!termEdits[t.TerminacionID];
                                        return (
                                            <tr key={t.TerminacionID} className={`border-b border-slate-100 hover:bg-slate-50 ${!t.Activo ? 'opacity-50' : ''}`}>
                                                <td className="py-2">
                                                    <input value={getTermVal(t, 'nombre', t.Nombre)}
                                                        onChange={e => setTermEdit(t.TerminacionID, 'nombre', e.target.value)}
                                                        className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 focus:bg-white rounded-lg px-2 py-1 outline-none font-bold text-slate-800" />
                                                </td>
                                                <td className="py-2">
                                                    <select value={getTermVal(t, 'unidadCobro', t.UnidadCobro)}
                                                        onChange={e => setTermEdit(t.TerminacionID, 'unidadCobro', e.target.value)}
                                                        className="bg-transparent border border-transparent hover:border-slate-200 rounded-lg px-1 py-1 outline-none font-bold text-slate-600">
                                                        <option value="U">Unidad</option>
                                                        <option value="M">Metro lineal</option>
                                                        <option value="M2">Metro cuadrado</option>
                                                    </select>
                                                </td>
                                                <td className="py-2">
                                                    <select value={getTermVal(t, 'codArticulo', (t.CodArticulo || '').trim())}
                                                        onChange={e => setTermEdit(t.TerminacionID, 'codArticulo', e.target.value)}
                                                        className="w-full bg-transparent border border-transparent hover:border-slate-200 rounded-lg px-1 py-1 outline-none text-slate-600 truncate">
                                                        <option value="">— Sin artículo —</option>
                                                        {termArts.map(a => <option key={a.CodArticulo} value={a.CodArticulo}>{a.CodArticulo} · {a.Descripcion}</option>)}
                                                    </select>
                                                </td>
                                                <td className="py-2 text-center">
                                                    <button onClick={() => toggleTermActivo(t)} disabled={termSavingId === t.TerminacionID}
                                                        className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                                                        title={t.Activo ? 'Desactivar (deja de ofrecerse)' : 'Reactivar'}>
                                                        {t.Activo ? <Eye size={14} className="text-emerald-600" /> : <EyeOff size={14} className="text-slate-400" />}
                                                    </button>
                                                </td>
                                                <td className="py-2 text-center">
                                                    {dirty && (
                                                        <button onClick={() => saveTerminacion(t)} disabled={termSavingId === t.TerminacionID}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition-all">
                                                            {termSavingId === t.TerminacionID ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )
                    ) : loading ? (
                        <div className="flex items-center justify-center h-40 text-slate-400">
                            <Loader2 className="animate-spin mr-2" size={20} /> Cargando...
                        </div>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="text-slate-400 uppercase tracking-wider border-b border-slate-200">
                                    <th className="py-2 text-left font-bold w-8"></th>
                                    <th className="py-2 text-left font-bold">Grupo</th>
                                    <th className="py-2 text-left font-bold">CodStock</th>
                                    <th className="py-2 text-left font-bold">Variante</th>
                                    <th className="py-2 text-left font-bold w-20">UM</th>
                                    <th className="py-2 text-left font-bold w-40">Tipo</th>
                                    <th className="py-2 text-center font-bold w-20">Artículos</th>
                                    <th className="py-2 text-center font-bold w-20">Visible</th>
                                    <th className="py-2 text-center font-bold w-20"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map(row => {
                                    const dirty = !!edits[row.CodStock];
                                    const badge = tipoBadge(getVal(row, 'tipoStock', row.TipoStock));
                                    return (
                                        <React.Fragment key={row.CodStock}>
                                            <tr className={`border-b border-slate-100 hover:bg-slate-50 ${!row.Mostrar ? 'opacity-50' : ''}`}>
                                                <td className="py-2">
                                                    <button onClick={() => toggleExpand(row)} className="p-1 hover:bg-slate-200 rounded-lg" title="Ver artículos">
                                                        {expanded === row.CodStock ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    </button>
                                                </td>
                                                <td className="py-2 font-mono text-slate-500">{row.Grupo}</td>
                                                <td className="py-2 font-mono font-bold text-slate-700">{row.CodStock}</td>
                                                <td className="py-2">
                                                    <input value={getVal(row, 'articulo', row.Articulo)}
                                                        onChange={e => setEdit(row.CodStock, 'articulo', e.target.value)}
                                                        className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-cyan-400 focus:bg-white rounded-lg px-2 py-1 outline-none font-bold text-slate-800" />
                                                </td>
                                                <td className="py-2">
                                                    <select value={getVal(row, 'um', row.UM)}
                                                        onChange={e => setEdit(row.CodStock, 'um', e.target.value)}
                                                        className="bg-transparent border border-transparent hover:border-slate-200 rounded-lg px-1 py-1 outline-none font-bold text-slate-600">
                                                        <option value="M2">M2</option>
                                                        <option value="M">M</option>
                                                        <option value="U">U</option>
                                                        {!['M2', 'M', 'U'].includes((getVal(row, 'um', row.UM) || '').toUpperCase()) &&
                                                            <option value={getVal(row, 'um', row.UM)}>{getVal(row, 'um', row.UM)}</option>}
                                                    </select>
                                                </td>
                                                <td className="py-2">
                                                    <select value={getVal(row, 'tipoStock', row.TipoStock)}
                                                        onChange={e => setEdit(row.CodStock, 'tipoStock', e.target.value)}
                                                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase outline-none border-0 cursor-pointer ${badge.color}`}>
                                                        {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                    </select>
                                                </td>
                                                <td className="py-2 text-center">
                                                    <span className="inline-flex items-center gap-1 text-slate-500 font-bold">
                                                        <Package size={12} /> {row.CantArticulos}
                                                    </span>
                                                </td>
                                                <td className="py-2 text-center">
                                                    <button onClick={() => toggleMostrar(row)} disabled={savingCod === row.CodStock}
                                                        className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                                                        title={row.Mostrar ? 'Ocultar del portal' : 'Mostrar en portal'}>
                                                        {row.Mostrar ? <Eye size={14} className="text-emerald-600" /> : <EyeOff size={14} className="text-slate-400" />}
                                                    </button>
                                                </td>
                                                <td className="py-2 text-center">
                                                    {dirty && (
                                                        <button onClick={() => saveRow(row)} disabled={savingCod === row.CodStock}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition-all">
                                                            {savingCod === row.CodStock ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                            {expanded === row.CodStock && (
                                                <tr className="bg-slate-50/80">
                                                    <td colSpan={9} className="px-8 py-3">
                                                        {artLoading ? (
                                                            <div className="flex items-center gap-2 text-slate-400 text-xs py-2">
                                                                <Loader2 size={14} className="animate-spin" /> Cargando artículos...
                                                            </div>
                                                        ) : articulos.length === 0 ? (
                                                            <p className="text-xs text-slate-400 italic py-2">Sin artículos asignados a esta variante.</p>
                                                        ) : (
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-2">
                                                                {articulos.map(a => (
                                                                    <div key={a.CodArticulo} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                                                                        <span className="font-mono text-[10px] text-slate-400 w-12 shrink-0">{a.CodArticulo}</span>
                                                                        <span className={`text-xs flex-1 truncate ${a.Mostrar ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{a.Descripcion}</span>
                                                                        <div className="flex items-center gap-1 shrink-0" title="Mover a otra variante">
                                                                            <ArrowRightLeft size={11} className="text-slate-300" />
                                                                            <select value="" disabled={movingArt === a.CodArticulo}
                                                                                onChange={e => moverArticulo(a.CodArticulo, e.target.value)}
                                                                                className="bg-slate-100 border border-slate-200 rounded-lg px-1.5 py-1 text-[10px] font-bold text-slate-500 outline-none cursor-pointer max-w-[130px]">
                                                                                <option value="">Mover a...</option>
                                                                                {rows.filter(r => r.Grupo === row.Grupo && r.CodStock !== row.CodStock).map(r => (
                                                                                    <option key={r.CodStock} value={r.CodStock}>{r.CodStock} · {r.Articulo}</option>
                                                                                ))}
                                                                            </select>
                                                                            {movingArt === a.CodArticulo && <Loader2 size={11} className="animate-spin text-cyan-500" />}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* FOOTER */}
                <div className="px-8 py-3 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
                    <p className="text-[10px] text-slate-400">
                        StockArt/artículos se mantienen desde el ERP — este editor escribe directo en la base. El <b>Tipo</b> define el comportamiento en el form del portal.
                    </p>
                    <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-xs font-bold text-slate-600 transition-all">Cerrar</button>
                </div>
            </div>
        </div>
    );
}
