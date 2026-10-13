// SIN USO (13/10): tablero de lotes viejo: AreaView lo monta en la ruta "produccion" pero ningún botón lleva ahí. El vivo es PlaneacionTrabajo. Además llama rollsService.closeRoll, que no existe (TypeError). Ver docs/auditoria-limpieza-2026-10-09.md.
import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { productionService, rollsService } from '../../services/api';
import ActiveRollModal from '../modals/ActiveRollModal';
import RollDetailModal from '../modals/RollDetailModal';
import RollCard from '../production/components/RollCard';

const ProductionKanban = ({ areaCode }) => {
    const [machines, setMachines] = useState([]);
    const [pendingRolls, setPendingRolls] = useState([]);
    const [loading, setLoading] = useState(true);

    // --- ESTADOS SEPARADOS PARA EVITAR CONFLICTO DE MODALES ---
    const [selectedRoll, setSelectedRoll] = useState(null); // Para ActiveRollModal (Acciones rápidas)
    const [detailRoll, setDetailRoll] = useState(null);     // Para RollDetailModal (PDF y Tabla)

    // Lógica de carga
    const loadBoard = async () => {
        try {
            const data = await productionService.getBoard(areaCode);
            // data ya contiene { machines, pendingRolls } gracias al nuevo controlador
            setMachines(data.machines || []);
            setPendingRolls(data.pendingRolls || []);
        } catch (error) {
            console.error("Error cargando el tablero:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadBoard();
        const interval = setInterval(loadBoard, 60000);
        return () => clearInterval(interval);
    }, [areaCode]);

    // Registro de Tiempos (Iniciar/Pausar) - VERSIÓN CORREGIDA DE REACT
    // Reemplaza tu función handleToggleStatus con esta:

    const handleToggleStatus = async (rollId, currentAction, machineId) => {

        // 1. VALIDACIÓN: SI ES PLAY (START), VERIFICAR QUE LA MÁQUINA ESTÉ LIBRE
        if (currentAction === 'start') {
            const targetMachine = machines.find(m => String(m.id) === String(machineId));
            if (targetMachine) {
                // Buscamos si hay ALGÚN rollo cuyo estado empiece con 'En maquina' (o 'Producción' por compatibilidad)
                const isBusy = targetMachine.rolls.some(r =>
                    (r.status === 'En maquina' || r.status.startsWith('En maquina') || r.status === 'Producción') &&
                    String(r.id) !== String(rollId)
                );

                if (isBusy) {
                    alert("⛔ DETENIDO: Ya hay un rollo en proceso (Play) en esta máquina. Debes pausarlo o finalizarlo primero.");
                    return; // Cancelamos la acción
                }
            }
        }

        // Guardar estado previo para rollback
        const prevMachines = JSON.parse(JSON.stringify(machines));

        // 2. ACTUALIZACIÓN OPTIMISTA
        console.log(`%c [OPTIMISTA] Cambiando estado...`, 'color: orange');

        setMachines(prevM => {
            return prevM.map(machine => {
                if (String(machine.id) === String(machineId)) {
                    const newRolls = machine.rolls.map(r => {
                        if (String(r.id) === String(rollId)) {
                            // NUEVO ESTADO: 'En maquina' para start, 'Pausado' para stop
                            // Nota: El backend agregará el nombre de la máquina después, 
                            // pero visualmente 'En maquina' activa los estilos correctos por ahora.
                            const newStatus = currentAction === 'start' ? 'En maquina' : 'Pausado';
                            return { ...r, status: newStatus };
                        }
                        return r;
                    });
                    return { ...machine, rolls: newRolls };
                }
                return machine;
            });
        });

        // 3. LLAMADA AL SERVIDOR
        try {
            await productionService.toggleStatus(rollId, currentAction);
            console.log("✅ Éxito en servidor.");
            loadBoard(); // Recargamos para obtener los nombres completos (ej: 'En maquina - Roland')
        } catch (e) {
            console.error("❌ ERROR BACKEND:", e);
            alert(`Error: ${e.response?.data?.error || e.message}`);
            setMachines(prevMachines); // Rollback
        }
    };

    // Finalizar Rollo <--- DEBE SEGUIR ESTA LÍNEA
    const handleCloseRoll = async (roll) => {
        const ordersIncomplete = roll.orders?.filter(o => o.status !== 'Finalizado' && o.status !== 'Imprimiendo').length;
        if (ordersIncomplete > 0) {
            const confirmMessage = `ATENCIÓN: ${ordersIncomplete} órdenes aún no están finalizadas. ¿Desea forzar el cierre?`;
            if (!window.confirm(confirmMessage)) return;
        }
        if (!window.confirm(`¿Finalizar impresión y cerrar el lote ${roll.rollCode}?`)) return;

        try {
            await rollsService.closeRoll(roll.id);
            loadBoard();
        } catch (e) { alert("Error al finalizar el lote."); }
    };

    // --- MANEJADORES DE MODALES ---

    // 1. Abrir Modal de Detalle (El Azul con PDF)
    const handleOpenRollDetail = (roll) => {
        console.log("Abriendo Detalle para:", roll.rollCode);
        setDetailRoll(roll); // Solo activamos detailRoll
    };

    // 2. Abrir Modal de Acciones (Al clickear la tarjeta)
    const handleSelectRoll = (roll) => {
        console.log("Seleccionando Rollo:", roll.rollCode);
        setSelectedRoll(roll); // Solo activamos selectedRoll
    };

    // --- DRAG & DROP ---
    // --- DRAG & DROP (OPTIMISTA) ---
    const onDragEnd = async (result) => {
        const { source, destination, draggableId } = result;

        // 1. Validaciones básicas
        if (!destination) return;
        // Si el usuario lo suelta donde mismo, no hacemos nada
        if (
            source.droppableId === destination.droppableId &&
            source.index === destination.index
        ) {
            return;
        }

        // LOG: Diagnóstico de movimiento
        console.log(`%c [UI] Moviendo Rollo ID: ${draggableId} | De: ${source.droppableId} -> A: ${destination.droppableId}`, 'color: cyan');

        // ============================================================
        // PASO 2: COPIA DE SEGURIDAD (Por si falla el servidor)
        // ============================================================
        const prevPendingRolls = [...pendingRolls];
        // Hacemos copia profunda de machines porque tiene arrays anidados (rolls)
        const prevMachines = JSON.parse(JSON.stringify(machines));

        // ============================================================
        // PASO 3: ACTUALIZACIÓN VISUAL INMEDIATA (Lógica Local)
        // ============================================================
        let movedRoll = null;

        // A. CREAMOS NUEVAS VARIABLES PARA MODIFICAR
        const newPending = [...pendingRolls];
        const newMachines = machines.map(m => ({ ...m, rolls: [...m.rolls] }));

        // B. BUSCAR Y QUITAR DEL ORIGEN (Source)
        if (source.droppableId === 'pending') {
            // Estaba en pendientes
            movedRoll = newPending[source.index];
            newPending.splice(source.index, 1);
        } else {
            // Estaba en una máquina
            const sourceMachine = newMachines.find(m => String(m.id) === source.droppableId);
            if (sourceMachine) {
                movedRoll = sourceMachine.rolls[source.index];
                sourceMachine.rolls.splice(source.index, 1);
            }
        }

        // Si por alguna razón no encontramos el rollo, salimos
        if (!movedRoll) return;

        // C. INSERTAR EN EL DESTINO (Destination)
        if (destination.droppableId === 'pending') {
            // Va a pendientes
            // Opcional: Actualizar estado visualmente a 'En cola'
            movedRoll = { ...movedRoll, status: 'En cola', machineId: null };
            newPending.splice(destination.index, 0, movedRoll);
        } else {
            // Va a una máquina
            const destMachine = newMachines.find(m => String(m.id) === destination.droppableId);
            if (destMachine) {
                // Opcional: Actualizar estado visualmente para que no se vea raro mientras carga
                movedRoll = { ...movedRoll, status: 'En cola', machineId: destMachine.id };
                destMachine.rolls.splice(destination.index, 0, movedRoll);
            }
        }

        // D. APLICAR CAMBIOS AL ESTADO DE REACT (¡Aquí ocurre la magia instantánea!)
        console.log(`%c [UI] Aplicando cambios visuales YA...`, 'color: orange');
        setPendingRolls(newPending);
        setMachines(newMachines);

        // ============================================================
        // PASO 4: LLAMADA AL SERVIDOR (En segundo plano)
        // ============================================================
        const rollId = draggableId;
        const targetMachineId = destination.droppableId === 'pending' ? null : destination.droppableId;

        try {
            console.log(`%c [SERVER] Enviando petición al backend...`, 'color: yellow');
            // Nota: Esperamos la promesa (await) solo para saber si falló, 
            // pero el usuario ya vio el cambio.
            await productionService.assignRoll(rollId, targetMachineId);

            console.log(`%c [SERVER] Éxito. Sincronizado.`, 'color: green');
            // Opcional: Si el servidor devuelve datos calculados (como tiempos nuevos), 
            // podrías llamar a loadBoard() aquí, pero cuidado con los saltos visuales.
            // Por ahora, confiamos en la actualización local.

        } catch (error) {
            // ============================================================
            // PASO 5: ROLLBACK (Si falla, volvemos atrás)
            // ============================================================
            console.error("Error al mover rollo en servidor:", error);

            // Revertimos a las copias de seguridad
            setPendingRolls(prevPendingRolls);
            setMachines(prevMachines);

            const errorMessage = error.response?.data?.message || error.message || "Error desconocido.";
            alert(`Operación Fallida: ${errorMessage}. Se han revertido los cambios.`);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-full bg-slate-50">
            <div className="text-center">
                <i className="fa-solid fa-circle-notch fa-spin text-4xl text-cyan-500 mb-4"></i>
                <p className="font-bold text-slate-500">Cargando Tablero...</p>
            </div>
        </div>
    );

    // --- RENDERIZADO ---
    return (
        <div className="h-full bg-slate-50 flex flex-col overflow-hidden">
            <DragDropContext onDragEnd={onDragEnd}>
                <div className="flex-1 overflow-x-auto p-6 flex gap-6 align-start bg-slate-50">

                    {/* COLUMNA: LOTES EN ESPERA */}
                    <div className="w-80 min-w-[320px] bg-white rounded-2xl shadow-lg border-t-4 border-amber-500 flex flex-col max-h-full">
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white rounded-t-xl sticky top-0 z-10">
                            <div className="font-black text-slate-800 text-sm flex items-center gap-2">
                                <i className="fa-solid fa-layer-group text-amber-500"></i>
                                LOTES EN ESPERA
                            </div>
                            <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">
                                {pendingRolls.length}
                            </span>
                        </div>

                        <Droppable droppableId="pending">
                            {(provided) => (
                                <div
                                    className="p-3 flex-1 overflow-y-auto custom-scrollbar bg-slate-50/50"
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                >
                                    {pendingRolls.map((roll, index) => (
                                        <RollCard
                                            key={roll.id}
                                            roll={roll}
                                            index={index}
                                            isMachineView={false}
                                            onOpenDetail={handleOpenRollDetail}
                                            onSelect={handleSelectRoll}
                                            onFinish={() => { }}
                                            onToggleStatus={() => { }}
                                        />
                                    ))}
                                    {provided.placeholder}
                                    {pendingRolls.length === 0 && (
                                        <div className="h-24 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-300 text-xs italic">
                                            Sin lotes pendientes
                                        </div>
                                    )}
                                </div>
                            )}
                        </Droppable>
                    </div>

                    {/* COLUMNAS: MÁQUINAS */}
                    {machines.map(machine => {
                        const isBusy = machine.rolls.length > 0;
                        const statusColor = machine.status === 'OK' ? 'border-emerald-500' : 'border-red-500';

                        return (
                            <div key={machine.id} className={`w-96 min-w-[320px] bg-white rounded-2xl shadow-lg border-t-4 ${statusColor} flex flex-col max-h-full transition-colors ${isBusy ? 'bg-emerald-50/10' : ''}`}>
                                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white rounded-t-xl sticky top-0 z-10">
                                    <div className="font-black text-slate-800 text-sm flex items-center gap-2">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isBusy ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                                            <i className={`fa-solid ${isBusy && machine.rolls[0]?.status.includes('En maquina') ? 'fa-gear fa-spin' : 'fa-print'}`}></i>
                                        </div>
                                        {machine.name}
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${machine.status === 'OK' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                        {machine.status}
                                    </span>
                                </div>

                                <Droppable droppableId={String(machine.id)}>
                                    {(provided) => (
                                        <div
                                            className="p-3 flex-1 overflow-y-auto custom-scrollbar bg-slate-50/50"
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                        >
                                            {machine.rolls.map((roll, index) => (
                                                <RollCard
                                                    key={roll.id}
                                                    roll={roll}
                                                    index={index}
                                                    isMachineView={true}
                                                    onToggleStatus={handleToggleStatus}
                                                    onFinish={handleCloseRoll}
                                                    onOpenDetail={handleOpenRollDetail}
                                                    onSelect={handleSelectRoll}
                                                    machineId={machine.id}
                                                />
                                            ))}
                                            {provided.placeholder}
                                            {machine.rolls.length === 0 && (
                                                <div className="h-32 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-300 gap-2">
                                                    <i className="fa-solid fa-power-off text-2xl opacity-20"></i>
                                                    <span className="text-xs font-medium">Disponible</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </Droppable>
                            </div>
                        );
                    })}

                </div>
            </DragDropContext>

            {/* --- SECCIÓN DE MODALES (SEPARADOS) --- */}

            {/* 1. Modal General (Acciones Rápidas) */}
            {selectedRoll && (
                <ActiveRollModal
                    isOpen={!!selectedRoll}
                    onClose={() => setSelectedRoll(null)}
                    roll={selectedRoll}
                    onSuccess={loadBoard}
                />
            )}

            {/* 2. Modal Detalle (PDF y Tabla Azul) */}
            {detailRoll && (
                <RollDetailModal
                    isOpen={!!detailRoll}
                    onClose={() => setDetailRoll(null)}
                    roll={detailRoll}
                />
            )}
        </div>
    );
};

export default ProductionKanban;
