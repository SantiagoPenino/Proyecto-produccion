import React from 'react';
import { Check, Settings, Circle, Ban, AlertTriangle, Trash2 } from 'lucide-react';

/**
 * ProcessStepper Component
 * A reusable horizontal stepper for tracking process flow.
 * 
 * @param {Array} steps - Array of step objects: { id, label, status, subLabel, isDeletable, data }
 * @param {Function} onDelete - Callback for delete action: (id, data) => void
 */
export const ProcessStepper = ({ steps = [], onDelete }) => {
    return (
        <div className="w-full overflow-x-auto pb-4">
            <div className="flex items-start min-w-max gap-0 relative px-4">
                {steps.map((step, idx) => {
                    const isLast = idx === steps.length - 1;

                    // Determine styles based on status
                    let circleClass = "bg-white border-2 border-zinc-200 text-zinc-300";
                    let icon = <Circle size={10} />;
                    let lineColor = "bg-zinc-200";
                    let labelClass = "text-zinc-400";
                    let cardClass = "bg-zinc-50 border-zinc-100 opacity-60";

                    if (step.status === 'COMPLETED') {
                        circleClass = "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-200/50";
                        icon = <Check size={18} strokeWidth={3} />;
                        lineColor = "bg-emerald-500";
                        labelClass = "text-emerald-700 font-bold";
                        cardClass = "bg-emerald-50 border-emerald-100";
                    } else if (step.status === 'ACTIVE') {
                        circleClass = "bg-white border-4 border-amber-400 text-amber-500 shadow-xl shadow-amber-100 scale-110 z-10";
                        icon = <Settings size={18} className="animate-spin-slow" />;
                        lineColor = "bg-zinc-200"; // Future steps are not active yet
                        labelClass = "text-amber-700 font-black";
                        cardClass = "bg-amber-50 border-amber-100";
                    } else if (step.status === 'ERROR') {
                        circleClass = "bg-rose-50 border-2 border-rose-200 text-rose-500 animate-pulse";
                        icon = <AlertTriangle size={18} />;
                        lineColor = "bg-rose-200";
                        labelClass = "text-rose-500 font-bold";
                        cardClass = "bg-rose-50 border-rose-100";
                    } else if (step.status === 'CANCELLED') {
                        circleClass = "bg-zinc-100 border-2 border-zinc-300 text-zinc-400";
                        icon = <Ban size={18} />;
                        lineColor = "bg-zinc-200";
                        labelClass = "text-zinc-400 line-through";
                        cardClass = "bg-zinc-100 border-zinc-200 opacity-50";
                    }

                    return (
                        <div key={step.id || idx} className="flex flex-col items-center relative flex-1 min-w-[120px] group">

                            {/* Connecting Line */}
                            {!isLast && (
                                <div className="absolute top-5 left-1/2 w-full h-1 -translate-y-1/2 -z-0 bg-zinc-100 overflow-hidden">
                                    <div className={`h-full w-full transition-all duration-500 ${step.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-transparent'}`}></div>
                                </div>
                            )}

                            {/* Status Circle */}
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 z-10 ${circleClass}`}>
                                {icon}
                            </div>

                            {/* Label & Details */}
                            <div className="mt-3 text-center w-full px-1">
                                <div className={`text-sm uppercase tracking-tight mb-2 ${labelClass}`}>
                                    {step.label}
                                </div>

                                {/* Detail Card */}
                                <div className={`relative rounded-lg border p-2 text-center transition-all ${cardClass}`}>

                                    {/* Action Button (Delete) */}
                                    {step.isDeletable && onDelete && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDelete(step.id, step.data);
                                            }}
                                            className="absolute -top-2 -right-2 bg-white text-zinc-400 hover:text-rose-500 hover:bg-rose-50 border border-zinc-200 p-1 rounded-full shadow-sm transition-all z-20"
                                            title="Eliminar / Cancelar"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    )}

                                    <div className="text-[10px] font-bold uppercase truncate text-zinc-600">
                                        {step.subLabel}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
