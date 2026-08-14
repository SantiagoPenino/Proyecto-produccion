import api from '../apiClient';

export const feriadosService = {
    getAll: async () => {
        const response = await api.get('/feriados');
        return response.data;
    },
    create: async (data) => {
        const response = await api.post('/feriados', data);
        return response.data;
    },
    update: async (fechaOriginal, data) => {
        const response = await api.put(`/feriados/${fechaOriginal}`, data);
        return response.data;
    },
    delete: async (fecha) => {
        const response = await api.delete(`/feriados/${fecha}`);
        return response.data;
    }
};
