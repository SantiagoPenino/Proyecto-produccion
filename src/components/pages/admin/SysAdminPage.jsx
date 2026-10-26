import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../../services/api';
import Swal from 'sweetalert2';
import { toast } from 'sonner';
import {
    Server, Cpu, HardDrive, Database, Wifi, Clock, RefreshCw,
    FileText, Search, Filter, Package,
    CreditCard, TrendingUp, AlertCircle, CheckCircle, Activity,
    Terminal as TerminalIcon, BarChart3, Loader2, XCircle,
    Users, Shield, Play, Power, Lock, Table2, Globe, Save,
    Bug, ChevronRight, ClipboardList, Trash2, ArrowDownToLine, Pause, ArrowRight
} from 'lucide-react';
import Selector from '../../ui/Selector';

// Estética nueva (22/10/2026, como Reportes y la Vista 360°): fondo claro, tarjetas blancas con borde, íconos de
// Lucide en brand-cyan sin fondo. El color queda para lo que significa algo: base online (emerald) / caída
// (magenta), nivel del log, resultado del login, y los medidores por umbral (brand-cyan → amber → magenta).
// Las 8 pestañas son pastillas en escritorio y un selector en el celular.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
// Destructivo (limpiar logs, reiniciar): gris que se pone magenta al pasar.
const BTN_PELIGRO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-400 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 transition-colors disabled:opacity-50';
const BTN_ICONO_PELIGRO = 'w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center text-zinc-400 hover:bg-brand-magenta/10 hover:text-brand-magenta transition-colors';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_FILTRO = CAMPO.replace('py-2.5', 'py-2'); // misma altura que los selectores de la barra
const ROTULO = 'text-[11px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap';
const CHIP_OK = 'bg-emerald-50 text-emerald-700 border-emerald-200';
const CHIP_ERROR = 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20';
const CHIP_AVISO = 'bg-amber-50 text-amber-700 border-amber-200';
const CHIP_INFO = 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20';
const CHIP_NEUTRO = 'bg-zinc-100 text-zinc-600 border-zinc-200';

// ─── HELPERS ─────────────────────────────────────────────
const formatBytes = (b) => {
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
    return (b / 1024).toFixed(0) + ' KB';
};

const formatUptime = (seconds) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

const timeAgo = (iso) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `hace ${Math.floor(diff)}s`;
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    return `hace ${Math.floor(diff / 86400)}d`;
};

// ─── VACÍO ───────────────────────────────────────────────
const Vacio = ({ icon: Icon, titulo, detalle }) => (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
        <Icon size={40} className="mb-3 text-brand-cyan" />
        <p className="text-sm font-bold text-zinc-700">{titulo}</p>
        {detalle && <p className="text-xs text-zinc-400 mt-1">{detalle}</p>}
    </div>
);

// ─── GAUGE ───────────────────────────────────────────────
// El anillo cambia por umbral: brand-cyan → amber (más de 65 %) → brand-magenta (más de 85 %).
const Gauge = ({ label, value, max = 100, unit = '%', icon: Icon, color = '#006E97' }) => {
    const pct = Math.min((value / max) * 100, 100);
    const gaugeColor = pct > 85 ? '#BD0C7E' : pct > 65 ? '#f59e0b' : color;
    return (
        <div className={`${CARD} p-5 flex flex-col items-center gap-3 min-w-0`}>
            <div className="flex items-center gap-2">
                {Icon && <Icon size={16} className="text-brand-cyan shrink-0" />}
                <span className="text-[11px] font-black uppercase tracking-widest text-zinc-400">{label}</span>
            </div>
            <div className="relative w-24 h-24">
                <svg viewBox="0 0 100 100" className="transform -rotate-90 w-full h-full">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#f4f4f5" strokeWidth="8" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke={gaugeColor} strokeWidth="8"
                        strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round"
                        className="transition-all duration-700" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-black text-zinc-900 tabular-nums">{typeof value === 'number' ? Math.round(value) : value}</span>
                    <span className="text-[10px] text-zinc-400 font-bold">{unit}</span>
                </div>
            </div>
        </div>
    );
};

// ─── STAT CARD ───────────────────────────────────────────
// tono: color del número (solo cuando significa algo, p. ej. entregadas / canceladas).
const StatCard = ({ label, value, sub, icon: Icon, tono = 'text-zinc-900', className = '' }) => (
    <div className={`${CARD} p-4 flex items-center gap-3 min-w-0 ${className}`}>
        {Icon && <Icon size={22} className="text-brand-cyan shrink-0" />}
        <div className="min-w-0">
            <p className="text-[11px] font-black text-zinc-400 uppercase tracking-wide truncate">{label}</p>
            <p className={`text-lg font-black truncate tabular-nums leading-tight mt-0.5 ${tono}`}>{value}</p>
            {sub && <p className="text-[11px] text-zinc-400">{sub}</p>}
        </div>
    </div>
);

