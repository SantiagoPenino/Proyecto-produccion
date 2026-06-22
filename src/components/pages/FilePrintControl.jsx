import React, { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption, Transition } from '@headlessui/react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useAuth } from "../../context/AuthContext";
import { fileControlService, ordersService, rollsService } from "../../services/api";
import KPICard from '../common/KPICard';
import OrderCard from '../production/components/OrderCard';
import RollDetailsModal from '../modals/RollDetailsModal';
import OrderDetailModal from '../production/components/OrderDetailModal';
import FileControlCard from '../production/components/FileControlCard';

import { socket } from '../../services/socketService';
import Toast from '../ui/Toast';
import { printLabelsHelper } from '../../utils/printHelper';

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
  const [activeRoll, setActiveRoll] = useState(() => {
    try {
      const saved = localStorage.getItem(`activeRoll_${areaCode || 'DTF'}`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
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
  const [pendingSelectCode, setPendingSelectCode] = useState(null);

  // Falla Form
  const [failureType, setFailureType] = useState('');
  const [metersToReprint, setMetersToReprint] = useState('');
  const [reponerCompleto, setReponerCompleto] = useState(false);
  const [actionReason, setActionReason] = useState('');

  // Persist selected activeRoll across tab changes
  useEffect(() => {
    if (activeRoll) {
      localStorage.setItem(`activeRoll_${areaCode || 'DTF'}`, JSON.stringify(activeRoll));
    } else {
      localStorage.removeItem(`activeRoll_${areaCode || 'DTF'}`);
    }
  }, [activeRoll, areaCode]);

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
    const area = areaCode || 'DTF';
    fileControlService.getFallaTypes(area).then(setFallaTypes).catch(console.error);
  }, [areaCode]);

  // 1. Load active rolls
  const fetchRollos = React.useCallback(async () => {
    try {
      const area = areaCode || 'DTF';
      const data = await fileControlService.getRollosActivos(area);
      setRollos(data || []);
    } catch (error) { console.error("Error rollos:", error); }
  }, [areaCode]);

  useEffect(() => {
    fetchRollos();
    socket.on('server:order_updated', fetchRollos);
    socket.on('server:ordersUpdated', fetchRollos);
    socket.on('lotes:updated', fetchRollos);
    return () => {
      socket.off('server:order_updated', fetchRollos);
      socket.off('server:ordersUpdated', fetchRollos);
      socket.off('lotes:updated', fetchRollos);
    };
  }, [fetchRollos]);

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
          statusArea: o.EstadoenArea,
          controlled: o.Controlada === 1,
          sequence: o.Secuencia || 0,
          failures: o.CantidadFallas || 0,
          hasLabels: o.CantidadEtiquetas || 0,
          rolloId: o.RolloID || null,
          nextService: o.ProximoServicio,
          meters: parseFloat(o.Magnitud) || 0
        }));
        setOrders(normalized);
        // Auto-select pending order after lote switch
        if (pendingSelectCode) {
          const toSelect = normalized.find(o => o.code === pendingSelectCode);
          if (toSelect) { setSelectedOrder(toSelect); setPendingSelectCode(null); }
        }
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
        const rId = activeRoll.id === 'todo' ? '' : activeRoll.id;
        // Refresh orders list
        fileControlService.getOrdenes(searchTerm, rId, areaCode || 'DTF').then(newOrders => {
          const normalized = (newOrders || []).map(o => ({
            id: o.OrdenID,
            code: o.CodigoOrden,
            client: o.Cliente,
            material: o.Material,
            status: o.Estado,
            statusArea: o.EstadoenArea,
            controlled: o.Controlada === 1,
            sequence: o.Secuencia || 0,
            failures: o.CantidadFallas || 0,
            hasLabels: o.CantidadEtiquetas || 0,
            rolloId: o.RolloID || null,
            nextService: o.ProximoServicio,
            meters: parseFloat(o.Magnitud) || 0
          }));
          setOrders(normalized);

          if (selectedOrder) {
            const fresh = normalized.find(o => o.id === selectedOrder.id);
            if (fresh) {
              // Updarte current selection
              setSelectedOrder(prev => {
                if (!prev) return null; // Prevent resurrecting a cleared order
                if (prev.id !== fresh.id) return prev;
                return { ...prev, ...fresh };
              });

              // AUTO ADVANCE LOGIC
              // Check if status changed to a completed state
              const isCompleted = ['PRONTO', 'FINALIZADO', 'ENTREGADO'].includes(fresh.status?.toUpperCase()) || (fresh.EstadoenArea || fresh.areaStatus || '').toUpperCase() === 'PRONTO';
              const wasCompleted = ['PRONTO', 'FINALIZADO', 'ENTREGADO'].includes(selectedOrder.status?.toUpperCase()) || (selectedOrder.EstadoenArea || selectedOrder.areaStatus || '').toUpperCase() === 'PRONTO';

              // Solo mostrar el modal si NO es una orden de reposición (-F)
              // Las -F se completan silenciosamente durante "CORREGIR FALLA" para navegar a la madre.
              const isReposition = /\-F\d+$/.test(fresh.code || '');

              if (isCompleted && !wasCompleted && !isReposition) {
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
    socket.on('server:ordersUpdated', handleUpdate);
    return () => {
      socket.off('server:order_updated', handleUpdate);
      socket.off('server:ordersUpdated', handleUpdate);
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, [activeRoll, selectedOrder, searchTerm, areaCode, autoAdvance, sortOrder]);


  // --- HELPERS ---
  const orderMetrics = React.useMemo(() => {
    const total = files.length;
    const done = files.filter(f => ['OK', 'FINALIZADO', 'CANCELADO'].includes(f.EstadoArchivo)).length;
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [files]);

  const refreshCurrentOrder = () => {
    if (selectedOrder) {
      fileControlService.getArchivosPorOrden(selectedOrder.id).then(setFiles);
      fileControlService.getPedidoMetrics(selectedOrder.code || selectedOrder.id).then(setPedidoMetrics);
    }
    // Refrescar métricas del lote para actualizar el progreso en la sidebar
    if (activeRoll?.id) {
      fileControlService.getRolloMetrics(activeRoll.id).then(setActiveRollMetrics).catch(console.error);
      // Refrescar lista de órdenes para actualizar el flag "Controlada" (check verde)
      const rId = activeRoll.id === 'todo' ? '' : activeRoll.id;
      fileControlService.getOrdenes('', rId, areaCode || 'DTF').then(data => {
        const normalized = (data || []).map(o => ({
          id: o.OrdenID,
          code: o.CodigoOrden,
          client: o.Cliente,
          material: o.Material,
          status: o.Estado,
          statusArea: o.EstadoenArea,
          controlled: o.Controlada === 1,
          sequence: o.Secuencia || 0,
          failures: o.CantidadFallas || 0,
          hasLabels: o.CantidadEtiquetas || 0,
          nextService: o.ProximoServicio,
          meters: parseFloat(o.Magnitud) || 0
        }));
        setOrders(normalized);
      }).catch(console.error);
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
  // --- FALLA ORDER DETECTION ---
  const isFallaOrder = /\-F\d+$/.test(selectedOrder?.code || '');
  const originalOrderCode = isFallaOrder ? selectedOrder.code.replace(/\-F\d+$/, '') : null;

  const handleCorregirFalla = async () => {
    if (!originalOrderCode) return;

    // Step 1: PRIMERO buscar el lote de la orden original ANTES de finalizar la -F,
    // porque al finalizar, la madre pasa de 'Retenido' a 'Pendiente' y puede cambiar de visibilidad.
    let targetRolloId = null;
    let targetRollo = null;

    try {
      // Strategy 1: use getRelatedOrders
      const related = await fileControlService.getRelatedOrders(selectedOrder.id);
      const original = (related || []).find(o =>
        (o.CodigoOrden || o.code) === originalOrderCode
      );
      targetRolloId = original?.RolloID || original?.rolloId || null;

      // Strategy 2: search active orders if related didn't give us a rollo
      if (!targetRolloId) {
        const activeOrders = await fileControlService.getOrdenes(originalOrderCode, '', areaCode || 'DTF');
        const found = activeOrders.find(o => o.CodigoOrden === originalOrderCode);
        targetRolloId = found?.RolloID || null;
      }

      if (targetRolloId) {
        targetRollo = rollos.find(r => r.id === targetRolloId);
      }
    } catch (e) {
      console.error("Error buscando orden original:", e);
    }

    // Step 2: Finalizar la orden -F
    try {
      setFinalizandoOrden(true);
      const res = await fileControlService.completarOrden(selectedOrder.id);
      if (!res.success) {
        setToast({ visible: true, message: res.error || 'Error al finalizar la reposición', type: 'error' });
        setFinalizandoOrden(false);
        return;
      }
    } catch (e) {
      console.error(e);
      setToast({ visible: true, message: 'Error al finalizar la reposición', type: 'error' });
      setFinalizandoOrden(false);
      return;
    } finally {
      setFinalizandoOrden(false);
    }

    // Step 3: Limpiar estado de la -F inmediatamente para que isFallaOrder se recalcule
    setSelectedOrder(null);
    setFiles([]);
    setPedidoMetrics(null);

    // Step 4: Navegar al lote de la orden original
    const targetRollId = targetRollo?.id || targetRolloId;
    const isSameBatch = activeRoll && targetRollId && activeRoll.id === targetRollId;

    if (isSameBatch || targetRollo) {
      // Re-fetch órdenes del lote (mismo o diferente) y seleccionar la original directamente.
      // No depender de pendingSelectCode + useEffect para evitar race conditions con el socket.
      const rollIdToFetch = targetRollId || activeRoll?.id;

      if (!isSameBatch && targetRollo) {
        setActiveRoll(targetRollo);
      }

      try {
        const data = await fileControlService.getOrdenes('', rollIdToFetch, areaCode || 'DTF');
        const normalized = (data || []).map(o => ({
          id: o.OrdenID, code: o.CodigoOrden, client: o.Cliente,
          material: o.Material, status: o.Estado, statusArea: o.EstadoenArea,
          controlled: o.Controlada === 1, sequence: o.Secuencia || 0,
          failures: o.CantidadFallas || 0, hasLabels: o.CantidadEtiquetas || 0,
          rolloId: o.RolloID || null, nextService: o.ProximoServicio,
          meters: parseFloat(o.Magnitud) || 0
        }));
        setOrders(normalized);

        // Seleccionar la orden original
        const toSelect = normalized.find(o => o.code === originalOrderCode);
        if (toSelect) {
          setSelectedOrder(toSelect);
          setToast({ visible: true, message: `Falla corregida. Orden ${originalOrderCode} lista para finalizar.`, type: 'success' });
        } else {
          setToast({ visible: true, message: `Orden ${originalOrderCode} no encontrada en el lote`, type: 'warning' });
        }

        // Refrescar métricas del lote
        fileControlService.getRolloMetrics(rollIdToFetch).then(setActiveRollMetrics).catch(console.error);
      } catch (e) {
        console.error("Error refrescando órdenes:", e);
      }
      return;
    }

    // Fallback: no rollo found — buscar por código
    setSearchTerm(originalOrderCode);
    setActiveRoll(null);
    setToast({ visible: true, message: `Buscando orden original ${originalOrderCode}...`, type: 'info' });
  };

  const handleFinalizarOrden = async () => {
    if (!selectedOrder || finalizandoOrden) return;
    setFinalizandoOrden(true);

    // Excluir órdenes ya en estado final de todos los cálculos
    // (Pronto/En Transito/Finalizado quedan en la lista visual pero no son "pendientes")
    const isFinalState = (o) => {
      const saUp = (o.statusArea || '').toUpperCase().trim();
      const sUp  = (o.status     || '').toUpperCase().trim();
      return saUp === 'PRONTO' || saUp === 'EN TRANSITO' || sUp === 'FINALIZADO';
    };

    const ordenesPendientes = orders.filter(o => !isFinalState(o));

    const loteCompleto = ordenesPendientes.length > 0
      && ordenesPendientes.every(o => o.controlled)
      && ordenesPendientes.every(o => (o.failures || 0) === 0);

    const ordersToComplete = loteCompleto ? ordenesPendientes : [selectedOrder];

    try {
      let lastRes = null;
      let someError = null;

      for (const order of ordersToComplete) {
        const res = await fileControlService.completarOrden(order.id);
        if (res.success) {
          lastRes = res;
        } else {
          someError = res.error || `Error al finalizar la orden ${order.code || order.id}`;
          setToast({ visible: true, message: someError, type: 'error' });
        }
      }

      if (lastRes && !someError) {
        // isLastInRoll: quedan pendientes que NO son las que acabamos de completar
        // y que tampoco estaban ya en estado final
        const completedIds = new Set(ordersToComplete.map(x => x.id));
        const aunPendientes = ordenesPendientes.filter(o => !completedIds.has(o.id));
        const isLastInRoll = aunPendientes.length === 0 && activeRoll && activeRoll.id && activeRoll.id !== 'todo';

        setCompletedOrderData({
          ordenId: selectedOrder.id,
          destino: lastRes.estadoLogistica || 'LOGÍSTICA',
          proximoServicio: selectedOrder.nextService,
          isLastInRoll
        });

        // NO eliminar la orden de la lista — refrescar para que muestre su nuevo estado (Pronto)
        const rId = activeRoll?.id === 'todo' ? '' : (activeRoll?.id || '');
        fileControlService.getOrdenes('', rId, areaCode || 'DTF').then(data => {
          const normalized = (data || []).map(o => ({
            id: o.OrdenID,
            code: o.CodigoOrden,
            client: o.Cliente,
            material: o.Material,
            status: o.Estado,
            statusArea: o.EstadoenArea,
            controlled: o.Controlada === 1,
            sequence: o.Secuencia || 0,
            failures: o.CantidadFallas || 0,
            hasLabels: o.CantidadEtiquetas || 0,
            rolloId: o.RolloID || null,
            nextService: o.ProximoServicio,
            meters: parseFloat(o.Magnitud) || 0
          }));
          setOrders(normalized);
        }).catch(console.error);

        setSelectedOrder(null);
        setFiles([]);
        fetchRollos();
      }
    } catch (e) {
      setToast({ visible: true, message: e?.response?.data?.error || e?.message || 'Error de conexión al finalizar', type: 'error' });
    } finally {
      setFinalizandoOrden(false);
    }
  };


  const handlePrintLabels = async (ordenIdToPrint) => {
    const id = ordenIdToPrint || selectedOrder?.id;
    if (!id) return;
    setToast({ visible: true, message: 'Obteniendo etiquetas...', type: 'info' });

    // GUARD: si la orden ya está en estado final, solo imprimir — nunca regenerar
    const saUp = (selectedOrder?.statusArea || '').toUpperCase().trim();
    const sUp  = (selectedOrder?.status     || '').toUpperCase().trim();
    const isAlreadyDone = saUp === 'PRONTO' || saUp === 'EN TRANSITO' || sUp === 'FINALIZADO';

    try {
      let data = await fileControlService.getEtiquetas(id);

      if (!data || !data.etiquetas || data.etiquetas.length === 0) {
        if (isAlreadyDone) {
          // Orden ya despachada: no regenerar, solo avisar
          setToast({ visible: true, message: 'La orden ya fue despachada. Las etiquetas originales pueden no estar disponibles.', type: 'warning' });
          return;
        }
        // Primera vez (orden no despachada) → generar
        setToast({ visible: true, message: 'Generando etiquetas por primera vez...', type: 'info' });
        const regenRes = await fileControlService.regenerateLabels(id);
        if (regenRes.success) {
           data = await fileControlService.getEtiquetas(id);
        } else {
           setToast({ visible: true, message: `Error al generar: ${regenRes.error}`, type: 'error' });
           return;
        }
      }

      if (data && data.etiquetas && data.etiquetas.length > 0) {
        printLabelsHelper(null, { id });
        setToast({ visible: true, message: `Etiquetas listas para imprimir`, type: 'success' });
      } else {
        // En caso de que el backend devuelva el array de etiquetas directamente
        if (Array.isArray(data) && data.length > 0) {
          printLabelsHelper(null, { id });
          setToast({ visible: true, message: `Etiquetas listas para imprimir`, type: 'success' });
        } else {
          setToast({ visible: true, message: `Error: No se encontraron etiquetas.`, type: 'error' });
        }
      }
    } catch (e) {
      console.error(e);
      setToast({ visible: true, message: `Error de conexión: ${e.message}`, type: 'error' });
    }
  };


  const openActionModal = (file, action) => {
    setSelectedFileForAction(file);
    setControlAction(action);
    setActionReason('');
    setFailureType('');
    setMetersToReprint('');
    setReponerCompleto(false);
  };

  const closeModal = () => {
    setControlAction(null);
    setSelectedFileForAction(null);
    setReponerCompleto(false);
  };

  const printFailureLabel = ({ order, file, tipoFalla, observacion }) => {
    const printWindow = window.open('', '_blank', 'width=600,height=800');
    if (!printWindow) return;
    const orderCode = order?.code || order?.CodigoOrden || '---';
    const client = order?.client || order?.Cliente || '---';
    const material = file?.Material || file?.material || order?.material || '';
    const ancho = parseFloat(file?.Ancho || 0).toFixed(2);
    const alto = parseFloat(file?.Alto || 0).toFixed(2);
    const fecha = new Date().toLocaleDateString('es-ES');

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Etiqueta de Falla</title>
  <style>
    @page { size: 10cm 15cm; margin: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #fff; color: #000; }
    .label-page {
      width: 10cm; box-sizing: border-box;
      padding: 12px; display: flex; flex-direction: column;
      margin: 0 auto; background: white; min-height: 15cm;
    }
    .header { border-bottom: 3px solid #000; padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header-left { flex: 1; min-width: 0; }
    .header-right { text-align: right; min-width: 100px; }
    .label-bold { font-weight: 900; font-size: 11px; text-transform: uppercase; color: #000; }
    .value-text { font-size: 14px; font-weight: 800; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #000; }
    .body-section { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 0; gap: 12px; }
    .falla-word {
      font-size: 88px; font-weight: 900; line-height: 1; letter-spacing: -2px;
      background: #000; color: #fff;
      width: 100%; text-align: center; padding: 8px 0;
    }
    .tipo-falla {
      font-size: 20px; font-weight: 900; text-transform: uppercase; text-align: center;
      border: 3px solid #000; padding: 6px 20px; width: 90%; box-sizing: border-box;
    }
    .obs-box {
      font-size: 13px; font-weight: 600; text-align: center; color: #000;
      width: 90%; line-height: 1.4; border-top: 1px solid #000; padding-top: 10px;
    }
    .footer { border-top: 3px solid #000; padding-top: 8px; margin-top: 8px; text-align: center; }
    .order-num { font-size: 38px; font-weight: 900; display: inline-block; white-space: nowrap; color: #000; }
    .dim-text { font-size: 12px; color: #000; margin-top: 2px; }
    @media screen {
      .label-page { border: 1px dashed #999; margin: 20px auto; width: 380px; }
      body { background: #e0e0e0; padding-bottom: 40px; }
    }
    @media print { .no-print { display: none !important; } body { background: #fff; } }
  </style>
</head>
<body>
  <div class="no-print" style="position:sticky;top:0;z-index:100;padding:12px;text-align:center;background:#222;color:white;">
    <button onclick="window.print()" style="padding:8px 24px;font-size:15px;cursor:pointer;background:#000;color:white;border:none;border-radius:6px;font-weight:bold;">🖨️ IMPRIMIR</button>
  </div>
  <div class="label-page">
    <div class="header">
      <div class="header-left">
        <div class="label-bold">Cliente</div>
        <div class="value-text">${client}</div>
        ${material ? `<div class="label-bold" style="margin-top:4px;">Material</div><div class="value-text" style="font-size:13px;">${material}</div>` : ''}
      </div>
      <div class="header-right">
        <div class="label-bold">Fecha</div>
        <div class="value-text" style="font-size:13px;">${fecha}</div>
        <div class="label-bold" style="margin-top:6px;">Medida</div>
        <div class="value-text" style="font-size:13px;">${ancho} x ${alto} m</div>
      </div>
    </div>

    <div class="body-section">
      <div class="falla-word">FALLA</div>
      ${tipoFalla ? `<div class="tipo-falla">${tipoFalla}</div>` : ''}
      ${observacion ? `<div class="obs-box">${observacion}</div>` : ''}
    </div>

    <div class="footer">
      <div class="order-num">${orderCode}</div>
      <div class="dim-text">${material}</div>
    </div>
  </div>
  <script>window.addEventListener('load', function() {
    var el = document.querySelector('.order-num');
    if (!el) return;
    var maxW = el.parentElement.offsetWidth * 0.8;
    var fs = 10;
    el.style.fontSize = fs + 'px';
    while (el.offsetWidth < maxW && fs < 200) { fs++; el.style.fontSize = fs + 'px'; }
    while (el.offsetWidth > maxW && fs > 8) { fs--; el.style.fontSize = fs + 'px'; }
    setTimeout(function() { window.print(); }, 800);
  });</script>
</body>
</html>`);
    printWindow.document.close();
  };

  const handleSubmitModal = async () => {
    if (!selectedFileForAction) return;

    if (controlAction === 'FALLA' && !failureType) {
      setToast({ visible: true, message: 'Seleccioná el tipo de falla antes de confirmar', type: 'error' });
      return;
    }

    const payload = {
      archivoId: selectedFileForAction.ArchivoID || selectedFileForAction.id,
      estado: controlAction,
      motivo: actionReason,
      tipoFalla: failureType,
      metrosReponer: metersToReprint,
      usuario: user?.usuario || user?.username || 'Sistema',
      isService: selectedFileForAction.isService
    };

    try {
      const res = await fileControlService.controlarArchivo(payload);
      if (res.success) {
        setToast({ visible: true, message: 'Acción registrada correctamente', type: 'success' });
        if (controlAction === 'FALLA') {
          const fallaLabel = fallaTypes.find(f => f.FallaID === failureType)?.Titulo || failureType;
          printFailureLabel({
            order: selectedOrder,
            file: selectedFileForAction,
            tipoFalla: fallaLabel,
            observacion: actionReason,
          });
        }
        refreshCurrentOrder();
        closeModal();
      } else {
        setToast({ visible: true, message: res.message || 'Error al registrar acción', type: 'error' });
      }
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.message || e?.message || 'Error al registrar acción';
      setToast({ visible: true, message: msg, type: 'error' });
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
                    {(selectedOrder.status === 'PRONTO' || (selectedOrder.EstadoenArea || selectedOrder.areaStatus) === 'Pronto') && <span className="px-2 py-0.5 rounded bg-brand-cyan text-white text-[10px] font-black uppercase tracking-widest">COMPLETA</span>}
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

            {/* BOTTOM COMPLETION BUTTON - aparece cuando todos los archivos están listos o el lote entero está controlado */}
            {((orderMetrics.done === orderMetrics.total && orderMetrics.total > 0 && selectedOrder && !['FINALIZADO', 'ENTREGADO'].includes(selectedOrder.status?.toUpperCase())) || 
              (orders.length > 0 && orders.every(o => o.controlled) && orders.every(o => (o.failures || 0) === 0))) && (
              <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom duration-500">
                {isFallaOrder ? (
                  <button
                    onClick={handleCorregirFalla}
                    className="bg-[#BD0C7E] text-white px-6 py-4 rounded-2xl shadow-2xl shadow-[#BD0C7E]/40 flex items-center gap-4 hover:bg-[#9a0a67] active:scale-95 transition-all"
                  >
                    <i className="fa-solid fa-rotate-left text-2xl"></i>
                    <div>
                      <div className="font-black text-lg">CORREGIR FALLA</div>
                      <div className="text-xs opacity-90">Ir al lote con la orden original · {originalOrderCode}</div>
                    </div>
                  </button>
                ) : (
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
                      <div className="font-black text-lg">{finalizandoOrden ? 'FINALIZANDO...' : (orders.length > 0 && orders.every(o => o.controlled) && orders.every(o => (o.failures || 0) === 0) ? 'FINALIZAR LOTE COMPLETO' : 'FINALIZAR ORDEN')}</div>
                      <div className="text-xs opacity-90">{orders.length > 0 && orders.every(o => o.controlled) && orders.every(o => (o.failures || 0) === 0) ? 'Finalizar todas las órdenes del lote a la vez' : 'Todos los archivos listos · Pulsar para cerrar'}</div>
                    </div>
                  </button>
                )}
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
            <div className={`px-6 py-4 border-b flex justify-between items-center ${controlAction === 'FALLA' ? 'bg-[#BD0C7E]/10 border-[#BD0C7E]/20' : 'bg-slate-50 border-slate-200'}`}>
              <h3 className={`font-black text-lg ${controlAction === 'FALLA' ? 'text-[#BD0C7E]' : 'text-slate-600'}`}>
                {controlAction === 'FALLA' ? 'REPORTAR FALLA DE IMPRESIÓN' : 'CANCELAR ARCHIVO'}
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div className="p-6 space-y-4">
              {controlAction === 'FALLA' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Tipo de Falla</label>
                  <div className="relative z-[1500]">
                    <Listbox value={failureType} onChange={setFailureType}>
                      <div className="relative">
                        <ListboxButton className="relative w-full cursor-pointer rounded-xl bg-slate-50 py-3 pl-4 pr-10 text-left border border-slate-200 focus:outline-none focus-visible:border-[#BD0C7E] sm:text-sm">
                          <span className={`block truncate font-medium ${failureType ? 'text-slate-700' : 'text-slate-400'}`}>
                            {failureType ? fallaTypes.find(f => f.FallaID === failureType)?.Titulo : 'Seleccione...'}
                          </span>
                          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                            <ChevronsUpDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
                          </span>
                        </ListboxButton>
                        <Transition
                          as={Fragment}
                          leave="transition ease-in duration-100"
                          leaveFrom="opacity-100"
                          leaveTo="opacity-0"
                        >
                          <ListboxOptions className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-2 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm z-50">
                            <ListboxOption
                              value=""
                              className={({ active }) =>
                                `relative cursor-pointer select-none py-2.5 pl-10 pr-4 ${active ? 'bg-[#BD0C7E]/10 text-[#BD0C7E]' : 'text-slate-500'}`
                              }
                            >
                              <span className="block truncate italic">Seleccione...</span>
                            </ListboxOption>
                            {fallaTypes.map((falla) => (
                              <ListboxOption
                                key={falla.FallaID}
                                className={({ active }) =>
                                  `relative cursor-pointer select-none py-2.5 pl-10 pr-4 ${active ? 'bg-[#BD0C7E]/10 text-[#BD0C7E]' : 'text-slate-700'}`
                                }
                                value={falla.FallaID}
                              >
                                {({ selected }) => (
                                  <>
                                    <span className={`block truncate ${selected ? 'font-black' : 'font-medium'}`} title={falla.DescripcionDefault}>
                                      {falla.Titulo}
                                    </span>
                                    {selected ? (
                                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#BD0C7E]">
                                        <Check className="h-4 w-4" aria-hidden="true" />
                                      </span>
                                    ) : null}
                                  </>
                                )}
                              </ListboxOption>
                            ))}
                          </ListboxOptions>
                        </Transition>
                      </div>
                    </Listbox>
                  </div>
                </div>
              )}

              {controlAction === 'FALLA' && (() => {
                const fileAlto = parseFloat(selectedFileForAction?.Alto || 0);
                const maxReponer = fileAlto > 0 ? Math.max(0, fileAlto - 0.01) : null;
                return (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                      Metros a Reponer
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={maxReponer ?? undefined}
                        disabled={reponerCompleto}
                        className={`flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-[#BD0C7E] font-medium text-sm text-slate-700 ${reponerCompleto ? 'opacity-50 cursor-not-allowed' : ''}`}
                        placeholder="Ej: 2.5"
                        value={metersToReprint}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (maxReponer !== null && parseFloat(val) > maxReponer) {
                            setMetersToReprint(maxReponer.toFixed(2));
                          } else {
                            setMetersToReprint(val);
                          }
                        }}
                      />
                      <label className="flex items-center gap-2 cursor-pointer shrink-0 select-none">
                        <input
                          type="checkbox"
                          checked={reponerCompleto}
                          onChange={(e) => {
                            setReponerCompleto(e.target.checked);
                            if (e.target.checked) {
                              setMetersToReprint(fileAlto > 0 ? fileAlto.toFixed(2) : '');
                            } else {
                              setMetersToReprint('');
                            }
                          }}
                          className="w-4 h-4 accent-[#BD0C7E] cursor-pointer"
                        />
                        <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">
                          Completo ({fileAlto > 0 ? fileAlto.toFixed(2) : '?'} m)
                        </span>
                      </label>
                    </div>
                    {maxReponer !== null && !reponerCompleto && (
                      <p className="text-xs text-slate-400 mt-1">
                        Máximo: <span className="font-bold text-slate-500">{maxReponer.toFixed(2)} m</span>
                      </p>
                    )}
                  </div>
                );
              })()}

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
                  className={`flex-1 py-3 rounded-xl font-bold text-white shadow-lg transition-all transform active:scale-95 ${controlAction === 'FALLA' ? 'bg-[#BD0C7E] shadow-[#BD0C7E]/30 hover:bg-[#9a0a67]' : 'bg-slate-700 shadow-slate-300 hover:bg-slate-800'}`}
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

              <div className="w-full bg-brand-cyan/10 rounded-2xl border-2 border-brand-cyan/20 p-4 mb-6">
                <div className="text-[10px] font-black text-brand-cyan uppercase tracking-widest mb-1">PRÓXIMO SERVICIO</div>
                <div className="text-2xl font-black text-brand-cyan leading-tight">
                  {completedOrderData.proximoServicio || '---'}
                </div>
              </div>

              <div className="space-y-3 w-full">
                <button onClick={() => {
                  const id = completedOrderData?.ordenId;
                  const wasLast = completedOrderData?.isLastInRoll;
                  setCompletedOrderData(null);
                  if (wasLast) setActiveRoll(null);
                  // Usar printLabelsHelper directamente: las etiquetas acaban de generarse
                  // por completarOrden, NO llamar handlePrintLabels que podría regenerar
                  // si selectedOrder es null (isAlreadyDone = false en ese momento).
                  printLabelsHelper(null, { id });
                }} className="w-full py-3 rounded-xl bg-brand-cyan text-white font-black text-lg shadow-lg shadow-brand-cyan/30 hover:bg-brand-cyan hover:scale-[1.02] transition-all active:scale-95">
                  <i className="fa-solid fa-print mr-2"></i> IMPRIMIR ETIQUETAS
                </button>
                <div className="flex gap-2">
                  <button onClick={() => {
                    const wasLast = completedOrderData?.isLastInRoll;
                    setCompletedOrderData(null);
                    if (wasLast) setActiveRoll(null);
                  }} className="flex-1 py-3 rounded-xl bg-white border-2 border-slate-200 text-slate-500 font-bold text-sm hover:bg-slate-50">
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
