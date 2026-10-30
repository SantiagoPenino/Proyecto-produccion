import React, { useState, useEffect } from 'react';
import { FileText, AlertCircle, AlertTriangle, Search, Send, FileOutput, Plus, Edit, XCircle, Printer, Copy, FileX, User, Trash2, Mail, MailCheck, Loader2, SearchX } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'sonner';
import api from '../../services/apiClient';
import { generarPdfComprobanteDGI } from '../../utils/pdfGenerator';
import { useEmpresas } from '../../hooks/useEmpresas';
import FacturacionManualModal from './FacturacionManualModal';
import NcEditarModal from './NcEditarModal';
import ConfirmationModal from '../modals/ConfirmationModal';
import CfeNotaCreditoModal from './CfeNotaCreditoModal';
import NcExternaModal from './NcExternaModal';
import CfePreviewDgiModal from './CfePreviewDgiModal';
import CfeEnviarEmailModal from './CfeEnviarEmailModal';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import useConfirmar from '../ui/useConfirmar';
// Nombre del tipo de documento: única fuente, compartida con el generador de PDF
import { getTipoDocName } from '../../utils/tiposDocumento';

// Estética nueva (27/10/2026): encabezado, filtros con Selector/SelectorFecha, tabla clara (en el celular, una
// tarjeta por documento), estados con color de estado y acciones como íconos parejos. Anular y reversar confirman
// con la ventana del sistema (antes, window.confirm). La lógica no cambió.

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-8 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap';
// Ícono de acción: gris, se pone cian al pasar (magenta en los que anulan)
const ACCION = 'p-1.5 rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/5 transition-colors disabled:opacity-40';
const ACCION_PELIGRO = 'p-1.5 rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors';
const CHECK = 'w-4 h-4 rounded border-zinc-300 accent-[#006E97] cursor-pointer';

const getStatusBadge = (status) => {
    switch(status) {
        case 'PENDIENTE': return <span className={`${CHIP} bg-amber-50 text-amber-700 border-amber-200`}>Pendiente DGI</span>;
        // Candado mientras SISNET contesta (INF-SIS-2026-18): dura unos segundos
        case 'ENVIANDO': return <span className={`${CHIP} bg-sky-50 text-sky-700 border-sky-200`}>Enviando a DGI…</span>;
        case 'ACEPTADO_DGI': return <span className={`${CHIP} bg-emerald-50 text-emerald-700 border-emerald-200`}>Aceptado DGI</span>;
        case 'RECHAZADO_DGI': return <span className={`${CHIP} bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20`}>Rechazado</span>;
        case 'BORRADOR': return <span className={`${CHIP} bg-zinc-50 text-zinc-600 border-zinc-200`}>Borrador</span>;
        default: return <span className={`${CHIP} bg-zinc-50 text-zinc-500 border-zinc-200`}>{status}</span>;
    }
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
    const timePart = date.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return (
        <div className="flex flex-col text-xs tabular-nums">
            <span className="text-zinc-800 font-semibold">{datePart}</span>
            <span className="text-[11px] text-zinc-400 mt-0.5">{timePart}</span>
        </div>
    );
};

const renderCfeOficialCol = (doc) => {
    if (doc.CfeEstado !== 'ACEPTADO_DGI') {
        return <span className="text-zinc-300">—</span>;
    }
    const text = doc.CfeNumeroOficial || '';

    // Caso 1: Formato "Nro. de CAE 90260001010 Serie B 1 / 1000"
    const matchCae = text.match(/Nro\.\s+de\s+CAE\s+(\d+)\s+Serie\s+([A-Za-z]+)\s+(\d+)\s*(?:\/\s*(\d+))?/i);
    if (matchCae) {
        const [_, caeNum, serie, numero, total] = matchCae;
        return (
            <div className="flex flex-col text-xs leading-tight">
                <div className="font-black text-brand-cyan text-sm tabular-nums">N° {numero}</div>
                <div className="font-medium text-zinc-500">Serie {serie} {total ? `/ ${total}` : ''}</div>
                <div className="text-[10px] text-zinc-400 mt-1 font-mono">CAE: {caeNum}</div>
                <div className="text-[10px] text-zinc-400 font-mono">{doc.CfeCAE}</div>
            </div>
        );
    }

    // Caso 2: Formato simple "B-1" o "Serie B-1"
    const matchSimple = text.match(/(?:Serie\s+)?([A-Za-z]+)-(\d+)/i);
    if (matchSimple) {
        const [_, serie, numero] = matchSimple;
        return (
            <div className="flex flex-col text-xs leading-tight">
                <div className="font-black text-brand-cyan text-sm tabular-nums">N° {numero}</div>
                <div className="font-medium text-zinc-500">Serie {serie}</div>
                <div className="text-[10px] text-zinc-400 mt-1 font-mono">{doc.CfeCAE}</div>
            </div>
        );
    }

    // Fallback
    return (
        <div className="flex flex-col leading-tight">
            <div className="font-semibold text-zinc-800 text-sm">{text}</div>
            <div className="text-xs text-zinc-400 font-mono">{doc.CfeCAE}</div>
        </div>
    );
};

/**
 * Botón "enviar por email" de la columna Acciones.
 * NO se deshabilita cuando el cliente no tiene dirección cargada: hay fichas viejas
 * sin email y el modal permite escribirla en el momento. El color ámbar avisa que no
 * hay ninguna guardada, y el tooltip dice exactamente a qué casilla iría.
 * Si el documento ya se mandó alguna vez, el ícono pasa a verde con la fecha y el
 * destinatario del último envío, para no mandarlo dos veces sin darse cuenta.
 */
const BotonEnviarEmail = ({ doc, onClick }) => {
    const email = (doc.CliEmail || doc.CliEmailPortal || '').trim();
    const yaEnviado = !!doc.UltimoEnvioFecha;

    let title = email
        ? `Enviar el PDF por email a ${email}`
        : 'Enviar el PDF por email — este cliente no tiene dirección cargada, se escribe al enviar';
    if (yaEnviado) {
        title += `\nÚltimo envío: ${new Date(doc.UltimoEnvioFecha).toLocaleString('es-UY')} a ${doc.UltimoEnvioDestinatario || ''}`;
    }

    return (
        <button
            onClick={() => onClick(doc)}
            title={title}
            aria-label="Enviar por email"
            className={`p-1.5 rounded-lg transition-colors ${
                yaEnviado ? 'text-emerald-600 hover:bg-emerald-50'
                          : email ? 'text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/5'
                                  : 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'
            }`}
        >
            {yaEnviado ? <MailCheck className="h-[18px] w-[18px]" /> : <Mail className="h-[18px] w-[18px]" />}
        </button>
    );
};

