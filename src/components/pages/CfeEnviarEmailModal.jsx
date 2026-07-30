import React, { useState, useEffect } from 'react';
import { Mail, X, AlertTriangle, Send, Paperclip, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../services/apiClient';
import { generarPdfFacturaDGI } from '../../utils/pdfGenerator';
import { parsearNumeroOficialCfe, etiquetaNumeroDocumento } from '../../utils/numeroCfe';

/**
 * Modal de envío del comprobante por email.
 *
 * Regla de diseño: el destinatario NUNCA se resuelve solo. Se muestran las dos
 * direcciones que tiene el sistema (la de la ficha y la del alta web), se dice de
 * dónde sale cada una, y el operador confirma o la corrige antes de mandar. El mail
 * del alta web a veces es el de quien dio de alta al cliente y no el del cliente
 * (caso Consumidor Final), así que elegir en silencio mandaría datos fiscales de un
 * tercero a la casilla equivocada, sin forma de deshacerlo.
 */
const CfeEnviarEmailModal = ({ doc, onClose, onEnviado }) => {
    const emailFicha  = (doc?.CliEmail || '').trim();
    const emailPortal = (doc?.CliEmailPortal || '').trim();

    const [destinatario, setDestinatario] = useState(emailFicha || emailPortal || '');
    const [mensaje, setMensaje] = useState('');
    const [enviando, setEnviando] = useState(false);

    useEffect(() => {
        setDestinatario(emailFicha || emailPortal || '');
    }, [doc?.DocIdDocumento]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!doc) return null;

    const tipoDoc   = String(doc.DocTipo || 'Documento').trim();
    // Si ya está emitido, se muestra el número de DGI (el que el cliente tiene en el
    // PDF), no el interno. Ver src/utils/numeroCfe.js.
    const oficial   = parsearNumeroOficialCfe(doc);
    const numeroDoc = etiquetaNumeroDocumento(doc);
    const cliente   = (doc.DocCliNombre || doc.CliNombreFantasia || doc.CliRazonSocial || '').trim();
    const noEmitido = doc.CfeEstado !== 'ACEPTADO_DGI';
    const sinEmail  = !emailFicha && !emailPortal;
    const emailValido = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(destinatario.trim());

    // Etiqueta de origen: si el operador escribió otra cosa, se dice explícitamente.
    const origen = destinatario.trim() === emailFicha  ? 'de la ficha del cliente'
                 : destinatario.trim() === emailPortal ? 'del alta web del portal'
                 : 'escrita a mano';

    const handleEnviar = async () => {
        if (!emailValido) return;
        setEnviando(true);
        const toastId = toast.loading('Generando el PDF y enviando...');
        try {
            // Se pide el documento COMPLETO (trae los datos de la empresa emisora, que
            // el listado no tiene) y se dibuja el mismo PDF que descarga el operador.
            const { data } = await api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`);
            if (!data?.doc) throw new Error('No se pudo obtener el documento.');

            const pdf = await generarPdfFacturaDGI(data.doc, data.detalles || [], { retornarBase64: true });
            if (!pdf?.base64) throw new Error('No se pudo generar el PDF.');

            const { data: resp } = await api.post(
                `/contabilidad/cfe/documentos/${doc.DocIdDocumento}/enviar-email`,
                { destinatario: destinatario.trim(), pdfBase64: pdf.base64, mensaje: mensaje.trim() || undefined }
            );

            toast.dismiss(toastId);
            if (resp.simulado) {
                toast.warning(`El mail NO salió: no hay credenciales de correo cargadas en el servidor. (Destinatario: ${resp.destinatario})`, { duration: 8000 });
            } else {
                toast.success(`Comprobante enviado a ${resp.destinatario}`);
            }
            onEnviado?.(resp);
            onClose();
        } catch (err) {
            toast.dismiss(toastId);
            toast.error('No se pudo enviar: ' + (err.response?.data?.error || err.message));
        } finally {
            setEnviando(false);
        }
    };

    const ChipEmail = ({ valor, etiqueta }) => (
        <button
            type="button"
            onClick={() => setDestinatario(valor)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors text-left ${
                destinatario.trim() === valor
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300'
            }`}
            title={`Usar ${valor}`}
        >
            <span className="block opacity-70">{etiqueta}</span>
            <span className="block font-bold">{valor}</span>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-zinc-900/60 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-zinc-100">

                <div className="px-5 py-4 flex justify-between items-center border-b border-zinc-100">
                    <h3 className="text-[15px] font-bold text-zinc-800 flex items-center gap-2">
                        <Mail size={18} className="text-blue-600" />
                        Enviar comprobante por email
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-400">
                        <X size={16} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Qué se va a mandar */}
                    <div className="bg-zinc-50 rounded-xl p-3 text-sm">
                        <div className="flex items-center gap-2 text-zinc-700 font-semibold">
                            <Paperclip size={14} className="text-zinc-400" />
                            Se adjunta el PDF de <span className="text-zinc-900">{tipoDoc} {numeroDoc}</span>
                        </div>
                        {oficial && (
                            <div className="text-xs text-zinc-500 mt-1 pl-6">
                                Número de DGI — es el que figura en el comprobante del cliente
                                {oficial.cae && <span className="text-zinc-400"> · CAE {oficial.cae}</span>}
                            </div>
                        )}
                        {cliente && <div className="text-xs text-zinc-500 mt-1 pl-6">Cliente: {cliente}</div>}
                    </div>

                    {noEmitido && (
                        <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800 leading-relaxed">
                                Este documento está en estado <strong>{doc.CfeEstado || 'sin estado'}</strong>: todavía
                                no fue aceptado por DGI. Si lo mandás ahora, el cliente recibe un comprobante que aún
                                no es definitivo.
                            </p>
                        </div>
                    )}

                    {/* Destinatario */}
                    <div>
                        <label className="block text-xs font-bold text-zinc-600 mb-1.5">Enviar a</label>
                        <input
                            type="email"
                            value={destinatario}
                            onChange={(e) => setDestinatario(e.target.value)}
                            placeholder="cliente@ejemplo.com"
                            className={`w-full px-3 py-2 rounded-xl border text-sm outline-none transition-colors ${
                                destinatario && !emailValido
                                    ? 'border-red-300 focus:border-red-400 bg-red-50/40'
                                    : 'border-zinc-200 focus:border-blue-400'
                            }`}
                        />
                        {destinatario && !emailValido && (
                            <p className="text-[11px] text-red-600 mt-1">
                                No es una dirección válida. Tiene que ser del tipo nombre@dominio.com
                            </p>
                        )}
                        {destinatario && emailValido && (
                            <p className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
                                <CheckCircle size={11} className="text-green-600" />
                                Dirección {origen}
                            </p>
                        )}
                    </div>

                    {/* Direcciones conocidas */}
                    {sinEmail ? (
                        <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800 leading-relaxed">
                                Este cliente no tiene ningún email cargado. Escribí la dirección a mano — y si es la
                                que va a usar siempre, cargala en su ficha.
                            </p>
                        </div>
                    ) : (
                        <div>
                            <p className="text-[11px] text-zinc-500 mb-1.5">Direcciones que tiene este cliente:</p>
                            <div className="flex flex-wrap gap-2">
                                {emailFicha && <ChipEmail valor={emailFicha} etiqueta="Ficha del cliente" />}
                                {emailPortal && emailPortal !== emailFicha && <ChipEmail valor={emailPortal} etiqueta="Alta web del portal" />}
                            </div>
                        </div>
                    )}

                    {/* Mensaje opcional */}
                    <div>
                        <label className="block text-xs font-bold text-zinc-600 mb-1.5">
                            Mensaje <span className="font-normal text-zinc-400">(opcional)</span>
                        </label>
                        <textarea
                            rows={2}
                            value={mensaje}
                            onChange={(e) => setMensaje(e.target.value)}
                            placeholder="Te adjuntamos tu comprobante en PDF."
                            className="w-full px-3 py-2 rounded-xl border border-zinc-200 focus:border-blue-400 text-sm outline-none resize-none"
                        />
                    </div>
                </div>

                <div className="px-5 py-4 border-t border-zinc-100 flex gap-2 justify-end bg-zinc-50/50">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-500 hover:bg-zinc-100">
                        Cancelar
                    </button>
                    <button
                        onClick={handleEnviar}
                        disabled={!emailValido || enviando}
                        className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <Send size={14} />
                        {enviando ? 'Enviando...' : `Enviar a ${destinatario.trim() || '...'}`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CfeEnviarEmailModal;
