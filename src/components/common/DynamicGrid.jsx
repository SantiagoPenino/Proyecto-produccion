// SIN USO (13/10): solo lo importa pages/AdminDashboard.jsx, que tampoco se usa. Ver docs/auditoria-limpieza-2026-10-09.md.
import React, { useState, useMemo } from 'react';

const DynamicGrid = ({ data = [], loading = false }) => {
    // Estado local para los filtros de cada columna
    const [filters, setFilters] = useState({});

    // 1. Detectar columnas automáticamente basadas en el primer registro
    const columns = useMemo(() => {
        if (data && data.length > 0) {
            return Object.keys(data[0]);
        }
        return [];
    }, [data]);

    // 2. Filtrar datos en el cliente
    const filteredData = useMemo(() => {
        if (!data) return [];
        return data.filter(row => {
            // Verifica que la fila cumpla con TODOS los filtros activos
            return columns.every(col => {
                const filterValue = filters[col]?.toLowerCase();
                if (!filterValue) return true; // Si no hay filtro, pasa

                const cellValue = String(row[col] || '').toLowerCase();
                return cellValue.includes(filterValue);
            });
        });
    }, [data, filters, columns]);

    // Handler para actualizar filtros
    const handleFilterChange = (col, value) => {
        setFilters(prev => ({
            ...prev,
            [col]: value
        }));
    };

    // Renderizado de estados de carga/vacío
    if (loading) {
        return (
            <div className="flex flex-col h-full items-center justify-center p-10 text-slate-400 gap-3">
                <i className="fa-solid fa-spinner fa-spin fa-2x text-blue-500"></i>
                <p className="text-sm font-bold">Cargando datos...</p>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col h-full items-center justify-center p-10 text-slate-400 gap-3">
                <i className="fa-regular fa-folder-open fa-2x opacity-50"></i>
                <p className="text-sm font-bold">No hay datos para mostrar.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full bg-white overflow-hidden">
            {/* Contenedor con scroll automático */}
            <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-50 border-b-2 border-slate-200 shadow-sm">
                        <tr>
                            {columns.map((col) => (
                                <th key={col} className="text-left px-3 py-2 min-w-[120px] bg-slate-50 border-r border-slate-100 last:border-r-0 align-top group">
                                    <div className="flex flex-col gap-1.5 h-full">
                                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex justify-between items-center">
                                            <span>{col}</span>
                                            <i className="fa-solid fa-sort text-slate-300 group-hover:text-slate-400 cursor-pointer"></i>
                                        </div>
                                        <input
                                            type="text"
                                            className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all font-normal placeholder:text-slate-300"
                                            placeholder="Filtrar..."
                                            value={filters[col] || ''}
                                            onChange={(e) => handleFilterChange(col, e.target.value)}
                                            autoComplete="off"
                                        />
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredData.map((row, rowIndex) => (
                            <tr key={rowIndex} className="hover:bg-slate-50 transition-colors">
                                {columns.map((col) => (
                                    <td key={`${rowIndex}-${col}`} className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap border-r border-slate-50 last:border-r-0 max-w-xs truncate" title={row[col]}>
                                        {row[col]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer informativo */}
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex justify-end gap-1 font-medium shrink-0">
                Mostrando <strong className="text-slate-800">{filteredData.length}</strong> de {data.length} registros
            </div>
        </div>
    );
};

export default DynamicGrid;
