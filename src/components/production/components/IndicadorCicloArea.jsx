import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Timer, X, Loader2, TriangleAlert } from 'lucide-react';
import { cicloPlantaService } from '../../../services/api';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';
import { fmtDuracion, fmtDiasHabiles, fmtCorridos, ORIGEN_INICIO, tituloCiclo } from '../../../utils/cicloPlanta';

// Tiempo de respuesta del área (plan INF-SIS-2026-04): promedio del ciclo en planta de las órdenes de clientes
// (Normal y Urgente) que quedaron prontas en los últimos 30 días. El ciclo de cada orden son las horas laborales
// del área desde que entró hasta que quedó pronta, sin feriados ni espera del cliente (lo calcula el job «Ciclo en
// planta» cada 10 minutos). Va en la cabecera del área; al tocarlo se abre el detalle.

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
const fechaHora = (f) => (f ? new Date(f).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const useResumen = (area, params) => useQuery({
    queryKey: ['ciclo-planta', area, params],
    queryFn: () => cicloPlantaService.getResumen(area, params),
    enabled: !!area,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
});

const Tarjeta = ({ titulo, valor, detalle }) => (
    <div className="bg-white rounded-2xl border border-zinc-200 px-4 py-3 min-w-0">
        <div className="text-[10px] font-black uppercase tracking-wider text-zinc-400">{titulo}</div>
        <div className="text-xl font-black text-zinc-800 leading-tight mt-0.5">{valor}</div>
        {detalle && <div className="text-xs text-zinc-500 mt-0.5">{detalle}</div>}
    </div>
);

function DetalleCiclo({ area, nombre, onCerrar, onAbrirOrden }) {
    const [periodo, setPeriodo] = useState('30');
    const [desde, setDesde] = useState('');
    const [hasta, setHasta] = useState('');
    const conFechas = periodo === 'fechas';
    const fechasOk = conFechas && desde && hasta && desde <= hasta;
    const params = conFechas ? (fechasOk ? { desde, hasta } : null) : { dias: Number(periodo) };
    const { data: d, isLoading, isError } = useQuery({
        queryKey: ['ciclo-planta', area, params],
        queryFn: () => cicloPlantaService.getResumen(area, params),
        enabled: !!area && !!params,
        staleTime: 5 * 60 * 1000,
    });
    const jornada = d?.minutosJornada;
    const maxSemana = Math.max(1, ...(d?.semanas || []).map(s => s.promedio || 0));

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
                    </div>

                    {conFechas && !fechasOk ? (
                        <p className="text-sm text-zinc-500 py-8 text-center">Elegí desde y hasta.</p>
                    ) : isLoading ? (
                        <div className="py-16 flex justify-center"><Loader2 size={24} className="animate-spin text-brand-cyan" /></div>
                    ) : isError || !d ? (
                        <p className="text-sm text-brand-magenta py-8 text-center">No se pudo cargar el tiempo de respuesta.</p>
                    ) : d.sinTabla ? (
                        <p className="text-sm text-zinc-500 py-8 text-center">Todavía no se calcula el ciclo de las órdenes: falta crear la tabla en la base.</p>
                    ) : (
                        <>
                            {!d.tieneHorario && (
                                <div className="flex gap-2 items-start rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    <TriangleAlert size={18} className="shrink-0 mt-0.5" />
                                    <span>Esta área no tiene horario laboral cargado: se cuenta de lunes a viernes de 9 a 17. Cargalo en Configuración › Horario laboral.</span>
                                </div>
                            )}

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <Tarjeta titulo="Promedio" valor={fmtDiasHabiles(d.promedio, jornada)} detalle={`${fmtDuracion(d.promedio)} laborales`} />
                                <Tarjeta titulo="Mediana" valor={fmtDiasHabiles(d.mediana, jornada)} detalle={`${fmtDuracion(d.mediana)} · la mitad tardó menos`} />
                                <Tarjeta titulo="Órdenes" valor={num(d.ordenes)} detalle={`prontas del ${ddmm(d.desde)} al ${ddmm(d.hasta)}`} />
                                <Tarjeta titulo="Reloj corrido" valor={fmtCorridos(d.corridosPromedio)} detalle={d.esperaClientePromedio > 0 ? `sin contar ${fmtDuracion(d.esperaClientePromedio)} de espera del cliente` : 'promedio, con noches y fines de semana'} />
                            </div>

                            <div className="bg-white rounded-2xl border border-zinc-200 p-4">
                                <div className="text-xs font-black uppercase tracking-wider text-zinc-500 mb-3">Por semana · últimas 8</div>
                                <div className="flex items-end gap-2 h-36">
                                    {d.semanas.map(s => (
                                        <div key={s.semana} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1"
                                            title={s.ordenes ? `Semana del ${ddmm(s.semana)}: ${num(s.ordenes)} órdenes · promedio ${fmtDuracion(s.promedio)} · mediana ${fmtDuracion(s.mediana)}` : `Semana del ${ddmm(s.semana)}: sin órdenes`}>
                                            <span className="text-[11px] font-bold text-zinc-600 tabular-nums">{s.ordenes ? fmtDiasHabiles(s.promedio, jornada, { corto: true }).replace(' d háb.', '') : '—'}</span>
                                            <div className="w-full max-w-[44px] rounded-t-md bg-brand-cyan" style={{ height: `${s.ordenes ? Math.max(4, Math.round(100 * (s.promedio || 0) / maxSemana)) : 0}%` }} />
                                            <span className="text-[10px] text-zinc-400 tabular-nums">{ddmm(s.semana)}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="text-[11px] text-zinc-400 mt-2">Días hábiles promedio de las órdenes que quedaron prontas cada semana (de lunes a domingo).</div>
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
                                                    {p.ordenes ? <><span className="font-bold text-zinc-800">{fmtDiasHabiles(p.promedio, jornada, { corto: true })}</span> <span className="text-zinc-400 text-xs">{fmtDuracion(p.promedio)}</span></> : '—'}
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
                                            title={`De ${fechaHora(o.inicio)} (${ORIGEN_INICIO[o.origenInicio] || ''}) a ${fechaHora(o.fin)} · ${fmtCorridos(o.minutosCorridos)} corridos`}>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-bold text-zinc-800 truncate">{o.codigo}</div>
                                                <div className="text-xs text-zinc-500 truncate">{o.cliente} · <span className={COLOR_PRIORIDAD[o.prioridad] || ''}>{o.prioridad}</span></div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="text-sm font-black text-zinc-800 tabular-nums">{fmtDiasHabiles(o.minutosCiclo, jornada, { corto: true })}</div>
                                                <div className="text-[11px] text-zinc-400 tabular-nums">{fmtDuracion(o.minutosCiclo)}</div>
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
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

export default function IndicadorCicloArea({ area, nombre, onAbrirOrden }) {
    const [abierto, setAbierto] = useState(false);
    const { data: d, isLoading } = useResumen(area, { dias: 30 });

    // Sin tabla (base sin el script) o un área que no produce (PRO de venta directa): no se muestra.
    const sinDatos = !d || d.sinTabla || (!d.ordenes && !(d.semanas || []).some(s => s.ordenes));
    if (!isLoading && sinDatos) return null;

    return (
        <>
            <button type="button" onClick={() => setAbierto(true)}
                className="flex items-center gap-2.5 px-3 py-1.5 tablet:px-2 tablet:py-1 rounded-xl border border-zinc-200 bg-white hover:border-brand-cyan/50 hover:bg-zinc-50 transition-colors text-left min-w-0"
                title="Promedio de horas laborales desde que la orden entra hasta que queda pronta (últimos 30 días). Tocá para ver el detalle.">
                <Timer size={22} className="text-brand-cyan shrink-0 tablet:hidden" />
                <span className="flex flex-col leading-tight min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 whitespace-nowrap">Tiempo de respuesta</span>
                    {isLoading ? (
                        <span className="text-sm font-black text-zinc-300">…</span>
                    ) : (
                        <>
                            <span className="text-sm tablet:text-xs font-black text-zinc-800 whitespace-nowrap">
                                {d.ordenes ? fmtDiasHabiles(d.promedio, d.minutosJornada) : 'Sin órdenes'}
                                {d.ordenes > 0 && <span className="font-bold text-zinc-400 tablet:hidden"> · {fmtDuracion(d.promedio)}</span>}
                            </span>
                            <span className="text-[10px] text-zinc-400 whitespace-nowrap tablet:hidden">
                                promedio de 30 días · {num(d.ordenes)} órdenes{!d.tieneHorario ? ' · sin horario' : ''}
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
    const v = { minutos: c.MinutosCiclo, corridos: c.MinutosCorridos, espera: c.MinutosEsperaCliente, origen: c.OrigenInicio };
    return (
        <span className="text-xs font-bold text-zinc-600 bg-white px-2 py-0.5 rounded border border-zinc-200 flex items-center gap-1 whitespace-nowrap" title={tituloCiclo(v)}>
            <Timer size={12} className="text-brand-cyan" /> Ciclo en planta: {fmtDuracion(c.MinutosCiclo)} · {fmtDiasHabiles(c.MinutosCiclo, c.minutosJornada, { corto: true })}
        </span>
    );
}
