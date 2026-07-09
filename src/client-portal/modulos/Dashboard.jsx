import React, { useEffect, useState } from 'react';
import { GlassCard } from '../pautas/GlassCard';
import { SERVICES_LIST } from '../constants/services';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/apiClient';
import { Loader2, Package, ShieldX } from 'lucide-react';
import { InstallAppBanner } from '../components/InstallAppBanner';

export const Dashboard = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [visibleConfig, setVisibleConfig] = useState(null);
    const [loading, setLoading] = useState(true);

    const isBloqueado = user?.estado === 'BLOQUEADO';

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await apiClient.get('/web-orders/area-mapping');
                if (res.success && res.data?.visibility) {
                    setVisibleConfig(res.data.visibility);
                } else {
                    setVisibleConfig({});
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
        const map = {
            'DF': 'DTF',
            'sublimacion': 'SUB',
            'ecouv': 'EUV',
            'directa_320': 'DIR',
            'directa_algodon': 'DIR',
            'bordado': 'BOR',
            'corte': 'COR',
            'corte-confeccion': 'COS',
            'tpu': 'TPU'
        };
        return map[serviceId] || serviceId.toUpperCase();
    };

    if (loading) {
        return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-zinc-300" /></div>;
    }

    return (
        <div className="animate-fade-in space-y-6">

            {/* Banner "Instalá la app" (se esconde solo si ya está instalada o lo descartó) */}
            <InstallAppBanner />

            {/* Banner de cuenta bloqueada */}
            {isBloqueado && (
                <div className="flex items-start gap-4 bg-red-950/40 border border-red-700/60 rounded-2xl px-5 py-4">
                    <ShieldX size={36} strokeWidth={1.5} className="text-red-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-300 font-bold text-sm uppercase tracking-wide">Cuenta bloqueada</p>
                        <p className="text-red-400/80 text-xs mt-1 leading-relaxed">
                            Tu cuenta está actualmente bloqueada y no podés crear nuevos pedidos.
                            Por favor, contactanos para regularizar tu situación.
                        </p>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-3 mb-2">
                <Package size={48} strokeWidth={1} className="text-brand-gold" />
                <div>
                    <h2 className="text-lg font-bold text-zinc-300 uppercase">Servicios <span className="text-custom-cyan">Disponibles</span></h2>
                    <p className="text-zinc-500 uppercase text-xs">Seleccioná una categoría para comenzar.</p>
                </div>
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 ${isBloqueado ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                {SERVICES_LIST.map((service) => {
                    const erpCode = getErpCode(service.id);
                    if (visibleConfig && visibleConfig[erpCode]?.visible === false) {
                        return null;
                    }

                    const Icon = service.icon;
                    return (
                        <GlassCard
                            key={service.id}
                            className="cursor-pointer transition-all duration-300 h-full md:aspect-square flex flex-col justify-center"
                            onClick={() => {
                                if (isBloqueado) return;
                                if (service.isTicketSystem) {
                                    navigate('/portal/soporte');
                                } else if (service.externalUrl) {
                                    const params = new URLSearchParams();
                                    params.append('usp', 'pp_url');
                                    if (service.formEntries) {
                                        if (service.formEntries.clienteId && user?.idCliente) {
                                            params.append(service.formEntries.clienteId, user.idCliente.toString().trim());
                                        }
                                        if (service.formEntries.terminos) {
                                            params.append(service.formEntries.terminos.id, service.formEntries.terminos.value);
                                        }
                                    }
                                    window.open(`${service.externalUrl}?${params.toString()}`, '_blank');
                                } else {
                                    navigate(`/portal/order/${service.id}`);
                                }
                            }}
                        >
                            <div className="flex flex-col items-center gap-2 mb-2">
                                <Icon size={28} strokeWidth={1.5} className="text-amber-500" />
                                <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wide text-center">{service.label}</h3>
                            </div>
                            <div className="border-t border-zinc-700/50 my-2"></div>
                            <p className="text-xs text-zinc-500 uppercase line-clamp-1 md:line-clamp-none text-center">{service.desc}</p>
                        </GlassCard>
                    );
                })}
            </div>
        </div>
    );
};
