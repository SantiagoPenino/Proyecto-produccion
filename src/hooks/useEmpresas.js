import { useState, useEffect, useCallback } from 'react';
import { listarEmpresas, pickEmpresaPorDefecto } from '../services/modules/empresasService';

/**
 * Hook para cargar y seleccionar empresas.
 * Seguro de usar desde múltiples componentes (cada instancia mantiene su propio estado).
 *
 * @param {boolean} soloActivas - Trae solo empresas activas (por defecto true).
 * @returns {{
 *   empresas: Array,
 *   empresaSeleccionada: object|null,
 *   setEmpresaSeleccionada: Function,
 *   loading: boolean,
 *   error: (Error|null),
 *   recargar: Function
 * }}
 */
export function useEmpresas(soloActivas = true) {
    const [empresas, setEmpresas] = useState([]);
    const [empresaSeleccionada, setEmpresaSeleccionada] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const recargar = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await listarEmpresas(soloActivas);
            setEmpresas(data);
            setEmpresaSeleccionada((prev) => prev || pickEmpresaPorDefecto(data));
            return data;
        } catch (err) {
            setError(err);
            setEmpresas([]);
            return [];
        } finally {
            setLoading(false);
        }
    }, [soloActivas]);

    useEffect(() => {
        let activo = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await listarEmpresas(soloActivas);
                if (!activo) return;
                setEmpresas(data);
                setEmpresaSeleccionada((prev) => prev || pickEmpresaPorDefecto(data));
            } catch (err) {
                if (!activo) return;
                setError(err);
                setEmpresas([]);
            } finally {
                if (activo) setLoading(false);
            }
        })();
        return () => {
            activo = false;
        };
    }, [soloActivas]);

    return {
        empresas,
        empresaSeleccionada,
        setEmpresaSeleccionada,
        loading,
        error,
        recargar,
    };
}
