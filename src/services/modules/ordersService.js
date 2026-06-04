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
    updateAreaStatus: async (orderId, newAreaStatus) => {
        const response = await api.put(`/orders/${orderId}/area-status`, { areaStatus: newAreaStatus });
        return response.data;
    },
    getPriorities: async (areaCode) => {
        const response = await api.get(`/orders/priorities?area=${areaCode}`);
        return response.data;
    },
    getEstados: async () => {
        const response = await api.get(`/orders/estados`);
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
        // Use the direct ID endpoint to avoid returning wrong orders via text search
        try {
            const response = await api.get(`/orders/details/${orderId}`);
            const o = response.data;
            if (!o) return null;
            // Map raw SQL fields to the frontend model format
            return {
                id: o.OrdenID || o.id,
                code: o.CodigoOrden || o.code || `ORD-${o.OrdenID}`,
                client: o.Cliente || o.client || '',
                desc: o.DescripcionTrabajo || o.desc || '',
                area: o.AreaID || o.area || area || '',
                status: o.Estado || o.status || 'Pendiente',
                areaStatus: o.EstadoenArea || o.areaStatus || '',
                priority: o.Prioridad || o.priority || 'Normal',
                magnitude: o.Magnitud || o.magnitude || '',
                material: o.Material || o.material || '',
                variantCode: o.Variante || o.variantCode || '',
                ink: o.Tinta || o.ink || '',
                UM: o.UnidadMedida || o.UM || 'm',
                retiro: o.ModoRetiro || o.retiro || '',
                noDocERP: o.NoDocERP || o.noDocERP || '',
                nextService: o.ProximoServicio || o.nextService || '',
                entryDate: o.FechaIngreso || o.entryDate || null,
                deliveryDate: o.FechaEstimadaEntrega || o.deliveryDate || null,
                filesData: o.filesData || o.files || [],
            };
        } catch (e) {
            // Fallback to search if details endpoint fails
            let url = `/orders?q=${orderId}&mode=all`;
            if (area) url += `&area=${area}`;
            const response = await api.get(url);
            return Array.isArray(response.data) ? response.data[0] : response.data;
        }
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
