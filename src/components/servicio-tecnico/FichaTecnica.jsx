import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2, AlertTriangle, ExternalLink, Upload } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { comprimirImagen } from '../../utils/comprimirImagen';
import { mensajeError } from './constantes';
import { chip, label, input, btn, btnSec, btnPri, btnCancelar, MiniModal, Dato, Adjunto } from './ui';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import {
    TIPOS, tipoLabel, COLORES, seccionesDe, etiquetaCampo, num, fmtNum, calculosDe, avisosDe, completitud, resumenCambios, esUrl,
} from './fichaTecnicaCampos';

// Ficha técnica de una máquina (08/10): las secciones de su tipo, cada una se ve y se edita por separado
// (lápiz → Guardar / Cancelar). Campos y secciones: fichaTecnicaCampos.js. Guardan los técnicos y Admin.
// Plan: docs/servicio-tecnico/ficha-tecnica-maquinas-plan.md.

const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const fmtFechaCorta = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const TONO = { ok: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-700' };
const CHIP_ESTADO = {
    Operativo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Revisar: 'bg-amber-50 text-amber-700 border-amber-200',
    Reemplazar: 'bg-red-50 text-red-700 border-red-200',
    'Fuera de servicio': 'bg-red-50 text-red-700 border-red-200',
};

// Texto de un valor para mostrar (y para el historial).
const mostrarValor = (catalogos) => (c, v) => {
    if (!lleno(v)) return '';
    if (c.t === 'num') return num(v) != null ? `${fmtNum(num(v))}${c.u ? ` ${c.u}` : ''}` : String(v);
    if (c.t === 'fecha') return fmtFechaCorta(v);
    if (c.t === 'maqCostura') return catalogos?.maquinasCostura?.find(m => String(m.Id) === String(v))?.Nombre || String(v);
    return String(v);
};

// ── Piezas comunes ───────────────────────────────────────────────────────────
const Completitud = ({ hechos, total }) => (
    <span className={`${chip} ${hechos > 0 ? 'font-mono' : ''} ${hechos === total ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : hechos > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-zinc-50 text-zinc-400 border-zinc-200'}`}
        title="Datos principales cargados">
        {hechos === 0 ? 'Sin cargar' : `${hechos}/${total}`}
    </span>
);

// Acompaña con una transición los cambios de alto de lo que tiene adentro: al tocar «Editar» la sección se
// estira hasta el formulario y al guardar o cancelar se achica (más rápido: las salidas son más cortas).
// Mide con ResizeObserver; la primera medida no anima, así que al abrir la página no se mueve nada.
const AltoAnimado = ({ children }) => {
    const adentro = useRef(null);
    const previo = useRef(null);
    const [alto, setAlto] = useState(null);
    const [creciendo, setCreciendo] = useState(true);
    useLayoutEffect(() => {
        const el = adentro.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(() => {
            const h = el.offsetHeight;
            if (previo.current != null && h !== previo.current) setCreciendo(h > previo.current);
            previo.current = h;
            setAlto(h);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return (
        <div style={alto == null ? undefined : { height: alto }}
            className={`overflow-hidden transition-[height] ease-out motion-reduce:transition-none ${creciendo ? 'duration-300' : 'duration-200'}`}>
            <div ref={adentro}>{children}</div>
        </div>
    );
};

const Tarjeta = ({ sec, comp, tec, editando, onEditar, onCancelar, onGuardar, guardando, children, extraCabecera }) => {
    // El fundido es para el paso de ver a editar (y la vuelta), no para cuando se abre la página.
    const inicial = useRef(editando);
    const [yaCambio, setYaCambio] = useState(false);
    useEffect(() => { if (editando !== inicial.current) setYaCambio(true); }, [editando]);
    const animar = yaCambio || editando !== inicial.current;
    return (
        <section id={`sec-${sec.key}`} className="scroll-mt-4 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-100 bg-zinc-50/70">
                <span className="font-mono text-[11px] font-bold tracking-wider px-1.5 py-0.5 rounded border border-zinc-300 text-zinc-500">{sec.tag}</span>
                <h3 className="flex-1 min-w-0 text-base font-black text-zinc-800 leading-tight">{sec.titulo}</h3>
                {extraCabecera}
                {comp && <Completitud {...comp} />}
                {/* Editando, el botón queda invisible pero ocupa su lugar: es lo más alto de la cabecera y, si
                    se sacara, la cabecera se achicaría y la pastilla saltaría a la derecha. */}
                {tec && (
                    <button type="button" onClick={onEditar} disabled={editando} className={`${btnSec} ${editando ? 'invisible' : ''}`} aria-label={`Editar ${sec.titulo}`}>
                        <Pencil size={14} className="text-brand-cyan" /> Editar
                    </button>
                )}
            </div>
            <AltoAnimado>
                {/* key: al pasar de ver a editar se vuelve a montar y entra con el fundido (animate-aparecer-suave, index.css) */}
                <div key={editando ? 'editar' : 'ver'} className={`p-4 flex flex-col gap-4 ${animar ? 'animate-aparecer-suave' : ''}`}>{children}</div>
                {editando && (
                    <div className="px-4 py-3 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2 animate-aparecer-suave">
                        <button type="button" onClick={onCancelar} className={btnCancelar} disabled={guardando}>Cancelar</button>
                        <button type="button" onClick={onGuardar} className={btnPri} disabled={guardando}>
                            {guardando && <Loader2 size={15} className="animate-spin" />} Guardar
                        </button>
                    </div>
                )}
            </AltoAnimado>
        </section>
    );
};

const Calculos = ({ items }) => (items.length === 0 ? null : (
    <div className="flex flex-wrap gap-x-7 gap-y-2 px-3 py-2.5 rounded-xl border border-dashed border-zinc-200 bg-zinc-50">
        {items.map(c => (
            <div key={c.titulo} className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-wide text-zinc-400">{c.titulo}</span>
                <strong className={`font-mono text-base font-semibold tabular-nums ${TONO[c.tono] || 'text-zinc-800'}`}>{c.valor}</strong>
                {c.nota && <small className="text-[11px] text-zinc-400">{c.nota}</small>}
            </div>
        ))}
    </div>
));

const Avisos = ({ items }) => (items.length === 0 ? null : (
    <div className="flex flex-col gap-1">
        {items.map(a => <p key={a} className="flex items-start gap-1.5 text-xs font-bold text-amber-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{a}</p>)}
    </div>
));

// Campo con su unidad a la derecha.
const ConUnidad = ({ u, children }) => (
    <div className="flex items-stretch rounded-xl border border-zinc-200 bg-white overflow-hidden focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/10">
        {children}
        {u && <span className="flex items-center px-2.5 border-l border-zinc-200 bg-zinc-50 font-mono text-xs text-zinc-400 whitespace-nowrap">{u}</span>}
    </div>
);
const inputDesnudo = 'min-w-0 flex-1 px-3 py-2.5 text-sm text-zinc-800 bg-transparent outline-none placeholder:text-zinc-300';

// Control de un campo según su tipo.
const Control = ({ c, valor, onChange, catalogos, id, etiqueta }) => {
    const v = valor ?? '';
    if (c.t === 'num') {
        return (
            <ConUnidad u={c.u}>
                <input id={id} className={`${inputDesnudo} font-mono tabular-nums`} inputMode="decimal" value={v} placeholder={c.ph}
                    onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ''))} />
            </ConUnidad>
        );
    }
    if (c.t === 'sel' || c.t === 'sino') {
        return (
            <Selector id={id} value={v} onChange={(e) => onChange(e.target.value)} aria-label={etiqueta}>
                <option value="">—</option>
                {(c.t === 'sino' ? ['Sí', 'No'] : c.o).map(o => <option key={o} value={o}>{o}</option>)}
            </Selector>
        );
    }
    if (c.t === 'color') {
        return (
            <Selector value={v} onChange={(e) => onChange(e.target.value)} aria-label={etiqueta}>
                <option value="">—</option>
                {Object.entries(COLORES).map(([k, hex]) => (
                    <option key={k} value={k}><span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-sm border border-zinc-300 shrink-0" style={{ background: hex }} />{k}</span></option>
                ))}
            </Selector>
        );
    }
    if (c.t === 'maqCostura') {
        return (
            <Selector id={id} value={String(v)} onChange={(e) => onChange(e.target.value)} aria-label={etiqueta}>
                <option value="">—</option>
                {(catalogos?.maquinasCostura || []).map(m => <option key={m.Id} value={String(m.Id)}>{m.Nombre}</option>)}
            </Selector>
        );
    }
    if (c.t === 'fecha') return <SelectorFecha id={id} value={v} onChange={(e) => onChange(e.target.value)} vaciable aria-label={etiqueta} />;
    if (c.t === 'area') return <textarea id={id} className={`${input} min-h-[90px]`} value={v} maxLength={4000} placeholder={c.ph} onChange={(e) => onChange(e.target.value)} />;
    if (c.t === 'url') return <input id={id} type="url" inputMode="url" className={input} value={v} maxLength={1000} placeholder={c.ph} aria-label={etiqueta} onChange={(e) => onChange(e.target.value)} />;
    return <input id={id} className={input} value={v} maxLength={300} placeholder={c.ph} onChange={(e) => onChange(e.target.value)} />;
};

const Grilla = ({ children }) => <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">{children}</div>;
const GrillaVista = ({ children }) => <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-3">{children}</div>;
const Vacio = ({ children }) => <span className="text-zinc-300">{children || '—'}</span>;

// ── Tablas (cabezales por posición, cabezales de bordado, herramientas) ─────
const ListaVista = ({ lista, filas, ver }) => (
    filas.length === 0 ? null : (
        <div>
            <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1.5">{lista.titulo}</div>
            <div className="overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full min-w-[480px] text-sm">
                    <thead><tr className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-400">
                        <th className="px-3 py-2 text-left font-black w-12">#</th>
                        {lista.cols.map(c => <th key={c.k} className="px-3 py-2 text-left font-black">{c.l}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-zinc-100">
                        {filas.map((f, i) => (
                            <tr key={i}>
                                <td className="px-3 py-2 font-mono text-xs text-zinc-400">{String(i + 1).padStart(2, '0')}</td>
                                {lista.cols.map(c => (
                                    <td key={c.k} className="px-3 py-2 text-zinc-700">
                                        {c.k === 'estado' && f.estado ? <span className={`${chip} ${CHIP_ESTADO[f.estado] || 'bg-zinc-50 text-zinc-500 border-zinc-200'}`}>{f.estado}</span>
                                            : c.t === 'color' && f.color ? <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded-sm border border-zinc-300" style={{ background: COLORES[f.color] || 'transparent' }} />{f.color}</span>
                                                : c.t === 'url' && lleno(f[c.k]) ? (esUrl(f[c.k])
                                                    ? <a href={String(f[c.k]).trim()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-brand-cyan hover:underline break-all">Abrir <ExternalLink size={12} /></a>
                                                    : <span className="text-amber-700 break-all">{f[c.k]}</span>)
                                                : lleno(f[c.k]) ? ver(c, f[c.k]) : <Vacio />}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
);

const ListaEditor = ({ lista, filas, onChange, catalogos }) => {
    const set = (i, k, v) => onChange(filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
    return (
        <div>
            <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1.5">{lista.titulo}</div>
            {filas.length === 0 ? (
                <p className="text-sm text-zinc-400 mb-2">{lista.libre ? 'Todavía no hay ninguna.' : 'Cargá la cantidad para completar cada posición.'}</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {filas.map((f, i) => (
                        <div key={i} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="font-mono text-xs font-bold text-zinc-400">{lista.fila} {String(i + 1).padStart(2, '0')}</span>
                                {lista.libre && (
                                    <button type="button" onClick={() => onChange(filas.filter((_, j) => j !== i))} className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-50 hover:text-red-600" aria-label={`Quitar ${lista.fila.toLowerCase()} ${i + 1}`}>
                                        <Trash2 size={15} />
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                                {lista.cols.map(c => (
                                    <div key={c.k}>
                                        <span className={label}>{c.l}</span>
                                        <Control c={c} valor={f[c.k]} onChange={(v) => set(i, c.k, v)} catalogos={catalogos} etiqueta={`${c.l} ${i + 1}`} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {lista.libre && (
                <button type="button" onClick={() => onChange([...filas, lista.nueva()])} className={`${btnSec} mt-2`}>
                    <Plus size={15} className="text-brand-cyan" /> Agregar {lista.fila.toLowerCase()}
                </button>
            )}
        </div>
    );
};

// Filas de la tabla con la cantidad que corresponde (las que sobran se sacan; las que faltan, vacías).
const ajustarFilas = (filas, n, nueva) => {
    const r = (filas || []).slice(0, n);
    while (r.length < n) r.push(nueva());
    return r;
};
const cantidadLista = (sec, valores, eq) => {
    if (sec.lista?.cantidadDeCapacidad) return Math.max(0, Math.min(64, Math.trunc(num(eq?.Cabezales) || 0)));
    if (sec.lista?.cantidadDe) return Math.max(0, Math.min(32, Math.trunc(num(valores?.[sec.lista.cantidadDe]) || 0)));
    return null;
};

// ── Sección genérica (lo que va en Datos) ────────────────────────────────────
const SeccionGenerica = ({ sec, ficha, eq, tipo, tec, catalogos, onGuardar }) => {
    const guardados = ficha.Datos?.[sec.key] || {};
    const [borrador, setBorrador] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const editando = !!borrador;
    const valores = borrador || guardados;
    const ver = mostrarValor(catalogos);
    const lista = sec.lista;
    const n = cantidadLista(sec, valores, eq);
    const filas = lista ? (n == null ? (valores[lista.k] || []) : ajustarFilas(valores[lista.k], n, lista.nueva)) : [];
    const set = (k, v) => setBorrador(b => ({ ...b, [k]: v }));

    const guardar = async () => {
        const limpio = { ...borrador };
        (sec.campos || []).forEach(c => {
            if (c.t === 'num' && lleno(limpio[c.k])) limpio[c.k] = String(limpio[c.k]).replace(',', '.').trim();
            else if (typeof limpio[c.k] === 'string') limpio[c.k] = limpio[c.k].trim();
        });
        if (lista) limpio[lista.k] = filas;
        const resumen = resumenCambios(sec, guardados, limpio, { tipo, mostrarValor: ver });
        if (!resumen.length) { setBorrador(null); return; }
        setGuardando(true);
        try {
            if (await onGuardar(sec, limpio, resumen)) setBorrador(null);
        } finally { setGuardando(false); }
    };

    const camposVisibles = (sec.campos || []);
    const algoCargado = camposVisibles.some(c => lleno(guardados[c.k])) || (guardados[lista?.k] || []).length > 0;
    const isoDeMaquina = sec.key === 'cos' && lleno(valores.maquinaCosturaId)
        ? (catalogos?.costurasISO || []).filter(x => String(x.MaqId) === String(valores.maquinaCosturaId)) : [];

    return (
        <Tarjeta sec={sec} comp={sec.principales.length ? completitud(sec, ficha, eq) : null} tec={tec} editando={editando} guardando={guardando}
            extraCabecera={!sec.principales.length && lista ? <CantidadChip n={(guardados[lista.k] || []).length} uno={lista.fila.toLowerCase()} /> : null}
            onEditar={() => setBorrador(JSON.parse(JSON.stringify(guardados)))} onCancelar={() => setBorrador(null)} onGuardar={guardar}>
            {sec.nota && <p className="text-xs text-zinc-500">{sec.nota}</p>}
            {editando ? (camposVisibles.length > 0 &&
                <Grilla>
                    {camposVisibles.map(c => (
                        <div key={c.k} className={c.ancho ? 'col-span-full' : ''}>
                            <label htmlFor={`f-${sec.key}-${c.k}`} className={label}>{etiquetaCampo(c, tipo)}</label>
                            <Control c={c} id={`f-${sec.key}-${c.k}`} valor={valores[c.k]} onChange={(v) => set(c.k, v)} catalogos={catalogos} etiqueta={etiquetaCampo(c, tipo)} />
                        </div>
                    ))}
                </Grilla>
            ) : !algoCargado ? (
                <p className="text-sm text-zinc-400">Sin cargar.{tec ? ' Tocá «Editar» para completarla.' : ''}</p>
            ) : (camposVisibles.length > 0 &&
                <GrillaVista>
                    {camposVisibles.map(c => (
                        <div key={c.k} className={c.ancho || c.t === 'area' ? 'col-span-full' : ''}>
                            <Dato titulo={etiquetaCampo(c, tipo)}>{lleno(guardados[c.k]) ? <span className={c.t === 'area' ? 'whitespace-pre-wrap' : ''}>{ver(c, guardados[c.k])}</span> : <Vacio />}</Dato>
                        </div>
                    ))}
                </GrillaVista>
            )}
            {isoDeMaquina.length > 0 && (
                <div>
                    <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1.5">Puntadas que hace (catálogo de costuras)</div>
                    <div className="flex flex-wrap gap-1.5">{isoDeMaquina.map(x => <span key={x.CodigoISO} className={`${chip} bg-white text-zinc-600 border-zinc-200`}><b className="font-mono">{x.CodigoISO}</b> {x.Nombre}</span>)}</div>
                </div>
            )}
            {lista && sec.lista.cantidadDeCapacidad && n === 0 && (
                <p className="text-xs text-zinc-500">Para cargar el estado de cada cabezal, primero completá «Cabezales / estaciones» en Capacidad de producción.</p>
            )}
            {lista && (editando
                ? <ListaEditor lista={lista} filas={filas} catalogos={catalogos} onChange={(f) => set(lista.k, f)} />
                : <ListaVista lista={lista} filas={guardados[lista.k] || []} ver={ver} />)}
            <Calculos items={calculosDe(sec.key, valores, { eq, datos: ficha.Datos })} />
            <Avisos items={avisosDe(sec.key, valores)} />
        </Tarjeta>
    );
};

// "3 enlaces", "1 archivo": para las secciones que no cuentan datos principales.
const plural = (n, uno) => `${n} ${n === 1 ? uno : `${uno}${/[aeiou]$/.test(uno) ? 's' : 'es'}`}`;
const CantidadChip = ({ n, uno }) => (
    <span className={`${chip} ${n > 0 ? 'bg-white text-zinc-600 border-zinc-200' : 'bg-zinc-50 text-zinc-400 border-zinc-200'}`}>{n > 0 ? plural(n, uno) : 'Sin cargar'}</span>
);

// ── Fotos y archivos (parte 3, 08/10) ────────────────────────────────────────
// Adjuntos de la máquina (ST_Adjuntos, Entidad EQUIPO): fotos de la máquina, la placa de datos y las conexiones,
// manuales en PDF, videos cortos. Las fotos se guardan en WebP (como todo Servicio Técnico). Subir, renombrar y
// borrar: técnicos o Admin; queda en el historial de la máquina.
const SeccionArchivos = ({ sec, eq, tec, onRecargar }) => {
    const docs = eq.documentos || [];
    const inputRef = useRef(null);
    const [subiendo, setSubiendo] = useState(false);
    const [renombrar, setRenombrar] = useState(null); // { a, nombre }
    const [borrar, setBorrar] = useState(null);
    const [trabajando, setTrabajando] = useState(false);

    const subir = async (lista) => {
        const elegidos = Array.from(lista || []);
        if (inputRef.current) inputRef.current.value = '';
        if (!elegidos.length) return;
        if (elegidos.length > 8) toast.info('Se suben de a 8: van los primeros 8.');
        setSubiendo(true);
        try {
            const archivos = await Promise.all(elegidos.slice(0, 8).map(a => comprimirImagen(a)));
            const r = await servicioTecnicoService.adjuntarEquipo(eq.EquipoID, archivos);
            toast.success(r.length === 1 ? 'Archivo agregado' : `${r.length} archivos agregados`);
            onRecargar();
        } catch (e) { toast.error(mensajeError(e)); }
        finally { setSubiendo(false); }
    };
    const sinExtension = (n) => String(n || '').replace(/\.[^.]+$/, '');
    const guardarNombre = async () => {
        setTrabajando(true);
        try {
            await servicioTecnicoService.renombrarAdjuntoEquipo(eq.EquipoID, renombrar.a.AdjId, renombrar.nombre.trim());
            setRenombrar(null);
            onRecargar();
        } catch (e) { toast.error(mensajeError(e)); }
        finally { setTrabajando(false); }
    };
    const confirmarBorrar = async () => {
        setTrabajando(true);
        try {
            await servicioTecnicoService.borrarAdjuntoEquipo(eq.EquipoID, borrar.AdjId);
            toast.success('Archivo borrado');
            setBorrar(null);
            onRecargar();
        } catch (e) { toast.error(mensajeError(e)); }
        finally { setTrabajando(false); }
    };

    return (
        <Tarjeta sec={sec} comp={null} tec={false} editando={false}
            extraCabecera={<>
                <CantidadChip n={docs.length} uno="archivo" />
                {tec && (
                    <button type="button" onClick={() => inputRef.current?.click()} disabled={subiendo} className={btnSec}>
                        {subiendo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} className="text-brand-cyan" />} Agregar
                    </button>
                )}
            </>}>
            <input ref={inputRef} type="file" multiple accept="image/*,application/pdf,video/*" className="hidden" onChange={(e) => subir(e.target.files)} />
            <p className="text-xs text-zinc-500">
                Fotos de la máquina, la placa de datos y las conexiones, manuales en PDF y videos cortos. Hasta 8 por vez y 25 MB cada uno; las fotos se guardan en WebP.
            </p>
            {docs.length === 0 ? (
                <p className="text-sm text-zinc-400">Sin archivos.{tec ? ' Tocá «Agregar» para subir el primero.' : ''}</p>
            ) : (
                <div className="flex flex-wrap gap-3">
                    {docs.map(a => (
                        <div key={a.AdjId} className="w-24 flex flex-col gap-1">
                            <Adjunto a={a} sinNombre />
                            {/* Alto de dos renglones siempre: así los botones quedan alineados aunque un nombre ocupe uno solo */}
                            <div className="min-h-[2.5em] text-[11px] leading-tight text-zinc-600 break-words line-clamp-2" title={a.NombreOriginal}>{a.NombreOriginal}</div>
                            {tec && (
                                <div className="flex gap-0.5">
                                    <button type="button" onClick={() => setRenombrar({ a, nombre: sinExtension(a.NombreOriginal) })} title="Cambiar el nombre" aria-label={`Cambiar el nombre de ${a.NombreOriginal}`}
                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><Pencil size={14} /></button>
                                    <button type="button" onClick={() => setBorrar(a)} title="Borrar" aria-label={`Borrar ${a.NombreOriginal}`}
                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {renombrar && (
                <MiniModal titulo="Cambiar el nombre" chico onCerrar={() => setRenombrar(null)} pie={<>
                    <button onClick={() => setRenombrar(null)} className={btnCancelar}>Cancelar</button>
                    <button onClick={guardarNombre} disabled={trabajando || !renombrar.nombre.trim()} className={btnPri}>
                        {trabajando && <Loader2 size={15} className="animate-spin" />} Guardar
                    </button>
                </>}>
                    <div>
                        <label htmlFor="renombrar-archivo" className={label}>Nombre</label>
                        <input id="renombrar-archivo" className={input} value={renombrar.nombre} maxLength={200} autoFocus
                            onChange={(e) => setRenombrar(r => ({ ...r, nombre: e.target.value }))} placeholder="Ej: Placa de datos" />
                        <p className="mt-1 text-xs text-zinc-400">La extensión del archivo se conserva.</p>
                    </div>
                </MiniModal>
            )}
            {borrar && (
                <MiniModal titulo="Borrar archivo" chico onCerrar={() => setBorrar(null)} pie={<>
                    <button onClick={() => setBorrar(null)} className={btnCancelar}>Cancelar</button>
                    <button onClick={confirmarBorrar} disabled={trabajando} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
                        {trabajando ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Borrar
                    </button>
                </>}>
                    <p className="text-sm text-zinc-700">¿Borrar <b>{borrar.NombreOriginal}</b>? Se borra del servidor y no se puede recuperar. Queda anotado en el historial de la máquina.</p>
                </MiniModal>
            )}
        </Tarjeta>
    );
};

// ── Identificación (columnas de ST_FichaEquipo) ─────────────────────────────
const SeccionIdent = ({ sec, ficha, eq, tipo, tipoSugerido, tec, locales, onGuardar }) => {
    const guardados = {
        tipo: ficha.Tipo || '', marca: ficha.Marca || '', modelo: ficha.Modelo || '', serie: ficha.Serie || '',
        anio: ficha.Anio != null ? String(ficha.Anio) : '', localId: ficha.LocalId != null ? String(ficha.LocalId) : '',
        localOtro: ficha.LocalOtro || '', ubicacion: ficha.Datos?.ident?.ubicacion || '',
    };
    const [borrador, setBorrador] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const editando = !!borrador;
    const set = (c) => setBorrador(b => ({ ...b, ...c }));
    const nombreLocal = (id) => locales.find(l => String(l.Id) === String(id))?.Nombre || '';
    const esOtro = (id) => nombreLocal(id).trim().toLowerCase() === 'otro';

    const CAMPOS = [
        ['tipo', 'Tipo de máquina'], ['marca', 'Marca'], ['modelo', 'Modelo'], ['serie', 'N.º de serie'], ['anio', 'Año de fabricación'],
        ['localId', 'Local'], ['ubicacion', 'Ubicación dentro del local'],
    ];
    const texto = (k, d) => {
        if (k === 'tipo') return tipoLabel(d.tipo);
        if (k === 'localId') return d.localId ? (esOtro(d.localId) && d.localOtro ? `otro: ${d.localOtro}` : nombreLocal(d.localId)) : '';
        return d[k];
    };

    const guardar = async () => {
        const b = Object.fromEntries(Object.entries(borrador).map(([k, v]) => [k, String(v ?? '').trim()]));
        if (b.localId && esOtro(b.localId) && !b.localOtro) { toast.error('Especificá el local.'); return; }
        if (!esOtro(b.localId)) b.localOtro = '';
        const resumen = CAMPOS.filter(([k]) => texto(k, guardados) !== texto(k, b) || (k === 'localId' && guardados.localOtro !== b.localOtro))
            .map(([k, l]) => `${l}: ${texto(k, guardados) || '—'} → ${texto(k, b) || '—'}`);
        if (!resumen.length) { setBorrador(null); return; }
        setGuardando(true);
        try { if (await onGuardar(sec, b, resumen)) setBorrador(null); }
        finally { setGuardando(false); }
    };

    return (
        <Tarjeta sec={sec} comp={completitud(sec, ficha, eq)} tec={tec} editando={editando} guardando={guardando}
            onEditar={() => setBorrador({ ...guardados, tipo: guardados.tipo || tipoSugerido })} onCancelar={() => setBorrador(null)} onGuardar={guardar}>
            {editando ? (
                <Grilla>
                    <div>
                        <span className={label}>Tipo de máquina</span>
                        <Selector value={borrador.tipo} onChange={(e) => set({ tipo: e.target.value })} aria-label="Tipo de máquina">
                            {TIPOS.map(t => <option key={t.value} value={t.value} descripcion={!ficha.Tipo && t.value === tipoSugerido ? 'Sugerido por el área' : undefined}>{t.label}</option>)}
                        </Selector>
                    </div>
                    <div><label htmlFor="f-ident-marca" className={label}>Marca</label><input id="f-ident-marca" className={input} maxLength={100} value={borrador.marca} onChange={(e) => set({ marca: e.target.value })} /></div>
                    <div><label htmlFor="f-ident-modelo" className={label}>Modelo</label><input id="f-ident-modelo" className={input} maxLength={100} value={borrador.modelo} onChange={(e) => set({ modelo: e.target.value })} /></div>
                    <div><label htmlFor="f-ident-serie" className={label}>N.º de serie</label><input id="f-ident-serie" className={input} maxLength={100} value={borrador.serie} onChange={(e) => set({ serie: e.target.value })} /></div>
                    <div><label htmlFor="f-ident-anio" className={label}>Año de fabricación</label>
                        <input id="f-ident-anio" className={`${input} font-mono`} inputMode="numeric" maxLength={4} value={borrador.anio} onChange={(e) => set({ anio: e.target.value.replace(/\D/g, '') })} placeholder="Ej: 2023" /></div>
                    {locales.length > 0 && (
                        <div>
                            <span className={label}>Local</span>
                            <Selector value={borrador.localId} onChange={(e) => set({ localId: e.target.value })} aria-label="Local">
                                <option value="">—</option>
                                {locales.map(l => <option key={l.Id} value={String(l.Id)}><span className="capitalize">{l.Nombre}</span></option>)}
                            </Selector>
                            {esOtro(borrador.localId) && <input className={`${input} mt-2`} maxLength={150} value={borrador.localOtro} onChange={(e) => set({ localOtro: e.target.value })} placeholder="Especifique" />}
                        </div>
                    )}
                    <div className="col-span-full"><label htmlFor="f-ident-ubic" className={label}>Ubicación dentro del local</label>
                        <input id="f-ident-ubic" className={input} maxLength={300} value={borrador.ubicacion} onChange={(e) => set({ ubicacion: e.target.value })} placeholder="Ej: planta alta, al lado de la calandra" /></div>
                </Grilla>
            ) : (
                <GrillaVista>
                    {CAMPOS.filter(([k]) => k !== 'localId' || locales.length > 0 || guardados.localId).map(([k, l]) => (
                        <div key={k} className={k === 'ubicacion' ? 'col-span-full' : ''}>
                            <Dato titulo={l}>
                                {k === 'tipo' && !ficha.Tipo
                                    ? <span className="text-amber-700">Sin confirmar <span className="text-zinc-400">(sugerido: {tipoLabel(tipo)})</span></span>
                                    : texto(k, guardados) ? <span className={k === 'localId' ? 'capitalize' : ''}>{texto(k, guardados)}</span> : <Vacio />}
                            </Dato>
                        </div>
                    ))}
                </GrillaVista>
            )}
        </Tarjeta>
    );
};

// ── Capacidad (columnas de ConfigEquipos, la lee Planificación) ──────────────
const OTRA_UNIDAD = '__otra__';
export const valoresCapacidad = (eq, datos) => ({
    cabezales: eq.Cabezales ?? '', velocidadValor: eq.VelocidadValor ?? '', velocidadUnidad: (eq.VelocidadUnidad || '').trim(),
    minutosPreparacion: eq.MinutosPreparacion ?? '', cabezalesReal: eq.CabezalesReal ?? '', velocidadValorReal: eq.VelocidadValorReal ?? '',
    minutosPreparacionReal: eq.MinutosPreparacionReal ?? '', horasTurno: datos?.cap?.horasTurno ?? '', condicion: datos?.cap?.condicion ?? '',
});
export const cuerpoCapacidad = (v) => ({
    cabezales: String(v.cabezales ?? '').replace(',', '.'), velocidadValor: String(v.velocidadValor ?? '').replace(',', '.'),
    velocidadUnidad: String(v.velocidadUnidad ?? '').trim(), minutosPreparacion: String(v.minutosPreparacion ?? ''),
    cabezalesReal: String(v.cabezalesReal ?? ''), velocidadValorReal: String(v.velocidadValorReal ?? '').replace(',', '.'),
    minutosPreparacionReal: String(v.minutosPreparacionReal ?? ''),
    extra: { horasTurno: String(v.horasTurno ?? '').replace(',', '.'), condicion: String(v.condicion ?? '').trim() },
});

const SeccionCapacidad = ({ sec, ficha, eq, tipo, tec, catalogos, onGuardada }) => {
    const guardados = valoresCapacidad(eq, ficha.Datos);
    const [borrador, setBorrador] = useState(null);
    const [otraUnidad, setOtraUnidad] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const editando = !!borrador;
    const v = borrador || guardados;
    const set = (c) => setBorrador(b => ({ ...b, ...c }));
    const unidades = [...new Set([...(catalogos?.unidades || []), guardados.velocidadUnidad].filter(Boolean))].sort();
    const u = v.velocidadUnidad || '';
    const unidadesArea = catalogos?.unidadesArea || [];
    const avisoUnidad = u && unidadesArea.length > 0 && !unidadesArea.includes(u)
        ? `Las otras máquinas del área usan «${unidadesArea.join('», «')}». Planificación suma sus velocidades: conviene la misma unidad.` : null;
    const ayudaCabezales = tipo === 'BORDADORA'
        ? 'Planificación multiplica la velocidad (por cabezal) por este número.'
        : 'Planificación multiplica la velocidad por este número (vacío = 1). No son los cabezales de impresión.';

    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await servicioTecnicoService.guardarCapacidad(eq.EquipoID, cuerpoCapacidad(borrador));
            toast.success(r?.data?.cambios ? 'Capacidad guardada' : 'Sin cambios');
            setBorrador(null);
            onGuardada();
        } catch (e) { toast.error(mensajeError(e)); }
        finally { setGuardando(false); }
    };

    const numCampo = (k, u2, ariaLabel, ph) => (
        <ConUnidad u={u2}>
            <input className={`${inputDesnudo} font-mono tabular-nums`} inputMode="decimal" value={v[k] ?? ''} aria-label={ariaLabel} placeholder={ph}
                onChange={(e) => set({ [k]: e.target.value.replace(/[^\d.,]/g, '') })} />
        </ConUnidad>
    );
    const dato = (titulo, valor, unidad) => <Dato titulo={titulo}>{lleno(valor) ? `${fmtNum(num(valor))}${unidad ? ` ${unidad}` : ''}` : <Vacio />}</Dato>;

    return (
        <Tarjeta sec={sec} comp={completitud(sec, ficha, eq)} tec={tec} editando={editando} guardando={guardando}
            onEditar={() => { setBorrador({ ...guardados }); setOtraUnidad(false); }} onCancelar={() => setBorrador(null)} onGuardar={guardar}>
            <p className="text-xs text-zinc-500">Es la que usa Planificación para calcular las fechas. La real (medida en planta) pisa a la estándar cuando está cargada.</p>
            {editando ? (
                <>
                    <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 -mb-2">Estándar (ficha del fabricante)</div>
                    <Grilla>
                        <div><span className={label}>Cabezales / estaciones</span>{numCampo('cabezales', 'u', 'Cabezales / estaciones')}<p className="mt-1 text-[11px] text-zinc-400">{ayudaCabezales}</p></div>
                        <div><span className={label}>Velocidad</span>{numCampo('velocidadValor', u || '—', 'Velocidad')}</div>
                        <div>
                            <span className={label}>Unidad</span>
                            <Selector value={otraUnidad ? OTRA_UNIDAD : u} aria-label="Unidad de la velocidad"
                                onChange={(e) => { if (e.target.value === OTRA_UNIDAD) { setOtraUnidad(true); set({ velocidadUnidad: '' }); } else { setOtraUnidad(false); set({ velocidadUnidad: e.target.value }); } }}>
                                <option value="">—</option>
                                {unidades.map(x => <option key={x} value={x}>{x}</option>)}
                                <option value={OTRA_UNIDAD}>Otra…</option>
                            </Selector>
                            {otraUnidad && <input className={`${input} mt-2`} maxLength={30} value={u} autoFocus onChange={(e) => set({ velocidadUnidad: e.target.value })} placeholder="Ej: m²/h, piezas/h" />}
                        </div>
                        <div><span className={label}>Preparación</span>{numCampo('minutosPreparacion', 'min', 'Minutos de preparación')}</div>
                    </Grilla>
                    <div className="text-[10px] font-black uppercase tracking-wide text-amber-600 -mb-2">Real de planta (opcional, pisa a la estándar)</div>
                    <Grilla>
                        <div><span className={label}>Cabezales funcionando</span>{numCampo('cabezalesReal', 'u', 'Cabezales funcionando')}</div>
                        <div><span className={label}>Velocidad real</span>{numCampo('velocidadValorReal', u || '—', 'Velocidad real')}</div>
                        <div><span className={label}>Preparación real</span>{numCampo('minutosPreparacionReal', 'min', 'Minutos de preparación reales')}</div>
                    </Grilla>
                    <Grilla>
                        <div><span className={label}>Horas por turno</span>{numCampo('horasTurno', 'h', 'Horas por turno')}</div>
                        <div className="sm:col-span-1 lg:col-span-2 2xl:col-span-3"><label htmlFor="f-cap-cond" className={label}>Condición de medición</label>
                            <input id="f-cap-cond" className={input} maxLength={300} value={v.condicion} onChange={(e) => set({ condicion: e.target.value })} placeholder="Ej: modo producción 600×900 dpi, CMYK + blanco" /></div>
                    </Grilla>
                    {avisoUnidad && <Avisos items={[avisoUnidad]} />}
                </>
            ) : (
                <GrillaVista>
                    {dato('Cabezales / estaciones', guardados.cabezales)}
                    {dato('Velocidad', guardados.velocidadValor, guardados.velocidadUnidad)}
                    {dato('Preparación', guardados.minutosPreparacion, 'min')}
                    {dato('Horas por turno', guardados.horasTurno, 'h')}
                    {dato('Cabezales funcionando', guardados.cabezalesReal)}
                    {dato('Velocidad real', guardados.velocidadValorReal, guardados.velocidadUnidad)}
                    {dato('Preparación real', guardados.minutosPreparacionReal, 'min')}
                    {lleno(guardados.condicion) && <div className="col-span-full"><Dato titulo="Condición de medición">{guardados.condicion}</Dato></div>}
                </GrillaVista>
            )}
            {!editando && !lleno(guardados.velocidadValor) && (
                <p className="text-xs font-bold text-amber-700">Sin velocidad cargada: Planificación no cuenta esta máquina.</p>
            )}
            <Calculos items={calculosDe('cap', { horasTurno: v.horasTurno }, { eq: editando ? { ...eq, ...capacidadComoEq(v) } : eq })} />
        </Tarjeta>
    );
};
const capacidadComoEq = (v) => ({
    Cabezales: v.cabezales, VelocidadValor: v.velocidadValor, VelocidadUnidad: v.velocidadUnidad, CabezalesReal: v.cabezalesReal, VelocidadValorReal: v.velocidadValorReal,
});

// ── Bordadoras: cabezales funcionando ────────────────────────────────────────
// Cuántos cabezales andan según la tabla de la ficha (los que no están "Fuera de servicio"; si falta la fila, anda)
// y cuántos cuenta hoy Planificación (CabezalesReal o, sin cargar, todos). Si no coinciden devuelve
// { funcionando, total, ahora } para preguntarle al técnico (decisión de Santiago, 08/10: no se actualiza solo).
export const preguntaCabezales = (eq, filas) => {
    const total = Math.trunc(num(eq?.Cabezales) || 0);
    if (total <= 0) return null;
    const funcionando = Array.from({ length: total }, (_, i) => filas?.[i]).filter(f => f?.estado !== 'Fuera de servicio').length;
    const ahora = num(eq.CabezalesReal) ?? total;
    return funcionando !== ahora ? { funcionando, total, ahora } : null;
};

// La pregunta: lo usan la sección Bordado de la ficha y "Registrar cambio" (un cabezal cambiado vuelve a andar).
export const ModalCabezalesFuncionando = ({ eq, datos, funcionando, total, ahora, onCerrar, onHecho }) => {
    const [guardando, setGuardando] = useState(false);
    const actualizar = async () => {
        setGuardando(true);
        try {
            await servicioTecnicoService.guardarCapacidad(eq.EquipoID, cuerpoCapacidad({ ...valoresCapacidad(eq, datos), cabezalesReal: String(funcionando) }));
            toast.success(`Cabezales funcionando: ${funcionando} de ${total}`);
            onHecho?.();
        } catch (e) { toast.error(mensajeError(e)); setGuardando(false); }
    };
    return (
        <MiniModal titulo="Cabezales funcionando" chico onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Dejarlo como está</button>
            <button onClick={actualizar} disabled={guardando} className={btnPri}>
                {guardando && <Loader2 size={15} className="animate-spin" />} Actualizar a {funcionando}
            </button>
        </>}>
            <p className="text-sm text-zinc-700">
                Quedaron <b>{funcionando} de {total}</b> cabezales funcionando (Planificación hoy calcula con {ahora}).
            </p>
            <p className="text-sm text-zinc-500">¿Actualizo «Cabezales funcionando» en la capacidad para que Planificación lo tome?</p>
        </MiniModal>
    );
};

// ── La ficha ─────────────────────────────────────────────────────────────────
// pestana: 'ficha' | 'comercial'. onRecargar: después de guardar.
const FichaTecnica = ({ eq, meta, tec, pestana, catalogos, tipo, tipoSugerido, onRecargar }) => {
    const ficha = eq.fichaTecnica;
    const [preguntaBordado, setPreguntaBordado] = useState(null); // { funcionando, total, ahora }

    if (!ficha?.disponible) {
        return (
            <div className="flex flex-col gap-4">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
                    Falta correr <span className="font-mono">docs/servicio-tecnico/st-ficha-tecnica.sql</span> en la base para guardar la ficha técnica.
                    {pestana === 'ficha' && ' La capacidad se puede editar igual.'}
                {pestana === 'comercial' && ' Las fotos y los archivos se pueden subir igual.'}
                </div>
                {pestana === 'ficha' && (
                    <SeccionCapacidad sec={seccionesDe(tipo, 'ficha').find(s => s.especial === 'cap')} ficha={{ Datos: {} }} eq={eq} tipo={tipo} tec={tec} catalogos={catalogos} onGuardada={onRecargar} />
                )}
                {pestana === 'comercial' && (
                    <SeccionArchivos sec={seccionesDe(tipo, 'comercial').find(s => s.especial === 'archivos')} eq={eq} tec={tec} onRecargar={onRecargar} />
                )}
            </div>
        );
    }

    const guardarSeccion = async (sec, valores, resumen) => {
        try {
            await servicioTecnicoService.guardarFicha(eq.EquipoID, { seccion: sec.key, titulo: sec.titulo, valores, resumen });
            toast.success(`${sec.titulo}: guardado`);
            onRecargar();
            // Bordadora: si cambió cuántos cabezales andan, se pregunta si Planificación lo toma.
            if (sec.key === 'bor') setPreguntaBordado(preguntaCabezales(eq, valores.cabezales));
            return true;
        } catch (e) { toast.error(mensajeError(e)); return false; }
    };

    const secciones = seccionesDe(tipo, pestana);
    return (
        <div className="flex flex-col gap-4">
            {secciones.map(sec => (
                sec.especial === 'archivos' ? <SeccionArchivos key={sec.key} sec={sec} eq={eq} tec={tec} onRecargar={onRecargar} />
                    : sec.especial === 'ident' ? <SeccionIdent key={sec.key} sec={sec} ficha={ficha} eq={eq} tipo={tipo} tipoSugerido={tipoSugerido} tec={tec} locales={meta?.locales || []} onGuardar={guardarSeccion} />
                    : sec.especial === 'cap' ? <SeccionCapacidad key={sec.key} sec={sec} ficha={ficha} eq={eq} tipo={tipo} tec={tec} catalogos={catalogos} onGuardada={onRecargar} />
                        : <SeccionGenerica key={sec.key} sec={sec} ficha={ficha} eq={eq} tipo={tipo} tec={tec} catalogos={catalogos} onGuardar={guardarSeccion} />
            ))}
            {preguntaBordado && (
                <ModalCabezalesFuncionando eq={eq} datos={ficha.Datos} {...preguntaBordado}
                    onCerrar={() => setPreguntaBordado(null)} onHecho={() => { setPreguntaBordado(null); onRecargar(); }} />
            )}
        </div>
    );
};

export default FichaTecnica;
