import api from '../apiClient';

// To-Do compartido del sistema interno. Cualquiera crea, cualquiera marca hecha;
// el backend registra quién creó y quién realizó cada tarea.
export const tareasService = {
    list: async (estado = 'todas') => {
        const res = await api.get(`/tareas?estado=${encodeURIComponent(estado)}`);
        return res.data;
    },
    create: async (data) => {
        const res = await api.post('/tareas', data);
        return res.data;
    },
    setHecha: async (id, hecha) => {
        const res = await api.put(`/tareas/${id}/hecha`, { hecha });
        return res.data;
    },
    remove: async (id) => {
        const res = await api.delete(`/tareas/${id}`);
        return res.data;
    },
};
