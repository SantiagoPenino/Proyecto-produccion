import api from '../apiClient';

export const horarioLaboralService = {
    getAll: async (areaID) => {
        const response = await api.get('/horario-laboral', { params: areaID ? { area: areaID } : {} });
        return response.data;
    },
    create: async (data) => {
        const response = await api.post('/horario-laboral', data);
        return response.data;
    },
    update: async (id, data) => {
        const response = await api.put(`/horario-laboral/${id}`, data);
        return response.data;
    },
    delete: async (id) => {
        const response = await api.delete(`/horario-laboral/${id}`);
        return response.data;
    }
};
