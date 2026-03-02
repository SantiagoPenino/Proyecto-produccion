import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { useAuth } from "../../context/AuthContext";
import { ordersService } from "../../services/modules/ordersService";
import { SOCKET_URL } from "../../services/apiClient";

export default function FailedOrdersCard() {
    const { user } = useAuth(); // user contains token, role, areaKey
    const areaKey = user.role !== "admin" ? user.areaKey : null;

    // React Query implementation
    const { data: summary, isLoading, error, refetch } = useQuery({
        queryKey: ['failedOrdersSummary', areaKey],
        queryFn: () => ordersService.getFailedSummary(areaKey),
        refetchInterval: 60000,
        staleTime: 1000 * 30,
    });

    const displaySummary = summary || { totalGeneral: 0, perArea: {} };

    // Socket.io for realtime updates
    useEffect(() => {
        const socket = io(SOCKET_URL, { reconnectionAttempts: 5 });

        socket.on("connect_error", (err) => {
            console.error("🔴 Connection Error Socket.io:", err);
        });

        socket.on("server:order_updated", () => {
            refetch();
        });

        return () => socket.disconnect();
    }, [refetch]);

    const loading = isLoading;

    return (
        <div className="relative bg-white rounded-2xl p-6 border border-red-100 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden group">
            <div className="relative z-10">
                <div className="flex items-center mb-4">
                    <div className="w-12 h-12 rounded-xl bg-yellow-500 shadow-lg flex items-center justify-center text-white text-2xl mr-3">
                        <i className="fa-solid fa-triangle-exclamation" />
                    </div>
                    <h4 className="text-xl font-black text-slate-800 uppercase">Órdenes con Falla</h4>
                </div>
                <p className="text-4xl font-bold text-red-600 mb-2">
                    {loading ? <i className="fa-solid fa-spinner fa-spin text-2xl text-red-500"></i> : displaySummary.totalGeneral}
                </p>
                <div className="text-sm text-slate-600">
                    <p className="text-xs text-slate-400 font-bold uppercase mb-1">Detalle por área:</p>
                    {Object.entries(displaySummary.perArea || {}).length === 0 && !loading && (
                        <span className="text-slate-400 italic">Sin fallas activas</span>
                    )}
                    {Object.entries(displaySummary.perArea || {}).map(([area, total]) => (
                        <div key={area} className="flex justify-between border-b border-slate-50 py-1 last:border-0">
                            <span className="font-semibold text-slate-700">{area}</span>
                            <span className="font-bold text-red-500">{total}</span>
                        </div>
                    ))}
                </div>
            </div>
            {/* Background decorative icon */}
            <i className="fa-solid fa-triangle-exclamation absolute -right-4 -bottom-4 text-8xl text-red-50 opacity-20 group-hover:scale-110 transition-transform duration-500 rotate-12" />
        </div>
    );
}
