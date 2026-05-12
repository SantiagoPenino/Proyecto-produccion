import React, { useState, useEffect } from 'react';

const Workflow = ({ orders }) => {
  const [workflows, setWorkflows] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    generateWorkflows();
  }, [orders]);

  const generateWorkflows = () => {
    const coordOrders = orders.filter(order => order.area === 'COORD');

    const generatedWorkflows = coordOrders.map(order => ({
      id: order.id,
      client: order.client,
      product: order.desc,
      status: order.status,
      progress: order.progress || 30,
      flow: order.flow || 'Diseño > Sub > Costura',
      currentStep: getCurrentStep(order.status),
      steps: generateSteps(order),
      priority: order.priority,
      supply: order.supply || 'Stock OK',
      source: order.source || 'Propia',
      lastUpdate: 'Hace 2h',
      assignedTo: 'Coordinación Central'
    }));

    setWorkflows(generatedWorkflows);
  };

  const getCurrentStep = (status) => {
    const stepMap = {
      'Pendiente': 0,
      'Diseño': 1,
      'En Proceso': 2,
      'Producción': 3,
      'Finalizado': 4
    };
    return stepMap[status] || 0;
  };

  const generateSteps = (order) => {
    return [
      { name: 'Ingreso', status: 'completed', area: 'COORD', time: '22/11 09:00' },
      { name: 'Diseño', status: 'completed', area: 'DISEÑO', time: '22/11 10:30' },
      { name: 'Producción', status: order.status === 'En Proceso' ? 'active' : 'pending', area: 'PRODUCCIÓN', time: 'En proceso' },
      { name: 'Control Calidad', status: 'pending', area: 'CALIDAD', time: 'Pendiente' },
      { name: 'Empaque', status: 'pending', area: 'LOGÍSTICA', time: 'Pendiente' }
    ];
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'En Proceso': return 'bg-blue-100 text-blue-700';
      case 'Pendiente': return 'bg-yellow-100 text-yellow-700';
      case 'Finalizado': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStepStatusIcon = (status) => {
    switch (status) {
      case 'completed': return 'fa-solid fa-check-circle text-green-500 text-lg';
      case 'active': return 'fa-solid fa-play-circle text-blue-500 animate-pulse text-lg';
      case 'pending': return 'fa-regular fa-clock text-gray-300 text-lg';
      default: return 'fa-regular fa-circle text-gray-200 text-lg';
    }
  };

  const filteredWorkflows = workflows.filter(workflow => {
    if (filter === 'all') return true;
    if (filter === 'active') return workflow.status === 'En Proceso';
    if (filter === 'pending') return workflow.status === 'Pendiente';
    if (filter === 'completed') return workflow.status === 'Finalizado';
    return true;
  });

  const getProgressColor = (progress) => {
    if (progress < 30) return 'bg-red-500';
    if (progress < 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="flex-1 flex flex-col bg-indigo-50/50 p-6 overflow-y-auto">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-xl font-bold text-indigo-900 flex items-center gap-2">
            <i className="fa-solid fa-diagram-project"></i>
            Flujos de Trabajo
          </h2>
          <p className="text-sm text-indigo-600 font-medium">
            Estado integral de órdenes multidepartamento
          </p>
        </div>

        <div className="flex bg-white rounded-lg p-1 gap-1 shadow-sm border border-indigo-100">
          <button
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${filter === 'all' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:bg-zinc-50'}`}
            onClick={() => setFilter('all')}
          >
            Todos ({workflows.length})
          </button>
          <button
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${filter === 'active' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:bg-zinc-50'}`}
            onClick={() => setFilter('active')}
          >
            En Proceso ({workflows.filter(w => w.status === 'En Proceso').length})
          </button>
          <button
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${filter === 'pending' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:bg-zinc-50'}`}
            onClick={() => setFilter('pending')}
          >
            Pendientes ({workflows.filter(w => w.status === 'Pendiente').length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredWorkflows.map(workflow => (
          <div key={workflow.id} className="bg-white rounded-xl shadow-sm border border-indigo-100 overflow-hidden hover:shadow-md transition-all group">
            {/* Header */}
            <div className="p-4 border-b border-indigo-50 flex justify-between items-center bg-white">
              <div className="flex items-center gap-3">
                <span className="font-black text-sm text-indigo-900">ORD-{workflow.id}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${getStatusColor(workflow.status)}`}>
                  {workflow.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-100">{workflow.priority}</span>
                <span>{workflow.lastUpdate}</span>
              </div>
            </div>

            {/* Client and Product */}
            <div className="p-4 border-b border-indigo-50 bg-white">
              <h3 className="font-bold text-zinc-800 text-sm mb-1">{workflow.client}</h3>
              <p className="text-xs text-zinc-500">{workflow.product}</p>
            </div>

            {/* Progress Bar */}
            <div className="p-4 border-b border-indigo-50 bg-zinc-50/50">
              <div className="flex justify-between items-center mb-2 text-xs font-bold text-zinc-600">
                <span>Progreso General</span>
                <span className="text-indigo-800">{workflow.progress}%</span>
              </div>
              <div className="w-full bg-zinc-200 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${getProgressColor(workflow.progress)}`}
                  style={{ width: `${workflow.progress}%` }}
                ></div>
              </div>
            </div>

            {/* Flow Steps */}
            <div className="p-5 border-b border-indigo-50">
              <div className="font-bold text-zinc-700 text-xs mb-4 flex items-center gap-2 uppercase tracking-wide">
                <i className="fa-solid fa-route text-indigo-500"></i>
                Flujo: {workflow.flow}
              </div>

              <div className="space-y-0 relative">
                {/* Vertical Line Connector (Absolute) */}
                <div className="absolute left-[9px] top-2 bottom-4 w-0.5 bg-zinc-200 z-0"></div>

                {workflow.steps.map((step, index) => (
                  <div key={index} className="flex items-start gap-4 relative z-10 pb-4 last:pb-0">
                    <div className="bg-white rounded-full p-1 border-4 border-white">
                      <i className={getStepStatusIcon(step.status)}></i>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-zinc-700">{step.name}</div>
                      <div className="flex justify-between items-center mt-1 text-xs">
                        <span className="bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded font-bold">{step.area}</span>
                        <span className="text-zinc-400">{step.time}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Additional Info */}
            <div className="p-4 border-b border-indigo-50 bg-zinc-50 grid grid-cols-2 gap-y-3">
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <i className="fa-solid fa-truck-loading text-green-500 w-4 text-center"></i>
                <span>Abastecimiento: <strong>{workflow.supply}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <i className="fa-solid fa-factory text-blue-500 w-4 text-center"></i>
                <span>Origen: <strong>{workflow.source}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-600 col-span-2">
                <i className="fa-solid fa-user text-purple-500 w-4 text-center"></i>
                <span>Asignado: <strong>{workflow.assignedTo}</strong></span>
              </div>
            </div>

            {/* Actions */}
            <div className="p-3 bg-white flex gap-2">
              <button className="flex-1 py-2 rounded bg-zinc-100 text-zinc-600 text-xs font-bold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2">
                <i className="fa-solid fa-eye"></i> Detalles
              </button>
              <button className="flex-1 py-2 rounded bg-zinc-100 text-zinc-600 text-xs font-bold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2">
                <i className="fa-solid fa-pen-to-square"></i> Editar
              </button>
              <button className="flex-1 py-2 rounded bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-sm">
                Next <i className="fa-solid fa-forward"></i>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredWorkflows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center mb-6">
            <i className="fa-solid fa-diagram-project text-indigo-300 text-5xl"></i>
          </div>
          <h3 className="text-xl font-bold text-zinc-600 mb-2">No hay flujos activos</h3>
          <p className="text-zinc-400 text-sm max-w-sm mx-auto">
            {filter !== 'all'
              ? `No hay flujos en estado "${filter}" actualmente.`
              : 'No se encontraron órdenes de coordinación para mostrar.'
            }
          </p>
        </div>
      )}
    </div>
  );
};

export default Workflow;
