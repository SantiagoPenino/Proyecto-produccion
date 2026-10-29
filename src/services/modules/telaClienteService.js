import api from '../api';

// Devolución física de excedente — ver backend/services/telaClienteDevolucionFisicaService.js
export const telaClienteService = {
    // Botón ↶ de la bobina (vista interna), sin pasar por la bandeja: DEVOLVER aprueba y empaqueta
    // (devuelve la orden DEV-<n> y los datos de la etiqueta); DESCARTAR cierra la bobina. El canal
    // (Retiro/Encomienda) se define recién cuando el cliente retira, por el circuito normal de retiros.
    devolverDesdeInventario: async (clienteId, bobinaId, { accion, observaciones }) => {
        const response = await api.post(`/tela-cliente/${clienteId}/bobinas/${bobinaId}/devolver-ahora`, {
            accion, observaciones,
        });
        return response.data;
    },

    getBandeja: async (estado) => {
        const response = await api.get('/tela-cliente/bandeja', { params: estado ? { estado } : {} });
        return response.data;
    },

    getParaEmpaquetar: async () => {
        const response = await api.get('/tela-cliente/bandeja/para-empaquetar');
        return response.data;
    },

    aprobarEvento: async (tevId) => {
        const response = await api.post(`/tela-cliente/bandeja/${tevId}/aprobar`);
        return response.data;
    },

    rechazarEvento: async (tevId, motivo) => {
        const response = await api.post(`/tela-cliente/bandeja/${tevId}/rechazar`, { motivo });
        return response.data;
    },

    // La tela se le dio en mano al cliente: cierra la solicitud (y la bobina, si sigue abierta)
    marcarEntregada: async (tevId, nota) => {
        const response = await api.post(`/tela-cliente/bandeja/${tevId}/entregada`, { nota });
        return response.data;
    },

    empaquetarDevolucion: async (tevId) => {
        const response = await api.post(`/tela-cliente/bandeja/${tevId}/empaquetar`);
        return response.data;
    },

    marcarAvisoEnviado: async (tevId) => {
        const response = await api.post(`/tela-cliente/bandeja/${tevId}/marcar-enviado`);
        return response.data;
    },
};
