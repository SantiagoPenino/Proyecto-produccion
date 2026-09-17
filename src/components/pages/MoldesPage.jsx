import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

/*
 * MOLDES ESCALADOS — /moldes
 * ──────────────────────────────────────────────────────────────────
 * Se sube el PDF del plotter (escala 1:1), el backend lo despieza solo
 * y acá se le pone nombre a cada grupo de trazos ("nido") contra el
 * nomenclador PiezasPrenda.
 *
 * Lo importante de la pantalla: NO se rotula talle por talle. Se rotula
 * el NIDO, que son los 10 talles de esa pieza anidados uno dentro de
 * otro; el orden por tamaño ya resuelve cuál es cuál. En el molde de
 * camisetas con costadillo son 30 rótulos, no 300.
 *
 * La banda (la fila de la hoja) la detecta el backend y se usa para
 * PROPONER la curva, pero la que vale es la que confirma el usuario:
 * si el molde viene con las bandas encimadas, la detección se equivoca.
 * Por eso se pueden seleccionar varios nidos y asignarles la curva de
 * una sola vez.
 *
 * Backend: /api/configurador/moldes (moldesController).
 */

const API = '/configurador';

const HILOS = [
    { id: 'RECTO', label: 'Recto' },
    { id: 'TRANSVERSAL', label: 'Transversal' },
    { id: 'BIES', label: 'Al bies' },
];

const cm = (n) => (n == null ? '—' : Number(n).toLocaleString('es-UY', { maximumFractionDigits: 1 }));
const entero = (n) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('es-UY'));

// Miniatura del contorno del talle más grande. El backend ya lo manda
// normalizado a un viewBox 0 0 100 100, así que acá no hay que escalar nada.
const Contorno = ({ d, className = '' }) => (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
);

const Label = ({ children }) => (
    <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1.5">{children}</p>
);

