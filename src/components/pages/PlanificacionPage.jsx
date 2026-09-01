import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { areasService, planificacionService } from '../../services/api';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Formatea 'YYYY-MM-DD' sin pasar por Date() — evita el corrimiento de huso horario que
// castiga a toLocaleDateString/new Date(str) en este proyecto (ver src/utils/fechas.js).
function fmtDia(fechaStr) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    return `${d} ${MESES[m - 1]}`;
}

// Horas de máquina estimadas (decimal, ver horasEstimadas del backend) a "Xh Ym" legible.
function fmtHoras(h) {
    if (h == null) return '';
    const horas = Math.floor(h);
    const minutos = Math.round((h - horas) * 60);
    if (horas === 0) return `${minutos} min`;
    if (minutos === 0) return `${horas} h`;
    return `${horas} h ${minutos} min`;
}

function addDiasStr(fechaStr, dias) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + dias);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}


const SEMAFORO_COLOR = {
    rojo: 'bg-red-500', amarillo: 'bg-amber-400', verde: 'bg-emerald-500'
};
const SEMAFORO_TEXTO = {
    rojo: 'text-red-600', amarillo: 'text-amber-600', verde: 'text-emerald-600'
};

// Un ícono por requisito, para la lista de "esperando requisitos" — así se ve de un vistazo
// QUÉ falta sin tener que leer texto. Fallback genérico si aparece un CodigoRequisito nuevo
// que todavía no tiene ícono asignado acá.
const REQUISITO_ICONO = {
    PRENDA: 'fa-shirt',
    MATRIZ: 'fa-table-cells',
    APROBACION: 'fa-stamp',
};

// La Agenda agrupa cada orden bajo su FechaCompromiso (la promesa fija al cliente) — pero una
// orden que ya cumplió sus requisitos puede quedar como la única (o la primera) compitiendo
// por capacidad y completarse ANTES de esa promesa vieja (calculada cuando todavía competía
// contra trabajo hoy bloqueado/excluido de la simulación). Se reubica bajo su día proyectado
// REAL (diaProyectadoPorOrden, ver getCapacidad) sin tocar la promesa en sí — solo cambia bajo
// qué día aparece en esta vista interna. Si el día proyectado cae fuera del rango visible (o no
// hay simulación para esa orden — sigue bloqueada, o el área no tiene capacidad cargada), se
// deja en su día original: no hay dónde reubicarla, o no hay nada más preciso que mostrar.
function reagruparPorDiaProyectado(diasAgenda, diaProyectadoPorOrden) {
    if (!diaProyectadoPorOrden || !diasAgenda) return diasAgenda;
    const fechasDisponibles = new Set(diasAgenda.map(d => d.fecha));
    const ordenesPorFecha = new Map(diasAgenda.map(d => [d.fecha, []]));
    for (const dia of diasAgenda) {
        for (const orden of dia.ordenes) {
            const diaProyectado = diaProyectadoPorOrden[orden.OrdenID];
            const fechaDestino = (diaProyectado && fechasDisponibles.has(diaProyectado)) ? diaProyectado : dia.fecha;
            ordenesPorFecha.get(fechaDestino).push(orden);
        }
    }
    return diasAgenda.map(d => {
        const ordenes = ordenesPorFecha.get(d.fecha);
        return { ...d, ordenes, totalOrdenes: ordenes.length };
    });
}

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

const redondear2 = (n) => Math.round(n * 100) / 100;

