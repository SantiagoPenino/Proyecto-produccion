import React, { useState, useEffect } from 'react';
import { Loader2, Power, AlertCircle, RefreshCw } from 'lucide-react';
import http from '../../../services/apiClient';
import { toast } from 'sonner';

export default function ConfigSyncModal({ isOpen, onClose }) {
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(null);

    const loadConfigs = async () => {
        setLoading(true);
        try {
            const res = await http.get('/configuraciones');
            setConfigs(res.data);

        } catch (error) {
            console.error("Error cargando configuraciones:", error);
            toast.error("Error al cargar procesos de sincronización");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadConfigs();
        }
    }, [isOpen]);

    const handleToggle = async (procesoID, currentState) => {
        setToggling(procesoID);
        try {
            await http.post('/configuraciones/toggle', {
                ProcesoID: procesoID,
                Activo: !currentState
            });

            toast.success(`Sincronización ${!currentState ? 'Activada' : 'Desactivada'} correctamente.`);

            // Refrescar el estado de los toggles localmente
            setConfigs(prev => prev.map(c =>
                c.ProcesoID === procesoID ? { ...c, Activo: !currentState } : c
            ));
        } catch (error) {
            console.error("Error toggling:", error);
            toast.error("Error al cambiar estado del proceso");
        } finally {
            setToggling(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/60  p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-xl w-full max-w-3xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="bg-zinc-50 px-8 py-6 border-b border-zinc-100 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex justify-center items-center shadow-inner">
                            <RefreshCw className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-zinc-800 tracking-tight">Procesos de Sincronización</h2>
                            <p className="text-zinc-500 font-medium text-sm">Control centralizado de tareas automáticas</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-8 overflow-y-auto bg-zinc-50 flex-1">

                    <div className="mb-6 flex items-center gap-3 p-4 bg-blue-50/50 border border-blue-100 rounded-2xl text-blue-800 text-sm">
                        <AlertCircle className="w-5 h-5 text-blue-500 shrink-0" />
                        <p>Usa estos interruptores para encender o apagar componentes de sincronización sin tener que reiniciar el servidor.</p>
                    </div>

                    {loading ? (
                        <div className="flex justify-center items-center py-20 text-indigo-500">
                            <Loader2 className="w-10 h-10 animate-spin" />
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {configs.map(config => (
                                <div key={config.ID} className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm hover:shadow-md transition-shadow">
                                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h3 className="font-bold text-zinc-800 text-lg">{config.NombreProceso}</h3>
                                                <span className="text-[10px] uppercase font-black tracking-wider text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-md">
                                                    {config.ProcesoID}
                                                </span>
                                            </div>
                                            <p className="text-zinc-500 text-sm">{config.Descripcion}</p>

                                            {/* Estado de Última Ejecución */}
                                            <div className="mt-3 flex gap-4 text-xs font-semibold">
                                                <div className="flex items-center gap-1 text-zinc-500">
                                                    <span className="uppercase tracking-widest text-[9px]">Última Ejecución:</span>
                                                    {config.UltimaEjecucion ? new Date(config.UltimaEjecucion).toLocaleString() : 'Nunca'}
                                                </div>
                                                {config.UltimoEstado && (
                                                    <div className={`flex items-center gap-1 ${config.UltimoEstado === 'OK' ? 'text-green-600' : 'text-red-500'}`}>
                                                        <span className="uppercase tracking-widest text-[9px]">Estado:</span>
                                                        {config.UltimoEstado}
                                                    </div>
                                                )}
                                            </div>
                                            {config.UltimoEstado === 'ERROR' && config.MensajeError && (
                                                <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg break-all">
                                                    <span className="font-bold">Detalle Error:</span> {config.MensajeError}
                                                </div>
                                            )}
                                        </div>

                                        {/* Toggle Switch */}
                                        <div className="shrink-0 flex items-center">
                                            <button
                                                onClick={() => handleToggle(config.ProcesoID, config.Activo)}
                                                disabled={toggling === config.ProcesoID}
                                                className={`
                                                    relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                                                    ${config.Activo ? 'bg-indigo-500' : 'bg-zinc-300'}
                                                    ${toggling === config.ProcesoID ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-inner'}
                                                `}
                                            >
                                                <span className="sr-only">Toggle Process</span>

                                                {/* Icon Track */}
                                                <div className="absolute inset-0 flex justify-between px-3 self-center items-center pointer-events-none text-white font-bold text-[10px]">
                                                    <span>ON</span>
                                                    <span className="text-zinc-500">OFF</span>
                                                </div>

                                                <span
                                                    className={`
                                                        inline-block h-8 w-8 transform rounded-full bg-white transition-transform shadow-sm flex items-center justify-center relative z-10
                                                        ${config.Activo ? 'translate-x-11' : 'translate-x-1'}
                                                    `}
                                                >
                                                    {toggling === config.ProcesoID ? (
                                                        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                                                    ) : (
                                                        <Power className={`w-4 h-4 ${config.Activo ? 'text-indigo-500' : 'text-zinc-400'}`} />
                                                    )}
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* EXTRA PANEL ONLY FOR SHEETS SYNC */}
                                    {config.ProcesoID.startsWith('SYNC_PLANILLA_SHEETS') && (
                                        <ManualPlanillaControl
                                            procesoID={config.ProcesoID}
                                            onSuccess={loadConfigs}
                                        />
                                    )}
                                </div>
                            ))}

                            {configs.length === 0 && (
                                <div className="text-center py-10 text-zinc-400">
                                    No se encontraron procesos registrados.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Subcomponente para manejar el panel de Control Manual de Planilla por separado
function ManualPlanillaControl({ procesoID, onSuccess }) {
    let area = 'DF';
    let propName = 'UltimafilaDF';

    if (procesoID === 'SYNC_PLANILLA_SHEETS_SUB') {
        area = 'SB';
        propName = 'UltimafilaSB';
    } else if (procesoID === 'SYNC_PLANILLA_SHEETS_IMD') {
        area = 'IMD';
        propName = 'UltimafilaIMD';
    } else if (procesoID === 'SYNC_PLANILLA_SHEETS_TPU') {
        area = 'TPU';
        propName = 'UltimafilaTPU';
    } else if (procesoID === 'SYNC_PLANILLA_SHEETS_CENCO') {
        area = 'CENCO';
        propName = 'UltimafilaCENCO';
    }

    const [rowInput, setRowInput] = useState('');
    const [updatingRow, setUpdatingRow] = useState(false);
    const [currentRow, setCurrentRow] = useState(null);
    const [loadingRow, setLoadingRow] = useState(false);

    useEffect(() => {
        let mounted = true;
        const fetchCurrentRow = async () => {
            setLoadingRow(true);
            try {
                const res = await http.get(`/configuraciones/get-planilla-row?area=${area}`);
                if (mounted && res.data.success && res.data.currentRow) {
                    setCurrentRow(res.data.currentRow);
                    setRowInput(res.data.currentRow.toString());
                }
            } catch (error) {
                console.error("Error fetching current row for area", area, error);
            } finally {
                if (mounted) setLoadingRow(false);
            }
        };
        fetchCurrentRow();

        return () => { mounted = false; };
    }, [area]);

    const handleSetRow = async (e) => {
        e.preventDefault();
        if (!rowInput) {
            toast.warning("Ingresa un número de fila");
            return;
        }

        if (!confirm(`¿Estás seguro que deseas sobreescribir la propiedad de Apps Script y reanudar la lectura (${area}) desde la fila ${rowInput}?`)) {
            return;
        }

        setUpdatingRow(true);
        try {
            const res = await http.post('/configuraciones/set-planilla-row', {
                rowNumber: parseInt(rowInput, 10),
                area: area
            });
            toast.success(res.data.message || "Fila ajustada extosamente. Revisa el log de la terminal.");
            setCurrentRow(rowInput);
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error("Error setting row:", err);
            toast.error(err.response?.data?.error || "Error al aplicar fila remota");
        } finally {
            setUpdatingRow(false);
        }
    };

    return (
        <div className="mt-4 pt-4 border-t border-zinc-100 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-xs text-zinc-500">
                <strong className="text-zinc-700 block mb-1">Control Manual Restricto de Planilla</strong>
                Sobrescribe la propiedad global (<code>{propName}</code>) en Google Apps Script para forzar relectura desde un número específico de fila.
            </div>
            <div className="flex items-center gap-4 w-full md:w-auto">
                {loadingRow ? (
                    <span className="text-indigo-600 text-sm font-bold uppercase animate-pulse">Consultando a Google...</span>
                ) : (
                    <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono flex flex-col items-center justify-center px-4 py-2 rounded-xl shadow-inner min-w-[120px]">
                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-0.5">Valor Actual</span>
                        <span className="text-2xl font-black">{currentRow || '?'}</span>
                        {!currentRow && <span className="text-[9px] mt-1 text-red-400 text-center leading-tight">Agrega acción getRow<br />a tu Apps Script</span>}
                    </div>
                )}

                <form onSubmit={handleSetRow} className="flex gap-2 items-stretch">
                    <input
                        type="number"
                        min="1"
                        required
                        value={rowInput}
                        onChange={(e) => setRowInput(e.target.value)}
                        placeholder="Ej: 3743"
                        className="w-32 sm:w-40 px-4 py-3 border-2 border-indigo-200 rounded-xl text-lg bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono text-center flex-1 md:flex-none shadow-sm transition-all"
                    />
                    <button
                        type="submit"
                        disabled={updatingRow || loadingRow}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-300 transition-colors font-bold text-white text-sm px-6 rounded-xl whitespace-nowrap shadow-md hover:shadow-lg active:scale-95 flex items-center gap-2"
                    >
                        {updatingRow ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Enviando...
                            </>
                        ) : (
                            'Actualizar Planilla'
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}


