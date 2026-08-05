import api from '../apiClient';

export const ordersService = {
    getByArea: async (areaCode, mode = 'active') => {
        const response = await api.get(`/orders?area=${areaCode}&mode=${mode}`);
        return response.data;
    },
    getActiveSummary: async (areaKey) => {
        const params = areaKey ? { area: areaKey } : {};
        const response = await api.get('/orders/active', { params });
        return response.data;
    },
    getFailedSummary: async (areaKey) => {
        const params = areaKey ? { area: areaKey } : {};
        const response = await api.get('/orders/failed', { params });
        return response.data;
    },
    // Tarjeta "Canceladas" del Panel de Control. Faltaba: el Dashboard la pasaba como queryFn y quedaba
    // undefined → OrdersCard hacía queryFn(areaKey) → TypeError → data undefined → mostraba 0 sin desglose.
    getCancelledSummary: async (areaKey) => {
        const params = areaKey ? { area: areaKey } : {};
        const response = await api.get('/orders/cancelled', { params });
        return response.data;
    },
    create: async (orderData) => {
        const response = await api.post('/orders', orderData);
        return response.data;
    },
    updateStatus: async (orderId, newStatus) => {
        const response = await api.put(`/orders/${orderId}/status`, { status: newStatus });
        return response.data;
    },
    updateAreaStatus: async (orderId, newAreaStatus) => {
        const response = await api.put(`/orders/${orderId}/area-status`, { areaStatus: newAreaStatus });
        return response.data;
    },
    getPriorities: async (areaCode) => {
        const response = await api.get(`/orders/priorities?area=${areaCode}`);
        return response.data;
    },
    getEstados: async () => {
        const response = await api.get(`/orders/estados`);
        return response.data;
    },
    assignRoll: async (orderIdsOrPayload, rollId) => {
        const payload = Array.isArray(orderIdsOrPayload)
            ? { orderIds: orderIdsOrPayload, rollId }
            : orderIdsOrPayload;
        const response = await api.post('/orders/assign-roll', payload);
        return response.data;
    },
    unassignRoll: async (orderId) => {
        const response = await api.post('/orders/unassign-roll', { orderId });
        return response.data;
    },

    assignFabricBobbin: async (orderId, bobinaId) => {
        const response = await api.post('/orders/assign-fabric-bobbin', { orderId, bobinaId });
        return response.data;
    },
    updateFile: async (fileData) => {
        const response = await api.put('/orders/file/update', fileData);
        return response.data;
    },
    updateService: async (serviceData) => {
        const response = await api.put('/orders/service/update', serviceData);
        return response.data;
    },
    addFile: async (fileData) => {
        const response = await api.post('/orders/file/add', fileData);
        return response.data;
    },
    // Sube un PDF de producción (arte) a una orden existente. Uso interno (TPU).
    // tipoArchivo: 'Impresion' (default) | 'MATRIZ' (Bordado, DST/EMB de Wilcom).
    uploadProductionFile: async (ordenId, file, onProgress, tipoArchivo = 'Impresion', extraFields = null) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('tipoArchivo', tipoArchivo);
        // [PRO] Campos extra de la subida desde el detalle de la orden madre:
        // copias del archivo + procesarPortal='1' (medición/renombrado como el portal).
        if (extraFields) {
            Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));
        }
        const response = await api.post(`/orders/${ordenId}/production-file`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            // Progreso de subida (bytes enviados de ESTE archivo) para la barra del modal TPU.
            onUploadProgress: onProgress ? (e) => onProgress(e.loaded, e.total || file.size || 0) : undefined,
        });
        return response.data;
    },
    // TPU: enviar la orden a aprobación del cliente (retiene hasta que apruebe).
    enviarAprobacionTPU: async (ordenId) => {
        const response = await api.post(`/orders/${ordenId}/enviar-aprobacion`);
        return response.data;
    },
    // Notas de producción por orden — ADITIVAS (cada llamada agrega, nunca pisa).
    getOrderNotes: async (ordenId) => {
        const response = await api.get(`/orders/${ordenId}/notas`);
        return response.data?.data || [];
    },
    addOrderNote: async (ordenId, texto) => {
        const response = await api.post(`/orders/${ordenId}/notas`, { texto });
        return response.data;
    },
    // TPU: texturas por zona que eligió el cliente al aprobar el boceto.
    getTexturasOrden: async (ordenId) => {
        const response = await api.get(`/orders/${ordenId}/texturas`);
        return response.data;
    },
    setTexturasOrden: async (ordenId, elecciones) => {
        const response = await api.put(`/orders/${ordenId}/texturas`, { elecciones });
        return response.data;
    },
    // Catálogo (la carpeta assets/textures). Mismo endpoint que usa el portal.
    getCatalogoTexturas: async () => {
        const response = await api.get('/web-orders/texturas-tpu');
        return response.data;
    },
    deleteFile: async (fileId) => {
        const response = await api.delete(`/orders/file/${fileId}`);
        return response.data;
    },
    getById: async (orderId, area) => {
        // Use the direct ID endpoint to avoid returning wrong orders via text search
        try {
            const response = await api.get(`/orders/details/${orderId}`);
            const o = response.data;
            if (!o) return null;
            // Map raw SQL fields to the frontend model format
            return {
                id: o.OrdenID || o.id,
                code: o.CodigoOrden || o.code || `ORD-${o.OrdenID}`,
                client: o.Cliente || o.client || '',
                idCliente: o.IDCliente || o.idCliente || '',
                desc: o.DescripcionTrabajo || o.desc || '',
                area: o.AreaID || o.area || area || '',
                status: o.Estado || o.status || 'Pendiente',
                areaStatus: o.EstadoenArea || o.areaStatus || '',
                priority: o.Prioridad || o.priority || 'Normal',
                magnitude: o.Magnitud || o.magnitude || '',
                material: o.Material || o.material || '',
                variantCode: o.Variante || o.variantCode || '',
                ink: o.Tinta || o.ink || '',
                UM: o.UnidadMedida || o.UM || 'm',
                retiro: o.ModoRetiro || o.retiro || '',
                noDocERP: o.NoDocERP || o.noDocERP || '',
                nextService: o.ProximoServicio || o.nextService || '',
                entryDate: o.FechaIngreso || o.entryDate || null,
                deliveryDate: o.FechaEstimadaEntrega || o.deliveryDate || null,
                note: o.Nota || o.note || '',
                filesData: o.filesData || o.files || [],
            };
        } catch (e) {
            // Fallback to search if details endpoint fails
            let url = `/orders?q=${orderId}&mode=all`;
            if (area) url += `&area=${area}`;
            const response = await api.get(url);
            return Array.isArray(response.data) ? response.data[0] : response.data;
        }
    },
    cancel: async (payload) => {
        const response = await api.post('/orders/cancel', payload);
        return response.data;
    },
    cancelOrder: async (payload) => { // Alias explícito para evitar error en Modal
        const response = await api.post('/orders/cancel', payload);
        return response.data;
    },
    cancelRequest: async (payload) => {
        const response = await api.post('/orders/cancel-request', payload);
        return response.data;
    },
    cancelFile: async (payload) => {
        const response = await api.post('/orders/file/cancel', payload);
        return response.data;
    },
    reactivateOrder: async (payload) => {
        const response = await api.post('/orders/reactivate', payload);
        return response.data;
    },
    reactivateRequest: async (payload) => {
        const response = await api.post('/orders/reactivate-request', payload);
        return response.data;
    },
    reactivateFile: async (payload) => {
        const response = await api.post('/orders/file/reactivate', payload);
        return response.data;
    },
    advancedSearch: async (filters) => {
        const response = await api.post('/orders/search/advanced', filters);
        return response.data;
    },
    getFullDetails: async (orderId) => {
        const response = await api.get(`/orders/details/${orderId}`);
        return response.data;
    },
    getIntegralDetails: async (ref) => {
        const response = await api.get(`/orders/search/integral/${encodeURIComponent(ref)}`);
        return response.data;
    },
    getReferences: async (orderId) => {
        const response = await api.get(`/orders/${orderId}/references`);
        return response.data;
    },
    // [PRO] Archivos de referencia: alta manual con tipo (catálogo) + nota, y baja.
    getTiposReferencia: async () => {
        const response = await api.get('/orders/referencia-tipos');
        return response.data;
    },
    uploadReferenceFile: async (ordenId, file, tipo, nota = '') => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('tipo', tipo || 'REFERENCIA');
        formData.append('nota', nota);
        const response = await api.post(`/orders/${ordenId}/reference-file`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },
    deleteReferenceFile: async (refId) => {
        const response = await api.delete(`/orders/reference/${refId}`);
        return response.data;
    },
    // [PRO] Cantidad a fabricar (Magnitud global): edición manual, recotiza el pedido.
    updateMagnitud: async (ordenId, magnitud) => {
        const response = await api.put(`/orders/${ordenId}/magnitud`, { magnitud });
        return response.data;
    },
    // [PRO] Reordenar Costura/Bordado/Estampado: `areas` es el nuevo orden deseado (AreaID).
    updateRoutePriority: async (ordenId, areas) => {
        const response = await api.put(`/orders/${ordenId}/route-priority`, { areas });
        return response.data;
    },
    getServices: async (orderId) => {
        const response = await api.get(`/orders/${orderId}/services`);
        return response.data;
    }
};
