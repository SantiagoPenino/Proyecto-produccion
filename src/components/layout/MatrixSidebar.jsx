// SIN USO (13/10): AreaView lo importa pero no lo renderiza (renderSidebar devuelve null). Ver docs/auditoria-limpieza-2026-10-09.md.
const MatrixSidebar = ({ orders, currentFilter, onFilterChange }) => {
  // Agrupar por estado de matriz (específico de Bordado)
  const matrixGroups = orders.reduce((acc, order) => {
    const status = order.matrixStatus || 'PENDING';
    if (!acc[status]) {
      acc[status] = {
        status,
        orders: [],
        totalStitches: 0
      };
    }
    acc[status].orders.push(order);
    acc[status].totalStitches += order.stitches || 0;
    return acc;
  }, {});

  const getStatusColor = (status) => {
    const colors = {
      APPROVED: '#10b981', // emerald-500
      PENDING: '#f59e0b', // amber-500
      TESTING: '#3b82f6', // blue-500
      REJECTED: '#ef4444' // red-500
    };
    return colors[status] || '#64748b'; // slate-500
  };

  const getStatusName = (status) => {
    const names = {
      APPROVED: 'Aprobadas',
      PENDING: 'Pendientes',
      TESTING: 'En Prueba',
      REJECTED: 'Rechazadas'
    };
    return names[status] || status;
  };

  return (
    <aside className="w-[240px] h-full flex flex-col bg-white border-r border-slate-200 shrink-0">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 className="text-sm font-black text-slate-700 uppercase tracking-wide">Matrices / Diseños</h3>
        <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-bold">{orders.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Filtro Todos */}
        <button
          className={`w-full text-left px-3 py-3 rounded-lg flex justify-between items-center transition-all group ${currentFilter === 'ALL'
            ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200'
            : 'text-slate-600 hover:bg-slate-50'
            }`}
          onClick={() => onFilterChange('ALL')}
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-slate-400"></div>
            <span className="text-sm font-bold">Todas las Matrices</span>
          </div>
          <span className={`text-xs font-bold ${currentFilter === 'ALL' ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`}>{orders.length}</span>
        </button>

        {/* Grupos por estado de matriz */}
        {Object.values(matrixGroups).map(group => {
          const isActive = currentFilter === group.status;
          const color = getStatusColor(group.status);

          return (
            <button
              key={group.status}
              className={`w-full text-left px-3 py-3 rounded-lg flex justify-between items-center transition-all group relative overflow-hidden ${isActive
                ? 'bg-white shadow-md ring-1 ring-slate-200 z-10'
                : 'text-slate-600 hover:bg-slate-50'
                }`}
              onClick={() => onFilterChange(group.status)}
            >
              {isActive && <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: color }}></div>}

              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}></div>
                <div className="flex flex-col">
                  <span className={`text-sm font-bold ${isActive ? 'text-slate-800' : 'text-slate-600'}`}>
                    {getStatusName(group.status)}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium lowercase">
                    {(group.totalStitches / 1000).toFixed(0)}k puntadas
                  </span>
                </div>
              </div>

              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isActive ? 'bg-slate-100 text-slate-700' : 'bg-slate-100 text-slate-400'}`}>
                {group.orders.length}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  );
};

export default MatrixSidebar;
