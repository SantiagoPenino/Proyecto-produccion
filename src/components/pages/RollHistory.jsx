import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { rollsService } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import RollDetailsModal from '../modals/RollDetailsModal';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, History, Eye, Package } from 'lucide-react';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
} from '@tanstack/react-table';

const RollHistory = () => {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

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

    const columns = useMemo(() => [
        {
            accessorKey: 'id',
            header: 'ID Lote',
            size: 100,
            cell: info => <span className="font-mono text-xs font-bold text-zinc-500 bg-zinc-100 px-2 py-1 rounded-md">#{info.getValue()}</span>,
        },
        {
            accessorKey: 'name',
            header: () => <div className="text-center">Nombre</div>,
            size: 400,
            cell: info => <div className="font-bold text-zinc-800 text-center">{info.getValue()}</div>,
        },
        {
            accessorKey: 'status',
            header: () => <div className="text-center">Estado</div>,
            size: 150,
            cell: info => {
                const status = info.getValue();
                return (
                    <div className="text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider border
                            ${status === 'Finalizado' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                status === 'Cerrado' ? 'bg-zinc-100 text-zinc-600 border-zinc-200' :
                                    'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20'
                            }`}>
                            {status}
                        </span>
                    </div>
                );
            }
        },
        {
            accessorKey: 'orderCount',
            header: () => <div className="text-center">Órdenes</div>,
            size: 100,
            cell: info => (
                <div className="text-center">
                    <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-zinc-100 rounded-md text-xs font-bold text-zinc-600">
                        {info.getValue()}
                    </span>
                </div>
            )
        },
        {
            accessorKey: 'machineName',
            header: () => <div className="text-center">Máquina (Final)</div>,
            size: 150,
            cell: info => {
                const machineName = info.getValue();
                return machineName ? (
                    <div className="flex items-center justify-center gap-1.5 text-zinc-600 font-medium">
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
            header: () => <div className="text-center">Fecha Creación</div>,
            size: 150,
            cell: info => {
                const date = new Date(info.getValue());
                return (
                    <div className="flex flex-col text-center">
                        <span className="text-zinc-700 font-medium">{date.toLocaleDateString()}</span>
                        <span className="text-zinc-400 text-xs">{date.toLocaleTimeString()}</span>
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
                        onClick={() => setInspectingRoll({ id: row.original.id, name: row.original.name, status: row.original.status })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-brand-cyan hover:text-white hover:bg-brand-cyan font-bold text-xs transition-all"
                    >
                        <Eye size={14} /> Detalles
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

    return (
        <div className="md:-mt-6 md:-mx-6">
            <div className="flex flex-col bg-white rounded-b-2xl font-sans text-zinc-800 relative shadow-sm overflow-hidden">
                <div className="relative z-10 flex flex-col">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 border-b border-zinc-100 shrink-0">
                        <div className="flex items-center gap-4">
                            {backPath && (
                                <button
                                    onClick={() => navigate(backPath)}
                                    className="flex items-center justify-center w-10 h-10 shrink-0 bg-white border border-zinc-200 rounded-xl text-zinc-500 hover:bg-zinc-50 hover:text-brand-cyan hover:border-brand-cyan/30 transition-all shadow-sm group"
                                >
                                    <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                                </button>
                            )}
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-brand-cyan/20 to-brand-cyan/5 flex items-center justify-center text-brand-cyan shadow-inner ring-1 ring-brand-cyan/20">
                                    <History size={20} />
                                </div>
                                <div className="flex flex-col justify-center">
                                    <h1 className="text-3xl font-black text-zinc-800 tracking-tight leading-none mb-1">
                                        Historial de Lotes
                                    </h1>
                                    <p className="text-sm font-medium text-zinc-500">Consulta y analiza el registro histórico de producción.</p>
                                </div>
                            </div>
                        </div>

                        {/* Search Bar */}
                        <form onSubmit={handleSearch} className="flex gap-2 w-full md:w-auto md:min-w-[400px]">
                            <div className="relative flex-1 group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <Search size={16} className="text-zinc-400 group-focus-within:text-brand-cyan transition-colors" />
                                </div>
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    placeholder="Buscar por ID, Nombre..."
                                    className="w-full pl-11 pr-4 py-3 bg-white border border-zinc-200 rounded-xl text-sm font-medium text-zinc-700 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 focus:border-brand-cyan/50 transition-all shadow-sm"
                                />
                            </div>
                            <button type="submit" className="px-6 py-3 bg-zinc-800 text-white font-bold text-sm rounded-xl hover:bg-zinc-700 transition-all active:scale-95 shadow-sm hover:shadow-md flex items-center gap-2">
                                Buscar
                            </button>
                        </form>
                    </div>

                    {/* Table Area */}
                    <div className="bg-white h-auto overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm border-collapse table-fixed">
                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                    {table.getHeaderGroups().map(headerGroup => (
                                        <tr key={headerGroup.id}>
                                            {headerGroup.headers.map(header => (
                                                <th 
                                                    key={header.id} 
                                                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                                                    className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-zinc-500"
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
                                        <tr>
                                            <td colSpan={columns.length} className="px-6 py-16 text-center">
                                                <div className="flex flex-col items-center justify-center gap-3 text-brand-cyan">
                                                    <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                                                    <span className="font-bold text-xs tracking-widest uppercase">Cargando Historial...</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : rolls.length === 0 ? (
                                        <tr>
                                        <td colSpan={columns.length} className="px-6 py-16 text-center">
                                            <div className="flex flex-col items-center justify-center gap-3 text-zinc-400">
                                                <Package size={32} className="opacity-40" />
                                                <span className="font-medium">No se encontraron lotes en el historial.</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    table.getRowModel().rows.map((row, index) => {
                                        const isLastRow = index === table.getRowModel().rows.length - 1;
                                        return (
                                            <tr 
                                                key={row.id} 
                                                ref={isLastRow ? lastElementRef : null}
                                                className="hover:bg-zinc-50/80 transition-colors group"
                                            >
                                                {row.getVisibleCells().map(cell => (
                                                    <td key={cell.id} className="px-6 py-4">
                                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    })
                                )}
                                {loadingMore && (
                                    <tr>
                                        <td colSpan={columns.length} className="px-6 py-8 text-center">
                                            <div className="flex justify-center items-center gap-2 text-brand-cyan">
                                                <i className="fa-solid fa-circle-notch fa-spin text-lg"></i>
                                                <span className="font-bold text-xs uppercase">Cargando más...</span>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            
            {inspectingRoll && (
                <RollDetailsModal
                    roll={inspectingRoll}
                    onClose={() => setInspectingRoll(null)}
                    onUpdate={() => { }}
                />
            )}
            
            {/* Explicit Gray Spacer for the bottom */}
            <div className="h-6 w-full bg-slate-100 shrink-0"></div>
        </div>
        </div>
    );
};

export default RollHistory;
