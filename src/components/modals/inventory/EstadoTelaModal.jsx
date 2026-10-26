import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { inventoryService } from "../../../services/modules/inventoryService";
import {
    X, User, Package, Calendar, AlertTriangle, Loader2, ReceiptText, ClipboardList, BadgeCheck, Scissors,
    Download, Factory, Recycle, Wrench, Undo2, Trash2,
} from "lucide-react";

// Estética nueva (22/10/2026, como el Inventario de tela): modal blanco, encima de la barra de arriba (z-[6000]; antes
// z-50 y quedaba por debajo), íconos de Lucide en brand-cyan en vez de emojis, y el color solo para lo que es estado
// (entra / sale stock, saldo bajo). La tabla de movimientos scrollea de costado en el celular.
const CARD = "bg-white rounded-2xl border border-zinc-200";

const fmtFecha = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("es-UY", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
};

const ENTRA = "bg-emerald-50 text-emerald-700 border-emerald-200";
const SALE = "bg-rose-50 text-rose-700 border-rose-200";
const MEDIDA = "bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20";
const AVISO = "bg-amber-50 text-amber-700 border-amber-200";
const NEUTRO = "bg-zinc-100 text-zinc-600 border-zinc-200";
const TIPO_CONFIG = {
    INGRESO:             { label: "Ingreso",             cls: ENTRA,  Icono: Download },
    CONFIRMACION_MEDIDA: { label: "Confirmación medida", cls: MEDIDA, Icono: BadgeCheck },
    CONSUMO:             { label: "Consumo",             cls: SALE,   Icono: Scissors },
    CONSUMO_PRODUCCION:  { label: "Consumo producción",  cls: SALE,   Icono: Factory },
    CONSUMO_ORDEN:       { label: "Consumo orden",       cls: SALE,   Icono: Scissors },
    MERMA_REIMPRESION:   { label: "Merma reimpresión",   cls: AVISO,  Icono: Recycle },
    AJUSTE_DESECHO:      { label: "Desecho",             cls: AVISO,  Icono: Trash2 },
    AJUSTE_MANUAL:       { label: "Ajuste manual",       cls: NEUTRO, Icono: Wrench },
    DEVOLUCION:          { label: "Devolución",          cls: MEDIDA, Icono: Undo2 },
};
// Tipos sin configurar: el código en texto legible ("LIBERACION_RESERVA" → "Liberacion reserva")
const getTipo = (t) => TIPO_CONFIG[t] || {
    label: t ? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ") : "—", cls: NEUTRO, Icono: ClipboardList,
};

