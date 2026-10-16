import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Plus, Search } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import { MiniModal, btnPri, btnCancelar, input, label, campoFiltro } from '../servicio-tecnico/ui';
import { fmtD, mensajeError } from './comun';
import { useEquipo } from './tareas';
import ProyectoFicha from './ProyectoFicha';
import { puntaje, recProyecto, coincide, hoy, nombreEtapaActual, colorEtapaActual } from './reglas';

// Proyectos (spec-B §3.1): los desarrollos en curso (los terminados están en Archivo) y la ficha de cada
// uno (?abrir=ID). Filtros, órdenes y textos del prototipo.

const CHIPS_ESTADO = [
    ['activos', 'En curso', p => p.estado !== 'CANCELADO'],
    ['pausa', 'En pausa', p => p.estado === 'PAUSADO'],
    ['cancelados', 'Cancelados', p => p.estado === 'CANCELADO'],
];
const ORDENES = [
    ['rec', 'Recomendado para atender'], ['puntaje', 'Mayor puntaje'], ['nuevos', 'Más nuevos'], ['viejos', 'Más viejos'],
    ['limite', 'Fecha límite más cercana'], ['avance', 'Más avanzados'], ['nombre', 'Nombre'],
];
const creadoMs = (p) => new Date(p.creado || 0).getTime();
const ordenar = (lista, orden) => {
    const l = [...lista];
    if (orden === 'puntaje') return l.sort((a, b) => puntaje(b) - puntaje(a));
    if (orden === 'nuevos') return l.sort((a, b) => creadoMs(b) - creadoMs(a));
    if (orden === 'viejos') return l.sort((a, b) => creadoMs(a) - creadoMs(b));
    if (orden === 'limite') return l.sort((a, b) => (a.fechaLimite || '9999').localeCompare(b.fechaLimite || '9999'));
    if (orden === 'avance') return l.sort((a, b) => b.avance.pct - a.avance.pct);
    if (orden === 'nombre') return l.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
    return l.sort((a, b) => recProyecto(b) - recProyecto(a) || creadoMs(b) - creadoMs(a));
};
// Clave de la etapa actual (para los chips de las cinco etapas de siempre); null si es propia
const claveEtapa = (p) => p.etapas.find(e => e.id === p.etapaActual)?.clave ?? null;

