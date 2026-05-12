import React, { useState } from 'react';
import { ordersService, rollsService } from '../../services/api';


const ActiveRollModal = ({ isOpen, onClose, roll, onSuccess }) => {
    const [loading, setLoading] = useState(false);

    if (!isOpen || !roll) return null;

    // 1. GENERAR PDF CON QR
    const generateManifest = async () => {
        setLoading(true);
        try {
            // Dynamic Imports
            const { jsPDF } = await import("jspdf");
            const autoTableModule = await import("jspdf-autotable");
            const autoTable = autoTableModule.default || autoTableModule;
            const QRCode = await import("qrcode");

            const doc = new jsPDF();

            // Generar QR
            const qrData = JSON.stringify({ id: roll.id, name: roll.name, orders: roll.orders.length });
            const qrUrl = await QRCode.toDataURL(qrData);

            // Encabezado
            doc.setFontSize(18);
            doc.text(`Manifiesto de Producción: ${roll.name} `, 14, 20);

            doc.setFontSize(10);
            doc.text(`ID Lote: ${roll.id} `, 14, 28);
            doc.text(`Fecha Impresión: ${new Date().toLocaleString()} `, 14, 33);

            // Pegar QR
            doc.addImage(qrUrl, 'PNG', 150, 10, 40, 40);

            // Tabla de Órdenes
            const tableColumn = ["ID", "Cliente", "Trabajo", "Material", "Metros"];
            const tableRows = roll.orders.map(o => [
                o.id,
                o.client,
                o.desc,
                o.variant || '-',
                o.magnitude || '-'
            ]);

            autoTable(doc, {
                startY: 50,
                head: [tableColumn],
                body: tableRows,
                theme: 'grid',
                headStyles: { fillColor: [59, 130, 246] }
            });

            doc.save(`Manifiesto_${roll.id}.pdf`);
        } catch (e) {
            console.error("Error generating manifest PDF:", e);
            alert("Error al generar PDF: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[1400] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
                <div
                    className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center bg-white shrink-0">
                        <h3 className="text-xl font-black text-zinc-800 flex items-center gap-3">
                            <i className="fa-solid fa-print p-2 rounded-lg bg-zinc-100 shadow-sm" style={{ color: roll.color }}></i>
                            Gestión de Producción <span className="text-zinc-400 font-bold mx-1">/</span> {roll.name}
                        </h3>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors"
                        >
                            <i className="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <div className="p-6 flex flex-col gap-6 overflow-hidden flex-1 bg-zinc-50/50">

                        {/* ACCIONES DEL ROLLO */}
                        <div className="bg-white p-5 rounded-xl border border-zinc-200 shadow-sm flex justify-between items-center flex-wrap gap-4">
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-black tracking-widest text-zinc-400 mb-1">Progreso Actual</span>
                                <div className="flex items-baseline gap-2">
                                    <h2 className="text-2xl font-black" style={{ color: roll.color }}>{roll.usage}</h2>
                                    <span className="text-zinc-400 font-bold text-sm">/ {roll.capacity}m</span>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={generateManifest}
                                    className="px-4 py-2 bg-zinc-700 text-white text-sm font-bold rounded-lg shadow hover:bg-zinc-800 hover:shadow-lg transition-all active:scale-95 flex items-center gap-2"
                                >
                                    <i className="fa-solid fa-qrcode"></i> Imprimir QR / PDF
                                </button>
                                <button onClick={() => {
                                    if (confirm("¿Cerrar Lote completo? Todas las órdenes restantes pasarán a Finalizado.")) {
                                        rollsService.closeRoll(roll.id).then(() => { if (onSuccess) onSuccess(); onClose(); });
                                    }
                                }}
                                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg shadow hover:bg-emerald-700 hover:shadow-lg transition-all active:scale-95 flex items-center gap-2"
                                >
                                    <i className="fa-solid fa-check-double"></i> Finalizar Todo
                                </button>
                            </div>
                        </div>

                        {/* LISTA DE ÓRDENES EN EL ROLLO */}
                        <div className="flex flex-col flex-1 overflow-hidden bg-white border border-zinc-200 rounded-xl shadow-sm">
                            <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                                    <i className="fa-solid fa-list-ul"></i> Órdenes en Cola de Impresión
                                </h4>
                            </div>

                            <div className="overflow-y-auto flex-1">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-zinc-500 uppercase bg-white border-b border-zinc-200 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-3 font-bold">ID</th>
                                            <th className="px-4 py-3 font-bold">Cliente</th>
                                            <th className="px-4 py-3 font-bold">Detalle</th>
                                            <th className="px-4 py-3 font-bold">Material</th>
                                            <th className="px-4 py-3 font-bold">Metros</th>
                                            <th className="px-4 py-3 font-bold text-center w-32">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {roll.orders.map((order, idx) => (
                                            <tr key={order.id} className="hover:bg-zinc-50 transition-colors">
                                                <td className="px-4 py-3 font-mono font-bold text-zinc-700 min-w-[120px]">
                                                    {order.code || order.id}
                                                </td>
                                                <td className="px-4 py-3 font-semibold text-zinc-600 truncate max-w-[150px]">{order.client}</td>
                                                <td className="px-4 py-3 text-zinc-500 truncate max-w-[200px]">{order.desc}</td>
                                                <td className="px-4 py-3">
                                                    <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-indigo-100">
                                                        {order.variant || order.material || 'N/A'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 font-bold text-zinc-800">{order.magnitude}m</td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={() => {
                                                            if (confirm("¿Marcar esta orden como impresa y pasar a Terminación?")) {
                                                                setLoading(true);
                                                                ordersService.updateStatus(order.id, 'Terminación')
                                                                    .then(() => { if (onSuccess) onSuccess(); })
                                                                    .catch(() => alert("Error al mover orden"))
                                                                    .finally(() => setLoading(false));
                                                            }
                                                        }}
                                                        title="Marcar como Impreso -> Enviar a Calidad"
                                                        className="w-full px-2 py-1.5 bg-white border border-emerald-200 text-emerald-600 text-[10px] font-bold rounded hover:bg-emerald-50 hover:border-emerald-300 transition-colors uppercase tracking-wide flex items-center justify-center gap-1.5"
                                                        disabled={loading}
                                                    >
                                                        <i className="fa-solid fa-share"></i> Terminación
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {roll.orders.length === 0 && (
                                            <tr>
                                                <td colSpan="6" className="py-12 text-center text-zinc-400 italic">
                                                    Lote vacío. No hay órdenes asignadas.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </>
    );
};

export default ActiveRollModal;

