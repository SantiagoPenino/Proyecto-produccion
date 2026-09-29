import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Play, ChevronRight, Hand, CheckCircle2, AlertTriangle, CalendarDays, Wrench, Repeat } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import {
    estadoTrabajo, prioridad as prioridadInfo, estado as estadoInfo, DIAS_SEMANA, fmtDuracion, fmtDia, haceCuanto, mensajeError,
} from './constantes';
import { chip, btn, btnPri, ModalMotivo } from './ui';

// "Mi semana" (etapa 3): lo que tiene que hacer el técnico logueado, con botones grandes para tablet
// y celular — hoy, lo atrasado, el resto de la semana, sus solicitudes, sus seguimientos y lo que
// está sin asignar.

const diaDe = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return DIAS_SEMANA[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
};

const Seccion = ({ titulo, icono: Icono, cantidad, alerta = false, children }) => (
    <section className="mb-5">
        <h3 className={`mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide ${alerta ? 'text-red-600' : 'text-zinc-500'}`}>
            <Icono size={16} /> {titulo}{cantidad != null && <span className="text-zinc-400">({cantidad})</span>}
        </h3>
        {children}
    </section>
);

const MiSemanaVista = ({ meta, onAbrirTrabajo, onAbrirSolicitud, version = 0 }) => {
    const [d, setD] = useState(null);
    const [ocupado, setOcupado] = useState(null);
    const [seguimiento, setSeguimiento] = useState(null);

    const cargar = useCallback(async () => {
        try { setD(await servicioTecnicoService.miSemana()); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo cargar tu semana')); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    const cargarRef = useRef(cargar);
    cargarRef.current = cargar;
    useEffect(() => { if (version) cargarRef.current(); }, [version]);
    const avisar = useRecargaConFreno(() => cargar());
    useEffect(() => {
        socket.on('st:updated', avisar);
        return () => socket.off('st:updated', avisar);
    }, [avisar]);

    const hacer = async (id, fn, exito) => {
        setOcupado(id);
        try { await fn(); toast.success(exito); await cargar(); }
        catch (e) { toast.error(mensajeError(e)); }
        finally { setOcupado(null); }
    };

    if (!d) return <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div>;

    const abiertos = d.trabajos.filter(t => ['PENDIENTE', 'EN_CURSO'].includes(t.Estado));
    const deHoy = d.trabajos.filter(t => t.FechaProgramada === d.hoy || t.Estado === 'EN_CURSO');
    const atrasados = abiertos.filter(t => t.FechaProgramada < d.hoy && t.Estado !== 'EN_CURSO');
    const resto = abiertos.filter(t => t.FechaProgramada > d.hoy && t.Estado !== 'EN_CURSO');
    const minutosHoy = deHoy.filter(t => ['PENDIENTE', 'EN_CURSO'].includes(t.Estado)).reduce((s, t) => s + (t.MinutosEstimados || 0), 0);

    const Grande = ({ t }) => {
        const est = estadoTrabajo(t);
        const cerrado = !['PENDIENTE', 'EN_CURSO'].includes(t.Estado);
        const pct = t.TareasTotal ? Math.round((t.TareasHechas / t.TareasTotal) * 100) : null;
        return (
            <div className={`rounded-2xl border p-4 ${cerrado ? 'bg-zinc-50 border-zinc-200 opacity-70' : t.Estado === 'EN_CURSO' ? 'bg-brand-cyan/5 border-brand-cyan/40' : t.Vencido ? 'bg-red-50/60 border-red-200' : 'bg-white border-zinc-200'}`}>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`${chip} ${est.chip}`}>{est.label}</span>
                    {t.PlanId && <span className="inline-flex items-center gap-1 text-zinc-400"><Repeat size={11} />plan</span>}
                    <span className="ml-auto font-bold text-zinc-500">{fmtDuracion(t.MinutosEstimados)}</span>
                </div>
                <div className="mt-1.5 text-base font-black text-zinc-900 leading-snug">{t.Titulo}</div>
                {(t.EquipoNombre || t.EquipoTexto) && <div className="text-sm text-zinc-500">{t.EquipoNombre || t.EquipoTexto}{t.ParaMaquina && <span className="text-amber-700 font-bold"> · parar la máquina</span>}</div>}
                {pct != null && (
                    <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                        <span className="text-xs text-zinc-500 font-bold">{t.TareasHechas}/{t.TareasTotal}</span>
                    </div>
                )}
                <div className="mt-3 flex gap-2">
                    {t.Estado === 'PENDIENTE' && (
                        <button disabled={ocupado === t.TrabId} onClick={() => hacer(t.TrabId, () => servicioTecnicoService.empezarTrabajo(t.TrabId), 'Empezado')}
                            className={`${btnPri} flex-1 justify-center py-3 text-base`}>
                            {ocupado === t.TrabId ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />} Empezar
                        </button>
                    )}
                    <button onClick={() => onAbrirTrabajo(t.TrabId)} className={`${btn} flex-1 justify-center py-3 text-base bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100`}>
                        {t.Estado === 'EN_CURSO' ? 'Seguir' : 'Ver'} <ChevronRight size={18} />
                    </button>
                </div>
            </div>
        );
    };

    const Fila = ({ t, accion }) => {
        const est = estadoTrabajo(t);
        return (
            <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${t.Vencido ? 'bg-red-50/60 border-red-200' : 'bg-white border-zinc-200'}`}>
                <button onClick={() => onAbrirTrabajo(t.TrabId)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="font-black text-zinc-600">{diaDe(t.FechaProgramada)} {fmtDia(t.FechaProgramada).slice(0, 5)}</span>
                        <span className={`${chip} ${est.chip}`}>{est.label}</span>
                        <span className="text-zinc-400">{fmtDuracion(t.MinutosEstimados)}</span>
                    </div>
                    <div className="text-sm font-bold text-zinc-800 truncate">{t.Titulo}</div>
                    {(t.EquipoNombre || t.EquipoTexto) && <div className="text-xs text-zinc-500 truncate">{t.EquipoNombre || t.EquipoTexto}</div>}
                </button>
                {accion}
            </div>
        );
    };

    return (
        <div className="max-w-3xl">
            <div className="mb-4 rounded-2xl bg-zinc-900 text-white px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1">
                <div><div className="text-[11px] uppercase tracking-wide text-zinc-400 font-bold">Hoy</div><div className="text-lg font-black">{diaDe(d.hoy)} {fmtDia(d.hoy).slice(0, 5)}</div></div>
                <div><div className="text-[11px] uppercase tracking-wide text-zinc-400 font-bold">Trabajos</div><div className="text-lg font-black">{deHoy.filter(t => ['PENDIENTE', 'EN_CURSO'].includes(t.Estado)).length}</div></div>
                <div><div className="text-[11px] uppercase tracking-wide text-zinc-400 font-bold">Tiempo estimado</div><div className="text-lg font-black">{fmtDuracion(minutosHoy) || '0 min'}</div></div>
                <div><div className="text-[11px] uppercase tracking-wide text-zinc-400 font-bold">Solicitudes</div><div className="text-lg font-black">{d.solicitudes.length}</div></div>
            </div>

            <Seccion titulo="Hoy" icono={CalendarDays} cantidad={deHoy.length}>
                {deHoy.length === 0 ? <p className="text-sm text-zinc-400">Nada programado para hoy.</p>
                    : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{deHoy.map(t => <Grande key={t.TrabId} t={t} />)}</div>}
            </Seccion>

            {atrasados.length > 0 && (
                <Seccion titulo="Atrasado" icono={AlertTriangle} cantidad={atrasados.length} alerta>
                    <div className="flex flex-col gap-2">{atrasados.map(t => <Fila key={t.TrabId} t={t} />)}</div>
                </Seccion>
            )}

            {d.solicitudes.length > 0 && (
                <Seccion titulo="Mis solicitudes" icono={Wrench} cantidad={d.solicitudes.length}>
                    <div className="flex flex-col gap-2">
                        {d.solicitudes.map(s => (
                            <button key={s.SolId} onClick={() => onAbrirSolicitud(s.SolId)} className="w-full text-left rounded-xl border border-zinc-200 bg-white px-3 py-2.5 hover:border-brand-cyan/40">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="font-mono font-bold text-zinc-400">{s.Codigo}</span>
                                    <span className={`${chip} ${prioridadInfo(s.Prioridad).chip}`}>{prioridadInfo(s.Prioridad).label}</span>
                                    <span className={`${chip} ${estadoInfo(s.Estado).chip}`}>{estadoInfo(s.Estado).label}</span>
                                    {s.MaquinaNoTrabaja && <span className={`${chip} bg-amber-50 text-amber-700 border-amber-200`}>Máquina parada</span>}
                                    <span className="ml-auto text-zinc-400">{haceCuanto(s.FechaSolicitud)}</span>
                                </div>
                                <div className="mt-0.5 text-sm font-bold text-zinc-800">{s.Titulo}</div>
                                {(s.EquipoNombre || s.EquipoTexto) && <div className="text-xs text-zinc-500">{s.EquipoNombre || s.EquipoTexto}{s.EsperaMotivo ? ` · esperando: ${s.EsperaMotivo}` : ''}</div>}
                            </button>
                        ))}
                    </div>
                </Seccion>
            )}

            {d.seguimientos.length > 0 && (
                <Seccion titulo="Seguimientos" icono={CheckCircle2} cantidad={d.seguimientos.length}>
                    <div className="flex flex-col gap-2">
                        {d.seguimientos.map(s => (
                            <div key={s.SolId} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${s.FechaSeguimiento < d.hoy ? 'bg-red-50/60 border-red-200' : 'bg-violet-50/50 border-violet-200'}`}>
                                <button onClick={() => onAbrirSolicitud(s.SolId)} className="min-w-0 flex-1 text-left">
                                    <div className="text-[11px] font-bold text-zinc-500">{fmtDia(s.FechaSeguimiento)} · <span className="font-mono">{s.Codigo}</span></div>
                                    <div className="text-sm font-bold text-zinc-800 truncate">{s.Titulo}</div>
                                    {s.SeguimientoNota && <div className="text-xs text-zinc-500 truncate">{s.SeguimientoNota}</div>}
                                </button>
                                <button onClick={() => setSeguimiento(s)} className={`${btn} bg-violet-600 text-white hover:bg-violet-700 shrink-0`}><CheckCircle2 size={15} /> Hecho</button>
                            </div>
                        ))}
                    </div>
                </Seccion>
            )}

            {resto.length > 0 && (
                <Seccion titulo="Resto de la semana" icono={CalendarDays} cantidad={resto.length}>
                    <div className="flex flex-col gap-2">{resto.map(t => <Fila key={t.TrabId} t={t} />)}</div>
                </Seccion>
            )}

            {d.sinAsignar.length > 0 && (
                <Seccion titulo="Sin asignar" icono={Hand} cantidad={d.sinAsignar.length}>
                    <div className="flex flex-col gap-2">
                        {d.sinAsignar.map(t => (
                            <Fila key={t.TrabId} t={t} accion={
                                <button disabled={ocupado === t.TrabId} onClick={() => hacer(t.TrabId, () => servicioTecnicoService.editarTrabajo(t.TrabId, { tecnicoId: meta?.usuario?.id }), 'Es tuyo')}
                                    className={`${btn} bg-brand-cyan text-white hover:bg-brand-cyan/90 shrink-0`}>
                                    {ocupado === t.TrabId ? <Loader2 size={15} className="animate-spin" /> : <Hand size={15} />} Tomar
                                </button>
                            } />
                        ))}
                    </div>
                </Seccion>
            )}

            {seguimiento && (
                <ModalMotivo titulo={`Seguimiento de ${seguimiento.Codigo}`} textoLabel="¿Cómo quedó? (opcional)" confirmar="Marcar hecho" opcional
                    placeholder="Ej: la PC anda bien, se cierra" onCerrar={() => setSeguimiento(null)}
                    onConfirmar={async (nota) => { await hacer(`s${seguimiento.SolId}`, () => servicioTecnicoService.seguimientoHecho(seguimiento.SolId, nota), 'Seguimiento hecho'); setSeguimiento(null); }} />
            )}
        </div>
    );
};

export default MiSemanaVista;
