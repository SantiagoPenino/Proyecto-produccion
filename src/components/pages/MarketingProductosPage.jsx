import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { toast } from 'sonner';
import { Search, Eye, EyeOff, X, Save, ExternalLink, Image as ImageIcon, Upload, Trash2, Loader2 } from 'lucide-react';

// [MARKETING 21/08] /marketing/productos — Admin de la vitrina de la tienda, pensado para
// marketing: publicar/ocultar productos, título/descripción de venta, categoría, orden y
// fotos (portada + por color). El precio se muestra solo-lectura con link a /marketing/precios.
// Los vínculos ERP/WMS/variantes NO se tocan acá: viven en /admin/products-integration.

const fmtPrecio = (precio, moneda) => {
    if (precio == null) return null;
    const n = Number(precio);
    if (isNaN(n)) return null;
    const simbolo = String(moneda || '').toUpperCase().includes('UYU') || String(moneda) === '$' ? '$' : 'US$';
    return `${simbolo} ${n.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const TIPOS_VITRINA = [
    { value: 'TERMINADO', label: 'Terminado — se compra directo (carrito)' },
    { value: 'PERSONALIZADO', label: 'Personalizado — la ficha inicia un pedido' },
    { value: 'CONFECCIONADO', label: 'Confeccionado — la ficha inicia un pedido' },
];

const MarketingProductosPage = () => {
    const navigate = useNavigate();
    const [productos, setProductos] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [busqueda, setBusqueda] = useState('');
    const [tab, setTab] = useState('TODOS'); // TODOS | PUBLICADOS | OCULTOS
    const [editando, setEditando] = useState(null); // producto seleccionado (copia editable)

    const cargar = async () => {
        try {
            const res = await api.get('/products-integration/vitrina');
            setProductos(res.data?.data || []);
        } catch (e) {
            toast.error('No se pudo cargar el listado de productos');
        } finally {
            setCargando(false);
        }
    };
    useEffect(() => { cargar(); }, []);

    const categorias = useMemo(() => {
        const set = new Set();
        productos.forEach(p => { if (p.CategoriaVitrina) set.add(p.CategoriaVitrina); });
        return [...set].sort();
    }, [productos]);

    const filtrados = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return productos.filter(p => {
            if (tab === 'PUBLICADOS' && !p.Publicado) return false;
            if (tab === 'OCULTOS' && p.Publicado) return false;
            if (!q) return true;
            return [p.TituloVenta, p.Descripcion, p.CodArticulo, p.CategoriaVitrina]
                .some(v => (v || '').toLowerCase().includes(q));
        });
    }, [productos, busqueda, tab]);

    const contadores = useMemo(() => ({
        TODOS: productos.length,
        PUBLICADOS: productos.filter(p => p.Publicado).length,
        OCULTOS: productos.filter(p => !p.Publicado).length,
    }), [productos]);

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-5">
                <h1 className="text-2xl font-black text-slate-800">Productos de la tienda</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Lo que está <span className="font-bold text-emerald-600">publicado</span> aparece en la tienda del portal de clientes.
                    Hacé click en un producto para editar su ficha, fotos y visibilidad.
                </p>
            </div>

            {/* Buscador + tabs */}
            <div className="flex flex-col md:flex-row gap-3 md:items-center mb-5">
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={busqueda}
                        onChange={e => setBusqueda(e.target.value)}
                        placeholder="Buscar producto..."
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                    />
                </div>
                <div className="flex gap-1.5">
                    {[['TODOS', 'Todos'], ['PUBLICADOS', 'Publicados'], ['OCULTOS', 'Ocultos']].map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${tab === key
                                ? 'bg-slate-800 text-white'
                                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                        >
                            {label} <span className="opacity-60 font-semibold">({contadores[key]})</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Grid */}
            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center">
                    <Loader2 size={18} className="animate-spin" /> Cargando productos...
                </div>
            ) : filtrados.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">No hay productos que coincidan.</div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {filtrados.map(p => (
                        <button
                            key={p.ProIdProducto}
                            onClick={() => setEditando({ ...p })}
                            className="text-left bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md hover:border-slate-300 transition-all"
                        >
                            <div className="aspect-square bg-white border-b border-slate-100 flex items-center justify-center overflow-hidden">
                                {p.Portada
                                    ? <img src={p.Portada} alt="" className="w-full h-full object-contain" loading="lazy" />
                                    : <ImageIcon size={32} className="text-slate-200" />}
                            </div>
                            <div className="p-3">
                                <div className="flex items-center gap-1.5 mb-1">
                                    {p.Publicado
                                        ? <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><Eye size={10} /> Publicado</span>
                                        : <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5"><EyeOff size={10} /> Oculto</span>}
                                </div>
                                <p className="text-sm font-bold text-slate-800 leading-tight line-clamp-2">
                                    {p.TituloVenta || p.Descripcion}
                                </p>
                                <div className="flex items-center justify-between mt-1.5">
                                    <span className="text-sm font-black text-slate-700">{fmtPrecio(p.Precio, p.Moneda) || <span className="text-slate-300 font-semibold text-xs">sin precio</span>}</span>
                                    {p.CategoriaVitrina && <span className="text-[10px] text-slate-400 font-semibold truncate max-w-[45%]">{p.CategoriaVitrina}</span>}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {editando && (
                <EditorProducto
                    producto={editando}
                    categorias={categorias}
                    onCerrar={() => setEditando(null)}
                    onGuardado={() => { setEditando(null); cargar(); }}
                    onIrAPrecios={(id) => navigate(`/marketing/precios${id ? `?producto=${id}` : ''}`)}
                />
            )}
        </div>
    );
};

// ── Modal de edición ─────────────────────────────────────────────────────────
const EditorProducto = ({ producto, categorias, onCerrar, onGuardado, onIrAPrecios }) => {
    const [form, setForm] = useState({
        Publicado: !!producto.Publicado,
        TipoVitrina: producto.TipoVitrina || 'TERMINADO',
        TituloVenta: producto.TituloVenta || '',
        DescripcionVenta: producto.DescripcionVenta || '',
        CategoriaVitrina: producto.CategoriaVitrina || '',
        Orden: producto.Orden || 0,
        EnListaPrecios: producto.EnListaPrecios == null ? true : !!producto.EnListaPrecios,
        EnListaPublica: producto.EnListaPublica == null ? true : !!producto.EnListaPublica,
    });
    const [guardando, setGuardando] = useState(false);
    const [portada, setPortada] = useState(producto.Portada || null);
    const [subiendoPortada, setSubiendoPortada] = useState(false);
    const portadaRef = useRef(null);

    // Fotos por color: se suben/borran al momento (mismo endpoint que el admin técnico).
    // El botón vive EN CADA FILA de la tabla de variantes (el color sale de la variante,
    // nadie tipea nada); colorPendienteRef recuerda para qué color se abrió el file picker.
    const [fotosColor, setFotosColor] = useState([]);
    const [subiendoColor, setSubiendoColor] = useState(null); // color en subida, o null
    const colorRef = useRef(null);
    const colorPendienteRef = useRef(null);
    const fotoDeColor = (color) => {
        const c = String(color || '').trim().toUpperCase();
        return c ? fotosColor.find(f => String(f.color).trim().toUpperCase() === c) : null;
    };

    const cargarFotosColor = () => {
        api.get(`/products-integration/article-images/${producto.ProIdProducto}`)
            .then(res => setFotosColor((res.data?.data || []).filter(i => i.color)))
            .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cargarFotosColor, []);

    // [VARIANTES 21/08] Talle/Color por variante: el GET dispara el auto-parse del backend
    // (backfill incremental) y acá marketing corrige lo que quedó mal o vacío. Se guarda
    // junto con el botón Guardar del modal.
    const [variantes, setVariantes] = useState([]);
    // Eje sin datos = columna oculta (es ruido): talle único esconde TALLE, y sin colores se
    // esconden COLOR y FOTO (la foto por color no aplica). Los links "mostrar" las traen de
    // vuelta por si hay que cargar el eje a mano.
    const [mostrarTalles, setMostrarTalles] = useState(true);
    const [mostrarColores, setMostrarColores] = useState(true);
    // Vista agrupada por color: una fila por color (rename + foto), no una por talle×color.
    // _grupoColor = el color con el que la variante LLEGÓ (identidad estable del grupo
    // mientras se renombra); verDetalle abre la tabla variante-por-variante para casos finos.
    const [verDetalle, setVerDetalle] = useState(false);
    useEffect(() => {
        api.get(`/products-integration/vitrina/${producto.ProIdProducto}/variantes`)
            .then(res => {
                const data = (res.data?.data || []).map(v => ({ ...v, _grupoColor: String(v.Color || '').trim().toUpperCase() }));
                setVariantes(data);
                setMostrarTalles(data.some(v => String(v.Talle || '').trim()));
                setMostrarColores(data.some(v => String(v.Color || '').trim()));
            })
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const gruposColor = useMemo(() => {
        const map = {};
        variantes.forEach(v => {
            if (!v._grupoColor) return;
            (map[v._grupoColor] = map[v._grupoColor] || []).push(v);
        });
        return Object.keys(map).map(k => ({
            key: k,
            color: String(map[k][0].Color || '').trim().toUpperCase(), // color ACTUAL (editable)
            talles: [...new Set(map[k].map(v => String(v.Talle || '').trim()).filter(Boolean))],
            cantidad: map[k].length,
        }));
    }, [variantes]);
    const renombrarColorGrupo = (key, nuevo) =>
        setVariantes(prev => prev.map(v => v._grupoColor === key ? { ...v, Color: nuevo.toUpperCase() } : v));
    const tallesProducto = useMemo(
        () => [...new Set(variantes.map(v => String(v.Talle || '').trim()).filter(Boolean))],
        [variantes]);
    // Clases literales (no armar el string por partes: el JIT de Tailwind necesita verlas enteras)
    const gridVariantes = mostrarTalles
        ? (mostrarColores ? 'grid-cols-[1fr_90px_140px_72px]' : 'grid-cols-[1fr_90px]')
        : (mostrarColores ? 'grid-cols-[1fr_140px_72px]' : 'grid-cols-[1fr]');
    const setEjeVariante = (id, campo, valor) =>
        setVariantes(prev => prev.map(v => v.id === id ? { ...v, [campo]: valor } : v));

    const subirPortada = async (file) => {
        if (!file) return;
        setSubiendoPortada(true);
        try {
            const fd = new FormData();
            fd.append('image', file);
            const res = await api.post(`/products-integration/upload-image/${producto.ProIdProducto}`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setPortada(res.data?.imageUrl || portada);
            toast.success('Foto actualizada');
        } catch (e) {
            toast.error('No se pudo subir la foto');
        } finally {
            setSubiendoPortada(false);
        }
    };

    const subirFotoColor = async (file) => {
        const color = String(colorPendienteRef.current || '').trim().toUpperCase();
        if (!file || !color) return;
        setSubiendoColor(color);
        try {
            const fd = new FormData();
            fd.append('color', color);
            fd.append('image', file);
            await api.post(`/products-integration/upload-image/${producto.ProIdProducto}`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            toast.success(`Foto de ${color} subida`);
            cargarFotosColor();
        } catch (e) {
            toast.error('No se pudo subir la foto del color');
        } finally {
            setSubiendoColor(null);
            colorPendienteRef.current = null;
        }
    };
    const elegirFotoColor = (color) => {
        colorPendienteRef.current = color;
        colorRef.current?.click();
    };

    const borrarFotoColor = async (color) => {
        try {
            await api.delete(`/products-integration/article-image/${producto.ProIdProducto}?color=${encodeURIComponent(color)}`);
            cargarFotosColor();
        } catch (e) {
            toast.error('No se pudo borrar');
        }
    };

    const guardar = async () => {
        setGuardando(true);
        try {
            await api.put(`/products-integration/vitrina/${producto.ProIdProducto}`, form);
            if (variantes.length) {
                await api.put(`/products-integration/vitrina/${producto.ProIdProducto}/variantes-ejes`, {
                    variantes: variantes.map(v => ({ id: v.id, Talle: v.Talle, Color: v.Color })),
                });
            }
            toast.success(form.Publicado ? 'Guardado — visible en la tienda' : 'Guardado — oculto de la tienda');
            onGuardado();
        } catch (e) {
            toast.error('No se pudo guardar');
            setGuardando(false);
        }
    };

    // Portal a body + z al tope del layout (la navbar es sticky z-[5010] y el overlay más
    // alto del admin usa z-[99999]): sin esto el header del modal quedaba cortado debajo.
    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3">
            <div className="absolute inset-0 bg-black/60" onClick={onCerrar} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-slate-800 truncate">{producto.Descripcion}</h2>
                        <p className="text-xs text-slate-400 font-semibold">{producto.CodArticulo}</p>
                    </div>
                    <button onClick={onCerrar} className="w-9 h-9 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center shrink-0"><X size={18} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 grid md:grid-cols-[240px_1fr] gap-6">
                    {/* Columna fotos */}
                    <div className="space-y-4">
                        <div>
                            <p className="text-xs font-black uppercase tracking-wide text-slate-400 mb-2">Foto principal</p>
                            <div className="aspect-square rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
                                {portada
                                    ? <img src={portada} alt="" className="w-full h-full object-contain" />
                                    : <ImageIcon size={36} className="text-slate-200" />}
                            </div>
                            <input ref={portadaRef} type="file" accept="image/*" className="hidden"
                                onChange={e => { subirPortada(e.target.files?.[0]); e.target.value = ''; }} />
                            <button
                                onClick={() => portadaRef.current?.click()}
                                disabled={subiendoPortada}
                                className="mt-2 w-full py-2 rounded-xl bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-700 disabled:opacity-50"
                            >
                                {subiendoPortada ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                {portada ? 'Cambiar foto' : 'Subir foto'}
                            </button>
                            <p className="text-[10px] text-slate-400 mt-1">Se ajusta sola a 512×512 con fondo blanco.</p>
                        </div>

                        {/* Visibilidad en las DOS listas de precios (portal con cuenta / pública de leads) */}
                        <div className="space-y-2">
                            {[
                                ['EnListaPrecios', 'Lista de precios', 'clientes con cuenta'],
                                ['EnListaPublica', 'Lista pública', 'landing para leads'],
                            ].map(([campo, titulo, sub]) => (
                                <button
                                    key={campo}
                                    onClick={() => setForm(f => ({ ...f, [campo]: !f[campo] }))}
                                    className={`w-full flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors ${form[campo]
                                        ? 'bg-sky-50 border-sky-300'
                                        : 'bg-slate-50 border-slate-200'}`}
                                >
                                    <span className="text-left">
                                        <span className={`block text-xs font-black ${form[campo] ? 'text-sky-700' : 'text-slate-500'}`}>{titulo}</span>
                                        <span className="block text-[10px] text-slate-400">{sub}</span>
                                    </span>
                                    <span className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ml-2 ${form[campo] ? 'bg-sky-500' : 'bg-slate-300'}`}>
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${form[campo] ? 'left-[18px]' : 'left-0.5'}`} />
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Input file compartido de las fotos por color: cada fila de la tabla
                            de variantes tiene su botón (elegirFotoColor fija el color destino). */}
                        <input ref={colorRef} type="file" accept="image/*" className="hidden"
                            onChange={e => { subirFotoColor(e.target.files?.[0]); e.target.value = ''; }} />
                        {/* Fotos de colores que no matchean ninguna variante (huérfanas): visibles
                            para poder borrarlas — sin esto quedarían invisibles en el sistema. */}
                        {(() => {
                            const coloresVar = new Set(variantes.map(v => String(v.Color || '').trim().toUpperCase()).filter(Boolean));
                            const huerfanas = fotosColor.filter(f => !coloresVar.has(String(f.color).trim().toUpperCase()));
                            if (!huerfanas.length) return null;
                            return (
                                <div>
                                    <p className="text-xs font-black uppercase tracking-wide text-slate-400 mb-2">Fotos de colores sin variante</p>
                                    <div className="space-y-1.5">
                                        {huerfanas.map(f => (
                                            <div key={f.color} className="flex items-center gap-2 border border-slate-200 rounded-lg p-1.5">
                                                <img src={f.url_imagen} alt="" className="w-8 h-8 rounded object-contain bg-white border border-slate-100" />
                                                <span className="text-xs font-bold text-slate-600 flex-1">{f.color}</span>
                                                <button onClick={() => borrarFotoColor(f.color)} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Columna ficha */}
                    <div className="space-y-4">
                        {/* Publicado */}
                        <button
                            onClick={() => setForm(f => ({ ...f, Publicado: !f.Publicado }))}
                            className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${form.Publicado
                                ? 'bg-emerald-50 border-emerald-300'
                                : 'bg-slate-50 border-slate-200'}`}
                        >
                            <span className="flex items-center gap-2 text-sm font-black">
                                {form.Publicado
                                    ? <><Eye size={16} className="text-emerald-600" /> <span className="text-emerald-700">Publicado en la tienda</span></>
                                    : <><EyeOff size={16} className="text-slate-400" /> <span className="text-slate-500">Oculto de la tienda</span></>}
                            </span>
                            <span className={`w-10 h-6 rounded-full relative transition-colors ${form.Publicado ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${form.Publicado ? 'left-[18px]' : 'left-0.5'}`} />
                            </span>
                        </button>

                        <div>
                            <label className="text-xs font-black uppercase tracking-wide text-slate-400">Título en la tienda</label>
                            <input
                                value={form.TituloVenta}
                                onChange={e => setForm(f => ({ ...f, TituloVenta: e.target.value }))}
                                placeholder={producto.Descripcion}
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-200"
                            />
                            <p className="text-[10px] text-slate-400 mt-1">Si lo dejás vacío se muestra el nombre interno.</p>
                        </div>

                        <div>
                            <label className="text-xs font-black uppercase tracking-wide text-slate-400">Descripción para el cliente</label>
                            <textarea
                                value={form.DescripcionVenta}
                                onChange={e => setForm(f => ({ ...f, DescripcionVenta: e.target.value }))}
                                rows={4}
                                placeholder="Contale al cliente qué es, de qué material, talles disponibles..."
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-black uppercase tracking-wide text-slate-400">Categoría</label>
                                <input
                                    list="mkt-categorias"
                                    value={form.CategoriaVitrina}
                                    onChange={e => setForm(f => ({ ...f, CategoriaVitrina: e.target.value }))}
                                    placeholder="Ej: Remeras"
                                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-200"
                                />
                                <datalist id="mkt-categorias">
                                    {categorias.map(c => <option key={c} value={c} />)}
                                </datalist>
                            </div>
                            <div>
                                <label className="text-xs font-black uppercase tracking-wide text-slate-400">Orden en la vitrina</label>
                                <input
                                    type="number"
                                    value={form.Orden}
                                    onChange={e => setForm(f => ({ ...f, Orden: e.target.value }))}
                                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-200"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">Menor número = aparece primero.</p>
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-black uppercase tracking-wide text-slate-400">Tipo de producto</label>
                            <select
                                value={form.TipoVitrina}
                                onChange={e => setForm(f => ({ ...f, TipoVitrina: e.target.value }))}
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                            >
                                {TIPOS_VITRINA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>

                        {/* Precio solo lectura */}
                        <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                            <div>
                                <p className="text-xs font-black uppercase tracking-wide text-slate-400">Precio</p>
                                <p className="text-lg font-black text-slate-800">{fmtPrecio(producto.Precio, producto.Moneda) || <span className="text-slate-300 text-sm">Sin precio cargado</span>}</p>
                            </div>
                            <button onClick={() => onIrAPrecios(producto.ProIdProducto)} className="flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-800">
                                Editar en Precios <ExternalLink size={13} />
                            </button>
                        </div>
                    </div>

                    {/* Variantes: talle/color de cada una (define el selector de la ficha) */}
                    {variantes.length > 1 && (
                        <div className="md:col-span-2">
                            <p className="text-xs font-black uppercase tracking-wide text-slate-400 mb-1">Talle y color por variante</p>
                            <p className="text-[11px] text-slate-400 mb-2">
                                Con esto la tienda arma el selector de talles y colores. El sistema los completa solo desde el nombre —
                                corregí acá lo que haya quedado mal.
                                {!mostrarTalles && (
                                    <> Este producto es <span className="font-bold">talle único</span> —{' '}
                                    <button onClick={() => setMostrarTalles(true)} className="text-sky-600 font-bold hover:underline">mostrar talles</button>.</>
                                )}
                                {!mostrarColores && (
                                    <> Este producto <span className="font-bold">no tiene colores</span> —{' '}
                                    <button onClick={() => setMostrarColores(true)} className="text-sky-600 font-bold hover:underline">mostrar colores</button>.</>
                                )}
                            </p>

                            {/* VISTA AGRUPADA: una fila POR COLOR (renombrar aplica a todas sus
                                variantes; la foto es una por color). Los talles, como dato del
                                producto, van en chips. El detalle variante-por-variante queda
                                para casos finos — con talle×color explotaba (36 filas un short). */}
                            {gruposColor.length > 0 && !verDetalle ? (
                                <>
                                    {tallesProducto.length > 0 && (
                                        <div className="flex items-center gap-1.5 flex-wrap mb-2">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1">Talles:</span>
                                            {tallesProducto.map(t => (
                                                <span key={t} className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-600">{t}</span>
                                            ))}
                                        </div>
                                    )}
                                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                                        <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100">
                                            <span className="w-10 text-[10px] font-black uppercase tracking-wider text-slate-400">Foto</span>
                                            <span className="w-48 text-[10px] font-black uppercase tracking-wider text-slate-400">Color</span>
                                            <span className="flex-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Talles</span>
                                        </div>
                                        <div className="divide-y divide-slate-50 max-h-60 overflow-y-auto">
                                            {gruposColor.map(g => {
                                                const fc = fotoDeColor(g.color);
                                                const subiendoEsta = subiendoColor && subiendoColor === g.color;
                                                return (
                                                    <div key={g.key} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50/60">
                                                        <button
                                                            onClick={() => elegirFotoColor(g.color)}
                                                            disabled={!g.color || !!subiendoColor}
                                                            title={fc ? 'Cambiar foto' : 'Subir foto de este color'}
                                                            className="w-10 h-10 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden bg-white hover:border-sky-400 disabled:opacity-40 shrink-0"
                                                        >
                                                            {subiendoEsta
                                                                ? <Loader2 size={14} className="animate-spin text-slate-400" />
                                                                : fc
                                                                    ? <img src={fc.url_imagen} alt="" className="w-full h-full object-contain" />
                                                                    : <Upload size={14} className="text-slate-300" />}
                                                        </button>
                                                        <input
                                                            value={g.color}
                                                            onChange={e => renombrarColorGrupo(g.key, e.target.value)}
                                                            className="w-48 px-2.5 py-2 rounded-lg border border-slate-200 text-xs font-bold uppercase focus:outline-none focus:ring-2 focus:ring-sky-200 shrink-0"
                                                        />
                                                        <div className="flex-1 flex flex-wrap items-center gap-1">
                                                            {g.talles.length
                                                                ? g.talles.map(t => (
                                                                    <span key={t} className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-500">{t}</span>
                                                                ))
                                                                : <span className="text-[11px] font-semibold text-slate-300">{g.cantidad} variante{g.cantidad > 1 ? 's' : ''}</span>}
                                                        </div>
                                                        {fc && (
                                                            <button onClick={() => borrarFotoColor(g.color)}
                                                                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50" title="Borrar foto">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <button onClick={() => setVerDetalle(true)} className="mt-1.5 text-[11px] text-sky-600 font-bold hover:underline">
                                        Editar variante por variante ({variantes.length})
                                    </button>
                                </>
                            ) : (
                            <>
                            {gruposColor.length > 0 && (
                                <button onClick={() => setVerDetalle(false)} className="mb-1.5 text-[11px] text-sky-600 font-bold hover:underline">
                                    ← Volver a la vista por color
                                </button>
                            )}
                            <div className="rounded-xl border border-slate-200 overflow-hidden">
                                <div className={`grid ${gridVariantes} gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100`}>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Variante</span>
                                    {mostrarTalles && <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Talle</span>}
                                    {mostrarColores && <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Color</span>}
                                    {mostrarColores && <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Foto</span>}
                                </div>
                                <div className="divide-y divide-slate-50 max-h-56 overflow-y-auto">
                                    {variantes.map(v => {
                                        const fc = fotoDeColor(v.Color);
                                        const subiendoEsta = subiendoColor && subiendoColor === String(v.Color || '').trim().toUpperCase();
                                        return (
                                            <div key={v.id} className={`grid ${gridVariantes} gap-2 px-3 py-1.5 items-center`}>
                                                <span className="text-xs font-semibold text-slate-600 truncate" title={v.nombre_variante}>{v.nombre_variante}</span>
                                                {mostrarTalles && (
                                                    <input
                                                        value={v.Talle || ''}
                                                        onChange={e => setEjeVariante(v.id, 'Talle', e.target.value.toUpperCase())}
                                                        placeholder="—"
                                                        className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold uppercase text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
                                                    />
                                                )}
                                                {mostrarColores && (
                                                    <input
                                                        value={v.Color || ''}
                                                        onChange={e => setEjeVariante(v.id, 'Color', e.target.value.toUpperCase())}
                                                        placeholder="—"
                                                        className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold uppercase focus:outline-none focus:ring-2 focus:ring-sky-200"
                                                    />
                                                )}
                                                {mostrarColores && (
                                                    /* Foto del color de ESTA variante: subir/cambiar + borrar */
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => elegirFotoColor(v.Color)}
                                                            disabled={!String(v.Color || '').trim() || !!subiendoColor}
                                                            title={!String(v.Color || '').trim() ? 'Primero cargale un color' : (fc ? 'Cambiar foto' : 'Subir foto de este color')}
                                                            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden bg-white hover:border-sky-300 disabled:opacity-40"
                                                        >
                                                            {subiendoEsta
                                                                ? <Loader2 size={13} className="animate-spin text-slate-400" />
                                                                : fc
                                                                    ? <img src={fc.url_imagen} alt="" className="w-full h-full object-contain" />
                                                                    : <Upload size={13} className="text-slate-400" />}
                                                        </button>
                                                        {fc && (
                                                            <button onClick={() => borrarFotoColor(String(v.Color).trim().toUpperCase())}
                                                                className="text-slate-300 hover:text-red-500" title="Borrar foto">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            </>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
                    <button onClick={onCerrar} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-bold hover:bg-slate-50">Cancelar</button>
                    <button
                        onClick={guardar}
                        disabled={guardando}
                        className="flex-1 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-black flex items-center justify-center gap-2 hover:bg-slate-700 disabled:opacity-50"
                    >
                        {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default MarketingProductosPage;
