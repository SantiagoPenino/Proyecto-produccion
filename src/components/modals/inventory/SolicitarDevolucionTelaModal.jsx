import React, { useState } from "react";
import { createPortal } from "react-dom";
import { X, PackageCheck, Trash2, Undo2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { telaClienteService } from "../../../services/modules/telaClienteService";

/**
 * Modal chico: pedir devolución o descarte del excedente de UNA bobina.
 * Solo pide la decisión (Devolver/Descartar) — cómo se la devolvemos (Retiro
 * en el local / Encomienda) y la dirección se definen recién cuando el
 * cliente la retira de verdad, por el circuito normal de retiros (portal,
 * tótem o WebRetirosPage), igual que cualquier otra orden.
 * Usable desde la vista interna (TelaClienteInventarioPage). El portal usa su
 * propio flujo equivalente en RecursosView.jsx contra /web-recursos.
 *
 * Estética nueva (22/10/2026): modal blanco redondeado encima de la barra de arriba (z-[6000]; antes z-50),
 * «Devolver» elegido en brand-cyan y «Descartar» en rojo, «Enviar a la bandeja» en brand-cyan.
 */
const SolicitarDevolucionTelaModal = ({ bobina, clienteId, onClose, onSuccess }) => {
    const [accion, setAccion] = useState("DEVOLVER");
    const [observaciones, setObservaciones] = useState("");
    const [loading, setLoading] = useState(false);

    const submit = async () => {
        setLoading(true);
        try {
            await telaClienteService.solicitarDevolucion(clienteId, bobina.BobinaID, { accion, observaciones });
            toast.success(accion === "DEVOLVER" ? "Solicitud de devolución enviada a la bandeja." : "Solicitud de descarte enviada a la bandeja.");
            onSuccess?.();
            onClose();
        } catch (err) {
            toast.error(err?.response?.data?.error || "Error al enviar la solicitud");
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
                        Quedan <b className="text-zinc-800 tabular-nums">{(parseFloat(bobina.MetrosRestantes) || 0).toFixed(2)} m</b> de {bobina.DescripcionTela || bobina.TipoTela}.
                        ¿Qué querés pedir para el cliente?
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

                    {accion === "DEVOLVER" && (
                        <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                            Cómo se la devolvemos (retiro en el local o encomienda) y la dirección se definen recién cuando el cliente la retira, igual que cualquier otro pedido.
                        </p>
                    )}

                    {accion === "DESCARTAR" && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                            Al aprobarse, la bobina se cierra directo — no genera bulto ni entrega. Dejá constancia de que el cliente autorizó el descarte abajo.
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
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-brand-cyan hover:bg-brand-cyan/90 transition-colors disabled:opacity-40"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        {loading ? "Enviando..." : "Enviar a la bandeja"}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default SolicitarDevolucionTelaModal;
