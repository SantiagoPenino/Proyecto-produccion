import { useState, useEffect } from 'react';
import { mockOrders } from '../../data/mockData.js'; // Asegúrate de que esta ruta sea correcta

export const useOrders = (filters = {}) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulamos una carga de API
    setLoading(true);
    
    // FILTRADO CLIENT-SIDE (Temporal hasta tener SQL)
    const filteredData = mockOrders.filter(order => {
        let isValid = true;

        // 1. Filtrar por Área (Crítico: AreaGenerica pasa 'filters.area' usualmente o lo manejamos fuera)
        // Asumimos que mockOrders tiene propiedad 'area'
        if (filters.area && order.area !== filters.area) isValid = false;

        // 2. Filtrar por Impresora (Selector del header)
        if (isValid && filters.printer && filters.printer !== '') {
            if (order.printer !== filters.printer) isValid = false;
        }

        // 3. Filtro de Estado (AreaFilters)
        if (isValid && filters.status && filters.status !== '') {
            if (order.status !== filters.status) isValid = false;
        }

        // 4. Búsqueda texto (si implementaste buscador)
        if (isValid && filters.search) {
             const term = filters.search.toLowerCase();
             if (!order.client.toLowerCase().includes(term) && !order.id.includes(term)) {
                 isValid = false;
             }
        }

        return isValid;
    });

    // Simulamos un pequeño delay de red
    setTimeout(() => {
        setOrders(filteredData);
        setLoading(false);
    }, 300);

  }, [filters]); // Se ejecuta cada vez que cambian los filtros

  return { orders, loading };
};