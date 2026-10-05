import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Search, Paperclip, User, Hand, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import {
    CATEGORIAS, PRIORIDADES, ESTADOS, RESULTADOS, categoria as categoriaInfo, prioridad as prioridadInfo, estado as estadoInfo,
    resultado as resultadoInfo, estadoEquipo, fmtFecha, haceCuanto, mensajeError,
} from './constantes';
import { chip, campoFiltro, btnPri, btnCancelar, PanelInferior } from './ui';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

// Bandeja / historial de solicitudes con buscador y filtros.
// Técnicos: Abiertas · Tomadas por mí · Historial. Resto: Mis solicitudes · Abiertas.
// Abiertas y Tomadas por mí nunca muestran las finalizadas; el Historial muestra solo las finalizadas
// (se filtra por resultado). Mis solicitudes (quien pide) muestra todas.
const VISTAS_TECNICO = [
    { key: 'abiertas', label: 'Abiertas' },
    { key: 'mias', label: 'Tomadas por mí' },
    { key: 'historial', label: 'Historial' },
];
const VISTAS_USUARIO = [
    { key: 'mis', label: 'Mis solicitudes' },
    { key: 'abiertas', label: 'Abiertas' },
];
const FILTROS_VACIOS = { q: '', categoria: '', prioridad: '', estado: '', resultado: '', tecnico: '', area: '', desde: '', hasta: '' };
const ESTADOS_ABIERTOS = Object.entries(ESTADOS).filter(([k]) => k !== 'FINALIZADA');
const barraPrioridad = { BAJA: 'bg-emerald-400', MEDIA: 'bg-amber-400', ALTA: 'bg-orange-500', CRITICA: 'bg-red-600' };

