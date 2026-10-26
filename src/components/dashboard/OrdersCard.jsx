import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { socket } from "../../services/socketService";

// Color por estado (22/10/2026): el número y las barras van con el color del estado; el ícono, siempre en
// brand-cyan y sin fondo. Con 0, el número queda gris.
const TONOS = {
    neutro: { numero: "text-zinc-800", barra: "bg-brand-cyan" },
    ambar: { numero: "text-amber-600", barra: "bg-amber-400" },
    rojo: { numero: "text-rose-600", barra: "bg-rose-400" },
};

// Total y reparto por área de una tarjeta, con refresco cada minuto y al llegar un aviso de orden por socket.
// La usan la tarjeta de escritorio y el resumen del celular (misma queryKey: comparten la caché, no piden dos veces).
// escucharSocket=false para una segunda vista de la misma tarjeta, así un aviso no dispara dos refetch.
function useResumenOrdenes(queryKey, queryFn, { escucharSocket = true } = {}) {
    const { user } = useAuth();
    const areaKey = user.role !== "admin" ? user.areaKey : null;

    const { data: summary, isLoading, refetch } = useQuery({
        queryKey: [queryKey, areaKey],
        queryFn: () => queryFn(areaKey),
        refetchInterval: 60000,
        staleTime: 1000 * 30,
    });

    useEffect(() => {
        if (!escucharSocket) return undefined;
        // Socket único de la app (services/socketService). Antes hacía io(SOCKET_URL) acá: como el
        // singleton ya tiene el namespace "/", socket.io-client abre una conexión NUEVA (no multiplexa)
        // y el cleanup solo quitaba listeners → cada montaje dejaba una conexión abierta (13/10).
        // Solo quitar los listeners de ESTE componente; nunca disconnect() (baja el de toda la app).
        const handleOrderUpdated = () => {
            refetch();
        };

        socket.on("server:order_updated", handleOrderUpdated);

        return () => {
            socket.off("server:order_updated", handleOrderUpdated);
        };
    }, [refetch, escucharSocket]);

    const total = summary?.totalGeneral || 0;
    // De mayor a menor: lo que más pesa, arriba.
    const areas = Object.entries(summary?.perArea || {}).sort((a, b) => b[1] - a[1]);
    // Cada área con el código de sus órdenes (SUB, DTF, XEUV, VEN...), que manda el backend; si no viene, el área.
    const prefijos = summary?.prefijos || {};
    return { total, areas, prefijos, isLoading };
}

// Reparto por área: código, barra proporcional al área que más tiene y cantidad.
function ListaAreas({ areas, prefijos, tono }) {
    const maximo = Math.max(1, ...areas.map(([, n]) => n));
    const t = TONOS[tono] || TONOS.neutro;
    return (
        <ul className="mt-3 pt-3 border-t border-zinc-100 flex flex-col gap-1.5">
            {areas.map(([area, n]) => (
                <li key={area} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-3">
                    <span className="text-xs font-bold text-zinc-600 truncate" title={`Área ${area}`}>{prefijos[area] || area}</span>
                    <span className="h-1.5 rounded-full bg-zinc-100 overflow-hidden" aria-hidden="true">
                        <span className={`block h-full rounded-full ${t.barra}`} style={{ width: `${Math.max(3, (n / maximo) * 100)}%` }} />
                    </span>
                    <span className="text-sm font-black text-zinc-700 text-right tabular-nums">{n.toLocaleString("es-UY")}</span>
                </li>
            ))}
        </ul>
    );
}

