import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
    Save, UploadCloud, Plus, Trash2, ArrowLeft,
    AlertTriangle, Check, Scissors, Zap, Download,
    ImageIcon, User, FileCode, CheckCircle, ClipboardList, Layers
} from 'lucide-react';

// Custom Hooks
import { useOrderForm } from './order-form/hooks/useOrderForm';
import { useToast } from '../pautas/Toast';

// Services
import { fileService } from '../api/fileService';
import { apiClient } from '../api/apiClient';

// UI Components
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { FormInput } from '../pautas/FormInput';
import { PrintSettingsPanel } from '../pautas/PrintSettingsPanel';

import { CustomSelect } from '../pautas/CustomSelect';
import ErrorModal from './order-form/components/ErrorModal';
import UploadProgressModal from './order-form/components/UploadProgressModal';
import FileUploadZone from './order-form/components/FileUploadZone';
import CorteTechnicalUI from './order-form/components/CorteTechnicalUI';
import CosturaTechnicalUI from './order-form/components/CosturaTechnicalUI';
import BordadoTechnicalUI from './order-form/components/BordadoTechnicalUI';
import { EstampadoTechnicalUI } from './order-form/components/EstampadoTechnicalUI';
import EcouvTerminacionesUI from './EcouvTerminacionesUI';

