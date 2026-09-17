import api from '../apiClient';

// =====================================================================
// CONSULTA AL CLIENTE (SB · DTF · ECOUV) — llamados de la planta
// =====================================================================
// El portal del cliente NO usa este módulo: sus dos endpoints viven bajo
// /web-orders/consultas y los llama el portal con su propio apiClient.
// Plan: docs/consultas-cliente-plan.md §8.

export const consultasService = {
    // Catálogo MotivosConsulta (se agregan motivos sin deploy).
    getMotivos: async () => {
        const response = await api.get('/consultas/motivos');
        return response.data?.data || [];
    },

    // Todas las consultas de una orden (abiertas e históricas), con sus fotos.
    getPorOrden: async (ordenId) => {
        const response = await api.get(`/consultas/orden/${ordenId}`);
        return response.data?.data || [];
    },

    /**
     * Crea la consulta y frena la orden.
     * `fotos` son File del input; van como multipart porque el backend las guarda
     * en disco (carpeta por consulta), no en la base.
     */
    crear: async ({ ordenId, archivoId, motivoId, pregunta, fotos = [] }) => {
        const formData = new FormData();
        formData.append('ordenId', ordenId);
        if (archivoId) formData.append('archivoId', archivoId);
        formData.append('motivoId', motivoId);
        formData.append('pregunta', pregunta);
        fotos.forEach(f => formData.append('fotos', f));
        const response = await api.post('/consultas', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },

    // El operario da de baja su propia consulta: libera la orden al estado previo.
    retirar: async (consultaId, motivo) => {
        const response = await api.post(`/consultas/${consultaId}/retirar`, { motivo });
        return response.data;
    },

    /**
     * La foto de una consulta como blob URL.
     * La ruta es autenticada (mismo patrón que los adjuntos de tickets), así que un
     * <img src="/api/..."> pelado da 401: hay que bajarla con el token y armar el
     * object URL. Quien la use tiene que revocarlo al desmontar.
     */
    getFotoUrl: async (consultaId, fotoId) => {
        const response = await api.get(`/consultas/foto/${consultaId}/${fotoId}`, { responseType: 'blob' });
        return URL.createObjectURL(response.data);
    },
};
