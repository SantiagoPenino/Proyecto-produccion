import React, { useState } from 'react';
import { Button } from '../../ui/Button';
import { inventoryService } from '../../../services/modules/inventoryService';
import { toast } from 'sonner';

const CloseBobinaModal = ({ bobina, insumoName, onClose, onSuccess }) => {
    const [metrosFinales, setMetrosFinales] = useState(0);
    const [motivo, setMotivo] = useState('Fin de Bobina');
    const [loading, setLoading] = useState(false);
    const [calculatedWaste, setCalculatedWaste] = useState(null);
    const [finish, setFinish] = useState(true);

    const handleCalculate = () => {
        const waste = bobina.MetrosRestantes - metrosFinales;
        setCalculatedWaste(waste >= 0 ? waste : 0);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await inventoryService.closeBobina({
                bobinaId: bobina.BobinaID,
                metrosFinales: parseFloat(metrosFinales || 0),
                motivo,
                finish
            });

            if (res.success) {
                toast.success(`Bobina cerrada. Desecho ajustado.`);
                onSuccess();
                onClose();
            } else {
                toast.error(res.message || "Error al cerrar bobina");
            }
        } catch (error) {
            console.error(error);
            toast.error("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                <h2 className="text-xl font-bold text-zinc-800 mb-2">Cerrar Bobina</h2>

                <div className="bg-blue-50 p-4 rounded mb-4">
                    <p className="text-sm font-semibold text-blue-800">{insumoName}</p>
                    <p className="text-xs text-blue-600 font-mono mt-1">Lote: {bobina.CodigoEtiqueta}</p>
                    <p className="text-sm text-blue-700 mt-2">Restante Sistema: <strong>{bobina.MetrosRestantes} m</strong></p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Metros Reales Sobrantes</label>
                        <input
                            type="number"
                            step="0.01"
                            className="w-full border rounded p-2"
                            value={metrosFinales}
                            onChange={(e) => {
                                setMetrosFinales(e.target.value);
                                setCalculatedWaste(null);
                            }}
                            onBlur={handleCalculate}
                            required
                        />
                        <p className="text-xs text-zinc-500 mt-1">Mida lo que queda físicamente en el rollo.</p>
                    </div>

                    {calculatedWaste !== null && (
                        <div className={`text-sm p-2 rounded ${calculatedWaste > 0 ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                            Desecho (Merma): <strong>{calculatedWaste.toFixed(2)} m</strong>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-1">Motivo de Cierre</label>
                        <select
                            className="w-full border rounded p-2"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                        >
                            <option value="Fin de Bobina">Fin de Bobina (Terminada)</option>
                            <option value="Deterioro">Deterioro / Daño</option>
                            <option value="Cambio de Lote">Cambio de Lote</option>
                            <option value="Inventario">Ajuste de Inventario</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2 pt-2 bg-zinc-50 p-2 rounded border border-zinc-100">
                        <input
                            type="checkbox"
                            id="finishCheck"
                            checked={finish}
                            onChange={(e) => setFinish(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                        />
                        <label htmlFor="finishCheck" className="text-sm text-zinc-700 font-medium select-none cursor-pointer">
                            Dar de baja (Sacar de Inventario Activo)
                        </label>
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
                        <Button type="submit" disabled={loading} className="bg-red-600 hover:bg-red-700 text-white">
                            {loading ? 'Procesando...' : 'Confirmar'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CloseBobinaModal;

