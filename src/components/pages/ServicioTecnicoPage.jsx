import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Wrench, Plus, Pencil, Check, X } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import NuevaSolicitudModal from '../servicio-tecnico/NuevaSolicitudModal';
import SolicitudDetalle from '../servicio-tecnico/SolicitudDetalle';
import SolicitudesVista from '../servicio-tecnico/SolicitudesVista';
import MaquinasVista from '../servicio-tecnico/MaquinasVista';
import MaquinaFicha from '../servicio-tecnico/MaquinaFicha';
import MiSemanaVista from '../servicio-tecnico/MiSemanaVista';
import CalendarioVista from '../servicio-tecnico/CalendarioVista';
import PlanesVista from '../servicio-tecnico/PlanesVista';
import TrabajoDetalle from '../servicio-tecnico/TrabajoDetalle';
import ProyectosVista, { ProyectoDetalle } from '../servicio-tecnico/Proyectos';
import InsumosVista from '../servicio-tecnico/Insumos';
import ReportesVista from '../servicio-tecnico/ReportesVista';
import { mensajeError } from '../servicio-tecnico/constantes';

// Servicio Técnico — pantalla principal. Plan: docs/servicio-tecnico-plan.md.
// Marco de las secciones (solicitudes, máquinas, ...) y de los paneles de detalle, que se pueden
// abrir desde cualquier sección (y desde un aviso: ?sol=ID).
// Técnicos (área SERVICIO) y Admin ven todas las secciones; el resto, solo sus solicitudes.

const SECCIONES_TECNICO = [
    { key: 'solicitudes', label: 'Solicitudes' },
    { key: 'semana', label: 'Mi semana' },
    { key: 'calendario', label: 'Calendario' },
    { key: 'maquinas', label: 'Máquinas' },
    { key: 'planes', label: 'Planes y procedimientos' },
    { key: 'proyectos', label: 'Proyectos' },
    { key: 'insumos', label: 'Insumos' },
    { key: 'reportes', label: 'Reportes' },
];

const sel = 'px-3 py-2 border border-zinc-200 rounded-xl text-sm text-zinc-700 bg-white outline-none focus:border-brand-cyan';

