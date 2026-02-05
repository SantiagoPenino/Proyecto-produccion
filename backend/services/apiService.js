const axios = require('axios');

const apiClient = axios.create({
    baseURL: `${process.env.ERP_API_URL || 'http://localhost:6061'}/api`,
    headers: { 'Accept': 'application/json' }
});

// Función principal para obtener el pedido con sublíneas
const getPedidoCompleto = async (id) => {
    try {
        const response = await apiClient.get(`/pedidos/${id}/con_sublineas`);
        return response.data.data;
    } catch (error) {
        console.error(`Error fetching order ${id}:`, error.message);
        throw error;
    }
};

module.exports = {
    getPedidoCompleto
};