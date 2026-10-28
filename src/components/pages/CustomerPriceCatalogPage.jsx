import React, { useState, useCallback } from 'react';
import api from '../../services/api';
import CustomerPriceCatalog from './CustomerPriceCatalog';
import { toast } from 'sonner';

const CustomerPriceCatalogPage = () => {
    const [customers, setCustomers] = useState([]);

    // useCallback: el hijo la tiene en las dependencias de su espera de 500 ms. Sin esto, cada respuesta volvía a dibujar
    // esta página, se creaba la función de nuevo y se disparaba otra búsqueda: pedía los ~6.000 clientes en bucle (28/10).
    const searchCustomers = useCallback(async (term) => {
        try {
            const res = await api.get('/clients', { params: { q: term } });
            setCustomers(res.data || []);
        } catch (e) {
            console.error("Error searching customers:", e);
            toast.error("Error buscando clientes");
        }
    }, []);

    return (
        <div className="h-full bg-slate-50/50">
            <CustomerPriceCatalog customers={customers} onSearch={searchCustomers} />
        </div>
    );
};

export default CustomerPriceCatalogPage;
