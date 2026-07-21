import React, { useState, useEffect, useCallback } from 'react';
import api from '../../../services/apiClient';
import toast from 'react-hot-toast';
import { X, Loader2, Box, Plus, Eye, EyeOff, Trash2, RefreshCw } from 'lucide-react';

// Gestor de PRODUCTOS TERMINADOS EcoUV: barra lateral con la lista (seleccionar,
// activar/desactivar, eliminar) + ficha completa a la derecha (alta y edición).
// El código del artículo es AUTOMÁTICO: CodArticulo = IDProdReact = ProIdProducto.
const API = '/stockart';
const GRUPO_ECOUV = '1.3';
const UBICACIONES = [
    { v: 'ARRIBA', l: 'Arriba' }, { v: 'ABAJO', l: 'Abajo' },
    { v: 'ARRIBA_ABAJO', l: 'Arriba y abajo' }, { v: 'COSTADOS', l: 'Costados' },
    { v: 'PERIMETRO', l: 'Perímetro' },
];

const Paso = ({ n, titulo, children, verde }) => (
    <div>
        <p className="text-xs font-black text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center ${verde ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{n}</span>
            {titulo}
        </p>
        {children}
    </div>
);

const FORM_VACIO = {
    nombre: '', codStock: '', visible: true,
    material: '', tinta: '', ancho: '', alto: '', borde: '',
    moneda: 'UYU', precio: ''
};

