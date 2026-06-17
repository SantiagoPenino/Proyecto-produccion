import React, { useState, useEffect } from 'react';
import { FileText, CheckCircle, AlertCircle, Search, Send, FileOutput, Plus, Edit, XCircle, Printer, Copy, RefreshCw, FileX, FilePlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import api from '../../services/apiClient';
import { generarPdfFacturaDGI } from '../../utils/pdfGenerator';
import FacturacionManualModal from './FacturacionManualModal';
import CfeNotaCreditoModal from './CfeNotaCreditoModal';

const getStatusBadge = (status) => {
    switch(status) {
        case 'PENDIENTE': return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-semibold">Pendiente DGI</span>;
        case 'ACEPTADO_DGI': return <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold">Aceptado DGI</span>;
        case 'RECHAZADO_DGI': return <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs font-semibold">Rechazado</span>;
        case 'BORRADOR': return <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs font-semibold">📋 Borrador</span>;
        default: return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded-full text-xs font-semibold">{status}</span>;
    }
};

const getTipoDocName = (tipo) => {
    const MAP = {
        // Códigos numéricos DGI
        '07': 'E-Ticket NC',  '08': 'E-Ticket Crédito',
        '10': 'E-Ticket NC',  '01': 'E-Ticket Contado',
        '02': 'E-Factura Crédito', '04': 'E-Factura NC',
        '107': 'E-Ticket Contado', '108': 'E-Ticket Crédito',
        '101': 'E-Factura Contado', '102': 'E-Factura Crédito',
        // Otros tipos
        'PedidoCaja': 'Pedido Caja', 'PC': 'Pedido Caja', 'Pedidos Caja': 'Pedido Caja',
        'FACTURA': 'E-Factura Crédito', 'E-TICKET': 'E-Ticket Contado',
        'FACTURA_CICLO': 'Edo. Cuenta',
        'NOTA_CREDITO': 'E-Ticket NC', 'NOTA_DEBITO': 'E-Ticket ND',
        // Valores tal cual vienen de Config_TiposDocumento.Detalle
        'E-Ticket Contado': 'E-Ticket Contado',
        'E-Ticket Credito': 'E-Ticket Crédito',
        'E-Ticket Crédito': 'E-Ticket Crédito',
        'E-Ticket Nota De Credito': 'E-Ticket NC',
        'E-Ticket Nota De Crédito': 'E-Ticket NC',
        'E-Factura Nota De Credito': 'E-Factura NC',
        'E-Factura Nota De Crédito': 'E-Factura NC',
        'E-Factura Contado': 'E-Factura Contado',
        'E-Factura Credito': 'E-Factura Crédito',
        'E-Factura Crédito': 'E-Factura Crédito',
        'E-Ticket Nota De Deb': 'E-Ticket ND',
        'E-Factura Nota De Deb': 'E-Factura ND',
        'Nota de Credito': 'E-Ticket NC',
        'Nota de Crédito': 'E-Ticket NC',
        'Nota de Debito': 'E-Ticket ND',
        'Nota de Débito': 'E-Ticket ND',
    };
    if (!tipo) return '—';
    const k = String(tipo).trim();
    if (MAP[k]) return MAP[k];
    // Fallback: reducir strings largos con patrones comunes
    const tl = k.toLowerCase();
    if (tl.includes('nota de cre') || tl.includes('nota de cr')) {
        return tl.includes('factura') ? 'E-Factura NC' : 'E-Ticket NC';
    }
    if (tl.includes('nota de deb')) {
        return tl.includes('factura') ? 'E-Factura ND' : 'E-Ticket ND';
    }
    if (tl.includes('e-ticket') || tl.includes('eticket')) return 'E-Ticket Contado';
    if (tl.includes('e-factura') || tl.includes('efactura')) return 'E-Factura Contado';
    return k;
};

const isFiscalCfe = (tipo) => {
    if (!tipo) return false;
    const t = String(tipo).toLowerCase();
    return !t.includes('pedido') && t !== 'pc';
};

const isCreditNote = (tipo) => {
    if (!tipo) return false;
    const t = String(tipo).toLowerCase();
    return t.includes('nota de cre') || t.includes('nota de cr') || t.includes('n.crédito') || t.includes('n.credito') || t.includes('nota_credito') || t === '10' || t === '04';
};

const renderDocFecha = (fechaStr) => {
    if (!fechaStr) return '—';
    const date = new Date(fechaStr);
    const datePart = date.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timePart = date.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: true });
    return (
        <div className="flex flex-col text-xs text-gray-500 font-medium">
            <span className="text-gray-900 font-semibold">{datePart}</span>
            <span className="text-[10px] text-gray-400 mt-0.5">{timePart}</span>
        </div>
    );
};

