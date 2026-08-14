import React, { useState, useEffect, useCallback } from 'react';
import { areasService, planificacionService } from '../../services/api';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Formatea 'YYYY-MM-DD' sin pasar por Date() — evita el corrimiento de huso horario que
// castiga a toLocaleDateString/new Date(str) en este proyecto (ver src/utils/fechas.js).
function fmtDia(fechaStr) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    return `${d} ${MESES[m - 1]}`;
}

function addDiasStr(fechaStr, dias) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + dias);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Diferencia en días entre dos 'YYYY-MM-DD' (a - b). Solo aritmética de calendario, sin
// Date() de por medio para lecturas de la base — acá los dos strings los generamos nosotros.
function diffDias(aStr, bStr) {
    const [ay, am, ad] = aStr.split('-').map(Number);
    const [by, bm, bd] = bStr.split('-').map(Number);
    return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

const MODO_LABEL = { urgente_atrasado: 'URGENTE', urgente_hoy: 'URGENTE', pendiente: 'NORMAL' };

const SEMAFORO_COLOR = {
    rojo: 'bg-red-500', amarillo: 'bg-amber-400', verde: 'bg-emerald-500'
};
const SEMAFORO_TEXTO = {
    rojo: 'text-red-600', amarillo: 'text-amber-600', verde: 'text-emerald-600'
};

// Agrupa la lista plana de días en semanas Lunes-Domingo (corta cada vez que aparece un
// Lunes, salvo al principio). La primera semana puede arrancar a mitad (ej. si "hoy" es
// jueves) y queda con huecos a la izquierda — se rellenan con celdas vacías al renderizar.
function agruparPorSemana(dias) {
    const semanas = [];
    let actual = [];
    for (const dia of dias) {
        if (dia.diaSemanaISO === 1 && actual.length > 0) {
            semanas.push(actual);
            actual = [];
        }
        actual.push(dia);
    }
    if (actual.length > 0) semanas.push(actual);
    return semanas;
}

function hoyStr() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

const PlanificacionPage = () => {
    const [areas, setAreas] = useState([]);
    const [areaId, setAreaId] = useState('');
    const [desde, setDesde] = useState(hoyStr());
    const [agenda, setAgenda] = useState(null);
    const [capacidad, setCapacidad] = useState(null);
    const [loading, setLoading] = useState(false);
    const [diaExpandido, setDiaExpandido] = useState(null);
    const [modalGrupo, setModalGrupo] = useState(null); // { fecha, grupo, label, unidad, loading, error, ordenes }

    const abrirModalGrupo = async (fecha, grupo, label, unidad) => {
        setModalGrupo({ fecha, grupo, label, unidad, loading: true, error: false, ordenes: [] });
        try {
            const data = await planificacionService.getDetalleGrupo(areaId, fecha, grupo);
            setModalGrupo(m => (m && m.fecha === fecha && m.grupo === grupo) ? { ...m, loading: false, ordenes: data.ordenes } : m);
        } catch (e) {
            setModalGrupo(m => (m && m.fecha === fecha && m.grupo === grupo) ? { ...m, loading: false, error: true } : m);
        }
    };

    const renderDiaCompleto = (dia) => {
        const expandido = diaExpandido === dia.fecha;
        const esHoy = dia.fecha === hoyStr();
        const cap = capacidad?.tieneCapacidad ? capacidad.dias.find(d => d.fecha === dia.fecha) : null;
        const u = capacidad?.tieneCapacidad ? capacidad.unidad.replace('/h', '') : '';
        return (
            <div
                key={dia.fecha}
                className={`rounded-xl border shadow-sm bg-white overflow-hidden flex flex-col
                    ${!dia.laborable ? 'opacity-60' : ''}
                    ${esHoy ? 'ring-2 ring-teal-400' : 'border-slate-200'}`}
            >
                <div className={`px-3 py-2 flex items-start justify-between gap-2
                    ${dia.esFeriado ? 'bg-rose-50' : dia.laborable ? 'bg-teal-50' : 'bg-slate-100'}`}>
                    <div>
                        <div className="text-xs font-bold uppercase text-slate-500">{dia.diaNombre}</div>
                        <div className="text-sm font-black text-slate-800">{fmtDia(dia.fecha)}</div>
                    </div>
                    <div className="text-right">
                        {dia.esFeriado ? (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 uppercase">Feriado</span>
                        ) : !dia.laborable ? (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 uppercase">No laborable</span>
                        ) : (
                            dia.horarios.map((h, i) => (
                                <div key={i} className="text-[11px] text-slate-500 font-mono">
                                    {h.turno ? `${h.turno}: ` : ''}{(h.horaInicio || '').slice(0, 5)}-{(h.horaFin || '').slice(0, 5)}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="px-3 py-2 flex-1">
                    {dia.esFeriado && dia.feriadoDescripcion && (
                        <div className="text-[11px] text-rose-500 italic mb-2">{dia.feriadoDescripcion}</div>
                    )}

                    {cap && (
                        <div className="mb-2 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
                            <div className="text-[9px] font-bold uppercase text-slate-400">Capacidad de producción</div>
                            <div className="text-xs font-black text-slate-700 mb-1">{cap.capacidadDia} {u}</div>

                            {capacidad.grupoLabels && Object.values(cap.grupos).some(g => g.cantidad > 0) && (
                                <table className="w-full text-[9px] border-collapse">
                                    <thead>
                                        <tr className="text-slate-400 uppercase">
                                            <th className="text-left font-bold pb-0.5">Día</th>
                                            <th className="text-left font-bold pb-0.5">Modo</th>
                                            <th className="text-right font-bold pb-0.5">Ord.</th>
                                            <th className="text-right font-bold pb-0.5">{u}</th>
                                            <th className="text-right font-bold pb-0.5">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(cap.grupos)
                                            .filter(([, g]) => g.cantidad > 0)
                                            .map(([key, g]) => {
                                                const diasAtraso = g.fechaPrometidaMin ? diffDias(hoyStr(), g.fechaPrometidaMin) : null;
                                                return (
                                                    <tr
                                                        key={key}
                                                        onClick={() => abrirModalGrupo(dia.fecha, key, capacidad.grupoLabels[key], u)}
                                                        className="cursor-pointer hover:bg-slate-100"
                                                    >
                                                        <td className="py-0.5 font-mono text-slate-600">{g.fechaIngresoMin ? fmtDia(g.fechaIngresoMin) : '—'}</td>
                                                        <td className="py-0.5 font-bold text-slate-500">{MODO_LABEL[key]}</td>
                                                        <td className="py-0.5 text-right font-bold text-slate-700">{g.cantidad}</td>
                                                        <td className="py-0.5 text-right font-mono text-slate-600">{g.metros}</td>
                                                        <td className="py-0.5 text-right">
                                                            {diasAtraso == null ? '—' : diasAtraso > 0 ? (
                                                                <span className="font-bold text-red-600">ATRASADA {diasAtraso}D</span>
                                                            ) : (
                                                                <span className="font-bold text-emerald-600">AL DÍA</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            )}

                            <div className="text-[10px] text-slate-400 mt-1 pt-1 border-t border-slate-200">
                                Pendiente restante: {cap.cargaAcumuladaRestante} {u}
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => setDiaExpandido(expandido ? null : dia.fecha)}
                        className={`w-full text-left rounded-lg px-2 py-1.5 text-xs font-bold flex items-center justify-between
                            ${dia.totalOrdenes > 0 ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'text-slate-300'}`}
                        disabled={dia.totalOrdenes === 0}
                    >
                        <span>{dia.totalOrdenes} orden{dia.totalOrdenes === 1 ? '' : 'es'}</span>
                        {dia.totalOrdenes > 0 && <i className={`fa-solid fa-chevron-${expandido ? 'up' : 'down'} text-[10px]`}></i>}
                    </button>

                    {expandido && (
                        <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                            {dia.ordenes.map(o => (
                                <div key={o.OrdenID} className="text-[11px] bg-slate-50 rounded px-2 py-1.5 border border-slate-100">
                                    <div className="font-bold text-slate-700">{o.CodigoOrden || `#${o.OrdenID}`}</div>
                                    <div className="text-slate-500 truncate">{o.Cliente}</div>
                                    <div className="flex items-center justify-between mt-0.5">
                                        <span className={`text-[9px] font-bold uppercase ${o.Prioridad === 'Urgente' ? 'text-red-500' : 'text-slate-400'}`}>{o.Prioridad}</span>
                                        <span className="text-slate-400">{o.Magnitud} {o.UM}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Versión chica para Sábado/Domingo — se apilan uno arriba del otro en una sola columna
    // para no gastar el mismo ancho que un día laborable normal.
    const renderDiaCompacto = (dia) => {
        const esHoy = dia.fecha === hoyStr();
        const cap = capacidad?.tieneCapacidad ? capacidad.dias.find(d => d.fecha === dia.fecha) : null;
        const u = capacidad?.tieneCapacidad ? capacidad.unidad.replace('/h', '') : '';
        return (
            <div
                key={dia.fecha}
                className={`rounded-lg border bg-white overflow-hidden flex-1
                    ${!dia.laborable ? 'opacity-60' : ''}
                    ${esHoy ? 'ring-2 ring-teal-400' : 'border-slate-200'}`}
            >
                <div className={`px-2 py-1 flex items-center justify-between gap-1
                    ${dia.esFeriado ? 'bg-rose-50' : dia.laborable ? 'bg-teal-50' : 'bg-slate-100'}`}>
                    <span className="text-[10px] font-bold text-slate-600">{dia.diaNombre.slice(0, 3)} {fmtDia(dia.fecha)}</span>
                    {dia.esFeriado ? (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 uppercase">Feriado</span>
                    ) : !dia.laborable ? (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500 uppercase">No laborable</span>
                    ) : null}
                </div>
                {(dia.laborable || dia.totalOrdenes > 0 || cap) && (
                    <div className="px-2 py-1 text-[10px] text-slate-500 space-y-0.5">
                        {dia.laborable && dia.horarios.map((h, i) => (
                            <div key={i} className="font-mono">
                                {h.turno ? `${h.turno}: ` : ''}{(h.horaInicio || '').slice(0, 5)}-{(h.horaFin || '').slice(0, 5)}
                            </div>
                        ))}
                        {cap && <div>Cap: <b className="text-slate-700">{cap.capacidadDia} {u}</b></div>}
                        {dia.totalOrdenes > 0 && <div>{dia.totalOrdenes} orden{dia.totalOrdenes === 1 ? '' : 'es'} prometida{dia.totalOrdenes === 1 ? '' : 's'}</div>}
                    </div>
                )}
            </div>
        );
    };

    useEffect(() => {
        areasService.getAll({ productive: true }).then(data => {
            setAreas(data);
            if (data.length > 0 && !areaId) setAreaId(data[0].code);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const cargarAgenda = useCallback(async () => {
        if (!areaId) return;
        setLoading(true);
        try {
            const hasta = addDiasStr(desde, 13);
            const [dataAgenda, dataCapacidad] = await Promise.all([
                planificacionService.getAgenda(areaId, desde, hasta),
                planificacionService.getCapacidad(areaId, hoyStr(), 90)
            ]);
            setAgenda(dataAgenda);
            setCapacidad(dataCapacidad);
        } catch (e) {
            console.error(e);
            setAgenda(null);
            setCapacidad(null);
        } finally {
            setLoading(false);
        }
    }, [areaId, desde]);

    useEffect(() => { cargarAgenda(); }, [cargarAgenda]);

    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-800">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-calendar-week text-teal-500"></i> Planificación
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Qué días trabaja cada área y qué órdenes tienen fecha de entrega estimada en cada uno.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        className="bg-white border border-slate-200 text-sm font-bold text-slate-700 rounded-lg py-2 pl-3 pr-8 outline-none cursor-pointer shadow-sm"
                        value={areaId}
                        onChange={(e) => setAreaId(e.target.value)}
                    >
                        {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                    </select>
                    <button
                        onClick={() => setDesde(addDiasStr(desde, -14))}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shadow-sm"
                        title="14 días antes"
                    >
                        <i className="fa-solid fa-chevron-left"></i>
                    </button>
                    <button
                        onClick={() => setDesde(hoyStr())}
                        className="px-3 h-9 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shadow-sm text-xs font-bold uppercase"
                    >
                        Hoy
                    </button>
                    <button
                        onClick={() => setDesde(addDiasStr(desde, 14))}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shadow-sm"
                        title="14 días después"
                    >
                        <i className="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
            </div>

            {!agenda?.tieneHorarioConfigurado && agenda && (
                <div className="mb-6 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm flex items-center gap-2">
                    <i className="fa-solid fa-triangle-exclamation"></i>
                    Esta área todavía no tiene Horario Laboral cargado (Configuración → Horario Laboral) — se está mostrando
                    el criterio genérico Lunes a Viernes.
                </div>
            )}

            {capacidad && !capacidad.tieneCapacidad && (
                <div className="mb-6 px-4 py-3 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 text-sm flex items-center gap-2">
                    <i className="fa-solid fa-circle-info"></i>
                    {capacidad.motivo}
                </div>
            )}

            {capacidad?.tieneCapacidad && (() => {
                const u = capacidad.unidad.replace('/h', '');
                return (
                <div className="mb-6 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
                        {/* CAPACIDAD INSTALADA — ficha técnica de las máquinas, u/hora */}
                        <div>
                            <div className="text-xs font-bold uppercase text-slate-400 mb-1">
                                Capacidad instalada
                                <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full uppercase bg-slate-100 text-slate-500">ficha técnica</span>
                            </div>
                            <div className="text-2xl font-black text-slate-800">
                                {capacidad.capacidadTeorica} <span className="text-sm font-bold text-slate-400">{u}/hora</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                                suma de la Velocidad Real de {capacidad.maquinas.length} máquina{capacidad.maquinas.length === 1 ? '' : 's'} activa{capacidad.maquinas.length === 1 ? '' : 's'}
                            </div>
                        </div>

                        {/* CAPACIDAD DE PRODUCCIÓN — Capacidad Instalada x horas de trabajo de hoy */}
                        <div>
                            <div className="text-xs font-bold uppercase text-slate-400 mb-1">Capacidad de producción</div>
                            <div className="text-2xl font-black text-slate-800">
                                {capacidad.capacidadDiaHoy ?? '—'} <span className="text-sm font-bold text-slate-400">{u} hoy</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                                {capacidad.capacidadHoraria} {u}/hora <span className="text-slate-300">×</span> {capacidad.horasProduccionHoy} horas de trabajo hoy <span className="text-slate-300">=</span> {capacidad.capacidadDiaHoy}
                            </div>
                        </div>

                        {/* PENDIENTE TOTAL */}
                        <div>
                            <div className="text-xs font-bold uppercase text-slate-400 mb-1">Pendiente total</div>
                            <div className="text-2xl font-black text-slate-800">
                                {capacidad.cargaPendienteTotal} <span className="text-sm font-bold text-slate-400">{u}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{capacidad.cantidadOrdenesPendientes} órdenes sin FechaPronto</div>
                        </div>

                        {/* PENDIENTE URGENTE */}
                        <div>
                            <div className="text-xs font-bold uppercase text-red-400 mb-1">Pendiente urgente</div>
                            <div className="text-2xl font-black text-red-600">
                                {capacidad.cargaPendienteUrgente} <span className="text-sm font-bold text-red-300">{u}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{capacidad.cantidadOrdenesPendientesUrgente} órdenes urgentes</div>
                        </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 text-xs">
                        <span className="font-bold uppercase text-slate-400">Al ritmo actual, se pone al día: </span>
                        <span className={`font-black ${capacidad.horizonteAgotado ? 'text-rose-600' : 'text-teal-600'}`}>
                            {capacidad.horizonteAgotado
                                ? 'no en los próximos 90 días'
                                : capacidad.fechaAgotamiento ? fmtDia(capacidad.fechaAgotamiento) : '—'}
                        </span>
                    </div>
                </div>
                );
            })()}

            {agenda && (
                <div className="text-xs font-bold uppercase text-slate-400 mb-3">
                    Agenda: fecha prometida (FechaEstimadaEntrega) y prorrateo de capacidad por día
                </div>
            )}

            {loading ? (
                <div className="text-center py-20 text-slate-400"><i className="fa-solid fa-spinner fa-spin text-2xl"></i></div>
            ) : !agenda ? (
                <div className="text-center py-20 text-slate-400">Elegí un área para ver la agenda.</div>
            ) : (
                <div className="space-y-4">
                    {agruparPorSemana(agenda.dias).map((semana, wi) => {
                        const porDia = Object.fromEntries(semana.map(d => [d.diaSemanaISO, d]));
                        const sab = porDia[6];
                        const dom = porDia[7];
                        return (
                            <div key={wi} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                                {[1, 2, 3, 4, 5].map(iso => (
                                    porDia[iso] ? renderDiaCompleto(porDia[iso]) : <div key={iso} />
                                ))}
                                {(sab || dom) && (
                                    <div className="flex flex-col gap-2">
                                        {sab && renderDiaCompacto(sab)}
                                        {dom && renderDiaCompacto(dom)}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {modalGrupo && (
                <div className="fixed inset-0 bg-slate-900/60 z-[1100] flex items-center justify-center p-4" onClick={() => setModalGrupo(null)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <h3 className="text-base font-black text-slate-800">
                                {modalGrupo.label} — {fmtDia(modalGrupo.fecha)}
                                <span className="ml-2 text-xs font-semibold text-slate-400">
                                    {!modalGrupo.loading && !modalGrupo.error && `${modalGrupo.ordenes.length} orden${modalGrupo.ordenes.length === 1 ? '' : 'es'}`}
                                </span>
                            </h3>
                            <button onClick={() => setModalGrupo(null)} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-red-500">
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>
                        <div className="overflow-y-auto flex-1 p-6">
                            {modalGrupo.loading ? (
                                <div className="text-center py-10 text-slate-400"><i className="fa-solid fa-spinner fa-spin text-xl"></i></div>
                            ) : modalGrupo.error ? (
                                <div className="text-center py-10 text-red-400 text-sm">Error al cargar el detalle.</div>
                            ) : modalGrupo.ordenes.length === 0 ? (
                                <div className="text-center py-10 text-slate-400 text-sm">No hay órdenes en este grupo.</div>
                            ) : (
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-slate-400 uppercase border-b border-slate-100">
                                        <tr>
                                            <th className="py-2 pr-3 font-bold">Orden</th>
                                            <th className="py-2 pr-3 font-bold">Fecha ingreso</th>
                                            <th className="py-2 pr-3 font-bold">Prioridad</th>
                                            <th className="py-2 pr-3 font-bold">Prometido</th>
                                            <th className="py-2 pr-3 font-bold text-right">{modalGrupo.unidad}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {modalGrupo.ordenes.map(o => (
                                            <tr key={o.OrdenID}>
                                                <td className="py-2 pr-3">
                                                    <div className="font-bold text-slate-700">{o.CodigoOrden || `#${o.OrdenID}`}</div>
                                                    <div className="text-xs text-slate-400 truncate max-w-[200px]">{o.Cliente}</div>
                                                </td>
                                                <td className="py-2 pr-3 font-mono text-slate-600">{o.FechaIngreso}</td>
                                                <td className="py-2 pr-3">
                                                    <span className={`text-[10px] font-bold uppercase ${o.Prioridad === 'Urgente' ? 'text-red-500' : 'text-slate-400'}`}>{o.Prioridad}</span>
                                                </td>
                                                <td className="py-2 pr-3">
                                                    <span className="flex items-center gap-1.5 font-mono text-slate-600">
                                                        {o.semaforo && <span className={`w-1.5 h-1.5 rounded-full ${SEMAFORO_COLOR[o.semaforo]}`}></span>}
                                                        {o.FechaPrometida || '—'}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-3 text-right font-mono text-slate-700">{o.Magnitud}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlanificacionPage;
