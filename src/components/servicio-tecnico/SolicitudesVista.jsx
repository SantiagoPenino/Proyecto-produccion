import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Search, Paperclip, User, Hand, Loader2, RefreshCw } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import {
    CATEGORIAS, PRIORIDADES, ESTADOS, categoria as categoriaInfo, prioridad as prioridadInfo, estado as estadoInfo,
    resultado as resultadoInfo, estadoEquipo, fmtFecha, haceCuanto, mensajeError,
} from './constantes';
import { chip } from './ui';

// Bandeja / historial de solicitudes con buscador y filtros.
// Técnicos: Abiertas · Tomadas por mí · Historial. Resto: Mis solicitudes · Abiertas.
const VISTAS_TECNICO = [
    { key: 'abiertas', label: 'Abiertas' },
    { key: 'mias', label: 'Tomadas por mí' },
    { key: 'historial', label: 'Historial' },
];
const VISTAS_USUARIO = [
    { key: 'mis', label: 'Mis solicitudes' },
    { key: 'abiertas', label: 'Abiertas' },
];
const FILTROS_VACIOS = { q: '', categoria: '', prioridad: '', estado: '', tecnico: '', area: '', desde: '', hasta: '' };
const sel = 'px-3 py-2 border border-zinc-200 rounded-xl text-sm text-zinc-700 bg-white outline-none focus:border-brand-cyan';
const barraPrioridad = { BAJA: 'bg-emerald-400', MEDIA: 'bg-amber-400', ALTA: 'bg-orange-500', CRITICA: 'bg-red-600' };

