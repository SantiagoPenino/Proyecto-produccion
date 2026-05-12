import React, { useState, useEffect } from 'react';
import { Button } from '../../ui/Button';
import { inventoryService } from '../../../services/modules/inventoryService';
import { toast } from 'sonner';
import { X, Save, Printer } from 'lucide-react';

const AddStockModal = ({ isOpen, onClose, areas = [], onSuccess }) => {
    const [insumos, setInsumos] = useState([]);

    // Form States
    const [targetArea, setTargetArea] = useState('');
    const [selectedInsumo, setSelectedInsumo] = useState('');
    const [metros, setMetros] = useState(50);
    const [cantidad, setCantidad] = useState(1);
    const [loteProv, setLoteProv] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadInsumos();
        // Pre-select area if only one is available
        if (areas.length === 1) {
            setTargetArea(areas[0].code || areas[0].AreaID);
        } else if (areas.length > 0) {
            // If multiple, maybe don't select default to force user choice, or select first?
            // Let's force choice if > 1 to avoid mistakes
            setTargetArea(areas[0].code || areas[0].AreaID);
        }
    }, [areas]);

    const loadInsumos = async () => {
        try {
            const data = await inventoryService.getInsumos();
            setInsumos(data);
        } catch (e) {
            toast.error("Error cargando lista de insumos");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!targetArea) return toast.error("Seleccione el área de destino");
        if (!selectedInsumo) return toast.error("Seleccione un insumo");

        setLoading(true);
        try {
            const res = await inventoryService.addStock({
                insumoId: selectedInsumo,
                areaId: targetArea,
                metros: parseFloat(metros),
                cantidadBobinas: parseInt(cantidad),
                loteProv
            });

            if (res.success) {
                toast.success(res.message);
                onSuccess();
                onClose();
            }
        } catch (error) {
            console.error(error);
            toast.error("Error al ingresar stock");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-lg font-bold text-zinc-800">Ingreso de Material</h2>
                    <button onClick={onClose}><X className="w-5 h-5 text-zinc-500" /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">

                    {/* AREA SELECTION */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1">Área Destino</label>
                        {areas.length > 1 ? (
                            <select
                                className="w-full border rounded p-2 bg-zinc-50"
                                value={targetArea}
                                onChange={e => setTargetArea(e.target.value)}
                                required
                            >
                                {areas.map(a => (
                                    <option key={a.code || a.AreaID} value={a.code || a.AreaID}>
                                        {a.name || a.Nombre}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                type="text"
                                value={areas[0]?.name || areas[0]?.Nombre || targetArea}
                                disabled
                                className="w-full border rounded p-2 bg-zinc-100 text-zinc-500"
                            />
                        )}
                    </div>

                    {/* SELECT INSUMO */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1">Insumo / Material</label>
                        <select
                            className="w-full border rounded p-2 bg-zinc-50"
                            value={selectedInsumo}
                            onChange={e => setSelectedInsumo(e.target.value)}
                            required
                        >
                            <option value="">-- Seleccionar --</option>
                            {insumos.filter(i => {
                                // Filtro estricto: Solo mostrar insumos asignados al área seleccionada
                                if (!targetArea) return true;
                                if (!i.AreaIDs) return false; // Si no tiene área asignada, no se muestra
                                const assignedAreas = i.AreaIDs.split(',').map(s => s.trim());
                                return assignedAreas.includes(targetArea);
                            }).map(i => (
                                <option key={i.InsumoID} value={i.InsumoID}>
                                    {i.Nombre} ({i.CodigoReferencia || 'S/REF'})
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-zinc-400 mt-1">¿No encuentra el insumo? Contácte a Administración.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 mb-1">Metros por Bobina</label>
                            <input
                                type="number" step="0.01" min="1"
                                className="w-full border rounded p-2"
                                value={metros}
                                onChange={e => setMetros(e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 mb-1">Cantidad de Bobinas</label>
                            <input
                                type="number" min="1" max="100"
                                className="w-full border rounded p-2"
                                value={cantidad}
                                onChange={e => setCantidad(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1">Lote Proveedor (Opcional)</label>
                        <input
                            type="text"
                            className="w-full border rounded p-2 uppercase"
                            placeholder="Ej: LOTE-2023-XYZ"
                            value={loteProv}
                            onChange={e => setLoteProv(e.target.value)}
                        />
                    </div>

                    <div className="bg-blue-50 text-blue-800 text-sm p-3 rounded flex items-start gap-2">
                        <Printer className="w-4 h-4 mt-0.5 shrink-0" />
                        <p>Se generarán <strong>{cantidad}</strong> registros únicos. Podrá imprimir las etiquetas individuales desde el panel principal.</p>
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t">
                        <Button variant="outline" type="button" onClick={onClose}>Cancelar</Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Guardando...' : 'Confirmar Ingreso'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddStockModal;

