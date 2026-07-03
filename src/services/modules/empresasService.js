import api from '../apiClient';

/**
 * Lista las empresas.
 * @param {boolean} soloActivas - Si es true, añade ?soloActivas=1 para traer solo las activas.
 * @returns {Promise<Array>} Arreglo de empresas.
 */
export const listarEmpresas = async (soloActivas = true) => {
    const url = soloActivas ? '/empresas?soloActivas=1' : '/empresas';
    const response = await api.get(url);
    const data = response.data?.data || response.data || [];
    return Array.isArray(data) ? data : [];
};

/**
 * Selecciona la empresa por defecto de un arreglo (helper client-side).
 * Prioridad: EmpPorDefecto === 1 -> primera activa (EmpActiva === 1) -> primera -> null.
 * @param {Array} empresas
 * @returns {object|null}
 */
export const pickEmpresaPorDefecto = (empresas) => {
    if (!Array.isArray(empresas) || empresas.length === 0) return null;
    return (
        empresas.find((e) => Number(e?.EmpPorDefecto) === 1) ||
        empresas.find((e) => Number(e?.EmpActiva) === 1) ||
        empresas[0] ||
        null
    );
};

/**
 * Obtiene una empresa por su id.
 * @param {number|string} id
 * @returns {Promise<object>}
 */
export const obtenerEmpresa = async (id) => {
    const response = await api.get(`/empresas/${id}`);
    return response.data?.data || response.data;
};

/**
 * Crea una nueva empresa.
 * @param {object} payload
 * @returns {Promise<object>}
 */
export const crearEmpresa = async (payload) => {
    const response = await api.post('/empresas', payload);
    return response.data?.data || response.data;
};

/**
 * Actualiza una empresa existente.
 * @param {number|string} id
 * @param {object} payload
 * @returns {Promise<object>}
 */
export const actualizarEmpresa = async (id, payload) => {
    const response = await api.put(`/empresas/${id}`, payload);
    return response.data?.data || response.data;
};

/**
 * Marca una empresa como la empresa por defecto.
 * @param {number|string} id
 * @returns {Promise<object>}
 */
export const setEmpresaPorDefecto = async (id) => {
    const response = await api.post(`/empresas/${id}/default`);
    return response.data?.data || response.data;
};

/**
 * Alterna el estado activo/inactivo de una empresa.
 * @param {number|string} id
 * @returns {Promise<object>}
 */
export const toggleActivaEmpresa = async (id) => {
    const response = await api.post(`/empresas/${id}/toggle`);
    return response.data?.data || response.data;
};

export const empresasService = {
    listarEmpresas,
    pickEmpresaPorDefecto,
    obtenerEmpresa,
    crearEmpresa,
    actualizarEmpresa,
    setEmpresaPorDefecto,
    toggleActivaEmpresa,
};
