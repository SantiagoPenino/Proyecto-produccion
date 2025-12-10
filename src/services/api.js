import axios from 'axios';

// Detecta URL de entorno (Vite) o usa localhost por defecto
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// ==========================================
// 1. SERVICIO DE ÁREAS (Configuración)
// ==========================================
export const areasService = {
    getAll: async () => {
        try {
            const response = await api.get('/areas');
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("❌ Error fetching areas:", error);
            return []; 
        }
    },
    getDetails: async (code) => {
        try {
            const response = await api.get(`/areas/${code}/details`);
            return response.data || { equipos: [], insumos: [], columnas: [], estados: [] };
        } catch (error) {
            console.error("Error getDetails:", error);
            return { equipos: [], insumos: [], columnas: [], estados: [] };
        }
    },
    getDictionary: async () => {
        try {
            const response = await api.get('/areas/dictionary');
            return response.data;
        } catch (error) { return []; }
    },
    saveColumns: async (data) => {
        const response = await api.post('/areas/columns', data);
        return response.data;
    },
    saveStatuses: async (data) => {
        const response = await api.post('/areas/statuses', data);
        return response.data;
    },
    updatePrinter: async (id, data) => {
        // data: { nombre, capacidad, velocidad }
        const response = await api.put(`/areas/printer/${id}`, data);
        return response.data;
    },
    addPrinter: async (data) => {
        const response = await api.post('/areas/printer', data);
        return response.data;
    },
    toggleInsumo: async (data) => {
        const response = await api.post('/areas/insumo-link', data);
        return response.data;
    },
    updateConfig: async (code, newConfig) => {
        const response = await api.put(`/areas/${code}/config`, { ui_config: newConfig });
        return response.data;
    }
    
};

// ==========================================
// 2. SERVICIO DE ÓRDENES
// ==========================================
export const ordersService = {
    getByArea: async (areaCode, mode = 'active') => {
        const response = await api.get(`/orders?area=${areaCode}&mode=${mode}`);
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
    getPriorities: async (areaCode) => {
        const response = await api.get(`/orders/priorities?area=${areaCode}`);
        return response.data;
    },
    assignRoll: async (orderIds, rollId) => {
        const response = await api.post('/orders/assign-roll', { orderIds, rollId });
        return response.data;
    },
    // Gestión de Archivos
    updateFile: async (fileData) => {
        const response = await api.put('/orders/files/update', fileData);
        return response.data;
    },
    addFile: async (fileData) => {
        const response = await api.post('/orders/files/add', fileData);
        return response.data;
    },
    deleteFile: async (fileId) => {
        const response = await api.delete(`/orders/files/${fileId}`);
        return response.data;
    },
    // Para recargar una sola orden y ver el nuevo total
    getById: async (orderId) => {
        // Reutilizamos el filtro por ID del endpoint general si no quieres crear uno nuevo
        const response = await api.get(`/orders?q=${orderId}`);
        return response.data[0]; // Devolvemos la primera coincidencia
    }
};

// ==========================================
// 3. SERVICIO DE STOCK (Insumos)
// ==========================================
export const stockService = {
    create: async (data) => {
        const response = await api.post('/stock', data);
        return response.data;
    },
    getHistory: async (areaCode) => {
        const response = await api.get(`/stock/history?area=${areaCode}`);
        return response.data;
    },
    searchItems: async (query) => {
        const response = await api.get(`/stock/items?q=${query}`);
        return response.data;
    },
    createItem: async (itemData) => {
        const response = await api.post('/stock/items', itemData);
        return response.data;
    },
    getUrgentCount: async () => {
        try {
            const response = await api.get('/stock/urgent-count');
            return response.data.count;
        } catch (error) { return 0; }
    }
};

// ==========================================
// 4. SERVICIO DE FALLAS (Mantenimiento)
// ==========================================
export const failuresService = {
    getAll: async () => {
        const response = await api.get('/failures');
        return response.data;
    },
    getMachines: async (areaCode) => {
        const response = await api.get(`/failures/machines?area=${areaCode}`);
        return response.data;
    },
    searchTitles: async (query, areaCode) => {
        const response = await api.get(`/failures/titles?q=${query}&area=${areaCode}`);
        return response.data;
    },
    createType: async (data) => {
        const response = await api.post('/failures/titles', data);
        return response.data;
    },
    create: async (data) => {
        const response = await api.post('/failures', data);
        return response.data;
    },
    getHistory: async (areaCode) => {
        const response = await api.get(`/failures/history?area=${areaCode}`);
        return response.data;
    }
};

// ==========================================
// 5. SERVICIO DE CLIENTES
// ==========================================
export const clientsService = { 
    search: async (query) => {
        const response = await api.get(`/clients/search?q=${query}`);
        return response.data;
    },
    create: async (data) => {
        const response = await api.post('/clients', data);
        return response.data;
    }
};

// ==========================================
// 6. SERVICIO DE FLUJOS (Rutas)
// ==========================================
export const workflowsService = {
    getAll: async () => {
        const response = await api.get('/workflows');
        return response.data;
    },
    create: async (data) => {
        const response = await api.post('/workflows', data);
        return response.data;
    }
};

// ==========================================
// 7. SERVICIO DE ROLLOS / LOTES (Kanban)
// ==========================================
export const rollsService = {
    getBoard: async (areaCode) => {
        const response = await api.get(`/rolls/board?area=${areaCode}`);
        return response.data;
    },
    moveOrder: async (orderId, targetRollId) => {
        const response = await api.post('/rolls/move', { orderId, targetRollId });
        return response.data;
    },
    create: async (data) => {
        const response = await api.post('/rolls/create', data);
        return response.data;
    }
};

// ==========================================
// 8. SERVICIO DE LOGÍSTICA (Despachos)
// ==========================================
export const logisticsService = {
    getCandidates: async (areaCode) => {
        const response = await api.get(`/logistics/cart-candidates?area=${areaCode}`);
        return response.data;
    },
    createDispatch: async (data) => {
        const response = await api.post('/logistics/dispatch', data);
        return response.data;
    }
};
// ...
export const productionService = {
    getBoard: async (areaCode) => {
        const response = await api.get(`/production/board?area=${areaCode}`);
        return response.data;
    },
    assignRoll: async (rollId, machineId) => {
        const response = await api.post('/production/assign', { rollId, machineId });
        return response.data;
    }
};
// ...
export default api;