const NuevoProyecto = ({ sesion, catalogos, onCreado, onCerrar }) => {
    const equipo = useEquipo();
    const plantillas = (catalogos?.plantillas || []).filter(x => x.para !== 'VARIANTE');
    const [d, setD] = useState({ nombre: '', plantillaId: String(plantillas.find(x => x.clave === 'prenda')?.id || plantillas[0]?.id || ''), lineaAreaId: '', liderId: String(sesion?.usuario?.id || ''), fechaInicio: hoy() });
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const pl = plantillas.find(x => String(x.id) === d.plantillaId);
    const crear = async () => {
        if (!d.nombre.trim()) { setError('Poné un nombre.'); return; }
        setGuardando(true);
        try {
            const p = await desarrollosService.crearProyecto({ nombre: d.nombre.trim(), plantillaId: Number(d.plantillaId), lineaAreaId: d.lineaAreaId || null, liderId: Number(d.liderId) || null, fechaInicio: d.fechaInicio || null });
            onCreado(p);
        } catch (e) { setError(mensajeError(e, 'No se pudo crear.')); setGuardando(false); }
    };
    const cambiar = (k, v) => { setD(x => ({ ...x, [k]: v })); setError(''); };
    const opcionesLider = [...equipo];
    if (sesion?.usuario?.id && !equipo.some(m => m.usuarioId === sesion.usuario.id)) opcionesLider.unshift({ usuarioId: sesion.usuario.id, nombre: sesion.usuario.nombre });
    return (
        <MiniModal titulo="Nuevo proyecto" onCerrar={onCerrar} pie={<>
            <button type="button" onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button type="button" onClick={crear} disabled={guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />} Crear</button>
        </>}>
            <div><span className={label}>Nombre</span><input className={input} value={d.nombre} maxLength={120} autoFocus onChange={(e) => cambiar('nombre', e.target.value)} /></div>
            <div>
                <span className={label}>Plantilla</span>
                <Selector value={d.plantillaId} onChange={(e) => cambiar('plantillaId', e.target.value)} aria-label="Plantilla" anchoLista={340}>
                    {plantillas.map(x => <option key={x.id} value={String(x.id)}>{x.nombre}</option>)}
                </Selector>
                {pl && <p className="mt-1 text-xs text-zinc-500">{pl.descripcion} {pl.tareas} pasos en {pl.etapas} etapas, unos {pl.dias} días hábiles en total. Después se pueden agregar, quitar o mover pasos.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <span className={label}>Línea</span>
                    <Selector value={d.lineaAreaId} onChange={(e) => cambiar('lineaAreaId', e.target.value)} aria-label="Línea">
                        <option value="">Sin línea</option>
                        {(catalogos?.lineas || []).map(l => <option key={l.areaId} value={l.areaId}>{l.nombre}</option>)}
                    </Selector>
                </div>
                <div>
                    <span className={label}>Responsable</span>
                    <Selector value={d.liderId} onChange={(e) => cambiar('liderId', e.target.value)} aria-label="Responsable" anchoLista={240}>
                        {opcionesLider.map(m => <option key={m.usuarioId} value={String(m.usuarioId)}>{m.nombre}</option>)}
                    </Selector>
                </div>
                <div><span className={label}>Inicio</span><SelectorFecha value={d.fechaInicio} onChange={(e) => cambiar('fechaInicio', e.target.value)} className="w-full" /></div>
            </div>
            {error && <p className="text-sm font-bold text-brand-magenta">{error}</p>}
        </MiniModal>
    );
};

const Tarjeta = ({ p, tipos, lineas, onAbrir }) => {
    const tipo = tipos.find(t => t.id === p.tipoId);
    const h = hoy();
    return (
        <button type="button" onClick={() => onAbrir(p.id)}
            className="w-full text-left rounded-2xl border border-zinc-200 bg-white p-3 sm:p-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)] hover:border-brand-cyan/40"
            style={{ borderLeft: `5px solid ${colorEtapaActual(p)}` }}>
            <div className="min-w-0">
                <p className="text-sm sm:text-base font-bold text-zinc-800">{p.nombre || 'Sin nombre'}</p>
                <p className="text-xs text-zinc-500">
                    {p.codigo}{(p.articuloCodigo || p.refErpTexto) && ` · ${p.articuloCodigo || p.refErpTexto}`}
                    {tipo && !tipo.esProducto && <> · <span className="px-1.5 rounded bg-zinc-100 text-zinc-600">{tipo.nombre}</span></>}
                    {p.lineaAreaId && ` · ${lineas.find(l => l.areaId === p.lineaAreaId)?.nombre || p.lineaAreaId}`}
                    {` · ${p.lider || 'sin responsable'}`}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                    {p.atrasadas > 0 && <span className="px-1.5 rounded bg-brand-magenta/10 text-[11px] font-bold text-brand-magenta">{p.atrasadas} {p.atrasadas === 1 ? 'atrasada' : 'atrasadas'}</span>}
                    {p.tandas.map(t => <span key={t.id} className="px-1.5 rounded bg-brand-cyan/10 text-[11px] font-bold text-brand-cyan">{t.nombre}</span>)}
                    {p.estado === 'PAUSADO' && <span className="px-1.5 rounded bg-amber-50 text-[11px] font-bold text-amber-700">En pausa</span>}
                    {p.estado === 'CANCELADO' && <span className="px-1.5 rounded bg-zinc-100 text-[11px] font-bold text-zinc-500">Cancelado</span>}
                </div>
            </div>
            <p className="text-xs text-zinc-600 self-center">
                {p.tareaActual ? (<>
                    <span className="text-zinc-400">Ahora: </span>{p.tareaActual.nombre}
                    {p.tareaActual.responsable && ` · ${p.tareaActual.responsable}`}
                    {p.tareaActual.fecha && <span className={p.tareaActual.fecha < h ? 'text-brand-magenta font-bold' : ''}>{` · ${fmtD(p.tareaActual.fecha)}`}</span>}
                </>) : '—'}
            </p>
            <div className="self-center">
                <p className="text-xs text-zinc-600">{nombreEtapaActual(p)} · {p.avance.h}/{p.avance.t}</p>
                <div className="mt-1 h-1.5 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p.avance.pct}%`, background: colorEtapaActual(p) }} /></div>
            </div>
        </button>
    );
};

const ProyectosVista = ({ sesion, catalogos, version }) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const abierto = Number(searchParams.get('abrir')) || null;
    const [lista, setLista] = useState(null);
    const [chip, setChip] = useState('activos');
    const [q, setQ] = useState('');
    const [resp, setResp] = useState('');
    const [des, setDes] = useState('');
    const [linea, setLinea] = useState('');
    const [etapa, setEtapa] = useState('');
    const [orden, setOrden] = useState('rec');
    const [nuevo, setNuevo] = useState(false);
    const tipos = catalogos?.tipos || [];
    const lineas = catalogos?.lineas || [];
    const etapasFabrica = catalogos?.etapasFabrica || [];

    const cargar = useCallback(async () => {
        try { setLista(await desarrollosService.proyectos()); }
        catch (e) { setLista([]); toast.error(mensajeError(e, 'No se pudieron cargar los proyectos.')); }
    }, []);
    useEffect(() => { cargar(); }, [cargar, version]);

    const abrir = (id) => { const sp = new URLSearchParams(searchParams); sp.set('abrir', id); setSearchParams(sp); window.scrollTo({ top: 0 }); };
    const cerrar = () => { const sp = new URLSearchParams(searchParams); sp.delete('abrir'); setSearchParams(sp); };
    // Un cambio en la ficha actualiza la lista sin esperar el socket
    const alCambiar = (p) => setLista(l => (l ? (p.borrado ? l.filter(x => x.id !== p.id) : l.map(x => (x.id === p.id ? p : x))) : l));

    const universo = useMemo(() => (lista || []).filter(p => p.etapaActual !== 'TERMINADO'), [lista]);
    const responsables = useMemo(() => [...new Set(universo.map(p => p.lider).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [universo]);
    const base = useMemo(() => universo.filter(p =>
        CHIPS_ESTADO.find(c => c[0] === chip)[2](p)
        && coincide(q, p.nombre, p.codigo, p.articuloCodigo, p.refErpTexto, p.lider, p.familia, p.etiqueta, p.notas)
        && (!resp || p.lider === resp)
        && (!des || p.tipoId === Number(des))
        && (!linea || p.lineaAreaId === linea)), [universo, chip, q, resp, des, linea]);
    const propia = (p) => p.etapaActual !== 'CANCELADO' && claveEtapa(p) === null;
    const visibles = useMemo(() => ordenar(base.filter(p => !etapa || (etapa === '__otras' ? propia(p) : claveEtapa(p) === etapa)), orden), [base, etapa, orden]);

    if (abierto) {
        return <ProyectoFicha id={abierto} sesion={sesion} catalogos={catalogos} version={version} onVolver={cerrar} onCambio={alCambiar} />;
    }
    const enCurso = universo.filter(p => p.estado !== 'CANCELADO').length;
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-brand-cyan/10 text-sm font-black text-brand-cyan">{enCurso} en curso</span>
                <div className="flex-1" />
                {sesion?.esEditor && <button type="button" onClick={() => setNuevo(true)} className={btnPri}><Plus size={15} /> Nuevo proyecto</button>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                {CHIPS_ESTADO.map(([k, l, f]) => (
                    <button key={k} type="button" onClick={() => setChip(k)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-bold ${chip === k ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`}>
                        {l} <span className={chip === k ? 'text-white/80' : 'text-zinc-400'}>{universo.filter(f).length}</span>
                    </button>
                ))}
                <span className="text-xs text-zinc-400">Los terminados están en «Archivo».</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input type="search" className={`${campoFiltro} w-full pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, código, artículo, responsable o detalle" />
                </div>
                <Selector filtro value={resp} onChange={(e) => setResp(e.target.value)} aria-label="Responsable" renderValor={o => `Responsable: ${o?.texto || 'Todos'}`}>
                    <option value="">Todos</option>
                    {responsables.map(r => <option key={r} value={r}>{r}</option>)}
                </Selector>
                <Selector filtro value={des} onChange={(e) => setDes(e.target.value)} aria-label="Desarrollo" renderValor={o => `Desarrollo: ${o?.texto || 'Todos'}`}>
                    <option value="">Todos</option>
                    {tipos.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
                </Selector>
                <Selector filtro value={linea} onChange={(e) => setLinea(e.target.value)} aria-label="Línea" renderValor={o => `Línea: ${o?.texto || 'Todas'}`}>
                    <option value="">Todas</option>
                    {lineas.map(l => <option key={l.areaId} value={l.areaId}>{l.nombre}</option>)}
                </Selector>
                <Selector filtro resaltar={false} value={orden} onChange={(e) => setOrden(e.target.value)} aria-label="Ordenar" anchoLista={240}>
                    {ORDENES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Selector>
            </div>
            <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setEtapa('')} className={`px-3 py-1.5 rounded-full border text-xs font-bold ${!etapa ? 'border-zinc-700 bg-zinc-700 text-white' : 'border-zinc-200 bg-white text-zinc-600'}`}>
                    Todas las etapas <span className="opacity-70">{base.length}</span>
                </button>
                {etapasFabrica.map(e => (
                    <button key={e.clave} type="button" onClick={() => setEtapa(e.clave)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${etapa === e.clave ? 'border-zinc-700 bg-zinc-700 text-white' : 'border-zinc-200 bg-white text-zinc-600'}`}>
                        <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />{e.nombre} <span className="opacity-70">{base.filter(p => claveEtapa(p) === e.clave).length}</span>
                    </button>
                ))}
                {base.some(propia) && (
                    <button type="button" onClick={() => setEtapa('__otras')} className={`px-3 py-1.5 rounded-full border text-xs font-bold ${etapa === '__otras' ? 'border-zinc-700 bg-zinc-700 text-white' : 'border-zinc-200 bg-white text-zinc-600'}`}>
                        Con etapas propias <span className="opacity-70">{base.filter(propia).length}</span>
                    </button>
                )}
            </div>
            {lista === null ? <Loader2 size={20} className="animate-spin text-zinc-300" />
                : !visibles.length ? <p className="text-sm text-zinc-400">{(lista || []).length ? 'Ningún proyecto coincide con el filtro.' : 'Todavía no hay proyectos. Se crean al aprobar un pedido en la Bandeja.'}</p>
                : <div className="flex flex-col gap-2">{visibles.map(p => <Tarjeta key={p.id} p={p} tipos={tipos} lineas={lineas} onAbrir={abrir} />)}</div>}
            {nuevo && <NuevoProyecto sesion={sesion} catalogos={catalogos} onCerrar={() => setNuevo(false)}
                onCreado={(p) => { setNuevo(false); setLista(l => [...(l || []), p]); abrir(p.id); }} />}
        </div>
    );
};

export default ProyectosVista;
