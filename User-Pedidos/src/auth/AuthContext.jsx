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
        const token = localStorage.getItem('auth_token');
        if (token) {
            try {
                // Verify token and get latest user data
                const userData = await apiClient.get('/web-auth/me');
                // Assumes backend returns the User object directly or { user: ... }
                // Adjust based on actual backend response structure
                const user = userData.user || userData;
                setUser(user);
                setIsLoggedIn(true);
            } catch (err) {
                console.error('Session validation failed:', err);
                logout();
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
            // Password validation relaxed as requested
            // if (data.password.length < 6) { ... } REMOVED

            const response = await apiClient.post('/web-auth/register', data);

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
        setUser(null);
        setIsLoggedIn(false);
        localStorage.removeItem('user_session');
        localStorage.removeItem('auth_token');
        // Optional: Call functionality to invalidate token on server
    };

    const updateProfile = async (updates) => {
        try {
            const updatedUser = await apiClient.put('/users/profile', updates);
            setUser(prev => ({ ...prev, ...updatedUser }));
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
