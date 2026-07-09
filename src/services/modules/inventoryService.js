import api from '../api';

export const inventoryService = {
    // Obtener inventario detallado por área
    // opts.includeAgotadas: incluye bobinas Agotadas/Cerradas (solo tela de cliente)
    getInventoryByArea: async (areaId, opts = {}) => {
        const extra = opts.includeAgotadas ? '&includeAgotadas=1' : '';
        const response = await api.get(`/inventory/area?areaId=${areaId}${extra}`);
        return response.data;
    },

    // Reporte de consumo
    getReport: async (params) => {
        // params: { startDate, endDate, areaId }
        const response = await api.get('/inventory/report', { params });
        return response.data;
    },

    // Agregar Stock (Recepcion)
    addStock: async (data) => {
        // data: { insumoId, areaId, metros, cantidadBobinas, loteProv, codigoBarraBase }
        const response = await api.post('/inventory/stock/add', data);
        return response.data;
    },

    // Cerrar Bobina (Calculo Desecho)
    closeBobina: async (data) => {
        const response = await api.post('/inventory/stock/close', data);
        return response.data;
    },

    // Ajuste Manual (Sin Cierre)
    adjustBobina: async (data) => {
        const response = await api.post('/inventory/stock/adjust', data);
        return response.data;
    },

    // Historial
    getBobinaHistory: async (code) => {
        const response = await api.get(`/inventory/stock/history?code=${code}`);
        return response.data;
    },

    // CRUD Insumos
    getInsumos: async () => {
        const response = await api.get('/inventory/insumos');
        return response.data;
    },

    createInsumo: async (data) => {
        const response = await api.post('/inventory/insumos', data);
        return response.data;
    },

    updateInsumo: async (id, data) => {
        const response = await api.put(`/inventory/insumos/${id}`, data);
        return response.data;
    },

    deleteInsumo: async (id) => {
        const response = await api.delete(`/inventory/insumos/${id}`);
        return response.data;
    },

    // Confirmar medida real — Tela de Cliente
    confirmarMedida: async (bobinaId, metrosReales, ancho = null, peso = null) => {
        const response = await api.post('/inventory/stock/confirmar-medida', { bobinaId, metrosReales, ancho, peso });
        return response.data;
    },

    // Estado de cuenta por bobina de tela de cliente
    getEstadoTela: async (bobinaId) => {
        const response = await api.get(`/inventory/stock/estado-tela?bobinaId=${bobinaId}`);
        return response.data;
    }
};