function KpiCard({ label, value, sub, cls, Icono }) {
    return (
        <div className={`${CARD} px-4 py-3 min-w-0`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black text-zinc-400 uppercase tracking-wide truncate">{label}</span>
                <Icono className="w-4 h-4 shrink-0 text-brand-cyan" />
            </div>
            <div className={`mt-1 text-xl md:text-2xl font-black tabular-nums leading-tight ${cls}`}>{value}</div>
            {sub && <div className="text-xs text-zinc-400 mt-0.5">{sub}</div>}
        </div>
    );
}

const COLUMNAS = { gridTemplateColumns: "110px 1fr 150px 100px 100px" };

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

    const claseSaldo = saldo <= 0 ? "text-rose-600" : saldo < (confirmados ?? declarados) * 0.2 ? "text-amber-600" : "text-emerald-600";

    // En portal: si no, queda dentro de la capa de la página y no tapa la barra de arriba ni la lateral
    return createPortal(
        <div className="fixed inset-0 z-[6000] flex items-center justify-center p-3 sm:p-4 bg-black/40">
            <div className="bg-slate-50 rounded-2xl border border-zinc-200 shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden font-sans text-zinc-800">

                {/* HEADER */}
                <div className="bg-white border-b border-zinc-200 px-5 py-4 flex items-start justify-between gap-3 flex-shrink-0">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        <ReceiptText className="w-7 h-7 shrink-0 text-brand-cyan mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-black text-zinc-400 uppercase tracking-wide">
                                Estado de cuenta — tela de cliente
                            </div>
                            {loading && (
                                <div className="flex items-center gap-2 text-zinc-400 text-sm mt-1">
                                    <Loader2 className="w-4 h-4 animate-spin text-brand-cyan" /> Cargando...
                                </div>
                            )}
                            {bob && (
                                <>
                                    <h2 className="text-xl font-black text-zinc-800 tracking-tight truncate">
                                        {bob.DescripcionTela || bob.TipoTela}
                                    </h2>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-zinc-500">
                                        <span className="flex items-center gap-1">
                                            <User className="w-3.5 h-3.5 text-brand-cyan" />
                                            {bob.NombreCliente || bob.ClienteID}
                                        </span>
                                        <span className="flex items-center gap-1 font-mono">
                                            <Package className="w-3.5 h-3.5 text-brand-cyan" />
                                            {bob.CodigoEtiqueta}
                                        </span>
                                        <span className="flex items-center gap-1 tabular-nums">
                                            <Calendar className="w-3.5 h-3.5 text-brand-cyan" />
                                            {fmtFecha(bob.FechaIngreso)}
                                        </span>
                                        <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${
                                            bob.Estado === "Pendiente"  ? AVISO :
                                            bob.Estado === "Disponible" ? ENTRA :
                                                                          NEUTRO
                                        }`}>
                                            {bob.Estado}
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Cerrar"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {error && (
                    <div className="px-5 py-3 bg-rose-50 border-b border-rose-200 text-rose-700 text-sm font-bold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                    </div>
                )}

                {bob && (
                    <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">

                        {/* KPIs */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <KpiCard label="Declarados" value={`${declarados.toFixed(2)} m`}
                                cls="text-zinc-800" Icono={ClipboardList} sub="Al ingresar" />
                            <KpiCard label="Confirmados"
                                value={confirmados === null ? "Pendiente" : `${confirmados.toFixed(2)} m`}
                                cls={confirmados === null ? "text-amber-600" : "text-zinc-800"} Icono={BadgeCheck} sub="Medición real" />
                            <KpiCard label="Consumido" value={`${consumidoReal.toFixed(2)} m`}
                                cls={consumidoReal > 0 ? "text-rose-600" : "text-zinc-400"} Icono={Scissors} sub={`${pctConsumido}% del total`} />
                            <KpiCard label="Saldo" value={`${saldo.toFixed(2)} m`}
                                cls={claseSaldo} Icono={Package} sub="Disponible hoy" />
                        </div>

                        {/* BARRA DE PROGRESO */}
                        <div className={`${CARD} px-4 py-3`}>
                            <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                                <span className="font-semibold">Consumo acumulado</span>
                                <span className="tabular-nums font-bold">{pctConsumido}%</span>
                            </div>
                            <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-500 ${
                                    pctConsumido >= 90 ? "bg-rose-500" : pctConsumido >= 60 ? "bg-amber-400" : "bg-emerald-500"
                                }`} style={{ width: `${Math.min(pctConsumido, 100)}%` }} />
                            </div>
                        </div>

                        {/* TABLA */}
                        <div>
                            <h3 className="text-sm font-black text-zinc-800 mb-2">
                                Movimientos <span className="text-xs font-normal text-zinc-400">{movs.length}</span>
                            </h3>

                            {movs.length === 0 ? (
                                <div className={`${CARD} flex flex-col items-center gap-2 py-10 text-zinc-400 text-sm`}>
                                    <ClipboardList size={36} className="text-zinc-200" />
                                    Sin movimientos registrados aún.
                                </div>
                            ) : (
                                <div className={`${CARD} overflow-hidden`}>
                                    <div className="overflow-x-auto">
                                        <div className="min-w-[640px]">
                                            {/* Header */}
                                            <div className="grid text-[10px] font-black uppercase tracking-wide text-zinc-400 bg-zinc-50 border-b border-zinc-200 px-4 py-2.5"
                                                 style={COLUMNAS}>
                                                <span>Fecha</span>
                                                <span>Detalle / orden</span>
                                                <span>Tipo</span>
                                                <span className="text-right">Cantidad</span>
                                                <span className="text-right">Saldo</span>
                                            </div>

                                            {/* Rows */}
                                            <div className="divide-y divide-zinc-100">
                                                {movs.map((m, i) => {
                                                    const cfg  = getTipo(m.TipoMovimiento);
                                                    const cant = parseFloat(m.Cantidad) || 0;
                                                    return (
                                                        <div key={i}
                                                             className="grid items-center px-4 py-2.5 hover:bg-zinc-50 transition-colors text-sm"
                                                             style={COLUMNAS}>
                                                            {/* Fecha */}
                                                            <div className="text-[11px] font-mono text-zinc-500 tabular-nums">
                                                                {new Date(m.Fecha).toLocaleDateString("es-UY", { day:"2-digit", month:"2-digit", year:"2-digit" })}
                                                                <span className="block text-[10px] text-zinc-400">
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
                                                                                <span className="inline-block text-[10px] font-mono font-black text-brand-cyan bg-brand-cyan/5 border border-brand-cyan/20 px-1.5 py-0.5 rounded mb-0.5">
                                                                                    #{ordenPart}
                                                                                </span>
                                                                            )}
                                                                            <div className="text-xs text-zinc-700 truncate" title={motivoPart}>{motivoPart || '—'}</div>
                                                                            {m.Usuario && (
                                                                                <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                                                                                    <User className="w-3 h-3" /> {m.Usuario}
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    );
                                                                })()}
                                                            </div>

                                                            {/* Tipo badge */}
                                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold w-fit ${cfg.cls}`}>
                                                                <cfg.Icono className="w-3 h-3 shrink-0" /> {cfg.label}
                                                            </span>

                                                            {/* Cantidad */}
                                                            <div className={`text-right font-bold tabular-nums text-sm ${cant >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                                {cant >= 0 ? "+" : ""}{cant.toFixed(2)} m
                                                            </div>

                                                            {/* Saldo corrido */}
                                                            <div className="text-right font-black tabular-nums text-sm text-zinc-800">
                                                                {parseFloat(m.SaldoCorrido).toFixed(2)} m
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Total row */}
                                            <div className="grid px-4 py-3 bg-zinc-50 items-center border-t border-zinc-200"
                                                 style={COLUMNAS}>
                                                <span className="text-[11px] font-black text-zinc-400 uppercase tracking-wide col-span-4">Saldo final</span>
                                                <span className={`text-right font-black tabular-nums text-lg ${saldo <= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                                                    {saldo.toFixed(2)} m
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
