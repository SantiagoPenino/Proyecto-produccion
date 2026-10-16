import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2, UserPlus, Search } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import { btnSec, campoFiltro } from '../servicio-tecnico/ui';
import { mensajeError } from './comun';

// Equipo de desarrollo (reemplaza a "Más › Equipo" del prototipo). Quién trabaja en Desarrollos, con
// qué nivel y en qué líneas. Lo cambia quien edita; el resto lo ve.
const NIVELES = [
    { value: 'EDITOR', label: 'Editor', descripcion: 'Todo: aprobar, proyectos, tareas, tandas y plantillas' },
    { value: 'COLABORADOR', label: 'Colaborador', descripcion: 'Carga pedidos, muestras y comentarios' },
];

const Fila = ({ m, lineas, edita, onGuardar, onQuitar }) => {
    const [seguro, setSeguro] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const guardar = async (cambios) => {
        setGuardando(true);
        try { await onGuardar(m.usuarioId, { nivel: m.nivel, lineas: m.lineas, ...cambios }); }
        finally { setGuardando(false); }
    };
    const alternarLinea = (areaId) => guardar({ lineas: m.lineas.includes(areaId) ? m.lineas.filter(x => x !== areaId) : [...m.lineas, areaId] });
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-zinc-100 last:border-b-0">
            <div className="min-w-[180px] flex-1">
                <div className="text-sm font-bold text-zinc-800">{m.nombre}</div>
                <div className="text-xs text-zinc-400">{m.usuario}{m.rol ? ` · ${m.rol}` : ''}</div>
            </div>
            <div className="w-40">
                {edita ? (
                    <Selector value={m.nivel} onChange={(e) => guardar({ nivel: e.target.value })} disabled={guardando} aria-label="Nivel" anchoLista={300}>
                        {NIVELES.map(n => <option key={n.value} value={n.value} descripcion={n.descripcion}>{n.label}</option>)}
                    </Selector>
                ) : <span className="text-sm text-zinc-600">{NIVELES.find(n => n.value === m.nivel)?.label || m.nivel}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {lineas.map(l => {
                    const activa = m.lineas.includes(l.areaId);
                    return (
                        <button key={l.areaId} type="button" disabled={!edita || guardando} onClick={() => alternarLinea(l.areaId)}
                            className={`px-2.5 py-1 rounded-full border text-xs font-bold transition-colors disabled:cursor-default ${activa ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-zinc-200 text-zinc-400'} ${edita ? 'hover:border-brand-cyan/50' : ''}`}>
                            {l.nombre}
                        </button>
                    );
                })}
            </div>
            {edita && (
                <button type="button" onClick={() => (seguro ? onQuitar(m.usuarioId) : setSeguro(true))} onBlur={() => setSeguro(false)}
                    className={`sm:w-36 sm:text-right text-xs font-bold${seguro ? 'text-brand-magenta' : 'text-zinc-400 hover:text-zinc-600'}`}>
                    {seguro ? '¿Quitar? Tocá de nuevo' : 'Quitar'}
                </button>
            )}
            {guardando && <Loader2 size={14} className="animate-spin text-zinc-300" />}
        </div>
    );
};

const EquipoVista = ({ sesion, catalogos }) => {
    const [equipo, setEquipo] = useState(null);
    const [q, setQ] = useState('');
    const [candidatos, setCandidatos] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const edita = !!sesion?.esEditor;
    const lineas = catalogos?.lineas || [];

    const cargar = useCallback(async () => {
        try { setEquipo(await desarrollosService.equipo()); }
        catch (e) { setEquipo([]); toast.error(mensajeError(e, 'No se pudo cargar el equipo.')); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    // Buscar a quién sumar (con una pausa corta mientras se escribe)
    useEffect(() => {
        if (!edita || q.trim().length < 2) { setCandidatos([]); return undefined; }
        setBuscando(true);
        const t = setTimeout(() => {
            desarrollosService.candidatos(q.trim()).then(setCandidatos).catch(() => setCandidatos([])).finally(() => setBuscando(false));
        }, 250);
        return () => clearTimeout(t);
    }, [q, edita]);

    const guardar = async (usuarioId, datos) => {
        try { setEquipo(await desarrollosService.guardarMiembro(usuarioId, datos)); }
        catch (e) { toast.error(mensajeError(e)); }
    };
    const sumar = async (c, nivel) => {
        await guardar(c.usuarioId, { nivel, lineas: [] });
        setQ('');
        setCandidatos([]);
        toast.success(`${c.nombre} se sumó al equipo como ${nivel === 'EDITOR' ? 'editor' : 'colaborador'}.`);
    };
    const quitar = async (usuarioId) => {
        try { setEquipo(await desarrollosService.quitarMiembro(usuarioId)); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo quitar.')); }
    };

    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-zinc-500">
                Quién trabaja en Desarrollos. <b>Editor</b>: hace todo (aprobar, proyectos, tareas, tandas y plantillas).{' '}
                <b>Colaborador</b>: carga pedidos, muestras y comentarios. Los Admin del sistema son editores sin cargarlos.
                Los vendedores no van acá: ven «Pedidos» por el menú de su rol. Solo la gente del equipo aparece para elegir como responsable.
            </p>

            {edita && (
                <div className="flex flex-col gap-2">
                    <div className="relative max-w-sm">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input className={`${campoFiltro} w-full pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar a alguien para sumar al equipo" />
                    </div>
                    {buscando && <Loader2 size={15} className="animate-spin text-zinc-300" />}
                    {!buscando && q.trim().length >= 2 && !candidatos.length && <p className="text-sm text-zinc-400">Nadie coincide (o ya está en el equipo).</p>}
                    {candidatos.length > 0 && (
                        <div className="rounded-xl border border-zinc-200 bg-white max-w-xl">
                            {candidatos.slice(0, 8).map(c => (
                                <div key={c.usuarioId} className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-zinc-100 last:border-b-0">
                                    <UserPlus size={16} className="text-brand-cyan" />
                                    <div className="flex-1 min-w-[140px]">
                                        <span className="text-sm font-bold text-zinc-800">{c.nombre}</span>
                                        <span className="text-xs text-zinc-400"> · {c.usuario}{c.rol ? ` · ${c.rol}` : ''}</span>
                                    </div>
                                    <button type="button" onClick={() => sumar(c, 'COLABORADOR')} className={btnSec}>Colaborador</button>
                                    <button type="button" onClick={() => sumar(c, 'EDITOR')} className={btnSec}>Editor</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="rounded-2xl border border-zinc-200 bg-white">
                {equipo === null ? <div className="p-4"><Loader2 size={18} className="animate-spin text-zinc-300" /></div>
                    : !equipo.length ? <p className="p-4 text-sm text-zinc-400">Todavía no hay nadie en el equipo.</p>
                    : equipo.map(m => <Fila key={m.usuarioId} m={m} lineas={lineas} edita={edita} onGuardar={guardar} onQuitar={quitar} />)}
            </div>
        </div>
    );
};

export default EquipoVista;
