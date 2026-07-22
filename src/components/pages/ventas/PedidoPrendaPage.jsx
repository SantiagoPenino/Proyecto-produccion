/*
 * PedidoPrendaPage.jsx — Ruta interna: /ventas/pedido-prenda
 *
 * Monta el form de prendas (PrendaOrderForm, que vive en el árbol del portal) DENTRO
 * de la app productiva/interna. El componente no se toca: se envuelve con los dos
 * providers que necesita del portal —AuthProvider y ToastProvider— para que corra
 * igual que en /portal/order-prenda, pero de cara a producción y no al cliente.
 *
 * El AuthProvider del portal ya tiene fallback a la sesión de la app interna
 * (lee localStorage 'user' si no hay token de cliente), así que el usuario interno
 * queda logueado sin re-autenticar.
 */
import React from 'react';
import { AuthProvider } from '../../../client-portal/auth/AuthContext';
import { ToastProvider } from '../../../client-portal/pautas/Toast';
import PrendaOrderForm from '../../../client-portal/modulos/PrendaOrderForm';

export default function PedidoPrendaPage() {
    return (
        <div className="bg-custom-dark min-h-full">
            <AuthProvider>
                <ToastProvider>
                    <PrendaOrderForm />
                </ToastProvider>
            </AuthProvider>
        </div>
    );
}
