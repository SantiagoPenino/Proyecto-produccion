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

// ═════════════════════════════════════════════════════════════════════════
//  [AVÍOS EN TABLA 15/10] Los avíos de la ficha como pidió Dirección: UNA tabla, una fila por avío, columnas = talles.
//  · Carga: "Única" (una celda que ocupa todo el ancho: "3 en todos los talles"), "Por talle" (medida o cantidad de cada
//    talle) o "Artículo por talle" (cada talle elige el artículo del catálogo: cierre de 15 cm o de 18 cm).
//  · Solo los talles de los grupos que vende el producto (gruposVisibles); con más de un grupo, se ve uno por vez.
//  · Exportar / Importar .CSV (separado por ;) para cargarlo en Excel.
//  Guarda lo mismo que la grilla vieja (porTalle, articuloPorTalle, talles[{talle, valor, avioId}]): la ficha impresa, la
//  bandeja de Costura y los PDF no cambian. Los valores de talles que no se ven (otros grupos) se conservan.
// ═════════════════════════════════════════════════════════════════════════
const TIPO_UNIDAD = { cm: 'cm de corte', m: 'metros', u: 'unidades', par: 'pares' };
const CARGAS = [['UNICA', 'Única'], ['TALLE', 'Por talle'], ['ARTICULO', 'Artículo por talle']];
const cargaDe = (av) => (!av.porTalle ? 'UNICA' : av.articuloPorTalle ? 'ARTICULO' : 'TALLE');
const celdaCls = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-1 py-1.5 text-center text-sm font-bold text-slate-800 outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100';
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Una línea de CSV en celdas (con comillas)
function celdasCsv(linea, sep) {
    const out = []; let cur = ''; let q = false;
    for (let k = 0; k < linea.length; k++) {
        const ch = linea[k];
        if (q) { if (ch === '"' && linea[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true;
        else if (ch === sep) { out.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    out.push(cur.trim());
    return out;
}

export function TablaAviosEditable({ avios, aviosCat, gruposVisibles, gruposTodos, puedePorTalle, onChange, onAgregar }) {
    const [ver, setVer] = React.useState(null);
    const archivo = React.useRef(null);
    const grupo = gruposVisibles.find(([g]) => g === ver) || gruposVisibles[0] || null;
    const talles = grupo ? grupo[1] : [];
    const ordenTodos = gruposTodos.flatMap(([, l]) => l);
    const tallesCsv = gruposVisibles.flatMap(([, l]) => l);
    const setAv = (i, patch) => onChange(avios.map((a, j) => (j === i ? { ...a, ...patch } : a)));
    const de = (av, t) => (av.talles || []).find(x => x.talle === t) || { talle: t, valor: '', avioId: '' };
    // La lista completa en el orden del molde (ese orden se imprime) + lo guardado de talles que ya no están
    const conTalle = (av, t, patch) => {
        const huerfanos = (av.talles || []).filter(x => !ordenTodos.includes(x.talle) && conValor(x));
        return [...ordenTodos.map(tl => (tl === t ? { ...de(av, tl), ...patch } : de(av, tl))), ...huerfanos];
    };
    const cambiarCarga = (i, c) => {
        const av = avios[i];
        if (c === 'UNICA') setAv(i, { porTalle: false, articuloPorTalle: false });
        else if (c === 'TALLE') setAv(i, { porTalle: true, articuloPorTalle: false, talles: (av.talles || []).map(t => ({ ...t, avioId: '' })) });
        else setAv(i, { porTalle: true, articuloPorTalle: true });
    };
    const copiarATodos = (i) => {
        const av = avios[i];
        const clave = av.articuloPorTalle ? 'avioId' : 'valor';
        const primero = talles.map(t => de(av, t)[clave]).find(v => v !== '' && v != null);
        if (primero == null) return;
        let lista = av.talles || [];
        talles.forEach(t => { lista = conTalle({ ...av, talles: lista }, t, { [clave]: primero }); });
        setAv(i, { talles: lista });
    };
    const nombreArt = (id) => aviosCat.find(c => String(c.AvioID) === String(id))?.Nombre || '';

    // ── CSV: Avío;Unidad;Carga;Única;<talles…> (artículo por talle: el nombre del artículo en cada talle) ──
    const exportar = () => {
        const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lineas = [['Avío', 'Unidad', 'Carga', 'Única', ...tallesCsv].map(celda).join(';')];
        avios.filter(a => a.nombre).forEach(a => {
            const c = cargaDe(a);
            lineas.push([a.nombre, a.unidad || 'u', CARGAS.find(([k]) => k === c)[1], c === 'UNICA' ? a.cantidad : '',
                ...tallesCsv.map(t => (c === 'UNICA' ? '' : c === 'ARTICULO' ? nombreArt(de(a, t).avioId) : de(a, t).valor))].map(celda).join(';'));
        });
        const url = URL.createObjectURL(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'avios_por_talle.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    };
    const importar = async (ev) => {
        const f = ev.target.files?.[0]; ev.target.value = '';
        if (!f) return;
        const texto = (await f.text()).replace(/^﻿/, '');
        const lineas = texto.split(/\r?\n/).filter(l => l.trim());
        if (lineas.length < 2) return;
        const sep = lineas[0].includes(';') ? ';' : ',';
        const [cab, ...filas] = lineas.map(l => celdasCsv(l, sep));
        const col = (n) => cab.findIndex(c => sinTildes(c) === sinTildes(n));
        let lista = [...avios];
        filas.forEach(c => {
            const nombre = c[col('Avío')] ?? c[0];
            if (!nombre) return;
            const cat = aviosCat.find(x => sinTildes(x.Nombre) === sinTildes(nombre));
            const carga = (CARGAS.find(([, t]) => sinTildes(t) === sinTildes(c[col('Carga')])) || ['UNICA'])[0];
            const k = lista.findIndex(a => sinTildes(a.nombre) === sinTildes(nombre));
            let av = k >= 0 ? lista[k] : { avioId: cat?.AvioID || '', nombre: cat?.Nombre || nombre, cantidad: 1, unidad: cat?.Unidad || 'u', medida: '', nota: '', porTalle: false, talles: [], articuloPorTalle: false };
            av = { ...av, porTalle: carga !== 'UNICA' && puedePorTalle, articuloPorTalle: carga === 'ARTICULO' && puedePorTalle };
            if (carga === 'UNICA' && c[col('Única')]) av.cantidad = String(c[col('Única')]).replace(',', '.');
            if (av.porTalle) cab.forEach((t, n) => {
                if (!ordenTodos.includes(t) || c[n] === '' || c[n] == null) return;
                av = { ...av, talles: conTalle(av, t, carga === 'ARTICULO'
                    ? { avioId: aviosCat.find(x => sinTildes(x.Nombre) === sinTildes(c[n]))?.AvioID || '' }
                    : { valor: String(c[n]).replace(',', '.') }) };
            });
            lista = k >= 0 ? lista.map((a, j) => (j === k ? av : a)) : [...lista, av];
        });
        onChange(lista);
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                {gruposVisibles.length > 1 && (
                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="tablist" aria-label="Grupo de talles a la vista">
                        {gruposVisibles.map(([g, l]) => (
                            <button key={g} type="button" role="tab" aria-selected={grupo?.[0] === g} onClick={() => setVer(g)}
                                className={`px-3 py-1.5 text-xs font-bold border-r border-slate-200 last:border-r-0 ${grupo?.[0] === g ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-slate-500 hover:text-slate-700'}`}>
                                {g} <span className="font-normal text-slate-400">{String(l[0]).replace(/fem$/i, '')}–{String(l[l.length - 1]).replace(/fem$/i, '')}</span>
                            </button>
                        ))}
                    </div>
                )}
                <span className="ml-auto flex gap-2">
                    <button type="button" onClick={exportar} disabled={!avios.length} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300 disabled:opacity-40">Exportar plantilla .CSV</button>
                    <button type="button" onClick={() => archivo.current?.click()} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300">Importar .CSV</button>
                    <input ref={archivo} type="file" accept=".csv,.txt" className="hidden" onChange={importar} />
                </span>
            </div>
            {avios.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-separate border-spacing-x-1 border-spacing-y-1.5 text-sm">
                        <colgroup><col style={{ width: 230 }} /><col style={{ width: 150 }} />{talles.map(t => <col key={t} />)}<col style={{ width: 64 }} /></colgroup>
                        <thead>
                            <tr className="text-[11px] font-bold text-slate-500">
                                <th className="text-left px-1">Avío</th>
                                <th className="text-center">Carga</th>
                                {talles.map(t => <th key={t} className="text-center font-mono">{grupo?.[0] === 'Femenino' ? t.replace(/fem$/i, '') : t}</th>)}
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {avios.map((av, i) => {
                                const c = cargaDe(av);
                                const unidad = av.unidad || 'u';
                                return (
                                    <React.Fragment key={i}>
                                    <tr className="align-middle">
                                        <td className="px-1">
                                            <Selector value={av.avioId || ''} title="Avío del catálogo"
                                                onChange={e => { const x = aviosCat.find(y => String(y.AvioID) === e.target.value); setAv(i, x ? { avioId: x.AvioID, nombre: x.Nombre, unidad: x.Unidad || 'u' } : { avioId: '' }); }}
                                                claseBoton={`flex w-full items-center justify-between gap-1 rounded-lg border bg-white px-2 py-1 text-left text-sm font-black text-slate-800 ${av.avioId ? 'border-transparent hover:border-slate-200' : 'border-amber-300'}`} anchoLista={280}>
                                                <option value="">{aviosCat.filter(x => x.Activo).length ? 'Elegí el avío…' : 'Cargá avíos en "Catálogo de avíos"'}</option>
                                                {aviosCat.filter(x => x.Activo || x.AvioID === av.avioId).map(x => <option key={x.AvioID} value={x.AvioID}>{x.Nombre}{x.Activo ? '' : ' (inactivo)'}</option>)}
                                            </Selector>
                                            <div className="px-2 text-[11px] text-slate-500">{c === 'ARTICULO' ? 'artículo del catálogo' : TIPO_UNIDAD[unidad] || unidad}</div>
                                        </td>
                                        <td className="text-center">
                                            {puedePorTalle ? (
                                                <Selector value={c} onChange={e => cambiarCarga(i, e.target.value)} anchoLista={200} title="Cómo se carga este avío"
                                                    claseBoton={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold ${c === 'UNICA' ? 'border-slate-200 bg-white text-slate-600' : 'border-indigo-300 bg-indigo-50 text-indigo-700'}`}>
                                                    {CARGAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                                                </Selector>
                                            ) : <span className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-500">Única</span>}
                                        </td>
                                        {c === 'UNICA' || !talles.length ? (
                                            <td colSpan={Math.max(1, talles.length)}>
                                                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                                                    <input type="number" min="0.01" step="0.01" value={av.cantidad} aria-label={`${av.nombre || 'Avío'}: cantidad por prenda`}
                                                        onChange={e => setAv(i, { cantidad: e.target.value })}
                                                        className="w-16 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-center text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-100" />
                                                    <span className="text-xs text-slate-600 whitespace-nowrap">{unidad} en todos los talles</span>
                                                    <input value={av.medida || ''} placeholder="medida (si la tiene, ej. 55 cm)" onChange={e => setAv(i, { medida: e.target.value })}
                                                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-0.5 text-xs text-slate-600 outline-none hover:border-slate-200 focus:border-indigo-300 focus:bg-white" />
                                                </div>
                                            </td>
                                        ) : talles.map(t => (
                                            <td key={t}>
                                                {c === 'ARTICULO' ? (
                                                    <Selector value={de(av, t).avioId ? String(de(av, t).avioId) : ''} onChange={e => setAv(i, { talles: conTalle(av, t, { avioId: e.target.value }) })} anchoLista={240}
                                                        claseBoton={`flex w-full items-center justify-center truncate ${celdaCls} !py-1.5 !text-xs`}
                                                        renderValor={o => (o?.value ? <span className="truncate" title={o.texto}>{o.texto}</span> : <span className="text-slate-300">—</span>)}>
                                                        <option value="">— igual que la línea —</option>
                                                        {aviosCat.filter(x => x.Activo || String(x.AvioID) === String(de(av, t).avioId)).map(x => <option key={x.AvioID} value={String(x.AvioID)}>{x.Nombre}</option>)}
                                                    </Selector>
                                                ) : (
                                                    <input type="number" min="0" step="0.01" value={de(av, t).valor} aria-label={`${av.nombre || 'Avío'} talle ${nombreTalle(t)}`}
                                                        onChange={e => setAv(i, { talles: conTalle(av, t, { valor: e.target.value }) })} className={celdaCls} />
                                                )}
                                            </td>
                                        ))}
                                        <td className="text-right whitespace-nowrap">
                                            {c !== 'UNICA' && talles.length > 0 && (
                                                <button type="button" onClick={() => copiarATodos(i)} title="Copiar el primer valor a todos los talles de este grupo" className="px-1 text-xs font-bold text-slate-400 hover:text-indigo-600">→ todos</button>
                                            )}
                                            <button type="button" title="Quitar este avío" onClick={() => onChange(avios.filter((_, j) => j !== i))} className="px-1.5 font-black text-red-400 hover:text-red-600">×</button>
                                        </td>
                                    </tr>
                                    {/* La nota del avío (dónde va, cómo se cose): renglón propio, a lo ancho, con letra legible */}
                                    <tr>
                                        <td colSpan={3 + Math.max(1, talles.length)} className="px-1 pb-2 border-b border-slate-100">
                                            <input value={av.nota || ''} placeholder="Nota: dónde va y cómo se pone (ej. centro de la espalda, se cose al pegar el cuello)" onChange={e => setAv(i, { nota: e.target.value })}
                                                aria-label={`Nota de ${av.nombre || 'este avío'}`}
                                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />
                                        </td>
                                    </tr>
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <button type="button" onClick={onAgregar} className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-500 hover:border-slate-400">+ Agregar avío</button>
        </div>
    );
}
