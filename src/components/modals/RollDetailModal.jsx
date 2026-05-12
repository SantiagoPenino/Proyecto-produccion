import React, { useState, useEffect } from 'react';

const RollDetailModal = ({ isOpen, onClose, roll }) => {
    const [realFiles, setRealFiles] = useState([]);
    const [loading, setLoading] = useState(false);

    // --- 1. CARGA DE DATOS ---
    useEffect(() => {
        if (isOpen && roll) {
            if (roll.orders && roll.orders.length > 0) {
                setRealFiles(roll.orders);
            }
        }
    }, [isOpen, roll]);

    if (!isOpen || !roll) return null;

    // --- 2. GENERAR PDF ---
    const handlePrintPDF = async () => {
        setLoading(true);
        try {
            // Dynamic imports to prevent bundle issues
            const { jsPDF } = await import("jspdf");
            const autoTableModule = await import("jspdf-autotable");
            const autoTable = autoTableModule.default || autoTableModule;

            const doc = new jsPDF();

            doc.setFontSize(18);
            doc.text(`LOTE: ${roll.rollCode || roll.id}`, 14, 20);
            doc.setFontSize(12);
            doc.text(`Progreso: ${roll.usage || 0} / ${roll.capacity || 100}m`, 14, 30);

            const tableRows = (realFiles.length > 0 ? realFiles : roll.orders || []).map(order => [
                order.code || order.id || '#',
                order.client || 'Cliente',
                order.fileName || order.desc || 'Detalle',
                `${order.width || 0}m`
            ]);

            autoTable(doc, {
                startY: 40,
                head: [['ID', 'Cliente', 'Detalle', 'Metros']],
                body: tableRows,
                theme: 'grid',
                headStyles: { fillColor: [51, 65, 85] } // zinc-700
            });

            doc.save(`Lote_${roll.rollCode || 'Detalle'}.pdf`);
        } catch (error) {
            console.error("Error generating PDF", error);
            alert("Error cargando librería de PDF");
        } finally {
            setLoading(false);
        }
    };

    // --- 3. FINALIZAR TODO ---
    const handleFinishAll = () => {
        if (window.confirm("¿Estás seguro de finalizar todo el lote?")) {
            console.log("Finalizando lote:", roll.id);
            onClose();
        }
    };

    const usage = roll.usage ? roll.usage.toFixed(0) : '0';
    const capacity = roll.capacity || '100';
    const displayOrders = realFiles.length > 0 ? realFiles : (roll.orders || []);

    return (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
            {/* Contenedor Principal */}
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300"
                onClick={e => e.stopPropagation()}
            >

                {/* --- HEADER --- */}
                <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30">
                            <i className="fa-solid fa-scroll text-xl"></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-zinc-800 leading-none">Gestión de Producción</h3>
                            <span className="text-sm text-blue-600 font-bold uppercase tracking-wider">LOTE: {roll.rollCode || roll.name}</span>
                        </div>
                    </div>
                    <button
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 transition-colors"
                        onClick={onClose}
                    >
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                {/* --- BODY --- */}
                <div className="flex-1 overflow-y-auto p-6 bg-white">

                    {/* CAJA DE RESUMEN SUPERIOR */}
                    <div className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-wrap gap-4 justify-between items-center mb-8 shadow-sm">

                        {/* Progreso */}
                        <div className="flex items-center gap-4">
                            <div className="relative w-16 h-16">
                                <svg className="w-full h-full transform -rotate-90">
                                    <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-zinc-100" />
                                    <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent"
                                        strokeDasharray={175}
                                        strokeDashoffset={175 - (175 * (parseFloat(usage) / parseFloat(capacity)))}
                                        className="text-blue-500 transition-all duration-1000 ease-out"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-zinc-600">
                                    {Math.round((parseFloat(usage) / parseFloat(capacity)) * 100)}%
                                </div>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Progreso del Lote</span>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-2xl font-black text-blue-600">{usage}m</span>
                                    <span className="text-lg font-semibold text-zinc-400">/ {capacity}m</span>
                                </div>
                            </div>
                        </div>

                        {/* Botones de Acción */}
                        <div className="flex gap-3">
                            <button
                                className="px-5 py-2.5 bg-zinc-800 text-white rounded-lg font-bold hover:bg-zinc-900 shadow-lg shadow-zinc-900/20 transition-all flex items-center gap-2"
                                onClick={handlePrintPDF}
                            >
                                <i className="fa-solid fa-qrcode"></i> Imprimir QR / PDF
                            </button>
                            <button
                                className="px-5 py-2.5 bg-emerald-500 text-white rounded-lg font-bold hover:bg-emerald-600 shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-2"
                                onClick={handleFinishAll}
                            >
                                <i className="fa-solid fa-check"></i> Finalizar Todo
                            </button>
                        </div>
                    </div>

                    {/* TABLA DE ÓRDENES */}
                    <h3 className="text-sm font-bold text-zinc-700 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-list-check text-zinc-400"></i> Órdenes en Cola de Impresión
                    </h3>

                    <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-zinc-50 text-zinc-500 font-bold border-b border-zinc-200 text-xs uppercase tracking-wide">
                                <tr>
                                    <th className="px-4 py-3 w-20">ID</th>
                                    <th className="px-4 py-3">Cliente</th>
                                    <th className="px-4 py-3">Detalle</th>
                                    <th className="px-4 py-3 text-center">Metros</th>
                                    <th className="px-4 py-3 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-50">
                                {displayOrders.length > 0 ? (
                                    displayOrders.map((order, idx) => (
                                        <tr key={idx} className="hover:bg-zinc-50/80 transition-colors group">
                                            <td className="px-4 py-3 font-bold text-zinc-700 min-w-[120px]">Orden No.: {order.code || order.id}</td>
                                            <td className="px-4 py-3 font-medium text-zinc-600">{order.client}</td>
                                            <td className="px-4 py-3 text-zinc-500">
                                                {order.fileName || order.desc || `ERP #${order.id}`}
                                                <span className="ml-2 text-xs bg-zinc-100 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-200 font-mono">
                                                    ({order.copies || 1}/1)
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center font-bold text-zinc-800">{order.width || order.metros || 0}m</td>
                                            <td className="px-4 py-3 text-right">
                                                <button className="px-3 py-1.5 bg-white border border-zinc-200 text-zinc-600 rounded-full text-xs font-bold hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm group-hover:scale-105">
                                                    <i className="fa-solid fa-share mr-1"></i> A Calidad
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="5" className="p-8 text-center text-zinc-400 italic">
                                            {loading ? 'Cargando datos...' : 'No hay órdenes en cola'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default RollDetailModal;
