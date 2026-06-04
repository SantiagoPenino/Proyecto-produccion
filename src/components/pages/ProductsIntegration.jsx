import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

// ─── Modal de Edición con combos dependientes ─────────────────────────────────
const EditModal = ({ article, allArticles, onClose, onSaved }) => {
    const isNew = !article?.CodArticulo;

    const [form, setForm] = useState({
        proIdProducto: null, codArticulo: '', idProdReact: '',
        descripcion: '', codStock: '',
        grupo: '', supFlia: '', mostrar: true,
        anchoImprimible: '', llevaPapel: false, monIdMoneda: '',
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (article) {
            setForm({
                proIdProducto:   article.ProIdProducto ?? null,
                codArticulo:     article.CodArticulo?.trim()     || '',
                idProdReact:     article.IDProdReact != null ? String(article.IDProdReact) : '',
                descripcion:     article.Descripcion?.trim()     || '',
                codStock:        article.CodStock?.trim()         || '',
                grupo:           article.Grupo?.trim()            || '',
                supFlia:         article.SupFlia?.trim()          || '',
                mostrar:         article.Mostrar == null ? true : !!article.Mostrar,
                anchoImprimible: article.anchoimprimible != null ? String(article.anchoimprimible) : '',
                llevaPapel:      !!article.LLEVAPAPEL,
                monIdMoneda:     article.MonIdMoneda != null ? String(article.MonIdMoneda) : '',
            });
        }
    }, [article]);

    // ── Opciones para combos dependientes ──────────────────────────────────────
    // 1. SupFlia únicos ordenados
    const supFlias = useMemo(() => {
        const seen = new Set();
        return allArticles
            .map(a => ({ val: a.SupFlia?.trim(), label: a.SupFlia?.trim() }))
            .filter(x => x.val && !seen.has(x.val) && seen.add(x.val))
            .sort((a, b) => a.val?.localeCompare(b.val));
    }, [allArticles]);

    // 2. Grupos que existen dentro de la SupFlia seleccionada
    const grupos = useMemo(() => {
        const seen = new Set();
        return allArticles
            .filter(a => !form.supFlia || a.SupFlia?.trim() === form.supFlia)
            .map(a => ({
                val:   a.Grupo?.trim(),
                label: a.DescripcionGrupo?.trim() ? `${a.Grupo?.trim()} — ${a.DescripcionGrupo.trim()}` : a.Grupo?.trim()
            }))
            .filter(x => x.val && !seen.has(x.val) && seen.add(x.val))
            .sort((a, b) => a.val?.localeCompare(b.val));
    }, [allArticles, form.supFlia]);

    // 3. CodStock que existen dentro del Grupo seleccionado (con descripción de StockArt)
    const stocks = useMemo(() => {
        const seen = new Set();
        return allArticles
            .filter(a =>
                (!form.supFlia || a.SupFlia?.trim() === form.supFlia) &&
                (!form.grupo   || a.Grupo?.trim()   === form.grupo))
            .map(a => ({
                val:   a.CodStock?.trim(),
                label: a.DescripcionStock?.trim()
                    ? `${a.CodStock?.trim()} — ${a.DescripcionStock.trim()}`
                    : a.CodStock?.trim()
            }))
            .filter(x => x.val && !seen.has(x.val) && seen.add(x.val))
            .sort((a, b) => a.val?.localeCompare(b.val));
    }, [allArticles, form.supFlia, form.grupo]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        const newVal = type === 'checkbox' ? checked : value;

        setForm(prev => {
            const next = { ...prev, [name]: newVal };
            // Al cambiar SupFlia → limpiar Grupo y CodStock si ya no aplica
            if (name === 'supFlia') { next.grupo = ''; next.codStock = ''; }
            // Al cambiar Grupo → limpiar CodStock si ya no aplica
            if (name === 'grupo')   { next.codStock = ''; }
            return next;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.codArticulo.trim()) return toast.error('El código es obligatorio');
        setSaving(true);
        try {
            const payload = {
                codArticulo:     form.codArticulo,
                idProdReact:     form.idProdReact !== '' ? parseInt(form.idProdReact) : null,
                descripcion:     form.descripcion,
                codStock:        form.codStock,
                grupo:           form.grupo,
                supFlia:         form.supFlia,
                mostrar:         form.mostrar,
                llevaPapel:      form.llevaPapel,
                anchoImprimible: form.anchoImprimible !== '' ? parseFloat(form.anchoImprimible) : 0,
                monIdMoneda:     form.monIdMoneda !== '' ? parseInt(form.monIdMoneda) : null,
            };

            if (isNew) {
                await api.post('/products-integration/create', payload);
            } else {
                await api.post('/products-integration/update', {
                    ...payload,
                    proIdProducto: form.proIdProducto,
                });
            }

            toast.success(isNew ? 'Artículo creado' : 'Artículo actualizado');
            onSaved(form);
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally { setSaving(false); }
    };

    const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition bg-white";
    const selectCls = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition bg-white";
    const labelCls = "block text-xs font-semibold text-slate-500 mb-1";

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
                    <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                        <i className={`fa-solid ${isNew ? 'fa-plus-circle text-green-500' : 'fa-pen-to-square text-indigo-500'}`}></i>
                        {isNew ? 'Nuevo Artículo' : `Editar · ProId ${article?.ProIdProducto ?? '—'}`}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded"><i className="fa-solid fa-times"></i></button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-5 space-y-4 text-sm">

                    {/* ProIdProducto (siempre solo lectura) + CodArticulo e IDReact editables */}
                    {!isNew && (
                        <div className="flex items-center gap-2 bg-indigo-50 rounded-lg px-3 py-2 text-xs border border-indigo-100">
                            <i className="fa-solid fa-key text-indigo-300"></i>
                            <span className="text-indigo-400 font-semibold">ProId:</span>
                            <strong className="text-indigo-800">{article?.ProIdProducto ?? '—'}</strong>
                            <span className="text-indigo-200 mx-1">|</span>
                            <span className="text-indigo-400 font-semibold">Identificador interno (no editable)</span>
                        </div>
                    )}

                    {/* CodArticulo + IDReact editables en 2 columnas */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls}>Código Artículo *</label>
                            <input name="codArticulo" value={form.codArticulo} onChange={handleChange}
                                className={inputCls} placeholder="Ej: 1152" />
                        </div>
                        <div>
                            <label className={labelCls}>IDReact <span className="text-slate-400 font-normal">(entero, opcional)</span></label>
                            <input type="number" name="idProdReact" value={form.idProdReact} onChange={handleChange}
                                className={inputCls} placeholder="Ej: 54" />
                        </div>
                    </div>




                    {/* Descripción */}
                    <div>
                        <label className={labelCls}>Descripción</label>
                        <input name="descripcion" value={form.descripcion} onChange={handleChange}
                            className={inputCls} placeholder="Nombre del artículo" />
                    </div>

                    {/* ── Combos dependientes ────────────────────────────── */}
                    <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-slate-50">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                            <i className="fa-solid fa-sitemap mr-1 text-indigo-400"></i> Clasificación (árbol)
                        </p>

                        {/* Nivel 1: SupFlia */}
                        <div>
                            <label className={labelCls}>Sup. Familia</label>
                            <select name="supFlia" value={form.supFlia} onChange={handleChange} className={selectCls}>
                                <option value="">— Seleccionar —</option>
                                {supFlias.map(x => (
                                    <option key={x.val} value={x.val}>{x.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Nivel 2: Grupo (filtrado por SupFlia) */}
                        <div>
                            <label className={labelCls}>
                                Grupo
                                {!form.supFlia && <span className="ml-1 text-slate-400 font-normal">(seleccioná Familia primero)</span>}
                            </label>
                            <select name="grupo" value={form.grupo} onChange={handleChange}
                                className={selectCls} disabled={!form.supFlia && grupos.length === 0}>
                                <option value="">— Seleccionar —</option>
                                {grupos.map(x => (
                                    <option key={x.val} value={x.val}>{x.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Nivel 3: CodStock (filtrado por Grupo) */}
                        <div>
                            <label className={labelCls}>
                                Cód. Stock
                                {!form.grupo && <span className="ml-1 text-slate-400 font-normal">(seleccioná Grupo primero)</span>}
                            </label>
                            <select name="codStock" value={form.codStock} onChange={handleChange}
                                className={selectCls} disabled={!form.grupo && stocks.length === 0}>
                                <option value="">— Seleccionar —</option>
                                {stocks.map(x => (
                                    <option key={x.val} value={x.val}>{x.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Moneda */}
                    <div>
                        <label className={labelCls}>
                            Moneda <span className="text-slate-400 font-normal">(para precios y facturación)</span>
                        </label>
                        <select name="monIdMoneda" value={form.monIdMoneda} onChange={handleChange} className={selectCls}>
                            <option value="">— Sin especificar —</option>
                            <option value="1">$ UYU — Pesos Uruguayos</option>
                            <option value="2">USD — Dólares</option>
                        </select>
                    </div>

                    {/* Ancho imprimible */}
                    <div>
                        <label className={labelCls}>Ancho Imprimible (metros)</label>
                        <input type="number" step="0.01" min="0" name="anchoImprimible"
                            value={form.anchoImprimible}
                            onChange={handleChange}
                            className={inputCls}
                            placeholder="Ej: 1.60" />
                    </div>

                    {/* Checkboxes */}
                    <div className="flex gap-6 pt-1">
                        {[
                            { name: 'mostrar',    label: 'Mostrar',     color: 'accent-green-600' },
                            { name: 'llevaPapel', label: 'Lleva Papel', color: 'accent-blue-600'  },
                        ].map(({ name, label, color }) => (
                            <label key={name} className="flex items-center gap-2 cursor-pointer select-none">
                                <input type="checkbox" name={name} checked={form[name]} onChange={handleChange}
                                    className={`${color} w-4 h-4`} />
                                <span className="font-medium text-slate-700">{label}</span>
                            </label>
                        ))}
                    </div>
                </form>

                {/* Footer */}
                <div className="flex justify-end gap-2 p-5 border-t border-slate-100 shrink-0">
                    <button type="button" onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg text-sm transition">
                        Cancelar
                    </button>
                    <button onClick={handleSubmit} disabled={saving}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60 flex items-center gap-2">
                        {saving && <i className="fa-solid fa-spinner fa-spin"></i>}
                        {isNew ? 'Crear' : 'Guardar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Fila artículo ────────────────────────────────────────────────────────────
const ArticleRow = ({ art, onEdit }) => {
    // Parsear correctamente el decimal que viene del servidor
    const ancho = parseFloat(art.anchoimprimible);

    return (
        <tr className="hover:bg-indigo-50/40 transition-colors group text-xs">
            <td className="pl-14 pr-3 py-2 font-mono font-bold text-indigo-700 w-32 whitespace-nowrap">
                {art.ProIdProducto ?? '—'}
            </td>
            <td className="px-3 py-2 font-mono text-slate-500 w-28 whitespace-nowrap">
                {art.CodArticulo?.trim()}
            </td>
            <td className="px-3 py-2 text-center w-24">
                {art.IDProdReact != null
                    ? <span className="text-slate-600">{art.IDProdReact}</span>
                    : <span className="text-slate-300 italic">null</span>}
            </td>
            <td className="px-3 py-2 text-slate-700 max-w-xs truncate" title={art.Descripcion?.trim()}>
                {art.Descripcion?.trim()}
            </td>
            <td className="px-3 py-2 text-center w-16">
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-bold ${art.Mostrar ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                    {art.Mostrar ? '✓' : '✗'}
                </span>
            </td>
            <td className="px-3 py-2 text-center w-16">
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-bold ${art.LLEVAPAPEL ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                    {art.LLEVAPAPEL ? '✓' : '✗'}
                </span>
            </td>
            <td className="px-3 py-2 text-center w-16">
                {art.MonIdMoneda === 2
                    ? <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">USD</span>
                    : art.MonIdMoneda === 1
                        ? <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">UYU</span>
                        : <span className="text-slate-300 text-xs">—</span>}
            </td>
            <td className="px-3 py-2 text-center w-16 text-slate-500">
                {ancho > 0 ? `${ancho}m` : <span className="text-slate-300">—</span>}
            </td>
            <td className="px-3 py-2 w-10 text-right">
                <button onClick={() => onEdit(art)}
                    className="opacity-0 group-hover:opacity-100 transition text-slate-400 hover:text-indigo-600 p-1.5 rounded hover:bg-indigo-50"
                    title="Editar">
                    <i className="fa-solid fa-pen-to-square"></i>
                </button>
            </td>
        </tr>
    );
};

// ─── Componente Principal ─────────────────────────────────────────────────────
const ProductsIntegration = () => {
    const [articles, setArticles] = useState([]);
    const [loading, setLoading]   = useState(false);
    const [search, setSearch]     = useState('');
    const [editing, setEditing]   = useState(null);
    const [expanded, setExpanded] = useState({});

    const load = useCallback(() => {
        setLoading(true);
        api.get('/products-integration/local')
            .then(res => setArticles(res.data))
            .catch(() => toast.error('Error al cargar artículos'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    const expandAll = () => {
        const all = {};
        articles.forEach(a => {
            const sup = (a.SupFlia || '').trim();
            const grp = (a.Grupo || '').trim();
            const stk = (a.CodStock || '').trim();
            if (sup) all[`sup-${sup}`] = true;
            if (sup && grp) all[`grp-${sup}-${grp}`] = true;
            if (sup && grp && stk) all[`stk-${sup}-${grp}-${stk}`] = true;
        });
        setExpanded(all);
    };

    // ── Árbol SupFlia → Grupo → CodStock → Artículos ──────────────────────────
    const tree = useMemo(() => {
        const s = search.toLowerCase().trim();
        const filtered = s
            ? articles.filter(a =>
                (a.CodArticulo || '').toLowerCase().includes(s) ||
                (a.Descripcion || '').toLowerCase().includes(s) ||
                String(a.ProIdProducto || '').includes(s) ||
                String(a.IDProdReact  || '').includes(s) ||
                (a.CodStock || '').toLowerCase().includes(s))
            : articles;

        const supMap = {};
        filtered.forEach(a => {
            const sup = (a.SupFlia  || '').trim() || '(Sin Familia)';
            const grp = (a.Grupo    || '').trim() || '(Sin Grupo)';
            const stk = (a.CodStock || '').trim() || '(Sin Stock)';

            if (!supMap[sup]) supMap[sup] = {};
            if (!supMap[sup][grp]) supMap[sup][grp] = { nombre: a.DescripcionGrupo || '', stocks: {} };
            if (!supMap[sup][grp].stocks[stk]) {
                supMap[sup][grp].stocks[stk] = {
                    descripcion: a.DescripcionStock || '',
                    items: []
                };
            }
            supMap[sup][grp].stocks[stk].items.push(a);
        });
        return supMap;
    }, [articles, search]);

    useEffect(() => {
        if (search.length > 1) {
            const all = {};
            Object.keys(tree).forEach(sup => {
                all[`sup-${sup}`] = true;
                Object.keys(tree[sup]).forEach(grp => {
                    all[`grp-${sup}-${grp}`] = true;
                    Object.keys(tree[sup][grp].stocks).forEach(stk => {
                        all[`stk-${sup}-${grp}-${stk}`] = true;
                    });
                });
            });
            setExpanded(all);
        }
    }, [search, tree]);

    const handleSaved = (formData) => {
        setArticles(prev => {
            const idx = prev.findIndex(a => a.CodArticulo?.trim() === formData.codArticulo.trim());
            if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = {
                    ...updated[idx],
                    Descripcion:     formData.descripcion,
                    CodStock:        formData.codStock,
                    Grupo:           formData.grupo,
                    SupFlia:         formData.supFlia,
                    Mostrar:         formData.mostrar ? 1 : 0,
                    anchoimprimible: parseFloat(formData.anchoImprimible) || 0,
                    LLEVAPAPEL:      formData.llevaPapel ? 1 : 0,
                    MonIdMoneda:     formData.monIdMoneda !== '' ? parseInt(formData.monIdMoneda) : null,
                };
                return updated;
            }
            load(); return prev;
        });
        setEditing(null);
    };

    const supKeys = Object.keys(tree).sort();

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">

            {/* Header */}
            <div className="p-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3 shadow-sm">
                <div className="flex-1 min-w-0">
                    <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-sitemap text-indigo-600 text-base"></i>
                        Artículos
                    </h1>
                    <p className="text-xs text-slate-400">
                        {loading ? 'Cargando...' : `${articles.length} artículos`}
                    </p>
                </div>

                <div className="relative w-64">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                    <input className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition bg-white"
                        placeholder="ProId, Cód, Descripción, Stock..."
                        value={search} onChange={e => setSearch(e.target.value)} />
                </div>

                <div className="flex gap-1.5">
                    <button onClick={expandAll}
                        className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-100 transition">
                        <i className="fa-solid fa-expand mr-1"></i>Todo
                    </button>
                    <button onClick={() => setExpanded({})}
                        className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-100 transition">
                        <i className="fa-solid fa-compress mr-1"></i>Colapsar
                    </button>
                    <button onClick={load}
                        className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-100 transition" title="Recargar">
                        <i className="fa-solid fa-rotate text-sm"></i>
                    </button>
                    <button onClick={() => setEditing({})}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition shadow-sm">
                        <i className="fa-solid fa-plus"></i> Nuevo
                    </button>
                </div>
            </div>

            {/* Árbol */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-100 border-b border-slate-200 text-xs text-slate-500 font-semibold uppercase tracking-wide">
                            <th className="px-4 py-2.5 text-left w-32">ProIdProducto</th>
                            <th className="px-3 py-2.5 text-left w-28">CodArticulo</th>
                            <th className="px-3 py-2.5 text-center w-24">IDReact</th>
                            <th className="px-3 py-2.5 text-left">Descripción</th>
                            <th className="px-3 py-2.5 text-center w-16">Mostrar</th>
                            <th className="px-3 py-2.5 text-center w-16">Papel</th>
                            <th className="px-3 py-2.5 text-center w-16">Moneda</th>
                            <th className="px-3 py-2.5 text-center w-16">Ancho</th>
                            <th className="w-10"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={8} className="py-20 text-center text-slate-400">
                                <i className="fa-solid fa-spinner fa-spin mr-2"></i> Cargando...
                            </td></tr>
                        )}

                        {!loading && supKeys.map(sup => {
                            const supKey = `sup-${sup}`;
                            const supOpen = !!expanded[supKey];
                            const grpKeys = Object.keys(tree[sup]).sort();
                            const supCount = grpKeys.reduce((a, g) =>
                                a + Object.values(tree[sup][g].stocks).reduce((b, s) => b + s.items.length, 0), 0);

                            return (
                                <React.Fragment key={supKey}>
                                    {/* Nivel 1: SupFlia */}
                                    <tr className="bg-amber-50 border-y border-amber-200 cursor-pointer select-none hover:bg-amber-100/80 transition"
                                        onClick={() => toggle(supKey)}>
                                        <td colSpan={8} className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <i className={`fa-solid ${supOpen ? 'fa-folder-open text-amber-500' : 'fa-folder text-amber-400'} text-sm`}></i>
                                                <span className="font-bold text-amber-900 text-sm">Familia {sup}</span>
                                                <span className="text-[10px] bg-amber-200 text-amber-700 px-2 py-0.5 rounded-full">{supCount}</span>
                                                <i className={`fa-solid fa-chevron-${supOpen ? 'up' : 'down'} text-amber-400 text-[10px] ml-auto`}></i>
                                            </div>
                                        </td>
                                    </tr>

                                    {supOpen && grpKeys.map(grp => {
                                        const grpKey  = `grp-${sup}-${grp}`;
                                        const grpOpen = !!expanded[grpKey];
                                        const grpInfo = tree[sup][grp];
                                        const stkKeys = Object.keys(grpInfo.stocks).sort();
                                        const grpCount = stkKeys.reduce((a, s) => a + grpInfo.stocks[s].items.length, 0);
                                        const grpLabel = grpInfo.nombre?.trim()
                                            ? `${grp} — ${grpInfo.nombre.trim()}`
                                            : grp;

                                        return (
                                            <React.Fragment key={grpKey}>
                                                {/* Nivel 2: Grupo */}
                                                <tr className="bg-slate-50 border-b border-slate-200 cursor-pointer select-none hover:bg-slate-100/80 transition"
                                                    onClick={() => toggle(grpKey)}>
                                                    <td colSpan={8} className="pl-8 pr-3 py-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <i className={`fa-solid ${grpOpen ? 'fa-folder-open text-indigo-400' : 'fa-folder text-indigo-300'} text-xs`}></i>
                                                            <span className="font-semibold text-slate-700 text-xs">{grpLabel}</span>
                                                            <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">{grpCount}</span>
                                                            <i className={`fa-solid fa-chevron-${grpOpen ? 'up' : 'down'} text-slate-400 text-[10px] ml-auto`}></i>
                                                        </div>
                                                    </td>
                                                </tr>

                                                {grpOpen && stkKeys.map(stk => {
                                                    const stkKey  = `stk-${sup}-${grp}-${stk}`;
                                                    const stkOpen = !!expanded[stkKey];
                                                    const stkInfo = grpInfo.stocks[stk];
                                                    const arts    = stkInfo.items;
                                                    const stkDesc = stkInfo.descripcion;

                                                    return (
                                                        <React.Fragment key={stkKey}>
                                                            {/* Nivel 3: CodStock */}
                                                            <tr className="border-b border-slate-100 cursor-pointer select-none hover:bg-teal-50/40 transition"
                                                                onClick={() => toggle(stkKey)}>
                                                                <td colSpan={8} className="pl-12 pr-3 py-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <i className={`fa-solid fa-layer-group text-[10px] ${stkOpen ? 'text-teal-500' : 'text-slate-400'}`}></i>
                                                                        <span className="font-mono text-xs text-slate-600 font-semibold">{stk}</span>
                                                                        {stkDesc && (
                                                                            <span className="text-xs text-slate-400">— {stkDesc}</span>
                                                                        )}
                                                                        <span className="text-[10px] bg-teal-50 text-teal-600 border border-teal-200 px-1.5 py-0.5 rounded-full">{arts.length}</span>
                                                                        <i className={`fa-solid fa-chevron-${stkOpen ? 'up' : 'down'} text-slate-300 text-[10px] ml-auto`}></i>
                                                                    </div>
                                                                </td>
                                                            </tr>

                                                            {/* Nivel 4: Artículos */}
                                                            {stkOpen && arts.map(art => (
                                                                <ArticleRow
                                                                    key={art.ProIdProducto ?? art.CodArticulo}
                                                                    art={art}
                                                                    onEdit={setEditing}
                                                                />
                                                            ))}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </React.Fragment>
                                        );
                                    })}
                                </React.Fragment>
                            );
                        })}

                        {!loading && supKeys.length === 0 && (
                            <tr><td colSpan={8} className="py-20 text-center text-slate-400 italic">
                                No se encontraron artículos
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal */}
            {editing !== null && (
                <EditModal
                    article={Object.keys(editing).length === 0 ? null : editing}
                    allArticles={articles}
                    onClose={() => setEditing(null)}
                    onSaved={handleSaved}
                />
            )}
        </div>
    );
};

export default ProductsIntegration;
