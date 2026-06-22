import React, { useState, useMemo, useEffect } from 'react';
import { Eye } from 'lucide-react';
import {
    useReactTable,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    flexRender
} from '@tanstack/react-table';

export default function ProductionTable({ rowData = [], onRowSelected, selectedRowIds, onRowClick, columnDefs: propColumnDefs, toolbarContent, flashingRowIds = [] }) {

    const [rowSelection, setRowSelection] = useState({});
    const [columnVisibility, setColumnVisibility] = useState({});

    // Sincronizar estado interno de selección hacia arriba (prop onRowSelected)
    useEffect(() => {
        if (onRowSelected) {
            const selectedIds = Object.keys(rowSelection).filter(k => rowSelection[k]).map(id => parseInt(id, 10));
            // Evitamos un loop verificando que haya cambiado realmente respecto al prop (si existe)
            if (!selectedRowIds || selectedRowIds.length !== selectedIds.length || !selectedIds.every(id => selectedRowIds.includes(id))) {
                onRowSelected(selectedIds);
            }
        }
    }, [rowSelection]);

    // Sincronizar desde arriba hacia el estado interno (si el padre limpia la selección)
    useEffect(() => {
        if (selectedRowIds !== undefined) {
            setRowSelection(prev => {
                const newSelection = {};
                selectedRowIds.forEach(id => newSelection[id] = true);
                
                const prevKeys = Object.keys(prev).filter(k => prev[k]);
                const newKeys = Object.keys(newSelection);
                
                if (prevKeys.length !== newKeys.length || !prevKeys.every(k => newSelection[k])) {
                    return newSelection;
                }
                return prev;
            });
        }
    }, [selectedRowIds]);

    // Limpiar selección cuando cambian los datos drásticamente (opcional)
    useEffect(() => {
        setRowSelection({});
    }, [rowData]);

    // Renderizadores internos para cuando no hay propColumnDefs
    const StatusRenderer = (params) => {
        const status = params.value || 'Pendiente';
        let colorClass = "text-zinc-500";
        const s = status.toLowerCase();

        if (s.includes('imprimiendo') || s.includes('proceso')) colorClass = "text-blue-600";
        else if (s.includes('detenido') || s.includes('falla')) colorClass = "text-red-600";
        else if (s.includes('finalizado') || s.includes('entregado') || s.includes('ok')) colorClass = "text-emerald-600";

        return (
            <span className={`text-xs font-bold uppercase tracking-wide ${colorClass}`}>
                {status}
            </span>
        );
    };

    const ActionsRenderer = (params) => (
        <div onClick={(e) => { e.stopPropagation(); if (onRowClick) onRowClick(params.data); }}
            className="flex items-center justify-center h-full cursor-pointer text-zinc-400 hover:text-brand-cyan transition-colors group">
            <Eye size={15} className="group-hover:scale-110 transition-transform" />
        </div>
    );

    const PriorityRenderer = (params) => {
        const code = (params.data?.code || '').toUpperCase();
        const isFalla = (params.value === 'Falla' || params.value === 'FALLA') || code.includes('-F') || code.startsWith('F-') || code.startsWith('F ');
        if (isFalla) {
            return <span className="pulse-falla-badge inline-flex items-center px-3 py-1 rounded text-xs font-bold uppercase tracking-wide">FALLA</span>;
        }
        if (params.value === 'Urgente') {
            return <span className="text-xs font-bold text-brand-magenta uppercase tracking-wide">URGENTE</span>;
        }
        if (params.value === 'Reposición' || params.value === 'Reposicion' || params.value === 'REPOSICIÓN') {
            return <span className="text-xs font-bold text-orange-500 uppercase tracking-wide">REPOSICIÓN</span>;
        }
        return <span className="text-xs text-zinc-500 font-medium">{params.value || 'Normal'}</span>;
    };

    const BatchRenderer = (params) => {
        if (!params.value) return <span className="text-zinc-300">-</span>;
        return (
            <span className="text-xs font-bold text-brand-cyan">
                {params.value}
            </span>
        );
    };

    const FilesRenderer = (params) => {
        const val = params.value;
        const displayVal = val !== undefined && val !== null && val !== '' ? val : 0;
        return <span className="text-xs font-bold text-zinc-600">{displayVal}</span>;
    };

    const DateRenderer = (params) => {
        if (!params.value) return null;
        const date = new Date(params.value);
        return (
            <div className="flex flex-col leading-tight">
                <span className="text-xs font-bold text-zinc-700">{date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                <span className="text-[10px] text-zinc-400 font-medium">{date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        );
    };

    const internalColumnDefs = useMemo(() => [
        { headerName: '', width: 40, cellRenderer: ActionsRenderer },
        { field: 'entryDate', headerName: 'Fecha', width: 85, cellRenderer: DateRenderer },
        { field: 'priority', headerName: 'Prioridad', width: 90, cellRenderer: PriorityRenderer },
        { field: 'code', headerName: 'Orden', width: 130 },
        { field: 'client', headerName: 'Cliente', width: 150 },
        { field: 'desc', headerName: 'Trabajo', width: 180 },
        { field: 'variantCode', headerName: 'Variante', width: 110 },
        { field: 'material', headerName: 'Material', minWidth: 250 },
        { field: 'magnitude', headerName: 'Cantidad', width: 100, cellRenderer: ({ value, data }) => {
            const mag = data?.magnitude ?? value ?? '';
            const unit = data?.unit ?? '';
            const numStr = String(mag).replace(/[^\d.]/g, '');
            const display = numStr || mag;
            const unitDisplay = unit || (String(mag).replace(/[\d. ]/g, '') || '');
            return `${display}${unitDisplay ? ' ' + unitDisplay : ''}`;
        }},
        { field: 'status', headerName: 'Estado General', width: 130, cellRenderer: StatusRenderer },
        { field: 'areaStatus', headerName: 'Estado en Área', width: 130 },
        { field: 'filesCount', headerName: 'Archivos', width: 80, cellRenderer: FilesRenderer },
        { field: 'rollId', headerName: 'Lote', width: 100, cellRenderer: BatchRenderer },
        { field: 'printer', headerName: 'Máquina', width: 120 },
        { field: 'ink', headerName: 'Tinta', width: 100 },
        { field: 'note', headerName: 'Nota', width: 100 },
        { field: 'observations', headerName: 'Observaciones', width: 200 }
    ], [onRowClick]);

    // Adaptador mágico: Convierte el array viejo de AG Grid al nuevo formato de TanStack Table
    const columns = useMemo(() => {
        const sourceCols = propColumnDefs || internalColumnDefs;
        return sourceCols.map((col, index) => {
            const isFirstActionCol = index === 0 && !col.field;
            
            // --- CÁLCULO DE ANCHO DINÁMICO (Auto-Fit) ---
            let computedSize = 100;
            if (isFirstActionCol) {
                computedSize = 50;
            } else if (col.field && rowData && rowData.length > 0) {
                let maxChars = col.headerName ? col.headerName.length : 0;
                rowData.slice(0, 20).forEach(row => {
                    const val = row[col.field];
                    if (val !== null && val !== undefined) {
                        let strVal = typeof val === 'string' ? val.trim() : String(val);
                        // Mockear longitud para columnas con UI especial para no romper el cálculo
                        if (col.field === 'entryDate') strVal = '10/10/26'; // 8 caracteres
                        
                        const len = strVal.length;
                        if (len > maxChars) maxChars = len;
                    }
                });
                // Cálculo escalonado para textos:
                // Textos cortos (<= 15) necesitan más px por letra.
                // Textos largos (> 15) suelen tener minúsculas/espacios, usamos menos px extra para no inflar la columna.
                let textWidth = maxChars * 8;
                if (maxChars > 15) {
                    textWidth = (15 * 8) + ((maxChars - 15) * 5.5);
                }
                
                const minHeaderWidth = col.headerName ? Math.max(col.headerName.length * 9 + 24, 45) : 45;
                // Ajuste preciso con 24px de colchón para absorber los px-2 (16px de padding total + 8px margen).
                // Cap reducido a 200px: el texto más largo se trunca con ellipsis de todas formas.
                computedSize = Math.min(Math.max(textWidth + 24, minHeaderWidth), 200);
            } else {
                computedSize = col.width || col.minWidth || 150;
            }

            return {
                id: col.field || `col_${index}`,
                accessorKey: col.field,
                header: isFirstActionCol 
                    ? ({ table }) => (
                        <input
                            type="checkbox"
                            checked={table.getIsAllRowsSelected()}
                            ref={input => {
                                if (input) input.indeterminate = table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected();
                            }}
                            onChange={table.getToggleAllRowsSelectedHandler()}
                            className="w-4 h-4 cursor-pointer accent-brand-cyan rounded border-zinc-300 block mx-auto"
                            title="Seleccionar todo"
                        />
                    )
                    : col.headerName || '',
                size: computedSize,
                minSize: col.headerName ? Math.max(col.headerName.length * 8 + 24, 40) : 40,
                cell: (info) => {
                    if (col.cellRenderer) {
                        const Renderer = col.cellRenderer;
                        return <div className="flex justify-center w-full"><Renderer value={info.getValue()} data={info.row.original} row={info.row} /></div>;
                    }
                    if (col.field === 'code') {
                        return <span className="text-xs font-bold text-brand-cyan">{info.getValue() || '-'}</span>;
                    }
                    if (col.field === 'client') {
                        let finalDisplay = info.row.original.idClienteStr;
                        if (!finalDisplay) {
                            finalDisplay = info.getValue() || '-';
                        }
                        
                        // Limpieza extrema para mostrar solo UN DATO:
                        if (typeof finalDisplay === 'string') {
                            if (finalDisplay.includes(' - ')) {
                                finalDisplay = finalDisplay.split(' - ')[0].trim();
                            } else {
                                const matchParenthesis = finalDisplay.match(/^\(([^)]+)\)/);
                                if (matchParenthesis) {
                                    finalDisplay = matchParenthesis[1].trim();
                                } else if (finalDisplay.includes('-')) {
                                    finalDisplay = finalDisplay.split('-')[0].trim();
                                }
                            }
                        }

                        return (
                            <span className="text-xs font-bold text-zinc-700 truncate block w-full text-center">
                                {finalDisplay}
                            </span>
                        );
                    }
                    return <span className="text-xs font-medium text-zinc-700">{info.getValue() || '-'}</span>;
                }
            };
        });
    }, [propColumnDefs, internalColumnDefs, rowData]);

    // Cálculo de columnas vacías por defecto
    const emptyColumns = useMemo(() => {
        const empty = {};
        const sourceCols = propColumnDefs || internalColumnDefs;
        if (!rowData || rowData.length === 0) return empty;

        sourceCols.forEach(col => {
            if (!col.field) return; // Saltamos columnas sin campo (ej. acciones)
            
            const isAllEmpty = rowData.every(row => {
                const val = row[col.field];
                return val === null || val === undefined || String(val).trim() === '' || String(val).trim() === '-';
            });
            
            if (isAllEmpty) {
                empty[col.field] = false;
            }
        });
        
        return empty;
    }, [rowData, propColumnDefs, internalColumnDefs]);

    const table = useReactTable({
        data: rowData,
        columns,
        state: {
            rowSelection,
            columnVisibility: { ...emptyColumns, ...columnVisibility }
        },
        enableRowSelection: true,
        onRowSelectionChange: setRowSelection,
        onColumnVisibilityChange: setColumnVisibility,
        getRowId: row => row.id, // Usar el ID real de la base de datos
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        columnResizeMode: 'onChange',
        initialState: {
            pagination: { pageSize: 20 }
        }
    });

    return (
        <div className="flex flex-col h-full w-full bg-white overflow-hidden animate-in fade-in duration-300 relative">
            
            {/* Toolbar Superior */}
            {(toolbarContent || rowData.length > 0) && <div className="px-4 py-2 border-b-2 border-zinc-200 bg-zinc-50 flex justify-between items-center shrink-0 z-20">
                {/* Contenido Dinámico (Filtros, Historial, etc) */}
                <div className="flex-1 flex items-center overflow-visible flex-wrap gap-2">
                    {toolbarContent}
                </div>

                {/* Controles Nativos de la Tabla (Ocultar Columnas) */}
                <div className="relative group shrink-0 ml-4">
                    <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-white border border-zinc-200 rounded-lg text-zinc-600 hover:bg-brand-cyan/5 hover:text-brand-cyan hover:border-brand-cyan/30 transition-colors shadow-sm">
                        <i className="fa-solid fa-table-columns"></i> Columnas
                    </button>
                    {/* Dropdown Menu */}
                    <div className="absolute right-0 top-full pt-1 w-56 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all pointer-events-none group-hover:pointer-events-auto z-50">
                        <div className="bg-white border border-zinc-200 rounded-xl shadow-xl overflow-hidden">
                        <div className="p-2 flex flex-col gap-0.5">
                            <div className="px-2 py-1 mb-1 text-[10px] font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-100">Visibilidad de Columnas</div>
                            {table.getAllLeafColumns().map(column => {
                                if (column.id === 'col_0' || column.id === 'select') return null; // No ocultar la primera columna
                                return (
                                    <label key={column.id} className="flex items-center gap-3 px-2 py-1.5 hover:bg-zinc-50 rounded-lg cursor-pointer text-xs font-semibold text-zinc-700 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={column.getIsVisible()}
                                            onChange={column.getToggleVisibilityHandler()}
                                            className="w-3.5 h-3.5 accent-brand-cyan rounded border-zinc-300"
                                        />
                                        {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
                                    </label>
                                );
                            })}
                        </div>
                        </div>
                    </div>
                </div>
            </div>}

            {/* Contenedor de la tabla scrollable */}
            {table.getRowModel().rows.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400 bg-zinc-50">
                    <i className="fa-solid fa-inbox text-5xl text-zinc-200"></i>
                    <span className="text-sm font-medium">No hay órdenes para mostrar</span>
                </div>
            ) : (
                <div className="flex-1 overflow-auto bg-zinc-50 relative custom-scrollbar z-10">
                    <table 
                        className="text-left border-collapse overflow-hidden"
                        style={{ 
                            tableLayout: 'fixed',
                            width: '100%'
                        }}
                    >
                        <thead className="bg-zinc-100/90 backdrop-blur-md sticky top-0 z-20 border-b-2 border-zinc-200 shadow-sm">
                            {table.getHeaderGroups().map(headerGroup => (
                                <tr key={headerGroup.id}>
                                    {headerGroup.headers.map((header, index) => (
                                    <th
                                        key={header.id}
                                        className="py-3 px-2 text-[10px] font-black text-zinc-600 uppercase tracking-widest whitespace-nowrap bg-transparent relative group select-none border-r border-zinc-200/50 last:border-r-0 text-center first:border-l-4 first:border-transparent"
                                        style={{ 
                                            width: header.getSize(), 
                                            minWidth: header.column.columnDef.minSize || 50 
                                        }}
                                    >
                                        <div className="flex items-center justify-center gap-2 w-full overflow-hidden">
                                            <span className="truncate block w-full text-center">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                                        </div>
                                        {/* Agarrador para redimensionar centrado sobre el borde real */}
                                        {header.column.getCanResize() && (
                                            <div
                                                onMouseDown={header.getResizeHandler()}
                                                onTouchStart={header.getResizeHandler()}
                                                className={`absolute right-0 top-0 h-full w-[6px] translate-x-[50%] cursor-col-resize touch-none z-20 transition-colors ${
                                                    header.column.getIsResizing() ? 'bg-brand-cyan' : 'hover:bg-brand-cyan/40'
                                                }`}
                                            />
                                        )}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody className="bg-white">
                        {table.getRowModel().rows.length > 0 ? (
                            table.getRowModel().rows.map((row, rowIndex) => {
                                const isSelected = row.getIsSelected();
                                return (
                                    <tr
                                        key={row.id}
                                        onClick={() => row.toggleSelected()}
                                        className={`
                                            cursor-pointer transition-all border-b border-zinc-100 group row-appear
                                            ${flashingRowIds.map(String).includes(String(row.id)) ? 'flash-emerald' : ''}
                                            ${(() => {
                                                const code = (row.original?.code || '').toUpperCase();
                                                const priority = (row.original?.priority || '').toUpperCase();
                                                const isFalla = priority === 'FALLA' || code.includes('-F') || code.startsWith('F-') || code.startsWith('F ');
                                                if (isFalla) return isSelected ? 'bg-custom-cyan/40 hover:bg-custom-cyan/50' : 'bg-white hover:bg-zinc-50';
                                                return isSelected ? 'bg-custom-cyan/40 hover:bg-custom-cyan/50' : 'bg-white hover:bg-zinc-50';
                                            })()}
                                        `}
                                        style={{ animationDelay: `${Math.min(rowIndex, 20) * 30}ms` }}
                                    >
                                        {row.getVisibleCells().map(cell => (
                                            <td key={cell.id} className={`py-2 px-2 align-middle border-r border-zinc-200/40 last:border-r-0 text-center overflow-hidden whitespace-nowrap text-ellipsis max-w-[0px]`}>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })
                        ) : null}
                    </tbody>
                </table>
            </div>
            )}

            {/* Paginación Moderna */}
            {rowData.length > 0 && <div className="px-6 py-3.5 bg-white border-t border-zinc-200 flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-zinc-500 flex items-center gap-2">
                    <span className="bg-zinc-100 text-zinc-600 px-2 py-1 rounded-md">
                        Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}
                    </span>
                    <span className="font-medium text-zinc-400">({rowData.length} órdenes en total)</span>
                    <span className="bg-brand-cyan/10 text-brand-cyan px-2 py-1 rounded-md font-bold">
                        {rowData.reduce((sum, o) => sum + (parseFloat(o.magnitude) || 0), 0).toFixed(2)} m
                    </span>
                </span>
                
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                        className="w-8 h-8 flex items-center justify-center text-xs font-bold bg-white text-zinc-500 border border-zinc-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-zinc-50 hover:enabled:text-brand-cyan hover:enabled:border-brand-cyan/30"
                        title="Primera página"
                    >
                        <i className="fa-solid fa-angles-left"></i>
                    </button>
                    <button
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                        className="px-3 h-8 flex items-center gap-1.5 text-xs font-bold bg-white text-zinc-600 border border-zinc-200 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-zinc-50 hover:enabled:text-brand-cyan hover:enabled:border-brand-cyan/30"
                    >
                        <i className="fa-solid fa-angle-left"></i> Anterior
                    </button>
                    <button
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                        className="px-3 h-8 flex items-center gap-1.5 text-xs font-bold bg-white text-zinc-600 border border-zinc-200 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-zinc-50 hover:enabled:text-brand-cyan hover:enabled:border-brand-cyan/30"
                    >
                        Siguiente <i className="fa-solid fa-angle-right"></i>
                    </button>
                    <button
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                        disabled={!table.getCanNextPage()}
                        className="w-8 h-8 flex items-center justify-center text-xs font-bold bg-white text-zinc-500 border border-zinc-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-zinc-50 hover:enabled:text-brand-cyan hover:enabled:border-brand-cyan/30"
                        title="Última página"
                    >
                        <i className="fa-solid fa-angles-right"></i>
                    </button>
                </div>
            </div>}
            
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                @keyframes rowAppear {
                    from { opacity: 0; transform: translateY(6px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                .row-appear {
                    animation: rowAppear 0.25s ease both;
                }
                @keyframes flashEmerald {
                    0% { background-color: #10b981; color: white; }
                    10% { background-color: #34d399; color: black; }
                    100% { background-color: transparent; }
                }
                tr.flash-emerald td {
                    animation: flashEmerald 3s ease-out forwards;
                }
                @keyframes pulseFallaBadge {
                    0%, 100% { background-color: rgb(239 68 68); color: white; opacity: 1; }
                    50%       { background-color: rgb(239 68 68); color: white; opacity: 0.5; }
                }
                td:has(.pulse-falla-badge) { /* reset td bg */
                    background-color: transparent !important;
                }
                .pulse-falla-badge {
                    animation: pulseFallaBadge 2s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}

