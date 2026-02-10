import React from 'react';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { SERVICES_LIST } from '../constants/services';
import { useNavigate } from 'react-router-dom';

export const Dashboard = () => {
    const navigate = useNavigate();

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-3xl font-bold text-neutral-800 tracking-tight">Servicios Disponibles</h2>
                <p className="text-zinc-500">Selecciona una categoría para comenzar</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {SERVICES_LIST.map((service) => {
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
