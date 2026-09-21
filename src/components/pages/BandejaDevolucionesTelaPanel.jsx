import React, { useState, useEffect } from "react";
import { CheckCircle2, XCircle, PackageCheck, RefreshCw, Send, Printer } from "lucide-react";
import { toast } from "sonner";
import { telaClienteService } from "../../services/modules/telaClienteService";
import { printLabels } from "../../utils/labelPrinter";

const ESTADO_LABEL = {
    PENDIENTE: { label: "Pendiente", cls: "bg-amber-100 text-amber-700" },
    APROBADA: { label: "Aprobada — falta empaquetar", cls: "bg-blue-100 text-blue-700" },
    EMPAQUETADA: { label: "Empaquetada — esperando remito a depósito", cls: "bg-purple-100 text-purple-700" },
    EN_DEPOSITO: { label: "En depósito — esperando que lo retiren", cls: "bg-cyan-100 text-cyan-700" },
    RECHAZADA: { label: "Rechazada", cls: "bg-slate-200 text-slate-500" },
    ENVIADA: { label: "Retirado", cls: "bg-green-100 text-green-700" },
    RESUELTA: { label: "Resuelta", cls: "bg-green-100 text-green-700" },
};

const TIPO_LABEL = {
    SOLICITUD_CLIENTE: "Solicitud",
    AVISO_EXCEDENTE: "Aviso de excedente",
};

// "Abiertos" agrupa lo que todavía necesita alguna acción (incluye ENVIADA:
// recién procesada, puede hacer falta reimprimir la etiqueta).
const FILTROS = [
    { key: "ABIERTOS", label: "Abiertos", estados: ["PENDIENTE", "APROBADA", "EMPAQUETADA", "EN_DEPOSITO", "ENVIADA"] },
    { key: "ESCALADOS", label: "⚠ Sin respuesta", predicate: e => e.Escalado },
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
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1 flex-wrap">
                    {FILTROS.map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFiltro(f.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                filtro === f.key ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200"
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <button onClick={cargar} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
                </button>
            </div>

            {loading && <div className="text-center py-10 text-slate-400 text-sm">Cargando...</div>}

            {!loading && eventos.length === 0 && (
                <div className="text-center py-16 text-slate-400 text-sm">No hay eventos {filtro !== "TODOS" ? `en "${FILTROS.find(f => f.key === filtro)?.label}"` : ""}.</div>
            )}

            <div className="space-y-2">
                {eventos.map(ev => {
                    const est = ESTADO_LABEL[ev.Estado] || { label: ev.Estado, cls: "bg-slate-100 text-slate-600" };
                    const busy = busyId === ev.TevID;
                    return (
                        <div key={ev.TevID} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${est.cls}`}>{est.label}</span>
                                    <span className="text-[10px] text-slate-400 font-semibold uppercase">{TIPO_LABEL[ev.Tipo] || ev.Tipo}</span>
                                    {ev.Accion && <span className="text-[10px] text-slate-400">· {ev.Accion === "DEVOLVER" ? "Devolver" : "Descartar"}</span>}
                                    {ev.Canal && <span className="text-[10px] text-slate-400">· {ev.Canal === "ENCOMIENDA" ? "Encomienda" : "Retiro local"}</span>}
                                    {ev.Escalado && (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700" title={`Sin respuesta desde ${ev.FechaEscalado ? new Date(ev.FechaEscalado).toLocaleDateString('es-UY') : ''} — llamar al cliente`}>
                                            ⚠ Sin respuesta — llamar
                                        </span>
                                    )}
                                </div>
                                <p className="font-bold text-slate-800 text-sm mt-1">{ev.NombreCliente} — {ev.TipoTela}</p>
                                <p className="text-xs text-slate-500">
                                    {ev.CodigoEtiqueta} · {(parseFloat(ev.MetrosInvolucrados) || 0).toFixed(2)} m · bobina {ev.EstadoBobina}
                                    {ev.CodigoOrden && <> · orden <b>{ev.CodigoOrden}</b></>}
                                    {ev.CodigoRetiro && <> · retiro <b>{ev.CodigoRetiro}</b></>}
                                    {ev.ReceptorNombre && <> · retira <b>{ev.ReceptorNombre}</b></>}
                                    {ev.Tipo === "AVISO_EXCEDENTE" && ev.Estado === "ENVIADA" && ev.FechaResolucion && (
                                        <> · avisado el {new Date(ev.FechaResolucion).toLocaleDateString('es-UY')}</>
                                    )}
                                    {ev.Observaciones && <> · "{ev.Observaciones}"</>}
                                </p>
                            </div>

                            <div className="flex gap-2 shrink-0">
                                {ev.Tipo === "SOLICITUD_CLIENTE" && ev.Estado === "PENDIENTE" && (
                                    <>
                                        <button disabled={busy} onClick={() => accionar(telaClienteService.aprobarEvento, ev.TevID, "Aprobada.")}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-50 hover:bg-green-100 text-green-700 text-xs font-bold border border-green-200 disabled:opacity-50">
                                            <CheckCircle2 className="w-3.5 h-3.5" /> Aprobar
                                        </button>
                                        <button disabled={busy} onClick={() => accionar((id) => telaClienteService.rechazarEvento(id), ev.TevID, "Rechazada.")}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold border border-red-200 disabled:opacity-50">
                                            <XCircle className="w-3.5 h-3.5" /> Rechazar
                                        </button>
                                    </>
                                )}
                                {ev.Tipo === "SOLICITUD_CLIENTE" && ev.Accion === "DEVOLVER" && ev.Estado === "APROBADA" && (
                                    <button
                                        disabled={busy || !["Disponible", "Pendiente"].includes(ev.EstadoBobina)}
                                        title={!["Disponible", "Pendiente"].includes(ev.EstadoBobina) ? "La tela todavía está en uso — esperá a que se libere" : ""}
                                        onClick={() => empaquetar(ev)}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-40"
                                    >
                                        <PackageCheck className="w-3.5 h-3.5" /> Empaquetar
                                    </button>
                                )}
                                {ev.Tipo === "SOLICITUD_CLIENTE" && ["EMPAQUETADA", "EN_DEPOSITO", "ENVIADA"].includes(ev.Estado) && (
                                    <button onClick={() => imprimirEtiqueta(ev)}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold">
                                        <Printer className="w-3.5 h-3.5" /> Imprimir etiqueta {ev.CodigoOrden}
                                    </button>
                                )}
                                {ev.Tipo === "AVISO_EXCEDENTE" && ev.Estado === "PENDIENTE" && (
                                    <button disabled={busy} onClick={() => accionar(telaClienteService.marcarAvisoEnviado, ev.TevID, "Marcado como avisado.")}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold border border-indigo-200 disabled:opacity-50">
                                        <Send className="w-3.5 h-3.5" /> Marcar avisado
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default BandejaDevolucionesTelaPanel;
