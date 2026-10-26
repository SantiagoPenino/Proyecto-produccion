import React, { useState, useEffect, useRef } from 'react';
import { ListChecks, Search, Loader2, ScrollText } from 'lucide-react';
import { auditService } from '../../services/api';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

const CARD = 'bg-white rounded-2xl border border-zinc-200';
// Buscador con la altura del Selector filtro (py-2), para que la fila de filtros quede pareja.
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-400';

// Color de la acción: LOGIN es un ingreso correcto, LOGOUT una salida; el resto, informativo.
const claseAccion = (accion) => (
    accion === 'LOGIN' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : accion === 'LOGOUT' ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20'
);

// Estética nueva (22/10/2026): fondo claro, filtros en una tarjeta con Selector y SelectorFecha propios (antes
// <select> e <input type="date"> nativos), tabla clara en su tarjeta y fechas en formato uruguayo (antes salían
// con el formato del navegador, 10/21/2026).
// Se dibujan de a 50 filas y se suman 50 al acercarse al final (en la copia local hay más de 22.000 registros
// y dibujarlos todos juntos traba la pantalla). El filtro y el contador siguen tomando todos. Mismo patrón
// que Reportes (useDeAPoco).
const DE_A = 50;
// El contenedor que scrollea de verdad (el del layout): el margen de 600 px se mide contra él.
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};
function useDeAPoco(total, clave) {
    const [cuantos, setCuantos] = useState(DE_A);
    const centinela = useRef(null);
    // Volver a 50 cuando cambian la lista o los filtros
    useEffect(() => { setCuantos(DE_A); }, [clave]);
    useEffect(() => {
        const el = centinela.current;
        if (!el || cuantos >= total) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setCuantos(c => c + DE_A);
        },
            { root: contenedorConScroll(el), rootMargin: '0px 0px 600px 0px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, [cuantos, total]);
    return [Math.min(cuantos, total), centinela];
}

const AuditPage = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterUser, setFilterUser] = useState('');
    const [filterAction, setFilterAction] = useState('');

    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    useEffect(() => {
        loadLogs();
    }, []);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const data = await auditService.getAll();
            setLogs(data);
        } catch (error) {
            console.error("Error loading audit logs:", error);
        } finally {
            setLoading(false);
        }
    };

    const filteredLogs = logs.filter(log => {
        const term = searchTerm.toLowerCase();
        const matchesSearch =
            (log.Usuario?.toLowerCase() || '').includes(term) ||
            (log.Accion?.toLowerCase() || '').includes(term) ||
            (log.Detalles?.toLowerCase() || '').includes(term);

        const matchesUser = filterUser ? log.Usuario === filterUser : true;
        const matchesAction = filterAction ? log.Accion === filterAction : true;

        let matchesDate = true;
        if (startDate || endDate) {
            const logDate = new Date(log.FechaAccion);
            if (startDate) {
                const start = new Date(`${startDate}T00:00:00`); // hora local: 'AAAA-MM-DD' solo se lee como UTC y en Uruguay quedaba en el día anterior
                start.setHours(0, 0, 0, 0); // Start of day
                if (logDate < start) matchesDate = false;
            }
            if (endDate && matchesDate) { // Check only if still matching
                const end = new Date(`${endDate}T00:00:00`);
                end.setHours(23, 59, 59, 999); // End of day
                if (logDate > end) matchesDate = false;
            }
        }

        return matchesSearch && matchesUser && matchesAction && matchesDate;
    });

    const [cuantos, centinela] = useDeAPoco(filteredLogs.length, `${logs.length}|${searchTerm}|${filterUser}|${filterAction}|${startDate}|${endDate}`);
    const faltan = filteredLogs.length - cuantos;

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700">

            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <ListChecks size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Auditoría del Sistema</h1>
                    <p className="text-sm text-zinc-500 mt-1">Historial de acciones y eventos</p>
                </div>
            </div>

            {/* Filtros */}
            <div className={`${CARD} p-4 mb-4 grid grid-cols-2 gap-3 md:flex md:items-end`}>
                <div className="col-span-2 md:flex-1 min-w-0">
                    <label htmlFor="auditoria-buscar" className={ETIQUETA}>Buscar</label>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input
                            id="auditoria-buscar"
                            type="text"
                            placeholder="Buscar en detalles..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={CAMPO}
                        />
                    </div>
                </div>

                <div className="min-w-0 md:w-48">
                    <span className={ETIQUETA}>Usuario</span>
                    <Selector filtro className="w-full" value={filterUser} onChange={(e) => setFilterUser(e.target.value)} aria-label="Usuario" anchoLista={240}>
                        <option value="">Todos los Usuarios</option>
                        {[...new Set(logs.map(l => l.Usuario))].filter(Boolean).sort().map(u => (
                            <option key={u} value={u}>{u}</option>
                        ))}
                    </Selector>
                </div>

                <div className="min-w-0 md:w-52">
                    <span className={ETIQUETA}>Acción</span>
                    <Selector filtro className="w-full" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} aria-label="Acción" anchoLista={260}>
                        <option value="">Todas las Acciones</option>
                        {[...new Set(logs.map(l => l.Accion))].filter(Boolean).sort().map(a => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </Selector>
                </div>

                <div className="min-w-0 md:w-40">
                    <span className={ETIQUETA}>Desde</span>
                    <SelectorFecha filtro vaciable className="w-full" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="Desde" aria-label="Desde" />
                </div>

                <div className="min-w-0 md:w-40">
                    <span className={ETIQUETA}>Hasta</span>
                    <SelectorFecha filtro vaciable className="w-full" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="Hasta" aria-label="Hasta" />
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 mb-3 px-1">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Registros</h3>
                {!loading && (
                    <span className="text-xs font-bold text-zinc-400 tabular-nums">
                        {filteredLogs.length === logs.length ? `${logs.length} registros` : `${filteredLogs.length} de ${logs.length} registros`}
                    </span>
                )}
            </div>

            <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left border-collapse">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                            <tr>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400">Fecha/Hora</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400">Usuario</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400">Acción</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400">Detalles</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400">IP</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="px-4 py-12 text-center">
                                        <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
                                            <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando registros...
                                        </span>
                                    </td>
                                </tr>
                            ) : filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-4 py-16">
                                        <div className="flex flex-col items-center justify-center text-center">
                                            <ScrollText size={40} className="mb-3 text-brand-cyan" />
                                            <span className="text-sm font-bold text-zinc-700">No se encontraron registros</span>
                                            <span className="text-xs text-zinc-400 mt-1">Probá con otra búsqueda u otras fechas.</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.slice(0, cuantos).map((log) => (
                                    <tr key={log.AccionID} className="hover:bg-zinc-50 transition-colors">
                                        <td className="px-4 py-3 text-xs font-mono text-zinc-500 whitespace-nowrap tabular-nums">
                                            {new Date(log.FechaAccion).toLocaleString('es-UY')}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <span className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-600 flex items-center justify-center font-black text-[11px] uppercase shrink-0">
                                                    {(log.Usuario || '?').substring(0, 2)}
                                                </span>
                                                <div className="min-w-0">
                                                    <div className="text-sm font-bold text-zinc-800 whitespace-nowrap">{log.Nombre || log.Usuario}</div>
                                                    {log.Nombre && <div className="text-[11px] text-zinc-400 font-mono">@{log.Usuario}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase tracking-wide whitespace-nowrap ${claseAccion(log.Accion)}`}>
                                                {log.Accion}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-zinc-600">{log.Detalles}</td>
                                        <td className="px-4 py-3 text-xs font-mono text-zinc-400 whitespace-nowrap">{log.IPAddress}</td>
                                    </tr>
                                ))
                            )}
                            {!loading && faltan > 0 && (
                                <tr ref={centinela}>
                                    <td colSpan={5} className="px-4 py-3 text-center text-xs text-zinc-400">
                                        Mostrando {cuantos.toLocaleString('es-UY')} de {filteredLogs.length.toLocaleString('es-UY')}…
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AuditPage;
