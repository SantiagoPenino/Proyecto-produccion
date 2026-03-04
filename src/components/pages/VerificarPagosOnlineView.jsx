import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';

const VerificarPagosOnlineView = () => {
    const [pagos, setPagos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState(null);

    // Filtros
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [clientFilter, setClientFilter] = useState('');
    const [orderFilter, setOrderFilter] = useState('');

    const fetchPagos = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (clientFilter) params.append('clientFilter', clientFilter);
            if (orderFilter) params.append('orderFilter', orderFilter);

            const res = await api.get(`/web-retiros/pagos-online?${params.toString()}`);
            setPagos(res.data);
        } catch (error) {
            console.error("Error al traer pagos online:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPagos();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const parseOrders = (jsonString) => {
        try {
            return JSON.parse(jsonString || "[]");
        } catch {
            return [];
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-lg border border-zinc-100 min-h-full flex flex-col p-6 lg:p-10 font-sans">
            <h2 className="text-2xl font-black text-[#0070bc] mb-6">Verificar Pagos Online Realizados</h2>

            <div className="bg-zinc-50 rounded-xl p-4 lg:p-6 mb-8 border border-zinc-200">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-zinc-700">Fecha Inicio</label>
                        <input
                            type="date"
                            className="bg-white border border-zinc-300 rounded-lg px-3 py-2 text-zinc-700 outline-none focus:border-[#0070bc] focus:ring-1 focus:ring-[#0070bc]"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-zinc-700">Fecha Fin</label>
                        <input
                            type="date"
                            className="bg-white border border-zinc-300 rounded-lg px-3 py-2 text-zinc-700 outline-none focus:border-[#0070bc] focus:ring-1 focus:ring-[#0070bc]"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-zinc-700">Cliente (Nombre o Cód)</label>
                        <input
                            type="text"
                            placeholder="Buscar cliente..."
                            className="bg-white border border-zinc-300 rounded-lg px-3 py-2 text-zinc-700 outline-none focus:border-[#0070bc] focus:ring-1 focus:ring-[#0070bc]"
                            value={clientFilter}
                            onChange={(e) => setClientFilter(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-zinc-700">Orden de Retiro</label>
                        <input
                            type="text"
                            placeholder="Ej. R-1234..."
                            className="bg-white border border-zinc-300 rounded-lg px-3 py-2 text-zinc-700 outline-none focus:border-[#0070bc] focus:ring-1 focus:ring-[#0070bc]"
                            value={orderFilter}
                            onChange={(e) => setOrderFilter(e.target.value)}
                        />
                    </div>
                    <div>
                        <button
                            onClick={fetchPagos}
                            className="w-full bg-[#0070bc] hover:bg-[#005a99] text-white font-bold py-2 px-4 rounded-lg transition-colors border-2 border-transparent focus:outline-none focus:ring-2 focus:ring-[#0070bc] focus:ring-offset-2"
                        >
                            <i className="fa-solid fa-search mr-2"></i>Filtrar
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border border-zinc-200 bg-white">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-[#f8f9fa] top-0 sticky text-zinc-600 z-10">
                        <tr>
                            <th className="px-5 py-4 font-bold border-b border-zinc-200">Fecha/Hora</th>
                            <th className="px-5 py-4 font-bold border-b border-zinc-200">Emisor / Status</th>
                            <th className="px-5 py-4 font-bold border-b border-zinc-200">Transacción Handy</th>
                            <th className="px-5 py-4 font-bold border-b border-zinc-200">Cliente</th>
                            <th className="px-5 py-4 font-bold border-b border-zinc-200">Monto</th>
                            <th className="px-5 py-4 font-bold border-b border-zinc-200">Órdenes Pagadas</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 text-zinc-800">
                        {loading && pagos.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-5 py-8 text-center text-zinc-500">
                                    <div className="flex justify-center items-center gap-3">
                                        <div className="animate-spin h-5 w-5 border-2 border-[#0070bc] border-t-transparent rounded-full"></div>
                                        Cargando transacciones...
                                    </div>
                                </td>
                            </tr>
                        ) : pagos.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-5 py-8 text-center text-zinc-500">
                                    No se encontraron pagos con los filtros aplicados.
                                </td>
                            </tr>
                        ) : (
                            pagos.map((pago) => {
                                const orders = parseOrders(pago.OrdersJson);
                                let ordenesRetiro = [];
                                if (orders.ordenRetiro) ordenesRetiro = [orders.ordenRetiro];
                                if (!orders.ordenRetiro && orders.reactOrderNumbers) {
                                    ordenesRetiro = [...new Set(orders.reactOrderNumbers)];
                                }

                                const paidAtDate = pago.PaidAt ? new Date(pago.PaidAt).toLocaleString() : 'N/A';

                                return (
                                    <tr
                                        key={pago.Id}
                                        className="hover:bg-blue-50 transition-colors cursor-pointer"
                                        onClick={() => setSelectedTransaction(pago)}
                                    >
                                        <td className="px-5 py-3 font-medium">{paidAtDate}</td>
                                        <td className="px-5 py-3">
                                            <div className="flex flex-col gap-1">
                                                <span className="font-bold text-zinc-700">{pago.IssuerName || 'N/A'}</span>
                                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full inline-block w-fit ${pago.Status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                                                    pago.Status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-red-100 text-red-700'
                                                    }`}>
                                                    {pago.Status}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-xs text-zinc-500 font-mono">
                                            {pago.TransactionId}
                                        </td>
                                        <td className="px-5 py-3 text-[#0070bc] font-bold">
                                            {pago.NombreCliente || 'Cliente N/A'} <br />
                                            <span className="text-xs text-zinc-500 font-normal">Cód: {pago.CodCliente}</span>
                                        </td>
                                        <td className="px-5 py-3 text-zinc-900 font-bold">
                                            {pago.Currency === 858 || pago.Currency === 'UYU' ? 'UYU' : 'USD'} {Number(pago.TotalAmount).toFixed(2)}
                                        </td>
                                        <td className="px-5 py-3 font-medium">
                                            <div className="flex flex-col gap-1">
                                                {ordenesRetiro.length > 0 ? (
                                                    ordenesRetiro.map((o, i) => (
                                                        <span key={i} className="bg-[#eaf5ff] text-[#0070bc] border border-[#cbe5ff] px-2 py-1 rounded text-xs w-fit">
                                                            {o}
                                                        </span>
                                                    ))
                                                ) : <span className="text-zinc-400">Sin identificar</span>}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal de Detalle */}
            {selectedTransaction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm" onClick={() => setSelectedTransaction(null)}>
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]"
                        onClick={(e) => e.stopPropagation()} // Para no cerrar cuando se clickea adentro
                    >
                        {/* Head */}
                        <div className="flex justify-between items-center p-6 border-b border-zinc-100 bg-zinc-50">
                            <div>
                                <h3 className="text-xl font-black text-[#0070bc]">Detalle de Transacción</h3>
                                <p className="text-sm text-zinc-500 font-medium mt-1">
                                    ID: <span className="font-mono">{selectedTransaction.TransactionId}</span>
                                </p>
                            </div>
                            <button
                                onClick={() => setSelectedTransaction(null)}
                                className="text-zinc-400 hover:text-red-500 transition-colors w-10 h-10 rounded-full hover:bg-red-50 flex items-center justify-center"
                            >
                                <i className="fa-solid fa-times text-xl"></i>
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 overflow-y-auto w-full custom-scrollbar">
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Cliente</p>
                                    <p className="font-bold text-zinc-800">{selectedTransaction.NombreCliente || 'N/A'}</p>
                                    <p className="text-sm text-zinc-500">Cód: {selectedTransaction.CodCliente}</p>
                                </div>
                                <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Pago Realizado</p>
                                    <p className="font-black text-[#0070bc] text-lg">
                                        {selectedTransaction.Currency === 858 || selectedTransaction.Currency === 'UYU' ? 'UYU' : 'USD'} {Number(selectedTransaction.TotalAmount).toFixed(2)}
                                    </p>
                                    <p className="text-sm text-zinc-500 font-medium mt-1 bg-zinc-200 px-2 py-0.5 rounded-full w-fit">
                                        {selectedTransaction.IssuerName || 'N/A'} - {selectedTransaction.Status}
                                    </p>
                                </div>
                            </div>

                            <h4 className="font-bold text-zinc-800 mb-3 text-lg">Contenido del Pedido</h4>
                            <div className="flex flex-col gap-3">
                                {(() => {
                                    const ordersParsed = parseOrders(selectedTransaction.OrdersJson);
                                    let subOrders = ordersParsed.orders || [];
                                    const withdrawalOrder = ordersParsed.ordenRetiro || null;

                                    // Compatibilidad por si en algun JSON viejo vino un arreglo directo
                                    if (Array.isArray(ordersParsed)) subOrders = ordersParsed;

                                    return (
                                        <>
                                            {withdrawalOrder && (
                                                <div className="mb-2">
                                                    <span className="bg-[#eaf5ff] text-[#0070bc] border border-[#cbe5ff] font-bold px-3 py-1.5 rounded-full text-sm inline-block shadow-sm">
                                                        Orden de Retiro Base: R-{String(withdrawalOrder).replace('R-', '')}
                                                    </span>
                                                </div>
                                            )}

                                            {subOrders.length > 0 ? (
                                                <div className="border border-zinc-200 rounded-xl overflow-hidden mt-1">
                                                    <table className="w-full text-left text-sm">
                                                        <thead className="bg-[#f8f9fa] border-b border-zinc-200">
                                                            <tr>
                                                                <th className="px-4 py-3 font-bold text-zinc-600">ID / Código</th>
                                                                <th className="px-4 py-3 font-bold text-zinc-600">Descripción</th>
                                                                <th className="px-4 py-3 font-bold text-zinc-600 text-right">Monto</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-zinc-100">
                                                            {subOrders.map((o, i) => (
                                                                <tr key={i} className="hover:bg-zinc-50">
                                                                    <td className="px-4 py-3 font-bold text-zinc-800">
                                                                        {o.id || o.rawId || 'N/A'}
                                                                    </td>
                                                                    <td className="px-4 py-3 text-zinc-600 font-medium">
                                                                        {o.desc || 'Pedido estándar'}
                                                                    </td>
                                                                    <td className="px-4 py-3 font-bold text-right text-[#0070bc]">
                                                                        {Number(o.amount).toFixed(2)}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="bg-zinc-50 p-6 rounded-xl text-center text-zinc-500 border border-zinc-200 border-dashed">
                                                    No hay detalles de sub-órdenes para esta transacción.
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end">
                            <button
                                onClick={() => setSelectedTransaction(null)}
                                className="px-6 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-bold rounded-lg transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VerificarPagosOnlineView;
