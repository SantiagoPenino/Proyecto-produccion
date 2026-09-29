import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, PackageMinus, Package, AlertTriangle, Pencil, Check, X } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import { fmtFecha, fmtPlata, fmtCantidad, mensajeError } from './constantes';
import { label, input, btn, btnPri, btnCancelar, MiniModal } from './ui';

// Insumos y repuestos del stock propio (/stock) — etapa 4 de Servicio Técnico. Cada uso se descuenta
// del depósito elegido como consumo (en /stock suma en el gasto por sector) y queda acá con fecha,
// costo y a qué solicitud / trabajo / proyecto / máquina fue.

const unidadTexto = (u) => ({ uni: 'u.', mts: 'm', rollos: 'rollos', kg: 'kg', lts: 'l' }[String(u || '').toLowerCase()] || u || '');

// ── Ventana: registrar un insumo usado ───────────────────────────────────────
// contexto: { solId, trabId, proyId, equipoId, titulo } (a qué va el uso)
export const ModalUsoInsumo = ({ contexto = {}, onGuardado, onCerrar }) => {
    const [config, setConfig] = useState(null);
    const [dep, setDep] = useState('');
    const [q, setQ] = useState('');
    const [stock, setStock] = useState(null);
    const [elegido, setElegido] = useState(null);
    const [cantidad, setCantidad] = useState('1');
    const [nota, setNota] = useState('');
    const [falta, setFalta] = useState(null); // aviso de stock insuficiente → "usar igual"
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        servicioTecnicoService.insumosConfig().then((c) => {
            setConfig(c);
            if (c.deposito?.id) setDep(String(c.deposito.id));
        }).catch((e) => toast.error(mensajeError(e)));
    }, []);
    useEffect(() => {
        if (!dep) { setStock(null); return undefined; }
        const t = setTimeout(() => {
            servicioTecnicoService.stockInsumos(dep, q.trim()).then(setStock).catch((e) => { toast.error(mensajeError(e)); setStock([]); });
        }, 250);
        return () => clearTimeout(t);
    }, [dep, q]);

    const porUnidad = String(elegido?.Unidad || '').toLowerCase() === 'uni';
    const cant = Number(String(cantidad).replace(',', '.'));
    const valido = elegido && cant > 0 && (!porUnidad || Number.isInteger(cant));

    const guardar = async (forzar = false) => {
        setGuardando(true);
        try {
            const r = await servicioTecnicoService.registrarUso({
                varId: elegido.VarId, depId: dep, cantidad: cant, nota: nota.trim() || undefined, forzar,
                solId: contexto.solId, trabId: contexto.trabId, proyId: contexto.proyId, equipoId: contexto.equipoId,
            });
            toast.success(`Registrado: ${fmtCantidad(cant)} ${unidadTexto(elegido.Unidad)} de ${elegido.Producto}${r.CostoTotal != null ? ` (${fmtPlata(r.CostoTotal, r.Moneda)})` : ''}`,
                { description: r.Faltante ? `Faltaron ${fmtCantidad(r.Faltante)} en el depósito: quedó como diferencia en /stock.` : undefined });
            onGuardado?.(r);
        } catch (e) {
            if (e?.response?.status === 409 && e.response.data?.faltaStock) setFalta(e.response.data.error);
            else toast.error(mensajeError(e));
        } finally { setGuardando(false); }
    };

    return (
        <MiniModal titulo={`Usar insumo${contexto.titulo ? ` · ${contexto.titulo}` : ''}`} ancho="max-w-2xl" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            {falta ? (
                <button onClick={() => guardar(true)} disabled={guardando} className={`${btn} bg-amber-600 text-white hover:bg-amber-700`}>
                    {guardando ? <Loader2 size={15} className="animate-spin" /> : <AlertTriangle size={15} />} Usar igual
                </button>
            ) : (
                <button onClick={() => guardar(false)} disabled={!valido || guardando} className={btnPri}>
                    {guardando ? <Loader2 size={15} className="animate-spin" /> : <PackageMinus size={15} />} Registrar uso
                </button>
            )}
        </>}>
            {!config ? <div className="py-8 text-center text-zinc-400"><Loader2 className="inline animate-spin" /></div> : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                            <span className={label}>Sale del depósito</span>
                            <select className={input} value={dep} onChange={(e) => { setDep(e.target.value); setElegido(null); setFalta(null); }}>
                                <option value="">— Elegir —</option>
                                {config.depositos.map(d => <option key={d.DepId} value={d.DepId}>{d.Nombre}{config.deposito?.id === d.DepId ? ' (Servicio Técnico)' : ''}</option>)}
                            </select>
                        </div>
                        <div>
                            <span className={label}>Buscar</span>
                            <div className="relative">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                                <input className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o código" disabled={!dep} />
                            </div>
                        </div>
                    </div>
                    {!config.deposito && <p className="text-xs text-amber-700">Todavía no se eligió el depósito de Servicio Técnico (lo elige un Admin en la sección Insumos).</p>}
                    {dep && (
                        <div className="border border-zinc-200 rounded-xl max-h-60 overflow-y-auto divide-y divide-zinc-100">
                            {!stock ? <div className="py-6 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={18} /></div>
                                : stock.length === 0 ? <div className="py-6 text-center text-sm text-zinc-400">No hay stock{q ? ' con esa búsqueda' : ''} en este depósito.</div>
                                : stock.map(s => (
                                    <button key={s.VarId} type="button" onClick={() => { setElegido(s); setFalta(null); }}
                                        className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-brand-cyan/5 ${elegido?.VarId === s.VarId ? 'bg-brand-cyan/10' : ''}`}>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-bold text-zinc-800 truncate">{s.Producto}</span>
                                            {s.NombreVariante && s.NombreVariante !== s.Producto && <span className="block text-xs text-zinc-500 truncate">{s.NombreVariante}</span>}
                                        </span>
                                        <span className="text-xs text-zinc-500 shrink-0 text-right">
                                            <b className="text-zinc-700">{fmtCantidad(s.Stock)}</b> {unidadTexto(s.Unidad)}
                                            {s.Costo != null && <span className="block text-zinc-400">{fmtPlata(s.Costo, s.Moneda)} c/u</span>}
                                        </span>
                                    </button>
                                ))}
                        </div>
                    )}
                    {elegido && (
                        <div className="grid grid-cols-[130px_1fr] gap-2 items-end">
                            <div><span className={label}>Cantidad ({unidadTexto(elegido.Unidad)})</span>
                                <input className={input} inputMode="decimal" value={cantidad} autoFocus onChange={(e) => { setCantidad(e.target.value); setFalta(null); }} /></div>
                            <div><span className={label}>Nota <span className="normal-case font-bold text-zinc-300">(opcional)</span></span>
                                <input className={input} value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} placeholder="Ej: se cambió el de la izquierda" /></div>
                        </div>
                    )}
                    {elegido && porUnidad && cant > 0 && !Number.isInteger(cant) && <p className="text-xs text-red-600">Se cuenta por unidad: la cantidad tiene que ser entera.</p>}
                    {falta && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{falta}</p>}
                </>
            )}
        </MiniModal>
    );
};

// ── Lista de insumos usados en una solicitud / trabajo / proyecto ────────────
export const InsumosUsados = ({ filtro, version = 0, puedeUsar = false, contexto = {}, onCambio }) => {
    const [usos, setUsos] = useState(null);
    const [modal, setModal] = useState(false);
    const cargar = useCallback(async () => {
        try { setUsos(await servicioTecnicoService.usosInsumos(filtro)); } catch (_) { setUsos([]); }
    }, [JSON.stringify(filtro)]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { cargar(); }, [cargar, version]);
    const totales = (usos || []).reduce((t, u) => { if (u.CostoTotal != null) t[u.Moneda || 'UYU'] = (t[u.Moneda || 'UYU'] || 0) + Number(u.CostoTotal); return t; }, {});
    return (
        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Insumos usados ({usos?.length ?? '…'})</span>
                {puedeUsar && <button onClick={() => setModal(true)} className={`${btn} py-1 text-xs text-brand-cyan hover:bg-brand-cyan/10`}><PackageMinus size={14} /> Usar insumo</button>}
            </div>
            {!usos ? null : usos.length === 0 ? <p className="text-sm text-zinc-400">Ninguno.</p> : (
                <ul className="divide-y divide-zinc-100">
                    {usos.map(u => (
                        <li key={u.UsoId} className="py-1.5 flex items-start gap-3 text-sm">
                            <span className="min-w-0 flex-1">
                                <span className="font-bold text-zinc-800">{fmtCantidad(u.Cantidad)} {unidadTexto(u.Unidad)}</span> <span className="text-zinc-700">{u.Nombre}</span>
                                <span className="block text-[11px] text-zinc-400">{fmtFecha(u.Fecha)} · {u.UsuarioNombre} · de {u.Deposito}{u.Nota ? ` · ${u.Nota}` : ''}{u.Faltante ? ` · faltaron ${fmtCantidad(u.Faltante)}` : ''}</span>
                            </span>
                            {u.CostoTotal != null && <span className="text-xs font-bold text-zinc-600 shrink-0">{fmtPlata(u.CostoTotal, u.Moneda)}</span>}
                        </li>
                    ))}
                </ul>
            )}
            {Object.keys(totales).length > 0 && (
                <p className="mt-2 text-xs text-zinc-500 text-right">Total: <b>{Object.entries(totales).map(([m, n]) => fmtPlata(n, m)).join(' + ')}</b></p>
            )}
            {modal && <ModalUsoInsumo contexto={contexto} onCerrar={() => setModal(false)} onGuardado={() => { setModal(false); cargar(); onCambio?.(); }} />}
        </div>
    );
};

// ── Sección Insumos: stock del depósito de Servicio Técnico + historial de usos ──
const InsumosVista = ({ meta }) => {
    const [tab, setTab] = useState('stock');
    const [config, setConfig] = useState(null);
    const [dep, setDep] = useState('');
    const [q, setQ] = useState('');
    const [stock, setStock] = useState(null);
    const [usos, setUsos] = useState(null);
    const [filtroUsos, setFiltroUsos] = useState({ desde: '', hasta: '', q: '' });
    const [usar, setUsar] = useState(null);
    const [eligiendo, setEligiendo] = useState(false);
    const [depElegido, setDepElegido] = useState('');

    const cargarConfig = useCallback(async () => {
        try {
            const c = await servicioTecnicoService.insumosConfig();
            setConfig(c);
            setDep((d) => d || (c.deposito?.id ? String(c.deposito.id) : ''));
        } catch (e) { toast.error(mensajeError(e)); }
    }, []);
    useEffect(() => { cargarConfig(); }, [cargarConfig]);

    const cargarStock = useCallback(async () => {
        if (!dep) { setStock(null); return; }
        try { setStock(await servicioTecnicoService.stockInsumos(dep, q.trim())); } catch (e) { toast.error(mensajeError(e)); setStock([]); }
    }, [dep, q]);
    const cargarUsos = useCallback(async () => {
        try { setUsos(await servicioTecnicoService.usosInsumos({ desde: filtroUsos.desde || undefined, hasta: filtroUsos.hasta || undefined, q: filtroUsos.q.trim() || undefined })); }
        catch (e) { toast.error(mensajeError(e)); setUsos([]); }
    }, [filtroUsos]);
    useEffect(() => { const t = setTimeout(cargarStock, 250); return () => clearTimeout(t); }, [cargarStock]);
    useEffect(() => { if (tab === 'usos') { const t = setTimeout(cargarUsos, 250); return () => clearTimeout(t); } return undefined; }, [tab, cargarUsos]);
    const recargarRef = useRef(null);
    recargarRef.current = () => { cargarStock(); if (tab === 'usos') cargarUsos(); };
    const avisar = useRecargaConFreno(() => recargarRef.current());
    useEffect(() => {
        socket.on('st:updated', avisar);
        return () => socket.off('st:updated', avisar);
    }, [avisar]);

    const guardarDeposito = async () => {
        try {
            await servicioTecnicoService.setDepositoInsumos(depElegido || null);
            toast.success('Depósito de Servicio Técnico guardado');
            setEligiendo(false);
            setDep(depElegido);
            cargarConfig();
        } catch (e) { toast.error(mensajeError(e)); }
    };

    const totalesUsos = (usos || []).reduce((t, u) => { if (u.CostoTotal != null) t[u.Moneda || 'UYU'] = (t[u.Moneda || 'UYU'] || 0) + Number(u.CostoTotal); return t; }, {});
    const sel = 'px-3 py-2 border border-zinc-200 rounded-xl text-sm text-zinc-700 bg-white outline-none focus:border-brand-cyan';

    return (
        <div>
            {/* Depósito de Servicio Técnico */}
            {config && (
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                    <span className="font-bold text-zinc-400 uppercase text-[11px] tracking-wide">Depósito de Servicio Técnico:</span>
                    {eligiendo ? (
                        <>
                            <select className={sel} value={depElegido} onChange={(e) => setDepElegido(e.target.value)}>
                                <option value="">— Ninguno —</option>
                                {config.depositos.map(d => <option key={d.DepId} value={d.DepId}>{d.Nombre}</option>)}
                            </select>
                            <button onClick={guardarDeposito} className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-cyan text-white"><Check size={16} /></button>
                            <button onClick={() => setEligiendo(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><X size={16} /></button>
                        </>
                    ) : (
                        <>
                            <span className="font-bold text-zinc-700">{config.deposito?.nombre || 'Sin elegir'}</span>
                            {config.deposito && config.deposito.origen !== 'pantalla' && <span className="text-xs text-zinc-400">({config.deposito.origen})</span>}
                            {config.puedeElegir && (
                                <button onClick={() => { setDepElegido(config.deposito?.origen === 'pantalla' ? String(config.deposito.id) : ''); setEligiendo(true); }}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-brand-cyan" title="Elegir depósito"><Pencil size={14} /></button>
                            )}
                            {!config.deposito && <span className="text-xs text-zinc-400">Crealo en /stock → Gestión → Almacenes y sectores (tipo Sector) y elegilo acá.</span>}
                        </>
                    )}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-3">
                {[['stock', 'Stock'], ['usos', 'Usos']].map(([k, t]) => (
                    <button key={k} onClick={() => setTab(k)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${tab === k ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-100'}`}>{t}</button>
                ))}
                <button onClick={() => setUsar({})} className={`${btnPri} ml-auto`}><PackageMinus size={16} /> Usar insumo</button>
            </div>

            {tab === 'stock' ? (
                <>
                    <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-3 flex flex-wrap gap-2 items-center">
                        <select className={sel} value={dep} onChange={(e) => setDep(e.target.value)}>
                            <option value="">— Depósito —</option>
                            {(config?.depositos || []).map(d => <option key={d.DepId} value={d.DepId}>{d.Nombre}</option>)}
                        </select>
                        <div className="relative flex-1 min-w-[180px]">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar insumo…" className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-xl text-sm outline-none focus:border-brand-cyan" />
                        </div>
                    </div>
                    {!dep ? <div className="py-12 text-center text-sm text-zinc-400">Elegí un depósito.</div>
                        : !stock ? <div className="py-12 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={20} /></div>
                        : stock.length === 0 ? <div className="py-12 text-center text-sm text-zinc-400">No hay stock{q ? ' con esa búsqueda' : ''} en este depósito.</div>
                        : (
                            <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
                                {stock.map(s => (
                                    <div key={s.VarId} className="px-4 py-2.5 flex items-center gap-3">
                                        <Package size={16} className="text-zinc-300 shrink-0" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-bold text-zinc-800 truncate">{s.Producto}</span>
                                            {s.NombreVariante && s.NombreVariante !== s.Producto && <span className="block text-xs text-zinc-500 truncate">{s.NombreVariante}</span>}
                                        </span>
                                        <span className="text-sm text-zinc-600 shrink-0"><b>{fmtCantidad(s.Stock)}</b> {unidadTexto(s.Unidad)}</span>
                                        {s.Costo != null && <span className="text-xs text-zinc-400 shrink-0 hidden sm:inline">{fmtPlata(s.Costo, s.Moneda)} c/u</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                </>
            ) : (
                <>
                    <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-3 flex flex-wrap gap-2 items-center">
                        <div className="relative flex-1 min-w-[180px]">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                            <input value={filtroUsos.q} onChange={(e) => setFiltroUsos(f => ({ ...f, q: e.target.value }))} placeholder="Buscar insumo, nota o persona…"
                                className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-xl text-sm outline-none focus:border-brand-cyan" />
                        </div>
                        <input type="date" className={sel} value={filtroUsos.desde} onChange={(e) => setFiltroUsos(f => ({ ...f, desde: e.target.value }))} title="Desde" />
                        <input type="date" className={sel} value={filtroUsos.hasta} onChange={(e) => setFiltroUsos(f => ({ ...f, hasta: e.target.value }))} title="Hasta" />
                        {Object.keys(totalesUsos).length > 0 && <span className="text-xs text-zinc-500">Total: <b>{Object.entries(totalesUsos).map(([m, n]) => fmtPlata(n, m)).join(' + ')}</b></span>}
                    </div>
                    {!usos ? <div className="py-12 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={20} /></div>
                        : usos.length === 0 ? <div className="py-12 text-center text-sm text-zinc-400">No hay usos registrados.</div>
                        : (
                            <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
                                {usos.map(u => (
                                    <div key={u.UsoId} className="px-4 py-2.5 flex items-start gap-3">
                                        <span className="min-w-0 flex-1 text-sm">
                                            <span className="font-bold text-zinc-800">{fmtCantidad(u.Cantidad)} {unidadTexto(u.Unidad)}</span> <span className="text-zinc-700">{u.Nombre}</span>
                                            <span className="block text-[11px] text-zinc-400">
                                                {fmtFecha(u.Fecha)} · {u.UsuarioNombre} · de {u.Deposito}
                                                {u.EquipoNombre && ` · ${u.EquipoNombre}`}
                                                {u.SolCodigo && ` · ${u.SolCodigo} ${u.SolTitulo || ''}`}
                                                {u.TrabTitulo && ` · trabajo: ${u.TrabTitulo}`}
                                                {u.ProyTitulo && ` · proyecto: ${u.ProyTitulo}`}
                                                {u.Nota && ` · ${u.Nota}`}
                                                {u.Faltante ? ` · faltaron ${fmtCantidad(u.Faltante)}` : ''}
                                            </span>
                                        </span>
                                        {u.CostoTotal != null && <span className="text-xs font-bold text-zinc-600 shrink-0">{fmtPlata(u.CostoTotal, u.Moneda)}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                </>
            )}

            {usar && <ModalUsoInsumo contexto={usar} onCerrar={() => setUsar(null)} onGuardado={() => { setUsar(null); cargarStock(); if (tab === 'usos') cargarUsos(); }} />}
        </div>
    );
};

export default InsumosVista;