const ServicioTecnicoPage = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [meta, setMeta] = useState(null);
    const [seccion, setSeccion] = useState('solicitudes');
    const [nueva, setNueva] = useState(false);
    const [abierta, setAbierta] = useState(null);            // SolId del detalle
    const [maquinaAbierta, setMaquinaAbierta] = useState(null); // EquipoID de la ficha
    const [trabajoAbierto, setTrabajoAbierto] = useState(null); // TrabId del detalle de trabajo
    const [proyectoAbierto, setProyectoAbierto] = useState(null); // ProyId del detalle de proyecto
    const [versionProyecto, setVersionProyecto] = useState(0);
    const proyectoRef = useRef(null);
    proyectoRef.current = proyectoAbierto;
    const [versionDetalle, setVersionDetalle] = useState(0);
    const [versionMaquina, setVersionMaquina] = useState(0);
    const [versionTrabajo, setVersionTrabajo] = useState(0);
    const [versionLista, setVersionLista] = useState(0);
    const trabajoRef = useRef(null);
    trabajoRef.current = trabajoAbierto;
    const [editandoEnc, setEditandoEnc] = useState(false);
    const [usuarios, setUsuarios] = useState([]);
    const [encElegido, setEncElegido] = useState('');
    const abiertaRef = useRef(null);
    const maquinaRef = useRef(null);
    abiertaRef.current = abierta;
    maquinaRef.current = maquinaAbierta;

    const esTecnico = !!meta?.esTecnico;

    const cargarMeta = useCallback(async () => {
        try { setMeta(await servicioTecnicoService.meta()); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo cargar Servicio Técnico')); }
    }, []);
    useEffect(() => { cargarMeta(); }, [cargarMeta]);

    // Desde un aviso: ?sol=ID abre una solicitud, ?trab=ID un trabajo, ?seccion=semana|calendario|... una sección.
    useEffect(() => {
        const s = parseInt(searchParams.get('sol'), 10);
        if (s > 0) setAbierta(s);
        const t = parseInt(searchParams.get('trab'), 10);
        if (t > 0) setTrabajoAbierto(t);
        const p = parseInt(searchParams.get('proy'), 10);
        if (p > 0) setProyectoAbierto(p);
        const sec = searchParams.get('seccion');
        if (sec && SECCIONES_TECNICO.some(x => x.key === sec)) setSeccion(sec);
    }, [searchParams]);
    const quitarParam = (k) => {
        if (searchParams.get(k)) { searchParams.delete(k); setSearchParams(searchParams, { replace: true }); }
    };
    const cerrarDetalle = () => { setAbierta(null); quitarParam('sol'); };
    const cerrarTrabajo = () => { setTrabajoAbierto(null); quitarParam('trab'); };
    const cerrarProyecto = () => { setProyectoAbierto(null); quitarParam('proy'); };

    // Cambios de otros (socket): los paneles abiertos se refrescan al toque (las listas, cada una con su freno).
    useEffect(() => {
        const alCambiar = (d) => {
            if (d?.solId && d.solId === abiertaRef.current) setVersionDetalle(v => v + 1);
            if (d?.trabId && d.trabId === trabajoRef.current) setVersionTrabajo(v => v + 1);
            if (d?.proyId && d.proyId === proyectoRef.current) setVersionProyecto(v => v + 1);
            if (maquinaRef.current && (!d?.equipoId || d.equipoId === maquinaRef.current)) setVersionMaquina(v => v + 1);
        };
        socket.on('st:updated', alCambiar);
        return () => socket.off('st:updated', alCambiar);
    }, []);

    // Cambio hecho desde esta misma pantalla: todo se recarga sin esperar el socket.
    const alCambiarAlgo = () => {
        setVersionLista(v => v + 1);
        if (maquinaRef.current) setVersionMaquina(v => v + 1);
    };

    const guardarEncargado = async () => {
        try {
            const enc = await servicioTecnicoService.setEncargado(encElegido || null);
            setMeta((m) => ({ ...m, encargado: enc }));
            setEditandoEnc(false);
            toast.success(enc ? `Encargado: ${enc.nombre}` : 'Sin encargado elegido');
        } catch (e) { toast.error(mensajeError(e)); }
    };
    const editarEncargado = async () => {
        setEncElegido(meta?.encargado?.origen === 'pantalla' ? String(meta.encargado.id) : '');
        setEditandoEnc(true);
        if (!usuarios.length) servicioTecnicoService.usuarios().then(setUsuarios).catch(() => {});
    };

    return (
        <div className="max-w-6xl mx-auto p-3 md:p-6">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center shrink-0"><Wrench size={24} /></div>
                <div className="min-w-0 flex-1">
                    <h1 className="text-2xl font-black text-zinc-800 leading-none">Servicio Técnico</h1>
                    <p className="text-sm text-zinc-400 mt-1">
                        {esTecnico ? 'Solicitudes, máquinas y mantenimiento.' : 'Tus pedidos a Servicio Técnico y su estado.'}
                    </p>
                </div>
                <button onClick={() => setNueva(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 shadow-sm">
                    <Plus size={18} /> Nueva solicitud
                </button>
            </div>

            {/* Encargado (quien recibe los avisos de solicitudes nuevas) */}
            {meta && esTecnico && (
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                    <span className="font-bold text-zinc-400 uppercase text-[11px] tracking-wide">Encargado:</span>
                    {editandoEnc ? (
                        <>
                            <select className={sel} value={encElegido} onChange={(e) => setEncElegido(e.target.value)}>
                                <option value="">— Ninguno (usa la variable de entorno o avisa a todos los técnicos) —</option>
                                {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}{u.area ? ` · ${u.area}` : ''}</option>)}
                            </select>
                            <button onClick={guardarEncargado} className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-cyan text-white"><Check size={16} /></button>
                            <button onClick={() => setEditandoEnc(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><X size={16} /></button>
                        </>
                    ) : (
                        <>
                            <span className="font-bold text-zinc-700">{meta.encargado?.nombre || 'Sin elegir: los avisos van a todos los técnicos'}</span>
                            {meta.encargado?.origen === 'variable de entorno' && <span className="text-xs text-zinc-400">(variable de entorno)</span>}
                            {meta.esAdmin && (
                                <button onClick={editarEncargado} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-brand-cyan" title="Cambiar encargado"><Pencil size={14} /></button>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Secciones (técnicos) */}
            {esTecnico && (
                <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
                    {SECCIONES_TECNICO.map(s => (
                        <button key={s.key} onClick={() => setSeccion(s.key)}
                            className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${seccion === s.key ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-zinc-400 hover:text-zinc-600'}`}>
                            {s.label}
                        </button>
                    ))}
                </div>
            )}

            {!meta ? null
                : !esTecnico || seccion === 'solicitudes' ? <SolicitudesVista meta={meta} onAbrir={setAbierta} version={versionLista} />
                : seccion === 'semana' ? <MiSemanaVista meta={meta} onAbrirTrabajo={setTrabajoAbierto} onAbrirSolicitud={setAbierta} version={versionLista} />
                : seccion === 'calendario' ? <CalendarioVista meta={meta} onAbrirTrabajo={setTrabajoAbierto} onAbrirSolicitud={setAbierta} version={versionLista} />
                : seccion === 'maquinas' ? <MaquinasVista onAbrirMaquina={setMaquinaAbierta} />
                : seccion === 'planes' ? <PlanesVista meta={meta} onAbrirTrabajo={setTrabajoAbierto} />
                : seccion === 'proyectos' ? <ProyectosVista meta={meta} onAbrir={setProyectoAbierto} />
                : seccion === 'insumos' ? <InsumosVista meta={meta} />
                : seccion === 'reportes' ? <ReportesVista semanaInicial={searchParams.get('semana') || undefined} onAbrirMaquina={setMaquinaAbierta} />
                : null}

            <NuevaSolicitudModal abierta={nueva} onCerrar={() => setNueva(false)} onCreada={(sol) => { alCambiarAlgo(); setAbierta(sol.SolId); }} />
            {maquinaAbierta && (
                <MaquinaFicha equipoId={maquinaAbierta} meta={meta} version={versionMaquina}
                    onCerrar={() => setMaquinaAbierta(null)} onAbrirSolicitud={setAbierta} onCambio={alCambiarAlgo} />
            )}
            {proyectoAbierto && (
                <ProyectoDetalle proyId={proyectoAbierto} meta={meta} version={versionProyecto} onCerrar={cerrarProyecto} onCambio={alCambiarAlgo} />
            )}
            {trabajoAbierto && (
                <TrabajoDetalle trabId={trabajoAbierto} meta={meta} version={versionTrabajo}
                    onCerrar={cerrarTrabajo} onCambio={alCambiarAlgo} onAbrirMaquina={esTecnico ? setMaquinaAbierta : undefined} />
            )}
            {abierta && (
                <SolicitudDetalle solId={abierta} meta={meta} version={versionDetalle}
                    onCerrar={cerrarDetalle} onCambio={alCambiarAlgo} onAbrir={setAbierta}
                    onAbrirMaquina={esTecnico ? setMaquinaAbierta : undefined} />
            )}
        </div>
    );
};

export default ServicioTecnicoPage;
