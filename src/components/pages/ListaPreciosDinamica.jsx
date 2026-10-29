import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Calculator, Info, RefreshCw, Copy, Plus, Trash2, AlertTriangle, Star } from 'lucide-react';
import api from '../../services/apiClient';
import Selector from '../ui/Selector';

/* ══════════════════════════════════════════════════════════════════════
   LISTA DE PRECIOS DINÁMICA  (/admin/lista-precios-dinamica) — 29/10/2026

   La maqueta «Pricing textil» con los datos reales. Precio por unidad:
     costo  = consumo de la tela principal × precio del metro + corte y costura del producto
     precio = costo × (1 + margen de la franja de unidades)
   El precio del metro baja con los metros TOTALES del pedido (unidades × consumo), según las escalas del área
   de la tela. La cuenta la hace el servidor (services/listaPreciosDinamica.js), la misma que usa el motor.
   Pestañas:
     · Lista de precios: una fila por producto (con su tela ★), un precio por franja de unidades + cotizador.
     · Telas (solo lectura): precio de lista y escalas por metros. Se cambian en Precios Estándar / Perfiles.
     · Productos (solo lectura): telas, consumos y corte y costura. Se cargan en Configurar productos.
     · Márgenes y costos: corte y costura general (el de los productos que no tienen el suyo), franjas de
       unidades (margen), áreas de las telas, moneda, redondeo y si se aplica.
   ══════════════════════════════════════════════════════════════════════ */

const PESTANAS = [
    { id: 'lista', nombre: 'Lista de precios' },
    { id: 'telas', nombre: 'Telas' },
    { id: 'productos', nombre: 'Productos' },
    { id: 'margenes', nombre: 'Márgenes y costos' },
];
const SIMBOLO = { UYU: '$', USD: 'US$' };
const num = (n, d = 2) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('es-UY', { minimumFractionDigits: d, maximumFractionDigits: d }));
const textoValores = (vs) => vs.map(v => `${v.nombre} ${v.tipo === 'PORCENTAJE' ? `+${num(v.valor, v.valor % 1 ? 1 : 0)} %` : `+${SIMBOLO[v.moneda] || ''} ${num(v.valor)}`}`).join(', ');
const CARD = 'bg-white border border-slate-200 rounded-xl';
const CAMPO = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-brand-cyan/20 tabular-nums';

