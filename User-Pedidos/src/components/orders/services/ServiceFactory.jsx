import React from 'react';
import { SublimacionService } from './SublimacionService';
import { BordadoService } from './BordadoService';
import { CorteService } from './CorteService';
import { DTFService } from './DTFService';
import { GlassCard } from '../ui/GlassCard';

/**
 * Fábrica de Servicios: Renderiza el componente técnico adecuado según el ID del servicio.
 * @param {string} serviceId - Identificador del servicio (sublimacion, bordado, dtf, etc).
 * @param {Object} props - Props comunes (items, handlers, config) que se pasan al servicio.
 */
export function ServiceFactory({ serviceId, ...props }) {

    // Mapa de Componentes por Servicio
    // Normalizamos el ID para evitar problemas de mayúsculas/minúsculas
    const normalizedId = serviceId?.toLowerCase() || '';

    if (normalizedId.includes('sublimacion') || normalizedId.includes('impresion')) {
        return <SublimacionService {...props} />;
    }

    if (normalizedId.includes('bordado')) {
        return <BordadoService {...props} />;
    }

    if (normalizedId.includes('corte') && !normalizedId.includes('laser')) {
        // Corte y Confección (Textil)
        return <CorteService {...props} />;
    }

    if (normalizedId.includes('dtf') || normalizedId.includes('directa')) {
        return <DTFService {...props} />;
    }

    // Fallback: Servicio Genérico (Por defecto Sublimación si no coincide nada)
    return (
        <div className="space-y-4">
            <GlassCard title={`Servicio: ${serviceId}`}>
                <div className="p-4 bg-amber-50 text-amber-800 rounded-xl border border-amber-200">
                    <p className="font-bold text-sm">Modo Genérico Activo</p>
                    <p className="text-xs">No se encontró una interfaz especializada para "{serviceId}". Se usará la interfaz estándar.</p>
                </div>
            </GlassCard>
            <SublimacionService {...props} />
        </div>
    );
}
