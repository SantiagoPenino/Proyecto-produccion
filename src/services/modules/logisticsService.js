import api from '../../services/api';

const logisticsService = {
    // --- BULTOS (PACKING) ---
    createBulto: async (data) => {
        // data: { codigoEtiqueta, tipo, ordenId, descripcion, ubicacion, usuarioId }
        const response = await api.post('/logistics/bultos', data);
        return response.data;
    },

    getBultoByLabel: async (label) => {
        const response = await api.get(`/logistics/bultos/${label}`);
        return response.data;
    },

    // --- REMITOS (DISPATCH) ---
    createRemito: async (data) => {
        // data: { codigoRemito, areaOrigen, areaDestino, usuarioId, bultosIds }
        const response = await api.post('/logistics/remitos', data);
        return response.data;
    },

    validateDispatch: async (bultosIds) => {
        const response = await api.post('/logistics/remitos/validate', { bultosIds });
        return response.data;
    },

    getRemitoByCode: async (code) => {
        const response = await api.get(`/logistics/remitos/${encodeURIComponent(code)}`);
        return response.data;
    },

    getIncomingRemitos: async (areaId) => {
        const response = await api.get('/logistics/remitos/incoming', { params: { areaId } });
        return response.data;
    },

    getOutgoingRemitos: async (areaId) => {
        const response = await api.get('/logistics/remitos/outgoing', { params: { areaId } });
        return response.data;
    },

    // --- RECEPCIÓN ---
    receiveBulto: async (data) => {
        // data: { envioId, codigoEtiqueta, usuarioId }
        const response = await api.post('/logistics/receive', data);
        return response.data;
    },

    receiveDispatchItem: async (data) => {
        const response = await api.post('/logistics/receive', data);
        return response.data;
    },

    // --- DASHBOARD ---
    getDashboard: async (areaId) => {
        const response = await api.get('/logistics/dashboard', { params: { areaId } });
        return response.data;
    },

    // --- ACCIONES ADICIONALES ---
    addParcel: async (orderId) => {
        const response = await api.post('/logistics/add-parcel', { orderId });
        return response.data;
    },

    getLabels: async (orderIds) => {
        const response = await api.post('/logistics/labels', { orderIds });
        return response.data;
    },

    // Mapeando endpoints viejos si se usan en PackingView antiguo
    getHistory: async (areaId) => {
        const response = await api.get('/logistics/history', { params: { areaId } });
        return response.data;
    },
    createParcel: async (data) => api.post('/logistics/bultos', data).then(r => r.data),
    createDispatch: async (data) => api.post('/logistics/remitos', data).then(r => r.data),

    confirmTransport: async (data) => {
        const response = await api.post('/logistics/transport/confirm', data);
        return response.data;
    },

    getActiveTransports: async () => {
        const response = await api.get('/logistics/transport/active');
        return response.data;
    },

    getAreaStock: async (areaId) => {
        const params = areaId ? { areaId } : {};
        const response = await api.get('/logistics/stock', { params });
        return response.data;
    },
    // --- EXTRAVIADOS ---
    getLostItems: async () => {
        const response = await api.get('/logistics/lost');
        return response.data;
    },

    recoverItem: async (data) => {
        const response = await api.post('/logistics/recover', data);
        return response.data;
    },
};

export { logisticsService };