const renderCfeOficialCol = (doc) => {
    if (doc.CfeEstado !== 'ACEPTADO_DGI') {
        return <span className="text-gray-400">-</span>;
    }
    const text = doc.CfeNumeroOficial || '';
    
    // Caso 1: Formato "Nro. de CAE 90260001010 Serie B 1 / 1000"
    const matchCae = text.match(/Nro\.\s+de\s+CAE\s+(\d+)\s+Serie\s+([A-Za-z]+)\s+(\d+)\s*(?:\/\s*(\d+))?/i);
    if (matchCae) {
        const [_, caeNum, serie, numero, total] = matchCae;
        return (
            <div className="flex flex-col text-xs leading-tight">
                <div className="font-extrabold text-blue-600 text-sm">N° {numero}</div>
                <div className="font-medium text-gray-500">Serie {serie} {total ? `/ ${total}` : ''}</div>
                <div className="text-[10px] text-gray-400 mt-1">CAE: {caeNum}</div>
                <div className="text-[10px] text-gray-400">{doc.CfeCAE}</div>
            </div>
        );
    }

    // Caso 2: Formato simple "B-1" o "Serie B-1"
    const matchSimple = text.match(/(?:Serie\s+)?([A-Za-z]+)-(\d+)/i);
    if (matchSimple) {
        const [_, serie, numero] = matchSimple;
        return (
            <div className="flex flex-col text-xs leading-tight">
                <div className="font-extrabold text-blue-600 text-sm">N° {numero}</div>
                <div className="font-medium text-gray-500">Serie {serie}</div>
                <div className="text-[10px] text-gray-400 mt-1">{doc.CfeCAE}</div>
            </div>
        );
    }
    
    // Fallback
    return (
        <div className="flex flex-col leading-tight">
            <div className="font-semibold text-gray-900 text-sm">{text}</div>
            <div className="text-xs text-gray-400">{doc.CfeCAE}</div>
        </div>
    );
};

