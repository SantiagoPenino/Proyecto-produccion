// ═════════════════════════════════════════════════════════════════════════
//  [MEDIDAS] Ficha de diseño: medidas de la prenda (15/10)
//  El dibujo con letras (A, B, C…), una fila por medida y una columna por talle (en cm), con los
//  mismos grupos de talle que los avíos. La medida sale del nomenclador (Catálogo › Medidas) y trae
//  su "cómo medir"; cada producto puede cambiarlo. Las principales salen grandes en la ficha impresa.
//  Datos: dbo.ProductoMedidas / ProductoMedidasTalle (docs/migrations/configurador_medidas_prenda.sql).
// ═════════════════════════════════════════════════════════════════════════
import React from 'react';
import Selector from '../ui/Selector';

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const celdaCls = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-1 py-1.5 text-center text-sm font-bold text-slate-800 outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100';
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const nombreTalle = (t) => String(t).replace(/fem$/i, ' fem');

// La próxima letra libre (A, B, C…)
export const letraLibre = (medidas) => LETRAS.find(l => !medidas.some(m => String(m.letra || '').toUpperCase() === l)) || '';
// Cómo se mide: lo propio del producto o, si no tiene, lo del nomenclador
export const comoMedirDe = (m, medidasCat) => (m.comoMedir || '').trim() || medidasCat.find(c => String(c.MedidaID) === String(m.medidaId))?.ComoMedir || '';
// Una medida nueva: la primera del nomenclador que el producto todavía no tiene
export const medidaNueva = (medidas, medidasCat) => {
    const c = medidasCat.find(x => x.Activo && !medidas.some(m => String(m.medidaId) === String(x.MedidaID)));
    return { medidaId: c ? c.MedidaID : '', nombre: c ? c.Nombre : '', letra: letraLibre(medidas), principal: false, comoMedir: '', talles: [] };
};

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

