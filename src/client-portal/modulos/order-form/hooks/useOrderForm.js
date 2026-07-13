
import { useReducer, useEffect, useCallback } from 'react';
import { apiClient } from '../../../api/apiClient';
import { fileService } from '../../../api/fileService';
import { useToast } from '../../../pautas/Toast';
import { useAuth } from '../../../auth/AuthContext';
import { SERVICES_LIST } from '../../../constants/services';

const findDefaultMaterial = (materialsList) => {
    if (!materialsList || materialsList.length === 0) return '';
    const found = materialsList.find(m => {
        const name = (m.Material || m.Descripcion || m || '').toLowerCase();
        return name.includes('hexagonal') && (name.includes('1.83') || name.includes('1,83'));
    });
    if (found) {
        return found.Material || found.Descripcion || found;
    }
    return materialsList[0].Material || materialsList[0].Descripcion || materialsList[0];
};

const initialState = {
    // Form Data
    jobName: '',
    serviceSubType: '',
    urgency: '',
    generalNote: '',
    globalMaterial: '',
    fabricType: 'lisa',
    requiresSample: false,
    items: [],
    referenceFiles: [],
    selectedComplementary: {},

    // Specialized Data
    moldType: 'SUBLIMACION',
    fabricOrigin: 'TELA SUBLIMADA EN USER',
    clientFabricName: '',
    // Tela de Cliente: bobina seleccionada (BobinaID de InventarioBobinas) + datos para validar
    selectedBobinaId: null,
    selectedBobinaAncho: null,   // ancho de la bobina (m) — valida el ancho del archivo
    selectedBobinaMetros: null,  // MetrosRestantes — valida el largo del archivo
    bobinasDisponibles: [],
    selectedSubOrderId: '',
    tizadaFiles: [],
    pedidoExcelFile: null,
    enableCorte: false,
    enableCostura: false,
    garmentQuantity: '',
    ponchadoFiles: [],
    bocetoFile: null,
    bordadoBocetoFile: null,
    costuraNote: '',
    bordadoMaterial: '',
    bordadoVariant: '',

    // Estampado Data
    estampadoFile: null,
    estampadoQuantity: '',
    estampadoPrints: 1,
    estampadoOrigin: 'Prendas del Cliente',

    // TPU Data
    tpuForma: '',

    // UI & Upload State
    loading: false,
    showSuccessModal: false,
    createdOrderIds: [],
    uploading: false,
    uploadProgress: { current: 0, total: 0, filename: '' },
    uploadError: false,
    pendingManifest: [],
    localFileMap: {},
    errorModalOpen: false,
    errorModalMessage: '',

    // Loaded/Dynamic Data
    visibleConfig: {},          // indexado por CodOrden (BOR, COR...) tal como viene del backend
    visibleConfigByArea: {},    // mismo dato re-indexado por AreaID_Interno (EMB, TWC...) = lo que usa el portal
    prioritiesList: [],
    // Áreas con urgencia activa (viene con /nomenclators/priorities; misma regla que precios).
    // null = sin dato → no se oculta nada (fail-open).
    areasConUrgencia: null,
    uniqueVariants: [],
    dynamicMaterials: [],
    activeSubOrders: [],
    embroideryVariants: [],
    embroideryMaterials: [],
    // userStock is derived from AuthContext usually, but we can store it here if needed or just use context
};

const actionTypes = {
    SET_FIELD: 'SET_FIELD',
    RESET_FORM: 'RESET_FORM',
    ADD_ITEM: 'ADD_ITEM',
    REMOVE_ITEM: 'REMOVE_ITEM',
    UPDATE_ITEM: 'UPDATE_ITEM',
    SET_ITEMS: 'SET_ITEMS',
    SET_DATA: 'SET_DATA', // Generic for loading lists
    START_UPLOAD: 'START_UPLOAD',
    UPDATE_UPLOAD_PROGRESS: 'UPDATE_UPLOAD_PROGRESS',
    UPLOAD_SUCCESS: 'UPLOAD_SUCCESS',
    UPLOAD_ERROR: 'UPLOAD_ERROR',
};

