import React from 'react';

/* ══════════════════════════════════════════════════════════════════════
   TABLA DE UNA TARIFA POR DATO TÉCNICO (19/10/2026)

   En horizontal como la planilla: el dato técnico arriba (puntadas o
   bajadas) y debajo el precio con su cuenta. La arma tablaDeTarifa
   (tarifasCobro.js). La usan Precios por cantidad y el recuadro de la
   tarifa en Precios Estándar.
   ══════════════════════════════════════════════════════════════════════ */

const money = (n) => (Number(n) || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// `conTitulo`: la franja con el nombre de la tarifa arriba (en Precios por cantidad; el recuadro de
// Precios Estándar ya tiene su título)
export default function TablaTarifa({ tabla, conTitulo = true }) {
    if (!tabla) return null;
    const { valores } = tabla.encabezado;
    return (
        <div className={conTitulo ? 'border-b border-slate-200' : 'rounded-lg border border-slate-200 bg-white overflow-hidden'}>
            {conTitulo && (
                <div className="flex items-center gap-2 pl-3 pr-4 py-2 bg-slate-100 border-l-4 border-brand-cyan">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-700">{tabla.titulo}</span>
                    <span className="text-[11px] text-slate-500">· {tabla.subtitulo}</span>
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <tbody>
                        <tr className="border-b border-slate-100">
                            <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-2 whitespace-nowrap w-40">{tabla.encabezado.etiqueta}</th>
                            {valores.map(v => (
                                <td key={v} className="px-3 py-2 text-center tabular-nums whitespace-nowrap border-l border-slate-100 text-slate-600 font-bold">
                                    {Number(v).toLocaleString('es-UY')}
                                </td>
                            ))}
                        </tr>
                        {tabla.filas.map((f, k) => (
                            <tr key={f.etiqueta} className={k < tabla.filas.length - 1 ? 'border-b border-slate-100' : ''}>
                                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 px-4 py-2 whitespace-nowrap">{f.etiqueta}</th>
                                {f.celdas.map((c, i) => (
                                    <td key={valores[i]} className="px-3 py-2 text-center tabular-nums whitespace-nowrap border-l border-slate-100"
                                        title={c.detalle ? `${Number(valores[i]).toLocaleString('es-UY')}: ${c.detalle}` : undefined}>
                                        <div className={f.destacada ? 'font-black text-slate-800' : 'text-slate-500'}>$ {money(c.precio)}</div>
                                        {c.detalle && <div className="text-[10px] leading-4 text-slate-400">{c.detalle}</div>}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
