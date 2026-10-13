// SIN USO (13/10): AreaView lo importa pero no lo renderiza (renderSidebar devuelve null). Ver docs/auditoria-limpieza-2026-10-09.md.
import React from 'react';

const RollSidebar = ({ orders, currentFilter, onFilterChange, onClose, title = "LOTES" }) => {

  // 1. Agrupamos las órdenes (Igual que antes)
  const itemsMap = orders.reduce((acc, order) => {
    const key = order.rollId || 'Sin Asignar';

    if (!acc[key]) {
      acc[key] = { id: key, count: 0 };
    }
    acc[key].count += 1;
    return acc;
  }, {});

  // 2. Convertimos a Array y ORDENAMOS
  const sortedItems = Object.values(itemsMap).sort((a, b) => {
    // Regla 1: "Sin Asignar" debe ir PRIMERO
    if (a.id === 'Sin Asignar') return -1;
    if (b.id === 'Sin Asignar') return 1;

    // Regla 2: El resto se ordena alfanuméricamente (para que Rollo 1, Rollo 2... salgan en orden)
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' });
  });

  return (
    <aside className="w-[240px] h-full flex flex-col bg-white border-r border-slate-200 shrink-0">

      {/* Encabezado */}
      <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
        <h3 className="text-sm font-black text-slate-700 uppercase tracking-wide">{title}</h3>
        <button
          className="text-slate-400 hover:text-slate-600 w-6 h-6 flex items-center justify-center rounded hover:bg-slate-200 transition-colors"
          onClick={onClose}
          title="Ocultar panel"
        >
          <i className="fa-solid fa-angles-left text-sm"></i>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">

        {/* Opción TODOS (Siempre fija arriba) */}
        <button
          className={`w-full text-left px-3 py-2.5 rounded-lg flex justify-between items-center transition-all group ${currentFilter === 'ALL'
            ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200'
            : 'text-slate-600 hover:bg-slate-50'
            }`}
          onClick={() => onFilterChange('ALL')}
        >
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${currentFilter === 'ALL' ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
            <span className="text-sm font-bold">Todos</span>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${currentFilter === 'ALL' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'}`}>
            {orders.length}
          </span>
        </button>

        {/* Separador */}
        <div className="h-px bg-slate-100 my-1 mx-2"></div>

        {/* Lista Ordenada (Sin Asignar va primero) */}
        {sortedItems.map(item => {
          const isUnassigned = item.id === 'Sin Asignar';
          const isActive = currentFilter === item.id;

          return (
            <button
              key={item.id}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex justify-between items-center transition-all group ${isActive
                ? 'bg-white shadow-md ring-1 ring-slate-200 z-10'
                : 'text-slate-600 hover:bg-slate-50'
                }`}
              onClick={() => onFilterChange(item.id)}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                {isUnassigned ? (
                  <i className={`fa-solid fa-triangle-exclamation text-xs ${isActive ? 'text-red-500' : 'text-red-400'}`}></i>
                ) : (
                  <i className={`fa-solid fa-layer-group text-xs ${isActive ? 'text-indigo-500' : 'text-slate-400'}`}></i>
                )}

                <span className={`text-sm font-bold truncate ${isUnassigned
                  ? (isActive ? 'text-red-700' : 'text-red-600')
                  : (isActive ? 'text-slate-800' : 'text-slate-600')
                  }`}>
                  {isUnassigned ? 'Sin Asignar' : item.id}
                </span>
              </div>

              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-400'}`}>
                {item.count}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  );
};

export default RollSidebar;
