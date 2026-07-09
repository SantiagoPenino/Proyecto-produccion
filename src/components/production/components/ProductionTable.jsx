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
import { isTabletDevice } from '../../../utils/device';

// Tablets de planta (1200x800): la tabla completa no entra → arrancar con las columnas
// secundarias ocultas (el operario puede volver a mostrarlas desde "Columnas").
const IS_TABLET = isTabletDevice();
const TABLET_HIDDEN_DEFAULT = {
    variantCode: false,   // Variante (está dentro del material casi siempre)
    status: false,        // Estado General (se conserva Estado en Área, más específico)
    filesCount: false,    // Archivos
    ink: false,           // Tinta
    note: false,          // Nota
    observations: false,  // Observaciones
};

export default function ProductionTable({ rowData = [], onRowSelected, selectedRowIds, onRowClick, columnDefs: propColumnDefs, toolbarContent, flashingRowIds = [] }) {

    const [rowSelection, setRowSelection] = useState({});
    const [columnVisibility, setColumnVisibility] = useState(() => (IS_TABLET ? { ...TABLET_HIDDEN_DEFAULT } : {}));

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

    // Al cambiar los datos (p. ej. refetch por un pedido nuevo entrante), PRESERVAR la selección
    // del usuario; sólo descartar los ids que ya no estén en la lista. Antes se limpiaba todo
    // (setRowSelection({})), por eso un pedido nuevo deseleccionaba lo que estabas por asignar.
    useEffect(() => {
        setRowSelection(prev => {
            const validIds = new Set(rowData.map(r => String(r.id)));
            const next = {};
            Object.keys(prev).forEach(k => {
                if (prev[k] && validIds.has(k)) next[k] = true;
            });
            const prevSel = Object.keys(prev).filter(k => prev[k]);
            const nextSel = Object.keys(next);
            // Sin cambios reales → mantener la referencia (evita re-render y el sync innecesario).
            if (prevSel.length === nextSel.length && prevSel.every(k => next[k])) return prev;
            return next;
        });
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
            <span className={`text-xs tablet:text-[11px] font-bold uppercase tracking-wide tablet:tracking-tight ${colorClass}`}>
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
            return <span className="pulse-falla-badge inline-flex items-center px-3 py-1 tablet:px-1.5 tablet:py-0.5 rounded text-xs tablet:text-[10px] font-bold uppercase tracking-wide tablet:tracking-tight">FALLA</span>;
        }
        if (params.value === 'Urgente') {
            return <span className="text-xs tablet:text-[10px] font-bold text-brand-magenta uppercase tracking-wide tablet:tracking-tight">URGENTE</span>;
        }
        if (params.value === 'Reposición' || params.value === 'Reposicion' || params.value === 'REPOSICIÓN') {
            return <span className="text-xs tablet:text-[10px] font-bold text-orange-500 uppercase tracking-wide tablet:tracking-tight">REPOSICIÓN</span>;
        }
        return <span className="text-xs tablet:text-[11px] text-zinc-500 font-medium">{params.value || 'Normal'}</span>;
    };

    const BatchRenderer = (params) => {
        if (!params.value) return <span className="text-xs tablet:text-[11px] text-zinc-300">-</span>;
        return (
            <span className="text-xs tablet:text-[11px] font-bold text-brand-cyan">
                {params.value}
            </span>
        );
    };

    const FilesRenderer = (params) => {
        const val = params.value;
        const displayVal = val !== undefined && val !== null && val !== '' ? val : 0;
        return <span className="text-xs tablet:text-[11px] font-bold text-zinc-600">{displayVal}</span>;
    };

    const DateRenderer = (params) => {
        if (!params.value) return null;
        const date = new Date(params.value);
        return (
            <div className="flex flex-col leading-tight">
                <span className="text-xs tablet:text-[11px] font-bold text-zinc-700">{date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                <span className="text-[10px] tablet:text-[9px] text-zinc-400 font-medium">{date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
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
            // OJO: devolver un string pelado hace que la celda herede los 16px del body (se veía gigante)
            return <span className="text-xs tablet:text-[11px] font-bold text-zinc-700">{`${display}${unitDisplay ? ' ' + unitDisplay : ''}`}</span>;
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
                // En TABLET la fuente baja a 11px → menos px por carácter, colchón y cap más chicos.
                const pxChar = IS_TABLET ? 7 : 8;
                const pxCharLargo = IS_TABLET ? 4.8 : 5.5;
                const colchon = IS_TABLET ? 16 : 24;
                const cap = IS_TABLET ? 160 : 200;

                let textWidth = maxChars * pxChar;
                if (maxChars > 15) {
                    textWidth = (15 * pxChar) + ((maxChars - 15) * pxCharLargo);
                }

                const minHeaderWidth = col.headerName ? Math.max(col.headerName.length * (IS_TABLET ? 7.5 : 9) + colchon, 45) : 45;
                computedSize = Math.min(Math.max(textWidth + colchon, minHeaderWidth), cap);
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
                        return <span className="text-xs tablet:text-[11px] font-bold text-brand-cyan">{info.getValue() || '-'}</span>;
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
                            <span className="text-xs tablet:text-[11px] font-bold text-zinc-700 truncate block w-full text-center">
                                {finalDisplay}
                            </span>
                        );
                    }
                    return <span className="text-xs tablet:text-[11px] font-medium text-zinc-700">{info.getValue() || '-'}</span>;
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
            {(toolbarContent || rowData.length > 0) && <div className="px-4 py-2 tablet:px-2 tablet:py-1.5 border-b-2 border-zinc-200 bg-zinc-50 flex justify-between items-center shrink-0 z-20">
                {/* Contenido Dinámico (Filtros, Historial, etc) */}
                <div className="flex-1 flex items-center overflow-visible flex-wrap gap-2 tablet:gap-1.5">
                    {toolbarContent}
                </div>

                {/* Controles Nativos de la Tabla (Ocultar Columnas) */}
                <div className="relative group shrink-0 ml-4 tablet:ml-2">
                    <button className="flex items-center gap-2 px-3 py-1.5 tablet:px-2 tablet:py-1 text-xs tablet:text-[11px] font-bold bg-white border border-zinc-200 rounded-lg text-zinc-600 hover:bg-brand-cyan/5 hover:text-brand-cyan hover:border-brand-cyan/30 transition-colors shadow-sm">
                        <i className="fa-solid fa-table-columns"></i> <span className="tablet:hidden">Columnas</span>
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
                        className="text-left border-collapse overflow-hidden text-xs tablet:text-[11px]"
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
                                        className="py-3 px-2 tablet:py-1.5 tablet:px-1 text-[10px] tablet:text-[9px] font-black text-zinc-600 uppercase tracking-widest tablet:tracking-normal whitespace-nowrap bg-transparent relative group select-none border-r border-zinc-200/50 last:border-r-0 text-center first:border-l-4 first:border-transparent"
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
                                            <td key={cell.id} className={`py-2 px-2 tablet:py-1 tablet:px-1 align-middle border-r border-zinc-200/40 last:border-r-0 text-center overflow-hidden whitespace-nowrap text-ellipsis max-w-[0px]`}>
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
            {rowData.length > 0 && <div className="px-6 py-3.5 tablet:px-3 tablet:py-2 bg-white border-t border-zinc-200 flex items-center justify-between shrink-0">
            <span className="text-xs tablet:text-[11px] font-bold text-zinc-500 flex items-center gap-2 tablet:gap-1.5">
                    <span className="bg-zinc-100 text-zinc-600 px-2 py-1 tablet:px-1.5 tablet:py-0.5 rounded-md">
                        Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}
                    </span>
                    <span className="font-medium text-zinc-400 tablet:hidden">({rowData.length} órdenes en total)</span>
                    <span className="hidden tablet:inline font-medium text-zinc-400">({rowData.length})</span>
                    <span className="bg-brand-cyan/10 text-brand-cyan px-2 py-1 tablet:px-1.5 tablet:py-0.5 rounded-md font-bold">
                        {rowData.reduce((sum, o) => sum + (parseFloat(o.magnitude) || 0), 0).toFixed(2)} m
                    </span>
                    {table.getSelectedRowModel().rows.length > 0 && (
                        <span className="bg-indigo-100 text-indigo-700 px-2 py-1 tablet:px-1.5 tablet:py-0.5 rounded-md font-bold">
                            {table.getSelectedRowModel().rows.length} sel. · {table.getSelectedRowModel().rows.reduce((sum, r) => sum + (parseFloat(r.original.magnitude) || 0), 0).toFixed(2)} m
                        </span>
                    )}
                </span>
                
                <div className="flex items-center gap-2 tablet:gap-1">
                    <button
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                        className="w-8 h-8 tablet:w-7 tablet:h-7 flex items-center justify-center text-xs font-bold bg-white text-zinc-500 border border-zinc-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-zinc-50 hover:enabled:text-brand-cyan hover:enabled:border-brand-cyan/30"
                        title="Primera página"
                    >
                        <i className="fa-solid fa-angles-left"></i>
                    </button>
                    <button
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                        className="px-3 h-8 tablet:px-2 tablet:h-7 flex items-center gap-1.5 text-xs tablet:text-[11px] font-bold bg-white text-zinc-600 border border-zinc-200 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-zinc-50 hover:enabled:text-brand-cyan hover:enabled:border-brand-cyan/30"
                    >
                        <i className="fa-solid fa-angle-left"></i> <span className="tablet:hidden">Anterior</span>
                    </button>
                    <button
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                        className="px-3 h-8 tablet:px-2 tablet:h-7 flex items-center gap-1.5 text-xs tablet:text-[11px] font-bold bg-white text-zinc-600 border border-zinc-200 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-zinc-50 hover:enabled:text-brand-cyan hover:enabled:border-brand-cyan/30"
                    >
                        <span className="tablet:hidden">Siguiente</span> <i className="fa-solid fa-angle-right"></i>
                    </button>
                    <button
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                        disabled={!table.getCanNextPage()}
                        className="w-8 h-8 tablet:w-7 tablet:h-7 flex items-center justify-center text-xs font-bold bg-white text-zinc-500 border border-zinc-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-zinc-50 hover:enabled:text-brand-cyan hover:enabled:border-brand-cyan/30"
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

