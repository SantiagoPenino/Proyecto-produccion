import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Loader2, ChevronLeft, ChevronRight, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import {
    categoria as categoriaInfo, prioridad as prioridadInfo, estado as estadoInfo, resultado as resultadoInfo, ESTADOS_PROYECTO,
    fmtFecha, fmtDia, fmtDuracion, fmtPlata, fmtCantidad, sumarDias, lunesDe, diaCorto, hoyISO, mensajeError,
} from './constantes';
import { chip } from './ui';

// Reportes de Servicio Técnico (etapa 5): resumen por período y reporte semanal para imprimir.

const PRESETS = [
    ['30', 'Últimos 30 días', (h) => [sumarDias(h, -29), h]],
    ['mes', 'Este mes', (h) => [`${h.slice(0, 8)}01`, h]],
    ['mesAnt', 'Mes anterior', (h) => { const fin = sumarDias(`${h.slice(0, 8)}01`, -1); return [`${fin.slice(0, 8)}01`, fin]; }],
    ['90', 'Últimos 90 días', (h) => [sumarDias(h, -89), h]],
    ['anio', 'Este año', (h) => [`${h.slice(0, 4)}-01-01`, h]],
];

const Tarjeta = ({ titulo, valor, nota }) => (
    <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 break-inside-avoid">
        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">{titulo}</div>
        <div className="text-xl font-black text-zinc-800 leading-tight">{valor}</div>
        {nota && <div className="text-[11px] text-zinc-400">{nota}</div>}
    </div>
);
const Bloque = ({ titulo, children, nota }) => (
    <section className="mb-5 break-inside-avoid">
        <h3 className="text-sm font-black text-zinc-700 uppercase tracking-wide mb-2">{titulo}{nota && <span className="ml-2 normal-case font-bold text-zinc-400 text-xs">{nota}</span>}</h3>
        {children}
    </section>
);
const BarraH = ({ valor, max, color = 'bg-brand-cyan' }) => (
    <div className="h-2 bg-zinc-100 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${max ? Math.max(3, Math.round((valor / max) * 100)) : 0}%` }} /></div>
);
const th = 'px-2 py-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-wide text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-sm text-zinc-700 whitespace-nowrap';

const Totales = ({ t }) => (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-5">
        <Tarjeta titulo="Nuevas" valor={t.Nuevas} />
        <Tarjeta titulo="Finalizadas" valor={t.Finalizadas} nota={`${t.Resueltas} resueltas`} />
        <Tarjeta titulo="Abiertas ahora" valor={t.AbiertasAhora} />
        <Tarjeta titulo="Respuesta" valor={t.RespuestaProm != null ? fmtDuracion(t.RespuestaProm) : '—'} nota="promedio hasta tomarla" />
        <Tarjeta titulo="Resolución" valor={t.ResolucionProm != null ? fmtDuracion(t.ResolucionProm) : '—'} nota="promedio hasta finalizarla" />
        <Tarjeta titulo="Parada" valor={fmtDuracion(t.MinutosParada) || '0 min'} nota="máquinas reportadas paradas" />
        <Tarjeta titulo="Derivaciones" valor={t.Derivaciones} />
    </div>
);

