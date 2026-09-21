import api from '../api';

// Devolución física de excedente — ver backend/services/telaClienteDevolucionFisicaService.js
export const telaClienteService = {
    // Solicitar devolución/descarte desde la vista interna de la bobina. El canal
    // (Retiro/Encomienda) y la dirección de envío ya NO se piden acá — se definen
    // recién cuando el cliente retira de verdad, por el circuito normal de retiros.
    solicitarDevolucion: async (clienteId, bobinaId, { accion, observaciones }) => {
        const response = await api.post(`/tela-cliente/${clienteId}/bobinas/${bobinaId}/solicitar`, {
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

    empaquetarDevolucion: async (tevId) => {
        const response = await api.post(`/tela-cliente/bandeja/${tevId}/empaquetar`);
        return response.data;
    },

    marcarAvisoEnviado: async (tevId) => {
        const response = await api.post(`/tela-cliente/bandeja/${tevId}/marcar-enviado`);
        return response.data;
    },
};
