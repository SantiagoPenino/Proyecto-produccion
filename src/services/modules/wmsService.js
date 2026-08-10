import api from '../apiClient';

export const wmsService = {
    getCatalog: async () => {
        const response = await api.get('/wms/catalog');
        return response.data;
    },
    syncCatalog: async () => {
        const response = await api.post('/wms/sync');
        return response.data;
    },
    createOrder: async (orderData) => {
        const response = await api.post('/wms/order', orderData);
        return response.data;
    },
    getExchangeRate: async () => {
        const response = await api.get('/wms/exchange-rate');
        return response.data;
    },
    
    // Logistics
    getPendingOrders: async () => {
        const response = await api.get('/wms-logistica/pending');
        return response.data;
    },
    startPreparation: async (pedidoId) => {
        const response = await api.put(`/wms-logistica/start/${pedidoId}`);
        return response.data;
    },
    confirmPreparation: async (pedidoId) => {
        const response = await api.put(`/wms-logistica/confirm/${pedidoId}`);
        return response.data;
    },
    getPreparedOrders: async () => {
        const response = await api.get('/wms-logistica/prepared');
        return response.data;
    },
    receivePreparedOrder: async (pedidoId) => {
        const response = await api.put(`/wms-logistica/receive/${pedidoId}`);
        return response.data;
    },
    updateItemQuantity: async (pedidoId, data) => {
        const response = await api.put(`/wms-logistica/update-item/${pedidoId}`, data);
        return response.data;
    },
    deleteItem: async (pedidoId, wms_variante_id) => {
        const response = await api.delete(`/wms-logistica/delete-item/${pedidoId}/${wms_variante_id}`);
        return response.data;
    },
    cancelOrder: async (pedidoId) => {
        const response = await api.put(`/wms-logistica/cancel/${pedidoId}`);
        return response.data;
    },
    markDelivered: async (pedidoId) => {
        const response = await api.put(`/wms-logistica/deliver/${pedidoId}`);
        return response.data;
    },
    // [WMS] Trazabilidad y notas del pedido (PedidosCobranzaEventos)
    getEventos: async (pedidoId) => {
        const response = await api.get(`/wms-logistica/eventos/${pedidoId}`);
        return response.data;
    },
    // [WMS] Pestaña Historial: pedidos terminados/cancelados, con búsqueda
    getHistorialPedidos: async (search = '') => {
        const response = await api.get('/wms-logistica/historial', { params: { search } });
        return response.data;
    },
    // [WMS] Bulto extra del pedido (etiquetas 1/2, 2/2...)
    addBultoPedido: async (pedidoId) => {
        const response = await api.post(`/wms-logistica/bulto-extra/${pedidoId}`);
        return response.data;
    },
    addNota: async (pedidoId, nota) => {
        const response = await api.post(`/wms-logistica/nota/${pedidoId}`, { nota });
        return response.data;
    },

    // [PRENDAS] "Comprar y personalizar" — la prenda es una Orden real (no PedidosCobranza),
    // así que su retiro de depósito WMS pasa por prendas-orders, no por wms-logistica.
    getRetirosPrendas: async () => {
        const response = await api.get('/prendas-orders/retiros-wms-pendientes');
        return response.data?.data || [];
    },
    iniciarPreparacionPrenda: async (ordenId) => {
        const response = await api.put(`/prendas-orders/${ordenId}/iniciar-preparacion-retiro`);
        return response.data;
    },
    actualizarCantidadPrenda: async (ordenId, nuevaCantidad) => {
        const response = await api.put(`/prendas-orders/${ordenId}/actualizar-cantidad-retiro`, { nuevaCantidad });
        return response.data;
    },
    confirmarRetiroPrendas: async (ordenId) => {
        const response = await api.put(`/prendas-orders/${ordenId}/confirmar-retiro-wms`);
        return response.data;
    },

    // [PRENDAS/WMS] Bandeja de etiquetas del área PRO (prendas personalizadas + ventas
    // directas) para reimprimir sin salir de Logística WMS.
    getEtiquetasPro: async (search = '') => {
        const response = await api.get('/production-file-control/ordenes-labels', { params: { area: 'PRO', search } });
        return response.data;
    }
};
