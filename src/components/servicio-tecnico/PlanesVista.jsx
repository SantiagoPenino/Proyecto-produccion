import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Pencil, Power, Repeat, ListChecks, Cog, Eye, EyeOff } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import { fmtDia, fmtDuracion, estadoTrabajo, mensajeError, franjaTexto } from './constantes';
import { chip, btnPri } from './ui';
import { ModalPlan, ModalProcedimiento } from './FormulariosMantenimiento';

// Planes de mantenimiento (se repiten) y procedimientos (cómo se hace cada trabajo) — etapa 3.
const PlanesVista = ({ meta, onAbrirTrabajo }) => {
    const [tab, setTab] = useState('planes');
    const [todos, setTodos] = useState(false);
    const [planes, setPlanes] = useState(null);
    const [procs, setProcs] = useState(null);
    const [modal, setModal] = useState(null); // { plan } | { proc }

    const cargar = useCallback(async () => {
        try {
            const [pl, pr] = await Promise.all([servicioTecnicoService.planes(todos), servicioTecnicoService.procedimientos(todos)]);
            setPlanes(pl);
            setProcs(pr);
        } catch (e) { toast.error(mensajeError(e, 'No se pudieron cargar los planes')); }
    }, [todos]);
    useEffect(() => { cargar(); }, [cargar]);
    const avisar = useRecargaConFreno(() => cargar());
    useEffect(() => {
        socket.on('st:updated', avisar);
        return () => socket.off('st:updated', avisar);
    }, [avisar]);

    const activar = async (fn, exito) => {
        try { await fn(); toast.success(exito); cargar(); }
        catch (e) { toast.error(mensajeError(e)); }
    };

    const procsActivos = (procs || []).filter(p => p.Activo);
    const nuevo = () => setModal(tab === 'planes' ? { plan: null } : { proc: null });
    const textoNuevo = tab === 'planes' ? 'Nuevo plan' : 'Nuevo procedimiento';

    return (
        <div>
            {/* En celular, todo en una fila como en el calendario: las pestañas se reparten el ancho, "Ver
                desactivados" es un ojo que se prende y "nuevo" es solo "+". Desde sm, con textos. */}
            <div className="flex items-center gap-2 mb-4 sm:flex-wrap">
                <div className="flex-1 sm:flex-none flex gap-1 min-w-0">
                    {[['planes', 'Planes', Repeat], ['procedimientos', 'Procedimientos', ListChecks]].map(([k, t, Icono]) => (
                        <button key={k} onClick={() => setTab(k)}
                            className={`flex-1 sm:flex-none justify-center inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide whitespace-nowrap transition-colors ${tab === k ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-100'}`}>
                            <Icono size={14} className="hidden sm:block" /> {t}
                        </button>
                    ))}
                </div>
                <label className="hidden sm:inline-flex items-center gap-2 text-sm font-bold text-zinc-500">
                    <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} className="w-4 h-4 accent-brand-cyan" /> Ver desactivados
                </label>
                <button type="button" onClick={() => setTodos((v) => !v)} aria-pressed={todos}
                    title={todos ? 'Ocultar desactivados' : 'Ver desactivados'} aria-label={todos ? 'Ocultar desactivados' : 'Ver desactivados'}
                    className={`sm:hidden w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${todos ? 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-400'}`}>
                    {todos ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button onClick={nuevo} className={`hidden sm:inline-flex ${btnPri} ml-auto`}><Plus size={16} /> {textoNuevo}</button>
                <button onClick={nuevo} title={textoNuevo} aria-label={textoNuevo}
                    className="sm:hidden w-9 h-9 rounded-xl flex items-center justify-center bg-brand-cyan text-white hover:bg-brand-cyan/90 shrink-0"><Plus size={18} /></button>
            </div>

            {!planes || !procs ? <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div>
                : tab === 'planes' ? (
                    planes.length === 0 ? (
                        <div className="py-16 text-center text-sm text-zinc-400">
                            Todavía no hay planes. Un plan programa un mantenimiento que se repite (ej: limpieza de cabezales cada semana).
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {planes.map(p => (
                                <div key={p.PlanId} className={`rounded-2xl border px-4 py-3 flex flex-wrap items-center gap-3 ${p.Activo ? 'bg-white border-zinc-200' : 'bg-zinc-50 border-zinc-200 opacity-60'}`}>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                            <span className={`${chip} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30`}>{p.CadaTexto}{franjaTexto(p) && ` · ${franjaTexto(p)}`}</span>
                                            {!p.Activo && <span className={`${chip} bg-zinc-100 text-zinc-500 border-zinc-200`}>Desactivado</span>}
                                            {p.ParaMaquina && <span className="inline-flex items-center gap-1 text-amber-700 font-bold"><Cog size={11} /> para la máquina</span>}
                                        </div>
                                        <div className="mt-1 text-sm font-black text-zinc-800">{p.Titulo}</div>
                                        <div className="text-xs text-zinc-500">
                                            {p.EquipoNombre ? `${p.EquipoNombre} (${p.EquipoArea})` : p.EquipoTexto || 'Sin máquina'}
                                            {p.ProcTitulo && ` · ${p.ProcTitulo}`} · {p.TecnicoNombre || 'sin técnico'}
                                        </div>
                                    </div>
                                    <div className="text-right text-xs">
                                        {p.TrabAbiertoId ? (
                                            <button onClick={() => onAbrirTrabajo(p.TrabAbiertoId)} className="text-left hover:underline">
                                                <div className="font-bold text-zinc-700">Próximo: {fmtDia(p.TrabAbiertoFecha)}</div>
                                                <span className={`${chip} ${estadoTrabajo({ Estado: p.TrabAbiertoEstado, Vencido: p.TrabAbiertoVencido, VecesPospuesto: p.TrabAbiertoPospuesto }).chip}`}>
                                                    {estadoTrabajo({ Estado: p.TrabAbiertoEstado, Vencido: p.TrabAbiertoVencido, VecesPospuesto: p.TrabAbiertoPospuesto }).label}
                                                </span>
                                            </button>
                                        ) : <span className="text-zinc-400">{p.Activo ? `Próximo: ${fmtDia(p.ProximaFecha)}` : '—'}</span>}
                                        {p.UltimaVezRealizado && <div className="text-zinc-400 mt-0.5">Última vez: {fmtDia(p.UltimaVezRealizado)}</div>}
                                    </div>
                                    <div className="flex gap-1">
                                        <button title="Editar" onClick={() => setModal({ plan: p })} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><Pencil size={15} /></button>
                                        <button title={p.Activo ? 'Desactivar' : 'Activar'} onClick={() => activar(() => servicioTecnicoService.activarPlan(p.PlanId, !p.Activo), p.Activo ? 'Plan desactivado' : 'Plan activado')}
                                            className={`w-8 h-8 rounded-lg flex items-center justify-center hover:bg-zinc-100 ${p.Activo ? 'text-emerald-600' : 'text-zinc-400'}`}><Power size={15} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                ) : (
                    procs.length === 0 ? (
                        <div className="py-16 text-center text-sm text-zinc-400">
                            Todavía no hay procedimientos. Un procedimiento son los pasos de un trabajo, con el tiempo de cada uno.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                            {procs.map(p => (
                                <div key={p.ProcId} className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${p.Activo ? 'bg-white border-zinc-200' : 'bg-zinc-50 border-zinc-200 opacity-60'}`}>
                                    <button onClick={() => setModal({ proc: p })} className="min-w-0 flex-1 text-left">
                                        <div className="text-sm font-black text-zinc-800">{p.Titulo}</div>
                                        <div className="text-xs text-zinc-500">
                                            {p.Pasos} pasos · {fmtDuracion(p.MinutosTotal) || '0 min'}
                                            {(p.EquipoNombre || p.AreaNombre) && ` · ${p.EquipoNombre || p.AreaNombre}`}
                                            {p.PlanesActivos > 0 && ` · en ${p.PlanesActivos} plan${p.PlanesActivos === 1 ? '' : 'es'}`}
                                        </div>
                                        {p.Descripcion && <div className="text-xs text-zinc-400 line-clamp-2 mt-0.5">{p.Descripcion}</div>}
                                    </button>
                                    <div className="flex gap-1 shrink-0">
                                        <button title="Editar" onClick={() => setModal({ proc: p })} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><Pencil size={15} /></button>
                                        <button title={p.Activo ? 'Desactivar' : 'Activar'} onClick={() => activar(() => servicioTecnicoService.activarProcedimiento(p.ProcId, !p.Activo), p.Activo ? 'Procedimiento desactivado' : 'Procedimiento activado')}
                                            className={`w-8 h-8 rounded-lg flex items-center justify-center hover:bg-zinc-100 ${p.Activo ? 'text-emerald-600' : 'text-zinc-400'}`}><Power size={15} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                )}

            {modal && 'plan' in modal && (
                <ModalPlan plan={modal.plan} meta={meta} procedimientos={procsActivos} onCerrar={() => setModal(null)} onGuardado={() => { setModal(null); cargar(); }} />
            )}
            {modal && 'proc' in modal && (
                <ModalProcedimiento procId={modal.proc?.ProcId || null} meta={meta} onCerrar={() => setModal(null)} onGuardado={() => { setModal(null); cargar(); }} />
            )}
        </div>
    );
};

export default PlanesVista;
