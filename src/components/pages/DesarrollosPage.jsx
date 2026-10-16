import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
    House, Inbox, FolderKanban, ChartGantt, ListChecks, Shirt, NotebookPen, Library, Archive, FileText,
    LayoutTemplate, Users, Construction, Loader2,
} from 'lucide-react';
import { desarrollosService } from '../../services/api';
import { socket } from '../../services/socketService';
import { SECCIONES_DES } from './desarrollosSecciones';
import EquipoVista from '../desarrollos/EquipoVista';
import PedidosVista from '../desarrollos/PedidosVista';
import BandejaVista from '../desarrollos/BandejaVista';
import ProyectosVista from '../desarrollos/ProyectosVista';
import TareasVista from '../desarrollos/TareasVista';
import ArchivoVista from '../desarrollos/ArchivoVista';
import PlantillasVista from '../desarrollos/PlantillasVista';
import PlanificacionVista from '../desarrollos/PlanificacionVista';
import InicioVista from '../desarrollos/InicioVista';
import MuestrasVista from '../desarrollos/MuestrasVista';
import CatalogoVista from '../desarrollos/CatalogoVista';
import { mensajeError } from '../desarrollos/comun';

// Desarrollos — marco de las secciones (docs/desarrollos/plan-integracion.md). Cada sección es su
// propia entrada del menú (desarrollosSecciones.js) y llega en `seccion`. Lo que cada uno puede hacer
// adentro (editor, colaborador, o quien pidió algo) lo dice /desarrollos/sesion y lo valida el backend.
// Las pantallas llegan por fases; mientras tanto, cada una dice qué va a hacer y en qué fase llega.

const ICONOS = {
    inicio: House, bandeja: Inbox, proyectos: FolderKanban, planificacion: ChartGantt, tareas: ListChecks,
    muestras: Shirt, pedidos: NotebookPen, catalogo: Library, archivo: Archive, reportes: FileText,
    plantillas: LayoutTemplate, equipo: Users,
};

// Qué hace cada pantalla (del Plan funcional de Felipe), para el aviso de "todavía no está".
const QUE_HACE = {
    inicio: 'Lo de cada persona hoy: sus tareas planificadas o con fecha (las atrasadas primero), sus proyectos, la tanda en curso y lo que espera en la Bandeja y en Muestras.',
    bandeja: 'Todo lo que entra: pedidos, ideas, órdenes, correcciones y variantes. Se busca, se ordena por lo recomendado para atender y se decide: aprobar y crear el proyecto, posponer o descartar con un motivo que ve quien lo pidió.',
    proyectos: 'Los desarrollos en curso y la ficha de cada uno: etapas, la tarea que sigue, las tareas por etapa, datos, puntaje, archivos, comentarios e historial.',
    planificacion: 'Tandas de 1 a 4 semanas: se vinculan proyectos y se eligen sus tareas; al cerrar, lo pendiente pasa a la próxima. Y la lista de desarrollo, en orden manual o recomendado.',
    tareas: 'El trabajo del día, en lista o en tablero por estado, con fechas sugeridas según duraciones y dependencias.',
    muestras: 'Cada muestra física con sus órdenes del sistema, los proyectos a los que pertenece, estado, tildes, ronda, fecha y fotos.',
    pedidos: 'Un formulario corto para cargar lo que piden los clientes, y «Mis pedidos» con el estado en palabras simples y los comentarios.',
    catalogo: 'Capacidades técnicas (y cuál conviene desarrollar primero), variantes de cada producto y opciones de cada molde.',
    archivo: 'Los proyectos terminados y cancelados, con lo que llevó cada uno.',
    reportes: 'El resumen de la semana, para copiar y mandar por WhatsApp o mail.',
    plantillas: 'Los flujos guardados (etapas y tareas) que se eligen al aprobar un pedido, y los tipos de desarrollo.',
};

const EnConstruccion = ({ s }) => (
    <div className="max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 flex gap-4">
        <Construction size={26} className="text-brand-cyan shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1.5">
            <p className="text-base font-bold text-zinc-800">Esta pantalla llega en la fase {s.fase} del plan.</p>
            <p className="text-sm text-zinc-600">{QUE_HACE[s.id]}</p>
            <p className="text-xs text-zinc-400">Los datos del prototipo de Felipe ya están cargados; falta la pantalla.</p>
        </div>
    </div>
);

