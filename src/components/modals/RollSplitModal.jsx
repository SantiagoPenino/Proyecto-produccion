
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { rollsService } from '../../services/api';
import { inventoryService } from '../../services/modules/inventoryService';

const RollSplitModal = ({ isOpen, onClose, roll, areaId }) => {
    const queryClient = useQueryClient();
    const [selectedOrderId, setSelectedOrderId] = useState(null);
    const [newBobinaId, setNewBobinaId] = useState('');
    const [step, setStep] = useState(1);

    // Fetch valid bobinas for the new part
    const { data: bobinas } = useQuery({
        queryKey: ['bobinas-disponibles', areaId],
        queryFn: () => inventoryService.getInventory(areaId),
        enabled: isOpen && step === 2
    });

    const splitMutation = useMutation({
        mutationFn: rollsService.splitRoll,
        onSuccess: () => {
            toast.success("Lote dividido y restante reasignado correctamente");
            queryClient.invalidateQueries(['productionBoard']);
            queryClient.invalidateQueries(['rolls']);
            onClose();
        },
        onError: (err) => {
            console.error(err);
            toast.error("Error al dividir lote");
        }
    });

    const handleConfirm = () => {
        if (!selectedOrderId) return toast.error("Seleccione la última orden impresa correctamente.");

        splitMutation.mutate({
            rollId: roll.id,
            lastOrderId: selectedOrderId,
            newBobinaId: newBobinaId || null
        });
    };

    if (!isOpen || !roll) return null;

    const availableBobinas = (bobinas || [])
        .flatMap(group => group.items || [])
        .flatMap(item => item.bobinas || [])
        .filter(b => b.Estado === 'Disponible' && b.MetrosRestantes > 10);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50">
                    <div>
                        <h2 className="text-xl font-bold text-zinc-800 flex items-center gap-2">
                            <i className="fa-solid fa-scissors text-amber-500"></i>
                            Corte de Bobina / Finalizado Parcial
                        </h2>
                        <p className="text-xs text-zinc-500 mt-1">Lote: {roll.name}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-times"></i>
                    </button>
                </div>

                <div className="p-6">
                    {step === 1 && (
                        <div>
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start gap-3">
                                <i className="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5"></i>
                                <div>
                                    <p className="text-sm text-amber-800 font-bold">Seleccione la última orden que se imprimió CORRECTAMENTE.</p>
                                    <p className="text-xs text-amber-700 mt-1">El sistema asumirá que todas las anteriores están bien y las que siguen se moverán a un NUEVO rollo.</p>
                                </div>
                            </div>

                            <div className="max-h-[400px] overflow-y-auto space-y-2 pr-2">
                                {roll.orders?.map((order, idx) => (
                                    <div
                                        key={order.id}
                                        onClick={() => setSelectedOrderId(order.id)}
                                        className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${selectedOrderId === order.id ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500 shadow-sm' : 'bg-white border-zinc-200 hover:border-blue-300'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${selectedOrderId === order.id ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                                                {idx + 1}
                                            </span>
                                            <div>
                                                <p className="font-bold text-zinc-700 text-sm">{order.code} - {order.client}</p>
                                                <p className="text-xs text-zinc-500 max-w-[300px] truncate">{order.desc}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-xs font-bold text-zinc-600 bg-zinc-100 px-2 py-1 rounded">
                                                {order.magnitudeStr || 'N/A'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={() => setStep(2)}
                                    disabled={!selectedOrderId}
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-200"
                                >
                                    Siguiente <i className="fa-solid fa-arrow-right ml-2"></i>
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div>
                            <div className="mb-6">
                                <label className="block text-sm font-bold text-zinc-700 mb-2">Bobina para el Restante (Opcional)</label>
                                <p className="text-xs text-zinc-500 mb-3">Si ya montaste la nueva bobina, selecciónala aquí para asignarla al nuevo lote automáticamente.</p>

                                <select
                                    value={newBobinaId}
                                    onChange={(e) => setNewBobinaId(e.target.value)}
                                    className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="">-- Dejar nueva bobina pendiente (Solo crear Lote) --</option>
                                    {availableBobinas.map(b => (
                                        <option key={b.BobinaID} value={b.BobinaID}>
                                            {b.CodigoEtiqueta} - {b.NombreInsumo} ({b.MetrosRestantes}m)
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-4 pt-6 border-t border-zinc-100">
                                <button
                                    onClick={() => setStep(1)}
                                    className="px-4 py-2 text-zinc-500 hover:text-zinc-800 font-bold"
                                >
                                    Atrás
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={splitMutation.isPending}
                                    className="flex-1 px-6 py-3 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 shadow-lg shadow-amber-200 flex items-center justify-center gap-2"
                                >
                                    {splitMutation.isPending ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check-double"></i>}
                                    Confirmar Corte y Reasignar
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RollSplitModal;

