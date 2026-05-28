import React, { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption, Transition } from '@headlessui/react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useAuth } from "../../context/AuthContext";
import { fileControlService, ordersService } from "../../services/api";
import KPICard from '../common/KPICard';
import OrderCard from '../production/components/OrderCard';
import RollDetailsModal from '../modals/RollDetailsModal';
import OrderDetailModal from '../production/components/OrderDetailModal';
import FileControlCard from '../production/components/FileControlCard';

import { socket } from '../../services/socketService';
import Toast from '../ui/Toast';

const SmallRollMetrics = ({ roll, metrics }) => {
  if (!roll) return null;
  const execution = metrics?.stats?.execution || 0;
  const currentMeters = metrics?.stats?.metrosProducidos ?? 0;
  const totalMeters = metrics?.stats?.metrosTotales ?? roll.metros ?? 0;
  const metersText = metrics?.stats ? `${currentMeters}/${totalMeters}m` : `${totalMeters}m`;

  return (
    <div className="bg-white px-4 py-3 flex flex-col w-full">
      <div className="flex items-center gap-6 justify-between">
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] font-black text-slate-400 uppercase leading-none">LOTE</div>
            <div className="font-black text-slate-700 text-lg">#{roll.id}</div>
          </div>
          <div className="h-8 w-px bg-slate-100"></div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-slate-100" />
              <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" fill="transparent"
                strokeDasharray={100}
                strokeDashoffset={100 - (100 * execution / 100)}
                className="text-cyan-500 transition-all duration-1000 ease-out" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-slate-700">{execution}%</span>
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider leading-none mb-1">PROGRESO</div>
            <div className="font-bold text-xs text-slate-700">{metersText}</div>
          </div>
        </div>
      </div>
      {/* WARNING IF NOT FINALIZED */}
      {roll.status && roll.status !== 'Finalizado' && (
        <div className="mt-3 bg-amber-50 text-amber-600 text-[10px] px-2 py-1.5 rounded-lg border border-amber-100 font-bold text-center flex items-center justify-center gap-2">
          <i className="fa-solid fa-triangle-exclamation animate-pulse"></i>
          LOTE EN {String(roll.status).toUpperCase()} (NO FINALIZADO)
        </div>
      )}
    </div>
  );
};


