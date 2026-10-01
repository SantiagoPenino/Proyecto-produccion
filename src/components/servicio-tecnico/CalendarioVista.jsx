import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, Plus, CalendarCheck, Repeat, User, AlertTriangle } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import { estadoTrabajo, DIAS_SEMANA, fmtDuracion, sumarDias, lunesDe, diaCorto, hoyISO, mensajeError, franjaTexto } from './constantes';
import { chip, btnPri } from './ui';
import { ModalNuevoTrabajo } from './FormulariosMantenimiento';
import Selector from '../ui/Selector';

// Calendario semanal de Servicio Técnico (etapa 3): mantenimientos y tareas programados, lo vencido y
// los seguimientos de solicitudes. Cada día suma el tiempo estimado de lo que queda por hacer.

// Las tarjetas van dentro del día, que también es un botón (programar ahí): el toque no le llega.
const TarjetaTrabajo = ({ t, onAbrir }) => {
    const est = estadoTrabajo(t);
    const cerrado = !['PENDIENTE', 'EN_CURSO'].includes(t.Estado);
    return (
        <button onClick={(e) => { e.stopPropagation(); onAbrir(t.TrabId); }}
            className={`w-full text-left rounded-xl border px-2.5 py-2 transition-all hover:shadow-sm ${cerrado ? 'bg-zinc-50 border-zinc-200 opacity-70' : t.Vencido ? 'bg-red-50/60 border-red-200' : t.Estado === 'EN_CURSO' ? 'bg-brand-cyan/5 border-brand-cyan/30' : 'bg-white border-zinc-200 hover:border-brand-cyan/40'}`}>
            <div className="flex items-center gap-1 text-[10px]">
                <span className={`${chip} ${est.chip}`}>{est.label}</span>
                {t.PlanId && <Repeat size={11} className="text-zinc-400" title="De un plan" />}
                {franjaTexto(t) && <span className="ml-auto font-black text-zinc-600">{franjaTexto(t)}</span>}
                <span className={`${franjaTexto(t) ? '' : 'ml-auto '}text-zinc-400 font-bold`}>{fmtDuracion(t.MinutosEstimados)}</span>
            </div>
            <div className={`mt-1 text-[13px] font-bold leading-snug line-clamp-2 ${cerrado ? 'text-zinc-500 line-through decoration-zinc-300' : 'text-zinc-800'}`}>{t.Titulo}</div>
            {(t.EquipoNombre || t.EquipoTexto) && <div className="text-[11px] text-zinc-500 truncate">{t.EquipoNombre || t.EquipoTexto}</div>}
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400">
                <User size={10} /> <span className="truncate">{t.TecnicoNombre || 'sin asignar'}</span>
                {t.TareasTotal > 0 && <span className="ml-auto shrink-0">{t.TareasHechas}/{t.TareasTotal}</span>}
            </div>
        </button>
    );
};

const TarjetaSeguimiento = ({ s, hoy, onAbrir }) => (
    <button onClick={(e) => { e.stopPropagation(); onAbrir(s.SolId); }}
        className={`w-full text-left rounded-xl border px-2.5 py-2 transition-all hover:shadow-sm ${s.FechaSeguimiento < hoy ? 'bg-red-50/60 border-red-200' : 'bg-violet-50/60 border-violet-200 hover:border-violet-300'}`}>
        <div className="flex items-center gap-1 text-[10px]">
            <span className={`${chip} bg-violet-100 text-violet-700 border-violet-200`}>Seguimiento</span>
            <span className="font-mono font-bold text-zinc-400">{s.Codigo}</span>
        </div>
        <div className="mt-1 text-[13px] font-bold text-zinc-800 leading-snug line-clamp-2">{s.Titulo}</div>
        {s.SeguimientoNota && <div className="text-[11px] text-zinc-500 line-clamp-2">{s.SeguimientoNota}</div>}
        <div className="mt-0.5 text-[11px] text-zinc-400 truncate">{s.TecnicoNombre || 'sin técnico'}</div>
    </button>
);

