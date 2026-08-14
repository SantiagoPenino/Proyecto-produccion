import api from '../apiClient';

export const planificacionService = {
    getAgenda: async (area, desde, hasta) => {
        const response = await api.get('/planificacion/agenda', { params: { area, desde, hasta } });
        return response.data;
    },
    getCapacidad: async (area, desde, dias) => {
        const response = await api.get('/planificacion/capacidad', { params: { area, desde, dias } });
        return response.data;
    },
    getHistorico: async (area, dias) => {
        const response = await api.get('/planificacion/historico', { params: { area, dias } });
        return response.data;
    },
    getDetalleGrupo: async (area, fecha, grupo) => {
        const response = await api.get('/planificacion/capacidad/detalle', { params: { area, fecha, grupo } });
        return response.data;
    }
};