export default function MoldesPage() {
    const [moldes, setMoldes] = useState([]);
    const [curvas, setCurvas] = useState([]);
    const [piezas, setPiezas] = useState([]);
    const [moldeId, setMoldeId] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const [nuevo, setNuevo] = useState(null);     // { codigo, nombre, notas } mientras se sube
    const archivoRef = useRef(null);

    const [seleccion, setSeleccion] = useState(() => new Set());
    const [form, setForm] = useState({ curvaId: '', piezaId: '', cantidad: 1, espejada: false, sentidoHilo: 'RECTO' });

    const [exCurva, setExCurva] = useState('');
    const [exTalle, setExTalle] = useState('');
    const [extraccion, setExtraccion] = useState(null);

    // ── carga ────────────────────────────────────────────────────────
    const cargarCatalogos = useCallback(async () => {
        try {
            const [c, p] = await Promise.all([
                api.get(`${API}/curvas-talle`),
                api.get(`${API}/piezas`),
            ]);
            setCurvas(c.data?.data || []);
            setPiezas(p.data?.data || []);
        } catch (e) {
            toast.error('No se pudieron cargar las curvas y el nomenclador de piezas.');
        }
    }, []);

    const cargarMoldes = useCallback(async () => {
        try {
            const r = await api.get(`${API}/moldes`);
            setMoldes(r.data?.data || []);
        } catch (e) {
            toast.error('No se pudo cargar la lista de moldes.');
        }
    }, []);

    const cargarDetalle = useCallback(async (id) => {
        if (!id) { setDetalle(null); return; }
        setCargando(true);
        try {
            const r = await api.get(`${API}/moldes/${id}`);
            setDetalle(r.data?.data || null);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo abrir el molde.');
            setDetalle(null);
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargarCatalogos(); cargarMoldes(); }, [cargarCatalogos, cargarMoldes]);
    useEffect(() => {
        setSeleccion(new Set());
        setExtraccion(null);
        setExCurva('');
        setExTalle('');
        cargarDetalle(moldeId);
    }, [moldeId, cargarDetalle]);

    // ── subir ────────────────────────────────────────────────────────
    const subir = async () => {
        const archivo = archivoRef.current?.files?.[0];
        if (!archivo) return toast.error('Elegí el PDF del molde.');
        if (!nuevo?.codigo?.trim()) return toast.error('El código del molde es obligatorio.');

        const fd = new FormData();
        fd.append('molde', archivo);
        fd.append('codigo', nuevo.codigo.trim());
        fd.append('nombre', (nuevo.nombre || '').trim());
        fd.append('notas', (nuevo.notas || '').trim());

        setSubiendo(true);
        try {
            const r = await api.post(`${API}/moldes`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            const d = r.data?.despiece;
            toast.success(`Molde despiezado: ${d?.nidosDetectados} piezas en ${d?.bandas} banda(s), de ${d?.trazosTotales} trazos.`);
            setNuevo(null);
            await cargarMoldes();
            setMoldeId(r.data.moldeId);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo procesar el molde.');
        } finally {
            setSubiendo(false);
        }
    };

    // ── selección ────────────────────────────────────────────────────
    const nidos = detalle?.piezas || [];
    const bandas = useMemo(() => {
        const m = new Map();
        nidos.forEach(n => {
            const b = n.Bloque || 1;
            if (!m.has(b)) m.set(b, []);
            m.get(b).push(n);
        });
        return [...m.entries()].sort((a, b) => a[0] - b[0]);
    }, [nidos]);

    const tocarNido = (nido, e) => {
        const acumula = e.ctrlKey || e.metaKey || e.shiftKey;
        setSeleccion(prev => {
            const next = acumula ? new Set(prev) : new Set();
            if (acumula && prev.has(nido.NidoIndice)) next.delete(nido.NidoIndice);
            else next.add(nido.NidoIndice);
            return next;
        });
        if (!acumula) {
            setForm({
                curvaId: nido.CurvaID || '',
                piezaId: nido.PiezaID || '',
                cantidad: nido.Cantidad || 1,
                espejada: !!nido.Espejada,
                sentidoHilo: nido.SentidoHilo || 'RECTO',
            });
        }
    };

    const seleccionarBanda = (lista) => {
        setSeleccion(new Set(lista.map(n => n.NidoIndice)));
        setForm(f => ({ ...f, curvaId: lista[0]?.CurvaID || '', piezaId: '' }));
    };

    const seleccionados = useMemo(
        () => nidos.filter(n => seleccion.has(n.NidoIndice)),
        [nidos, seleccion]
    );
    const unico = seleccionados.length === 1 ? seleccionados[0] : null;

    // ── guardar rótulo ───────────────────────────────────────────────
    const guardar = async () => {
        if (!seleccionados.length) return;
        if (!form.curvaId) return toast.error('Elegí la curva de talles.');
        if (seleccionados.length === 1 && !form.piezaId) return toast.error('Elegí qué pieza es.');

        const rotulos = seleccionados.map(n => ({
            nidoIndice: n.NidoIndice,
            curvaId: Number(form.curvaId),
            // En selección múltiple no se toca la pieza: diez nidos no pueden
            // ser la misma pieza. Se les asigna la curva y se conserva lo demás.
            piezaId: unico ? Number(form.piezaId) : (n.PiezaID || null),
            cantidad: unico ? Number(form.cantidad) || 1 : (n.Cantidad || 1),
            espejada: unico ? form.espejada : !!n.Espejada,
            sentidoHilo: unico ? form.sentidoHilo : (n.SentidoHilo || 'RECTO'),
        }));

        try {
            await api.put(`${API}/moldes/${moldeId}/piezas`, { rotulos });
            toast.success(unico ? 'Rótulo guardado.' : `Curva asignada a ${rotulos.length} piezas.`);
            await cargarDetalle(moldeId);
            await cargarMoldes();
            setExtraccion(null);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo guardar el rótulo.');
        }
    };

    const quitarRotulo = async () => {
        if (!unico) return;
        try {
            await api.put(`${API}/moldes/${moldeId}/piezas`, {
                rotulos: [{ nidoIndice: unico.NidoIndice, curvaId: null, piezaId: null }],
            });
            toast.success('Rótulo quitado.');
            setForm({ curvaId: '', piezaId: '', cantidad: 1, espejada: false, sentidoHilo: 'RECTO' });
            await cargarDetalle(moldeId);
            await cargarMoldes();
            setExtraccion(null);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo quitar el rótulo.');
        }
    };

    // ── extraer ──────────────────────────────────────────────────────
    const curvaExtraccion = curvas.find(c => String(c.CurvaID) === String(exCurva));
    const extraer = async () => {
        if (!exCurva || !exTalle) return toast.error('Elegí la curva y el talle.');
        try {
            const r = await api.get(`${API}/moldes/${moldeId}/extraer`, { params: { curvaId: exCurva, talle: exTalle } });
            setExtraccion(r.data?.data || null);
        } catch (e) {
            setExtraccion(null);
            toast.error(e.response?.data?.error || 'No se pudo extraer el talle.');
        }
    };

    const rotuladas = nidos.filter(n => n.PiezaID && n.CurvaID).length;

    // ═════════════════════════════════════════════════════════════════
    return (
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5">

            {/* ── encabezado + lista de moldes ───────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800">Moldes escalados</h1>
                        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
                            Subí el PDF del plotter una vez. El sistema separa las piezas y los talles solo;
                            vos les ponés nombre. Después, pedir un talle suelto es una consulta.
                        </p>
                    </div>
                    <button onClick={() => setNuevo(nuevo ? null : { codigo: '', nombre: '', notas: '' })}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700">
                        <i className={`fa-solid ${nuevo ? 'fa-xmark' : 'fa-plus'} mr-2`} />
                        {nuevo ? 'Cancelar' : 'Subir molde'}
                    </button>
                </div>

                {nuevo && (
                    <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-4 mb-4 grid md:grid-cols-4 gap-3 items-end">
                        <div>
                            <Label>Código</Label>
                            <input value={nuevo.codigo} onChange={e => setNuevo({ ...nuevo, codigo: e.target.value })}
                                placeholder="MOL-CAMISETA-COSTADILLO"
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold uppercase" />
                        </div>
                        <div>
                            <Label>Nombre</Label>
                            <input value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
                                placeholder="Camiseta de fútbol con costadillo"
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <Label>Archivo PDF del plotter</Label>
                            <input ref={archivoRef} type="file" accept="application/pdf,.pdf"
                                className="w-full text-xs text-slate-600 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-200 file:text-xs file:font-bold" />
                        </div>
                        <button onClick={subir} disabled={subiendo}
                            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-bold disabled:opacity-50">
                            {subiendo ? 'Despiezando…' : 'Subir y despiezar'}
                        </button>
                        <p className="md:col-span-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            Tiene que ser el PDF <b>vectorial</b> que exporta el CAD, con todos los talles anidados.
                            Un molde escaneado o una imagen no se puede despiezar y se rechaza.
                        </p>
                    </div>
                )}

                <div className="flex gap-2 flex-wrap">
                    {moldes.length === 0 && <p className="text-sm text-slate-400">Todavía no hay moldes cargados.</p>}
                    {moldes.map(m => (
                        <button key={m.MoldeID} onClick={() => setMoldeId(m.MoldeID)}
                            className={`text-left border rounded-xl px-4 py-3 min-w-[220px] transition ${moldeId === m.MoldeID
                                ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300'
                                : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                            <p className="text-sm font-black text-slate-800 leading-tight">{m.Nombre}</p>
                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">{m.Codigo} · v{m.Version}</p>
                            <div className="flex items-center gap-2 mt-2">
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${m.Estado === 'ROTULADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {m.Estado}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500">{m.Rotuladas}/{m.Nidos} piezas</span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {cargando && <p className="text-sm text-slate-400 px-1">Abriendo el molde…</p>}

            {detalle && (
                <>
                    {/* ── rotulado ───────────────────────────────────── */}
                    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">

                        <div className="bg-white border border-slate-200 rounded-xl">
                            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
                                <div>
                                    <h2 className="text-lg font-black text-slate-800">{detalle.Nombre}</h2>
                                    <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                                        {cm(detalle.AnchoHojaCm)} × {cm(detalle.AltoHojaCm)} cm · {detalle.TrazosTotales} trazos ·
                                        {' '}{detalle.NidosDetectados} piezas · {bandas.length} banda(s)
                                    </p>
                                </div>
                                <div className="ml-auto text-right">
                                    <p className="text-2xl font-black text-slate-800 tabular-nums">{rotuladas}<span className="text-slate-300"> / {nidos.length}</span></p>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">piezas rotuladas</p>
                                </div>
                            </div>

                            {bandas.map(([banda, lista]) => {
                                const curvasBanda = [...new Set(lista.map(n => n.CurvaNombre).filter(Boolean))];
                                return (
                                    <div key={banda} className="border-b border-slate-100 last:border-b-0">
                                        <div className="px-5 pt-4 pb-2 flex flex-wrap items-baseline gap-3">
                                            <span className="text-sm font-black uppercase tracking-wide text-slate-600">Banda {banda}</span>
                                            <span className="text-xs text-slate-400">
                                                {curvasBanda.length ? curvasBanda.join(' · ') : 'sin curva asignada'}
                                            </span>
                                            <button onClick={() => seleccionarBanda(lista)}
                                                className="ml-auto text-[11px] font-bold text-indigo-600 hover:text-indigo-800">
                                                Seleccionar las {lista.length} piezas de la banda
                                            </button>
                                        </div>
                                        <div className="px-5 pb-4 grid gap-2 grid-cols-[repeat(auto-fill,minmax(96px,1fr))]">
                                            {lista.map(n => {
                                                const sel = seleccion.has(n.NidoIndice);
                                                const listo = n.PiezaID && n.CurvaID;
                                                const mayor = n.talles?.[n.talles.length - 1];
                                                return (
                                                    <button key={n.NidoIndice} onClick={e => tocarNido(n, e)}
                                                        className={`relative text-left border rounded-lg p-1.5 transition ${sel
                                                            ? 'border-indigo-500 ring-1 ring-indigo-400 bg-indigo-50'
                                                            : listo ? 'border-slate-200 bg-white hover:border-slate-300'
                                                                : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}>
                                                        <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${listo ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                                        <Contorno d={n.SvgPath} className="w-full h-auto text-indigo-900" />
                                                        <p className="text-[10px] font-bold text-slate-700 leading-tight mt-1 truncate">
                                                            {n.PiezaNombre || 'Sin rotular'}
                                                        </p>
                                                        <p className="text-[9px] font-mono text-slate-400 leading-tight">
                                                            nido {n.NidoIndice} · {cm(mayor?.AnchoCm)}×{cm(mayor?.AltoCm)}
                                                        </p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* panel */}
                        <div className="bg-white border border-slate-200 rounded-xl lg:sticky lg:top-4">
                            {!seleccionados.length ? (
                                <div className="p-8 text-center text-sm text-slate-400">
                                    Tocá una pieza para rotularla.
                                    <span className="block mt-2 text-xs text-slate-400">
                                        Con <b>Ctrl</b> (o <b>Shift</b>) sumás varias y les asignás la curva de una.
                                    </span>
                                </div>
                            ) : (
                                <div className="p-4 space-y-3">
                                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                                        {unico ? `Nido ${unico.NidoIndice}` : `${seleccionados.length} piezas seleccionadas`}
                                    </p>

                                    {unico && (
                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-center">
                                            <Contorno d={unico.SvgPath} className="w-32 h-32 text-indigo-900" />
                                        </div>
                                    )}

                                    <div>
                                        <Label>Curva de talles</Label>
                                        <select value={form.curvaId} onChange={e => setForm({ ...form, curvaId: e.target.value })}
                                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold">
                                            <option value="">— elegir —</option>
                                            {curvas.map(c => (
                                                <option key={c.CurvaID} value={c.CurvaID}>
                                                    {c.Nombre} ({c.talles?.length || 0} talles)
                                                </option>
                                            ))}
                                        </select>
                                        <p className="text-[11px] text-slate-400 mt-1">
                                            La banda de la hoja es una sugerencia. Confirmá vos.
                                        </p>
                                    </div>

                                    {unico ? (
                                        <>
                                            <div>
                                                <Label>Pieza</Label>
                                                <select value={form.piezaId} onChange={e => setForm({ ...form, piezaId: e.target.value })}
                                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold">
                                                    <option value="">— elegir del nomenclador —</option>
                                                    {piezas.map(p => (
                                                        <option key={p.PiezaID} value={p.PiezaID}>{p.Codigo} · {p.Nombre}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <Label>Cantidad</Label>
                                                    <input type="number" min="1" value={form.cantidad}
                                                        onChange={e => setForm({ ...form, cantidad: e.target.value })}
                                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold" />
                                                </div>
                                                <div>
                                                    <Label>Sentido de hilo</Label>
                                                    <select value={form.sentidoHilo} onChange={e => setForm({ ...form, sentidoHilo: e.target.value })}
                                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold">
                                                        {HILOS.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
                                                <input type="checkbox" checked={form.espejada}
                                                    onChange={e => setForm({ ...form, espejada: e.target.checked })} />
                                                Se corta al espejo
                                            </label>

                                            {!!unico.talles?.length && (
                                                <div>
                                                    <Label>Talles dentro de este nido</Label>
                                                    <div className="text-[11px] font-mono text-slate-500 leading-relaxed max-h-28 overflow-y-auto">
                                                        {unico.talles.map(t => {
                                                            const c = curvas.find(x => String(x.CurvaID) === String(form.curvaId));
                                                            const nom = c?.talles?.find(x => x.Orden === t.Orden)?.Talle;
                                                            return (
                                                                <span key={t.Orden} className="inline-block mr-3">
                                                                    <b className="text-slate-700">{nom || `#${t.Orden}`}</b> {cm(t.AnchoCm)}×{cm(t.AltoCm)}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                            Con varias piezas seleccionadas sólo se asigna la <b>curva</b>: el nombre de cada
                                            pieza se pone de a una. Lo ya rotulado no se pisa.
                                        </p>
                                    )}

                                    <button onClick={guardar}
                                        className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700">
                                        {unico ? 'Guardar rótulo' : `Asignar curva a ${seleccionados.length} piezas`}
                                    </button>
                                    {unico?.PiezaID && (
                                        <button onClick={quitarRotulo}
                                            className="w-full px-4 py-2 rounded-lg border border-slate-200 text-slate-500 text-sm font-bold hover:bg-slate-50">
                                            Quitar rótulo
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── extraer ────────────────────────────────────── */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                        <div className="flex flex-wrap items-center gap-3 mb-4">
                            <h2 className="text-lg font-black text-slate-800">Extraer un talle</h2>
                            <span className="text-[11px] font-bold text-slate-400">sólo piezas ya rotuladas</span>
                        </div>

                        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end max-w-2xl">
                            <div>
                                <Label>Curva</Label>
                                <select value={exCurva} onChange={e => { setExCurva(e.target.value); setExTalle(''); setExtraccion(null); }}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold">
                                    <option value="">— elegir —</option>
                                    {curvas.map(c => <option key={c.CurvaID} value={c.CurvaID}>{c.Nombre}</option>)}
                                </select>
                            </div>
                            <div>
                                <Label>Talle</Label>
                                <select value={exTalle} onChange={e => { setExTalle(e.target.value); setExtraccion(null); }}
                                    disabled={!curvaExtraccion}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold disabled:bg-slate-50">
                                    <option value="">— elegir —</option>
                                    {(curvaExtraccion?.talles || []).map(t => <option key={t.ItemID} value={t.Talle}>{t.Talle}</option>)}
                                </select>
                            </div>
                            <button onClick={extraer}
                                className="px-4 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-bold hover:bg-slate-900">
                                Extraer
                            </button>
                        </div>

                        {extraccion && (
                            <div className="mt-5">
                                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
                                                <th className="text-left px-3 py-2 w-12"></th>
                                                <th className="text-left px-3 py-2">Cód.</th>
                                                <th className="text-left px-3 py-2">Pieza</th>
                                                <th className="text-right px-3 py-2">Cant.</th>
                                                <th className="text-right px-3 py-2">Ancho cm</th>
                                                <th className="text-right px-3 py-2">Alto cm</th>
                                                <th className="text-right px-3 py-2">Área cm²</th>
                                                <th className="text-left px-3 py-2">Hilo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {extraccion.piezas.map(p => (
                                                <tr key={p.MoldePiezaID} className="border-t border-slate-100">
                                                    <td className="px-3 py-1.5">
                                                        <Contorno d={p.SvgPath} className="w-8 h-8 text-indigo-900" />
                                                    </td>
                                                    <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{p.PiezaCodigo}</td>
                                                    <td className="px-3 py-1.5 font-bold text-slate-700">{p.PiezaNombre}</td>
                                                    <td className="px-3 py-1.5 text-right tabular-nums">{p.Cantidad}</td>
                                                    <td className="px-3 py-1.5 text-right tabular-nums">{cm(p.AnchoCm)}</td>
                                                    <td className="px-3 py-1.5 text-right tabular-nums">{cm(p.AltoCm)}</td>
                                                    <td className="px-3 py-1.5 text-right tabular-nums">{entero(p.AreaTotalCm2)}</td>
                                                    <td className="px-3 py-1.5 text-xs text-slate-500">
                                                        {HILOS.find(h => h.id === p.SentidoHilo)?.label || p.SentidoHilo}
                                                        {p.Espejada ? ' · espejo' : ''}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-slate-50 border-t border-slate-300 font-black text-slate-700">
                                                <td colSpan={6} className="px-3 py-2">
                                                    Talle {extraccion.talle} · {extraccion.piezas.length} piezas
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums">{entero(extraccion.totalCm2)}</td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                                <p className="text-xs text-slate-500 mt-3 max-w-2xl">
                                    <b className="text-slate-700">El área es la de la pieza, no el consumo.</b> Da el piso teórico
                                    de tela; el consumo real sale de la marcada, que siempre es mayor por la merma entre piezas.
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
