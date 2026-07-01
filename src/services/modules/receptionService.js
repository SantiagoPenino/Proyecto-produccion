import api from '../apiClient';

export const receptionService = {
    getInitData: async () => {
        const response = await api.get('/reception/init-data');
        return response.data;
    },
    createReception: async (data) => {
        const response = await api.post('/reception/create', data);
        return response.data;
    },
    getHistory: async (filters) => {
        const params = new URLSearchParams(filters);
        const response = await api.get(`/reception/history?${params.toString()}`);
        return response.data;
    },
    getOrdersByClient: async (cliente) => {
        const response = await api.get(`/reception/orders-by-client?cliente=${encodeURIComponent(cliente)}`);
        return response.data;
    },
    getStock: async () => {
        const response = await api.get('/reception/stock');
        return response.data;
    },
    getOrdersForFabric: async (cliente, area, type) => {
        const response = await api.get(`/reception/orders-for-fabric?cliente=${encodeURIComponent(cliente)}&area=${encodeURIComponent(area || '')}&type=${encodeURIComponent(type || '')}`);
        return response.data;
    },
    guardarComprobante: async (nombreDocumento, pdfBase64) => {
        const response = await api.post('/reception/guardar-comprobante', { nombreDocumento, pdfBase64 });
        return response.data;
    },

    // Búsqueda full de clientes (devuelve objetos con Nombre, Email, Telefono, Direccion, etc.)
    searchClientes: async (q) => {
        try {
            const response = await api.get(`/contabilidad/clientes-activos?q=${encodeURIComponent(q)}&tipo=TODOS`);
            const data = response.data?.data || response.data || [];
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    },

    // Saldo de telas del cliente (para badges + "sumar a tela existente")
    getSaldoTelas: async (clienteId) => {
        try {
            const response = await api.get(`/tela-cliente/${encodeURIComponent(clienteId)}/saldo`);
            return response.data?.saldos || response.data?.data || [];
        } catch {
            return [];
        }
    },

    getBobinasByOrden: async (orden) => {
        try {
            const response = await api.get(`/reception/bobinas-by-orden/${encodeURIComponent(orden)}`);
            return response.data?.bobinas || [];
        } catch {
            return [];
        }
    },


};
