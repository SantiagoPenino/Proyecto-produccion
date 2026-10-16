import React, { useRef } from 'react';
import { Lock, Plus, Trash2, Upload } from 'lucide-react';
import { INPUT, Miniatura, SEL_CAMPO, claseSel } from './solicitudesComunes';
import Selector from '../../ui/Selector';

/**
 * [EXTRAS EN LA TABLA 14/10] "Qué lleva" un diseño (JUGADOR, GOLERO…), en UNA tabla, para el vendedor y para el cliente del portal:
 *  - una fila por objeto del arte (los editables): la imagen con su medida DEBAJO, qué es y en qué pieza, CÓMO se hace
 *    (sublimado, DTF, TPU, bordado) con el cobro debajo, y la opción del extra (ej. DTF textil común) en la última columna.
 *    Elegir DTF / TPU / Bordado ya es "este diseño lleva ese extra": el arte es ese objeto y va en su pieza.
 *  - una fila por lo que va en bordado / DTF / TPU y NO está en el arte ("+ Agregar bordado"): el archivo subido aparte,
 *    la pieza del molde y un detalle libre (ej. "pecho izquierdo, 8 cm"), y "Extra: Bordado" con el cobro debajo.
 * Columnas fijas para que todo quede alineado. El "dónde va" de cada servicio lo arma el servidor con estas filas
 * (solicitudesVendedorTizadaPro: filasExtra / dondeVa).
 *
 * servicios: [{ tipo: 'BORDADO'|'DTF'|'TPU', nombre, cobro: 'INCLUIDA'|'APARTE'|null, obligatorio, opciones: [{id, nombre}], opcionId }]
 *   (opcionId = el tipo del servicio, el de por defecto de las filas sin tipo propio)
 * filasArchivo: [{ archivo: { ArchivoID, NombreOriginal, UrlDrive }, tipo, pieza, detalle, opcionId }]
 * onForma(claveObjeto, opcionId): el tipo de UN objeto del arte (15/10). Sin onForma, el tipo se muestra y no se cambia.
 */
const PROCESOS = [['sublimado', 'Sublimado'], ['dtf', 'DTF'], ['tpu', 'TPU'], ['bordado', 'Bordado']];
const TIPO_DE = { dtf: 'DTF', tpu: 'TPU', bordado: 'BORDADO' };
const PROC_DE = { DTF: 'dtf', TPU: 'tpu', BORDADO: 'bordado' };
const ACEPTA = { DTF: '.png', TPU: '.png,.jpg,.jpeg,.pdf,.ai,.svg', BORDADO: '.png,.jpg,.jpeg,.pdf,.ai,.svg,.dst,.emb' };
const NOMBRE_TIPO = { BORDADO: 'Bordado', DTF: 'DTF', TPU: 'TPU' };

// La clave del tipo de un objeto en d.formas: "<objeto>|<pieza>" (la misma que el servidor, solicitudesVendedorTizadaPro)
export const claveObjeto = (o) => `${o.objeto}|${o.pieza || ''}`;

const Cobro = ({ s }) => (!s?.cobro ? null : s.cobro === 'INCLUIDA'
    ? <span className="inline-block rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700 whitespace-nowrap">incluido</span>
    : <span className="inline-block rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700 whitespace-nowrap">se cobra aparte</span>);

