import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowRight, ArrowLeft, Camera, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { fileControlService } from '../../../services/modules/fileControlService';

/**
 * Spec 39 — Reportar falla o faltante desde la bandeja (EMB / EST / TWC / TWT), en tres pasos:
 *   1. Lo pendiente del pedido según el libro: "¿lo que te falta es esto?" (si es eso, no se crea nada)
 *   2. Qué falta: tipo, cantidad, archivo de origen, detalle de piezas, motivo, nota, foto
 *   3. Reposiciones propuestas: cadena hacia atrás (o falla propia) — o la solicitud de insumo
 *      cuando lo dañado es del cliente o del local (no nace ninguna orden).
 */
export default function ReportarFallaModal({ open, onClose, orden, area, service, onDone }) {
    const [step, setStep] = useState(1);
    const [cargando, setCargando] = useState(false);
    const [pend, setPend] = useState(null);           // paso 1: { anteriores, ordenes, cadenaHabilitada, orden }
    const [tipos, setTipos] = useState([]);
    const [form, setForm] = useState({ tipo: 'FALLA_PROPIA', cantidad: '', motivoId: '', motivoTexto: '', nota: '', archivoOrigenId: '', piezas: [], foto: null });
    const [propuesta, setPropuesta] = useState(null); // paso 3: { eslabones, origenInsumo, stock }
    const [enviando, setEnviando] = useState(false);

    // La cantidad que se reporta acá SIEMPRE son prendas (cuántas piezas fallaron/faltan) —
    // nunca la unidad técnica de producción de la orden (Bordado factura por "punt" de
    // puntadas, Estampado por "baj" de bajadas: eso no es algo que el operario cuenta al
    // reportar una falla, y preguntarlo así no tiene sentido). Este modal es EXCLUSIVO de
    // las 4 áreas de bandeja (EMB/EST/TWC/TWT), todas cuentan por prenda.
    const um = 'prendas';
    const hayAnteriores = !!(pend && pend.anteriores && pend.anteriores.length);
    const puedeFaltante = hayAnteriores && !!pend?.cadenaHabilitada;
    // Cuánto se puede reportar como falla PROPIA: lo que ya está trabajado en esta orden y
    // todavía no salió en una tanda aprobada (no se puede reportar como fallado algo que ya
    // se despachó). null = el área no cuenta unidades (ej. Sublimación mide metros): sin tope.
    const maxFallaPropia = pend?.orden?.maxFallaPropia;
    // Spec 39: en Bordado/Corte/Costura no hay prenda de repuesto en stock — una falla
    // PROPIA reportada acá también arma la cadena completa hacia atrás (igual que un
    // faltante), porque si rompió/perdió la prenda física hay que fabricar una nueva. Solo
    // aplica si este pedido realmente tiene áreas anteriores (un combo "Comprar y
    // personalizar" puede llegar directo desde un producto ya armado, sin tela/corte/costura
    // detrás — ahí se queda como siempre, una orden nueva en esta misma área).
    const fallaPropiaUsaCadena = !!pend?.fallaPropiaUsaCadena && hayAnteriores;
    const usaCadena = form.tipo === 'FALTANTE' || (form.tipo === 'FALLA_PROPIA' && fallaPropiaUsaCadena);

    useEffect(() => {
        if (!open || !orden) return;
        setStep(1); setPropuesta(null);
        setForm({ tipo: 'FALLA_PROPIA', cantidad: '', motivoId: '', motivoTexto: '', nota: '', archivoOrigenId: '', piezas: [], foto: null });
        setCargando(true);
        Promise.all([service.getFallaPendientes(orden.OrdenID), fileControlService.getTiposFalla(area).catch(() => [])])
            .then(([p, t]) => {
                setPend(p);
                setTipos(Array.isArray(t) ? t : []);
                // Por defecto, "cuánto falta" arranca en el máximo reportable (de acuerdo al
                // caso: lo trabajado sin despachar) — el operario lo baja si solo una parte
                // está realmente dañada.
                if (p?.orden?.maxFallaPropia != null) setForm(f => ({ ...f, cantidad: String(p.orden.maxFallaPropia) }));
                if (!p?.anteriores?.length) setStep(2);
            })
            .catch(e => { toast.error('No se pudo cargar lo pendiente del pedido: ' + (e?.response?.data?.error || e.message)); setPend({ anteriores: [], ordenes: [] }); setStep(2); })
            .finally(() => setCargando(false));
    }, [open, orden?.OrdenID]);

    const archivosOrigen = useMemo(() => (pend?.ordenes || []).flatMap(o => (o.archivos || []).map(a => ({ ...a, codigoOrden: o.CodigoOrden, area: o.AreaID }))), [pend]);
    const set = (patch) => setForm(f => ({ ...f, ...patch }));

    const onFoto = (file) => {
        if (!file) return set({ foto: null });
        const reader = new FileReader();
        reader.onload = () => set({ foto: reader.result });
        reader.readAsDataURL(file);
    };

    const esLoPendiente = async () => {
        try { await service.fallaEsLoPendiente(orden.OrdenID); } catch (_) { /* solo auditoría */ }
        toast.success('No se creó ninguna reposición: lo que falta ya está en camino o en producción.');
        onClose();
    };

    const irAPropuesta = async () => {
        if (!(Number(form.cantidad) > 0)) return toast.error('Indicá cuánto falta.');
        if (!form.motivoId && !form.motivoTexto.trim()) return toast.error('Indicá el motivo.');
        if (usaCadena && archivosOrigen.length > 0 && !form.archivoOrigenId) return toast.error('Elegí de qué archivo del área anterior viene lo que falta.');
        setCargando(true);
        try {
            const p = await service.fallaProponer(orden.OrdenID, { tipo: form.tipo, cantidad: Number(form.cantidad) });
            setPropuesta({ ...p, eslabones: (p.eslabones || []).map(e => ({ ...e })) });
            setStep(3);
        } catch (e) { toast.error(e?.response?.data?.error || e.message); }
        finally { setCargando(false); }
    };

    const confirmar = async () => {
        if (!propuesta) return;
        setEnviando(true);
        try {
            const res = await service.reportarFalla(orden.OrdenID, {
                tipo: form.tipo, cantidad: Number(form.cantidad), motivoId: form.motivoId || null, motivoTexto: form.motivoTexto || null,
                nota: form.nota || null, imagenBase64: form.foto || null, archivoOrigenId: form.archivoOrigenId || null,
                detallePiezas: form.piezas.filter(p => Number(p.cantidad) > 0),
                eslabones: propuesta.eslabones.map(e => ({ area: e.area, ordenMadreId: e.ordenMadreId, cantidad: e.cuentaUnidades ? Number(e.cantidad) : null })),
            });
            toast.success(res.message || 'Reporte registrado.', { duration: 9000 });
            onDone?.(res);
            onClose();
        } catch (e) { toast.error(e?.response?.data?.error || e.message); }
        finally { setEnviando(false); }
    };

    if (!open || !orden) return null;
    const codigo = orden.CodigoOrden;
    const Steps = () => (
        <div className="flex gap-1.5 text-[10px] font-black uppercase tracking-wide">
            {[['1', 'Lo pendiente'], ['2', 'Qué falta'], ['3', 'Reposiciones']].map(([n, t]) => (
                <span key={n} className={`px-2 py-0.5 rounded-full ${String(step) === n ? 'bg-[#BD0C7E] text-white' : 'bg-zinc-100 text-zinc-400'}`}>{n} · {t}</span>
            ))}
        </div>
    );

    return (
        <div className="fixed inset-0 z-[1400] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-pink-200 bg-pink-50">
                    <h3 className="font-black text-sm text-[#BD0C7E] uppercase">Reportar falla o faltante · {codigo}</h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><X size={18} /></button>
                </div>
                <div className="p-5 overflow-y-auto flex-1 space-y-4 text-sm">
                    <Steps />
                    {cargando && <div className="flex items-center gap-2 text-zinc-500 text-xs"><Loader2 size={14} className="animate-spin" /> Cargando...</div>}

                    {step === 1 && pend && (
                        <>
                            <p className="text-zinc-700">Antes de reportar, así está <b>cada área anterior a {area}</b> en este pedido, según el libro de entregas:</p>
                            <div className="border border-amber-200 rounded-xl overflow-hidden">
                                <div className="bg-amber-100 text-amber-800 text-[10px] font-black uppercase px-3 py-1.5">Pedido {pend.noDocERP} · estado de las órdenes anteriores</div>
                                {pend.ordenes.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">Nada pendiente: todo lo de las áreas anteriores ya llegó.</div>}
                                {pend.ordenes.map(o => (
                                    <div key={o.OrdenID} className="grid grid-cols-[1.2fr_1fr_auto] gap-3 items-center px-3 py-2 border-t border-amber-100 text-xs bg-white">
                                        <div>
                                            <span className="font-bold text-brand-cyan">{o.CodigoOrden}</span> <span className="text-zinc-500">· {o.AreaID}</span>
                                            <div className="text-zinc-600">Recibido {o.recibido.envios ? `${o.recibido.envios} envío(s), ${o.recibido.bultos} bulto(s)${o.recibido.cantidad != null ? `, ${o.recibido.cantidad} ${(o.UM || '').trim()}` : ''}` : 'nada todavía'}</div>
                                        </div>
                                        <div className="text-zinc-600">
                                            {o.reposicionesAbiertas.map((r, i) => <div key={i}>Reposición <span className="font-mono font-bold">{r.CodigoFalla || '(sin orden)'}</span> · {r.descripcion}</div>)}
                                            {o.enCamino.map((e, i) => <div key={'c' + i}>En camino: remito {e.remito}{e.cantidad != null ? ` · ${e.cantidad}` : ''}</div>)}
                                            {o.estadoEnvio === 'PARCIAL' && !o.reposicionesAbiertas.length && !o.enCamino.length && <div>Envío parcial: el resto sigue en producción en {o.AreaID}</div>}
                                            {!o.incompleta && <div>Sin pendientes</div>}
                                        </div>
                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${o.incompleta ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{o.incompleta ? 'En camino' : 'Completo'}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="font-bold text-zinc-800">¿Lo que te falta es esto?</p>
                            <div className="flex justify-end gap-2">
                                <button onClick={esLoPendiente} className="px-4 py-2 rounded-lg border border-zinc-200 font-bold text-zinc-600 hover:bg-zinc-50">Sí, es esto · no reportar</button>
                                <button onClick={() => setStep(2)} className="px-4 py-2 rounded-lg bg-[#BD0C7E] text-white font-bold hover:brightness-110 flex items-center gap-1">No, es otra cosa <ArrowRight size={14} /></button>
                            </div>
                        </>
                    )}

                    {step === 2 && (
                        <>
                            <div>
                                <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">Tipo</div>
                                <div className="flex gap-2 flex-wrap">
                                    <button onClick={() => set({ tipo: 'FALLA_PROPIA', cantidad: maxFallaPropia != null ? String(maxFallaPropia) : form.cantidad })} className={`px-3 py-2 rounded-lg border font-bold ${form.tipo === 'FALLA_PROPIA' ? 'border-[#BD0C7E] text-[#BD0C7E] bg-pink-50' : 'border-zinc-200 text-zinc-600'}`}>{fallaPropiaUsaCadena ? 'Falla en esta área (rompimos la prenda)' : 'Falla en esta área (lo arruinamos acá)'}</button>
                                    <button onClick={() => puedeFaltante && set({ tipo: 'FALTANTE' })} disabled={!puedeFaltante} title={!hayAnteriores ? 'Este pedido no tiene áreas anteriores' : (!pend?.cadenaHabilitada ? 'La cadena de reposición no está habilitada para esta área' : '')} className={`px-3 py-2 rounded-lg border font-bold ${form.tipo === 'FALTANTE' ? 'border-[#BD0C7E] text-[#BD0C7E] bg-pink-50' : 'border-zinc-200 text-zinc-600'} disabled:opacity-40 disabled:cursor-not-allowed`}>Faltante de insumo (vino mal o no vino)</button>
                                </div>
                                {form.tipo === 'FALLA_PROPIA' && fallaPropiaUsaCadena && (
                                    <p className="text-xs text-zinc-500 mt-1">Acá no hay prenda de repuesto en stock: si se rompió/perdió, hay que fabricar una nueva desde cero. La reposición nace en el área que produce el insumo ({pend?.anteriores?.join(' → ')}) y llega hasta acá. De {area} en adelante no se crea ninguna orden.</p>
                                )}
                                {form.tipo === 'FALTANTE' && <p className="text-xs text-zinc-500 mt-1">La reposición nace en el área que produce el insumo ({pend?.anteriores?.join(' → ')}) y llega hasta acá. De {area} en adelante no se crea ninguna orden.</p>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">
                                        Cantidad que falta ({um}){form.tipo === 'FALLA_PROPIA' && maxFallaPropia != null && <span className="text-zinc-400 normal-case font-bold"> · máx. {maxFallaPropia}</span>}
                                    </div>
                                    <input
                                        type="number" min="0" step="1"
                                        max={form.tipo === 'FALLA_PROPIA' ? maxFallaPropia ?? undefined : undefined}
                                        value={form.cantidad}
                                        onChange={e => {
                                            let v = e.target.value;
                                            if (form.tipo === 'FALLA_PROPIA' && maxFallaPropia != null && v !== '' && Number(v) > maxFallaPropia) v = String(maxFallaPropia);
                                            set({ cantidad: v });
                                        }}
                                        className="w-full p-2 border border-zinc-200 rounded-lg font-mono font-bold"
                                        placeholder={`p. ej. 5 ${um}`}
                                    />
                                    {form.tipo === 'FALLA_PROPIA' && maxFallaPropia != null && (
                                        <p className="text-[10px] text-zinc-400 mt-1">No podés reportar más de lo que tenés en mano sin despachar todavía.</p>
                                    )}
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">Motivo</div>
                                    <select value={form.motivoId} onChange={e => set({ motivoId: e.target.value })} className="w-full p-2 border border-zinc-200 rounded-lg bg-white font-bold">
                                        <option value="">Seleccioná o escribí abajo...</option>
                                        {tipos.map(t => <option key={t.FallaID} value={t.FallaID}>{t.Titulo}</option>)}
                                    </select>
                                    <input value={form.motivoTexto} onChange={e => set({ motivoTexto: e.target.value })} className="w-full p-2 border border-zinc-200 rounded-lg mt-1" placeholder="Otro motivo (texto libre)" />
                                </div>
                            </div>
                            {usaCadena && archivosOrigen.length > 0 && (
                                <div>
                                    <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">De qué archivo del área anterior viene</div>
                                    <select value={form.archivoOrigenId} onChange={e => set({ archivoOrigenId: e.target.value })} className="w-full p-2 border border-[#BD0C7E]/40 rounded-lg bg-white font-bold">
                                        <option value="">Elegí el archivo...</option>
                                        {archivosOrigen.map(a => <option key={a.ArchivoID} value={a.ArchivoID}>{a.codigoOrden} · {a.NombreArchivo}{a.Metros ? ` · ${a.Metros} m` : ''}{a.Piezas ? ` · ${a.Piezas} piezas` : ''}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <div className="text-[10px] font-black uppercase text-zinc-500">Detalle de piezas (cantidad · parte · talle)</div>
                                    <button onClick={() => set({ piezas: [...form.piezas, { cantidad: '', parte: '', talle: '' }] })} className="text-xs font-bold text-brand-cyan flex items-center gap-1"><Plus size={12} /> Agregar</button>
                                </div>
                                {form.piezas.map((p, i) => (
                                    <div key={i} className="grid grid-cols-[80px_1fr_100px_auto] gap-2 mb-1">
                                        <input type="number" min="0" value={p.cantidad} onChange={e => set({ piezas: form.piezas.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x) })} className="p-2 border border-zinc-200 rounded-lg font-mono" placeholder="3" />
                                        <input value={p.parte} onChange={e => set({ piezas: form.piezas.map((x, j) => j === i ? { ...x, parte: e.target.value } : x) })} className="p-2 border border-zinc-200 rounded-lg" placeholder="delantero" />
                                        <input value={p.talle} onChange={e => set({ piezas: form.piezas.map((x, j) => j === i ? { ...x, talle: e.target.value } : x) })} className="p-2 border border-zinc-200 rounded-lg" placeholder="L" />
                                        <button onClick={() => set({ piezas: form.piezas.filter((_, j) => j !== i) })} className="text-zinc-400 hover:text-rose-500"><Trash2 size={14} /></button>
                                    </div>
                                ))}
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">Nota</div>
                                <textarea value={form.nota} onChange={e => set({ nota: e.target.value })} rows={2} className="w-full p-2 border border-zinc-200 rounded-lg" placeholder="Manchas en 5 piezas delanteras, talles L y XL" />
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase text-zinc-500 mb-1">Foto (opcional)</div>
                                <label className="inline-flex items-center gap-2 px-3 py-2 border border-dashed border-zinc-300 rounded-lg cursor-pointer text-zinc-600 hover:bg-zinc-50">
                                    <Camera size={14} /> {form.foto ? 'Foto adjunta · cambiar' : 'Sacar o adjuntar foto'}
                                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onFoto(e.target.files?.[0])} />
                                </label>
                                {form.foto && <img src={form.foto} alt="foto" className="mt-2 max-h-32 rounded-lg border border-zinc-200" />}
                            </div>
                            <div className="flex justify-between gap-2 pt-2">
                                <button onClick={() => hayAnteriores ? setStep(1) : onClose()} className="px-4 py-2 rounded-lg border border-zinc-200 font-bold text-zinc-600 flex items-center gap-1"><ArrowLeft size={14} /> Atrás</button>
                                <button onClick={irAPropuesta} disabled={cargando} className="px-4 py-2 rounded-lg bg-[#BD0C7E] text-white font-bold hover:brightness-110 flex items-center gap-1 disabled:opacity-50">Ver reposiciones propuestas <ArrowRight size={14} /></button>
                            </div>
                        </>
                    )}

                    {step === 3 && propuesta && (
                        <>
                            {propuesta.origenInsumo !== 'PROPIO' ? (
                                <div className="space-y-3">
                                    <div className="bg-pink-50 border border-pink-200 rounded-xl p-3 text-[#8a0a5c]">
                                        <div className="flex items-center gap-2 font-black text-xs uppercase"><AlertTriangle size={14} /> Origen del insumo detectado: {propuesta.origenInsumo.replace('_', ' ')}</div>
                                        <p className="text-xs mt-1">Producción no puede reponer esto. <b>No se crea ninguna orden</b>: se abre una solicitud para Atención al Cliente y Administración, que informan al cliente y registran su decisión. {codigo} queda retenida mientras tanto.</p>
                                    </div>
                                    {propuesta.stock && (
                                        <div className={`rounded-xl p-3 border text-xs ${propuesta.stock.encontrado?.length ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-zinc-50 border-zinc-200 text-zinc-600'}`}>
                                            <b>Stock de este insumo del cliente:</b> {propuesta.stock.resumen}
                                            {propuesta.stock.encontrado?.slice(0, 4).map((s, i) => <div key={i}>· {s.CodigoEtiqueta || s.CodigoRecepcion} {s.MetrosRestantes != null ? `${Number(s.MetrosRestantes).toFixed(2)} m` : `${s.CantidadDisponible} u`}{s.AreaID ? ` · ${s.AreaID}` : ''}</div>)}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <p className="text-zinc-700">El sistema propone esta cadena. Podés ajustar las cantidades donde se cuentan prendas.</p>
                                    {propuesta.eslabones.map((e, i) => (
                                        <div key={i} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center border border-zinc-200 rounded-xl px-3 py-2 bg-white">
                                            <CheckCircle2 size={16} className="text-brand-cyan" />
                                            <div>
                                                <div className="text-[10px] font-black uppercase text-brand-cyan">{e.area}</div>
                                                <div className="text-xs"><span className="font-mono font-bold">{e.codigoMadre}</span> → nace la orden de falla {i === 0 ? 'primero' : `cuando llegue la de ${propuesta.eslabones[i - 1].area}`}</div>
                                                <div className="text-[11px] text-zinc-500">{e.nota}</div>
                                            </div>
                                            {e.cuentaUnidades ? (
                                                <input type="number" min="0" value={e.cantidad ?? ''} onChange={ev => setPropuesta(p => ({ ...p, eslabones: p.eslabones.map((x, j) => j === i ? { ...x, cantidad: ev.target.value } : x) }))} className="w-24 p-1.5 border border-zinc-200 rounded-lg font-mono font-bold text-right" />
                                            ) : <span className="text-[10px] font-black text-zinc-400 uppercase">sin metros</span>}
                                        </div>
                                    ))}
                                    <div className="border border-dashed border-zinc-200 rounded-xl px-3 py-2 bg-zinc-50 text-xs">
                                        <div className="text-[10px] font-black uppercase text-zinc-400">{area}</div>
                                        Sin orden nueva. <b>{codigo}</b> queda Retenida y sigue con lo que tiene.
                                    </div>
                                    <div className="text-xs text-emerald-700 font-bold">✔ De {area} en adelante no se crea ninguna orden.</div>
                                </div>
                            )}
                            <div className="flex justify-between gap-2 pt-2">
                                <button onClick={() => setStep(2)} className="px-4 py-2 rounded-lg border border-zinc-200 font-bold text-zinc-600 flex items-center gap-1"><ArrowLeft size={14} /> Atrás</button>
                                <button onClick={confirmar} disabled={enviando} className="px-4 py-2 rounded-lg bg-[#BD0C7E] text-white font-bold hover:brightness-110 disabled:opacity-50">
                                    {enviando ? 'Registrando...' : (propuesta.origenInsumo !== 'PROPIO' ? `Abrir solicitud y retener ${codigo}` : `Crear ${propuesta.eslabones.length} reposición(es) y retener ${codigo}`)}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
