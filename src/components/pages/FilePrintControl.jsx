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
import FallaAnnotator from '../production/components/FallaAnnotator';

import { socket } from '../../services/socketService';
import Toast from '../ui/Toast';
import { printLabelsHelper } from '../../utils/printHelper';

// Pseudo-lote "Todos": habilita el buscador cross-lote (el backend busca en todos los lotes activos del área).
const ALL_ROLLS = { id: 'todo', nombre: 'Todos los lotes' };

const SmallRollMetrics = ({ roll, metrics }) => {
  if (!roll) return null;
  const execution = metrics?.stats?.execution || 0;
  const currentMeters = metrics?.stats?.metrosProducidos ?? 0;
  const totalMeters = metrics?.stats?.metrosTotales ?? roll.metros ?? 0;
  // La unidad la decide el backend según el área del lote: TPU va en unidades (parches), el resto
  // en metros. Estaba fija en 'm' y un lote de TPU mostraba "15/15m".
  const unidad = metrics?.stats?.unidad || 'm';
  const metersText = metrics?.stats ? `${currentMeters}/${totalMeters}${unidad}` : `${totalMeters}${unidad}`;

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
            {/* viewBox: el círculo se dibuja en un espacio 40x40 y se escala al contenedor
                (sin esto, al achicar el contenedor —ej. tablet— el anillo se salía y se rompía) */}
            <svg viewBox="0 0 40 40" className="w-full h-full transform -rotate-90">
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
  // Auto-Siguiente DESHABILITADO a pedido: siempre false, el toggle queda visible pero disabled.
  const [autoAdvance] = useState(false);

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
  // Órdenes que se cerraron pero NO generaron etiqueta: sin bulto no se pueden despachar.
  const [etiquetasFallidas, setEtiquetasFallidas] = useState(null);
  const [fallaTypes, setFallaTypes] = useState([]);
  const [finalizandoOrden, setFinalizandoOrden] = useState(false);
  const [pendingSelectCode, setPendingSelectCode] = useState(null);

  // Falla Form
  const [failureType, setFailureType] = useState('');
  const [metersToReprint, setMetersToReprint] = useState('');
  // FALLA POR COPIAS: cuántas copias fallaron (archivos multi-copia, fuera de TPU). La -F repone
  // solo esas y las buenas se siguen contando. TPU queda whole-file (controla por parches).
  const [copiasFalladas, setCopiasFalladas] = useState('1');
  const [reponerCompleto, setReponerCompleto] = useState(false);
  const [actionReason, setActionReason] = useState('');
  const [annotatedImage, setAnnotatedImage] = useState(null); // dataURL del thumbnail con el recuadro de falla
  const [submittingControl, setSubmittingControl] = useState(false); // request en vuelo: bloquea el Confirmar (evita fallas duplicadas por doble click)
  // En SB no se piden "metros a reponer": la falla (-F) arranca en 0m. Se oculta el campo + el check.
  const isSB = String(areaCode || '').toUpperCase() === 'SB';

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
    // Throttle con trailing: producción emite order_updated/ordersUpdated todo el día (WSP,
    // entregas, otras áreas) — sin esto se recargaban los rollos por CADA evento.
    const ROLLOS_WINDOW_MS = 8000;
    let rollosTimer = null;
    let lastRollosRun = 0;
    const fetchRollosThrottled = () => {
      if (rollosTimer) return; // ya hay una ejecución agendada que cubre este evento
      const wait = Math.max(300, ROLLOS_WINDOW_MS - (Date.now() - lastRollosRun));
      rollosTimer = setTimeout(() => { rollosTimer = null; lastRollosRun = Date.now(); fetchRollos(); }, wait);
    };
    socket.on('server:order_updated', fetchRollosThrottled);
    socket.on('server:ordersUpdated', fetchRollosThrottled);
    socket.on('lotes:updated', fetchRollosThrottled);
    return () => {
      clearTimeout(rollosTimer);
      socket.off('server:order_updated', fetchRollosThrottled);
      socket.off('server:ordersUpdated', fetchRollosThrottled);
      socket.off('lotes:updated', fetchRollosThrottled);
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
          clienteId: o.IDCliente || '',
          material: o.Material,
          status: o.Estado,
          statusArea: o.EstadoenArea,
          controlled: o.Controlada === 1,
          sequence: o.Secuencia || 0,
          failures: o.CantidadFallas || 0,
          hasLabels: o.CantidadEtiquetas || 0,
          rolloId: o.RolloID || null,
          nextService: o.ProximoServicio,
          meters: parseFloat(o.Magnitud) || 0,
          priority: o.Prioridad || 'Normal',
          modoRetiro: o.ModoRetiro || ''
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
      if (activeRoll?.id && activeRoll.id !== 'todo') {
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
        const fullDetails = await fileControlService.getPedidoMetrics(selectedOrder.code || selectedOrder.id, areaCode);
        setPedidoMetrics(fullDetails);

      } catch (e) { console.error(e); }
      finally { setLoadingFiles(false); }
    };
    fetchDetails();
  }, [selectedOrder]);

  // Ref that always holds the latest selectedOrder — lets the socket handler
  // read it without adding selectedOrder to the effect dependencies (which
  // would cancel the auto-advance timer on every order-state update).
  const selectedOrderRef = useRef(selectedOrder);
  useEffect(() => { selectedOrderRef.current = selectedOrder; }, [selectedOrder]);

  // 4. Socket Listeners
  useEffect(() => {
    // Parte pesada (recarga de la lista de órdenes + auto-advance) con throttle-trailing:
    // los eventos socket llegan constantemente desde toda la producción; sin ventana, esta
    // vista recargaba TODO por cada evento. El primer evento corre a los ~300ms (la acción
    // del operario se siente inmediata) y la ráfaga queda cubierta por UNA ejecución final.
    const HEAVY_WINDOW_MS = 4000;
    let heavyTimer = null;
    let lastHeavyRun = 0;

    const runHeavyRefresh = () => {
      if (!activeRoll) return;
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
            meters: parseFloat(o.Magnitud) || 0,
          priority: o.Prioridad || 'Normal',
          modoRetiro: o.ModoRetiro || ''
          }));
          setOrders(normalized);

          const currentSelected = selectedOrderRef.current;
          if (currentSelected) {
            const fresh = normalized.find(o => o.id === currentSelected.id);
            if (fresh) {
              // Update current selection
              setSelectedOrder(prev => {
                if (!prev) return null;
                if (prev.id !== fresh.id) return prev;
                // Sin cambios reales → devolver prev (misma referencia). Si no, cada evento creaba
                // un objeto nuevo y re-disparaba la recarga de archivos ("Cargando archivos" en loop).
                const campos = ['status', 'statusArea', 'controlled', 'sequence', 'failures', 'hasLabels', 'rolloId', 'nextService', 'meters'];
                if (campos.every(k => prev[k] === fresh[k])) return prev;
                return { ...prev, ...fresh };
              });

              // AUTO ADVANCE LOGIC
              // Check if status changed to a completed state
              const isCompleted = ['PRONTO', 'FINALIZADO', 'ENTREGADO'].includes(fresh.status?.toUpperCase()) || (fresh.EstadoenArea || fresh.areaStatus || '').toUpperCase() === 'PRONTO';
              // Estado ANTERIOR de la orden: usar el ref (currentSelected), no selectedOrder del
              // closure (que está stale/null porque el effect no tiene selectedOrder en sus deps).
              const wasCompleted = ['PRONTO', 'FINALIZADO', 'ENTREGADO'].includes(currentSelected.status?.toUpperCase()) || (currentSelected.EstadoenArea || currentSelected.areaStatus || '').toUpperCase() === 'PRONTO';

              // Solo mostrar el modal si NO es una orden de reposición (-F)
              // Las -F se completan silenciosamente durante "CORREGIR FALLA" para navegar a la madre.

              // (-\d+)? contempla el sufijo de linaje (SUB-9960-F14604-3): también es una -F.
              const isReposition = /\-F\d+(-\d+)?$/.test(fresh.code || '');

              if (isCompleted && !wasCompleted && !isReposition) {
                // Determinar si es la última orden válida del lote
                const currentSorted = [...normalized].sort((a, b) => {
                  const seqA = a.sequence || 999999;
                  const seqB = b.sequence || 999999;
                  return sortOrder === 'asc' ? seqA - seqB : seqB - seqA;
                });
                const idx = currentSorted.findIndex(o => o.id === fresh.id);
                let hasNext = false;
                for (let i = idx + 1; i < currentSorted.length; i++) {
                  if ((currentSorted[i].meters || 0) > 0) { hasNext = true; break; }
                }

                setCompletedOrderData({
                  ordenId: fresh.id,
                  isLastInRoll: !hasNext,
                  destino: fresh.nextService || 'LOG\u00cdSTICA',
                  proximoServicio: fresh.nextService
                });
              }
            }
          }
        });
    };

    const handleUpdate = (data) => {
      if (activeRoll && !heavyTimer) {
        const wait = Math.max(300, HEAVY_WINDOW_MS - (Date.now() - lastHeavyRun));
        heavyTimer = setTimeout(() => { heavyTimer = null; lastHeavyRun = Date.now(); runHeavyRefresh(); }, wait);
      }
      // La orden que el operario tiene seleccionada se refresca al instante (evento propio, camino barato)
      if (data?.orderId && selectedOrderRef.current && data.orderId == selectedOrderRef.current.id) {
        refreshCurrentOrder();
      }
    };

    socket.on('server:order_updated', handleUpdate);
    socket.on('server:ordersUpdated', handleUpdate);
    return () => {
      clearTimeout(heavyTimer);
      socket.off('server:order_updated', handleUpdate);
      socket.off('server:ordersUpdated', handleUpdate);
      // NO cancelamos autoAdvanceTimerRef aquí — eso se maneja en su propio efecto
    };
  }, [activeRoll, searchTerm, areaCode, sortOrder]);

  // 5. Auto-Advance: efecto separado para no cancelar el timer al cambiar selectedOrder
  useEffect(() => {
    // Solo actuar cuando aparece el modal (completedOrderData pasa de null a algo)
    if (!completedOrderData || !autoAdvance) return;

    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);

    autoAdvanceTimerRef.current = setTimeout(() => {
      if (completedOrderData.isLastInRoll) {
        // Última orden del lote — cerrar modal y avisar
        setCompletedOrderData(null);
        setToast({ visible: true, message: '✓ Lote completado. Todas las órdenes finalizadas.', type: 'success' });
        return;
      }

      // Buscar la siguiente orden válida
      setOrders(prevOrders => {
        const currentSorted = [...prevOrders].sort((a, b) => {
          const seqA = a.sequence || 999999;
          const seqB = b.sequence || 999999;
          return sortOrder === 'asc' ? seqA - seqB : seqB - seqA;
        });

        const idx = currentSorted.findIndex(o => o.id === completedOrderData.ordenId);
        let nextOrder = null;
        const startIdx = idx !== -1 ? idx + 1 : 0;
        for (let i = startIdx; i < currentSorted.length; i++) {
          if ((currentSorted[i].meters || 0) > 0) {
            nextOrder = currentSorted[i];
            break;
          }
        }

        if (nextOrder) {
          setSelectedOrder(nextOrder);
          setCompletedOrderData(null);
          setToast({ visible: true, message: `Auto-avanzando a orden #${nextOrder.code || nextOrder.id}...`, type: 'info' });
        } else {
          // Sin más órdenes válidas
          setCompletedOrderData(null);
          setToast({ visible: true, message: '✓ Lote completado. Todas las órdenes finalizadas.', type: 'success' });
        }
        return prevOrders;
      });
    }, 5000);

    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, [completedOrderData, autoAdvance, sortOrder]);


  // --- HELPERS ---
  // TPU: lo que se controla son los PARCHES, no las capas del arte. Los archivos de una orden TPU
  // son el diseño (cmyk, corte, relieve…), todos con Copias = 1: controlarlos uno por uno no dice
  // nada y muestra 5 líneas donde debería haber una. Se colapsa a UNA línea, con el nombre
  // CodigoOrden_Trabajo y la cantidad pedida como copias a controlar.
  // El contador se apoya en el primer archivo de arte (el boceto queda afuera: no se fabrica), y el
  // backend, para TPU, topea por Ordenes.Magnitud en vez de por Copias del archivo.
  const esControlTPU = String(areaCode || '').toUpperCase() === 'TPU';
  const filesVista = useMemo(() => {
    if (!esControlTPU) return files;
    const arte = files.filter(f => !f.isService && !/boceto/i.test(String(f.NombreArchivo || '')));
    const portador = arte[0];
    if (!portador) return files;
    const cantidad = Math.max(1, Math.round(parseFloat(
      String(portador.OrdenMagnitud ?? '0').replace(',', '.')
    ) || 0));
    const codigo = portador.OrdenCodigo || selectedOrder?.code || '';
    const trabajo = (portador.OrdenTrabajo || '').trim();
    return [{
      ...portador,
      NombreArchivo: trabajo ? `${codigo}_${trabajo}` : codigo,
      Copias: cantidad,
      Metros: 0,
    }];
  }, [files, esControlTPU, selectedOrder]);

  const orderMetrics = React.useMemo(() => {
    // TPU: la unidad de control es el PARCHE. El progreso son copias controladas sobre la cantidad
    // pedida — contando archivos daría 1/5 (solo la línea colapsada llega a OK) y el botón de
    // finalizar no aparecería nunca.
    if (esControlTPU && filesVista.length === 1 && !filesVista[0].isService) {
      const linea = filesVista[0];
      const total = parseInt(linea.Copias) || 1;
      const done = ['OK', 'FINALIZADO', 'CANCELADO'].includes(linea.EstadoArchivo)
        ? total
        : Math.min(total, parseInt(linea.Controlcopias) || 0);
      return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
    }
    const total = files.length;
    const done = files.filter(f => ['OK', 'FINALIZADO', 'CANCELADO'].includes(f.EstadoArchivo)).length;
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [files, filesVista, esControlTPU]);

  const refreshCurrentOrder = () => {
    if (selectedOrder) {
      fileControlService.getArchivosPorOrden(selectedOrder.id).then(setFiles);
      fileControlService.getPedidoMetrics(selectedOrder.code || selectedOrder.id, areaCode).then(setPedidoMetrics);
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
          meters: parseFloat(o.Magnitud) || 0,
          priority: o.Prioridad || 'Normal',
          modoRetiro: o.ModoRetiro || ''
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

  // Tarjetas de "órdenes hermanas" (mismo pedido, misma área): 1/2, 2/2, etc.
  const siblingOrders = React.useMemo(() => {
    if (!pedidoMetrics?.ordenes) return [];
    const sameArea = pedidoMetrics.ordenes.filter(o => o.AreaID === areaCode);
    if (sameArea.length < 2) return [];
    return sameArea
      .map(o => ({
        ordenId: o.OrdenID,
        code: o.CodigoOrden,
        status: o.Estado,
        statusArea: o.EstadoenArea,
        canasto: o.Canasto,
        material: o.Material,
        rolloId: o.RolloID,
        lote: o.NombreRollo,
        maquina: o.NombreMaquina,
        files: (pedidoMetrics.allFiles || []).filter(f => String(f.OrdenID) === String(o.OrdenID))
      }))
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  }, [pedidoMetrics, areaCode]);

  // Solo las hermanas (sin la orden que se está controlando ahora mismo)
  const otherSiblingOrders = React.useMemo(() => {
    return siblingOrders.filter(s => s.ordenId !== selectedOrder?.id);
  }, [siblingOrders, selectedOrder]);

  // Mismos tonos que OrderCard.getStatusColor, para que las hermanas se vean consistentes con el resto de la app
  const orderStatusTone = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('imprimiendo') || s.includes('proceso')) return 'bg-blue-100 text-blue-700 border-blue-200';
    if (s.includes('detenido') || s.includes('falla') || s.includes('retenido')) return 'bg-red-100 text-red-700 border-red-200';
    if (s.includes('control') || s.includes('calidad')) return 'bg-purple-100 text-purple-700 border-purple-200';
    if (s.includes('finalizado') || s.includes('entregado') || s.includes('pronto')) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    return 'bg-zinc-100 text-zinc-600 border-zinc-200';
  };

  const fileStatusTone = (status) => {
    const s = (status || '').toUpperCase();
    if (['OK', 'FINALIZADO'].includes(s)) return 'bg-brand-cyan/10 text-brand-cyan';
    if (s === 'FALLA') return 'bg-red-100 text-red-600';
    if (s === 'CANCELADO') return 'bg-zinc-100 text-zinc-500';
    return 'bg-zinc-100 text-zinc-400';
  };

  // "Ver esta orden" en la tarjeta de una hermana: si ya está en la lista del lote activo la
  // selecciona directo; si no (otro lote), la busca por código antes de seleccionarla.
  const handleSelectSiblingOrder = async (ordenId, codigoOrden) => {
    if (selectedOrder?.id === ordenId) return;
    const existing = orders.find(o => o.id === ordenId);
    if (existing) {
      handleSelectOrder(existing);
      return;
    }
    try {
      const data = await fileControlService.getOrdenes(codigoOrden, '', areaCode || 'DTF');
      const found = (data || []).find(o => o.OrdenID === ordenId) || (data || []).find(o => o.CodigoOrden === codigoOrden);
      if (!found) {
        setToast({ visible: true, message: `No se encontró la orden ${codigoOrden}`, type: 'error' });
        return;
      }
      handleSelectOrder({
        id: found.OrdenID,
        code: found.CodigoOrden,
        client: found.Cliente,
        clienteId: found.IDCliente || '',
        material: found.Material,
        status: found.Estado,
        statusArea: found.EstadoenArea,
        controlled: found.Controlada === 1,
        sequence: found.Secuencia || 0,
        failures: found.CantidadFallas || 0,
        hasLabels: found.CantidadEtiquetas || 0,
        rolloId: found.RolloID || null,
        nextService: found.ProximoServicio,
        meters: parseFloat(found.Magnitud) || 0,
        priority: found.Prioridad || 'Normal'
      });
    } catch (e) {
      console.error(e);
      setToast({ visible: true, message: 'Error al cargar la orden', type: 'error' });
    }
  };

  // --- ACTIONS HANDLERS ---
  // --- FALLA ORDER DETECTION ---
  // (-\d+)? contempla el sufijo de linaje: SUB-9960-F14604-3 también es una reposición.
  const isFallaOrder = /\-F\d+(-\d+)?$/.test(selectedOrder?.code || '');
  const originalOrderCode = isFallaOrder ? selectedOrder.code.replace(/\-F\d+(-\d+)?$/, '') : null;

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
          meters: parseFloat(o.Magnitud) || 0,
          priority: o.Prioridad || 'Normal',
          modoRetiro: o.ModoRetiro || ''
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

    // Con el buscador filtrado, la lista visible NO representa el lote entero → se finaliza SOLO la
    // orden seleccionada (aunque las visibles estén controladas), no "el lote completo".
    const loteCompleto = !searchTerm.trim()
      && ordenesPendientes.length > 0
      && ordenesPendientes.every(o => o.controlled)
      && ordenesPendientes.every(o => (o.failures || 0) === 0);

    const ordersToComplete = loteCompleto ? ordenesPendientes : [selectedOrder];

    try {
      let lastRes = null;
      let someError = null;
      const faltantesAcc = new Set();
      const liberadasAcc = new Set();
      const sinEtiqueta = [];   // órdenes que quedaron sin etiqueta (no se pueden despachar)

      for (const order of ordersToComplete) {
        const res = await fileControlService.completarOrden(order.id);
        if (res.success) {
          lastRes = res;
          if (res.pedidoCompletoEnArea === false) {
            (res.faltantesPedido || []).forEach(c => faltantesAcc.add(c));
          }
          (res.ordenesLiberadas || []).forEach(c => liberadasAcc.add(c));
          // La orden se cerró, pero sin etiqueta no hay bulto y sin bulto no hay remito.
          // Antes esto solo quedaba en el log del servidor.
          if (res.etiquetasError) {
            sinEtiqueta.push({ code: res.codigoOrden || order.code || order.id, motivo: res.etiquetasError });
          }
        } else {
          someError = res.error || `Error al finalizar la orden ${order.code || order.id}`;
          setToast({ visible: true, message: someError, type: 'error' });
        }
      }

      if (sinEtiqueta.length > 0) {
        setEtiquetasFallidas(sinEtiqueta);
      }

      // Si en este mismo batch se completó o liberó una orden que figuraba como
      // faltante, ya no es faltante
      ordersToComplete.forEach(o => faltantesAcc.delete(o.code));
      liberadasAcc.forEach(c => faltantesAcc.delete(c));

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
          isLastInRoll,
          faltantesPedido: [...faltantesAcc],
          ordenesLiberadas: [...liberadasAcc]
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
            meters: parseFloat(o.Magnitud) || 0,
          priority: o.Prioridad || 'Normal',
          modoRetiro: o.ModoRetiro || ''
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


  // Agrega un bulto/etiqueta EXTRA a la orden seleccionada (mismo backend que el modal de Etiquetas).
  // Útil acá porque al controlar/empaquetar ya se sabe el total real de bultos.
  const handleAddExtraBulto = async () => {
    if (!selectedOrder?.id) return;
    if (!window.confirm(`¿Agregar un bulto EXTRA a la orden ${selectedOrder.code || selectedOrder.id}?`)) return;
    try {
      setToast({ visible: true, message: 'Agregando bulto extra...', type: 'info' });
      const res = await fileControlService.createExtraLabel(selectedOrder.id);
      if (res?.success) {
        const total = res?.details?.totalBultos;
        setToast({ visible: true, message: res.message || 'Bulto extra agregado.', type: 'success' });
        // Reflejar el nuevo total de etiquetas en la orden (habilita/actualiza el botón Etiquetas)
        setSelectedOrder(prev => prev ? { ...prev, hasLabels: total ?? ((prev.hasLabels || 0) + 1) } : prev);
        setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, hasLabels: total ?? ((o.hasLabels || 0) + 1) } : o));
      } else {
        setToast({ visible: true, message: res?.error || 'No se pudo agregar el bulto.', type: 'error' });
      }
    } catch (e) {
      setToast({ visible: true, message: e?.response?.data?.error || e?.message || 'Error al agregar bulto extra.', type: 'error' });
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


  // ¿La falla de este archivo va POR COPIAS? (multi-copia, no servicio, no TPU)
  const fallaPorCopiasAplica = (file) =>
    !!file && !file.isService && !esControlTPU && (parseInt(file.Copias) || 1) > 1;
  // Copias que quedan sin resolver (sin contar ni fallar): el máximo reportable
  const copiasRestantesDe = (file) => Math.max(1,
    (parseInt(file?.Copias) || 1) - (parseInt(file?.Controlcopias) || 0) - (parseInt(file?.CopiasFalladas) || 0));

  const openActionModal = (file, action) => {
    setSelectedFileForAction(file);
    setControlAction(action);
    setActionReason('');
    setFailureType('');
    setReponerCompleto(false);
    setAnnotatedImage(null);
    setCopiasFalladas('1');
    // Metros sugeridos = 1 copia (metros por copia del archivo); el operario puede corregirlos.
    const mCopia = parseFloat(file?.Metros || file?.Alto || 0);
    setMetersToReprint(action === 'FALLA' && !isSB && fallaPorCopiasAplica(file) && mCopia > 0
      ? mCopia.toFixed(2) : '');
  };

  const closeModal = () => {
    setControlAction(null);
    setSelectedFileForAction(null);
    setReponerCompleto(false);
    setAnnotatedImage(null);
  };

  // UNA etiqueta por archivo, cuando queda RESUELTO (contadas + falladas = total),
  // listando TODAS sus fallas acumuladas. Antes salía una etiqueta por cada reporte.
  const printFailureLabel = ({ order, file, fallas = [] }) => {
    const orderCode = order?.code || order?.CodigoOrden || '---';
    const client = order?.client || order?.Cliente || '---';
    const material = file?.Material || file?.material || order?.material || '';
    const ancho = parseFloat(file?.Ancho || 0).toFixed(2);
    const alto = parseFloat(file?.Alto || 0).toFixed(2);
    const fecha = new Date().toLocaleDateString('es-ES');

    const esc = (s) => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const itemsFalla = fallas.map((f) => {
      const partes = [];
      // Qué copia salió mala (registrada al reportar). Con varias, el rango N-M.
      if (f.CopiaDesde) {
        const n = parseInt(f.CopiasFalla) || 1;
        partes.push(n > 1 ? `COPIAS ${f.CopiaDesde}-${f.CopiaDesde + n - 1}` : `COPIA ${f.CopiaDesde}`);
      } else if (f.CopiasFalla) {
        partes.push(`x${f.CopiasFalla} ${f.CopiasFalla === 1 ? 'copia' : 'copias'}`);
      }
      if (f.CantidadFalla) partes.push(`${parseFloat(f.CantidadFalla).toFixed(2)} m`);
      const cant = partes.length ? ` — ${partes.join(' · ')}` : '';
      return `
        <div class="falla-item">
          <div class="falla-tipo">${esc(f.TipoFalla)}${cant}</div>
          ${f.Observaciones ? `<div class="falla-obs">${esc(f.Observaciones)}</div>` : ''}
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
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
    .tipo-falla {
      font-size: 20px; font-weight: 900; text-transform: uppercase; text-align: center;
      border: 3px solid #000; padding: 6px 20px; width: 90%; box-sizing: border-box;
    }
    .fallas-list { width: 92%; display: flex; flex-direction: column; gap: 5px; }
    .falla-item { border: 2px solid #000; padding: 4px 8px; }
    .falla-tipo { font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .falla-obs { font-size: 9px; font-weight: 600; line-height: 1.25; margin-top: 2px; }
    .footer { border-top: 3px solid #000; padding-top: 8px; margin-top: 8px; text-align: center; }
    .order-num { font-size: 38px; font-weight: 900; display: inline-block; white-space: nowrap; color: #000; }
    .dim-text { font-size: 12px; color: #000; margin-top: 2px; }
    @media print { .no-print { display: none !important; } body { background: #fff; } }
  </style>
</head>
<body>
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
      <div class="tipo-falla">${fallas.length} ${fallas.length === 1 ? 'FALLA REGISTRADA' : 'FALLAS REGISTRADAS'}</div>
      <div class="fallas-list">${itemsFalla}</div>
    </div>

    <div class="footer">
      <div class="order-num">${orderCode}</div>
      <div class="dim-text">${material}</div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function() {
      var el = document.querySelector('.order-num');
      if (el) {
        var maxW = el.parentElement.offsetWidth * 0.8;
        var fs = 10;
        el.style.fontSize = fs + 'px';
        while (el.offsetWidth < maxW && fs < 200) { fs++; el.style.fontSize = fs + 'px'; }
        while (el.offsetWidth > maxW && fs > 8) { fs--; el.style.fontSize = fs + 'px'; }
      }
    });
  </script>
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    // Give iframe a moment to render and execute its resize script before printing
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 3000);
    }, 250);
  };

  const handleSubmitModal = async () => {
    if (!selectedFileForAction || submittingControl) return;

    if (controlAction === 'FALLA' && !failureType) {
      setToast({ visible: true, message: 'Seleccioná el tipo de falla antes de confirmar', type: 'error' });
      return;
    }

    const payload = {
      archivoId: selectedFileForAction.ArchivoID || selectedFileForAction.id,
      estado: controlAction,
      motivo: actionReason,
      tipoFalla: failureType,
      metrosReponer: isSB ? '' : metersToReprint,
      // Falla por copias: la -F repone SOLO estas (el backend igual la topea a las restantes)
      copiasFalladas: (controlAction === 'FALLA' && fallaPorCopiasAplica(selectedFileForAction))
        ? Math.min(parseInt(copiasFalladas) || 1, copiasRestantesDe(selectedFileForAction))
        : undefined,
      usuario: user?.usuario || user?.username || 'Sistema',
      isService: selectedFileForAction.isService,
      annotatedImage: controlAction === 'FALLA' ? annotatedImage : null
    };

    setSubmittingControl(true);
    try {
      const res = await fileControlService.controlarArchivo(payload);
      if (res.success) {
        setToast({ visible: true, message: 'Acción registrada correctamente', type: 'success' });
        // Etiqueta: solo cuando el backend dice que el archivo quedó RESUELTO (una etiqueta
        // con TODAS sus fallas). Si quedan copias buenas por contar, saldrá al contar la última.
        if (controlAction === 'FALLA' && res.imprimirEtiquetaFalla && Array.isArray(res.fallasArchivo) && res.fallasArchivo.length) {
          printFailureLabel({
            order: selectedOrder,
            file: selectedFileForAction,
            fallas: res.fallasArchivo,
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
    } finally {
      setSubmittingControl(false);
    }
  };


  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">

      {/* --- SIDEBAR (ORDER LIST) --- */}
      {/* Ancho en rem (no px): así escala solo con la compactación de tablet (html.is-tablet font-size) */}
      <aside className="w-[22.5rem] h-full bg-white border-r border-slate-200 flex flex-col z-10 shrink-0 shadow-xl shadow-slate-200/50">

        {/* Header Sidebar */}
        <div className="p-4 tablet:p-2.5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 mb-4 tablet:mb-2.5">
            <div className="w-8 h-8 tablet:w-7 tablet:h-7 rounded-lg bg-cyan-500 flex items-center justify-center text-white shadow-lg shadow-cyan-200">
              <i className="fa-solid fa-boxes-packing"></i>
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-800 uppercase leading-none">Control</h2>
              <div className="text-[10px] tablet:text-[9px] font-bold text-slate-400 uppercase tracking-widest">Empaquetado {areaCode}</div>
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
                  <span className="truncate">{activeRoll ? (activeRoll.id === 'todo' ? '🔎 Todos los lotes' : `Lote #${activeRoll.id} - ${activeRoll.nombre}`) : 'Seleccione Lote...'}</span>
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
                      <ListboxOption
                        value={ALL_ROLLS}
                        className={({ active, selected }) =>
                          `flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-xs transition-colors border-b border-slate-100 ${
                            selected || activeRoll?.id === 'todo' ? 'bg-cyan-50 text-cyan-600 font-bold' : active ? 'bg-slate-50 text-slate-800 font-medium' : 'text-slate-600 font-bold'
                          }`
                        }
                      >
                        <i className="fa-solid fa-layer-group text-[11px] shrink-0"></i>
                        <span className="truncate">Todos los lotes (buscar en todos)</span>
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

          {/* Auto Advance Toggle — DESHABILITADO (siempre apagado, no clickeable) */}
          <div className="mt-3 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 opacity-50">
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-forward text-xs text-slate-400"></i>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Auto-Siguiente</span>
            </div>

            <div
              className="w-8 h-4 flex items-center rounded-full p-0.5 cursor-not-allowed bg-slate-300"
              title="Auto-Siguiente deshabilitado"
            >
              <div className="bg-white w-3 h-3 rounded-full shadow-sm translate-x-0"></div>
            </div>
          </div>
        </div>

        {/* Metrics (no aplica al pseudo-lote "Todos") */}
        {activeRoll && activeRoll.id !== 'todo' && <div className="border-b border-slate-200"><SmallRollMetrics roll={activeRoll} metrics={activeRollMetrics} /></div>}

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col bg-slate-50">
          {loadingOrders ? (
            <div className="py-8 text-center text-cyan-500"><i className="fa-solid fa-circle-notch fa-spin"></i></div>
          ) : sortedOrders.length === 0 ? (
            <div className="py-8 text-center text-slate-400 italic text-xs">
              {activeRoll?.id === 'todo' && !searchTerm.trim()
                ? <>Escribí en el buscador para buscar<br />en todos los lotes del área</>
                : 'Sin órdenes'}
            </div>
          ) : (
            sortedOrders.map(o => {
              const isBlocked = (o.meters || 0) <= 0;
              return (
                <div key={o.id} className={`relative transition-opacity ${isBlocked ? 'opacity-60 grayscale' : ''}`}>
                  {activeRoll?.id === 'todo' && o.rolloId && (
                    <div className="absolute top-2 right-2 z-20 text-cyan-600 bg-cyan-50 rounded-full px-2 py-0.5 text-[10px] font-black border border-cyan-200 shadow-sm">
                      Lote #{o.rolloId}
                    </div>
                  )}
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
            <div className="bg-white border-b border-slate-200 px-4 py-2.5 tablet:px-2.5 tablet:py-1.5">
              <div className="flex justify-between items-center min-h-[40px] tablet:min-h-[32px]">

                {/* Left Side: Order Info & Stepper */}
                <div className="flex items-center gap-4 tablet:gap-2">
                  <div className="flex items-center gap-3 tablet:gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] tablet:text-[9px] font-black uppercase tracking-widest border border-slate-200">
                      ORD
                    </span>
                    <h1 className="text-[22px] tablet:text-lg font-black text-slate-800 tracking-tight leading-none">
                      {selectedOrder.code || selectedOrder.id}
                    </h1>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-bold text-slate-400 truncate max-w-[200px]">
                        {selectedOrder.client}
                      </div>
                      {selectedOrder.clienteId && (
                        <span className="text-[10px] font-black text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/20 px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">
                          {selectedOrder.clienteId}
                        </span>
                      )}
                    </div>
                    <span className="px-2 py-0.5 rounded bg-brand-cyan/10 text-brand-cyan text-[10px] font-black uppercase tracking-widest border border-brand-cyan/20">
                      SEC: {selectedOrder.sequence || '-'}
                    </span>
                    {/* Forma de envío del pedido: cómo lo recibe el cliente */}
                    {selectedOrder.modoRetiro && (
                      <span className="px-2 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-black uppercase tracking-widest border border-violet-200"
                        title="Forma de envío elegida por el cliente">
                        <i className="fa-solid fa-truck-fast mr-1"></i>{selectedOrder.modoRetiro}
                      </span>
                    )}
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

                  {/* Botón: agregar bulto/etiqueta extra (acá ya se conoce el total real al controlar) */}
                  <button
                    onClick={handleAddExtraBulto}
                    title="Agregar un bulto/etiqueta extra a esta orden"
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-brand-cyan/30 bg-white text-brand-cyan text-xs font-black uppercase tracking-wide hover:bg-brand-cyan/10 transition-all shadow-sm shrink-0"
                  >
                    <i className="fa-solid fa-plus"></i>
                    <span className="hidden sm:inline">Extra</span>
                  </button>

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
              ) : filesVista.length === 0 ? (
                <div className="py-20 text-center text-slate-400 italic">
                  Sin archivos de producción
                </div>
              ) : (
                <div className="flex flex-col overflow-hidden border-b border-slate-200 divide-y divide-slate-200">
                  <div className="flex items-center justify-between px-6 py-3 bg-slate-50">
                    <div className="text-xs font-black text-slate-500 uppercase tracking-widest">
                      {filesVista.length} {esControlTPU ? 'LÍNEA A CONTROLAR' : 'ARCHIVOS EN ORDEN'}
                    </div>
                    {selectedOrder?.priority && (
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${['urgente', 'falla', 'reposición', 'reposicion'].includes(String(selectedOrder.priority).toLowerCase()) ? 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20' : 'bg-white text-zinc-400 border-zinc-200'}`}>
                        {selectedOrder.priority}
                      </span>
                    )}
                    {(() => {
                      // Suma de lo imprimible: Metros × Copias de cada archivo (sin servicios ni cancelados),
                      // mismo cálculo que muestra cada tarjeta.
                      const totalMetros = filesVista.reduce((acc, f) => {
                        if (f.isService || String(f.EstadoArchivo || '').toUpperCase() === 'CANCELADO') return acc;
                        return acc + ((parseFloat(f.Metros) || 0) * (parseInt(f.Copias) || 1));
                      }, 0);
                      if (totalMetros <= 0) return null;
                      return (
                        <div className="text-xs font-black text-brand-cyan uppercase tracking-widest">
                          Total: {totalMetros.toFixed(2)} m
                        </div>
                      );
                    })()}
                  </div>

                  {filesVista.map(file => (
                    <FileControlCard
                      key={file.isService ? `service-${file.ArchivoID}` : `file-${file.ArchivoID}`}
                      file={file}
                      refreshOrder={refreshCurrentOrder}
                      onAction={openActionModal}
                      onFallaResuelta={(f, fallas) => printFailureLabel({ order: selectedOrder, file: f, fallas })}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* SIBLING ORDERS (hermanas del mismo pedido, misma área: 1/2, 2/2, etc. — NO incluye la que se está controlando) */}
            {otherSiblingOrders.length > 0 && (
              <div className="border-t border-slate-200">
                <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-b border-slate-200">
                  <div className="text-xs font-black text-slate-500 uppercase tracking-widest">
                    Órdenes hermanas de este pedido
                  </div>
                </div>
                <div className="p-3 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                  {otherSiblingOrders.map(s => (
                    <div key={s.ordenId} className="bg-white border border-zinc-200 rounded-lg p-2.5 hover:border-brand-cyan/40 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-mono text-[10px] font-black text-zinc-400 truncate">ORD {s.code}</span>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase shrink-0 ${orderStatusTone(s.status)}`}>
                          {s.status || '-'}
                        </span>
                      </div>

                      <div className="text-xs font-bold text-zinc-700 truncate mb-1" title={s.material}>{s.material || '-'}</div>

                      <div className="flex items-center gap-2.5 text-[10px] text-zinc-400 font-semibold mb-1.5">
                        <span className="truncate flex items-center gap-1" title={s.lote}><i className="fa-solid fa-layer-group text-[9px]"></i>{s.lote || 'Sin lote'}</span>
                        <span className="truncate flex items-center gap-1" title={s.maquina}><i className="fa-solid fa-print text-[9px]"></i>{s.maquina || 'Sin máquina'}</span>
                      </div>

                      <div className="flex flex-col gap-1 text-[10px] text-zinc-800 font-semibold mb-1.5">
                        <span className="truncate flex items-center gap-1" title={s.statusArea}><i className="fa-solid fa-layer-group text-[9px] text-zinc-300"></i>Estado en área: {s.statusArea || '-'}</span>
                        <span className="truncate flex items-center gap-1" title={s.canasto}><i className="fa-solid fa-basket-shopping text-[9px] text-zinc-300"></i>Canasto: {s.canasto || '-'}</span>
                      </div>

                      <div className="flex flex-col gap-1 border-t border-zinc-100 pt-1.5 max-h-20 overflow-y-auto">
                        {s.files.length === 0 ? (
                          <div className="text-[10px] text-zinc-300 italic">Sin archivos</div>
                        ) : s.files.map((f, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[10px] gap-2">
                            <span className="truncate text-zinc-800">{f.NombreArchivo}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-zinc-800 font-bold">{f.Controlcopias || 0}/{f.Copias || 1}</span>
                              <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${fileStatusTone(f.Estado)}`}>{f.Estado || 'PEND'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                      <div className="font-black text-lg">{finalizandoOrden ? 'FINALIZANDO...' : (!searchTerm.trim() && orders.length > 0 && orders.every(o => o.controlled) && orders.every(o => (o.failures || 0) === 0) ? 'FINALIZAR LOTE COMPLETO' : 'FINALIZAR ORDEN')}</div>
                      <div className="text-xs opacity-90">{!searchTerm.trim() && orders.length > 0 && orders.every(o => o.controlled) && orders.every(o => (o.failures || 0) === 0) ? 'Finalizar todas las órdenes del lote a la vez' : 'Todos los archivos listos · Pulsar para cerrar'}</div>
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
          <div className={`bg-white w-full ${controlAction === 'FALLA' ? 'max-w-lg' : 'max-w-md'} rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200`}>
            <div className={`px-6 py-4 border-b flex justify-between items-center ${controlAction === 'FALLA' ? 'bg-[#BD0C7E]/10 border-[#BD0C7E]/20' : 'bg-slate-50 border-slate-200'}`}>
              <h3 className={`font-black text-lg ${controlAction === 'FALLA' ? 'text-[#BD0C7E]' : 'text-slate-600'}`}>
                {controlAction === 'FALLA' ? 'REPORTAR FALLA DE IMPRESIÓN' : 'CANCELAR ARCHIVO'}
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
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

              {controlAction === 'FALLA' && selectedFileForAction && !selectedFileForAction.isService && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Zona de la falla</label>
                  <FallaAnnotator
                    thumbUrl={`/thumbnails/${selectedOrder?.code}/${selectedFileForAction.ArchivoID || selectedFileForAction.id}.jpg`}
                    onAnnotated={setAnnotatedImage}
                  />
                </div>
              )}

              {/* FALLA POR COPIAS: cuántas fallaron. Solo multi-copia fuera de TPU; la -F repone
                  esas copias y las buenas se siguen contando en la card. */}
              {controlAction === 'FALLA' && fallaPorCopiasAplica(selectedFileForAction) && (() => {
                const maxF = copiasRestantesDe(selectedFileForAction);
                const mCopia = parseFloat(selectedFileForAction?.Metros || selectedFileForAction?.Alto || 0);
                return (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                      ¿Cuántas copias fallaron?
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min="1"
                        max={maxF}
                        step="1"
                        className="w-28 p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-[#BD0C7E] font-bold text-sm text-slate-700"
                        value={copiasFalladas}
                        onChange={(e) => {
                          let v = parseInt(e.target.value);
                          if (isNaN(v)) { setCopiasFalladas(''); return; }
                          if (v < 1) v = 1;
                          if (v > maxF) v = maxF;
                          setCopiasFalladas(String(v));
                          // Sugerir metros = f × metros por copia (editable después)
                          if (!isSB && mCopia > 0 && !reponerCompleto) setMetersToReprint((v * mCopia).toFixed(2));
                        }}
                      />
                      <span className="text-xs font-semibold text-slate-500">
                        de <span className="font-black text-slate-700">{maxF}</span> sin resolver
                        · las copias buenas se siguen contando
                      </span>
                    </div>
                  </div>
                );
              })()}

              {controlAction === 'FALLA' && !isSB && (() => {
                const fileAlto = parseFloat(selectedFileForAction?.Alto || 0);
                const fPorCopias = fallaPorCopiasAplica(selectedFileForAction) ? (parseInt(copiasFalladas) || 1) : 1;
                // Con falla por copias el tope de metros escala con f (f copias = f alturas)
                const maxReponer = fileAlto > 0 ? Math.max(0, fileAlto * fPorCopias - 0.01) : null;
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
                              // "Completo" = todas las copias que se están reportando (f × alto)
                              setMetersToReprint(fileAlto > 0 ? (fileAlto * fPorCopias).toFixed(2) : '');
                            } else {
                              setMetersToReprint('');
                            }
                          }}
                          className="w-4 h-4 accent-[#BD0C7E] cursor-pointer"
                        />
                        <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">
                          Completo ({fileAlto > 0 ? (fileAlto * fPorCopias).toFixed(2) : '?'} m)
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
                  disabled={submittingControl}
                  className={`flex-1 py-3 rounded-xl font-bold text-white shadow-lg transition-all transform active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${controlAction === 'FALLA' ? 'bg-[#BD0C7E] shadow-[#BD0C7E]/30 hover:bg-[#9a0a67]' : 'bg-slate-700 shadow-slate-300 hover:bg-slate-800'}`}
                >
                  {submittingControl ? <><i className="fa-solid fa-circle-notch fa-spin mr-2"></i>Enviando...</> : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div >
      )}

      {/* AVISO: la orden se cerró pero NO se generó su etiqueta.
          Sin etiqueta no hay bulto, y sin bulto no se puede armar el remito.
          Antes esto solo quedaba en el log y el operario lo descubría al despachar. */}
      {etiquetasFallidas && etiquetasFallidas.length > 0 && (
        <div className="fixed inset-0 z-[1700] bg-black/70 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border-4 border-amber-400">
            <div className="bg-amber-400 p-6 flex items-center gap-4 text-amber-950">
              <i className="fa-solid fa-triangle-exclamation text-4xl"></i>
              <div>
                <h2 className="text-xl font-black uppercase tracking-wide leading-tight">Sin etiqueta: no se puede despachar</h2>
                <p className="text-sm font-bold opacity-80">La orden quedó pronta, pero no se generó su bulto.</p>
              </div>
            </div>
            <div className="p-6 space-y-3">
              {etiquetasFallidas.map((x, i) => (
                <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="font-black text-slate-800 text-sm mb-1">{x.code}</p>
                  <p className="text-xs text-slate-600 leading-snug">{x.motivo}</p>
                </div>
              ))}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  <b>Cómo se resuelve:</b> abrí la orden → pestaña <b>Cotizar Productos</b>, cargá el precio
                  y guardá. Después generá la etiqueta desde el botón <b>Etiquetas</b>. Recién con el bulto
                  creado vas a poder incluirla en un remito.
                </p>
              </div>
            </div>
            <div className="px-6 pb-6">
              <button onClick={() => setEtiquetasFallidas(null)}
                className="w-full py-3 rounded-xl bg-slate-800 text-white font-black uppercase tracking-wide hover:bg-slate-700 transition-colors">
                Entendido
              </button>
            </div>
          </div>
        </div>
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

              <div className={`w-full rounded-2xl border-2 p-4 mb-4 ${completedOrderData.faltantesPedido?.length > 0 ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-100'}`}>
                <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${completedOrderData.faltantesPedido?.length > 0 ? 'text-amber-600' : 'text-slate-400'}`}>DESTINO FÍSICO (Canasto)</div>
                <div className={`text-xl font-black leading-tight ${completedOrderData.faltantesPedido?.length > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                  {completedOrderData.destino || 'LOGÍSTICA'}
                </div>
              </div>

              {completedOrderData.faltantesPedido?.length > 0 && (
                <div className="w-full bg-amber-50 rounded-2xl border-2 border-amber-300 p-4 mb-4 text-left">
                  <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">
                    <i className="fa-solid fa-hourglass-half mr-1"></i> PEDIDO INCOMPLETO
                  </div>
                  <div className="text-sm font-bold text-amber-800 leading-snug">
                    Faltan del mismo pedido: {completedOrderData.faltantesPedido.join(', ')}
                  </div>
                </div>
              )}

              {completedOrderData.ordenesLiberadas?.length > 0 && (
                <div className="w-full bg-emerald-50 rounded-2xl border-2 border-emerald-400 p-4 mb-4 text-left animate-pulse">
                  <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">
                    <i className="fa-solid fa-box-open mr-1"></i> ¡PEDIDO COMPLETO!
                  </div>
                  <div className="text-sm font-bold text-emerald-800 leading-snug">
                    Retire también del Canasto Incompletos: {completedOrderData.ordenesLiberadas.join(', ')}
                  </div>
                </div>
              )}

              <div className="w-full bg-brand-cyan/10 rounded-2xl border-2 border-brand-cyan/20 p-4 mb-6">
                <div className="text-[10px] font-black text-brand-cyan uppercase tracking-widest mb-1">PRÓXIMO SERVICIO</div>
                <div className="text-2xl font-black text-brand-cyan leading-tight">
                  {completedOrderData.proximoServicio || '---'}
                </div>
              </div>

              <div className="space-y-3 w-full">
                <button onClick={() => { 
                  // Cancelar el timer de auto-avance para que el operador pueda imprimir
                  // sin que el modal se cierre antes de que la impresión arranque
                  if (autoAdvanceTimerRef.current) {
                    clearTimeout(autoAdvanceTimerRef.current);
                    autoAdvanceTimerRef.current = null;
                  }
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
                    // Cerrar manual: cancelar timer y avanzar inmediato
                    if (autoAdvanceTimerRef.current) {
                      clearTimeout(autoAdvanceTimerRef.current);
                      autoAdvanceTimerRef.current = null;
                    }
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
