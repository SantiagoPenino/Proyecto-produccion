import React, { useState, useEffect } from 'react';
import { X, FileText, Printer } from 'lucide-react';
import api from '../../services/apiClient';
import { generarPdfFacturaDGI } from '../../utils/pdfGenerator';

export default function CfePreviewModal({ doc, onClose }) {
    const [detalles, setDetalles] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!doc) return;
        const fetchDetalles = async () => {
            try {
                const { data } = await api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`);
                setDetalles(data.detalles || []);
            } catch (err) {
                console.error("Error fetching detalles", err);
            } finally {
                setLoading(false);
            }
        };
        fetchDetalles();
    }, [doc]);

    if (!doc) return null;

    const esUYU = doc.MonIdMoneda === 1;
    const isE_Ticket = doc.DocTipo.includes('E-Ticket') || doc.DocTipo.includes('E-TICKET');

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60  flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <div className="flex items-center space-x-2">
                        <FileText className="w-5 h-5 text-blue-600" />
                        <h3 className="text-lg font-bold text-gray-800">
                            Vista Previa Documento
                        </h3>
                    </div>
                    <div className="flex space-x-2">
                        <button 
                            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors"
                            onClick={() => generarPdfFacturaDGI(doc, detalles)}
                            title="Descargar PDF"
                        >
                            <Printer className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Ticket Body */}
                <div className="p-8 overflow-y-auto bg-gray-100 flex-1 flex justify-center">
                    <div className="bg-white p-8 w-full max-w-sm shadow-sm font-mono text-sm border-t-4 border-gray-800 relative print:shadow-none print:max-w-none">
                        
                        <div className="text-center mb-6">
                            <h2 className="text-xl font-bold mb-1">USER S.A.</h2>
                            <p className="text-xs text-gray-500">RUT: 211111110015</p>
                            <p className="text-xs text-gray-500">Bulevar Artigas 1234, Montevideo</p>
                            <div className="mt-4 border-b border-dashed border-gray-300 pb-4">
                                <h3 className="font-bold text-lg uppercase">{doc.DocTipo}</h3>
                                <p className="font-bold">SERIE: {doc.DocSerie} NRO: {doc.DocNumero}</p>
                            </div>
                        </div>

                        <div className="mb-6 space-y-1">
                            <div className="flex justify-between">
                                <span className="text-gray-500">FECHA:</span>
                                <span>{new Date(doc.DocFechaEmision).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">ESTADO:</span>
                                <span className="bg-yellow-100 text-yellow-800 px-2 rounded-sm text-xs">{doc.CfeEstado}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">PAGADO:</span>
                                <span>{doc.DocPagado ? 'SI (Caja)' : 'NO (Crédito)'}</span>
                            </div>
                        </div>

                        <div className="border-y border-dashed border-gray-300 py-3 mb-6">
                            <p className="font-bold mb-1">CLIENTE:</p>
                            {/* Se muestra el receptor REAL del comprobante (datos DGI del documento).
                                Si se facturó a un tercero, el alias de la cuenta no corresponde. */}
                            <p>
                                {!doc.DocCliNombre && doc.StringIDCliente && <span className="font-bold mr-1">[{doc.StringIDCliente.trim()}]</span>}
                                {doc.DocCliNombre || doc.CliNombreFantasia || doc.CliRazonSocial || 'CONSUMIDOR FINAL'}
                            </p>
                            {doc.DocCliNombreFantasia && <p>NOMBRE FANTASÍA: {doc.DocCliNombreFantasia}</p>}
                            {(doc.DocCliDocumento || doc.CliRUT) && <p>RUT/CI: {doc.DocCliDocumento || doc.CliRUT}</p>}
                        </div>

                        <div className="mb-6">
                            <div className="border-b border-gray-800 font-bold mb-2 pb-1 text-xs grid grid-cols-12 gap-2">
                                <span className="col-span-8">DESCRIPCIÓN</span>
                                <span className="col-span-1 text-center">CANT</span>
                                <span className="col-span-3 text-right">SUBTOTAL</span>
                            </div>
                            
                            {loading ? (
                                <div className="text-center py-4 text-gray-500">Cargando detalle...</div>
                            ) : detalles.length > 0 ? (
                                detalles.map((d, i) => {
                                    const isHeader = (d.DcdCantidad == null && d.DcdSubtotal == null && d.DcdNomItem && d.DcdNomItem.startsWith('Orden:'));
                                    const isSubtotal = (d.DcdNomItem && d.DcdNomItem.startsWith('SUBTOTAL ORDEN'));

                                    if (isHeader) {
                                        return (
                                            <div key={i} className="mb-2 mt-4 pb-1 border-b border-gray-300 text-xs font-black text-indigo-700">
                                                {d.DcdNomItem}
                                            </div>
                                        );
                                    }

                                    if (isSubtotal) {
                                        return (
                                            <div key={i} className="mb-4 pt-1 flex justify-between text-xs font-bold text-gray-600">
                                                <span>{d.DcdNomItem}</span>
                                                <span>{esUYU ? '$' : 'US$'} {Number(d.DcdSubtotal).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={i} className="mb-3 pb-2 border-b border-dashed border-gray-200 last:border-0 text-xs">
                                            <div className="grid grid-cols-12 gap-2 items-start">
                                                <div className="col-span-8 font-semibold">
                                                    {d.DcdNomItem}
                                                </div>
                                                <div className="col-span-1 text-center">{Number(d.DcdCantidad)}</div>
                                                <div className="col-span-3 text-right">
                                                    {esUYU ? '$' : 'US$'} {Number(d.DcdSubtotal).toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                                                </div>
                                            </div>
                                            {d.DcdDscItem && (
                                                <div className="text-[10px] text-gray-500 mt-1 pl-1 leading-tight whitespace-pre-wrap">
                                                    {d.DcdDscItem}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="flex justify-between text-xs text-gray-600 py-2">
                                    <span>{isE_Ticket ? 'Por sus compras' : 'Servicios y Productos'}</span>
                                    <span>{esUYU ? '$' : 'US$'} {Number(doc.DocSubtotal).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                        </div>

                        <div className="border-t border-solid border-gray-300 pt-3 space-y-1 text-right">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Subtotal:</span>
                                <span>{Number(doc.DocSubtotal).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Impuestos (IVA):</span>
                                <span>{Number(doc.DocImpuestos).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between text-lg font-bold mt-2">
                                <span>TOTAL:</span>
                                <span>{esUYU ? '$' : 'US$'} {Number(doc.DocTotal).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
                            </div>
                        </div>

                        <div className="mt-8 text-center text-xs text-gray-400">
                            <p>DOCUMENTO NO VÁLIDO COMO FACTURA</p>
                            <p>PENDIENTE DE APROBACIÓN DGI</p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-xl text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 font-semibold transition-colors"
                    >
                        Cerrar Vista Previa
                    </button>
                </div>

            </div>
        </div>
    );
}
