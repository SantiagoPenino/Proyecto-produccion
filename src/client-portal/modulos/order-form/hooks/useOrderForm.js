
import { useReducer, useEffect, useCallback } from 'react';
import { apiClient } from '../../../api/apiClient';
import { fileService } from '../../../api/fileService';
import { useToast } from '../../../pautas/Toast';
import { useAuth } from '../../../auth/AuthContext';
import { SERVICES_LIST } from '../../../constants/services';

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
    selectedSubOrderId: '',
    tizadaFiles: [],
    pedidoExcelFile: null,
    enableCorte: true,
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
    visibleConfig: {},
    prioritiesList: [],
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

    const serviceInfo = SERVICES_LIST.find(s => s.id === serviceId);
    const config = serviceInfo?.config || {};

    // --- Computed Visibility Logic ---
    // Calculates which complementary options are visible based on:
    // 1. SERVICES_LIST definition (base)
    // 2. Global Backend Config (visibleConfig)
    // 3. Runtime Overrides (props/navigation state)
    const visibleComplementaryOptions = (serviceInfo?.complementaryOptions || []).filter(opt => {
        // 1. Global Disable via Backend (if loaded)
        const globalVisibility = state.visibleConfig?.[opt.id]?.visible;
        if (globalVisibility === false) return false;

        // 1.5 Local Config: Allowed Complementary Services for THIS Service
        const currentServiceCode = serviceInfo?.codOrden || serviceInfo?.id?.toUpperCase();
        const allowedComplementaries = state.visibleConfig?.[currentServiceCode]?.complementarios;
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
                } else {
                    updates.visibleConfig = {};
                }

                if (prioRes.success && prioRes.data.length > 0) {
                    updates.prioritiesList = prioRes.data;
                    updates.urgency = prioRes.data[0].Nombre;
                } else {
                    updates.prioritiesList = [{ IdPrioridad: 0, Nombre: 'Normal', Color: '#fff' }, { IdPrioridad: 1, Nombre: 'Urgente', Color: '#fbbf24' }];
                    updates.urgency = 'Normal';
                }

                dispatch({ type: actionTypes.SET_DATA, data: updates });

            } catch (err) {
                console.error("Error loading initial data", err);
                // Set defaults on error
                dispatch({ type: actionTypes.SET_DATA, data: { visibleConfig: {}, urgency: 'Normal' } });
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
            enableCorte: true,
            enableCostura: serviceId === 'corte-confeccion' ? true : false,
            // Reset Arrays
            items: [{ id: Date.now(), file: null, fileBack: null, copies: 1, material: '', note: '', doubleSided: false, printSettings: {} }],
            // Data clearing
            uniqueVariants: [],
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
                    const firstMat = mRes.data[0].Material;
                    dispatch({
                        type: actionTypes.SET_DATA,
                        data: { dynamicMaterials: mRes.data, globalMaterial: firstMat }
                    });
                    // Update Initial Item
                    setItems([{ id: Date.now(), file: null, fileBack: null, copies: 1, material: firstMat, note: '', doubleSided: false, printSettings: {} }]);
                } else {
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: [], globalMaterial: '' } });
                }
            });
        };

        // Case A: Fixed Variant (e.g. Corte -> 'Corte')
        if (variantMode === 'fixed' && fixedVariant) {
            dispatch({ type: actionTypes.SET_DATA, data: { serviceSubType: fixedVariant, uniqueVariants: [] } });
            fetchMaterialsForVariant(fixedVariant);
        }
        // Case B: Selectable Variant (Fetch from DB)
        else if (variantMode === 'select') {
            apiClient.get(`/nomenclators/variants/${dbAreaId}`).then(res => {
                if (res.success && res.data.length > 0) {
                    const variants = res.data.map(item => item.Variante);
                    // Use defaultVariant from config if present in list, otherwise first
                    const initialVariant = (defaultVariant && variants.includes(defaultVariant)) ? defaultVariant : variants[0];

                    dispatch({ type: actionTypes.SET_DATA, data: { uniqueVariants: variants, serviceSubType: initialVariant } });
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

        if (dbAreaId && newSubType) {
            apiClient.get(`/nomenclators/materials/${dbAreaId}/${encodeURIComponent(newSubType)}`).then(res => {
                if (res.success && res.data.length > 0) {
                    dispatch({ type: actionTypes.SET_DATA, data: { dynamicMaterials: res.data } });
                    const firstMat = res.data[0].Material;
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
                    progress: { current: i + 1, total, filename: item.originalName }
                });

                try {
                    await fileService.uploadStream(fileObj, item);
                } catch (e) {
                    throw e;
                }
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
            setCreatedOrderIds
        }
    };
};
