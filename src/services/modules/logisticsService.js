import api from '../../services/api';
import Swal from 'sweetalert2';

// [25/09] Crear un remito con aviso: si alguna orden del despacho ya se entregó al cliente, el server
// frena con 409 ORDENES_ENTREGADAS. Se pregunta y, si confirman, se reintenta con confirmarEntregadas.
// Va acá para que lo tengan todas las pantallas que despachan (Despacho, Entrega de pedidos, carrito,
// modal de despacho y generación de etiquetas). Si cancelan, el caller recibe el 409 con su mensaje.
// [01/10] Segundo aviso por el mismo camino: 409 PEDIDO_PARCIAL = del mismo pedido quedan órdenes de esta
// área fuera del remito (prontas o en producción). Se muestra el detalle y se reintenta con
// confirmarPedidoParcial. Los dos avisos pueden salir uno detrás del otro, por eso es un ciclo.
const AVISOS_REMITO = {
    ORDENES_ENTREGADAS: { flag: 'confirmarEntregadas', titulo: 'Orden ya entregada', confirmar: 'Despachar igual', color: '#dc2626' },
    PEDIDO_PARCIAL: { flag: 'confirmarPedidoParcial', titulo: 'El pedido no sale completo', confirmar: 'Enviar igual, en partes', color: '#d97706' },
};
async function postRemitoConAviso(url, data) {
    let cuerpo = { ...data };
    for (let intento = 0; intento < 4; intento++) {
        try {
            return (await api.post(url, cuerpo)).data;
        } catch (err) {
            const d = err.response?.data;
            const aviso = err.response?.status === 409 ? AVISOS_REMITO[d?.codigo] : null;
            if (!aviso || cuerpo[aviso.flag]) throw err;
            const { isConfirmed } = await Swal.fire({
                icon: 'warning',
                title: aviso.titulo,
                html: `<div style="text-align:left;white-space:pre-line;font-size:14px">${String(d.error || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`,
                showCancelButton: true,
                confirmButtonText: aviso.confirmar,
                cancelButtonText: 'Cancelar y revisar',
                confirmButtonColor: aviso.color,
                cancelButtonColor: '#64748b',
            });
            if (!isConfirmed) throw err;
            cuerpo = { ...cuerpo, [aviso.flag]: true };
        }
    }
    return (await api.post(url, cuerpo)).data;
}

