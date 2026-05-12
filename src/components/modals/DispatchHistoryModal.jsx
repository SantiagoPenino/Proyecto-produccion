import React, { useState, useEffect } from 'react';
import { logisticsService } from '../../services/api';
import QRCode from "react-qr-code";

const DispatchHistoryModal = ({ isOpen, onClose, areaId }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedDispatch, setSelectedDispatch] = useState(null); // Full details

    useEffect(() => {
        if (isOpen) {
            loadHistory();
            setSelectedDispatch(null);
        }
    }, [isOpen]);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const data = await logisticsService.getHistory(areaId);
            setHistory(data);
        } catch (error) {
            console.error("Error history", error);
        } finally {
            setLoading(false);
        }
    };

    const handleViewDispatch = async (code) => {
        setLoading(true);
        try {
            const details = await logisticsService.getRemitoByCode(code);
            // Transform items to 'orders' shape for consistent rendering
            // Group items by Order to match the Manifest look "Order - Client - X Bultos"

            const grouped = {};
            details.items.forEach(item => {
                const oid = item.OrdenID;
                if (!grouped[oid]) {
                    grouped[oid] = {
                        id: oid,
                        displayId: item.CodigoOrden || oid || '?',
                        cliente: item.Cliente || 'Desconocido',
                        bultosCount: 0
                    };
                }
                grouped[oid].bultosCount++;
            });

            setSelectedDispatch({
                ...details,
                orders: Object.values(grouped),
                totalBultos: details.items.length
            });

        } catch (error) {
            alert("Error cargando remito: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => window.print();

    if (!isOpen) return null;

    // VIEW: DETAIL (RECEIPT)
    if (selectedDispatch) {
        return (
            <div className="fixed inset-0 bg-zinc-900/80 flex items-center justify-center p-4 z-[1400] print:p-0 print:bg-white">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] print:shadow-none print:w-full print:max-w-none print:h-full print:max-h-none print:rounded-none">
                    <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50 print:hidden">
                        <h3 className="text-lg font-black text-zinc-800">Manifiesto Histórico</h3>
                        <button onClick={() => setSelectedDispatch(null)} className="text-sm font-bold text-blue-600 hover:underline">Volver</button>
                    </div>

                    <div className="p-8 flex flex-col items-center gap-6 overflow-y-auto print:p-0">
                        {/* MANIFIESTO IMPRIMIBLE (Igual que CreateDispatchModal) */}
                        <div className="w-full border-2 border-dashed border-zinc-800 p-6 rounded-xl bg-white text-center print:border-4 print:border-black print:rounded-none">
                            <div className="flex justify-between items-end border-b-2 border-zinc-900 pb-4 mb-6">
                                <h1 className="text-4xl font-black uppercase text-zinc-900 tracking-tighter">REMITO</h1>
                                <div className="text-right">
                                    <div className="text-xs font-bold text-zinc-500">FECHA</div>
                                    <div className="font-mono font-bold">{new Date(selectedDispatch.FechaCreacion).toLocaleDateString()}</div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center bg-zinc-100 p-3 rounded mb-6 print:bg-zinc-100 print:print-color-adjust-exact">
                                <div className="text-left">
                                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">ORIGEN</div>
                                    <div className="font-black text-xl text-zinc-800">{selectedDispatch.AreaOrigenID || 'PRODUCCION'}</div>
                                </div>
                                <div className="text-2xl text-zinc-300"><i className="fa-solid fa-arrow-right"></i></div>
                                <div className="text-right">
                                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">DESTINO</div>
                                    <div className="font-black text-xl text-zinc-800">{selectedDispatch.AreaDestinoID}</div>
                                </div>
                            </div>

                            <div className="flex justify-center mb-4">
                                <QRCode value={selectedDispatch.Codigo} size={150} />
                            </div>

                            <div className="text-3xl font-black font-mono tracking-widest text-zinc-900 mb-8 select-all border-b border-t border-zinc-200 py-2">
                                {selectedDispatch.Codigo}
                            </div>


                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-zinc-100 flex justify-end gap-3 bg-zinc-50 print:hidden">
                        <button onClick={() => setSelectedDispatch(null)} className="px-5 py-2 rounded-xl border border-zinc-200 text-zinc-600 font-bold text-sm">Volver</button>
                        <button onClick={handlePrint} className="px-6 py-2 rounded-xl bg-zinc-800 text-white font-bold text-sm shadow-lg"><i className="fa-solid fa-print mr-2"></i> Imprimir</button>
                    </div>
                </div>
            </div>
        );
    }

    // VIEW: LIST
    return (
        <div className="fixed inset-0 bg-zinc-900/50 flex items-center justify-center p-4 z-[1400]">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
                <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50">
                    <h3 className="text-lg font-black text-zinc-800"><i className="fa-solid fa-clock-rotate-left text-zinc-400 mr-2"></i> Historial de Despachos</h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-red-500"><i className="fa-solid fa-xmark text-xl"></i></button>
                </div>

                <div className="flex-1 overflow-y-auto p-0">
                    {loading && history.length === 0 ? (
                        <div className="p-8 text-center text-zinc-400">Cargando...</div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-zinc-50 text-xs font-bold uppercase text-zinc-400 sticky top-0">
                                <tr>
                                    <th className="px-6 py-3">Fecha</th>
                                    <th className="px-6 py-3">Código</th>
                                    <th className="px-6 py-3">Destino</th>
                                    <th className="px-6 py-3 text-right">Bultos</th>
                                    <th className="px-6 py-3 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {history.map(d => (
                                    <tr key={d.DespachoID} className="hover:bg-zinc-50 transition-colors">
                                        <td className="px-6 py-3 text-zinc-500 whitespace-nowrap">{new Date(d.FechaCreacion).toLocaleDateString()} <span className="text-xs">{new Date(d.FechaCreacion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></td>
                                        <td className="px-6 py-3 font-mono font-bold text-zinc-700">{d.Codigo}</td>
                                        <td className="px-6 py-3">
                                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-bold border border-blue-100">{d.AreaDestinoID}</span>
                                        </td>
                                        <td className="px-6 py-3 text-right font-bold text-zinc-600">{d.TotalBultos}</td>
                                        <td className="px-6 py-3 text-right">
                                            <button
                                                onClick={() => handleViewDispatch(d.Codigo)}
                                                className="text-blue-600 hover:text-blue-800 font-bold text-xs bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded transition-colors"
                                            >
                                                <i className="fa-solid fa-eye mr-1"></i> Ver
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {history.length === 0 && !loading && (
                                    <tr><td colSpan="5" className="p-8 text-center text-zinc-400 italic">No hay despachos recientes.</td></tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="px-6 py-3 border-t border-zinc-100 bg-zinc-50 flex justify-end">
                    <button onClick={onClose} className="px-5 py-2 rounded-xl bg-white border border-zinc-200 text-zinc-600 font-bold text-sm hover:shadow-sm">Cerrar</button>
                </div>
            </div>
        </div>
    );
};

export default DispatchHistoryModal;

