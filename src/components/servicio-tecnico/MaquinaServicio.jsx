import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Repeat, Trash2, User, CalendarPlus, Plus, X, Cog } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { estadoTrabajo, fmtDia, fmtDuracion, franjaTexto, mensajeError } from './constantes';
import { chip, input, btn, btnPri, btnCancelar, MiniModal } from './ui';
import { ModalPlan, ModalNuevoTrabajo } from './FormulariosMantenimiento';
import BuscadorVariante from '../stock/BuscadorVariante';
import { fmtNum } from './fichaTecnicaCampos';

// Preventivo y repuestos críticos de una máquina (ficha técnica, parte 2, 08/10): sub-secciones de la pestaña
// Servicio de su página. Plan: docs/servicio-tecnico/ficha-tecnica-maquinas-plan.md.

const Titulo = ({ children, extra }) => (
    <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wide">{children}</h3>
        {extra}
    </div>
);

// Un trabajo (programado o ya cerrado) en una fila: tocándolo se abre su detalle.
const FilaTrabajo = ({ t, onAbrir, cerrado = false }) => {
    const est = estadoTrabajo(t);
    return (
        <button type="button" onClick={() => onAbrir?.(t.TrabId)}
            className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${cerrado ? 'bg-zinc-50 border-zinc-200 hover:border-zinc-300' : t.Vencido ? 'bg-red-50/60 border-red-200 hover:border-red-300' : 'bg-white border-zinc-200 hover:border-brand-cyan/40'}`}>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-black text-zinc-700">{fmtDia(t.FechaProgramada)}</span>
                <span className={`${chip} ${est.chip}`}>{est.label}</span>
                {t.PlanId && <span className="inline-flex items-center gap-1 text-zinc-400" title="Es de un plan: se repite"><Repeat size={11} className="text-brand-cyan" /> se repite</span>}
                {t.ParaMaquina && <span className="inline-flex items-center gap-1 font-bold text-amber-700"><Cog size={11} /> para la máquina</span>}
                {franjaTexto(t) && <span className="font-bold text-zinc-500">{franjaTexto(t)}</span>}
                <span className="ml-auto text-zinc-400">
                    {cerrado ? (t.MinutosReales != null ? fmtDuracion(t.MinutosReales) : '') : fmtDuracion(t.MinutosEstimados)}
                </span>
            </div>
            <div className={`mt-1 text-sm font-bold ${cerrado ? 'text-zinc-600' : 'text-zinc-800'}`}>{t.Titulo}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1"><User size={11} />{t.TecnicoNombre || 'sin asignar'}</span>
                {t.TareasTotal > 0 && <span>Tareas {t.TareasHechas}/{t.TareasTotal}</span>}
            </div>
            {cerrado && t.Observaciones && <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{t.Observaciones}</p>}
        </button>
    );
};

// ── Preventivo ───────────────────────────────────────────────────────────────
export const PreventivoMaquina = ({ eq, meta, version = 0, onAbrirTrabajo }) => {
    const tec = !!meta?.esTecnico;
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const [procs, setProcs] = useState(null);
    const [modal, setModal] = useState(null); // 'programar' | { plan }

    const cargar = useCallback(async () => {
        try { setDatos(await servicioTecnicoService.preventivoEquipo(eq.EquipoID)); setError(null); }
        catch (e) { setError(mensajeError(e, 'No se pudo cargar el preventivo')); }
    }, [eq.EquipoID]);
    useEffect(() => { cargar(); }, [cargar, version]);

    // Las ventanas de programar y de editar plan piden los procedimientos: se cargan al abrirlas.
    const abrir = async (m) => {
        if (!procs) {
            try { setProcs((await servicioTecnicoService.procedimientos(false)).filter(p => p.Activo)); }
            catch (e) { toast.error(mensajeError(e, 'No se pudieron cargar los procedimientos')); return; }
        }
        setModal(m);
    };
    const alGuardar = () => { setModal(null); cargar(); };

    if (error) return <p className="py-8 text-center text-sm text-red-600">{error}</p>;
    if (!datos) return <div className="py-10 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={20} /></div>;
    const nada = !datos.planes.length && !datos.abiertos.length && !datos.cerrados.length;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">Los mantenimientos y tareas de esta máquina. Se programan como en el calendario; tocando uno se abre.</p>
                {tec && (
                    <button type="button" onClick={() => abrir('programar')} className={btnPri}>
                        <CalendarPlus size={15} /> Programar
                    </button>
                )}
            </div>

            {nada && <p className="py-6 text-center text-sm text-zinc-400">Esta máquina no tiene mantenimientos ni tareas programadas.</p>}

            {datos.planes.length > 0 && (
                <div>
                    <Titulo>Se repiten</Titulo>
                    <div className="flex flex-col gap-2">
                        {datos.planes.map(p => {
                            const est = p.TrabAbiertoId ? estadoTrabajo({ Estado: p.TrabAbiertoEstado, Vencido: p.TrabAbiertoVencido, VecesPospuesto: p.TrabAbiertoPospuesto }) : null;
                            return (
                                <div key={p.PlanId} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                            <span className={`${chip} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30`}>{p.CadaTexto}{franjaTexto(p) && ` · ${franjaTexto(p)}`}</span>
                                            {p.ParaMaquina && <span className="inline-flex items-center gap-1 font-bold text-amber-700"><Cog size={11} /> para la máquina</span>}
                                        </div>
                                        <div className="mt-1 text-sm font-bold text-zinc-800">{p.Titulo}</div>
                                        <div className="text-xs text-zinc-500">{[p.ProcTitulo, p.TecnicoNombre || 'sin técnico'].filter(Boolean).join(' · ')}</div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1 text-xs">
                                        {p.TrabAbiertoId ? (
                                            <button type="button" onClick={() => onAbrirTrabajo?.(p.TrabAbiertoId)} className="group flex items-center gap-2" title="Ver el trabajo">
                                                <span className="font-bold text-zinc-700 group-hover:underline">Próximo: {fmtDia(p.TrabAbiertoFecha)}</span>
                                                <span className={`${chip} ${est.chip}`}>{est.label}</span>
                                            </button>
                                        ) : <span className="text-zinc-400">Próximo: {fmtDia(p.ProximaFecha)}</span>}
                                        {p.UltimaVezRealizado && <span className="text-zinc-400">Última vez: {fmtDia(p.UltimaVezRealizado)}</span>}
                                    </div>
                                    {tec && (
                                        <button type="button" title="Editar el plan" aria-label={`Editar el plan ${p.Titulo}`} onClick={() => abrir({ plan: p })}
                                            className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><Pencil size={15} /></button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {datos.abiertos.length > 0 && (
                <div>
                    <Titulo>Programado</Titulo>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {datos.abiertos.map(t => <FilaTrabajo key={t.TrabId} t={t} onAbrir={onAbrirTrabajo} />)}
                    </div>
                </div>
            )}

            {datos.cerrados.length > 0 && (
                <div>
                    <Titulo>Últimos hechos</Titulo>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {datos.cerrados.map(t => <FilaTrabajo key={t.TrabId} t={t} onAbrir={onAbrirTrabajo} cerrado />)}
                    </div>
                </div>
            )}

            {modal === 'programar' && (
                <ModalNuevoTrabajo meta={meta} procedimientos={procs} equipoInicial={eq.EquipoID} tipoInicial="MANTENIMIENTO"
                    onCerrar={() => setModal(null)} onGuardado={alGuardar} />
            )}
            {modal?.plan && (
                <ModalPlan plan={modal.plan} meta={meta} procedimientos={procs} onCerrar={() => setModal(null)} onGuardado={alGuardar} />
            )}
        </div>
    );
};

// ── Repuestos críticos ───────────────────────────────────────────────────────
// El stock y los límites (crítico / alerta) son los del /stock; acá solo se elige qué artículos son repuestos de la
// máquina. Primero los que tienen problema.
const ESTADO_REPUESTO = {
    SIN_STOCK: { label: 'Sin stock', chip: 'bg-red-50 text-red-700 border-red-200', orden: 0 },
    CRITICO: { label: 'Crítico', chip: 'bg-red-50 text-red-700 border-red-200', orden: 1 },
    ALERTA: { label: 'Alerta', chip: 'bg-amber-50 text-amber-700 border-amber-200', orden: 2 },
    OK: { label: 'Stock OK', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', orden: 3 },
    SIN_LIMITES: { label: 'Sin límites', chip: 'bg-zinc-50 text-zinc-500 border-zinc-200', orden: 4 },
};

export const RepuestosMaquina = ({ eq, meta, version = 0 }) => {
    const tec = !!meta?.esTecnico;
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const [elegido, setElegido] = useState(null); // variante elegida para agregar
    const [nota, setNota] = useState('');
    const [agregando, setAgregando] = useState(false);
    const [quitar, setQuitar] = useState(null);
    const [quitando, setQuitando] = useState(false);

    const cargar = useCallback(async () => {
        try { setDatos(await servicioTecnicoService.repuestosEquipo(eq.EquipoID)); setError(null); }
        catch (e) { setError(mensajeError(e, 'No se pudieron cargar los repuestos')); }
    }, [eq.EquipoID]);
    useEffect(() => { cargar(); }, [cargar, version]);

    const agregar = async () => {
        setAgregando(true);
        try {
            await servicioTecnicoService.agregarRepuesto(eq.EquipoID, { varId: elegido.VarId, nota: nota.trim() });
            toast.success('Repuesto agregado');
            setElegido(null); setNota('');
            cargar();
        } catch (e) { toast.error(mensajeError(e)); }
        finally { setAgregando(false); }
    };
    const confirmarQuitar = async () => {
        setQuitando(true);
        try {
            await servicioTecnicoService.quitarRepuesto(eq.EquipoID, quitar.RepId);
            toast.success('Repuesto quitado');
            setQuitar(null);
            cargar();
        } catch (e) { toast.error(mensajeError(e)); }
        finally { setQuitando(false); }
    };

    if (error) return <p className="py-8 text-center text-sm text-red-600">{error}</p>;
    if (!datos) return <div className="py-10 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={20} /></div>;
    if (!datos.disponible) {
        return <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">Falta correr <span className="font-mono">docs/servicio-tecnico/st-ficha-tecnica.sql</span> en la base para cargar repuestos.</div>;
    }
    const lista = [...datos.data].sort((a, b) => (ESTADO_REPUESTO[a.Estado]?.orden ?? 9) - (ESTADO_REPUESTO[b.Estado]?.orden ?? 9));
    const cant = (n, u) => `${fmtNum(Number(n) || 0, 3)}${u ? ` ${u}` : ''}`;

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-zinc-500">
                Los artículos del stock que conviene tener para esta máquina. El stock y los límites (crítico y alerta) son los del stock:
                se cargan en Stock → Gestión de Sistema → Alertas de stock.
            </p>

            {tec && (
                <div className="rounded-2xl border border-zinc-200 bg-white p-3">
                    {!elegido ? (
                        <BuscadorVariante onElegir={setElegido} placeholder="Agregar un repuesto: buscá el artículo del stock…" />
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-bold text-zinc-800">{elegido.Producto}</div>
                                    <div className="text-xs text-zinc-500">{elegido.NombreVariante}{elegido.CodigoVariante && <span className="ml-1 font-mono text-[11px] text-zinc-400">{elegido.CodigoVariante}</span>}</div>
                                </div>
                                <button type="button" onClick={() => { setElegido(null); setNota(''); }} aria-label="Elegir otro artículo"
                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><X size={16} /></button>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <input className={`${input} flex-1`} value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)}
                                    placeholder="Nota (opcional): ej. de repuesto para el canal blanco" aria-label="Nota del repuesto" />
                                <button type="button" onClick={agregar} disabled={agregando} className={`${btnPri} justify-center`}>
                                    {agregando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Agregar
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {lista.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-400">Todavía no hay repuestos cargados para esta máquina.</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {lista.map(r => {
                        const est = ESTADO_REPUESTO[r.Estado] || ESTADO_REPUESTO.SIN_LIMITES;
                        return (
                            <div key={r.RepId} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-bold text-zinc-800">{r.Producto}</div>
                                    <div className="text-xs text-zinc-500">
                                        {r.NombreVariante}{r.CodigoVariante && <span className="ml-1 font-mono text-[11px] text-zinc-400">{r.CodigoVariante}</span>}
                                        {!r.Activa && <span className="ml-1 text-amber-700">(artículo desactivado)</span>}
                                    </div>
                                    {r.Nota && <div className="mt-0.5 text-xs text-zinc-500">{r.Nota}</div>}
                                </div>
                                <div className="flex flex-col items-end gap-1 text-xs">
                                    <span className={`${chip} ${est.chip}`}>{est.label}</span>
                                    <span className="font-mono tabular-nums font-bold text-zinc-700">{cant(r.Stock, r.Unidad)}</span>
                                    {datos.deposito && r.StockDeposito != null && <span className="text-zinc-400">{cant(r.StockDeposito)} en {datos.deposito}</span>}
                                    {(Number(r.CantidadCritica) > 0 || Number(r.CantidadAlerta) > 0) && (
                                        <span className="text-[11px] text-zinc-400">crítico {fmtNum(Number(r.CantidadCritica) || 0)} · alerta {fmtNum(Number(r.CantidadAlerta) || 0)}</span>
                                    )}
                                </div>
                                {tec && (
                                    <button type="button" onClick={() => setQuitar(r)} title="Quitar de los repuestos" aria-label={`Quitar ${r.Producto} de los repuestos`}
                                        className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {quitar && (
                <MiniModal titulo="Quitar repuesto" chico onCerrar={() => setQuitar(null)} pie={<>
                    <button onClick={() => setQuitar(null)} className={btnCancelar}>Cancelar</button>
                    <button onClick={confirmarQuitar} disabled={quitando} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
                        {quitando ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Quitar
                    </button>
                </>}>
                    <p className="text-sm text-zinc-700">¿Quitar <b>{quitar.Producto}{quitar.NombreVariante ? ` — ${quitar.NombreVariante}` : ''}</b> de los repuestos de {eq.Nombre}?</p>
                    <p className="text-xs text-zinc-500">No toca el stock: solo deja de figurar como repuesto de esta máquina. Queda anotado en su historial.</p>
                </MiniModal>
            )}
        </div>
    );
};
