import React, { useState, useEffect } from 'react';

const BordadoScheduler = ({ orders }) => {
  const [pendingOrders, setPendingOrders] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [machineLoad, setMachineLoad] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Máquinas de bordado disponibles
  const machines = [
    { id: 'M-BORD-01', name: 'Tajima 6', heads: 6, speed: 800, capacity: 200000, currentLoad: 0 },
    { id: 'M-BORD-02', name: 'Brother 4', heads: 4, speed: 750, capacity: 120000, currentLoad: 0 },
    { id: 'M-BORD-03', name: 'Tajima 12', heads: 12, speed: 1000, capacity: 300000, currentLoad: 0 }
  ];

  useEffect(() => {
    loadPendingOrders();
    calculateMachineLoad();
  }, [orders]);

  const loadPendingOrders = () => {
    const pending = orders.filter(order =>
      order.area === 'BORD' &&
      order.status !== 'Finalizado' &&
      order.status !== 'Entregado'
    );
    setPendingOrders(pending);
  };

  const calculateMachineLoad = () => {
    const load = machines.map(machine => ({
      ...machine,
      currentLoad: Math.floor(Math.random() * 80) + 10, // Simulado
      estimatedCompletion: `~${Math.floor(Math.random() * 4) + 2}h`
    }));
    setMachineLoad(load);
  };

  const runAutoScheduler = async () => {
    setIsLoading(true);

    // Simular procesamiento de IA
    await new Promise(resolve => setTimeout(resolve, 2000));

    const newSuggestions = generateSuggestions();
    setSuggestions(newSuggestions);
    setIsLoading(false);
  };

  const generateSuggestions = () => {
    return pendingOrders.slice(0, 3).map(order => ({
      orderId: order.id,
      client: order.client,
      description: order.desc,
      stitches: order.stitches || 0,
      recommendedMachine: machines[Math.floor(Math.random() * machines.length)].id,
      priority: ['Alta', 'Media', 'Baja'][Math.floor(Math.random() * 3)],
      estimatedTime: `${Math.floor((order.stitches || 10000) / 500)}min`,
      reason: getSuggestionReason(order)
    }));
  };

  const getSuggestionReason = (order) => {
    const reasons = [
      'Optimización de cabezales disponibles',
      'Compatibilidad de diseño con máquina',
      'Prioridad por tiempo de entrega',
      'Balance de carga entre máquinas',
      'Eficiencia en cambio de hilos'
    ];
    return reasons[Math.floor(Math.random() * reasons.length)];
  };

  const applySuggestion = (suggestion) => {
    // Aquí iría la lógica para aplicar la sugerencia
    console.log('Aplicando sugerencia:', suggestion);

    // Remover de pendientes y sugerencias
    setPendingOrders(prev => prev.filter(order => order.id !== suggestion.orderId));
    setSuggestions(prev => prev.filter(s => s.orderId !== suggestion.orderId));

    // Actualizar carga de máquinas
    calculateMachineLoad();
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'Alta': return 'bg-red-100 text-red-700';
      case 'Media': return 'bg-amber-100 text-amber-700';
      case 'Baja': return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-zinc-100 text-zinc-700';
    }
  };

  const getLoadColor = (load) => {
    if (load < 40) return 'bg-emerald-500';
    if (load < 80) return 'bg-amber-500';
    return 'bg-red-500';
  }

  return (
    <div className="flex-1 flex flex-col bg-zinc-50 p-6 overflow-hidden">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-xl font-bold text-zinc-800 flex items-center gap-2">
            <i className="fa-solid fa-wand-magic-sparkles text-pink-500"></i>
            Planificador de Bordado
          </h2>
          <p className="text-sm text-zinc-500 font-medium">Optimización de carga por IA</p>
        </div>

        <button
          className="bg-pink-600 hover:bg-pink-700 text-white px-5 py-2 rounded-lg font-bold shadow-lg shadow-pink-500/30 transition-all active:scale-95 flex items-center gap-2 disabled:bg-zinc-400 disabled:cursor-not-allowed disabled:shadow-none"
          onClick={runAutoScheduler}
          disabled={isLoading}
        >
          {isLoading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-robot"></i>}
          {isLoading ? 'Procesando...' : 'Auto-Asignar'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full overflow-hidden">

        {/* Columna 1: Cola de Espera */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 flex flex-col overflow-hidden h-full">
          <div className="p-4 bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-700 text-sm flex items-center gap-2">
            <i className="fa-solid fa-list-ul text-zinc-400"></i>
            Cola de Espera
            <span className="ml-auto bg-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full text-xs">{pendingOrders.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {pendingOrders.length === 0 ? (
              <div className="text-center py-8 text-zinc-400">
                <i className="fa-solid fa-check-circle text-emerald-400 text-3xl mb-2"></i>
                <p className="text-sm">Sin órdenes pendientes</p>
              </div>
            ) : (
              pendingOrders.map(order => (
                <div key={order.id} className="bg-white border border-zinc-200 rounded-lg p-3 hover:shadow-md transition-all cursor-pointer group hover:border-blue-300">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-zinc-800 text-sm">Orden No.: {order.id}</span>
                    <span className="text-xs text-zinc-500 font-medium truncate max-w-[120px]" title={order.client}>{order.client}</span>
                  </div>
                  <p className="text-xs text-zinc-600 mb-3 line-clamp-2" title={order.desc}>{order.desc}</p>
                  <div className="flex justify-between text-xs text-zinc-500 border-t border-zinc-100 pt-2">
                    <span className="flex items-center gap-1 font-mono">
                      <i className="fa-solid fa-thread text-zinc-400"></i>
                      {order.stitches ? order.stitches.toLocaleString() : '0'} pts
                    </span>
                    <span className="flex items-center gap-1 font-bold">
                      <i className="fa-solid fa-hashtag text-zinc-400"></i>
                      {order.quantity || 1}u
                    </span>
                  </div>
                  {order.matrixStatus && (
                    <div className="mt-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide ${order.matrixStatus === 'Aprobado'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                        }`}>
                        {order.matrixStatus}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Columna 2: Sugerencias IA */}
        <div className="bg-pink-50 rounded-xl border border-pink-200 flex flex-col overflow-hidden h-full relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-400 to-purple-500"></div>
          <div className="p-4 border-b border-pink-200 font-bold text-pink-800 text-sm flex justify-between items-center bg-pink-50/50">
            <span>Sugerencias IA</span>
            <i className="fa-solid fa-brain text-pink-500"></i>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {isLoading ? (
              <div className="text-center py-8">
                <i className="fa-solid fa-spinner fa-spin text-pink-500 text-3xl mb-3"></i>
                <p className="text-sm text-pink-700 font-bold animate-pulse">Analizando órdenes con IA...</p>
                <p className="text-xs text-pink-500 mt-1">Calculando asignaciones óptimas</p>
              </div>
            ) : suggestions.length === 0 ? (
              <div className="text-center py-8 text-pink-400/60">
                <i className="fa-solid fa-robot text-4xl mb-3 opacity-50"></i>
                <p className="text-sm font-medium">Ejecuta Auto-Asignar para ver sugerencias</p>
              </div>
            ) : (
              suggestions.map((suggestion) => (
                <div key={suggestion.orderId} className="bg-white border border-pink-200 rounded-xl p-4 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-black text-pink-600 text-sm">Orden No.: {suggestion.orderId}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${getPriorityColor(suggestion.priority)}`}>
                      {suggestion.priority}
                    </span>
                  </div>

                  <p className="font-bold text-zinc-700 text-xs mb-1">{suggestion.client}</p>
                  <p className="text-xs text-zinc-500 mb-3 line-clamp-1">{suggestion.description}</p>

                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 mb-3 bg-zinc-50 p-2 rounded-lg border border-zinc-100">
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-robot text-pink-500"></i>
                      <span className="font-bold">{suggestion.recommendedMachine}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-clock text-blue-500"></i>
                      <span>{suggestion.estimatedTime}</span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <i className="fa-solid fa-thread text-emerald-500"></i>
                      <span>{suggestion.stitches.toLocaleString()} pts</span>
                    </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 flex items-start gap-2 mb-3">
                    <i className="fa-solid fa-lightbulb text-amber-500 text-xs mt-0.5"></i>
                    <span className="text-xs text-amber-700 font-medium leading-tight">{suggestion.reason}</span>
                  </div>

                  <button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2"
                    onClick={() => applySuggestion(suggestion)}
                  >
                    <i className="fa-solid fa-check"></i>
                    Aplicar Sugerencia
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Columna 3: Carga de Máquinas */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 flex flex-col overflow-hidden h-full">
          <div className="p-4 bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-700 text-sm flex items-center gap-2">
            <i className="fa-solid fa-industry text-zinc-400"></i>
            Estado de Planta
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {machineLoad.map(machine => (
              <div key={machine.id} className="bg-white border border-zinc-200 rounded-xl p-4 hover:border-blue-200 transition-colors">
                <div className="flex justify-between items-center mb-3">
                  <span className="font-bold text-zinc-700 text-sm">{machine.name}</span>
                  <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-bold border border-blue-100">
                    {machine.heads} cabezales
                  </span>
                </div>

                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 bg-zinc-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${getLoadColor(machine.currentLoad)}`}
                      style={{ width: `${machine.currentLoad}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-bold text-zinc-600 w-8 text-right">
                    {machine.currentLoad}%
                  </span>
                </div>

                <div className="flex justify-between text-xs text-zinc-500 mb-2 font-medium">
                  <div className="flex items-center gap-1.5">
                    <i className="fa-solid fa-gauge-high text-zinc-400"></i>
                    <span>{machine.speed} rpm</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <i className="fa-solid fa-flag-checkered text-zinc-400"></i>
                    <span>{machine.estimatedCompletion}</span>
                  </div>
                </div>

                <div className="text-[10px] text-center text-zinc-400 border-t border-zinc-50 pt-2 mt-2">
                  Capacidad: <span className="font-mono text-zinc-500">{machine.capacity.toLocaleString()}</span> pts/día
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BordadoScheduler;
