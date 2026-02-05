const axios = require('axios');

const apiClient = axios.create({
    baseURL: `${process.env.ERP_API_URL || 'http://localhost:6061'}/api`,
    timeout: 7000,
    headers: { 'Accept': 'application/json' }
});

const RestApiService = {
    getPendingHeaders: async (ultimaFact = 0) => {
        console.log(`📡 Obteniendo lista de pedidos (desde fact: ${ultimaFact})...`);
        const response = await apiClient.get(`/pedidos/todos?NroFact=${ultimaFact}`);
        return response.data.data || [];
    },

    fetchOrderDeepDetails: async (nroFact) => {
        console.log(`📡 Obteniendo detalles profundos del pedido: ${nroFact}`);
        const response = await apiClient.get(`/pedidos/${nroFact}/con_sublineas`);
        return response.data; // Devuelve el objeto con .data
    }
};

module.exports = RestApiService;