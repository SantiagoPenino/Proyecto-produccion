import React, { useState } from 'react';
import ProductionTable from '../components/ProductionTable.jsx';
import WorkflowFlows from '../components/Workflow.jsx';

const CoordinacionArea = ({ orders, onOrderUpdate }) => {
  const [currentView, setCurrentView] = useState('orders');

  const areaConfig = {
    name: 'Coordinación de Producto',
    gridTemplate: '40px 40px 60px 80px 80px 120px 220px 150px 150px 100px 100px 90px 50px',
    headers: ['', 'Pos', 'Orden', 'Ingreso', 'Tiempo', 'Cliente', 'Producto', 'Flujo', 'Abastecimiento', 'Origen', 'Estado', 'Chat']
  };

  const renderView = () => {
    switch (currentView) {
      case 'orders':
        return (
          <ProductionTable
            orders={orders.filter(o => o.area === 'COORD')}
            areaConfig={areaConfig}
            selectedOrders={[]}
            onOrderSelect={() => {}}
            onDeselectAll={() => {}}
          />
        );
      case 'flows':
        return <WorkflowFlows orders={orders.filter(o => o.area === 'COORD')} />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex justify-between items-center sticky top-0 z-20 shrink-0">
        <div className="flex gap-4 items-center">
          <div>
            <h2 className="font-bold text-slate-800 text-lg leading-tight">
              {areaConfig.name}
            </h2>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">
              Coordinación
            </p>
          </div>
          
          <div className="flex bg-indigo-50 rounded p-1 ml-2">
            <button
              onClick={() => setCurrentView('orders')}
              className={`px-3 py-1 text-xs font-bold rounded ${
                currentView === 'orders' 
                  ? 'bg-white shadow text-indigo-700' 
                  : 'text-slate-500 hover:text-indigo-700'
              }`}
            >
              Órdenes
            </button>
            <button
              onClick={() => setCurrentView('flows')}
              className={`px-3 py-1 text-xs font-bold rounded flex items-center gap-1 ${
                currentView === 'flows' 
                  ? 'bg-white shadow text-indigo-700' 
                  : 'text-slate-500 hover:text-indigo-700'
              }`}
            >
              <i className="fa-solid fa-diagram-project"></i>
              Flujos de Trabajo
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {renderView()}
      </div>
    </div>
  );
};

export default CoordinacionArea;