// Agrupa el avance diario (1 fila por orden) por (FechaIngreso, FechaPrometida) — pedido
// explícito del usuario 28-ago-2026, tras ver una card con más de mil órdenes individuales en un
// solo día en DTF: un resumen sumado por grupo, clic para ver el detalle real. Dentro de un mismo
// grupo, semaforo/UM son el mismo para todas las órdenes (comparten FechaPrometida y el día que
// se está proyectando) — se toman de la primera, no hace falta "peor semáforo" entre ellas.
function agruparAvance(avanceOrdenes) {
    const grupos = new Map();
    for (const a of avanceOrdenes) {
        const key = `${a.FechaIngreso}|${a.FechaPrometida}`;
        if (!grupos.has(key)) {
            grupos.set(key, {
                key, FechaIngreso: a.FechaIngreso, FechaPrometida: a.FechaPrometida,
                diasEnEspera: a.diasEnEspera, semaforo: a.semaforo, UM: a.UM,
                cantidad: 0, totalHoy: 0, totalCompleto: 0, ordenes: []
            });
        }
        const g = grupos.get(key);
        g.cantidad += 1;
        if (a.piezasHoy != null) g.totalHoy += a.piezasHoy;
        if (a.piezasTotal != null) g.totalCompleto += a.piezasTotal;
        g.ordenes.push(a);
    }
    return [...grupos.values()];
}

function hoyStr() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