function orderFormReducer(state, action) {
    switch (action.type) {
        case actionTypes.SET_FIELD:
            return { ...state, [action.field]: action.value };

        case actionTypes.RESET_FORM:
            return {
                ...initialState,
                // Preserve loaded configuration that is global (not service specific if needed, but here we reset mostly)
                prioritiesList: state.prioritiesList,
                visibleConfig: state.visibleConfig,
                visibleConfigByArea: state.visibleConfigByArea,
                // Apply defaults from action if provided
                ...action.defaults
            };

        case actionTypes.ADD_ITEM:
            return { ...state, items: [...state.items, action.item] };

        case actionTypes.REMOVE_ITEM:
            return { ...state, items: state.items.filter(item => item.id !== action.id) };

        case actionTypes.UPDATE_ITEM:
            return {
                ...state,
                items: state.items.map(item =>
                    item.id === action.id ? { ...item, [action.field]: action.value } : item
                )
            };

        case actionTypes.SET_ITEMS:
            return { ...state, items: action.items };

        case actionTypes.SET_DATA:
            return { ...state, ...action.data };

        case actionTypes.START_UPLOAD:
            return {
                ...state,
                uploading: true,
                uploadError: false,
                // Reset del progreso: si no, una segunda subida arranca mostrando el 100% de la anterior
                uploadProgress: {
                    current: 0,
                    total: action.manifest?.length || 0,
                    filename: '',
                    phase: 'uploading',
                    bytesUploaded: 0,
                    totalBytes: 0,
                    currentFileBytes: 0,
                    currentFileTotal: 0,
                    etaSeconds: 0
                },
                pendingManifest: action.manifest,
                localFileMap: action.fileMap
            };

        case actionTypes.UPDATE_UPLOAD_PROGRESS:
            return { ...state, uploadProgress: action.progress };

        case actionTypes.UPLOAD_SUCCESS:
            return {
                ...state,
                uploading: false,
                localFileMap: {},
                pendingManifest: [],
                showSuccessModal: true
            };

        case actionTypes.UPLOAD_ERROR:
            return { ...state, uploadError: true, pendingManifest: action.remainingManifest };

        default:
            return state;
    }
}

