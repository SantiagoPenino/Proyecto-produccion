import api from '../apiClient';

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
        const response = await api.post('/production/toggle-status', { rollId, action, destination });
        return response.data;
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