const PlanificacionPage = () => {
    const [searchParams] = useSearchParams();
    const [areas, setAreas] = useState([]);
    // Preseleccionada por AreaView ("Agenda de Trabajo" del área en la que ya estaba el usuario,
    // ?area=EMB) — se valida contra la lista real de áreas al cargarla más abajo, no se confía
    // ciegamente en el parámetro de la URL.
    const [areaId, setAreaId] = useState(searchParams.get('area') || '');
    // Entrando con ?area= (desde el botón de un área puntual) el selector queda fijo en esa
    // área — pedido explícito del usuario 28-ago-2026: "que no me deje cambiar el combo... solo
    // si entro por la opción del menú puedo cambiar de área". Se decide UNA sola vez al montar
    // (no reactivo a `searchParams`) para que no se "desbloquee" solo si algo tocara la URL
    // después.
    const [areaFijada] = useState(() => !!searchParams.get('area'));
    const [desde, setDesde] = useState(hoyStr());
    const [agenda, setAgenda] = useState(null);
    const [capacidad, setCapacidad] = useState(null);
    const [loading, setLoading] = useState(false);
    // Qué grupo (de agruparAvance) está expandido mostrando el detalle — clave compuesta
    // "fecha-del-día-del-calendario|clave-del-grupo" para no mezclar la expansión entre días
    // distintos de la grilla. Solo uno abierto a la vez.
    const [grupoExpandido, setGrupoExpandido] = useState(null);

    const renderDiaCompleto = (dia) => {
        const esHoy = dia.fecha === hoyStr();
        const cap = capacidad?.tieneCapacidad ? capacidad.dias.find(d => d.fecha === dia.fecha) : null;
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

                    {/* Cuánto se prevé avanzar ESE día en cada orden en curso — sale de la
                        simulación real (no de la fecha PROMETIDA fija), y aparece también en los
                        días intermedios de una orden grande que no termina hoy (x/y = unidades
                        previstas hoy / total de la orden, "…" si sigue en curso). Agrupado por
                        (Fech.Ing, Fech.Prom) — un área con backlog grande (DTF real: 1200+
                        órdenes en un solo día) es inmanejable como card por orden; acá se ve el
                        resumen sumado del grupo, con clic para el detalle real. */}
                    {cap?.avanceOrdenes?.length > 0 ? (
                        <div className="space-y-2">
                            <div className="text-[10px] font-bold text-slate-400">
                                {cap.avanceOrdenes.length} orden{cap.avanceOrdenes.length === 1 ? '' : 'es'}
                            </div>
                            {agruparAvance(cap.avanceOrdenes).map(g => {
                                const claveExpand = `${dia.fecha}|${g.key}`;
                                const expandido = grupoExpandido === claveExpand;
                                return (
                                    <div key={g.key}>
                                        <button
                                            type="button"
                                            onClick={() => setGrupoExpandido(expandido ? null : claveExpand)}
                                            className="w-full text-left rounded-lg border border-teal-200 bg-teal-50/40 p-2.5 hover:bg-teal-50"
                                        >
                                            <div className="flex items-start justify-between gap-2 mb-1">
                                                <span className="text-[11px] font-bold text-slate-700">
                                                    {g.cantidad} orden{g.cantidad === 1 ? '' : 'es'}
                                                </span>
                                                {g.FechaIngreso && (
                                                    <span className="text-[9px] font-bold text-slate-900 shrink-0">
                                                        Fech.Ing {fmtDia(g.FechaIngreso)}
                                                        {g.diasEnEspera != null && ` (${g.diasEnEspera} día${g.diasEnEspera === 1 ? '' : 's'})`}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between gap-2 mt-1.5">
                                                <span
                                                    className="text-[10px] font-bold text-slate-600 font-mono"
                                                    title={`Previstos ${redondear2(g.totalHoy)} de ${redondear2(g.totalCompleto)} ${g.UM || ''} este día, sumando las ${g.cantidad} órdenes del grupo`}
                                                >
                                                    {redondear2(g.totalHoy)}/{redondear2(g.totalCompleto)} {g.UM || ''}
                                                </span>
                                                {g.semaforo && (
                                                    <span className="flex items-center gap-1 shrink-0" title={`Comprometido: ${fmtDia(g.FechaPrometida)}`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${SEMAFORO_COLOR[g.semaforo]}`} />
                                                        <span className="text-[9px] font-bold text-slate-500">Fech.Prom</span>
                                                        <span className={`text-[10px] font-bold ${SEMAFORO_TEXTO[g.semaforo]}`}>
                                                            {fmtDia(g.FechaPrometida)}
                                                        </span>
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[9px] text-slate-400 mt-1 flex items-center gap-1">
                                                <i className={`fa-solid fa-chevron-${expandido ? 'up' : 'down'}`}></i>
                                                {expandido ? 'Ocultar detalle' : 'Ver detalle'}
                                            </div>
                                        </button>
                                        {expandido && (
                                            <div className="ml-2 mt-1.5 space-y-1.5 border-l-2 border-teal-200 pl-2 max-h-64 overflow-y-auto">
                                                {g.ordenes.map(a => (
                                                    <div key={a.OrdenID} className="rounded-lg border border-slate-200 bg-white p-2">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="font-mono text-[10px] font-bold text-slate-700">{a.CodigoOrden || `#${a.OrdenID}`}</span>
                                                            {a.piezasHoy != null && (
                                                                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                                                                    {a.piezasHoy}/{a.piezasTotal} {a.UM || ''}
                                                                    {!a.completa && <span className="text-amber-500 ml-1">…</span>}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {a.Cliente && <div className="text-[10px] text-slate-600 truncate">{a.Cliente}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-[10px] font-bold uppercase text-slate-300">Sin trabajo previsto</div>
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
            // El área pedida por query param puede no existir (URL vieja, typo) — se cae al
            // comportamiento de siempre (primera de la lista) en vez de quedar en un área muerta.
            const valida = areaId && data.some(a => a.code === areaId);
            if (data.length > 0 && !valida) setAreaId(data[0].code);
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
        <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0">
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
                    <div className="relative">
                        <select
                            className={`bg-white border border-slate-200 text-sm font-bold text-slate-700 rounded-lg py-2 pl-3 pr-8 outline-none shadow-sm
                                ${areaFijada ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                            value={areaId}
                            disabled={areaFijada}
                            onChange={(e) => setAreaId(e.target.value)}
                            title={areaFijada ? 'Entraste desde un área puntual — para ver otras, abrí Planificación desde el menú' : undefined}
                        >
                            {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                        </select>
                        {areaFijada && (
                            <i
                                className="fa-solid fa-lock absolute -top-1.5 -right-1.5 text-[9px] bg-slate-400 text-white rounded-full w-4 h-4 flex items-center justify-center"
                                title="Área fija — entraste desde el botón de esta área"
                            ></i>
                        )}
                    </div>
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
                    {/* % DE PLANTA OPERATIVA — capacidad REAL disponible ahora (excluye máquinas
                        en mantenimiento) sobre la capacidad instalada TOTAL del parque. A pedido
                        del usuario, 25-ago-2026: "tengo 9000 instalada pero con máquinas fuera de
                        servicio tengo REALMENTE 5000 — a ese % está trabajando la planta". Esta
                        capacidad REDUCIDA es la que ya usa toda la simulación de abajo (fechas
                        proyectadas, semáforos, "se pone al día") — no es solo informativo. */}
                    <div className={`mb-5 flex items-center justify-between gap-4 px-4 py-3 rounded-lg border
                        ${capacidad.porcentajePlantaOperativa >= 100 ? 'bg-teal-50 border-teal-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div>
                            <div className={`text-[11px] font-bold uppercase ${capacidad.porcentajePlantaOperativa >= 100 ? 'text-teal-700' : 'text-amber-700'}`}>
                                Planta operativa al
                            </div>
                            <div className={`text-[11px] mt-0.5 ${capacidad.porcentajePlantaOperativa >= 100 ? 'text-teal-600' : 'text-amber-700'}`}>
                                {capacidad.capacidadOperativaAhora} <span className="opacity-60">de</span> {capacidad.capacidadTeorica} {u}/hora
                                {capacidad.maquinasEnMantenimiento.length > 0 && (
                                    <> <span className="opacity-60">— en mantenimiento:</span> {capacidad.maquinasEnMantenimiento.join(', ')}</>
                                )}
                                {capacidad.maquinas.filter(m => m.cabezalesReducidos).length > 0 && (
                                    <>
                                        {capacidad.maquinasEnMantenimiento.length > 0 ? ';' : <span className="opacity-60"> —</span>}
                                        <span className="opacity-60"> con menos cabezales:</span>{' '}
                                        {capacidad.maquinas.filter(m => m.cabezalesReducidos).map(m => `${m.nombre} (${m.capacidadEfectiva} ${u}/h)`).join(', ')}
                                    </>
                                )}
                            </div>
                        </div>
                        <div className={`text-3xl font-black ${capacidad.porcentajePlantaOperativa >= 100 ? 'text-teal-700' : 'text-amber-700'}`}>
                            {capacidad.porcentajePlantaOperativa != null ? `${capacidad.porcentajePlantaOperativa}%` : '—'}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
                        {/* CAPACIDAD INSTALADA — ficha técnica de TODO el parque, esté o no operativo */}
                        <div>
                            <div className="text-xs font-bold uppercase text-slate-400 mb-1">
                                Capacidad instalada
                                <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full uppercase bg-slate-100 text-slate-500">ficha técnica</span>
                            </div>
                            <div className="text-2xl font-black text-slate-800">
                                {capacidad.capacidadTeorica} <span className="text-sm font-bold text-slate-400">{u}/hora</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                                {capacidad.maquinas.length} máquina{capacidad.maquinas.length === 1 ? '' : 's'} activa{capacidad.maquinas.length === 1 ? '' : 's'} × sus cabezales de diseño a pleno
                            </div>
                        </div>

                        {/* CAPACIDAD DE PRODUCCIÓN — capacidad NOMINAL de hoy, ya calculada con la
                            capacidad REAL operativa (no la instalada total). No se anula en feriado:
                            eso es una decisión de agenda (se ve abajo, día por día), no un cambio en
                            la capacidad. */}
                        <div>
                            <div className="text-xs font-bold uppercase text-slate-400 mb-1">Capacidad de producción</div>
                            <div className="text-2xl font-black text-slate-800">
                                {capacidad.capacidadNominalHoy ?? '—'} <span className="text-sm font-bold text-slate-400">{u} hoy</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                                {capacidad.capacidadHoraria} {u}/hora <span className="text-slate-300">×</span> {capacidad.horasProduccionHoy} horas de trabajo hoy <span className="text-slate-300">=</span> {capacidad.capacidadNominalHoy}
                            </div>
                            {capacidad.esFeriadoHoy && (
                                <div className="text-[10px] text-rose-500 mt-1 flex items-center gap-1">
                                    <i className="fa-solid fa-triangle-exclamation"></i>
                                    Hoy es feriado — no se planifica producción (no afecta esta capacidad)
                                </div>
                            )}
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

                    {/* ÓRDENES QUE VAN A INCUMPLIR — con la capacidad REAL de ahora (reducida por
                        mantenimiento si corresponde), cuántas órdenes ya planificadas van a llegar
                        después de su fecha prometida (semáforo rojo en la simulación de abajo). */}
                    {capacidad.cantidadOrdenesIncumplen > 0 && (
                        <div className="mt-4 px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-between gap-4">
                            <div className="text-xs text-rose-700">
                                <span className="font-bold uppercase">Van a incumplir su fecha prometida: </span>
                                con la capacidad real de hoy ({capacidad.capacidadOperativaAhora} {u}/hora)
                            </div>
                            <div className="text-xl font-black text-rose-700 whitespace-nowrap">
                                {capacidad.cantidadOrdenesIncumplen} orden{capacidad.cantidadOrdenesIncumplen === 1 ? '' : 'es'}
                                <span className="text-xs font-bold text-rose-400 ml-2">({capacidad.magnitudOrdenesIncumplen} {u})</span>
                            </div>
                        </div>
                    )}

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
                    {agruparPorSemana(reagruparPorDiaProyectado(agenda.dias, capacidad?.diaProyectadoPorOrden)).map((semana, wi) => {
                        const porDia = Object.fromEntries(semana.map(d => [d.diaSemanaISO, d]));
                        // Un día no laborable (feriado o fin de semana) solo se muestra si tiene
                        // trabajo asignado — si no, es ruido visual (una card "No laborable" vacía
                        // no aporta nada). Un día laborable siempre se muestra, tenga o no órdenes
                        // (ahí sí importa ver "0 órdenes": es capacidad libre).
                        const seMuestra = (dia) => dia && (dia.laborable || dia.totalOrdenes > 0);
                        const sab = seMuestra(porDia[6]) ? porDia[6] : null;
                        const dom = seMuestra(porDia[7]) ? porDia[7] : null;
                        return (
                            <div key={wi} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                                {[1, 2, 3, 4, 5].map(iso => (
                                    seMuestra(porDia[iso]) ? renderDiaCompleto(porDia[iso]) : <div key={iso} />
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

        </div>

        {/* [REQUISITOS] Lo que existe pero no se sabe cuándo se desbloquea (matriz sin listar,
            prenda del cliente sin llegar, etc.) — no está en la simulación de la izquierda a
            propósito (no se inventa una fecha para algo sin fecha real), pero tiene que ser
            visible: si no, el trabajo real parece haber desaparecido. */}
        {capacidad?.tieneCapacidad && capacidad.ordenesBloqueadas?.length > 0 && (
            <aside className="w-80 shrink-0 sticky top-8">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <h2 className="text-xs font-bold uppercase text-slate-500 mb-1 flex items-center gap-1.5">
                        <i className="fa-solid fa-lock text-amber-500"></i>
                        Esperando requisitos ({capacidad.ordenesBloqueadas.length})
                    </h2>
                    <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
                        Existen, pero mientras les falte algo no se sabe cuándo van a poder producirse.
                    </p>
                    <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1">
                        {capacidad.ordenesBloqueadas.map(o => (
                            <div key={o.OrdenID} className="rounded-lg border border-amber-200 bg-amber-50/40 p-2.5">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                    <span className="font-mono text-[11px] font-bold text-slate-700">{o.CodigoOrden}</span>
                                    <span className="text-[9px] font-bold text-slate-900 shrink-0">
                                        Ingresó {fmtDia(o.FechaIngreso)}
                                        {o.diasEnEspera != null && ` (${o.diasEnEspera} día${o.diasEnEspera === 1 ? '' : 's'})`}
                                    </span>
                                </div>
                                <div className="text-xs font-bold text-slate-600 truncate">{o.Cliente}</div>
                                {o.Material && (
                                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{o.Material.trim()}</div>
                                )}
                                <div className="flex items-center justify-between gap-2 mt-1.5 mb-2">
                                    <span className="text-[10px] font-bold text-slate-600">
                                        {o.Cantidad > 0 ? `${o.Cantidad} u. a bordar` : ''}
                                    </span>
                                    {/* Semáforo: margen en días contra la fecha comprometida, ya
                                        descontado lo que va a tardar en producirse (ver
                                        horasEstimadas) — no si va a llegar a tiempo (no se sabe
                                        cuándo arranca, sigue bloqueada), sino si el reloj ya
                                        apremia considerando el trabajo de máquina que tiene por
                                        delante. amarillo = apenas alcanza; rojo = ya no alcanza. */}
                                    {o.semaforo && (
                                        <span
                                            className="flex items-center gap-1 shrink-0"
                                            title={`Comprometido: ${fmtDia(o.FechaPrometidaEfectiva)} (${o.margenDias <= 0 ? 'vencido' : `${o.margenDias} día${o.margenDias === 1 ? '' : 's'} de margen`}${o.horasEstimadas != null ? `, descontando ${fmtHoras(o.horasEstimadas)} de máquina` : ''})`}
                                        >
                                            <span className={`w-1.5 h-1.5 rounded-full ${SEMAFORO_COLOR[o.semaforo]}`} />
                                            <span className={`text-[10px] font-bold ${SEMAFORO_TEXTO[o.semaforo]}`}>
                                                {fmtDia(o.FechaPrometidaEfectiva)}
                                            </span>
                                        </span>
                                    )}
                                </div>
                                {o.horasEstimadas != null && (
                                    <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-2 -mt-1">
                                        <i className="fa-regular fa-clock"></i>
                                        <span>≈{fmtHoras(o.horasEstimadas)} de máquina</span>
                                    </div>
                                )}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {o.requisitosFaltantes.map(r => {
                                        // Un combo trae varias órdenes PRO para la MISMA prenda base
                                        // ("PRO-12298 (1/3)", "(2/3)", "(3/3)") — se muestra el código
                                        // base una sola vez, sin el sufijo de posición.
                                        const codigosBase = r.ordenesAsociadas?.length
                                            ? [...new Set(r.ordenesAsociadas.map(c => c.replace(/\s*\(\d+\/\d+\)\s*$/, '')))]
                                            : [];
                                        const tieneOrdenes = codigosBase.length > 0;
                                        const listaOrdenes = codigosBase.join(', ');
                                        return (
                                            <span
                                                key={r.codigo}
                                                title={`${r.cumplido ? 'Cumplido' : 'Falta'}: ${r.descripcion}${tieneOrdenes ? ` (${listaOrdenes})` : ''}`}
                                                className={`flex items-center gap-1 h-6 rounded-full border text-[11px]
                                                    ${r.cumplido ? 'bg-emerald-50 border-emerald-300 text-emerald-600' : 'bg-white border-amber-300 text-amber-600'}
                                                    ${tieneOrdenes ? 'pl-1.5 pr-2' : 'w-6 justify-center'}`}
                                            >
                                                <i className={`fa-solid ${REQUISITO_ICONO[r.codigo] || 'fa-circle-question'}`}></i>
                                                {/* Orden PRO hermana / recepción PRE- de mostrador
                                                    que traen la prenda física — solo para PRENDA,
                                                    cuando existen (un combo con varias prendas
                                                    puede traer más de una). Ver ordenesAsociadas
                                                    del backend. */}
                                                {tieneOrdenes && (
                                                    <span className={`text-[9px] font-mono font-bold ${r.cumplido ? 'text-emerald-500' : 'text-slate-500'}`}>
                                                        {listaOrdenes}
                                                    </span>
                                                )}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </aside>
        )}
        </div>

        </div>
    );
};

export default PlanificacionPage;
