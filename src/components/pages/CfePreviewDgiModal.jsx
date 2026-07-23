import React, { useState, useEffect } from 'react';
import { X, Send, AlertTriangle, Loader2, FileCheck2, Link2, User, Building2 } from 'lucide-react';
import api from '../../services/apiClient';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Qué significa cada código de CFE ante la DGI, en criollo.
const EXPLICA_CFE = {
    101: 'Venta a consumidor final. SUMA ventas e IVA.',
    111: 'Venta a empresa con RUT. SUMA ventas e IVA.',
    102: 'Devuelve/anula un e-Ticket. RESTA ventas e IVA.',
    112: 'Devuelve/anula una e-Factura. RESTA ventas e IVA.',
    103: 'Cobra de más sobre un e-Ticket. SUMA ventas e IVA.',
    113: 'Cobra de más sobre una e-Factura. SUMA ventas e IVA.',
};

const Fila = ({ label, children }) => (
    <div className="flex gap-3 py-1.5 text-sm border-b border-gray-100 last:border-0">
        <div className="w-44 shrink-0 text-gray-500">{label}</div>
        <div className="flex-1 text-gray-900 font-medium break-words">{children}</div>
    </div>
);

const Seccion = ({ icon: Icon, titulo, children }) => (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-3 py-2 flex items-center gap-2 border-b border-gray-200">
            <Icon size={15} className="text-gray-500" />
            <span className="text-xs font-bold uppercase tracking-wide text-gray-600">{titulo}</span>
        </div>
        <div className="px-3 py-2">{children}</div>
    </div>
);

/**
 * Muestra el CFE exacto que se le va a pedir a la DGI para un documento, ANTES de emitirlo.
 * El backend lo arma con la misma función que usa el envío real (sisnetService.prepararCFE),
 * así que lo que se ve acá es lo que efectivamente viaja. Abrir esta ventana no emite nada.
 */