// En el celular, tarjetas en vez de la tabla de 9 columnas (una vista sola: no se dibujan las dos ocultando una)
const MQ_TABLA = '(min-width: 1024px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}

const ContabilidadBandejaCFE = ({ initialCliente = null, embedded = false, autoNuevaFactura = false }) => {
    const { token } = useAuth();
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const conTabla = useConTabla();
    // Cuando se monta scopeado a un cliente (Panel 360): fecha amplia y cliente fijo.
    const cliFijoId = initialCliente ? (initialCliente.CliIdCliente || initialCliente.CodCliente || '') : '';
    const seisMesesAtras = () => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; };
    const clientePrefill = initialCliente ? {
        CliIdCliente:    initialCliente.CliIdCliente,
        DocCliNombre:    initialCliente.Nombre || initialCliente.NombreFantasia || '',
        DocCliDocumento: initialCliente.CioRuc || initialCliente.CodCliente || '',
        DocCliDireccion: initialCliente.Direccion || '',
        DocCliCiudad:    initialCliente.Ciudad || '',
        lineas: [],
    } : null;
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sendingId, setSendingId] = useState(null);
    const [error, setError] = useState('');
    const [showFacturaModal, setShowFacturaModal] = useState(false);
    const [showNcExternaModal, setShowNcExternaModal] = useState(false);
    const [selectedDocs, setSelectedDocs] = useState(new Set());
    const [tiposExistentes, setTiposExistentes] = useState([]);
    
    // ID del documento a editar (abre FacturacionManualModal en mode='editar')
    const [editDocId, setEditDocId] = useState(null);
    // Qué ventana abrir: la de notas de crédito/débito o la de facturación
    const [editDocEsNota, setEditDocEsNota] = useState(false);

    const abrirEdicion = (doc) => {
        const esNota = isCreditNote(doc.DocTipo) || String(doc.DocTipo).toUpperCase().includes('DEBITO');
        setEditDocEsNota(esNota);
        setEditDocId(doc.DocIdDocumento);
    };

    // Acciones Copiar/Reversar/Nota de Crédito
    const [copyData, setCopyData] = useState(null);
    const [showNcModal, setShowNcModal] = useState(false);
    const [ncDoc, setNcDoc] = useState(null);
    const [ncLineas, setNcLineas] = useState([]);
    const [ncMode, setNcMode] = useState('NC');
    // Confirmación de envío a DGI: { tipo: 'uno', doc } | { tipo: 'lote', ids: [...] }
    const [confirmEnvio, setConfirmEnvio] = useState(null);
    const [previewDoc, setPreviewDoc] = useState(null);   // documento cuyo CFE a emitir se está viendo
    const [emailDoc, setEmailDoc] = useState(null);       // documento que se está por mandar por email
    const [regularizarDoc, setRegularizarDoc] = useState(null);   // NC aceptada como venta: explica la regularización

    // Filtros
    const [clientes, setClientes] = useState([]);
    const [filtros, setFiltros] = useState({
        fechaDesde: initialCliente ? seisMesesAtras() : new Date().toISOString().split('T')[0],
        fechaHasta: new Date().toISOString().split('T')[0],
        estado: '',
        tipo: '',
        clienteId: cliFijoId,
        empresaId: '',
        metodoPagoId: '',
        buscar: ''
    });

    const [clienteSearch, setClienteSearch] = useState('');
    const [clienteSeleccionado, setClienteSeleccionado] = useState(initialCliente || null);
    const [showClienteDropdown, setShowClienteDropdown] = useState(false);
    const { empresas } = useEmpresas(false); // todas (activas e inactivas) para el filtro
    const [metodosPago, setMetodosPago] = useState([]);
    const dropdownRef = React.useRef(null);

    const handleSelectCliente = (cliente) => {
        setFiltros(prev => ({ ...prev, clienteId: cliente ? (cliente.CliIdCliente || cliente.CodCliente || '') : '' }));
        setClienteSeleccionado(cliente || null);
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

        // Relevancia: menor score = aparece primero.
        // Prioridad: IDCliente exacto > IDCliente empieza con > nombre exacto >
        // nombre empieza con > el resto (coincidencia parcial).
        const scoreCliente = (c) => {
            const idCliente = String(c.IDCliente || '').trim().toLowerCase();
            const nombre = String(c.Nombre || '').trim().toLowerCase();
            const nombreFantasia = String(c.NombreFantasia || '').trim().toLowerCase();
            if (idCliente === query) return 0;
            if (idCliente.startsWith(query)) return 1;
            if (nombre === query || nombreFantasia === query) return 2;
            if (nombre.startsWith(query) || nombreFantasia.startsWith(query)) return 3;
            if (idCliente.includes(query)) return 4;
            return 5;
        };

        return clientes
            .filter(c => {
                const id = String(c.CliIdCliente || c.CodCliente || '').toLowerCase();
                const idCliente = String(c.IDCliente || '').toLowerCase();
                const nombre = String(c.Nombre || '').toLowerCase();
                const nombreFantasia = String(c.NombreFantasia || '').toLowerCase();
                const ruc = String(c.CioRuc || '').toLowerCase();
                const tel = String(c.TelefonoTrabajo || '').toLowerCase();

                return id.includes(query) ||
                       idCliente.includes(query) ||
                       nombre.includes(query) ||
                       nombreFantasia.includes(query) ||
                       ruc.includes(query) ||
                       tel.includes(query);
            })
            .sort((a, b) => {
                const sa = scoreCliente(a);
                const sb = scoreCliente(b);
                if (sa !== sb) return sa - sb;
                // A igual relevancia, ordenar alfabéticamente por nombre
                return String(a.Nombre || a.NombreFantasia || '').localeCompare(String(b.Nombre || b.NombreFantasia || ''));
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
            if (filtros.empresaId) queryParams.append('empresaId', filtros.empresaId);
            if (filtros.metodoPagoId) queryParams.append('metodoPagoId', filtros.metodoPagoId);
            if (filtros.buscar.trim()) queryParams.append('buscar', filtros.buscar.trim());
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

    const fetchMetodosPago = async () => {
        try {
            const { data } = await api.get('/apipagos/metodos');
            setMetodosPago(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error al cargar métodos de pago:', err);
        }
    };

    useEffect(() => {
        fetchClientes();
        fetchDocumentos();
        fetchTiposExistentes();
        fetchMetodosPago();
        // eslint-disable-next-line
    }, []);

    // Abrir Nueva Factura Manual (opcionalmente con el cliente ya prellenado)
    const abrirNuevaFactura = () => {
        if (clientePrefill) setCopyData(clientePrefill);
        else setShowFacturaModal(true);
    };

    // Panel 360: si se pide entrar directo a "Nueva Factura Manual"
    useEffect(() => {
        if (autoNuevaFactura) abrirNuevaFactura();
        // eslint-disable-next-line
    }, [autoNuevaFactura]);

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFiltros(prev => ({ ...prev, [name]: value }));
    };

    const handleDownloadPdf = async (docId) => {
        try {
            const loadingToast = toast.loading('Generando PDF...');
            
            // Obtener el documento COMPLETO (con datos de empresa) desde el backend.
            // Importante: usar response.data.doc (trae Emp*), NO el doc de la lista (que no los tiene).
            const response = await api.get(`/contabilidad/cfe/documentos/${docId}/detalle`);
            const doc = response.data?.doc || docs.find(d => d.DocIdDocumento === docId);
            if (!doc) throw new Error("Documento no encontrado");
            const detalles = response.data?.detalles || [];

            // Generar y descargar el PDF localmente en el navegador
            generarPdfComprobanteDGI(doc, detalles);
            
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
        setConfirmEnvio({ tipo: 'lote', ids: nonPedidoDocs });
    };

    const doEnviarSeleccionados = async (nonPedidoDocs) => {
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
                generarPdfComprobanteDGI(data.doc, data.detalles || []);
                toast.success('Factura descargada');
            } else {
                toast.error('No se pudo obtener el documento.');
            }
        } catch (err) {
            toast.error('Error al descargar la factura: ' + (err.response?.data?.error || err.message));
        }
    };

    // Antes de emitir mostramos el CFE exacto que se le va a pedir a la DGI
    // (tipo 101/111 venta, 102/112 nota de crédito, 103/113 nota de débito, referencia y totales).
    const handleEnviarDGI = (doc) => {
        setPreviewDoc(doc);
    };

    const doEnviarDGI = async (doc) => {
        try {
            setSendingId(doc.DocIdDocumento);
            const { data } = await api.post(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/enviar`);
            toast.success(`${data.message}. CAE: ${data.cae}`);
            setPreviewDoc(null);
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
        if (!(await confirmar({ titulo: `¿Anular la factura ${doc.DocSerie}-${doc.DocNumero}?`, texto: 'Esto revertirá el asiento contable.', confirmar: 'Anular', peligro: true }))) return;
        
        try {
            const { data } = await api.put(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/anular`);
            toast.success('Factura anulada correctamente');
            // Cobros de caja que pagaban el documento: se anularon con él, o quedaron porque cubren otros
            (data?.avisos || []).forEach(a => toast.warning(a, { duration: 12000 }));
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
        
        if (!(await confirmar({ titulo: 'Reversar y generar de nuevo', texto: confirmMsg, confirmar: 'Continuar', peligro: true }))) return;

        try {
            const toastId = toast.loading('Reversando documento...');
            let refacturarInfo = null;   // crédito de la NC para pagar la factura corregida

            if (doc.CfeEstado === 'ACEPTADO_DGI') {
                const respNc = await api.post('/contabilidad/caja/nota-credito', {
                    docIdOrigen: doc.DocIdDocumento,
                    monto: doc.DocTotal,
                    motivo: 'Reverso para regeneración',
                    clienteId: doc.CliIdCliente || 1,
                    monedaId: doc.MonIdMoneda || 1,
                    cuentaId: doc.CueIdCuenta || (doc.MonIdMoneda === 2 ? 119 : 118),
                    // La plata que el cliente ya pagó queda para pagar la factura corregida
                    // (antes se la volvía a cobrar y quedaba un saldo a favor falso).
                    destinoPlata: 'REFACTURAR',
                });
                refacturarInfo = respNc?.data?.refacturar || null;
                // Si la factura era una compra de recurso, decir qué pasó con los metros
                if (respNc?.data?.avisoRecurso) {
                    toast.info(respNc.data.avisoRecurso, { duration: 12000 });
                }
            } else {
                const rAn = await api.put(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/anular`);
                (rAn?.data?.avisos || []).forEach(a => toast.warning(a, { duration: 12000 }));
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
                lineas: lineas,
                // Solo si la NC dejó plata libre: la factura corregida se paga con ese crédito.
                refacturar: refacturarInfo && Number(refacturarInfo.credito) > 0.009 ? refacturarInfo : null,
            });
        } catch (error) {
            toast.dismiss();
            toast.error('Error durante el reverso/copia: ' + (error.response?.data?.error || error.message));
        }
    };

    // NC emitida con destino "Es para refacturar": abre la factura corregida (copia del original)
    // que se paga con el crédito que dejó la NC.
    const abrirRefacturacion = async (docOri, refacturar) => {
        try {
            const response = await api.get(`/contabilidad/cfe/documentos/${docOri.DocIdDocumento}/detalle`);
            setCopyData({
                DocTipo: docOri.DocTipo,
                MonIdMoneda: docOri.MonIdMoneda,
                CliIdCliente: docOri.CliIdCliente,
                lineas: response.data?.detalles || [],
                refacturar: Number(refacturar?.credito) > 0.009 ? refacturar : null,
            });
        } catch (error) {
            toast.error('La NC se emitió, pero no se pudo abrir la factura corregida: ' + (error.response?.data?.error || error.message));
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

    const esNotaODebito = (doc) => isCreditNote(doc.DocTipo) || String(doc.DocTipo).toUpperCase().includes('DEBITO');
    const pendientesFiscales = docs.filter(d => d.CfeEstado === 'PENDIENTE' && isFiscalCfe(d.DocTipo));

    // Tipo + nomenclador DGI. Se distingue lo EMITIDO (hecho) de lo que CORRESPONDE (cálculo): si no coinciden,
    // la fila se marca.
    const celdaTipo = (doc) => (
        <>
            <div className="text-sm font-semibold text-zinc-800">{getTipoDocName(doc.DocTipo)}</div>
            {doc.DgiTipoCorrecto && (
                <div className="mt-0.5 space-y-1">
                    {doc.DgiTipoEmitido ? (
                        <div
                            className={`text-[11px] font-semibold ${doc.DgiAlerta ? 'text-brand-magenta' : 'text-zinc-400'}`}
                            title={doc.DgiEmitidoInferido
                                ? `Emitido como CFE ${doc.DgiTipoEmitido} (${doc.DgiTipoEmitidoNombre}).\n\nDato RECONSTRUIDO con la lógica vigente al emitir, porque este documento salió antes de que se empezara a guardar el tipo. Usa el documento que el cliente tiene HOY: si se lo editaron después de emitir, el número puede no ser exacto (el CAE del comprobante es la prueba definitiva).\n\nLos documentos que se emitan de ahora en más guardan el tipo real y no necesitan reconstrucción.`
                                : `Emitido como CFE ${doc.DgiTipoEmitido} (${doc.DgiTipoEmitidoNombre}). Dato guardado en el momento de la emisión.`}
                        >
                            Emitido: DGI {doc.DgiTipoEmitido} · {doc.DgiTipoEmitidoNombre}
                            {doc.DgiEmitidoInferido && <span className="font-normal text-zinc-400"> (inferido)</span>}
                        </div>
                    ) : (
                        <div
                            className={`text-[11px] font-semibold ${[102, 112, 103, 113].includes(doc.DgiTipoCorrecto) ? 'text-amber-700' : 'text-zinc-400'}`}
                            title={`Todavía no se envió. Al enviarlo se le pedirá a DGI un CFE tipo ${doc.DgiTipoCorrecto} (${doc.DgiTipoCorrectoNombre}).`}
                        >
                            Se emitirá: DGI {doc.DgiTipoCorrecto} · {doc.DgiTipoCorrectoNombre}
                        </div>
                    )}

                    {doc.DgiAlerta && (
                        <div
                            className={`${CHIP} bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20`}
                            title={`Este documento se emitió ante DGI como CFE ${doc.DgiTipoEmitido} (${doc.DgiTipoEmitidoNombre}), pero le corresponde ${doc.DgiTipoCorrecto} (${doc.DgiTipoCorrectoNombre}). Hay que regularizarlo ante DGI: el sistema no lo puede corregir solo.`}
                        >
                            <AlertTriangle size={12} /> Debía ser {doc.DgiTipoCorrecto} · {doc.DgiTipoCorrectoNombre}
                        </div>
                    )}
                </div>
            )}
        </>
    );

    const celdaCliente = (doc) => (
        <>
            <div className="text-sm text-zinc-800 font-semibold">
                {doc.CliNombreFantasia || doc.CliRazonSocial || 'Consumidor Final'}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {doc.StringIDCliente && (
                    <span className="text-[10px] font-bold font-mono text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                        {doc.StringIDCliente.trim()}
                    </span>
                )}
                {doc.CliRUT && <span className="text-[11px] text-zinc-400">RUT: {doc.CliRUT}</span>}
            </div>
        </>
    );

    const celdaTotal = (doc) => (
        <>
            <div className="text-sm font-black text-zinc-900 tabular-nums whitespace-nowrap">
                {doc.MonIdMoneda === 1 ? '$ ' : 'US$ '}
                {Number(doc.DocTotal).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mt-1">
                {doc.DocPagado ? (
                    <span className={`${CHIP} bg-emerald-50 text-emerald-700 border-emerald-200`} title={doc.MetodoPagoNombre || ''}>
                        Contado {doc.MetodoPagoNombre ? `(${doc.MetodoPagoNombre.trim()})` : ''}
                    </span>
                ) : (
                    <span className={`${CHIP} bg-zinc-50 text-zinc-600 border-zinc-200`}>
                        Crédito
                    </span>
                )}
            </div>
        </>
    );

    const celdaNumero = (doc) => (
        <>
            <div className="font-mono font-bold text-zinc-900 whitespace-nowrap">{doc.DocSerie}-{parseInt(doc.DocNumero, 10) || doc.DocNumero}</div>
            {doc.RetiroCodigos && (
                <div className="mt-0.5 font-mono text-xs font-bold text-brand-cyan" title="Nº de retiro que originó este documento">
                    {doc.RetiroCodigos}
                </div>
            )}
        </>
    );

    // Acciones según el estado del documento (las mismas que antes, con íconos parejos)
    const acciones = (doc) => {
        if (doc.CfeEstado === 'BORRADOR') return (
            <div className="flex items-center justify-center gap-0.5">
                <button onClick={() => handleDescargarFacturaPdf(doc)} className={ACCION} title="Vista previa PDF" aria-label="Vista previa PDF">
                    <Printer className="h-[18px] w-[18px]" />
                </button>
                <BotonEnviarEmail doc={doc} onClick={setEmailDoc} />
                <button onClick={() => abrirEdicion(doc)} className={ACCION} title="Editar Borrador" aria-label="Editar borrador">
                    <Edit className="h-[18px] w-[18px]" />
                </button>
                {!esNotaODebito(doc) && (
                    <button onClick={() => handleCopiar(doc)} className={ACCION} title="Convertir / Copiar como e-Ticket o e-Factura" aria-label="Copiar">
                        <Copy className="h-[18px] w-[18px]" />
                    </button>
                )}
                <button onClick={() => handleAnular(doc)} className={ACCION_PELIGRO} title="Reversar Documento" aria-label="Reversar">
                    <XCircle className="h-[18px] w-[18px]" />
                </button>
                {/* Si no es fiscal no se muestra nada: el badge "Borrador" de la
                    columna Estado DGI ya dice que este documento no se envía. */}
                {isFiscalCfe(doc.DocTipo) && (
                    <button onClick={() => handleEnviarDGI(doc)}
                        className="ml-1 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors"
                        title="Enviar a DGI">
                        <Send className="h-3.5 w-3.5" /> Enviar a DGI
                    </button>
                )}
            </div>
        );
        if (doc.CfeEstado === 'PENDIENTE') return (
            <div className="flex items-center justify-center gap-0.5">
                <button onClick={() => handleDescargarFacturaPdf(doc)} className={ACCION} title="Descargar Factura PDF" aria-label="Descargar PDF">
                    <Printer className="h-[18px] w-[18px]" />
                </button>
                <BotonEnviarEmail doc={doc} onClick={setEmailDoc} />
                {/* Editar: también NC/ND mientras sigan PENDIENTE (todavía no se
                    emitieron ante DGI, así que el comprobante no es fiscal aún).
                    El backend igual valida: editarFactura solo acepta PENDIENTE/BORRADOR. */}
                <button onClick={() => abrirEdicion(doc)} className={ACCION} aria-label="Editar"
                    title={esNotaODebito(doc) ? 'Editar esta nota — se puede porque todavía no se envió a DGI' : 'Editar Factura'}>
                    <Edit className="h-[18px] w-[18px]" />
                </button>
                {/* Reversar */}
                <button onClick={() => handleAnular(doc)} className={ACCION_PELIGRO} title="Reversar Documento" aria-label="Reversar">
                    <XCircle className="h-[18px] w-[18px]" />
                </button>
                {/* Copiar */}
                {!esNotaODebito(doc) && (
                    <button onClick={() => handleCopiar(doc)} className={ACCION} title="Copiar Factura" aria-label="Copiar">
                        <Copy className="h-[18px] w-[18px]" />
                    </button>
                )}
                {isFiscalCfe(doc.DocTipo) && (
                    <button onClick={() => handleEnviarDGI(doc)} disabled={sendingId === doc.DocIdDocumento}
                        className="ml-1 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-cyan text-white hover:bg-brand-cyan/90 transition-colors disabled:opacity-50"
                        title="Enviar a DGI" aria-label="Enviar a DGI">
                        {sendingId === doc.DocIdDocumento ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                )}
            </div>
        );
        if (doc.CfeEstado === 'ENVIANDO') return <span className="text-zinc-400 font-bold italic text-xs">Enviando a DGI…</span>;
        if (doc.CfeEstado === 'ANULADO') return <span className="text-zinc-400 font-bold italic text-xs">ANULADA</span>;
        return (
            <div className="flex items-center justify-center gap-0.5">
                <button onClick={() => handleDownloadPdf(doc.DocIdDocumento)}
                    className="mr-1 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
                    title="Descargar PDF">
                    <FileOutput className="h-3.5 w-3.5 text-brand-cyan" /> PDF
                </button>
                <BotonEnviarEmail doc={doc} onClick={setEmailDoc} />
                {/* Copiar (solo si no es nota de crédito o débito) */}
                {!esNotaODebito(doc) && (
                    <button onClick={() => handleCopiar(doc)} className={ACCION} title="Copiar Factura" aria-label="Copiar">
                        <Copy className="h-[18px] w-[18px]" />
                    </button>
                )}
                {/* Nota de Crédito o Débito según el tipo.
                    BLINDAJE: si este documento es una NC pero DGI lo aceptó
                    como VENTA (bug del DocTipo truncado → DgiAlerta), NO se
                    ofrece la Nota de Débito automática. Emitir una ND acá
                    volvería a SUMAR a la base imponible, cuando lo que hay
                    que hacer es una NC contra la e-Factura espuria. Requiere
                    regularización con el contador. */}
                {isCreditNote(doc.DocTipo) && doc.DgiAlerta ? (
                    <button
                        onClick={() => setRegularizarDoc(doc)}
                        className="ml-1 inline-flex items-center gap-1 text-xs font-bold text-brand-magenta bg-brand-magenta/10 border border-brand-magenta/20 rounded-lg px-2.5 py-1.5 hover:bg-brand-magenta/15 transition-colors"
                        title={`Esta Nota de Crédito llegó a DGI como CFE ${doc.DgiTipoEmitido} (${doc.DgiTipoEmitidoNombre}), no como nota de crédito. Requiere regularización fiscal — clic para ver cómo. NO se puede revertir con una Nota de Débito automática.`}
                    >
                        <AlertCircle className="h-4 w-4" /> Regularizar
                    </button>
                ) : isCreditNote(doc.DocTipo) ? (
                    <button onClick={() => handleOpenNcModal(doc, 'ND')} className={ACCION_PELIGRO} title="Generar Nota de Débito (Anula NC)" aria-label="Nota de débito">
                        <XCircle className="h-[18px] w-[18px]" />
                    </button>
                ) : (
                    <button onClick={() => handleOpenNcModal(doc, 'NC')} className={ACCION_PELIGRO} title="Generar Nota de Crédito (Anula Doc.)" aria-label="Nota de crédito">
                        <XCircle className="h-[18px] w-[18px]" />
                    </button>
                )}
            </div>
        );
    };

    const checkDoc = (doc) => doc.CfeEstado === 'PENDIENTE' && isFiscalCfe(doc.DocTipo) && (
        <input
            type="checkbox"
            className={CHECK}
            aria-label={`Seleccionar ${doc.DocSerie}-${doc.DocNumero}`}
            checked={selectedDocs.has(doc.DocIdDocumento)}
            onChange={() => toggleSelection(doc.DocIdDocumento)}
        />
    );

    const sinFilas = loading && docs.length === 0 ? (
        <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando documentos...
        </span>
    ) : docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center">
            <SearchX size={40} className="mb-3 text-brand-cyan" />
            <span className="text-sm font-bold text-zinc-700">No se encontraron documentos contables para los filtros seleccionados.</span>
            <span className="text-xs text-zinc-400 mt-1">Probá con otras fechas, otro estado u otro cliente.</span>
        </div>
    ) : null;

    return (
        <div className={`${embedded ? '' : 'px-3 sm:px-6 py-5 min-h-full'} w-full text-zinc-700 flex flex-col gap-4`}>
            <div className="flex flex-wrap items-center gap-3">
                <FileText size={embedded ? 24 : 30} className="text-brand-cyan shrink-0" />
                <div className="min-w-[220px] flex-1">
                    <h1 className={`${embedded ? 'text-lg' : 'text-xl sm:text-2xl'} font-black uppercase tracking-tight text-zinc-900 leading-none`}>
                        {embedded ? 'Bandeja CFE' : 'Bandeja de facturación electrónica (CFE)'}
                    </h1>
                    {!embedded && <p className="text-sm text-zinc-500 mt-1">Documentos emitidos, su envío a DGI y las notas de crédito</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
                    {selectedDocs.size > 0 && (
                        <button
                            onClick={handleEnviarSeleccionados}
                            disabled={loading || sendingId}
                            className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}
                        >
                            <Send size={16} />
                            Enviar seleccionados ({selectedDocs.size})
                        </button>
                    )}
                    <button
                        onClick={() => setShowNcExternaModal(true)}
                        className={`${BTN_SECUNDARIO} flex-1 sm:flex-none`}
                        title="Nota de crédito sobre una factura emitida en el sistema de facturación anterior"
                    >
                        <FileX size={16} className="text-brand-magenta" />
                        NC factura externa
                    </button>
                    <button onClick={abrirNuevaFactura} className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}>
                        <Plus size={16} />
                        Nueva factura manual
                    </button>
                </div>
            </div>

            <div className={`${CARD} p-4 grid grid-cols-2 lg:grid-cols-6 gap-3 items-start`}>
                <div className="min-w-0">
                    <span className={ETIQUETA}>Desde</span>
                    <SelectorFecha filtro name="fechaDesde" className="w-full" value={filtros.fechaDesde} onChange={handleFilterChange} placeholder="Desde" aria-label="Fecha desde" />
                </div>
                <div className="min-w-0">
                    <span className={ETIQUETA}>Hasta</span>
                    <SelectorFecha filtro name="fechaHasta" className="w-full" value={filtros.fechaHasta} onChange={handleFilterChange} placeholder="Hasta" aria-label="Fecha hasta" />
                </div>
                <div className="min-w-0">
                    <span className={ETIQUETA}>Estado DGI</span>
                    <Selector filtro name="estado" className="w-full" value={filtros.estado} onChange={handleFilterChange} aria-label="Estado DGI" anchoLista={220}>
                        <option value="">Todos</option>
                        <option value="PENDIENTE">Pendientes de Envío</option>
                        <option value="ACEPTADO_DGI">Aceptados por DGI</option>
                        <option value="RECHAZADO_DGI">Rechazados</option>
                    </Selector>
                </div>
                <div className="min-w-0">
                    <span className={ETIQUETA}>Tipo de documento</span>
                    <Selector filtro name="tipo" className="w-full" value={filtros.tipo} onChange={handleFilterChange} aria-label="Tipo de documento" anchoLista={260}>
                        <option value="">Todos</option>
                        {tiposExistentes.map(t => (
                            <option key={t} value={t}>{getTipoDocName(t)}</option>
                        ))}
                    </Selector>
                </div>
                {empresas.length > 1 && (
                    <div className="min-w-0">
                        <span className={ETIQUETA}>Empresa</span>
                        <Selector filtro name="empresaId" className="w-full" value={String(filtros.empresaId)} onChange={handleFilterChange} aria-label="Empresa" anchoLista={240}>
                            <option value="">Todas</option>
                            {empresas.map(e => (
                                <option key={e.EmpIdEmpresa} value={String(e.EmpIdEmpresa)}>{e.EmpNombreFantasia || e.EmpRazonSocial}</option>
                            ))}
                        </Selector>
                    </div>
                )}
                <div className="min-w-0">
                    <span className={ETIQUETA}>Método de pago</span>
                    <Selector filtro name="metodoPagoId" className="w-full" value={String(filtros.metodoPagoId)} onChange={handleFilterChange} aria-label="Método de pago" anchoLista={260}>
                        <option value="">Todos</option>
                        {metodosPago.map(m => (
                            <option key={m.MPaIdMetodoPago} value={String(m.MPaIdMetodoPago)}>{m.MPaDescripcionMetodo}</option>
                        ))}
                    </Selector>
                </div>
                <div className="relative col-span-2 min-w-0" ref={dropdownRef}>
                    <span className={ETIQUETA}>Cliente</span>
                    {clienteSeleccionado ? (
                        /* Tarjeta del cliente seleccionado */
                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5 min-w-0">
                                <User size={18} className="text-brand-cyan shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                    <p className="text-zinc-900 text-sm font-bold leading-tight truncate">
                                        {clienteSeleccionado.Nombre || clienteSeleccionado.NombreFantasia}
                                    </p>
                                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                                        {clienteSeleccionado.IDCliente && String(clienteSeleccionado.IDCliente).trim() && (
                                            <span className="font-mono font-bold text-zinc-600 mr-2">{String(clienteSeleccionado.IDCliente).trim()}</span>
                                        )}
                                        RUC / CI: <span className="font-mono font-bold text-zinc-700">{clienteSeleccionado.CioRuc || 'S/N'}</span>
                                        {clienteSeleccionado.TelefonoTrabajo && <> · Tel: <span className="font-mono text-zinc-700">{clienteSeleccionado.TelefonoTrabajo}</span></>}
                                    </p>
                                    {clienteSeleccionado.Email && <p className="text-[11px] text-zinc-500 truncate">Email: <span className="font-mono text-zinc-700">{clienteSeleccionado.Email}</span></p>}
                                </div>
                            </div>
                            {!initialCliente && (
                                <button
                                    type="button"
                                    onClick={() => handleSelectCliente(null)}
                                    className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors shrink-0"
                                    title="Quitar cliente"
                                    aria-label="Quitar cliente"
                                >
                                    <Trash2 size={15} />
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="relative">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre, ID, RUC o tel..."
                                value={clienteSearch}
                                onChange={handleInputChange}
                                onFocus={() => setShowClienteDropdown(true)}
                                aria-label="Cliente"
                                className={CAMPO}
                            />
                            {clienteSearch && (
                                <button
                                    type="button"
                                    onClick={() => { setClienteSearch(''); setFiltros(prev => ({ ...prev, clienteId: '' })); }}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                                    aria-label="Borrar cliente"
                                >
                                    <XCircle size={16} />
                                </button>
                            )}
                        </div>
                    )}
                    {showClienteDropdown && !clienteSeleccionado && (
                        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl bg-white py-1 shadow-lg border border-zinc-200">
                            {clientesFiltrados.length === 0 ? (
                                <div className="py-2.5 px-3 text-sm text-zinc-400">
                                    No se encontraron clientes
                                </div>
                            ) : (
                                clientesFiltrados.slice(0, 100).map(c => (
                                    <div
                                        key={c.CliIdCliente || c.CodCliente}
                                        onClick={() => handleSelectCliente(c)}
                                        className={`cursor-pointer select-none py-2 px-3 hover:bg-zinc-50 text-zinc-800 transition-colors ${
                                            String(filtros.clienteId) === String(c.CliIdCliente || c.CodCliente) ? 'bg-brand-cyan/5 font-semibold' : ''
                                        }`}
                                    >
                                        <span className="block truncate text-sm">
                                            {c.Nombre || c.NombreFantasia}
                                        </span>
                                        <span className="block truncate text-[11px] text-zinc-400 mt-0.5">
                                            ID: {c.CliIdCliente || c.CodCliente}{c.IDCliente && String(c.IDCliente).trim() ? ` | IDCliente: ${String(c.IDCliente).trim()}` : ''} | RUC: {c.CioRuc || 'S/N'} {c.TelefonoTrabajo ? `| Tel: ${c.TelefonoTrabajo}` : ''}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
                <div className="col-span-2 lg:col-span-2 min-w-0">
                    <span className={ETIQUETA}>Nro / Retiro / Orden</span>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input
                            type="text"
                            name="buscar"
                            value={filtros.buscar}
                            onChange={handleFilterChange}
                            onKeyDown={(e) => { if (e.key === 'Enter') fetchDocumentos(); }}
                            placeholder="ET-4049 · RW-21510 · SUB-11554"
                            title="Busca por Nro interno (ET-4049), Nº de retiro (RW-21510) o Nº de orden (SUB-11554). Ignora el rango de fechas: encuentra el documento esté donde esté."
                            aria-label="Nro, retiro u orden"
                            className={CAMPO}
                        />
                        {filtros.buscar && (
                            <button
                                type="button"
                                onClick={() => setFiltros(prev => ({ ...prev, buscar: '' }))}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                                title="Limpiar búsqueda"
                                aria-label="Limpiar búsqueda"
                            >
                                <XCircle size={16} />
                            </button>
                        )}
                    </div>
                    {filtros.buscar.trim() && (
                        <p className="text-[11px] text-amber-700 font-medium mt-1">
                            Busca en TODAS las fechas (ignora Desde/Hasta)
                        </p>
                    )}
                </div>
                <div className="col-span-2 lg:col-span-2">
                    <span className={`${ETIQUETA} hidden lg:block`}>&nbsp;</span>
                    <button onClick={fetchDocumentos} disabled={loading} className={`${BTN_PRINCIPAL} w-full`}>
                        {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Buscar
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 bg-brand-magenta/10 text-brand-magenta p-4 rounded-xl border border-brand-magenta/20 text-sm font-bold">
                    <AlertCircle size={16} className="shrink-0" /> {error}
                </div>
            )}

            <div className="flex items-center justify-between gap-3 px-1 -mb-1">
                <div className="flex items-center gap-3">
                    {!conTabla && pendientesFiscales.length > 0 && (
                        <input type="checkbox" className={CHECK} onChange={toggleAll} aria-label="Seleccionar todos los pendientes"
                            checked={selectedDocs.size === pendientesFiscales.length} />
                    )}
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Documentos</h3>
                </div>
                {!loading && <span className="text-xs font-bold text-zinc-400 tabular-nums">{docs.length} documento{docs.length !== 1 ? 's' : ''}</span>}
            </div>

            {!conTabla ? (
                sinFilas ? <div className={`${CARD} px-4 py-12 text-center`}>{sinFilas}</div> : (
                    <div className="flex flex-col gap-2.5">
                        {docs.map(doc => (
                            <div key={doc.DocIdDocumento} className={`${CARD} p-3.5 flex flex-col gap-2.5`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-2.5 min-w-0">
                                        {checkDoc(doc) && <div className="pt-0.5">{checkDoc(doc)}</div>}
                                        <div className="min-w-0">{celdaNumero(doc)}</div>
                                    </div>
                                    <div className="text-right shrink-0">{getStatusBadge(doc.CfeEstado)}</div>
                                </div>
                                <div className="min-w-0">{celdaCliente(doc)}</div>
                                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                                    <div className="min-w-[140px] flex-1">{celdaTipo(doc)}</div>
                                    <div className="text-right ml-auto">{celdaTotal(doc)}</div>
                                </div>
                                {doc.CfeEstado === 'ACEPTADO_DGI' && <div className="bg-zinc-50 rounded-xl px-3 py-2">{renderCfeOficialCol(doc)}</div>}
                                <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-zinc-100">
                                    {renderDocFecha(doc.DocFechaEmision)}
                                    <div className="overflow-x-auto">{acciones(doc)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            ) : (
            <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                            <tr>
                                <th scope="col" className="px-4 py-3 w-10">
                                    <input
                                        type="checkbox"
                                        className={CHECK}
                                        aria-label="Seleccionar todos los pendientes"
                                        onChange={toggleAll}
                                        checked={docs.length > 0 && pendientesFiscales.length > 0 && selectedDocs.size === pendientesFiscales.length}
                                    />
                                </th>
                                <th scope="col" className={TH}>Fecha</th>
                                <th scope="col" className={TH}>Tipo</th>
                                <th scope="col" className={TH}>Nro interno</th>
                                <th scope="col" className={TH}>Cliente</th>
                                <th scope="col" className={TH}>Total</th>
                                <th scope="col" className={TH}>Estado DGI</th>
                                <th scope="col" className={TH}>Nro oficial / CAE</th>
                                <th scope="col" className={`${TH} text-center`}>Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {sinFilas ? (
                                <tr>
                                    <td colSpan="9" className="px-4 py-14 text-center">{sinFilas}</td>
                                </tr>
                            ) : (
                                docs.map(doc => (
                                    <tr key={doc.DocIdDocumento} className="hover:bg-zinc-50 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap">{checkDoc(doc)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">{renderDocFecha(doc.DocFechaEmision)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">{celdaTipo(doc)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm">{celdaNumero(doc)}</td>
                                        <td className="px-4 py-3">{celdaCliente(doc)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">{celdaTotal(doc)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">{getStatusBadge(doc.CfeEstado)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">{renderCfeOficialCol(doc)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-center">{acciones(doc)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

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

            {showNcExternaModal && (
                <NcExternaModal
                    onClose={() => setShowNcExternaModal(false)}
                    onSuccess={() => {
                        setShowNcExternaModal(false);
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
                    onSuccess={(data) => {
                        const docOri = ncDoc;
                        setShowNcModal(false);
                        setNcDoc(null);
                        setNcLineas([]);
                        fetchDocumentos();
                        // NC con destino "Es para refacturar": se abre la factura corregida (copia del
                        // original) pagada con el crédito que dejó la NC — no se cobra de nuevo.
                        if (data?.refacturar && docOri) abrirRefacturacion(docOri, data.refacturar);
                    }}
                />
            )}

            {/* PreviewModal eliminada — el lápiz abre el modal de edición completo */}

            {/* Confirmación de envío a DGI (reemplaza el window.confirm nativo) */}
            <ConfirmationModal
                isOpen={!!confirmEnvio}
                onClose={() => setConfirmEnvio(null)}
                onConfirm={() => {
                    if (confirmEnvio?.tipo === 'uno') doEnviarDGI(confirmEnvio.doc);
                    else if (confirmEnvio?.tipo === 'lote') doEnviarSeleccionados(confirmEnvio.ids);
                }}
                title="Enviar a DGI"
                message={confirmEnvio?.tipo === 'uno'
                    ? `Se enviará el documento ${confirmEnvio?.doc?.DocSerie}-${confirmEnvio?.doc?.DocNumero} (${confirmEnvio?.doc?.DocTipo || ''}) a DGI a través de SISNET.\n\nUna vez aceptado por DGI, el comprobante es fiscal y ya no se puede editar (solo anular con Nota de Crédito).`
                    : `Se enviarán ${confirmEnvio?.ids?.length || 0} documentos a DGI a través de SISNET.\n\nUna vez aceptados, los comprobantes son fiscales y ya no se pueden editar (solo anular con Nota de Crédito).`}
                confirmText="Sí, enviar a DGI"
                cancelText="Cancelar"
            />

            {ventanaConfirmar}

            {regularizarDoc && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[6000] p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="flex items-start gap-2.5 px-5 py-4 border-b border-zinc-100">
                            <AlertCircle className="h-5 w-5 text-brand-magenta shrink-0 mt-0.5" />
                            <h3 className="font-black text-zinc-900">
                                Nota de Crédito que llegó mal a DGI — {regularizarDoc.DocSerie}-{regularizarDoc.DocNumero}
                            </h3>
                        </div>
                        <div className="p-5 space-y-3 text-sm text-zinc-700 overflow-y-auto">
                            <p>
                                Esta Nota de Crédito se emitió ante DGI como{' '}
                                <b>CFE {regularizarDoc.DgiTipoEmitido} · {regularizarDoc.DgiTipoEmitidoNombre}</b> (una venta),
                                no como nota de crédito. Es decir, en DGI <b>sumó</b> ventas e IVA en vez de restarlos.
                            </p>
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                                <b className="text-amber-800">Por eso NO se puede revertir con una Nota de Débito.</b>
                                <p className="mt-1">
                                    Una Nota de Débito volvería a <b>sumar</b> a la base imponible: empeoraría el problema.
                                </p>
                            </div>
                            <p className="font-semibold text-zinc-900">La regularización es fiscal y la define el contador:</p>
                            <ol className="list-decimal list-inside space-y-1">
                                <li>Emitir una <b>Nota de Crédito (112 / 102)</b> contra la <b>e-Factura/e-Ticket espuria</b> ({renderCfeOficialCol(regularizarDoc) ? '' : ''}el comprobante que DGI aceptó, {regularizarDoc.CfeNumeroOficial || 's/nº'}), para neutralizar esa venta.</li>
                                <li>Emitir la nota de crédito real, ya bien tipada, contra la factura original.</li>
                            </ol>
                            <p className="text-xs text-zinc-500">
                                El sistema no puede hacerlo automáticamente: el comprobante ya existe en DGI con su CAE y no se puede pisar.
                                Coordiná los pasos con tu contador antes de emitir nada.
                            </p>
                        </div>
                        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end">
                            <button onClick={() => setRegularizarDoc(null)} className={BTN_PRINCIPAL}>
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {emailDoc && (
                <CfeEnviarEmailModal
                    doc={emailDoc}
                    onClose={() => setEmailDoc(null)}
                    onEnviado={() => fetchDocumentos()}
                />
            )}

            {previewDoc && (
                <CfePreviewDgiModal
                    doc={previewDoc}
                    enviando={sendingId === previewDoc.DocIdDocumento}
                    onClose={() => setPreviewDoc(null)}
                    onConfirmarEnvio={() => doEnviarDGI(previewDoc)}
                />
            )}

            {/* Las notas de crédito/débito tienen su propia ventana: el modal de facturación
                es para EMITIR ventas (solapas de tipo, serie, contado/crédito, medios de pago,
                calculadora de vuelto) y nada de eso aplica a una nota. */}
            {editDocId && (editDocEsNota ? (
                <NcEditarModal
                    docId={editDocId}
                    onClose={() => { setEditDocId(null); setEditDocEsNota(false); }}
                    onSuccess={() => {
                        setEditDocId(null);
                        setEditDocEsNota(false);
                        fetchDocumentos();
                    }}
                />
            ) : (
                <FacturacionManualModal
                    mode="editar"
                    editDocId={editDocId}
                    onClose={() => setEditDocId(null)}
                    onSuccess={() => {
                        setEditDocId(null);
                        fetchDocumentos();
                    }}
                />
            ))}
        </div>
    );
};

export default ContabilidadBandejaCFE;
