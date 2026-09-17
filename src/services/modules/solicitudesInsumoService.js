import api from '../apiClient';

// Spec 39 — Solicitudes de insumo del cliente (bandeja de Atención al Cliente / Administración)
export const solicitudesInsumoService = {
    listar: async (estado = 'ABIERTAS') => (await api.get('/solicitudes-insumo', { params: { estado } })).data,
    detalle: async (id) => (await api.get(`/solicitudes-insumo/${id}`)).data,
    abiertasCliente: async (clienteId) => (await api.get('/solicitudes-insumo/abiertas-cliente', { params: { clienteId } })).data,
    notificar: async (id, mensaje) => (await api.post(`/solicitudes-insumo/${id}/notificar`, { mensaje })).data,
    /** decision: USA_STOCK | TRAE_MAS | ACEPTA_PARCIAL | COMPRA_ADMIN | VEN_INTERNA */
    decidir: async (id, payload) => (await api.post(`/solicitudes-insumo/${id}/decision`, payload)).data,
    vincularPre: async (id, payload) => (await api.post(`/solicitudes-insumo/${id}/vincular-pre`, payload)).data,
};

export default solicitudesInsumoService;
