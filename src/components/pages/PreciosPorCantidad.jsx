import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { BadgePercent, Info, RefreshCw } from 'lucide-react';
import api from '../../services/apiClient';
import TablaTarifa from './TablaTarifa';
import { tablaDeTarifa, cobroBasico, TEXTOS_TARIFA } from './tarifasCobro';

/* ══════════════════════════════════════════════════════════════════════
   PRECIOS POR CANTIDAD  (/vendedores/precios-cantidad) — 19/10/2026

   Solo lectura, como la planilla de precios: TODO el nomenclador (los
   artículos activos, tengan o no precio de lista) con su precio de lista
   y su moneda y, donde hay franjas de cantidad, el precio y el % de
   descuento de cada franja. «Todas» muestra un cuadro por área, uno
   debajo del otro; cada área también tiene su pestaña.
     · Los precios de las franjas los calcula el motor de precios (GET
       /prices/por-cantidad, pricesController.getPreciosPorCantidad), el
       mismo que cotiza los pedidos, sin cliente: es lo que paga un cliente
       sin excepciones ni perfiles propios.
     · Las franjas son los mínimos de los perfiles de precios globales del
       área (se editan en Perfiles de Precios, no acá).
     · Bordado y Estampado no se cobran por la lista: llevan un aviso con
       la tarifa por puntadas o por bajadas.
   No guarda nada: se arma cada vez que se abre.
   ══════════════════════════════════════════════════════════════════════ */

const TODAS = 'TODAS';
const SIMBOLO = { UYU: '$', USD: 'US$' };
// Unidad de StockArt.UM para el encabezado de las franjas
const UNIDAD = { M: 'm', M2: 'm²', U: 'u.', UN: 'u.', UNI: 'u.' };
// Cómo se vende cada variante, para su fila
const VENTA_POR = { M: 'por metro', M2: 'por m²', U: 'por unidad', UN: 'por unidad', UNI: 'por unidad' };

