import api from '../apiClient';

// [BANDEJA GENÉRICA] Bandeja de órdenes (no lotes) — ver backend/controllers/embBoardController.js.
// Nació para Bordado (EMB) y se generalizó para Estampado (EST): mismo controlador del
// lado del backend, cada área pega a su propio prefijo (/emb o /est) y el backend fuerza
// el área ahí (estRoutes.js), así que del lado del cliente no hace falta mandarla aparte.
const createBandejaService = (basePath) => ({
    getOrders: async (fase = 'trabajo') => {
        const response = await api.get(`${basePath}/orders`, { params: { fase } });
        return response.data?.data || [];
    },
    getOrdersBloqueadas: async () => {
        const response = await api.get(`${basePath}/orders/bloqueadas`);
        return response.data?.data || [];
    },
    getMaquinas: async () => {
        const response = await api.get(`${basePath}/maquinas`);
        return response.data?.data || [];
    },
    asignarMaquina: async (ordenId, maquinaId) => {
        const response = await api.put(`${basePath}/orders/${ordenId}/maquina`, { maquinaId });
        return response.data;
    },
    asignarOperario: async (ordenId, operarioId) => {
        const response = await api.put(`${basePath}/orders/${ordenId}/operario`, { operarioId });
        return response.data;
    },
    // estado: 'EN_PROCESO' | 'PAUSADO' | null (volver a "sin iniciar")
    setEstadoTrabajo: async (ordenId, estado) => {
        const response = await api.put(`${basePath}/orders/${ordenId}/trabajo`, { estado });
        return response.data;
    },
    setProgreso: async (ordenId, cantidadTerminada) => {
        const response = await api.put(`${basePath}/orders/${ordenId}/progreso`, { cantidadTerminada });
        return response.data;
    },
    // Bandeja (trabajo) -> Control y Calidad. No genera etiqueta todavía.
    finalizarTrabajo: async (ordenId) => {
        const response = await api.post(`${basePath}/orders/${ordenId}/finalizar-trabajo`);
        return response.data;
    },
    // Contador de Control (unidades ya verificadas), aparte del de trabajo (CantidadTerminada).
    setProgresoControl: async (ordenId, cantidadControlada) => {
        const response = await api.put(`${basePath}/orders/${ordenId}/progreso-control`, { cantidadControlada });
        return response.data;
    },
    // Aprobar Control: pasa a Pronto y genera `bultos` etiquetas.
    aprobarControl: async (ordenId, bultos) => {
        const response = await api.post(`${basePath}/orders/${ordenId}/aprobar-control`, { bultos });
        return response.data;
    },
});

export const embBoardService = createBandejaService('/emb');
export const estBoardService = createBandejaService('/est');
export const twcBoardService = createBandejaService('/twc');
export const twtBoardService = createBandejaService('/twt');

const SERVICES_POR_AREA = {
    EMB: embBoardService,
    EST: estBoardService,
    TWC: twcBoardService,
    TWT: twtBoardService,
};

// Selector por área — usado por el componente genérico de bandeja (EmbBandeja.jsx).
export const getBandejaService = (area) => (
    SERVICES_POR_AREA[(area || '').toString().trim().toUpperCase()] || embBoardService
);
