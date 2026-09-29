import api from '../apiClient';

// Campanita del sistema interno: avisos por usuario (backend: /api/notificaciones).
export const notificacionesService = {
    listar: async () => (await api.get('/notificaciones')).data,
    marcarLeida: async (id) => (await api.post(`/notificaciones/${id}/leida`)).data,
    marcarTodas: async () => (await api.post('/notificaciones/leer-todas')).data,
    suscribirPush: async (subscription, dispositivo) =>
        (await api.post('/notificaciones/push/suscribir', { subscription, dispositivo })).data,
    desuscribirPush: async (endpoint) => (await api.post('/notificaciones/push/desuscribir', { endpoint })).data,
    probarPush: async () => (await api.post('/notificaciones/push/probar')).data,
    // Clave pública VAPID (misma ruta pública que usa el portal).
    clavePush: async () => (await api.get('/push/vapid-key')).data?.publicKey,
};
