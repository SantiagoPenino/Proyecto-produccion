import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
    Wrench, Users, Loader2, ClipboardList, ListChecks, CalendarDays, Printer, Repeat, FolderKanban, Package, ChartColumn,
} from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import Selector from '../ui/Selector';
import { MiniModal, btnPri, btnCancelar, clasePastillaBoton, ContenidoPastilla, PastillaFija } from '../servicio-tecnico/ui';
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
import { useAuth } from '../../context/AuthContext';

// Servicio Técnico — pantalla principal. Plan: docs/servicio-tecnico-plan.md.
// Marco de las secciones (solicitudes, máquinas, ...) y de los paneles de detalle, que se pueden
// abrir desde cualquier sección (y desde un aviso: ?sol=ID).
// Técnicos (área SERVICIO) y Admin ven todas las secciones; el resto, solo sus solicitudes.

const SECCIONES_TECNICO = [
    { key: 'solicitudes', label: 'Solicitudes', Icono: ClipboardList },
    { key: 'semana', label: 'Mi semana', Icono: ListChecks },
    { key: 'calendario', label: 'Calendario', Icono: CalendarDays },
    { key: 'maquinas', label: 'Máquinas', Icono: Printer },
    { key: 'planes', label: 'Planes y procedimientos', Icono: Repeat },
    { key: 'proyectos', label: 'Proyectos', Icono: FolderKanban },
    { key: 'insumos', label: 'Insumos', Icono: Package },
    { key: 'reportes', label: 'Reportes', Icono: ChartColumn },
];

