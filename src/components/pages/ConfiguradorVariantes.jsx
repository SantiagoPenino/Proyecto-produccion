// ═════════════════════════════════════════════════════════════════════════
//  [VARIANTES] Paso "Variantes" del producto padre (12/10)
//  Cada modelo del molde que se vende puede ser una VARIANTE: un artículo más (código, nombre, foto, estado)
//  que se edita en el mismo editor que el padre. Acá se crean, se ve qué tiene propio cada una y se abren.
//  Backend: services/productoVariantes.js (GET/POST /productos/:id/variantes).
// ═════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import { Layers, Plus, Pencil, Trash2, RefreshCw, Info, TriangleAlert } from 'lucide-react';

const API = '/configurador';
const simbolo = (m) => { const c = String(m || '').trim().toUpperCase(); return !c || c === 'UYU' ? '$' : c === 'USD' ? 'US$' : c; };
const fmtPrecio = (p, m) => (p == null || p === '' ? 'sin precio' : `${simbolo(m)} ${Number(p).toLocaleString('es-UY', { maximumFractionDigits: 2 })}`);

// hayCambios: el padre tiene cambios sin guardar (las variantes se arman con los modelos GUARDADOS).
// onEditar(proId): abre la variante en el editor. BorrarModal: la ventana de borrar del configurador.
export default function PasoVariantes({ proId, hayCambios, onCambio, onEditar, BorrarModal }) {
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const [creando, setCreando] = useState(null);       // modeloClave | 'todas'
    const [borrando, setBorrando] = useState(null);     // variante a borrar

    const cargar = useCallback(async () => {
        try { const { data } = await api.get(`${API}/productos/${proId}/variantes`); setDatos(data.data); setError(null); }
        catch (e) { setError(e.response?.data?.error || e.message); }
    }, [proId]);
    useEffect(() => { setDatos(null); cargar(); }, [cargar]);

    const crear = async (claves) => {
        setCreando(claves.length > 1 ? 'todas' : claves[0]);
        try {
            const hechas = [];
            for (const c of claves) { const { data } = await api.post(`${API}/productos/${proId}/variantes`, { modeloClave: c }); hechas.push(data.data.codArticulo); }
            toast.success(`✅ ${hechas.length === 1 ? `Variante creada: ${hechas[0]}` : `${hechas.length} variantes creadas: ${hechas.join(', ')}`}`);
            await cargar(); onCambio?.();
        } catch (e) {
            toast.error(e.response?.data?.error || e.message);
            await cargar();
        } finally { setCreando(null); }
    };

    if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
    if (!datos) return <p className="text-sm text-slate-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Cargando variantes…</p>;

    const { padre, variantes, modelosSinVariante } = datos;
    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-brand-cyan/20 bg-brand-cyan/5 p-4 text-[12px] text-slate-600 flex gap-3">
                <Layers size={18} className="text-brand-cyan shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p><b className="text-slate-800">Cada modelo del molde que se vende puede ser una variante:</b> un artículo más, con su código ({padre.codArticulo}-01, -02…), su nombre, su foto y su estado. Es lo que se elige en la solicitud y sale en el pedido y la factura.</p>
                    <p>Nace <b>igual a {padre.descripcion}</b> (técnicas, telas, apliques, accesorios, ficha, avíos, costuras y precio) y después la cambiás con <b>Editar</b>, como cualquier producto. El molde y el modelo no se cambian, y las técnicas, telas y accesorios solo pueden ser de los que tiene el padre: si el padre deja de tener algo, se les saca también a sus variantes.</p>
                </div>
            </div>

            {hayCambios && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                    <TriangleAlert size={14} className="shrink-0 mt-px" />
                    Este producto tiene cambios sin guardar. Las variantes se arman con los modelos que se venden guardados: guardá primero si marcaste modelos nuevos.
                </div>
            )}

            {!padre.moldeRef && (
                <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    <Info size={14} className="shrink-0 mt-px text-brand-cyan" />
                    Para tener variantes, vinculá el molde en "Molde, telas y apliques", marcá los modelos que se venden y guardá.
                </div>
            )}

            {variantes.length > 0 && (
                <div className="space-y-2">
                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Variantes ({variantes.length})</div>
                    {variantes.map(v => (
                        <div key={v.proId} className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div className="min-w-[220px] flex-1">
                                <div className="text-sm font-black text-slate-800 break-words">{v.descripcion}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                                    <span className="font-mono">{v.codArticulo}</span>
                                    <span>·</span>
                                    <span className="font-bold text-slate-700">{fmtPrecio(v.precio, v.moneda)}</span>
                                    {!v.modeloOfrecido && <span className="font-bold text-amber-700">· el modelo ya no se vende en el padre</span>}
                                </div>
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${v.estado === 'PUBLICADO' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{v.estado === 'PUBLICADO' ? 'Publicado' : 'Borrador'}</span>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setBorrando(v)} title="Borrar esta variante (antes se revisa que no se haya usado)"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-rose-400 hover:text-rose-600">
                                    <Trash2 size={13} /> Borrar
                                </button>
                                <button type="button" onClick={() => onEditar?.(v.proId)} title="Abrir la variante en el editor"
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-cyan/90">
                                    <Pencil size={13} /> Editar
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {modelosSinVariante.length > 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Modelos que se venden sin variante ({modelosSinVariante.length})</div>
                        {modelosSinVariante.length > 1 && (
                            <button type="button" disabled={!!creando} onClick={() => crear(modelosSinVariante.map(m => m.modeloClave))}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-cyan/90 disabled:opacity-50">
                                <Plus size={13} /> {creando === 'todas' ? 'Creando…' : `Crear las ${modelosSinVariante.length} variantes`}
                            </button>
                        )}
                    </div>
                    {modelosSinVariante.map(m => (
                        <div key={m.modeloClave} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-sm font-bold text-slate-700">{m.modeloNombre || m.modeloClave}</span>
                            <button type="button" disabled={!!creando} onClick={() => crear([m.modeloClave])}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-cyan px-3 py-1.5 text-xs font-bold text-brand-cyan hover:bg-brand-cyan/5 disabled:opacity-50">
                                <Plus size={13} /> {creando === m.modeloClave ? 'Creando…' : 'Crear variante'}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {padre.moldeRef && !variantes.length && !modelosSinVariante.length && (
                <p className="text-sm text-slate-500">No hay modelos marcados en "Modelos que se venden". Marcalos en "Molde, telas y apliques" y guardá.</p>
            )}

            {borrando && BorrarModal && (
                <BorrarModal form={{ proId: borrando.proId, descripcion: borrando.descripcion, codArticulo: borrando.codArticulo, esCombo: false }}
                    onClose={() => setBorrando(null)}
                    onBorrado={async (d) => { setBorrando(null); toast.success(`🗑 Variante borrada: ${d.codArticulo}`); await cargar(); onCambio?.(); }} />
            )}
        </div>
    );
}
