import api from '../apiClient';

// Requests de toggleStatus en vuelo, por rollo+acción. Un segundo click idéntico mientras
// el primero viaja NO dispara otro POST: se cuelga de la misma promesa (caso lote 1467:
// "finalizar" martillado re-corría el flujo entero en el backend por cada click).
const togglesEnVuelo = new Map();

export const productionService = {
    getBoard: async (area) => {
        try {
            const response = await api.get(`/production-kanban/board?area=${area}`);
            return response.data;
        } catch (error) {
            console.error("Error en getBoard (API):", error);
            throw error;
        }
    },
    assignRoll: async (rollId, machineId) => {
        const response = await api.post('/production-kanban/assign', { rollId, machineId });
        return response.data;
    },
    assignRolls: async (rollIds, machineId) => {
        const response = await api.post('/production-kanban/assign', { rollIds, machineId });
        return response.data;
    },
    toggleStatus: async (rollId, action, destination) => {
        const clave = `${rollId}|${action}|${destination || ''}`;
        if (togglesEnVuelo.has(clave)) return togglesEnVuelo.get(clave);
        const promesa = api.post('/production/toggle-status', { rollId, action, destination })
            .then(response => response.data)
            .finally(() => togglesEnVuelo.delete(clave));
        togglesEnVuelo.set(clave, promesa);
        return promesa;
    },
    unassignRoll: async (rollId) => {
        const response = await api.post('/production-kanban/unassign', { rollId });
        return response.data;
    },
    magicSort: async (areaCode, selectedIds = []) => {
        const response = await api.post('/production/magic-sort', { areaCode, selectedIds });
        return response.data;
    }
};
