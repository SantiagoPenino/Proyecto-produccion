import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { useAuth } from "../../context/AuthContext";
import { ordersService } from "../../services/modules/ordersService";
import { SOCKET_URL } from "../../services/apiClient";

export default function ActiveOrdersCard() {
    const { user } = useAuth(); // user contains token, role, areaKey
    const areaKey = user.role !== "admin" ? user.areaKey : null;

    // React Query implementation
    const { data: summary, isLoading, error, refetch } = useQuery({
        queryKey: ['activeOrdersSummary', areaKey],
        queryFn: () => ordersService.getActiveSummary(areaKey),
        refetchInterval: 60000, // Poll every minute just in case
        staleTime: 1000 * 30,   // Data is fresh for 30s
    });

    // Handle initial state or missing data
    const displaySummary = summary || { totalGeneral: 0, perArea: {} };

    // Socket.io for realtime updates
    useEffect(() => {
        const socket = io(SOCKET_URL, { reconnectionAttempts: 5 });

        socket.on("connect_error", (err) => {
            console.error("🔴 Connection Error Socket.io:", err);
        });

        socket.on("server:order_updated", () => {
            console.log("⚡ socket: update received, refetching summary...");
            refetch();
        });

        return () => socket.disconnect();
    }, [refetch]);

    const loading = isLoading; // Compatibility with existing render logic

    return (
        <div className="relative bg-white rounded-2xl p-6 border border-slate-100 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden group">
            <div className="relative z-10">
                <div className="flex items-center mb-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-600 shadow-lg flex items-center justify-center text-white text-2xl mr-3">
                        <i className="fa-solid fa-clipboard-list" />
                    </div>
                    <h4 className="text-xl font-black text-slate-800 uppercase">Órdenes activas</h4>
                </div>
                <p className="text-4xl font-bold text-slate-800 mb-2">
                    {loading ? <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-500"></i> : displaySummary.totalGeneral}
                </p>
                <div className="text-sm text-slate-600">
                    {Object.entries(displaySummary.perArea || {}).map(([area, total]) => (
                        <div key={area} className="flex justify-between">
                            <span>{area}</span>
                            <span>{total}</span>
                        </div>
                    ))}
                </div>
            </div>
            {/* Background decorative icon */}
            <i className="fa-solid fa-clipboard-list absolute -right-4 -bottom-4 text-8xl text-slate-100 opacity-30 group-hover:scale-110 transition-transform duration-500 rotate-12" />
        </div>
    );
}