export default function NuevoProductoTerminadoModal({ isOpen, onClose, onCreated }) {
    const [lista, setLista] = useState([]);
    const [variantesPT, setVariantesPT] = useState([]);
    const [materiales, setMateriales] = useState([]);
    const [termCatalogo, setTermCatalogo] = useState([]);
    const [selCod, setSelCod] = useState(null);            // null = NUEVO
    const [f, setFAll] = useState(FORM_VACIO);
    const [incluidas, setIncluidas] = useState({});         // TerminacionID -> { cantidad, ubicacion }
    const [saving, setSaving] = useState(false);
    const [loadingLista, setLoadingLista] = useState(false);
    const [busyCod, setBusyCod] = useState(null);
    const setF = (k, v) => setFAll(prev => ({ ...prev, [k]: v }));

    const cargarLista = useCallback(async () => {
        setLoadingLista(true);
        try {
            const r = await api.get(`${API}/productos-terminados`);
            setLista(r.data?.data || []);
        } catch (e) {
            toast.error('Error cargando productos: ' + (e.response?.data?.error || e.message));
        } finally {
            setLoadingLista(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        setSelCod(null);
        setIncluidas({});
        Promise.all([
            api.get(`${API}?grupo=${GRUPO_ECOUV}`),
            api.get(`${API}/materiales-impresion?grupo=${GRUPO_ECOUV}`),
            api.get(`${API}/terminaciones`),
        ]).then(([v, m, t]) => {
            const pts = (v.data?.data || []).filter(r => r.TipoStock === 'PRODUCTO_TERMINADO');
            setVariantesPT(pts);
            setMateriales(m.data?.data || []);
            setTermCatalogo(t.data?.data || []);
            setFAll({ ...FORM_VACIO, codStock: pts.find(x => x.Mostrar)?.CodStock || pts[0]?.CodStock || '' });
        }).catch(e => toast.error('Error cargando datos: ' + (e.response?.data?.error || e.message)));
        cargarLista();
    }, [isOpen, cargarLista]);

    // Seleccionar un producto de la lista → cargar su ficha
    const seleccionar = async (p) => {
        setSelCod(p.CodArticulo);
        setFAll({
            nombre: p.Descripcion || '',
            codStock: p.CodStock || '',
            visible: !!p.Mostrar,
            material: '', tinta: '', ancho: '', alto: '', borde: '',
            moneda: p.Moneda === 'USD' ? 'USD' : 'UYU',
            precio: p.Precio != null ? String(p.Precio) : ''
        });
        setIncluidas({});
        try {
            const r = await api.get(`${API}/articulos/${encodeURIComponent(p.CodArticulo)}/producto-terminado`);
            const d = r.data?.data;
            if (d) {
                setFAll(prev => ({
                    ...prev,
                    material: d.materialCodArticulo || '',
                    tinta: d.tinta || '',
                    ancho: d.anchoM != null ? String(d.anchoM) : '',
                    alto: d.altoM != null ? String(d.altoM) : '',
                    borde: d.bordeCm != null ? String(d.bordeCm) : '',
                }));
                const map = {};
                (d.terminaciones || []).forEach(t => { map[t.TerminacionID] = { cantidad: t.Cantidad, ubicacion: t.Ubicacion || '' }; });
                setIncluidas(map);
            }
        } catch (e) {
            toast.error('Error cargando ficha: ' + (e.response?.data?.error || e.message));
        }
    };

    const nuevo = () => {
        setSelCod(null);
        setIncluidas({});
        setFAll({ ...FORM_VACIO, codStock: variantesPT.find(x => x.Mostrar)?.CodStock || variantesPT[0]?.CodStock || '' });
    };

    const toggleVisible = async (p) => {
        setBusyCod(p.CodArticulo);
        try {
            await api.put(`${API}/productos-terminados/${encodeURIComponent(p.CodArticulo)}`, { mostrar: !p.Mostrar });
            if (selCod === p.CodArticulo) setF('visible', !p.Mostrar);
            cargarLista();
        } catch (e) {
            toast.error('Error: ' + (e.response?.data?.error || e.message));
        } finally {
            setBusyCod(null);
        }
    };

    const eliminar = async (p) => {
        if (!window.confirm(`¿Eliminar "${p.Descripcion}" (${p.CodArticulo})? Esta acción no se puede deshacer.`)) return;
        setBusyCod(p.CodArticulo);
        try {
            await api.delete(`${API}/articulos/${encodeURIComponent(p.CodArticulo)}?codStock=${encodeURIComponent(p.CodStock)}`);
            toast.success(`✅ "${p.Descripcion}" eliminado`);
            if (selCod === p.CodArticulo) nuevo();
            cargarLista();
        } catch (e) {
            toast.error('Error eliminando: ' + (e.response?.data?.error || e.message));
        } finally {
            setBusyCod(null);
        }
    };

    if (!isOpen) return null;

    const toggleInc = (id) => setIncluidas(prev => {
        const next = { ...prev };
        if (next[id]) delete next[id];
        else next[id] = { cantidad: 1, ubicacion: '' };
        return next;
    });

    const matSel = materiales.find(m => (m.CodArticulo || '').trim() === f.material);
    const fichaPayload = () => ({
        anchoM: f.ancho !== '' ? parseFloat(f.ancho) : null,
        altoM: f.alto !== '' ? parseFloat(f.alto) : null,
        bordeCm: f.borde !== '' ? parseFloat(f.borde) : null,
        materialCodArticulo: f.material || null,
        tinta: f.tinta || null,
        terminaciones: Object.entries(incluidas).map(([id, v]) => ({
            terminacionId: parseInt(id),
            cantidad: parseFloat(v.cantidad) || 1,
            ubicacion: v.ubicacion || null,
        })),
    });

    const guardar = async () => {
        if (!f.nombre.trim()) return toast.error('Poné el nombre del producto');
        if (!f.codStock) return toast.error('Elegí la variante');
        setSaving(true);
        try {
            if (!selCod) {
                // NUEVO: alta completa en una transacción, código automático (= ProIdProducto)
                const r = await api.post(`${API}/productos-terminados`, {
                    descripcion: f.nombre.trim(),
                    codStock: f.codStock,
                    mostrar: f.visible,
                    moneda: f.moneda,
                    precio: f.precio !== '' ? parseFloat(f.precio) : undefined,
                    ...fichaPayload(),
                });
                toast.success(`✅ Producto creado (código ${r.data?.codArticulo})`);
                onCreated && onCreated();
                await cargarLista();
                setSelCod(r.data?.codArticulo || null);
            } else {
                // EDICIÓN: datos + ficha + precio
                await api.put(`${API}/productos-terminados/${encodeURIComponent(selCod)}`, {
                    descripcion: f.nombre.trim(),
                    mostrar: f.visible,
                    codStock: f.codStock,
                });
                await api.put(`${API}/articulos/${encodeURIComponent(selCod)}/producto-terminado`, fichaPayload());
                if (f.precio !== '') {
                    await api.put(`${API}/articulos/${encodeURIComponent(selCod)}/precio-base`, {
                        precio: parseFloat(f.precio),
                        moneda: f.moneda,
                    });
                }
                toast.success('✅ Producto guardado');
                cargarLista();
            }
        } catch (e) {
            toast.error('Error guardando: ' + (e.response?.data?.error || e.message));
        } finally {
            setSaving(false);
        }
    };

    const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-purple-400";

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/70 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden border border-slate-200">

                <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-purple-400/20 rounded-xl flex items-center justify-center">
                            <Box className="text-purple-300" size={18} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-white">PRODUCTOS TERMINADOS</h2>
                            <p className="text-slate-400 text-[11px]">Alta y edición · el código se asigna solo (= ID interno)</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl"><X className="text-white" size={18} /></button>
                </div>

                <div className="flex-1 grid grid-cols-1 md:grid-cols-[250px_1fr] overflow-hidden">

                    {/* BARRA LATERAL: lista de productos */}
                    <div className="border-r border-slate-100 flex flex-col overflow-hidden">
                        <div className="p-3 border-b border-slate-100 flex gap-2">
                            <button onClick={nuevo}
                                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${!selCod
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'}`}>
                                <Plus size={14} /> Nuevo producto
                            </button>
                            <button onClick={cargarLista} className="px-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-500">
                                {loadingLista ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {lista.map(p => (
                                <div key={p.CodArticulo}
                                    className={`group flex items-center gap-1.5 rounded-xl border transition-all ${selCod === p.CodArticulo
                                        ? 'bg-purple-50 border-purple-300'
                                        : 'border-transparent hover:bg-slate-50'} ${!p.Mostrar ? 'opacity-50' : ''}`}>
                                    <button onClick={() => seleccionar(p)} className="flex-1 text-left px-2.5 py-2 min-w-0">
                                        <p className="text-xs font-bold text-slate-800 truncate">{p.Descripcion}</p>
                                        <p className="text-[10px] text-slate-400 truncate">
                                            #{p.CodArticulo} · {p.Variante}{p.Precio != null ? ` · ${p.Moneda === 'USD' ? 'US$' : '$'} ${parseFloat(p.Precio)}` : ''}
                                        </p>
                                    </button>
                                    <button onClick={() => toggleVisible(p)} disabled={busyCod === p.CodArticulo}
                                        className="p-1 rounded-lg hover:bg-slate-200 shrink-0" title={p.Mostrar ? 'Desactivar (ocultar del portal)' : 'Activar'}>
                                        {p.Mostrar ? <Eye size={13} className="text-emerald-600" /> : <EyeOff size={13} className="text-slate-400" />}
                                    </button>
                                    <button onClick={() => eliminar(p)} disabled={busyCod === p.CodArticulo}
                                        className="p-1 mr-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 shrink-0"
                                        title="Eliminar (bloqueado si tiene órdenes históricas)">
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))}
                            {lista.length === 0 && !loadingLista && (
                                <p className="text-xs text-slate-400 italic text-center py-6">Sin productos todavía</p>
                            )}
                        </div>
                    </div>

                    {/* FICHA */}
                    <div className="overflow-y-auto p-6 space-y-6">

                        <Paso n={1} titulo="Datos del producto">
                            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Nombre</label>
                                    <input value={f.nombre} onChange={e => setF('nombre', e.target.value)} placeholder="Cuadro canvas 30 x 30" className={inputCls} />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Código artículo</label>
                                    <div className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-500">
                                        {selCod ? `#${selCod}` : 'Automático al crear'}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3 mt-3">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Variante (dónde lo ve el cliente)</label>
                                    <select value={f.codStock} onChange={e => setF('codStock', e.target.value)} className={inputCls}>
                                        {variantesPT.map(v => <option key={v.CodStock} value={v.CodStock}>{v.Articulo}</option>)}
                                    </select>
                                </div>
                                <label className="flex items-end gap-2 pb-2 cursor-pointer">
                                    <input type="checkbox" checked={f.visible} onChange={e => setF('visible', e.target.checked)} className="w-4 h-4 accent-emerald-500" />
                                    <span className="text-xs font-bold text-slate-600">Visible en portal</span>
                                </label>
                            </div>
                        </Paso>

                        <Paso n={2} titulo="Ficha de producción">
                            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Material de impresión</label>
                                    <select value={f.material} onChange={e => setF('material', e.target.value)} className={inputCls}>
                                        <option value="">— Sin definir —</option>
                                        {materiales.map(m => <option key={m.CodArticulo} value={(m.CodArticulo || '').trim()}>{(m.Descripcion || m.Material || '').trim()}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Tinta</label>
                                    <select value={f.tinta} onChange={e => setF('tinta', e.target.value)} className={inputCls}>
                                        <option value="">— Sin definir —</option>
                                        <option value="Ecosolvente">Ecosolvente</option>
                                        <option value="UV">UV</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3 mt-3">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Ancho (m)</label>
                                    <input type="number" step="0.01" min="0" value={f.ancho} onChange={e => setF('ancho', e.target.value)} className={inputCls + ' text-right'} placeholder="0.30" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Alto (m)</label>
                                    <input type="number" step="0.01" min="0" value={f.alto} onChange={e => setF('alto', e.target.value)} className={inputCls + ' text-right'} placeholder="0.30" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Borde (cm)</label>
                                    <input type="number" step="0.5" min="0" value={f.borde} onChange={e => setF('borde', e.target.value)} className={inputCls + ' text-right'} placeholder="3" />
                                </div>
                            </div>
                            {(f.ancho && f.alto) && (
                                <p className="text-[10px] text-slate-400 mt-2">
                                    Área de impresión real: {(parseFloat(f.ancho || 0) + 2 * (parseFloat(f.borde || 0) / 100)).toFixed(2)} × {(parseFloat(f.alto || 0) + 2 * (parseFloat(f.borde || 0) / 100)).toFixed(2)} m (el borde es la demasía por lado).
                                </p>
                            )}
                        </Paso>

                        <Paso n={3} titulo="Terminaciones incluidas (dentro del precio)">
                            <div className="flex flex-wrap gap-2">
                                {termCatalogo.map(t => {
                                    const v = incluidas[t.TerminacionID];
                                    const active = v != null;
                                    const ubis = (t.Ubicaciones || '').split(',').map(x => x.trim()).filter(Boolean);
                                    return (
                                        <div key={t.TerminacionID} className={`inline-flex items-center rounded-full border transition-all overflow-hidden ${active
                                            ? 'bg-purple-500 border-purple-500 text-white'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-purple-300'}`}>
                                            <button type="button" onClick={() => toggleInc(t.TerminacionID)} className="px-3 py-1.5 text-xs font-bold">
                                                {active ? '✓ ' : '+ '}{(t.Nombre || '').trim()}
                                            </button>
                                            {active && ubis.length > 0 && (
                                                <select value={v.ubicacion} onChange={e => setIncluidas(p => ({ ...p, [t.TerminacionID]: { ...p[t.TerminacionID], ubicacion: e.target.value } }))}
                                                    className="text-[10px] font-bold text-purple-700 bg-white rounded-full px-1.5 py-1 mr-1 outline-none max-w-[105px]">
                                                    <option value="">Ubicación...</option>
                                                    {UBICACIONES.filter(u => ubis.includes(u.v)).map(u => <option key={u.v} value={u.v}>{u.l}</option>)}
                                                </select>
                                            )}
                                            {active && (
                                                <input type="number" min="0.5" step="0.5" value={v.cantidad}
                                                    onChange={e => setIncluidas(p => ({ ...p, [t.TerminacionID]: { ...p[t.TerminacionID], cantidad: e.target.value } }))}
                                                    className="w-12 px-1 py-1 mr-1 text-xs font-black text-purple-700 bg-white rounded-full outline-none text-center" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </Paso>

                        <Paso n={4} titulo="Precio cerrado" verde>
                            <div className="grid grid-cols-[1fr_1fr_2fr] gap-3 items-end">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Moneda</label>
                                    <select value={f.moneda} onChange={e => setF('moneda', e.target.value)} className={inputCls}>
                                        <option value="UYU">$ UYU</option>
                                        <option value="USD">US$ USD</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Precio</label>
                                    <input type="number" step="0.01" min="0" value={f.precio} onChange={e => setF('precio', e.target.value)} className={inputCls + ' text-right font-black'} placeholder="450.00" />
                                </div>
                                <p className="text-[10px] text-slate-400 pb-2">Incluye impresión, borde y las terminaciones del paso 3. Se guarda en PreciosBase.</p>
                            </div>
                        </Paso>

                        <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3">
                            <p className="text-[10px] font-black text-purple-500 uppercase tracking-wider mb-1">Así lo ve el cliente</p>
                            <p className="text-xs text-purple-800 font-medium">
                                {f.nombre || 'Producto'} — {f.moneda === 'USD' ? 'US$' : '$'} {f.precio || '0'}
                                {f.ancho && f.alto ? ` · ${f.ancho} × ${f.alto} m` : ''}{f.borde ? ` (+${f.borde} cm de borde)` : ''}
                                {matSel ? ` · Se imprime en ${(matSel.Descripcion || '').trim()}` : ''}{f.tinta ? ` · Tinta ${f.tinta.toLowerCase()}` : ''}
                                {Object.keys(incluidas).length > 0 ? ` · Incluye: ${Object.keys(incluidas).map(id => (termCatalogo.find(t => t.TerminacionID === parseInt(id))?.Nombre || '').trim()).join(', ')}` : ''}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
                    <p className="text-[10px] text-slate-400">
                        {selCod ? `Editando #${selCod}` : 'Alta nueva — código automático (CodArticulo = IDReact = ProIdProducto)'}
                    </p>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-xs font-bold text-slate-600">Cerrar</button>
                        <button onClick={guardar} disabled={saving}
                            className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold">
                            {saving && <Loader2 size={14} className="animate-spin" />} {selCod ? 'Guardar cambios' : 'Crear producto'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
