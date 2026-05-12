import React, { useState, useEffect } from 'react';
import { insumosService } from '../../services/api';

const FabricAssignmentModal = ({ isOpen, onClose, materialName, orderId, onAssign }) => {
    const [bobbins, setBobbins] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedBobbin, setSelectedBobbin] = useState(null);

    // Load Inventory when Open
    useEffect(() => {
        if (isOpen && materialName) {
            loadBobbins();
        }
    }, [isOpen, materialName]);

    const loadBobbins = async () => {
        setLoading(true);
        try {
            // Fetch Inventory (reuse general inventory fetch or specific)
            // Assuming 'SUBLIMACION' or 'GENERAL' area code. 
            // Better to fetch ALL inventory and filter by name.
            // Or use a search endpoint if available.
            // For now, let's assume we can search by name or Area='SUB'

            // Note: insumosService.getInventoryByArea might be heavy.
            // Let's assume we filter client-side for now or use fuzzy search.
            const allInsumos = await insumosService.getInventoryByArea('SUBLIMACION'); // Or 'SUB'

            // Filter by Material Name (Fuzzy)
            const target = materialName.toLowerCase().trim();

            const matchedInsumos = allInsumos.filter(i =>
                i.Nombre.toLowerCase().includes(target) || target.includes(i.Nombre.toLowerCase())
            );

            // Extract Bobbins
            let availableBobbins = [];
            matchedInsumos.forEach(insumo => {
                if (insumo.ActiveBatches) {
                    insumo.ActiveBatches.forEach(batch => {
                        if (batch.MetrosRestantes > 0 && (batch.Estado === 'Disponible' || batch.Estado === 'En Uso')) {
                            availableBobbins.push({
                                ...batch,
                                MaterialName: insumo.Nombre
                            });
                        }
                    });
                }
            });

            // Sort by Date (FIFO)
            availableBobbins.sort((a, b) => new Date(a.FechaIngreso) - new Date(b.FechaIngreso));
            setBobbins(availableBobbins);

        } catch (e) {
            console.error("Error loading fabric bobbins:", e);
        } finally {
            setLoading(false);
        }
    };

    const handleConfirm = () => {
        if (!selectedBobbin) return alert("Selecciona una bobina");
        onAssign(selectedBobbin.BobinaID);
    };

    if (!isOpen) return null;

    const filteredBobbins = bobbins.filter(b =>
        b.Codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.BobinaID.toString().includes(searchTerm)
    );

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border-2 border-indigo-500 animate-in zoom-in-95 duration-200">

                {/* Header Warning */}
                <div className="bg-indigo-600 p-4 text-white">
                    <div className="flex items-center gap-3 mb-1">
                        <i className="fa-solid fa-triangle-exclamation text-yellow-300 text-xl animate-pulse"></i>
                        <h2 className="text-lg font-black uppercase tracking-wider">Cambio de Material</h2>
                    </div>
                    <p className="text-indigo-100 text-sm">
                        La siguiente orden requiere: <br />
                        <span className="font-black text-white text-lg bg-indigo-500/50 px-2 rounded mt-1 inline-block">
                            {materialName}
                        </span>
                    </p>
                </div>

                <div className="p-6">
                    <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                        Escanea o Selecciona la Bobina de Tela
                    </label>

                    {/* Search Input (Autofocus for scanner) */}
                    <div className="relative mb-4">
                        <i className="fa-solid fa-barcode absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"></i>
                        <input
                            autoFocus
                            type="text"
                            placeholder="Escanear Etiqueta..."
                            className="w-full pl-10 pr-4 py-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl outline-none focus:border-indigo-500 font-mono text-lg font-bold text-zinc-700"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && filteredBobbins.length > 0) {
                                    setSelectedBobbin(filteredBobbins[0]);
                                }
                            }}
                        />
                    </div>

                    {/* Bobbin List */}
                    <div className="max-h-[200px] overflow-y-auto custom-scrollbar border border-zinc-100 rounded-xl mb-4">
                        {loading ? (
                            <div className="p-4 text-center text-zinc-400">
                                <i className="fa-solid fa-circle-notch fa-spin mr-2"></i> Buscando inventario...
                            </div>
                        ) : filteredBobbins.length === 0 ? (
                            <div className="p-4 text-center text-zinc-400 italic bg-zinc-50">
                                No se encontraron bobinas compatibles.
                            </div>
                        ) : (
                            <div className="divide-y divide-zinc-50">
                                {filteredBobbins.map(b => (
                                    <div
                                        key={b.BobinaID}
                                        onClick={() => setSelectedBobbin(b)}
                                        className={`p-3 cursor-pointer transition-colors flex justify-between items-center
                                            ${selectedBobbin?.BobinaID === b.BobinaID ? 'bg-indigo-50 border-l-4 border-indigo-500' : 'hover:bg-zinc-50 border-l-4 border-transparent'}
                                        `}
                                    >
                                        <div>
                                            <div className="font-bold text-zinc-700 text-sm">Bobina #{b.BobinaID}</div>
                                            <div className="text-[10px] text-zinc-500">{b.Codigo}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-mono font-bold text-indigo-600">{b.MetrosRestantes}m</div>
                                            <div className="text-[9px] text-zinc-400 uppercase">Disponible</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleConfirm}
                        disabled={!selectedBobbin}
                        className={`w-full py-3 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2
                            ${selectedBobbin ? 'bg-indigo-600 hover:bg-indigo-700 hover:scale-[1.02]' : 'bg-zinc-300 cursor-not-allowed'}
                        `}
                    >
                        <i className="fa-solid fa-check-circle"></i> Confirmar Asignación
                    </button>

                    <button
                        onClick={onClose}
                        className="w-full mt-3 py-2 text-zinc-400 font-bold text-xs hover:text-zinc-600"
                    >
                        Cancelar (Saltar Asignación)
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FabricAssignmentModal;