export default function ListaPreciosDinamica() {
    const [datos, setDatos] = useState(null);
    const [loading, setLoading] = useState(false);
    const [pestana, setPestana] = useState('lista');
    const [selId, setSelId] = useState(null);

    const cargar = useCallback(async () => {
        setLoading(true);
        try { const r = await api.get('/prices/lista-dinamica'); setDatos(r.data); }
        catch (e) { toast.error(e.response?.data?.error || 'No se pudo cargar la lista de precios dinámica'); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const cfg = datos?.config;
    const sim = SIMBOLO[cfg?.moneda] || '';
    const dinero = (n, mon) => `${SIMBOLO[mon] || sim} ${num(n, cfg?.redondeo >= 1 ? 0 : 2)}`;
    const dinero2 = (n, mon) => `${SIMBOLO[mon] || sim} ${num(n)}`;

    return (
        <div className="px-4 pt-3 pb-4 md:px-6 md:pt-0 md:pb-6 w-full font-sans text-slate-800">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center">
                        <Calculator size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight text-slate-800">Lista de precios dinámica</h1>
                        <p className="text-xs text-slate-500">Precio por unidad = tela × consumo + confección, más el margen de la franja de unidades</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {cfg && (
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${cfg.aplicar ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
                            title={cfg.aplicar ? 'Los pedidos y cotizaciones de estos productos salen de esta lista' : 'Se prende en Márgenes y costos'}>
                            {cfg.aplicar ? 'Se aplica en los pedidos' : 'Todavía no se aplica en los pedidos'}
                        </span>
                    )}
                    <button onClick={cargar} disabled={loading} title="Volver a calcular"
                        className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40">
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {datos?.faltaSQL && (
                <div className="mb-4 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Falta correr <b>backend/scripts/lista_precios_dinamica.sql</b> en esta base: sin eso no hay consumo por tela y no se calcula ningún producto.</span>
                </div>
            )}

            <div className="flex flex-wrap gap-2 mb-4">
                {PESTANAS.map(p => (
                    <button key={p.id} onClick={() => setPestana(p.id)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${p.id === pestana ? 'bg-brand-cyan border-brand-cyan text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        {p.nombre}
                    </button>
                ))}
            </div>

            {!datos ? <div className="py-10 text-center text-slate-400 text-sm">{loading ? 'Calculando…' : 'Sin datos'}</div> : (
                <>
                    {pestana === 'lista' && <PestanaLista datos={datos} dinero={dinero} dinero2={dinero2} selId={selId} setSelId={setSelId} />}
                    {pestana === 'telas' && <PestanaTelas datos={datos} dinero2={dinero2} />}
                    {pestana === 'productos' && <PestanaProductos datos={datos} />}
                    {pestana === 'margenes' && <PestanaMargenes datos={datos} onGuardado={cargar} />}
                </>
            )}

            {datos?.cotizacion && (
                <div className="mt-4 flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    <span>
                        Cada producto va en la moneda de <b>su precio de lista</b> (los que no tienen, en {cfg.moneda === 'USD' ? 'dólares' : 'pesos'}). La tela y el corte y costura en otra moneda se convierten con la cotización
                        {' '}<b>US$ 1 = $ {num(datos.cotizacion.valor)}</b> ({datos.cotizacion.dia}); en un pedido, con la del pedido.
                    </span>
                </div>
            )}
        </div>
    );
}

// ── Lista de precios + detalle + cotizador ───────────────────────────────────
function PestanaLista({ datos, dinero, dinero2, selId, setSelId }) {
    const cfg = datos.config;
    const conLista = datos.productos.filter(p => p.lista);
    const sinLista = datos.productos.filter(p => !p.lista);
    const sel = conLista.find(p => p.proId === selId) || conLista[0] || null;
    const [copiada, setCopiada] = useState(false);

    const copiar = async () => {
        const head = ['Código', 'Producto', 'Tela', 'Consumo (m)', 'Moneda', ...cfg.franjas.map(f => `Desde ${f.desde} u. (+${f.margen}%)`)];
        const filas = conLista.map(p => [p.cod, p.nombre, p.tela.nombre, num(p.tela.consumo, 3), SIMBOLO[p.moneda] || p.moneda, ...p.lista.map(r => num(r.precio, cfg.redondeo >= 1 ? 0 : 2))]);
        const tsv = [head, ...filas].map(r => r.join('\t')).join('\n');
        try { await navigator.clipboard.writeText(tsv); setCopiada(true); setTimeout(() => setCopiada(false), 2500); }
        catch { toast.error('No se pudo copiar'); }
    };

    return (
        <div className="space-y-4">
            <div className={`${CARD} overflow-hidden`}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
                    <p className="text-xs text-slate-500">Precio por unidad en cada franja (el costo debajo). Tocá un producto para ver la cuenta paso a paso.</p>
                    <button onClick={copiar} disabled={!conLista.length}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                        <Copy size={13} /> {copiada ? 'Copiada: pegala en Excel' : 'Copiar lista'}
                    </button>
                </div>
                {!conLista.length ? (
                    <p className="px-4 py-8 text-center text-sm text-slate-400">Todavía no hay productos con consumo cargado. Cargalo en Configurar productos › Molde, telas y apliques.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                                    <th className="text-left px-4 py-2 font-black">Producto</th>
                                    {cfg.franjas.map(f => (
                                        <th key={f.desde} className="px-3 py-2 text-right font-black whitespace-nowrap">
                                            desde {f.desde} u.<span className="block text-[10px] font-bold text-emerald-600 normal-case">+{num(f.margen, f.margen % 1 ? 1 : 0)} %</span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {conLista.map(p => (
                                    <tr key={p.proId} onClick={() => setSelId(p.proId)} tabIndex={0}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelId(p.proId); } }}
                                        className={`border-t border-slate-100 cursor-pointer ${sel?.proId === p.proId ? 'bg-brand-cyan/5' : 'hover:bg-slate-50'}`}>
                                        <td className="px-4 py-2">
                                            <span className="block font-bold text-slate-800">{p.nombre}</span>
                                            <span className="block text-[11px] text-slate-400">{p.cod} · {num(p.tela.consumo, 2)} m de {p.tela.nombre} · corte y costura {p.corteCostura?.propio ? `${SIMBOLO[p.corteCostura.moneda] || ''} ${num(p.corteCostura.costo)}` : 'general'}{p.valores?.length ? ` · ${textoValores(p.valores)}` : ''}</span>
                                        </td>
                                        {p.lista.map(r => (
                                            <td key={r.desdeUnidades} className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                                                <span className="block font-black text-slate-800">{dinero(r.precio, p.moneda)}</span>
                                                <span className="block text-[11px] text-slate-400">costo {num(r.costoUnitario)}</span>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {sel && <Detalle prod={sel} cfg={cfg} dinero={dinero} dinero2={dinero2} />}
            <Cotizador productos={conLista} cfg={cfg} dinero={dinero} dinero2={dinero2} inicial={sel} />

            {sinLista.length > 0 && (
                <div className={`${CARD} px-4 py-3`}>
                    <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">Sin precio dinámico ({sinLista.length})</h3>
                    <ul className="space-y-1 text-xs">
                        {sinLista.map(p => (
                            <li key={p.proId}><b className="text-slate-700">{p.nombre}</b> <span className="text-slate-400">{p.cod}</span> — <span className="text-amber-700">{p.avisos.join(' ')}</span></li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function Detalle({ prod, cfg, dinero: dineroL, dinero2: dineroL2 }) {
    const dinero = (n) => dineroL(n, prod.moneda);
    const dinero2 = (n) => dineroL2(n, prod.moneda);
    const fila = (titulo, fn, total) => (
        <tr className={`border-t border-slate-100 ${total ? 'bg-slate-50 font-black' : ''}`}>
            <th scope="row" className="text-left px-4 py-1.5 font-bold text-slate-600 whitespace-nowrap">{titulo}</th>
            {prod.lista.map(r => <td key={r.desdeUnidades} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fn(r)}</td>)}
        </tr>
    );
    return (
        <div className={`${CARD} overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-100">
                <span className="text-[10px] font-black uppercase tracking-wide text-brand-cyan">Cálculo paso a paso</span>
                <h2 className="text-base font-black text-slate-800">{prod.nombre}</h2>
                <p className="text-xs text-slate-500">
                    {num(prod.tela.consumo, 3)} m por unidad de {prod.tela.nombre} · corte y costura {prod.corteCostura?.propio ? `del producto: ${SIMBOLO[prod.corteCostura.moneda] || ''} ${num(prod.corteCostura.costo)}` : 'general'}.
                    {' '}Cada columna, con la cantidad mínima de su franja.
                </p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                            <th />
                            {cfg.franjas.map(f => <th key={f.desde} className="px-3 py-2 text-right font-black whitespace-nowrap">desde {f.desde} u.</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {fila('Metros de tela del pedido', r => `${num(r.metros)} m`)}
                        {fila('Franja de la tela', r => <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600" title={r.reglaTela || 'Precio de lista'}>desde {r.desdeMetros} m</span>)}
                        {fila('Precio del metro', r => dinero2(r.precioMetro))}
                        {fila('Tela por unidad', r => dinero2(r.costoTela))}
                        {fila(`Corte y costura (${prod.corteCostura?.propio ? 'del producto' : 'general'})`, r => dinero2(r.costoConfeccion))}
                        {fila('Costo por unidad', r => dinero2(r.costoUnitario), true)}
                        {fila('Margen', r => `+${num(r.margen, r.margen % 1 ? 1 : 0)} %`)}
                        {prod.valores?.length > 0 && fila('Precio con margen', r => dinero2(r.precioConMargen))}
                        {prod.valores?.length > 0 && fila(`Valores agregados (${textoValores(prod.valores)})`, r => `+${dinero2(r.valoresImporte)}`)}
                        {fila('Precio de venta', r => dinero(r.precio), true)}
                        {fila('Ganancia por unidad', r => dinero2(r.ganancia))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Cotizador({ productos, cfg, dinero: dineroL, dinero2: dineroL2, inicial }) {
    const [proId, setProId] = useState('');
    const [telaId, setTelaId] = useState('');
    const [cantidad, setCantidad] = useState('');
    const [res, setRes] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => { if (inicial && !proId) setProId(String(inicial.proId)); }, [inicial, proId]);
    const prod = productos.find(p => String(p.proId) === proId) || null;
    const telas = (prod?.telas || []).filter(t => t.consumo > 0 && t.enLista);
    useEffect(() => { setTelaId(prod?.tela ? String(prod.tela.telaProId) : ''); }, [prod?.proId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const q = Number(String(cantidad).replace(',', '.'));
        if (!prod || !(q > 0)) { setRes(null); setError(''); return undefined; }
        let vivo = true;
        const t = setTimeout(() => {
            api.post('/prices/lista-dinamica/cotizar', { proId: prod.proId, telaProId: Number(telaId) || null, cantidad: q })
                .then(r => { if (vivo) { setRes(r.data); setError(''); } })
                .catch(e => { if (vivo) { setRes(null); setError(e.response?.data?.error || 'No se pudo cotizar'); } });
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [prod, telaId, cantidad]);

    if (!productos.length) return null;
    const dinero = (n) => dineroL(n, res?.moneda);
    const dinero2 = (n) => dineroL2(n, res?.moneda);
    const qrow = (a, b) => <div className="flex justify-between gap-3 py-1 border-b border-slate-100 text-sm"><span className="text-slate-500">{a}</span><span className="font-bold tabular-nums text-right">{b}</span></div>;
    return (
        <div className={`${CARD} px-4 py-3`}>
            <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">Cotizar un pedido</h3>
            <div className="flex flex-wrap items-end gap-3">
                <label className="text-[11px] font-bold text-slate-500 min-w-[220px] flex-1">Producto
                    <Selector value={proId} onChange={e => setProId(e.target.value)} className="w-full mt-1" aria-label="Producto a cotizar">
                        {productos.map(p => <option key={p.proId} value={String(p.proId)}>{p.nombre}</option>)}
                    </Selector>
                </label>
                <label className="text-[11px] font-bold text-slate-500 min-w-[200px]">Tela
                    <Selector value={telaId} onChange={e => setTelaId(e.target.value)} className="w-full mt-1" aria-label="Tela">
                        {telas.map(t => <option key={t.telaProId} value={String(t.telaProId)}>{t.nombre} · {num(t.consumo, 2)} m{t.esDefault ? ' ★' : ''}</option>)}
                    </Selector>
                </label>
                <label className="text-[11px] font-bold text-slate-500">Unidades
                    <input type="number" min="1" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)} placeholder="Ej: 120"
                        className={`block w-28 mt-1 ${CAMPO}`} aria-label="Cantidad de unidades" />
                </label>
            </div>
            {error && <p className="mt-3 text-xs font-bold text-rose-600">{error}</p>}
            {res && (
                <div className="mt-3 max-w-md">
                    {qrow('Franja de venta', `desde ${res.desdeUnidades} u. · +${num(res.margen, res.margen % 1 ? 1 : 0)} %`)}
                    {qrow('Tela total', `${num(res.metros)} m`)}
                    {qrow('Precio del metro', `${dinero2(res.precioMetro)} (desde ${res.desdeMetros} m)`)}
                    {qrow(`Corte y costura ${res.corteCosturaPropio ? 'del producto' : 'general'}`, dinero2(res.costoConfeccion))}
                    {qrow('Costo por unidad', dinero2(res.costoUnitario))}
                    {res.valores?.length > 0 && qrow(`Valores agregados (${textoValores(res.valores)})`, `+${dinero2(res.valoresImporte)}`)}
                    {qrow('Precio por unidad', dinero(res.precio))}
                    {qrow('Ganancia del pedido', dinero2(res.ganancia * res.cantidad))}
                    <div className="flex justify-between items-end gap-3 pt-2">
                        <span className="text-xs text-slate-500">Total del pedido<br />{res.cantidad} u.</span>
                        <span className="text-2xl font-black text-slate-800 tabular-nums">{dinero(res.precio * res.cantidad)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Telas (solo lectura) ─────────────────────────────────────────────────────
function PestanaTelas({ datos, dinero2 }) {
    const grupos = useMemo(() => {
        const m = new Map();
        datos.telas.forEach(t => { const k = `${t.area} · ${t.variante || 'Sin variante'}`; m.set(k, [...(m.get(k) || []), t]); });
        return [...m.entries()];
    }, [datos.telas]);
    const nombreArea = (id) => datos.areas.find(a => a.id === id)?.nombre || id;
    return (
        <div className="space-y-4">
            <p className="text-xs text-slate-500">
                Telas de las áreas {datos.config.areas.map(nombreArea).join(' y ')}. Solo lectura: el precio se cambia en <b>Precios Estándar</b> y
                {' '}las escalas por metros en <b>Perfiles de Precios</b> (el perfil global del área). La franja la dan los metros totales del pedido.
            </p>
            {grupos.map(([grupo, telas]) => (
                <div key={grupo} className={`${CARD} overflow-hidden`}>
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs font-black text-slate-600">{grupo} <span className="font-bold text-slate-400">({telas.length})</span></div>
                    <table className="w-full text-sm">
                        <tbody>
                            {telas.map(t => (
                                <tr key={t.proId} className="border-t border-slate-100 first:border-t-0">
                                    <td className="px-4 py-2">
                                        <span className="block font-bold text-slate-800">{t.nombre}</span>
                                        <span className="block text-[11px] text-slate-400">{t.cod}{t.anchoM ? ` · ${num(t.anchoM)} m de ancho` : ''}{t.precioLista != null ? ` · lista ${SIMBOLO[t.monedaLista] || ''} ${num(t.precioLista)}` : ''}</span>
                                    </td>
                                    <td className="px-4 py-2">
                                        {!t.escalas.length ? <span className="text-xs font-bold text-amber-700">Sin precio en la lista</span> : (
                                            <div className="flex flex-wrap gap-1.5 justify-end">
                                                {t.escalas.map(e => (
                                                    <span key={e.desde} title={e.regla || 'Precio de lista'}
                                                        className="text-[11px] font-bold px-2 py-1 rounded-lg border border-slate-200 bg-white whitespace-nowrap tabular-nums">
                                                        <span className="text-slate-400 font-medium">desde {e.desde} m</span> {dinero2(e.precio)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
            {!grupos.length && <p className="text-sm text-slate-400">Las áreas elegidas no tienen telas visibles.</p>}
        </div>
    );
}

// ── Productos (solo lectura) ─────────────────────────────────────────────────
function PestanaProductos({ datos }) {
    return (
        <div className="space-y-3">
            <p className="text-xs text-slate-500">
                Productos con telas cargadas, la norma de consumo de cada tela principal (metros por unidad) y su corte y costura por
                {' '}unidad. Se cargan en <b>Configurar productos › Molde, telas y apliques</b>. La lista usa la tela ★; en un pedido, la que se elija.
            </p>
            <div className={`${CARD} overflow-x-auto`}>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="text-left px-4 py-2 font-black">Producto</th>
                            <th className="text-left px-3 py-2 font-black">Familia</th>
                            <th className="text-left px-3 py-2 font-black">Moneda</th>
                            <th className="text-left px-3 py-2 font-black">Corte y costura</th>
                            <th className="text-left px-3 py-2 font-black">Valores agregados</th>
                            <th className="text-left px-3 py-2 font-black">Telas y consumo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {datos.productos.map(p => (
                            <tr key={p.proId} className="border-t border-slate-100 align-top">
                                <td className="px-4 py-2">
                                    <span className="block font-bold text-slate-800">{p.nombre}</span>
                                    <span className="block text-[11px] text-slate-400">{p.cod}{p.estado ? ` · ${p.estado.toLowerCase()}` : ''}</span>
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-600">{p.familia || '—'}</td>
                                <td className="px-3 py-2 text-xs font-bold text-slate-600" title="La de su precio de lista">{SIMBOLO[p.moneda] || p.moneda}</td>
                                <td className="px-3 py-2 text-xs whitespace-nowrap">
                                    {p.corteCostura?.propio
                                        ? <b className="text-slate-700 tabular-nums">{SIMBOLO[p.corteCostura.moneda] || ''} {num(p.corteCostura.costo)}</b>
                                        : <span className="text-slate-400" title="No tiene el suyo: usa el general de Márgenes y costos">general</span>}
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-600">{p.valores?.length ? textoValores(p.valores) : <span className="text-slate-400">—</span>}</td>
                                <td className="px-3 py-2">
                                    <div className="flex flex-wrap gap-1.5">
                                        {p.telas.map(t => (
                                            <span key={t.telaProId}
                                                title={!t.enLista ? 'No es de las áreas de la lista' : t.consumo > 0 ? '' : 'Falta el consumo'}
                                                className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border ${!t.enLista ? 'border-slate-200 text-slate-400' : t.consumo > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                                                {t.esDefault && <Star size={10} className="fill-current" aria-hidden="true" />}
                                                {t.nombre} · {t.consumo > 0 ? `${num(t.consumo, 2)} m` : 'sin consumo'}
                                            </span>
                                        ))}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!datos.productos.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No hay productos con telas cargadas.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Márgenes y costos (lo único que se edita acá) ────────────────────────────
function PestanaMargenes({ datos, onGuardado }) {
    const original = datos.config;
    const [cfg, setCfg] = useState(original);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { setCfg(original); }, [original]);
    const cambiado = JSON.stringify(cfg) !== JSON.stringify(original);
    const set = (patch) => setCfg(prev => ({ ...prev, ...patch }));
    const setFranja = (i, campo, valor) => set({ franjas: cfg.franjas.map((f, k) => (k === i ? { ...f, [campo]: valor } : f)) });
    const sim = SIMBOLO[cfg.moneda];

    const guardar = async () => {
        setGuardando(true);
        try {
            const n = (v) => Number(String(v ?? '').replace(',', '.'));
            const cuerpo = { ...cfg, corteCostura: n(cfg.corteCostura), franjas: cfg.franjas.map(f => ({ desde: Number(f.desde), margen: n(f.margen) })) };
            await api.put('/prices/lista-dinamica/config', cuerpo);
            toast.success('Guardado');
            await onGuardado();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo guardar'); }
        finally { setGuardando(false); }
    };

    return (
        <div className="space-y-4">
            <div className={`${CARD} px-4 py-3`}>
                <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input type="checkbox" checked={cfg.aplicar} onChange={e => set({ aplicar: e.target.checked })} className="mt-1 accent-brand-cyan w-4 h-4" />
                    <span>
                        <span className="block text-sm font-black text-slate-800">Usar esta lista en los pedidos y cotizaciones</span>
                        <span className="block text-xs text-slate-500">
                            Prendida: el precio de los productos con consumo cargado sale de esta lista, en lugar de su precio de lista y de sus
                            escalas por cantidad. Los descuentos propios del cliente se aplican encima, como siempre. Apagada: solo se ve acá.
                        </span>
                    </span>
                </label>
            </div>

            <div className={`${CARD} px-4 py-3`}>
                <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-1">Corte y costura general</h3>
                <p className="text-xs text-slate-500 mb-2">
                    Cada producto tiene su corte y costura por unidad (un short no cuesta lo mismo que una campera): se carga en
                    {' '}<b>Configurar productos</b>, debajo de las telas, con sus <b>valores agregados</b> (complejidad, riesgo…). Este valor es el de los productos que todavía no tienen el suyo.
                </p>
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
                    Corte y costura por unidad
                    <input type="number" min="0" step="0.01" value={cfg.corteCostura ?? 0} onChange={e => set({ corteCostura: e.target.value })}
                        className={`w-28 ${CAMPO}`} aria-label="Corte y costura general por unidad" />
                    {sim}
                </label>
            </div>

            <div className={`${CARD} px-4 py-3`}>
                <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-1">Franjas por cantidad de unidades</h3>
                <p className="text-xs text-slate-500 mb-3">Cada franja empieza en una cantidad de unidades del pedido y tiene su <b>margen</b> (% sobre el costo).</p>
                <div className="overflow-x-auto">
                    <table className="text-sm">
                        <thead>
                            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                                <th className="text-left pr-3 py-1 font-black">Franja</th>
                                <th className="text-left pr-3 py-1 font-black">Desde (unidades)</th>
                                <th className="text-left pr-3 py-1 font-black">Margen (%)</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {cfg.franjas.map((f, i) => (
                                <tr key={i}>
                                    <th scope="row" className="text-left pr-3 py-1 text-xs font-bold text-slate-500">Franja {i + 1}</th>
                                    <td className="pr-3 py-1"><input type="number" min="1" step="1" value={f.desde} disabled={i === 0} onChange={e => setFranja(i, 'desde', e.target.value)} className={`w-24 ${CAMPO} disabled:bg-slate-50 disabled:text-slate-400`} aria-label={`Franja ${i + 1}: desde unidades`} /></td>
                                    <td className="pr-3 py-1"><input type="number" min="0" step="0.5" value={f.margen} onChange={e => setFranja(i, 'margen', e.target.value)} className={`w-24 ${CAMPO}`} aria-label={`Franja ${i + 1}: margen`} /></td>
                                    <td className="py-1">
                                        {i > 0 && (
                                            <button type="button" onClick={() => set({ franjas: cfg.franjas.filter((_, k) => k !== i) })} title="Quitar franja" aria-label={`Quitar franja ${i + 1}`}
                                                className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center">
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {cfg.franjas.length < datos.maxFranjas && (
                    <button type="button" onClick={() => { const u = cfg.franjas[cfg.franjas.length - 1]; set({ franjas: [...cfg.franjas, { desde: Number(u.desde) * 2 || 2, margen: u.margen }] }); }}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-brand-cyan hover:underline">
                        <Plus size={13} /> Agregar franja
                    </button>
                )}
            </div>

            <div className={`${CARD} px-4 py-3 grid gap-4 md:grid-cols-3`}>
                <div>
                    <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-400 mb-2">Áreas de las telas</h3>
                    <div className="flex flex-wrap gap-1.5">
                        {datos.areas.map(a => {
                            const on = cfg.areas.includes(a.id);
                            return (
                                <button key={a.id} type="button" aria-pressed={on}
                                    onClick={() => set({ areas: on ? cfg.areas.filter(x => x !== a.id) : [...cfg.areas, a.id] })}
                                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${on ? 'bg-brand-cyan border-brand-cyan text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                    {a.nombre}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <label className="text-[11px] font-bold text-slate-500" title="Cada producto va en la moneda de su precio de lista. Esta es la de los que no tienen precio de lista y la del corte y costura general.">Moneda de los productos sin precio de lista
                    <Selector value={cfg.moneda} onChange={e => set({ moneda: e.target.value })} className="w-full mt-1" aria-label="Moneda de los productos sin precio de lista">
                        <option value="USD">Dólares (US$)</option>
                        <option value="UYU">Pesos ($)</option>
                    </Selector>
                </label>
                <label className="text-[11px] font-bold text-slate-500">Redondear el precio de venta hacia arriba
                    <Selector value={String(cfg.redondeo)} onChange={e => set({ redondeo: Number(e.target.value) })} className="w-full mt-1" aria-label="Redondeo">
                        {datos.redondeos.map(r => <option key={r} value={String(r)}>{r ? `a múltiplos de ${num(r, r < 1 ? 2 : 0)}` : 'Sin redondeo'}</option>)}
                    </Selector>
                </label>
            </div>

            <div className="flex justify-end gap-2">
                {cambiado && <button type="button" onClick={() => setCfg(original)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">Descartar</button>}
                <button type="button" onClick={guardar} disabled={!cambiado || guardando}
                    className="px-5 py-2 rounded-lg bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 disabled:opacity-40">
                    {guardando ? 'Guardando…' : 'Guardar'}
                </button>
            </div>
        </div>
    );
}
