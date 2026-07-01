import React, { useState, useEffect } from "react";
import { inventoryService } from "../../../services/modules/inventoryService";
import { X, User, Package, Calendar, AlertTriangle } from "lucide-react";

const fmtFecha = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("es-UY", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
};

const TIPO_CONFIG = {
    INGRESO:             { label: "Ingreso",             color: "#16a34a", bg: "#dcfce7", icon: "📥" },
    CONFIRMACION_MEDIDA: { label: "Confirmación Medida", color: "#2563eb", bg: "#dbeafe", icon: "✅" },
    CONSUMO:             { label: "Consumo",             color: "#dc2626", bg: "#fee2e2", icon: "⚙️" },
    CONSUMO_PRODUCCION:  { label: "Consumo Producción",  color: "#dc2626", bg: "#fee2e2", icon: "🏭" },
    MERMA_REIMPRESION:   { label: "Merma Reimpresión",   color: "#ea580c", bg: "#ffedd5", icon: "♻️" },
    AJUSTE_MANUAL:       { label: "Ajuste Manual",       color: "#7c3aed", bg: "#ede9fe", icon: "🔧" },
    DEVOLUCION:          { label: "Devolución",          color: "#0891b2", bg: "#cffafe", icon: "↩️" },
};
const getTipo = (t) => TIPO_CONFIG[t] || { label: t, color: "#64748b", bg: "#f1f5f9", icon: "📋" };

function KpiCard({ label, value, sub, color, icon }) {
    return (
        <div className="flex flex-col gap-1 bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
                <span className="text-lg">{icon}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
            {sub && <div className="text-xs text-slate-400">{sub}</div>}
        </div>
    );
}

