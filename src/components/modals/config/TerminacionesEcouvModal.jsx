import React, { useState, useEffect, useCallback } from 'react';
import api from '../../../services/apiClient';
import toast from 'react-hot-toast';
import { X, Plus, Loader2, RefreshCw, Save, Scissors, ChevronDown, ChevronRight } from 'lucide-react';

// Configuración de terminaciones ECOUV (una sola puerta para la matriz):
// catálogo + manera de aplicación (ubicaciones/regla de cantidad) + precio
// directo (escribe PreciosBase) + en qué materiales se ofrece cada una.
const API = '/stockart';
const GRUPO_ECOUV = '1.3';

const UBICACIONES = [
    { v: 'ARRIBA', l: 'Arriba' },
    { v: 'ABAJO', l: 'Abajo' },
    { v: 'ARRIBA_ABAJO', l: 'Arriba y abajo' },
    { v: 'COSTADOS', l: 'Costados' },
    { v: 'PERIMETRO', l: 'Todo el perímetro' },
];
const REGLAS = [
    { v: 'FIJA', l: 'Cantidad fija' },
    { v: 'CADA_X_CM', l: '1 cada X cm del tramo' },
    { v: 'METROS_TRAMO', l: 'Metros del tramo elegido' },
];
const unidadLabel = (u) => u === 'M2' ? 'm²' : u === 'M' ? 'metro' : 'unidad';

