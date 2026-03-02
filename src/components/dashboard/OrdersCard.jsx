import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { useAuth } from "../../context/AuthContext";
import { SOCKET_URL } from "../../services/apiClient";

export default function OrdersCard({ title, icon, bgColor, borderColor = "border-slate-100", numberColor = "text-slate-800", zeroColor, queryKey, queryFn, decorativeIcon }) {
    const { user } = useAuth();
    const areaKey = user.role !== "admin" ? user.areaKey : null;

    const { data: summary, isLoading, refetch } = useQuery({
        queryKey: [queryKey, areaKey],
        queryFn: () => queryFn(areaKey),
        refetchInterval: 60000,
        staleTime: 1000 * 30,
    });

    const displaySummary = summary || { totalGeneral: 0, perArea: {} };

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
    const iconName = decorativeIcon || icon;
    const dynamicColor = displaySummary.totalGeneral === 0 ? (zeroColor || numberColor) : numberColor;

    return (
        <div className={`relative bg-white rounded-2xl p-6 border ${borderColor} shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden group`}>
            <div className="relative z-10">
                <div className="flex items-center mb-4">
                    <div className={`w-12 h-12 rounded-xl ${bgColor} shadow-lg flex items-center justify-center text-white text-2xl mr-3`}>
                        <i className={`fa-solid ${icon}`} />
                    </div>
                    <h4 className="text-xl font-black text-slate-800 uppercase">{title}</h4>
                </div>
                <p className={`text-4xl font-bold ${dynamicColor} mb-2`}>
                    {loading ? <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-500"></i> : displaySummary.totalGeneral}
                </p>
                <div className="text-sm text-slate-600">
                    {Object.entries(displaySummary.perArea || {}).map(([area, total]) => (
                        <div key={area} className="flex justify-between border-b border-slate-50 py-1 last:border-0">
                            <span className="font-semibold text-slate-700">{area}</span>
                            <span className={`font-bold ${dynamicColor}`}>{total}</span>
                        </div>
                    ))}
                </div>
            </div>
            <i className={`fa-solid ${iconName} absolute -right-4 -bottom-4 text-8xl text-slate-100 opacity-20 group-hover:scale-110 transition-transform duration-500 rotate-12`} />
        </div>
    );
}