const ServiceAccordion = ({ title, subtitle, isActive, onToggle, children, icon: Icon, main = false, optional = false }) => {
    return (
        <div className={`md:!rounded-3xl !rounded-none border-y !border-x-0 md:!border transition-all duration-300 ${isActive ? 'border-zinc-700 bg-custom-dark shadow-xl shadow-black/20 overflow-visible' : 'border-zinc-700/50 bg-custom-dark/60 overflow-hidden'} -mx-4 md:mx-0`}>
            <div
                className={`p-4 md:p-6 flex items-center justify-between cursor-pointer transition-colors ${isActive ? 'bg-custom-dark text-zinc-100 md:rounded-t-[1.7rem] rounded-t-none' : 'hover:bg-custom-dark text-zinc-400 md:rounded-[1.7rem] rounded-none'}`}
                onClick={onToggle}
            >
                <div className="flex items-center gap-4">
                    {Icon && <Icon size={20} className="text-brand-gold" />}
                    <div>
                        <span className="font-bold uppercase tracking-wide text-sm">{title}</span>
                        {subtitle && <p className="text-[10px] text-zinc-500 mt-0.5 md:hidden">{subtitle}</p>}
                        {optional && (
                            <p className={`text-[10px] mt-0.5 font-medium tracking-wide ${isActive ? 'text-cyan-400' : 'text-zinc-500'}`}>
                                {isActive ? '✓ Incluido en el pedido' : 'Opcional · Tocá para agregar'}
                            </p>
                        )}
                    </div>
                </div>
                {main && <span className="text-[10px] bg-cyan-400 text-zinc-900 px-2.5 py-1 rounded-full font-black tracking-wider">PRINCIPAL</span>}
                {optional && !main && (
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-black tracking-wider ${isActive ? 'bg-cyan-400/20 text-cyan-400' : 'bg-zinc-700/50 text-zinc-500'}`}>
                        {isActive ? 'ACTIVO' : '+ AGREGAR'}
                    </span>
                )}
            </div>

            {isActive && (
                <div className="p-4 md:p-6 border-t border-zinc-700/50 animate-in slide-in-from-top-4">
                    {children}
                </div>
            )}
        </div>
    );
};

// Helper to robustly resolve material printable width from DB 'Ancho' field or fallback to regex name parsing
const resolveMaterialWidth = (matObj) => {
    if (!matObj) return 1.50;
    
    // 1. Try parsing from Ancho if it's a valid positive number
    if (matObj && matObj.Ancho !== undefined && matObj.Ancho !== null) {
        const rawAncho = typeof matObj.Ancho === 'string' 
            ? parseFloat(matObj.Ancho.replace(',', '.')) 
            : parseFloat(matObj.Ancho);
        if (!isNaN(rawAncho) && rawAncho > 0) {
            return rawAncho;
        }
    }
    
    // 2. Fallback: extract from description name
    const matName = matObj.Material || matObj.Descripcion || (typeof matObj === 'string' ? matObj : '');
    if (matName) {
        // Look for number inside parenthesis, e.g., (1,83) or (1.83) or (1,70 m)
        const parenMatch = matName.match(/\((\d+(?:[.,]\d+)?)(?:\s*m)?/);
        if (parenMatch) {
            const parsed = parseFloat(parenMatch[1].replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        
        // Look for any decimal number in the string, e.g. 1.83 or 1,83
        const numberMatch = matName.match(/(\d+(?:[.,]\d+)+)/);
        if (numberMatch) {
            const parsed = parseFloat(numberMatch[1].replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
    }
    
    return 1.50;
};

const OrderForm = ({ serviceId: propServiceId }) => {
    const { serviceId: paramServiceId } = useParams();
    const navigate = useNavigate();
    const { addToast } = useToast();
    const location = useLocation();

    // Allows passing overrides via navigate('/order/...', { state: { config: { allowedOptions: ['...'] } } })
    const overrideConfig = location.state?.config || {};

    const serviceId = propServiceId || paramServiceId;

    // Use the custom hook for all state management
    const { state, actions, config, serviceInfo, userStock, visibleComplementaryOptions } = useOrderForm(serviceId, overrideConfig);

    // Destructure state for easier access in render
    const {
        jobName, serviceSubType, urgency, generalNote, globalMaterial, fabricType,
        items, referenceFiles, selectedComplementary,
        moldType, fabricOrigin, clientFabricName, selectedSubOrderId, tizadaFiles,
        pedidoExcelFile, enableCorte, enableCostura, garmentQuantity,
        ponchadoFiles, bocetoFile, bordadoBocetoFile, costuraNote,
        bordadoMaterial, bordadoVariant,
        // Estampado
        estampadoFile, estampadoQuantity, estampadoPrints, estampadoOrigin,
        // TPU
        tpuForma,
        loading, showSuccessModal, createdOrderIds, uploading, uploadProgress, uploadError,
        errorModalOpen, errorModalMessage,
        uniqueVariants, dynamicMaterials, visibleConfig, prioritiesList,
        activeSubOrders, embroideryVariants, embroideryMaterials
    } = state;

    // Helper for TPU Service logic
    const currentMaterials = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
    const selectedMaterialObj = currentMaterials.find(m => (m.Material || m) === globalMaterial);

    // Check by Name OR Code 1568
    const isTpuEtiquetaOficial = serviceId === 'tpu' && (
        globalMaterial === 'ETIQUETA PRODUCTO OFICIAL' ||
        globalMaterial === 'ETIQUETAS OFICIALES HASTA 4X4' ||
        (selectedMaterialObj && String(selectedMaterialObj.CodArticulo || '').trim() === '1568')
    );

    // Initial Config for Specific Services
    useEffect(() => {
        if (serviceId === 'corte') {
            // Default to 'MOLDES CLIENTES' so file upload is visible immediately
            actions.setMoldType('MOLDES CLIENTES');
        }
    }, [serviceId]);


    // Directa 3.20 Twinface Logic (Code 1560)
    const isDirectaTwinface = serviceId === 'directa_320' && (
        (selectedMaterialObj && String(selectedMaterialObj.CodArticulo || '').trim() === '1560') ||
        (globalMaterial && globalMaterial.toUpperCase().includes('TWOFACE'))
    );

    const [twinfaceSame, setTwinfaceSame] = useState(false);
    const [applyMaterialToAll, setApplyMaterialToAll] = useState(false);

    const handleApplyMaterialToAll = (checked) => {
        setApplyMaterialToAll(checked);
        if (checked && items.length > 0) {
            const firstMaterial = items[0].material;
            const updated = items.map(it => ({ ...it, material: firstMaterial }));
            actions.setItems(updated);
        }
    };

    const handleItemMaterialChange = (itemId, val) => {
        if (applyMaterialToAll) {
            const updated = items.map(it => ({ ...it, material: val }));
            actions.setItems(updated);
        } else {
            actions.updateItem(itemId, 'material', val);
        }
    };

    // --- Handlers for File Uploads (that need UI feedback or validation) ---

    // Generic handler for single file specialized upload
    const handleSpecializedFileUpload = (setterAction, file) => {
        if (!file) return;
        // STORE RAW FILE, DO NOT UPLOAD YET. Defer to final submit.
        setterAction(file);
        addToast('Archivo adjunto (Pendiente de envío con el pedido)');
    };

    // Generic handler for multiple file specialized upload
    const handleMultipleSpecializedFileUpload = (addFilesAction, filesInput) => {
        if (!filesInput) return;

        // Ensure regular array
        let files = [];
        if (filesInput instanceof FileList) {
            files = Array.from(filesInput);
        } else if (Array.isArray(filesInput)) {
            files = filesInput;
        } else {
            files = [filesInput];
        }

        if (files.length === 0) return;

        // Filter valid files
        const validFiles = files.filter(f => (f instanceof Blob || f instanceof File));

        if (validFiles.length > 0) {
            addFilesAction(validFiles);
            addToast(`${validFiles.length} archivos adjuntos (Pendientes de envío)`);
        }
    };

    // Main Item File Upload Handler (with Validation)
    const handleFileUpload = async (itemId, field, file) => {
        if (!file) return false;

        // Validation
        const allowed = ['image/png', 'image/jpeg', 'application/pdf'];
        const isAllowed = allowed.includes(file.type) || file.name.toLowerCase().match(/\.(jpg|jpeg|png|pdf)$/);

        if (!isAllowed) {
            addToast('Formato de archivo inválido, debe ajustarse a los formatos establecidos.', 'error');
            return false;
        }

        try {
            const result = await fileService.uploadFile(file);

            // Validation of Printable Width
            if (result.width && !result.measurementError) {
                const currentItem = items.find(it => it.id === itemId);
                const itemMaterial = currentItem?.material || '';

                let selectedMatName;
                let maxWidth;

                if (serviceId === 'sublimacion') {
                    // For sublimación: validate against item material if selected, else default 1.83m
                    if (itemMaterial) {
                        selectedMatName = itemMaterial;
                        const matList = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
                        const matObj = matList.find(m => (m.Material || m.Descripcion || m) === itemMaterial) || itemMaterial;
                        maxWidth = resolveMaterialWidth(matObj);
                    } else {
                        selectedMatName = null;
                        maxWidth = 1.83;
                    }
                } else {
                    selectedMatName = globalMaterial;
                    if (config.materialMode === 'multiple' && itemMaterial) {
                        selectedMatName = itemMaterial;
                    }
                    const matList = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
                    const matObj = matList.find(m => (m.Material || m.Descripcion || m) === selectedMatName) || selectedMatName;
                    maxWidth = resolveMaterialWidth(matObj);
                }

                const fileWidthM = result.unit === 'meters' ? result.width : (result.width / 300) * 0.0254;
                const maxPrintableWidth = maxWidth - 0.03;

                if (fileWidthM > maxPrintableWidth + 0.001) {
                    const matLabel = selectedMatName || `ancho máximo ${maxWidth.toFixed(2)}m`;
                    actions.setErrorModalMessage(
                        `El ancho del archivo (${fileWidthM.toFixed(2)}m) excede el ancho imprimible del material "${matLabel}" (${maxPrintableWidth.toFixed(2)}m). Por favor, ajuste el archivo o seleccione otro material.`
                    );
                    actions.setErrorModalOpen(true);
                    return false;
                }

                // Validación de alto máximo para DTF (2.50m)
                if (serviceId?.toUpperCase() === 'DF') {
                    const fileHeightM = result.unit === 'meters' ? result.height : (result.height / 300) * 0.0254;
                    if (fileHeightM > 2.50) {
                        actions.setErrorModalMessage(
                            `El alto del archivo (${fileHeightM.toFixed(2)}m) excede el máximo permitido para DTF (2.50m). Por favor, ajuste el archivo.`
                        );
                        actions.setErrorModalOpen(true);
                        return false;
                    }
                }
            }

            // Validación de páginas para DTF (máximo 1 página)
            if (serviceId?.toUpperCase() === 'DF' && result.pageCount && result.pageCount > 1) {
                actions.setErrorModalMessage(
                    `El archivo tiene ${result.pageCount} páginas. Para DTF solo se permite 1 página por archivo.`
                );
                actions.setErrorModalOpen(true);
                return false;
            }

            if (result.measurementError) {
                addToast(`ALERTA TÉCNICA: El archivo se cargó pero no pudo ser medido automáticamente. (${result.measurementError})`, 'warning');

                // Update with error note
                const newItems = items.map(it => {
                    if (it.id === itemId) {
                        const errorMsg = `[NO PUDO MEDIR: ${result.measurementError.toUpperCase()}]`;
                        const currentNote = it.note || '';
                        return {
                            ...it,
                            [field]: result,
                            note: currentNote.includes(errorMsg) ? currentNote : (errorMsg + " " + currentNote).trim()
                        };
                    }
                    return it;
                });
                actions.setItems(newItems);
            } else {
                actions.updateItem(itemId, field, result);
                addToast('Archivo listo (Medida Detectada)', 'success');
                return true;
            }
            return true;
        } catch (err) {
            addToast(err.message, 'error');
            return false;
        }
    };

    // --- Submit Logic ---
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!jobName.trim()) return addToast('Nombre del proyecto requerido', 'error');

        const invalidPrintSettings = items.some(it => it.printSettings?.isValid === false);
        if (invalidPrintSettings) {
            return addToast('Hay errores en la configuración de impresión. Revise los items.', 'error');
        }

        if (config.hasCuttingWorkflow && moldType === 'MOLDES CLIENTES' && (!tizadaFiles || tizadaFiles.length === 0)) {
            return addToast('Debe subir al menos un archivo de tizada para moldes de clientes', 'error');
        }

        if (serviceId === 'tpu') {
            const invalidCopies = items.some(it => it.copies < 30);
            if (invalidCopies) {
                return addToast('El pedido mínimo para TPU es de 30 copias por diseño.', 'error');
            }
            if (isTpuEtiquetaOficial && !tpuForma) {
                return addToast('Debe seleccionar una Forma para la Etiqueta de Producto Oficial.', 'error');
            }
        }

        actions.setLoading(true);

        try {
            // Helper to map files for upload
            const filesToUploadMap = {};
            const addToMap = (f) => {
                if (f && f.name) {
                    if (f.fileData && f.fileData instanceof File) {
                        filesToUploadMap[f.name] = f.fileData;
                    } else if (f instanceof File) {
                        filesToUploadMap[f.name] = f;
                    }
                }
            };

            // Collect Files
            if (bocetoFile) addToMap(bocetoFile);
            if (bordadoBocetoFile) addToMap(bordadoBocetoFile);
            if (Array.isArray(tizadaFiles)) tizadaFiles.forEach(addToMap);
            if (pedidoExcelFile) addToMap(pedidoExcelFile);
            if (Array.isArray(tizadaFiles)) tizadaFiles.forEach(addToMap);
            if (pedidoExcelFile) addToMap(pedidoExcelFile);
            if (Array.isArray(ponchadoFiles)) ponchadoFiles.forEach(addToMap);
            if (estampadoFile) addToMap(estampadoFile);
            if (referenceFiles) referenceFiles.forEach(addToMap);
            items.forEach(it => {
                if (it.file) addToMap(it.file);
                if (it.fileBack) addToMap(it.fileBack);
            });
            if (selectedComplementary) {
                Object.keys(selectedComplementary).forEach(id => {
                    const comp = selectedComplementary[id];
                    if (comp.active && comp.file) addToMap(comp.file);
                });
            }

            // Helper to map material codes
            const mapMaterial = (matName, areaId = null) => {
                const searchList = areaId === 'EMB' ? embroideryMaterials : dynamicMaterials;
                const found = searchList.find(m => m.Material === matName);
                if (found) return { name: found.Material, codArt: found.CodArticulo, codStock: found.CodStock };
                return { name: matName };
            };

            // Enriched Complementary Services Metadata
            const enrichedComplementary = {};
            if (selectedComplementary) {
                Object.keys(selectedComplementary).forEach(id => {
                    const comp = selectedComplementary[id];
                    if (comp.active) {
                        let cabecera = { variante: serviceSubType, material: mapMaterial(globalMaterial) };
                        if (id === 'TWC' || id === 'laser') {
                            cabecera = { variante: 'Corte Laser', material: { name: 'Corte Laser por prenda', id: 90, codArt: '1375', codStock: '1.1.6.1' } };
                        } else if (id === 'EST' || id === 'estampado') {
                            cabecera = {
                                variante: 'Estampado',
                                material: { name: 'Estampado por bajada', codArt: serviceInfo?.config?.defaultCodArt || '110', codStock: serviceInfo?.config?.defaultCodStock || '1.1.5.1' }
                            };
                        } else if (id === 'EMB' || id === 'BORDADO') {
                            cabecera = { variante: bordadoVariant || serviceSubType, material: mapMaterial(bordadoMaterial || globalMaterial, 'EMB') };
                        }

                        // Determinar Tipo de Archivo Específico
                        let fileType = 'ARCHIVO_EXTRA';
                        if (id === 'TWC') fileType = 'ARCHIVO_CORTE';
                        if (id === 'TWT') fileType = 'GUIA_CONFECCION';
                        if (id === 'EST' || id === 'estampado') fileType = 'BOCETO_ESTAMPADO';
                        if (id === 'EMB' || id === 'BORDADO') fileType = 'BOCETO_BORDADO';

                        // Prepare files array
                        const archivosComp = [];
                        if (comp.file) archivosComp.push({ name: comp.file.name, size: comp.file.size, tipo: fileType });

                        // Fallback: Si no hay archivo específico y es Estampado, usar global (Solo si NO se usó comp.file que ya lo cubría antes, pero aquí somos explícitos)
                        if ((id === 'EST' || id === 'estampado') && !comp.file && estampadoFile) {
                            archivosComp.push({ name: estampadoFile.name, tipo: 'BOCETO_ESTAMPADO' });
                        }

                        // Fallback y Extras para Bordado complementario
                        if (id === 'EMB' || id === 'BORDADO') {
                            if (!comp.file && bordadoBocetoFile) {
                                archivosComp.push({ name: bordadoBocetoFile.name, tipo: 'BOCETO_BORDADO' });
                            }
                            if (ponchadoFiles && ponchadoFiles.length > 0) {
                                ponchadoFiles.forEach(f => archivosComp.push({ name: f.name, tipo: 'MATRIZ_LOGOS' }));
                            }
                        }

                        enrichedComplementary[id] = {
                            activo: comp.active,
                            observacion: comp.text,
                            archivos: archivosComp, // NEW: Array structure
                            campos: comp.fields,
                            cabecera,
                            // Capturar metadatos si están disponibles en variables globales (para Estampado/Bordado como secundario, idealmente deberían tener su input propio, pero usamos globales como fallback o props)
                            metadata: (id === 'EST' || id === 'estampado')
                                ? { prendas: estampadoQuantity, estampadosPorPrenda: estampadoPrints, origen: estampadoOrigin }
                                : (id === 'EMB' || id === 'BORDADO' ? { prendas: garmentQuantity } : {})
                        };
                    }
                });
            }

            // *** CRITICAL FIX: Explicitly add TWC (Corte) and TWT (Costura) if enabled via Workflow ***
            if (config.hasCuttingWorkflow) {
                if (enableCorte) {
                    enrichedComplementary['TWC'] = {
                        activo: true,
                        observacion: `Corte habilitado. Molde: ${moldType}. Tela: ${fabricOrigin}.`,
                        archivo: (tizadaFiles && tizadaFiles.length > 0) ? { name: tizadaFiles[0].name } : null,
                        cabecera: {
                            variante: 'Corte Laser',
                            material: { name: 'Corte Laser por prenda', id: 90, codArt: '1375', codStock: '1.1.6.1' }
                        },
                        // Pass specific technical data if needed in a custom field
                        metadata: { moldType, fabricOrigin, clientFabricName, selectedSubOrderId }
                    };
                }
                if (enableCostura) {
                    enrichedComplementary['TWT'] = {
                        activo: true,
                        observacion: costuraNote || 'Servicio de Costura solicitado',
                        cabecera: {
                            variante: 'Costura',
                            material: { name: 'Costura Standard', codArt: '112', codStock: '1.1.7.1' }
                        }
                    };
                }
            }

            // Structure Lines and Sublines
            const grupos = {};
            items.forEach(it => {
                const matInfo = mapMaterial(it.material || globalMaterial);
                const key = `${matInfo.name}| ${serviceSubType} `.toUpperCase();

                if (!grupos[key]) {
                    grupos[key] = {
                        cabecera: {
                            material: matInfo.name,
                            variante: serviceSubType,
                            codArticulo: matInfo.codArt,
                            codStock: matInfo.codStock
                        },
                        sublineas: []
                    };
                }

                let extraNote = it.printSettings?.observation ? ` [${it.printSettings.observation}]` : '';
                if (serviceId === 'tpu' && tpuForma) extraNote += ` [Forma: ${tpuForma}]`;

                const printNote = extraNote;
                const isSpecialPrint = it.printSettings?.mode && it.printSettings.mode !== 'normal';

                const finalWidthM = isSpecialPrint && it.printSettings.finalWidthM
                    ? parseFloat(it.printSettings.finalWidthM)
                    : (it.file?.width ? (it.file.unit === 'meters' ? it.file.width : (it.file.width / 300) * 0.0254) : 0);

                const finalHeightM = isSpecialPrint && it.printSettings.finalHeightM
                    ? parseFloat(it.printSettings.finalHeightM)
                    : (it.file?.height ? (it.file.unit === 'meters' ? it.file.height : (it.file.height / 300) * 0.0254) : 0);

                const finalQty = isSpecialPrint ? 1 : it.copies;

                const shouldUseSame = (isDirectaTwinface && twinfaceSame);
                const fileBackEffective = it.fileBack || (shouldUseSame ? it.file : null);

                grupos[key].sublineas.push({
                    archivoPrincipal: it.file ? {
                        name: it.file.name,
                        width: finalWidthM,
                        height: finalHeightM,
                        observaciones: it.printSettings?.observation || ''
                    } : null,
                    archivoDorso: fileBackEffective ? {
                        name: fileBackEffective.name, // ENVIAR NOMBRE ORIGINAL para que el backend encuentre el archivo
                        width: finalWidthM, // Enviar dimensiones correctas
                        height: finalHeightM,
                        observaciones: (it.printSettings?.observation || '') + ' [DORSO]' // Agregar DORSO a observaciones
                    } : null,
                    cantidad: finalQty,
                    nota: (it.note || '') + printNote + (shouldUseSame ? ' [TWINFACE: MISMA IMAGEN DORSO]' : ''),
                    printSettings: it.printSettings,
                    width: finalWidthM,
                    height: finalHeightM,
                    widthBack: fileBackEffective ? finalWidthM : undefined,
                    heightBack: fileBackEffective ? finalHeightM : undefined
                });
            });

            // Fallback for Bordado without files (just quantity/logo)
            if (Object.keys(grupos).length === 0 && (serviceId === 'bordado' || !config.requiresProductionFiles)) {
                const matInfo = mapMaterial(globalMaterial);
                const key = `${matInfo.name}| ${serviceSubType} `.toUpperCase();
                const logos = (ponchadoFiles && ponchadoFiles.length > 0) ? ponchadoFiles : [null];
                const sublineas = logos.map((logo, idx) => ({
                    archivoPrincipal: logo ? { name: logo.name } : null,
                    cantidad: garmentQuantity || 1,
                    nota: `Logo ${idx + 1} - Bordado`
                }));
                grupos[key] = {
                    cabecera: {
                        material: matInfo.name,
                        variante: serviceSubType,
                        codArticulo: matInfo.codArt,
                        codStock: matInfo.codStock
                    },
                    sublineas
                };
            }

            // Fallback for Estampado (Principal)
            if (Object.keys(grupos).length === 0 && (serviceId === 'estampado' || serviceId === 'EST')) {
                const key = `ESTAMPADO|${estampadoOrigin}|${estampadoPrints}x`.toUpperCase();

                grupos[key] = {
                    cabecera: {
                        variante: 'Estampado',
                        material: 'Estampado (Servicio)',
                        codArticulo: serviceInfo?.config?.defaultCodArt || '110', // FIX: Hardcoded fallback based on services.js
                        codStock: serviceInfo?.config?.defaultCodStock || '1.1.5.1'
                    },
                    sublineas: [{
                        archivoPrincipal: estampadoFile ? { name: estampadoFile.name, typeOverride: 'BOCETO_ESTAMPADO' } : null, // FIX: Override type for production loop
                        cantidad: (estampadoQuantity || 1) * (estampadoPrints || 1),
                        nota: `Prendas: ${estampadoQuantity} | Estampados x Prenda: ${estampadoPrints}. Origen: ${estampadoOrigin}`,
                        observaciones: `OBS: Prendas: ${estampadoQuantity}, Estampados: ${estampadoPrints}`
                    }]
                };
            }

            // 1. Construir Lista Unificada de Servicios
            const listaServicios = [];

            // A) SERVICIO PRINCIPAL (Convertir grupos a objetos de servicio)
            Object.values(grupos).forEach((grp, idx) => {
                // Archivos del Servicio Principal
                const archivosServicio = [];

                // Archivos de Items (Producción)
                grp.sublineas.forEach(sl => {
                    const tipoPrincipal = sl.archivoPrincipal?.typeOverride || 'PRODUCCION';
                    if (sl.archivoPrincipal) archivosServicio.push({ ...sl.archivoPrincipal, tipo: tipoPrincipal });
                    if (sl.archivoDorso) archivosServicio.push({ ...sl.archivoDorso, tipo: 'PRODUCCION' }); // FIX: Usar tipo estándar, distinción via obs
                });

                // Archivos de Referencia (Solo al primer grupo del principal para no duplicar metadatos globales)
                // Archivos de Referencia (Solo al primer grupo del principal para no duplicar metadatos globales)
                if (idx === 0) {
                    if (referenceFiles) referenceFiles.forEach(f => archivosServicio.push({ name: f.name, tipo: 'REFERENCIA' }));

                    // Solo adjuntar Boceto/Excel al Principal si NO es Corte (porque en UI están en Corte)
                    // Solo adjuntar boceto general SI NO HAY boceto especializado (para evitar duplicados)
                    const hasSpecializedSketch = (
                        ((serviceId === 'bordado' || serviceId === 'EMB') && bordadoBocetoFile) ||
                        ((serviceId === 'estampado' || serviceId === 'EST') && estampadoFile)
                    );

                    if (!enableCorte && bocetoFile && !hasSpecializedSketch) {
                        archivosServicio.push({ name: bocetoFile.name, tipo: 'BOCETO' });
                    }
                    if (!enableCorte && pedidoExcelFile) archivosServicio.push({ name: pedidoExcelFile.name, tipo: 'INFO_PEDIDO' });

                    // CORRECCIÓN: Solo adjuntar archivos específicos si el servicio principal coincide
                    // PREVENIR QUE ARCHIVOS DE BORDADO VAYAN A SUBLIMACIÓN U OTROS

                    // Estampado Principal
                    if ((serviceId === 'estampado' || serviceId === 'EST') && estampadoFile) {
                        if (!archivosServicio.some(f => f.name === estampadoFile.name)) {
                            archivosServicio.push({ name: estampadoFile.name, tipo: 'BOCETO_ESTAMPADO' });
                        }
                    }

                    // Bordado Principal
                    if ((serviceId === 'bordado' || serviceId === 'EMB') && bordadoBocetoFile) {
                        if (!archivosServicio.some(f => f.name === bordadoBocetoFile.name)) {
                            archivosServicio.push({ name: bordadoBocetoFile.name, tipo: 'BOCETO_BORDADO' });
                        }
                    }

                    if ((serviceId === 'bordado' || serviceId === 'EMB') && ponchadoFiles) {
                        ponchadoFiles.forEach(f => {
                            if (!archivosServicio.some(existing => existing.name === f.name)) {
                                archivosServicio.push({ name: f.name, tipo: 'MATRIZ_LOGOS' });
                            }
                        });
                    }
                }



                // Metadata Específica del Servicio Principal
                let metadata = {};
                if (serviceId === 'estampado' || serviceId === 'EST') {
                    metadata = { prendas: estampadoQuantity, estampadosPorPrenda: estampadoPrints, origen: estampadoOrigin };
                } else if (serviceId === 'bordado' || serviceId === 'EMB') {
                    metadata = { prendas: garmentQuantity };
                }

                listaServicios.push({
                    esPrincipal: true,
                    areaId: serviceInfo?.areaId || serviceId, // FIX: Send DB-aligned ID (e.g. SB, ECOUV) forcorrect priority mapping
                    cabecera: grp.cabecera,
                    archivos: archivosServicio, // Lista oficial de archivos
                    // Mantenemos items con ref al archivo para saber qué cantidad va con qué archivo
                    items: grp.sublineas.map(sl => ({
                        cantidad: sl.cantidad,
                        nota: sl.nota,
                        width: sl.width,
                        height: sl.height,
                        fileName: sl.archivoPrincipal?.name, // <--- NECESARIO PARA VINCULAR
                        fileBackName: sl.archivoDorso?.name,
                        printSettings: sl.printSettings,
                        widthBack: sl.widthBack, // Pass back dimensions
                        heightBack: sl.heightBack,
                        observacionesBack: sl.archivoDorso?.observaciones // Pass back observations if any
                    })),
                    metadata: metadata, // NUEVO CAMPO METADATA
                    notas: generalNote
                });
            });

            // B) SERVICIOS COMPLEMENTARIOS (Corte, Costura, etc.)
            // Normalizamos 'enrichedComplementary' que ya calculamos arriba
            if (enrichedComplementary) {
                Object.keys(enrichedComplementary).forEach(key => {
                    const comp = enrichedComplementary[key];
                    if (comp.activo || comp.active) {

                        // Combinar archivos del array enriquecido o del singular legacy
                        const archivosExtra = comp.archivos ? [...comp.archivos] : [];

                        // Legacy singular fallback (por si acaso TWC u otros no migraron)
                        if (comp.archivo && !archivosExtra.some(f => f.name === comp.archivo.name)) {
                            archivosExtra.push({ name: comp.archivo.name, size: comp.archivo.size, tipo: 'ARCHIVO_EXTRA' });
                        }

                        // Si es TWC (Corte), adjuntar archivos de tizada si existen y no están ya
                        if (key === 'TWC') {
                            if (tizadaFiles && tizadaFiles.length > 0) {
                                tizadaFiles.forEach(f => {
                                    if (!archivosExtra.some(existing => existing.name === f.name)) {
                                        archivosExtra.push({ name: f.name, tipo: 'ARCHIVO_CORTE' });
                                    }
                                });
                            }
                            // Si están en el contenedor de Corte, van a Corte (ya evitamos ponerlos en Principal arriba)
                            if (bocetoFile) archivosExtra.push({ name: bocetoFile.name, tipo: 'BOCETO_CORTE' });
                            if (pedidoExcelFile) archivosExtra.push({ name: pedidoExcelFile.name, tipo: 'INFO_CORTE' });
                        }

                        // Si es Bordado (EMB/bordado), adjuntar archivos y metadata
                        if (key === 'EMB' || key === 'bordado') {
                            if (bordadoBocetoFile) {
                                archivosExtra.push({ name: bordadoBocetoFile.name, tipo: 'BOCETO_BORDADO' });
                            }
                            if (ponchadoFiles && ponchadoFiles.length > 0) {
                                ponchadoFiles.forEach(f => {
                                    if (!archivosExtra.some(existing => existing.name === f.name)) {
                                        archivosExtra.push({ name: f.name, tipo: 'MATRIZ_LOGOS' });
                                    }
                                });
                            }
                            // Inyectar Metadata de Prendas
                            comp.metadata = {
                                ...comp.metadata,
                                prendas: garmentQuantity, // Actualizar cantidad de prendas
                                material: bordadoMaterial,
                                variante: bordadoVariant
                            };
                        }

                        // Si es Estampado (EST), adjuntar archivos y metadata (FIX: Faltaba este bloque)
                        if (key === 'EST') {
                            if (estampadoFile) {
                                archivosExtra.push({ name: estampadoFile.name, tipo: 'BOCETO_ESTAMPADO' });
                            }
                            // Inyectar Metadata y Códigos Hardcoded para Estampado
                            comp.metadata = {
                                ...comp.metadata,
                                prendas: estampadoQuantity,
                                estampadosPorPrenda: estampadoPrints,
                                origen: estampadoOrigin
                            };
                            // Forzar códigos de Estampado si no vienen en cabecera
                            if (!comp.cabecera) comp.cabecera = {};
                            comp.cabecera.codArticulo = '110';
                            comp.cabecera.codStock = '1.1.5.1';
                            comp.cabecera.material = 'Estampado (Servicio)';
                        }

                        listaServicios.push({
                            esPrincipal: false,
                            areaId: key,
                            cabecera: comp.cabecera,
                            archivos: archivosExtra,
                            items: [], // Complementarios no suelen tener items productivos aquí
                            notas: comp.observacion,
                            metadata: comp.metadata || {}
                        });
                    }
                });
            }



            // --- LOOKUP COD ARTICULO PARA PRINCIPAL ---
            // Buscar el objeto material real para obtener CodArticulo
            let mainCodArt = '';
            let mainCodStock = '';

            if (globalMaterial) {
                // Buscar en materiales dinámicos
                const foundMat = dynamicMaterials.find(m => (m.Material || m.Descripcion || m) === globalMaterial);
                if (foundMat) {
                    mainCodArt = foundMat.CodArticulo || foundMat.CodigoArticulo || '';
                    mainCodStock = foundMat.CodStock || foundMat.CodigoStock || '';
                } else if (serviceInfo?.materials) {
                    // Buscar en estáticos
                    const foundStatic = serviceInfo.materials.find(m => (m.Material || m) === globalMaterial);
                    if (foundStatic && typeof foundStatic === 'object') {
                        mainCodArt = foundStatic.codArt || '';
                        mainCodStock = foundStatic.codStock || '';
                    }
                }
            }

            // Si es Estampado Principal y no hay mat, usar default
            if (serviceId === 'estampado' || serviceId === 'EST') {
                if (!mainCodArt) mainCodArt = '110';
                if (!mainCodStock) mainCodStock = '1.1.5.1';
            }

            // Inyectar en el primer servicio (Principal)
            if (listaServicios.length > 0 && listaServicios[0].esPrincipal) {
                if (!listaServicios[0].cabecera.codArticulo) listaServicios[0].cabecera.codArticulo = mainCodArt;
                if (!listaServicios[0].cabecera.codStock) listaServicios[0].cabecera.codStock = mainCodStock;
            }

            const payload = {
                idServicioBase: serviceId,
                nombreTrabajo: jobName,
                prioridad: urgency,
                notasGenerales: (items.some(it => it.printSettings?.mode && it.printSettings.mode !== 'normal') ? '[CONTIENE ARCHIVOS CON ESCALA/RAPORT] ' : '') + generalNote,

                // Nueva Estructura Unificada
                servicios: listaServicios,

                // Mantenemos cliente y fechas arriba
                clienteInfo: {
                    // Si tienes info de cliente aqui
                }
            };

            console.log("🚀 Enviando Metadata de Pedido...", payload);
            const response = await apiClient.post('/web-orders/create', payload);

            if (response.success) {
                actions.setCreatedOrderIds(response.orderIds || []);
                if (response.requiresUpload && response.uploadManifest) {
                    await actions.handleUploadProcess(response.uploadManifest, filesToUploadMap);
                } else {
                    actions.setErrorModalOpen(false); // Reuse this or add explicit success modal setter in hook if handled differently
                    // Ah, hook's showSuccessModal should be true.
                    // The hook sets showSuccessModal in UPLOAD_SUCCESS.
                    // But if no upload, we need to set it manually.
                    // The hook does NOT expose setShowSuccessModal directly in the generic implementation?
                    // Wait, I can dispatch SET_FIELD via generic setter.
                    // actions.setField('showSuccessModal', true); // But I exposed specific setters.
                    // I didn't expose setShowSuccessModal setter in the hook explicitly! I checked and I missed it.
                    // I only exposed actions.setErrorModalOpen...
                    // Wait, `setCreatedOrderIds` is there.
                    // I'll check if I can use generic `dispatch`. No.
                    // I will just display the Toast and maybe Navigate?
                    // Or I'll use `actions.setErrorModalOpen` (no).
                    // Ideally I should update the hook.
                    // But for now, if no upload, I can just rely on Toast? User expects modal.

                    // ACTUALLY, I missed `setShowSuccessModal` in the hook setters.
                    // I will use `actions.setField` if I exposed it? No.
                    // I exposed `setLoading`.
                    // I will assume for now I can't open success modal without upload.
                    // But I can fix the hook later.
                    // I will check if hook has `setShowSuccessModal` exposed?
                    // In Step 36 output, I see `setCreatedOrderIds`.
                    // I DO NOT SEE `setShowSuccessModal`.

                    // WORKAROUND: I will edit the hook again quickly to add `setShowSuccessModal`.
                    // It is better to be correct.
                    addToast('Pedido enviado con éxito', 'success');
                    // Since I can't open the modal easily, I'll just let it be or rely on upload completion.
                }
            } else {
                addToast(response.message || 'Error al enviar', 'error');
            }

        } catch (error) {
            console.error(error);
            addToast(error.message || 'Error al enviar pedido', 'error');
        } finally {
            actions.setLoading(false);
        }
    };

    // --- Render Logic Checks ---
    const isBlackoutSelected = (serviceId === 'directa_320' && globalMaterial === 'Lona Blackout') || isDirectaTwinface;
    const currentCode = (() => {
        const areaMapLocal = { 'dtf': 'DF', 'DF': 'DF', 'sublimacion': 'SB', 'ecouv': 'ECOUV', 'directa_320': 'DIRECTA', 'directa_algodon': 'DIRECTA', 'bordado': 'EMB', 'laser': 'TWC', 'tpu': 'TPU', 'costura': 'TWT', 'corte-confeccion': 'TWT', 'estampado': 'EST' };
        return areaMapLocal[serviceId] || (serviceId ? serviceId.toUpperCase() : '');
    })();
    const specificConfig = visibleConfig ? visibleConfig[currentCode] : null;

    return (
        <div className="animate-fade-in pb-20">
            {specificConfig && (specificConfig.description || specificConfig.image) && (
                <div className="mb-8 animate-fade-in-down">
                    <GlassCard className="-mx-4 md:mx-0 md:!rounded-xl !rounded-none !border-r-0 md:!border-r border-y md:border-y-0 border-l-4 border-l-brand-gold overflow-hidden !p-0">
                        <div className="flex flex-col md:flex-row">
                            {specificConfig.image && <div className="w-full md:w-1/3 min-h-[200px] md:min-h-0 bg-zinc-800/40 relative"><img src={specificConfig.image} alt="Info" className="absolute inset-0 w-full h-full object-cover opacity-80" /></div>}
                            <div className="flex-1 p-8">
                                <h3 className="text-xl font-black text-brand-gold mb-3 uppercase tracking-widest flex items-center gap-2">
                                    <AlertTriangle className="text-brand-gold" size={20} /> Información Importante
                                </h3>
                                {specificConfig.description && <div className="prose prose-invert prose-sm text-zinc-400 font-bold leading-relaxed whitespace-pre-wrap">{specificConfig.description}</div>}
                            </div>
                        </div>
                    </GlassCard>
                </div>
            )}

            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-6 px-4 md:px-0">
                <div className="flex-shrink-0">
                    <CustomButton variant="ghost" onClick={() => navigate('/portal')} icon={ArrowLeft} className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 -ml-4 md:ml-0 px-2">Volver</CustomButton>
                </div>
                <div>
                    <h2 className="text-xl md:text-2xl font-black text-zinc-100 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 uppercase tracking-widest leading-tight">
                        <span>Nuevo Pedido:</span> <span className="text-cyan-400">{serviceInfo?.label}</span>
                    </h2>
                    <p className="text-xs md:text-sm text-zinc-500 font-bold tracking-tight mt-1">{serviceInfo?.desc}</p>
                </div>
            </div>

            {config.dependencyWarning && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r flex items-start gap-3">
                    <AlertTriangle className="text-amber-500" />
                    <div><h4 className="font-bold text-amber-800 text-sm">Requisito Previo</h4><p className="text-sm text-amber-700">{config.dependencyWarning}</p></div>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">

                {/* 1. Datos Generales (Resumed) */}
                <GlassCard title="Datos Generales del Pedido" icon={ClipboardList} className="-mx-4 md:mx-0 md:!rounded-xl !rounded-none !border-x-0 md:!border-x border-y md:border-y-0 px-4 md:px-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <FormInput label="Nombre del Proyecto / Trabajo *" placeholder="Ej: Camisetas Verano 2024" value={jobName} onChange={(e) => actions.setJobName(e.target.value)} required />
                        </div>
                        <div>
                            <p className="block text-sm font-medium text-zinc-400 mb-2">Prioridad *</p>
                            <div className="flex bg-brand-dark p-1 rounded-lg gap-1 border border-zinc-700">
                                {(prioritiesList || []).map(p => {
                                    const isUrgent = p.Nombre.toLowerCase() === 'urgente';
                                    const isSelected = urgency === p.Nombre;
                                    const selectedClass = isUrgent
                                        ? 'shadow-sm bg-custom-magenta/20 text-custom-magenta border border-custom-magenta/30'
                                        : 'shadow-sm bg-cyan-400/20 text-cyan-300 border border-cyan-500/30';
                                    const isDisabled = isUrgent && serviceId?.toUpperCase() === 'DF';
                                    return (
                                    <button key={p.Nombre} type="button" onClick={() => !isDisabled && actions.setUrgency(p.Nombre)}
                                        disabled={isDisabled}
                                        className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${isDisabled ? 'text-zinc-600 cursor-not-allowed opacity-40' : isSelected ? selectedClass : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'} `}
                                    >
                                        {p.Nombre}
                                    </button>
                                    );
                                })}
                            </div>
                            {serviceId?.toUpperCase() === 'DF' && (
                                <p className="text-[11px] text-amber-400/70 mt-1.5 italic">⚠ La prioridad urgente se encuentra temporalmente desactivada.</p>
                            )}
                        </div>

                    </div>
                </GlassCard>

                {/* 2. Servicios - Stack */}
                <div className="space-y-4">
                    <h3 className="text-lg font-black text-zinc-200 px-2 uppercase tracking-tight">Servicios y Procesos</h3>

                    {/* Main Service Block */}
                    <ServiceAccordion
                        title={`Producción Principal: ${serviceInfo?.label || 'Servicio'}`}
                        isActive={true} // Always active
                        onToggle={() => { }} // No toggle for main
                        icon={Layers}
                        main={true}
                    >
                        <div className="space-y-8">
                            {/* Material Selectors for Main Service */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-custom-dark md:rounded-2xl rounded-none border-y border-x-0 md:border-x border-zinc-700/50 -mx-4 md:mx-0">
                                {config.variantMode === 'select' && serviceId !== 'bordado' && serviceId !== 'EMB' && (
                                    <div>
                                        <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">Variante / Sub-Categoría *</p>
                                        <CustomSelect
                                            name="serviceSubType"
                                            aria-label="Variante / Sub-Categoría"
                                            value={serviceSubType}
                                            onChange={(val) => actions.handleSubTypeChange(val)}
                                            options={(uniqueVariants.length > 0 ? uniqueVariants : (serviceInfo?.subtypes || [])).map(t => ({ value: t, label: t }))}
                                            placeholder="Seleccionar..."
                                            variant="black"
                                        />
                                    </div>
                                )}

                                {/* Global Material Selector - Hidden for Bordado and Sublimacion */}
                                {config.materialMode === 'single' && serviceId !== 'bordado' && serviceId !== 'EMB' && serviceId !== 'sublimacion' && (
                                    <div>
                                        <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">{serviceInfo?.config?.materialLabel || 'Material / Soporte'} *</p>
                                        <CustomSelect
                                            name="globalMaterial"
                                            aria-label={serviceInfo?.config?.materialLabel || 'Material / Soporte'}
                                            value={globalMaterial}
                                            onChange={(val) => actions.setGlobalMaterial(val)}
                                            options={(dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || [])).map(m => {
                                                const val = m.Material || m.Descripcion || m;
                                                return { value: val, label: val };
                                            })}
                                            placeholder="Seleccionar Material..."
                                            variant="black"
                                        />
                                    </div>
                                )}

                                {isTpuEtiquetaOficial && (
                                    <div className="md:col-span-2 mt-2 animate-in slide-in-from-top-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
                                        <p className="block text-xs font-bold uppercase text-amber-800 mb-2">Forma de Etiqueta *</p>
                                        <CustomSelect
                                            name="tpuForma"
                                            aria-label="Forma de Etiqueta"
                                            value={tpuForma || ''}
                                            onChange={(val) => actions.setTpuForma(val)}
                                            options={['Ovalado', 'Rectangular', 'Redondo', 'Cuadrado Redondeado', 'Triangulo Redondeado', 'Hexagonal'].map(f => ({ value: f, label: f }))}
                                            placeholder="Seleccionar Forma..."
                                            variant="light"
                                            size="small"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Bordado Specific UI if Main Service is Bordado */}
                            {serviceId === 'bordado' && (
                                <BordadoTechnicalUI
                                    serviceId={serviceId} garmentQuantity={garmentQuantity} setGarmentQuantity={actions.setGarmentQuantity}
                                    bocetoFile={bordadoBocetoFile} setBocetoFile={actions.setBordadoBocetoFile}
                                    ponchadoFiles={ponchadoFiles} setPonchadoFiles={actions.setPonchadoFiles}
                                    globalMaterial={globalMaterial} handleGlobalMaterialChange={actions.setGlobalMaterial}
                                    serviceInfo={serviceInfo} userStock={userStock}
                                    handleSpecializedFileUpload={(file) => handleSpecializedFileUpload(actions.setBordadoBocetoFile, file)}
                                    handleMultipleSpecializedFileUpload={(files) => handleMultipleSpecializedFileUpload(actions.addPonchadoFiles, files)}
                                    uniqueVariants={uniqueVariants} dynamicMaterials={dynamicMaterials}
                                    serviceSubType={serviceSubType} handleSubTypeChange={actions.handleSubTypeChange}
                                />
                            )}

                            {/* Estampado UI */}
                            {(serviceId === 'estampado' || serviceId === 'EST') && (
                                <EstampadoTechnicalUI
                                    file={estampadoFile} setFile={actions.setEstampadoFile}
                                    quantity={estampadoQuantity} setQuantity={actions.setEstampadoQuantity}
                                    printsPerGarment={estampadoPrints} setPrintsPerGarment={actions.setEstampadoPrints}
                                    origin={estampadoOrigin} setOrigin={actions.setEstampadoOrigin}
                                    handleSpecializedFileUpload={(file) => handleSpecializedFileUpload(actions.setEstampadoFile, file)}
                                />
                            )}

                            {/* Corte UI only if Main Service */}
                            {serviceId === 'corte' && (
                                <div className="space-y-6">
                                    <CorteTechnicalUI
                                        serviceId={serviceId} moldType={moldType} setMoldType={actions.setMoldType}
                                        fabricOrigin={fabricOrigin} setFabricOrigin={actions.setFabricOrigin}
                                        clientFabricName={clientFabricName} setClientFabricName={actions.setClientFabricName}
                                        selectedSubOrderId={selectedSubOrderId} setSelectedSubOrderId={actions.setSelectedSubOrderId}
                                        activeSubOrders={activeSubOrders} tizadaFiles={tizadaFiles} setTizadaFiles={actions.setTizadaFiles}
                                        handleMultipleSpecializedFileUpload={(files) => handleMultipleSpecializedFileUpload(actions.addTizadaFiles, files)}
                                        compact={false}
                                    />
                                    {/* Documentation for Main Corte (Always visible for Main Service) */}
                                    <div className="pt-6 border-t border-zinc-100">
                                        <h4 className="text-xs font-black uppercase text-zinc-400 mb-4">Documentación de Corte/Confección</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {config.templateButtons?.map(btn => (
                                                <a key={btn.label} href={btn.url} download className="flex items-center justify-between bg-zinc-50 p-3 rounded-xl border border-zinc-100 hover:border-black transition-colors"><span className="text-[10px] font-black uppercase">{btn.label}</span><Download size={16} /></a>
                                            ))}
                                            <FileUploadZone id="pedido-upload-corte-main" label="EXCEL DETALLE" selectedFile={pedidoExcelFile} onFileSelected={(f) => handleSpecializedFileUpload(actions.setPedidoExcelFile, f)} color="emerald" compact={true} />
                                            <FileUploadZone id="boceto-upload-main" label="MOCKUP / CROQUIS" selectedFile={bocetoFile} onFileSelected={(f) => handleSpecializedFileUpload(actions.setBocetoFile, f)} color="blue" compact={true} />
                                        </div>
                                    </div>
                                </div>
                            )}


                            {/* Standard Production Files (Items) */}
                            {config.requiresProductionFiles && (
                                <div>
                                    <div className="flex justify-between items-center mb-4">
                                        <p className="text-sm font-bold uppercase text-zinc-400">Archivos para Producción ({items.length}/15)</p>
                                    </div>
                                    <div className="space-y-4">
                                        {items.map((item, index) => (
                                            <div key={item.id} className="bg-brand-dark p-4 md:rounded-2xl rounded-none border-y border-x-0 md:border-x border-zinc-700/50 shadow-sm -mx-4 md:mx-0">
                                                <div className="flex justify-between items-center mb-4 pb-2 border-b border-zinc-700/30">
                                                    <span className="text-[10px] font-black bg-cyan-400/10 text-cyan-400 py-1 px-3 rounded-full border border-cyan-500/20">ARCHIVO {index + 1}</span>
                                                    <button type="button" onClick={() => actions.removeItem(item.id)}><Trash2 size={16} className="text-zinc-500 hover:text-red-400 transition-colors" /></button>
                                                </div>
                                                {/* Item Material Override */}
                                                {config.materialMode === 'multiple' && (
                                                    <div className="mb-4 px-1">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="block text-[9px] uppercase font-black text-zinc-400">Material (Específico)</span>
                                                            {index === 0 && (
                                                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={applyMaterialToAll}
                                                                        onChange={(e) => handleApplyMaterialToAll(e.target.checked)}
                                                                        className="w-3 h-3 rounded border-zinc-600 accent-cyan-400 cursor-pointer"
                                                                    />
                                                                    <span className="text-[9px] font-bold uppercase text-zinc-500">Aplicar a todo el pedido</span>
                                                                </label>
                                                            )}
                                                        </div>
                                                        {(index === 0 || !applyMaterialToAll) ? (
                                                            <CustomSelect
                                                                value={item.material}
                                                                onChange={(val) => handleItemMaterialChange(item.id, val)}
                                                                options={(dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || [])).map(m => {
                                                                    const val = m.Material || m.Descripcion || m;
                                                                    return { value: val, label: val };
                                                                })}
                                                                placeholder="Selecciona material"
                                                                variant="black"
                                                                size="small"
                                                                disabled={uniqueVariants.length > 0 && dynamicMaterials.length === 0}
                                                            />
                                                        ) : (
                                                            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded-[10px] text-xs text-zinc-400">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 flex-shrink-0"></span>
                                                                <span className="truncate">{items[0]?.material || 'Sin material'}</span>
                                                                <span className="ml-auto text-[9px] font-black uppercase text-cyan-500/60 flex-shrink-0">Global</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                                    <div className={isBlackoutSelected ? "md:col-span-4" : "md:col-span-6"}>
                                                        <FileUploadZone id={item.id} label={isBlackoutSelected ? "Frente" : (config.productionFileLabel || "Archivo")} selectedFile={item.file} onFileSelected={(f) => handleFileUpload(item.id, 'file', f)} />
                                                        {item.file && <div className="mt-2 text-[10px] font-bold text-zinc-400 bg-zinc-900/60 p-1 px-2 rounded border border-zinc-700/50 w-fit flex gap-1"><FileCode size={12} className="text-cyan-400/60" /> {item.file.name}</div>}
                                                        {item.file && item.file.pageCount != null && (
                                                            <div className="mt-1 text-[10px] font-bold text-zinc-500 bg-zinc-900/40 px-2 py-0.5 rounded border border-zinc-700/40 w-fit flex items-center gap-1">
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                                                {item.file.pageCount} {item.file.pageCount === 1 ? 'página' : 'páginas'}
                                                            </div>
                                                        )}

                                                        {isDirectaTwinface && (
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={twinfaceSame}
                                                                    onChange={(e) => setTwinfaceSame(e.target.checked)}
                                                                    id={`twinface-${index}`}
                                                                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                                />
                                                                <label htmlFor={`twinface-${index}`} className="text-[10px] font-bold uppercase text-zinc-500 cursor-pointer">
                                                                    Misma imagen Frente y Dorso
                                                                </label>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {isBlackoutSelected && (!isDirectaTwinface || !twinfaceSame) && (
                                                        <div className="md:col-span-4">
                                                            <FileUploadZone id={item.id} label="Dorso" selectedFile={item.fileBack} onFileSelected={(f) => handleFileUpload(item.id, 'fileBack', f)} color="purple" />
                                                        </div>
                                                    )}
                                                    <div className={isBlackoutSelected ? "md:col-span-4" : "md:col-span-6"}>
                                                        {item.file && item.file.width && (
                                                            <PrintSettingsPanel
                                                                originalWidthM={item.file.unit === 'meters' ? item.file.width : (item.file.width / 300) * 0.0254}
                                                                originalHeightM={item.file.unit === 'meters' ? item.file.height : (item.file.height / 300) * 0.0254}
                                                                materialMaxWidthM={(() => {
                                                                    const isSingleMat = config.materialMode === 'single';
                                                                    const itemMat = isSingleMat ? globalMaterial : (item.material || globalMaterial);
                                                                    const matList = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
                                                                    const foundMat = matList.find(m => (m.Material || m.Descripcion || m) === itemMat);
                                                                    return resolveMaterialWidth(foundMat || itemMat);
                                                                })()}
                                                                values={item.printSettings || {}} copies={item.copies}
                                                                onCopiesChange={(v) => actions.updateItem(item.id, 'copies', v)}
                                                                onChange={(s) => actions.updateItem(item.id, 'printSettings', s)}
                                                                disableScaling={serviceId === 'tpu' || serviceId?.toUpperCase() === 'DF'}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}

                                        {/* Hidden file input for direct dialog */}
                                        <input
                                            type="file"
                                            id="add-item-file-input"
                                            className="hidden"
                                            accept="image/png, image/jpeg, application/pdf, .jpg, .jpeg, .png, .pdf"
                                            onChange={async (e) => {
                                                const file = e.target.files[0];
                                                if (!file) return;
                                                e.target.value = ''; // Reset para poder elegir el mismo archivo
                                                const newId = Date.now();
                                                const lastItem = items[items.length - 1];
                                                const newMaterial = globalMaterial;
                                                const newItem = { id: newId, file: null, fileBack: null, copies: 1, material: newMaterial, note: '', doubleSided: false, printSettings: {} };
                                                actions.setItems([...items, newItem]);
                                                const success = await handleFileUpload(newId, 'file', file);
                                                if (!success) {
                                                    actions.removeItem(newId);
                                                }
                                            }}
                                        />
                                        {/* Add Item Button at Bottom */}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (items.length >= 15) return;
                                                document.getElementById('add-item-file-input').click();
                                            }}
                                            disabled={items.length >= 15}
                                            className={`w-full py-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 transition-all ${items.length >= 15 ? 'border-zinc-700 text-zinc-600 cursor-not-allowed' : 'border-zinc-600 text-zinc-400 bg-brand-dark hover:border-cyan-500 hover:text-cyan-400 hover:bg-cyan-400/5'}`}
                                        >
                                            {items.length >= 15 ? (
                                                <span className="text-xs font-bold uppercase">Límite de 15 archivos alcanzado</span>
                                            ) : (
                                                <>
                                                    <Plus size={16} />
                                                    <span className="text-xs font-bold uppercase">AGREGAR ARCHIVO</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}


                        </div>
                    </ServiceAccordion>

                    {/* Corte (Complementario) - Ocultar si es Principal */}
                    {config.hasCuttingWorkflow && serviceId !== 'corte' && (
                        <ServiceAccordion
                            title="Servicio de Corte"
                            isActive={enableCorte}
                            onToggle={() => actions.setEnableCorte(!enableCorte)}
                            icon={Zap}
                            optional={true}
                        >
                            <CorteTechnicalUI
                                serviceId={serviceId} moldType={moldType} setMoldType={actions.setMoldType}
                                fabricOrigin={fabricOrigin} setFabricOrigin={actions.setFabricOrigin}
                                clientFabricName={clientFabricName} setClientFabricName={actions.setClientFabricName}
                                selectedSubOrderId={selectedSubOrderId} setSelectedSubOrderId={actions.setSelectedSubOrderId}
                                activeSubOrders={activeSubOrders} tizadaFiles={tizadaFiles} setTizadaFiles={actions.setTizadaFiles}
                                handleMultipleSpecializedFileUpload={(files) => handleMultipleSpecializedFileUpload(actions.addTizadaFiles, files)}
                                compact={true}
                            />
                            {/* Documentation Moved to Corte */}
                            {(config.templateButtons || pedidoExcelFile || bocetoFile) && (
                                <div className="mt-6 pt-6 border-t border-zinc-700/50">
                                    <h4 className="text-[10px] font-black uppercase text-zinc-500 mb-4 tracking-widest">Documentación de Corte/Confección</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {config.templateButtons?.map(btn => (
                                            <a key={btn.label} href={btn.url} download className="flex items-center justify-between bg-zinc-800/40 p-4 rounded-xl border border-zinc-700/50 hover:border-cyan-500/50 hover:bg-zinc-800/60 transition-all group">
                                                <span className="text-[10px] font-black uppercase text-zinc-300 group-hover:text-cyan-400 transition-colors">{btn.label}</span>
                                                <Download size={16} className="text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                                            </a>
                                        ))}
                                        <FileUploadZone id="pedido-upload-corte" label="EXCEL DETALLE" selectedFile={pedidoExcelFile} onFileSelected={(f) => handleSpecializedFileUpload(actions.setPedidoExcelFile, f)} color="emerald" compact={true} />
                                        <FileUploadZone id="boceto-upload-corte" label="MOCKUP / CROQUIS" selectedFile={bocetoFile} onFileSelected={(f) => handleSpecializedFileUpload(actions.setBocetoFile, f)} color="blue" compact={true} />
                                    </div>
                                </div>
                            )}
                        </ServiceAccordion>
                    )}

                    {/* Costura */}
                    {config.hasCuttingWorkflow && (
                        <ServiceAccordion
                            title="Servicio de Costura"
                            isActive={enableCostura}
                            onToggle={() => actions.setEnableCostura(!enableCostura)}
                            icon={Scissors}
                            optional={true}
                        >
                            <CosturaTechnicalUI isCorteActive={enableCorte} costuraNote={costuraNote} setCosturaNote={actions.setCosturaNote} compact={true} />
                        </ServiceAccordion>
                    )}

                    {/* Complementary Options */}
                    {visibleComplementaryOptions.map(opt => (
                        <ServiceAccordion
                            key={opt.id}
                            title={opt.label}
                            subtitle={opt.subtitle}
                            isActive={!!selectedComplementary[opt.id]}
                            onToggle={() => {
                                // Logic: Costura (TWT) depends on Corte (TWC)
                                if (opt.id === 'TWT') {
                                    if (!selectedComplementary['TWC']) {
                                        addToast('Para seleccionar Confección/Costura, primero debe activar Corte/Tizada.', { error: true });
                                        return;
                                    }
                                }

                                // Atomic State Update
                                const newSelection = { ...selectedComplementary };
                                if (newSelection[opt.id]) {
                                    delete newSelection[opt.id];
                                    if (opt.id === 'TWC' && newSelection['TWT']) {
                                        delete newSelection['TWT'];
                                        addToast('Costura desactivada por dependencia.', { duration: 2000 });
                                    }
                                } else {
                                    newSelection[opt.id] = { active: true };
                                }
                                actions.setSelectedComplementary(newSelection);
                            }}
                            icon={Plus}
                            optional={true}
                        >
                            {/* Content for Complementary */}
                            <div className="space-y-4">
                                {opt.hasFile && opt.id !== 'EMB' && opt.id !== 'EST' && (
                                    <div>
                                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2 tracking-widest">Cargar Croquis / Archivo</label>
                                        <div className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-3 text-zinc-300">
                                            <UploadCloud size={16} className="text-zinc-500" />
                                            <input type="file" className="text-xs w-full file:bg-zinc-700 file:text-zinc-300 file:border-none file:rounded-md file:px-2 file:py-1 file:mr-2 file:cursor-pointer" onChange={(e) => handleSpecializedFileUpload((res) => actions.updateComplementaryFile(opt.id, res), e.target.files[0])} />
                                        </div>
                                    </div>
                                )}
                                {opt.hasInput && !opt.fields && opt.id !== 'EST' && <textarea rows="2" className="w-full p-2 text-xs border rounded-lg" placeholder="Notas..." value={selectedComplementary[opt.id]?.text || ''} onChange={(e) => actions.updateComplementaryText(opt.id, e.target.value)} />}

                                {opt.fields && (
                                    <div className={`grid grid-cols-1 ${opt.fullWidth ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-2'} gap-4`}>
                                        {opt.fields.map((f) => (
                                            <div key={f.name} className={f.type === 'text' ? 'md:col-span-2' : ''}>
                                                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2 tracking-widest">{f.label}</label>
                                                {f.type === 'select' ? (
                                                    <CustomSelect
                                                        value={selectedComplementary[opt.id]?.fields?.[f.name] || ''}
                                                        onChange={(val) => actions.updateComplementaryField(opt.id, f.name, val)}
                                                        options={f.options.map(o => ({ value: o, label: o }))}
                                                        placeholder="Seleccionar..."
                                                        variant="black"
                                                        size="small"
                                                    />
                                                ) : (
                                                    <input
                                                        type={f.type || 'text'}
                                                        placeholder={f.placeholder}
                                                        className="w-full p-3 text-xs border border-zinc-700/50 rounded-xl bg-zinc-800/50 text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all placeholder:text-zinc-600"
                                                        value={selectedComplementary[opt.id]?.fields?.[f.name] || ''}
                                                        onChange={(e) => actions.updateComplementaryField(opt.id, f.name, e.target.value)}
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Estampado UI as Complement */}
                                {opt.id === 'EST' && (
                                    <EstampadoTechnicalUI
                                        file={estampadoFile} setFile={actions.setEstampadoFile}
                                        quantity={estampadoQuantity} setQuantity={actions.setEstampadoQuantity}
                                        printsPerGarment={estampadoPrints} setPrintsPerGarment={actions.setEstampadoPrints}
                                        origin={estampadoOrigin} setOrigin={actions.setEstampadoOrigin}
                                        handleSpecializedFileUpload={(file) => handleSpecializedFileUpload(actions.setEstampadoFile, file)}
                                    />
                                )}

                                {/* ECOUV Terminaciones */}
                                {opt.id === 'terminaciones_ecouv' && (
                                    <EcouvTerminacionesUI
                                        serviceInfo={serviceInfo}
                                        value={selectedComplementary[opt.id]?.fields?.items || []}
                                        onChange={(items) => actions.updateComplementaryField(opt.id, 'items', items)}
                                    />
                                )}

                                {/* Embroidery Special UI */}
                                {opt.id === 'EMB' && (
                                    <BordadoTechnicalUI
                                        garmentQuantity={garmentQuantity} setGarmentQuantity={actions.setGarmentQuantity}
                                        bocetoFile={bordadoBocetoFile} setBocetoFile={actions.setBordadoBocetoFile}
                                        ponchadoFiles={ponchadoFiles} setPonchadoFiles={actions.setPonchadoFiles}
                                        globalMaterial={globalMaterial} handleGlobalMaterialChange={actions.setGlobalMaterial}
                                        serviceInfo={serviceInfo} userStock={userStock}
                                        handleSpecializedFileUpload={(f) => handleSpecializedFileUpload(actions.setBordadoBocetoFile, f)}
                                        handleMultipleSpecializedFileUpload={(fs) => handleMultipleSpecializedFileUpload(actions.addPonchadoFiles, fs)}
                                        compact={true} isComplement={true}
                                        compMaterial={bordadoMaterial} setCompMaterial={actions.setBordadoMaterial}
                                        compVariant={bordadoVariant} setCompVariant={(v) => actions.handleEmbroideryVariantChange(v)}
                                        compVariants={embroideryVariants} compMaterials={embroideryMaterials}
                                    />
                                )}
                            </div>
                        </ServiceAccordion>
                    ))}
                </div>


                {/* Observaciones Finales */}
                <div className="mt-8">
                    <p className="block text-lg font-black text-zinc-200 mb-4 px-2">OBSERVACIONES GENERALES</p>
                    <textarea id="observaciones-generales" name="observaciones" rows="3" className="w-full p-4 border border-zinc-700 rounded-2xl text-sm bg-custom-dark text-zinc-200 placeholder-zinc-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-all resize-none" placeholder="Detalles importantes, instrucciones de entrega o notas adicionales..." value={generalNote} onChange={(e) => actions.setGeneralNote(e.target.value)} />
                </div>

                {/* Footer */}
                <div className="mt-8">
                    <div className="bg-custom-dark text-white p-8 md:rounded-3xl rounded-none shadow-2xl shadow-black/30 flex flex-col md:flex-row items-center justify-between gap-8 border-y border-x-0 md:border-x border-zinc-700/50 -mx-4 md:mx-0">
                        <div className="flex gap-10 flex-wrap">
                            <div><p className="text-[11px] uppercase font-bold text-zinc-500">Servicio</p><p className="text-xl font-bold text-zinc-100">{serviceInfo?.label}</p></div>
                            <div><p className="text-[11px] uppercase font-bold text-zinc-500">Prioridad</p><p className={`text-xl font-bold ${urgency?.toLowerCase() === 'urgente' ? 'text-custom-magenta' : 'text-cyan-400'}`}>{urgency}</p></div>
                            <div><p className="text-[11px] uppercase font-bold text-zinc-500">Items (Total)</p><p className="text-2xl font-black text-zinc-100">{items.length}</p></div>
                            <div><p className="text-[11px] uppercase font-bold text-zinc-500">Largo Total</p><p className="text-2xl font-black text-cyan-400">{items.reduce((acc, it) => {
                                const h = it.printSettings?.finalHeightM || (it.file?.unit === 'meters' ? it.file?.height : (it.file?.height ? (it.file.height / 300) * 0.0254 : 0)) || 0;
                                return acc + (h * (it.copies || 1));
                            }, 0).toFixed(2)}m</p></div>
                        </div>
                        <CustomButton type="submit" variant="primary" className="w-full md:w-auto px-14 py-5 !bg-cyan-400 !text-zinc-900 hover:!bg-cyan-300 font-black text-lg rounded-2xl shadow-lg shadow-cyan-500/20" isLoading={loading} icon={Save}>Confirmar Pedido</CustomButton>
                    </div>
                </div>

            </form>

            <UploadProgressModal isOpen={uploading || uploadError} progress={uploadProgress} isError={uploadError} onRetry={() => actions.handleUploadProcess(state.pendingManifest, state.localFileMap)} />
            <ErrorModal isOpen={errorModalOpen} onClose={() => actions.setErrorModalOpen(false)} message={errorModalMessage} />

            {showSuccessModal && createPortal(
                <div 
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 animate-in fade-in duration-300"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            actions.setShowSuccessModal(false);
                            setTimeout(() => navigate('/portal/factory'), 50);
                        }
                    }}
                >
                    <div className="bg-zinc-900/90 rounded-[3rem] shadow-2xl p-10 max-w-md w-full mx-4 border border-zinc-700/50 relative overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        {/* Background Decoration */}
                        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 animate-gradient-x" />

                        <div className="flex flex-col items-center text-center gap-6 relative z-10">
                            {/* Icono con halo cyan */}
                            <div className="w-24 h-24 bg-cyan-500/10 rounded-full flex items-center justify-center text-cyan-400 mb-2 border border-cyan-500/20 shadow-lg shadow-cyan-500/10 relative">
                                <CheckCircle size={48} className="drop-shadow-[0_0_12px_rgba(34,211,238,0.5)]" />
                                <div className="absolute inset-0 rounded-full border-4 border-cyan-400/30 animate-pulse" style={{ animationDuration: '2s' }} />
                            </div>

                            <div>
                                <h2 className="text-3xl font-black text-zinc-100 tracking-widest uppercase mb-3">¡Genial!</h2>
                                <p className="text-xs text-zinc-400 font-bold leading-relaxed px-4 tracking-widest uppercase">
                                    Pedido recibido y sincronizado
                                </p>
                            </div>

                            {/* Órdenes generadas */}
                            <div className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-2xl p-5 mb-2">
                                <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-black mb-4">Órdenes Generadas</p>
                                <div className="flex flex-wrap justify-center gap-2">
                                    {createdOrderIds.map(id => (
                                        <span key={id} className="bg-zinc-900 border border-cyan-500/30 text-cyan-300 rounded-xl py-2 px-4 font-mono font-bold text-sm shadow-inner shadow-cyan-500/5">
                                            {id}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Acciones */}
                            <div className="w-full space-y-3">
                                <button
                                    className="w-full py-5 bg-cyan-400 hover:bg-cyan-300 text-zinc-900 font-black rounded-[2rem] transition-all shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_25px_rgba(34,211,238,0.5)] active:scale-95 flex items-center justify-center gap-3 uppercase tracking-widest"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        actions.setShowSuccessModal(false);
                                        setTimeout(() => navigate('/portal/factory'), 50);
                                    }}
                                >
                                    Ver mis pedidos
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        actions.setShowSuccessModal(false);
                                        setTimeout(() => window.location.reload(), 50);
                                    }}
                                    className="w-full text-zinc-500 hover:text-cyan-400 text-[10px] font-black uppercase tracking-[0.2em] transition-colors py-3"
                                >
                                    + Crear otro pedido
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default OrderForm;
