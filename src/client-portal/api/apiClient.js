export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const handleResponse = async (response) => {
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
        if (response.status === 401 && !window.location.pathname.includes('/login')) {
            // Auto-logout only if not already on login page to avoid loops or bad UX
            // But careful, maybe just let the specific call fail.
            // Original logic was:
            // localStorage.removeItem('auth_token');
            // localStorage.removeItem('user_session');
            // window.location.href = '/login';
        }

        let errorMessage = response.statusText;
        if (data && data.message) {
            errorMessage = data.message;
        } else if (data && data.error) {
            errorMessage = data.error;
        }

        // Error con el payload adjunto: err.message sigue funcionando como siempre, pero además
        // queda accesible el resto de la respuesta (banderas como accountInactive, datos como
        // maskedEmail) que antes se perdía y obligaba a decidir por el texto del mensaje.
        const err = new Error(errorMessage);
        err.status = response.status;
        err.data = data;
        return Promise.reject(err);
    }

    return data;
};

// Modo diseñador: si hay un cliente elegido (designer_cliente), todas las llamadas viajan
// con el header de impersonación — el backend valida el vínculo cliente↔diseñador.
const getImpersonationHeader = () => {
    try {
        const dc = JSON.parse(localStorage.getItem('designer_cliente') || 'null');
        return dc?.codCliente ? { 'X-Cliente-CodCliente': String(dc.codCliente) } : {};
    } catch { return {}; }
};

const getHeaders = () => {
    const token = localStorage.getItem('auth_token');
    // console.log("🔑 [ApiClient] Headers token:", token ? "Present" : "Missing");
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...getImpersonationHeader()
    };
};

export const apiClient = {
    get: async (endpoint) => {
        const requestOptions = {
            method: 'GET',
            headers: getHeaders(),
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);
        return handleResponse(response);
    },

    post: async (endpoint, body) => {
        const requestOptions = {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body)
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);
        return handleResponse(response);
    },

    put: async (endpoint, body) => {
        const requestOptions = {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(body)
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);
        return handleResponse(response);
    },

    delete: async (endpoint, body) => {
        const requestOptions = {
            method: 'DELETE',
            headers: getHeaders(),
            ...(body ? { body: JSON.stringify(body) } : {})
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);
        return handleResponse(response);
    },

    patch: async (endpoint, body) => {
        const requestOptions = {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify(body)
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);
        return handleResponse(response);
    },

    // Method to upload files
    postFormData: async (endpoint, formData) => {
        const token = localStorage.getItem('auth_token');
        const headers = { ...(token ? { 'Authorization': `Bearer ${token}` } : {}), ...getImpersonationHeader() };

        const requestOptions = {
            method: 'POST',
            headers: headers, // Content-Type is automatic for FormData
            body: formData
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);
        return handleResponse(response);
    }
};
