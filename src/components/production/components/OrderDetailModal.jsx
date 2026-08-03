import React, { useState, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { ordersService, fileControlService } from '../../../services/api';
import api from '../../../services/apiClient';
import FileItem, { ActionButton } from './FileItem';
import ReferenceItem from './ReferenceItem';
import { toast } from 'sonner';
import OrderRequirementsList from '../../logistics/OrderRequirementsList';
import { printLabelsHelper } from "../../../utils/printHelper";
import { labelUbicacion } from "../../../utils/terminacionesGeo";
import QuotationEditModal from '../../logistics/QuotationEditModal';
import { useAuth } from '../../../context/AuthContext';
import { Listbox, Transition } from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';
import ModalConfirmacionFalla from './ModalConfirmacionFalla';
import ModalLiberacionFalla from './ModalLiberacionFalla';
import Swal from 'sweetalert2';

// Visor 3D del parche TPU (el mismo del portal, en modo interno: el diseñador elige las texturas).
// Lazy: carga three.js/pdfjs solo si se abre.
const Tpu3DViewer = React.lazy(() => import('../../../client-portal/modulos/Tpu3DViewer'));

// Capas del arte TPU: son EXACTAMENTE estas, ni una más ni una menos. Espeja CAPAS_ARTE_TPU del
// backend (ordersController) — el que manda es el backend, esto es UX para no dejar subir de más.
const CAPAS_ARTE_TPU = 5;

const OrderDetailModal = ({ order, onClose, onOrderUpdated, readOnly = false }) => {
    // Estado Pestañas
    const [activeTab, setActiveTab] = useState('files');
    const [fallaImages, setFallaImages] = useState([]); // imágenes de fallas anotadas (solo SB)
    const { user } = useAuth();

    // ¿Este usuario puede MODIFICAR el estado de la orden? Solo internos con rol habilitado.
    // El backend es el que manda (soloInternoConRol en /orders/:id/status y /area-status);
    // esto es UX: sin el gate se veía un combo que después rebotaba con 403.
    // Comparación normalizada (sin acentos, minúsculas) igual que en el backend.
    // Admin(1), User(2), Coordinador(11). Espeja ROLES_EDITAN_ESTADO del backend.
    const ROLES_EDITAN_ESTADO = ['admin', 'user', 'coordinador'];
    const normalizaRol = (r) => String(r || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim().toLowerCase();
    const puedeEditarEstado = user?.userType === 'INTERNAL'
        && ROLES_EDITAN_ESTADO.includes(normalizaRol(user?.rol));

    // Estado local Base
    const [currentOrder, setCurrentOrder] = useState(null);

    // isSB robusto: la -F puede venir con el código en otro campo (code/codigoOrden/CodigoOrden) y con el
    // área ya distinta de 'SB' (la reposición avanza a Depósito). Chequeamos todas las variantes en el prop
    // y en el fetch (currentOrder), así el tab de fallas marcadas también aparece en la orden -F.
    const isSB = (() => {
        const code = String(order?.code || order?.codigoOrden || order?.CodigoOrden
            || currentOrder?.code || currentOrder?.codigoOrden || currentOrder?.CodigoOrden || '');
        const area = String(order?.area || order?.AreaID || currentOrder?.area || currentOrder?.AreaID || '').toUpperCase();
        return area === 'SB' || /^SUB-/i.test(code);
    })();
    const isTPU = String(order?.area || order?.AreaID || currentOrder?.area || currentOrder?.AreaID || '').toUpperCase() === 'TPU';
    const [files, setFiles] = useState([]);
    const [uploadingTPU, setUploadingTPU] = useState(false);
    // Progreso de la subida TPU: % global ponderado por bytes + archivo en curso (para la barra).
    const [progresoTPU, setProgresoTPU] = useState(null); // { pct, actual, total } | null
    const [configEstados, setConfigEstados] = useState([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [labels, setLabels] = useState([]);
    const [loadingLabels, setLoadingLabels] = useState(false);
    const [draftStates, setDraftStates] = useState({ status: '', areaStatus: '' });

    // Fase del flujo TPU: hasta que el cliente aprueba, lo único que se sube es el boceto.
    // También decide el texto del botón del 3D (ver vs. seleccionar texturas).
    // Las texturas elegidas NO se listan acá: se ven y se corrigen en el visor 3D, que es donde
    // se ve lo que se está tocando.
    const [tpuEstado, setTpuEstado] = useState({ aprobado: false, rechazado: false, enLote: false, texturasElige: null });
    const [visor3D, setVisor3D] = useState(false); // visor TPU interno (elegir texturas)

    // Reuso de matriz TPU con cantidad distinta: la orden trae arte "base" a regenerar y NO va a
    // aprobación del cliente — al subir las capas nuevas, entra directo a producción.
    const esReusoRegen = isTPU && (
        /\[REUSO-REGEN\]/i.test(String(currentOrder?.Nota || currentOrder?.nota || order?.Nota || order?.nota || '')) ||
        files.some(f => /REGENERAR|ARTE BASE/i.test(String(f.TipoArchivo || f.tipo || f.NombreArchivo || f.nombre || '')))
    );

    // TPU: en qué fase está el flujo (aprobado / rechazado / en lote / quién elige las texturas).
    useEffect(() => {
        if (!isTPU || !currentOrder?.id) return;
        let vivo = true;
        (async () => {
            try {
                const t = await ordersService.getTexturasOrden(currentOrder.id);
                if (!vivo) return;
                setTpuEstado({ aprobado: !!t?.aprobado, rechazado: !!t?.rechazado, enLote: !!t?.enLote, texturasElige: t?.texturasElige || null });
            } catch (_) { /* sin datos: el modal se comporta como antes de la aprobación */ }
        })();
        return () => { vivo = false; };
    }, [isTPU, currentOrder?.id]);

    useEffect(() => {
        if (currentOrder) {
            let initialGeneralStatus = currentOrder.status || 'Pendiente';
            
            if (currentOrder.areaStatus && configEstados?.length > 0) {
                 const selectedAreaState = configEstados.find(s => s.Nombre === currentOrder.areaStatus);
                 if (selectedAreaState && selectedAreaState.EstadoPadreID) {
                      const parentState = configEstados.find(s => s.EstadoID == selectedAreaState.EstadoPadreID);
                      if (parentState) {
                           initialGeneralStatus = parentState.Nombre;
                      }
                 }
            }

            setDraftStates({
                status: initialGeneralStatus,
                areaStatus: currentOrder.areaStatus || ''
            });
        }
    }, [currentOrder, configEstados]);

    // Estado de Edición
    const [editingFileId, setEditingFileId] = useState(null);
    const [editValues, setEditValues] = useState({ copias: 1, metros: 0, ancho: 0, alto: 0, link: '', puntadas: 0, bajadas: 0, bajadasAdicionales: 0 });

    // Estado Cancelación
    const [cancelModalOpen, setCancelModalOpen] = useState(false);
    const [cancelDetails, setCancelDetails] = useState("");
    const [cancelType, setCancelType] = useState(null); // 'ORDER' | 'REQUEST' | 'FILE'
    const [fileToCancel, setFileToCancel] = useState(null);
    const [motivosOptions, setMotivosOptions] = useState([]);
    const [selectedMotivo, setSelectedMotivo] = useState(null);

    useEffect(() => {
        if (cancelModalOpen) {
            // Motivos filtrados por el área de la orden (flags DF/SB en MotivosCancelacion)
            const areaMotivos = currentOrder?.area || currentOrder?.AreaID || order?.area || order?.AreaID || '';
            fileControlService.getMotivosCancelacion(areaMotivos).then(res => {
                if (Array.isArray(res)) {
                    setMotivosOptions([...res, { MotivoID: 'otros', Titulo: 'Otros' }]);
                }
            }).catch(err => console.error(err));
        } else {
            setSelectedMotivo(null);
            setCancelDetails("");
        }
    }, [cancelModalOpen]);


    // Estado modales Canasto Falla
    const [modalFallaData,      setModalFallaData]      = useState(null);
    const [modalLiberacionData, setModalLiberacionData] = useState(null);
    const [liberandoFalla,      setLiberandoFalla]      = useState(false);

    // Estado Nuevo Producto/Servicio
    const [isAddingService, setIsAddingService] = useState(false);
    const [newService, setNewService] = useState({ name: '', quantity: 1, puntadas: 0, bajadas: 0, bajadasAdicionales: 0 });
    const [articlesList, setArticlesList] = useState([]);

    // Cargar artículos al abrir la pestaña (FILTRADOS POR ÁREA)
    useEffect(() => {
        if (activeTab === 'services' && articlesList.length === 0 && currentOrder?.area) {
            api.get(`/nomenclators/articles-by-area/${currentOrder.area}`)
                .then(res => {
                    if (res.data?.success) {
                        setArticlesList(res.data.data);
                    }
                })
                .catch(err => console.error("Error cargando artículos por área:", err));
        }
    }, [activeTab, currentOrder?.area, articlesList.length]);

    const handleAddService = async () => {
        if (!newService.name.trim()) return toast.error("Debe seleccionar o ingresar un producto.");

        // Validar que el producto exista en la lista cargada
        const productExists = articlesList.some(a => (a.Descripcion || '').trim() === newService.name.trim());
        if (!productExists) {
            return toast.error("Por favor, seleccione un producto válido de la lista.");
        }

        const user = JSON.parse(localStorage.getItem('user')) || {};
        const safeUser = user.id || user.UsuarioID || 1;

        toast.promise(
            ordersService.addFile({
                ordenId: currentOrder.id,
                nombre: newService.name,
                tipo: 'Servicio',
                copias: newService.quantity,
                link: '',
                metros: 0,
                userId: safeUser,
                puntadas: newService.puntadas || 0,
                bajadas: newService.bajadas || 0,
                bajadasAdicionales: newService.bajadasAdicionales || 0
            }),
            {
                loading: 'Agregando producto...',
                success: () => {
                    setIsAddingService(false);
                    setNewService({ name: '', quantity: 1, puntadas: 0, bajadas: 0, bajadasAdicionales: 0 });
                    reloadFiles();
                    return 'Producto agregado correctamente';
                },
                error: 'Error al agregar'
            }
        );
    };

    const handleControlItem = async (item, estado, isService = false) => {
        const itemId = item.id || item.ArchivoID || item.ServicioID;
        const safeUser = user?.id || user?.UsuarioControl || 1;
        const payload = { archivoId: itemId, estado, usuario: safeUser, isService };

        if (estado === 'FALLA') {
            const motivo = prompt("Ingrese el motivo de la falla:");
            if (!motivo) return;
            payload.motivo = motivo;
        }

        try {
            const res = await fileControlService.postControl(payload);
            reloadFiles();
            if (onOrderUpdated) onOrderUpdated();
            toast.success(estado === 'FALLA' ? 'Falla registrada' : `Estado actualizado a ${estado}`);

            // Modal: hermanas retroactivas movidas a Canasto Falla
            if (res?.data?.fallaDetectada && res.data.ordenesRetroactivas?.length > 0) {
                setModalFallaData({
                    ordenes:  res.data.ordenesRetroactivas,
                    noDocERP: currentOrder?.noDocERP || currentOrder?.NoDocERP,
                    areaId:   currentOrder?.area
                });
            }
            // Modal: pedido completamente resuelto, listo para liberar
            if (res?.data?.listoParaProduccion && res.data.ordenesParaLiberar?.length > 0) {
                setModalLiberacionData({
                    ordenes:  res.data.ordenesParaLiberar,
                    noDocERP: currentOrder?.noDocERP || currentOrder?.NoDocERP,
                    areaId:   currentOrder?.area
                });
            }
        } catch (e) {
            toast.error('Error: ' + (e.response?.data?.error || e.message));
        }
    };

    // Operador confirmó que movió físicamente las órdenes al Canasto Falla
    const handleConfirmarFalla = async () => {
        try {
            await api.post('/production-file-control/canasto-falla/confirmar', {
                userId:           user?.id,
                noDocERP:         modalFallaData.noDocERP,
                areaId:           modalFallaData.areaId,
                ordenesAfectadas: modalFallaData.ordenes
            });
            setModalFallaData(null);
            toast.success('Confirmación registrada');
        } catch (e) {
            toast.error('Error al confirmar: ' + (e.response?.data?.error || e.message));
        }
    };

    // Operador confirma liberación → sistema mueve a Canasto Produccion
    const handleLiberarFalla = async () => {
        setLiberandoFalla(true);
        try {
            await api.post('/production-file-control/canasto-falla/liberar', {
                userId:   user?.id,
                noDocERP: modalLiberacionData.noDocERP,
                areaId:   modalLiberacionData.areaId
            });
            setModalLiberacionData(null);
            if (onOrderUpdated) onOrderUpdated();
            toast.success('¡Órdenes liberadas al Canasto Producción!');
        } catch (e) {
            toast.error('Error al liberar: ' + (e.response?.data?.error || e.message));
        } finally {
            setLiberandoFalla(false);
        }
    };


    const handleDeleteService = (fileId) => {
        if (serviceFiles.length <= 1) {
            return toast.error("La orden debe tener al menos un producto/servicio. No se puede eliminar el último.");
        }
        if (!confirm("¿Está seguro de eliminar este producto/servicio de la cotización?")) return;
        toast.promise(
            ordersService.deleteFile(fileId),
            {
                loading: 'Eliminando...',
                success: () => {
                    reloadFiles();
                    return 'Eliminado correctamente';
                },
                error: 'Error al eliminar'
            }
        );
    };

    // TPU: eliminar un archivo de arte (por si el operario se equivocó al subir). Borra la fila.
    const handleDeleteFileTPU = async (fileId) => {
        // Modal propio en vez del confirm() del navegador: el nativo se dibuja pegado al borde de
        // la ventana, fuera del modal de la orden, y no se puede leer como parte de la pantalla.
        const r = await Swal.fire({
            title: '¿Eliminar el boceto?',
            html: 'Se borra el archivo de la orden. <b>No se puede deshacer.</b><br/>Después vas a poder subir uno nuevo.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#71717a',
            customClass: { container: '!z-[99999]' },
        });
        if (!r.isConfirmed) return;
        toast.promise(
            ordersService.deleteFile(fileId),
            {
                loading: 'Eliminando...',
                success: () => { loadData(currentOrder.id, currentOrder.area); onOrderUpdated?.(); return 'Archivo eliminado'; },
                error: 'Error al eliminar el archivo'
            }
        );
    };

    // Carga de Etiquetas
    useEffect(() => {
        if (currentOrder?.id) {
            fileControlService.getEtiquetas(currentOrder.id)
                .then(data => setLabels(data))
                .catch(e => console.error(e));
        } else {
            setLabels([]);
        }
    }, [currentOrder?.id]);

    // Listas filtradas con lógica robusta (Case Insensitive y Catch-All)
    const normalizeType = (t) => (t || '').toUpperCase();
    const servTypes = ['SERVICIO', 'ACABADO'];

    // ¿Esta orden es una reposición? (código termina en -R1, -R2, ...). En ese caso el
    // integral trae el archivo de la orden madre (readonly) Y el de la reposición (editable),
    // que se ven idénticos porque heredan el mismo nombre → los etiquetamos para distinguirlos.
    const isRepoOrder = /-R\d+/i.test(String(currentOrder?.code || ''));

    // Archivos de Impresión = select * from ArchivosOrden, pero el integral trae los de TODAS las
    // órdenes hermanas del pedido (mismo NoDocERP, incluidas otras hermanas de bultos tipo 1/2, 2/2).
    // Acá solo debe verse el arte de ESTA orden puntual; la excepción es la reposición, que sí debe
    // mostrar también el archivo de la orden madre (readonly) junto al propio.
    const productionFiles = files.filter(f => {
        const esProduccion = f.Categoria === 'produccion' || (!f.Categoria && !servTypes.includes(normalizeType(f.tipo)));
        if (!esProduccion) return false;
        if (isRepoOrder) return true;
        return String(f.OrdenID) === String(currentOrder?.id);
    });

    // Archivos de Referencia = select * from ArchivosReferencia
    const referenceFiles = files.filter(f => f.Categoria === 'referencia');

    // TPU: el arte cuyo nombre contiene "boceto" es el BOCETO DE PRODUCCIÓN. Es LO ÚNICO que hace
    // falta para mandar la orden a aprobación (las otras capas se suben después, ya aprobada), y se
    // MUESTRA en la pestaña de Referencias (debajo del boceto del cliente) con su propio tag — es el
    // que el cliente ve en el portal para aprobar (el backend filtra por 'boceto' con fallback a cmyk).
    const esBocetoProduccion = (f) => isTPU && /boceto/i.test(String(f.nombre || f.NombreArchivo || ''));
    const printFilesVista = productionFiles.filter(f => !esBocetoProduccion(f));
    const bocetosProduccion = productionFiles.filter(esBocetoProduccion);

    // Fase BOCETO del flujo TPU: el cliente todavía no aprobó → lo único que se sube es el boceto
    // de producción (un solo PDF). El resto del arte recién va después de la aprobación. El reuso
    // no pasa por aprobación, así que sube sus capas directo.
    const faseBocetoTPU = isTPU && !esReusoRegen && !tpuEstado.aprobado;

    // Cotizar Productos = select * from ServiciosExtraOrden
    const serviceFiles = files.filter(f => f.Categoria === 'servicio' || (f.tipo && servTypes.includes(normalizeType(f.tipo))));

    const handleAddLabel = () => {
        toast("¿Crear una etiqueta EXTRA para esta orden?", {
            action: {
                label: 'Crear',
                onClick: async () => {
                    try {
                        setLoadingLabels(true);
                        await fileControlService.createExtraLabel(currentOrder.id);
                        const data = await fileControlService.getEtiquetas(currentOrder.id);
                        setLabels(data);
                        toast.success("Etiqueta extra creada");
                    } catch (e) { toast.error("Error: " + (e.response?.data?.error || e.response?.data?.message || e.message)); }
                    finally { setLoadingLabels(false); }
                }
            },
        });
    };

    // TPU: subir los PDFs de arte (producción) a la orden desde el detalle
    const handleUploadTPUFiles = async (fileList) => {
        const todos = Array.from(fileList || []);
        let validos = todos.filter(f => {
            const n = (f.name || '').toLowerCase();
            return n.endsWith('.pdf') || n.endsWith('.plt') || f.type === 'application/pdf';
        });
        if (validos.length === 0) return toast.error('Solo se permiten archivos PDF o PLT.');
        if (validos.length !== todos.length) toast.error('Se ignoraron archivos que no son PDF/PLT.');

        const activos = productionFiles.filter(f => (f.Estado || f.estado || f.EstadoArchivo || '').toUpperCase() !== 'CANCELADO');
        const yaHay = activos.length;
        // Para el tope del arte NO cuenta el boceto: es lo que el cliente aprobó, no una capa, y
        // se muestra en la pestaña de referencias. Contándolo, el tope se comía una capa de arte.
        const yaHayArte = activos.filter(f => !esBocetoProduccion(f)).length;
        if (faseBocetoTPU) {
            // Antes de la aprobación: UN archivo, PDF, y es el boceto de producción.
            if (yaHay >= 1) return toast.error('Ya hay un boceto de producción cargado. Envialo a aprobación (si está mal, borralo y subí otro).');
            if (todos.length > 1) return toast.error('Antes de la aprobación se sube UN solo archivo: el boceto de producción.');
            const f = validos[0];
            if (!(f.name || '').toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') {
                return toast.error('El boceto de producción debe ser un PDF.');
            }
            // La convención es que el nombre lleve "boceto" (así lo reconocen el portal y el visor
            // 3D). Si el operario no lo nombró así, se renombra solo en vez de rebotar la subida.
            validos = /boceto/i.test(f.name || '')
                ? [f]
                : [new File([f], `BOCETO-${f.name}`, { type: f.type })];
        } else if (yaHayArte + validos.length > CAPAS_ARTE_TPU) {
            // El arte son CAPAS_ARTE_TPU capas exactas (sin contar las canceladas). Acá es tope
            // porque se suben de a poco; el "ni una menos" se exige al enviar.
            return toast.error(`El arte son ${CAPAS_ARTE_TPU} archivos, ni más ni menos (ya hay ${yaHayArte}).`);
        }
        if (!currentOrder?.id) return;
        setUploadingTPU(true);
        // Progreso GLOBAL ponderado por bytes: (bytes de archivos ya subidos + bytes en vuelo) / total.
        const totalBytes = validos.reduce((s, f) => s + (f.size || 0), 0) || 1;
        let bytesListos = 0;
        setProgresoTPU({ pct: 0, actual: 1, total: validos.length });
        try {
            for (let i = 0; i < validos.length; i++) {
                const f = validos[i];
                await ordersService.uploadProductionFile(currentOrder.id, f, (loaded) => {
                    const pct = Math.min(100, Math.round(((bytesListos + loaded) / totalBytes) * 100));
                    setProgresoTPU({ pct, actual: i + 1, total: validos.length });
                });
                bytesListos += (f.size || 0);
                setProgresoTPU({ pct: Math.min(100, Math.round((bytesListos / totalBytes) * 100)), actual: Math.min(i + 2, validos.length), total: validos.length });
            }
            toast.success(`${validos.length} archivo(s) de arte subido(s).`);
            loadData(currentOrder.id, currentOrder.area);
            onOrderUpdated?.();
        } catch (e) {
            toast.error('Error al subir: ' + (e?.response?.data?.error || e?.message || ''));
        } finally {
            setUploadingTPU(false);
            setProgresoTPU(null);
        }
    };

    // TPU: enviar la orden a aprobación del cliente (con confirmación)
    const handleEnviarAprobacion = async () => {
        if (!currentOrder?.id) return;
        if (tpuEstado.aprobado) return toast.error('El cliente ya aprobó este pedido.');
        const activos = productionFiles.filter(f => (f.Estado || f.estado || f.EstadoArchivo || '').toUpperCase() !== 'CANCELADO');
        if (esReusoRegen) {
            // El reuso no pasa por el cliente: va directo a fabricar, así que necesita el arte completo.
            const capasArte = activos.filter(f => !esBocetoProduccion(f)).length;
            if (capasArte !== CAPAS_ARTE_TPU) {
                return toast.error(`Se necesitan exactamente ${CAPAS_ARTE_TPU} archivos de arte para enviar a producción (hay ${capasArte}).`);
            }
        } else if (!activos.some(esBocetoProduccion)) {
            // Lo único que se manda a aprobar es el BOCETO; el resto del arte se sube después.
            return toast.error('Falta el boceto: subí un PDF con "boceto" en el nombre.');
        }
        const r = await Swal.fire({
            title: esReusoRegen ? '¿Enviar a producción?' : '¿Enviar a aprobación del cliente?',
            html: esReusoRegen
                ? `Es un <b>reuso de matriz</b> con cantidad distinta: el diseño ya está aprobado.<br/>Con las ${CAPAS_ARTE_TPU} capas nuevas, la orden entra <b>directo a producción</b> (sin aprobación del cliente).`
                : 'El cliente verá el <b>boceto</b> y deberá aprobarlo.<br/>La orden queda <b>retenida</b> hasta que apruebe.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: esReusoRegen ? 'Enviar a producción' : 'Enviar a aprobación',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: esReusoRegen ? '#059669' : '#0891b2',
            customClass: { container: '!z-[99999]' } // por encima del OrderDetailModal (z-[9999])
        });
        if (!r.isConfirmed) return;
        try {
            await ordersService.enviarAprobacionTPU(currentOrder.id);
            toast.success(esReusoRegen ? 'Orden enviada a producción.' : 'Orden enviada a aprobación del cliente.');
            loadData(currentOrder.id, currentOrder.area);
            onOrderUpdated?.();
        } catch (e) {
            toast.error('Error: ' + (e?.response?.data?.error || e?.message || ''));
        }
    };

    const handlePrintLabels = () => {
        printLabelsHelper(labels, currentOrder);
    };

    const handleRecalcular = async () => {
        toast.promise(
            (async () => {
                const result = await fileControlService.recalcularContadores(currentOrder.id);
                if (!result.success) throw new Error(result.error);
                const data = await fileControlService.getEtiquetas(currentOrder.id);
                setLabels(data);
                return result.totalBultos;
            })(),
            {
                loading: 'Recalculando contadores...',
                success: (total) => `Contadores actualizados: ${total} bulto(s). Los números de etiqueta no cambiaron.`,
                error: (e) => `Error: ${e.message}`
            }
        );
    };

    const handleDeleteLabel = (labelId) => {
        toast("¿Eliminar etiqueta?", {
            description: "Esta acción es irreversible.",
            action: {
                label: 'Eliminar',
                onClick: async () => {
                    try {
                        await fileControlService.deleteLabel(labelId);
                        const data = await fileControlService.getEtiquetas(currentOrder.id);
                        setLabels(data || []);
                        toast.success("Etiqueta eliminada");
                    } catch (e) { toast.error("Error: " + e.message); }
                }
            },
        });
    };

    const loadData = (orderId, area) => {
        setLoadingFiles(true);

        ordersService.getById(orderId, area)
            .then(data => {
                if (data) {
                    setCurrentOrder(data);

                    const refCode = data.code || data.codigoOrden || data.NoDocERP;
                    if (refCode) {
                        ordersService.getIntegralDetails(refCode).then(integralData => {
                            if (integralData && integralData.archivos) {
                                // Código de la orden de cada archivo: el modal muestra los archivos de TODAS
                                // las órdenes del pedido, así que sin esto no se puede distinguir cuáles vienen
                                // de una orden de falla (-F).
                                const codigoPorOrden = {};
                                (integralData.ordenes || []).forEach(o => {
                                    const oid = o.OrdenID ?? o.id;
                                    if (oid != null) codigoPorOrden[String(oid)] = o.CodigoOrden || o.code || '';
                                });
                                // Add logic to mark files not from current order as readonly
                                const allFiles = integralData.archivos.map(f => ({
                                    ...f,
                                    id: f.ArchivoID || f.RefID || f.ServicioID || f.id,
                                    readonly: String(f.OrdenID) !== String(orderId),
                                    _codigoOrden: codigoPorOrden[String(f.OrdenID)] || ''
                                }));
                                setFiles(allFiles);

                                // logic tab
                                const prodFiles = allFiles.filter(f => f.Categoria === 'produccion' || f.TipoArchivo === 'IMPRESION');
                                const servFiles = allFiles.filter(f => f.Categoria === 'servicio' || f.TipoArchivo === 'SERVICIO');
                                if (activeTab === 'files' && prodFiles.length === 0 && servFiles.length > 0) {
                                    setActiveTab('services');
                                }
                            } else {
                                setFiles([]);
                            }
                        }).catch(e => {
                            console.error(e);
                            setFiles([]);
                        }).finally(() => setLoadingFiles(false));
                    } else {
                        Promise.all([
                            ordersService.getReferences(orderId).catch(e => []),
                            ordersService.getServices(orderId).catch(e => [])
                        ])
                            .then(([refFiles, servFiles]) => {
                                const prodFilesRaw = data.filesData || data.files || [];
                                
                                const prodFiles = prodFilesRaw.map(f => ({ ...f, Categoria: 'produccion' }));
                                const mappedRefFiles = refFiles.map(f => ({ ...f, Categoria: 'referencia' }));
                                const mappedServFiles = servFiles.map(f => ({ ...f, Categoria: 'servicio' }));
                                
                                const mappedAllFiles = [...prodFiles, ...mappedRefFiles, ...mappedServFiles].map(f => ({
                                    ...f,
                                    id: f.ArchivoID || f.RefID || f.ServicioID || f.id,
                                    readonly: String(f.OrdenID) !== String(orderId)
                                }));
                                setFiles(mappedAllFiles);

                                if (activeTab === 'files' && prodFiles.length === 0 && servFiles.length > 0) {
                                    setActiveTab('services');
                                }
                            })
                            .finally(() => setLoadingFiles(false));
                    }
                } else {
                    setLoadingFiles(false);
                }
            })
            .catch(err => {
                console.error("Error cargando orden", err);
                setLoadingFiles(false);
            });
    };

    const reloadFiles = () => {
        if (currentOrder?.id) loadData(currentOrder.id, currentOrder.area);
    };

    const startEditing = (file) => {
        const url = file.link || file.url || file.RutaAlmacenamiento || '';
        const id = file.id || file.ArchivoID;
        setEditingFileId(id);
        const w = file.ancho || file.Ancho || 0;
        const h = file.alto || file.Alto || 0;

        setEditValues({
            copias: file.copias || file.copies || file.Copias || 1,
            metros: file.metros || file.width || file.Metros || 0,
            ancho: w,
            alto: h,
            link: url,
            observaciones: file.observaciones || file.notas || file.Observacion || '',
            nombre: file.nombre || '',
            puntadas: file.Puntadas || 0,
            bajadas: file.Bajadas || 0,
            bajadasAdicionales: file.BajadasAdicionales || 0
        });
    };

    const startCancellingFile = (file) => {
        setFileToCancel(file);
        setCancelType('FILE');
        setCancelDetails("");
        setSelectedMotivo(null);
        setCancelModalOpen(true);
    };

    const saveEditing = async () => {
        if (!editingFileId) return;

        const fileToEdit = files.find(f => (f.id || f.ArchivoID) === editingFileId);

        // Manejo específico para SERVICIOS
        if (fileToEdit && fileToEdit.tipo === 'Servicio') {
            const user = JSON.parse(localStorage.getItem('user')) || {};
            toast.promise(
                ordersService.updateService({
                    serviceId: editingFileId,
                    cantidad: parseFloat(editValues.copias) || 1,
                    obs: editValues.observaciones,
                    nombre: editValues.nombre, // Ahora mandamos nombre editado
                    usuario: user.id || user.UsuarioID || 1,
                    puntadas: parseInt(editValues.puntadas) || 0,
                    bajadas: parseInt(editValues.bajadas) || 0,
                    bajadasAdicionales: parseInt(editValues.bajadasAdicionales) || 0
                }).then(() => {
                    setEditingFileId(null);
                    reloadFiles();
                    if (onOrderUpdated) onOrderUpdated();
                }),
                {
                    loading: 'Actualizando servicio...',
                    success: 'Servicio actualizado',
                    error: (e) => `Error: ${e.response?.data?.error || e.message}`
                }
            );
            return;
        }

        // Manejo estándar para ARCHIVOS
        const user = JSON.parse(localStorage.getItem('user')) || {};
        const payload = {
            fileId: editingFileId,
            copias: parseInt(editValues.copias) || 1,
            metros: parseFloat(editValues.metros) || 0,
            ancho: parseFloat(editValues.ancho) || 0,
            alto: parseFloat(editValues.alto) || 0,
            link: editValues.link,
            nombre: editValues.nombre, // Para productos añadidos via addFile
            userId: user.id || user.UsuarioID
        };

        toast.promise(
            ordersService.updateFile(payload).then(() => {
                setEditingFileId(null);
                reloadFiles();
                if (onOrderUpdated) onOrderUpdated();
            }),
            {
                loading: 'Guardando cambios...',
                success: 'Archivo actualizado',
                error: (e) => `No se pudo guardar: ${e.response?.data?.error || e.message}`
            }
        );
    };

    const handleConfirmCancel = async () => {
        if (!selectedMotivo) {
            toast.error("Debe seleccionar un motivo de cancelación.");
            return;
        }

        if (selectedMotivo?.MotivoID === 'otros' && !cancelDetails.trim()) {
            toast.error("Por favor, especifique el motivo de cancelación.");
            return;
        }

        const user = JSON.parse(localStorage.getItem('user')) || {};
        const safeUser = user.id || user.UsuarioID || user.userId || 1;

        const isOtros = selectedMotivo?.MotivoID === 'otros';
        const finalMotivoId = isOtros ? null : (selectedMotivo ? selectedMotivo.MotivoID : null);

        const combinedReason = isOtros
            ? `Otros - ${cancelDetails.trim()}`
            : (selectedMotivo 
                ? `${selectedMotivo.Titulo}${cancelDetails.trim() ? ' - ' + cancelDetails.trim() : ''}`
                : cancelDetails.trim());

        const commonPayload = {
            reason: combinedReason,
            motivoId: finalMotivoId,
            detalles: cancelDetails.trim() || null,
            usuario: safeUser
        };

        const promise = (async () => {
            if (cancelType === 'FILE') {
                if (!fileToCancel) return;
                const fileId = fileToCancel.id || fileToCancel.ArchivoID;
                const res = await ordersService.cancelFile({ ...commonPayload, fileId });

                if (res.orderCancelled) onClose();
                else reloadFiles();
                return res.message || 'Archivo cancelado';

            } else if (cancelType === 'REQUEST') {
                await ordersService.cancelRequest({ ...commonPayload, orderId: currentOrder.id });
                onClose();
                return "Pedido completo cancelado (todas las áreas).";

            } else {
                await ordersService.cancelOrder({ ...commonPayload, orderId: currentOrder.id });
                onClose();
                return "Orden cancelada correctamente.";
            }
        })();

        toast.promise(promise, {
            loading: 'Procesando cancelación...',
            success: (msg) => {
                setCancelModalOpen(false);
                setCancelDetails("");
                setSelectedMotivo(null);
                setCancelType(null);
                setFileToCancel(null);
                if (onOrderUpdated) onOrderUpdated();
                return msg;
            },
            error: (e) => `Error al cancelar: ${e.response?.data?.error || e.message}`
        });
    };

    // ── REACTIVACIÓN ───────────────────────────────────────────────
    const handleReactivate = (type) => {
        const safeUser = user?.id || user?.UsuarioID || 'Sistema';
        const payload = { orderId: currentOrder.id, usuario: safeUser };

        const messages = {
            ORDER: { loading: 'Reactivando orden...', success: '✅ Orden reactivada correctamente', label: 'esta orden' },
            REQUEST: { loading: 'Reactivando pedido completo...', success: '✅ Pedido reactivado correctamente', label: 'todo el pedido' },
        };
        const { loading, success, label } = messages[type];

        Swal.fire({
            title: `¿Reactivar ${label}?`,
            html: `Se restaurarán los archivos al estado previo a la cancelación<br>y se limpiará la nota de cancelación.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '✅ Sí, reactivar',
            cancelButtonText: 'No, cancelar',
            confirmButtonColor: '#16a34a',
            cancelButtonColor: '#64748b',
            customClass: { container: '!z-[99999]' },
        }).then(({ isConfirmed }) => {
            if (!isConfirmed) return;
            const serviceCall = type === 'REQUEST'
                ? ordersService.reactivateRequest(payload)
                : ordersService.reactivateOrder(payload);

            toast.promise(serviceCall, {
                loading,
                success: () => {
                    reloadFiles();
                    if (onOrderUpdated) onOrderUpdated();
                    return success;
                },
                error: (e) => `Error al reactivar: ${e.response?.data?.error || e.message}`
            });
        });
    };

    const handleUpdateOrderStatus = async (newStatus) => {
        if (!newStatus?.trim() || newStatus === currentOrder.status) return;
        
        toast.promise(
            ordersService.updateStatus(currentOrder.id, newStatus),
            {
                loading: 'Actualizando estado general...',
                success: () => {
                    reloadFiles();
                    if (onOrderUpdated) onOrderUpdated();
                    return 'Estado actualizado';
                },
                error: (e) => `Error: ${e.response?.data?.error || e.message}`
            }
        );
    };

    const handleUpdateAreaStatus = async (newAreaStatus) => {
        if (!newAreaStatus?.trim() || newAreaStatus === currentOrder.areaStatus) return;
        
        toast.promise(
            ordersService.updateAreaStatus(currentOrder.id, newAreaStatus),
            {
                loading: 'Actualizando estado en área...',
                success: () => {
                    reloadFiles();
                    if (onOrderUpdated) onOrderUpdated();
                    return 'Estado de área actualizado';
                },
                error: (e) => `Error: ${e.response?.data?.error || e.message}`
            }
        );
    };

    useEffect(() => {
        setCurrentOrder(order);
        if (order && order.id) {
            loadData(order.id, order.area);
        } else {
            setFiles([]);
        }
    }, [order]);

    // Imágenes de fallas marcadas (recuadro) — solo SB, para la tab Referencias.
    useEffect(() => {
        if (order?.id && isSB) {
            api.get(`/production-file-control/orden/${order.id}/fallas-imagenes`)
                .then(res => setFallaImages(res.data?.data || []))
                .catch(() => setFallaImages([]));
        } else {
            setFallaImages([]);
        }
    }, [order, isSB]);

    useEffect(() => {
        ordersService.getEstados().then(data => {
            if (data && data.length > 0) {
                setConfigEstados(data);
            }
        }).catch(err => console.error("Error loading estados:", err));
    }, []);

    // Terminaciones de la orden (ECOUV legacy / hermana contenedora TERMINAC).
    const [terminacionesOrden, setTerminacionesOrden] = useState([]);
    useEffect(() => {
        if (order?.id && ['ECOUV', 'TERMINAC'].includes((order?.area || '').toUpperCase())) {
            api.get(`/finishing/orders/${order.id}/details`)
                .then(res => setTerminacionesOrden(res.data?.terminaciones || []))
                .catch(() => setTerminacionesOrden([]));
        } else {
            setTerminacionesOrden([]);
        }
    }, [order]);

    if (!order || !currentOrder) return null;

    // Helper para acciones de archivo (Definido aquí para acceder al scope)
    const renderFileActionsData = (f, idx) => {
        const fileId = f.id || f.ArchivoID || idx;
        const isEditing = editingFileId === fileId;
        const rawStatus = f.Estado || f.estado || 'PENDIENTE';
        const isCancelled = rawStatus.toUpperCase() === 'CANCELADO';
        const isOrderCancelled = currentOrder.status === 'CANCELADO';

        let editContent = null;

        if (isEditing) {
            const umStr = (currentOrder.UM || currentOrder.unit || 'm').toLowerCase();
            const isAreaStr = umStr.includes('2');

            const handleChange = (field, val) => {
                const newValues = { ...editValues, [field]: val };
                const w = parseFloat(field === 'ancho' ? val : newValues.ancho) || 0;
                const h = parseFloat(field === 'alto' ? val : newValues.alto) || 0;

                if (isAreaStr) {
                    newValues.metros = (w * h).toFixed(2);
                } else {
                    newValues.metros = h.toFixed(2);
                }
                setEditValues(newValues);
            };

            editContent = (
                <div className="flex flex-wrap items-center gap-2">
                    {/* 1. COPIAS */}
                    <div className="flex items-center gap-1 bg-white border border-blue-300 rounded px-1 shadow-sm focus-within:ring-2 focus-within:ring-blue-100">
                        <label className="text-[9px] font-bold text-blue-400 uppercase">Copias:</label>
                        <input
                            type="number" className="w-10 text-center font-bold text-xs outline-none text-zinc-700 bg-transparent h-6"
                            value={editValues.copias}
                            onChange={e => setEditValues({ ...editValues, copias: e.target.value })}
                            autoFocus
                        />
                    </div>

                    <span className="text-zinc-300 text-xs font-light">x</span>

                    {/* 2. ANCHO */}
                    <div className="flex items-center gap-1 bg-white border border-blue-300 rounded px-1 shadow-sm focus-within:ring-2 focus-within:ring-blue-100">
                        <label className="text-[9px] font-bold text-blue-400 uppercase">Ancho:</label>
                        <input
                            type="number" step="0.01" className="w-12 text-center font-bold text-xs outline-none text-zinc-700 bg-transparent h-6"
                            value={editValues.ancho}
                            onChange={e => handleChange('ancho', e.target.value)}
                        />
                    </div>

                    <span className="text-zinc-300 text-xs font-light">x</span>

                    {/* 3. ALTO / LARGO */}
                    <div className="flex items-center gap-1 bg-white border border-blue-300 rounded px-1 shadow-sm focus-within:ring-2 focus-within:ring-blue-100">
                        <label className="text-[9px] font-bold text-blue-400 uppercase">Alto:</label>
                        <input
                            type="number" step="0.01" className="w-12 text-center font-bold text-xs outline-none text-zinc-700 bg-transparent h-6"
                            value={editValues.alto}
                            onChange={e => handleChange('alto', e.target.value)}
                        />
                    </div>

                    <div className="w-px bg-zinc-200 h-4 mx-1"></div>

                    {/* RESULTADO (Calculado) */}
                    <div className="flex items-center gap-1 bg-zinc-100/50 px-2 py-0.5 rounded border border-zinc-200">
                        <label className="text-[9px] font-bold text-zinc-400 uppercase">Total:</label>
                        <div className="text-xs font-black text-brand-cyan">
                            {editValues.metros} {currentOrder.UM || 'm'}
                        </div>
                    </div>
                </div>
            );
        }

        const actions = (
            <div className="flex items-center gap-3">
                {/* Estado Informativo */}
                <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider border select-none 
                    ${rawStatus === 'OK' || rawStatus === 'FINALIZADO' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                        rawStatus === 'FALLA' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                            rawStatus === 'CANCELADO' ? 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20' :
                                'bg-zinc-50 text-zinc-400 border-zinc-100'
                    }`}>
                    {rawStatus}
                </div>

                {isEditing && !f.readonly && !readOnly ? (
                    <div className="flex gap-1 animate-in zoom-in-95 duration-200">
                        <ActionButton icon="fa-check" color="emerald" onClick={saveEditing} title="Guardar Cambios" />
                        <ActionButton icon="fa-xmark" color="zinc" onClick={() => setEditingFileId(null)} title="Cancelar" />
                    </div>
                ) : (
                    !isCancelled && !isOrderCancelled && !f.readonly && !readOnly && (
                        <div className='flex gap-1'>
                            <ActionButton
                                icon="fa-pen"
                                color="blue"
                                onClick={() => startEditing({ ...f, id: fileId })}
                                title="Editar Dimensiones y Cantidad"
                            />
                            {isTPU ? (
                                <ActionButton
                                    icon="fa-trash"
                                    color="red"
                                    onClick={() => handleDeleteFileTPU(fileId)}
                                    title="Eliminar archivo"
                                />
                            ) : (
                                <ActionButton
                                    icon="fa-ban"
                                    color="red"
                                    onClick={() => startCancellingFile({ ...f, id: fileId })}
                                    title="Cancelar Archivo"
                                />
                            )}
                        </div>
                    )
                )}
            </div>
        );

        return { actions, editContent };
    };

    return createPortal(
        <>
            <ModalConfirmacionFalla
                ordenes={modalFallaData?.ordenes}
                onConfirm={handleConfirmarFalla}
            />
            <ModalLiberacionFalla
                ordenes={modalLiberacionData?.ordenes}
                onConfirm={handleLiberarFalla}
                loading={liberandoFalla}
            />
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">

            <div
                className="absolute inset-0 bg-zinc-900/60 transition-opacity"
                onClick={onClose}
            ></div>

            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] lg:max-w-7xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-zinc-200 overflow-hidden">

                <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-start shrink-0">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <span className="font-mono bg-zinc-200 px-2 py-0.5 rounded text-zinc-600 font-bold text-xs border border-zinc-300">
                                Orden No.: {currentOrder.code || currentOrder.id}
                            </span>
                            {labels.length > 0 && (
                                <span className="bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded text-xs font-bold border border-brand-cyan/20 flex items-center gap-1">
                                    <i className="fa-solid fa-tags text-[10px]"></i> {labels.length} Bultos
                                </span>
                            )}
                            <span className="text-xs font-bold text-brand-cyan bg-brand-cyan/10 px-2 py-0.5 rounded uppercase tracking-wider border border-brand-cyan/20">
                                Detalle de Orden
                            </span>
                            {currentOrder.status === 'CANCELADO' && (
                                <span className="text-xs font-bold text-white bg-brand-magenta px-2 py-0.5 rounded uppercase tracking-wider">CANCELADA</span>
                            )}
                        </div>
                        <h2 className="text-xl font-bold text-zinc-800 leading-tight">{currentOrder.idCliente || currentOrder.client}</h2>
                        <p className="text-sm text-zinc-500 mt-0.5">{currentOrder.idCliente ? currentOrder.client : ''}</p>
                        <p className="text-sm text-zinc-500 mt-1 max-w-2xl truncate">{currentOrder.desc}</p>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white border border-zinc-200 text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/10 hover:border-brand-magenta/30 transition-all flex items-center justify-center shadow-sm"
                    >
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 bg-white flex-1 overflow-y-auto custom-scrollbar">

                    {/* Campos de Estado Editables — solo internos con rol habilitado (ver puedeEditarEstado) */}
                    {!readOnly && puedeEditarEstado && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 bg-brand-cyan/5 p-4 rounded-xl border border-brand-cyan/20 shadow-sm">
                        {(() => {
                            const areaId = currentOrder?.area || '';
                            const filteredGeneral = configEstados.filter(s => 
                                s.TipoEstado === 'ESTADO' && 
                                (s.AreaID === 'ADMIN' || s.AreaID === areaId || (s.AreaID && s.AreaID.split(',').includes(areaId)))
                            );
                            const filteredArea = configEstados.filter(s => 
                                s.TipoEstado === 'ESTADOENAREA' && 
                                (s.AreaID === 'ADMIN' || s.AreaID === areaId || (s.AreaID && s.AreaID.split(',').includes(areaId)))
                            );

                            const currentStatus = currentOrder?.status;
                            const currentAreaStatus = currentOrder?.areaStatus;

                            const allGeneralNames = [...new Set([
                                ...filteredGeneral.map(s => s.Nombre),
                                ...(currentStatus ? [currentStatus] : [])
                            ])].sort((a, b) => a.localeCompare(b));

                            const allAreaNames = [...new Set([
                                ...filteredArea.map(s => s.Nombre)
                            ])].sort((a, b) => a.localeCompare(b));

                            return (
                                <>
                                    <div className="lg:col-span-2">
                                        <label className="text-[10px] uppercase font-bold text-zinc-500 block mb-1"><i className="fa-solid fa-flag text-brand-cyan mr-1"></i> Estado General</label>
                                        <div className="flex gap-2 mb-4">
                                            <div className="relative flex-1">
                                                <div className="w-full text-sm font-bold text-zinc-500 border border-zinc-200 bg-zinc-100 rounded px-3 py-1.5 text-left cursor-not-allowed flex items-center justify-between">
                                                    <span className="block truncate">{draftStates.status || '-- Seleccionar Estado --'}</span>
                                                    <span className="text-zinc-400"><i className="fa-solid fa-lock text-[10px]"></i></span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="lg:col-span-2">
                                        <label className="text-[10px] uppercase font-bold text-zinc-500 block mb-1"><i className="fa-solid fa-layer-group text-brand-cyan mr-1"></i> Estado en su Área</label>
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <Listbox value={draftStates.areaStatus} onChange={(val) => {
                                                    let newGeneralStatus = draftStates.status;
                                                    const selectedAreaState = filteredArea.find(s => s.Nombre === val);
                                                    if (selectedAreaState && selectedAreaState.EstadoPadreID) {
                                                        const parentState = configEstados.find(s => s.EstadoID == selectedAreaState.EstadoPadreID);
                                                        if (parentState) {
                                                            newGeneralStatus = parentState.Nombre;
                                                        }
                                                    }
                                                    setDraftStates({ ...draftStates, areaStatus: val, status: newGeneralStatus });
                                                }}>
                                                    <div className="relative">
                                                        <Listbox.Button className="relative w-full text-sm font-bold text-zinc-700 border border-zinc-300 rounded px-3 py-1.5 text-left outline-none bg-white shadow-sm hover:border-brand-cyan focus:border-brand-cyan transition-all cursor-pointer">
                                                            <span className="block truncate">{draftStates.areaStatus || '-- Seleccionar Estado --'}</span>
                                                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-zinc-400">
                                                                <ChevronDown size={14} />
                                                            </span>
                                                        </Listbox.Button>
                                                        <Transition
                                                            as={Fragment}
                                                            leave="transition ease-in duration-100"
                                                            leaveFrom="opacity-100"
                                                            leaveTo="opacity-0"
                                                        >
                                                            <Listbox.Options className="absolute mt-1 w-full rounded-xl bg-white py-1 text-sm shadow-xl border border-zinc-100 focus:outline-none z-[9999]">
                                                                {allAreaNames.map(name => (
                                                                    <Listbox.Option
                                                                        key={`area_${name}`}
                                                                        className={({ active }) =>
                                                                            `relative cursor-pointer select-none py-2 pl-9 pr-4 ${
                                                                                active ? 'bg-brand-cyan/10 text-brand-cyan' : 'text-zinc-700'
                                                                            }`
                                                                        }
                                                                        value={name}
                                                                    >
                                                                        {({ selected }) => (
                                                                            <>
                                                                                <span className={`block truncate ${selected ? 'font-bold' : 'font-medium'}`}>{name}</span>
                                                                                {selected && (
                                                                                    <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-brand-cyan">
                                                                                        <Check size={14} strokeWidth={3} />
                                                                                    </span>
                                                                                )}
                                                                            </>
                                                                        )}
                                                                    </Listbox.Option>
                                                                ))}
                                                            </Listbox.Options>
                                                        </Transition>
                                                    </div>
                                                </Listbox>
                                            </div>
                                            <button 
                                                onClick={() => handleUpdateAreaStatus(draftStates.areaStatus)}
                                                disabled={draftStates.areaStatus === currentOrder.areaStatus}
                                                className={`px-3 py-1.5 rounded border transition-colors flex items-center justify-center shrink-0 ${draftStates.areaStatus !== currentOrder.areaStatus ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30 hover:bg-brand-cyan/20' : 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed'}`}
                                                title="Actualizar Estado en su Área"
                                            >
                                                <i className="fa-solid fa-save"></i>
                                            </button>
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                    )}

                    {/* Header Grid: Datos Clave */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6 bg-zinc-50 p-4 rounded-xl border border-zinc-100 shadow-sm">

                        <div className="md:col-span-2 lg:col-span-2">
                            <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">Material / Sustrato</label>
                            <div className="font-semibold text-zinc-700 text-sm leading-tight">{currentOrder.variant || currentOrder.material || '-'}</div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">Magnitud Global</label>
                            <div className="font-black text-brand-cyan text-lg leading-none">
                                {(() => {
                                    // TPU no se recalcula: su Magnitud es la CANTIDAD PEDIDA en
                                    // unidades, fijada al crear el pedido. Sus archivos son las capas
                                    // del arte (sin metros) y su único servicio extra es la matriz,
                                    // con Cantidad 1 — sumar eso mostraba "1.00 U" en una orden de 15.
                                    // Mismo criterio que el backend (recalculateOrderMagnitude).
                                    if (isTPU) return currentOrder.magnitude || '0';

                                    // 1. Suma de Producción
                                    const prodTotal = productionFiles.reduce((acc, f) => {
                                        const fStatus = (f.Estado || f.estado || f.EstadoArchivo || '').toUpperCase();
                                        if (fStatus === 'CANCELADO') return acc;
                                        return acc + ((parseFloat(f.copias || f.Copias || 1)) * (parseFloat(f.metros || f.width || f.Metros || 0)));
                                    }, 0);

                                    // 2. Suma de Servicios Extras
                                    const servTotal = serviceFiles.reduce((acc, s) => {
                                        return acc + (parseFloat(s.copias || s.Cantidad || 0));
                                    }, 0);

                                    // 3. Total Real
                                    const totalMag = prodTotal + servTotal;

                                    // Si hay total calculado lo mostramos, si no mostramos la magnitud estática
                                    return totalMag > 0 ? totalMag.toFixed(2) : (currentOrder.magnitude || '0');
                                })()}
                                <span className="text-xs font-bold text-zinc-500 ml-1">{currentOrder.UM || currentOrder.unit || ''}</span>
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">Prioridad</label>
                            <div className={`font-bold text-sm ${currentOrder.priority === 'Urgente' ? 'text-brand-magenta' : 'text-zinc-600'}`}>
                                {currentOrder.priority || 'Normal'}
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">Tinta</label>
                            <div className="font-mono text-zinc-700 text-sm font-bold bg-white border border-zinc-200 px-2 py-0.5 rounded inline-block">
                                {currentOrder.ink || '-'}
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">Modo Retiro</label>
                            <div className="font-bold text-zinc-700 text-sm">
                                {currentOrder.retiro || '-'}
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">Próximo Area</label>
                            <div className="font-bold text-brand-cyan text-sm flex items-center gap-1">
                                <i className="fa-solid fa-arrow-right text-[10px]"></i> {currentOrder.nextService || '-'}
                            </div>
                        </div>
                    </div>

                    {currentOrder.rollId && (
                        <div className="mb-4 flex items-center gap-2 text-xs font-mono text-zinc-500 bg-zinc-100 px-3 py-1.5 rounded-lg w-fit">
                            <i className="fa-solid fa-scroll"></i>
                            Asignado a Rollo/Lote: <b>{currentOrder.rollId}</b>
                        </div>
                    )}

                    {/* Aviso de configuración de impresión (escala/raport) — card propia, arriba de las notas */}
                    {(() => {
                        const modeIn = (f) => String(f.Observaciones || f.observaciones || '');
                        const hasEscala = productionFiles.some(f => /\[ESCALA\]/i.test(modeIn(f)) || /Modo:\s*scale/i.test(modeIn(f)));
                        const hasRaport = productionFiles.some(f => /\[RAPORT\]/i.test(modeIn(f)) || /Modo:\s*raport/i.test(modeIn(f)));
                        if (!hasEscala && !hasRaport) return null;
                        const label = hasEscala && hasRaport ? 'ESCALA y RAPORT' : hasEscala ? 'ESCALA' : 'RAPORT';
                        const isRaport = hasRaport && !hasEscala;
                        return (
                            <div className={`mb-4 border-l-4 p-3 flex gap-3 shadow-sm rounded-r-lg ${isRaport ? 'bg-purple-50 border-purple-400' : 'bg-cyan-50 border-cyan-400'}`}>
                                <i className={`fa-solid ${isRaport ? 'fa-repeat' : 'fa-expand'} text-lg mt-0.5 ${isRaport ? 'text-purple-500' : 'text-cyan-500'}`}></i>
                                <div>
                                    <h4 className={`font-bold text-xs uppercase mb-0.5 ${isRaport ? 'text-purple-900' : 'text-cyan-900'}`}>Configuración de Impresión</h4>
                                    <p className={`text-sm font-semibold ${isRaport ? 'text-purple-800' : 'text-cyan-800'}`}>Contiene archivos con {label}</p>
                                </div>
                            </div>
                        );
                    })()}

                    {currentOrder.note && (() => {
                        const parts = currentOrder.note.split('||').map(n => n.trim()).filter(Boolean);
                        const fallas = parts.filter(n => /^FALLA:/i.test(n)).map(n => n.replace(/^FALLA:\s*/i, '').trim()).filter(Boolean);
                        // Quitar el marcador viejo [CONTIENE ARCHIVOS CON ESCALA/RAPORT] de las notas del cliente
                        // (ahora se muestra en su propia card arriba).
                        const prod = parts.filter(n => !/^FALLA:/i.test(n)).map(n => n.replace(/\[CONTIENE ARCHIVOS CON ESCALA\/RAPORT\]\s*/i, '').trim()).filter(Boolean);
                        return (
                            <div className="mb-8 space-y-3">
                                {prod.length > 0 && (
                                    <div className="bg-blue-50 border-l-4 border-blue-400 p-3 flex gap-3 shadow-sm rounded-r-lg">
                                        <i className="fa-solid fa-note-sticky text-blue-500 text-lg mt-0.5"></i>
                                        <div className="w-full">
                                            <h4 className="font-bold text-blue-900 text-xs uppercase mb-1">Notas de Producción</h4>
                                            <div className="space-y-1.5">
                                                {prod.map((nota, index) => (
                                                    <div key={index} className="flex gap-2 items-start bg-blue-100/50 p-2 rounded border border-blue-200/50">
                                                        <i className="fa-solid fa-circle-info text-blue-500 mt-1 text-[10px]"></i>
                                                        <p className="text-blue-800 text-sm italic leading-snug font-medium">{nota}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {fallas.length > 0 && (
                                    <div className="bg-amber-50 border-l-4 border-amber-400 p-3 flex gap-3 shadow-sm rounded-r-lg">
                                        <i className="fa-solid fa-triangle-exclamation text-amber-500 text-lg mt-0.5"></i>
                                        <div className="w-full">
                                            <h4 className="font-bold text-amber-900 text-xs uppercase mb-1">Fallas</h4>
                                            <div className="space-y-1.5">
                                                {fallas.map((nota, index) => (
                                                    <div key={index} className="flex gap-2 items-start bg-amber-100/50 p-2 rounded border border-amber-200/50">
                                                        <i className="fa-solid fa-circle-exclamation text-amber-500 mt-1 text-[10px]"></i>
                                                        <p className="text-amber-800 text-sm italic leading-snug font-medium">{nota}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* TABS DE NAVEGACIÓN */}
                    <div>
                        <div className="flex gap-1 border-b border-zinc-200 mb-6 overflow-x-auto">
                            {[
                                { id: 'files', label: 'Archivos de Impresión', count: printFilesVista.length, icon: 'fa-layer-group' },
                                ...(terminacionesOrden.length > 0 ? [{ id: 'terminaciones', label: 'Terminaciones', count: terminacionesOrden.length, icon: 'fa-scissors' }] : []),
                                { id: 'refs', label: 'Archivos de Referencia', count: referenceFiles.length + bocetosProduccion.length + (isSB ? fallaImages.length : 0), icon: 'fa-paperclip' },
                                { id: 'services', label: 'Cotizar Productos', count: serviceFiles.length, icon: 'fa-box-open' },
                                { id: 'labels', label: 'Etiquetas', count: labels.length, icon: 'fa-tags' },
                                { id: 'reqs', label: 'Requisitos', count: 0, icon: 'fa-list-check' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-4 py-3 font-bold text-sm border-b-2 transition-all flex items-center gap-2 whitespace-nowrap
                                        ${activeTab === tab.id
                                            ? 'border-brand-cyan text-brand-cyan bg-brand-cyan/5'
                                            : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'
                                        }`}
                                >
                                    <i className={`fa-solid ${tab.icon} ${activeTab === tab.id ? 'text-brand-cyan' : 'text-zinc-300'}`}></i>
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-brand-cyan/20 text-brand-cyan' : 'bg-zinc-100 text-zinc-500'}`}>
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* CONTENIDO TABS */}
                        <div className="min-h-[250px] animate-in fade-in slide-in-from-bottom-2 duration-300">

                            {/* PESTAÑA: TERMINACIONES (ECOUV: por archivo, dentro de la misma orden) */}
                            {activeTab === 'terminaciones' && (
                                <div className="space-y-4 pr-1 custom-scrollbar">
                                    {(() => {
                                        const grupos = {};
                                        terminacionesOrden.forEach(t => {
                                            const key = t.ArchivoID || 'general';
                                            if (!grupos[key]) grupos[key] = { archivo: t.NombreArchivo, items: [] };
                                            grupos[key].items.push(t);
                                        });
                                        const hechas = terminacionesOrden.filter(t => t.Estado === 'Hecha').length;
                                        return (
                                            <>
                                                <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex gap-3 text-amber-800 text-sm">
                                                    <i className="fa-solid fa-scissors mt-0.5"></i>
                                                    <p>
                                                        <b>{hechas}/{terminacionesOrden.length}</b> terminaciones hechas.
                                                        Se marcan desde la bandeja de <b>Terminaciones ECOUV</b>.
                                                    </p>
                                                </div>
                                                {Object.entries(grupos).map(([key, g]) => (
                                                    <div key={key} className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                                                        <div className="bg-zinc-50 border-b border-zinc-100 px-4 py-2.5 flex items-center gap-2">
                                                            <i className="fa-regular fa-file text-zinc-400"></i>
                                                            <span className="text-xs font-bold text-zinc-700 truncate">
                                                                {(g.archivo || 'Terminaciones generales de la orden').trim()}
                                                            </span>
                                                            <span className="ml-auto text-[10px] font-black text-zinc-400 uppercase shrink-0">
                                                                {g.items.length} {g.items.length === 1 ? 'terminación' : 'terminaciones'}
                                                            </span>
                                                        </div>
                                                        <div className="divide-y divide-zinc-100">
                                                            {g.items.map(t => (
                                                                <div key={t.ID} className={`flex items-center gap-3 px-4 py-2.5 ${t.Estado === 'Hecha' ? 'bg-emerald-50/50' : ''}`}>
                                                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.Estado === 'Hecha' ? 'bg-emerald-500' : 'bg-amber-400'}`}></span>
                                                                    <p className={`text-sm font-bold ${t.Estado === 'Hecha' ? 'text-emerald-700 line-through' : 'text-zinc-700'}`}>
                                                                        {t.Nombre}
                                                                    </p>
                                                                    {t.Ubicacion && (
                                                                        <span className="text-[10px] font-black uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                                                                            {labelUbicacion(String(t.Ubicacion).trim())}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-xs font-black text-zinc-400">
                                                                        × {parseFloat(t.Cantidad)} {t.UnidadCobro === 'M2' ? 'm²' : t.UnidadCobro === 'M' ? 'm' : 'u.'}
                                                                    </span>
                                                                    <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${t.Estado === 'Hecha' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                        {t.Estado}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* PESTAÑA: REQUISITOS (Nueva) */}
                            {activeTab === 'reqs' && (
                                <div className="p-1">
                                    <div className="bg-brand-cyan/10 border border-brand-cyan/20 p-3 rounded-lg flex gap-3 text-brand-cyan text-sm mb-4">
                                        <i className="fa-solid fa-circle-info mt-0.5"></i>
                                        <p>
                                            Verifique que los materiales para <b>{currentOrder.area}</b> estén listos.
                                            <br />
                                            Los elementos <span className="font-bold text-green-600">Verdes</span> ya están disponibles.
                                        </p>
                                    </div>
                                    <OrderRequirementsList
                                        ordenId={currentOrder.id}
                                        areaId={currentOrder.area}
                                    />
                                </div>
                            )}

                            {/* PESTAÑA: ARCHIVOS DE PRODUCCIÓN */}
                            {activeTab === 'files' && (
                                <div className="space-y-2 pr-1 custom-scrollbar">
                                    {/* Boceto rechazado: el operario tiene que borrarlo (desde Referencias),
                                        subir el corregido y reenviar a aprobación. */}
                                    {isTPU && tpuEstado.rechazado && (
                                        <div className="flex items-center gap-2 p-3 mb-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
                                            <i className="fa-solid fa-circle-xmark"></i>
                                            El cliente RECHAZÓ el boceto. Borralo en Referencias, subí el corregido y reenvialo a aprobación.
                                        </div>
                                    )}

                                    {/* Acción principal del flujo TPU, ARRIBA de todo: antes quedaba al
                                        fondo de la pestaña, después del listado, y había que scrollear
                                        para encontrarla. */}
                                    {isTPU && productionFiles.length > 0 && (
                                        esReusoRegen ? (
                                            currentOrder?.status === 'Cargando...' ? (
                                                <button onClick={handleEnviarAprobacion} className="w-full flex items-center justify-center gap-2 py-3 mb-2 rounded-xl bg-emerald-600 text-white text-sm font-bold uppercase tracking-wide hover:opacity-90 transition-opacity shadow-sm">
                                                    <i className="fa-solid fa-industry"></i> Enviar a producción
                                                </button>
                                            ) : (
                                                <div className="flex items-center justify-center gap-2 py-3 mb-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold uppercase tracking-wide">
                                                    <i className="fa-solid fa-check"></i> En producción
                                                </div>
                                            )
                                        ) : tpuEstado.aprobado ? (
                                            // Aprobado: el botón de enviar NO vuelve a aparecer — re-enviarla
                                            // retendría una orden que ya está en producción.
                                            <div className="flex items-center justify-center gap-2 py-3 mb-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold uppercase tracking-wide">
                                                <i className="fa-solid fa-check-double"></i> Boceto aprobado por el cliente — subí el arte ({CAPAS_ARTE_TPU} capas)
                                            </div>
                                        ) : currentOrder?.status === 'Cargando...' ? (
                                            <div className="flex items-center justify-center gap-2 py-3 mb-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold uppercase tracking-wide">
                                                <i className="fa-regular fa-clock"></i> Esperando aprobación del cliente
                                            </div>
                                        ) : (
                                            <button onClick={handleEnviarAprobacion} className="w-full flex items-center justify-center gap-2 py-3 mb-2 rounded-xl bg-brand-cyan text-white text-sm font-bold uppercase tracking-wide hover:opacity-90 transition-opacity shadow-sm">
                                                <i className="fa-solid fa-paper-plane"></i> Enviar a cliente para aprobación
                                            </button>
                                        )
                                    )}

                                    {/* Visor 3D interno: con el boceto cargado, el diseñador puede elegir
                                        las texturas por zona antes de mandar a aprobación (o corregirlas
                                        después). Es el mismo visor del portal, en modo interno. */}
                                    {/* Cliente aprobó SIN elegir texturas → las define el diseñador acá. */}
                                    {isTPU && tpuEstado.aprobado && tpuEstado.texturasElige === 'DISENADOR' && (
                                        <div className="flex items-center gap-2 p-3 mb-2 rounded-xl bg-brand-cyan/5 border border-brand-cyan/30 text-brand-cyan text-xs font-bold">
                                            <i className="fa-solid fa-wand-magic-sparkles"></i>
                                            El cliente aprobó el boceto sin elegir texturas: definilas en el visor 3D.
                                        </div>
                                    )}

                                    {isTPU && bocetosProduccion.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setVisor3D(true)}
                                            className="w-full flex items-center justify-center gap-2 py-2.5 mb-2 rounded-xl border border-brand-cyan/40 text-brand-cyan text-xs font-bold uppercase tracking-wide hover:bg-brand-cyan/5 transition-colors"
                                        >
                                            {/* El texto dice de quién es la decisión: solo cuando el
                                                cliente aprobó sin elegir le toca definirlas al
                                                diseñador. En los otros casos el visor abre para ver
                                                (con candado adentro si igual hay que corregir). */}
                                            <i className="fa-solid fa-cube"></i> {tpuEstado.texturasElige === 'DISENADOR' ? 'Seleccionar texturas' : 'Ver en 3D'}
                                        </button>
                                    )}

                                    {/* En fase boceto con el boceto ya cargado no hay nada más que subir:
                                        el siguiente paso es el botón de enviar a aprobación. */}
                                    {isTPU && !(faseBocetoTPU && bocetosProduccion.length > 0) && (
                                        <label className={`relative overflow-hidden flex items-center justify-center gap-2 py-3 mb-2 rounded-xl border-2 border-dashed transition-colors ${uploadingTPU ? 'border-brand-cyan/30 text-brand-cyan pointer-events-none' : 'border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/5 cursor-pointer'}`}>
                                            {/* Barra de progreso de la subida (relleno de fondo, % por bytes) */}
                                            {uploadingTPU && progresoTPU && (
                                                <div
                                                    className="absolute inset-y-0 left-0 bg-brand-cyan/15 transition-all duration-200"
                                                    style={{ width: `${progresoTPU.pct}%` }}
                                                />
                                            )}
                                            <i className={`relative fa-solid ${uploadingTPU ? 'fa-circle-notch fa-spin' : 'fa-plus'}`}></i>
                                            <span className="relative text-xs font-bold uppercase tracking-wide">
                                                {uploadingTPU
                                                    ? (progresoTPU
                                                        ? `Subiendo ${progresoTPU.actual}/${progresoTPU.total} · ${progresoTPU.pct}%`
                                                        : 'Subiendo...')
                                                    : faseBocetoTPU
                                                        ? 'Subir boceto de producción (PDF)'
                                                        : `Subir arte (PDF / PLT · ${CAPAS_ARTE_TPU} capas)`}
                                            </span>
                                            <input type="file"
                                                accept={faseBocetoTPU ? 'application/pdf,.pdf' : 'application/pdf,.pdf,.plt'}
                                                multiple={!faseBocetoTPU}
                                                className="hidden" disabled={uploadingTPU}
                                                onChange={(e) => { handleUploadTPUFiles(e.target.files); e.target.value = ''; }} />
                                        </label>
                                    )}
                                    {printFilesVista.length === 0 ? (
                                        <div className="py-12 text-center text-zinc-400 italic bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
                                            No hay archivos de impresión cargados.
                                            {/* El boceto no se lista acá: se muestra en Referencias. Sin este aviso el
                                                operario sube el boceto y ve la pestaña vacía, como si no hubiera subido nada. */}
                                            {bocetosProduccion.length > 0 && (
                                                <div className="mt-2 text-[11px] not-italic font-bold uppercase tracking-wide text-brand-cyan">
                                                    <i className="fa-solid fa-arrow-turn-down mr-1"></i>
                                                    El boceto está en “Archivos de Referencia”
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        printFilesVista.map((f, idx) => {
                                            const { actions, editContent } = renderFileActionsData(f, idx);
                                            // Solo en órdenes de reposición: el readonly es el original (orden madre),
                                            // el editable es el de esta reposición. Se ven iguales (nombre heredado).
                                            const repoLabel = isRepoOrder
                                                ? (f.readonly
                                                    ? { text: 'Original (madre)', tone: 'zinc' }
                                                    : { text: 'Reposición', tone: 'cyan' })
                                                : null;
                                            // Relación con una FALLA — se marca SIEMPRE, esté sanada o no:
                                            //  · el archivo está fallado ahora
                                            //  · ya fue repuesto (la cura le deja la marca [Repuesto])
                                            //  · o es el archivo de una orden de falla (-F), o sea la reposición
                                            const fallaLabel = (() => {
                                                const est = String(f.EstadoArchivo || f.Estado || f.estado || '').toUpperCase();
                                                const obs = String(f.Observaciones || f.observaciones || '');
                                                // Marcas que deja la cura al completar la reposición. Son DOS textos
                                                // distintos según el camino: '[Reposición OK]' y '[Repuesto]'.
                                                const yaRepuesto   = /\[Repuesto\]|\[Reposici[oó]n OK\]/i.test(obs);
                                                const esDeOrdenF   = /-F\d+/i.test(String(f._codigoOrden || '')) || /Reposici[oó]n por Falla/i.test(obs);
                                                const estaResuelto = est === 'OK' || est === 'FINALIZADO';

                                                if (est === 'FALLA') return { text: 'Falla', tone: 'magenta', title: 'Este archivo está reportado como falla' };
                                                if (yaRepuesto)      return { text: 'Falla resuelta', tone: 'ok', title: 'Tuvo una falla y su reposición ya se completó' };
                                                if (esDeOrdenF) {
                                                    // Archivo de la orden -F: si ya se controló OK, esa reposición está cerrada.
                                                    return estaResuelto
                                                        ? { text: 'Falla resuelta', tone: 'ok',      title: `Reposición completada${f._codigoOrden ? ` (${f._codigoOrden})` : ''}` }
                                                        : { text: 'Repone falla',   tone: 'magenta', title: `Reposición en curso${f._codigoOrden ? ` (${f._codigoOrden})` : ''}` };
                                                }
                                                return null;
                                            })();
                                            return (
                                                <FileItem
                                                    key={`file-${idx}`}
                                                    file={f}
                                                    readOnly={true}
                                                    extraInfo={{
                                                        roll: currentOrder?.rollId || 'General',
                                                        machine: currentOrder?.printer || 'Sin Asignar',
                                                        um: currentOrder.UM || currentOrder.unit || 'm',
                                                        repoLabel,
                                                        fallaLabel
                                                    }}
                                                    actions={actions}
                                                    editingContent={editContent}
                                                />
                                            );
                                        })
                                    )}
                                    {/* Footer Totales — en TPU no aplica: la orden es por unidades y el
                                        metraje de las capas del arte no significa nada. */}
                                    {!isTPU && productionFiles.length > 0 && (
                                        <div className="mt-4 pt-3 border-t border-zinc-100 flex justify-between items-center text-sm px-2">
                                            <span className="font-bold text-zinc-400 uppercase text-xs tracking-wider">Metraje Total Estimado</span>
                                            <span className="font-black text-brand-cyan text-xl font-mono">
                                                {productionFiles.reduce((acc, f) => {
                                                    const fStatus = (f.Estado || f.estado || f.EstadoArchivo || '').toUpperCase();
                                                    if (fStatus === 'CANCELADO') return acc;
                                                    return acc + ((f.copias || f.copies || f.Copias || 1) * (f.metros || f.width || f.Metros || 0));
                                                }, 0).toFixed(2)}m
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* PESTAÑA: REFERENCIAS */}
                            {activeTab === 'refs' && (
                                <div className="space-y-2">
                                    {/* Fallas marcadas (recuadro dibujado en Control) — solo SB */}
                                    {isSB && fallaImages.length > 0 && (
                                        <div className="mb-3">
                                            <div className="text-[11px] font-black text-[#BD0C7E] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                <i className="fa-solid fa-triangle-exclamation"></i> Fallas marcadas ({fallaImages.length})
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                {fallaImages.map(fi => (
                                                    <a key={fi.FallaID} href={fi.ImagenFalla} target="_blank" rel="noreferrer" className="block">
                                                        <div className="rounded-lg overflow-hidden border border-[#BD0C7E]/30 bg-slate-50">
                                                            <img src={fi.ImagenFalla} alt="Falla" className="w-full h-auto object-contain" loading="lazy" />
                                                        </div>
                                                        <div className="text-[10px] font-bold text-zinc-600 mt-1 truncate">
                                                            {fi.TipoFalla || 'Falla'}{fi.NombreArchivo ? ` · ${fi.NombreArchivo}` : ''}
                                                        </div>
                                                        {fi.Observaciones && (
                                                            <div className="text-[11px] text-zinc-500 mt-0.5 whitespace-pre-wrap break-words">
                                                                <span className="font-bold text-zinc-600">Detalle:</span> {fi.Observaciones}
                                                            </div>
                                                        )}
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {referenceFiles.length === 0 && bocetosProduccion.length === 0 && !(isSB && fallaImages.length > 0) ? (
                                        <div className="py-8 text-center text-zinc-400 bg-zinc-50 rounded-lg border border-dashed border-zinc-200">
                                            <i className="fa-regular fa-image text-2xl mb-2 block opacity-50"></i>
                                            Sin imágenes de referencia o guías.
                                        </div>
                                    ) : (
                                        <>
                                            {referenceFiles.map((f, idx) => (
                                                <ReferenceItem key={idx} file={f} />
                                            ))}
                                            {/* TPU: el arte "boceto" (uno de los 6) se muestra acá, debajo del boceto
                                                del cliente, como BOCETO DE PRODUCCIÓN — es lo que el cliente aprueba. */}
                                            {/* En fase boceto se puede BORRAR (para reemplazarlo, ej. tras un
                                                rechazo); una vez aprobado ya no: es lo que el cliente aprobó. */}
                                            {bocetosProduccion.map((f, idx) => (
                                                <div key={`bocprod-${idx}`} className="relative">
                                                    <ReferenceItem file={{ ...f, tipo: 'BOCETO DE PRODUCCION', TipoArchivo: 'BOCETO DE PRODUCCION' }} />
                                                    {faseBocetoTPU && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteFileTPU(f.id || f.ArchivoID)}
                                                            /* A la IZQUIERDA del botón de descargar, no encima: ReferenceItem lo pone último en
                                                               una fila flex con padding 12px, así que ocupa los 44px de
                                                               la derecha. Centrado en vertical para que queden alineados. */
                                                            className="absolute right-14 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md bg-white border border-red-200 text-red-500 hover:bg-red-50 flex items-center justify-center shadow-sm"
                                                            title="Borrar el boceto para subir uno nuevo"
                                                        ><i className="fa-solid fa-trash-can text-xs"></i></button>
                                                    )}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </div>
                            )}

                            {/* PESTAÑA: SERVICIOS / PRODUCTOS */}
                            {activeTab === 'services' && (
                                <div className="p-1 h-[500px]">
                                    <QuotationEditModal
                                        embedded={true}
                                        noDocERP={currentOrder.code || currentOrder.id}
                                        currentUser={user}
                                        areaFilter={currentOrder.area}
                                        onSaved={reloadFiles}
                                        readOnly={readOnly}
                                    />
                                </div>
                            )}

                            {/* PESTAÑA: ETIQUETAS (Tu código existente) */}
                            {activeTab === 'labels' && (
                                <div className="min-h-[200px]">
                                    <div className="flex justify-between items-center mb-4 bg-brand-cyan/10 p-3 rounded-lg border border-brand-cyan/20">
                                        <div className="flex items-center gap-2 text-brand-cyan">
                                            <i className="fa-solid fa-boxes-stacked"></i>
                                            <h3 className="font-bold text-sm">Gestión de Bultos</h3>
                                        </div>
                                        <div className="flex gap-2">
                                            {!readOnly && (
                                                <>
                                                    <button onClick={handleAddLabel} className="px-3 py-1.5 bg-white text-brand-cyan border border-brand-cyan/30 rounded text-xs font-bold hover:bg-brand-cyan/10 transition shadow-sm"><i className="fa-solid fa-plus mr-1"></i> Extra</button>
                                                    <button onClick={handleRecalcular} className="px-3 py-1.5 bg-white text-amber-600 border border-amber-200 rounded text-xs font-bold hover:bg-amber-50 transition shadow-sm" title="Recalcular contadores (mantiene números de etiqueta)">
                                                        <i className="fa-solid fa-arrow-rotate-left mr-1"></i> Recalcular
                                                    </button>
                                                </>
                                            )}
                                            <button onClick={handlePrintLabels} className="px-3 py-1.5 bg-brand-cyan text-white rounded text-xs font-bold hover:bg-brand-cyan/80 transition shadow-sm"><i className="fa-solid fa-print mr-1"></i> Imprimir</button>
                                        </div>
                                    </div>
                                    {/* ... Logic de mapeo de labels (mantenida igual) ... */}
                                    {loadingLabels ? <div className="py-12 text-center text-zinc-400"><i className="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br />Cargando...</div> : labels.length === 0 ? <div className="py-8 text-center text-zinc-400 italic">No hay etiquetas generadas.</div> :
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[350px] overflow-y-auto custom-scrollbar p-1">
                                            {labels.map(l => (
                                                <div key={l.EtiquetaID} className="bg-white border border-zinc-200 rounded-lg p-3 flex justify-between items-center shadow-sm hover:shadow-md transition group">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-zinc-100 rounded flex items-center justify-center text-zinc-500 font-bold text-lg border border-zinc-200">{l.NumeroBulto}</div>
                                                        <div><div className="font-bold text-zinc-700 text-sm">Bulto {l.NumeroBulto}/{l.TotalBultos}</div><div className="text-[10px] text-zinc-400 font-mono tracking-widest">{l.CodigoEtiqueta || '---'}</div></div>
                                                    </div>
                                                    {!readOnly && (
                                                    <button onClick={() => handleDeleteLabel(l.EtiquetaID)} className="w-7 h-7 rounded bg-white text-zinc-300 hover:text-brand-magenta hover:bg-brand-magenta/10 border border-transparent hover:border-brand-magenta/20 transition"><i className="fa-solid fa-trash-can text-xs"></i></button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    }
                                </div>
                            )}

                        </div>
                    </div>

                </div>

                {/* FOOTER ACCIONES CONSOLIDADO */}
                <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-between items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                        {/* Grupo de Botones Peligrosos — solo visible si NO está cancelada */}
                        {!readOnly && !['CANCELADO','Cancelado'].includes(currentOrder?.status) && (
                        <div className="flex bg-white rounded-lg border border-zinc-200 p-1 shadow-sm">
                            <button
                                onClick={() => { setCancelType('ORDER'); setCancelModalOpen(true); }}
                                className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-2 hover:bg-brand-magenta/10 text-zinc-500 hover:text-brand-magenta`}
                                title="Cancelar solo esta orden del área"
                            >
                                <i className="fa-solid fa-ban"></i> Cancelar Orden
                            </button>
                            <div className="w-px bg-zinc-200 my-1"></div>
                            <button
                                onClick={() => { setCancelType('REQUEST'); setCancelModalOpen(true); }}
                                className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-2 hover:bg-brand-magenta/10 text-zinc-500 hover:text-brand-magenta`}
                                title="Cancelar todo el pedido (todas las áreas)"
                            >
                                <i className="fa-solid fa-dumpster-fire"></i> Cancelar Pedido
                            </button>
                        </div>
                        )}

                        {/* Grupo de Botones de Reactivación — visible solo si la orden está cancelada */}
                        {!readOnly && ['CANCELADO','Cancelado'].includes(currentOrder?.status) && (
                        <div className="flex bg-white rounded-lg border border-emerald-200 p-1 shadow-sm">
                            <button
                                onClick={() => handleReactivate('ORDER')}
                                className="px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-2 hover:bg-emerald-50 text-zinc-500 hover:text-emerald-700"
                                title="Reactivar solo esta orden"
                            >
                                <i className="fa-solid fa-rotate-left"></i> Reactivar Orden
                            </button>
                            <div className="w-px bg-zinc-200 my-1"></div>
                            <button
                                onClick={() => handleReactivate('REQUEST')}
                                className="px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-2 hover:bg-emerald-50 text-zinc-500 hover:text-emerald-700"
                                title="Reactivar todo el pedido (todas las áreas)"
                            >
                                <i className="fa-solid fa-rotate"></i> Reactivar Pedido
                            </button>
                        </div>
                        )}
                    </div>

                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-zinc-800 text-white font-bold rounded-lg hover:bg-zinc-700 transition shadow-lg shadow-zinc-200 active:scale-95"
                    >
                        Cerrar
                    </button>
                </div>

            </div>

            {/* MODAL DE CANCELACIÓN */}
            {cancelModalOpen && (
                <div className="fixed inset-0 z-[2100] bg-black/50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200 border border-brand-magenta/20">
                        <div className="flex items-center gap-3 text-brand-magenta mb-4">
                            <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
                            <h3 className="text-lg font-black uppercase">
                                {cancelType === 'REQUEST' ? 'Cancelar Pedido Completo' :
                                    cancelType === 'FILE' ? 'Cancelar Archivo' : 'Cancelar Orden'}
                            </h3>
                        </div>

                        <p className="text-zinc-600 text-sm mb-4">
                            {cancelType === 'REQUEST' ? (
                                <>
                                    Se cancelarán <b>TODAS las órdenes</b> del pedido <b>{currentOrder.code.split('(')[0]}</b> en <b>TODAS las áreas</b>.
                                    <span className="block mt-2 font-bold text-brand-magenta bg-brand-magenta/10 p-2 rounded border border-brand-magenta/20">
                                        Esta acción afecta a todo el flujo de producción.
                                    </span>
                                </>
                            ) : cancelType === 'FILE' ? (
                                <>
                                    Se cancelará el archivo <b>{fileToCancel?.name || fileToCancel?.NombreArchivo}</b>.
                                    <br />Si este es el último archivo activo, la orden se cancelará automáticamente.
                                </>
                            ) : (
                                <>
                                    Se cancelará solo esta orden <b>({currentOrder.code})</b> del área <b>{currentOrder.area}</b> con sus archivos.
                                </>
                            )}
                        </p>

                        <div className="mb-6">
                            <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                                Motivo de Cancelación <span className="text-red-500">*</span>
                            </label>
                            
                            {/* Selector de Motivos (MotivosCancelacion) */}
                            <div className="relative mb-3 z-50">
                                <Listbox value={selectedMotivo} onChange={setSelectedMotivo}>
                                    <div className="relative">
                                        <Listbox.Button className="relative w-full cursor-pointer rounded-xl bg-zinc-50 py-3 pl-4 pr-10 text-left border border-zinc-200 focus:outline-none focus-visible:border-brand-magenta sm:text-sm">
                                            <span className={`block truncate font-medium ${selectedMotivo ? 'text-zinc-900' : 'text-zinc-400'}`}>
                                                {selectedMotivo ? selectedMotivo.Titulo : 'Seleccione un motivo...'}
                                            </span>
                                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                                                <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                                            </span>
                                        </Listbox.Button>
                                        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
                                            <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-xl bg-white py-2 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm z-50">
                                                {motivosOptions.map((motivo) => (
                                                    <Listbox.Option
                                                        key={motivo.MotivoID}
                                                        className={({ active }) =>
                                                            `relative cursor-pointer select-none py-2.5 pl-10 pr-4 ${active ? 'bg-brand-magenta/10 text-brand-magenta' : 'text-zinc-700'}`
                                                        }
                                                        value={motivo}
                                                    >
                                                        {({ selected }) => (
                                                            <>
                                                                <span className={`block truncate ${selected ? 'font-black' : 'font-medium'}`}>
                                                                    {motivo.Titulo}
                                                                </span>
                                                                {selected ? (
                                                                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-brand-magenta">
                                                                        <Check className="h-4 w-4" aria-hidden="true" />
                                                                    </span>
                                                                ) : null}
                                                            </>
                                                        )}
                                                    </Listbox.Option>
                                                ))}
                                            </Listbox.Options>
                                        </Transition>
                                    </div>
                                </Listbox>
                            </div>

                            {selectedMotivo?.MotivoID === 'otros' ? (
                                <input
                                    type="text"
                                    className="w-full p-3 bg-white border border-brand-magenta/30 rounded-xl outline-none focus:border-brand-magenta text-sm font-bold text-zinc-800 shadow-sm"
                                    placeholder="Especifique el motivo de cancelación *"
                                    value={cancelDetails}
                                    onChange={(e) => setCancelDetails(e.target.value)}
                                    autoFocus
                                />
                            ) : (
                                <textarea
                                    className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl outline-none focus:border-red-400 min-h-[100px] text-sm font-medium text-zinc-700 resize-none"
                                    placeholder="Detalles adicionales (opcional)..."
                                    value={cancelDetails}
                                    onChange={(e) => setCancelDetails(e.target.value)}
                                    autoFocus
                                ></textarea>
                            )}
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => { setCancelModalOpen(false); setCancelType(null); setFileToCancel(null); }}
                                className="px-4 py-2 text-zinc-500 font-bold hover:bg-zinc-50 rounded-lg transition"
                            >
                                Volver
                            </button>
                            <button
                                onClick={handleConfirmCancel}
                                className="px-4 py-2 bg-brand-magenta text-white font-bold rounded-lg shadow-lg shadow-red-200 hover:bg-brand-magenta transition transform active:scale-95"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Visor 3D TPU en modo interno (elige/corrige texturas el diseñador). */}
            {visor3D && (
                <React.Suspense fallback={null}>
                    <Tpu3DViewer
                        modo="interno"
                        ordenId={currentOrder.id}
                        codigo={currentOrder.code}
                        onClose={async () => {
                            setVisor3D(false);
                            // Guardar en el visor deja el PNG del boceto aprobado en referencias:
                            // sin recargar la lista, la pestaña no lo muestra hasta reabrir el modal.
                            reloadFiles();
                            try {
                                const t = await ordersService.getTexturasOrden(currentOrder.id);
                                setTpuEstado({ aprobado: !!t?.aprobado, rechazado: !!t?.rechazado, enLote: !!t?.enLote, texturasElige: t?.texturasElige || null });
                            } catch (_) { /* sin refresco: se verá al reabrir */ }
                        }}
                    />
                </React.Suspense>
            )}
            </div>
        </>,
        document.body
    );
};

export default OrderDetailModal;

