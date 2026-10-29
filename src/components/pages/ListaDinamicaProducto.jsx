import React, { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import api from '../../services/apiClient';
import { precioPorCantidad } from '../../utils/escalasPrecio';

/* ══════════════════════════════════════════════════════════════════════
   LISTA DINÁMICA DEL PRODUCTO — paso «Precios» de Configurar productos (29/10/2026)

   Al lado del precio de lista y de las escalas del producto, lo que da la Lista de precios dinámica para
   ese producto en cada franja de unidades (tela × consumo + corte y costura + margen + valores agregados),
   para compararlos. Solo lectura: lo calcula el servidor (GET /prices/lista-dinamica/producto/:proId)
   con lo GUARDADO; `version` cambia al guardar y vuelve a pedirlo. El catálogo de cada franja sale de lo
   que está en pantalla (precioPorCantidad, la misma regla de las escalas).
   ══════════════════════════════════════════════════════════════════════ */

const SIMBOLO = { UYU: '$', USD: 'US$' };
const num = (n, d = 2) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('es-UY', { minimumFractionDigits: d, maximumFractionDigits: d }));
const plata = (n, mon) => `${SIMBOLO[mon] || ''} ${num(n)}`;
const textoValores = (vs) => vs.map(v => `${v.nombre} ${v.tipo === 'PORCENTAJE' ? `+${num(v.valor, v.valor % 1 ? 1 : 0)} %` : `+${SIMBOLO[v.moneda] || ''} ${num(v.valor)}`}`).join(', ');

export default function ListaDinamicaProducto({ proId, version, precioLista, monedaLista, escalas, hayCambios }) {
    const [d, setD] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!proId) return undefined;
        let vivo = true;
        api.get(`/prices/lista-dinamica/producto/${proId}`)
            .then(r => { if (vivo) { setD(r.data); setError(''); } })
            .catch(e => { if (vivo) setError(e.response?.data?.error || 'No se pudo calcular la lista dinámica'); });
        return () => { vivo = false; };
    }, [proId, version]);

    const p = d?.producto;
    const lista = Number(precioLista) > 0 ? Number(precioLista) : null;
    const monCat = String(monedaLista || '').toUpperCase() === 'USD' ? 'USD' : 'UYU';
    const mismaMoneda = p && p.moneda === monCat;

    return (
        <div className="border border-slate-200 rounded-xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                    <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                        <Calculator size={13} className="text-brand-cyan" aria-hidden="true" /> Lista de precios dinámica
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Tela × consumo + corte y costura + margen de la franja + valores agregados, comparado con su precio de catálogo.</p>
                </div>
                {d && (
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${d.config.aplicar ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
                        title={d.config.aplicar ? 'Los pedidos de este producto se cobran con la lista dinámica' : 'Se prende en Gestión de Precios › Lista de precios dinámica'}>
                        {d.config.aplicar ? 'Se aplica en los pedidos' : 'Todavía no se aplica en los pedidos'}
                    </span>
                )}
            </div>

            {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
            {!d && !error && <p className="text-xs text-slate-400">Calculando…</p>}
            {d && d.faltaSQL && <p className="text-xs font-bold text-amber-700">Falta correr backend/scripts/lista_precios_dinamica.sql en esta base.</p>}
            {d && !d.faltaSQL && !p && <p className="text-xs text-amber-700">El producto no tiene telas: elegilas en «Molde, telas y apliques», con el consumo de cada una.</p>}
            {p && !p.lista && <p className="text-xs text-amber-700">{p.avisos.join(' ')}</p>}

            {p?.lista && (
                <>
                    <p className="text-xs text-slate-600 mb-2">
                        Con <b>{p.tela.nombre}</b> ({num(p.tela.consumo, 2)} m por unidad) · corte y costura{' '}
                        {p.corteCostura.propio ? <b>{plata(p.corteCostura.costo, p.corteCostura.moneda)}</b> : 'general'}
                        {p.valores?.length ? <> · valores agregados: <b>{textoValores(p.valores)}</b></> : null}
                        {' '}· en {p.moneda === 'USD' ? 'dólares' : 'pesos'}
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-3 py-1.5 text-left">Por unidad</th>
                                    {p.lista.map(r => <th key={r.desdeUnidades} className="px-3 py-1.5 text-right whitespace-nowrap">desde {r.desdeUnidades} u.</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="border-t border-slate-100">
                                    <th scope="row" className="px-3 py-1.5 text-left font-bold text-slate-600">Lista dinámica</th>
                                    {p.lista.map(r => (
                                        <td key={r.desdeUnidades} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                                            <b className="text-slate-800">{plata(r.precio, p.moneda)}</b>
                                            <span className="block text-[10px] text-slate-400">costo {num(r.costoUnitario)} · +{num(r.margen, r.margen % 1 ? 1 : 0)} %</span>
                                        </td>
                                    ))}
                                </tr>
                                <tr className="border-t border-slate-100">
                                    <th scope="row" className="px-3 py-1.5 text-left font-bold text-slate-600">Precio de catálogo</th>
                                    {p.lista.map(r => {
                                        const c = lista ? precioPorCantidad(lista, escalas, r.desdeUnidades) : null;
                                        return (
                                            <td key={r.desdeUnidades} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                                                {c?.precio ? <>{plata(c.precio, monCat)}<span className="block text-[10px] text-slate-400">{c.desde ? `escala desde ${c.desde}` : 'precio de lista'}</span></> : <span className="text-slate-400">sin precio</span>}
                                            </td>
                                        );
                                    })}
                                </tr>
                                {mismaMoneda && lista && (
                                    <tr className="border-t border-slate-100">
                                        <th scope="row" className="px-3 py-1.5 text-left font-bold text-slate-600">Dinámica vs. catálogo</th>
                                        {p.lista.map(r => {
                                            const c = precioPorCantidad(lista, escalas, r.desdeUnidades);
                                            const dif = c?.precio ? Math.round((r.precio / c.precio - 1) * 1000) / 10 : null;
                                            return (
                                                <td key={r.desdeUnidades} className={`px-3 py-1.5 text-right tabular-nums font-bold ${dif == null ? 'text-slate-400' : dif > 0 ? 'text-sky-700' : dif < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                    {dif == null ? '—' : dif === 0 ? 'igual' : `${dif > 0 ? '+' : ''}${num(dif, 1)} %`}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                        {hayCambios ? 'Tenés cambios sin guardar: la lista dinámica se recalcula al guardar. ' : ''}
                        Los márgenes por franja se cambian en Gestión de Precios › Lista de precios dinámica; el consumo, el corte y costura y los valores agregados, en «Molde, telas y apliques».
                        {!mismaMoneda && lista ? ` El precio de catálogo está en ${monCat === 'USD' ? 'dólares' : 'pesos'} y la lista dinámica en ${p.moneda === 'USD' ? 'dólares' : 'pesos'}: no se comparan.` : ''}
                    </p>
                </>
            )}
        </div>
    );
}
