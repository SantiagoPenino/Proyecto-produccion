import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

// ─── Modal de Edición con combos dependientes ─────────────────────────────────
const EditModal = ({ article, allArticles, onClose, onSaved }) => {
    const isNew = !article?.ProIdProducto;

    const [form, setForm] = useState({
        proIdProducto: null, codArticulo: '', idProdReact: '',
        descripcion: '', codStock: '',
        grupo: '', supFlia: '', mostrar: true,
        anchoImprimible: '', llevaPapel: false, monIdMoneda: '',
        producto_maestro_id: ''
    });
    const [saving, setSaving] = useState(false);
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(article?.url_imagen || null);
    const [wmsMasters, setWmsMasters] = useState([]);
    const [wmsSearch, setWmsSearch] = useState('');
    const [wmsDropdownOpen, setWmsDropdownOpen] = useState(false);
    const [wmsVariants, setWmsVariants] = useState([]);
    const fileInputRef = useRef(null);

    useEffect(() => {
        api.get('/products-integration/wms/masters').then(res => {
            if (res.data?.success) setWmsMasters(res.data.data);
        }).catch(err => console.error("Error fetching WMS Masters:", err));
    }, []);

    useEffect(() => {
        if (form.producto_maestro_id) {
            api.get(`/products-integration/wms/variants/${form.producto_maestro_id}`)
               .then(res => setWmsVariants(res.data.data || []))
               .catch(err => console.error("Error fetching variants:", err));
            
            if (wmsMasters.length > 0) {
                const selectedMaster = wmsMasters.find(m => String(m.id) === String(form.producto_maestro_id));
                if (selectedMaster) setWmsSearch(`${selectedMaster.id} - ${selectedMaster.nombre}`);
            }
        } else {
            setWmsVariants([]);
            if (wmsMasters.length > 0) setWmsSearch('');
        }
    }, [form.producto_maestro_id, wmsMasters]);

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
                anchoImprimible: article.anchoimprimible != null ? String(parseFloat(Number(article.anchoimprimible).toFixed(4))) : '',
                llevaPapel:      !!article.LLEVAPAPEL,
                monIdMoneda:     article.MonIdMoneda != null ? String(article.MonIdMoneda) : '',
                producto_maestro_id: article.producto_maestro_id != null ? String(article.producto_maestro_id) : '',
                precioBase:      article.PrecioBase != null ? parseFloat(article.PrecioBase) : null
            });
        }
    }, [article]);

    // Opciones para combos dependientes
    const supFlias = useMemo(() => {
        const seen = new Set();
        return allArticles
            .map(a => ({ val: a.SupFlia?.trim(), label: a.SupFlia?.trim() }))
            .filter(x => x.val && !seen.has(x.val) && seen.add(x.val))
            .sort((a, b) => a.val?.localeCompare(b.val));
    }, [allArticles]);

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
            if (name === 'supFlia') { next.grupo = ''; next.codStock = ''; }
            if (name === 'grupo')   { next.codStock = ''; }
            return next;
        });
    };

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => setImagePreview(reader.result);
            reader.readAsDataURL(file);
        }
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

            let proId = form.proIdProducto;

            if (isNew) {
                const res = await api.post('/products-integration/create', payload);
                // Si la API retorna el nuevo ID creado, lo usaríamos aquí para wms/img
            } else {
                await api.post('/products-integration/update', {
                    ...payload,
                    proIdProducto: proId,
                });

                // 2. Guardar WMS ID
                if (form.producto_maestro_id !== (article?.producto_maestro_id != null ? String(article.producto_maestro_id) : '')) {
                    await api.put(`/products-integration/wms/${proId}`, {
                        producto_maestro_id: form.producto_maestro_id !== '' ? parseInt(form.producto_maestro_id) : null
                    });
                }

                // 3. Subir Imagen
                if (imageFile) {
                    const formData = new FormData();
                    formData.append('image', imageFile);
                    await api.post(`/products-integration/upload-image/${proId}`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                }
            }

            toast.success(isNew ? 'Artículo creado' : 'Artículo actualizado');
            onSaved({ ...form, url_imagen: imagePreview }); // optimistically update UI
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally { setSaving(false); }
    };

    const inputCls = "w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition bg-slate-50 focus:bg-white";
    const selectCls = inputCls;
    const labelCls = "block text-xs font-bold tracking-wide text-slate-500 uppercase mb-1.5";

    return (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-6 bg-slate-50 border-b border-slate-100 shrink-0">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isNew ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                            <i className={`fa-solid ${isNew ? 'fa-plus' : 'fa-pen'}`}></i>
                        </div>
                        {isNew ? 'Nuevo Artículo' : `Editar Artículo`}
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center bg-slate-200 hover:bg-slate-300 text-slate-500 rounded-full transition-colors"><i className="fa-solid fa-times"></i></button>
                </div>

                {/* Body */}
                <form id="edit-form" onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-8 text-sm">
                    <div className="flex flex-col lg:flex-row gap-8">
                        {/* Left Column - Main Details */}
                        <div className="flex-1 space-y-6">
                            
                            {!isNew && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-bold text-slate-400 uppercase">ID Interno (ProIdProducto)</span>
                                    <span className="text-2xl font-black text-slate-800">#{article?.ProIdProducto ?? '—'}</span>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={labelCls}>Código Artículo *</label>
                                    <input name="codArticulo" value={form.codArticulo} onChange={handleChange} className={inputCls} placeholder="Ej: 1152" />
                                </div>
                                <div>
                                    <label className={labelCls}>IDReact</label>
                                    <input type="number" name="idProdReact" value={form.idProdReact} onChange={handleChange} className={inputCls} placeholder="Ej: 54" />
                                </div>
                            </div>

                            <div>
                                <label className={labelCls}>Descripción</label>
                                <input name="descripcion" value={form.descripcion} onChange={handleChange} className={inputCls} placeholder="Nombre del artículo" />
                            </div>

                            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
                                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-2">
                                    <i className="fa-solid fa-sitemap text-blue-500"></i> Clasificación
                                </h3>
                                <div>
                                    <label className={labelCls}>Sup. Familia</label>
                                    <select name="supFlia" value={form.supFlia} onChange={handleChange} className={selectCls}>
                                        <option value="">— Seleccionar —</option>
                                        {supFlias.map(x => <option key={x.val} value={x.val}>{x.label}</option>)}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className={labelCls}>Grupo</label>
                                        <select name="grupo" value={form.grupo} onChange={handleChange} className={selectCls} disabled={!form.supFlia && grupos.length === 0}>
                                            <option value="">— Seleccionar —</option>
                                            {grupos.map(x => <option key={x.val} value={x.val}>{x.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelCls}>Cód. Stock</label>
                                        <select name="codStock" value={form.codStock} onChange={handleChange} className={selectCls} disabled={!form.grupo && stocks.length === 0}>
                                            <option value="">— Seleccionar —</option>
                                            {stocks.map(x => <option key={x.val} value={x.val}>{x.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className={labelCls}>Moneda</label>
                                    <select name="monIdMoneda" value={form.monIdMoneda} onChange={handleChange} className={selectCls}>
                                        <option value="">— Sin especificar —</option>
                                        <option value="1">$ UYU — Pesos Uruguayos</option>
                                        <option value="2">USD — Dólares</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={labelCls}>Precio Base</label>
                                    <div className={`h-10 px-3 rounded-lg border border-slate-300 bg-slate-100 flex items-center text-lg font-black text-slate-800 cursor-not-allowed`} title="El precio base se configura en Perfiles de Precio">
                                        {form.precioBase != null ? `${form.monIdMoneda === '2' ? 'U$S' : '$'} ${form.precioBase.toFixed(2)}` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <label className={labelCls}>Ancho Imprimible</label>
                                    <input type="number" step="0.01" min="0" name="anchoImprimible" value={form.anchoImprimible} onChange={handleChange} className={inputCls} placeholder="Ej: 1.60" />
                                </div>
                            </div>

                            <div className="flex gap-8 pt-2">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className="relative flex items-center justify-center">
                                        <input type="checkbox" name="mostrar" checked={form.mostrar} onChange={handleChange} className="peer sr-only" />
                                        <div className="w-10 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                                    </div>
                                    <span className="font-bold text-slate-700 group-hover:text-slate-900">Mostrar Activo</span>
                                </label>

                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className="relative flex items-center justify-center">
                                        <input type="checkbox" name="llevaPapel" checked={form.llevaPapel} onChange={handleChange} className="peer sr-only" />
                                        <div className="w-10 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                                    </div>
                                    <span className="font-bold text-slate-700 group-hover:text-slate-900">Lleva Papel</span>
                                </label>
                            </div>
                        </div>

                        {/* Right Column - WMS & Image */}
                        <div className="w-full lg:w-72 flex flex-col gap-6">
                            <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
                                <h3 className="font-bold text-blue-800 text-sm flex items-center gap-2 mb-4">
                                    <i className="fa-solid fa-boxes-stacked"></i> Integración WMS
                                </h3>
                                <div>
                                    <label className="block text-xs font-bold text-blue-700 uppercase mb-2">WMS Master ID</label>
                                    <div className="relative">
                                        <div className="flex items-center w-full px-4 py-3 border border-blue-200 rounded-xl text-sm font-bold text-blue-900 bg-white focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/20 transition-all shadow-inner">
                                            <input 
                                                type="text" 
                                                className="w-full bg-transparent outline-none placeholder-blue-300"
                                                placeholder="Buscar producto maestro..."
                                                value={wmsSearch}
                                                onChange={(e) => {
                                                    setWmsSearch(e.target.value);
                                                    setWmsDropdownOpen(true);
                                                    if (e.target.value === '') setForm(prev => ({...prev, producto_maestro_id: ''}));
                                                }}
                                                onFocus={() => setWmsDropdownOpen(true)}
                                                onBlur={() => setTimeout(() => setWmsDropdownOpen(false), 200)}
                                            />
                                            <i className={`fa-solid fa-chevron-down text-blue-400 transition-transform ${wmsDropdownOpen ? 'rotate-180' : ''}`}></i>
                                        </div>
                                        
                                        {wmsDropdownOpen && (
                                            <div className="absolute z-50 w-full mt-1 bg-white border border-blue-100 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                                                {wmsMasters.filter(m => `${m.id} ${m.nombre}`.toLowerCase().includes(wmsSearch.toLowerCase())).map(m => (
                                                    <div 
                                                        key={m.id} 
                                                        className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm font-medium text-slate-700 transition-colors"
                                                        onClick={() => {
                                                            setForm(prev => ({...prev, producto_maestro_id: String(m.id)}));
                                                            setWmsSearch(`${m.id} - ${m.nombre}`);
                                                            setWmsDropdownOpen(false);
                                                        }}
                                                    >
                                                        <span className="font-bold text-blue-600 mr-2">#{m.id}</span>
                                                        {m.nombre}
                                                    </div>
                                                ))}
                                                {wmsMasters.filter(m => `${m.id} ${m.nombre}`.toLowerCase().includes(wmsSearch.toLowerCase())).length === 0 && (
                                                    <div className="px-4 py-3 text-sm text-slate-500 italic text-center">No se encontraron resultados</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-blue-600/80 font-medium mt-2 leading-tight">Busca y selecciona el producto maestro en el WMS para leer el stock en tiempo real.</p>
                                </div>
                                
                                {/* Display Variants */}
                                {wmsVariants.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-blue-200/50">
                                        <label className="block text-[10px] font-bold text-blue-700 uppercase mb-2">Variantes Encontradas ({wmsVariants.length})</label>
                                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
                                            {wmsVariants.map(v => (
                                                <span key={v.variante_id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-100 text-blue-800 text-[10px] font-bold border border-blue-200" title={v.codigo_variante}>
                                                    {v.nombre_variante || v.codigo_variante}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 min-h-[200px] border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-2xl bg-slate-50 flex flex-col items-center justify-center relative overflow-hidden transition-colors group cursor-pointer"
                                onClick={() => fileInputRef.current?.click()}>
                                {imagePreview ? (
                                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-center p-6">
                                        <div className="w-16 h-16 bg-white shadow-sm rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                                            <i className="fa-solid fa-cloud-arrow-up text-2xl text-blue-500"></i>
                                        </div>
                                        <p className="font-bold text-slate-700 text-sm">Cargar Imagen</p>
                                        <p className="text-xs text-slate-400 mt-1">PNG, JPG o WEBP</p>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <span className="text-white font-bold bg-black/50 px-4 py-2 rounded-full backdrop-blur-sm">
                                        <i className="fa-solid fa-camera mr-2"></i> Cambiar Foto
                                    </span>
                                </div>
                                <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />
                            </div>
                        </div>
                    </div>
                </form>

                {/* Footer */}
                <div className="flex items-center justify-between p-6 bg-slate-50 border-t border-slate-100 shrink-0">
                    <p className="text-xs font-semibold text-slate-400">
                        {isNew ? 'Completá los campos para crear' : 'Recordá guardar tus cambios'}
                    </p>
                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} className="px-6 py-3 font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition">Cancelar</button>
                        <button type="submit" form="edit-form" disabled={saving} className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/30 transition-all disabled:opacity-60 flex items-center gap-2">
                            {saving && <i className="fa-solid fa-spinner fa-spin"></i>}
                            {isNew ? 'Crear Artículo' : 'Guardar Cambios'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Componente de Tarjeta de Artículo (Modern Card) ──────────────────────────
const ArticleCard = ({ art, onEdit, showImages }) => {
    const ancho = art.anchoimprimible != null ? parseFloat(Number(art.anchoimprimible).toFixed(4)) : 0;
    const isWmsSynced = art.producto_maestro_id != null;
    
    return (
        <div className="bg-white rounded-2xl border border-slate-200 hover:border-blue-300 shadow-sm hover:shadow-xl hover:shadow-blue-500/10 transition-all overflow-hidden flex flex-col group h-full">
            {showImages && (
                <div className="relative h-40 bg-slate-100 shrink-0 overflow-hidden">
                    {art.url_imagen ? (
                        <img src={art.url_imagen} alt={art.Descripcion} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                            <i className="fa-solid fa-image text-4xl mb-2"></i>
                            <span className="text-xs font-bold uppercase tracking-widest">Sin Foto</span>
                        </div>
                    )}
                    <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                        {isWmsSynced && (
                            <div className="bg-blue-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1.5" title="Sincronizado con WMS">
                                <i className="fa-solid fa-link"></i> WMS: {art.producto_maestro_id}
                            </div>
                        )}
                        {art.Mostrar === false && (
                            <div className="bg-red-500/90 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1.5" title="Oculto">
                                <i className="fa-solid fa-eye-slash"></i> Oculto
                            </div>
                        )}
                    </div>
                    <div className="absolute top-3 right-3">
                        <button onClick={() => onEdit(art)} className="w-9 h-9 rounded-full bg-white/90 backdrop-blur-md text-slate-400 hover:text-blue-600 hover:bg-white shadow-sm flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0" title="Editar Artículo">
                            <i className="fa-solid fa-pen"></i>
                        </button>
                    </div>
                </div>
            )}
            
            <div className="p-4 flex flex-col flex-1">
                {!showImages && (
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex gap-1.5">
                            {isWmsSynced && (
                                <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1" title="Sincronizado con WMS">
                                    <i className="fa-solid fa-link"></i> WMS
                                </span>
                            )}
                            {art.Mostrar === false && (
                                <span className="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1" title="Oculto">
                                    <i className="fa-solid fa-eye-slash"></i> Oculto
                                </span>
                            )}
                        </div>
                        <button onClick={() => onEdit(art)} className="text-slate-400 hover:text-blue-600 transition-colors" title="Editar Artículo">
                            <i className="fa-solid fa-pen"></i>
                        </button>
                    </div>
                )}
                
                <div className="flex items-center justify-between mb-2">
                    <div></div>
                    <div>
                        {art.MonIdMoneda != null && (
                            <>
                                {art.MonIdMoneda === 2 && (
                                    <span className="text-[12px] font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200 shadow-sm flex items-center gap-1">
                                        <span>USD</span>
                                        {art.PrecioBase != null && <span>{parseFloat(art.PrecioBase).toFixed(2)}</span>}
                                    </span>
                                )}
                                {art.MonIdMoneda === 1 && (
                                    <span className="text-[12px] font-black text-blue-700 bg-blue-50 px-2 py-1 rounded-md border border-blue-200 shadow-sm flex items-center gap-1">
                                        <span>UYU</span>
                                        {art.PrecioBase != null && <span>{parseFloat(art.PrecioBase).toFixed(2)}</span>}
                                    </span>
                                )}
                                {art.MonIdMoneda !== 1 && art.MonIdMoneda !== 2 && (
                                    <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-md border border-slate-200">S/M</span>
                                )}
                            </>
                        )}
                    </div>
                </div>
                
                <h4 className="font-bold text-slate-800 text-sm leading-tight mb-3 line-clamp-2" title={art.Descripcion?.trim()}>
                    {art.Descripcion?.trim()}
                </h4>
                
                <div className="mt-auto grid grid-cols-2 gap-2 text-[11px] font-semibold">

                    <div className="bg-slate-50 rounded-lg p-2 flex items-center gap-2">
                        <i className="fa-solid fa-boxes-stacked text-slate-400"></i>
                        <div className="flex flex-col leading-tight">
                            <span className="text-slate-400 text-[9px] uppercase tracking-wider">Stock WMS</span>
                            <span className={art.StockWMS > 0 ? "text-emerald-600 font-bold" : "text-slate-400"}>{art.StockWMS ?? 0}</span>
                        </div>
                    </div>

                    <div className="bg-slate-50 rounded-lg p-2 flex items-center gap-2">
                        <i className="fa-solid fa-layer-group text-slate-400"></i>
                        <div className="flex flex-col leading-tight">
                            <span className="text-slate-400 text-[9px] uppercase tracking-wider">Variantes</span>
                            <span className="text-slate-700">{art.CantidadVariantes ?? 0}</span>
                        </div>
                    </div>

                    {ancho > 0 ? (
                        <div className="bg-slate-50 rounded-lg p-2 flex items-center gap-2">
                            <i className="fa-solid fa-ruler-horizontal text-slate-400"></i>
                            <div className="flex flex-col leading-tight">
                                <span className="text-slate-400 text-[9px] uppercase tracking-wider">Ancho</span>
                                <span className="text-slate-700">{ancho}m</span>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-50 rounded-lg p-2 flex items-center gap-2">
                            <i className="fa-solid fa-scroll text-slate-400"></i>
                            <div className="flex flex-col leading-tight">
                                <span className="text-slate-400 text-[9px] uppercase tracking-wider">Papel</span>
                                <span className={art.LLEVAPAPEL ? "text-blue-600" : "text-slate-400"}>{art.LLEVAPAPEL ? "Sí" : "No"}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Componente Principal ─────────────────────────────────────────────────────
const ProductsIntegration = () => {
    const [articles, setArticles] = useState([]);
    const [loading, setLoading]   = useState(false);
    const [search, setSearch]     = useState('');
    const [editing, setEditing]   = useState(null);
    const [selectedNode, setSelectedNode] = useState('all'); // 'all', 'sup||X', 'grp||X||Y'
    const [expanded, setExpanded] = useState({});

    // UI States
    const [showImages, setShowImages] = useState(true);
    const [filterStatus, setFilterStatus] = useState('active'); // 'active', 'all', 'inactive'
    const [sortBy, setSortBy] = useState('name_asc');

    const load = useCallback(() => {
        setLoading(true);
        api.get('/products-integration/local')
            .then(res => setArticles(res.data))
            .catch(() => toast.error('Error al cargar artículos'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (articles.length > 0) {
            const all = {};
            articles.forEach(a => {
                const sup = (a.SupFlia || '').trim() || '(Sin Familia)';
                all[`sup||${sup}`] = true;
            });
            setExpanded(all);
        }
    }, [articles]);

    const toggle = (key, e) => {
        if(e) e.stopPropagation();
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Árbol SupFlia → Grupo
    const tree = useMemo(() => {
        const supMap = {};
        articles.forEach(a => {
            const sup = (a.SupFlia  || '').trim() || '(Sin Familia)';
            const grp = (a.Grupo    || '').trim() || '(Sin Grupo)';

            if (!supMap[sup]) supMap[sup] = { count: 0, grupos: {} };
            supMap[sup].count++;
            
            if (!supMap[sup].grupos[grp]) {
                supMap[sup].grupos[grp] = { 
                    nombre: a.DescripcionGrupo || '', 
                    count: 0 
                };
            }
            supMap[sup].grupos[grp].count++;
        });
        return supMap;
    }, [articles]);

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
                    producto_maestro_id: formData.producto_maestro_id !== '' ? parseInt(formData.producto_maestro_id) : null,
                    url_imagen:      formData.url_imagen || updated[idx].url_imagen
                };
                return updated;
            }
            load(); return prev;
        });
        setEditing(null);
    };

    const supKeys = Object.keys(tree).sort();

    // Filtro para el Grid Principal
    const displayArticles = useMemo(() => {
        let list = articles;
        
        // Filtro por activo/inactivo
        if (filterStatus === 'active') {
            list = list.filter(a => a.Mostrar !== false && a.Mostrar !== 0);
        } else if (filterStatus === 'inactive') {
            list = list.filter(a => a.Mostrar === false || a.Mostrar === 0);
        }

        // Filtro por texto
        const s = search.toLowerCase().trim();
        if (s) {
            list = list.filter(a =>
                (a.CodArticulo || '').toLowerCase().includes(s) ||
                (a.Descripcion || '').toLowerCase().includes(s) ||
                String(a.ProIdProducto || '').includes(s) ||
                String(a.IDProdReact  || '').includes(s) ||
                (a.CodStock || '').toLowerCase().includes(s)
            );
        }

        // Filtro por sidebar
        if (selectedNode !== 'all') {
            const parts = selectedNode.split('||');
            if (parts[0] === 'sup') {
                list = list.filter(a => (a.SupFlia || '').trim() === parts[1]);
            } else if (parts[0] === 'grp') {
                list = list.filter(a => (a.SupFlia || '').trim() === parts[1] && (a.Grupo || '').trim() === parts[2]);
            }
        }

        // Ordenamiento
        list = [...list].sort((a, b) => {
            if (sortBy === 'name_asc') return (a.Descripcion || '').localeCompare(b.Descripcion || '');
            if (sortBy === 'name_desc') return (b.Descripcion || '').localeCompare(a.Descripcion || '');
            if (sortBy === 'price_asc') return (parseFloat(a.PrecioBase) || 0) - (parseFloat(b.PrecioBase) || 0);
            if (sortBy === 'price_desc') return (parseFloat(b.PrecioBase) || 0) - (parseFloat(a.PrecioBase) || 0);
            return 0;
        });

        return list;
    }, [articles, search, selectedNode, filterStatus, sortBy]);

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            {/* Header */}
            <div className="p-5 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                        <i className="fa-solid fa-box-open text-xl"></i>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Catálogo y WMS</h1>
                        <p className="text-sm font-semibold text-slate-400">
                            Gestiona productos y vinculaciones desde un solo lugar.
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={load} className="px-4 py-2.5 text-xs font-bold bg-white border-2 border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm" title="Recargar">
                        <i className="fa-solid fa-rotate"></i>
                    </button>
                    <button onClick={() => setEditing({})} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-600/30 transition-all">
                        <i className="fa-solid fa-plus"></i> Nuevo
                    </button>
                </div>
            </div>

            {/* Layout a 2 columnas */}
            <div className="flex-1 flex overflow-hidden">
                
                {/* Sidebar */}
                <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full shrink-0">
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="font-bold text-slate-800 text-sm">Categorias / Familias</h2>
                        <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-1 rounded-md">{supKeys.length} Familias</span>
                    </div>
                    
                    <div className="p-4 border-b border-slate-100">
                        <div className="relative">
                            <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                            <input className="w-full pl-8 pr-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm outline-none focus:border-blue-500 focus:bg-white transition-all"
                                placeholder="Filtrar productos..."
                                value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
                        {/* Boton "Todos los productos" */}
                        <div 
                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${selectedNode === 'all' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                            onClick={() => setSelectedNode('all')}
                        >
                            <div className="flex items-center gap-3">
                                <i className="fa-solid fa-globe text-sm opacity-80"></i>
                                <span className="text-sm font-bold">Todos los Productos</span>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${selectedNode === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{articles.length}</span>
                        </div>

                        {/* Arbol */}
                        {supKeys.map(sup => {
                            const supKey = `sup||${sup}`;
                            const isSelected = selectedNode === supKey;
                            const isExpanded = !!expanded[supKey];
                            const grpKeys = Object.keys(tree[sup].grupos).sort();

                            return (
                                <div key={supKey} className="mt-2">
                                    <div 
                                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${isSelected ? 'bg-blue-600 text-white shadow-md' : 'text-slate-700 hover:bg-slate-100'}`}
                                        onClick={() => setSelectedNode(supKey)}
                                    >
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <i 
                                                className={`fa-solid ${isExpanded ? 'fa-folder-open' : 'fa-folder'} text-sm ${isSelected ? 'opacity-90' : 'text-amber-400'}`}
                                                onClick={(e) => toggle(supKey, e)}
                                            ></i>
                                            <span className="text-sm font-bold truncate">Familia {sup}</span>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{tree[sup].count}</span>
                                    </div>

                                    {/* Grupos */}
                                    {isExpanded && (
                                        <div className="ml-5 mt-1 border-l-2 border-slate-100 pl-2 space-y-1">
                                            {grpKeys.map(grp => {
                                                const grpKey = `grp||${sup}||${grp}`;
                                                const isGrpSelected = selectedNode === grpKey;
                                                const gInfo = tree[sup].grupos[grp];
                                                const gLabel = gInfo.nombre ? `${grp} - ${gInfo.nombre}` : grp;

                                                return (
                                                    <div 
                                                        key={grpKey} 
                                                        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${isGrpSelected ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
                                                        onClick={() => setSelectedNode(grpKey)}
                                                    >
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <i className={`fa-solid fa-folder text-xs ${isGrpSelected ? 'text-blue-500' : 'text-amber-400'}`}></i>
                                                            <span className="text-xs truncate" title={gLabel}>{gLabel}</span>
                                                        </div>
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${isGrpSelected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>{gInfo.count}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Main Content (Grid) */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <i className="fa-solid fa-circle-notch fa-spin text-4xl mb-4 text-blue-500"></i>
                            <p className="font-bold">Cargando catálogo...</p>
                        </div>
                    ) : displayArticles.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <i className="fa-solid fa-box-open text-6xl mb-4 text-slate-200"></i>
                            <p className="font-bold text-lg text-slate-500">No se encontraron artículos</p>
                        </div>
                    ) : (
                        <div>
                            <div className="mb-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <h2 className="text-lg font-bold text-slate-800">
                                        {selectedNode === 'all' && 'Todos los Productos'}
                                        {selectedNode.startsWith('sup') && `Familia ${selectedNode.split('||')[1]}`}
                                        {selectedNode.startsWith('grp') && `Grupo ${selectedNode.split('||')[2]}`}
                                    </h2>
                                    <span className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200">{displayArticles.length} resultados</span>
                                </div>
                                
                                {/* Filters and Options Bar */}
                                <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100">
                                    {/* Search */}
                                    <div className="relative flex-1 min-w-[250px] max-w-md">
                                        <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                                        <input className="w-full pl-9 pr-3 py-2 border border-slate-200 bg-slate-50 hover:bg-white rounded-lg text-sm outline-none focus:border-blue-500 focus:bg-white transition-all shadow-inner"
                                            placeholder="Buscar producto por nombre, código..."
                                            value={search} onChange={e => setSearch(e.target.value)} />
                                    </div>

                                    <div className="flex flex-wrap items-center gap-6">
                                        {/* Sort */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-500"><i className="fa-solid fa-sort"></i></span>
                                            <select className="px-3 py-2 border border-slate-200 bg-slate-50 hover:bg-white rounded-lg text-sm outline-none focus:border-blue-500 transition-all font-semibold text-slate-600 shadow-sm"
                                                value={sortBy} onChange={e => setSortBy(e.target.value)}>
                                                <option value="name_asc">A - Z</option>
                                                <option value="name_desc">Z - A</option>
                                                <option value="price_asc">Precio: Menor a Mayor</option>
                                                <option value="price_desc">Precio: Mayor a Menor</option>
                                            </select>
                                        </div>

                                        {/* Switches */}
                                        <div className="flex items-center gap-5 border-l border-slate-200 pl-5">
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <div className="relative flex items-center justify-center">
                                                    <input type="checkbox" checked={showImages} onChange={e => setShowImages(e.target.checked)} className="peer sr-only" />
                                                    <div className="w-8 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500 shadow-inner"></div>
                                                </div>
                                                <span className="text-xs font-bold text-slate-600 group-hover:text-slate-800">Fotos</span>
                                            </label>

                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-500">Estado:</span>
                                                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-inner text-xs font-bold">
                                                    <button 
                                                        onClick={() => setFilterStatus('active')}
                                                        className={`px-3 py-1.5 rounded-md transition-all ${filterStatus === 'active' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                                    >
                                                        Activos
                                                    </button>
                                                    <button 
                                                        onClick={() => setFilterStatus('all')}
                                                        className={`px-3 py-1.5 rounded-md transition-all ${filterStatus === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                                    >
                                                        Todos
                                                    </button>
                                                    <button 
                                                        onClick={() => setFilterStatus('inactive')}
                                                        className={`px-3 py-1.5 rounded-md transition-all ${filterStatus === 'inactive' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                                    >
                                                        Inactivos
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                                {displayArticles.map(art => (
                                    <ArticleCard
                                        key={art.ProIdProducto ?? art.CodArticulo}
                                        art={art}
                                        onEdit={setEditing}
                                        showImages={showImages}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

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
