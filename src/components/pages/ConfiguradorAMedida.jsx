// [A MEDIDA] Configurador › "Molde, telas y apliques" de un producto A MEDIDA (pañuelos, toallas, banderas, banderines).
// El producto se vincula a una VARIABLE a medida de TIZADA PRO (GET /variables con el bloque a_medida) y dice qué
// ofrece de ella: formas, punta del triángulo, terminación del borde, medida libre o medidas fijas, telas y tiras.
// La medida de cada pedido la escribe el vendedor en la solicitud; TIZADA le suma el margen y arma el molde.
import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import Selector from '../ui/Selector';
import { RefreshCw, Plus, Trash2, Info } from 'lucide-react';

const NOMBRE = {
    rectangulo: 'Rectángulo', circulo: 'Círculo', triangulo: 'Triángulo',
    abajo: 'Punta abajo', arriba: 'Punta arriba', izq: 'Punta a la izquierda', der: 'Punta a la derecha',
    dobladillo: 'Dobladillo', overlock: 'Overlock', sin: 'Sin terminación',
};
const AYUDA_TERMINACION = {
    dobladillo: 'Se dobla el margen y se cose (esquinas recortadas). Usa el margen del molde.',
    overlock: 'Costura sobre el borde: la forma tal cual con un margen chico.',
    sin: 'No se cose el borde: la pieza es el diseño. Las tiras van solo en la ficha.',
};
const LADOS = { rectangulo: ['arriba', 'abajo', 'izq', 'der'], triangulo: ['base', 'laterales'], circulo: ['alrededor'] };
const NOMBRE_LADO = { arriba: 'Arriba', abajo: 'Abajo', izq: 'Izquierda', der: 'Derecha', base: 'Base', laterales: 'Cada lateral', alrededor: 'Alrededor' };

// Dibujo chico de la forma (y de hacia dónde va la punta)
export function IconoForma({ forma, punta = 'abajo', size = 26, className = '' }) {
    const tri = { abajo: '3,5 23,5 13,22', arriba: '13,4 23,21 3,21', izq: '4,13 22,3 22,23', der: '22,13 4,3 4,23' }[punta] || '3,5 23,5 13,22';
    return (
        <svg width={size} height={size} viewBox="0 0 26 26" className={className} aria-hidden="true">
            {forma === 'circulo' && <circle cx="13" cy="13" r="9.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.8" />}
            {forma === 'triangulo' && <polygon points={tri} fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />}
            {forma === 'rectangulo' && <rect x="3" y="6" width="20" height="14" rx="1" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.8" />}
        </svg>
    );
}

// Lo que se guarda al elegir una variable: todo lo que TIZADA permite, con sus valores por defecto
const desdeVariable = (v) => {
    const p = v.permitido;
    return {
        variable: v.clave, variableNombre: v.nombre, molde: v.molde, pieza: p.pieza || null,
        formas: [...p.formas], forma: p.forma, orientacion: p.punta,
        terminaciones: [...p.terminaciones], terminacion: p.terminacion,
        medidas: { modo: 'LIBRE', minimo_m: p.minimo, maximo_m: p.maximo, fijas: [] },
        telas: [],
        tiras: { lleva: !!p.tiras?.lleva, marcar: true, lados: { ...(p.tiras?.lados || {}) }, fijas: false },
    };
};

// Mismo botón que los demás selectores del configurador
const claseSel = (clases) => `flex items-center gap-1.5 bg-white text-left text-slate-700 outline-none transition-colors hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 ${clases}`;
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : ''; };
const claseInput = 'border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold text-slate-800 w-24 focus:outline-none focus:border-brand-cyan';
const chip = (sel) => `inline-flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-bold transition-colors ${sel ? 'border-emerald-500 bg-emerald-50/40 text-slate-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`;

