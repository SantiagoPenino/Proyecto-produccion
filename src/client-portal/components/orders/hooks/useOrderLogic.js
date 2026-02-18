import { useReducer, useCallback, useEffect } from 'react';

/**
 * @typedef {Object} OrderState
 * @property {string} jobName - Nombre del trabajo.
 * @property {string} urgency - Urgencia (Normal, Urgente, Express).
 * @property {string} globalMaterial - Material base seleccionado.
 * @property {string} serviceSubType - Subcategoría del servicio.
 * @property {Array} items - Lista de archivos/piezas a producir.
 * @property {Object} complementaryServices - Configuración de servicios adicionales.
 * @property {Object} technicalSpecs - Especificaciones técnicas (corte, bordado, etc).
 */

const initialState = {
    jobName: '',
    urgency: 'Normal',
    globalMaterial: '',
    serviceSubType: '',
    items: [], // [{ id, file, material, copies, printSettings, ... }]
    complementaryServices: {},
    technicalSpecs: {
        corte: { active: false, moldType: '', fabricOrigin: '' },
        costura: { active: false, note: '' }
    }
};

function orderReducer(state, action) {
    switch (action.type) {
        case 'SET_FIELD':
            return { ...state, [action.field]: action.value };

        case 'SET_TECHNICAL_SPEC':
            return {
                ...state,
                technicalSpecs: {
                    ...state.technicalSpecs,
                    [action.service]: {
                        ...state.technicalSpecs[action.service],
                        ...action.updates
                    }
                }
            };

        case 'ADD_ITEM':
            return { ...state, items: [...state.items, action.item] };

        case 'REMOVE_ITEM':
            return { ...state, items: state.items.filter(i => i.id !== action.id) };

        case 'UPDATE_ITEM':
            return {
                ...state,
                items: state.items.map(item =>
                    item.id === action.id ? { ...item, ...action.updates } : item
                )
            };

        case 'TOGGLE_COMPLEMENTARY':
            const current = state.complementaryServices[action.serviceId] || {};
            return {
                ...state,
                complementaryServices: {
                    ...state.complementaryServices,
                    [action.serviceId]: { ...current, active: !current.active }
                }
            };

        case 'RESET':
            return initialState;

        default:
            return state;
    }
}

/**
 * Hook principal para la lógica de negocio del formulario de pedidos.
 * @param {string} serviceId - ID del servicio actual (ej: 'sublimacion', 'bordado').
 */
export function useOrderLogic(serviceId) {
    const [state, dispatch] = useReducer(orderReducer, initialState);

    // -- Handlers Optimizados con useCallback --

    const setField = useCallback((field, value) => {
        dispatch({ type: 'SET_FIELD', field, value });
    }, []);

    const addItem = useCallback(() => {
        const newItem = {
            id: crypto.randomUUID(),
            file: null,
            material: state.globalMaterial || '', // Hereda si existe
            copies: 1,
            printSettings: { mode: 'normal' }
        };
        dispatch({ type: 'ADD_ITEM', item: newItem });
    }, [state.globalMaterial]);

    const updateItem = useCallback((id, field, value) => {
        dispatch({ type: 'UPDATE_ITEM', id, updates: { [field]: value } });
    }, []);

    const removeItem = useCallback((id) => {
        dispatch({ type: 'REMOVE_ITEM', id });
    }, []);

    const toggleService = useCallback((serviceKey) => {
        // Lógica de dependencia: Si activo Costura, debo revisar si Corte es necesario
        // (Esto podría expandirse según reglas de negocio complejas)
        dispatch({ type: 'TOGGLE_COMPLEMENTARY', serviceId: serviceKey });
    }, []);

    // -- Validación de Dependencias (Effect) --
    useEffect(() => {
        // Ejemplo: Si el servicio es 'corte-confeccion', activar specs por defecto
        if (serviceId === 'corte-confeccion') {
            dispatch({
                type: 'SET_TECHNICAL_SPEC',
                service: 'corte',
                updates: { active: true }
            });
        }
    }, [serviceId]);

    return {
        state,
        dispatch,
        handlers: {
            setField,
            addItem,
            updateItem,
            removeItem,
            toggleService
        }
    };
}
