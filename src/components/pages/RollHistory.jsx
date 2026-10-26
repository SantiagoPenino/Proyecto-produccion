import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { rollsService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import RollDetailsModal from '../modals/RollDetailsModal';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, History, Eye, Package, Loader2 } from 'lucide-react';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
} from '@tanstack/react-table';

// Estética nueva (22/10/2026, como Reportes y Logística): ícono Lucide en brand-cyan sin fondo, título en mayúsculas,
// la tabla en una tarjeta blanca con borde y estados en pastel con borde. En el celular cada lote es una tarjeta
// (antes una tabla de 7 columnas que había que scrollear de costado); se dibuja una sola de las dos vistas.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}

const claseEstado = (status) =>
    status === 'Finalizado' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    status === 'Cerrado' ? 'bg-zinc-100 text-zinc-600 border-zinc-200' :
    'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20';
const EstadoLote = ({ status }) => (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase border whitespace-nowrap ${claseEstado(status)}`}>
        {status}
    </span>
);

// Zona fija de Montevideo, no la del dispositivo: el driver ya entrega el instante correcto (ver backend/config/db.js,
// useUTC), así que solo hay que pedir la hora de Uruguay. Fijarla evita que una tablet con la zona mal configurada
// muestre otra hora. Formato compacto: fecha DD/MM/YY y hora 24hs (sin AM/PM).
const parseFecha = (v) => {
    const d = v ? new Date(v) : null;
    return (!d || isNaN(d)) ? null : d;
};
const fFecha = (d) => d.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Montevideo' });
const fHora  = (d) => d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Montevideo' });

const RollHistory = () => {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const conTabla = useConTabla();

    // Prioridad: 1. Filtro por navegación (state), 2. Área del usuario (si no es admin)
    const [areaFilter, setAreaFilter] = useState(location.state?.areaFilter || '');
    const backPath = location.state?.areaFilter ? `/area/${location.state.areaFilter.toLowerCase()}` : null;

    useEffect(() => {
        if (user) {
            // Si NO es admin, forzamos su área
            if (user.rol !== 'ADMIN') {
                const userArea = user.areaKey || user.area || '';
                // Solo seteamos si es diferente para evitar ciclos
                if (userArea && areaFilter !== userArea) {
                    setAreaFilter(userArea);
                }
            }
        }
    }, [user]);

    const [searchTerm, setSearchTerm] = useState('');
    const [rolls, setRolls] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [inspectingRoll, setInspectingRoll] = useState(null);

    const observer = useRef();
    const lastElementRef = useCallback(node => {
        if (loading || loadingMore) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                setPage(prevPage => prevPage + 1);
            }
        });
        if (node) observer.current.observe(node);
    }, [loading, loadingMore, hasMore]);

    const fetchHistory = async (currentPage = 1, isLoadMore = false) => {
        if (isLoadMore) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        try {
            const result = await rollsService.getHistory(searchTerm, areaFilter, currentPage);
            // Result is now { data, page, hasMore }
            if (isLoadMore) {
                setRolls(prev => [...prev, ...result.data]);
            } else {
                setRolls(result.data);
            }
            setHasMore(result.hasMore);
        } catch (error) {
            console.error("Error fetching history:", error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    // Initial fetch and areaFilter changes
    useEffect(() => {
        if (user) {
            setPage(1);
            fetchHistory(1, false);
        }
    }, [areaFilter, user]);

    // Fetch on page change (infinite scroll)
    useEffect(() => {
        if (page > 1) {
            fetchHistory(page, true);
        }
    }, [page]);

    const handleSearch = (e) => {
        e.preventDefault();
        setPage(1);
        fetchHistory(1, false);
    };

    const verDetalles = (r) => setInspectingRoll({ id: r.id, name: r.name, status: r.status });

    const columns = useMemo(() => [
        {
            accessorKey: 'id',
            header: 'ID Lote',
            size: 100,
            cell: info => <span className="font-mono text-xs font-bold text-zinc-600 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-md">#{info.getValue()}</span>,
        },
        {
            accessorKey: 'name',
            header: 'Nombre',
            size: 400,
            cell: info => <div className="font-bold text-zinc-800 truncate" title={info.getValue()}>{info.getValue()}</div>,
        },
        {
            accessorKey: 'status',
            header: () => <div className="text-center">Estado</div>,
            size: 150,
            cell: info => <div className="text-center"><EstadoLote status={info.getValue()} /></div>,
        },
        {
            accessorKey: 'orderCount',
            header: () => <div className="text-center">Órdenes</div>,
            size: 100,
            cell: info => (
                <div className="text-center">
                    <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-zinc-100 rounded-md text-xs font-bold text-zinc-600 tabular-nums">
                        {info.getValue()}
                    </span>
                </div>
            )
        },
        {
            accessorKey: 'machineName',
            header: () => <div className="text-center">Máquina (final)</div>,
            size: 150,
            cell: info => {
                const machineName = info.getValue();
                return machineName ? (
                    <div className="flex items-center justify-center gap-1.5 text-zinc-700 font-medium">
                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-300"></div>
                        {machineName}
                    </div>
                ) : (
                    <div className="text-center text-zinc-400 italic text-xs">Sin asignar</div>
                );
            }
        },
        {
            accessorKey: 'FechaCreacion',
            header: () => <div className="text-center">Fecha</div>,
            // OJO: 150 es el valor mágico que esta tabla interpreta como "ancho automático"
            // (ver el style del <th>). Dejarlo así hace que FECHA siga repartiendo el sobrante con
            // ESTADO y MÁQUINA y ninguna columna se corra de lugar.
            size: 150,
            cell: info => {
                // Creación y finalización lado a lado, cada una con fecha arriba y hora abajo:
                //   FECHA CREACIÓN | FECHA FINALIZACIÓN
                //   HORA CREACIÓN  | HORA FINALIZACIÓN
                // La finalización sale de la última FechaFin de la bitácora del lote; si todavía no
                // se finalizó, va un guion.
                const creado = parseFecha(info.getValue());
                const finalizado = parseFecha(info.row.original.FechaFinalizacion);
                const Bloque = ({ date, color, title }) => (
                    <div className="flex flex-col text-center whitespace-nowrap tabular-nums" title={title}>
                        {date ? (
                            <>
                                <span className={`font-medium text-xs ${color}`}>{fFecha(date)}</span>
                                <span className="text-zinc-400 text-xs">{fHora(date)}</span>
                            </>
                        ) : (
                            <span className="text-zinc-300">—</span>
                        )}
                    </div>
                );
                return (
                    <div className="flex items-center justify-center gap-2">
                        <Bloque date={creado} color="text-zinc-700" title="Creación del lote" />
                        <div className="w-px self-stretch bg-zinc-200" />
                        <Bloque date={finalizado} color="text-emerald-600" title="Finalización del lote" />
                    </div>
                );
            }
        },
        {
            id: 'acciones',
            header: () => <div className="text-right">Acciones</div>,
            size: 120,
            cell: ({ row }) => (
                <div className="text-right">
                    <button
                        type="button"
                        onClick={() => verDetalles(row.original)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 font-bold text-xs transition-colors"
                    >
                        <Eye size={14} className="text-brand-cyan" /> Detalles
                    </button>
                </div>
            )
        }
    ], []);

    const table = useReactTable({
        data: rolls,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    const cargando = (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 size={30} className="animate-spin text-brand-cyan" />
            <span className="text-sm text-zinc-400">Cargando historial...</span>
        </div>
    );
    const vacio = (
        <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center">
            <Package size={40} className="text-zinc-200" />
            <span className="text-sm text-zinc-400">No se encontraron lotes en el historial.</span>
        </div>
    );
    const cargandoMas = (
        <div className="flex justify-center items-center gap-2 py-6 text-sm text-zinc-400">
            <Loader2 size={16} className="animate-spin text-brand-cyan" /> Cargando más...
        </div>
    );

    return (
        <div className="p-3 md:p-6 bg-slate-50 min-h-full font-sans text-zinc-800 space-y-4">
            {/* ── Encabezado y búsqueda ─────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    {backPath && (
                        <button
                            type="button"
                            onClick={() => navigate(backPath)}
                            className="flex items-center justify-center w-10 h-10 shrink-0 bg-white border border-zinc-200 rounded-xl text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 transition-colors"
                            aria-label="Volver al área"
                        >
                            <ArrowLeft size={18} />
                        </button>
                    )}
                    <History size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Historial de lotes</h1>
                        <p className="text-sm text-zinc-400">Consultá y analizá el registro histórico de producción.</p>
                    </div>
                </div>

                <form onSubmit={handleSearch} className="flex gap-2 w-full md:w-auto md:min-w-[400px]">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            placeholder="Buscar por ID, Nombre..."
                            aria-label="Buscar lote"
                            className="w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
                        />
                    </div>
                    <button type="submit" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors">
                        <Search size={15} /> Buscar
                    </button>
                </form>
            </div>

            {/* ── Lotes ─────────────────────────────────────────────── */}
            <div className={`${CARD} overflow-hidden`}>
                {conTabla ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm border-collapse table-fixed">
                            <thead className="bg-zinc-50 border-b border-zinc-200">
                                {table.getHeaderGroups().map(headerGroup => (
                                    <tr key={headerGroup.id}>
                                        {headerGroup.headers.map(header => (
                                            <th
                                                key={header.id}
                                                style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                                                className="px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-zinc-400"
                                            >
                                                {header.isPlaceholder
                                                    ? null
                                                    : flexRender(
                                                        header.column.columnDef.header,
                                                        header.getContext()
                                                    )}
                                            </th>
                                        ))}
                                    </tr>
                                ))}
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {loading ? (
                                    <tr><td colSpan={columns.length}>{cargando}</td></tr>
                                ) : rolls.length === 0 ? (
                                    <tr><td colSpan={columns.length}>{vacio}</td></tr>
                                ) : (
                                    table.getRowModel().rows.map((row, index) => {
                                        const isLastRow = index === table.getRowModel().rows.length - 1;
                                        return (
                                            <tr
                                                key={row.id}
                                                ref={isLastRow ? lastElementRef : null}
                                                className="hover:bg-zinc-50 transition-colors"
                                            >
                                                {row.getVisibleCells().map(cell => (
                                                    <td key={cell.id} className="px-4 py-3">
                                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    })
                                )}
                                {loadingMore && (
                                    <tr><td colSpan={columns.length}>{cargandoMas}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : loading ? cargando : rolls.length === 0 ? vacio : (
                    /* Celular: una tarjeta por lote */
                    <ul className="divide-y divide-zinc-100">
                        {rolls.map((r, index) => {
                            const creado = parseFecha(r.FechaCreacion);
                            const finalizado = parseFecha(r.FechaFinalizacion);
                            return (
                                <li key={r.id} ref={index === rolls.length - 1 ? lastElementRef : null} className="px-4 py-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-xs font-bold text-zinc-600 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-md">#{r.id}</span>
                                        <EstadoLote status={r.status} />
                                    </div>
                                    <p className="font-bold text-zinc-800 mt-1.5 break-words">{r.name}</p>
                                    <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                                        <div className="min-w-0">
                                            <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Órdenes</dt>
                                            <dd className="font-bold text-zinc-700 tabular-nums">{r.orderCount}</dd>
                                        </div>
                                        <div className="min-w-0 col-span-2">
                                            <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Máquina (final)</dt>
                                            <dd className={`truncate ${r.machineName ? 'font-bold text-zinc-700' : 'italic text-zinc-400'}`}>{r.machineName || 'Sin asignar'}</dd>
                                        </div>
                                        <div className="min-w-0">
                                            <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Creado</dt>
                                            <dd className="text-zinc-700 tabular-nums">{creado ? `${fFecha(creado)} ${fHora(creado)}` : '—'}</dd>
                                        </div>
                                        <div className="min-w-0">
                                            <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Finalizado</dt>
                                            <dd className={`tabular-nums ${finalizado ? 'text-emerald-600 font-medium' : 'text-zinc-300'}`}>{finalizado ? `${fFecha(finalizado)} ${fHora(finalizado)}` : '—'}</dd>
                                        </div>
                                        {/* El botón en la misma fila que las fechas: no deja una fila entera vacía para él solo */}
                                        <div className="flex items-end justify-end">
                                            <button
                                                type="button"
                                                onClick={() => verDetalles(r)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 font-bold text-xs transition-colors"
                                            >
                                                <Eye size={14} className="text-brand-cyan" /> Detalles
                                            </button>
                                        </div>
                                    </dl>
                                </li>
                            );
                        })}
                        {loadingMore && <li>{cargandoMas}</li>}
                    </ul>
                )}
            </div>

            {inspectingRoll && (
                <RollDetailsModal
                    roll={inspectingRoll}
                    onClose={() => setInspectingRoll(null)}
                    onUpdate={() => { }}
                    readOnly
                />
            )}
        </div>
    );
};

export default RollHistory;