export default function ConfiguradorAMedida({ valor, onChange, deshabilitado = false, tituloSeccion }) {
    const [info, setInfo] = useState(null);   // { apiActiva, motivo, variables }
    const [cargando, setCargando] = useState(false);
    const cargar = async (refrescar = false) => {
        setCargando(true);
        try { const { data } = await api.get('/configurador/tizadapro/a-medida', { params: refrescar ? { refrescar: 1 } : {} }); setInfo(data.data); }
        catch (e) { setInfo({ apiActiva: false, motivo: e.response?.data?.error || e.message, variables: [] }); }
        finally { setCargando(false); }
    };
    useEffect(() => { cargar(); }, []);

    const v = useMemo(() => (info?.variables || []).find(x => x.clave === valor?.variable) || null, [info, valor?.variable]);
    const p = v?.permitido || null;
    const set = (patch) => onChange({ ...valor, ...patch });
    const titulo = tituloSeccion || ((t, a) => <div className="mb-3"><p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{t}</p>{a && <p className="text-[11px] text-slate-400 mt-0.5">{a}</p>}</div>);

    // Formas: las de TIZADA (o, sin TIZADA, las guardadas)
    const formasPosibles = p ? p.formas : (valor?.formas || []);
    const terminacionesPosibles = p ? p.terminaciones : (valor?.terminaciones || []);
    const alternar = (lista, x) => (lista.includes(x) ? lista.filter(y => y !== x) : [...lista, x]);

    return (
        <div className="space-y-4">
            <div className="border border-slate-200 rounded-xl p-4">
                {titulo('Variable a medida de TIZADA PRO', 'La prenda de una sola pieza sin talles (pañuelo, toalla, bandera, banderín) que TIZADA arma con la medida de cada pedido. Se carga en TIZADA PRO; acá se elige cuál es la de este producto.')}
                {info && !info.apiActiva && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs font-bold mb-3">No se puede leer TIZADA PRO: {info.motivo}</div>}
                {info?.apiActiva && info.motivo && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-xs font-bold mb-3">{info.motivo}</div>}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Selector value={valor?.variable || ''} disabled={deshabilitado || cargando}
                        onChange={e => { const x = (info?.variables || []).find(y => y.clave === e.target.value); onChange(x ? desdeVariable(x) : null); }}
                        claseBoton={claseSel(`min-w-[300px] border rounded-lg px-2.5 py-2 text-sm font-bold text-slate-800 ${valor?.variable ? 'border-slate-200' : 'border-amber-300'}`)} anchoLista={360}>
                        <option value="">{cargando ? 'Leyendo TIZADA PRO…' : 'Elegí la variable a medida'}</option>
                        {valor?.variable && !v && <option value={valor.variable}>{valor.variableNombre || valor.variable}{info?.apiActiva && !cargando ? ' (ya no está en TIZADA como a medida)' : ''}</option>}
                        {(info?.variables || []).map(x => <option key={x.clave} value={x.clave}>{x.nombre}{x.moldeNombre ? ` · ${x.moldeNombre}` : ''}</option>)}
                    </Selector>
                    <button type="button" onClick={() => cargar(true)} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700" title="Volver a leer las variables a medida de TIZADA PRO">
                        <RefreshCw size={13} aria-hidden="true" className={cargando ? 'animate-spin' : ''} />Actualizar
                    </button>
                    {info?.apiActiva && !cargando && !(info.variables || []).length && <span className="text-[11px] font-bold text-amber-600">TIZADA PRO todavía no tiene ninguna variable a medida: hay que cargarla allá.</span>}
                    {valor?.variable && <span className="text-[10px] font-mono text-slate-300 ml-auto" title="Clave de la variable y molde en TIZADA PRO">{valor.variable} · {valor.molde}</span>}
                </div>
                {p && (
                    <p className="text-[11px] text-slate-500 mt-2">
                        Pieza <b>{p.pieza || '—'}</b> · medidas de {p.minimo} m a {p.maximo} m
                        {p.margenCm ? <> · margen para coser {Math.max(...Object.values(p.margenCm).map(Number).filter(Number.isFinite))} cm por lado (TIZADA lo suma solo)</> : null}
                        {p.overlockCm != null ? <> · overlock {p.overlockCm} cm</> : null}
                    </p>
                )}
            </div>

            {valor?.variable && (<>
                <div className="border border-slate-200 rounded-xl p-4">
                    {titulo('Formas que se ofrecen', 'Marcá las que el cliente puede pedir y elegí la que viene puesta.')}
                    <div className="flex flex-wrap gap-2">
                        {formasPosibles.map(f => {
                            const sel = valor.formas.includes(f);
                            return (
                                <button key={f} type="button" aria-pressed={sel} disabled={deshabilitado || (sel && valor.formas.length === 1)}
                                    onClick={() => { const formas = alternar(valor.formas, f); set({ formas, forma: formas.includes(valor.forma) ? valor.forma : formas[0] }); }}
                                    className={chip(sel)} title={sel && valor.formas.length === 1 ? 'Tiene que quedar al menos una' : ''}>
                                    <IconoForma forma={f} punta={valor.orientacion} className={sel ? 'text-emerald-600' : 'text-slate-400'} />{NOMBRE[f]}
                                </button>
                            );
                        })}
                    </div>
                    {valor.formas.length > 1 && (
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-600 mt-3">Viene puesta:
                            <Selector value={valor.forma} disabled={deshabilitado} onChange={e => set({ forma: e.target.value })} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 min-w-[140px]')}>
                                {valor.formas.map(f => <option key={f} value={f}>{NOMBRE[f]}</option>)}
                            </Selector>
                        </label>
                    )}
                    {valor.formas.includes('triangulo') && (
                        <div className="mt-3">
                            <p className="text-xs font-bold text-slate-600 mb-1.5">Triángulo: hacia dónde va la punta por defecto <span className="font-normal text-slate-400">(abajo = banderín)</span></p>
                            <div className="flex flex-wrap gap-2">
                                {(p?.puntas || ['abajo', 'arriba', 'izq', 'der']).map(o => (
                                    <button key={o} type="button" aria-pressed={valor.orientacion === o} disabled={deshabilitado} onClick={() => set({ orientacion: o })} className={chip(valor.orientacion === o)}>
                                        <IconoForma forma="triangulo" punta={o} className={valor.orientacion === o ? 'text-emerald-600' : 'text-slate-400'} />{NOMBRE[o]}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="border border-slate-200 rounded-xl p-4">
                    {titulo('Terminación del borde', 'Cómo se termina el borde. Cambia cuánta tela lleva. Marcá las que se ofrecen y elegí la que viene puesta.')}
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                        {terminacionesPosibles.map(t => {
                            const sel = valor.terminaciones.includes(t);
                            const def = valor.terminacion === t;
                            return (
                                <div key={t} className={`rounded-xl border-2 p-3 ${def ? 'border-amber-400 bg-amber-50/40' : sel ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200'}`}>
                                    <label className="flex items-center gap-2 text-sm font-black text-slate-800">
                                        <input type="checkbox" checked={sel} disabled={deshabilitado || (sel && valor.terminaciones.length === 1)}
                                            onChange={() => { const ts = alternar(valor.terminaciones, t); set({ terminaciones: ts, terminacion: ts.includes(valor.terminacion) ? valor.terminacion : ts[0] }); }} />
                                        {NOMBRE[t]}
                                    </label>
                                    <p className="text-[11px] text-slate-500 mt-1">{AYUDA_TERMINACION[t]}</p>
                                    {sel && (def
                                        ? <p className="text-[11px] font-bold text-amber-600 mt-1">Viene puesta</p>
                                        : <button type="button" disabled={deshabilitado} onClick={() => set({ terminacion: t })} className="text-[11px] font-bold text-brand-cyan hover:underline mt-1">Que venga puesta</button>)}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4">
                    {titulo('Medidas', 'La medida es la del DISEÑO, en metros (lo que se ve). TIZADA le suma el margen para coser: nunca lo sumes vos.')}
                    <div className="flex flex-wrap gap-2 mb-3" role="radiogroup">
                        {[['LIBRE', 'La escribe el vendedor', 'Cualquier medida entre un mínimo y un máximo'], ['FIJAS', 'Medidas fijas', 'El vendedor elige de una lista (ej. Pañuelo 50 × 50)']].map(([k, t, a]) => (
                            <button key={k} type="button" role="radio" aria-checked={valor.medidas.modo === k} disabled={deshabilitado} onClick={() => set({ medidas: { ...valor.medidas, modo: k } })} className={`${chip(valor.medidas.modo === k)} flex-col !items-start`}>
                                <span>{t}</span><span className="text-[11px] font-normal text-slate-500">{a}</span>
                            </button>
                        ))}
                    </div>
                    {valor.medidas.modo === 'LIBRE' ? (
                        <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-600">
                            <label className="flex items-center gap-1.5">Mínimo <input type="number" step="0.01" min={p?.minimo || 0.05} className={claseInput} value={valor.medidas.minimo_m ?? ''} disabled={deshabilitado}
                                onChange={e => set({ medidas: { ...valor.medidas, minimo_m: num(e.target.value) } })} /> m</label>
                            <label className="flex items-center gap-1.5">Máximo <input type="number" step="0.01" max={p?.maximo || 50} className={claseInput} value={valor.medidas.maximo_m ?? ''} disabled={deshabilitado}
                                onChange={e => set({ medidas: { ...valor.medidas, maximo_m: num(e.target.value) } })} /> m</label>
                            {p && <span className="text-[11px] font-normal text-slate-400">TIZADA acepta de {p.minimo} a {p.maximo} m: lo que se salga se recorta al guardar.</span>}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {valor.medidas.fijas.map((fx, i) => {
                                const setFija = (patch) => { const fijas = [...valor.medidas.fijas]; fijas[i] = { ...fx, ...patch }; set({ medidas: { ...valor.medidas, fijas } }); };
                                const forma = valor.formas.includes(fx.forma) ? fx.forma : valor.forma;
                                return (
                                    <div key={i} className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-xl px-3 py-2">
                                        <input type="text" placeholder="Nombre (ej. Pañuelo 50 × 50)" maxLength={60} className={`${claseInput} !w-52 !font-bold`} value={fx.nombre || ''} disabled={deshabilitado} onChange={e => setFija({ nombre: e.target.value })} />
                                        {valor.formas.length > 1 && (
                                            <Selector value={forma} disabled={deshabilitado} onChange={e => setFija({ forma: e.target.value })} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 min-w-[120px]')}>
                                                {valor.formas.map(f => <option key={f} value={f}>{NOMBRE[f]}</option>)}
                                            </Selector>
                                        )}
                                        {forma === 'circulo' ? (
                                            <label className="flex items-center gap-1 text-xs font-bold text-slate-600">Diámetro <input type="number" step="0.01" className={claseInput} value={fx.diametro_m ?? ''} disabled={deshabilitado} onChange={e => setFija({ diametro_m: num(e.target.value) })} /> m</label>
                                        ) : (<>
                                            <label className="flex items-center gap-1 text-xs font-bold text-slate-600">Ancho <input type="number" step="0.01" className={claseInput} value={fx.ancho_m ?? ''} disabled={deshabilitado} onChange={e => setFija({ ancho_m: num(e.target.value) })} /> m</label>
                                            <label className="flex items-center gap-1 text-xs font-bold text-slate-600">Alto <input type="number" step="0.01" className={claseInput} value={fx.alto_m ?? ''} disabled={deshabilitado} onChange={e => setFija({ alto_m: num(e.target.value) })} /> m</label>
                                        </>)}
                                        {forma === 'triangulo' && (
                                            <Selector value={fx.orientacion || valor.orientacion} disabled={deshabilitado} onChange={e => setFija({ orientacion: e.target.value })} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 min-w-[150px]')}>
                                                {(p?.puntas || ['abajo', 'arriba', 'izq', 'der']).map(o => <option key={o} value={o}>{NOMBRE[o]}</option>)}
                                            </Selector>
                                        )}
                                        <button type="button" disabled={deshabilitado} onClick={() => set({ medidas: { ...valor.medidas, fijas: valor.medidas.fijas.filter((_, j) => j !== i) } })}
                                            className="ml-auto text-slate-400 hover:text-rose-600" title="Quitar esta medida" aria-label="Quitar esta medida"><Trash2 size={15} /></button>
                                    </div>
                                );
                            })}
                            <button type="button" disabled={deshabilitado} onClick={() => set({ medidas: { ...valor.medidas, fijas: [...valor.medidas.fijas, { nombre: '', forma: valor.forma, orientacion: valor.orientacion, ancho_m: '', alto_m: '', diametro_m: '' }] } })}
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-cyan hover:underline"><Plus size={13} />Agregar medida</button>
                            {!valor.medidas.fijas.length && <p className="text-[11px] font-bold text-amber-600">Sin ninguna medida en la lista, al guardar queda como "La escribe el vendedor".</p>}
                        </div>
                    )}
                </div>

                <div className="border border-slate-200 rounded-xl p-4">
                    {titulo('Telas que se ofrecen', 'Las de esta variable en TIZADA. Sin ninguna marcada se ofrecen todas. En la solicitud, TIZADA dice si el total (medida + margen) entra en cada una.')}
                    {!p ? <p className="text-xs text-slate-400">Sin conexión con TIZADA PRO no se pueden listar las telas.{valor.telas.length ? ` Hoy se ofrecen ${valor.telas.length}.` : ''}</p> : (
                        <div className="flex flex-wrap gap-2">
                            {p.telas.map(t => {
                                const sel = valor.telas.includes(t.id);
                                return (
                                    <button key={t.id} type="button" aria-pressed={sel} disabled={deshabilitado} onClick={() => set({ telas: alternar(valor.telas, t.id) })} className={chip(sel)}>
                                        <span>{t.nombre}</span>{t.entraHastaCm ? <span className="text-[11px] font-normal text-slate-400">entra hasta {t.entraHastaCm} cm</span> : null}
                                    </button>
                                );
                            })}
                            {!p.telas.length && <p className="text-xs font-bold text-amber-600">La variable no tiene telas en TIZADA PRO.</p>}
                        </div>
                    )}
                </div>

                <div className="border border-slate-200 rounded-xl p-4">
                    {titulo('Tiras', 'Las cintas que se cosen para atar. TIZADA imprime una marca donde va cada una (siempre negra con contorno blanco). Por lado, contando las 2 puntas: 5 = una en cada esquina y 3 en el medio · 1 = una en el medio · 0 = sin tiras.')}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-bold text-slate-700 mb-3">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!valor.tiras.lleva} disabled={deshabilitado} onChange={e => set({ tiras: { ...valor.tiras, lleva: e.target.checked } })} />Lleva tiras</label>
                        {valor.tiras.lleva && <label className="flex items-center gap-2"><input type="checkbox" checked={valor.tiras.marcar !== false} disabled={deshabilitado} onChange={e => set({ tiras: { ...valor.tiras, marcar: e.target.checked } })} />Marcarlas en la tizada <span className="text-[11px] font-normal text-slate-400">(sin tilde: solo en la ficha técnica)</span></label>}
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!valor.tiras.fijas} disabled={deshabilitado} onChange={e => set({ tiras: { ...valor.tiras, fijas: e.target.checked } })} />El vendedor no las cambia</label>
                    </div>
                    {valor.tiras.lleva && (
                        <div className="space-y-2">
                            {valor.formas.map(f => (
                                <div key={f} className="flex flex-wrap items-center gap-3">
                                    <span className="inline-flex items-center gap-1.5 w-32 text-xs font-black text-slate-600"><IconoForma forma={f} punta={valor.orientacion} size={20} className="text-slate-400" />{NOMBRE[f]}</span>
                                    {LADOS[f].map(l => (
                                        <label key={l} className="flex items-center gap-1 text-xs font-bold text-slate-600">{NOMBRE_LADO[l]}
                                            <input type="number" min="0" max={l === 'alrededor' ? 200 : 50} step="1" className={`${claseInput} !w-16`} value={valor.tiras.lados?.[l] ?? 0} disabled={deshabilitado}
                                                onChange={e => set({ tiras: { ...valor.tiras, lados: { ...valor.tiras.lados, [l]: Math.max(0, parseInt(e.target.value, 10) || 0) } } })} />
                                        </label>
                                    ))}
                                </div>
                            ))}
                            {valor.terminaciones.includes('sin') && <p className="text-[11px] text-slate-400 flex items-center gap-1"><Info size={12} />Con "Sin terminación" las tiras no se marcan: van solo en la ficha.</p>}
                        </div>
                    )}
                </div>
            </>)}
        </div>
    );
}
