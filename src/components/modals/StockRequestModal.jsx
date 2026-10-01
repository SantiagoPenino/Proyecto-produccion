import React, { useState, useEffect, useCallback } from 'react';
import { Boxes, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../services/api';
import PedirInsumos from '../stock/PedirInsumos';

// Pedido de insumos desde el tablero de un área. Desde el 29/09 es el mismo "Pedir insumos" de Mi
// Sector (/stock): pide con el sector del stock que el área tiene asignado (Areas.WmsDepId) y el
// pedido llega a Órdenes solicitadas, donde Logística lo despacha con remito. Antes guardaba en
// dbo.Solicitudes, una tabla que no existía: el botón nunca funcionó.
const StockRequestModal = ({ isOpen, onClose, areaName, areaCode }) => {
    const [estado, setEstado] = useState(null);       // respuesta de /area-deposito
    const [cargando, setCargando] = useState(false);
    const [depositos, setDepositos] = useState([]);
    const [asignando, setAsignando] = useState(null); // DepId que se está guardando

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const r = await api.get(`/wms-interno/area-deposito?area=${encodeURIComponent(areaCode || '')}`);
            setEstado(r.data);
            if (!r.data?.data && r.data?.puedeAsignar) {
                const d = await api.get('/wms-interno/depositos');
                // El central no pide insumos: es de donde salen
                setDepositos((d.data?.data || []).filter(x => x.Activo !== false && String(x.Tipo || '').trim().toLowerCase() !== 'central'));
            }
        } catch (e) { setEstado({ error: true }); }
        finally { setCargando(false); }
    }, [areaCode]);

    useEffect(() => {
        if (!isOpen) return;
        setEstado(null);
        if (areaCode) cargar();
    }, [isOpen, areaCode, cargar]);

    const asignar = async (dep) => {
        setAsignando(dep.DepId);
        try {
            await api.put('/wms-interno/area-deposito', { area: areaCode, depId: dep.DepId });
            toast.success(`Esta área pide insumos como ${dep.Nombre}`);
            await cargar();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo asignar el sector'); }
        finally { setAsignando(null); }
    };

    if (!isOpen) return null;

    const sector = estado?.data;
    const nombreArea = areaName || estado?.area || areaCode;

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-zinc-900/60 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

                <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex justify-between items-start gap-4 shrink-0">
                    <div>
                        <h2 className="text-lg font-bold text-amber-900 flex items-center gap-2">
                            <Boxes size={20} className="text-amber-600" /> Insumos: {nombreArea}
                        </h2>
                        {sector && (
                            <p className="text-xs text-amber-900/70 mt-1">
                                Pide como <b>{sector.deposito}</b>. El pedido llega a Logística, que lo despacha con remito.
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-amber-800/60 hover:bg-amber-100 hover:text-amber-800 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-white">
                    {cargando && !estado ? (
                        <div className="flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
                    ) : estado?.error ? (
                        <p className="text-sm text-rose-600 text-center py-8">No se pudo cargar el sector de esta área. Probá de nuevo en un rato.</p>
                    ) : estado?.falta ? (
                        <p className="text-sm text-slate-500 text-center py-8">
                            Pedir insumos desde el área todavía no está habilitado: falta correr el script de sectores
                            (<span className="font-mono text-xs">areas_sector_stock_2026-09-29.sql</span>).
                        </p>
                    ) : sector ? (
                        <PedirInsumos key={sector.depId} dep={sector.depId} compacto />
                    ) : estado?.puedeAsignar ? (
                        <div>
                            <p className="text-sm font-black text-slate-700">Esta área todavía no tiene un sector del stock</p>
                            <p className="text-xs text-slate-500 mt-1 mb-4">Elegí con qué sector pide insumos. Queda guardado para el área.</p>
                            <div className="flex flex-wrap gap-2">
                                {depositos.map(d => (
                                    <button key={d.DepId} type="button" disabled={!!asignando} onClick={() => asignar(d)}
                                        className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50 text-sm font-bold text-slate-700 disabled:opacity-50 flex items-center gap-2">
                                        {asignando === d.DepId && <Loader2 size={14} className="animate-spin" />} {d.Nombre}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : estado ? (
                        <p className="text-sm text-slate-500 text-center py-8">
                            Esta área todavía no tiene un sector del stock para pedir insumos. Pedile a un administrador que se lo asigne.
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default StockRequestModal;