const SolicitudesVista = ({ meta, onAbrir, version = 0 }) => {
    const esTecnico = !!meta?.esTecnico;
    const vistas = esTecnico ? VISTAS_TECNICO : VISTAS_USUARIO;
    const [vista, setVista] = useState(esTecnico ? 'abiertas' : 'mis');
    const [filtros, setFiltros] = useState(FILTROS_VACIOS);
    const [busqueda, setBusqueda] = useState(''); // q con freno de tipeo
    const [lista, setLista] = useState([]);
    const [cargando, setCargando] = useState(false);

    // Buscador: espera a que se deje de tipear.
    useEffect(() => {
        const t = setTimeout(() => setFiltros((f) => (f.q === busqueda ? f : { ...f, q: busqueda })), 300);
        return () => clearTimeout(t);
    }, [busqueda]);

    const parametros = useMemo(() => {
        const p = {};
        const estadoPorDefecto = vista === 'historial' || vista === 'mis' ? 'TODAS' : 'ABIERTAS';
        p.estado = filtros.estado || estadoPorDefecto;
        if (vista === 'mias') p.tecnico = 'yo';
        if (vista === 'mis') p.mias = 1;
        if (filtros.q.trim()) p.q = filtros.q.trim();
        if (filtros.categoria) p.categoria = filtros.categoria;
        if (filtros.prioridad) p.prioridad = filtros.prioridad;
        if (filtros.area) p.area = filtros.area;
        if (filtros.tecnico && vista !== 'mias') p.tecnico = filtros.tecnico;
        if (filtros.desde) p.desde = filtros.desde;
        if (filtros.hasta) p.hasta = filtros.hasta;
        return p;
    }, [vista, filtros]);

    const cargar = useCallback(async () => {
        setCargando(true);
        try { setLista(await servicioTecnicoService.listar(parametros)); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo cargar la lista')); }
        finally { setCargando(false); }
    }, [parametros]);
    useEffect(() => { cargar(); }, [cargar]);
    // Cambio hecho desde esta pantalla (detalle, alta): recargar al toque, con los filtros de ahora.
    const cargarRef = useRef(cargar);
    cargarRef.current = cargar;
    useEffect(() => { if (version) cargarRef.current(); }, [version]);

    // Cambios de otros (socket), con freno.
    const avisar = useRecargaConFreno(() => cargar());
    useEffect(() => {
        socket.on('st:updated', avisar);
        return () => socket.off('st:updated', avisar);
    }, [avisar]);

    // Contadores de la bandeja (solo con la vista de abiertas y sin filtro de estado).
    const contadores = useMemo(() => {
        if (vista !== 'abiertas' || filtros.estado) return null;
        return ['PENDIENTE', 'EN_CURSO', 'EN_ESPERA', 'DERIVADA'].map(k => ({ k, n: lista.filter(s => s.Estado === k).length }));
    }, [vista, filtros.estado, lista]);

    const setFiltro = (c) => setFiltros((f) => ({ ...f, ...c }));
    const hayFiltros = Object.entries(filtros).some(([k, v]) => k !== 'q' && v) || busqueda;

    return (
        <div>
            {/* Vistas */}
            <div className="flex flex-wrap items-center gap-1 mb-3">
                {vistas.map(v => (
                    <button key={v.key} onClick={() => { setVista(v.key); setFiltro({ estado: '' }); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${vista === v.key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-100'}`}>
                        {v.label}
                    </button>
                ))}
                {contadores && (
                    <div className="ml-auto flex flex-wrap gap-1.5">
                        {contadores.map(({ k, n }) => (
                            <button key={k} onClick={() => setFiltro({ estado: k })} className={`${chip} ${estadoInfo(k).chip} hover:opacity-80`}>
                                {estadoInfo(k).label}: {n}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Filtros */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                    <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar: número, máquina, falla, persona…"
                        className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-xl text-sm outline-none focus:border-brand-cyan" />
                </div>
                <select className={sel} value={filtros.estado} onChange={(e) => setFiltro({ estado: e.target.value })}>
                    <option value="">{vista === 'historial' || vista === 'mis' ? 'Todos los estados' : 'Abiertas'}</option>
                    {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    {vista !== 'historial' && vista !== 'mis' && <option value="TODAS">Todas (con finalizadas)</option>}
                </select>
                <select className={sel} value={filtros.categoria} onChange={(e) => setFiltro({ categoria: e.target.value })}>
                    <option value="">Todos los tipos</option>
                    {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.corto}</option>)}
                </select>
                <select className={sel} value={filtros.prioridad} onChange={(e) => setFiltro({ prioridad: e.target.value })}>
                    <option value="">Toda prioridad</option>
                    {PRIORIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <select className={sel} value={filtros.area} onChange={(e) => setFiltro({ area: e.target.value })}>
                    <option value="">Todas las áreas</option>
                    {(meta?.areas || []).map(a => <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>)}
                </select>
                {esTecnico && vista !== 'mias' && (
                    <select className={sel} value={filtros.tecnico} onChange={(e) => setFiltro({ tecnico: e.target.value })}>
                        <option value="">Todos los técnicos</option>
                        {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                    </select>
                )}
                {(vista === 'historial' || vista === 'mis') && (
                    <>
                        <input type="date" className={sel} value={filtros.desde} onChange={(e) => setFiltro({ desde: e.target.value })} title="Desde" />
                        <input type="date" className={sel} value={filtros.hasta} onChange={(e) => setFiltro({ hasta: e.target.value })} title="Hasta" />
                    </>
                )}
                {hayFiltros && (
                    <button onClick={() => { setFiltros(FILTROS_VACIOS); setBusqueda(''); }} className="px-3 py-2 rounded-xl text-xs font-bold text-zinc-400 hover:bg-zinc-100">Limpiar</button>
                )}
                <button onClick={cargar} title="Actualizar" className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-zinc-100">
                    {cargando ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                </button>
            </div>

            {/* Lista */}
            {cargando && lista.length === 0 ? (
                <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div>
            ) : lista.length === 0 ? (
                <div className="py-16 text-center text-zinc-400 text-sm">
                    {hayFiltros ? 'No hay solicitudes con esos filtros.' : vista === 'mis' ? 'No pediste nada a Servicio Técnico todavía.' : 'No hay solicitudes abiertas.'}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {lista.map(s => {
                        const cat = categoriaInfo(s.Categoria);
                        const res = resultadoInfo(s.Resultado);
                        return (
                            <button key={s.SolId} onClick={() => onAbrir(s.SolId)}
                                className="relative w-full text-left bg-white border border-zinc-200 rounded-2xl pl-5 pr-4 py-3 hover:border-brand-cyan/40 hover:shadow-sm transition-all overflow-hidden">
                                <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${s.Estado === 'FINALIZADA' ? 'bg-zinc-200' : barraPrioridad[s.Prioridad] || 'bg-zinc-200'}`} />
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="font-mono font-bold text-zinc-400">{s.Codigo}</span>
                                    <span className={`${chip} ${prioridadInfo(s.Prioridad).chip}`}>{prioridadInfo(s.Prioridad).label}</span>
                                    <span className={`${chip} ${estadoInfo(s.Estado).chip}`}>{estadoInfo(s.Estado).label}</span>
                                    {res && <span className={`${chip} ${res.chip}`}>{res.label}</span>}
                                    {s.MaquinaNoTrabaja && s.Estado !== 'FINALIZADA' && <span className={`${chip} bg-amber-50 text-amber-700 border-amber-200`}>Máquina parada</span>}
                                    <span className="ml-auto text-zinc-400" title={fmtFecha(s.FechaSolicitud)}>{haceCuanto(s.FechaSolicitud)}</span>
                                </div>
                                <div className="mt-1 text-[15px] font-bold text-zinc-800 leading-snug break-words">{s.Titulo}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                                    <span className="inline-flex items-center gap-1"><cat.Icono size={13} />
                                        {s.EquipoNombre || s.EquipoTexto || cat.corto}
                                        {s.EquipoNombre && s.Estado !== 'FINALIZADA' && String(s.EquipoEstado || '').trim().toUpperCase() === 'MANTENIMIENTO' && (
                                            <span className={`${chip} ${estadoEquipo(s.EquipoEstado).chip} ml-1`}>{estadoEquipo(s.EquipoEstado).label}</span>
                                        )}
                                    </span>
                                    {(s.AreaNombre || s.AreaId) && <span>{s.AreaNombre || s.AreaId}</span>}
                                    {s.SolicitanteNombre && <span className="inline-flex items-center gap-1"><User size={12} />{s.SolicitanteNombre}</span>}
                                    {s.TecnicoNombre ? <span className="inline-flex items-center gap-1 text-zinc-600 font-bold"><Hand size={12} />{s.TecnicoNombre}</span>
                                        : s.Estado !== 'FINALIZADA' && <span className="text-zinc-400 italic">Sin tomar</span>}
                                    {s.DerivadaExterno && <span className="text-violet-600">→ {s.DerivadaExterno}</span>}
                                    {s.Adjuntos > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} />{s.Adjuntos}</span>}
                                </div>
                            </button>
                        );
                    })}
                    {lista.length >= 300 && <p className="text-center text-xs text-zinc-400 py-2">Se muestran las primeras 300. Usá el buscador o los filtros para acotar.</p>}
                </div>
            )}
        </div>
    );
};

export default SolicitudesVista;
