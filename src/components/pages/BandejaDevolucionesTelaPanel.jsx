import React, { useState, useEffect } from "react";
import { CheckCircle2, XCircle, PackageCheck, RefreshCw, Send, Printer, AlertTriangle, Loader2, Inbox, Bell, Undo2, Clock } from "lucide-react";
import Selector from "../ui/Selector";
import { toast } from "sonner";
import { telaClienteService } from "../../services/modules/telaClienteService";
import { printLabels } from "../../utils/labelPrinter";

// Estética nueva (22/10/2026, como el Inventario de tela): tarjetas blancas con borde en grilla, el filtro en un
// selector (Santiago: antes eran 10 pestañas), íconos Lucide y sin emojis. Estados: pendiente en ámbar, en curso en brand-cyan,
// terminados en verde, rechazado en gris.
const ENCURSO = "bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20";
const ESTADO_LABEL = {
    PENDIENTE: { label: "Pendiente", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    APROBADA: { label: "Aprobada — falta empaquetar", cls: ENCURSO },
    EMPAQUETADA: { label: "Empaquetada — esperando remito a depósito", cls: ENCURSO },
    EN_DEPOSITO: { label: "En depósito — esperando que lo retiren", cls: ENCURSO },
    RECHAZADA: { label: "Rechazada", cls: "bg-zinc-100 text-zinc-500 border-zinc-200" },
    ENVIADA: { label: "Retirado", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    RESUELTA: { label: "Resuelta", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};
const CARD = "bg-white rounded-2xl border border-zinc-200";
const BTN_PRINCIPAL = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const BTN_SECUNDARIO = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50";

// Un dato de la tarjeta: rótulo chico arriba, valor abajo
const Dato = ({ rotulo, valor, mono = false }) => (
    <div className="min-w-0">
        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400 truncate">{rotulo}</dt>
        <dd className={`text-xs font-bold text-zinc-700 truncate ${mono ? "font-mono" : ""}`} title={valor}>{valor || "—"}</dd>
    </div>
);

// "hoy", "ayer", "hace 5 días" (con la fecha si pasó más de un mes)
const haceCuanto = (f) => {
    if (!f) return "—";
    const d = new Date(f);
    const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (dias <= 0) return "Entró hoy";
    if (dias === 1) return "Entró ayer";
    if (dias < 31) return `Entró hace ${dias} días`;
    return `Entró el ${d.toLocaleDateString('es-UY')}`;
};

const TIPO_LABEL = {
    SOLICITUD_CLIENTE: "Solicitud",
    AVISO_EXCEDENTE: "Aviso de excedente",
};

// "Abiertos" agrupa lo que todavía necesita alguna acción (incluye ENVIADA:
// recién procesada, puede hacer falta reimprimir la etiqueta).
const FILTROS = [
    { key: "ABIERTOS", label: "Abiertos", estados: ["PENDIENTE", "APROBADA", "EMPAQUETADA", "EN_DEPOSITO", "ENVIADA"] },
    { key: "ESCALADOS", label: "Sin respuesta", predicate: e => e.Escalado },
    { key: "PENDIENTE", label: "Pendientes", estados: ["PENDIENTE"] },
    { key: "APROBADA", label: "Aprobadas", estados: ["APROBADA"] },
    { key: "EMPAQUETADA", label: "Esperando depósito", estados: ["EMPAQUETADA"] },
    { key: "EN_DEPOSITO", label: "Esperando que lo retiren", estados: ["EN_DEPOSITO"] },
    { key: "ENVIADA", label: "Retiradas", estados: ["ENVIADA"] },
    { key: "RECHAZADA", label: "Rechazadas", estados: ["RECHAZADA"] },
    { key: "RESUELTA", label: "Resueltas", estados: ["RESUELTA"] },
    { key: "TODOS", label: "Todos", estados: null },
];

/**
 * Bandeja única de TelaClienteEventos: solicitudes del cliente (portal o
 * bobina interna) para devolver/descartar excedente, y avisos de excedente
 * detectados por umbral (backend/jobs/telaClienteExcedente.job.js).
 */
const BandejaDevolucionesTelaPanel = () => {
    const [eventos, setEventos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [filtro, setFiltro] = useState("ABIERTOS");

    const cargar = async () => {
        setLoading(true);
        try {
            const res = await telaClienteService.getBandeja();
            let data = res.data || [];
            const def = FILTROS.find(f => f.key === filtro);
            if (def?.predicate) data = data.filter(def.predicate);
            else if (def?.estados) data = data.filter(e => def.estados.includes(e.Estado));
            setEventos(data);
        } catch (e) {
            toast.error("Error cargando la bandeja: " + (e?.message || ""));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { cargar(); }, [filtro]);

    const imprimirEtiqueta = (ev) => {
        if (!ev.BultoCodigoQR) {
            toast.error("Esta devolución todavía no tiene etiqueta generada.");
            return;
        }
        printLabels([{
            qrCode: ev.BultoCodigoQR,
            orderCode: ev.CodigoOrden,
            orderPrefix: "",
            retiroCode: ev.CodigoRetiro,
            client: ev.NombreCliente,
            job: ev.DescripcionTrabajo,
            area: "DEPOSITO",
            bultoIndex: 1,
            totalBultos: 1,
            nextService: ev.ModoRetiro === "ENCOMIENDA" ? "ENCOMIENDA" : "RETIRO LOCAL",
        }]);
    };

    const accionar = async (fn, tevId, successMsg) => {
        setBusyId(tevId);
        try {
            await fn(tevId);
            toast.success(successMsg);
            cargar();
        } catch (e) {
            toast.error(e?.response?.data?.error || "Error al procesar");
        } finally {
            setBusyId(null);
        }
    };

    // Empaquetar SOLO genera la orden + el bulto y lo imprime — igual que
    // cualquier orden normal. El retiro real y el aviso al cliente salen
    // recién cuando ese bulto se reciba de verdad en depósito por el remito
    // de siempre (logisticsController.receiveDispatch → finalizarLlegadaDeposito).
    const empaquetar = async (ev) => {
        setBusyId(ev.TevID);
        try {
            const res = await telaClienteService.empaquetarDevolucion(ev.TevID);
            toast.success(`${res.codigoOrden} armado — falta incluirlo en un remito a depósito para que salga.`, { duration: 8000 });
            printLabels([{
                qrCode: res.qrString,
                orderCode: res.codigoOrden,
                orderPrefix: "",
                client: res.nombreCliente,
                job: res.descTrabajo,
                area: res.areaOrigen,
                bultoIndex: 1,
                totalBultos: 1,
                nextService: "DEPOSITO",
            }]);
            cargar();
        } catch (e) {
            toast.error(e?.response?.data?.error || "Error al empaquetar");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                {/* Filtro en un selector (antes 10 pestañas) */}
                <div className="flex-1 sm:flex-none sm:w-72">
                    <Selector filtro className="w-full" aria-label="Filtrar devoluciones" value={filtro} onChange={e => setFiltro(e.target.value)} altoMax={480}>
                        {FILTROS.map(f => (
                            <option key={f.key} value={f.key}>
                                {f.key === "ESCALADOS"
                                    ? <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-rose-500" />{f.label}</span>
                                    : f.label}
                            </option>
                        ))}
                    </Selector>
                </div>
                <button type="button" onClick={cargar} disabled={loading} className={`${BTN_SECUNDARIO} py-2`} title="Actualizar" aria-label="Actualizar">
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            {loading && (
                <div className={`${CARD} flex flex-col items-center justify-center py-12 gap-3`}>
                    <Loader2 size={30} className="animate-spin text-brand-cyan" />
                    <p className="text-sm text-zinc-400">Cargando...</p>
                </div>
            )}

            {!loading && eventos.length === 0 && (
                <div className={`${CARD} flex flex-col items-center justify-center py-14 gap-2 px-4 text-center`}>
                    <Inbox size={40} className="text-zinc-200" />
                    <p className="text-sm text-zinc-400">No hay eventos {filtro !== "TODOS" ? `en "${FILTROS.find(f => f.key === filtro)?.label}"` : ""}.</p>
                </div>
            )}

            {/* Tarjetas en grilla (antes una fila por evento a todo el ancho) */}
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                {eventos.map(ev => {
                    const est = ESTADO_LABEL[ev.Estado] || { label: ev.Estado, cls: "bg-zinc-100 text-zinc-600 border-zinc-200" };
                    const busy = busyId === ev.TevID;
                    return (
                        <div key={ev.TevID} className={`${CARD} p-4 flex flex-col gap-3`}>
                            {/* Tipo (y qué pidió) a la izquierda, estado a la derecha */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-zinc-400">
                                    {ev.Tipo === "AVISO_EXCEDENTE"
                                        ? <Bell className="w-3.5 h-3.5 shrink-0 text-brand-cyan" />
                                        : <Undo2 className="w-3.5 h-3.5 shrink-0 text-brand-cyan" />}
                                    <span className="font-black uppercase tracking-wide truncate">{TIPO_LABEL[ev.Tipo] || ev.Tipo}</span>
                                    {ev.Accion && <span className="shrink-0">· {ev.Accion === "DEVOLVER" ? "Devolver" : "Descartar"}</span>}
                                    {ev.Canal && <span className="shrink-0">· {ev.Canal === "ENCOMIENDA" ? "Encomienda" : "Retiro local"}</span>}
                                </div>
                                <span className={`shrink-0 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${est.cls}`}>{est.label}</span>
                            </div>

                            <div className="min-w-0">
                                <p className="font-black text-zinc-800 leading-snug">{ev.NombreCliente} — {ev.TipoTela}</p>
                                {ev.Observaciones && <p className="text-xs text-zinc-500 italic mt-0.5">"{ev.Observaciones}"</p>}
                            </div>

                            {/* Datos con su rótulo, en vez de una sola línea con puntos */}
                            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5">
                                <Dato rotulo="Bobina" valor={ev.CodigoEtiqueta} mono />
                                <Dato rotulo="Metros" valor={`${(parseFloat(ev.MetrosInvolucrados) || 0).toFixed(2)} m`} />
                                <Dato rotulo="Estado bobina" valor={ev.EstadoBobina} />
                                {ev.CodigoOrden && <Dato rotulo="Orden" valor={ev.CodigoOrden} mono />}
                                {ev.CodigoRetiro && <Dato rotulo="Retiro" valor={ev.CodigoRetiro} mono />}
                                {ev.ReceptorNombre && <Dato rotulo="Retira" valor={ev.ReceptorNombre} />}
                                {ev.Tipo === "AVISO_EXCEDENTE" && ev.Estado === "ENVIADA" && ev.FechaResolucion && (
                                    <Dato rotulo="Avisado" valor={new Date(ev.FechaResolucion).toLocaleDateString('es-UY')} />
                                )}
                            </dl>

                            {ev.Escalado && (
                                <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    Sin respuesta{ev.FechaEscalado ? ` desde el ${new Date(ev.FechaEscalado).toLocaleDateString('es-UY')}` : ''} — llamar al cliente
                                </div>
                            )}

                            {/* Pie: cuándo entró a la bandeja + acciones */}
                            <div className="flex items-center justify-between gap-2 flex-wrap mt-auto pt-1">
                                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400" title={ev.FechaCreacion ? new Date(ev.FechaCreacion).toLocaleString('es-UY') : undefined}>
                                    <Clock className="w-3 h-3" /> {haceCuanto(ev.FechaCreacion)}
                                </span>
                                <div className="flex gap-2 flex-wrap justify-end">
                                {ev.Tipo === "SOLICITUD_CLIENTE" && ev.Estado === "PENDIENTE" && (
                                    <>
                                        <button type="button" disabled={busy} onClick={() => accionar(telaClienteService.aprobarEvento, ev.TevID, "Aprobada.")}
                                            className={BTN_PRINCIPAL}>
                                            <CheckCircle2 className="w-3.5 h-3.5" /> Aprobar
                                        </button>
                                        <button type="button" disabled={busy} onClick={() => accionar((id) => telaClienteService.rechazarEvento(id), ev.TevID, "Rechazada.")}
                                            className={`${BTN_SECUNDARIO} hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50`}>
                                            <XCircle className="w-3.5 h-3.5" /> Rechazar
                                        </button>
                                    </>
                                )}
                                {ev.Tipo === "SOLICITUD_CLIENTE" && ev.Accion === "DEVOLVER" && ev.Estado === "APROBADA" && (
                                    <button
                                        type="button"
                                        disabled={busy || !["Disponible", "Pendiente"].includes(ev.EstadoBobina)}
                                        title={!["Disponible", "Pendiente"].includes(ev.EstadoBobina) ? "La tela todavía está en uso — esperá a que se libere" : ""}
                                        onClick={() => empaquetar(ev)}
                                        className={BTN_PRINCIPAL}
                                    >
                                        <PackageCheck className="w-3.5 h-3.5" /> Empaquetar
                                    </button>
                                )}
                                {ev.Tipo === "SOLICITUD_CLIENTE" && ["EMPAQUETADA", "EN_DEPOSITO", "ENVIADA"].includes(ev.Estado) && (
                                    <button type="button" onClick={() => imprimirEtiqueta(ev)} className={BTN_SECUNDARIO}>
                                        <Printer className="w-3.5 h-3.5 text-brand-cyan" /> Imprimir etiqueta {ev.CodigoOrden}
                                    </button>
                                )}
                                {ev.Tipo === "AVISO_EXCEDENTE" && ev.Estado === "PENDIENTE" && (
                                    <button type="button" disabled={busy} onClick={() => accionar(telaClienteService.marcarAvisoEnviado, ev.TevID, "Marcado como avisado.")}
                                        className={BTN_SECUNDARIO}>
                                        <Send className="w-3.5 h-3.5 text-brand-cyan" /> Marcar avisado
                                    </button>
                                )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default BandejaDevolucionesTelaPanel;
