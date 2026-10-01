import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { PackagePlus, X, Plus, Trash2, LoaderCircle } from 'lucide-react';
import api from '../../services/api';
import Selector from '../ui/Selector';

// ─── Alta de producto de stock nuevo en el WMS propio ─────────────────────────
// Reemplaza a "Artículos Maestros" + "Variantes (SKU)" del sistema de stock viejo: crea el maestro y sus
// variantes en el WMS y el artículo del catálogo ya vinculado, todo junto. El backend solo lo permite
// después del cutover (WMS_INTERNO); antes, el botón que abre esto aparece deshabilitado.
// Lo usan Catálogo y WMS y Stock → Gestión de Sistema → Artículos (30/09). Desde Stock pregunta si el
// producto también se vende: si es un insumo interno no se crea el artículo del catálogo, que sale visible.
const filaVarianteVacia = () => ({ nombre: '', codigo: '', talle: '', color: '', costo: '', moneda: 'UYU', gramajeGsm: '', anchoMetros: '', composicion: '' });
// '' → null, "1,50" → 1.5, texto inválido → NaN (bloquea el alta: nunca se manda como 0).
const numAlta = (s) => {
    const t = String(s ?? '').trim();
    return t === '' ? null : Number(t.replace(',', '.'));
};

const AltaProductoStock = ({ opciones, onClose, onCreado, preguntarVenta = false }) => {
    const [maestro, setMaestro] = useState({ nombre: '', catId: '', unidadBase: '', tipoGestion: 'granel', llevaPeso: false, sku: '' });
    const [variantes, setVariantes] = useState([filaVarianteVacia()]);
    const [saving, setSaving] = useState(false);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const [venta, setVenta] = useState(null);   // con preguntarVenta: true = también se vende (artículo del catálogo)

    const porKilo = maestro.unidadBase === 'kg';
    // Ficha de tela (ancho, gramaje, composición): para lo que se lleva por kilo o es de una familia de telas.
    const familiaSel = opciones.familias.find(f => String(f.id) === String(maestro.catId));
    const esTela = porKilo || /^tela/i.test(String(familiaSel?.nombre || '').trim());
    const numInvalido = (s) => Number.isNaN(numAlta(s)) || numAlta(s) < 0;
    const filaInvalida = (v) => numInvalido(v.costo) || (esTela && (numInvalido(v.gramajeGsm) || numInvalido(v.anchoMetros)));
    const completo = maestro.nombre.trim() && maestro.catId && maestro.unidadBase
        && variantes.every(v => v.nombre.trim() && !filaInvalida(v))
        && (!preguntarVenta || venta !== null);
    const dirty = maestro.nombre.trim() !== '' || variantes.some(v => v.nombre.trim() !== '');

    const setM = (k, val) => setMaestro(m => ({ ...m, [k]: val }));
    const setV = (i, k, val) => setVariantes(vs => vs.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
    const agregar = () => setVariantes(vs => (vs.length >= 50 ? vs : [...vs, filaVarianteVacia()]));
    const quitar = (i) => setVariantes(vs => (vs.length > 1 ? vs.filter((_, j) => j !== i) : vs));

    const intentarCerrar = () => {
        if (saving) return;
        if (dirty) setConfirmDiscard(true);
        else onClose();
    };

    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (confirmDiscard) setConfirmDiscard(false);
            else intentarCerrar();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    const crear = async () => {
        if (!completo || saving) return;
        setSaving(true);
        try {
            const res = await api.post('/products-integration/wms/alta', {
                maestro: { ...maestro, catId: parseInt(maestro.catId, 10) },
                conCatalogo: preguntarVenta ? venta : true,
                variantes: variantes.map(v => ({
                    ...v,
                    costo: numAlta(v.costo) ?? 0,
                    gramajeGsm: esTela ? numAlta(v.gramajeGsm) : null,
                    anchoMetros: esTela ? numAlta(v.anchoMetros) : null,
                    composicion: esTela ? v.composicion : '',
                })),
            });
            const n = res.data?.variantes?.length || 0;
            toast.success(`"${maestro.nombre.trim()}" creado en el WMS con ${n} ${n === 1 ? 'variante' : 'variantes'}`);
            // Para cargar el stock inicial: cada variante creada con lo que necesita el ingreso
            // (vuelven en el orden del formulario)
            onCreado({
                ...res.data,
                variantesStock: (res.data?.variantes || []).map((x, i) => ({
                    VarId: x.varId, Producto: maestro.nombre.trim(), NombreVariante: x.nombre, Talle: x.talle, Color: x.color,
                    UnidadBase: maestro.unidadBase,
                    GramajeGsm: esTela ? numAlta(variantes[i]?.gramajeGsm) : null,
                    AnchoMetros: esTela ? numAlta(variantes[i]?.anchoMetros) : null,
                })),
            });
        } catch (e) {
            toast.error(e.response?.data?.message || 'No se pudo crear el producto');
            setSaving(false);
        }
    };

    const inputBase = "w-full h-10 px-3 border rounded-lg text-sm bg-white outline-none focus:ring-4 transition disabled:bg-slate-50 disabled:text-slate-400";
    const inputCls = `${inputBase} border-slate-300 focus:border-brand-cyan focus:ring-brand-cyan/10`;
    const inputErrCls = `${inputBase} border-red-500 focus:border-red-500 focus:ring-red-500/10`;
    const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";
    const helpCls = "text-[11px] text-slate-400 mt-1 leading-snug";

    return (
        <div className="fixed inset-0 bg-slate-900/60 z-[6000] flex items-center justify-center sm:p-4" onClick={intentarCerrar}>
            <div role="dialog" aria-modal="true" aria-labelledby="alta-wms-titulo"
                className="relative bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-w-3xl sm:max-h-[92vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-start gap-3 p-5 border-b border-slate-100">
                    <div className="w-9 h-9 bg-brand-cyan rounded-lg flex items-center justify-center text-white shrink-0">
                        <PackagePlus size={18} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 id="alta-wms-titulo" className="text-lg font-black text-slate-800">Nuevo producto de stock</h2>
                        <p className="text-xs text-slate-500">
                            {preguntarVenta
                                ? 'Se crea en el stock con sus variantes. Si también se vende, queda en el catálogo, ya vinculado.'
                                : 'Se crea en el WMS con sus variantes y queda en el catálogo, ya vinculado.'}
                        </p>
                    </div>
                    <button type="button" onClick={intentarCerrar} disabled={saving} aria-label="Cerrar"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    <section aria-labelledby="alta-producto">
                        <h3 id="alta-producto" className="text-sm font-bold text-slate-800 mb-3">Producto</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {preguntarVenta && (
                                <div className="sm:col-span-2">
                                    <p className={labelCls}>¿Se vende? *</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {[
                                            [true, 'Sí, también se vende', 'Queda además en el catálogo de artículos, ya vinculado.'],
                                            [false, 'No, es un insumo interno', 'Solo en el stock: no se crea el artículo del catálogo.'],
                                        ].map(([val, titulo, detalle]) => (
                                            <button key={String(val)} type="button" onClick={() => setVenta(val)} disabled={saving}
                                                aria-pressed={venta === val}
                                                className={`text-left rounded-xl border px-3 py-2.5 transition-colors disabled:opacity-60 ${venta === val
                                                    ? 'border-brand-cyan bg-brand-cyan/5 ring-2 ring-brand-cyan/15' : 'border-slate-200 hover:bg-slate-50'}`}>
                                                <span className="block text-sm font-bold text-slate-800">{titulo}</span>
                                                <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{detalle}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="sm:col-span-2">
                                <label htmlFor="alta-nombre" className={labelCls}>Nombre *</label>
                                <input id="alta-nombre" autoFocus maxLength={100} value={maestro.nombre} disabled={saving}
                                    onChange={e => setM('nombre', e.target.value)} placeholder="Ej: Satén liso" className={inputCls} />
                            </div>
                            <div>
                                <label htmlFor="alta-familia" className={labelCls}>Familia *</label>
                                <Selector id="alta-familia" value={maestro.catId} disabled={saving}
                                    onChange={e => setM('catId', e.target.value)}>
                                    <option value="">Elegí una familia</option>
                                    {opciones.familias.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                                </Selector>
                            </div>
                            <div>
                                <label htmlFor="alta-unidad" className={labelCls}>Unidad *</label>
                                <Selector id="alta-unidad" value={maestro.unidadBase} disabled={saving}
                                    onChange={e => setM('unidadBase', e.target.value)}>
                                    <option value="">Elegí la unidad</option>
                                    {opciones.unidades.map(u => <option key={u.v} value={u.v}>{u.t}</option>)}
                                </Selector>
                            </div>
                            <div>
                                <label htmlFor="alta-gestion" className={labelCls}>Tipo de gestión</label>
                                <Selector id="alta-gestion" value={maestro.tipoGestion} disabled={saving}
                                    onChange={e => setM('tipoGestion', e.target.value)}>
                                    {opciones.tiposGestion.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
                                </Selector>
                            </div>
                            <div>
                                <label htmlFor="alta-sku" className={labelCls}>Código</label>
                                <input id="alta-sku" maxLength={100} value={maestro.sku} disabled={saving}
                                    onChange={e => setM('sku', e.target.value)} placeholder="Se genera solo" className={inputCls} />
                                <p className={helpCls}>Si lo dejás vacío se arma como los demás, por ejemplo TEL-SATEN-1.</p>
                            </div>
                            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                                <input type="checkbox" checked={maestro.llevaPeso} disabled={saving}
                                    onChange={e => setM('llevaPeso', e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan/30" />
                                Lleva peso
                            </label>
                        </div>
                    </section>

                    <section aria-labelledby="alta-variantes">
                        <div className="flex items-center justify-between mb-3">
                            <h3 id="alta-variantes" className="text-sm font-bold text-slate-800">
                                Variantes <span className="ml-1 text-xs font-semibold text-slate-400">{variantes.length}</span>
                            </h3>
                            <button type="button" onClick={agregar} disabled={saving || variantes.length >= 50}
                                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold text-brand-cyan bg-brand-cyan/10 hover:bg-brand-cyan/15 transition-colors disabled:opacity-50">
                                <Plus size={14} aria-hidden="true" /> Agregar variante
                            </button>
                        </div>
                        <div className="space-y-3">
                            {variantes.map((v, i) => {
                                const id = (campo) => `alta-v${i}-${campo}`;
                                return (
                                    <div key={i} className="rounded-xl border border-slate-200 p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-bold text-slate-500">Variante {i + 1}</span>
                                            <button type="button" onClick={() => quitar(i)} disabled={saving || variantes.length === 1}
                                                aria-label={`Quitar la variante ${i + 1}`}
                                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent">
                                                <Trash2 size={14} aria-hidden="true" />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                                            <div className="col-span-2 sm:col-span-3">
                                                <label htmlFor={id('nombre')} className={labelCls}>Nombre *</label>
                                                <input id={id('nombre')} maxLength={150} value={v.nombre} disabled={saving}
                                                    onChange={e => setV(i, 'nombre', e.target.value)} placeholder="Ej: Satén liso blanco 1,50" className={inputCls} />
                                            </div>
                                            <div className="col-span-2 sm:col-span-3">
                                                <label htmlFor={id('codigo')} className={labelCls}>Código</label>
                                                <input id={id('codigo')} maxLength={100} value={v.codigo} disabled={saving}
                                                    onChange={e => setV(i, 'codigo', e.target.value)} placeholder="Se genera solo" className={inputCls} />
                                            </div>
                                            <div className="sm:col-span-2">
                                                <label htmlFor={id('talle')} className={labelCls}>Talle</label>
                                                <input id={id('talle')} maxLength={20} value={v.talle} disabled={saving}
                                                    onChange={e => setV(i, 'talle', e.target.value)} className={inputCls} />
                                            </div>
                                            <div className="sm:col-span-2">
                                                <label htmlFor={id('color')} className={labelCls}>Color</label>
                                                <input id={id('color')} maxLength={50} value={v.color} disabled={saving}
                                                    onChange={e => setV(i, 'color', e.target.value)} className={inputCls} />
                                            </div>
                                            <div className="col-span-2 sm:col-span-2">
                                                <label htmlFor={id('costo')} className={labelCls}>Costo de referencia</label>
                                                <div className="grid grid-cols-[1fr_5.5rem] gap-2">
                                                    <input id={id('costo')} inputMode="decimal" value={v.costo} disabled={saving}
                                                        onChange={e => setV(i, 'costo', e.target.value)} placeholder="0,00"
                                                        aria-invalid={numInvalido(v.costo)} className={numInvalido(v.costo) ? inputErrCls : inputCls} />
                                                    <Selector aria-label={`Moneda del costo de la variante ${i + 1}`} value={v.moneda} disabled={saving}
                                                        onChange={e => setV(i, 'moneda', e.target.value)}>
                                                        {opciones.monedas.map(m => <option key={m} value={m}>{m}</option>)}
                                                    </Selector>
                                                </div>
                                            </div>
                                            {esTela && (
                                                <>
                                                    <div className="sm:col-span-3">
                                                        <label htmlFor={id('ancho')} className={labelCls}>Ancho (m)</label>
                                                        <input id={id('ancho')} inputMode="decimal" value={v.anchoMetros} disabled={saving}
                                                            onChange={e => setV(i, 'anchoMetros', e.target.value)} placeholder="Ej: 1,50"
                                                            aria-invalid={numInvalido(v.anchoMetros)} className={numInvalido(v.anchoMetros) ? inputErrCls : inputCls} />
                                                    </div>
                                                    <div className="sm:col-span-3">
                                                        <label htmlFor={id('gramaje')} className={labelCls}>Gramaje (g/m²)</label>
                                                        <input id={id('gramaje')} inputMode="decimal" value={v.gramajeGsm} disabled={saving}
                                                            onChange={e => setV(i, 'gramajeGsm', e.target.value)} placeholder="Ej: 145"
                                                            aria-invalid={numInvalido(v.gramajeGsm)} className={numInvalido(v.gramajeGsm) ? inputErrCls : inputCls} />
                                                    </div>
                                                    <div className="col-span-2 sm:col-span-6">
                                                        <label htmlFor={id('composicion')} className={labelCls}>Composición</label>
                                                        <input id={id('composicion')} maxLength={200} value={v.composicion} disabled={saving}
                                                            onChange={e => setV(i, 'composicion', e.target.value)} placeholder="Ej: 96% Polyester, 4% Spandex"
                                                            className={inputCls} />
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <p className={`${helpCls} mt-2`}>
                            El código de cada variante se arma con el del producto si lo dejás vacío. El talle y el color conviene
                            cargarlos: si quedan vacíos se deducen del nombre, y a veces se lleva de más (por ejemplo la medida).
                            {esTela && ' Ancho, gramaje y composición quedan en la ficha de la tela; si se lleva por kilo, gramaje y ancho hacen que el stock muestre los metros equivalentes.'}
                        </p>
                    </section>
                </div>

                <div className="flex gap-3 p-4 bg-slate-50 border-t border-slate-100">
                    <button type="button" onClick={intentarCerrar} disabled={saving}
                        className="flex-1 px-4 py-2.5 font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl transition disabled:opacity-60">
                        Cancelar
                    </button>
                    <button type="button" onClick={crear} disabled={!completo || saving}
                        className="flex-1 px-4 py-2.5 bg-brand-cyan hover:bg-brand-cyan/90 text-white rounded-xl font-bold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-cyan flex items-center justify-center gap-2">
                        {saving && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                        {saving ? 'Creando...' : 'Crear producto'}
                    </button>
                </div>

                {confirmDiscard && (
                    <div className="absolute inset-0 z-10 bg-slate-900/40 flex items-center justify-center p-6"
                        role="alertdialog" aria-modal="true" aria-labelledby="alta-descartar-titulo" aria-describedby="alta-descartar-texto">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
                            <h3 id="alta-descartar-titulo" className="text-base font-bold text-slate-800">¿Descartar el producto?</h3>
                            <p id="alta-descartar-texto" className="text-sm text-slate-500 mt-1">Lo que cargaste no se va a guardar.</p>
                            <div className="flex justify-end gap-2 mt-5">
                                <button type="button" autoFocus onClick={() => setConfirmDiscard(false)}
                                    className="h-9 px-4 rounded-lg font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Seguir cargando</button>
                                <button type="button" onClick={onClose}
                                    className="h-9 px-4 rounded-lg font-semibold text-white bg-red-500 hover:bg-red-500/90 transition-colors">Descartar</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AltaProductoStock;
