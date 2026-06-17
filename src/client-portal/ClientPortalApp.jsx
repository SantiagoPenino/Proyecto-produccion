import React from 'react';
import './index.css'; // Import portal-specific styles
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './pautas/Toast';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { MainLayout } from './layout/MainLayout';
import { Dashboard } from './modulos/Dashboard';
import { ProfileView } from './modulos/ProfileView';
import { ProfileEdit } from './modulos/ProfileEdit';
import OrderForm from './modulos/OrderForm';

import { FactoryView } from './modulos/FactoryView';
import { PickupView } from './modulos/PickupView';
import { UnpaidPickupsView } from './modulos/UnpaidPickupsView';
import { HistorialView } from './modulos/HistorialView';
import { ClubView } from './modulos/ClubView';
import { PricesView } from './modulos/PricesView';
import PaymentResult from '../components/pages/PaymentResult';
import { TicketsClienteView } from './modulos/tickets/TicketsClienteView';
import { TicketThreadWindow } from './modulos/tickets/TicketThreadWindow';

export const ClientPortalApp = () => {
    return (
        <AuthProvider>
            <ToastProvider>
                <ToastContainer style={{ zIndex: 999999 }} />
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

                    <Route path="/profile/edit" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <ProfileEdit />
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

                    <Route path="/payments" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <UnpaidPickupsView />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="/history" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <HistorialView />
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

                    <Route path="/payment-status" element={
                        <ProtectedRoute>
                            <PaymentResult />
                        </ProtectedRoute>
                    } />

                    <Route path="/precios" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <PricesView />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="/soporte" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <TicketsClienteView />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="/soporte/:id" element={
                        <ProtectedRoute>
                            <MainLayout>
                                <TicketThreadWindow />
                            </MainLayout>
                        </ProtectedRoute>
                    } />

                    <Route path="*" element={<Navigate to="/portal" replace />} />
                </Routes>
            </ToastProvider>
        </AuthProvider>
    );
};