export const useOrderForm = (serviceId, overrides = {}) => {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [state, dispatch] = useReducer(orderFormReducer, initialState);

    const serviceInfo = SERVICES_LIST.find(s => s.id.toLowerCase() === serviceId?.toLowerCase());
    const config = serviceInfo?.config || {};

    // --- Computed Visibility Logic ---
    // Calculates which complementary options are visible based on:
    // 1. SERVICES_LIST definition (base)
    // 2. Global Backend Config (visibleConfig)
    // 3. Runtime Overrides (props/navigation state)
    const visibleComplementaryOptions = (serviceInfo?.complementaryOptions || []).filter(opt => {
        // 1. Global Disable via Backend (if loaded)
        // opt.id = AreaID_Interno (EMB, TWC, TWT...). La visibilidad viene re-indexada por área
        // (visibleConfigByArea) porque el backend la entrega por CodOrden (BOR, COR, COS...).
        const globalVisibility = state.visibleConfigByArea?.[opt.id]?.visible;
        if (globalVisibility === false) return false;

        // 1.5 Local Config: Allowed Complementary Services for THIS Service
        const currentArea = serviceInfo?.areaId || serviceInfo?.codOrden || serviceInfo?.id?.toUpperCase();
        const allowedComplementaries = state.visibleConfigByArea?.[currentArea]?.complementarios;
        if (allowedComplementaries && Array.isArray(allowedComplementaries)) {
            // If configuration exists, only show allowed ones.
            // Note: opt.id must match the ID stored in DB (e.g. 'EMB', 'EST').
            if (!allowedComplementaries.includes(opt.id)) return false;
        }

        // 2. Runtime Overrides (Allowlist/Blocklist)
        if (overrides.allowedOptions && !overrides.allowedOptions.includes(opt.id)) return false;
        if (overrides.hiddenOptions && overrides.hiddenOptions.includes(opt.id)) return false;

        // 3. Auto-Hide Redundant Services
        // If the service has a dedicated Cutting/Sewing workflow enabled (hasCuttingWorkflow),
        // we hide the complementary options that are already handled by the main blocks (TWC, TWT, etc.)
        if (config.hasCuttingWorkflow) {
            const lowerId = opt.id.toLowerCase();
            // TWC=Corte, TWT=Costura
            if (['twc', 'twt', 'corte', 'costura', 'laser', 'tizada', 'confeccion'].includes(lowerId)) {
                return false;
            }
        }

        return true;
    });

    // Corte (TWC) y Costura (TWT) se renderizan como bloques propios en el OrderForm (no salen del
    // .map de arriba), así que su visibilidad como servicio se chequea aparte con estos flags.
    // Default a visible mientras la config no cargó (evita ocultarlos por un parpadeo inicial).
    const corteServicioVisible   = state.visibleConfigByArea?.['TWC']?.visible !== false;
    const costuraServicioVisible = state.visibleConfigByArea?.['TWT']?.visible !== false;

    // --- Actions Wrappers ---
    const setField = (field, value) => dispatch({ type: actionTypes.SET_FIELD, field, value });

    // Explicit setters for compatibility with existing code structure (optional, but helper functions)
    const setJobName = (v) => setField('jobName', v);
    const setServiceSubType = (v) => setField('serviceSubType', v);
    const setUrgency = (v) => setField('urgency', v);
    const setGeneralNote = (v) => setField('generalNote', v);
    const setGlobalMaterial = (v) => {
        setField('globalMaterial', v);
        // Sync items with global material
        dispatch({
            type: actionTypes.SET_ITEMS,
            items: state.items.map(item => ({ ...item, material: v }))
        });
    };
    const setFabricType = (v) => setField('fabricType', v);
    const setRequiresSample = (v) => setField('requiresSample', v);
    const setSelectedComplementary = (v) => setField('selectedComplementary', v); // Full overwrite or merge? Existing code overwrites usually or updates keys.
    const setReferenceFiles = (v) => setField('referenceFiles', v);

    // Specialized
    const setMoldType = (v) => setField('moldType', v);
    const setFabricOrigin = (v) => setField('fabricOrigin', v);
    const setClientFabricName = (v) => setField('clientFabricName', v);
    // Tela de Cliente: setea la bobina elegida (o null para limpiar). Sincroniza clientFabricName
    // con la descripción de la tela (compatibilidad con notas/metadata existentes).
    const setSelectedBobina = (bobina) => {
        dispatch({
            type: actionTypes.SET_DATA,
            data: {
                selectedBobinaId: bobina?.BobinaID ?? null,
                // El ancho que valida el archivo sale del ancho REAL (confirmado); si no está, del declarado.
                selectedBobinaAncho: (bobina?.AnchoReal ?? bobina?.Ancho) != null ? parseFloat(bobina.AnchoReal ?? bobina.Ancho) : null,
                selectedBobinaMetros: bobina?.MetrosRestantes != null ? parseFloat(bobina.MetrosRestantes) : null,
                clientFabricName: bobina?.DescripcionTela || ''
            }
        });
    };
    const setSelectedSubOrderId = (v) => setField('selectedSubOrderId', v);
    const setTizadaFiles = (v) => {
        // Handle functional update if passed (e.g. prev => prev.filter...)
        // But reducer expects value. We handle this in the component or here.
        // Assuming value is passed directly for now, or we check type.
        // If functional update, we can't do it easily in reducer without accessing current state in dispatch which we can't.
        // Component should handle logic and pass final value.
        // But existing code uses `setTizadaFiles(prev => ...)`
        // We will need to adapt the consuming code or provide a smart setter.
        // For simplicity: We will change consuming code to pass the new value.
        setField('tizadaFiles', v);
    };
    const setPedidoExcelFile = (v) => setField('pedidoExcelFile', v);
    const setEnableCorte = (v) => setField('enableCorte', v);
    const setEnableCostura = (v) => setField('enableCostura', v);
    const setGarmentQuantity = (v) => setField('garmentQuantity', v);
    const setPonchadoFiles = (v) => setField('ponchadoFiles', v); // Functional update issue again
    const setBocetoFile = (v) => setField('bocetoFile', v);
    const setBordadoBocetoFile = (v) => setField('bordadoBocetoFile', v);
    const setCosturaNote = (v) => setField('costuraNote', v);
    const setBordadoMaterial = (v) => setField('bordadoMaterial', v);
    const setBordadoVariant = (v) => setField('bordadoVariant', v);

    const setEstampadoFile = (v) => setField('estampadoFile', v);
    const setEstampadoQuantity = (v) => setField('estampadoQuantity', v);
    const setEstampadoPrints = (v) => setField('estampadoPrints', v);
    const setEstampadoOrigin = (v) => setField('estampadoOrigin', v);

    const setTpuForma = (v) => setField('tpuForma', v);

    // Items
    const addItem = () => {
        const lastItem = state.items[state.items.length - 1];
        const newMaterial = lastItem ? lastItem.material : state.globalMaterial;
        const newItem = { id: Date.now(), file: null, fileBack: null, copies: 1, material: newMaterial, note: '', doubleSided: false, printSettings: {} };
        dispatch({ type: actionTypes.ADD_ITEM, item: newItem });
    };

    const removeItem = (id) => dispatch({ type: actionTypes.REMOVE_ITEM, id });

    const updateItem = (id, field, value) => dispatch({ type: actionTypes.UPDATE_ITEM, id, field, value });

    const setItems = (items) => {
        // Support functional update for items if needed, but risky with reducer
        if (typeof items === 'function') {
            // We can't support this easily without thunk or ref access. 
            // Ideally we refactor consuming code.
            // But for now, let's assume we can change the calling code to not use functional updates for setItems or use a specific action.
            console.warn("setItems functional update not fully supported in useOrderForm yet");
            return;
        }
        dispatch({ type: actionTypes.SET_ITEMS, items });
    };

    // UI Setters
    const setErrorModalOpen = (v) => setField('errorModalOpen', v);
    const setErrorModalMessage = (v) => setField('errorModalMessage', v);
    const setLoading = (v) => setField('loading', v);
    const setCreatedOrderIds = (v) => setField('createdOrderIds', v);
    const setShowSuccessModal = (v) => setField('showSuccessModal', v);

    // --- Effects ---

    // 1. Load Visibility Config & Priorities
    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const [visRes, prioRes] = await Promise.all([
                    apiClient.get('/web-orders/area-mapping'),
                    apiClient.get('/nomenclators/priorities')
                ]);

                let updates = {};
                if (visRes.success && visRes.data?.visibility) {
                    updates.visibleConfig = visRes.data.visibility;
                    // Re-indexar por AreaID_Interno: el portal referencia los servicios por área
                    // (EMB, TWC, TWT...) mientras el backend los devuelve por CodOrden (BOR, COR, COS...).
                    const byArea = {};
                    Object.values(visRes.data.visibility).forEach(v => {
                        if (v && v.area) byArea[v.area] = v;
                    });
                    updates.visibleConfigByArea = byArea;
                } else {
                    updates.visibleConfig = {};
                    updates.visibleConfigByArea = {};
                }

                if (prioRes?.success && prioRes.data?.length > 0) {
                    updates.prioritiesList = prioRes.data;
                    updates.urgency = prioRes.data[0].Nombre;
                    updates.areasConUrgencia = Array.isArray(prioRes.areasConUrgencia)
                        ? prioRes.areasConUrgencia.map(a => String(a).toUpperCase())
                        : null;
                } else {
                    updates.prioritiesList = [{ IdPrioridad: 0, Nombre: 'Normal', Color: '#fff' }, { IdPrioridad: 1, Nombre: 'Urgente', Color: '#fbbf24' }];
                    updates.urgency = 'Normal';
                }

                dispatch({ type: actionTypes.SET_DATA, data: updates });

            } catch (err) {
                console.error("Error loading initial data", err);
                // Set defaults on error
                dispatch({
                    type: actionTypes.SET_DATA,
                    data: {
                        visibleConfig: {},
                        visibleConfigByArea: {},
                        urgency: 'Normal',
                        prioritiesList: [{ IdPrioridad: 0, Nombre: 'Normal', Color: '#fff' }, { IdPrioridad: 1, Nombre: 'Urgente', Color: '#fbbf24' }]
                    } 
                });
            }
        };

        if (!serviceId) return;
        loadInitialData();
    }, []); // Run once on mount? Or when serviceId changes? Priorities are global. Visibility might be global.

    // 2. Initialize/Reset when serviceId changes
    useEffect(() => {
        if (!serviceInfo) return;

        const defaults = {
            jobName: '',
            generalNote: '',
            fabricType: 'lisa',
            requiresSample: false,
            selectedComplementary: {},
            referenceFiles: [],
            // Reset specialized
            moldType: 'SUBLIMACION',
            fabricOrigin: 'TELA SUBLIMADA EN USER',
            clientFabricName: '',
            selectedBobinaId: null,
            selectedBobinaAncho: null,
            selectedBobinaMetros: null,
            bobinasDisponibles: [],
            selectedSubOrderId: '',
            bocetoFile: null,
            bordadoBocetoFile: null,
            bocetoFile: null,
            bordadoBocetoFile: null,
            costuraNote: '',
            // Reset Estampado
            estampadoFile: null,
            estampadoQuantity: '',
            estampadoPrints: 1,
            estampadoOrigin: 'Prendas del Cliente',
            // Reset TPU
            tpuForma: '',
            tizadaFiles: [],
            pedidoExcelFile: null,
            enableCorte: false,
            enableCostura: serviceId === 'corte-confeccion' ? true : false,
            // Reset Arrays
            items: [],
            // Data clearing
            uniqueVariants: [],
            variantsInfo: {},   // Variante -> { tipoStock, um } (ECOUV: MATERIAL | PRODUCTO_TERMINADO)
            dynamicMaterials: [],
        };

        // We also need to fetch variants/materials for the new service
        // Initialize Form Data
        dispatch({ type: actionTypes.RESET_FORM, defaults });

        // Logic to fetch Variants/Materials based on new Config
        const dbAreaId = serviceInfo?.areaId;

        if (!dbAreaId) return;

        const { variantMode, fixedVariant, defaultVariant } = config;

        const fetchMaterialsForVariant = (variantName) => {
            if (!variantName) return;
            apiClient.get(`/nomenclators/materials/${dbAreaId}/${encodeURIComponent(variantName)}`).then(mRes => {
                if (mRes.success && mRes.data.length > 0) {
                    // En modo "multiple" (material por archivo, p. ej. Sublimación) NO autocompletamos:
                    // el cliente debe elegir el material de cada archivo (se valida al confirmar).
                    const firstMat = config.materialMode === 'multiple' ? '' : findDefaultMaterial(mRes.data);
                    dispatch({
                        type: actionTypes.SET_DATA,
                        data: { dynamicMaterials: mRes.data, globalMaterial: firstMat }
                    });
                    // Update Initial Item
                    setItems([]);
                } else {
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: [], globalMaterial: '' } });
                }
            });
        };

        // Materiales por TIPO para variantes virtuales (ECOUV)
        const fetchMaterialsForVirtualVariant = (variantLabel) => {
            const vv = (config.virtualVariants || []).find(x => x.label === variantLabel);
            if (!vv) return;
            const params = `tipo=${encodeURIComponent(vv.tipo)}${vv.soloConTerminaciones ? '&conTerminaciones=1' : ''}`;
            apiClient.get(`/nomenclators/materiales-por-tipo/${dbAreaId}?${params}`).then(mRes => {
                if (mRes.success && mRes.data.length > 0) {
                    const firstMat = config.materialMode === 'multiple' ? '' : findDefaultMaterial(mRes.data);
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: mRes.data, globalMaterial: firstMat } });
                    setItems([]);
                } else {
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: [], globalMaterial: '' } });
                }
            }).catch(e => {
                // Backend caído / red: no dejar los combos vacíos en silencio
                console.error('Error cargando materiales por tipo:', e);
                dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: [], globalMaterial: '' } });
            });
        };

        // Case 0: Variantes VIRTUALES definidas en services.js (ECOUV: Material Impreso /
        // Personalizado / Productos Terminados). No salen de StockArt: Impreso y
        // Personalizado comparten materiales y solo difieren en las terminaciones.
        if (variantMode === 'virtual' && Array.isArray(config.virtualVariants) && config.virtualVariants.length > 0) {
            const variants = config.virtualVariants.map(v => v.label);
            const variantsInfo = {};
            config.virtualVariants.forEach(v => {
                variantsInfo[v.label] = { tipoStock: v.tipo, terminaciones: !!v.terminaciones, soloConTerminaciones: !!v.soloConTerminaciones };
            });
            const initialVariant = (defaultVariant && variants.find(x => (x || '').trim().toLowerCase() === defaultVariant.trim().toLowerCase())) || variants[0];
            dispatch({ type: actionTypes.SET_DATA, data: { uniqueVariants: variants, variantsInfo, serviceSubType: initialVariant } });
            fetchMaterialsForVirtualVariant(initialVariant);
        }
        // Case A: Fixed Variant (e.g. Corte -> 'Corte')
        else if (variantMode === 'fixed' && fixedVariant) {
            dispatch({ type: actionTypes.SET_DATA, data: { serviceSubType: fixedVariant, uniqueVariants: [] } });
            fetchMaterialsForVariant(fixedVariant);
        }
        // Case B: Selectable Variant (Fetch from DB)
        else if (variantMode === 'select') {
            apiClient.get(`/nomenclators/variants/${dbAreaId}`).then(res => {
                if (res.success && res.data.length > 0) {
                    const variants = res.data.map(item => item.Variante);
                    // Tipo de cada variante (ECOUV): MATERIAL | PRODUCTO_TERMINADO | TERMINACION
                    const variantsInfo = {};
                    res.data.forEach(v => {
                        variantsInfo[(v.Variante || '').trim()] = { tipoStock: v.TipoStock || 'MATERIAL', um: (v.UM || '').trim() };
                    });
                    // Use defaultVariant from config (match tolerante a mayúsculas/espacios), sino la primera
                    const initialVariant = (defaultVariant && variants.find(v => (v || '').trim().toLowerCase() === defaultVariant.trim().toLowerCase())) || variants[0];

                    dispatch({ type: actionTypes.SET_DATA, data: { uniqueVariants: variants, variantsInfo, serviceSubType: initialVariant } });
                    fetchMaterialsForVariant(initialVariant);
                } else {
                    // Fallback if no variants found but we expected them
                    dispatch({ type: actionTypes.SET_DATA, data: { uniqueVariants: [], dynamicMaterials: [] } });
                }
            }).catch(e => console.warn('Error fetching variants', e));
        }
        // Case C: No Variant (Material might be direct)
        else {
            // If no variant, maybe we fetch materials directly for the Area? 
            // Current backend logic usually expects /materials/:Area/:Variant. 
            // If the area has no variants, maybe we pass specific keyword or check backend API.
            // For now, assume 'select' is dominant or 'fixed'.
        }
    }, [serviceId, serviceInfo]); // Be careful with dependencies. Using serviceId is safer.

    // 3. Fetch Embroidery Data if Complementary
    // FIX: Trigger also if 'EMB' passes the visibility check we just added or simply if present in serviceInfo to avoid complexity updates
    useEffect(() => {
        const hasBordado = visibleComplementaryOptions.some(o => o.id === 'EMB');
        if (hasBordado && serviceId !== 'bordado') {
            apiClient.get('/nomenclators/variants/EMB').then(res => {
                if (res.success && res.data.length > 0) {
                    const variants = res.data.map(item => item.Variante);
                    const firstVariant = variants[0];
                    dispatch({
                        type: actionTypes.SET_DATA,
                        data: { embroideryVariants: variants, bordadoVariant: firstVariant }
                    });

                    apiClient.get(`/nomenclators/materials/EMB/${encodeURIComponent(firstVariant)}`).then(mRes => {
                        if (mRes.success && mRes.data.length > 0) {
                            dispatch({
                                type: actionTypes.SET_DATA,
                                data: { embroideryMaterials: mRes.data, bordadoMaterial: mRes.data[0].Material }
                            });
                        }
                    });
                }
            });
        }
    }, [serviceId, serviceInfo, visibleComplementaryOptions.length]); // Added visibleComplementaryOptions dep

    // 3b. Tela de Cliente: cargar bobinas disponibles del cliente al elegir ese origen.
    // El backend resuelve el cliente desde el token del portal (no hace falta pasar clienteId).
    useEffect(() => {
        if (state.fabricOrigin === 'TELA CLIENTE' && state.moldType !== 'SUBLIMACION') {
            apiClient.get('/inventory/tela-cliente/disponible').then(res => {
                dispatch({ type: actionTypes.SET_DATA, data: { bobinasDisponibles: res?.data || [] } });
            }).catch(e => {
                console.warn('Error cargando bobinas de tela cliente', e);
                dispatch({ type: actionTypes.SET_DATA, data: { bobinasDisponibles: [] } });
            });
        } else {
            // Al salir de TELA CLIENTE se limpia la selección (evita mandar bobinaId colgado)
            dispatch({
                type: actionTypes.SET_DATA,
                data: { bobinasDisponibles: [], selectedBobinaId: null, selectedBobinaAncho: null, selectedBobinaMetros: null }
            });
        }
    }, [state.fabricOrigin, state.moldType]);

    // 3c. Sublimación Tela de Cliente: cargar las bobinas del cliente al elegir esa variante.
    // Mismo endpoint que Corte; el backend resuelve el cliente por el token del portal.
    // OJO: comparar case-insensitive — la URL puede venir /order/SUBLIMACION (bookmark).
    const svcIdHook = (serviceId || '').toLowerCase();
    const isSubliTelaClienteHook = svcIdHook === 'sublimacion' && /tela de cliente/i.test(state.serviceSubType || '');
    useEffect(() => {
        if (isSubliTelaClienteHook) {
            apiClient.get('/inventory/tela-cliente/disponible').then(res => {
                dispatch({ type: actionTypes.SET_DATA, data: { bobinasDisponibles: res?.data || [] } });
            }).catch(e => {
                console.warn('Error cargando bobinas de tela cliente (sublimación)', e);
                dispatch({ type: actionTypes.SET_DATA, data: { bobinasDisponibles: [] } });
            });
        } else if (svcIdHook === 'sublimacion') {
            // Salir de la variante tela cliente → limpiar selección para no mandar una bobina colgada
            dispatch({ type: actionTypes.SET_DATA, data: { bobinasDisponibles: [], selectedBobinaId: null, selectedBobinaAncho: null, selectedBobinaMetros: null } });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSubliTelaClienteHook, serviceId]);

    // 4. Fetch Sublimation Active Orders
    useEffect(() => {
        if (state.moldType === 'SUBLIMACION') {
            apiClient.get('/web-orders/active-sublimation').then(res => {
                if (res.success) {
                    dispatch({
                        type: actionTypes.SET_DATA,
                        data: {
                            activeSubOrders: res.data,
                            selectedSubOrderId: res.data.length > 0 ? res.data[0].CodigoOrden : ''
                        }
                    });
                }
            });
            setFabricOrigin('TELA SUBLIMADA EN USER');
        }
    }, [state.moldType]);


    // --- Methods ---

    const handleSubTypeChange = (newSubType) => {
        setServiceSubType(newSubType);
        const dbAreaId = serviceInfo?.areaId;
        if (!dbAreaId || !newSubType) return;

        // Variantes VIRTUALES (ECOUV): los materiales se buscan por TIPO, no por nombre
        const vv = config.variantMode === 'virtual' ? (config.virtualVariants || []).find(x => x.label === newSubType) : null;
        if (vv) {
            const params = `tipo=${encodeURIComponent(vv.tipo)}${vv.soloConTerminaciones ? '&conTerminaciones=1' : ''}`;
            apiClient.get(`/nomenclators/materiales-por-tipo/${dbAreaId}?${params}`).then(res => {
                if (res.success && res.data.length > 0) {
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: res.data } });
                    setGlobalMaterial(config.materialMode === 'multiple' ? '' : findDefaultMaterial(res.data));
                } else {
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: [] } });
                    setGlobalMaterial('');
                }
            }).catch(e => {
                console.error('Error cargando materiales por tipo:', e);
                dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: [] } });
                setGlobalMaterial('');
            });
            return;
        }

        if (dbAreaId && newSubType) {
            apiClient.get(`/nomenclators/materials/${dbAreaId}/${encodeURIComponent(newSubType)}`).then(res => {
                if (res.success && res.data.length > 0) {
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: res.data } });
                    const firstMat = config.materialMode === 'multiple' ? '' : findDefaultMaterial(res.data);
                    setGlobalMaterial(firstMat);
                } else {
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: [] } });
                    setGlobalMaterial('');
                }
            });
        }
    };

    const handleEmbroideryVariantChange = (newVariant) => {
        setBordadoVariant(newVariant);
        apiClient.get(`/nomenclators/materials/EMB/${encodeURIComponent(newVariant)}`).then(res => {
            if (res.success && res.data.length > 0) {
                dispatch({ type: actionTypes.SET_DATA, data: { embroideryMaterials: res.data } });
                setBordadoMaterial(res.data[0].Material);
            } else {
                dispatch({ type: actionTypes.SET_DATA, data: { embroideryMaterials: [] } });
                setBordadoMaterial('');
            }
        });
    };

    const toggleComplementary = (id) => {
        const current = state.selectedComplementary[id];
        let newComp;
        if (current) {
            const { [id]: _, ...rest } = state.selectedComplementary;
            newComp = rest;
        } else {
            newComp = { ...state.selectedComplementary, [id]: { active: true } };
        }
        setField('selectedComplementary', newComp);
    };

    const updateComplementaryFile = (id, fileData) => {
        const current = state.selectedComplementary[id] || { active: true };
        const newComp = { ...state.selectedComplementary, [id]: { ...current, file: fileData } };
        setField('selectedComplementary', newComp);
    };

    const updateComplementaryText = (id, text) => {
        const current = state.selectedComplementary[id] || { active: true };
        const newComp = { ...state.selectedComplementary, [id]: { ...current, text } };
        setField('selectedComplementary', newComp);
    };

    const updateComplementaryField = (id, fieldName, value) => {
        const current = state.selectedComplementary[id] || { active: true };
        const currentFields = current.fields || {};
        const newComp = {
            ...state.selectedComplementary,
            [id]: { ...current, fields: { ...currentFields, [fieldName]: value } }
        };
        setField('selectedComplementary', newComp);
    };

    const addTizadaFiles = (files) => {
        const newFiles = Array.isArray(files) ? files : [files];
        dispatch({ type: actionTypes.SET_FIELD, field: 'tizadaFiles', value: [...state.tizadaFiles, ...newFiles] });
    };

    const removeTizadaFile = (index) => {
        dispatch({ type: actionTypes.SET_FIELD, field: 'tizadaFiles', value: state.tizadaFiles.filter((_, i) => i !== index) });
    };

    const addPonchadoFiles = (files) => {
        const newFiles = Array.isArray(files) ? files : [files];
        dispatch({ type: actionTypes.SET_FIELD, field: 'ponchadoFiles', value: [...state.ponchadoFiles, ...newFiles] });
    };

    const removePonchadoFile = (index) => {
        dispatch({ type: actionTypes.SET_FIELD, field: 'ponchadoFiles', value: state.ponchadoFiles.filter((_, i) => i !== index) });
    };

    const handleUploadProcess = async (manifest, fileMap) => {
        dispatch({ type: actionTypes.START_UPLOAD, manifest, fileMap });

        let completed = 0;
        const total = manifest.length;
        
        // Calcular tamaño total para ETA
        const totalBytes = manifest.reduce((acc, item) => {
            const fileObj = fileMap[item.originalName];
            return acc + (fileObj?.size || 0);
        }, 0);
        
        let bytesUploadedForCompletedFiles = 0;
        const startTime = Date.now();

        try {
            for (let i = 0; i < manifest.length; i++) {
                const item = manifest[i];
                const fileObj = fileMap[item.originalName];

                if (!fileObj) {
                    completed++;
                    continue;
                }

                dispatch({
                    type: actionTypes.UPDATE_UPLOAD_PROGRESS,
                    progress: {
                        current: i + 1,
                        total,
                        filename: item.originalName,
                        phase: 'uploading',
                        bytesUploaded: bytesUploadedForCompletedFiles,
                        totalBytes,
                        etaSeconds: 0,
                        currentFileBytes: 0,
                        currentFileTotal: fileObj.size
                    }
                });

                try {
                    await fileService.uploadStream(fileObj, item, (loaded, eventTotal) => {
                        const currentTotalBytesUploaded = bytesUploadedForCompletedFiles + loaded;
                        const elapsedMs = Date.now() - startTime;
                        let etaSeconds = 0;
                        if (currentTotalBytesUploaded > 0 && elapsedMs > 500) {
                            const bytesPerMs = currentTotalBytesUploaded / elapsedMs;
                            const remainingBytes = totalBytes - currentTotalBytesUploaded;
                            etaSeconds = Math.round((remainingBytes / bytesPerMs) / 1000);
                        }
                        
                        dispatch({
                            type: actionTypes.UPDATE_UPLOAD_PROGRESS,
                            progress: {
                                current: i + 1,
                                total,
                                filename: item.originalName,
                                // Cuando los bytes ya salieron del navegador, el servidor está
                                // guardando en Drive (tramo que el navegador no puede medir).
                                phase: (eventTotal > 0 && loaded >= eventTotal) ? 'processing' : 'uploading',
                                bytesUploaded: currentTotalBytesUploaded,
                                totalBytes: totalBytes,
                                etaSeconds: etaSeconds,
                                currentFileBytes: loaded,
                                currentFileTotal: eventTotal
                            }
                        });
                    });
                } catch (e) {
                    throw e;
                }
                bytesUploadedForCompletedFiles += fileObj.size;
                completed++;
            }
            dispatch({ type: actionTypes.UPLOAD_SUCCESS });
            addToast('Pedido completado y archivos subidos', 'success');
        } catch (err) {
            console.error("❌ Error en secuencia de subida:", err);
            const remaining = manifest.slice(completed);
            dispatch({ type: actionTypes.UPLOAD_ERROR, remainingManifest: remaining });
            addToast("Hubo un error al subir archivos. Reintenta.", "error");
        }
    };

    return {
        state,
        serviceInfo,
        config,
        visibleComplementaryOptions, // New exposed property
        corteServicioVisible,        // toggle del modal (Servicios Web) para Corte
        costuraServicioVisible,      // toggle del modal (Servicios Web) para Costura
        userStock: user?.stock || [], // Fallback if not in user
        actions: {
            setJobName,
            setServiceSubType,
            setUrgency,
            setGeneralNote,
            setGlobalMaterial,
            setFabricType,
            setRequiresSample,
            setSelectedComplementary,
            setReferenceFiles,
            setMoldType,
            setFabricOrigin,
            setClientFabricName,
            setSelectedBobina,
            setSelectedSubOrderId,
            setTizadaFiles,
            setPedidoExcelFile,
            setEnableCorte,
            setEnableCostura,
            setGarmentQuantity,
            setPonchadoFiles,
            setBocetoFile,
            setBordadoBocetoFile,
            setCosturaNote,
            setBordadoMaterial,
            setBordadoVariant,
            setEstampadoFile,
            setEstampadoQuantity,
            setEstampadoPrints,
            setEstampadoOrigin,
            setTpuForma,
            handleEmbroideryVariantChange,
            toggleComplementary,
            updateComplementaryFile,
            updateComplementaryText,
            updateComplementaryField,
            addTizadaFiles,
            removeTizadaFile,
            addPonchadoFiles,
            removePonchadoFile,
            addItem,
            removeItem,
            updateItem,
            setItems, // Avoid if possible
            handleSubTypeChange,
            handleUploadProcess,
            setErrorModalOpen,
            setErrorModalMessage,
            setLoading,
            setCreatedOrderIds,
            setShowSuccessModal
        }
    };
};