const TablaTecnicos = ({ tecnicos, compacta = false }) => {
    const [abierto, setAbierto] = useState(null);
    const conActividad = tecnicos.filter(t => t.tomadas || t.finalizadas || t.derivadas || t.trabajosRealizados || t.trabajosNoRealizados || t.pospuestos);
    if (!conActividad.length) return <p className="text-sm text-zinc-400">Sin actividad de técnicos en el período.</p>;
    return (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
            <table className="w-full">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                    <tr>
                        <th className={th}>Técnico</th><th className={th}>Tomadas</th><th className={th}>Finalizadas</th><th className={th}>Resueltas</th>
                        {!compacta && <><th className={th}>En parte</th><th className={th}>No resueltas</th></>}
                        <th className={th}>Derivadas</th><th className={th}>Respuesta</th><th className={th}>Resolución</th>
                        <th className={th}>Trabajos</th><th className={th}>Tiempo real / estimado</th>{!compacta && <th className={th}>Pospuestos</th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                    {conActividad.map(t => (
                        <FilaTecnico key={t.id} t={t} compacta={compacta} abierto={abierto === t.id} onAlternar={() => setAbierto(abierto === t.id ? null : t.id)} />
                    ))}
                </tbody>
            </table>
        </div>
    );
};
const FilaTecnico = ({ t, compacta, abierto, onAlternar }) => (
    <>
        <tr>
            <td className={`${td} font-bold text-zinc-800`}>{t.nombre}</td>
            <td className={td}>{t.tomadas}</td>
            <td className={td}>{t.finalizadas}</td>
            <td className={td}>{t.resueltas}</td>
            {!compacta && <><td className={td}>{t.parciales}</td><td className={td}>{t.noResueltas}</td></>}
            <td className={td}>
                {t.derivadas > 0 ? (
                    <button onClick={onAlternar} className="inline-flex items-center gap-1 font-bold text-violet-700 hover:underline print:no-underline">
                        {t.derivadas} {abierto ? <ChevronUp size={13} className="print:hidden" /> : <ChevronDown size={13} className="print:hidden" />}
                    </button>
                ) : 0}
            </td>
            <td className={td}>{t.respuestaProm != null ? fmtDuracion(t.respuestaProm) : '—'}</td>
            <td className={td}>{t.resolucionProm != null ? fmtDuracion(t.resolucionProm) : '—'}</td>
            <td className={td}>{t.trabajosRealizados}{t.trabajosNoRealizados ? <span className="text-red-600"> (+{t.trabajosNoRealizados} no)</span> : ''}</td>
            <td className={td}>{t.minutosReales ? `${fmtDuracion(t.minutosReales)} / ${fmtDuracion(t.minutosEstimados)}` : '—'}</td>
            {!compacta && <td className={td}>{t.pospuestos}</td>}
        </tr>
        {(abierto || compacta) && t.motivos.length > 0 && (
            <tr className="bg-violet-50/40">
                <td colSpan={compacta ? 9 : 12} className="px-3 py-2">
                    <div className="text-[11px] font-black text-violet-700 uppercase tracking-wide mb-1">Derivaciones y por qué</div>
                    <ul className="flex flex-col gap-0.5">
                        {t.motivos.map((m, i) => (
                            <li key={i} className="text-xs text-zinc-600 whitespace-normal">
                                <span className="font-mono font-bold text-zinc-400">{m.codigo}</span> {m.titulo} → <b>{m.a}</b>: {m.motivo} <span className="text-zinc-400">({fmtFecha(m.fecha)})</span>
                            </li>
                        ))}
                    </ul>
                </td>
            </tr>
        )}
    </>
);

const ListaMaquinas = ({ maquinas, onAbrirMaquina, tope = 15 }) => {
    const max = Math.max(1, ...maquinas.map(m => m.Fallas));
    if (!maquinas.length) return <p className="text-sm text-zinc-400">Sin fallas de máquinas en el período.</p>;
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
            {maquinas.slice(0, tope).map((m, i) => (
                <button key={m.EquipoId} onClick={() => onAbrirMaquina?.(m.EquipoId)} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 break-inside-avoid">
                    <div className="flex items-center gap-2">
                        <span className="w-5 text-xs font-black text-zinc-400">{i + 1}</span>
                        <span className="font-bold text-sm text-zinc-800 min-w-0 truncate">{m.Nombre}</span>
                        <span className="text-xs text-zinc-400">{m.AreaID}</span>
                        <span className="ml-auto text-sm font-black text-zinc-700">{m.Fallas}</span>
                    </div>
                    <div className="ml-7 mt-1"><BarraH valor={m.Fallas} max={max} color="bg-red-400" /></div>
                    <div className="ml-7 mt-1 text-[11px] text-zinc-500">
                        {m.Graves > 0 && <span>{m.Graves} alta/crítica · </span>}
                        {m.Paradas > 0 && <span>{m.Paradas} con la máquina parada · parada {fmtDuracion(m.MinutosParada)} · </span>}
                        {m.titulos.map(t => `${t.titulo}${t.n > 1 ? ` (×${t.n})` : ''}`).join(' · ')}
                    </div>
                </button>
            ))}
        </div>
    );
};

