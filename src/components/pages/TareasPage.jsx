import React, { useState, useEffect, useCallback } from 'react';
import { tareasService } from '../../services/api';
import { socket } from '../../services/socketService';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import { ListChecks, Plus, Trash2, CheckCircle2, Circle, User, Clock, Loader2 } from 'lucide-react';
import Selector from '../ui/Selector';
import useConfirmar from '../ui/useConfirmar';

// Fecha corta DD/MM/YY HH:mm (24h) — mismo criterio que el resto del sistema.
const fmt = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Estética nueva (28/10/2026): encabezado con ícono brand-cyan sin fondo y título en mayúsculas, ancho completo,
// pestañas en pastillas (Selector en el celular), confirmación de borrado con useConfirmar (antes SweetAlert) y el
// tacho siempre visible (antes aparecía solo al pasar el mouse: en el celular no se podía borrar).
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full bg-white border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';

const TareasPage = () => {
    const { user } = useAuth();
    const [tareas, setTareas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filtro, setFiltro] = useState('pendientes'); // pendientes | hechas | todas
    const [titulo, setTitulo] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [mostrandoForm, setMostrandoForm] = useState(false); // el alta aparece al pulsar "Nueva tarea"
    const [confirmar, ventanaConfirmar] = useConfirmar();

    const cerrarForm = () => { setMostrandoForm(false); setTitulo(''); setDescripcion(''); };

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const res = await tareasService.list(filtro);
            setTareas(res.data || []);
        } catch (e) {
            toast.error('No se pudieron cargar las tareas');
        } finally {
            setLoading(false);
        }
    }, [filtro]);

    useEffect(() => { cargar(); }, [cargar]);

    // Tiempo real: cualquier alta/cambio de otro usuario refresca la lista.
    useEffect(() => {
        const onUpd = () => cargar();
        socket.on('tareas:updated', onUpd);
        return () => socket.off('tareas:updated', onUpd);
    }, [cargar]);

    const crear = async (e) => {
        e?.preventDefault();
        const t = titulo.trim();
        if (!t) return;
        setGuardando(true);
        try {
            await tareasService.create({ titulo: t, descripcion: descripcion.trim() || null });
            cerrarForm();
            cargar();
        } catch (e) {
            toast.error(e?.response?.data?.error || 'No se pudo crear la tarea');
        } finally {
            setGuardando(false);
        }
    };

    const toggle = async (tarea) => {
        const nuevo = !tarea.TarHecha;
        // Optimista: reflejamos el cambio ya; si falla, recargamos.
        setTareas((prev) => prev.map((x) => x.TarId === tarea.TarId
            ? { ...x, TarHecha: nuevo, TarHechaPorNombre: nuevo ? (user?.nombre || 'Vos') : null, TarFechaHecha: nuevo ? new Date().toISOString() : null }
            : x));
        try {
            await tareasService.setHecha(tarea.TarId, nuevo);
        } catch (e) {
            toast.error('No se pudo actualizar la tarea');
            cargar();
        }
    };

    const eliminar = async (tarea) => {
        if (!(await confirmar({ titulo: '¿Borrar tarea?', texto: tarea.TarTitulo, confirmar: 'Borrar', peligro: true }))) return;
        try {
            await tareasService.remove(tarea.TarId);
            setTareas((prev) => prev.filter((x) => x.TarId !== tarea.TarId));
        } catch (e) {
            toast.error(e?.response?.data?.error || 'No se pudo borrar');
        }
    };

    const tabs = [
        { key: 'pendientes', label: 'Pendientes' },
        { key: 'hechas', label: 'Hechas' },
        { key: 'todas', label: 'Todas' },
    ];

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
            {ventanaConfirmar}

            {/* Encabezado */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-3">
                        <ListChecks size={30} className="text-brand-cyan shrink-0" />
                        <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Tareas</h1>
                    </div>
                    <p className="text-sm text-zinc-500 mt-2">Lista compartida — cualquiera crea y cualquiera marca hecha.</p>
                </div>
                {!mostrandoForm && (
                    <button onClick={() => setMostrandoForm(true)} className={`${BTN_PRINCIPAL} w-full sm:w-auto`}>
                        <Plus size={16} /> Nueva tarea
                    </button>
                )}
            </div>

            {/* Alta de tarea: aparece solo al pulsar "Nueva tarea" */}
            {mostrandoForm && (
                <form onSubmit={crear} className={`${CARD} p-4 flex flex-col gap-2`}>
                    <input
                        type="text"
                        value={titulo}
                        onChange={(e) => setTitulo(e.target.value)}
                        placeholder="¿Qué hay que hacer?"
                        maxLength={300}
                        autoFocus
                        className={`${CAMPO} font-semibold`}
                    />
                    <textarea
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                        placeholder="Detalle (opcional)"
                        rows={descripcion ? 3 : 2}
                        className={`${CAMPO} resize-none`}
                    />
                    <div className="flex flex-wrap justify-end items-center gap-2 mt-1">
                        <button type="button" onClick={cerrarForm} className={BTN_SECUNDARIO}>
                            Cancelar
                        </button>
                        <button type="submit" disabled={!titulo.trim() || guardando} className={BTN_PRINCIPAL}>
                            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Agregar
                        </button>
                    </div>
                </form>
            )}

            {/* Filtros: pastillas en pantallas anchas, Selector en el celular */}
            <div>
                <div className="hidden md:inline-flex rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            onClick={() => setFiltro(t.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${filtro === t.key ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                <div className="md:hidden">
                    <Selector value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Qué tareas ver">
                        {tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </Selector>
                </div>
            </div>

            {/* Lista */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 size={28} className="animate-spin text-brand-cyan" />
                </div>
            ) : tareas.length === 0 ? (
                <div className={`${CARD} flex flex-col items-center justify-center text-center px-4 py-14 gap-2`}>
                    <ListChecks size={40} className="text-brand-cyan" />
                    <p className="text-sm font-bold text-zinc-700">
                        {filtro === 'hechas' ? 'Todavía no hay tareas hechas.' : 'No hay tareas. ¡A cargar!'}
                    </p>
                    {filtro !== 'hechas' && <p className="text-xs text-zinc-400">Las que cargue cualquiera aparecen acá al instante.</p>}
                </div>
            ) : (
                <div className={`${CARD} overflow-hidden divide-y divide-zinc-100`}>
                    {tareas.map((t) => (
                        <div
                            key={t.TarId}
                            className={`px-3 sm:px-4 py-3 flex items-start gap-3 transition-colors ${t.TarHecha ? 'bg-zinc-50/60' : 'hover:bg-zinc-50/60'}`}
                        >
                            {/* Check */}
                            <button
                                onClick={() => toggle(t)}
                                title={t.TarHecha ? 'Marcar como pendiente' : 'Marcar como hecha'}
                                className={`shrink-0 mt-0.5 transition-colors ${t.TarHecha ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500'}`}
                            >
                                {t.TarHecha ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                            </button>

                            {/* Cuerpo */}
                            <div className="min-w-0 flex-1">
                                <div className={`font-semibold text-sm break-words ${t.TarHecha ? 'text-zinc-400 line-through' : 'text-zinc-900'}`}>
                                    {t.TarTitulo}
                                </div>
                                {t.TarDescripcion && (
                                    <div className={`text-xs mt-0.5 whitespace-pre-wrap break-words ${t.TarHecha ? 'text-zinc-300' : 'text-zinc-500'}`}>
                                        {t.TarDescripcion}
                                    </div>
                                )}
                                {/* Registro: quién creó / quién hizo */}
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-zinc-400">
                                    <span className="inline-flex items-center gap-1">
                                        <User size={12} /> {t.TarCreadaPorNombre || '—'}
                                        <Clock size={11} className="ml-1" /> {fmt(t.TarFechaCreacion)}
                                    </span>
                                    {t.TarHecha && (
                                        <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                                            <CheckCircle2 size={12} /> Hecha por {t.TarHechaPorNombre || '—'}
                                            <Clock size={11} className="ml-1" /> {fmt(t.TarFechaHecha)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Borrar (el backend permite solo al creador o admin). Siempre visible: en el celular no hay «pasar el mouse». */}
                            <button
                                onClick={() => eliminar(t)}
                                title="Borrar tarea"
                                aria-label="Borrar tarea"
                                className="shrink-0 p-1.5 -m-1 rounded-lg border border-transparent text-zinc-300 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 transition-colors"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TareasPage;
