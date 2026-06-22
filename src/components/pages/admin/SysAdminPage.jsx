import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../../services/api';
import Swal from 'sweetalert2';
import {
    Server, Cpu, HardDrive, Database, Wifi, Clock, RefreshCw,
    FileText, Search, Filter, ChevronDown, Package,
    CreditCard, TrendingUp, AlertCircle, CheckCircle, Activity,
    Terminal as TerminalIcon, BarChart3, Loader2, XCircle,
    Users, Shield, Play, Power, Lock, Table2, Globe, Save,
    Bug, ChevronRight, ClipboardList, Trash2
} from 'lucide-react';

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

// ─── GAUGE ───────────────────────────────────────────────
const Gauge = ({ label, value, max = 100, unit = '%', icon: Icon, color = '#00B4D8' }) => {
    const pct = Math.min((value / max) * 100, 100);
    const gaugeColor = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : color;
    return (
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-zinc-400">
                {Icon && <Icon size={16} />}
                <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
            </div>
            <div className="relative w-24 h-24">
                <svg viewBox="0 0 100 100" className="transform -rotate-90 w-full h-full">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#27272a" strokeWidth="8" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke={gaugeColor} strokeWidth="8"
                        strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round"
                        className="transition-all duration-700" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-black text-white">{typeof value === 'number' ? Math.round(value) : value}</span>
                    <span className="text-[10px] text-zinc-500 font-bold">{unit}</span>
                </div>
            </div>
        </div>
    );
};

