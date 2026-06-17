import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '../pautas/GlassCard';
import { Crown, DollarSign, TrendingUp, CheckCircle, Smartphone, Mail, MapPin, Pencil, UserCheck, Package, FileText, User } from 'lucide-react';
import { StatusBadge } from '../pautas/StatusBadge';
import { apiClient } from '../api/apiClient';

export const ProfileView = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [recentActivity, setRecentActivity] = useState([]);
    const [loadingOrders, setLoadingOrders] = useState(true);

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const res = await apiClient.get('/web-orders/my-orders');
                if (res && res.data) {
                    setRecentActivity(res.data.slice(0, 10).map(ord => ({
                        id: ord.CodigoOrden || ord.OrdenID,
                        date: ord.FechaIngreso ? new Date(ord.FechaIngreso).toLocaleDateString() : '-',
                        type: ord.DescripcionTrabajo || ord.Material || '-',
                        status: ord.Estado || 'Pendiente',
                        amount: ord.Total,
                        currency: ord.Moneda || '$'
                    })));
                }
            } catch (err) {
                console.error('Error fetching recent orders:', err);
            } finally {
                setLoadingOrders(false);
            }
        };
        fetchOrders();
    }, []);

    if (!user) return null;

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <User size={48} strokeWidth={1} className="text-brand-gold" />
                <div>
                    <h2 className="text-lg font-bold text-zinc-300 uppercase">Mi <span className="text-brand-cyan">Perfil</span></h2>
                    <p className="text-zinc-500 uppercase text-xs">Gestión de cuenta y datos de contacto.</p>
                </div>
            </div>

            {/* KPIs (Ocultos temporalmente por petición del usuario) */}
            {/* <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <GlassCard className="!p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-neutral-100 rounded-lg text-black"><DollarSign size={20} /></div>
                        <p className="text-neutral-500 text-sm font-medium">Gasto Mensual</p>
                    </div>
                    <h3 className="text-2xl font-bold text-neutral-800">${user.monthlySpend?.toLocaleString() || '0'}</h3>
                    <p className="text-xs text-green-600 flex items-center mt-2"><TrendingUp size={12} className="mr-1" /> +15% vs mes anterior</p>
                </GlassCard>

                <GlassCard className="!p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-purple-100 rounded-lg text-purple-600"><Crown size={20} /></div>
                        <p className="text-neutral-500 text-sm font-medium">Club Points</p>
                    </div>
                    <h3 className="text-2xl font-bold text-neutral-800">{user.points || 0} pts</h3>
                    <div className="w-full bg-neutral-100 rounded-full h-1.5 mt-3">
                        <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: '75%' }}></div>
                    </div>
                    <p className="text-xs text-neutral-400 mt-1">2.500 pts para Nivel Platino</p>
                </GlassCard>

                <GlassCard className="!p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-green-100 rounded-lg text-green-600"><CheckCircle size={20} /></div>
                        <p className="text-neutral-500 text-sm font-medium">Cuenta Corriente</p>
                    </div>
                    <h3 className="text-2xl font-bold text-green-600">Habilitada</h3>
                    <p className="text-xs text-neutral-400 mt-2">Cierre de facturación: 30/Oct</p>
                </GlassCard>
            </div> */}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Datos Personales */}
                <GlassCard className="!p-6 flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-lg text-white">Datos de Cuenta</h3>
                        <button onClick={() => navigate('/portal/profile/edit')} className="text-brand-gold hover:text-white transition-colors text-sm font-medium flex items-center gap-1">
                            <Pencil size={13} /> Editar
                        </button>
                    </div>
                    <div className="space-y-4 flex-1">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center font-bold text-white text-2xl border border-white/20 shadow-xl">
                                {user.avatar || user.name?.charAt(0) || 'U'}
                            </div>
                            <div>
                                <p className="font-bold text-xl text-white leading-tight">{user.name}</p>
                                <p className="text-sm text-brand-cyan font-medium">{user.company || 'Sin Empresa'}</p>
                            </div>
                        </div>

                        <div className="space-y-4 text-sm">
                            <div className="flex items-start gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                                <UserCheck size={18} className="text-brand-cyan mt-1 shrink-0" />
                                <div>
                                    <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-0.5">ID Cliente</p>
                                    <p className="text-white font-medium">{user.idCliente || user.id}</p>
                                </div>
                            </div>

                            {user.ruc && (
                                <div className="hidden sm:flex items-start gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                                    <FileText size={18} className="text-brand-cyan mt-1 shrink-0" />
                                    <div>
                                        <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-0.5">RUT / Documento</p>
                                        <p className="text-white font-medium">{user.ruc}</p>
                                    </div>
                                </div>
                            )}

                            <div className="hidden sm:flex items-start gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                                <Mail size={18} className="text-brand-cyan mt-1 shrink-0" />
                                <div>
                                    <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-0.5">Email</p>
                                    <p className="text-white font-medium">{user.email}</p>
                                </div>
                            </div>

                            <div className="hidden sm:flex items-start gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                                <Smartphone size={18} className="text-brand-cyan mt-1 shrink-0" />
                                <div>
                                    <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-0.5">Teléfono</p>
                                    <p className="text-white font-medium">{user.phone || 'No registrado'}</p>
                                </div>
                            </div>

                            <div className="hidden sm:flex items-start gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                                <MapPin size={18} className="text-brand-cyan mt-1 shrink-0" />
                                <div>
                                    <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-0.5">Dirección</p>
                                    <p className="text-white font-medium">{user.address || 'No registrada'}</p>
                                </div>
                            </div>

                            {user.departamentoNombre && (
                                <div className="hidden sm:flex items-start gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                                    <MapPin size={18} className="text-brand-cyan mt-1 shrink-0" />
                                    <div>
                                        <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-0.5">Departamento</p>
                                        <p className="text-white font-medium">{user.departamentoNombre}</p>
                                    </div>
                                </div>
                            )}

                        </div>

                        {/* Asesor Asignado - Al final de la card */}
                        <div className="pt-2">
                        {user.vendedorNombre ? (
                                <div className="flex flex-col gap-3 p-4 rounded-xl bg-brand-cyan/10 border border-brand-cyan/20">
                                    <p className="text-[10px] text-brand-cyan uppercase font-black tracking-widest">Asesor asignado</p>
                                    <div className="flex items-center gap-3">
                                        {user.vendedorCedula ? (
                                            <img
                                                src={`/assets/images/asesores/${user.vendedorCedula}.webp`}
                                                alt={user.vendedorNombre}
                                                className="w-12 h-12 rounded-full object-cover border-2 border-brand-cyan/40 shrink-0"
                                                onError={e => { e.target.onerror = null; e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                            />
                                        ) : null}
                                        <div className="w-12 h-12 rounded-full bg-brand-cyan/20 border-2 border-brand-cyan/40 items-center justify-center shrink-0" style={{ display: user.vendedorCedula ? 'none' : 'flex' }}>
                                            <UserCheck size={20} className="text-brand-cyan" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-white font-bold text-base leading-tight truncate">{user.vendedorNombre}</p>
                                            <p className="text-xs text-zinc-500 mt-0.5">Tu contacto directo</p>
                                        </div>
                                    </div>
                                    {user.vendedorTelefono && (
                                        <a
                                            href={`https://wa.me/598${user.vendedorTelefono.replace(/\D/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-bold text-sm transition-all duration-200"
                                            style={{ background: '#25D366', color: '#fff' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#1EB758'}
                                            onMouseLeave={e => e.currentTarget.style.background = '#25D366'}
                                        >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                            </svg>
                                            WhatsApp
                                        </a>
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-dashed border-white/10">
                                    <UserCheck size={20} className="text-zinc-600 mt-1 shrink-0" />
                                    <div className="flex-1">
                                        <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mb-1">Asesor asignado</p>
                                        <p className="text-zinc-400 font-medium">No tenés un asesor asignado actualmente.</p>
                                        <p className="text-[11px] text-zinc-500 mt-1">Contactá con Atención al Cliente si necesitás asistencia personalizada.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </GlassCard>

                {/* Últimos Movimientos */}
                <GlassCard noPadding className="lg:col-span-2 overflow-hidden">
                    <div className="p-6 border-b border-white/10 flex justify-between items-center bg-black/40">
                        <h3 className="font-bold text-lg text-white">Últimos Pedidos</h3>
                    </div>
                    <div className="overflow-x-auto hidden md:block">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-black/60 text-zinc-400 border-b border-white/10">
                                <tr>
                                    <th className="p-4 font-medium">Orden</th>
                                    <th className="p-4 font-medium">Fecha</th>
                                    <th className="p-4 font-medium">Nombre</th>
                                    <th className="p-4 font-medium">Total</th>
                                    <th className="p-4 font-medium text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 basic-table-body">
                                {loadingOrders ? (
                                    <tr>
                                        <td colSpan="5" className="p-8 text-center text-zinc-500">Cargando últimos pedidos...</td>
                                    </tr>
                                ) : recentActivity.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="p-8 text-center text-zinc-500">
                                            <Package size={32} className="mx-auto mb-2 opacity-50 text-white" />
                                            No tenés pedidos recientes
                                        </td>
                                    </tr>
                                ) : recentActivity.map((order, index) => (
                                    <tr key={`${order.id}-${index}`} className="hover:bg-white/5 transition-colors">
                                        <td className="p-4 font-medium text-white">{order.id}</td>
                                        <td className="p-4 text-zinc-400">{order.date}</td>
                                        <td className="p-4 text-zinc-300">{order.type}</td>
                                        <td className="p-4 font-medium text-white">{order.amount != null ? `${order.currency} ${Number(order.amount).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</td>
                                        <td className="p-4 text-center">
                                            <StatusBadge status={order.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card List (Visible solo en pantallas pequeñas) */}
                    <div className="md:hidden divide-y divide-white/10">
                        {loadingOrders ? (
                            <div className="p-8 text-center text-zinc-500">Cargando últimos pedidos...</div>
                        ) : recentActivity.length === 0 ? (
                            <div className="p-8 text-center text-zinc-500">
                                <Package size={32} className="mx-auto mb-2 opacity-50 text-white" />
                                No tenés pedidos recientes
                            </div>
                        ) : recentActivity.map((order, index) => (
                            <div key={`${order.id}-${index}`} className="p-4 space-y-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-xs font-bold text-brand-cyan uppercase tracking-wider">{order.id}</p>
                                        <p className="text-[10px] text-zinc-500 uppercase">{order.date}</p>
                                    </div>
                                    <StatusBadge status={order.status} className="scale-90 origin-right" />
                                </div>
                                <div>
                                    <p className="text-sm text-zinc-100 font-medium line-clamp-1">{order.type}</p>
                                </div>
                                <div className="flex justify-between items-center pt-1">
                                    <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Total</p>
                                    <p className="text-sm font-bold text-white">
                                        {order.amount != null ? `${order.currency} ${Number(order.amount).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </GlassCard>
            </div>
        </div>
    );
};