export default function ArteExtrasTabla({
    d, objetos = [], servicios = [], filasArchivo = [], piezas = [], puede = false, ocupado = false, todosLosProcesos = false,
    onProceso, onAgregar, onCambiarFila, onQuitarFila, onForma = null,
}) {
    const inputs = useRef({});
    const servicio = (T) => servicios.find(s => s.tipo === T) || null;
    const procesoDe = (o) => (d.editables || {})[o.objeto] || o.sugerido || 'sublimado';
    const usados = new Set([...objetos.map(procesoDe).filter(p => p !== 'sublimado').map(p => TIPO_DE[p]), ...filasArchivo.map(f => f.tipo)]);
    // Extras obligatorios del producto que este diseño todavía no tiene en ninguna fila
    const faltan = servicios.filter(s => s.obligatorio && !usados.has(s.tipo));
    // [TIPO POR OBJETO 15/10] El tipo de CADA fila (DTF textil común, bordado 100% hilo…): el de esa fila (formaFila: el del
    // objeto en d.formas o el de la fila subida aparte) o, sin tipo propio, el del servicio. Cambiarlo cambia solo esa fila.
    // Se elige si hay más de uno o si todavía no tiene; si no, se dice cuál es. s.actual: lo cargado que no está en la lista.
    const opcionesDe = (s, formaFila, onCambiar) => {
        if (!s) return null;
        const id = formaFila || s.opcionId;
        const elegida = (s.opciones || []).find(o => String(o.id) === String(id)) || null;
        if (onCambiar && puede && (s.opciones?.length > 1 || (s.opciones?.length === 1 && !elegida))) return (
            <Selector value={elegida ? String(elegida.id) : ''} disabled={ocupado} onChange={e => { if (e.target.value) onCambiar(Number(e.target.value)); }}
                claseBoton={claseSel(`${SEL_CAMPO} ${elegida ? '' : '!border-amber-400'}`)} anchoLista={240} title={`Tipo de ${s.nombre.toLowerCase()} de esta fila`}>
                {!elegida && <option value="">{s.actual ? `${s.actual} (elegí de la lista)` : `— tipo de ${s.nombre.toLowerCase()} —`}</option>}
                {s.opciones.map(o => <option key={o.id} value={String(o.id)}>{o.nombre}</option>)}
            </Selector>
        );
        const txt = elegida?.nombre || (s.opciones?.length === 1 && !onCambiar ? s.opciones[0].nombre : null) || s.actual;
        if (txt) return <div className="text-xs font-semibold text-slate-700" title={`Tipo de ${s.nombre.toLowerCase()}`}>{txt}</div>;
        // Vendedor (todosLosProcesos): se avisa que falta; al cliente del portal no (no tiene de dónde elegirlo)
        return todosLosProcesos ? <div className="text-[11px] font-bold text-amber-700">Falta el tipo de {s.nombre.toLowerCase()}</div> : null;
    };
    const elegirArchivo = (T) => inputs.current[T]?.click();
    const celdaImagen = 'px-2 py-2 w-[84px] text-center align-middle';

    if (!objetos.length && !filasArchivo.length && !servicios.length) return null;
    return (
        <div className="space-y-1.5">
            <table className="w-full table-fixed">
                <colgroup><col style={{ width: 84 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 190 }} /></colgroup>
                <tbody>
                    {objetos.map(o => {
                        const proc = procesoDe(o);
                        const T = TIPO_DE[proc];
                        const s = T ? servicio(T) : null;
                        const lista = PROCESOS.filter(([v]) => v === 'sublimado' || v === proc || todosLosProcesos || servicio(TIPO_DE[v]));
                        return (
                            <tr key={`o-${o.objeto}`} className="border-t border-slate-100 first:border-t-0">
                                <td className={celdaImagen}>
                                    {o.vista ? <img src={o.vista} alt="" className="h-10 max-w-[56px] object-contain mx-auto" style={{ background: 'repeating-conic-gradient(#e5e7eb 0 25%, #fff 0 50%) 0/10px 10px' }} /> : null}
                                    {o.anchoCm && o.altoCm ? <div className="text-[10px] text-slate-400 whitespace-nowrap mt-0.5">{o.anchoCm} × {o.altoCm} cm</div> : null}
                                </td>
                                <td className="py-2 pr-2 align-middle truncate"><span className="font-bold text-slate-800">{o.objeto}</span> <span className="text-slate-500">· {o.pieza || '—'}</span></td>
                                <td className="py-2 pr-2 align-middle">
                                    <Selector value={proc} disabled={!puede || ocupado} onChange={e => onProceso(o.objeto, e.target.value)} claseBoton={claseSel(SEL_CAMPO)} anchoLista={170}>
                                        {lista.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                                    </Selector>
                                    {T && !s && <div className="mt-1 text-[10px] text-amber-700 font-bold">La solicitud no tiene {NOMBRE_TIPO[T]}</div>}
                                    {s?.cobro && <div className="mt-1"><Cobro s={s} /></div>}
                                </td>
                                <td className="py-2 pr-3 align-middle">{s ? opcionesDe(s, (d.formas || {})[claveObjeto(o)], onForma ? (id) => onForma(claveObjeto(o), id) : null) : null}</td>
                            </tr>
                        );
                    })}
                    {filasArchivo.map(f => {
                        const s = servicio(f.tipo);
                        return (
                            <tr key={`a-${f.archivo.ArchivoID}`} className="border-t border-slate-100">
                                <td className={celdaImagen}>
                                    <div className="flex justify-center"><Miniatura a={f.archivo} tam={40} entera /></div>
                                    <div className="text-[10px] text-slate-400 truncate mt-0.5" title={f.archivo.NombreOriginal}>{String(f.archivo.NombreOriginal || '').replace(/^[^_]+__/, '')}</div>
                                </td>
                                <td className="py-2 pr-2 align-middle space-y-1">
                                    <Selector value={f.pieza || ''} disabled={!puede || ocupado} onChange={e => onCambiarFila(f.archivo.ArchivoID, { pieza: e.target.value })}
                                        claseBoton={claseSel(`${SEL_CAMPO} ${f.pieza ? '' : '!border-amber-400'}`)} anchoLista={220} title="En qué pieza va">
                                        {!f.pieza && <option value="">— elegí la pieza —</option>}
                                        {piezas.map(pz => <option key={pz} value={pz}>{pz}</option>)}
                                        {f.pieza && !piezas.includes(f.pieza) && <option value={f.pieza}>{f.pieza}</option>}
                                    </Selector>
                                    <input key={`${f.archivo.ArchivoID}-${f.detalle || ''}`} defaultValue={f.detalle || ''} disabled={!puede || ocupado} placeholder="detalle: pecho izquierdo, 8 cm"
                                        onBlur={e => { if (e.target.value.trim() !== (f.detalle || '')) onCambiarFila(f.archivo.ArchivoID, { detalle: e.target.value.trim() }); }}
                                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        className={`${INPUT} !py-1.5`} />
                                </td>
                                <td className="py-2 pr-2 align-middle">
                                    <div className="text-[11px] text-slate-500">Extra:</div>
                                    <div className="font-black text-slate-800">{s?.nombre || NOMBRE_TIPO[f.tipo]}</div>
                                    {s?.cobro && <div className="mt-1"><Cobro s={s} /></div>}
                                </td>
                                <td className="py-2 pr-3 align-middle">
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 min-w-0">{opcionesDe(s, f.opcionId, onForma ? (id) => onCambiarFila(f.archivo.ArchivoID, { opcionId: id }) : null)}</div>
                                        {puede && <button type="button" disabled={ocupado} onClick={() => onQuitarFila(f.archivo.ArchivoID)} title="Quitar este extra (y su archivo)" className="shrink-0 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {faltan.map(s => (
                <div key={`f-${s.tipo}`} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] text-amber-800 flex flex-wrap items-center gap-2">
                    <Lock size={11} /> <b>{s.nombre}</b> es obligatorio en este producto: elegilo en un objeto del arte o subí su archivo.
                    {puede && onAgregar && <button type="button" disabled={ocupado} onClick={() => elegirArchivo(s.tipo)} className="ml-auto inline-flex items-center gap-1 font-bold text-amber-900 hover:underline"><Upload size={11} /> Subir el arte</button>}
                </div>
            ))}
            {puede && onAgregar && servicios.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-1">
                    {servicios.map(s => (
                        <button key={s.tipo} type="button" disabled={ocupado} onClick={() => elegirArchivo(s.tipo)}
                            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50"
                            title={`Algo que va en ${s.nombre} y NO está en el arte: subí su archivo y elegí en qué pieza va${s.tipo === 'DTF' ? ' (PNG con fondo transparente, a tamaño real)' : ''}`}>
                            <Plus size={11} /> Agregar {s.nombre.toLowerCase()}
                        </button>
                    ))}
                    <span className="text-[10px] text-slate-400">lo que va aparte del arte: un archivo por cada uno</span>
                </div>
            )}
            {servicios.map(s => (
                <input key={`in-${s.tipo}`} ref={el => { inputs.current[s.tipo] = el; }} type="file" className="hidden" accept={ACEPTA[s.tipo]}
                    onChange={ev => { const file = ev.target.files?.[0]; ev.target.value = ''; if (file) onAgregar?.(s.tipo, file); }} />
            ))}
        </div>
    );
}

export { PROC_DE, TIPO_DE };
