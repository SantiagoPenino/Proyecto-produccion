import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Bell, BellRing, BellOff, Smartphone, CheckCheck, Loader2 } from 'lucide-react';
import { notificacionesService } from '../../services/api';
import { socket } from '../../services/socketService';
import { useAuth } from '../../context/AuthContext';
import { estadoPush, activarPush, desactivarPush, refrescarPushSiActivo } from '../../utils/pushInterno';

// Campanita del menú superior: avisos POR USUARIO (backend: /api/notificaciones). Hasta el 28/09
// era decorativa (un "3" fijo). Recibe los avisos al momento por la sala de socket del usuario
// (`usuario:suscribir` con su token, al conectar y al reconectar) y permite activar el push en
// el celular/PC donde se está usando.

const tokenActual = () => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').token || localStorage.getItem('auth_token'); }
    catch (_) { return localStorage.getItem('auth_token'); }
};

const hace = (v) => {
    const min = (Date.now() - new Date(v).getTime()) / 60000;
    if (!(min >= 1)) return 'recién';
    if (min < 60) return `hace ${Math.round(min)} min`;
    if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
    const d = new Date(v);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const CampanaNotificaciones = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [abierta, setAbierta] = useState(false);
    const [avisos, setAvisos] = useState([]);
    const [sinLeer, setSinLeer] = useState(0);
    const [push, setPush] = useState('inactivo'); // no-soportado | bloqueado | activo | inactivo
    const [activando, setActivando] = useState(false);
    const caja = useRef(null);

    const cargar = useCallback(async () => {
        try {
            const r = await notificacionesService.listar();
            setAvisos(r.data || []);
            setSinLeer(r.sinLeer || 0);
        } catch (_) { /* la campanita no debe molestar si falla */ }
    }, []);

    // Suscripción a la sala propia + avisos que llegan al momento.
    useEffect(() => {
        if (!user?.id || user?.userType === 'CLIENT') return undefined;
        const suscribir = () => {
            const token = tokenActual();
            if (token) socket.emit('usuario:suscribir', { token });
        };
        const nuevo = (n) => {
            setAvisos((prev) => [n, ...prev.filter(a => a.NotId !== n.NotId)].slice(0, 40));
            setSinLeer((c) => c + 1);
            toast(n.Titulo, {
                description: n.Texto || undefined,
                duration: 10000,
                action: n.Url ? { label: 'Ver', onClick: () => navigate(n.Url) } : undefined,
            });
        };
        suscribir();
        socket.on('connect', suscribir);
        socket.on('notificacion:nueva', nuevo);
        cargar();
        refrescarPushSiActivo();
        estadoPush().then(setPush);
        return () => {
            socket.off('connect', suscribir);
            socket.off('notificacion:nueva', nuevo);
        };
    }, [user?.id, user?.userType, cargar, navigate]);

    // Cerrar al tocar afuera.
    useEffect(() => {
        if (!abierta) return undefined;
        const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierta(false); };
        document.addEventListener('mousedown', fuera);
        return () => document.removeEventListener('mousedown', fuera);
    }, [abierta]);

    const abrirAviso = async (a) => {
        setAbierta(false);
        if (!a.Leida) {
            setAvisos((prev) => prev.map(x => (x.NotId === a.NotId ? { ...x, Leida: true } : x)));
            setSinLeer((c) => Math.max(0, c - 1));
            notificacionesService.marcarLeida(a.NotId).catch(() => {});
        }
        if (a.Url) navigate(a.Url);
    };

    const leerTodas = async () => {
        setAvisos((prev) => prev.map(x => ({ ...x, Leida: true })));
        setSinLeer(0);
        try { await notificacionesService.marcarTodas(); } catch (_) { cargar(); }
    };

    const alternarPush = async () => {
        setActivando(true);
        try {
            if (push === 'activo') {
                await desactivarPush();
                toast.success('Avisos desactivados en este dispositivo');
            } else {
                await activarPush();
                await notificacionesService.probarPush().catch(() => {});
                toast.success('Avisos activados en este dispositivo: te mandamos uno de prueba');
            }
        } catch (e) {
            toast.error(e?.response?.data?.error || e?.message || 'No se pudieron activar los avisos');
        } finally {
            setPush(await estadoPush());
            setActivando(false);
        }
    };

    return (
        <div className="relative" ref={caja}>
            <button
                type="button"
                onClick={() => { setAbierta((v) => !v); if (!abierta) cargar(); }}
                className="relative cursor-pointer group"
                title="Avisos"
            >
                <div className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-700 text-slate-300 group-hover:bg-zinc-600 group-hover:text-white transition-colors">
                    <Bell size={20} className="group-hover:hidden" />
                    <BellRing size={20} className="hidden group-hover:block animate-[bell-ring_0.5s_ease-in-out]" />
                </div>
                {sinLeer > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-brand-magenta text-[9px] font-bold text-white border-2 border-white shadow-sm">
                        {sinLeer > 99 ? '99+' : sinLeer}
                    </span>
                )}
            </button>

            {abierta && (
                <div className="absolute right-0 top-12 w-[22rem] max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden z-[1200] text-left">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
                        <span className="text-sm font-black text-zinc-800">Avisos</span>
                        {sinLeer > 0 && (
                            <button onClick={leerTodas} className="inline-flex items-center gap-1 text-xs font-bold text-brand-cyan hover:underline">
                                <CheckCheck size={14} /> Marcar todo leído
                            </button>
                        )}
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-100">
                        {avisos.length === 0 ? (
                            <div className="px-4 py-8 text-center text-sm text-zinc-400">No tenés avisos.</div>
                        ) : avisos.map((a) => (
                            <button
                                key={a.NotId}
                                onClick={() => abrirAviso(a)}
                                className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-zinc-50 transition-colors ${a.Leida ? '' : 'bg-brand-cyan/5'}`}
                            >
                                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${a.Leida ? 'bg-transparent' : 'bg-brand-magenta'}`} />
                                <span className="min-w-0 flex-1">
                                    <span className={`block text-sm leading-snug ${a.Leida ? 'text-zinc-600' : 'text-zinc-900 font-bold'}`}>{a.Titulo}</span>
                                    {a.Texto && <span className="block text-xs text-zinc-500 mt-0.5 line-clamp-2">{a.Texto}</span>}
                                    <span className="block text-[11px] text-zinc-400 mt-1">{hace(a.Fecha)}</span>
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Push en ESTE dispositivo */}
                    <div className="px-4 py-3 border-t border-zinc-100 bg-zinc-50">
                        {push === 'no-soportado' ? (
                            <p className="flex items-start gap-2 text-xs text-zinc-500">
                                <BellOff size={14} className="shrink-0 mt-0.5" />
                                Este navegador no recibe avisos push. En iPhone, instalá el sistema en la pantalla de inicio.
                            </p>
                        ) : push === 'bloqueado' ? (
                            <p className="flex items-start gap-2 text-xs text-zinc-500">
                                <BellOff size={14} className="shrink-0 mt-0.5" />
                                Los avisos están bloqueados para este sitio. Habilitalos en la configuración del navegador.
                            </p>
                        ) : (
                            <button
                                onClick={alternarPush}
                                disabled={activando}
                                className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 ${push === 'activo' ? 'text-zinc-500 hover:bg-zinc-200' : 'bg-brand-cyan text-white hover:bg-brand-cyan/90'}`}
                            >
                                {activando ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
                                {push === 'activo' ? 'Avisos activos en este dispositivo · desactivar' : 'Recibir avisos en este dispositivo'}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CampanaNotificaciones;