// ─── MAIN ────────────────────────────────────────────────
const SysAdminPage = () => {
    const [tab, setTab] = useState('status');
    const [status, setStatus] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [logFiles, setLogFiles] = useState([]);
    const [selectedLog, setSelectedLog] = useState('');
    const [logLines, setLogLines] = useState([]);
    const [logFilter, setLogFilter] = useState('');
    const [logLevel, setLogLevel] = useState('');
    const [logLoading, setLogLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [followLog, setFollowLog] = useState(true);
    const [sessions, setSessions] = useState({ active: [], history: [] });
    const [sqlQuery, setSqlQuery] = useState('SELECT TOP 10 * FROM ');
    const [sqlResult, setSqlResult] = useState(null);
    const [sqlRunning, setSqlRunning] = useState(false);
    const [services, setServices] = useState([]);
    const [servicesLoading, setServicesLoading] = useState(false);
    const [tables, setTables] = useState([]);
    const [tableColumns, setTableColumns] = useState(null);
    const [selectedTable, setSelectedTable] = useState(null);
    const [tableFilter, setTableFilter] = useState('');
    const [clientErrors, setClientErrors] = useState({ errors: [], total: 0, recentCount: 0 });
    const [backupRunning, setBackupRunning] = useState(false);
    const [syncRunning, setSyncRunning] = useState(false);
    const [clearLogsRunning, setClearLogsRunning] = useState(false);
    const [auditEntries, setAuditEntries] = useState([]);
    const [auditFilter, setAuditFilter] = useState('');
    const [slowQueries, setSlowQueries] = useState([]);
    const logEndRef = useRef(null);
    const intervalRef = useRef(null);

    // ─── FETCH ───────────────────────────────────────────
    const fetchStatus = useCallback(async () => {
        try { const { data } = await api.get('/sysadmin/status'); setStatus(data); } catch (e) { console.error(e); }
    }, []);

    const fetchMetrics = useCallback(async () => {
        try {
            const [metricsRes, slowRes] = await Promise.all([
                api.get('/sysadmin/metrics'),
                api.get('/sysadmin/slow-queries')
            ]);
            setMetrics(metricsRes.data);
            setSlowQueries(slowRes.data.queries);
        } catch (e) { console.error(e); }
    }, []);

    const fetchSessions = useCallback(async () => {
        try { const { data } = await api.get('/sysadmin/sessions?limit=100'); setSessions(data); } catch (e) { console.error(e); }
    }, []);

    const handleKickSession = async (userId, username) => {
        const result = await Swal.fire({
            title: 'Expulsar Usuario',
            text: `¿Estás seguro de que querés cerrar la sesión de ${username}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, expulsar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#BD0C7E',
        });
        if (!result.isConfirmed) return;
        try {
            await api.delete(`/sysadmin/sessions/${userId}`);
            Swal.fire({ title: 'Expulsado', text: 'La sesión fue cerrada y el usuario fue desconectado.', icon: 'success', confirmButtonColor: '#006E97' });
            fetchSessions();
        } catch (e) {
            Swal.fire({ title: 'Error', text: e.response?.data?.error || e.message, icon: 'error', confirmButtonColor: '#006E97' });
        }
    };

    const fetchServices = async () => {
        setServicesLoading(true);
        try { const { data } = await api.get('/sysadmin/services'); setServices(data); } catch (e) { console.error(e); }
        finally { setServicesLoading(false); }
    };

    const fetchTables = async () => {
        try { const { data } = await api.get('/sysadmin/tables'); setTables(data.tables || []); } catch (e) { console.error(e); }
    };

    const fetchTableColumns = async (tableName) => {
        try {
            const { data } = await api.get(`/sysadmin/tables/${tableName}`);
            setTableColumns(data);
            setSelectedTable(tableName);
        } catch (e) { console.error(e); }
    };

    const fetchClientErrors = async () => {
        try { const { data } = await api.get('/sysadmin/client-errors'); setClientErrors(data); } catch (e) { console.error(e); }
    };

    const runBackup = async () => {
        const result = await Swal.fire({
            title: 'Ejecutar Backup',
            text: '¿Ejecutar el respaldo de la base de datos?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, ejecutar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#006E97',
        });
        if (!result.isConfirmed) return;
        setBackupRunning(true);
        try {
            // Corre en segundo plano en el servidor (el envío a la oficina puede tardar varios minutos):
            // se lanza y se consulta el estado hasta que termina.
            const { data: inicio } = await api.post('/sysadmin/backup');
            toast.info('Backup en curso: el backup y el envío a la oficina tardan unos minutos.');
            const desde = new Date(inicio.inicio).getTime();
            for (;;) {
                await new Promise(ok => setTimeout(ok, 5000));
                const { data: est } = await api.get('/sysadmin/backup/estado');
                const u = est.ultimo;
                if (!est.enCurso && u && new Date(u.inicio).getTime() >= desde - 1000) {
                    const tiempo = u.segundos >= 60 ? `${Math.floor(u.segundos / 60)} min ${u.segundos % 60} s` : `${u.segundos} s`;
                    if (u.ok) Swal.fire({ title: 'Backup completado', text: `Terminó en ${tiempo}.`, icon: 'success', confirmButtonColor: '#006E97' });
                    else Swal.fire({ icon: 'error', title: 'El backup falló', confirmButtonColor: '#006E97', html: `<p>Después de ${tiempo}. Lo último que dijo el script:</p><pre style="text-align:left;white-space:pre-wrap;font-size:12px;max-height:240px;overflow:auto">${(u.detalle || 'sin detalle').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>` });
                    break;
                }
            }
        } catch (e) {
            Swal.fire({ title: 'Error', text: e.response?.data?.error || e.message, icon: 'error', confirmButtonColor: '#006E97' });
        } finally { setBackupRunning(false); }
    };

    const handleClearLogs = async () => {
        const result = await Swal.fire({
            title: 'Limpiar Logs',
            text: '¿Seguro que querés vaciar los archivos de log? Esto liberará espacio en disco.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, limpiar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#BD0C7E',
        });
        if (!result.isConfirmed) return;
        setClearLogsRunning(true);
        try {
            const { data } = await api.post('/sysadmin/clear-logs');
            Swal.fire({ title: 'Logs Limpiados', text: data.message || 'Archivos vaciados correctamente', icon: 'success', confirmButtonColor: '#006E97' });
            fetchStatus(); // Refrescar el disco
            if (tab === 'logs') fetchLogFiles();
        } catch (e) {
            Swal.fire({ title: 'Error', text: e.response?.data?.error || e.message, icon: 'error', confirmButtonColor: '#006E97' });
        } finally { setClearLogsRunning(false); }
    };

    const handleSyncPrices = async () => {
        setSyncRunning(true);
        try {
            const { data } = await api.post('/admin/sync-precios');
            Swal.fire({ title: 'Sincronización Completada', text: `Insertados: ${data.inserted}, Actualizados: ${data.updated}, Total: ${data.synced} en ${data.duration}ms`, icon: 'success', confirmButtonColor: '#006E97' });
        } catch (e) {
            Swal.fire({ title: 'Error', text: e.response?.data?.error || 'Error al sincronizar precios', icon: 'error', confirmButtonColor: '#006E97' });
        } finally {
            setSyncRunning(false);
        }
    };

    const handleRestart = async () => {
        const result = await Swal.fire({
            title: 'Reiniciar Servidor',
            text: 'Ingresá la contraseña de administración',
            input: 'password',
            inputPlaceholder: 'Contraseña...',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Reiniciar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#BD0C7E',
            inputValidator: (value) => !value && 'Debés ingresar la contraseña',
        });
        if (!result.isConfirmed) return;
        try {
            await api.post('/sysadmin/restart', { password: result.value });
            Swal.fire({ title: 'Reiniciando...', text: 'El servidor se está reiniciando. Recargá la página en unos segundos.', icon: 'success', confirmButtonColor: '#006E97' });
        } catch (e) {
            Swal.fire({ title: 'Error', text: e.response?.data?.error || 'Error al reiniciar', icon: 'error', confirmButtonColor: '#006E97' });
        }
    };

    const handleMaintenance = async () => {
        const result = await Swal.fire({
            title: 'Aviso de mantenimiento',
            html:
                '<input id="swal-min" type="number" min="1" value="2" class="swal2-input" placeholder="Minutos">' +
                '<textarea id="swal-msg" class="swal2-textarea" placeholder="Mensaje (opcional)"></textarea>',
            focusConfirm: false,
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: 'Avisar a todos',
            denyButtonText: 'Ocultar aviso',
            cancelButtonText: 'Cerrar',
            confirmButtonColor: '#006E97',
            preConfirm: () => {
                const min = parseFloat(document.getElementById('swal-min').value);
                const msg = document.getElementById('swal-msg').value;
                if (!min || min <= 0) { Swal.showValidationMessage('Indicá los minutos'); return false; }
                return { segundos: Math.round(min * 60), mensaje: msg };
            }
        });
        try {
            if (result.isConfirmed) {
                await api.post('/sysadmin/maintenance', result.value);
                Swal.fire({ title: 'Aviso enviado', text: 'Todos los usuarios conectados ven la cuenta regresiva.', icon: 'success', confirmButtonColor: '#006E97' });
            } else if (result.isDenied) {
                await api.post('/sysadmin/maintenance', { cancel: true });
                Swal.fire({ title: 'Aviso ocultado', text: 'Se quitó el banner para todos.', icon: 'success', confirmButtonColor: '#006E97' });
            }
        } catch (e) {
            Swal.fire({ title: 'Error', text: e.response?.data?.error || 'No se pudo enviar el aviso', icon: 'error', confirmButtonColor: '#006E97' });
        }
    };

    const fetchAudit = async (action = '') => {
        try {
            const params = action ? `?action=${action}` : '';
            const { data } = await api.get(`/sysadmin/audit${params}`);
            setAuditEntries(data.entries || []);
        } catch (e) { console.error(e); }
    };

    const fetchLogFiles = useCallback(async () => {
        try {
            const { data } = await api.get('/sysadmin/logs');
            setLogFiles(data);
            if (data.length > 0 && !selectedLog) {
                const combined = data.find(f => f.name.includes('combined'));
                setSelectedLog(combined ? combined.name : data[0].name);
            }
        } catch (e) { console.error(e); }
    }, [selectedLog]);

    const fetchLogContent = useCallback(async (filename) => {
        if (!filename) return;
        setLogLoading(true);
        try {
            const params = new URLSearchParams({ lines: '500' });
            if (logFilter) params.append('filter', logFilter);
            if (logLevel) params.append('level', logLevel);
            const { data } = await api.get(`/sysadmin/logs/${filename}?${params}`);
            setLogLines(data.lines || []);
            setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        } catch (e) { console.error(e); }
        finally { setLogLoading(false); }
    }, [logFilter, logLevel]);

    useEffect(() => {
        const init = async () => {
            setLoading(true);
            await Promise.all([fetchStatus(), fetchMetrics(), fetchLogFiles(), fetchSessions()]);
            setLoading(false);
        };
        init();
    }, []);

    useEffect(() => {
        if (autoRefresh && tab === 'logs' && selectedLog) {
            intervalRef.current = setInterval(() => fetchLogContent(selectedLog), 5000);
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [autoRefresh, tab, selectedLog, fetchLogContent]);

    useEffect(() => {
        if (tab === 'logs' && selectedLog) fetchLogContent(selectedLog);
    }, [tab, selectedLog, logLevel]);

    useEffect(() => {
        if (tab === 'tables' && tables.length === 0) fetchTables();
        if (tab === 'errors') fetchClientErrors();
        if (tab === 'audit') fetchAudit(auditFilter);
        if (tab === 'sessions') fetchSessions();
        if (tab === 'metrics') fetchMetrics();
    }, [tab]);

    // ─── SQL Console ─────────────────────────────────────
    const runSql = async () => {
        if (!sqlQuery.trim()) return;
        setSqlRunning(true);
        setSqlResult(null);
        try {
            const { data } = await api.post('/sysadmin/sql', { query: sqlQuery });
            setSqlResult(data);
        } catch (e) {
            console.error('[SQL Console] Error:', e);
            const errMsg = e.response?.data?.error || e.response?.data?.message || e.message || 'Error desconocido';
            setSqlResult({ error: `Error: ${errMsg} (status: ${e.response?.status || 'N/A'})`, rows: [], columns: [] });
        } finally {
            setSqlRunning(false);
        }
    };


    // Nivel del log en color: error magenta, aviso amber, informativos brand-cyan / zinc.
    const colorForLevel = (line) => {
        if (line.includes('[ERROR]')) return 'text-brand-magenta';
        if (line.includes('[WARN]')) return 'text-amber-600';
        if (line.includes('[HTTP]')) return 'text-brand-cyan';
        if (line.includes('[AUDIT]')) return 'text-brand-cyan';
        if (line.includes('[SOCKET]')) return 'text-zinc-500';
        return 'text-zinc-700';
    };

    const tabs = [
        { id: 'status', label: 'Estado', icon: Activity },
        { id: 'logs', label: 'Logs', icon: TerminalIcon },
        { id: 'sessions', label: 'Sesiones', icon: Users },
        { id: 'sql', label: 'SQL', icon: Database },
        { id: 'tables', label: 'Tablas', icon: Table2 },

        { id: 'metrics', label: 'Métricas', icon: BarChart3 },
        { id: 'errors', label: 'Errores', icon: Bug },
        { id: 'audit', label: 'Auditoría', icon: ClipboardList },
    ];

    if (loading) {
        return (
            <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700">
                <div className="flex items-center justify-center gap-3 min-h-[60vh]">
                    <Loader2 className="animate-spin text-brand-cyan" size={30} />
                    <span className="text-sm text-zinc-400 font-medium">Cargando panel SysAdmin...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 font-sans">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <TerminalIcon size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">SysAdmin</h1>
                    <p className="text-sm text-zinc-500 mt-1">Panel de administración del sistema</p>
                </div>
                <div className="w-full sm:w-auto flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={handleSyncPrices} disabled={syncRunning}
                        className={BTN_SECUNDARIO}
                        title="Sincronizar Precios de Sheets" aria-label="Sincronizar Precios de Sheets">
                        {syncRunning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                        <span className="hidden md:inline">Sync precios</span>
                    </button>
                    <button type="button" onClick={runBackup} disabled={backupRunning}
                        className={BTN_SECUNDARIO}
                        title="Backup" aria-label="Backup">
                        {backupRunning ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    </button>
                    <button type="button" onClick={handleClearLogs} disabled={clearLogsRunning}
                        className={BTN_PELIGRO}
                        title="Limpiar Logs" aria-label="Limpiar Logs">
                        {clearLogsRunning ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                    <button type="button" onClick={handleMaintenance}
                        className={BTN_SECUNDARIO}
                        title="Avisar mantenimiento" aria-label="Avisar mantenimiento">
                        <AlertCircle size={15} />
                    </button>
                    <button type="button" onClick={handleRestart}
                        className={BTN_PELIGRO}
                        title="Reiniciar" aria-label="Reiniciar">
                        <Power size={15} />
                    </button>
                </div>
            </div>

            {/* Pestañas: pastillas en escritorio, selector en el celular */}
            <div className="mb-5">
                <div className="hidden md:inline-flex flex-wrap rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                    {tabs.map(t => (
                        <button key={t.id} type="button" onClick={() => setTab(t.id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${tab === t.id
                                ? 'bg-zinc-900 text-white'
                                : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}
                        >
                            <t.icon size={15} className={tab === t.id ? 'text-white' : 'text-brand-cyan'} /> {t.label}
                        </button>
                    ))}
                </div>
                <div className="md:hidden">
                    <Selector value={tab} onChange={e => setTab(e.target.value)} aria-label="Pestaña">
                        {tabs.map(t => (
                            <option key={t.id} value={t.id}>
                                <span className="inline-flex items-center gap-2"><t.icon size={15} className="shrink-0 text-brand-cyan" />{t.label}</span>
                            </option>
                        ))}
                    </Selector>
                </div>
            </div>

            {/* ═══ STATUS ═══ */}
            {tab === 'status' && status && (
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        <Gauge label="RAM" value={parseFloat(status.memory.percentUsed)} icon={HardDrive} />
                        <Gauge label="CPU" value={parseFloat(status.cpu.percentUsed)} icon={Cpu} />
                        <Gauge label="Disco" value={status.disk && status.disk.total > 0 ? ((status.disk.total - status.disk.free) / status.disk.total * 100) : 0} max={100} unit="%" icon={HardDrive} />
                        <Gauge label="Sockets" value={status.sockets} max={1000} unit="conn" icon={Wifi} />
                        <div className={`${CARD} col-span-2 lg:col-span-1 p-5 flex flex-col items-center gap-3 min-w-0`}>
                            <div className="flex items-center gap-2">
                                <Database size={16} className="text-brand-cyan shrink-0" />
                                <span className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Base de Datos</span>
                            </div>
                            <div className="h-24 flex items-center justify-center">
                                <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-lg font-black ${status.db.ok ? CHIP_OK : CHIP_ERROR}`}>
                                    {status.db.ok ? <CheckCircle size={18} /> : <XCircle size={18} />}
                                    {status.db.ok ? 'ONLINE' : 'ERROR'}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        <StatCard label="Uptime" value={formatUptime(status.uptime)} icon={Clock} />
                        <StatCard label="Reinicios PM2" value={status.pm2Restarts !== undefined ? status.pm2Restarts : '-'} icon={Activity} />
                        <StatCard label="Node.js" value={status.nodeVersion} icon={Server} />
                        <StatCard label="RAM Usada" value={formatBytes(status.memory.used)} sub={`de ${formatBytes(status.memory.total)}`} icon={HardDrive} />
                        <StatCard label="Tamaño DB" value={status.db.sizeMB ? `${status.db.sizeMB} MB` : '-'} icon={Database} className="col-span-2 lg:col-span-1" />
                    </div>
                    <button type="button" onClick={fetchStatus} className={`${BTN_SECUNDARIO} self-start`}>
                        <RefreshCw size={15} /> Actualizar
                    </button>
                </div>
            )}

            {/* ═══ LOGS ═══ */}
            {tab === 'logs' && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Selector filtro resaltar={false} value={selectedLog} onChange={e => setSelectedLog(e.target.value)} aria-label="Archivo de log" anchoLista={320}
                            renderValor={o => <span className="truncate">{o ? o.value : ' '}</span>}>
                            {logFiles.map(f => <option key={f.name} value={f.name}>{f.name} ({formatBytes(f.size)})</option>)}
                        </Selector>
                        <Selector filtro value={logLevel} onChange={e => setLogLevel(e.target.value)} aria-label="Nivel">
                            <option value="">Todos</option>
                            <option value="ERROR">ERROR</option>
                            <option value="WARN">WARN</option>
                            <option value="INFO">INFO</option>
                            <option value="HTTP">HTTP</option>
                            <option value="AUDIT">AUDIT</option>
                            <option value="SOCKET">SOCKET</option>
                        </Selector>
                        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                <input type="text" value={logFilter} onChange={e => setLogFilter(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && fetchLogContent(selectedLog)}
                                    placeholder="Buscar en logs..."
                                    className={CAMPO_FILTRO} />
                            </div>
                            <button type="button" onClick={() => fetchLogContent(selectedLog)} className={BTN_PRINCIPAL} title="Buscar" aria-label="Buscar"><Filter size={15} /></button>
                        </div>
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none px-1">
                            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-brand-cyan w-4 h-4" />
                            <span className="text-sm font-bold text-zinc-600">Auto</span>
                        </label>
                        <button type="button" onClick={() => fetchLogContent(selectedLog)} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar"><RefreshCw size={15} /></button>
                    </div>
                    <div className={`${CARD} overflow-hidden flex flex-col`} style={{ height: 'calc(100vh - 330px)', minHeight: 360 }}>
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-200 shrink-0">
                            <FileText size={15} className="text-brand-cyan shrink-0" />
                            <span className="text-xs text-zinc-600 font-mono truncate min-w-0">{selectedLog || 'No file'}</span>
                            <span className="text-[11px] text-zinc-400 ml-auto tabular-nums whitespace-nowrap">{logLines.length} líneas</span>
                            {logLoading && <Loader2 size={13} className="animate-spin text-brand-cyan shrink-0" />}
                            <button type="button" onClick={() => setFollowLog(f => !f)} title={followLog ? 'Pausar scroll' : 'Seguir al final'}
                                className={`${CHIP} shrink-0 transition-colors ${followLog ? CHIP_INFO : `${CHIP_NEUTRO} hover:text-zinc-800`}`}>
                                {followLog ? <><ArrowDownToLine size={12} /> Follow</> : <><Pause size={12} /> Pausado</>}
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-zinc-50 font-mono text-[11px] leading-relaxed text-zinc-700">
                            {logLines.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center font-sans">
                                    <FileText size={40} className="mb-3 text-brand-cyan" />
                                    <p className="text-sm font-bold text-zinc-700">Sin logs</p>
                                    <p className="text-xs text-zinc-400 mt-1">Probá con otro archivo, nivel o búsqueda.</p>
                                </div>
                            ) : logLines.map((line, i) => (
                                <div key={i} className={`py-0.5 rounded hover:bg-zinc-100 ${colorForLevel(line)}`}>
                                    <span className="text-zinc-400 select-none mr-3">{String(i + 1).padStart(4, ' ')}</span>{line}
                                </div>
                            ))}
                            <div ref={el => { logEndRef.current = el; if (followLog && el) el.scrollIntoView({ behavior: 'smooth' }); }} />
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ SESSIONS ═══ */}
            {tab === 'sessions' && (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className={ROTULO}><Shield size={14} className="text-brand-cyan" /> Sesiones Activas ({sessions.active.length})</h3>
                        <button type="button" onClick={fetchSessions} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar"><RefreshCw size={15} /></button>
                    </div>
                    {sessions.active.length > 0 ? (
                        <div className="flex flex-col gap-4">
                            {sessions.active.some(s => ['INTERNAL', 'ADMIN'].includes(s.userType?.toUpperCase())) && (
                                <div>
                                    <h4 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">Personal Interno</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {sessions.active.filter(s => ['INTERNAL', 'ADMIN'].includes(s.userType?.toUpperCase())).map((s, i) => (
                                            <div key={`int-${i}`} className={`${CARD} p-4 flex items-center gap-3 min-w-0`}>
                                                <div className="w-9 h-9 shrink-0 rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center font-black text-sm">
                                                    {(s.username || '?')[0].toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold text-zinc-800 truncate">{s.username}</p>
                                                    <p className="text-[11px] text-zinc-400 truncate">{s.ip} · {s.userType} · {timeAgo(s.loginAt)}</p>
                                                </div>
                                                <button type="button" onClick={() => handleKickSession(s.userId, s.username)} className={BTN_ICONO_PELIGRO} title="Expulsar" aria-label="Expulsar">
                                                    <XCircle size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {sessions.active.some(s => !['INTERNAL', 'ADMIN'].includes(s.userType?.toUpperCase())) && (
                                <div>
                                    <h4 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">Clientes Web</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {sessions.active.filter(s => !['INTERNAL', 'ADMIN'].includes(s.userType?.toUpperCase())).map((s, i) => (
                                            <div key={`cli-${i}`} className={`${CARD} p-4 flex items-center gap-3 min-w-0`}>
                                                <div className="w-9 h-9 shrink-0 rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center font-black text-sm">
                                                    {(s.username || '?')[0].toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold text-zinc-800 truncate">{s.username}</p>
                                                    <p className="text-[11px] text-zinc-400 truncate">{s.ip} · {s.userType} · {timeAgo(s.loginAt)}</p>
                                                </div>
                                                <button type="button" onClick={() => handleKickSession(s.userId, s.username)} className={BTN_ICONO_PELIGRO} title="Expulsar" aria-label="Expulsar">
                                                    <XCircle size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className={CARD}>
                            <Vacio icon={Users} titulo="No hay sesiones activas registradas" />
                        </div>
                    )}

                    <h3 className={`${ROTULO} mt-2`}><Clock size={14} className="text-brand-cyan" /> Historial de Logins</h3>
                    <div className={`${CARD} overflow-hidden`}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                    <tr>
                                        <th className={TH}>Fecha</th>
                                        <th className={TH}>Usuario</th>
                                        <th className={TH}>IP</th>
                                        <th className={TH}>Tipo</th>
                                        <th className={TH}>Estado</th>
                                        <th className={TH}>Detalle</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {sessions.history.slice(0, 50).map((h, i) => (
                                        <tr key={i} className="hover:bg-zinc-50">
                                            <td className="px-4 py-2.5 text-zinc-600 font-mono whitespace-nowrap tabular-nums">{new Date(h.timestamp).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                                            <td className="px-4 py-2.5 font-bold text-zinc-800 whitespace-nowrap">{h.username}</td>
                                            <td className="px-4 py-2.5 text-zinc-500 font-mono">{h.ip}</td>
                                            <td className="px-4 py-2.5"><span className={`${CHIP} ${CHIP_NEUTRO}`}>{h.userType}</span></td>
                                            <td className="px-4 py-2.5">
                                                {h.success
                                                    ? <span className={`${CHIP} ${CHIP_OK}`}><CheckCircle size={12} /> OK</span>
                                                    : <span className={`${CHIP} ${CHIP_ERROR}`}><XCircle size={12} /> FAIL</span>}
                                            </td>
                                            <td className="px-4 py-2.5 text-zinc-400 truncate max-w-[200px]">{h.reason}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {sessions.history.length === 0 && <Vacio icon={Clock} titulo="Sin historial de logins" />}
                    </div>
                </div>
            )}

            {/* ═══ SQL CONSOLE ═══ */}
            {tab === 'sql' && (
                <div className="flex flex-col gap-3">
                    <div className={`${CARD} p-4 flex flex-col gap-3`}>
                        {/* Snippets: elegir uno lo copia al editor (el selector vuelve a «Seleccionar…») */}
                        <Selector value="" onChange={(e) => { if (e.target.value) setSqlQuery(e.target.value); }}
                            aria-label="Snippet rápido" className="sm:max-w-xs" anchoLista={300}>
                            <option value="" disabled>Seleccionar Snippet Rápido...</option>
                            <option value="SELECT TOP 50 * FROM OrdenesDeposito ORDER BY OrdFechaIngreso DESC">Últimas 50 Órdenes</option>
                            <option value="SELECT TOP 50 * FROM Pagos ORDER BY PagFechaPago DESC">Últimos Pagos</option>
                            <option value="SELECT UsuTipoUsuario, COUNT(*) as Total FROM Usuarios GROUP BY UsuTipoUsuario">Tipos de Usuarios</option>
                            <option value="SELECT * FROM Ordenes WHERE Estado = 'PENDIENTE' AND FechaIngreso < DATEADD(day, -3, GETDATE())">Órdenes trancadas (&gt;3 días)</option>
                        </Selector>
                        <textarea value={sqlQuery} onChange={e => setSqlQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSql(); }}
                            onFocus={() => { if (sqlQuery === 'SELECT TOP 10 * FROM ') setSqlQuery(''); }}
                            rows={4} spellCheck={false}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-4 font-mono text-xs text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 resize-none"
                            placeholder="SELECT TOP 10 * FROM ..." />
                        <div className="flex items-center gap-3 flex-wrap">
                            <button type="button" onClick={runSql} disabled={sqlRunning} className={BTN_PRINCIPAL}>
                                {sqlRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                                {sqlRunning ? 'Ejecutando...' : 'Ejecutar (Ctrl+Enter)'}
                            </button>
                            <span className="text-[11px] text-zinc-400 flex items-center gap-1"><Lock size={12} className="text-brand-cyan" /> Solo SELECT — lectura</span>
                            {sqlResult?.duration != null && (
                                <span className="text-[11px] text-zinc-500 ml-auto tabular-nums">{sqlResult.rowCount} filas · {sqlResult.duration}ms</span>
                            )}
                        </div>
                    </div>

                    {sqlResult?.error && (
                        <div className="bg-brand-magenta/10 border border-brand-magenta/20 rounded-xl p-4 text-brand-magenta text-xs font-mono break-words">{sqlResult.error}</div>
                    )}

                    {sqlResult && !sqlResult.error && sqlResult.rows?.length === 0 && (
                        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-zinc-500 text-xs font-bold flex items-center gap-2">
                            Consulta ejecutada — 0 filas retornadas ({sqlResult.duration}ms)
                        </div>
                    )}

                    {sqlResult?.rows?.length > 0 && (
                        <div className={`${CARD} overflow-hidden`}>
                            <div className="overflow-x-auto max-h-[50vh]">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 z-10 bg-zinc-50">
                                        <tr className="border-b border-zinc-200">
                                            {sqlResult.columns.map(col => <th key={col} className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap">{col}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {sqlResult.rows.map((row, i) => (
                                            <tr key={i} className="hover:bg-zinc-50">
                                                {sqlResult.columns.map(col => (
                                                    <td key={col} className="px-3 py-2 text-zinc-700 font-mono whitespace-nowrap max-w-[300px] truncate">
                                                        {row[col] === null ? <span className="text-zinc-400 italic">NULL</span> : String(row[col])}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ METRICS ═══ */}
            {tab === 'metrics' && metrics && (
                <div className="flex flex-col gap-5">
                    <div>
                        <h3 className={`${ROTULO} mb-3`}><Package size={14} className="text-brand-cyan" /> Órdenes del día</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            <StatCard label="Total" value={metrics.orders.total || 0} icon={Package} />
                            <StatCard label="Ingresadas" value={metrics.orders.ingresadas || 0} icon={AlertCircle} />
                            <StatCard label="Empaquetadas" value={metrics.orders.empaquetadas || 0} icon={Package} />
                            <StatCard label="Entregadas" value={metrics.orders.entregadas || 0} icon={CheckCircle} tono="text-emerald-600" />
                            <StatCard label="Autorizadas" value={metrics.orders.autorizadas || 0} icon={TrendingUp} />
                            <StatCard label="Canceladas" value={metrics.orders.canceladas || 0} icon={XCircle} tono="text-brand-magenta" />
                        </div>
                    </div>
                    <div>
                        <h3 className={`${ROTULO} mb-3`}><CreditCard size={14} className="text-brand-cyan" /> Pagos del día</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <StatCard label="Cantidad" value={metrics.payments.cantidad || 0} icon={CreditCard} className="col-span-2 md:col-span-1" />
                            <StatCard label="Total UYU" value={`$ ${Number(metrics.payments.totalUYU || 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })}`} icon={CreditCard} />
                            <StatCard label="Total USD" value={`US$ ${Number(metrics.payments.totalUSD || 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })}`} icon={CreditCard} />
                        </div>
                    </div>
                    {slowQueries && slowQueries.length > 0 && (
                        <div>
                            <h3 className={`${ROTULO} mb-3`}><Activity size={14} className="text-brand-cyan" /> Consultas SQL más Lentas</h3>
                            <div className={`${CARD} overflow-hidden`}>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-zinc-50 border-b border-zinc-200">
                                            <tr>
                                                <th className={TH}>Query</th>
                                                <th className={TH}>Ejecuciones</th>
                                                <th className={TH}>Promedio (ms)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100">
                                            {slowQueries.map((sq, i) => (
                                                <tr key={i} className="hover:bg-zinc-50">
                                                    <td className="px-4 py-2 font-mono text-[10px] text-zinc-600 max-w-[800px] truncate" title={sq.query_text}>{sq.query_text}</td>
                                                    <td className="px-4 py-2 text-zinc-600 font-bold tabular-nums">{sq.execution_count}</td>
                                                    <td className="px-4 py-2 text-zinc-900 font-black tabular-nums">{sq.avg_duration_ms}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                    <button type="button" onClick={fetchMetrics} className={`${BTN_SECUNDARIO} self-start`}>
                        <RefreshCw size={15} /> Actualizar
                    </button>
                </div>
            )}



            {/* ═══ TABLES ═══ */}
            {tab === 'tables' && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className={ROTULO}><Table2 size={14} className="text-brand-cyan" /> Tablas de la Base de Datos ({tables.length})</h3>
                        <button type="button" onClick={fetchTables} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar"><RefreshCw size={15} /></button>
                    </div>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input type="text" value={tableFilter} onChange={e => setTableFilter(e.target.value)} placeholder="Filtrar tablas..."
                            className={CAMPO} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                        {tables.filter(t => !tableFilter || t.name.toLowerCase().includes(tableFilter.toLowerCase())).map(t => (
                            <button key={t.name} type="button" onClick={() => fetchTableColumns(t.name)}
                                className={`flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border text-left transition-colors min-w-0 ${selectedTable === t.name ? 'border-brand-cyan bg-brand-cyan/5' : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'}`}>
                                <span className={`text-sm font-bold truncate ${selectedTable === t.name ? 'text-brand-cyan' : 'text-zinc-800'}`}>{t.name}</span>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-[11px] text-zinc-400 tabular-nums">{t.rowCount} filas</span>
                                    <span className="text-[11px] text-zinc-400 tabular-nums">{t.sizeMB} MB</span>
                                    <ChevronRight size={14} className={selectedTable === t.name ? 'text-brand-cyan' : 'text-zinc-300'} />
                                </div>
                            </button>
                        ))}
                    </div>
                    {tableColumns && (
                        <div className={`${CARD} overflow-hidden`}>
                            <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between gap-3 flex-wrap">
                                <span className="text-sm font-black text-zinc-800 min-w-0 break-all">{tableColumns.table} <span className="font-bold text-zinc-400">— {tableColumns.columns.length} columnas</span></span>
                                <button type="button" onClick={() => { setSqlQuery(`SELECT TOP 20 * FROM ${tableColumns.table}`); setTab('sql'); }}
                                    className={BTN_SECUNDARIO}>
                                    Abrir en SQL <ArrowRight size={15} />
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-zinc-50 border-b border-zinc-200">
                                        <tr>
                                            <th className={TH}>Columna</th>
                                            <th className={TH}>Tipo</th>
                                            <th className={TH}>Max</th>
                                            <th className={TH}>Nulo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {tableColumns.columns.map((c, i) => (
                                            <tr key={i} className="hover:bg-zinc-50">
                                                <td className="px-4 py-2 font-bold text-zinc-800">{c.name}</td>
                                                <td className="px-4 py-2 text-brand-cyan font-mono">{c.type}</td>
                                                <td className="px-4 py-2 text-zinc-400 tabular-nums">{c.maxLength || '-'}</td>
                                                <td className="px-4 py-2 text-zinc-400">{c.nullable}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ CLIENT ERRORS ═══ */}
            {tab === 'errors' && (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className={`${ROTULO} flex-wrap`}>
                            <Bug size={14} className="text-brand-cyan" /> Errores del Frontend
                            {clientErrors.recentCount > 0 && <span className={`${CHIP} ${CHIP_ERROR} normal-case tracking-normal`}>{clientErrors.recentCount} recientes (5m)</span>}
                        </h3>
                        <button type="button" onClick={fetchClientErrors} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar"><RefreshCw size={15} /></button>
                    </div>
                    {clientErrors.alertActive && (
                        <div className="bg-brand-magenta/10 border border-brand-magenta/20 rounded-xl px-4 py-3 text-brand-magenta text-sm font-bold flex items-center gap-2">
                            <AlertCircle size={16} className="shrink-0" /> Alerta activa: muchos errores en los últimos 5 minutos
                        </div>
                    )}
                    {clientErrors.errors.length === 0 ? (
                        <div className={CARD}>
                            <Vacio icon={Bug} titulo="No hay errores registrados." detalle="Hacé clic en Actualizar." />
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                            {clientErrors.errors.map((e, i) => (
                                <div key={i} className={`${CARD} p-4`}>
                                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-0.5 sm:gap-3 mb-1">
                                        <span className="text-sm font-bold text-brand-magenta truncate sm:flex-1 min-w-0">{e.message}</span>
                                        <span className="text-[11px] text-zinc-400 shrink-0 tabular-nums">{new Date(e.timestamp).toLocaleString('es-UY')}</span>
                                    </div>
                                    <p className="text-[11px] text-zinc-500 break-all">url: {e.url} · ip: {e.ip} · user: {e.userId || '-'}</p>
                                    {e.stack && <pre className="mt-2 text-[11px] font-mono text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl p-3 overflow-x-auto max-h-24">{e.stack}</pre>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ═══ AUDIT TRAIL ═══ */}
            {tab === 'audit' && (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className={ROTULO}>
                            <ClipboardList size={14} className="text-brand-cyan" /> Auditoría ({auditEntries.length} registros)
                        </h3>
                        <div className="flex items-center gap-2">
                            <Selector filtro value={auditFilter} onChange={e => { setAuditFilter(e.target.value); fetchAudit(e.target.value); }} aria-label="Acción">
                                <option value="">Todas las acciones</option>
                                <option value="LOGIN">LOGIN</option>
                                <option value="SQL_CONSOLE">SQL_CONSOLE</option>
                                <option value="SERVER_RESTART">SERVER_RESTART</option>
                                <option value="DB_BACKUP">DB_BACKUP</option>
                            </Selector>
                            <button type="button" onClick={() => fetchAudit(auditFilter)} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar"><RefreshCw size={15} /></button>
                        </div>
                    </div>
                    {auditEntries.length === 0 ? (
                        <div className={CARD}>
                            <Vacio icon={ClipboardList} titulo="No hay registros de auditoría." />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {auditEntries.map((e, i) => {
                                // Login OK emerald / fallido magenta; reinicio amber (aviso); consola SQL y backup brand-cyan (informativo).
                                const actionColors = {
                                    LOGIN: e.details.result === 'OK' ? CHIP_OK : CHIP_ERROR,
                                    SQL_CONSOLE: CHIP_INFO,
                                    SERVER_RESTART: CHIP_AVISO,
                                    DB_BACKUP: CHIP_INFO,
                                };
                                return (
                                    <div key={i} className={`${CARD} px-4 py-3 flex items-start gap-x-4 gap-y-2 flex-wrap sm:flex-nowrap`}>
                                        <span className={`${CHIP} uppercase ${actionColors[e.action] || CHIP_NEUTRO}`}>
                                            {e.action}
                                        </span>
                                        <div className="order-last sm:order-none w-full sm:w-auto sm:flex-1 min-w-0 sm:pt-0.5">
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-700">
                                                {e.details.user && <span><strong className="font-bold text-zinc-400">Usuario:</strong> {e.details.user}</span>}
                                                {e.details.ip && <span><strong className="font-bold text-zinc-400">IP:</strong> {e.details.ip}</span>}
                                                {e.details.result && <span><strong className="font-bold text-zinc-400">Resultado:</strong> {e.details.result}</span>}
                                                {e.details.query && <span className="truncate max-w-[300px]" title={e.details.query}><strong className="font-bold text-zinc-400">Query:</strong> {e.details.query}</span>}
                                                {e.details.script && <span><strong className="font-bold text-zinc-400">Script:</strong> {e.details.script}</span>}
                                                {e.details.type && <span><strong className="font-bold text-zinc-400">Tipo:</strong> {e.details.type}</span>}
                                            </div>
                                        </div>
                                        <span className="ml-auto sm:ml-0 sm:pt-0.5 text-[11px] text-zinc-400 whitespace-nowrap shrink-0 tabular-nums">{e.timestamp}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SysAdminPage;