const ContabilidadBandejaCFE = () => {
    const { token } = useAuth();
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sendingId, setSendingId] = useState(null);
    const [error, setError] = useState('');
    const [showFacturaModal, setShowFacturaModal] = useState(false);
    const [selectedDocs, setSelectedDocs] = useState(new Set());
    const [tiposExistentes, setTiposExistentes] = useState([]);
    
    // ID del documento a editar (abre FacturacionManualModal en mode='editar')
    const [editDocId, setEditDocId] = useState(null);

    // Acciones Copiar/Reversar/Nota de Crédito
    const [copyData, setCopyData] = useState(null);
    const [showNcModal, setShowNcModal] = useState(false);
    const [ncDoc, setNcDoc] = useState(null);
    const [ncLineas, setNcLineas] = useState([]);
    const [ncMode, setNcMode] = useState('NC');

    // Filtros
    const [clientes, setClientes] = useState([]);
    const [filtros, setFiltros] = useState({
        fechaDesde: new Date().toISOString().split('T')[0],
        fechaHasta: new Date().toISOString().split('T')[0],
        estado: '',
        tipo: '',
        clienteId: ''
    });

    const [clienteSearch, setClienteSearch] = useState('');
    const [showClienteDropdown, setShowClienteDropdown] = useState(false);
    const dropdownRef = React.useRef(null);

    const handleSelectCliente = (cliente) => {
        setFiltros(prev => ({ ...prev, clienteId: cliente ? (cliente.CliIdCliente || cliente.CodCliente || '') : '' }));
        setClienteSearch(cliente ? `${cliente.Nombre || cliente.NombreFantasia} (${cliente.CioRuc || 'RUT S/N'})` : '');
        setShowClienteDropdown(false);
    };

    const handleInputChange = (e) => {
        const value = e.target.value;
        setClienteSearch(value);
        setShowClienteDropdown(true);
        if (!value) {
            setFiltros(prev => ({ ...prev, clienteId: '' }));
        }
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowClienteDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const clientesFiltrados = React.useMemo(() => {
        const query = clienteSearch.toLowerCase().trim();
        if (!query) return clientes;
        
        const selected = clientes.find(c => String(c.CliIdCliente || c.CodCliente || '') === String(filtros.clienteId));
        if (selected && `${selected.Nombre || selected.NombreFantasia} (${selected.CioRuc || 'RUT S/N'})` === clienteSearch) {
            return clientes;
        }

        return clientes.filter(c => {
            const id = String(c.CliIdCliente || c.CodCliente || '').toLowerCase();
            const nombre = String(c.Nombre || '').toLowerCase();
            const nombreFantasia = String(c.NombreFantasia || '').toLowerCase();
            const ruc = String(c.CioRuc || '').toLowerCase();
            const tel = String(c.TelefonoTrabajo || '').toLowerCase();
            
            return id.includes(query) || 
                   nombre.includes(query) || 
                   nombreFantasia.includes(query) || 
                   ruc.includes(query) || 
                   tel.includes(query);
        });
    }, [clientes, clienteSearch, filtros.clienteId]);

    const fetchClientes = async () => {
        try {
            const { data } = await api.get('/clients');
            setClientes(data || []);
        } catch (err) {
            console.error('Error al cargar clientes:', err);
        }
    };

    const fetchDocumentos = async () => {
        setLoading(true);
        setError('');
        try {
            const queryParams = new URLSearchParams();
            if (filtros.fechaDesde) queryParams.append('fechaDesde', filtros.fechaDesde);
            if (filtros.fechaHasta) queryParams.append('fechaHasta', filtros.fechaHasta);
            if (filtros.estado) queryParams.append('estado', filtros.estado);
            if (filtros.tipo) queryParams.append('tipo', filtros.tipo);
            if (filtros.clienteId) queryParams.append('clienteId', filtros.clienteId);
            const { data } = await api.get(`/contabilidad/cfe/documentos?${queryParams.toString()}`);
            setDocs(data);
        } catch (err) {
            setError('Error al cargar documentos CFE: ' + (err.response?.data?.error || err.message));
        } finally {
            setLoading(false);
        }
        setSelectedDocs(new Set());
    };

    const fetchTiposExistentes = async () => {
        try {
            const { data } = await api.get('/contabilidad/cfe/tipos-existentes');
            if (data.success) {
                setTiposExistentes(data.data || []);
            }
        } catch (err) {
            console.error('Error al cargar tipos de documentos existentes:', err);
        }
    };

    useEffect(() => {
        fetchClientes();
        fetchDocumentos();
        fetchTiposExistentes();
        // eslint-disable-next-line
    }, []);

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFiltros(prev => ({ ...prev, [name]: value }));
    };

    const handleDownloadPdf = async (docId) => {
        try {
            const loadingToast = toast.loading('Generando PDF...');
            
            // Obtener el documento actual de la lista
            const doc = docs.find(d => d.DocIdDocumento === docId);
            if (!doc) throw new Error("Documento no encontrado en la lista actual");

            // Obtener los detalles de la factura desde el backend
            const response = await api.get(`/contabilidad/cfe/documentos/${docId}/detalle`);
            const detalles = response.data?.detalles || [];

            // Generar y descargar el PDF localmente en el navegador
            generarPdfFacturaDGI(doc, detalles);
            
            toast.dismiss(loadingToast);
        } catch (error) {
            toast.dismiss();
            toast.error("Error al generar el PDF. " + (error.response?.data?.error || error.message));
        }
    };

    const toggleSelection = (docId) => {
        setSelectedDocs(prev => {
            const newSet = new Set(prev);
            if (newSet.has(docId)) {
                newSet.delete(docId);
            } else {
                newSet.add(docId);
            }
            return newSet;
        });
    };

    const toggleAll = () => {
        const pendings = docs.filter(d => d.CfeEstado === 'PENDIENTE' && isFiscalCfe(d.DocTipo));
        if (selectedDocs.size === pendings.length && pendings.length > 0) {
            setSelectedDocs(new Set());
        } else {
            setSelectedDocs(new Set(pendings.map(d => d.DocIdDocumento)));
        }
    };

    const handleEnviarSeleccionados = async () => {
        if (selectedDocs.size === 0) return;
        const nonPedidoDocs = Array.from(selectedDocs).filter(id => {
            const doc = docs.find(d => d.DocIdDocumento === id);
            return doc && isFiscalCfe(doc.DocTipo);
        });
        if (nonPedidoDocs.length === 0) return;
        if (!window.confirm(`[MODO PRUEBA SISNET] ¿Seguro que deseas simular el envío de ${nonPedidoDocs.length} documentos a SISNET?`)) return;
        
        let sentCount = 0;
        setLoading(true);
        for (const docId of nonPedidoDocs) {
            try {
                setSendingId(docId);
                const { data } = await api.post(`/contabilidad/cfe/documentos/${docId}/enviar`);
                toast.success(`[Doc ${docId}] ${data.message} (CAE: ${data.cae})`);
                sentCount++;
            } catch (err) {
                toast.error(`Error enviando doc ID ${docId} a SISNET: ` + (err.response?.data?.error || err.message));
            }
        }
        setSendingId(null);
        setLoading(false);
        if (sentCount > 0) {
            toast.success(`Se simularon ${sentCount} envíos a SISNET`);
        }
    };

    const handleDescargarFacturaPdf = async (doc) => {
        try {
            const toastId = toast.loading('Generando Factura PDF...');
            const { data } = await api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`);
            toast.dismiss(toastId);
            if (data && data.doc) {
                generarPdfFacturaDGI(data.doc, data.detalles || []);
                toast.success('Factura descargada');
            } else {
                toast.error('No se pudo obtener el documento.');
            }
        } catch (err) {
            toast.error('Error al descargar la factura: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleEnviarDGI = async (doc) => {
        if (!window.confirm(`¿Seguro que deseas enviar el documento ${doc.DocSerie}-${doc.DocNumero} a DGI a través de SISNET?`)) return;
        
        try {
            setSendingId(doc.DocIdDocumento);
            const { data } = await api.post(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/enviar`);
            toast.success(`${data.message}. CAE: ${data.cae}`);
            fetchDocumentos();
        } catch (err) {
            toast.error('Error enviando a SISNET: ' + (err.response?.data?.error || err.message));
        } finally {
            setSendingId(null);
        }
    };

    const handleAnular = async (doc) => {
        // [PROVISIONAL] Habilitado a petición del usuario.
        // if (doc.DocPagado) {
        //     toast.error('No se puede anular porque esta factura ya fue pagada en Caja. Debes anular el cobro desde la Caja.');
        //     return;
        // }
        if (!window.confirm(`¿Seguro que deseas ANULAR la factura ${doc.DocSerie}-${doc.DocNumero}? Esto revertirá el asiento contable.`)) return;
        
        try {
            await api.put(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/anular`);
            toast.success('Factura anulada correctamente');
            fetchDocumentos();
        } catch (err) {
            toast.error('Error anulando: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleCopiar = async (doc) => {
        try {
            const toastId = toast.loading('Cargando datos del documento original...');
            const response = await api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`);
            const lineas = response.data?.detalles || [];
            toast.dismiss(toastId);
            setCopyData({
                DocTipo: doc.DocTipo,
                MonIdMoneda: doc.MonIdMoneda,
                CliIdCliente: doc.CliIdCliente,
                DocCliNombre: doc.DocCliNombre || doc.CliRazonSocial || doc.CliNombreFantasia || '',
                DocCliDocumento: doc.DocCliDocumento || doc.CliRUT || '',
                DocCliDireccion: doc.DocCliDireccion || doc.CliDireccion || '',
                DocCliCiudad: doc.DocCliCiudad || '',
                lineas: lineas
            });
        } catch (error) {
            toast.dismiss();
            toast.error('Error al cargar datos del documento para copiar: ' + (error.response?.data?.error || error.message));
        }
    };

    const handleReversarYGenerar = async (doc) => {
        const confirmMsg = doc.CfeEstado === 'ACEPTADO_DGI' 
            ? 'Esta acción emitirá una Nota de Crédito por el 100% del total para anular la factura fiscal y abrirá el formulario para que generes una nueva corregida. ¿Deseas continuar?'
            : 'Esta acción reversará el documento actual y abrirá el formulario para que generes uno nuevo corregido. ¿Deseas continuar?';
        
        if (!window.confirm(confirmMsg)) return;

        try {
            const toastId = toast.loading('Reversando documento...');
            
            if (doc.CfeEstado === 'ACEPTADO_DGI') {
                await api.post('/contabilidad/caja/nota-credito', {
                    docIdOrigen: doc.DocIdDocumento,
                    monto: doc.DocTotal,
                    motivo: 'Reverso para regeneración',
                    clienteId: doc.CliIdCliente || 1,
                    monedaId: doc.MonIdMoneda || 1,
                    cuentaId: doc.CueIdCuenta || (doc.MonIdMoneda === 2 ? 119 : 118)
                });
            } else {
                await api.put(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/anular`);
            }

            toast.loading('Cargando datos para regeneración...', { id: toastId });
            const response = await api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`);
            const lineas = response.data?.detalles || [];
            
            toast.dismiss(toastId);
            toast.success('Documento original revertido. Por favor edite y guarde el nuevo comprobante.');

            setCopyData({
                DocTipo: doc.DocTipo,
                MonIdMoneda: doc.MonIdMoneda,
                CliIdCliente: doc.CliIdCliente,
                lineas: lineas
            });
        } catch (error) {
            toast.dismiss();
            toast.error('Error durante el reverso/copia: ' + (error.response?.data?.error || error.message));
        }
    };

    const handleOpenNcModal = async (doc, mode = 'NC') => {
        try {
            const toastId = toast.loading('Cargando detalles del documento original...');
            const response = await api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`);
            const lineas = response.data?.detalles || [];
            toast.dismiss(toastId);
            setNcDoc(doc);
            setNcLineas(lineas);
            setNcMode(mode);
            setShowNcModal(true);
        } catch (error) {
            toast.dismiss();
            toast.error('Error al cargar datos del documento: ' + (error.response?.data?.error || error.message));
        }
    };

    return (
        <div className="p-4 sm:p-6 w-full mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                    <FileText className="h-8 w-8 text-blue-600" />
                    <h2 className="text-2xl font-bold text-gray-800">
                        Bandeja de Facturación Electrónica (CFE)
                    </h2>
                </div>
                <div className="flex items-center gap-3">
                    {selectedDocs.size > 0 && (
                        <button
                            onClick={handleEnviarSeleccionados}
                            disabled={loading || sendingId}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white bg-green-600 hover:bg-green-700 font-bold transition-colors shadow-sm disabled:opacity-50"
                        >
                            <Send size={20} />
                            Enviar Seleccionados ({selectedDocs.size})
                        </button>
                    )}
                    <button
                        onClick={() => setShowFacturaModal(true)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white bg-blue-600 hover:bg-blue-700 font-bold transition-colors shadow-sm"
                    >
                        <Plus size={20} />
                        Nueva Factura Manual
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center">
                    <Search className="h-5 w-5 text-gray-500 mr-2" />
                    <h3 className="font-semibold text-gray-700">Filtros de Búsqueda</h3>
                </div>
                <div className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Desde</label>
                            <input 
                                type="date" 
                                name="fechaDesde" 
                                value={filtros.fechaDesde} 
                                onChange={handleFilterChange}
                                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Hasta</label>
                            <input 
                                type="date" 
                                name="fechaHasta" 
                                value={filtros.fechaHasta} 
                                onChange={handleFilterChange}
                                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Estado DGI</label>
                            <select 
                                name="estado" 
                                value={filtros.estado} 
                                onChange={handleFilterChange}
                                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border bg-white text-sm"
                            >
                                <option value="">Todos</option>
                                <option value="PENDIENTE">Pendientes de Envío</option>
                                <option value="ACEPTADO_DGI">Aceptados por DGI</option>
                                <option value="RECHAZADO_DGI">Rechazados</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Documento</label>
                             <select 
                                name="tipo" 
                                value={filtros.tipo} 
                                onChange={handleFilterChange}
                                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border bg-white text-sm"
                            >
                                <option value="">Todos</option>
                                {tiposExistentes.map(t => (
                                    <option key={t} value={t}>{getTipoDocName(t)}</option>
                                ))}
                            </select>
                        </div>
                        <div className="relative" ref={dropdownRef}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
                            <div className="relative">
                                <input 
                                    type="text"
                                    placeholder="Buscar por nombre, ID, RUC o tel..."
                                    value={clienteSearch}
                                    onChange={handleInputChange}
                                    onFocus={() => setShowClienteDropdown(true)}
                                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2 border text-sm pr-8 bg-white"
                                />
                                {filtros.clienteId && (
                                    <button
                                        type="button"
                                        onClick={() => handleSelectCliente(null)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                                    >
                                        <XCircle size={16} />
                                    </button>
                                )}
                            </div>
                            {showClienteDropdown && (
                                <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm border border-gray-200">
                                    {clientesFiltrados.length === 0 ? (
                                        <div className="relative cursor-default select-none py-2 px-4 text-gray-505">
                                            No se encontraron clientes
                                        </div>
                                    ) : (
                                        clientesFiltrados.slice(0, 100).map(c => (
                                            <div
                                                key={c.CliIdCliente || c.CodCliente}
                                                onClick={() => handleSelectCliente(c)}
                                                className={`relative cursor-pointer select-none py-2 px-3 hover:bg-blue-50 text-slate-800 transition-colors ${
                                                    String(filtros.clienteId) === String(c.CliIdCliente || c.CodCliente) ? 'bg-blue-50 font-semibold text-blue-900' : ''
                                                }`}
                                            >
                                                <div className="flex flex-col">
                                                    <span className="block truncate text-sm">
                                                        {c.Nombre || c.NombreFantasia}
                                                    </span>
                                                    <span className="block truncate text-xs text-gray-400 mt-0.5">
                                                        ID: {c.CliIdCliente || c.CodCliente} | RUC: {c.CioRuc || 'S/N'} {c.TelefonoTrabajo ? `| Tel: ${c.TelefonoTrabajo}` : ''}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <button 
                                onClick={fetchDocumentos} 
                                disabled={loading}
                                className="w-full flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            >
                                {loading ? (
                                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : 'Buscar'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <AlertCircle className="h-5 w-5 text-red-400" />
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-red-700">{error}</p>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left">
                                    <input 
                                        type="checkbox"
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        onChange={toggleAll}
                                        checked={docs.length > 0 && docs.filter(d => d.CfeEstado === 'PENDIENTE' && isFiscalCfe(d.DocTipo)).length > 0 && selectedDocs.size === docs.filter(d => d.CfeEstado === 'PENDIENTE' && isFiscalCfe(d.DocTipo)).length}
                                    />
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nro Interno</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado DGI</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nro Oficial / CAE</th>
                                <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {docs.length === 0 ? (
                                <tr>
                                    <td colSpan="9" className="px-6 py-10 text-center text-gray-500">
                                        No se encontraron documentos contables para los filtros seleccionados.
                                    </td>
                                </tr>
                            ) : (
                                docs.map(doc => (
                                    <tr key={doc.DocIdDocumento} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {doc.CfeEstado === 'PENDIENTE' && isFiscalCfe(doc.DocTipo) && (
                                                <input 
                                                    type="checkbox"
                                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    checked={selectedDocs.has(doc.DocIdDocumento)}
                                                    onChange={() => toggleSelection(doc.DocIdDocumento)}
                                                />
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {renderDocFecha(doc.DocFechaEmision)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {getTipoDocName(doc.DocTipo)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                                            {doc.DocSerie}-{parseInt(doc.DocNumero, 10) || doc.DocNumero}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div className="text-gray-900 font-medium">
                                                {doc.CliNombreFantasia || doc.CliRazonSocial || 'Consumidor Final'}
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                {doc.StringIDCliente && (
                                                    <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                                        {doc.StringIDCliente.trim()}
                                                    </span>
                                                )}
                                                {doc.CliRUT && <span className="text-xs text-gray-400">RUT: {doc.CliRUT}</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                                            <div>
                                                {doc.MonIdMoneda === 1 ? 'UYU ' : 'USD '}
                                                {Number(doc.DocTotal).toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                                            </div>
                                            <div className="mt-1">
                                                {doc.DocPagado ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800" title={doc.MetodoPagoNombre || ''}>
                                                        Contado {doc.MetodoPagoNombre ? `(${doc.MetodoPagoNombre.trim()})` : ''}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
                                                        Crédito
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStatusBadge(doc.CfeEstado)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {renderCfeOficialCol(doc)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                                            {doc.CfeEstado === 'BORRADOR' ? (
                                                <div className="flex items-center justify-center space-x-2">
                                                    <button
                                                        onClick={() => handleDescargarFacturaPdf(doc)}
                                                        className="text-gray-500 hover:text-indigo-600 transition-colors"
                                                        title="Vista previa PDF"
                                                    >
                                                        <Printer className="h-5 w-5" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditDocId(doc.DocIdDocumento)}
                                                        className="text-gray-500 hover:text-yellow-600 transition-colors"
                                                        title="Editar Borrador"
                                                    >
                                                        <Edit className="h-5 w-5" />
                                                    </button>
                                                    {!(isCreditNote(doc.DocTipo) || String(doc.DocTipo).toUpperCase().includes('DEBITO')) && (
                                                        <button
                                                            onClick={() => handleCopiar(doc)}
                                                            className="text-gray-500 hover:text-blue-600 transition-colors"
                                                            title="Convertir / Copiar como e-Ticket o e-Factura"
                                                        >
                                                            <Copy className="h-5 w-5" />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleAnular(doc)}
                                                        className="text-gray-500 hover:text-red-600 transition-colors"
                                                        title="Reversar Documento"
                                                    >
                                                        <XCircle className="h-5 w-5" />
                                                    </button>
                                                    {isFiscalCfe(doc.DocTipo) ? (
                                                        <button
                                                            onClick={() => handleEnviarDGI(doc)}
                                                            className="text-blue-500 hover:text-blue-700 transition-colors font-bold text-xs border border-blue-200 hover:border-blue-400 bg-blue-50/50 hover:bg-blue-50 px-2 py-1 rounded"
                                                            title="Enviar a DGI"
                                                        >
                                                            Enviar a DGI
                                                        </button>
                                                    ) : (
                                                        <span className="text-xs text-purple-500 font-semibold italic">No va a DGI</span>
                                                    )}
                                                </div>
                                            ) : doc.CfeEstado === 'PENDIENTE' ? (
                                                <div className="flex items-center justify-center space-x-2">
                                                    <button
                                                        onClick={() => handleDescargarFacturaPdf(doc)}
                                                        className="text-gray-500 hover:text-indigo-600 transition-colors"
                                                        title="Descargar Factura PDF"
                                                    >
                                                        <Printer className="h-5 w-5" />
                                                    </button>
                                                    {/* Editar: solo para facturas, no para NC/ND */}
                                                    {!(isCreditNote(doc.DocTipo) || String(doc.DocTipo).toUpperCase().includes('DEBITO')) && (
                                                    <button
                                                        onClick={() => setEditDocId(doc.DocIdDocumento)}
                                                        className="text-gray-500 hover:text-yellow-600 transition-colors"
                                                        title="Editar Factura"
                                                    >
                                                        <Edit className="h-5 w-5" />
                                                    </button>
                                                    )}
                                                    {/* Reversar */}
                                                    <button
                                                        onClick={() => handleAnular(doc)}
                                                        className="text-gray-500 hover:text-red-600 transition-colors"
                                                        title="Reversar Documento"
                                                    >
                                                        <XCircle className="h-5 w-5" />
                                                    </button>
                                                    {/* Copiar */}
                                                    {!(isCreditNote(doc.DocTipo) || String(doc.DocTipo).toUpperCase().includes('DEBITO')) && (
                                                        <button
                                                            onClick={() => handleCopiar(doc)}
                                                            className="text-gray-500 hover:text-blue-600 transition-colors"
                                                            title="Copiar Factura"
                                                        >
                                                            <Copy className="h-5 w-5" />
                                                        </button>
                                                    )}
                                                    {isFiscalCfe(doc.DocTipo) && (
                                                        <button 
                                                            onClick={() => handleEnviarDGI(doc)}
                                                            disabled={sendingId === doc.DocIdDocumento}
                                                            className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                                                            title="Enviar a DGI"
                                                        >
                                                            {sendingId === doc.DocIdDocumento ? (
                                                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                                </svg>
                                                            ) : (
                                                                <Send className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            ) : doc.CfeEstado === 'ANULADO' ? (
                                                <span className="text-gray-400 font-semibold italic text-xs">ANULADA</span>
                                            ) : (
                                                <div className="flex items-center justify-center space-x-2">
                                                    <button 
                                                        onClick={() => handleDownloadPdf(doc.DocIdDocumento)}
                                                        className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                                        title="Descargar PDF"
                                                    >
                                                        <FileOutput className="mr-1.5 h-3.5 w-3.5 text-red-500" /> PDF
                                                    </button>
                                                    {/* Copiar (solo si no es nota de crédito o débito) */}
                                                    {!(isCreditNote(doc.DocTipo) || String(doc.DocTipo).toUpperCase().includes('DEBITO')) && (
                                                        <button
                                                            onClick={() => handleCopiar(doc)}
                                                            className="text-gray-500 hover:text-blue-600 transition-colors p-1"
                                                            title="Copiar Factura"
                                                        >
                                                            <Copy className="h-5 w-5" />
                                                        </button>
                                                    )}
                                                    {/* Nota de Crédito o Débito según el tipo */}
                                                    {isCreditNote(doc.DocTipo) ? (
                                                        <button
                                                            onClick={() => handleOpenNcModal(doc, 'ND')}
                                                            className="text-gray-500 hover:text-red-500 transition-colors p-1"
                                                            title="Generar Nota de Débito (Anula NC)"
                                                        >
                                                            <XCircle className="h-5 w-5" />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleOpenNcModal(doc, 'NC')}
                                                            className="text-gray-500 hover:text-red-500 transition-colors p-1"
                                                            title="Generar Nota de Crédito (Anula Doc.)"
                                                        >
                                                            <XCircle className="h-5 w-5" />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {(showFacturaModal || copyData) && (
                <FacturacionManualModal 
                    initialData={copyData}
                    onClose={() => {
                        setShowFacturaModal(false);
                        setCopyData(null);
                    }}
                    onSuccess={() => {
                        setShowFacturaModal(false);
                        setCopyData(null);
                        fetchDocumentos();
                    }}
                />
            )}

            {showNcModal && ncDoc && (
                <CfeNotaCreditoModal 
                    doc={ncDoc}
                    lineas={ncLineas}
                    mode={ncMode}
                    onClose={() => {
                        setShowNcModal(false);
                        setNcDoc(null);
                        setNcLineas([]);
                    }}
                    onSuccess={() => {
                        setShowNcModal(false);
                        setNcDoc(null);
                        setNcLineas([]);
                        fetchDocumentos();
                    }}
                />
            )}

            {/* PreviewModal eliminada — el lápiz abre el modal de edición completo */}

            {editDocId && (
                <FacturacionManualModal
                    mode="editar"
                    editDocId={editDocId}
                    onClose={() => setEditDocId(null)}
                    onSuccess={() => {
                        setEditDocId(null);
                        fetchDocumentos();
                    }}
                />
            )}
        </div>
    );
};

export default ContabilidadBandejaCFE;
