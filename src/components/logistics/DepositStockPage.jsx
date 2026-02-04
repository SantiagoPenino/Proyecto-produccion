
import React, { useState, useEffect } from "react";
import http from "../../services/apiClient";
import { toast } from "sonner";
import { Loader2, RefreshCw, CheckCircle, XCircle, Package } from "lucide-react";

const DepositStockPage = () => {
    const [stock, setStock] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [results, setResults] = useState(null);

    // 1. Fetch Data
    const fetchStock = async () => {
        setLoading(true);
        try {
            const res = await http.get("/logistics/deposit-stock");
            setStock(res.data);
            setResults(null);
        } catch (err) {
            console.error(err);
            toast.error("Error cargando stock de depósito");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStock();
    }, []);

    // 2. Sync Logic
    const handleSync = async () => {
        if (stock.length === 0) {
            toast.info("No hay items para sincronizar");
            return;
        }

        setSyncing(true);
        setResults(null);
        try {
            // Prepare payload: List of items with their QR (agrupados)
            const itemsToSync = stock.map(item => ({
                qr: item.V3String,
                count: item.CantidadBultos,
                orderCode: item.CodigoOrden
            }));

            const res = await http.post("/logistics/deposit-sync", { items: itemsToSync });

            const resData = res.data.results;
            setResults(resData); // [{ qr, success, data/error }]

            // Count successes
            const okCount = resData.filter(r => r.success).length;
            if (okCount > 0) {
                toast.success(`Sincronizados ${okCount} de ${resData.length} pedidos`);
            } else {
                toast.error("Fallo general en sincronización");
            }

        } catch (err) {
            console.error(err);
            toast.error("Error de conexión al sincronizar");
        } finally {
            setSyncing(false);
        }
    };

    return (
        // Removed <Layout> wrapper, using plain div
        <div className="flex flex-col h-full bg-slate-50 overflow-y-auto">
            <div className="p-6 max-w-7xl mx-auto w-full">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Package className="w-8 h-8 text-indigo-600" />
                        Stock en Depósito (Pendiente Sync)
                    </h1>
                    <div className="flex gap-2">
                        <button
                            onClick={fetchStock}
                            disabled={loading || syncing}
                            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            Refrescar
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={loading || syncing || stock.length === 0}
                            className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 font-medium flex items-center gap-2 shadow-lg"
                        >
                            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sincronizar React / Macrosoft"}
                        </button>
                    </div>
                </div>

                {/* --- RESULTS SUMMARY (If Sync ran) --- */}
                {results && (
                    <div className="mb-8 bg-white p-4 rounded-xl shadow border border-gray-100 animate-in fade-in slide-in-from-top-2">
                        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">Resultados Sincronización</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {results.map((r, i) => {
                                const originalItem = stock.find(s => s.V3String === r.qr);
                                const label = originalItem ? `Orden ${originalItem.CodigoOrden.split('(')[0]}` : 'Desconocido';
                                return (
                                    <div key={i} className={`p-3 rounded-lg border flex items-start gap-3 ${r.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                        {r.success ? <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" /> : <XCircle className="w-5 h-5 text-red-600 mt-0.5" />}
                                        <div>
                                            <div className="font-bold text-sm text-gray-900">{label}</div>
                                            <div className="text-xs text-gray-500 break-all">{r.qr.substring(0, 30)}...</div>
                                            <div className="text-xs font-semibold mt-1">
                                                {r.success ? "OK" : `Error: ${r.error || 'API Fail'}`}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* --- STOCK TABLE --- */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {loading ? (
                        <div className="p-12 flex justify-center text-gray-500">
                            <Loader2 className="w-8 h-8 animate-spin mr-2" /> Cargando stock...
                        </div>
                    ) : stock.length === 0 ? (
                        <div className="p-12 text-center text-gray-500">
                            No hay bultos en Stock de Depósito actualmente.
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                                    <th className="p-4">Orden (Base)</th>
                                    <th className="p-4">Cliente</th>
                                    <th className="p-4">Trabajo</th>
                                    <th className="p-4 text-center">Cant. Bultos</th>
                                    <th className="p-4 text-right">Fecha Ingreso</th>
                                    <th className="p-4 text-center">Estado Sync</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {stock.map((item, idx) => {
                                    // Clean Order Number visual
                                    const niceOrder = item.CodigoOrden ? item.CodigoOrden.split('(')[0].trim() : '???';
                                    const syncResult = results?.find(r => r.qr === item.V3String);

                                    return (
                                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                            <td className="p-4 font-medium text-indigo-700">
                                                {item.CodigoOrden}
                                                <span className="text-xs text-gray-400 block font-normal">Base: {niceOrder}</span>
                                            </td>
                                            <td className="p-4 text-gray-800">{item.Cliente}</td>
                                            <td className="p-4 text-gray-600 max-w-xs truncate" title={item.Descripcion}>{item.Descripcion}</td>
                                            <td className="p-4 text-center font-bold">{item.CantidadBultos}</td>
                                            <td className="p-4 text-right text-gray-500 text-sm">
                                                {new Date(item.FechaIngreso).toLocaleDateString()}
                                            </td>
                                            <td className="p-4 text-center">
                                                {syncResult ? (
                                                    syncResult.success
                                                        ? <span className="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-700 text-xs font-bold">SINC. OK</span>
                                                        : <span className="inline-flex items-center px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-bold">ERROR</span>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DepositStockPage;