const ListaSolicitantes = ({ solicitantes, tope = 15 }) => {
    const max = Math.max(1, ...solicitantes.map(s => s.Solicitudes));
    if (!solicitantes.length) return <p className="text-sm text-zinc-400">Nadie pidió nada en el período.</p>;
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
            {solicitantes.slice(0, tope).map((s, i) => (
                <div key={`${s.SolicitanteId}-${s.Nombre}-${i}`} className="px-4 py-2 break-inside-avoid">
                    <div className="flex items-center gap-2">
                        <span className="w-5 text-xs font-black text-zinc-400">{i + 1}</span>
                        <span className="font-bold text-sm text-zinc-800 truncate">{s.Nombre || 'Sin nombre'}</span>
                        {s.Area && <span className="text-xs text-zinc-400">{s.Area}</span>}
                        <span className="ml-auto text-sm font-black text-zinc-700">{s.Solicitudes}</span>
                    </div>
                    <div className="ml-7 mt-1"><BarraH valor={s.Solicitudes} max={max} /></div>
                    <div className="ml-7 mt-0.5 text-[11px] text-zinc-500">{s.DeMaquinas} de máquinas · {s.Graves} alta/crítica{s.Canceladas ? ` · ${s.Canceladas} canceladas (duplicadas o no correspondían)` : ''}</div>
                </div>
            ))}
        </div>
    );
};

const Insumos = ({ insumos }) => (
    insumos.porMoneda.length === 0 ? <p className="text-sm text-zinc-400">No se usaron insumos en el período.</p> : (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-700 mb-2">Total: <b>{insumos.porMoneda.map(m => fmtPlata(m.Total || 0, m.Moneda)).join(' + ')}</b> <span className="text-zinc-400">({insumos.porMoneda.reduce((s, m) => s + m.Usos, 0)} usos)</span></p>
            <ul className="divide-y divide-zinc-100">
                {insumos.top.map(i => (
                    <li key={`${i.VarId}-${i.Moneda}`} className="py-1.5 flex items-center gap-3 text-sm">
                        <span className="min-w-0 flex-1 truncate"><b>{fmtCantidad(i.Cantidad)} {i.Unidad}</b> {i.Nombre}</span>
                        <span className="text-xs text-zinc-400">{i.Usos} uso{i.Usos === 1 ? '' : 's'}</span>
                        {i.Total != null && <span className="text-xs font-bold text-zinc-600">{fmtPlata(i.Total, i.Moneda)}</span>}
                    </li>
                ))}
            </ul>
        </div>
    )
);

