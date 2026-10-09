// ═════════════════════════════════════════════════════════════════════════
//  [AVÍOS POR TALLE] Ficha de diseño: avíos cuya medida o cantidad cambia según el talle (09/10)
//  Un avío es "medida única" (cantidad + medida, como siempre) o varía por talle: una celda por
//  talle del molde de TizadaPro. Según la unidad del catálogo, el valor es la medida (m, cm) o la
//  cantidad (u, par). Opcional: el artículo cambia por talle (cierre de 15 cm en S–M, de 18 en L–XXL).
//  Datos: dbo.ProductoAviosTalle (docs/migrations/configurador_ficha_avios_talle.sql).
// ═════════════════════════════════════════════════════════════════════════
import React from 'react';
import Selector from '../ui/Selector';

export const esMedida = (unidad) => ['m', 'cm'].includes(unidad);
const nombreTalle = (t) => String(t).replace(/fem$/i, ' fem');
const num = (v) => String(Number(v)).replace('.', ',');
const conValor = (t) => (t.valor !== '' && t.valor != null) || !!t.avioId;

// "S–M 55 cm · L–XL 60 cm": talles seguidos con el mismo valor (y el mismo artículo) van juntos.
// Mismo texto que arma el backend para la bandeja de Costura y los PDF (solicitudesVendedorFichaProducto.js).
export const resumenPorTalle = (av, aviosCat) => {
    const articulo = (id) => (id && String(id) !== String(av.avioId) ? aviosCat.find(c => String(c.AvioID) === String(id))?.Nombre : null);
    const etiqueta = (t) => [articulo(t.avioId), t.valor !== '' && t.valor != null ? `${num(t.valor)} ${av.unidad || 'u'}` : null].filter(Boolean).join(' ');
    const grupos = [];
    (av.talles || []).filter(conValor).forEach(t => {
        const e = etiqueta(t);
        const ult = grupos[grupos.length - 1];
        if (ult && ult.e === e) ult.hasta = t.talle; else grupos.push({ desde: t.talle, hasta: t.talle, e });
    });
    return grupos.map(g => `${g.desde === g.hasta ? nombreTalle(g.desde) : `${nombreTalle(g.desde)}–${nombreTalle(g.hasta)}`} ${g.e}`.trim()).join(' · ');
};

