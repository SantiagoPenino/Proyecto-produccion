import api from '../apiClient';

export const fileControlService = {
    /**
     * Obtiene los rollos activos para el combo de filtrado
     */
    getRollosActivos: async (areaId) => {
        // Backend: /rollos o /rollos-activos
        const response = await api.get('/production-file-control/rollos', {
            params: { areaId }
        });
        return response.data;
    },

    /**
     * Obtiene las órdenes filtradas. 
     */
    getOrdenes: async (searchTerm, rolloId, areaId) => {
        // Backend: /ordenes
        const response = await api.get('/production-file-control/ordenes', {
            params: {
                search: searchTerm,
                rolloId: rolloId || null,
                area: areaId // Backend expects 'area', frontend sent 'areaId'. Cleaned in backend, but safer to match.
            }
        });
        return response.data;
    },

    /**
     * Obtiene los archivos específicos de una orden
     */
    getArchivosPorOrden: async (ordenId) => {
        // Backend: /orden/:ordenId/archivos
        const response = await api.get(`/production-file-control/orden/${ordenId}/archivos`);
        return response.data;
    },

    /**
     * Registra el control (Listo/Falla) de un archivo
     */
    postControl: async (payload) => {
        // Backend: /controlar
        const response = await api.post('/production-file-control/controlar', payload);
        return response.data;
    },

    getTiposFalla: async (areaId) => {
        const response = await api.get('/production-file-control/tipos-falla', { params: { areaId } });
        return response.data;
    },

    getMotivosCancelacion: async () => {
        const response = await api.get('/production-file-control/motivos-cancelacion');
        return response.data;
    },


    /**
     * Obtiene métricas del Rollo
     */
    getRolloMetrics: async (rolloId) => {
        // Backend: /rollo/:rolloId/metrics
        const response = await api.get(`/production-file-control/rollo/${rolloId}/metrics`);
        return response.data;
    },

    /**
     * Obtiene métricas del Pedido (Global)
     */
    getPedidoMetrics: async (noDocErp, areaId) => {
        // Backend: /pedido/:noDocErp/metrics
        let url = `/production-file-control/pedido/${encodeURIComponent(noDocErp)}/metrics`;
        if (areaId) url += `?areaId=${encodeURIComponent(areaId)}`;
        const response = await api.get(url);
        return response.data;
    },

    getEtiquetas: async (ordenId) => {
        // Backend: /orden/:ordenId/etiquetas
        const response = await api.get(`/production-file-control/orden/${ordenId}/etiquetas`);
        return response.data;
    },

    regenerateLabels: async (ordenId, cantidad) => {
        const response = await api.post(`/production-file-control/regen-labels/${ordenId}`, { cantidad });
        return response.data;
    },

    recalcularContadores: async (ordenId) => {
        const response = await api.post(`/production-file-control/recalc-labels/${ordenId}`);
        return response.data;
    },

    createExtraLabel: async (ordenId) => {
        const response = await api.post(`/production-file-control/orden/${ordenId}/etiqueta-extra`, { ordenId });
        return response.data;
    },

    deleteLabel: async (id) => {
        const response = await api.delete(`/production-file-control/etiqueta/${id}`);
        return response.data;
    },

    updateFileCopyCount: async (archivoId, count, isService) => {
        const response = await api.post('/production-file-control/update-copy-count', { archivoId, count, isService });
        return response.data;
    },

    getFallaTypes: async (areaId) => {
        return fileControlService.getTiposFalla(areaId);
    },

    controlarArchivo: async (payload) => {
        return fileControlService.postControl(payload);
    },

    searchDeliveredOrders: async (query) => {
        const response = await api.get('/production-file-control/ordenes/entregadas', { params: { q: query } });
        return response.data;
    },

    createReplacement: async (payload) => {
        const response = await api.post('/production-file-control/ordenes/reposicion', payload);
        return response.data;
    },

    getRelatedOrders: async (ordenId) => {
        const response = await api.get(`/production-file-control/orden/${ordenId}/relacionadas`);
        return response.data;
    },

    completarOrden: async (ordenId) => {
        const response = await api.post(`/production-file-control/orden/${ordenId}/completar`);
        return response.data;
    }
};
