import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Search, ChevronDown } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import { btnSec, campoFiltro } from '../servicio-tecnico/ui';
import { Pastilla, Desplegable, fmtD, mensajeError } from './comun';
import { puntaje, fmtPuntaje, coincide, diaDe, dias } from './reglas';

// Archivo (spec-B §5): los proyectos terminados (todas las tareas hechas) y los cancelados, para consultar.
// No cambia nada. Para reabrir: desde la ficha (destildar una tarea o «Reactivar»).

const ORDENES = [['nuevos', 'Más recientes'], ['viejos', 'Más antiguos'], ['nombre', 'Nombre']];
const terminado = (p) => p.estado !== 'CANCELADO' && p.etapaActual === 'TERMINADO';
// Fecha de fin: la guardada (terminado o cancelado); si no hay, la última tarea hecha o la última actualización
const finDe = (p) => diaDe(p.estado === 'CANCELADO' ? (p.fechaCancelado || p.actualizado)
    : (p.fechaTerminado || (p.tareas || []).map(t => t.hechoEl).filter(Boolean).sort().pop() || p.actualizado));
const inicioDe = (p) => p.fechaInicio || diaDe(p.creado);

const Item = ({ p, abierto, onAlternar, lineas, navigate }) => {
    const fin = finDe(p);
    const ini = inicioDe(p);
    const duracion = terminado(p) && fin && ini ? Math.max(0, dias(ini, fin)) : null;
    const hechas = (p.tareas || []).filter(t => t.estado === 'HECHO').length;
    const aplican = (p.tareas || []).filter(t => t.estado !== 'NO_APLICA').length;
    const [verTareas, setVerTareas] = useState(false);
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            <button type="button" onClick={onAlternar} className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 p-3 sm:p-4 text-left hover:bg-zinc-50">
                <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-bold text-zinc-800">{p.nombre || 'Sin nombre'}</p>
                    <p className="text-xs text-zinc-500">
                        {p.codigo}{(p.articuloCodigo || p.refErpTexto) && ` · ${p.articuloCodigo || p.refErpTexto}`}{p.familia && ` · ${p.familia}`}
                        {p.lineaAreaId && ` · ${lineas.find(l => l.areaId === p.lineaAreaId)?.nombre || p.lineaAreaId}`}
                    </p>
                </div>
                <p className="text-xs text-zinc-500">{p.lider || 'sin responsable'}{duracion !== null && ` · ${duracion} ${duracion === 1 ? 'día' : 'días'} de desarrollo`}</p>
                <Pastilla tono={terminado(p) ? 'listo' : 'neutro'}>{terminado(p) ? 'Terminado' : 'Cancelado'} · {fmtD(fin)}</Pastilla>
                <ChevronDown size={16} className={`text-zinc-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
            </button>
            <Desplegable abierto={abierto}>
                <div className="border-t border-zinc-100 p-4 flex flex-col gap-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                        {[['Inicio', fmtD(ini) || '—'], [terminado(p) ? 'Terminado' : 'Cancelado', fmtD(fin) || '—'], ['Muestras', p.muestras],
                            ['Etiqueta', p.etiqueta || '—'], ['Puntaje', fmtPuntaje(puntaje(p))], ['Variantes', p.variantes]].map(([t, v]) => (
                            <div key={t}><span className="block text-[10px] font-black uppercase tracking-wide text-zinc-400">{t}</span><span className="text-zinc-800">{v}</span></div>
                        ))}
                    </div>
                    {p.notas && <p className="whitespace-pre-wrap text-sm text-zinc-700">{p.notas}</p>}
                    <div className="text-sm">
                        <button type="button" onClick={() => setVerTareas(v => !v)} className="inline-flex items-center gap-1 font-bold text-zinc-500 hover:text-zinc-700">
                            <ChevronDown size={14} className={`transition-transform duration-200 ${verTareas ? '' : '-rotate-90'}`} /> Tareas ({hechas} hechas de {aplican})
                        </button>
                        <Desplegable abierto={verTareas}>
                        <div className="pt-2 flex flex-col gap-0.5">
                            {(p.tareas || []).map(t => (
                                <p key={t.id} className="text-zinc-600">
                                    {t.estado === 'HECHO' ? '✓' : t.estado === 'NO_APLICA' ? '–' : '○'} {p.etapas.find(e => e.id === t.etapaId)?.nombre} · {t.nombre}
                                    {t.responsable && ` · ${t.responsable}`}{t.hechoEl && ` · ${fmtD(diaDe(t.hechoEl))}`}
                                </p>
                            ))}
                        </div>
                        </Desplegable>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${p.id}`)} className={btnSec}>Abrir la ficha completa</button>
                        {p.muestras > 0 && <button type="button" onClick={() => navigate(`/desarrollos/muestras?proyecto=${p.id}`)} className={btnSec}>Ver sus muestras</button>}
                    </div>
                </div>
            </Desplegable>
        </div>
    );
};

