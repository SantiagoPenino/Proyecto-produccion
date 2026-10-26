import axios from 'axios';

const getBaseUrl = () => {
    if (import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL;
    }
    // En Producción con Proxy (Vite Preview), usamos ruta relativa
    // para evitar problemas de HTTPS vs HTTP (Mixed Content).
    return '/api';
};

export const API_URL = getBaseUrl();

// Socket también relativo
export const SOCKET_URL = import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace('/api', '')
    : '/';

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

api.interceptors.request.use(config => {
    // Versión del front (vite.config.js): el monitor del servidor cuenta quién quedó con una versión vieja
    if (typeof __BUILD_ID__ !== 'undefined') config.headers['X-Front-Build'] = __BUILD_ID__;
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

api.interceptors.response.use(
    (response) => {
        const newToken = response.headers['x-renewed-token'];
        if (newToken) {
            const userStr = localStorage.getItem('user');
            if (userStr) {
                try {
                    const user = JSON.parse(userStr);
                    user.token = newToken;
                    localStorage.setItem('user', JSON.stringify(user));
                    localStorage.setItem('auth_token', newToken);
                } catch (e) {
                    console.error("Error actualizando token", e);
                }
            }
        }
        return response;
    },
    (error) => {
        if (error.response && error.response.status === 401) {
            // Evitar múltiples redirects simultáneos (ej: al cerrar sesión)
            if (!window.__isRedirectingToLogin && !window.location.pathname.includes('/login')) {
                window.__isRedirectingToLogin = true;
                localStorage.removeItem('user');
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user_session');
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
)

export default api;
