import React, { useState, useEffect } from 'react';
import { machineControlService } from '../../services/api';
import { useQuery } from '@tanstack/react-query';

const SlotActionModal = ({ isOpen, onClose, slot, machineId, onSuccess }) => {
    // Definir estos helpers al inicio para usarlos en el hook
    const isMount = isOpen && slot && !slot.BobinaMontadaID && slot.Tipo === 'BOBINA';
    const isUnmount = isOpen && slot && slot.BobinaMontadaID && slot.Tipo === 'BOBINA';
    const isRefill = isOpen && slot && slot.Tipo === 'CONSUMIBLE';

    const [formData, setFormData] = useState({ bobinaId: '', cantidad: '', comment: '' });
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    // Reset form on open
    useEffect(() => {
        if (isOpen) {
            setFormData({ bobinaId: '', cantidad: '', comment: '' });
            setSearchTerm('');
        }
    }, [isOpen]);

    // Fetch suggesions only if mounting
    const { data: availableBobbins, isLoading: loadingBobbins } = useQuery({
        queryKey: ['availableBobbins', machineId],
        queryFn: () => machineControlService.getAvailableBobbins(machineId),
        enabled: !!(isOpen && isMount),
        staleTime: 1000 * 30 // 30s
    });

    if (!isOpen || !slot) return null;

    const filteredBobbins = availableBobbins?.filter(b =>
        !searchTerm ||
        b.Material.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.CodigoEtiqueta.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            let action = '';
            // Copiamos formData base
            const payload = { ...formData }; // BobinaId ya debería estar seteado si seleccionaron o escanearon

            if (isMount) action = 'MOUNT';
            if (isUnmount) {
                action = 'UNMOUNT';
                // Para Desmontar, a veces piden estado final, aquí lo simplificamos a 'Disponible' por defecto o agregamos input extra si se requiere
            }
            if (isRefill) action = 'REFILL';

            await machineControlService.executeAction(machineId, slot.SlotID, {
                action,
                ...payload
            });

            // alert('Acción realizada con éxito'); // Feedback visual es mejor con toast, pero mantenemos simple
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            alert('Error: ' + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[1400] animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border-t-4 border-blue-500">
                <div className="px-6 py-4 bg-zinc-50 border-b flex justify-between items-center">
                    <h3 className="font-bold text-zinc-700 flex items-center gap-2">
                        {isMount && <><i className="fa-solid fa-tape"></i> Montar Bobina</>}
                        {isUnmount && <><i className="fa-solid fa-eject"></i> Desmontar Bobina</>}
                        {isRefill && <><i className="fa-solid fa-fill-drip"></i> Recargar Insumo</>}
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded hover:bg-zinc-200 flex items-center justify-center text-zinc-400 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">

                    {/* INFO SLOT */}
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-800 font-bold flex items-center gap-2 shadow-sm">
                        <i className="fa-solid fa-circle-info text-blue-500"></i>
                        {slot.Nombre}
                    </div>

                    {isMount && (
                        <div>
                            <label className="text-xs font-bold text-zinc-500 uppercase flex justify-between mb-1">
                                Seleccionar Bobina
                                <span className="text-[10px] bg-zinc-100 px-2 rounded-full text-zinc-400">Escáner o Lista</span>
                            </label>

                            {/* Buscador / Escanear */}
                            <div className="relative mb-3">
                                <i className="fa-solid fa-magnifying-glass absolute left-3 top-3 text-zinc-400"></i>
                                <input
                                    type="text"
                                    className="w-full pl-9 pr-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-zinc-300 font-bold text-zinc-700"
                                    placeholder="Escanear etiqueta o buscar..."
                                    value={formData.bobinaId || searchTerm} // Muestra ID seleccionado o termino de busqueda
                                    onChange={e => {
                                        setSearchTerm(e.target.value);
                                        setFormData({ ...formData, bobinaId: e.target.value });
                                    }}
                                    autoFocus
                                />
                            </div>

                            {/* Lista de Sugerencias */}
                            <div className="border border-zinc-200 rounded-lg bg-zinc-50 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300">
                                {loadingBobbins ? (
                                    <div className="p-4 text-center text-xs text-zinc-400 animate-pulse">Cargando inventario...</div>
                                ) : filteredBobbins.length === 0 ? (
                                    <div className="p-4 text-center text-xs text-zinc-400 italic">No se encontraron bobinas disponibles.</div>
                                ) : (
                                    <div className="divide-y divide-zinc-200">
                                        {filteredBobbins.map(b => (
                                            <div
                                                key={b.BobinaID}
                                                onClick={() => {
                                                    setFormData({ ...formData, bobinaId: b.CodigoEtiqueta });
                                                    setSearchTerm(''); // Limpiar busqueda visual para mostrar seleccion clara si se desea, o dejar
                                                }}
                                                className={`p-3 cursor-pointer hover:bg-blue-50 transition-colors group flex justify-between items-center ${formData.bobinaId === b.CodigoEtiqueta ? 'bg-blue-100 ring-1 ring-blue-500 inset-0' : ''}`}
                                            >
                                                <div>
                                                    <div className="font-bold text-xs text-zinc-700 group-hover:text-blue-700">{b.Material}</div>
                                                    <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                                                        <i className="fa-solid fa-barcode text-zinc-300 mr-1"></i>
                                                        {b.CodigoEtiqueta}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-bold text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                                                        {b.MetrosRestantes}m
                                                    </div>
                                                    <div className="text-[9px] text-zinc-400 mt-0.5">{new Date(b.FechaIngreso).toLocaleDateString()}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {isUnmount && (
                        <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800">
                            <h4 className="font-bold flex items-center gap-2 mb-2">
                                <i className="fa-solid fa-triangle-exclamation"></i> Confirmar Desmontaje
                            </h4>
                            <p className="opacity-90 leading-relaxed text-xs">
                                Vas a desmontar la bobina <b>{slot.CodigoEtiqueta || slot.BobinaMontadaID} ({slot.NombreInsumoMontado})</b>.
                                <br />Quedará marcada como <strong>Disponible</strong> con su metraje actual.
                            </p>
                        </div>
                    )}

                    {isRefill && (
                        <div>
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Cantidad Recargada</label>
                            <div className="flex gap-2 relative">
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full border border-zinc-300 rounded-lg p-3 pl-4 text-lg font-bold text-zinc-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    placeholder="0.00"
                                    value={formData.cantidad}
                                    onChange={e => setFormData({ ...formData, cantidad: e.target.value })}
                                    required
                                />
                                <div className="absolute right-3 top-3 text-zinc-400 font-bold text-sm pointer-events-none">Litros</div>
                            </div>
                        </div>
                    )}

                    {/* Comentario y Botones - Common */}
                    <hr className="border-zinc-100" />

                    <div className="flex justify-end gap-3 pt-2">
                        <button type="button" onClick={onClose} className="px-5 py-2.5 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg font-bold text-sm transition-colors">Cancelar</button>
                        <button
                            type="submit"
                            disabled={loading || (isMount && !formData.bobinaId) || (isRefill && !formData.cantidad)}
                            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold text-sm shadow-lg shadow-blue-500/30 hover:bg-blue-700 hover:translate-y-px active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                        >
                            {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <><i className="fa-solid fa-check"></i> Confirmar</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SlotActionModal;


