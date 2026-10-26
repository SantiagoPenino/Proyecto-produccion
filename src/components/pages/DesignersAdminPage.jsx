import React, { useState, useEffect, useCallback } from 'react';
import {
    Palette, Search, Loader2, Phone, CalendarDays, Users, ClipboardList,
    Check, Ban, RotateCcw, UserX, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../../services/apiClient';
import useConfirmar from '../ui/useConfirmar';

// Estética nueva (22/10/2026, como Reportes y Logística): página clara, tarjetas blancas con borde, íconos de Lucide
// en brand-cyan sin fondo, datos en recuadros zinc; el color queda para el estado (Pendiente amber, Inactivo magenta).
// Avisos con toast y confirmación con useConfirmar (antes alert / window.confirm del navegador).
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const DATO = 'flex items-center gap-2 text-xs text-zinc-600 bg-zinc-50 px-3 py-2 rounded-xl min-w-0';
const ROTULO = 'text-[11px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2 mb-3';
const CHIP = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full border tabular-nums';
const BADGE = 'text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide shrink-0';

/**
 * Administración de diseñadores del portal (ruta /designers).
 * v1: aprobar / desactivar cuentas. Acá se irán sumando más herramientas
 * (vínculos con clientes, pedidos por diseñador, etc.).
 */
const DesignersAdminPage = () => {
    const [disenadores, setDisenadores] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(null); // DisenadorID en proceso
    const [searchTerm, setSearchTerm] = useState('');
    const [confirmar, ventanaConfirmar] = useConfirmar();

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/web-designer/admin/lista');
            setDisenadores(res.data?.data || []);
        } catch (err) {
            console.error('Error cargando diseñadores', err);
            toast.error(err.response?.data?.error || 'Error cargando diseñadores');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const actualizar = async (d, cambios) => {
        setSaving(d.DisenadorID);
        try {
            await api.put(`/web-designer/admin/${d.DisenadorID}`, cambios);
            await cargar();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error actualizando el diseñador');
        } finally {
            setSaving(null);
        }
    };

    const filtrados = disenadores.filter(d => {
        const q = searchTerm.toLowerCase();
        return !q || (d.Nombre || '').toLowerCase().includes(q) || (d.Email || '').toLowerCase().includes(q);
    });

    const pendientes = filtrados.filter(d => !d.Aprobado);
    const aprobados = filtrados.filter(d => !!d.Aprobado);

    const DesignerCard = ({ d, pendiente }) => (
        <div className={`${CARD} p-4 flex flex-col gap-3 hover:border-zinc-300 transition-colors`}>
            {/* Nombre y email; el estado a la derecha */}
            <div className="flex items-start gap-3">
                <Palette size={22} className={`shrink-0 mt-0.5 ${!pendiente && !d.Activo ? 'text-zinc-300' : 'text-brand-cyan'}`} />
                <div className="min-w-0 flex-1">
                    <h3 className="text-base font-black text-zinc-800 leading-tight truncate m-0" title={d.Nombre}>{d.Nombre}</h3>
                    <p className="text-xs text-zinc-400 mt-0.5 mb-0 truncate" title={d.Email}>{d.Email}</p>
                </div>
                {pendiente && <span className={`${BADGE} bg-amber-50 text-amber-700 border-amber-200`}>Pendiente</span>}
                {!pendiente && !d.Activo && <span className={`${BADGE} bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20`}>Inactivo</span>}
            </div>

            {/* Datos */}
            <div className="flex flex-col gap-2">
                {d.Telefono && (
                    <div className={DATO}>
                        <Phone size={14} className="text-brand-cyan shrink-0" />
                        <span className="truncate">{d.Telefono}</span>
                    </div>
                )}
                <div className={DATO}>
                    <CalendarDays size={14} className="text-brand-cyan shrink-0" />
                    <span>Alta: {d.FechaAlta ? new Date(d.FechaAlta).toLocaleDateString('es-UY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div className={DATO}>
                        <Users size={14} className="text-brand-cyan shrink-0" />
                        <span className="truncate"><b className="text-zinc-800">{d.Clientes}</b> cliente{d.Clientes === 1 ? '' : 's'}</span>
                    </div>
                    <div className={DATO}>
                        <ClipboardList size={14} className="text-brand-cyan shrink-0" />
                        <span className="truncate"><b className="text-zinc-800">{d.Pedidos}</b> pedido{d.Pedidos === 1 ? '' : 's'}</span>
                    </div>
                </div>
            </div>

            {/* Acciones */}
            <div className="flex gap-2 mt-auto pt-1">
                {pendiente ? (
                    <button
                        type="button"
                        onClick={() => actualizar(d, { aprobado: true })}
                        disabled={saving === d.DisenadorID}
                        className={`${BTN_PRINCIPAL} flex-1`}
                    >
                        {saving === d.DisenadorID
                            ? <Loader2 size={15} className="animate-spin" />
                            : <><Check size={15} /> Aprobar</>}
                    </button>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={() => actualizar(d, { activo: !d.Activo })}
                            disabled={saving === d.DisenadorID}
                            className={`${d.Activo ? BTN_SECUNDARIO : BTN_PRINCIPAL} flex-1`}
                            title={d.Activo ? 'Bloquea el ingreso del diseñador' : 'Vuelve a habilitar el ingreso'}
                        >
                            {saving === d.DisenadorID
                                ? <Loader2 size={15} className={`animate-spin ${d.Activo ? 'text-brand-cyan' : ''}`} />
                                : d.Activo
                                    ? <><Ban size={15} className="text-brand-cyan" /> Desactivar</>
                                    : <><RotateCcw size={15} /> Reactivar</>}
                        </button>
                        <button
                            type="button"
                            onClick={async () => {
                                if (await confirmar({
                                    titulo: '¿Quitar la aprobación?',
                                    texto: 'El diseñador no va a poder ingresar hasta que lo apruebes de nuevo.',
                                    confirmar: 'Quitar aprobación',
                                    peligro: true,
                                })) actualizar(d, { aprobado: false });
                            }}
                            disabled={saving === d.DisenadorID}
                            className="w-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-400 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 transition-colors disabled:opacity-50"
                            title="Quitar aprobación"
                            aria-label="Quitar aprobación"
                        >
                            <UserX size={15} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );

    const GRILLA = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3';
    const Vacio = ({ icono: Icono, children }) => (
        <div className="flex flex-col items-center justify-center text-center py-10 px-4 bg-white rounded-2xl border border-dashed border-zinc-300">
            <Icono size={40} className="mb-3 text-brand-cyan" />
            <p className="text-sm font-bold text-zinc-700 m-0">{children}</p>
        </div>
    );

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 font-sans">

            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <Palette size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none m-0">Diseñadores del Portal</h1>
                    <p className="text-sm text-zinc-500 mt-1 mb-0">Aprobación y gestión de cuentas de diseñadores</p>
                </div>
                <div className="relative w-full sm:w-72">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Buscar por nombre o email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        aria-label="Buscar por nombre o email"
                        className={CAMPO}
                    />
                </div>
            </div>

            {loading ? (
                <div className={`${CARD} flex flex-col items-center justify-center py-20 gap-3`}>
                    <Loader2 size={30} className="animate-spin text-brand-cyan" />
                    <p className="text-sm text-zinc-400 m-0">Cargando diseñadores…</p>
                </div>
            ) : (
                <div className="space-y-8 pb-10">
                    {/* Pendientes de aprobación */}
                    <div>
                        <h3 className={ROTULO}>
                            Pendientes de aprobación
                            {pendientes.length > 0 && <span className={`${CHIP} bg-amber-50 text-amber-700 border-amber-200`}>{pendientes.length}</span>}
                        </h3>
                        {pendientes.length === 0 ? (
                            <Vacio icono={UserCheck}>No hay registros esperando aprobación</Vacio>
                        ) : (
                            <div className={GRILLA}>
                                {pendientes.map(d => <DesignerCard key={d.DisenadorID} d={d} pendiente />)}
                            </div>
                        )}
                    </div>

                    {/* Aprobados */}
                    <div>
                        <h3 className={ROTULO}>
                            Diseñadores aprobados
                            {aprobados.length > 0 && <span className={`${CHIP} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20`}>{aprobados.length}</span>}
                        </h3>
                        {aprobados.length === 0 ? (
                            <Vacio icono={Palette}>Todavía no hay diseñadores aprobados</Vacio>
                        ) : (
                            <div className={GRILLA}>
                                {aprobados.map(d => <DesignerCard key={d.DisenadorID} d={d} />)}
                            </div>
                        )}
                    </div>
                </div>
            )}
            {ventanaConfirmar}
        </div>
    );
};

export default DesignersAdminPage;