const FilePrintControl = ({ areaCode }) => {
  const { user } = useAuth(); // for fallback logic if needed
  // --- STATES ---
  const [activeRoll, setActiveRoll] = useState(null);
  const [rollos, setRollos] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [files, setFiles] = useState([]);
  const [pedidoMetrics, setPedidoMetrics] = useState(null); // For Stepper and Full details

  const autoAdvanceTimerRef = useRef(null); // Timer Ref for auto-advance

  // Sort & Auto-Advance
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [autoAdvance, setAutoAdvance] = useState(true);

  // Loading & Metrics
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [activeRollMetrics, setActiveRollMetrics] = useState(null);

  // Search
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  // Modals States
  const [controlAction, setControlAction] = useState(null);
  const [selectedFileForAction, setSelectedFileForAction] = useState(null);
  const [completedOrderData, setCompletedOrderData] = useState(null);
  const [fallaTypes, setFallaTypes] = useState([]);
  const [finalizandoOrden, setFinalizandoOrden] = useState(false);

  // Falla Form
  const [failureType, setFailureType] = useState('');
  const [metersToReprint, setMetersToReprint] = useState('');
  const [actionReason, setActionReason] = useState('');

  // --- DERIVED STATE ---
  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      const seqA = a.sequence || 999999;
      const seqB = b.sequence || 999999;
      if (sortOrder === 'asc') return seqA - seqB;
      return seqB - seqA;
    });
  }, [orders, sortOrder]);

  // --- EFFECTS ---

  // 0. Load Falla Types
  useEffect(() => {
    fileControlService.getFallaTypes().then(setFallaTypes).catch(console.error);
  }, []);

  // 1. Load active rolls
  useEffect(() => {
    const fetchRollos = async () => {
      try {
        const area = areaCode || 'DTF';
        const data = await fileControlService.getRollosActivos(area);
        setRollos(data || []);
      } catch (error) { console.error("Error rollos:", error); }
    };
    fetchRollos();
  }, [areaCode]);

  // 2. Load Orders when Roll changes
  useEffect(() => {
    const fetchOrders = async () => {
      setLoadingOrders(true);
      try {
        const rId = activeRoll?.id === 'todo' ? '' : (activeRoll?.id || '');
        const data = await fileControlService.getOrdenes(searchTerm, rId, areaCode || 'DTF');

        // Normalize
        const normalized = (data || []).map(o => ({
          id: o.OrdenID,
          code: o.CodigoOrden,
          client: o.Cliente,
          material: o.Material,
          status: o.Estado,
          sequence: o.Secuencia || 0,
          failures: o.CantidadFallas || 0,
          hasLabels: o.CantidadEtiquetas || 0,

          nextService: o.ProximoServicio,
          meters: parseFloat(o.Magnitud) || 0
        }));
        setOrders(normalized);
      } catch (e) { console.error(e); }
      finally { setLoadingOrders(false); }
    };

    const fetchMetrics = async () => {
      if (activeRoll?.id) {
        try {
          const data = await fileControlService.getRolloMetrics(activeRoll.id);
          setActiveRollMetrics(data);
        } catch (e) { console.error(e); }
      } else setActiveRollMetrics(null);
    };

    fetchOrders();
    fetchMetrics();
    // Reset selection when roll changes
    if (activeRoll) setSelectedOrder(null);
  }, [activeRoll, searchTerm, areaCode]);


  // 3. Load Files and Details when Order Selected
  useEffect(() => {
    const fetchDetails = async () => {
      if (!selectedOrder) {
        setFiles([]);
        setPedidoMetrics(null);
        return;
      }
      setLoadingFiles(true);
      try {
        const data = await fileControlService.getArchivosPorOrden(selectedOrder.id);
        setFiles(data || []);

        // Also fetch full details for Stepper (using same service as visualizer)
        const fullDetails = await fileControlService.getPedidoMetrics(selectedOrder.code || selectedOrder.id);
        setPedidoMetrics(fullDetails);

      } catch (e) { console.error(e); }
      finally { setLoadingFiles(false); }
    };
    fetchDetails();
  }, [selectedOrder]);

  // 4. Socket Listeners & Auto-Advance Logic
  useEffect(() => {
    const handleUpdate = (data) => {
      if (activeRoll) {
        // Refresh orders list
        fileControlService.getOrdenes(searchTerm, activeRoll.id, areaCode || 'DTF').then(newOrders => {
          const normalized = (newOrders || []).map(o => ({
            id: o.OrdenID,
            code: o.CodigoOrden,
            client: o.Cliente,
            material: o.Material,
            status: o.Estado,
            sequence: o.Secuencia || 0,
            failures: o.CantidadFallas || 0,
            hasLabels: o.CantidadEtiquetas || 0,

            nextService: o.ProximoServicio,
            meters: parseFloat(o.Magnitud) || 0


          }));
          setOrders(normalized);

          if (selectedOrder) {
            const fresh = normalized.find(o => o.id === selectedOrder.id);
            if (fresh) {
              // Updarte current selection
              setSelectedOrder(prev => ({ ...prev, ...fresh }));

              // AUTO ADVANCE LOGIC
              // Check if status changed to a completed state
              const isCompleted = ['PRONTO', 'FINALIZADO', 'ENTREGADO'].includes(fresh.status?.toUpperCase());
              const wasCompleted = ['PRONTO', 'FINALIZADO', 'ENTREGADO'].includes(selectedOrder.status?.toUpperCase());

              if (isCompleted && !wasCompleted) {
                // Show Completion Modal
                setCompletedOrderData({
                  destino: fresh.nextService || 'LOGÍSTICA',
                  proximoServicio: fresh.nextService
                });

                // If Auto-Advance enabled, switch after delay
                if (autoAdvance) {
                  if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);

                  autoAdvanceTimerRef.current = setTimeout(() => {
                    setOrders(prevOrders => {
                      // Re-sort current orders to find next index
                      const currentSorted = [...prevOrders].sort((a, b) => {
                        const seqA = a.sequence || 999999;
                        const seqB = b.sequence || 999999;
                        return sortOrder === 'asc' ? seqA - seqB : seqB - seqA;
                      });

                      const idx = currentSorted.findIndex(o => o.id === fresh.id);
                      if (idx !== -1 && idx < currentSorted.length - 1) {
                        // Find next VALID order (not blocked)
                        let nextOrder = null;
                        for (let i = idx + 1; i < currentSorted.length; i++) {
                          if ((currentSorted[i].meters || 0) > 0) {
                            nextOrder = currentSorted[i];
                            break;
                          }
                        }

                        if (nextOrder) {
                          setSelectedOrder(nextOrder);
                          setCompletedOrderData(null); // Auto-close modal
                          setToast({ visible: true, message: `Auto-avanzando a orden #${nextOrder.code || nextOrder.id}...`, type: 'info' });
                        }
                      }
                      return prevOrders;
                    });
                  }, 2000);
                }
              }
            }
          }
        });
      }
      if (data.orderId && selectedOrder && data.orderId == selectedOrder.id) {
        refreshCurrentOrder();
      }
    };

    socket.on('server:order_updated', handleUpdate);
    return () => {
      socket.off('server:order_updated', handleUpdate);
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, [activeRoll, selectedOrder, searchTerm, areaCode, autoAdvance, sortOrder]);


  // --- HELPERS ---
  const orderMetrics = React.useMemo(() => {
    const total = files.length;
    const done = files.filter(f => ['OK', 'FINALIZADO'].includes(f.EstadoArchivo)).length;
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [files]);

  const refreshCurrentOrder = () => {
    if (selectedOrder) {
      fileControlService.getArchivosPorOrden(selectedOrder.id).then(setFiles);
      fileControlService.getPedidoMetrics(selectedOrder.code || selectedOrder.id).then(setPedidoMetrics);
    }
  };

  const handleSelectOrder = (order) => {
    if (!order) {
      setSelectedOrder(null);
      return;
    }
    if ((order.meters || 0) <= 0) {
      setToast({ visible: true, message: `La orden ${order.code || order.id} tiene 0 metros. No se puede procesar.`, type: 'error' });
      return;
    }
    setSelectedOrder(order);
  };

  // --- ACTIONS HANDLERS ---
  const handleFinalizarOrden = async () => {
    if (!selectedOrder || finalizandoOrden) return;
    setFinalizandoOrden(true);
    try {
      const res = await fileControlService.completarOrden(selectedOrder.id);
      if (res.success) {
        // Quitar la orden de la lista inmediatamente sin esperar al socket
        setOrders(prev => prev.filter(o => o.id !== selectedOrder.id));
        setSelectedOrder(null);
        setFiles([]);
        setCompletedOrderData({
          destino: res.estadoLogistica || 'LOGÍSTICA',
          proximoServicio: selectedOrder.nextService
        });
      } else {
        setToast({ visible: true, message: res.error || 'Error al finalizar la orden', type: 'error' });
      }
    } catch (e) {
      setToast({ visible: true, message: 'Error de conexión al finalizar la orden', type: 'error' });
    } finally {
      setFinalizandoOrden(false);
    }
  };

  const handlePrintLabels = async () => {
    if (!selectedOrder) return;
    setToast({ visible: true, message: 'Generando etiquetas...', type: 'info' });
    try {
      const res = await fileControlService.regenerateLabels(selectedOrder.id);
      if (res.success) {
        setToast({ visible: true, message: `✅ Etiquetas generadas: ${res.totalBultos || 'OK'}`, type: 'success' });
      } else {
        setToast({ visible: true, message: `❌ Error: ${res.error || 'No se pudieron generar las etiquetas'}`, type: 'error' });
      }
    } catch (e) {
      console.error(e);
      setToast({ visible: true, message: `❌ Error de conexión: ${e.message}`, type: 'error' });
    }
  };

  const openActionModal = (file, action) => {
    setSelectedFileForAction(file);
    setControlAction(action);
    setActionReason('');
    setFailureType('');
    setMetersToReprint('');
  };

  const closeModal = () => {
    setControlAction(null);
    setSelectedFileForAction(null);
  };

  const handleSubmitModal = async () => {
    if (!selectedFileForAction) return;

    const payload = {
      archivoId: selectedFileForAction.ArchivoID || selectedFileForAction.id,
      estado: controlAction, // Correct field
      motivo: actionReason,
      tipoFalla: failureType,
      metrosReponer: metersToReprint, // Correct field
      usuario: user?.usuario || user?.username || 'Sistema', // String username
      isService: selectedFileForAction.isService
    };

    try {
      const res = await fileControlService.controlarArchivo(payload);
      if (res.success) {
        setToast({ visible: true, message: 'Acción registrada correctamente', type: 'success' });
        refreshCurrentOrder();
        closeModal();
      } else {
        alert("Error al registrar acción");
      }
    } catch (e) {
      console.error(e);
      alert("Error de conexión");
    }
  };


  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">

      {/* --- SIDEBAR (ORDER LIST) --- */}
      <aside className="w-[360px] h-full bg-white border-r border-slate-200 flex flex-col z-10 shrink-0 shadow-xl shadow-slate-200/50">

        {/* Header Sidebar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center text-white shadow-lg shadow-cyan-200">
              <i className="fa-solid fa-boxes-packing"></i>
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-800 uppercase leading-none">Control</h2>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Empaquetado {areaCode}</div>
            </div>
          </div>

          {/* Lote Selector */}
          <div className="relative mb-2 z-[100]">
            <Listbox 
              value={activeRoll} 
              onChange={(val) => {
                setActiveRoll(val);
              }}
            >
              <div className="relative">
                <ListboxButton className="w-full pl-3 pr-8 py-2 bg-white text-slate-700 border border-slate-200 rounded-xl font-bold text-xs outline-none text-left flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors shadow-sm">
                  <span className="truncate">{activeRoll ? `Lote #${activeRoll.id} - ${activeRoll.nombre}` : 'Seleccione Lote...'}</span>
                  <ChevronsUpDown size={14} className="text-slate-400 shrink-0 absolute right-3" />
                </ListboxButton>
                <Transition
                  as={Fragment}
                  leave="transition ease-in duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <ListboxOptions className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden focus:outline-none">
                    <div className="max-h-52 overflow-y-auto p-1 custom-scrollbar">
                      <ListboxOption
                        value={null}
                        className={({ active }) => `flex items-center px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${active ? 'bg-slate-100 text-slate-700' : 'text-slate-500'}`}
                      >
                        <span className="truncate italic">Seleccione Lote...</span>
                      </ListboxOption>
                      {rollos.map((r) => (
                        <ListboxOption
                          key={r.id}
                          value={r}
                          className={({ active, selected }) =>
                            `flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-xs transition-colors ${
                              selected ? 'bg-cyan-50 text-cyan-600 font-bold' : active ? 'bg-slate-50 text-slate-800 font-medium' : 'text-slate-600 font-medium'
                            }`
                          }
                        >
                          {({ selected }) => (
                            <>
                              <div className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-cyan-500 border-cyan-500' : 'border-slate-300'}`}>
                                {selected && <Check size={10} className="text-white" strokeWidth={3} />}
                              </div>
                              <span className="truncate">Lote #{r.id} - {r.nombre}</span>
                            </>
                          )}
                        </ListboxOption>
                      ))}
                    </div>
                  </ListboxOptions>
                </Transition>
              </div>
            </Listbox>
          </div>

          {/* Search and Sort */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                type="text"
                placeholder="Buscar orden..."
                className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-cyan-300 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="w-8 h-[34px] flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 hover:text-cyan-600 transition-colors"
              title={`Ordenar por Secuencia (${sortOrder === 'asc' ? 'Ascendente' : 'Descendente'})`}
            >
              <i className={`fa-solid fa-sort-${sortOrder === 'asc' ? 'numeric-down' : 'numeric-up-alt'}`}></i>
            </button>
          </div>

          {/* Auto Advance Toggle (Moved to Header) */}
          <div className="mt-3 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2">
              <i className={`fa-solid fa-forward text-xs ${autoAdvance ? 'text-brand-cyan' : 'text-slate-400'}`}></i>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Auto-Siguiente</span>
            </div>

            <div
              onClick={() => setAutoAdvance(!autoAdvance)}
              className={`w-8 h-4 flex items-center rounded-full p-0.5 cursor-pointer transition-colors duration-200 ${autoAdvance ? 'bg-brand-cyan' : 'bg-slate-300'}`}
              title="Avanzar automáticamente al siguiente pedido cuando se completa el actual"
            >
              <div className={`bg-white w-3 h-3 rounded-full shadow-sm transform transition-transform duration-200 ${autoAdvance ? 'translate-x-4' : 'translate-x-0'}`}></div>
            </div>
          </div>
        </div>

        {/* Metrics */}
        {activeRoll && <div className="border-b border-slate-200"><SmallRollMetrics roll={activeRoll} metrics={activeRollMetrics} /></div>}

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col bg-slate-50">
          {loadingOrders ? (
            <div className="py-8 text-center text-cyan-500"><i className="fa-solid fa-circle-notch fa-spin"></i></div>
          ) : sortedOrders.length === 0 ? (
            <div className="py-8 text-center text-slate-400 italic text-xs">Sin órdenes</div>
          ) : (
            sortedOrders.map(o => {
              const isBlocked = (o.meters || 0) <= 0;
              return (
                <div key={o.id} className={`relative transition-opacity ${isBlocked ? 'opacity-60 grayscale' : ''}`}>
                  {isBlocked && (
                    <div className="absolute top-2 right-2 z-20 text-red-500 bg-white/80 rounded-full px-2 py-0.5 text-[10px] font-bold border border-red-200 shadow-sm flex items-center gap-1">
                      <i className="fa-solid fa-ban"></i> 0m
                    </div>
                  )}
                  <OrderCard
                    order={o}
                    isSelected={selectedOrder?.id === o.id}
                    onToggleSelect={() => handleSelectOrder(o)}
                    onViewDetails={() => handleSelectOrder(o)}
                    minimal={true}
                  />
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* --- MAIN CONTENT (SELECTED ORDER DETAILS) --- */}
      <main className="flex-1 overflow-y-auto bg-white flex flex-col">
        {selectedOrder ? (
          <div className="w-full pb-20">
            {/* ORDER HEADER */}
            <div className="bg-white border-b border-slate-200 px-4 py-2.5">
              <div className="flex justify-between items-center min-h-[40px]">
                
                {/* Left Side: Order Info & Stepper */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest border border-slate-200">
                      ORD
                    </span>
                    <h1 className="text-[22px] font-black text-slate-800 tracking-tight leading-none">
                      {selectedOrder.code || selectedOrder.id}
                    </h1>
                    <div className="text-sm font-bold text-slate-400 truncate max-w-[200px]">
                      {selectedOrder.client}
                    </div>
                    <span className="px-2 py-0.5 rounded bg-brand-cyan/10 text-brand-cyan text-[10px] font-black uppercase tracking-widest border border-brand-cyan/20">
                      SEC: {selectedOrder.sequence || '-'}
                    </span>
                    {selectedOrder.status === 'PRONTO' && <span className="px-2 py-0.5 rounded bg-brand-cyan text-white text-[10px] font-black uppercase tracking-widest">COMPLETA</span>}
                  </div>

                  {/* STEPPER (Ruta) INLINE */}
                  <div className="flex items-center gap-3 ml-2 pl-4 border-l border-slate-200 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] max-w-[500px]">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0 mr-3">Ruta:</div>
                    {pedidoMetrics && pedidoMetrics.ruta ? pedidoMetrics.ruta.map((r, idx) => {
                      const isDone = r.estado === 'FINALIZADO' || r.estado === 'PRONTO' || r.estado === 'COMPLETADO';
                      const isActive = r.estado === 'EN PROCESO';
                      let bgClass = 'bg-slate-100 text-slate-400 border-slate-200';
                      if (isDone) bgClass = 'bg-brand-cyan text-white border-brand-cyan';
                      else if (isActive) bgClass = 'bg-amber-400 text-white border-amber-400 animate-pulse';

                      return (
                        <React.Fragment key={idx}>
                          <div className="flex flex-col items-center gap-1 group relative shrink-0">
                            <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-black transition-all ${bgClass} cursor-help`}>
                              {r.area.substring(0, 2)}
                            </div>
                            <div className="absolute top-full mt-1 bg-slate-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                              {r.area} - {r.estado}
                            </div>
                          </div>
                          {idx < pedidoMetrics.ruta.length - 1 && (
                            <div className={`h-0.5 w-8 rounded-full ${isDone ? 'bg-brand-cyan/50' : 'bg-slate-200'}`}></div>
                          )}
                        </React.Fragment>
                      )
                    }) : <span className="text-[10px] text-slate-300 italic">Cargando...</span>}
                  </div>
                </div>

                {/* Right Side: Etiquetas & Progreso */}
                <div className="flex items-center gap-6">
                  {/* Label Button (Etiquetas) */}
                  <div
                    className={`flex items-center gap-3 group ${selectedOrder.hasLabels > 0 ? 'opacity-100 cursor-pointer hover:bg-slate-50 rounded-lg px-2 py-1.5 transition-all border border-transparent hover:border-slate-100' : 'opacity-40 pointer-events-none'}`}
                    onClick={selectedOrder.hasLabels > 0 ? handlePrintLabels : undefined}
                    title="Reimprimir etiquetas"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${selectedOrder.hasLabels > 0 ? 'bg-brand-cyan/10 text-brand-cyan group-hover:bg-brand-cyan/30' : 'bg-slate-100 text-slate-300'}`}>
                      <i className="fa-solid fa-tags text-sm"></i>
                    </div>
                    <div className="text-right hidden sm:block">
                      <div className="text-[10px] font-bold text-slate-400 uppercase leading-none mb-1">Etiquetas</div>
                      <div className={`text-xs font-bold leading-none ${selectedOrder.hasLabels > 0 ? 'text-brand-cyan' : 'text-slate-600'}`}>
                        {selectedOrder.hasLabels > 0 ? 'OK' : 'PEND'}
                      </div>
                    </div>
                  </div>

                  {/* Big Counter */}
                  <div className="text-right pl-5 border-l border-slate-100 flex flex-col justify-center">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">PROGRESO</div>
                    <div className="text-3xl font-black text-slate-800 leading-none">
                      {orderMetrics.done}<span className="text-xl text-slate-300">/{orderMetrics.total}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* FILES LIST (CONTAINER) */}
            <div className="w-full bg-slate-50">
              {loadingFiles ? (
                <div className="py-20 text-center text-slate-400">
                  <i className="fa-solid fa-circle-notch fa-spin text-3xl mb-2"></i>
                  <div>Cargando archivos...</div>
                </div>
              ) : files.length === 0 ? (
                <div className="py-20 text-center text-slate-400 italic">
                  Sin archivos de producción
                </div>
              ) : (
                <div className="flex flex-col overflow-hidden border-b border-slate-200 divide-y divide-slate-200">
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
                    <div className="text-xs font-black text-slate-500 uppercase tracking-widest">
                      {files.length} ARCHIVOS EN ORDEN
                    </div>
                  </div>

                  {files.map(file => (
                    <FileControlCard
                      key={file.isService ? `service-${file.ArchivoID}` : `file-${file.ArchivoID}`}
                      file={file}
                      refreshOrder={refreshCurrentOrder}
                      onAction={openActionModal}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* BOTTOM COMPLETION BUTTON - aparece cuando todos los archivos están listos */}
            {orderMetrics.done === orderMetrics.total && orderMetrics.total > 0 && selectedOrder.status !== 'PRONTO' && (
              <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom duration-500">
                <button
                  onClick={handleFinalizarOrden}
                  disabled={finalizandoOrden}
                  className="bg-brand-cyan text-white px-6 py-4 rounded-2xl shadow-2xl shadow-brand-cyan/40 flex items-center gap-4 hover:bg-cyan-600 active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {finalizandoOrden ? (
                    <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                  ) : (
                    <i className="fa-solid fa-check-circle text-2xl"></i>
                  )}
                  <div>
                    <div className="font-black text-lg">{finalizandoOrden ? 'FINALIZANDO...' : 'FINALIZAR ORDEN'}</div>
                    <div className="text-xs opacity-90">Todos los archivos listos · Pulsar para cerrar</div>
                  </div>
                </button>
              </div>
            )}

          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-300">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-pulse">
              <i className="fa-solid fa-arrow-left text-4xl opacity-50"></i>
            </div>
            <div className="text-xl font-black text-slate-400">SELECCIONE UNA ORDEN</div>
            <div className="text-sm">para ver sus archivos y controlar copias</div>
          </div>
        )}
      </main>

      {/* --- MODALS --- */}

      {/* 1. Action Modal (Falla/Cancel) */}
      {controlAction && (controlAction === 'FALLA' || controlAction === 'CANCELADO') && (
        <div className="fixed inset-0 z-[1400] bg-black/40  flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className={`px-6 py-4 border-b flex justify-between items-center ${controlAction === 'FALLA' ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-200'}`}>
              <h3 className={`font-black text-lg ${controlAction === 'FALLA' ? 'text-red-600' : 'text-slate-600'}`}>
                {controlAction === 'FALLA' ? 'REPORTAR FALLA DE IMPRESIÓN' : 'CANCELAR ARCHIVO'}
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div className="p-6 space-y-4">
              {controlAction === 'FALLA' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Tipo de Falla</label>
                  <select
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-red-400 font-medium text-sm text-slate-700"
                    value={failureType}
                    onChange={(e) => setFailureType(e.target.value)}
                  >
                    <option value="">Seleccione...</option>
                    {fallaTypes.map(f => (
                      <option key={f.FallaID} value={f.FallaID} title={f.DescripcionDefault}>{f.Titulo}</option>
                    ))}
                  </select>
                </div>
              )}

              {controlAction === 'FALLA' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                    Cantidad a Reponer (Metros) <span className="text-slate-400 font-normal normal-case">(Opcional)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-red-400 font-medium text-sm text-slate-700"
                    placeholder="Ej: 2.5"
                    value={metersToReprint}
                    onChange={(e) => setMetersToReprint(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                  {controlAction === 'FALLA' ? 'Observaciones / Detalle' : 'Motivo de Cancelación'}
                </label>
                <textarea
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-400 min-h-[100px] text-sm font-medium text-slate-700 resize-none"
                  placeholder={controlAction === 'FALLA' ? "Describa el problema..." : "Ingrese el motivo..."}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                ></textarea>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={closeModal} className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancelar</button>
                <button
                  onClick={handleSubmitModal}
                  className={`flex-1 py-3 rounded-xl font-bold text-white shadow-lg transition-all transform active:scale-95 ${controlAction === 'FALLA' ? 'bg-red-500 shadow-red-200 hover:bg-red-600' : 'bg-slate-700 shadow-slate-300 hover:bg-slate-800'}`}
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div >
      )}

      {/* 2. Completed Order Modal (Pronto Sector) */}
      {completedOrderData && (
        <div className="fixed inset-0 z-[1600] bg-black/70 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border-4 border-brand-cyan">

            <div className="bg-brand-cyan p-8 flex flex-col items-center justify-center text-white relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20"></div>
              <i className="fa-solid fa-clipboard-check text-7xl mb-4 relative z-10 animate-[bounce_1s_infinite]"></i>
              <h2 className="text-3xl font-black uppercase tracking-widest relative z-10">¡ORDEN PRONTA!</h2>
            </div>

            <div className="p-8 flex flex-col items-center text-center">

              <div className="w-full bg-slate-50 rounded-2xl border-2 border-slate-100 p-4 mb-4">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">DESTINO FÍSICO (Canasto)</div>
                <div className="text-xl font-black text-slate-700 leading-tight">
                  {completedOrderData.destino || 'LOGÍSTICA'}
                </div>
              </div>

              <div className="w-full bg-blue-50 rounded-2xl border-2 border-blue-100 p-4 mb-6">
                <div className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">PRÓXIMO SERVICIO</div>
                <div className="text-2xl font-black text-blue-700 leading-tight">
                  {completedOrderData.proximoServicio || '---'}
                </div>
              </div>

              <div className="space-y-3 w-full">
                <button onClick={() => { setCompletedOrderData(null); handlePrintLabels(); }} className="w-full py-3 rounded-xl bg-brand-cyan text-white font-black text-lg shadow-lg shadow-brand-cyan/30 hover:bg-brand-cyan hover:scale-[1.02] transition-all active:scale-95">
                  <i className="fa-solid fa-print mr-2"></i> IMPRIMIR ETIQUETAS
                </button>
                <div className="flex gap-2">
                  <button onClick={() => setCompletedOrderData(null)} className="flex-1 py-3 rounded-xl bg-white border-2 border-slate-200 text-slate-500 font-bold text-sm hover:bg-slate-50">
                    Cerrar
                  </button>
                  {autoAdvance && <div className="flex items-center justify-center px-4 bg-slate-100 rounded-xl text-slate-400 text-xs font-bold">
                    <i className="fa-solid fa-forward mr-2 animate-pulse"></i> Auto
                  </div>}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Toast Wrapper */}
      {toast.visible && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, visible: false })} />}
    </div>
  );
};

export default FilePrintControl;
