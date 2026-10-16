import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Check, Plus } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import { btnSec } from '../servicio-tecnico/ui';
import { fmtD, mensajeError } from './comun';
import { pendiente, hoy, dias, tandaActual, estadoTanda, nombreEtapaActual, esAbierto } from './reglas';

// Inicio (spec-C §3): la pantalla de entrada de cada persona del equipo. Lo suyo (tareas planificadas o con
// fecha, las atrasadas primero), sus proyectos, la tanda en curso y lo que espera en la Bandeja y en Muestras.

const TONO_MUESTRA = { azul: 'bg-brand-cyan', ambar: 'bg-amber-400', verde: 'bg-emerald-500', rojo: 'bg-brand-magenta', gris: 'bg-zinc-400' };
const Caja = ({ titulo, cuenta, link, onLink, children }) => (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-base font-black text-zinc-800">{titulo}</h3>
            {cuenta !== undefined && <span className="text-sm font-bold text-zinc-400">{cuenta}</span>}
            <div className="flex-1" />
            {link && <button type="button" onClick={onLink} className="text-xs font-bold text-brand-cyan hover:underline">{link}</button>}
        </div>
        {children}
    </section>
);

const InicioVista = ({ sesion, catalogos }) => {
    const navigate = useNavigate();
    const [proyectos, setProyectos] = useState(null);
    const [pedidos, setPedidos] = useState([]);
    const [tandas, setTandas] = useState([]);
    const [muestras, setMuestras] = useState(null);
    const yo = sesion?.usuario?.id;
    const edita = !!sesion?.esEditor;

    const cargar = useCallback(() => {
        desarrollosService.proyectos().then(setProyectos).catch(e => { setProyectos([]); toast.error(mensajeError(e, 'No se pudo cargar Inicio.')); });
        desarrollosService.bandeja().then(setPedidos).catch(() => {});
        desarrollosService.planificacion().then(d => setTandas(d.tandas)).catch(() => {});
        desarrollosService.resumenMuestras().then(setMuestras).catch(() => {});
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    // Tareas de quien entró: pendientes, en una tanda abierta o con fecha (el resto está dormido)
    const mias = useMemo(() => {
        const h = hoy();
        const out = [];
        for (const p of proyectos || []) {
            if (p.estado === 'CANCELADO') continue;
            for (const t of p.tareas || []) {
                if (!pendiente(t) || t.responsableId !== yo || !(t.tanda || t.fecha)) continue;
                out.push({ p, t, tarde: !!t.fecha && t.fecha < h });
            }
        }
        return out.sort((a, b) => (b.tarde - a.tarde) || (!!b.t.tanda - !!a.t.tanda) || (a.t.fecha || '9999').localeCompare(b.t.fecha || '9999'));
    }, [proyectos, yo]);
    const marcar = async ({ p, t }) => {
        const tipo = catalogos?.tipos?.find(x => x.id === p.tipoId);
        if (t.pideRef && tipo?.esProducto && !p.proIdProducto && !p.refErpTexto) {
            toast.warning('Para dar el alta falta el artículo del ERP: cargalo en la ficha.');
            navigate(`/desarrollos/proyectos?abrir=${p.id}`);
            return;
        }
        try {
            const r = await desarrollosService.tarea(t.id, { estado: 'HECHO' });
            if (r.aviso) toast.warning(r.aviso);
            toast.success(`Hecha: ${t.nombre}.`);
            setProyectos(l => l.map(x => (x.id === r.data.id ? { ...x, ...r.data } : x)));
        } catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); }
    };

    if (!proyectos) return <Loader2 size={20} className="animate-spin text-zinc-300" />;
    const hora = new Date().getHours();
    const saludo = hora < 12 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
    const nombre = String(sesion?.usuario?.nombre || '').split(' ')[0];
    const atrasadas = mias.filter(x => x.tarde);
    const paraHacer = mias.filter(x => !x.tarde);
    const misProyectos = proyectos.filter(p => p.liderId === yo && p.estado !== 'CANCELADO' && p.etapaActual !== 'TERMINADO');
    const tanda = tandaActual(tandas);
    const porResolver = pedidos.filter(esAbierto).sort((a, b) => new Date(b.creado) - new Date(a.creado));

    const filaMia = (x) => (
        <div key={x.t.id} className="flex items-center gap-2 py-1.5">
            <button type="button" disabled={!edita} onClick={() => marcar(x)} title="Marcar como hecha"
                className="w-6 h-6 shrink-0 rounded-full border-2 border-zinc-300 text-transparent flex items-center justify-center hover:border-brand-cyan hover:text-brand-cyan disabled:cursor-default"><Check size={13} strokeWidth={3} /></button>
            <span className="flex-1 min-w-0 text-sm text-zinc-800">{x.t.nombre}
                <button type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${x.p.id}`)} className="ml-1.5 text-xs font-bold text-brand-cyan hover:underline">{x.p.nombre}</button>
            </span>
            <span className={`text-xs ${x.tarde ? 'font-bold text-brand-magenta' : 'text-zinc-400'}`}>{x.t.fecha ? fmtD(x.t.fecha).slice(0, 5) : 'en tanda'}{x.t.estado === 'EN_ESPERA' ? ' · en espera' : ''}</span>
        </div>
    );

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 text-lg font-black text-zinc-800">{saludo}{nombre ? `, ${nombre}` : ''}</p>
                {sesion?.esEquipo && (<>
                    <button type="button" onClick={() => navigate('/desarrollos/bandeja?nueva=1')} className={btnSec}><Plus size={15} /> Cargar pedido</button>
                    <button type="button" onClick={() => navigate('/desarrollos/muestras?nueva=1')} className={btnSec}><Plus size={15} /> Nueva muestra</button>
                </>)}
            </div>
            {/* Dos zonas: a la izquierda lo de cada uno, a la derecha lo del equipo. Cada caja con su alto. */}
            <div className="grid gap-4 lg:grid-cols-[3fr_2fr] items-start">
                <div className="flex flex-col gap-4 min-w-0">
                <Caja titulo="Lo mío" cuenta={mias.length} link="ver todas mis tareas" onLink={() => navigate('/desarrollos/tareas?resp=__yo')}>
                    {!mias.length ? <p className="text-sm text-zinc-400" title="Acá aparece lo que entra en una tanda con tu nombre o tiene fecha; el resto está dormido hasta que se planifica.">No tenés tareas planificadas ni con fecha.</p> : (<>
                        {atrasadas.length > 0 && <><p className="text-xs font-black uppercase tracking-wide text-brand-magenta">Atrasadas · {atrasadas.length}</p>{atrasadas.slice(0, 10).map(filaMia)}</>}
                        {paraHacer.length > 0 && <><p className="text-xs font-black uppercase tracking-wide text-zinc-400">Para hacer · {paraHacer.length}</p>{paraHacer.slice(0, 15).map(filaMia)}</>}
                        {mias.length > 25 && <p className="text-xs text-zinc-400">Hay más: están en «ver todas mis tareas».</p>}
                    </>)}
                </Caja>
                <Caja titulo="Mis proyectos" cuenta={misProyectos.length} link="ver todos los proyectos" onLink={() => navigate('/desarrollos/proyectos')}>
                    {!misProyectos.length ? <p className="text-sm text-zinc-400">No sos responsable de ningún proyecto en curso.</p> : (<>
                        {misProyectos.slice(0, 8).map(p => (
                            <div key={p.id} className="py-1">
                                <button type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${p.id}`)} className="text-sm font-bold text-zinc-800 hover:text-brand-cyan text-left">{p.nombre}</button>
                                <p className="text-xs text-zinc-500">{nombreEtapaActual(p)} · {p.avance.h}/{p.avance.t}{p.tareaActual ? ` · sigue: ${p.tareaActual.nombre}` : ''}</p>
                            </div>
                        ))}
                        {misProyectos.length > 8 && <p className="text-xs text-zinc-400">y {misProyectos.length - 8} más.</p>}
                    </>)}
                </Caja>
                </div>
                <div className="flex flex-col gap-4 min-w-0">
                <Caja titulo="Tanda" link="abrir Planificación" onLink={() => navigate('/desarrollos/planificacion')}>
                    {!tanda ? <p className="text-sm text-zinc-400">No hay una tanda abierta.</p> : (() => {
                        const refs = tanda.tareas.map(id => { for (const p of proyectos) { const t = (p.tareas || []).find(x => x.id === id); if (t) return t; } return null; }).filter(Boolean);
                        const hechas = refs.filter(t => !pendiente(t)).length;
                        const sinResp = tandas.filter(x => x.estado !== 'CERRADA').flatMap(x => x.tareas).map(id => proyectos.flatMap(p => p.tareas || []).find(t => t.id === id)).filter(t => t && pendiente(t) && !t.responsable).length;
                        const est = estadoTanda(tanda);
                        const quedan = dias(hoy(), tanda.fin);
                        return (<>
                            <p className="text-sm text-zinc-700"><b>{tanda.nombre}</b> {fmtD(tanda.inicio)} – {fmtD(tanda.fin)} · {est === 'proxima' ? `empieza en ${dias(hoy(), tanda.inicio)} días` : quedan >= 0 ? `quedan ${quedan} ${quedan === 1 ? 'día' : 'días'}` : 'terminó: hay que cerrarla'}</p>
                            {tanda.objetivo && <p className="text-sm text-zinc-500">{tanda.objetivo}</p>}
                            <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-brand-cyan" style={{ width: `${refs.length ? Math.round(hechas * 100 / refs.length) : 0}%` }} /></div>
                            <p className="text-xs text-zinc-500">{hechas} de {refs.length} tareas hechas · {tanda.proyectos.length} proyectos{sinResp > 0 && <span className="font-bold text-brand-magenta"> · {sinResp} sin responsable</span>}</p>
                        </>);
                    })()}
                </Caja>
                <Caja titulo="Bandeja" cuenta={`${porResolver.length} por resolver`} link="abrir la Bandeja" onLink={() => navigate('/desarrollos/bandeja')}>
                    {!porResolver.length ? <p className="text-sm text-zinc-400">No queda nada por resolver.</p>
                        : porResolver.slice(0, 5).map(s => (
                            <div key={s.id} className="py-0.5">
                                <button type="button" onClick={() => navigate(`/desarrollos/bandeja?abrir=${s.id}`)} className="text-sm font-bold text-zinc-800 hover:text-brand-cyan text-left">{s.titulo || 'Sin título'}</button>
                                <span className="text-xs text-zinc-400"> · {fmtD(s.creado).slice(0, 5)}{s.pedidoPor ? ` · ${s.pedidoPor}` : ''}</span>
                            </div>
                        ))}
                </Caja>
                <Caja titulo="Muestras" cuenta={muestras?.total} link="abrir Muestras" onLink={() => navigate('/desarrollos/muestras')}>
                    {!muestras ? <Loader2 size={16} className="animate-spin text-zinc-300" /> : !muestras.total ? <p className="text-sm text-zinc-400">Sin muestras cargadas.</p> : (
                        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-600">
                            {muestras.porEstado.map(e => <span key={e.id ?? 'sin'} className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${TONO_MUESTRA[e.tono] || 'bg-zinc-400'}`} /><b>{e.n}</b> {e.nombre}</span>)}
                        </p>
                    )}
                </Caja>
                </div>
            </div>
        </div>
    );
};

export default InicioVista;
