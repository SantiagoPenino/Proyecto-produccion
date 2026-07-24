import React, { useState, useEffect, useCallback } from 'react';
import { tareasService } from '../../services/api';
import { socket } from '../../services/socketService';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import { ListChecks, Plus, Trash2, CheckCircle2, Circle, User, Clock } from 'lucide-react';

// Fecha corta DD/MM/YY HH:mm (24h) — mismo criterio que el resto del sistema.
const fmt = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const TareasPage = () => {
    const { user } = useAuth();
    const [tareas, setTareas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filtro, setFiltro] = useState('pendientes'); // pendientes | hechas | todas
    const [titulo, setTitulo] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [mostrandoForm, setMostrandoForm] = useState(false); // el alta aparece al pulsar "Nueva tarea"

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
        const r = await Swal.fire({
            title: '¿Borrar tarea?',
            text: tarea.TarTitulo,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Borrar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#e11d48',
        });
        if (!r.isConfirmed) return;
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
        <div className="max-w-3xl mx-auto p-4 md:p-6">
            {/* Encabezado */}
            <div className="flex items-center gap-3 mb-6">
                <div className="w-11 h-11 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center">
                    <ListChecks size={24} />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-zinc-800 leading-none">Tareas</h1>
                    <p className="text-sm text-zinc-400 mt-1">Lista compartida — cualquiera crea y cualquiera marca hecha.</p>
                </div>
            </div>

            {/* Alta de tarea: aparece solo al pulsar "Nueva tarea" */}
            {!mostrandoForm ? (
                <button
                    onClick={() => setMostrandoForm(true)}
                    className="w-full mb-5 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border-2 border-dashed border-zinc-200 text-zinc-400 text-sm font-bold hover:border-brand-cyan/40 hover:text-brand-cyan transition-colors"
                >
                    <Plus size={18} /> Nueva tarea
                </button>
            ) : (
                <form onSubmit={crear} className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm mb-5">
                    <input
                        type="text"
                        value={titulo}
                        onChange={(e) => setTitulo(e.target.value)}
                        placeholder="¿Qué hay que hacer?"
                        maxLength={300}
                        autoFocus
                        className="w-full text-base font-semibold text-zinc-800 placeholder:text-zinc-300 outline-none"
                    />
                    <textarea
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                        placeholder="Detalle (opcional)"
                        rows={descripcion ? 2 : 1}
                        className="w-full mt-2 text-sm text-zinc-600 placeholder:text-zinc-300 outline-none resize-none"
                    />
                    <div className="flex justify-end items-center gap-2 mt-2">
                        <button
                            type="button"
                            onClick={cerrarForm}
                            className="px-4 py-2 rounded-xl text-zinc-400 text-sm font-bold hover:bg-zinc-100 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={!titulo.trim() || guardando}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-cyan/90 transition-colors"
                        >
                            <Plus size={16} /> Agregar
                        </button>
                    </div>
                </form>
            )}

            {/* Filtros */}
            <div className="flex items-center gap-1 mb-4">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setFiltro(t.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${filtro === t.key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-100'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Lista */}
            {loading ? (
                <div className="text-center text-zinc-400 py-12 animate-pulse">Cargando…</div>
            ) : tareas.length === 0 ? (
                <div className="text-center text-zinc-400 py-12">
                    {filtro === 'hechas' ? 'Todavía no hay tareas hechas.' : 'No hay tareas. ¡A cargar!'}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {tareas.map((t) => (
                        <div
                            key={t.TarId}
                            className={`group bg-white border rounded-xl p-3 flex items-start gap-3 transition-colors ${t.TarHecha ? 'border-zinc-100 bg-zinc-50/60' : 'border-zinc-200 hover:border-brand-cyan/40'}`}
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
                                <div className={`font-semibold text-sm ${t.TarHecha ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>
                                    {t.TarTitulo}
                                </div>
                                {t.TarDescripcion && (
                                    <div className={`text-xs mt-0.5 whitespace-pre-wrap ${t.TarHecha ? 'text-zinc-300' : 'text-zinc-500'}`}>
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

                            {/* Borrar (el backend permite solo al creador o admin) */}
                            <button
                                onClick={() => eliminar(t)}
                                title="Borrar tarea"
                                className="shrink-0 text-zinc-300 hover:text-brand-magenta opacity-0 group-hover:opacity-100 transition-all"
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
