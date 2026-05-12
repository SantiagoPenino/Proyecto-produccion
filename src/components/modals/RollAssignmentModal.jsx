import React, { useState, useEffect, Fragment } from 'react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption, Transition } from '@headlessui/react';
import { Check, ChevronsUpDown, Layers, X, Plus, List, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ordersService, rollsService } from '../../services/api';

const RollAssignmentModal = ({ isOpen, onClose, selectedIds = [], selectedOrders = [], areaCode, onSuccess }) => {

    const navigate = useNavigate();

    const [mode, setMode] = useState('existing');
    const [rollName, setRollName] = useState('');
    const [selectedRoll, setSelectedRoll] = useState(null);
    const [activeRolls, setActiveRolls] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingRolls, setLoadingRolls] = useState(false);

    useEffect(() => {
        if (isOpen && areaCode) {
            setLoadingRolls(true);
            rollsService.getActiveRolls(areaCode)
                .then(data => {
                    const rollsList = Array.isArray(data) ? data : [];
                    setActiveRolls(rollsList);
                    if (rollsList.length > 0) setSelectedRoll(rollsList[0]);
                    else setMode('new');
                })
                .catch(err => console.error("Error loading rolls:", err))
                .finally(() => setLoadingRolls(false));

            setRollName(`Lote ${new Date().toLocaleDateString('es-ES').replace(/\//g, '')}-${new Date().getHours()}${new Date().getMinutes()}`);
        }
    }, [isOpen, areaCode]);

    const handleAssign = async () => {
        if (mode === 'existing' && !selectedRoll) return alert("Selecciona un rollo existente");
        if (mode === 'new' && !rollName.trim()) return alert("Ingresa un nombre para el nuevo lote");

        setLoading(true);
        try {
            const payload = {
                orderIds: selectedIds,
                rollId: mode === 'existing' ? selectedRoll?.id : null,
                rollName: mode === 'new' ? rollName : null,
                isNew: mode === 'new',
                areaCode,
                capacity: 100
            };
            await ordersService.assignRoll(payload);
            if (onSuccess) onSuccess();
            onClose();
            // Navegar a la tab de planeación del área actual
            navigate(`/area/${areaCode.toLowerCase()}/planeacion`);
        } catch (error) {
            console.error(error);
            alert("Error al asignar rollo: " + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const count = selectedIds.length;
    const orderLabel = count === 1 ? 'orden' : 'órdenes';

    return (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 border border-zinc-200">

                {/* HEADER */}
                <div className="px-6 py-5 flex justify-between items-center border-b border-zinc-100">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center">
                            <Layers size={18} className="text-brand-cyan" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-zinc-800 leading-none">Asignar a Lote</h3>
                            <span className="text-[11px] text-zinc-400 font-medium">Producción / {areaCode}</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-brand-magenta/10 hover:text-brand-magenta transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* CONTENT */}
                <div className="p-6 flex flex-col gap-5">

                    {/* Info banner */}
                    <div className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl px-4 py-3 flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-brand-cyan/10 flex items-center justify-center shrink-0">
                            <List size={14} className="text-brand-cyan" />
                        </div>
                        <p className="text-sm text-zinc-700">
                            <span className="font-bold text-brand-cyan">{count} {orderLabel}</span> seleccionada{count === 1 ? '' : 's'}.
                        </p>
                    </div>


                    {/* Mode toggle */}
                    <div className="flex gap-1.5 p-1 bg-zinc-100 rounded-xl">
                        <button
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                mode === 'existing'
                                    ? 'bg-white text-brand-cyan shadow-sm border border-zinc-200'
                                    : 'text-zinc-500 hover:text-zinc-700'
                            }`}
                            onClick={() => setMode('existing')}
                            disabled={activeRolls.length === 0}
                        >
                            <Layers size={13} />
                            Existente {activeRolls.length > 0 && `(${activeRolls.length})`}
                        </button>
                        <button
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                mode === 'new'
                                    ? 'bg-white text-brand-cyan shadow-sm border border-zinc-200'
                                    : 'text-zinc-500 hover:text-zinc-700'
                            }`}
                            onClick={() => setMode('new')}
                        >
                            <Plus size={13} />
                            Crear Nuevo
                        </button>
                    </div>

                    {/* Input area */}
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                            {mode === 'new' ? 'Nombre del Nuevo Lote' : 'Seleccionar Lote'}
                        </label>

                        {mode === 'new' ? (
                            <div>
                                <input
                                    type="text"
                                    className="w-full px-4 py-2.5 border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 bg-white outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10 transition-all placeholder:text-zinc-300"
                                    value={rollName}
                                    onChange={(e) => setRollName(e.target.value)}
                                    placeholder="Nombre del Lote"
                                    autoFocus
                                />
                                <p className="text-[10px] text-zinc-400 mt-1.5 italic px-1">El ID se generará automáticamente.</p>
                            </div>
                        ) : loadingRolls ? (
                            <div className="flex items-center gap-2 px-4 py-3 border border-zinc-200 rounded-xl text-sm text-zinc-400">
                                <Loader2 size={14} className="animate-spin" />
                                Cargando lotes...
                            </div>
                        ) : activeRolls.length === 0 ? (
                            <p className="text-xs text-red-500 px-1">No hay lotes activos. Crea uno nuevo.</p>
                        ) : (
                            <Listbox value={selectedRoll} onChange={setSelectedRoll}>
                                <div className="relative">
                                    <ListboxButton className="w-full px-4 py-2.5 border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 bg-white text-left flex items-center justify-between gap-2 hover:border-brand-cyan/40 focus:outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10 transition-all cursor-pointer">
                                        <span className="truncate">{selectedRoll?.nombre || 'Seleccionar...'}</span>
                                        <ChevronsUpDown size={14} className="text-zinc-400 shrink-0" />
                                    </ListboxButton>
                                    <Transition
                                        as={Fragment}
                                        leave="transition ease-in duration-100"
                                        leaveFrom="opacity-100"
                                        leaveTo="opacity-0"
                                    >
                                        <ListboxOptions className="absolute z-50 mt-1.5 w-full bg-white border border-zinc-200 rounded-xl shadow-xl overflow-hidden focus:outline-none">
                                            <div className="max-h-52 overflow-y-auto p-1">
                                                {activeRolls.map(r => (
                                                    <ListboxOption
                                                        key={r.id}
                                                        value={r}
                                                        className={({ active, selected }) =>
                                                            `flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors ${
                                                                selected
                                                                    ? 'bg-brand-cyan/10 text-brand-cyan font-bold'
                                                                    : active
                                                                    ? 'bg-zinc-50 text-zinc-800 font-medium'
                                                                    : 'text-zinc-700 font-medium'
                                                            }`
                                                        }
                                                    >
                                                        {({ selected }) => (
                                                            <>
                                                                <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-brand-cyan border-brand-cyan' : 'border-zinc-300'}`}>
                                                                    {selected && <Check size={10} className="text-white" strokeWidth={3} />}
                                                                </div>
                                                                <span className="truncate">{r.nombre}{r.material ? ` · ${r.material}` : ''}</span>
                                                            </>
                                                        )}
                                                    </ListboxOption>
                                                ))}
                                            </div>
                                        </ListboxOptions>
                                    </Transition>
                                </div>
                            </Listbox>
                        )}
                    </div>
                </div>

                {/* FOOTER */}
                <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-end items-center gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800 font-semibold transition-colors rounded-lg hover:bg-zinc-100"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleAssign}
                        disabled={loading || (mode === 'new' && !rollName.trim())}
                        className="px-5 py-2.5 bg-brand-cyan hover:bg-[#0099d4] text-white text-sm font-bold rounded-xl shadow-lg shadow-brand-cyan/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading
                            ? <><Loader2 size={14} className="animate-spin" /> Procesando...</>
                            : <><Check size={14} strokeWidth={3} /> Asignar</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RollAssignmentModal;
