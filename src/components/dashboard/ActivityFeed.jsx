// SIN USO (13/10): datos de ejemplo fijos; Dashboard.jsx dejó de importarlo el 02/03. Confirmar con Yoania si se usa o se borra. Ver docs/auditoria-limpieza-2026-10-09.md.
import React from 'react';

// Ejemplo de actividad, luego puedes pasarla como prop si quieres
const activityLog = [
  { type: 'start', text: 'Carlos inició corte en #1050', time: 'Hace 10m' },
  { type: 'error', text: 'Reporte retraso en Área UV', time: 'Hace 1h' }
];

const ActivityFeed = ({ activities = activityLog }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2 hidden"> {/* Titulo oculto si ya viene del padre */}
        <h3 className="text-sm font-bold text-slate-700">Actividad Reciente</h3>
      </div>

      <div className="relative pl-2">
        {/* Linea Vertical Conectora */}
        <div className="absolute left-2.5 top-0 bottom-4 w-0.5 bg-slate-100"></div>

        {activities.map((item, idx) => {
          const isError = item.type === 'error';
          return (
            <div key={idx} className="flex gap-4 relative mb-6 last:mb-0 group">
              {/* Dot Indicator */}
              <div className={`
                        w-5 h-5 rounded-full border-4 border-white shadow-sm flex-shrink-0 relative z-10
                        ${isError ? 'bg-red-500' : 'bg-green-500'}
                    `}></div>

              <div className="flex-1 -mt-1 p-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all">
                <div className="flex justify-between items-start">
                  <p className={`text-sm font-bold ${isError ? 'text-red-700' : 'text-slate-700'}`}>
                    {item.text}
                  </p>
                  <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap bg-slate-100 px-2 py-0.5 rounded-full">{item.time}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {activities.length === 0 && (
        <div className="text-center py-6 text-slate-400 text-xs italic">
          No hay actividad reciente.
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
