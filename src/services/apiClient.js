import axios from 'axios';

// Detecta URL de entorno (Vite) o construye dinámicamente usando el hostname actual
// Esto permite acceder desde otras IPs en la red local sin hardcodear localhost
const getBaseUrl = () => {
    if (import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL;
    }
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:5005/api`;
};

export const API_URL = getBaseUrl();
// Remove /api for Socket.io connection
export const SOCKET_URL = API_URL.replace('/api', '');

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Interceptor para agregar token si existe (mejora de seguridad proactiva)
api.interceptors.request.use(config => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            if (user && user.token) {
                config.headers.Authorization = `Bearer ${user.token}`;
            }
        } catch (e) {
            console.error("Error parsing user token:", e);
        }
    }
    return config;
}, error => {
    return Promise.reject(error);
});

export default api;
