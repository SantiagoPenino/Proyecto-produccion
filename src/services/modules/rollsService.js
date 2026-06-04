import api from '../apiClient';

export const rollsService = {
    getBoard: async (areaCode) => {
        const response = await api.get(`/rolls/board?area=${areaCode}`);
        return response.data;
    },
    getActiveRolls: async (areaCode) => {
        const response = await api.get(`/rolls/list?areaId=${areaCode}`);
        return response.data;
    },
    moveOrder: async (data) => {
        const response = await api.post('/rolls/move', data);
        return response.data;
    },
    create: async (data) => {
        const response = await api.post('/rolls/create', data);
        return response.data;
    },
    reorderOrders: async (rollId, orderIds) => {
        const response = await api.post('/rolls/reorder', { rollId, orderIds });
        return response.data;
    },
    updateName: async (id, name, color) => {
        const { data } = await api.post('/rolls/update-name', { id, name, color });
        return data;
    },
    update: async (rollId, updates) => { // ✅ Nuevo mètodo genérico
        const { data } = await api.post('/rolls/update', { rollId, ...updates });
        return data;
    },
    swapBobina: async (data) => {
        const res = await api.post('/rolls/swap-bobina', data);
        return res.data;
    },
    splitRoll: async (data) => {
        const res = await api.post('/rolls/split', data);
        return res.data;
    },

    generateLabels: async (id) => {
        const { data } = await api.post(`/rolls/${id}/generate-labels`);
        return data;
    },
    getLabels: async (id) => {
        const { data } = await api.get(`/rolls/${id}/labels`);
        return data;
    },
    getDetails: async (rollId) => {
        const response = await api.get(`/rolls/details/${rollId}`);
        return response.data;
    },
    dismantle: async (rollId) => {
        const response = await api.post('/rolls/dismantle', { rollId });
        return response.data;
    },
    getHistory: async (search, area, page = 1) => {
        // search: string, area: string (optional), page: number
        const params = { search, page };
        if (area) params.area = area;
        const response = await api.get(`/rolls/history`, { params });
        return response.data;
    },
    magicAssignment: async (areaId) => {
        const response = await api.post('/rolls/magic', { areaId });
        return response.data;
    },
    downloadFilesByOrders: async (orderIds) => {
        const response = await api.post('/measurements/process-batch-by-orders', { orderIds });
        return response.data;
    },
    downloadZip: async (orderIds) => {
        const response = await api.post('/measurements/download-zip', { orderIds }, { responseType: 'blob' });
        return response.data;
    },
    reorderPendingOrders: async (areaId, orderIds, movedId) => {
        const { data } = await api.post('/rolls/reorder-pending', { areaId, orderIds, movedId });
        return data;
    },
    reorderRolls: async (areaId, rollIds, movedId) => {
        const { data } = await api.post('/rolls/reorder-rolls', { areaId, rollIds, movedId });
        return data;
    },
    getNextRollName: async (areaCode) => {
        const response = await api.get(`/rolls/next-name?area=${areaCode}`);
        return response.data; // { name: '20260603-df1' }
    },
};

