import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Search, X } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import { btnPri, btnSec, btnCancelar, campoFiltro } from '../servicio-tecnico/ui';
import { Desplegable, fmtD, mensajeError } from './comun';
import { FilaTarea, useEquipo } from './tareas';
import { ESTADOS_TAREA, etiquetaEstadoTarea, estadoVisible, bloqueos, fechasSugeridas, coincide, hoy, diaDe, tandaActual } from './reglas';

// Tareas (spec-C §2): el trabajo del día. Por defecto solo lo planificado (tareas en una tanda abierta);
// el resto está "dormido" y se ve con «Todas». Lista agrupada o tablero por estado.

const EST = [
    ['PENDIENTE', 'Pendiente', 'bg-zinc-400'], ['EN_CURSO', 'En curso', 'bg-brand-cyan'], ['EN_ESPERA', 'En espera', 'bg-amber-400'],
    ['BLOQUEADA', 'Bloqueada', 'bg-brand-magenta'], ['HECHO', 'Hechas (14 días)', 'bg-emerald-500'],
];
const ALCANCES = [['tandas', 'Planificadas (en una tanda)'], ['actuales', 'La tarea actual de cada proyecto'], ['todas', 'Todas, también las dormidas']];
const GRUPOS = [['resp', 'Responsable'], ['proyecto', 'Proyecto'], ['etapa', 'Etapa'], ['semana', 'Semana'], ['estado', 'Estado'], ['', 'Sin agrupar']];
const lunesDe = (iso) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const TareasVista = ({ sesion, catalogos, version }) => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const equipo = useEquipo();
    const [lista, setLista] = useState(null);
    const [alcance, setAlcance] = useState('tandas');
    const [tanda, setTanda] = useState(Number(searchParams.get('tanda')) || null);
    const proy = Number(searchParams.get('proyecto')) || null;
    const [des, setDes] = useState('');
    const [resp, setResp] = useState(searchParams.get('resp') || '');
    const [q, setQ] = useState('');
    const [est, setEst] = useState('');
    const [modo, setModo] = useState('lista');
    const [agrupar, setAgrupar] = useState('resp');
    const [confirmando, setConfirmando] = useState(false);
    const edita = !!sesion?.esEditor;
    const tipos = catalogos?.tipos || [];

    const [tandas, setTandas] = useState([]);
    const cargar = useCallback(async () => {
        try { setLista(await desarrollosService.proyectos()); }
        catch (e) { setLista([]); toast.error(mensajeError(e, 'No se pudieron cargar las tareas.')); }
        desarrollosService.planificacion().then(d => setTandas(d.tandas)).catch(() => {});
    }, []);
    useEffect(() => { cargar(); }, [cargar, version]);
    // «+ tanda»: suma una tarea dormida a la tanda actual
    const actualT = tandaActual(tandas);
    const sumarATanda = async (t) => {
        try { const r = await desarrollosService.tareaATanda(t.id); toast.success(r.mensaje || 'Tarea sumada.'); cargar(); }
        catch (e) { toast.error(mensajeError(e)); }
    };
    const actualizar = (p) => setLista(l => (l || []).map(x => (x.id === p.id ? { ...x, ...p } : x)));

    // Todas las tareas de proyectos no cancelados, con su estado visible y su fecha (la sugerida si no tiene)
    const items = useMemo(() => {
        const h = hoy();
        const limiteHechas = (() => { const d = new Date(`${h}T12:00`); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10); })();
        const out = [];
        for (const p of lista || []) {
            if (p.estado === 'CANCELADO') continue;
            const sug = fechasSugeridas(p);
            for (const t of p.tareas || []) {
                if (t.estado === 'NO_APLICA') continue;
                const ev = estadoVisible(t, p.tareas);
                if (ev === 'HECHO') { const f = diaDe(t.hechoEl) || t.fecha; if (!f || f < limiteHechas) continue; }
                out.push({ p, t, est: ev, fecha: t.fecha || (ev !== 'HECHO' ? sug[t.id] : null), sugerida: sug[t.id], esSug: !t.fecha && ev !== 'HECHO', actual: p.tareaActual?.id === t.id || t.estado === 'EN_CURSO' });
            }
        }
        return out;
    }, [lista]);
    const tandasAbiertas = useMemo(() => {
        const m = new Map();
        for (const w of items) if (w.t.tanda) m.set(w.t.tanda.id, w.t.tanda.nombre);
        return [...m].map(([id, nombre]) => ({ id, nombre }));
    }, [items]);
    const yo = sesion?.usuario?.id;
    const nombres = useMemo(() => [...new Set(items.map(w => w.t.responsable).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [items]);

    // Filtros en el orden del prototipo; el chip de estado va aparte (los contadores son de antes del chip)
    const filtradas = useMemo(() => items.filter(w => {
        if (proy) { if (w.p.id !== proy) return false; }
        else if (tanda) { if (w.t.tanda?.id !== tanda) return false; }
        else if (alcance === 'tandas' && !w.t.tanda) return false;
        else if (alcance === 'actuales' && !(w.actual || w.est === 'HECHO')) return false;
        if (des && w.p.tipoId !== Number(des)) return false;
        if (resp === '__yo' && w.t.responsableId !== yo) return false;
        if (resp === '__nadie' && w.t.responsable) return false;
        if (resp && !resp.startsWith('__') && w.t.responsable !== resp) return false;
        return coincide(q, w.t.nombre, w.p.nombre, w.p.codigo, w.t.responsable);
    }), [items, proy, tanda, alcance, des, resp, yo, q]);
    const vis = filtradas.filter(w => (est ? w.est === est : w.est !== 'HECHO'));
    const porFecha = (a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999');
    const sinTerminar = filtradas.filter(w => w.est !== 'HECHO').length;
    const aConfirmar = vis.filter(w => w.esSug && w.sugerida);

    const confirmarFechas = async () => {
        try {
            const r = await desarrollosService.confirmarFechas(aConfirmar.map(w => ({ tareaId: w.t.id, fecha: w.sugerida })));
            toast.success(`Fechas confirmadas en ${r.confirmadas} ${r.confirmadas === 1 ? 'tarea' : 'tareas'}.`);
            setConfirmando(false);
            cargar();
        } catch (e) { toast.error(mensajeError(e)); }
    };
    const quitarParam = (k) => { const sp = new URLSearchParams(searchParams); sp.delete(k); setSearchParams(sp); };
    const fila = (w) => (
        <FilaTarea key={w.t.id} p={w.p} t={w.t} equipo={equipo} edita={edita} esProducto={!!tipos.find(x => x.id === w.p.tipoId)?.esProducto}
            sugerida={w.sugerida} conProyecto onActualizado={actualizar} onAbrirProyecto={(id) => navigate(`/desarrollos/proyectos?abrir=${id}`)}
            tandaActual={actualT} onSumarATanda={sumarATanda} />
    );

    // Lista agrupada
    const grupos = useMemo(() => {
        if (!agrupar) return [['', [...vis].sort((a, b) => (b.actual - a.actual) || porFecha(a, b))]];
        const clave = (w) => agrupar === 'resp' ? (w.t.responsable || 'Sin responsable')
            : agrupar === 'proyecto' ? w.p.nombre
            : agrupar === 'etapa' ? (w.p.etapas.find(e => e.id === w.t.etapaId)?.nombre || '—')
            : agrupar === 'semana' ? (w.fecha ? `Semana del ${fmtD(lunesDe(w.fecha))}` : 'Sin fecha')
            : etiquetaEstadoTarea(w.est);
        const m = new Map();
        for (const w of vis) { const k = clave(w); if (!m.has(k)) m.set(k, []); m.get(k).push(w); }
        const gs = [...m].map(([k, ws]) => [k, ws.sort((a, b) => (b.actual - a.actual) || porFecha(a, b))]);
        if (agrupar === 'estado') return gs.sort((a, b) => EST.findIndex(e => e[1] === a[0] || etiquetaEstadoTarea(e[0]) === a[0]) - EST.findIndex(e => e[1] === b[0] || etiquetaEstadoTarea(e[0]) === b[0]));
        if (agrupar === 'semana') return gs.sort((a, b) => (a[0] === 'Sin fecha') - (b[0] === 'Sin fecha') || String(a[1][0]?.fecha).localeCompare(String(b[1][0]?.fecha)));
        return gs.sort((a, b) => (a[0].startsWith('Sin') - b[0].startsWith('Sin')) || a[0].localeCompare(b[0], 'es'));
    }, [vis, agrupar]); // eslint-disable-line react-hooks/exhaustive-deps

    const vacio = !proy && !tanda && alcance === 'tandas' && !tandasAbiertas.length
        ? 'Todavía no hay tandas. Las tareas aparecen acá cuando su proyecto entra en una tanda; mientras tanto podés ver «Todas, también las dormidas».'
        : 'No hay tareas con estos filtros.';
    const proyecto = proy ? (lista || []).find(p => p.id === proy) : null;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-brand-cyan/10 text-sm font-black text-brand-cyan">{sinTerminar} sin terminar</span>
                <div className="flex-1" />
                <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-0.5">
                    {[['lista', 'Lista'], ['tablero', 'Tablero por estado']].map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setModo(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${modo === k ? 'bg-brand-cyan text-white' : 'text-zinc-600'}`}>{l}</button>
                    ))}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {proyecto ? (
                    <button type="button" onClick={() => quitarParam('proyecto')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-zinc-700 text-xs font-bold text-white">Proyecto: {proyecto.nombre} <X size={13} /></button>
                ) : tanda ? (
                    <button type="button" onClick={() => setTanda(null)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-zinc-700 text-xs font-bold text-white">Solo {tandasAbiertas.find(t => t.id === tanda)?.nombre || 'la tanda'} <X size={13} /></button>
                ) : (<>
                    <Selector filtro resaltar={false} value={alcance} onChange={(e) => setAlcance(e.target.value)} aria-label="Mostrar" anchoLista={280} renderValor={o => `Mostrar: ${o?.texto}`}>
                        {ALCANCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Selector>
                    {tandasAbiertas.map(t => <button key={t.id} type="button" onClick={() => setTanda(t.id)} className="px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-xs font-bold text-zinc-600">Solo {t.nombre}</button>)}
                </>)}
                <Selector filtro value={des} onChange={(e) => setDes(e.target.value)} aria-label="Desarrollo" renderValor={o => `Desarrollo: ${o?.texto || 'Todos'}`}>
                    <option value="">Todos</option>
                    {tipos.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
                </Selector>
                <Selector filtro value={resp} onChange={(e) => setResp(e.target.value)} aria-label="Responsable" anchoLista={240} renderValor={o => `Responsable: ${o?.texto || 'Todos'}`}>
                    <option value="">Todos</option>
                    {yo && <option value="__yo">{`Yo (${sesion.usuario.nombre})`}</option>}
                    {nombres.map(n => <option key={n} value={n}>{n}</option>)}
                    <option value="__nadie">Sin responsable</option>
                </Selector>
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input type="search" className={`${campoFiltro} w-full pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por tarea, proyecto o responsable" />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => setEst('')} className={`px-3 py-1.5 rounded-full border text-xs font-bold ${!est ? 'border-zinc-700 bg-zinc-700 text-white' : 'border-zinc-200 bg-white text-zinc-600'}`}>
                    Sin terminar <span className="opacity-70">{sinTerminar}</span>
                </button>
                {EST.map(([k, l, color]) => (
                    <button key={k} type="button" onClick={() => setEst(e => (e === k ? '' : k))}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${est === k ? 'border-zinc-700 bg-zinc-700 text-white' : 'border-zinc-200 bg-white text-zinc-600'}`}>
                        <span className={`w-2 h-2 rounded-full ${color}`} />{l} <span className="opacity-70">{filtradas.filter(w => w.est === k).length}</span>
                    </button>
                ))}
                {modo === 'lista' && (
                    <Selector filtro resaltar={false} value={agrupar} onChange={(e) => setAgrupar(e.target.value)} aria-label="Agrupar" renderValor={o => `Agrupar: ${o?.texto}`}>
                        {GRUPOS.map(([v, l]) => <option key={v || 'sin'} value={v}>{l}</option>)}
                    </Selector>
                )}
                {edita && aConfirmar.length > 0 && !confirmando && <button type="button" onClick={() => setConfirmando(true)} className={btnSec}>Confirmar las fechas sugeridas ({aConfirmar.length})</button>}
            </div>
            <Desplegable abierto={confirmando} hueco={16}>
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <span className="text-sm text-amber-800">Confirmar la fecha sugerida en {aConfirmar.length} {aConfirmar.length === 1 ? 'tarea' : 'tareas'} sin fecha:</span>
                    <button type="button" onClick={confirmarFechas} className={btnPri}>Confirmar</button>
                    <button type="button" onClick={() => setConfirmando(false)} className={btnCancelar}>cancelar</button>
                </div>
            </Desplegable>

            {lista === null ? <Loader2 size={20} className="animate-spin text-zinc-300" />
                : !vis.length ? <p className="text-sm text-zinc-400">{vacio}</p>
                : modo === 'lista' ? (
                    <div className="flex flex-col gap-3">
                        {grupos.map(([k, ws]) => (
                            <section key={k || 'todas'} className="rounded-2xl border border-zinc-200 bg-white px-4 py-2">
                                {k && <h3 className="pt-1 pb-1 text-sm font-black text-zinc-700">{k} <span className="text-zinc-400 font-bold">{ws.length}</span></h3>}
                                {ws.slice(0, 150).map(fila)}
                                {ws.length > 150 && <p className="py-2 text-xs text-zinc-400">y {ws.length - 150} más en este grupo: filtrá o buscá para verlas.</p>}
                            </section>
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                        {EST.filter(([k]) => !est || est === k).map(([k, l, color]) => {
                            const col = filtradas.filter(w => w.est === k).sort(porFecha);
                            return (
                                <div key={k} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-2 flex flex-col gap-2 min-w-0">
                                    <h3 className="flex items-center gap-1.5 px-1 text-xs font-black text-zinc-600"><span className={`w-2 h-2 rounded-full ${color}`} />{l} <span className="text-zinc-400">{col.length}</span></h3>
                                    {!col.length && <p className="px-1 text-xs text-zinc-400">Nada acá.</p>}
                                    {col.slice(0, 60).map(w => (
                                        <div key={w.t.id} className="rounded-xl border border-zinc-200 bg-white p-2.5 flex flex-col gap-1.5">
                                            <span className="text-sm font-medium text-zinc-800">{w.t.nombre}</span>
                                            <button type="button" onClick={() => navigate(`/desarrollos/proyectos?abrir=${w.p.id}`)} className="self-start text-xs font-bold text-brand-cyan hover:underline text-left">{w.p.nombre}</button>
                                            <span className="text-xs text-zinc-400">{w.t.responsable || 'sin responsable'}{w.fecha ? ` · ${w.esSug ? '≈ ' : ''}${fmtD(w.fecha)}` : ''}{w.t.tanda ? ` · ${w.t.tanda.nombre}` : ''}</span>
                                            {k === 'BLOQUEADA' && <span className="text-xs text-brand-magenta">Espera a: {bloqueos(w.t, w.p.tareas).map(x => x.nombre).join(', ')}</span>}
                                            <Selector value={w.t.estado} disabled={!edita} aria-label="Estado"
                                                onChange={async (e) => { try { const r = await desarrollosService.tarea(w.t.id, { estado: e.target.value }); if (r.aviso) toast.warning(r.aviso); actualizar(r.data); } catch (err) { toast.error(mensajeError(err)); } }}>
                                                {ESTADOS_TAREA.map(([v, et]) => <option key={v} value={v}>{et}</option>)}
                                            </Selector>
                                        </div>
                                    ))}
                                    {col.length > 60 && <p className="px-1 text-xs text-zinc-400">y {col.length - 60} más: filtrá por responsable o proyecto.</p>}
                                </div>
                            );
                        })}
                    </div>
                )}
        </div>
    );
};

export default TareasVista;