const logisticsService = {
    // --- BULTOS (PACKING) ---
    createBulto: async (data) => {
        // data: { codigoEtiqueta, tipo, ordenId, descripcion, ubicacion, usuarioId }
        const response = await api.post('/logistics/bultos', data);
        return response.data;
    },

    getBultoByLabel: async (label) => {
        const response = await api.get(`/logistics/bultos/${label}`);
        return response.data;
    },

    // --- REMITOS (DISPATCH) ---
    createRemito: async (data) => {
        // data: { codigoRemito, areaOrigen, areaDestino, usuarioId, bultosIds }
        return postRemitoConAviso('/logistics/remitos', data);
    },

    validateDispatch: async (bultosIds) => {
        const response = await api.post('/logistics/remitos/validate', { bultosIds });
        return response.data;
    },

    confirmDeliveryWithProof: async (code, fileFormData) => {
        const response = await api.post(`/logistics/remitos/${encodeURIComponent(code)}/confirm-delivery`, fileFormData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    },

    createRemitoFromOrders: async (data) => {
        return postRemitoConAviso('/logistics/remitos/from-orders', data);
    },

    getRemitoByCode: async (code) => {
        const response = await api.get(`/logistics/remitos/${encodeURIComponent(code)}`);
        return response.data;
    },

    searchRemitos: async (query) => {
        const response = await api.get('/logistics/remitos/search', { params: { query } });
        return response.data;
    },

    getIncomingRemitos: async (areaId) => {
        const response = await api.get('/logistics/remitos/incoming', { params: { areaId } });
        return response.data;
    },

    getOutgoingRemitos: async (areaId) => {
        const response = await api.get('/logistics/remitos/outgoing', { params: { areaId } });
        return response.data;
    },

    // --- RECEPCIÓN ---
    receiveBulto: async (data) => {
        // data: { envioId, codigoEtiqueta, usuarioId }
        const response = await api.post('/logistics/receive', data);
        return response.data;
    },

    receiveDispatchItem: async (data) => {
        const response = await api.post('/logistics/receive', data);
        return response.data;
    },

    getEsperandoBultos: async () => {
        const response = await api.get('/logistics/esperando-bultos');
        return response.data;
    },

    // --- LIBRO DE ENTREGAS (Spec 39): envío parcial, complementos, lo que falta de este pedido ---
    getLibroConfig: async () => (await api.get('/logistics/libro/config')).data,
    getLibroOrden: async (ordenId) => (await api.get(`/logistics/libro/orden/${ordenId}`)).data,
    getLibroPedido: async (noDoc) => (await api.get(`/logistics/libro/pedido/${encodeURIComponent(String(noDoc).trim())}`)).data,
    getPendientesArea: async (noDoc, area) => (await api.get('/logistics/libro/pendientes', { params: { noDoc: String(noDoc).trim(), area } })).data,
    getEnvioInfo: async (ordenIds, areaOrigen, areaDestino) => (await api.post('/logistics/libro/envio-info', { ordenIds, areaOrigen, areaDestino })).data,
    // Reposiciones de una orden (accesible desde cualquier área) — usada por el detalle de
    // orden para mostrar SOLO el archivo puntual de la madre a reponer, sin traer nada más.
    getReposicionesOrden: async (ordenId) => (await api.get(`/logistics/reposiciones/orden/${ordenId}`)).data,

    forzarIngreso: async (ordenId, usuarioId) => {
        const response = await api.post('/logistics/receive', {
            forzarOrdenes: [ordenId],
            usuarioId,
            areaReceptora: 'DEPOSITO'
        });
        return response.data;
    },

    // --- CONTROL PRO (FASE 6) ---
    getPedidosCompletosPRO: async () => {
        const response = await api.get('/logistics/pro/pedidos-completos');
        return response.data;
    },

    aprobarControlPRO: async (noDocERP, cantidadBultos = 1) => {
        const response = await api.post(`/logistics/pro/pedidos/${encodeURIComponent(noDocERP)}/aprobar-control`, { cantidadBultos });
        return response.data;
    },

    // --- DASHBOARD ---
    getDashboard: async (areaId) => {
        const response = await api.get('/logistics/dashboard', { params: { areaId } });
        return response.data;
    },

    // --- ACCIONES ADICIONALES ---
    addParcel: async (orderId) => {
        const response = await api.post('/logistics/add-parcel', { orderId });
        return response.data;
    },

    getLabels: async (orderIds) => {
        const response = await api.post('/logistics/labels', { orderIds });
        return response.data;
    },

    // Mapeando endpoints viejos si se usan en PackingView antiguo
    getHistory: async (areaId) => {
        const response = await api.get('/logistics/history', { params: { areaId } });
        return response.data;
    },
    createParcel: async (data) => api.post('/logistics/bultos', data).then(r => r.data),
    createDispatch: async (data) => postRemitoConAviso('/logistics/remitos', data),

    confirmTransport: async (data) => {
        const response = await api.post('/logistics/transport/confirm', data);
        return response.data;
    },

    // filtros: { tipo: 'ENCOMIENDA'|'PRODUCCION', estado: 'ACTIVOS', q } — se aplican en el backend
    getActiveTransports: async (filtros = {}) => {
        const response = await api.get('/logistics/transport/active', { params: filtros });
        return response.data;
    },

    getAreaStock: async (areaId) => {
        const params = areaId ? { areaId } : {};
        const response = await api.get('/logistics/stock', { params });
        return response.data;
    },
    // --- EXTRAVIADOS ---
    getLostItems: async () => {
        const response = await api.get('/logistics/lost');
        return response.data;
    },

    recoverItem: async (data) => {
        const response = await api.post('/logistics/recover', data);
        return response.data;
    },

    // --- DEPOSITO SYNC ---
    syncDepositItems: async (items) => {
        const response = await api.post('/logistics/deposit-sync', { items });
        return response.data;
    },
};

export { logisticsService };
