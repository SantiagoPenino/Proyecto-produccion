import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Timer, X, Loader2, TriangleAlert } from 'lucide-react';
import { cicloPlantaService } from '../../../services/api';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';
import { fmtDuracion, fmtDiasHabiles, fmtCiclo, fmtHorasCorto, superaJornada, fmtCorridos, ORIGEN_INICIO, tituloCiclo, PASO_CICLO, listaPasos, textoPasos } from '../../../utils/cicloPlanta';

// Tiempo de respuesta del área (plan INF-SIS-2026-04): promedio del ciclo en planta de las órdenes de clientes
// (Normal y Urgente) que quedaron prontas en los últimos 7 días. El ciclo de cada orden son las horas laborales
// del área desde que entró hasta que quedó pronta, sin feriados ni espera del cliente (lo calcula el job «Ciclo en
// planta» cada 10 minutos). Va en la cabecera del área; al tocarlo se abre el detalle.

// Período de la cabecera y con el que abre el detalle: 7 días desde el 28/10/2026 (antes 30; lo pidió Santiago).
const DIAS_POR_DEFECTO = 7;
const PERIODOS = [
    { id: '7', label: '7 días' },
    { id: '30', label: '30 días' },
    { id: '90', label: '90 días' },
    { id: 'fechas', label: 'Fechas' },
];
const COLOR_PRIORIDAD = {
    Urgente: 'text-brand-magenta',
    Falla: 'text-red-600',
    'Reposición': 'text-amber-600',
    Normal: 'text-zinc-700',
};
const num = (n) => Number(n || 0).toLocaleString('es-UY');
const ddmm = (iso) => { const [, m, d] = String(iso).split('-'); return `${d}/${m}`; };
const fechaHora = (f) => (f ? new Date(f).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—');

const useResumen = (area, params) => useQuery({
    queryKey: ['ciclo-planta', area, params],
    queryFn: () => cicloPlantaService.getResumen(area, params),
    enabled: !!area,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
});

// El paso en el que la orden pasó más tiempo
const mayorPaso = (pasos) => listaPasos(pasos).reduce((a, b) => (b.minutos > a.minutos ? b : a));

// Barra apilada con los pasos de una orden (o de los promedios del área), cada uno en su color.
const BarraPasos = ({ pasos, className = 'h-3' }) => {
    const lista = listaPasos(pasos);
    const total = lista.reduce((t, p) => t + p.minutos, 0);
    if (!total) return null;
    return (
        <div className={`flex w-full rounded-full overflow-hidden bg-zinc-100 ${className}`} title={textoPasos(pasos)}>
            {lista.map(p => <div key={p.id} className={p.color} style={{ width: `${(100 * p.minutos) / total}%` }} />)}
        </div>
    );
};

// (28/10/2026) En qué se va el ciclo: promedio por orden de cada paso (las que no pasaron por el paso cuentan 0, así
// los pasos suman el promedio) y, aparte, cuántas pasaron y cuánto tardaron esas.
function PorPaso({ d, jornada }) {
    const pasos = Object.fromEntries(d.pasos.map(p => [p.paso, p.promedio]));
    const total = d.pasos.reduce((t, p) => t + (p.promedio || 0), 0) || 1;
    return (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="text-xs font-black uppercase tracking-wider text-zinc-500">Por paso · promedio por orden</div>
                {d.pasosOrdenes < d.ordenes && (
                    <span className="text-[11px] font-bold text-amber-600">Calculado sobre {num(d.pasosOrdenes)} de {num(d.ordenes)} órdenes: el resto se completa en unos minutos.</span>
                )}
            </div>
            <div className="px-4 pb-2"><BarraPasos pasos={pasos} /></div>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
                        <th className="text-left font-black px-4 py-1.5">Paso</th>
                        <th className="text-right font-black px-2 py-1.5">Por orden</th>
                        <th className="text-right font-black px-2 py-1.5">Del ciclo</th>
                        <th className="text-right font-black px-2 py-1.5 hidden sm:table-cell">Pasaron</th>
                        <th className="text-right font-black px-4 py-1.5 hidden sm:table-cell">Esas tardaron</th>
                    </tr>
                </thead>
                <tbody>
                    {d.pasos.map(p => {
                        const info = PASO_CICLO[p.paso] || { label: p.paso, color: 'bg-zinc-300', ayuda: '' };
                        return (
                            <tr key={p.paso} className="border-b border-zinc-50 last:border-0">
                                <td className="px-4 py-2" title={info.ayuda}>
                                    <span className="inline-flex items-center gap-2 font-bold text-zinc-700">
                                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${info.color}`} />{info.label}
                                    </span>
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums font-bold text-zinc-800">{fmtCiclo(p.promedio, jornada, { corto: true })}</td>
                                <td className="px-2 py-2 text-right tabular-nums text-zinc-600">{Math.round((100 * (p.promedio || 0)) / total)} %</td>
                                <td className="px-2 py-2 text-right tabular-nums text-zinc-500 hidden sm:table-cell">{num(p.ordenes)}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-zinc-500 hidden sm:table-cell">{fmtCiclo(p.promedioConPaso, jornada, { corto: true })}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="px-4 py-2.5 border-t border-zinc-100 text-[11px] text-zinc-400 leading-relaxed">
                Cada orden suma su tiempo al paso en el que estaba según sus marcas: cuándo la pusieron en un lote, cuándo la tildaron impresa y cuándo
                quedó Pronto; los botones del lote («Iniciar producción», calandra) solo separan la espera de la impresión. «Por orden» cuenta 0 en las
                que no pasaron por el paso, así los pasos suman el promedio; «Esas tardaron» es el promedio de las que sí. Pasá el mouse por cada paso
                para ver qué incluye.
            </p>
        </div>
    );
}

const Tarjeta = ({ titulo, valor, detalle }) => (
    <div className="bg-white rounded-2xl border border-zinc-200 px-4 py-3 min-w-0">
        <div className="text-[10px] font-black uppercase tracking-wider text-zinc-400">{titulo}</div>
        <div className="text-xl font-black text-zinc-800 leading-tight mt-0.5">{valor}</div>
        {detalle && <div className="text-xs text-zinc-500 mt-0.5">{detalle}</div>}
    </div>
);

function DetalleCiclo({ area, nombre, onCerrar, onAbrirOrden }) {
    const [periodo, setPeriodo] = useState(String(DIAS_POR_DEFECTO));
    const [desde, setDesde] = useState('');
    const [hasta, setHasta] = useState('');
    const conFechas = periodo === 'fechas';
    const fechasOk = conFechas && desde && hasta && desde <= hasta;
    const params = conFechas ? (fechasOk ? { desde, hasta } : null) : { dias: Number(periodo) };
    const { data: d, isLoading, isError, isPlaceholderData, isFetching } = useQuery({
        queryKey: ['ciclo-planta', area, params],
        queryFn: () => cicloPlantaService.getResumen(area, params),
        enabled: !!area && !!params,
        staleTime: 5 * 60 * 1000,
        // Al cambiar de período sigue a la vista el anterior, atenuado, hasta que llega el nuevo. Antes el cuerpo pasaba
        // a la ruedita y el modal se achicaba y volvía a crecer (28/10).
        placeholderData: keepPreviousData,
    });
    const esperandoFechas = conFechas && !fechasOk;
    const atenuado = isPlaceholderData || esperandoFechas;
    const jornada = d?.minutosJornada;
    const maxSemana = Math.max(1, ...(d?.semanas || []).map(s => s.promedio || 0));
    // Las barras van todas en la misma unidad: en días hábiles solo si alguna semana pasa de una jornada
    const semanasEnDias = (d?.semanas || []).some(s => s.ordenes && superaJornada(s.promedio, jornada));

    return createPortal(
        <div className="fixed inset-0 z-[6000] flex items-start sm:items-center justify-center bg-zinc-900/60 overflow-y-auto p-0 sm:p-4" onMouseDown={onCerrar}>
            <div className="bg-zinc-50 shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden h-[100dvh] sm:h-auto sm:max-h-[90vh] sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-zinc-200 shrink-0">
                    <Timer size={30} className="text-brand-cyan shrink-0" />
                    <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-black uppercase text-zinc-800 leading-tight truncate">Tiempo de respuesta</h3>
                        <div className="text-xs font-bold text-zinc-400 truncate">{nombre}</div>
                    </div>
                    <button onClick={onCerrar} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 shrink-0"><X size={18} /></button>
                </div>

                {/* Bloques uno abajo del otro (no flex: dentro de un alto fijo, flex las aplastaba en vez de scrollear) */}
                <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
                    {/* Período: pastillas en escritorio, selector en el celular */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1 bg-white border border-zinc-200 rounded-xl p-1">
                            {PERIODOS.map(p => (
                                <button key={p.id} onClick={() => setPeriodo(p.id)}
                                    className={`px-3 h-7 rounded-lg text-xs font-bold transition-colors ${periodo === p.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <div className="sm:hidden w-full">
                            <Selector value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-full">
                                {PERIODOS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                            </Selector>
                        </div>
                        {conFechas && (
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <SelectorFecha filtro value={desde} onChange={(e) => setDesde(e.target.value)} max={hasta || undefined} placeholder="Desde" resaltar={false} />
                                <SelectorFecha filtro value={hasta} onChange={(e) => setHasta(e.target.value)} min={desde || undefined} placeholder="Hasta" resaltar={false} />
                            </div>
                        )}
                        {isPlaceholderData && isFetching && <Loader2 size={16} className="animate-spin text-brand-cyan shrink-0" aria-label="Cargando" />}
                        {esperandoFechas && d && <span className="text-xs font-bold text-zinc-500">Elegí desde y hasta.</span>}
                    </div>

                    {esperandoFechas && !d ? (
                        <p className="text-sm text-zinc-500 py-8 text-center">Elegí desde y hasta.</p>
                    ) : isLoading ? (
                        <div className="py-16 flex justify-center"><Loader2 size={24} className="animate-spin text-brand-cyan" /></div>
                    ) : isError || !d ? (
                        <p className="text-sm text-brand-magenta py-8 text-center">No se pudo cargar el tiempo de respuesta.</p>
                    ) : d.sinTabla ? (
                        <p className="text-sm text-zinc-500 py-8 text-center">Todavía no se calcula el ciclo de las órdenes: falta crear la tabla en la base.</p>
                    ) : (
                        <div className={`space-y-4 transition-opacity ${atenuado ? 'opacity-40 pointer-events-none select-none' : ''}`} aria-busy={isPlaceholderData && isFetching}>
                            {!d.tieneHorario && (
                                <div className="flex gap-2 items-start rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    <TriangleAlert size={18} className="shrink-0 mt-0.5" />
                                    <span>Esta área no tiene horario laboral cargado: se cuenta de lunes a viernes de 9 a 17. Cargalo en Configuración › Horario laboral.</span>
                                </div>
                            )}

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <Tarjeta titulo="Promedio" valor={fmtCiclo(d.promedio, jornada)} detalle={superaJornada(d.promedio, jornada) ? `${fmtDuracion(d.promedio)} laborales` : 'horas laborales del área'} />
                                <Tarjeta titulo="Mediana" valor={fmtCiclo(d.mediana, jornada)} detalle={superaJornada(d.mediana, jornada) ? `${fmtDuracion(d.mediana)} · la mitad tardó menos` : 'la mitad tardó menos'} />
                                <Tarjeta titulo="Órdenes" valor={num(d.ordenes)} detalle={`prontas del ${ddmm(d.desde)} al ${ddmm(d.hasta)}`} />
                                <Tarjeta titulo="Reloj corrido" valor={fmtCorridos(d.corridosPromedio)} detalle={d.esperaClientePromedio > 0 ? `sin contar ${fmtDuracion(d.esperaClientePromedio)} de espera del cliente` : 'promedio, con noches y fines de semana'} />
                            </div>

                            {d.pasos?.length > 0 && <PorPaso d={d} jornada={jornada} />}

                            <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                                <div className="text-xs font-black uppercase tracking-wider text-zinc-500 mb-3">Por semana · últimas 8</div>
                                <div className="flex items-end gap-2 h-36">
                                    {d.semanas.map(s => (
                                        <div key={s.semana} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1"
                                            title={s.ordenes ? `Semana del ${ddmm(s.semana)}: ${num(s.ordenes)} órdenes · promedio ${fmtDuracion(s.promedio)} · mediana ${fmtDuracion(s.mediana)}` : `Semana del ${ddmm(s.semana)}: sin órdenes`}>
                                            <span className="text-[11px] font-bold text-zinc-600 tabular-nums">{!s.ordenes ? '—' : semanasEnDias ? fmtDiasHabiles(s.promedio, jornada, { corto: true }).replace(' d háb.', '') : fmtHorasCorto(s.promedio)}</span>
                                            <div className="w-full max-w-[44px] rounded-t-md bg-brand-cyan" style={{ height: `${s.ordenes ? Math.max(4, Math.round(100 * (s.promedio || 0) / maxSemana)) : 0}%` }} />
                                            <span className="text-[10px] text-zinc-400 tabular-nums">{ddmm(s.semana)}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="text-[11px] text-zinc-400 mt-2">{semanasEnDias ? 'Días hábiles' : 'Horas laborales'} promedio de las órdenes que quedaron prontas cada semana (de lunes a domingo).</div>
                            </div>

                            <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                                <div className="text-xs font-black uppercase tracking-wider text-zinc-500 px-4 pt-3 pb-2">Por prioridad</div>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100">
                                            <th className="text-left font-black px-4 py-1.5">Prioridad</th>
                                            <th className="text-right font-black px-2 py-1.5">Órdenes</th>
                                            <th className="text-right font-black px-2 py-1.5">Promedio</th>
                                            <th className="text-right font-black px-4 py-1.5 hidden sm:table-cell">Mediana</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {d.porPrioridad.map(p => (
                                            <tr key={p.prioridad} className="border-b border-zinc-50 last:border-0">
                                                <td className={`px-4 py-2 font-bold ${COLOR_PRIORIDAD[p.prioridad] || 'text-zinc-700'}`}>
                                                    {p.prioridad}
                                                    {(p.prioridad === 'Falla' || p.prioridad === 'Reposición') && <span className="ml-1.5 text-[10px] font-medium text-zinc-400">aparte</span>}
                                                </td>
                                                <td className="px-2 py-2 text-right tabular-nums text-zinc-600">{num(p.ordenes)}</td>
                                                <td className="px-2 py-2 text-right tabular-nums">
                                                    {p.ordenes ? <><span className="font-bold text-zinc-800">{fmtCiclo(p.promedio, jornada, { corto: true })}</span>{superaJornada(p.promedio, jornada) && <span className="text-zinc-400 text-xs"> {fmtDuracion(p.promedio)}</span>}</> : '—'}
                                                </td>
                                                <td className="px-4 py-2 text-right tabular-nums text-zinc-600 hidden sm:table-cell">{p.ordenes ? fmtDuracion(p.mediana) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {d.lentas.length > 0 && (
                                <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                                    <div className="text-xs font-black uppercase tracking-wider text-zinc-500 px-4 pt-3 pb-2">Las 10 más lentas del período</div>
                                    {d.lentas.map(o => (
                                        <button key={o.ordenId} type="button"
                                            onClick={() => onAbrirOrden?.({ id: o.ordenId, code: o.codigo, client: o.cliente, area })}
                                            className="w-full text-left px-4 py-2 border-t border-zinc-100 hover:bg-zinc-50 flex items-center gap-3"
                                            title={`De ${fechaHora(o.inicio)} (${ORIGEN_INICIO[o.origenInicio] || ''}) a ${fechaHora(o.fin)} · ${fmtCorridos(o.minutosCorridos)} corridos${o.pasos ? `\nPor paso: ${textoPasos(o.pasos)}` : ''}`}>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-bold text-zinc-800 truncate">{o.codigo}</div>
                                                <div className="text-xs text-zinc-500 truncate">{o.cliente} · <span className={COLOR_PRIORIDAD[o.prioridad] || ''}>{o.prioridad}</span></div>
                                                {o.pasos && listaPasos(o.pasos).length > 0 && (
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <BarraPasos pasos={o.pasos} className="h-1.5 max-w-[240px]" />
                                                        <span className="text-[10px] font-bold text-zinc-400 whitespace-nowrap">más en: {mayorPaso(o.pasos).label}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="text-sm font-black text-zinc-800 tabular-nums">{fmtCiclo(o.minutosCiclo, jornada, { corto: true })}</div>
                                                {superaJornada(o.minutosCiclo, jornada) && <div className="text-[11px] text-zinc-400 tabular-nums">{fmtDuracion(o.minutosCiclo)}</div>}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            <p className="text-xs text-zinc-500 leading-relaxed">
                                Ciclo de cada orden: las horas laborales del área desde que entra hasta que queda pronta (la última vez que pasó
                                a Pronto), sin feriados ni el tiempo que se esperó al cliente. El número principal es el promedio de las órdenes de
                                clientes (Normal y Urgente); Falla y Reposición van aparte. Jornada del área: {fmtDuracion(jornada)} (Configuración › Horario laboral).
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

export default function IndicadorCicloArea({ area, nombre, onAbrirOrden }) {
    const [abierto, setAbierto] = useState(false);
    const { data: d, isLoading } = useResumen(area, { dias: DIAS_POR_DEFECTO });

    // Sin tabla (base sin el script) o un área que no produce (PRO de venta directa): no se muestra.
    const sinDatos = !d || d.sinTabla || (!d.ordenes && !(d.semanas || []).some(s => s.ordenes));
    if (!isLoading && sinDatos) return null;

    return (
        <>
            <button type="button" onClick={() => setAbierto(true)}
                className="flex items-center gap-2.5 px-3 py-1.5 tablet:px-2 tablet:py-1 rounded-xl border border-zinc-200 bg-white hover:border-brand-cyan/50 hover:bg-zinc-50 transition-colors text-left min-w-0"
                title={`Promedio de horas laborales desde que la orden entra hasta que queda pronta (últimos ${DIAS_POR_DEFECTO} días). Tocá para ver el detalle.`}>
                <Timer size={22} className="text-brand-cyan shrink-0 tablet:hidden" />
                <span className="flex flex-col leading-tight min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 whitespace-nowrap">Tiempo de respuesta</span>
                    {isLoading ? (
                        <span className="text-sm font-black text-zinc-300">…</span>
                    ) : (
                        <>
                            <span className="text-sm tablet:text-xs font-black text-zinc-800 whitespace-nowrap">
                                {d.ordenes ? fmtCiclo(d.promedio, d.minutosJornada) : 'Sin órdenes'}
                                {d.ordenes > 0 && <span className="font-bold text-zinc-400 tablet:hidden">{superaJornada(d.promedio, d.minutosJornada) ? ` · ${fmtDuracion(d.promedio)}` : ' laborales'}</span>}
                            </span>
                            <span className="text-[10px] text-zinc-400 whitespace-nowrap tablet:hidden">
                                promedio de {DIAS_POR_DEFECTO} días · {num(d.ordenes)} órdenes{!d.tieneHorario ? ' · sin horario' : ''}
                            </span>
                        </>
                    )}
                </span>
            </button>
            {abierto && <DetalleCiclo area={area} nombre={nombre} onCerrar={() => setAbierto(false)} onAbrirOrden={onAbrirOrden} />}
        </>
    );
}

// Ciclo de UNA orden (cabecera del detalle de la orden). No muestra nada hasta que la orden queda pronta y el job
// la calcula.
export function CicloOrdenBadge({ ordenId }) {
    const { data: c } = useQuery({
        queryKey: ['ciclo-planta-orden', ordenId],
        queryFn: () => cicloPlantaService.getOrden(ordenId),
        enabled: !!ordenId,
        staleTime: 60 * 1000,
        retry: 0,
    });
    if (!c) return null;
    const v = { minutos: c.MinutosCiclo, corridos: c.MinutosCorridos, espera: c.MinutosEsperaCliente, origen: c.OrigenInicio, pasos: c.pasos };
    return (
        <span className="text-xs font-bold text-zinc-600 bg-white px-2 py-0.5 rounded border border-zinc-200 flex items-center gap-1 whitespace-nowrap" title={tituloCiclo(v)}>
            <Timer size={12} className="text-brand-cyan" /> Ciclo en planta: {fmtDuracion(c.MinutosCiclo)}{superaJornada(c.MinutosCiclo, c.minutosJornada) ? ` · ${fmtDiasHabiles(c.MinutosCiclo, c.minutosJornada, { corto: true })}` : ''}
        </span>
    );
}
