import React from 'react';
import { useAuth } from '../auth/AuthContext';
import { GlassCard } from '../pautas/GlassCard';
import { Crown, DollarSign, TrendingUp, CheckCircle, Smartphone, Mail } from 'lucide-react';
import { StatusBadge } from '../pautas/StatusBadge';

export const ProfileView = () => {
    const { user } = useAuth();

    // Mock data for recent activity (could be moved to a service later)
    const recentActivity = [
        { id: '#ORD-8920', date: '20 Oct, 2023', type: 'Corte Láser', status: 'En Producción', amount: 15400 },
        { id: '#ORD-8915', date: '18 Oct, 2023', type: 'DTF Común', status: 'Finalizado', amount: 8500 },
        { id: '#ORD-8902', date: '15 Oct, 2023', type: 'Sublimación', status: 'Finalizado', amount: 23000 },
        { id: '#ORD-8890', date: '10 Oct, 2023', type: 'Bordado', status: 'Pendiente', amount: 12000 },
    ];

    if (!user) return null;

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-3xl font-bold text-neutral-800">Mi Perfil</h2>
                <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-sm font-bold border border-amber-200 flex items-center gap-1">
                    <Crown size={14} /> {user.level || 'Member'}
                </span>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <GlassCard className="!p-6">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-neutral-100 rounded-lg text-black"><DollarSign size={20} /></div>
                        <p className="text-neutral-500 text-sm font-medium">Gasto Mensual</p>
                    </div>
                    {/* Fallback properties if user object doesn't have them yet */}
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
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Datos Personales */}
                <GlassCard className="!p-6 h-fit">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-lg text-neutral-800">Datos de Cuenta</h3>
                        <button className="text-black text-sm font-medium hover:underline">Editar</button>
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center font-bold text-zinc-500 text-lg border border-zinc-300">
                                {user.avatar || user.name?.charAt(0) || 'U'}
                            </div>
                            <div>
                                <p className="font-bold text-neutral-800">{user.name}</p>
                                <p className="text-xs text-neutral-500">{user.company || 'Sin Empresa'}</p>
                            </div>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 space-y-3 text-sm">
                            <div className="flex items-start gap-3">
                                <Mail size={16} className="text-zinc-400 mt-0.5" />
                                <div>
                                    <p className="text-xs text-neutral-400 uppercase font-bold">Email</p>
                                    <p className="text-neutral-700">{user.email}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Smartphone size={16} className="text-zinc-400 mt-0.5" />
                                <div>
                                    <p className="text-xs text-neutral-400 uppercase font-bold">Teléfono</p>
                                    <p className="text-neutral-700">{user.phone || 'No registrado'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </GlassCard>

                {/* Últimos Movimientos */}
                <GlassCard noPadding className="lg:col-span-2 overflow-hidden">
                    <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
                        <h3 className="font-bold text-lg text-neutral-800">Últimos Pedidos</h3>
                        <button className="text-neutral-400 hover:text-black text-sm">Ver todos</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-neutral-50 text-neutral-500 border-b border-zinc-100">
                                <tr>
                                    <th className="p-4 font-medium">ID Pedido</th>
                                    <th className="p-4 font-medium">Fecha</th>
                                    <th className="p-4 font-medium">Servicio</th>
                                    <th className="p-4 font-medium">Total</th>
                                    <th className="p-4 font-medium text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 basic-table-body">
                                {recentActivity.map(order => (
                                    <tr key={order.id} className="hover:bg-neutral-50 transition-colors">
                                        <td className="p-4 font-medium text-black">{order.id}</td>
                                        <td className="p-4 text-neutral-500">{order.date}</td>
                                        <td className="p-4 text-neutral-700">{order.type}</td>
                                        <td className="p-4 font-medium text-neutral-800">${order.amount.toLocaleString()}</td>
                                        <td className="p-4 text-center">
                                            <StatusBadge status={order.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </GlassCard>
            </div>
        </div>
    );
};