const iniciales = (n) => String(n || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

// Encargado: recibe los avisos de solicitudes nuevas. Lo cambia un Admin o el encargado de ahora
// (para pasarle el encargo a otro); el resto lo ve fijo. Desde sm es una pastilla con el nombre; en
// celular, solo el círculo con la inicial (tocándolo: la lista para cambiarlo, o un cartel con el nombre).
const Encargado = ({ meta, onCambio }) => {
    const [usuarios, setUsuarios] = useState([]);
    const [pasar, setPasar] = useState(null); // { valor, nombre }: el encargado se lo pasa a otro → se confirma
    const [guardando, setGuardando] = useState(false);
    const [verCartel, setVerCartel] = useState(false);
    const cartelRef = useRef(null);
    const enc = meta.encargado;
    const puede = !!(meta.esAdmin || (enc && enc.id === meta.usuario?.id));
    useEffect(() => { if (puede) servicioTecnicoService.usuarios().then(setUsuarios).catch(() => {}); }, [puede]);
    useEffect(() => {
        if (!verCartel) return undefined;
        const afuera = (e) => { if (!cartelRef.current?.contains(e.target)) setVerCartel(false); };
        document.addEventListener('pointerdown', afuera, true);
        return () => document.removeEventListener('pointerdown', afuera, true);
    }, [verCartel]);

    const guardar = async (v) => {
        setGuardando(true);
        try {
            const nuevo = await servicioTecnicoService.setEncargado(v || null);
            onCambio(nuevo);
            toast.success(nuevo ? `Encargado: ${nuevo.nombre}` : 'Sin encargado: los avisos van a todos los técnicos');
        } catch (e) { toast.error(mensajeError(e)); }
        finally { setGuardando(false); setPasar(null); }
    };
    // Si no es Admin y se lo pasa a otro, pierde el permiso de cambiarlo: se confirma antes.
    const elegir = (v) => {
        if (!meta.esAdmin && Number(v || 0) !== meta.usuario?.id) setPasar({ valor: v, nombre: usuarios.find(u => String(u.id) === v)?.nombre || null });
        else guardar(v);
    };

    const contenido = (
        <ContenidoPastilla etiqueta={enc?.origen === 'variable de entorno' ? 'Encargado · variable de entorno' : 'Encargado'}
            valor={enc ? enc.nombre : 'Todos los técnicos'} apagado={!enc} icono={enc ? iniciales(enc.nombre) : <Users size={15} />} />
    );
    const circulo = (
        <span className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${enc ? 'bg-brand-cyan/10 text-brand-cyan' : 'bg-zinc-100 text-zinc-400'}`}>
            {enc ? iniciales(enc.nombre) : <Users size={15} />}
        </span>
    );
    const tituloCirculo = `Encargado: ${enc ? enc.nombre : 'ninguno (avisos a todos los técnicos)'}`;

    if (!puede) return (
        <>
            <div className="hidden sm:block">
                <PastillaFija titulo="Recibe los avisos de solicitudes nuevas. Lo cambia un administrador o el encargado actual.">{contenido}</PastillaFija>
            </div>
            <div className="sm:hidden relative" ref={cartelRef}>
                <button type="button" onClick={() => setVerCartel(v => !v)} title={tituloCirculo} aria-label={tituloCirculo} className="block rounded-full">{circulo}</button>
                {verCartel && (
                    <div className="absolute right-0 top-11 z-20 w-60 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-xl">
                        <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Encargado{enc?.origen === 'variable de entorno' ? ' · variable de entorno' : ''}</div>
                        <div className="text-sm font-bold text-zinc-800">{enc ? enc.nombre : 'Todos los técnicos'}</div>
                        <div className="mt-1 text-xs text-zinc-500">Recibe los avisos de solicitudes nuevas. Lo cambia un administrador o el encargado.</div>
                    </div>
                )}
            </div>
        </>
    );

    const tecnicos = usuarios.filter(u => u.area === 'SERVICIO');
    const otros = usuarios.filter(u => u.area !== 'SERVICIO');
    const opciones = (<>
        <option value="" descripcion="Los avisos van a la variable de entorno o, si no hay, a todos los técnicos">Sin encargado</option>
        {tecnicos.length > 0 && <optgroup label="Servicio Técnico">{tecnicos.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</optgroup>}
        {otros.length > 0 && <optgroup label="Otros usuarios">{otros.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</optgroup>}
    </>);
    const valor = enc?.origen === 'pantalla' ? String(enc.id) : '';
    return (
        <>
            <div className="hidden sm:block">
                <Selector value={valor} onChange={(e) => elegir(e.target.value)} disabled={guardando}
                    buscar anchoLista={300} claseBoton={clasePastillaBoton} renderValor={() => contenido}
                    title="Encargado: recibe los avisos de solicitudes nuevas">
                    {opciones}
                </Selector>
            </div>
            <div className="sm:hidden">
                <Selector value={valor} onChange={(e) => elegir(e.target.value)} disabled={guardando} sinFlecha
                    buscar anchoLista={300} renderValor={() => circulo} title={tituloCirculo} aria-label={tituloCirculo}
                    claseBoton="flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/30 disabled:opacity-60">
                    {opciones}
                </Selector>
            </div>
            {pasar && (
                <MiniModal titulo="Pasar el encargo" chico onCerrar={() => setPasar(null)} pie={<>
                    <button onClick={() => setPasar(null)} className={btnCancelar}>Cancelar</button>
                    <button onClick={() => guardar(pasar.valor)} disabled={guardando} className={btnPri}>
                        {guardando && <Loader2 size={15} className="animate-spin" />} Pasar el encargo
                    </button>
                </>}>
                    <p className="text-sm text-zinc-600">
                        {pasar.nombre ? <>Los avisos de solicitudes nuevas le van a llegar a <b>{pasar.nombre}</b>.</>
                            : <>Queda sin encargado: los avisos van a la variable de entorno o, si no hay, a todos los técnicos.</>}
                    </p>
                    <p className="text-sm text-zinc-600">Después no vas a poder volver a cambiarlo: lo hace un administrador{pasar.nombre ? ` o ${pasar.nombre}` : ''}.</p>
                </MiniModal>
            )}
        </>
    );
};

const ServicioTecnicoPage = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [meta, setMeta] = useState(null);
    const [seccion, setSeccion] = useState('solicitudes');
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
    const abiertaRef = useRef(null);
    const maquinaRef = useRef(null);
    abiertaRef.current = abierta;
    maquinaRef.current = maquinaAbierta;

    // Hasta que llega /meta se supone con la sesión, con la regla del backend (Admin o área SERVICIO): si
    // no, el encabezado arrancaba como el de quien pide y cambiaba al toque (un flash al refrescar).
    const { user } = useAuth();
    const esTecnicoSesion = String(user?.rol || user?.role || '').trim().toLowerCase() === 'admin'
        || String(user?.areaKey || '').trim().toLowerCase() === 'servicio';
    const esTecnico = meta ? !!meta.esTecnico : esTecnicoSesion;

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

    // Las secciones como opciones de un Selector (celular y tablet; desde lg son pestañas).
    const opcionesSeccion = SECCIONES_TECNICO.map(({ key, label, Icono }) => (
        <option key={key} value={key}>
            <span className="inline-flex items-center gap-2.5 align-middle"><Icono size={18} className="shrink-0 text-brand-cyan" />{label}</span>
        </option>
    ));

    return (
        <div className="p-3 md:p-6">
            {/* Encabezado. En celular, para los técnicos, la sección elegida hace de título (tocándola se
                cambia de sección): "Servicio Técnico" + un desplegable aparte eran dos filas para lo mismo. */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                {esTecnico && (
                    <div className="sm:hidden min-w-0 flex-1">
                        <Selector value={seccion} onChange={(e) => setSeccion(e.target.value)} aria-label="Sección" anchoLista={260}
                            claseBoton="max-w-full flex items-center gap-2 rounded-lg text-left text-xl font-black text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20">
                            {opcionesSeccion}
                        </Selector>
                    </div>
                )}
                <div className={`${esTecnico ? 'hidden sm:flex' : 'flex'} w-11 h-11 rounded-xl bg-brand-cyan/10 text-brand-cyan items-center justify-center shrink-0`}><Wrench size={24} /></div>
                <div className={`${esTecnico ? 'hidden sm:block' : ''} min-w-[200px] flex-1`}>
                    <h1 className="text-2xl font-black text-zinc-800 leading-none">Servicio Técnico</h1>
                    <p className="hidden sm:block text-sm text-zinc-400 mt-1">
                        {esTecnico ? 'Solicitudes, máquinas y mantenimiento.' : 'Tus pedidos a Servicio Técnico y su estado.'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 max-w-full">
                    {esTecnico && (meta
                        ? <Encargado meta={meta} onCambio={(enc) => setMeta((m) => ({ ...m, encargado: enc }))} />
                        // Mientras carga, el lugar del encargado (círculo en celular, pastilla desde sm): que no salte.
                        : <span className="block w-9 h-9 sm:w-40 sm:h-11 rounded-full sm:rounded-2xl bg-zinc-200/70 animate-pulse" />)}
                    {/* "Nueva solicitud" está en la navbar (BotonNuevaSolicitud), en todas las pantallas. */}
                </div>
            </div>

            {/* Secciones en tablet (sm a lg): las 8 pestañas no entran (piden ~920 px), un desplegable con la
                sección actual. */}
            {esTecnico && (
                <div className="hidden sm:block lg:hidden mb-4">
                    <Selector value={seccion} onChange={(e) => setSeccion(e.target.value)} aria-label="Sección"
                        claseBoton="w-full flex items-center gap-2 px-4 py-3 rounded-xl border border-zinc-200 bg-white text-left text-base font-bold text-zinc-800 shadow-sm outline-none transition-colors hover:border-zinc-300 focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15">
                        {opcionesSeccion}
                    </Selector>
                </div>
            )}
            {/* Desde lg, pestañas. La línea de abajo es una sombra interna: con un borde + -mb-px los botones
                desbordaban 1px y aparecía una barra de scroll. */}
            {esTecnico && (
                <div className="hidden lg:flex gap-1 mb-4 overflow-x-auto no-scrollbar shadow-[inset_0_-1px_0_0_#e4e4e7]">
                    {SECCIONES_TECNICO.map(s => (
                        <button key={s.key} onClick={() => setSeccion(s.key)}
                            className={`shrink-0 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${seccion === s.key ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:border-zinc-300'}`}>
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