// Grilla de un avío: columnas = talles del molde en orden (por curva), más los que tienen valor
// guardado pero ya no están en el molde (no se pierden en silencio: se ven aparte).
export function GrillaAvioTalles({ av, grupos, aviosCat, onChange }) {
    const delMolde = grupos.flatMap(([, l]) => l);
    const guardados = av.talles || [];
    const huerfanos = guardados.filter(t => !delMolde.includes(t.talle) && conValor(t)).map(t => t.talle);
    const columnas = [...grupos, ...(huerfanos.length ? [['Ya no están en el molde', huerfanos]] : [])];
    const orden = [...delMolde, ...huerfanos];
    const de = (talle) => guardados.find(t => t.talle === talle) || { talle, valor: '', avioId: '' };
    // Siempre se devuelve la lista completa en el orden del molde (ese orden se imprime)
    const cambiar = (talle, patch) => onChange({ talles: orden.map(tl => (tl === talle ? { ...de(tl), ...patch } : de(tl))) });
    const primero = guardados.find(t => t.valor !== '' && t.valor != null)?.valor;
    const medida = esMedida(av.unidad);
    const unidad = av.unidad || 'u';

    if (!orden.length) {
        return <p className="w-full text-[11px] text-amber-700">El molde no tiene talles cargados en TizadaPro: sin talles, el avío va con medida única.</p>;
    }
    return (
        <div className="w-full rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                <span className="font-bold text-slate-600">{medida ? `Medida en ${unidad} de cada talle` : `Cantidad (${unidad}) de cada talle`}</span>
                {primero != null && (
                    <button type="button" onClick={() => onChange({ talles: orden.map(tl => ({ ...de(tl), valor: primero })) })}
                        className="font-bold text-indigo-600 hover:underline" title="Pone el primer valor cargado en todos los talles">
                        Copiar {num(primero)} a todos
                    </button>
                )}
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-slate-600">
                    <input type="checkbox" checked={!!av.articuloPorTalle} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                        onChange={e => onChange(e.target.checked ? { articuloPorTalle: true } : { articuloPorTalle: false, talles: guardados.map(t => ({ ...t, avioId: '' })) })} />
                    El artículo cambia según el talle
                </label>
            </div>
            <div className="overflow-x-auto">
                <table className="border-separate border-spacing-0 text-xs">
                    <thead>
                        <tr>
                            <th className="w-20" />
                            {columnas.map(([g, l]) => (
                                <th key={g} colSpan={l.length} className={`px-1 pb-0.5 text-left text-[9px] font-black uppercase tracking-wider ${g.startsWith('Ya no') ? 'text-amber-600' : 'text-slate-400'}`}>{g}</th>
                            ))}
                        </tr>
                        <tr>
                            <th className="w-20" />
                            {columnas.flatMap(([g, l]) => l.map(t => (
                                <th key={t} className="px-0.5 pb-1 text-center font-mono text-[10.5px] font-bold text-slate-600">{g === 'Femenino' ? t.replace(/fem$/i, '') : t}</th>
                            )))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="pr-2 text-[10px] font-bold text-slate-500">{medida ? unidad : 'Cantidad'}</td>
                            {orden.map(t => (
                                <td key={t} className="px-0.5">
                                    <input type="number" min="0" step="0.01" value={de(t).valor} aria-label={`${av.nombre || 'Avío'} talle ${nombreTalle(t)}`}
                                        onChange={e => cambiar(t, { valor: e.target.value })}
                                        className="w-14 rounded-md border border-slate-200 bg-white px-1 py-1 text-center font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200" />
                                </td>
                            ))}
                        </tr>
                        {av.articuloPorTalle && (
                            <tr>
                                <td className="pr-2 pt-1 text-[10px] font-bold text-slate-500">Artículo</td>
                                {orden.map(t => (
                                    <td key={t} className="px-0.5 pt-1">
                                        <Selector value={de(t).avioId ? String(de(t).avioId) : ''} onChange={e => cambiar(t, { avioId: e.target.value })} anchoLista={240}
                                            claseBoton="flex w-14 items-center justify-center truncate rounded-md border border-slate-200 bg-white px-1 py-1 text-[10px] font-bold text-slate-600"
                                            renderValor={o => (o?.value ? <span className="truncate" title={o.texto}>{o.texto}</span> : <span className="text-slate-300">igual</span>)}>
                                            <option value="" descripcion="El mismo artículo de la línea">Igual que la línea</option>
                                            {aviosCat.filter(x => x.Activo || String(x.AvioID) === String(de(t).avioId)).map(x => <option key={x.AvioID} value={String(x.AvioID)}>{x.Nombre}</option>)}
                                        </Selector>
                                    </td>
                                ))}
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// Tabla avío × talle para la vista imprimible (la misma que sale en los PDF)
export function TablaAviosTalle({ avios, aviosCat }) {
    const conTalle = avios.filter(a => a.porTalle && (a.nombre || '').trim() && (a.talles || []).some(conValor));
    if (!conTalle.length) return null;
    const talles = [];
    conTalle.forEach(a => a.talles.filter(conValor).forEach(t => { if (!talles.includes(t.talle)) talles.push(t.talle); }));
    const celda = (a, talle) => {
        const t = (a.talles || []).find(x => x.talle === talle);
        if (!t || !conValor(t)) return '';
        const art = t.avioId && String(t.avioId) !== String(a.avioId) ? aviosCat.find(c => String(c.AvioID) === String(t.avioId))?.Nombre : null;
        const valor = t.valor !== '' && t.valor != null ? num(t.valor) : '';
        return art ? <>{art}{valor ? <div>{valor}</div> : null}</> : valor;
    };
    return (
        <table className="w-full text-xs mt-3">
            <thead><tr className="border-b-2 border-slate-800">
                <th className="py-1 pr-2 text-left">Avío por talle</th>
                {talles.map(t => <th key={t} className="py-1 px-1 text-center font-mono">{nombreTalle(t)}</th>)}
            </tr></thead>
            <tbody>
                {conTalle.map((a, i) => (
                    <tr key={i} className="border-b border-slate-100 align-top">
                        <td className="py-1 pr-2"><b>{a.nombre}</b> <span className="text-slate-500">({a.unidad || 'u'})</span></td>
                        {talles.map(t => <td key={t} className="py-1 px-1 text-center">{celda(a, t)}</td>)}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
