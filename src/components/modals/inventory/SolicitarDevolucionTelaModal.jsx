import React, { useState } from "react";
import { createPortal } from "react-dom";
import { X, PackageCheck, Trash2, Undo2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { telaClienteService } from "../../../services/modules/telaClienteService";
import { printLabels } from "../../../utils/labelPrinter";

/**
 * Modal chico: devolver o descartar el excedente de UNA bobina, en el momento.
 * Desde el 29/10/2026 lo de adentro no pasa por la Bandeja de devoluciones:
 *  - Devolver: aprueba y empaqueta de una — cierra la bobina, arma la orden DEV-<n> con su bulto e imprime la
 *    etiqueta. Después el bulto va a depósito en un remito, como cualquier orden. Cómo se la devolvemos (Retiro
 *    en el local / Encomienda) lo elige el cliente al retirar, por el circuito normal de retiros.
 *  - Descartar: cierra la bobina en el momento, sin bulto ni entrega.
 * Usable desde la vista interna (TelaClienteInventarioPage). El portal usa su
 * propio flujo en RecursosView.jsx contra /web-recursos, que sí va a la bandeja.
 *
 * Estética nueva (22/10/2026): modal blanco redondeado encima de la barra de arriba (z-[6000]; antes z-50),
 * «Devolver» elegido en brand-cyan y «Descartar» en rojo.
 */
const SolicitarDevolucionTelaModal = ({ bobina, clienteId, onClose, onSuccess }) => {
    const [accion, setAccion] = useState("DEVOLVER");
    const [observaciones, setObservaciones] = useState("");
    const [loading, setLoading] = useState(false);
    const metros = (parseFloat(bobina.MetrosRestantes) || 0).toFixed(2);
    // Con la tela puesta en una máquina no se puede cerrar la bobina para empaquetarla (el servidor lo frena igual).
    const enUso = accion === "DEVOLVER" && !["Disponible", "Pendiente"].includes(bobina.Estado);

    const submit = async () => {
        setLoading(true);
        try {
            const res = await telaClienteService.devolverDesdeInventario(clienteId, bobina.BobinaID, { accion, observaciones });
            if (accion === "DEVOLVER") {
                // Misma etiqueta que el «Empaquetar» de la bandeja. El QR lleva solo el código del bulto
                // (DEV-n/B1), como cualquier bulto: es lo que busca Recepción al escanear el remito.
                printLabels([{
                    qrCode: res.codigoBulto,
                    orderCode: res.codigoOrden,
                    orderPrefix: "",
                    client: res.idCliente || res.nombreCliente,
                    clientName: res.nombreCliente,
                    job: res.descTrabajo,
                    area: res.areaOrigen,
                    bultoIndex: 1,
                    totalBultos: 1,
                    nextService: "DEPOSITO",
                }]);
                toast.success(`${res.codigoOrden} armado y etiqueta impresa. ${bobina.CodigoEtiqueta} quedó cerrada. Falta mandar el bulto a depósito en un remito.`, { duration: 10000 });
            } else {
                toast.success(`${bobina.CodigoEtiqueta} descartada: se cerró con ${metros} m como descarte.`, { duration: 8000 });
            }
            onSuccess?.();
            onClose();
        } catch (err) {
            toast.error(err?.response?.data?.error || (accion === "DEVOLVER" ? "Error al empaquetar la devolución" : "Error al descartar la tela"));
        } finally {
            setLoading(false);
        }
    };

    // En portal: si no, queda dentro de la capa de la página y no tapa la barra de arriba ni la lateral
    return createPortal(
        <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto font-sans text-zinc-800">
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100">
                    <div className="flex items-start gap-3 min-w-0">
                        <Undo2 className="w-6 h-6 shrink-0 text-brand-cyan mt-0.5" aria-hidden="true" />
                        <div className="min-w-0">
                            <h3 className="font-black text-zinc-800 leading-tight">Excedente de tela</h3>
                            <span className="inline-block mt-1 font-mono text-xs font-bold bg-zinc-100 text-zinc-700 px-1.5 py-0.5 border border-zinc-200 rounded">{bobina.CodigoEtiqueta}</span>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors" aria-label="Cerrar">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-sm text-zinc-500">
                        Quedan <b className="text-zinc-800 tabular-nums">{metros} m</b> de {bobina.DescripcionTela || bobina.TipoTela}.
                        ¿Qué hacemos con esta tela?
                    </p>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setAccion("DEVOLVER")}
                            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors ${
                                accion === "DEVOLVER" ? "border-brand-cyan bg-brand-cyan/5 text-brand-cyan" : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                            }`}
                        >
                            <PackageCheck className="w-4 h-4" /> Devolver
                        </button>
                        <button
                            type="button"
                            onClick={() => setAccion("DESCARTAR")}
                            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors ${
                                accion === "DESCARTAR" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                            }`}
                        >
                            <Trash2 className="w-4 h-4" /> Descartar
                        </button>
                    </div>

                    {accion === "DEVOLVER" && !enUso && (
                        <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                            Al tocar el botón se cierra la bobina, se arma la orden <b>DEV</b> con su bulto y se imprime la etiqueta. No pasa por la Bandeja de devoluciones.
                            Después mandá el bulto a depósito en un remito, como cualquier orden. Cómo se la devolvemos (retiro en el local o encomienda) lo elige el cliente al retirar.
                        </p>
                    )}

                    {enUso && (
                        <p className="flex items-start gap-2 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                            <span>La bobina está «{bobina.Estado}»: una orden la está usando. Esperá a que se libere para empaquetar la devolución.</span>
                        </p>
                    )}

                    {accion === "DESCARTAR" && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                            Al tocar el botón la bobina se cierra en el momento, con los {metros} m como descarte. No genera bulto ni entrega y no se puede deshacer. Dejá constancia abajo de que el cliente autorizó el descarte.
                        </p>
                    )}

                    <div>
                        <label className="block text-[11px] font-black text-zinc-400 uppercase tracking-wide mb-1.5">Observaciones (opcional)</label>
                        <textarea
                            value={observaciones}
                            onChange={e => setObservaciones(e.target.value)}
                            rows={2}
                            className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none transition-colors focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                            placeholder="Ej: cliente lo confirmó por WhatsApp el 17/09"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-100">
                    <button type="button" onClick={onClose} className="inline-flex items-center px-4 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors">Cancelar</button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={loading || enUso}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            accion === "DESCARTAR" ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-cyan hover:bg-brand-cyan/90"}`}
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : accion === "DESCARTAR" ? <Trash2 className="w-4 h-4" /> : <PackageCheck className="w-4 h-4" />}
                        {loading
                            ? (accion === "DESCARTAR" ? "Descartando..." : "Empaquetando...")
                            : (accion === "DESCARTAR" ? "Descartar y cerrar la bobina" : "Empaquetar e imprimir etiqueta")}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default SolicitarDevolucionTelaModal;