export default function TerminacionesEcouvModal({ isOpen, onClose }) {
    const [terms, setTerms] = useState([]);
    const [materiales, setMateriales] = useState([]);        // artículos MATERIAL grupo 1.3
    const [variantes, setVariantes] = useState({});           // CodStock -> nombre variante
    const [artsTerm, setArtsTerm] = useState([]);              // artículos vinculables (facturación)
    const [selId, setSelId] = useState(null);
    const [form, setForm] = useState(null);                    // copia editable de la seleccionada
    const [matsSel, setMatsSel] = useState(new Set());         // CodArticulos que la ofrecen
    const [openGroups, setOpenGroups] = useState({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [nuevoNombre, setNuevoNombre] = useState('');
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [t, m, v, a] = await Promise.all([
                api.get(`${API}/terminaciones?all=1`),
                api.get(`${API}/materiales-impresion?grupo=${GRUPO_ECOUV}`),
                api.get(`${API}?grupo=${GRUPO_ECOUV}`),
                api.get(`${API}/terminaciones/articulos-disponibles`),
            ]);
            const lista = t.data?.data || [];
            setTerms(lista);
            setMateriales(m.data?.data || []);
            const map = {};
            (v.data?.data || []).forEach(r => { if (r.TipoStock === 'MATERIAL') map[r.CodStock] = r.Articulo; });
            setVariantes(map);
            setArtsTerm(a.data?.data || []);
            if (lista.length > 0 && !lista.some(x => x.TerminacionID === selId)) setSelId(lista[0].TerminacionID);
        } catch (e) {
            toast.error('Error cargando terminaciones: ' + (e.response?.data?.error || e.message));
        } finally {
            setLoading(false);
        }
    }, [selId]);

    useEffect(() => { if (isOpen) load(); }, [isOpen]);

    // Al seleccionar: copiar a form editable + traer sus materiales
    useEffect(() => {
        if (!selId) { setForm(null); return; }
        const t = terms.find(x => x.TerminacionID === selId);
        if (!t) return;
        setForm({
            nombre: (t.Nombre || '').trim(),
            unidadCobro: t.UnidadCobro || 'U',
            codArticulo: (t.CodArticulo || '').trim(),
            activo: !!t.Activo,
            ubicaciones: new Set((t.Ubicaciones || '').split(',').map(x => x.trim()).filter(Boolean)),
            reglaCantidad: t.ReglaCantidad || 'FIJA',
            paramCantidad: t.ParamCantidad != null ? String(t.ParamCantidad) : '',
            clienteElige: t.ClienteElige !== false,
            precio: t.Precio != null ? String(t.Precio) : '',
            moneda: t.Moneda === 'USD' ? 'USD' : 'UYU',
        });
        api.get(`${API}/terminaciones/${selId}/materiales`)
            .then(res => setMatsSel(new Set(res.data?.data || [])))
            .catch(() => setMatsSel(new Set()));
    }, [selId, terms]);

    if (!isOpen) return null;

    const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
    const toggleUbi = (v) => setForm(prev => {
        const next = new Set(prev.ubicaciones);
        next.has(v) ? next.delete(v) : next.add(v);
        return { ...prev, ubicaciones: next };
    });
    const toggleMat = (cod) => setMatsSel(prev => {
        const next = new Set(prev);
        next.has(cod) ? next.delete(cod) : next.add(cod);
        return next;
    });

    // Materiales agrupados por variante física
    const grupos = {};
    materiales.forEach(m => {
        const cod = (m.CodStock || '').trim();
        const nombre = variantes[cod] || cod;
        (grupos[nombre] = grupos[nombre] || []).push(m);
    });

    const setGrupo = (mats, marcar) => setMatsSel(prev => {
        const next = new Set(prev);
        mats.forEach(m => { const c = (m.CodArticulo || '').trim(); marcar ? next.add(c) : next.delete(c); });
        return next;
    });

    const guardar = async () => {
        if (!form || !selId) return;
        setSaving(true);
        try {
            await api.put(`${API}/terminaciones/${selId}`, {
                nombre: form.nombre,
                unidadCobro: form.unidadCobro,
                codArticulo: form.codArticulo || null,
                activo: form.activo,
                ubicaciones: [...form.ubicaciones].join(',') || null,
                reglaCantidad: form.reglaCantidad,
                paramCantidad: form.reglaCantidad === 'METROS_TRAMO' ? null : (form.paramCantidad !== '' ? parseFloat(form.paramCantidad) : null),
                clienteElige: form.clienteElige,
                ...(form.precio !== '' ? { precio: parseFloat(form.precio), moneda: form.moneda } : {}),
            });
            await api.put(`${API}/terminaciones/${selId}/materiales`, { codArticulos: [...matsSel] });
            toast.success('✅ Terminación guardada');
            load();
        } catch (e) {
            toast.error('Error guardando: ' + (e.response?.data?.error || e.message));
        } finally {
            setSaving(false);
        }
    };

    const crear = async () => {
        if (!nuevoNombre.trim()) { toast.error('Poné un nombre'); return; }
        setCreating(true);
        try {
            await api.post(`${API}/terminaciones`, { nombre: nuevoNombre.trim(), unidadCobro: 'U', reglaCantidad: 'FIJA', paramCantidad: 1 });
            setNuevoNombre('');
            toast.success('✅ Terminación creada — completá su ficha');
            await load();
        } catch (e) {
            toast.error('Error creando: ' + (e.response?.data?.error || e.message));
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/70 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden border border-slate-200">

                {/* HEADER */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-8 py-5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-amber-400/20 rounded-xl flex items-center justify-center">
                            <Scissors className="text-amber-300" size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white">TERMINACIONES ECOUV</h2>
                            <p className="text-slate-400 text-xs">Catálogo · manera de aplicación · precio · dónde se ofrece</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} className="p-2 hover:bg-white/10 rounded-xl transition-colors" title="Refrescar">
                            {loading ? <Loader2 className="text-white animate-spin" size={18} /> : <RefreshCw className="text-white" size={18} />}
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                            <X className="text-white" size={20} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-1 md:grid-cols-[260px_1fr] overflow-hidden">

                    {/* LISTA */}
                    <div className="border-r border-slate-100 flex flex-col overflow-hidden">
                        <div className="p-3 border-b border-slate-100 flex gap-2">
                            <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && crear()}
                                placeholder="Nueva terminación..."
                                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-amber-400" />
                            <button onClick={crear} disabled={creating}
                                className="px-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-all">
                                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {terms.map(t => (
                                <button key={t.TerminacionID} onClick={() => setSelId(t.TerminacionID)}
                                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all ${selId === t.TerminacionID
                                        ? 'bg-amber-50 border border-amber-300'
                                        : 'hover:bg-slate-50 border border-transparent'} ${!t.Activo ? 'opacity-50' : ''}`}>
                                    <p className="text-sm font-bold text-slate-800 truncate">{(t.Nombre || '').trim()}</p>
                                    <p className="text-[11px] text-slate-400">
                                        {t.Precio != null ? `${t.Moneda === 'USD' ? 'US$' : '$'} ${parseFloat(t.Precio)}` : 'sin precio'} por {unidadLabel(t.UnidadCobro)}{!t.Activo ? ' · inactiva' : ''}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* DETALLE */}
                    {form ? (
                        <div className="overflow-y-auto p-6 space-y-6">

                            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Nombre</label>
                                    <input value={form.nombre} onChange={e => setF('nombre', e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-amber-400" />
                                </div>
                                <label className="flex items-center gap-2 pb-2 cursor-pointer">
                                    <input type="checkbox" checked={form.activo} onChange={e => setF('activo', e.target.checked)} className="w-4 h-4 accent-emerald-500" />
                                    <span className="text-xs font-bold text-slate-600">Activa</span>
                                </label>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Se cobra por</label>
                                    <select value={form.unidadCobro} onChange={e => setF('unidadCobro', e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none">
                                        <option value="U">Unidad</option>
                                        <option value="M">Metro lineal</option>
                                        <option value="M2">Metro cuadrado</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Precio</label>
                                    <input type="number" step="0.01" min="0" value={form.precio} onChange={e => setF('precio', e.target.value)}
                                        placeholder="0.00"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-right outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Moneda</label>
                                    <select value={form.moneda} onChange={e => setF('moneda', e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none">
                                        <option value="UYU">$ UYU</option>
                                        <option value="USD">US$ USD</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Artículo (factura)</label>
                                    <select value={form.codArticulo} onChange={e => setF('codArticulo', e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs outline-none">
                                        <option value="">— Sin artículo —</option>
                                        {artsTerm.map(a => <option key={a.CodArticulo} value={a.CodArticulo}>{a.CodArticulo} · {a.Descripcion}</option>)}
                                    </select>
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-400 -mt-3">El precio se guarda directo en PreciosBase del artículo vinculado.</p>

                            {/* MANERA DE APLICACIÓN */}
                            <div className="bg-amber-50/60 border border-amber-100 rounded-2xl p-4 space-y-3">
                                <p className="text-xs font-black text-amber-700 uppercase tracking-wide">Manera de aplicación</p>
                                <div>
                                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-2">Ubicaciones habilitadas (dónde puede ir)</label>
                                    <div className="flex flex-wrap gap-2">
                                        {UBICACIONES.map(u => {
                                            const on = form.ubicaciones.has(u.v);
                                            return (
                                                <button key={u.v} type="button" onClick={() => toggleUbi(u.v)}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${on
                                                        ? 'bg-amber-500 border-amber-500 text-white'
                                                        : 'bg-white border-slate-200 text-slate-500 hover:border-amber-300'}`}>
                                                    {on ? '✓ ' : ''}{u.l}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1.5">Sin ubicaciones = terminación libre (no pregunta dónde va).</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Cantidad sugerida</label>
                                        <select value={form.reglaCantidad} onChange={e => setF('reglaCantidad', e.target.value)}
                                            className="w-full bg-white border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none">
                                            {REGLAS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                                        </select>
                                    </div>
                                    {form.reglaCantidad !== 'METROS_TRAMO' && (
                                        <div>
                                            <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">
                                                {form.reglaCantidad === 'CADA_X_CM' ? 'Cada (cm)' : 'Cantidad (N)'}
                                            </label>
                                            <input type="number" step="0.5" min="0" value={form.paramCantidad}
                                                onChange={e => setF('paramCantidad', e.target.value)}
                                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-right outline-none" />
                                        </div>
                                    )}
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={form.clienteElige} onChange={e => setF('clienteElige', e.target.checked)} className="w-4 h-4 accent-amber-500" />
                                    <span className="text-xs text-slate-600"><b>El cliente elige la manera</b> — ve las ubicaciones habilitadas y puede ajustar la cantidad</span>
                                </label>
                            </div>

                            {/* MATERIALES DONDE SE OFRECE */}
                            <div>
                                <p className="text-xs font-black text-slate-500 uppercase tracking-wide mb-2">Se ofrece en estos materiales ({matsSel.size})</p>
                                <div className="space-y-2">
                                    {Object.entries(grupos).map(([nombre, mats]) => {
                                        const marcados = mats.filter(m => matsSel.has((m.CodArticulo || '').trim())).length;
                                        const abierto = !!openGroups[nombre];
                                        return (
                                            <div key={nombre} className="border border-slate-200 rounded-xl overflow-hidden">
                                                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                                                    <button onClick={() => setOpenGroups(p => ({ ...p, [nombre]: !abierto }))} className="p-0.5">
                                                        {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    </button>
                                                    <span className="text-xs font-bold text-slate-700 flex-1">{nombre}</span>
                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${marcados > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                                                        {marcados} / {mats.length}
                                                    </span>
                                                    <button onClick={() => setGrupo(mats, true)} className="text-[10px] font-bold text-slate-500 hover:text-emerald-600 px-2 py-0.5 bg-white border border-slate-200 rounded-lg">Todas</button>
                                                    <button onClick={() => setGrupo(mats, false)} className="text-[10px] font-bold text-slate-500 hover:text-red-500 px-2 py-0.5 bg-white border border-slate-200 rounded-lg">Ninguna</button>
                                                </div>
                                                {abierto && (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-3 border-t border-slate-100">
                                                        {mats.map(m => {
                                                            const cod = (m.CodArticulo || '').trim();
                                                            return (
                                                                <label key={cod} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 rounded-lg px-2 py-1">
                                                                    <input type="checkbox" checked={matsSel.has(cod)} onChange={() => toggleMat(cod)} className="w-3.5 h-3.5 accent-amber-500" />
                                                                    <span className="truncate">{(m.Descripcion || m.Material || '').trim()}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center text-slate-300 text-sm">
                            {loading ? <Loader2 className="animate-spin" size={24} /> : 'Seleccioná una terminación'}
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                <div className="px-8 py-3 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
                    <p className="text-[10px] text-slate-400">Los cambios impactan al instante en el pedido web del portal.</p>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-xs font-bold text-slate-600 transition-all">Cerrar</button>
                        <button onClick={guardar} disabled={saving || !form}
                            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all">
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar cambios
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
