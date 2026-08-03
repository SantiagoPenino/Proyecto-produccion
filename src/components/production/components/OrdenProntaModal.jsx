import React from 'react';

// Modal "¡ORDEN PRONTA!" — mismo diseño que usa el área de Impresión (FilePrintControl) al
// finalizar una orden, reutilizado en las áreas sin lotes (Bordado/Estampado/Corte/Costura
// vía EmbBandeja, y Terminaciones vía EcoUvFinishing) para que la confirmación se vea y se
// comporte igual en todas.
//
// data: null = modal cerrado. Si no, alguno de estos dos modos:
//   - { mensajeEspera } — la orden se aprobó pero todavía no generó bulto propio (ej. queda
//     esperando a una hermana de Estampado). No muestra Destino/Próximo servicio ni el botón
//     de imprimir.
//   - { ordenId, destino, proximoServicio, faltantesPedido?, ordenesLiberadas? } — bulto
//     generado, listo para imprimir etiqueta.
const OrdenProntaModal = ({ data, onImprimir, onClose }) => {
    if (!data) return null;
    const { destino, proximoServicio, faltantesPedido = [], ordenesLiberadas = [], mensajeEspera } = data;

    return (
        <div className="fixed inset-0 z-[1600] bg-black/70 flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border-4 border-brand-cyan">

                <div className="bg-brand-cyan p-8 flex flex-col items-center justify-center text-white relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20"></div>
                    <i className="fa-solid fa-clipboard-check text-7xl mb-4 relative z-10 animate-[bounce_1s_infinite]"></i>
                    <h2 className="text-3xl font-black uppercase tracking-widest relative z-10">¡ORDEN PRONTA!</h2>
                </div>

                <div className="p-8 flex flex-col items-center text-center">

                    {mensajeEspera ? (
                        <div className="w-full bg-amber-50 rounded-2xl border-2 border-amber-300 p-4 mb-6 text-left">
                            <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">
                                <i className="fa-solid fa-hourglass-half mr-1"></i> BULTO PENDIENTE
                            </div>
                            <div className="text-sm font-bold text-amber-800 leading-snug">{mensajeEspera}</div>
                        </div>
                    ) : (
                        <>
                            <div className={`w-full rounded-2xl border-2 p-4 mb-4 ${faltantesPedido.length > 0 ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-100'}`}>
                                <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${faltantesPedido.length > 0 ? 'text-amber-600' : 'text-slate-400'}`}>DESTINO FÍSICO</div>
                                <div className={`text-xl font-black leading-tight ${faltantesPedido.length > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                                    {destino || '---'}
                                </div>
                            </div>

                            {faltantesPedido.length > 0 && (
                                <div className="w-full bg-amber-50 rounded-2xl border-2 border-amber-300 p-4 mb-4 text-left">
                                    <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">
                                        <i className="fa-solid fa-hourglass-half mr-1"></i> PEDIDO INCOMPLETO
                                    </div>
                                    <div className="text-sm font-bold text-amber-800 leading-snug">
                                        Faltan del mismo pedido: {faltantesPedido.join(', ')}
                                    </div>
                                </div>
                            )}

                            {ordenesLiberadas.length > 0 && (
                                <div className="w-full bg-emerald-50 rounded-2xl border-2 border-emerald-400 p-4 mb-4 text-left animate-pulse">
                                    <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">
                                        <i className="fa-solid fa-box-open mr-1"></i> ¡PEDIDO COMPLETO!
                                    </div>
                                    <div className="text-sm font-bold text-emerald-800 leading-snug">
                                        Retire también: {ordenesLiberadas.join(', ')}
                                    </div>
                                </div>
                            )}

                            <div className="w-full bg-brand-cyan/10 rounded-2xl border-2 border-brand-cyan/20 p-4 mb-6">
                                <div className="text-[10px] font-black text-brand-cyan uppercase tracking-widest mb-1">PRÓXIMO SERVICIO</div>
                                <div className="text-2xl font-black text-brand-cyan leading-tight">
                                    {proximoServicio || '---'}
                                </div>
                            </div>
                        </>
                    )}

                    <div className="space-y-3 w-full">
                        {!mensajeEspera && onImprimir && (
                            <button
                                onClick={onImprimir}
                                className="w-full py-3 rounded-xl bg-brand-cyan text-white font-black text-lg shadow-lg shadow-brand-cyan/30 hover:bg-brand-cyan hover:scale-[1.02] transition-all active:scale-95"
                            >
                                <i className="fa-solid fa-print mr-2"></i> IMPRIMIR ETIQUETAS
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="w-full py-3 rounded-xl bg-white border-2 border-slate-200 text-slate-500 font-bold text-sm hover:bg-slate-50"
                        >
                            Cerrar
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default OrdenProntaModal;
