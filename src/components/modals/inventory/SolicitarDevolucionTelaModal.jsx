import React, { useState } from "react";
import { X, PackageCheck, Trash2 } from "lucide-react";
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

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800">Excedente de tela — {bobina.CodigoEtiqueta}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-sm text-slate-500">
                        Quedan <b>{(parseFloat(bobina.MetrosRestantes) || 0).toFixed(2)} m</b> de {bobina.DescripcionTela || bobina.TipoTela}.
                        ¿Qué querés pedir para el cliente?
                    </p>

                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => setAccion("DEVOLVER")}
                            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold border-2 transition-colors ${
                                accion === "DEVOLVER" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"
                            }`}
                        >
                            <PackageCheck className="w-4 h-4" /> Devolver
                        </button>
                        <button
                            onClick={() => setAccion("DESCARTAR")}
                            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold border-2 transition-colors ${
                                accion === "DESCARTAR" ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-500"
                            }`}
                        >
                            <Trash2 className="w-4 h-4" /> Descartar
                        </button>
                    </div>

                    {accion === "DEVOLVER" && (
                        <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            Cómo se la devolvemos (retiro en el local o encomienda) y la dirección se definen recién cuando el cliente la retira, igual que cualquier otro pedido.
                        </p>
                    )}

                    {accion === "DESCARTAR" && (
                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            Al aprobarse, la bobina se cierra directo — no genera bulto ni entrega. Dejá constancia de que el cliente autorizó el descarte abajo.
                        </p>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Observaciones (opcional)</label>
                        <textarea
                            value={observaciones}
                            onChange={e => setObservaciones(e.target.value)}
                            rows={2}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                            placeholder="Ej: cliente lo confirmó por WhatsApp el 17/09"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-100">Cancelar</button>
                    <button
                        onClick={submit}
                        disabled={loading}
                        className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {loading ? "Enviando..." : "Enviar a la bandeja"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SolicitarDevolucionTelaModal;