const SolicitudesVista = ({ meta, onAbrir, version = 0 }) => {
    // El encargado ve la bandeja de los técnicos aunque no sea del área: es quien asigna (02/10).
    const esTecnico = !!(meta?.esTecnico || meta?.esEncargado);
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
        if (vista === 'historial') {
            p.estado = 'FINALIZADA';
            if (filtros.resultado) p.resultado = filtros.resultado;
        } else p.estado = filtros.estado || (vista === 'mis' ? 'TODAS' : 'ABIERTAS');
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
    // Filtros activos sin contar el buscador: el número del botón "Filtros" en celular.
    const nFiltros = Object.entries(filtros).filter(([k, v]) => k !== 'q' && v).length;
    const [panelFiltros, setPanelFiltros] = useState(false);

    // Los desplegables de filtro: en la fila (desde sm) o en el panel de celular (enPanel).
    const controles = (enPanel) => {
        const ancho = enPanel ? 'w-full' : '';
        return (<>
            {vista === 'historial' ? (
                <Selector filtro className={ancho} value={filtros.resultado} onChange={(e) => setFiltro({ resultado: e.target.value })}>
                    <option value="">Todos los resultados</option>
                    {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Selector>
            ) : (
                <Selector filtro className={ancho} value={filtros.estado} onChange={(e) => setFiltro({ estado: e.target.value })}>
                    <option value="">{vista === 'mis' ? 'Todos los estados' : 'Abiertas'}</option>
                    {(vista === 'mis' ? Object.entries(ESTADOS) : ESTADOS_ABIERTOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Selector>
            )}
            <Selector filtro className={ancho} value={filtros.categoria} onChange={(e) => setFiltro({ categoria: e.target.value })}>
                <option value="">Todos los tipos</option>
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.corto}</option>)}
            </Selector>
            <Selector filtro className={ancho} value={filtros.prioridad} onChange={(e) => setFiltro({ prioridad: e.target.value })}>
                <option value="">Toda prioridad</option>
                {PRIORIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Selector>
            <Selector filtro className={ancho} value={filtros.area} onChange={(e) => setFiltro({ area: e.target.value })}>
                <option value="">Todas las áreas</option>
                {(meta?.areas || []).map(a => <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>)}
            </Selector>
            {esTecnico && vista !== 'mias' && (
                <Selector filtro className={ancho} value={filtros.tecnico} onChange={(e) => setFiltro({ tecnico: e.target.value })}>
                    <option value="">Todos los técnicos</option>
                    {(meta?.tecnicos || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </Selector>
            )}
            {(vista === 'historial' || vista === 'mis') && (enPanel ? (
                <div className="grid grid-cols-2 gap-2">
                    {[['desde', 'Desde'], ['hasta', 'Hasta']].map(([k, t]) => (
                        <label key={k} className="block min-w-0">
                            <span className="block mb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{t}</span>
                            <SelectorFecha filtro vaciable className="w-full" placeholder={t} value={filtros[k]}
                                min={k === 'hasta' ? filtros.desde || undefined : undefined} max={k === 'desde' ? filtros.hasta || undefined : undefined}
                                onChange={(e) => setFiltro({ [k]: e.target.value })} />
                        </label>
                    ))}
                </div>
            ) : (<>
                <SelectorFecha filtro vaciable placeholder="Desde" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => setFiltro({ desde: e.target.value })} />
                <SelectorFecha filtro vaciable placeholder="Hasta" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => setFiltro({ hasta: e.target.value })} />
            </>))}
        </>);
    };

    return (
        <div>
            {/* Vistas y contadores. En celular cada fila se reparte todo el ancho; desde sm, vistas a la
                izquierda y contadores a la derecha. */}
            <div className="flex flex-wrap items-center gap-1 mb-3">
                {vistas.map(v => (
                    <button key={v.key} onClick={() => { setVista(v.key); setFiltro({ estado: '', resultado: '' }); }}
                        className={`flex-1 sm:flex-none whitespace-nowrap text-center px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${vista === v.key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-100'}`}>
                        {v.label}
                    </button>
                ))}
                {contadores && (
                    <div className="w-full sm:w-auto sm:ml-auto flex gap-1.5">
                        {contadores.map(({ k, n }) => (
                            <button key={k} onClick={() => setFiltro({ estado: k })} className={`${chip} ${estadoInfo(k).chip} hover:opacity-80 flex-1 sm:flex-none text-center`}>
                                {estadoInfo(k).label}: {n}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Filtros. Desde sm, todo en una fila que se acomoda. En celular, el buscador con un botón
                "Filtros" (con cuántos hay activos) que abre los desplegables en un panel desde abajo. */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-0 sm:min-w-[220px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                    <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar: número, máquina, falla, persona…"
                        className={`${campoFiltro} w-full pl-9`} />
                </div>
                <button type="button" onClick={() => setPanelFiltros(true)} title="Filtros" aria-label={nFiltros ? `Filtros (${nFiltros})` : 'Filtros'}
                    className={`sm:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm leading-5 shrink-0 transition-colors ${nFiltros ? 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-600'}`}>
                    <SlidersHorizontal size={16} />
                    {nFiltros > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-brand-cyan text-white text-[11px] font-bold inline-flex items-center justify-center">{nFiltros}</span>}
                </button>
                <div className="hidden sm:contents">
                    {controles(false)}
                    {hayFiltros && (
                        <button onClick={() => { setFiltros(FILTROS_VACIOS); setBusqueda(''); }} className="px-3 py-2 rounded-xl text-xs font-bold text-zinc-400 hover:bg-zinc-100">Limpiar</button>
                    )}
                </div>
                <button onClick={cargar} title="Actualizar" className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-zinc-100 shrink-0">
                    {cargando ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                </button>
            </div>
            {panelFiltros && (
                <PanelInferior titulo="Filtros" onCerrar={() => setPanelFiltros(false)} pie={<>
                    <button onClick={() => setFiltros((f) => ({ ...FILTROS_VACIOS, q: f.q }))} disabled={!nFiltros} className={btnCancelar}>Limpiar</button>
                    <button onClick={() => setPanelFiltros(false)} className={btnPri}>Listo</button>
                </>}>
                    {controles(true)}
                </PanelInferior>
            )}

            {/* Lista */}
            {cargando && lista.length === 0 ? (
                <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div>
            ) : lista.length === 0 ? (
                <div className="py-16 text-center text-zinc-400 text-sm">
                    {hayFiltros ? 'No hay solicitudes con esos filtros.'
                        : vista === 'mis' ? 'No pediste nada a Servicio Técnico todavía.'
                        : vista === 'historial' ? 'Todavía no hay solicitudes finalizadas.'
                        : vista === 'mias' ? 'No tenés solicitudes abiertas a tu nombre.'
                        : 'No hay solicitudes abiertas.'}
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