export default function CfePreviewDgiModal({ doc, onClose, onConfirmarEnvio, enviando }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let vivo = true;
        setLoading(true);
        api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/preview-dgi`)
            .then(res => { if (vivo) { setData(res.data); setError(''); } })
            .catch(err => { if (vivo) setError(err.response?.data?.error || err.message); })
            .finally(() => { if (vivo) setLoading(false); });
        return () => { vivo = false; };
    }, [doc.DocIdDocumento]);

    const bloqueado = !!(data?.bloqueos?.length);
    const esNCoND = data?.cfe?.esNC || data?.cfe?.esND;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-3 border-b">
                    <div className="flex items-center gap-2">
                        <FileCheck2 size={18} className="text-blue-600" />
                        <div>
                            <h3 className="font-bold text-gray-900">Documento a emitir ante DGI</h3>
                            <p className="text-xs text-gray-500">
                                {doc.DocSerie}-{doc.DocNumero} · Vista previa: abrir esta ventana no envía nada
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {loading && (
                        <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
                            <Loader2 className="animate-spin" size={18} /> Armando el CFE…
                        </div>
                    )}

                    {!loading && error && (
                        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">
                            No se pudo generar la vista previa: {error}
                        </div>
                    )}

                    {!loading && data && (
                        <>
                            {/* Lo más importante: qué tipo de comprobante se le pide a DGI */}
                            <div className={`rounded-lg p-4 border-2 ${esNCoND ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-200'}`}>
                                <div className="text-xs uppercase tracking-wide text-gray-600 font-bold mb-1">
                                    Se le pedirá a la DGI un CFE tipo
                                </div>
                                <div className="text-2xl font-black text-gray-900">
                                    {data.cfe.tipoCFE} — {data.cfe.nombre}
                                </div>
                                <div className="text-sm text-gray-700 mt-1">
                                    {EXPLICA_CFE[data.cfe.tipoCFE] || ''}
                                </div>
                                <div className="text-xs text-gray-500 mt-2">
                                    Tipo guardado en el sistema: <code className="bg-white px-1 rounded border">{data.documento.docTipo}</code>
                                    {' · '}familia {data.cfe.familia}
                                </div>
                            </div>

                            {bloqueado && (
                                <div className="bg-red-50 border border-red-300 rounded-lg p-3">
                                    <div className="flex items-center gap-2 text-red-800 font-bold text-sm mb-1">
                                        <AlertTriangle size={16} /> No se puede emitir
                                    </div>
                                    <ul className="list-disc list-inside text-sm text-red-800 space-y-0.5">
                                        {data.bloqueos.map((b, i) => <li key={i}>{b}</li>)}
                                    </ul>
                                </div>
                            )}

                            {esNCoND && (
                                <Seccion icon={Link2} titulo="Documento que corrige (referencia exigida por DGI)">
                                    {data.referencia ? (
                                        <>
                                            <Fila label="Tipo referenciado">{data.referencia.tipo}</Fila>
                                            <Fila label="Serie y número">{data.referencia.serie} {data.referencia.numero}</Fila>
                                            <Fila label="Fecha">{data.referencia.fecha}</Fila>
                                            <Fila label="Monto original">{fmt(data.referencia.monto)}</Fila>
                                            <Fila label="Motivo">{data.referencia.razon}</Fila>
                                        </>
                                    ) : (
                                        <div className="text-sm text-red-700">Sin referencia. La DGI la exige para NC/ND.</div>
                                    )}
                                </Seccion>
                            )}

                            <Seccion icon={User} titulo="Receptor">
                                {data.receptor ? (
                                    <>
                                        <Fila label="Documento">
                                            {data.receptor.tipoDocRecep === 2 ? 'RUT' : 'CI'} {data.receptor.docRecep}
                                        </Fila>
                                        <Fila label="Razón social">{data.receptor.rznSocRecep}</Fila>
                                        <Fila label="Dirección">{data.receptor.dirRecep}, {data.receptor.ciudadRecep}</Fila>
                                    </>
                                ) : (
                                    <div className="text-sm text-gray-600">
                                        No se identifica al comprador (e-Ticket a consumidor final).
                                        {data.receptorValidacion?.motivo ? ` Motivo: ${data.receptorValidacion.motivo}` : ''}
                                    </div>
                                )}
                            </Seccion>

                            <Seccion icon={Building2} titulo="Emisor">
                                {data.emisor ? (
                                    <>
                                        <Fila label="Empresa">{data.emisor.nombre}</Fila>
                                        <Fila label="RUT">{data.emisor.rut}</Fila>
                                        <Fila label="Caja SISNET">{data.emisor.caja}</Fila>
                                    </>
                                ) : <div className="text-sm text-red-700">Sin empresa emisora configurada.</div>}
                            </Seccion>

                            <Seccion icon={FileCheck2} titulo={`Líneas (${data.lineas.length})`}>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-xs text-gray-500 border-b">
                                                <th className="py-1 pr-2">#</th>
                                                <th className="py-1 pr-2">Concepto</th>
                                                <th className="py-1 pr-2 text-right">Cant.</th>
                                                <th className="py-1 pr-2 text-right">P. unit.</th>
                                                <th className="py-1 pr-2 text-right">Monto</th>
                                                <th className="py-1 text-right">IVA</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.lineas.map(l => (
                                                <tr key={l.nroLinDet} className="border-b border-gray-50">
                                                    <td className="py-1 pr-2 text-gray-400">{l.nroLinDet}</td>
                                                    <td className="py-1 pr-2">{l.nomItem}</td>
                                                    <td className="py-1 pr-2 text-right">{l.cantidad}</td>
                                                    <td className="py-1 pr-2 text-right">{fmt(l.precioUnitario)}</td>
                                                    <td className="py-1 pr-2 text-right font-medium">{fmt(l.montoItem)}</td>
                                                    <td className="py-1 text-right text-xs text-gray-500">
                                                        {l.indFact === 3 ? 'Básica 22%' : l.indFact === 2 ? 'Mínima' : 'Exento'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Seccion>

                            <Seccion icon={FileCheck2} titulo="Totales que se declaran">
                                <Fila label="Moneda">
                                    {data.totales.tpoMoneda}
                                    {data.totales.tpoMoneda === 'USD' ? ` (tipo de cambio ${fmt(data.totales.tpoCambio)})` : ''}
                                </Fila>
                                <Fila label="Neto gravado 22%">{fmt(data.totales.mntNetoIvaTasaBasica)}</Fila>
                                <Fila label="IVA tasa básica">{fmt(data.totales.mntIVATasaBas)}</Fila>
                                <Fila label="No gravado">{fmt(data.totales.mntNoGrv)}</Fila>
                                <Fila label="TOTAL">
                                    <span className="text-base font-bold">{fmt(data.totales.mntTotal)} {data.totales.tpoMoneda}</span>
                                    {Math.abs(Number(data.totales.mntTotal) - Number(data.documento.total)) > 0.01 && (
                                        <span className="ml-2 text-xs text-amber-700">
                                            (el documento en el sistema dice {fmt(data.documento.total)})
                                        </span>
                                    )}
                                </Fila>
                                <Fila label="Fecha de emisión">{data.varios.fchEmis}</Fila>
                                <Fila label="Forma de pago">{data.varios.fmaPago === 1 ? 'Contado' : 'Crédito'}</Fila>
                            </Seccion>
                        </>
                    )}
                </div>

                <div className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
                    >
                        Cerrar sin enviar
                    </button>
                    {onConfirmarEnvio && (
                        <button
                            onClick={onConfirmarEnvio}
                            disabled={loading || bloqueado || !!error || enviando}
                            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                            title={bloqueado ? 'Corregí los problemas listados antes de enviar' : 'Emitir este CFE ante DGI'}
                        >
                            {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                            {data ? `Emitir como ${data.cfe.tipoCFE} ${data.cfe.nombre}` : 'Emitir a DGI'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