const money = (n) => (Number(n) || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctTexto = (p) => `${Math.abs(p).toLocaleString('es-UY', { maximumFractionDigits: 2 })} %`;

// Precio de una franja: el precio arriba y el % debajo. Sin descuento, el % va en gris.
function CeldaFranja({ celda }) {
    if (!celda || celda.precio == null) return <td className="px-3 py-2 text-center text-slate-300 border-l border-slate-100">—</td>;
    const { precio, pct, origen, moneda } = celda;
    const conDescuento = pct != null && pct > 0.004;
    const conRecargo = pct != null && pct < -0.004;
    const simbolo = SIMBOLO[moneda] || '';
    const titulo = conDescuento ? `${simbolo} ${money(precio)}: ${pctTexto(pct)} menos que la lista${origen ? ` (${origen})` : ''}`
        : conRecargo ? `${simbolo} ${money(precio)}: ${pctTexto(pct)} más que la lista${origen ? ` (${origen})` : ''}`
            : pct == null ? `${simbolo} ${money(precio)}${origen ? ` (${origen})` : ''}` : 'Mismo precio que la lista';
    return (
        <td className="px-3 py-2 text-center tabular-nums whitespace-nowrap border-l border-slate-100" title={titulo}>
            <div className={conDescuento ? 'font-bold text-slate-800' : 'text-slate-500'}>{money(precio)}</div>
            <div className={`text-[11px] leading-4 ${conDescuento ? 'font-bold text-emerald-600' : conRecargo ? 'font-bold text-red-500' : 'text-slate-300'}`}>
                {conDescuento ? `−${pctTexto(pct)}` : conRecargo ? `+${pctTexto(pct)}` : pct == null ? '' : 'sin descuento'}
            </div>
        </td>
    );
}

// El cuadro de un área, con sus tres niveles bien distintos:
//   1. ÁREA      → banda de color arriba del cuadro: nombre, cantidad de artículos y franjas (y el aviso de
//                  Bordado o Estampado, si va).
//   2. VARIANTE  → fila con barra de color a la izquierda y fondo gris: nombre, cantidad y unidad de venta.
//   3. ARTÍCULO  → con sangría y una línea guía que lo cuelga de su variante.
function CuadroArea({ matriz }) {
    const franjas = matriz.franjas || [];
    const columnas = 3 + franjas.length;

    // Los artículos agrupados por variante (DTF Textil, DTF UV…), en el orden en que llegan, con la unidad
    // de venta del grupo si es una sola (los cuadros por unidad, las lonas por m²…)
    const grupos = useMemo(() => {
        const out = [];
        (matriz.articulos || []).forEach(a => {
            const nombre = a.variante || 'Sin variante';
            const g = out[out.length - 1];
            if (g && g.nombre === nombre) g.articulos.push(a);
            else out.push({ nombre, articulos: [a] });
        });
        out.forEach(g => {
            const us = [...new Set(g.articulos.map(a => String(a.unidad || '').toUpperCase()))];
            g.unidad = us.length === 1 ? (VENTA_POR[us[0]] || null) : null;
        });
        return out;
    }, [matriz]);

    // Unidad del encabezado de las franjas: la de los artículos del área, si es una sola
    const unidad = useMemo(() => {
        const us = [...new Set((matriz.articulos || []).map(a => UNIDAD[String(a.unidad || '').toUpperCase()] || null))];
        return us.length === 1 ? us[0] : null;
    }, [matriz]);

    const cantidad = matriz.articulos.length;

    return (
        <section className="mb-6 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {/* Nivel 1: el área */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 bg-brand-cyan text-white">
                <h2 className="text-base font-black tracking-tight uppercase">{matriz.nombre}</h2>
                <span className="text-xs font-bold text-white/90">
                    {cantidad} {cantidad === 1 ? 'artículo' : 'artículos'}
                    {' · '}{franjas.length > 0 ? `precios por cantidad desde ${franjas.map(q => q.toLocaleString('es-UY')).join(', ')}${unidad ? ` ${unidad}` : ''}` : matriz.tarifa ? `se cobra ${(TEXTOS_TARIFA[matriz.tarifa.tipo]?.cobro || '').toLowerCase()}` : 'sin precios por cantidad'}
                </span>
            </div>
            {matriz.aviso && (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border-b border-amber-200 px-4 py-2">
                    <Info size={15} className="mt-0.5 shrink-0" /> <span>{matriz.aviso}</span>
                </div>
            )}
            {matriz.tarifa && <TablaTarifa tabla={tablaDeTarifa(matriz.tarifa)} />}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                            <th className="text-left font-bold px-4 py-2.5">Artículo</th>
                            <th className="text-center font-bold px-3 py-2.5 border-l border-slate-200 w-24">Moneda</th>
                            <th className="text-center font-bold px-3 py-2.5 border-l border-slate-200 whitespace-nowrap w-36">Precio de lista</th>
                            {franjas.map(q => (
                                <th key={q} className="text-center font-bold px-3 py-2.5 border-l border-slate-200 whitespace-nowrap w-32">
                                    Desde {q.toLocaleString('es-UY')}{unidad ? ` ${unidad}` : ''}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {grupos.length === 0 && (
                            <tr><td colSpan={columnas} className="px-4 py-8 text-center text-slate-400 text-sm">Esta área no tiene artículos.</td></tr>
                        )}
                        {grupos.map(g => (
                            <React.Fragment key={g.nombre}>
                                {/* Nivel 2: la variante */}
                                <tr className="bg-slate-100 border-t-2 border-slate-200">
                                    <td colSpan={columnas} className="p-0">
                                        <div className="flex items-center gap-2 pl-3 pr-4 py-2 border-l-4 border-brand-cyan">
                                            <span className="text-xs font-black uppercase tracking-wider text-slate-700">{g.nombre}</span>
                                            <span className="text-[11px] text-slate-500">
                                                · {g.articulos.length} {g.articulos.length === 1 ? 'artículo' : 'artículos'}{g.unidad ? ` · ${g.unidad}` : ''}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                                {/* Nivel 3: los artículos de la variante */}
                                {g.articulos.map((a, k) => {
                                    const porCantidad = Object.fromEntries(a.celdas.map(c => [c.cantidad, c]));
                                    // Bordado y estampado: el precio básico de la tarifa del área; el resto, en su tabla de arriba
                                    const basico = a.porTarifa ? cobroBasico(matriz.tarifa) : null;
                                    const ultimo = k === g.articulos.length - 1;
                                    return (
                                        <tr key={`${a.proIdProducto}-${a.moneda || 'sin'}`} className={`border-b border-slate-100 hover:bg-cyan-50/40 ${a.activo ? '' : 'opacity-60'}`}>
                                            <td className="relative py-2 pl-10 pr-4">
                                                {/* Línea guía: baja desde la variante y dobla hacia el artículo */}
                                                <span className={`absolute left-5 top-0 w-px bg-brand-cyan/30 ${ultimo ? 'h-1/2' : 'h-full'}`} aria-hidden="true" />
                                                <span className="absolute left-5 top-1/2 w-3 h-px bg-brand-cyan/30" aria-hidden="true" />
                                                <div className="font-bold text-slate-700">
                                                    {a.descripcion}
                                                    {!a.activo && <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 text-[9px] leading-4 font-black tracking-wider align-middle">INACTIVO</span>}
                                                </div>
                                                <div className="text-[11px] text-slate-400 font-mono">Cód. {a.codArticulo}</div>
                                            </td>
                                            <td className="px-3 py-2 text-center border-l border-slate-100">
                                                {a.moneda ? (
                                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] leading-4 font-black tracking-wider ${a.moneda === 'USD' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>
                                                        {SIMBOLO[a.moneda]}
                                                    </span>
                                                ) : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-3 py-2 text-center tabular-nums border-l border-slate-100">
                                                {basico
                                                    ? (
                                                        <span title={basico.titulo}>
                                                            <span className="block font-black text-slate-800">{money(basico.precio)}</span>
                                                            <span className="block text-[10px] leading-4 font-bold text-brand-cyan whitespace-nowrap">{basico.texto}</span>
                                                        </span>
                                                    )
                                                    : a.precioLista != null
                                                        ? <span className="font-black text-slate-800">{money(a.precioLista)}</span>
                                                        : <span className="text-xs text-slate-400" title="El artículo no tiene precio de lista cargado (o está en 0)">Sin precio</span>}
                                            </td>
                                            {franjas.map(q => <CeldaFranja key={q} celda={porCantidad[q]} />)}
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export default function PreciosPorCantidad() {
    const [areas, setAreas] = useState([]);
    const [area, setArea] = useState(TODAS);
    const [inactivos, setInactivos] = useState(false);
    const [secciones, setSecciones] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        api.get('/prices/por-cantidad', { params: { inactivos: inactivos ? 1 : undefined } })
            .then(r => setAreas(r.data?.areas || []))
            .catch(e => toast.error(e.response?.data?.error || 'No se pudieron cargar las áreas'));
    }, [inactivos]);

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/prices/por-cantidad', { params: { area, inactivos: inactivos ? 1 : undefined } });
            setSecciones(area === TODAS ? (r.data?.secciones || []) : [r.data]);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudieron calcular los precios');
            setSecciones([]);
        } finally { setLoading(false); }
    }, [area, inactivos]);

    useEffect(() => { cargar(); }, [cargar]);

    const totalArticulos = areas.reduce((s, a) => s + a.articulos, 0);
    const pestanas = [{ area: TODAS, nombre: 'Todas', articulos: totalArticulos }, ...areas];

    return (
        <div className="px-4 pt-3 pb-4 md:px-6 md:pt-0 md:pb-6 w-full font-sans text-slate-800">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center">
                        <BadgePercent size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight text-slate-800">Precios por cantidad</h1>
                        <p className="text-xs text-slate-500">Todo el nomenclador con su precio de lista y, donde hay franjas de cantidad, el precio de cada una</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none" title="Suma los artículos marcados como inactivos (no se muestran en las listas)">
                        <input type="checkbox" checked={inactivos} onChange={e => setInactivos(e.target.checked)} className="accent-brand-cyan" />
                        Incluir inactivos
                    </label>
                    <button onClick={cargar} disabled={loading}
                        className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                        title="Volver a calcular los precios">
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* «Todas» y una pestaña por área */}
            <div className="flex flex-wrap gap-2 mb-4">
                {pestanas.map(a => (
                    <button key={a.area} onClick={() => setArea(a.area)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${a.area === area
                            ? 'bg-brand-cyan border-brand-cyan text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        title={`${a.articulos} artículos`}>
                        {a.nombre}
                    </button>
                ))}
            </div>

            {loading && <div className="py-10 text-center text-slate-400 text-sm">Calculando precios…</div>}
            {!loading && secciones.map(m => <CuadroArea key={m.area} matriz={m} />)}

            {/* Pie: de dónde salen los números */}
            <div className="mt-2 flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <Info size={13} className="mt-0.5 shrink-0" />
                <span>
                    Los precios de las franjas salen del <b>motor de precios</b>, el mismo que cotiza los pedidos, para un cliente <b>sin excepciones ni perfiles propios</b>:
                    {' '}un cliente con precio especial puede pagar menos. <b>Desde N</b> es el precio por unidad cuando el pedido llega a esa cantidad;
                    {' '}el % es cuánto baja respecto de la lista. Pasá el mouse por un precio para ver qué perfil lo da.
                    {' '}Un área sin columnas de franjas no tiene precios por cantidad: todos pagan la lista. <b>Sin precio</b> = el artículo no tiene precio de lista cargado (o está en 0).
                    {' '}Las franjas y los % se cambian en Perfiles de Precios; el precio de lista, en Precios Estándar.
                </span>
            </div>
        </div>
    );
}
