import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './pautas/Toast';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { MainLayout } from './layout/MainLayout';
import { Dashboard } from './modulos/Dashboard';
import { ProfileView } from './modulos/ProfileView';
import OrderForm from './modulos/OrderForm';
import { LoginPage } from './modulos/LoginPage';
import { FactoryView } from './modulos/FactoryView';
import { PickupView } from './modulos/PickupView';
import { ClubView } from './modulos/ClubView';

function App() {
    return (
        <AuthProvider>
            <ToastProvider>
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />

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

                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </ToastProvider>
        </AuthProvider>
    );
}

export default App;
