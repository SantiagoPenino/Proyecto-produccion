const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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

        // Return an Error object so err.message works in catch blocks
        return Promise.reject(new Error(errorMessage));
    }

    return data;
};

const getHeaders = () => {
    const token = localStorage.getItem('auth_token');
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
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

    delete: async (endpoint) => {
        const requestOptions = {
            method: 'DELETE',
            headers: getHeaders(),
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);
        return handleResponse(response);
    },

    // Method to upload files
    postFormData: async (endpoint, formData) => {
        const token = localStorage.getItem('auth_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

        const requestOptions = {
            method: 'POST',
            headers: headers, // Content-Type is automatic for FormData
            body: formData
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, requestOptions);
        return handleResponse(response);
    }
};