export default function OrdersCard({ title, Icono, tono = "neutro", queryKey, queryFn }) {
    const { total, areas, prefijos, isLoading } = useResumenOrdenes(queryKey, queryFn);
    const t = TONOS[tono] || TONOS.neutro;

    return (
        <div className="bg-white rounded-2xl border border-zinc-200 p-4 md:p-5 flex flex-col">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-black text-zinc-400 uppercase tracking-wide">
                    <Icono size={14} className="text-brand-cyan" aria-hidden="true" /> {title}
                </div>
                {isLoading && <Loader2 size={15} className="animate-spin text-zinc-300" aria-label="Cargando" />}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
                <span className={`text-4xl font-black leading-tight tabular-nums ${total ? t.numero : "text-zinc-300"}`}>
                    {isLoading ? "—" : total.toLocaleString("es-UY")}
                </span>
                {!isLoading && <span className="text-sm text-zinc-400">{total === 1 ? "orden" : "órdenes"}</span>}
            </div>

            {!isLoading && areas.length > 0 && <ListaAreas areas={areas} prefijos={prefijos} tono={tono} />}
            {!isLoading && total === 0 && (
                <p className="mt-3 pt-3 border-t border-zinc-100 text-sm text-zinc-400">Ninguna por ahora.</p>
            )}
        </div>
    );
}

// ─── Celular (23/10/2026) ────────────────────────────────────────────────────
// Las tres tarjetas una abajo de la otra eran casi tres pantallas de scroll. En el celular van los tres totales
// en una fila (se tocan para elegir) y abajo el reparto por área del elegido.
function MosaicoCelular({ tarjeta, elegido, onElegir }) {
    const { total, isLoading } = useResumenOrdenes(tarjeta.queryKey, tarjeta.queryFn);
    const t = TONOS[tarjeta.tono] || TONOS.neutro;
    const { Icono } = tarjeta;
    return (
        <button
            type="button"
            onClick={onElegir}
            aria-pressed={elegido}
            className={`bg-white rounded-2xl border p-3 text-left min-w-0 transition-colors
                ${elegido ? "border-brand-cyan ring-2 ring-brand-cyan/15" : "border-zinc-200"}`}
        >
            <span className="flex items-center gap-1 text-[10px] font-black text-zinc-400 uppercase tracking-wide min-w-0">
                <Icono size={12} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                <span className="truncate">{tarjeta.title}</span>
            </span>
            <span className={`block mt-1 text-2xl font-black leading-tight tabular-nums ${total ? t.numero : "text-zinc-300"}`}>
                {isLoading ? "—" : total.toLocaleString("es-UY")}
            </span>
        </button>
    );
}

function DetalleCelular({ tarjeta }) {
    // La fila de arriba ya escucha el socket para esta misma tarjeta
    const { total, areas, prefijos, isLoading } = useResumenOrdenes(tarjeta.queryKey, tarjeta.queryFn, { escucharSocket: false });
    const { Icono } = tarjeta;
    return (
        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-black text-zinc-400 uppercase tracking-wide">
                    <Icono size={14} className="text-brand-cyan" aria-hidden="true" /> {tarjeta.title} por área
                </div>
                {isLoading
                    ? <Loader2 size={15} className="animate-spin text-zinc-300" aria-label="Cargando" />
                    : <span className="text-xs text-zinc-400 tabular-nums">{total.toLocaleString("es-UY")} {total === 1 ? "orden" : "órdenes"}</span>}
            </div>
            {!isLoading && areas.length > 0 && <ListaAreas areas={areas} prefijos={prefijos} tono={tarjeta.tono} />}
            {!isLoading && total === 0 && (
                <p className="mt-3 pt-3 border-t border-zinc-100 text-sm text-zinc-400">Ninguna por ahora.</p>
            )}
        </div>
    );
}

// tarjetas: [{ title, Icono, tono, queryKey, queryFn }], las mismas que las OrdersCard de escritorio.
export function ResumenOrdenesCelular({ tarjetas }) {
    const [elegida, setElegida] = useState(0);
    const tarjeta = tarjetas[elegida] || tarjetas[0];
    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
                {tarjetas.map((t, i) => (
                    <MosaicoCelular key={t.queryKey} tarjeta={t} elegido={i === elegida} onElegir={() => setElegida(i)} />
                ))}
            </div>
            <DetalleCelular key={tarjeta.queryKey} tarjeta={tarjeta} />
        </div>
    );
}