// ─── STAT CARD ───────────────────────────────────────────
const StatCard = ({ label, value, sub, icon: Icon, color = 'text-cyan-400' }) => (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 flex items-center gap-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-zinc-800 ${color}`}>
            {Icon && <Icon size={20} />}
        </div>
        <div className="min-w-0">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{label}</p>
            <p className="text-lg font-black text-white truncate">{value}</p>
            {sub && <p className="text-[10px] text-zinc-500">{sub}</p>}
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
            confirmButtonColor: '#ef4444',
        });
        if (!result.isConfirmed) return;
        try {
            await api.delete(`/sysadmin/sessions/${userId}`);
            Swal.fire('Expulsado', 'La sesión fue cerrada y el usuario fue desconectado.', 'success');
            fetchSessions();
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || e.message, 'error');
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
            confirmButtonColor: '#3b82f6',
        });
        if (!result.isConfirmed) return;
        setBackupRunning(true);
        try {
            const { data } = await api.post('/sysadmin/backup');
            Swal.fire('Backup completado', data.output || 'Respaldo generado correctamente', 'success');
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || e.message, 'error');
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
            confirmButtonColor: '#eab308',
        });
        if (!result.isConfirmed) return;
        setClearLogsRunning(true);
        try {
            const { data } = await api.post('/sysadmin/clear-logs');
            Swal.fire('Logs Limpiados', data.message || 'Archivos vaciados correctamente', 'success');
            fetchStatus(); // Refrescar el disco
            if (tab === 'logs') fetchLogFiles();
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || e.message, 'error');
        } finally { setClearLogsRunning(false); }
    };

    const handleSyncPrices = async () => {
        setSyncRunning(true);
        try {
            const { data } = await api.post('/admin/sync-precios');
            Swal.fire('Sincronización Completada', `Insertados: ${data.inserted}, Actualizados: ${data.updated}, Total: ${data.synced} en ${data.duration}ms`, 'success');
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'Error al sincronizar precios', 'error');
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
            confirmButtonColor: '#ef4444',
            inputValidator: (value) => !value && 'Debés ingresar la contraseña',
        });
        if (!result.isConfirmed) return;
        try {
            await api.post('/sysadmin/restart', { password: result.value });
            Swal.fire('Reiniciando...', 'El servidor se está reiniciando. Recargá la página en unos segundos.', 'success');
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'Error al reiniciar', 'error');
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


    const colorForLevel = (line) => {
        if (line.includes('[ERROR]')) return 'text-red-400';
        if (line.includes('[WARN]')) return 'text-yellow-400';
        if (line.includes('[HTTP]')) return 'text-cyan-400';
        if (line.includes('[AUDIT]')) return 'text-purple-400';
        if (line.includes('[SOCKET]')) return 'text-green-400';
        if (line.includes('[SLOW_QUERY]')) return 'text-orange-400';
        return 'text-zinc-300';
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
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="animate-spin text-cyan-500" size={40} />
                <span className="ml-3 text-zinc-400 font-medium">Cargando panel SysAdmin...</span>
            </div>
        );
    }

    return (
        <div className="min-h-full flex flex-col gap-4 font-sans">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <TerminalIcon size={24} style={{ color: '#DCB308' }} />
                    <div>
                        <h1 className="text-xl font-black text-zinc-800 uppercase tracking-wider">SysAdmin</h1>
                        <p className="text-xs text-zinc-400 uppercase tracking-wider">Panel de administración del sistema</p>
                    </div>
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5 flex-wrap">
                    {tabs.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all
                                ${tab === t.id
                                    ? 'bg-zinc-900 text-white shadow-lg'
                                    : 'bg-white text-zinc-500 hover:bg-zinc-100 border border-zinc-200'}`}
                        >
                            <t.icon size={13} /> {t.label}
                        </button>
                    ))}
                </div>
                <div className="w-px h-8 bg-zinc-300" />
                <div className="flex items-center gap-2">
                    <button onClick={handleSyncPrices} disabled={syncRunning}
                        className="p-2 disabled:opacity-50 transition-all hover:bg-zinc-100 rounded-xl flex items-center gap-2 font-bold text-xs"
                        title="Sincronizar Precios de Sheets">
                        {syncRunning ? <Loader2 size={18} className="animate-spin" style={{ color: '#00B4D8' }} /> : <RefreshCw size={18} style={{ color: '#00B4D8' }} />}
                        <span className="hidden md:inline" style={{ color: '#00B4D8' }}>SYNC PRECIOS</span>
                    </button>
                    <button onClick={runBackup} disabled={backupRunning}
                        className="p-2 disabled:opacity-50 transition-all hover:bg-zinc-100 rounded-xl"
                        title="Backup">
                        {backupRunning ? <Loader2 size={24} className="animate-spin" style={{ color: '#00B4D8' }} /> : <Save size={24} style={{ color: '#00B4D8' }} />}
                    </button>
                    <button onClick={handleClearLogs} disabled={clearLogsRunning}
                        className="p-2 disabled:opacity-50 transition-all hover:bg-zinc-100 rounded-xl"
                        title="Limpiar Logs">
                        {clearLogsRunning ? <Loader2 size={24} className="animate-spin" style={{ color: '#eab308' }} /> : <Trash2 size={24} style={{ color: '#eab308' }} />}
                    </button>
                    <button onClick={handleRestart}
                        className="p-2 transition-all hover:bg-zinc-100 rounded-xl"
                        title="Reiniciar">
                        <Power size={24} style={{ color: '#BD0C7E' }} />
                    </button>
                </div>
            </div>

            {/* ═══ STATUS ═══ */}
            {tab === 'status' && status && (
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <Gauge label="RAM" value={parseFloat(status.memory.percentUsed)} icon={HardDrive} color="#00B4D8" />
                        <Gauge label="CPU" value={parseFloat(status.cpu.percentUsed)} icon={Cpu} color="#BD0C7E" />
                        <Gauge label="Disco" value={status.disk && status.disk.total > 0 ? ((status.disk.total - status.disk.free) / status.disk.total * 100) : 0} max={100} unit="%" icon={HardDrive} color="#eab308" />
                        <Gauge label="Sockets" value={status.sockets} max={500} unit="conn" icon={Wifi} color="#DCB308" />
                        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800 flex flex-col items-center justify-center gap-2">
                            <Database size={20} className={status.db.ok ? 'text-emerald-400' : 'text-red-400'} />
                            <span className="text-xs font-bold text-zinc-400 uppercase">Base de Datos</span>
                            <span className={`text-lg font-black ${status.db.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                                {status.db.ok ? 'ONLINE' : 'ERROR'}
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <StatCard label="Uptime" value={formatUptime(status.uptime)} icon={Clock} />
                        <StatCard label="Reinicios PM2" value={status.pm2Restarts !== undefined ? status.pm2Restarts : '-'} icon={Activity} color="text-yellow-400" />
                        <StatCard label="Node.js" value={status.nodeVersion} icon={Server} color="text-emerald-400" />
                        <StatCard label="RAM Usada" value={formatBytes(status.memory.used)} sub={`de ${formatBytes(status.memory.total)}`} icon={HardDrive} color="text-cyan-400" />
                        <StatCard label="Tamaño DB" value={status.db.sizeMB ? `${status.db.sizeMB} MB` : '-'} icon={Database} color="text-purple-400" />
                    </div>
                    <button onClick={fetchStatus} className="self-start flex items-center gap-2 px-4 py-2 bg-zinc-200 hover:bg-zinc-300 rounded-xl text-xs font-bold text-zinc-600 transition-all">
                        <RefreshCw size={14} /> Actualizar
                    </button>
                </div>
            )}

            {/* ═══ LOGS ═══ */}
            {tab === 'logs' && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative">
                            <select value={selectedLog} onChange={e => setSelectedLog(e.target.value)}
                                className="bg-zinc-900 text-white border border-zinc-700 rounded-xl px-4 py-2.5 text-xs font-bold appearance-none pr-8 outline-none focus:border-cyan-500">
                                {logFiles.map(f => <option key={f.name} value={f.name}>{f.name} ({formatBytes(f.size)})</option>)}
                            </select>
                            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                        <select value={logLevel} onChange={e => setLogLevel(e.target.value)}
                            className="bg-zinc-900 text-white border border-zinc-700 rounded-xl px-4 py-2.5 text-xs font-bold appearance-none outline-none focus:border-cyan-500">
                            <option value="">Todos</option>
                            <option value="ERROR">ERROR</option>
                            <option value="WARN">WARN</option>
                            <option value="INFO">INFO</option>
                            <option value="HTTP">HTTP</option>
                            <option value="AUDIT">AUDIT</option>
                            <option value="SOCKET">SOCKET</option>
                            <option value="SLOW_QUERY">SLOW_QUERY</option>
                        </select>
                        <div className="flex items-center gap-1 flex-1 min-w-[200px]">
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input type="text" value={logFilter} onChange={e => setLogFilter(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && fetchLogContent(selectedLog)}
                                    placeholder="Buscar en logs..."
                                    className="w-full bg-zinc-900 text-white border border-zinc-700 rounded-xl pl-9 pr-4 py-2.5 text-xs outline-none focus:border-cyan-500" />
                            </div>
                            <button onClick={() => fetchLogContent(selectedLog)} className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold"><Filter size={14} /></button>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-cyan-500 w-4 h-4" />
                            <span className="text-xs font-bold text-zinc-500">Auto</span>
                        </label>
                        <button onClick={() => fetchLogContent(selectedLog)} className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2.5 rounded-xl text-xs font-bold"><RefreshCw size={14} /></button>
                    </div>
                    <div className="bg-zinc-950 rounded-2xl border border-zinc-800 overflow-hidden" style={{ height: 'calc(100vh - 280px)' }}>
                        <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
                            <div className="flex gap-1.5"><div className="w-3 h-3 rounded-full bg-red-500/80" /><div className="w-3 h-3 rounded-full bg-yellow-500/80" /><div className="w-3 h-3 rounded-full bg-green-500/80" /></div>
                            <span className="text-[10px] text-zinc-500 font-mono ml-2">{selectedLog || 'No file'}</span>
                            {logLoading && <Loader2 size={12} className="animate-spin text-cyan-400 ml-auto" />}
                            <span className="text-[10px] text-zinc-600 ml-auto">{logLines.length} líneas</span>
                            <button onClick={() => setFollowLog(f => !f)} title={followLog ? 'Pausar scroll' : 'Seguir al final'}
                                className={`ml-2 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${followLog ? 'bg-cyan-600 text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                                {followLog ? '▼ Follow' : '⏸ Pausado'}
                            </button>
                        </div>
                        <div className="overflow-y-auto p-4 font-mono text-[11px] leading-relaxed" style={{ height: 'calc(100% - 36px)' }}>
                            {logLines.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                                    <FileText size={40} className="mb-3" /><p className="text-sm font-bold">Sin logs</p>
                                </div>
                            ) : logLines.map((line, i) => (
                                <div key={i} className={`py-0.5 hover:bg-zinc-900/50 ${colorForLevel(line)}`}>
                                    <span className="text-zinc-600 select-none mr-3">{String(i + 1).padStart(4, ' ')}</span>{line}
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
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Shield size={14} /> Sesiones Activas ({sessions.active.length})</h3>
                        <button onClick={fetchSessions} className="flex items-center gap-2 px-3 py-2 bg-zinc-200 hover:bg-zinc-300 rounded-xl text-xs font-bold text-zinc-600"><RefreshCw size={14} /></button>
                    </div>
                    {sessions.active.length > 0 ? (
                        <div className="flex flex-col gap-4">
                            {sessions.active.some(s => ['INTERNAL', 'ADMIN'].includes(s.userType?.toUpperCase())) && (
                                <div>
                                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Personal Interno</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {sessions.active.filter(s => ['INTERNAL', 'ADMIN'].includes(s.userType?.toUpperCase())).map((s, i) => (
                                            <div key={`int-${i}`} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-black text-sm">
                                                    {(s.username || '?')[0].toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold text-zinc-800 truncate">{s.username}</p>
                                                    <p className="text-[10px] text-zinc-400">{s.ip} · {s.userType} · {timeAgo(s.loginAt)}</p>
                                                </div>
                                                <button onClick={() => handleKickSession(s.userId, s.username)} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors" title="Expulsar">
                                                    <XCircle size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {sessions.active.some(s => !['INTERNAL', 'ADMIN'].includes(s.userType?.toUpperCase())) && (
                                <div>
                                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Clientes Web</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {sessions.active.filter(s => !['INTERNAL', 'ADMIN'].includes(s.userType?.toUpperCase())).map((s, i) => (
                                            <div key={`cli-${i}`} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-cyan-100 text-cyan-600 flex items-center justify-center font-black text-sm">
                                                    {(s.username || '?')[0].toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold text-zinc-800 truncate">{s.username}</p>
                                                    <p className="text-[10px] text-zinc-400">{s.ip} · {s.userType} · {timeAgo(s.loginAt)}</p>
                                                </div>
                                                <button onClick={() => handleKickSession(s.userId, s.username)} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors" title="Expulsar">
                                                    <XCircle size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-zinc-400 italic">No hay sesiones activas registradas</p>
                    )}

                    <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider flex items-center gap-2 mt-2"><Clock size={14} /> Historial de Logins</h3>
                    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-zinc-50 text-zinc-500 uppercase tracking-wider">
                                        <th className="px-4 py-3 text-left font-bold">Fecha</th>
                                        <th className="px-4 py-3 text-left font-bold">Usuario</th>
                                        <th className="px-4 py-3 text-left font-bold">IP</th>
                                        <th className="px-4 py-3 text-left font-bold">Tipo</th>
                                        <th className="px-4 py-3 text-left font-bold">Estado</th>
                                        <th className="px-4 py-3 text-left font-bold">Detalle</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sessions.history.slice(0, 50).map((h, i) => (
                                        <tr key={i} className="border-t border-zinc-100 hover:bg-zinc-50">
                                            <td className="px-4 py-2.5 text-zinc-600 font-mono whitespace-nowrap">{new Date(h.timestamp).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                                            <td className="px-4 py-2.5 font-bold text-zinc-800">{h.username}</td>
                                            <td className="px-4 py-2.5 text-zinc-500 font-mono">{h.ip}</td>
                                            <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 text-[10px] font-bold">{h.userType}</span></td>
                                            <td className="px-4 py-2.5">
                                                {h.success
                                                    ? <span className="flex items-center gap-1 text-emerald-600 font-bold"><CheckCircle size={12} /> OK</span>
                                                    : <span className="flex items-center gap-1 text-red-500 font-bold"><XCircle size={12} /> FAIL</span>}
                                            </td>
                                            <td className="px-4 py-2.5 text-zinc-400 truncate max-w-[200px]">{h.reason}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {sessions.history.length === 0 && <p className="text-center text-zinc-400 py-8 text-sm">Sin historial de logins</p>}
                    </div>
                </div>
            )}

            {/* ═══ SQL CONSOLE ═══ */}
            {tab === 'sql' && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <select 
                            onChange={(e) => { if(e.target.value) setSqlQuery(e.target.value); }} 
                            className="bg-zinc-100 border border-zinc-200 text-zinc-600 rounded-lg px-3 py-1.5 text-xs font-bold outline-none"
                            defaultValue=""
                        >
                            <option value="" disabled>Seleccionar Snippet Rápido...</option>
                            <option value="SELECT TOP 50 * FROM OrdenesDeposito ORDER BY OrdFechaIngreso DESC">Últimas 50 Órdenes</option>
                            <option value="SELECT TOP 50 * FROM Pagos ORDER BY PagFechaPago DESC">Últimos Pagos</option>
                            <option value="SELECT UsuTipoUsuario, COUNT(*) as Total FROM Usuarios GROUP BY UsuTipoUsuario">Tipos de Usuarios</option>
                            <option value="SELECT * FROM Ordenes WHERE Estado = 'PENDIENTE' AND FechaIngreso < DATEADD(day, -3, GETDATE())">Órdenes trancadas (&gt;3 días)</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 relative">
                            <textarea value={sqlQuery} onChange={e => setSqlQuery(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSql(); }}
                                onFocus={() => { if (sqlQuery === 'SELECT TOP 10 * FROM ') setSqlQuery(''); }}
                                rows={4} spellCheck={false}
                                className="w-full bg-zinc-950 text-green-400 border border-zinc-800 rounded-xl p-4 font-mono text-xs outline-none focus:border-cyan-500 resize-none"
                                placeholder="SELECT TOP 10 * FROM ..." />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={runSql} disabled={sqlRunning}
                            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all">
                            {sqlRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                            {sqlRunning ? 'Ejecutando...' : 'Ejecutar (Ctrl+Enter)'}
                        </button>
                        <span className="text-[10px] text-zinc-400 flex items-center gap-1"><Lock size={10} /> Solo SELECT — lectura</span>
                        {sqlResult?.duration != null && (
                            <span className="text-[10px] text-zinc-500 ml-auto">{sqlResult.rowCount} filas · {sqlResult.duration}ms</span>
                        )}
                    </div>

                    {sqlResult?.error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-xs font-mono">{sqlResult.error}</div>
                    )}

                    {sqlResult && !sqlResult.error && sqlResult.rows?.length === 0 && (
                        <div className="bg-zinc-100 border border-zinc-200 rounded-xl p-4 text-zinc-500 text-xs font-bold flex items-center gap-2">
                            Consulta ejecutada — 0 filas retornadas ({sqlResult.duration}ms)
                        </div>
                    )}

                    {sqlResult?.rows?.length > 0 && (
                        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                            <div className="overflow-x-auto max-h-[50vh]">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0">
                                        <tr className="bg-zinc-900 text-zinc-300 uppercase tracking-wider">
                                            {sqlResult.columns.map(col => <th key={col} className="px-3 py-2.5 text-left font-bold whitespace-nowrap">{col}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sqlResult.rows.map((row, i) => (
                                            <tr key={i} className="border-t border-zinc-100 hover:bg-blue-50/50">
                                                {sqlResult.columns.map(col => (
                                                    <td key={col} className="px-3 py-2 text-zinc-700 font-mono whitespace-nowrap max-w-[300px] truncate">
                                                        {row[col] === null ? <span className="text-zinc-300 italic">NULL</span> : String(row[col])}
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
                <div className="flex flex-col gap-4">
                    <div>
                        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Package size={14} /> Órdenes del día</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            <StatCard label="Total" value={metrics.orders.total || 0} icon={Package} color="text-zinc-400" />
                            <StatCard label="Ingresadas" value={metrics.orders.ingresadas || 0} icon={AlertCircle} color="text-blue-400" />
                            <StatCard label="Empaquetadas" value={metrics.orders.empaquetadas || 0} icon={Package} color="text-amber-400" />
                            <StatCard label="Entregadas" value={metrics.orders.entregadas || 0} icon={CheckCircle} color="text-emerald-400" />
                            <StatCard label="Autorizadas" value={metrics.orders.autorizadas || 0} icon={TrendingUp} color="text-purple-400" />
                            <StatCard label="Canceladas" value={metrics.orders.canceladas || 0} icon={XCircle} color="text-red-400" />
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2"><CreditCard size={14} /> Pagos del día</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <StatCard label="Cantidad" value={metrics.payments.cantidad || 0} icon={CreditCard} color="text-cyan-400" />
                            <StatCard label="Total UYU" value={`$ ${Number(metrics.payments.totalUYU || 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })}`} icon={CreditCard} color="text-cyan-400" />
                            <StatCard label="Total USD" value={`US$ ${Number(metrics.payments.totalUSD || 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })}`} icon={CreditCard} color="text-purple-400" />
                        </div>
                    </div>
                    {slowQueries && slowQueries.length > 0 && (
                        <div>
                            <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Activity size={14} /> Consultas SQL más Lentas</h3>
                            <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-zinc-50 text-zinc-500 uppercase border-b border-zinc-200">
                                            <tr>
                                                <th className="px-4 py-3 text-left font-bold">Query</th>
                                                <th className="px-4 py-3 text-left font-bold">Ejecuciones</th>
                                                <th className="px-4 py-3 text-left font-bold">Promedio (ms)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {slowQueries.map((sq, i) => (
                                                <tr key={i} className="border-t border-zinc-100 hover:bg-red-50/50">
                                                    <td className="px-4 py-2 font-mono text-[10px] text-zinc-600 max-w-[800px] truncate" title={sq.query_text}>{sq.query_text}</td>
                                                    <td className="px-4 py-2 text-zinc-600 font-bold">{sq.execution_count}</td>
                                                    <td className="px-4 py-2 text-red-500 font-black">{sq.avg_duration_ms}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                    <button onClick={fetchMetrics} className="self-start flex items-center gap-2 px-4 py-2 bg-zinc-200 hover:bg-zinc-300 rounded-xl text-xs font-bold text-zinc-600 transition-all">
                        <RefreshCw size={14} /> Actualizar
                    </button>
                </div>
            )}



            {/* ═══ TABLES ═══ */}
            {tab === 'tables' && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Table2 size={14} /> Tablas de la Base de Datos ({tables.length})</h3>
                        <button onClick={fetchTables} className="flex items-center gap-2 px-3 py-2 bg-zinc-200 hover:bg-zinc-300 rounded-xl text-xs font-bold text-zinc-600"><RefreshCw size={14} /></button>
                    </div>
                    <input type="text" value={tableFilter} onChange={e => setTableFilter(e.target.value)} placeholder="Filtrar tablas..."
                        className="bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-cyan-500" />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {tables.filter(t => !tableFilter || t.name.toLowerCase().includes(tableFilter.toLowerCase())).map(t => (
                            <button key={t.name} onClick={() => fetchTableColumns(t.name)}
                                className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all hover:border-cyan-300 ${selectedTable === t.name ? 'border-cyan-400 bg-cyan-50' : 'border-zinc-200 bg-white'}`}>
                                <span className="text-xs font-bold text-zinc-800 truncate">{t.name}</span>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-[10px] text-zinc-400">{t.rowCount} filas</span>
                                    <span className="text-[10px] text-zinc-400">{t.sizeMB} MB</span>
                                    <ChevronRight size={12} className="text-zinc-300" />
                                </div>
                            </button>
                        ))}
                    </div>
                    {tableColumns && (
                        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
                                <span className="text-xs font-black text-zinc-600 uppercase">{tableColumns.table} — {tableColumns.columns.length} columnas</span>
                                <button onClick={() => { setSqlQuery(`SELECT TOP 20 * FROM ${tableColumns.table}`); setTab('sql'); }}
                                    className="text-[10px] font-bold text-cyan-600 hover:text-cyan-700">Abrir en SQL →</button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0">
                                        <tr className="bg-zinc-100 text-zinc-500 uppercase">
                                            <th className="px-4 py-2 text-left font-bold">Columna</th>
                                            <th className="px-4 py-2 text-left font-bold">Tipo</th>
                                            <th className="px-4 py-2 text-left font-bold">Max</th>
                                            <th className="px-4 py-2 text-left font-bold">Nulo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tableColumns.columns.map((c, i) => (
                                            <tr key={i} className="border-t border-zinc-100 hover:bg-blue-50/50">
                                                <td className="px-4 py-2 font-bold text-zinc-800">{c.name}</td>
                                                <td className="px-4 py-2 text-cyan-600 font-mono">{c.type}</td>
                                                <td className="px-4 py-2 text-zinc-400">{c.maxLength || '-'}</td>
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
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                            <Bug size={14} /> Errores del Frontend
                            {clientErrors.recentCount > 0 && <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">{clientErrors.recentCount} recientes (5m)</span>}
                        </h3>
                        <button onClick={fetchClientErrors} className="flex items-center gap-2 px-3 py-2 bg-zinc-200 hover:bg-zinc-300 rounded-xl text-xs font-bold text-zinc-600"><RefreshCw size={14} /></button>
                    </div>
                    {clientErrors.alertActive && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-xs font-bold flex items-center gap-2">
                            <AlertCircle size={14} /> ⚠️ Alerta activa: muchos errores en los últimos 5 minutos
                        </div>
                    )}
                    {clientErrors.errors.length === 0 ? (
                        <p className="text-sm text-zinc-400 italic">No hay errores registrados. Hacé clic en Actualizar.</p>
                    ) : (
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                            {clientErrors.errors.map((e, i) => (
                                <div key={i} className="bg-white rounded-xl border border-zinc-200 p-4">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-bold text-red-500 truncate flex-1">{e.message}</span>
                                        <span className="text-[10px] text-zinc-400 shrink-0 ml-2">{new Date(e.timestamp).toLocaleString('es-UY')}</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-400">url: {e.url} · ip: {e.ip} · user: {e.userId || '-'}</p>
                                    {e.stack && <pre className="mt-2 text-[10px] text-zinc-500 bg-zinc-50 rounded-lg p-2 overflow-x-auto max-h-20">{e.stack}</pre>}
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
                        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                            <ClipboardList size={14} /> Auditoría ({auditEntries.length} registros)
                        </h3>
                        <div className="flex items-center gap-2">
                            <select value={auditFilter} onChange={e => { setAuditFilter(e.target.value); fetchAudit(e.target.value); }}
                                className="bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-cyan-500">
                                <option value="">Todas las acciones</option>
                                <option value="LOGIN">LOGIN</option>
                                <option value="SQL_CONSOLE">SQL_CONSOLE</option>
                                <option value="SERVER_RESTART">SERVER_RESTART</option>
                                <option value="DB_BACKUP">DB_BACKUP</option>
                            </select>
                            <button onClick={() => fetchAudit(auditFilter)} className="flex items-center gap-2 px-3 py-2 bg-zinc-200 hover:bg-zinc-300 rounded-xl text-xs font-bold text-zinc-600"><RefreshCw size={14} /></button>
                        </div>
                    </div>
                    {auditEntries.length === 0 ? (
                        <p className="text-sm text-zinc-400 italic">No hay registros de auditoría.</p>
                    ) : (
                        <div className="space-y-2">
                            {auditEntries.map((e, i) => {
                                const actionColors = {
                                    LOGIN: e.details.result === 'OK' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
                                    SQL_CONSOLE: 'bg-blue-100 text-blue-700',
                                    SERVER_RESTART: 'bg-orange-100 text-orange-700',
                                    DB_BACKUP: 'bg-purple-100 text-purple-700',
                                };
                                return (
                                    <div key={i} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-start gap-4">
                                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase whitespace-nowrap ${actionColors[e.action] || 'bg-zinc-100 text-zinc-600'}`}>
                                            {e.action}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
                                                {e.details.user && <span><strong>Usuario:</strong> {e.details.user}</span>}
                                                {e.details.ip && <span><strong>IP:</strong> {e.details.ip}</span>}
                                                {e.details.result && <span><strong>Resultado:</strong> {e.details.result}</span>}
                                                {e.details.query && <span className="truncate max-w-[300px]" title={e.details.query}><strong>Query:</strong> {e.details.query}</span>}
                                                {e.details.script && <span><strong>Script:</strong> {e.details.script}</span>}
                                                {e.details.type && <span><strong>Tipo:</strong> {e.details.type}</span>}
                                            </div>
                                        </div>
                                        <span className="text-[10px] text-zinc-400 whitespace-nowrap shrink-0">{e.timestamp}</span>
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
