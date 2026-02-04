// src/context/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { API_URL } from '../services/apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const savedUser = localStorage.getItem('user');
        console.log("🔍 [AuthStep 1] Revisando LocalStorage:", savedUser);

        if (savedUser && savedUser !== "undefined" && savedUser !== "null") {
            try {
                const parsed = JSON.parse(savedUser);
                console.log("✅ [AuthStep 2] Usuario recuperado:", parsed);
                setUser(parsed);
            } catch (e) {
                console.error("❌ [AuthError] Error parseando usuario:", e);
                localStorage.removeItem('user');
            }
        }
        setLoading(false);
    }, []);

    const login = async (username, password) => {
        console.log("🚀 [LoginStep 1] Intentando login para:", username);
        try {
            const response = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            console.log("📥 [LoginStep 2] Respuesta del servidor:", data);

            if (response.ok && data.user) {
                // FALLBACK: Check if token is directly in data or inside user object
                const receivedToken = data.token || data.user.token;
                console.log("🔑 [LoginStep 2.5] Token recibido:", receivedToken ? "SÍ (Length: " + receivedToken.length + ")" : "NO (undefined)");

                const userData = {
                    id: data.user.userId || data.user.IdUsuario, // Support both new and old formats
                    nombre: data.user.Nombre || data.user.username || data.user.Usuario,
                    rol: data.user.role || data.user.IdRol, // Support both formats
                    idRol: data.user.idRol || data.user.IdRol, // Explicitly store IdRol
                    usuario: data.user.username || data.user.Usuario,
                    token: receivedToken, // Store the found token
                    areaKey: data.user.AreaKey // Store area key if available
                };
                console.log("💾 [LoginStep 3] Guardando en LocalStorage:", userData);
                localStorage.setItem('user', JSON.stringify(userData));
                setUser(userData);
                return userData;
            } else {
                throw new Error(data.message || 'Credenciales inválidas');
            }
        } catch (error) {
            console.error("🔥 [LoginError]:", error);
            throw error;
        }
    };

    const logout = () => {
        console.log("🚪 [Auth] Cerrando sesión...");
        localStorage.removeItem('user');
        setUser(null);
        window.location.href = '/login';
    };

    const value = useMemo(() => ({ user, login, logout, loading }), [user, loading]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);