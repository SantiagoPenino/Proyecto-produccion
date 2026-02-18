import React from 'react';
import './index.css'; // Import portal-specific styles
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './pautas/Toast';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { MainLayout } from './layout/MainLayout';
import { Dashboard } from './modulos/Dashboard';
import { ProfileView } from './modulos/ProfileView';
import OrderForm from './modulos/OrderForm';

import { FactoryView } from './modulos/FactoryView';
import { PickupView } from './modulos/PickupView';
import { ClubView } from './modulos/ClubView';

export const ClientPortalApp = () => {
    return (
        <AuthProvider>
            <ToastProvider>
                <Routes>

                    <Route path="/" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <Dashboard />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="/profile" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <ProfileView />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="/order/:serviceId" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <OrderForm />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="/factory" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <FactoryView />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="/pickup" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <PickupView />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="/club" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <ClubView />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="*" element={<Navigate to="/portal" replace />} />
                </Routes>
            </ToastProvider>
        </AuthProvider>
    );
};
