import api from '../apiClient';

// Tiempo de respuesta de las áreas: ciclo en planta de cada orden (plan INF-SIS-2026-04).
export const cicloPlantaService = {
    // { ordenes, promedio, mediana (minutos laborales), minutosJornada, tieneHorario, porPrioridad, semanas, lentas, … }
    // Período: { dias } (30 por defecto) o { desde, hasta } como 'AAAA-MM-DD'.
    getResumen: async (area, periodo = {}) => {
        const response = await api.get('/dashboard/produccion/ciclo', { params: { area, ...periodo } });
        return response.data;
    },
    // El ciclo de una orden, o null si todavía no está calculado
    getOrden: async (ordenId) => {
        const response = await api.get(`/dashboard/produccion/ciclo/orden/${ordenId}`);
        return response.data;
    },
};