export default function EstadoTelaModal({ bobinaId, onClose }) {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        inventoryService.getEstadoTela(bobinaId)
            .then(setData)
            .catch(e => setError(e?.response?.data?.error || "Error al cargar"))
            .finally(() => setLoading(false));
    }, [bobinaId]);

    const bob  = data?.bobina;
    const movs = data?.movimientos || [];

    const declarados = parseFloat(bob?.Declarados) || 0;
    const saldo      = parseFloat(bob?.SaldoActual) || 0;

    // Confirmados = declarados + ajuste de confirmación (puede ser negativo)
    const ajusteConfirmacion = movs
        .filter(m => m.TipoMovimiento === 'CONFIRMACION_MEDIDA')
        .reduce((acc, m) => acc + (parseFloat(m.Cantidad) || 0), 0);
    const confirmados = bob?.Estado === 'Pendiente'
        ? null
        : declarados + ajusteConfirmacion;

    // Consumido real = todo movimiento que reduce el stock (cantidad negativa),
    // excluyendo INGRESO y CONFIRMACION_MEDIDA (que son entradas o ajustes de medición)
    const EXCLUIR_DE_CONSUMO = ['INGRESO', 'CONFIRMACION_MEDIDA', 'LIBERACION_RESERVA'];
    const consumidoReal = movs
        .filter(m => !EXCLUIR_DE_CONSUMO.includes(m.TipoMovimiento) && parseFloat(m.Cantidad) < 0)
        .reduce((acc, m) => acc + Math.abs(parseFloat(m.Cantidad) || 0), 0);

    const base = confirmados ?? declarados;
    const pctConsumido = base > 0 ? Math.round((consumidoReal / base) * 100) : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(15,23,42,0.75)", backdropFilter: "blur(4px)" }}>
            <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

                {/* HEADER */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-4 flex items-start justify-between flex-shrink-0">
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
                            Estado de Cuenta — Tela de Cliente
                        </div>
                        {loading && <div className="text-slate-400 text-sm">Cargando...</div>}
                        {bob && (
                            <>
                                <h2 className="text-xl font-black tracking-tight truncate">
                                    {bob.DescripcionTela || bob.TipoTela}
                                </h2>
                                <div className="flex flex-wrap gap-3 mt-2 text-sm text-slate-300">
                                    <span className="flex items-center gap-1">
                                        <User className="w-3.5 h-3.5" />
                                        {bob.NombreCliente || bob.ClienteID}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Package className="w-3.5 h-3.5" />
                                        {bob.CodigoEtiqueta}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {fmtFecha(bob.FechaIngreso)}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                        bob.Estado === "Pendiente"  ? "bg-amber-500/20 text-amber-300"  :
                                        bob.Estado === "Disponible" ? "bg-green-500/20 text-green-300"  :
                                                                      "bg-slate-500/20 text-slate-300"
                                    }`}>
                                        {bob.Estado === "Pendiente" ? "⏳" : bob.Estado === "Disponible" ? "✅" : "⚙️"} {bob.Estado}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                    <button onClick={onClose}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white ml-4">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {error && (
                    <div className="px-6 py-3 bg-red-50 border-b border-red-100 text-red-700 text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> {error}
                    </div>
                )}

                {bob && (
                    <div className="flex-1 overflow-y-auto">

                        {/* KPIs */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-slate-200">
                            <KpiCard label="Declarados"  value={`${declarados.toFixed(2)} m`}
                                color="#1e40af" icon="📋" sub="Al ingresar" />
                            <KpiCard label="Confirmados"
                                value={confirmados === null ? "Pendiente" : `${confirmados.toFixed(2)} m`}
                                color={confirmados === null ? "#d97706" : "#16a34a"} icon="✅" sub="Medición real" />
                            <KpiCard label="Consumido"   value={`${consumidoReal.toFixed(2)} m`}
                                color={consumidoReal > 0 ? "#dc2626" : "#64748b"} icon="⚙️" sub={`${pctConsumido}% del total`} />
                            <KpiCard label="Saldo"       value={`${saldo.toFixed(2)} m`}
                                color={saldo <= 0 ? "#dc2626" : saldo < (confirmados ?? declarados) * 0.2 ? "#ea580c" : "#16a34a"}
                                icon="📦" sub="Disponible hoy" />
                        </div>

                        {/* BARRA DE PROGRESO */}
                        <div className="px-4 py-3 border-b border-slate-200 bg-white">
                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                                <span>Consumo acumulado</span>
                                <span>{pctConsumido}%</span>
                            </div>
                            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500"
                                     style={{
                                         width: `${Math.min(pctConsumido, 100)}%`,
                                         background: pctConsumido >= 90 ? "#dc2626"
                                                   : pctConsumido >= 60 ? "#ea580c" : "#16a34a"
                                     }} />
                            </div>
                        </div>

                        {/* TABLA */}
                        <div className="p-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                                Movimientos ({movs.length})
                            </h3>

                            {movs.length === 0 ? (
                                <div className="text-center py-10 text-slate-400 text-sm">
                                    Sin movimientos registrados aún.
                                </div>
                            ) : (
                                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                    {/* Header */}
                                    <div className="grid text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-50 border-b border-slate-200 px-4 py-2"
                                         style={{ gridTemplateColumns: "110px 1fr 110px 90px 90px" }}>
                                        <span>Fecha</span>
                                        <span>Detalle / Orden</span>
                                        <span>Tipo</span>
                                        <span className="text-right">Cantidad</span>
                                        <span className="text-right">Saldo</span>
                                    </div>

                                    {/* Rows */}
                                    <div className="divide-y divide-slate-100">
                                        {movs.map((m, i) => {
                                            const cfg  = getTipo(m.TipoMovimiento);
                                            const cant = parseFloat(m.Cantidad) || 0;
                                            return (
                                                <div key={i}
                                                     className="grid items-center px-4 py-2.5 hover:bg-slate-50 transition-colors text-sm"
                                                     style={{ gridTemplateColumns: "110px 1fr 110px 90px 90px" }}>
                                                    {/* Fecha */}
                                                    <div className="text-[11px] font-mono text-slate-500">
                                                        {new Date(m.Fecha).toLocaleDateString("es-UY", { day:"2-digit", month:"2-digit", year:"2-digit" })}
                                                        <span className="block text-[10px] text-slate-400">
                                                            {new Date(m.Fecha).toLocaleTimeString("es-UY", { hour:"2-digit", minute:"2-digit" })}
                                                        </span>
                                                    </div>

                                                    {/* Detalle: parsear Orden | Motivo y limpiar BOB-xxx */}
                                                    <div className="min-w-0 pr-2">
                                                        {(() => {
                                                            const raw = m.Detalle || '';
                                                            // Quitar prefijo "Ajuste BOB-xxx-xxx: " si existe
                                                            const sinBob = raw.replace(/Ajuste\s+BOB-[\w-]+:\s*/gi, '');
                                                            const hasPipe = sinBob.includes(' | ');
                                                            const ordenPart = hasPipe ? sinBob.split(' | ')[0].trim() : '';
                                                            const motivoPart = hasPipe ? sinBob.split(' | ').slice(1).join(' | ').trim() : sinBob;
                                                            return (
                                                                <>
                                                                    {ordenPart && (
                                                                        <span className="inline-block text-[10px] font-mono font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded mb-0.5">
                                                                            #{ordenPart}
                                                                        </span>
                                                                    )}
                                                                    <div className="text-xs text-slate-700 truncate" title={motivoPart}>{motivoPart || '—'}</div>
                                                                    {m.Usuario && (
                                                                        <div className="text-[10px] text-slate-400">👤 {m.Usuario}</div>
                                                                    )}
                                                                </>
                                                            );
                                                        })()}
                                                    </div>

                                                    {/* Tipo badge */}
                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold w-fit"
                                                          style={{ background: cfg.bg, color: cfg.color }}>
                                                        {cfg.icon} {cfg.label}
                                                    </span>

                                                    {/* Cantidad */}
                                                    <div className={`text-right font-bold tabular-nums text-sm ${cant >= 0 ? "text-green-600" : "text-red-600"}`}>
                                                        {cant >= 0 ? "+" : ""}{cant.toFixed(2)} m
                                                    </div>

                                                    {/* Saldo corrido */}
                                                    <div className="text-right font-black tabular-nums text-sm text-slate-800">
                                                        {parseFloat(m.SaldoCorrido).toFixed(2)} m
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Total row */}
                                    <div className="grid px-4 py-3 bg-slate-800 text-white items-center border-t-2 border-slate-700"
                                         style={{ gridTemplateColumns: "110px 1fr 110px 90px 90px" }}>
                                        <span className="text-xs font-bold text-slate-400 col-span-4">SALDO FINAL</span>
                                        <span className="text-right font-black tabular-nums text-lg"
                                              style={{ color: saldo <= 0 ? "#f87171" : "#4ade80" }}>
                                            {saldo.toFixed(2)} m
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