export function TablaMedidasEditable({ medidas, medidasCat, gruposVisibles, gruposTodos, onChange }) {
    const [ver, setVer] = React.useState(null);
    const archivo = React.useRef(null);
    const grupo = gruposVisibles.find(([g]) => g === ver) || gruposVisibles[0] || null;
    const talles = grupo ? grupo[1] : [];
    const ordenTodos = gruposTodos.flatMap(([, l]) => l);
    const tallesCsv = gruposVisibles.flatMap(([, l]) => l);
    const setM = (i, patch) => onChange(medidas.map((m, j) => (j === i ? { ...m, ...patch } : m)));
    const valorDe = (m, t) => (m.talles || []).find(x => x.talle === t)?.valor ?? '';
    // La lista en el orden del molde (ese orden se imprime) + lo guardado de talles que ya no están
    const conTalle = (m, t, valor) => {
        const huerfanos = (m.talles || []).filter(x => !ordenTodos.includes(x.talle) && x.valor !== '' && x.valor != null);
        return [...ordenTodos.map(tl => ({ talle: tl, valor: tl === t ? valor : valorDe(m, tl) })), ...huerfanos];
    };
    const letraRepetida = (m) => !!m.letra && medidas.filter(x => String(x.letra || '').toUpperCase() === String(m.letra).toUpperCase()).length > 1;

    // ── CSV: Letra;Medida;Principal;<talles…> ──
    const exportar = () => {
        const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lineas = [['Letra', 'Medida', 'Principal', ...tallesCsv].map(celda).join(';')];
        medidas.filter(m => m.nombre).forEach(m => lineas.push([m.letra || '', m.nombre, m.principal ? 'Sí' : '',
            ...tallesCsv.map(t => String(valorDe(m, t)).replace('.', ','))].map(celda).join(';')));
        const url = URL.createObjectURL(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'medidas_por_talle.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    };
    const importar = async (ev) => {
        const f = ev.target.files?.[0]; ev.target.value = '';
        if (!f) return;
        const lineas = (await f.text()).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
        if (lineas.length < 2) return;
        const sep = lineas[0].includes(';') ? ';' : ',';
        const [cab, ...filas] = lineas.map(l => celdasCsv(l, sep));
        const col = (n) => cab.findIndex(c => sinTildes(c) === sinTildes(n));
        let lista = [...medidas];
        filas.forEach(c => {
            const nombre = c[col('Medida')] ?? c[1];
            if (!nombre) return;
            const cat = medidasCat.find(x => sinTildes(x.Nombre) === sinTildes(nombre));
            const k = lista.findIndex(m => sinTildes(m.nombre) === sinTildes(nombre));
            let m = k >= 0 ? lista[k] : { ...medidaNueva(lista, []), medidaId: cat?.MedidaID || '', nombre: cat?.Nombre || nombre };
            const letra = col('Letra') >= 0 ? String(c[col('Letra')] || '').toUpperCase().slice(0, 4) : '';
            if (letra) m = { ...m, letra };
            if (col('Principal') >= 0) m = { ...m, principal: /^(s|si|sí|x|1|true)$/i.test(String(c[col('Principal')] || '').trim()) };
            cab.forEach((t, n) => {
                if (!ordenTodos.includes(t) || c[n] === '' || c[n] == null) return;
                m = { ...m, talles: conTalle(m, t, String(c[n]).replace(',', '.')) };
            });
            lista = k >= 0 ? lista.map((x, j) => (j === k ? m : x)) : [...lista, m];
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
                <span className="text-xs text-slate-400">Valores en cm</span>
                <span className="ml-auto flex gap-2">
                    <button type="button" onClick={exportar} disabled={!medidas.length} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300 disabled:opacity-40">Exportar plantilla .CSV</button>
                    <button type="button" onClick={() => archivo.current?.click()} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300">Importar .CSV</button>
                    <input ref={archivo} type="file" accept=".csv,.txt" className="hidden" onChange={importar} />
                </span>
            </div>
            {medidas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-separate border-spacing-x-1 border-spacing-y-1.5 text-sm">
                        <colgroup><col style={{ width: 56 }} /><col style={{ width: 240 }} /><col style={{ width: 84 }} />{talles.map(t => <col key={t} />)}<col style={{ width: 64 }} /></colgroup>
                        <thead>
                            <tr className="text-[11px] font-bold text-slate-500">
                                <th className="text-center">Ref.</th>
                                <th className="text-left px-1">Medida</th>
                                <th className="text-center" title="Las principales salen grandes arriba de la ficha impresa">Principal</th>
                                {talles.map(t => <th key={t} className="text-center font-mono">{grupo?.[0] === 'Femenino' ? t.replace(/fem$/i, '') : t}</th>)}
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {medidas.map((m, i) => {
                                const cat = medidasCat.find(c => String(c.MedidaID) === String(m.medidaId));
                                return (
                                    <tr key={i} className="align-middle">
                                        <td>
                                            <input value={m.letra || ''} maxLength={4} aria-label={`Letra de ${m.nombre || 'la medida'} en el dibujo`}
                                                title={letraRepetida(m) ? 'Esta letra está repetida' : 'La letra de esta medida en el dibujo'}
                                                onChange={e => setM(i, { letra: e.target.value.toUpperCase() })}
                                                className={`w-full rounded-lg border px-1 py-1.5 text-center text-base font-black outline-none focus:ring-2 focus:ring-indigo-100 ${letraRepetida(m) || !m.letra ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-indigo-700'}`} />
                                        </td>
                                        <td className="px-1">
                                            <Selector value={m.medidaId ? String(m.medidaId) : ''} title="Medida del nomenclador"
                                                onChange={e => { const x = medidasCat.find(y => String(y.MedidaID) === e.target.value); setM(i, x ? { medidaId: x.MedidaID, nombre: x.Nombre } : { medidaId: '' }); }}
                                                claseBoton={`flex w-full items-center justify-between gap-1 rounded-lg border bg-white px-2 py-1 text-left text-sm font-black text-slate-800 ${m.medidaId ? 'border-transparent hover:border-slate-200' : 'border-amber-300'}`} anchoLista={300}>
                                                <option value="">{medidasCat.filter(x => x.Activo).length ? 'Elegí la medida…' : 'Cargá medidas en "Catálogo › Medidas"'}</option>
                                                {medidasCat.filter(x => x.Activo || String(x.MedidaID) === String(m.medidaId)).map(x => <option key={x.MedidaID} value={String(x.MedidaID)}>{x.Nombre}{x.Activo ? '' : ' (inactiva)'}</option>)}
                                            </Selector>
                                            {(cat?.Referencia || (!m.medidaId && m.nombre)) && <div className="truncate px-2 text-[11px] text-slate-500">{cat?.Referencia || m.nombre}</div>}
                                        </td>
                                        <td className="text-center">
                                            <button type="button" aria-pressed={!!m.principal} onClick={() => setM(i, { principal: !m.principal })}
                                                title={m.principal ? 'Sale grande arriba de la ficha impresa' : 'Marcar como medida principal'}
                                                className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${m.principal ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-400 hover:text-slate-600'}`}>
                                                {m.principal ? '★ Sí' : '☆ No'}
                                            </button>
                                        </td>
                                        {talles.length ? talles.map(t => (
                                            <td key={t}>
                                                <input type="number" min="0" step="0.1" value={valorDe(m, t)} aria-label={`${m.nombre || 'Medida'} talle ${nombreTalle(t)}, en cm`}
                                                    onChange={e => setM(i, { talles: conTalle(m, t, e.target.value) })} className={celdaCls} />
                                            </td>
                                        )) : <td className="text-xs text-slate-400 px-2">Sin talles</td>}
                                        <td className="text-right whitespace-nowrap">
                                            <button type="button" title="Quitar esta medida" onClick={() => onChange(medidas.filter((_, j) => j !== i))} className="px-1.5 font-black text-red-400 hover:text-red-600">×</button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <button type="button" onClick={() => onChange([...medidas, medidaNueva(medidas, medidasCat)])}
                className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-500 hover:border-slate-400">+ Agregar medida</button>
        </div>
    );
}

// "Cómo medir": una línea por medida (letra — cómo se mide). Sale del nomenclador; escribir acá lo cambia solo para
// este producto (vaciarlo vuelve al del nomenclador).
export function ComoMedirEditable({ medidas, medidasCat, onChange }) {
    const conNombre = medidas.map((m, i) => ({ m, i })).filter(({ m }) => m.nombre);
    if (!conNombre.length) return null;
    return (
        <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {conNombre.map(({ m, i }) => {
                const delNom = medidasCat.find(c => String(c.MedidaID) === String(m.medidaId))?.ComoMedir || '';
                return (
                    <label key={i} className="flex items-center gap-2 text-sm">
                        <span className="w-6 shrink-0 text-center font-black text-indigo-700">{m.letra || '·'}</span>
                        <input value={m.comoMedir || ''} placeholder={delNom || `Cómo se mide ${m.nombre.toLowerCase()}`}
                            aria-label={`Cómo medir ${m.nombre}`} title={m.comoMedir ? 'Propio de este producto (vacialo para usar el del nomenclador)' : 'El del nomenclador (escribí para cambiarlo solo en este producto)'}
                            onChange={e => onChange(medidas.map((x, j) => (j === i ? { ...x, comoMedir: e.target.value } : x)))}
                            className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-[13px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 ${m.comoMedir ? 'border-indigo-200 bg-indigo-50/40 text-slate-800' : 'border-slate-200 bg-white text-slate-700 placeholder:text-slate-600'}`} />
                    </label>
                );
            })}
        </div>
    );
}

// La hoja de medidas como sale impresa: arriba las principales grandes por talle, el dibujo a la izquierda,
// la tabla REF · MEDIDA · talles a la derecha y "Cómo medir" en dos columnas. Solo los talles con algún valor.
export function HojaMedidas({ medidas, medidasCat, imagenUrl, ordenTalles }) {
    const lista = medidas.filter(m => m.nombre);
    if (!lista.length && !imagenUrl) return null;
    const valor = (m, t) => { const v = (m.talles || []).find(x => x.talle === t)?.valor; return v === '' || v == null ? '' : String(Number(v)).replace('.', ','); };
    const talles = ordenTalles.filter(t => lista.some(m => valor(m, t) !== ''));
    const principales = lista.filter(m => m.principal);
    const comoMedir = lista.map(m => ({ m, txt: comoMedirDe(m, medidasCat) })).filter(x => x.txt);
    return (
        <div className="mb-3 border-t-2 border-slate-800 pt-2">
            <div className="mb-2 flex items-baseline justify-between"><span className="text-xs font-black uppercase">Medidas de la prenda</span><span className="text-[10px] text-slate-500">en cm</span></div>
            {principales.length > 0 && talles.length > 0 && (
                <div className="mb-3 space-y-1.5">
                    {principales.map((m, i) => (
                        <div key={i} className="flex flex-wrap items-stretch gap-1">
                            <div className="flex w-32 shrink-0 items-center gap-1.5 text-xs font-bold"><span className="text-lg font-black">{m.letra}</span>{m.nombre}</div>
                            {talles.map(t => (
                                <div key={t} className="min-w-[44px] rounded border border-slate-300 px-1 py-0.5 text-center">
                                    <div className="text-[9px] text-slate-500">{nombreTalle(t)}</div>
                                    <div className="text-base font-black leading-tight">{valor(m, t) || '—'}</div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
                {imagenUrl && <img src={imagenUrl} alt="Dibujo con las medidas" className="w-full object-contain sm:w-2/5" style={{ maxHeight: 280 }} />}
                {lista.length > 0 && (
                    <div className="min-w-0 flex-1 overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead><tr className="border-b-2 border-slate-800 text-left"><th className="py-1 pr-2">Ref.</th><th className="py-1 pr-2">Medida</th>{talles.map(t => <th key={t} className="py-1 px-1 text-center font-mono">{nombreTalle(t)}</th>)}</tr></thead>
                            <tbody>
                                {lista.map((m, i) => (
                                    <tr key={i} className="border-b border-slate-100">
                                        <td className="py-1 pr-2 font-black">{m.letra}</td>
                                        <td className="py-1 pr-2">{m.nombre}</td>
                                        {talles.map(t => <td key={t} className="py-1 px-1 text-center">{valor(m, t)}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {comoMedir.length > 0 && (
                <div className="mt-2">
                    <div className="text-[10px] font-black uppercase text-slate-600">Cómo medir</div>
                    <div className="grid gap-x-4 text-[11px] sm:grid-cols-2">
                        {comoMedir.map(({ m, txt }, i) => <div key={i}><b>{m.letra}</b> — {txt}</div>)}
                    </div>
                </div>
            )}
        </div>
    );
}
