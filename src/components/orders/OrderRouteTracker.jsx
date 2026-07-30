import React, { useEffect } from 'react';

/**
 * OrderRouteTracker Component - DEBUG VERSION & DATA FIX
 */
const OrderRouteTracker = ({ steps = [], title = "Hoja de Ruta (Flujo de Áreas)" }) => {

    // DEBUG: Ver qué datos llegan realmente
    useEffect(() => {
        if (steps && steps.length > 0) {
            console.log("OrderRouteTracker received steps:", steps);
        }
    }, [steps]);

    // 1. DATA PREPARATION & MAPPING ROBUSTNESS
    const rawSteps = Array.isArray(steps) ? [...steps] : [];

    // Ensure Deposito Logic Deleted - Now handled by Backend


    // HELPER: Extraer nombre de cualquier campo posible
    const getAreaName = (s) => {
        if (!s) return '???';
        // Probar todas las variaciones posibles de mayus/minusculas que vengan del SQL
        return s.Nombre || s.nombre || s.AreaNombre || s.AreaID || s.area || s.id || '???';
    };

    // HELPER: Extraer estado
    const getStatus = (s) => {
        if (!s) return 'Pendiente';
        return s.Estado || s.estado || s.status || 'Pendiente';
    };

    // HELPER: Extraer Detalle
    const getDetail = (s) => s.EstadoenArea || s.estadoenArea || s.estadoArea || '-';

    // LO VISUAL DE SIEMPRE
    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col gap-6 w-full">

            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <i className="fa-solid fa-timeline text-blue-600"></i>
                    {title}
                </h3>
            </div>

            <div className="overflow-x-auto pb-6 pt-2">
                <div className="flex items-start justify-center min-w-max px-4 mx-auto gap-0">
                    {rawSteps.map((step, idx) => {
                        const areaName = getAreaName(step).toUpperCase();
                        const statusRaw = getStatus(step);
                        const status = statusRaw.toUpperCase();
                        const detail = getDetail(step);
                        const logistic = step.EstadoLogistica || step.estadoLogistica || '-';

                        // LOGICA SIMPLE DE COLOR
                        let type = 'PENDING';
                        if (status.includes('PRONTO') || status.includes('FINALIZADO') || status.includes('COMPLETADO')) type = 'FINISHED';
                        else if (status.includes('CANCEL')) type = 'CANCELLED';
                        else if (status.startsWith('PENDIENTE') || status === '') type = 'PENDING'; // "PENDIENTE", "PENDIENTE A RECIBIR", etc.
                        else type = 'ACTIVE'; // Si no es pendiente ni vacio -> Activo

                        // Asignar Clases
                        let circleClass = "bg-white border-2 border-slate-200 text-slate-300";
                        let icon = "fa-circle";
                        let textClass = "text-slate-400";
                        let borderClass = "border-slate-100";
                        let connectorClass = "bg-slate-200";

                        if (type === 'FINISHED') {
                            circleClass = "bg-teal-500 border-teal-500 text-white shadow-sm";
                            icon = "fa-check";
                            textClass = "text-teal-700 font-bold";
                            borderClass = "border-teal-100 bg-teal-50";
                            connectorClass = "bg-teal-400";
                        } else if (type === 'ACTIVE') {
                            circleClass = "bg-white border-4 border-amber-400 text-amber-500 font-bold scale-110 shadow-lg z-10";
                            icon = "fa-gear fa-spin";
                            textClass = "text-amber-700 font-black";
                            borderClass = "border-amber-200 bg-amber-50";
                            connectorClass = "bg-slate-200";
                        } else if (type === 'CANCELLED') {
                            circleClass = "bg-red-500 text-white border-red-500";
                            icon = "fa-ban";
                            textClass = "text-red-600 font-bold";
                            borderClass = "border-red-100 bg-red-50";
                        }

                        return (
                            <div key={idx} className="flex flex-col items-center relative flex-1 min-w-[140px] group">

                                {/* LINEA */}
                                {idx < rawSteps.length - 1 && (
                                    <div className={`absolute top-7 left-1/2 w-full h-1 -translate-y-1/2 -z-10 ${connectorClass}`}></div>
                                )}

                                {/* CIRCULO */}
                                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all box-content ${circleClass}`}>
                                    <i className={`fa-solid ${icon} ${type === 'PENDING' ? 'text-[8px]' : ''}`}></i>
                                </div>

                                {/* TEXTOS */}
                                <div className="mt-3 flex flex-col items-center gap-1 w-full px-1 text-center">
                                    <div className={`text-xs uppercase tracking-tight leading-tight mb-1 h-6 flex items-end ${textClass}`}>{areaName}</div>

                                    <div className={`w-full rounded border p-1 ${borderClass}`}>
                                        <div className="text-[10px] font-bold uppercase truncate">{statusRaw}</div>
                                        {detail !== '-' && <div className="text-[9px] text-slate-500 truncate border-t border-black/5 mt-0.5 pt-0.5">{detail}</div>}
                                        {logistic !== '-' && <div className="text-[9px] text-blue-600 font-bold truncate pt-0.5"><i className="fa-solid fa-truck text-[8px] mr-1"></i>{logistic}</div>}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default OrderRouteTracker;