// Inicio, Bandeja, Proyectos, Planificación, Tareas, Muestras, Catálogo, Archivo y Plantillas son del equipo: quien tenga la entrada del menú sin
// estar en el equipo ve este aviso.
const SoloEquipo = () => (
    <div className="max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
        Esta pantalla es del equipo de desarrollo. Para cargar un pedido y seguirlo, usá «Pedidos».
    </div>
);

const DesarrollosPage = ({ seccion }) => {
    const s = SECCIONES_DES.find(x => x.id === seccion) || SECCIONES_DES[0];
    const Icono = ICONOS[s.id] || FolderKanban;
    const [sesion, setSesion] = useState(null);
    const [catalogos, setCatalogos] = useState(null);
    // Cambios de otros (socket): las listas se vuelven a pedir. Lo que alguien está escribiendo no se pisa:
    // los borradores son estado de cada pantalla.
    const [version, setVersion] = useState(0);
    const [searchParams] = useSearchParams();
    const params = Object.fromEntries(searchParams.entries());
    useEffect(() => {
        const alCambiar = () => setVersion(v => v + 1);
        socket.on('desarrollos:cambio', alCambiar);
        return () => socket.off('desarrollos:cambio', alCambiar);
    }, []);

    useEffect(() => {
        let vivo = true;
        Promise.all([desarrollosService.sesion(), desarrollosService.catalogos()])
            .then(([se, ca]) => { if (vivo) { setSesion(se); setCatalogos(ca); } })
            .catch(e => toast.error(mensajeError(e, 'No se pudo cargar Desarrollos.')));
        return () => { vivo = false; };
    }, []);
    // Plantillas y tipos de desarrollo cambian poco: se vuelven a pedir cuando avisan que cambiaron
    const recargarCatalogos = () => desarrollosService.catalogos().then(setCatalogos).catch(() => {});
    useEffect(() => {
        const alCambiar = (d) => { if (d?.entidad === 'PLANTILLA' || d?.entidad === 'TIPOS') recargarCatalogos(); };
        socket.on('desarrollos:cambio', alCambiar);
        return () => socket.off('desarrollos:cambio', alCambiar);
    }, []);

    return (
        <div className="p-3 md:p-6">
            <div className="flex items-center gap-3 mb-5">
                <Icono size={28} className="hidden sm:block text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black text-zinc-800 leading-none">{s.label}</h1>
                    <p className="text-sm text-zinc-400 mt-1">Desarrollos</p>
                </div>
            </div>
            {!sesion ? <Loader2 size={20} className="animate-spin text-zinc-300" />
                : s.id === 'equipo' ? <EquipoVista sesion={sesion} catalogos={catalogos} />
                : s.id === 'pedidos' ? <PedidosVista sesion={sesion} version={version} abrirInicial={params.abrir ? Number(params.abrir) : null} />
                : s.id === 'inicio' ? (sesion.esEquipo ? <InicioVista sesion={sesion} catalogos={catalogos} key={version} /> : <SoloEquipo />)
                : s.id === 'planificacion' ? (sesion.esEquipo ? <PlanificacionVista sesion={sesion} catalogos={catalogos} version={version} /> : <SoloEquipo />)
                : s.id === 'proyectos' ? (sesion.esEquipo ? <ProyectosVista sesion={sesion} catalogos={catalogos} version={version} /> : <SoloEquipo />)
                : s.id === 'tareas' ? (sesion.esEquipo ? <TareasVista sesion={sesion} catalogos={catalogos} version={version} /> : <SoloEquipo />)
                : s.id === 'archivo' ? (sesion.esEquipo ? <ArchivoVista catalogos={catalogos} version={version} /> : <SoloEquipo />)
                : s.id === 'plantillas' ? (sesion.esEquipo ? <PlantillasVista sesion={sesion} catalogos={catalogos} version={version} onCatalogos={recargarCatalogos} /> : <SoloEquipo />)
                : s.id === 'muestras' ? (sesion.esEquipo ? <MuestrasVista sesion={sesion} catalogos={catalogos} version={version} params={params} onCatalogos={recargarCatalogos} /> : <SoloEquipo />)
                : s.id === 'catalogo' ? (sesion.esEquipo ? <CatalogoVista sesion={sesion} catalogos={catalogos} version={version} params={params} /> : <SoloEquipo />)
                : s.id === 'bandeja' ? (sesion.esEquipo
                    ? <BandejaVista sesion={sesion} catalogos={catalogos} version={version} params={params} />
                    : <SoloEquipo />)
                : <EnConstruccion s={s} />}
        </div>
    );
};

export default DesarrollosPage;