const ArchivoVista = ({ catalogos, version }) => {
    const navigate = useNavigate();
    const [lista, setLista] = useState(null);
    const [chip, setChip] = useState('terminados');
    const [q, setQ] = useState('');
    const [familia, setFamilia] = useState('');
    const [orden, setOrden] = useState('nuevos');
    const [abierto, setAbierto] = useState(null);
    const cargar = useCallback(async () => {
        try { setLista(await desarrollosService.proyectos()); }
        catch (e) { setLista([]); toast.error(mensajeError(e, 'No se pudo cargar el Archivo.')); }
    }, []);
    useEffect(() => { cargar(); }, [cargar, version]);

    const terminados = useMemo(() => (lista || []).filter(terminado), [lista]);
    const cancelados = useMemo(() => (lista || []).filter(p => p.estado === 'CANCELADO'), [lista]);
    const familias = useMemo(() => [...new Set([...terminados, ...cancelados].map(p => p.familia).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [terminados, cancelados]);
    const visibles = useMemo(() => {
        const l = (chip === 'terminados' ? terminados : cancelados).filter(p =>
            coincide(q, p.nombre, p.codigo, p.articuloCodigo, p.refErpTexto, p.lider, p.familia, p.etiqueta, p.notas) && (!familia || p.familia === familia));
        if (orden === 'nombre') return l.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
        return l.sort((a, b) => (orden === 'viejos' ? 1 : -1) * String(finDe(a)).localeCompare(String(finDe(b))));
    }, [chip, terminados, cancelados, q, familia, orden]);

    const vacio = chip === 'cancelados'
        ? (cancelados.length ? 'Ningún cancelado coincide.' : 'No hay proyectos cancelados.')
        : (terminados.length ? 'Ningún terminado coincide.' : 'Todavía no hay proyectos terminados. Un proyecto pasa acá cuando se completan todas sus tareas.');
    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-zinc-500">Proyectos con todas las tareas hechas. Salen de las listas de trabajo y quedan acá para consultar.</p>
            <div className="flex flex-wrap items-center gap-2">
                {[['terminados', 'Terminados', terminados.length], ['cancelados', 'Cancelados', cancelados.length]].map(([k, l, n]) => (
                    <button key={k} type="button" onClick={() => { setChip(k); setAbierto(null); }}
                        className={`px-3 py-1.5 rounded-full border text-xs font-bold ${chip === k ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-zinc-200 bg-white text-zinc-600'}`}>
                        {l} <span className={chip === k ? 'text-white/80' : 'text-zinc-400'}>{n}</span>
                    </button>
                ))}
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input type="search" className={`${campoFiltro} w-full pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, código, artículo, familia o detalle" />
                </div>
                <Selector filtro value={familia} onChange={(e) => setFamilia(e.target.value)} aria-label="Familia" renderValor={o => `Familia: ${o?.texto || 'Todas'}`}>
                    <option value="">Todas</option>
                    {familias.map(f => <option key={f} value={f}>{f}</option>)}
                </Selector>
                <Selector filtro resaltar={false} value={orden} onChange={(e) => setOrden(e.target.value)} aria-label="Ordenar">
                    {ORDENES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Selector>
            </div>
            {lista === null ? <Loader2 size={20} className="animate-spin text-zinc-300" />
                : !visibles.length ? <p className="text-sm text-zinc-400">{vacio}</p>
                : <div className="flex flex-col gap-2">{visibles.map(p => (
                    <Item key={p.id} p={p} abierto={abierto === p.id} onAlternar={() => setAbierto(a => (a === p.id ? null : p.id))} lineas={catalogos?.lineas || []} navigate={navigate} />
                ))}</div>}
        </div>
    );
};

export default ArchivoVista;
