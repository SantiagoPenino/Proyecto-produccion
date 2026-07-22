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
// [PRENDAS] PrendaOrderForm se movió a la app interna (/ventas/pedido-prenda).

import { FactoryView } from './modulos/FactoryView';
import { PickupView } from './modulos/PickupView';
import { UnpaidPickupsView } from './modulos/UnpaidPickupsView';
import { HistorialView } from './modulos/HistorialView';
import { ClubView } from './modulos/ClubView';
import { PricesView } from './modulos/PricesView';
import PaymentResult from '../components/pages/PaymentResult';
import MaintenanceBanner from '../components/common/MaintenanceBanner';
import { TicketsClienteView } from './modulos/tickets/TicketsClienteView';
import { TicketThreadWindow } from './modulos/tickets/TicketThreadWindow';
import { DesignerHomeView } from './modulos/DesignerHomeView';
import { DesignerOrderPage } from './modulos/DesignerOrderPage';

export const ClientPortalApp = () => {
    return (
        <AuthProvider>
            <ToastProvider>
                <ToastContainer style={{ zIndex: 999999 }} />
                <MaintenanceBanner />
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

                    {/* [PRENDAS] El form de prendas se MOVIÓ a la app interna:
                        ruta /ventas/pedido-prenda (de cara a producción, no al cliente).
                        Ver src/components/pages/ventas/PedidoPrendaPage.jsx */}

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

                    {/* Diseñadores: home (crea pedidos en nombre de sus clientes). El registro es /design (raíz, App.jsx) */}
                    <Route path="/estudio" element={
                        <ProtectedRoute>
                            <DesignerHomeView />
                        </ProtectedRoute>
                    } />
                    <Route path="/estudio/pedido/:serviceId" element={
                        <ProtectedRoute>
                            <DesignerOrderPage />
                        </ProtectedRoute>
                    } />

                    <Route path="*" element={<Navigate to="/portal" replace />} />
                </Routes>
            </ToastProvider>
        </AuthProvider>
    );
};
