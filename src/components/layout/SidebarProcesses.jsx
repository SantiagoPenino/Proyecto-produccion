// SIN USO (13/10): AreaView dejó de usarlo; la navegación por áreas está en MainAppContent + Navbar. Ver docs/auditoria-limpieza-2026-10-09.md.
import React from "react";

const SidebarProcesses = ({
  allAreaConfigs, // Recibe TODAS las configs para listar las áreas
  currentArea,
  onAreaChange
}) => {
  return (
    <aside className="w-[260px] h-full flex flex-col bg-white border-r border-slate-200 shrink-0">
      <div className="p-5 border-b border-slate-100 bg-slate-50">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Menú General</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {Object.entries(allAreaConfigs).map(([areaKey, config]) => {
          // Solo mostramos si tiene nombre definido
          if (!config.name) return null;

          const isActive = currentArea === areaKey;

          return (
            <button
              key={areaKey}
              className={`w-full text-left px-4 py-3 rounded-xl flex justify-between items-center transition-all group ${isActive
                  ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                }`}
              onClick={() => onAreaChange(areaKey)}
            >
              <div className="flex items-center gap-3">
                <span className={`text-lg p-1.5 rounded-lg ${isActive ? 'bg-white shadow-sm' : 'grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100'}`}>
                  {config.icon || "🏭"}
                </span>
                <div className="flex flex-col">
                  <span className={`text-sm font-bold ${isActive ? 'text-blue-800' : 'text-slate-700'}`}>
                    {config.name}
                  </span>
                  {isActive && <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Activo</span>}
                </div>
              </div>

              {isActive && (
                <div className="w-2 h-2 rounded-full bg-blue-500 shadow-sm shadow-blue-300"></div>
              )}
            </button>
          );
        })}
      </div>

      <div className="p-4 border-t border-slate-100 bg-slate-50">
        <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs shadow-sm">
            <i className="fa-solid fa-user-gear"></i>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-indigo-900">Panel Admin</span>
            <span className="text-[10px] text-indigo-500">Configuraciones</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default SidebarProcesses;
