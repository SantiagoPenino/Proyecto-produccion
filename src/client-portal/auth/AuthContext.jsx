import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '../api/apiClient';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkSession();
    }, []);

    const checkSession = async () => {
        // [PRENDAS] Uso interno (PedidoPrendaPage.jsx envuelve PrendaOrderForm con ESTE
        // AuthProvider dentro de la app admin): si hay sesión de la app principal
        // ('user' en localStorage), esa es la fuente de verdad y NO hay que validar
        // contra /web-auth/me — ese endpoint espera un cliente del portal (busca por
        // CodCliente) y con un token de admin (misma clave 'auth_token', pero es OTRO
        // token) siempre falla; el catch de abajo antes BORRABA el auth_token real del
        // admin (deslogueo silencioso de toda la app interna).
        //
        // PERO solo aplica si NO existe una sesión PROPIA del portal: la gestión y el
        // portal comparten dominio y claves, y este atajo corría SIEMPRE que existiera
        // 'user' — logueado en la gestión y después en el portal (como cliente real),
        // la UI mostraba el objeto de la GESTIÓN ({nombre, usuario…}, sin name ni
        // idCliente): el sidebar quedaba con el avatar "U" y sin nombre, aunque los
        // datos (token del último login) fueran del cliente.
        const mainAppUser = localStorage.getItem('user');
        let portalSession = null;
        try {
            const s = JSON.parse(localStorage.getItem('user_session') || 'null');
            // user_session también la escribe la gestión: es "del portal" solo si tiene
            // pinta de cliente/diseñador web (mismo criterio que el fast-path de abajo).
            if (s && (s.codCliente || s.role === 'WEB_CLIENT' || s.role === 'WEB_DESIGNER')) portalSession = s;
        } catch (e) { /* user_session corrupta: se ignora */ }

        if (mainAppUser && !portalSession) {
            try {
                const parsed = JSON.parse(mainAppUser);
                setUser(parsed);
                setIsLoggedIn(true);
                setLoading(false);
                return;
            } catch (e) {
                console.error('Error leyendo sesión de la app principal', e);
            }
        }

        // 1. Check URL for token (SSO style fallback)
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get('t');

        if (urlToken) {
            localStorage.setItem('auth_token', urlToken);
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        let token = localStorage.getItem('auth_token');

        if (token) {
            // Fast path: show cached session instantly (avoids loading flash)
            const cachedSession = localStorage.getItem('user_session');
            if (cachedSession) {
                try {
                    const cached = JSON.parse(cachedSession);
                    if (cached.codCliente || cached.role === 'WEB_CLIENT' || cached.role === 'WEB_DESIGNER') {
                        setUser(cached);
                        setIsLoggedIn(true);
                    }
                } catch (e) { /* ignore, will verify via API */ }
            }

            // Always refresh from API to get latest data from DB
            try {
                const userData = await apiClient.get('/web-auth/me');
                const freshUser = userData.user || userData;
                setUser(freshUser);
                setIsLoggedIn(true);
                localStorage.setItem('user_session', JSON.stringify(freshUser));
            } catch (err) {
                console.error('❌ [PortalAuth] Session validation failed:', err);
                // Si el token vigente no es del portal (p.ej. el ÚLTIMO login fue en la
                // gestión), volver a la sesión interna SIN tocar el storage: borrarlo acá
                // deslogueaba al admin de toda la app.
                if (mainAppUser) {
                    try {
                        setUser(JSON.parse(mainAppUser));
                        setIsLoggedIn(true);
                        setLoading(false);
                        return;
                    } catch (e2) { /* sesión interna corrupta: sigue el deslogueo normal */ }
                }
                setUser(null);
                setIsLoggedIn(false);
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user_session');
            }
        }
        setLoading(false);
    };

    const login = async (identifier, password) => {
        try {
            // Updated to send identifier (which can be idcliente or email)
            const response = await apiClient.post('/web-auth/login', { identifier, password });

            // Expected response: { token: 'jwt...', user: { ... } }
            const { token, user } = response;

            if (token) {
                localStorage.setItem('auth_token', token);
                // Also store minimal user session just in case
                localStorage.setItem('user_session', JSON.stringify(user));

                setUser(user);
                setIsLoggedIn(true);
                return user;
            } else {
                throw new Error('No token received from server');
            }
        } catch (error) {
            throw error; // Propagate error to UI
        }
    };

    const register = async (data) => {
        try {
            const response = await apiClient.post('/web-auth/register', data);

            // Si la cuenta queda pendiente de aprobación, no logueamos
            if (response.pendingApproval) {
                return { pendingApproval: true, message: response.message };
            }

            const { token, user } = response;
            if (token) {
                localStorage.setItem('auth_token', token);
                setUser(user);
                setIsLoggedIn(true);
                return user;
            }
        } catch (error) {
            throw error;
        }
    };

    const logout = () => {
        localStorage.removeItem('user_session');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        localStorage.removeItem('designer_cliente'); // modo diseñador: soltar el cliente impersonado
        window.location.href = '/';
    };

    const updateProfile = async (updates) => {
        try {
            const response = await apiClient.put('/web-auth/profile', updates);
            const updatedUser = response.user || response;
            setUser(prev => ({ ...prev, ...updatedUser }));
            localStorage.setItem('user_session', JSON.stringify({ ...user, ...updatedUser }));
            return updatedUser;
        } catch (error) {
            console.error('Update profile failed', error);
            throw error;
        }
    };

    return (
        <AuthContext.Provider value={{ user, isLoggedIn, login, logout, register, updateProfile, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