// ── Resumen por período ──────────────────────────────────────────────────────
const Resumen = ({ onAbrirMaquina }) => {
    const hoy = hoyISO();
    const [preset, setPreset] = useState('30');
    const [rango, setRango] = useState(PRESETS[0][2](hoy));
    const [d, setD] = useState(null);
    const [cargando, setCargando] = useState(false);
    const cargar = useCallback(async () => {
        setCargando(true);
        try { setD(await servicioTecnicoService.reporteResumen(rango[0], rango[1])); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo armar el reporte')); }
        finally { setCargando(false); }
    }, [rango]);
    useEffect(() => { cargar(); }, [cargar]);
    const maxCat = d ? Math.max(1, ...d.categorias.map(c => c.N)) : 1;
    const sel = 'px-3 py-2 border border-zinc-200 rounded-xl text-sm text-zinc-700 bg-white outline-none focus:border-brand-cyan';
    return (
        <div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap gap-2 items-center">
                {PRESETS.map(([k, t, f]) => (
                    <button key={k} onClick={() => { setPreset(k); setRango(f(hoy)); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${preset === k ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}>{t}</button>
                ))}
                <input type="date" className={sel} value={rango[0]} max={rango[1]} onChange={(e) => { setPreset(''); setRango([e.target.value, rango[1]]); }} />
                <input type="date" className={sel} value={rango[1]} min={rango[0]} onChange={(e) => { setPreset(''); setRango([rango[0], e.target.value]); }} />
                {cargando && <Loader2 size={16} className="animate-spin text-zinc-300" />}
            </div>
            {!d ? <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div> : (
                <>
                    <Totales t={d.totales} />
                    <Bloque titulo="Técnicos" nota="tomadas, resueltas, finalizadas, derivadas (tocá el número para ver por qué)"><TablaTecnicos tecnicos={d.tecnicos} /></Bloque>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4">
                        <Bloque titulo="Máquinas que más fallan"><ListaMaquinas maquinas={d.maquinas} onAbrirMaquina={onAbrirMaquina} /></Bloque>
                        <Bloque titulo="Quién reporta más fallas"><ListaSolicitantes solicitantes={d.solicitantes} /></Bloque>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4">
                        <Bloque titulo="Por tipo">
                            {d.categorias.length === 0 ? <p className="text-sm text-zinc-400">Sin solicitudes.</p> : (
                                <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-2">
                                    {d.categorias.map(c => (
                                        <div key={c.Categoria}>
                                            <div className="flex justify-between text-sm"><span className="font-bold text-zinc-700">{categoriaInfo(c.Categoria).label}</span><span className="font-black">{c.N}</span></div>
                                            <BarraH valor={c.N} max={maxCat} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Bloque>
                        <Bloque titulo="Insumos usados"><Insumos insumos={d.insumos} /></Bloque>
                    </div>
                </>
            )}
        </div>
    );
};

// ── Reporte semanal (para imprimir) ──────────────────────────────────────────
const Semanal = ({ semanaInicial, onAbrirMaquina }) => {
    const hoy = hoyISO();
    const [lunes, setLunes] = useState(lunesDe(semanaInicial || sumarDias(hoy, -7)));
    const [d, setD] = useState(null);
    const cargar = useCallback(async () => {
        setD(null);
        try { setD(await servicioTecnicoService.reporteSemanal(lunes)); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo armar el reporte semanal')); }
    }, [lunes]);
    useEffect(() => { cargar(); }, [cargar]);
    const avancesPorProyecto = useMemo(() => {
        const m = new Map();
        (d?.proyectos.avances || []).forEach(a => { if (!m.has(a.ProyId)) m.set(a.ProyId, { titulo: a.Titulo, progreso: a.Progreso, estado: a.Estado, avances: [] }); m.get(a.ProyId).avances.push(a); });
        return [...m.values()];
    }, [d]);
    const totalUsos = (d?.usos || []).reduce((t, u) => { if (u.CostoTotal != null) t[u.Moneda || 'UYU'] = (t[u.Moneda || 'UYU'] || 0) + Number(u.CostoTotal); return t; }, {});
    return (
        <div>
            {/* Solo se imprime el reporte: el resto de la pantalla queda oculto al imprimir. */}
            <style>{`@media print {
                body * { visibility: hidden !important; }
                .st-imprimible, .st-imprimible * { visibility: visible !important; }
                .st-imprimible { position: absolute; left: 0; top: 0; width: 100%; padding: 0 8mm; }
                .print\\:hidden { display: none !important; }
            }`}</style>
            <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap gap-2 items-center print:hidden">
                <button onClick={() => setLunes(sumarDias(lunes, -7))} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:bg-zinc-100"><ChevronLeft size={18} /></button>
                <span className="px-2 text-sm font-black text-zinc-700">{diaCorto(lunes)} – {diaCorto(sumarDias(lunes, 6))}</span>
                <button onClick={() => setLunes(sumarDias(lunes, 7))} disabled={lunes >= lunesDe(hoy)} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"><ChevronRight size={18} /></button>
                <button onClick={() => window.print()} disabled={!d} className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40"><Printer size={16} /> Imprimir / PDF</button>
            </div>
            {!d ? <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div> : (
                <div className="st-imprimible">
                    <h2 className="text-xl font-black text-zinc-900 mb-1">Reporte semanal de Servicio Técnico</h2>
                    <p className="text-sm text-zinc-500 mb-4">Semana del {fmtDia(d.desde)} al {fmtDia(d.hasta)} · generado {fmtFecha(new Date())}</p>
                    <Totales t={d.totales} />

                    <Bloque titulo="Fallas de la semana" nota={`${d.fallas.length} (pedidas o cerradas en la semana)`}>
                        {d.fallas.length === 0 ? <p className="text-sm text-zinc-400">Ninguna.</p> : (
                            <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
                                <table className="w-full">
                                    <thead className="bg-zinc-50 border-b border-zinc-200"><tr>
                                        <th className={th}>N°</th><th className={th}>Pedida</th><th className={th}>Máquina / equipo</th><th className={th}>Qué pasó</th>
                                        <th className={th}>Prioridad</th><th className={th}>Estado</th><th className={th}>Técnico</th><th className={th}>Parada</th>
                                    </tr></thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {d.fallas.map(f => (
                                            <tr key={f.SolId}>
                                                <td className={`${td} font-mono text-xs text-zinc-400`}>{f.Codigo}</td>
                                                <td className={td}>{fmtFecha(f.FechaSolicitud)}</td>
                                                <td className={td}>{f.EquipoNombre || f.EquipoTexto || categoriaInfo(f.Categoria).corto}</td>
                                                <td className={`${td} whitespace-normal min-w-[180px]`}>{f.Titulo}</td>
                                                <td className={td}><span className={`${chip} ${prioridadInfo(f.Prioridad).chip}`}>{prioridadInfo(f.Prioridad).label}</span></td>
                                                <td className={td}>{f.Resultado ? resultadoInfo(f.Resultado)?.label : estadoInfo(f.Estado).label}</td>
                                                <td className={td}>{f.TecnicoNombre || '—'}</td>
                                                <td className={td}>{f.MinutosParada != null ? fmtDuracion(f.MinutosParada) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Bloque>

                    <Bloque titulo="Mantenimientos y tareas">
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
                            <Tarjeta titulo="Programados" valor={d.trabajos.programados} nota={Object.entries(d.trabajos.porTipo).map(([k, n]) => `${n} ${k === 'TAREA' ? 'tareas' : 'mant.'}`).join(' · ')} />
                            <Tarjeta titulo="Realizados" valor={d.trabajos.realizados} />
                            <Tarjeta titulo="No realizados" valor={d.trabajos.noRealizados} />
                            <Tarjeta titulo="Pendientes" valor={d.trabajos.pendientes} nota={`${d.trabajos.cancelados} cancelados`} />
                            <Tarjeta titulo="Tiempo" valor={d.trabajos.minReales ? fmtDuracion(d.trabajos.minReales) : '—'} nota={d.trabajos.minEstimadosRealizados ? `estimado ${fmtDuracion(d.trabajos.minEstimadosRealizados)}` : null} />
                        </div>
                        {d.trabajos.pospuestos.length > 0 && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3">
                                <div className="text-[11px] font-black text-amber-700 uppercase tracking-wide mb-1">Pospuestos ({d.trabajos.pospuestos.length})</div>
                                <ul className="flex flex-col gap-0.5">
                                    {d.trabajos.pospuestos.map((p, i) => <li key={i} className="text-xs text-zinc-700">{p.Titulo}: {p.Detalle} — {p.Motivo} <span className="text-zinc-400">({p.UsuarioNombre})</span></li>)}
                                </ul>
                            </div>
                        )}
                    </Bloque>

                    <Bloque titulo="Proyectos">
                        {d.proyectos.activos.length === 0 && avancesPorProyecto.length === 0 ? <p className="text-sm text-zinc-400">Sin proyectos activos.</p> : (
                            <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                                {d.proyectos.activos.map(p => {
                                    const av = avancesPorProyecto.find(a => a.titulo === p.Titulo);
                                    return (
                                        <div key={p.ProyId} className="px-4 py-2.5 break-inside-avoid">
                                            <div className="flex items-center gap-2 text-sm">
                                                <span className="font-bold text-zinc-800 min-w-0 truncate">{p.Titulo}</span>
                                                <span className={`${chip} ${(ESTADOS_PROYECTO[p.Estado] || ESTADOS_PROYECTO.PLANIFICADO).chip}`}>{(ESTADOS_PROYECTO[p.Estado] || ESTADOS_PROYECTO.PLANIFICADO).label}</span>
                                                {p.Atrasado === 1 && <span className={`${chip} bg-red-50 text-red-700 border-red-200`}>Atrasado</span>}
                                                <span className="ml-auto font-black text-zinc-700">{p.Progreso}%</span>
                                            </div>
                                            <div className="text-[11px] text-zinc-500">{p.ResponsableNombre || 'sin responsable'}{p.FechaEstimadaFin && ` · fin estimado ${fmtDia(p.FechaEstimadaFin)}`}</div>
                                            {av ? av.avances.map((a, i) => <p key={i} className="mt-1 text-xs text-zinc-700 whitespace-pre-wrap">• {a.Detalle} <span className="text-zinc-400">({a.UsuarioNombre}, {fmtFecha(a.Fecha)})</span></p>)
                                                : <p className="mt-1 text-xs text-zinc-400">Sin avances esta semana.</p>}
                                        </div>
                                    );
                                })}
                                {d.proyectos.cambios.map((c, i) => (
                                    <div key={`c${i}`} className="px-4 py-2 text-xs text-zinc-600"><b>{c.Titulo}</b>: {c.Detalle}{c.Motivo ? ` — ${c.Motivo}` : ''} <span className="text-zinc-400">({c.UsuarioNombre}, {fmtFecha(c.Fecha)})</span></div>
                                ))}
                            </div>
                        )}
                    </Bloque>

                    <Bloque titulo="Técnicos"><TablaTecnicos tecnicos={d.tecnicos} compacta /></Bloque>
                    <Bloque titulo="Máquinas con más fallas"><ListaMaquinas maquinas={d.maquinas} onAbrirMaquina={onAbrirMaquina} tope={10} /></Bloque>

                    <Bloque titulo="Insumos usados" nota={Object.keys(totalUsos).length ? `total ${Object.entries(totalUsos).map(([m, n]) => fmtPlata(n, m)).join(' + ')}` : null}>
                        {d.usos.length === 0 ? <p className="text-sm text-zinc-400">Ninguno.</p> : (
                            <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                                {d.usos.map((u, i) => (
                                    <div key={i} className="px-4 py-1.5 flex items-center gap-3 text-sm">
                                        <span className="min-w-0 flex-1"><b>{fmtCantidad(u.Cantidad)} {u.Unidad}</b> {u.Nombre} <span className="text-xs text-zinc-400">· {fmtFecha(u.Fecha)} · {u.UsuarioNombre}{u.EquipoNombre ? ` · ${u.EquipoNombre}` : ''}</span></span>
                                        {u.CostoTotal != null && <span className="text-xs font-bold text-zinc-600">{fmtPlata(u.CostoTotal, u.Moneda)}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Bloque>
                </div>
            )}
        </div>
    );
};

const ReportesVista = ({ semanaInicial, onAbrirMaquina }) => {
    const [tab, setTab] = useState(semanaInicial ? 'semanal' : 'resumen');
    return (
        <div>
            <div className="flex gap-1 mb-3 print:hidden">
                {[['resumen', 'Resumen'], ['semanal', 'Semanal']].map(([k, t]) => (
                    <button key={k} onClick={() => setTab(k)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${tab === k ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-100'}`}>{t}</button>
                ))}
            </div>
            {tab === 'resumen' ? <Resumen onAbrirMaquina={onAbrirMaquina} /> : <Semanal semanaInicial={semanaInicial} onAbrirMaquina={onAbrirMaquina} />}
        </div>
    );
};

export default ReportesVista;
