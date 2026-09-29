import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, Plus, CalendarCheck, Repeat, User, AlertTriangle } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import { estadoTrabajo, DIAS_SEMANA, fmtDuracion, sumarDias, lunesDe, diaCorto, hoyISO, mensajeError } from './constantes';
import { chip, btnPri, btnSec } from './ui';
import { ModalNuevoTrabajo } from './FormulariosMantenimiento';

// Calendario semanal de Servicio Técnico (etapa 3): mantenimientos y tareas programados, lo vencido y
// los seguimientos de solicitudes. Cada día suma el tiempo estimado de lo que queda por hacer.

const TarjetaTrabajo = ({ t, onAbrir }) => {
    const est = estadoTrabajo(t);
    const cerrado = !['PENDIENTE', 'EN_CURSO'].includes(t.Estado);
    return (
        <button onClick={() => onAbrir(t.TrabId)}
            className={`w-full text-left rounded-xl border px-2.5 py-2 transition-all hover:shadow-sm ${cerrado ? 'bg-zinc-50 border-zinc-200 opacity-70' : t.Vencido ? 'bg-red-50/60 border-red-200' : t.Estado === 'EN_CURSO' ? 'bg-brand-cyan/5 border-brand-cyan/30' : 'bg-white border-zinc-200 hover:border-brand-cyan/40'}`}>
            <div className="flex items-center gap-1 text-[10px]">
                <span className={`${chip} ${est.chip}`}>{est.label}</span>
                {t.PlanId && <Repeat size={11} className="text-zinc-400" title="De un plan" />}
                <span className="ml-auto text-zinc-400 font-bold">{fmtDuracion(t.MinutosEstimados)}</span>
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
    <button onClick={() => onAbrir(s.SolId)}
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
        return m;
    }, [datos, dias]);
    // Lo vencido: trabajos de semanas anteriores sin cerrar + seguimientos atrasados.
    const vencidos = datos?.vencidos || [];
    const segAtrasados = (datos?.seguimientos || []).filter(s => s.FechaSeguimiento < lunes && s.FechaSeguimiento < hoy);
    const minutosSemana = Object.values(porDia).reduce((s, d) => s + d.minutos, 0);

    return (
        <div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap gap-2 items-center">
                <div className="flex items-center gap-1">
                    <button onClick={() => setLunes(sumarDias(lunes, -7))} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:bg-zinc-100"><ChevronLeft size={18} /></button>
                    <span className="px-2 text-sm font-black text-zinc-700 whitespace-nowrap">{diaCorto(lunes)} – {diaCorto(sumarDias(lunes, 6))}</span>
                    <button onClick={() => setLunes(sumarDias(lunes, 7))} className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:bg-zinc-100"><ChevronRight size={18} /></button>
                </div>
                {lunes !== lunesDe(hoy) && <button onClick={() => setLunes(lunesDe(hoy))} className={`${btnSec} py-1.5`}><CalendarCheck size={15} /> Esta semana</button>}
                <select className="px-3 py-2 border border-zinc-200 rounded-xl text-sm text-zinc-700 bg-white outline-none focus:border-brand-cyan" value={tecnico} onChange={(e) => setTecnico(e.target.value)}>
                    <option value="">Todos los técnicos</option>
                    {tec && <option value="yo">Solo lo mío</option>}
                    <option value="sin">Sin asignar</option>
                    {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
                <span className="text-xs text-zinc-500">Pendiente en la semana: <b>{fmtDuracion(minutosSemana) || '0 min'}</b></span>
                {cargando && <Loader2 size={16} className="animate-spin text-zinc-300" />}
                {tec && <button onClick={() => abrirNuevo(hoy >= lunes && hoy <= sumarDias(lunes, 6) ? hoy : lunes)} className={`${btnPri} ml-auto`}><Plus size={16} /> Programar trabajo</button>}
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

            {!datos ? <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div> : (
                <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                    {dias.map((d, i) => {
                        const dia = porDia[d];
                        const esHoy = d === hoy;
                        return (
                            <div key={d} className={`rounded-2xl border p-2 min-h-[120px] flex flex-col gap-1.5 ${esHoy ? 'border-brand-cyan/50 bg-brand-cyan/5' : 'border-zinc-200 bg-zinc-50/50'}`}>
                                <div className="flex items-baseline justify-between px-0.5">
                                    <span className={`text-xs font-black uppercase tracking-wide ${esHoy ? 'text-brand-cyan' : 'text-zinc-500'}`}>{DIAS_SEMANA[i]} <span className="font-bold normal-case">{diaCorto(d)}</span></span>
                                    {dia.minutos > 0 && <span className="text-[10px] font-bold text-zinc-400">{fmtDuracion(dia.minutos)}</span>}
                                </div>
                                {dia.trabajos.map(t => <TarjetaTrabajo key={t.TrabId} t={t} onAbrir={onAbrirTrabajo} />)}
                                {dia.seguimientos.map(s => <TarjetaSeguimiento key={`s${s.SolId}`} s={s} hoy={hoy} onAbrir={onAbrirSolicitud} />)}
                                {tec && (
                                    <button onClick={() => abrirNuevo(d)} className="mt-auto w-full py-1 rounded-lg text-zinc-300 hover:text-brand-cyan hover:bg-white text-xs font-bold inline-flex items-center justify-center gap-1">
                                        <Plus size={13} /> Agregar
                                    </button>
                                )}
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
