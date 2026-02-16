import React, { useEffect, useState } from 'react';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { SERVICES_LIST } from '../constants/services';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/apiClient';
import { Loader2 } from 'lucide-react';

export const Dashboard = () => {
    const navigate = useNavigate();
    const [visibleConfig, setVisibleConfig] = useState(null); // null = cargando/desconocido
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await apiClient.get('/web-orders/area-mapping');
                if (res.success && res.data?.visibility) {
                    setVisibleConfig(res.data.visibility);
                } else {
                    setVisibleConfig({}); // Empty config means show all by default
                }
            } catch (error) {
                console.error("Error fetching visibility config:", error);
                setVisibleConfig({});
            } finally {
                setLoading(false);
            }
        };
        fetchConfig();
    }, []);

    const getErpCode = (serviceId) => {
        // Mapeo manual de ID Web a CodigoERP
        const map = {
            'DF': 'DF', // ID en SERVICES_LIST es 'DF' igual
            'sublimacion': 'SB',
            'ecouv': 'ECOUV',
            'directa_320': 'DIRECTA',
            'directa_algodon': 'DIRECTA',
            'bordado': 'EMB',
            'corte-confeccion': 'TWT',
            'tpu': 'TPU'
        };
        return map[serviceId] || serviceId.toUpperCase();
    };

    if (loading) {
        return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-zinc-300" /></div>;
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold text-neutral-800 tracking-tight">Servicios Disponibles</h2>
                    <p className="text-zinc-500">Selecciona una categoría para comenzar</p>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {SERVICES_LIST.map((service) => {
                    // Lógica de Visibilidad
                    const erpCode = getErpCode(service.id);
                    // Si existe configuración y es false (0), ocultar.
                    // Si es undefined o true, mostrar.
                    if (visibleConfig && visibleConfig[erpCode]?.visible === false) {
                        return null;
                    }

                    const Icon = service.icon;
                    return (
                        <GlassCard
                            key={service.id}
                            className="group cursor-pointer hover:border-amber-400/50 transition-all duration-300 hover:shadow-xl"
                            onClick={() => navigate(`/order/${service.id}`)}
                            whileHover={{ y: -5 }}
                        >
                            <div className="mb-4 p-3 bg-zinc-100 rounded-xl w-fit group-hover:bg-amber-100 group-hover:text-amber-600 transition-colors">
                                <Icon size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-zinc-800 mb-2">{service.label}</h3>
                            <p className="text-sm text-zinc-500 line-clamp-2">{service.desc}</p>

                            <div className="mt-4 flex items-center text-xs font-bold text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                INICIAR PEDIDO &rarr;
                            </div>
                        </GlassCard>
                    );
                })}
            </div>
        </div>
    );
};
