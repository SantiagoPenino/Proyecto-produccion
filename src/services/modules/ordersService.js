import api from '../apiClient';

export const ordersService = {
    getByArea: async (areaCode, mode = 'active') => {
        const response = await api.get(`/orders?area=${areaCode}&mode=${mode}`);
        return response.data;
    },
    getActiveSummary: async (areaKey) => {
        const params = areaKey ? { area: areaKey } : {};
        const response = await api.get('/orders/active', { params });
        return response.data;
    },
    getCancelledSummary: async (areaKey) => {
        const params = areaKey ? { area: areaKey } : {};
        const response = await api.get('/orders/cancelled', { params });
        return response.data;
    },
    getFailedSummary: async (areaKey) => {
        const params = areaKey ? { area: areaKey } : {};
        const response = await api.get('/orders/failed', { params });
        return response.data;
    },
    create: async (orderData) => {
        const response = await api.post('/orders', orderData);
        return response.data;
    },
    updateStatus: async (orderId, newStatus) => {
        const response = await api.put(`/orders/${orderId}/status`, { status: newStatus });
        return response.data;
    },
    getPriorities: async (areaCode) => {
        const response = await api.get(`/orders/priorities?area=${areaCode}`);
        return response.data;
    },
    assignRoll: async (orderIdsOrPayload, rollId) => {
        const payload = Array.isArray(orderIdsOrPayload)
            ? { orderIds: orderIdsOrPayload, rollId }
            : orderIdsOrPayload;
        const response = await api.post('/orders/assign-roll', payload);
        return response.data;
    },
    unassignRoll: async (orderId) => {
        const response = await api.post('/orders/unassign-roll', { orderId });
        return response.data;
    },

    assignFabricBobbin: async (orderId, bobinaId) => {
        const response = await api.post('/orders/assign-fabric-bobbin', { orderId, bobinaId });
        return response.data;
    },
    updateFile: async (fileData) => {
        const response = await api.put('/orders/file/update', fileData);
        return response.data;
    },
    updateService: async (serviceData) => {
        const response = await api.put('/orders/service/update', serviceData);
        return response.data;
    },
    addFile: async (fileData) => {
        const response = await api.post('/orders/file/add', fileData);
        return response.data;
    },
    deleteFile: async (fileId) => {
        const response = await api.delete(`/orders/file/${fileId}`);
        return response.data;
    },
    getById: async (orderId, area) => {
        let url = `/orders?q=${orderId}`;
        if (area) url += `&area=${area}`;
        const response = await api.get(url);
        // Si no devuelve array, asumimos objeto unico o array vacio
        return Array.isArray(response.data) ? response.data[0] : response.data;
    },
    cancel: async (payload) => {
        const response = await api.post('/orders/cancel', payload);
        return response.data;
    },
    cancelOrder: async (payload) => { // Alias explícito para evitar error en Modal
        const response = await api.post('/orders/cancel', payload);
        return response.data;
    },
    cancelRequest: async (payload) => {
        const response = await api.post('/orders/cancel-request', payload);
        return response.data;
    },
    cancelFile: async (payload) => {
        const response = await api.post('/orders/file/cancel', payload);
        return response.data;
    },
    advancedSearch: async (filters) => {
        const response = await api.post('/orders/search/advanced', filters);
        return response.data;
    },
    getFullDetails: async (orderId) => {
        const response = await api.get(`/orders/details/${orderId}`);
        return response.data;
    },
    getIntegralDetails: async (ref) => {
        const response = await api.get(`/orders/search/integral/${encodeURIComponent(ref)}`);
        return response.data;
    },
    getReferences: async (orderId) => {
        const response = await api.get(`/orders/${orderId}/references`);
        return response.data;
    },
    getServices: async (orderId) => {
        const response = await api.get(`/orders/${orderId}/services`);
        return response.data;
    }
};