const CalendarioVista = ({ meta, onAbrirTrabajo, onAbrirSolicitud, version = 0 }) => {
    const [lunes, setLunes] = useState(lunesDe(hoyISO()));
    const [tecnico, setTecnico] = useState('');
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [nuevoEn, setNuevoEn] = useState(null); // fecha para "Programar trabajo"
    const [procedimientos, setProcedimientos] = useState([]);
    const tec = !!meta?.esTecnico;

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            setDatos(await servicioTecnicoService.trabajos({ desde: lunes, hasta: sumarDias(lunes, 6), tecnico: tecnico || undefined, vencidos: 1 }));
        } catch (e) { toast.error(mensajeError(e, 'No se pudo cargar el calendario')); }
        finally { setCargando(false); }
    }, [lunes, tecnico]);
    useEffect(() => { cargar(); }, [cargar]);
    const cargarRef = useRef(cargar);
    cargarRef.current = cargar;
    useEffect(() => { if (version) cargarRef.current(); }, [version]);
    const avisar = useRecargaConFreno(() => cargar());
    useEffect(() => {
        socket.on('st:updated', avisar);
        return () => socket.off('st:updated', avisar);
    }, [avisar]);

    const abrirNuevo = (fecha) => {
        setNuevoEn(fecha);
        if (!procedimientos.length) servicioTecnicoService.procedimientos().then(setProcedimientos).catch(() => {});
    };

    const hoy = datos?.hoy || hoyISO();
    const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes]);
    const porDia = useMemo(() => {
        const m = {};
        dias.forEach(d => { m[d] = { trabajos: [], seguimientos: [], minutos: 0 }; });
        (datos?.trabajos || []).forEach(t => {
            if (!m[t.FechaProgramada]) return;
            m[t.FechaProgramada].trabajos.push(t);
            if (['PENDIENTE', 'EN_CURSO'].includes(t.Estado)) m[t.FechaProgramada].minutos += t.MinutosEstimados || 0;
        });
        (datos?.seguimientos || []).forEach(s => { if (m[s.FechaSeguimiento]) m[s.FechaSeguimiento].seguimientos.push(s); });
        // Dentro del día, los que tienen franja horaria primero y por hora (30/09); después los demás, como venían
        Object.values(m).forEach(dia => dia.trabajos.sort((a, b) => (a.HoraDesde || '99') < (b.HoraDesde || '99') ? -1 : (a.HoraDesde || '99') > (b.HoraDesde || '99') ? 1 : 0));
        return m;
    }, [datos, dias]);
    // Lo vencido: trabajos de semanas anteriores sin cerrar + seguimientos atrasados.
    const vencidos = datos?.vencidos || [];
    const segAtrasados = (datos?.seguimientos || []).filter(s => s.FechaSeguimiento < lunes && s.FechaSeguimiento < hoy);
    const minutosSemana = Object.values(porDia).reduce((s, d) => s + d.minutos, 0);

    // En celular los 7 días llenan lo que queda de pantalla: se mide desde el tope de la lista hasta el
    // borde de abajo (menos el padding de la página) y las filas se reparten ese alto (flex-1). Un día
    // con trabajos crece lo que necesite; si no entra todo, la página scrollea como siempre.
    const listaRef = useRef(null);
    const [altoLista, setAltoLista] = useState(null);
    useLayoutEffect(() => {
        const medir = () => {
            const el = listaRef.current;
            if (!el || window.innerWidth >= 768) { setAltoLista(null); return; }
            setAltoLista(Math.max(7 * 48 + 6 * 6, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 12)));
        };
        medir();
        window.addEventListener('resize', medir);
        return () => window.removeEventListener('resize', medir);
    }, [datos]);

    // "+": hoy, o el lunes si se mira una semana que viene. Nunca una fecha que ya pasó.
    const programarDia = lunes > hoy ? lunes : hoy;
    // Filtro de técnico: en celular con un texto corto.
    const tecnicoCorto = (o) => (!o ? '' : o.value === '' ? 'Todos' : o.value === 'yo' ? 'Lo mío' : o.value === 'sin' ? 'Sin asignar' : o.texto);

    return (
        <div>
            {/* Barra de la semana. Desde md, en un panel blanco. En celular, sin panel y en una fila:
                ‹ semana › (con el pendiente debajo), el filtro de técnico corto y "+" para programar. */}
            <div className="mb-3 md:mb-4 flex items-center gap-2 md:flex-wrap md:bg-white md:border md:border-zinc-200 md:rounded-2xl md:p-3">
                <div className="flex-1 md:flex-none min-w-0 flex items-center justify-between gap-1 rounded-xl border border-zinc-200 bg-white md:border-0 md:bg-transparent">
                    <button onClick={() => setLunes(sumarDias(lunes, -7))} title="Semana anterior" className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:bg-zinc-100 shrink-0"><ChevronLeft size={18} /></button>
                    <div className="px-1 md:px-2 leading-tight text-center md:text-left">
                        <div className="text-sm font-black text-zinc-700 whitespace-nowrap">{diaCorto(lunes)} – {diaCorto(sumarDias(lunes, 6))}</div>
                        <div className="md:hidden text-[11px] text-zinc-500 whitespace-nowrap">Pendiente: <b>{fmtDuracion(minutosSemana) || '0 min'}</b></div>
                    </div>
                    <button onClick={() => setLunes(sumarDias(lunes, 7))} title="Semana siguiente" className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:bg-zinc-100 shrink-0"><ChevronRight size={18} /></button>
                </div>
                {lunes !== lunesDe(hoy) && (
                    <button onClick={() => setLunes(lunesDe(hoy))} title="Ir a esta semana" aria-label="Ir a esta semana"
                        className="h-9 px-2.5 md:px-3 inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-100 shrink-0">
                        <CalendarCheck size={16} /><span className="hidden md:inline">Esta semana</span>
                    </button>
                )}
                <Selector filtro className="ml-auto md:ml-0" value={tecnico} onChange={(e) => setTecnico(e.target.value)}
                    renderValor={(o) => (<><span className="md:hidden inline-flex items-center gap-1.5"><User size={14} className="shrink-0" />{tecnicoCorto(o)}</span><span className="hidden md:inline">{o?.contenido}</span></>)}>
                    <option value="">Todos los técnicos</option>
                    {tec && <option value="yo">Solo lo mío</option>}
                    <option value="sin">Sin asignar</option>
                    {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </Selector>
                <span className="hidden md:inline text-xs text-zinc-500">Pendiente en la semana: <b>{fmtDuracion(minutosSemana) || '0 min'}</b></span>
                {cargando && <Loader2 size={16} className="hidden md:block animate-spin text-zinc-300" />}
                {tec && (<>
                    <button onClick={() => abrirNuevo(programarDia)} className={`hidden md:inline-flex ${btnPri} ml-auto`}><Plus size={16} /> Programar trabajo</button>
                    <button onClick={() => abrirNuevo(programarDia)} title="Programar trabajo" aria-label="Programar trabajo"
                        className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center bg-brand-cyan text-white hover:bg-brand-cyan/90 shrink-0"><Plus size={18} /></button>
                </>)}
            </div>

            {(vencidos.length > 0 || segAtrasados.length > 0) && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50/50 p-3">
                    <div className="text-xs font-black text-red-700 uppercase tracking-wide mb-2 inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Atrasado ({vencidos.length + segAtrasados.length})</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        {vencidos.map(t => <TarjetaTrabajo key={t.TrabId} t={t} onAbrir={onAbrirTrabajo} />)}
                        {segAtrasados.map(s => <TarjetaSeguimiento key={`s${s.SolId}`} s={s} hoy={hoy} onAbrir={onAbrirSolicitud} />)}
                    </div>
                </div>
            )}

            {/* Días. Desde md, 7 columnas. En celular, una fila por día (el día a la izquierda y lo programado
                a la derecha) que se estiran hasta el final de la pantalla (altoLista). */}
            {!datos ? <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div> : (
                <div ref={listaRef} style={{ minHeight: altoLista || undefined }} className="flex flex-col md:grid md:grid-cols-7 gap-1.5 md:gap-2">
                    {dias.map((d, i) => {
                        const dia = porDia[d];
                        const esHoy = d === hoy;
                        // Para los técnicos el día entero es el botón de programar un trabajo ahí (desde hoy en adelante).
                        const puedeProgramar = tec && d >= hoy;
                        const programar = puedeProgramar ? {
                            role: 'button', tabIndex: 0, title: `Programar un trabajo el ${DIAS_SEMANA[i].toLowerCase()} ${diaCorto(d)}`,
                            onClick: () => abrirNuevo(d),
                            onKeyDown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirNuevo(d); } },
                        } : {};
                        return (
                            <div key={d} {...programar}
                                className={`flex-1 rounded-xl md:rounded-2xl border p-2 min-h-[48px] md:min-h-[120px] flex flex-row md:flex-col gap-2 md:gap-1.5 ${esHoy ? 'border-brand-cyan/50 bg-brand-cyan/5' : 'border-zinc-200 bg-zinc-50/50'} ${puedeProgramar ? 'cursor-pointer outline-none transition-colors hover:border-brand-cyan/40 hover:bg-white active:bg-white focus-visible:ring-2 focus-visible:ring-brand-cyan/20' : ''}`}>
                                <div className="w-12 md:w-auto shrink-0 flex flex-col md:flex-row md:items-baseline md:justify-between px-0.5 leading-tight">
                                    <span className={`text-xs font-black uppercase tracking-wide ${esHoy ? 'text-brand-cyan' : 'text-zinc-500'}`}>
                                        <span className="md:hidden">{DIAS_SEMANA[i].slice(0, 3)}</span><span className="hidden md:inline">{DIAS_SEMANA[i]}</span>
                                        <span className="hidden md:inline font-bold normal-case"> {diaCorto(d)}</span>
                                    </span>
                                    <span className={`md:hidden text-[11px] font-bold ${esHoy ? 'text-brand-cyan' : 'text-zinc-400'}`}>{diaCorto(d)}</span>
                                    {dia.minutos > 0 && <span className="text-[10px] font-bold text-zinc-400">{fmtDuracion(dia.minutos)}</span>}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col gap-1.5 md:contents">
                                    {dia.trabajos.map(t => <TarjetaTrabajo key={t.TrabId} t={t} onAbrir={onAbrirTrabajo} />)}
                                    {dia.seguimientos.map(s => <TarjetaSeguimiento key={`s${s.SolId}`} s={s} hoy={hoy} onAbrir={onAbrirSolicitud} />)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {nuevoEn && (
                <ModalNuevoTrabajo meta={meta} procedimientos={procedimientos} fechaInicial={nuevoEn}
                    onCerrar={() => setNuevoEn(null)}
                    onGuardado={(t) => { setNuevoEn(null); cargar(); if (t?.TrabId) onAbrirTrabajo(t.TrabId); }} />
            )}
        </div>
    );
};

export default CalendarioVista;
