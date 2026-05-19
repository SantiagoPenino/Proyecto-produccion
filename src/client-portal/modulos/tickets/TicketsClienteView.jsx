import React, { useState, useEffect, useMemo } from 'react';
import { GlassCard } from '../../pautas/GlassCard';
import { CustomButton } from '../../pautas/CustomButton';
import { CustomSelect } from '../../pautas/CustomSelect';
import { apiClient } from '../../api/apiClient';
import { Plus, MessageSquare, Clock, CheckCircle, XCircle, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CreateTicketModal from './CreateTicketModal';
import { socket } from '../../../services/socketService';

export const TicketsClienteView = () => {
    const navigate = useNavigate();
    const [tickets, setTickets] = useState([]);
    const [filterStatus, setFilterStatus] = useState('0');
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const fetchTickets = async () => {
        setLoading(true);
        try {
            const res = await apiClient.get('/tickets');
            if (res.success) {
                setTickets(res.data || []);
            }
        } catch (error) {
            console.error('Error fetching tickets:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTickets();
    }, []);

    // Suscribirse en tiempo real a las actualizaciones de cada ticket de la lista
    useEffect(() => {
        if (!tickets || tickets.length === 0) return;

        tickets.forEach(t => {
            socket.emit('join:ticket', { ticketId: t.TicIdTicket });
        });

        const handleSocketUpdate = () => {
            // Silenciosamente volvemos a buscar la info fresca de los tickets
            apiClient.get('/tickets').then(res => {
                if (res.success) setTickets(res.data || []);
            });
        };

        socket.on('ticket:new_message', handleSocketUpdate);
        socket.on('ticket:updated', handleSocketUpdate);

        return () => {
            tickets.forEach(t => {
                socket.emit('leave:ticket', { ticketId: t.TicIdTicket });
            });
            socket.off('ticket:new_message', handleSocketUpdate);
            socket.off('ticket:updated', handleSocketUpdate);
        };
    }, [tickets.length]);

    const filteredTickets = useMemo(() => {
        if (!tickets) return [];
        if (filterStatus === '0') return tickets;
        return tickets.filter(t => t.TicEstado === parseInt(filterStatus));
    }, [tickets, filterStatus]);

    const getStatusBadge = (statusId) => {
        const statuses = {
            1: { label: 'Abierto', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
            2: { label: 'Procesando', class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
            3: { label: 'Responder', class: 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20' },
            4: { label: 'Resuelto', class: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' },
            5: { label: 'Cerrado', class: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
        };
        const st = statuses[statusId] || { label: 'Desconocido', class: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' };
        return <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${st.class}`}>{st.label}</span>;
    };

    return (
        <div className="animate-fade-in md:max-w-7xl md:mx-auto space-y-6">
            <div className="flex flex-col gap-3">
                <div>
                    <h2 className="text-xl font-bold text-zinc-300 uppercase flex items-center gap-2">
                        <MessageSquare className="text-brand-gold" size={24} />
                        Centro de <span className="text-custom-cyan">Ayuda</span>
                    </h2>
                    <p className="text-zinc-500 text-sm">Gestiona tus consultas y reclamos técnicos.</p>
                </div>
                <div className="flex gap-2 w-full md:justify-between" style={{ marginTop: 8 }}>
                    <div className="w-1/2 md:w-48">
                        <CustomSelect
                            value={filterStatus}
                            onChange={setFilterStatus}
                            placeholder="Todos"
                            options={[
                                { value: '0', label: 'Todos' },
                                { value: '1', label: 'Abierto' },
                                { value: '2', label: 'Procesando' },
                                { value: '3', label: 'Responder' },
                                { value: '4', label: 'Resuelto' },
                                { value: '5', label: 'Cerrado' }
                            ]}
                            className="w-full"
                        />
                    </div>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="w-1/2 md:w-48 flex items-center justify-center gap-2 border border-brand-cyan text-brand-cyan text-sm font-semibold hover:bg-brand-cyan/10 transition-all shadow-[0_0_12px_rgba(6,182,212,0.2)] hover:shadow-[0_0_18px_rgba(6,182,212,0.35)] active:scale-95"
                        style={{
                            padding: '12px 20px',
                            borderRadius: 12,
                            background: 'rgba(0, 174, 239, 0.08)',
                            color: '#00AEEF'
                        }}
                    >
                        <Plus size={16} /> Nuevo Ticket
                    </button>
                </div>
            </div>

            <GlassCard className="hidden md:block p-0 overflow-hidden rounded-xl">
                {/* Vista Desktop (Tabla) */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-zinc-800/50 text-zinc-400 text-xs uppercase tracking-wider">
                                <th className="p-4 border-b border-zinc-700/50 font-semibold rounded-tl-lg">ID</th>
                                <th className="p-4 border-b border-zinc-700/50 font-semibold">F. Actualización</th>
                                <th className="p-4 border-b border-zinc-700/50 font-semibold">Departamento</th>
                                <th className="p-4 border-b border-zinc-700/50 font-semibold">Asunto</th>
                                <th className="p-4 border-b border-zinc-700/50 font-semibold text-center rounded-tr-lg">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-zinc-500">
                                        <div className="flex justify-center"><Clock className="w-6 h-6 animate-spin" /></div>
                                    </td>
                                </tr>
                            ) : filteredTickets.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-zinc-500">
                                        No tenés tickets que coincidan con el filtro.
                                    </td>
                                </tr>
                            ) : (
                                filteredTickets.map(t => (
                                    <tr
                                        key={t.TicIdTicket}
                                        onClick={() => navigate(`/portal/soporte/${t.TicIdTicket}`)}
                                        className="border-b border-zinc-700/30 hover:bg-zinc-800/40 transition-colors cursor-pointer"
                                    >
                                        <td className="p-4 text-zinc-300 font-mono">#{t.TicIdTicket}</td>
                                        <td className="p-4 text-zinc-400">{new Date(t.TicFechaActualizacion).toLocaleDateString('es-UY')}</td>
                                        <td className="p-4 text-zinc-300">{t.Departamento || '-'}</td>
                                        <td className="p-4 text-zinc-200 font-medium">{t.TicAsunto}</td>
                                        <td className="p-4 text-center">{getStatusBadge(t.TicEstado)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </GlassCard>

            {/* Vista Mobile (Tarjetas) */}
            <div className="md:hidden flex flex-col gap-3 w-full">
                    {loading ? (
                        <div className="p-8 flex justify-center text-zinc-500">
                            <Clock className="w-6 h-6 animate-spin" />
                        </div>
                    ) : filteredTickets.length === 0 ? (
                        <div className="p-8 text-center text-zinc-500 text-sm">
                            No tenés tickets que coincidan con el filtro.
                        </div>
                    ) : (
                        filteredTickets.map(t => (
                            <div
                                key={t.TicIdTicket}
                                onClick={() => navigate(`/portal/soporte/${t.TicIdTicket}`)}
                                className="flex flex-col p-4 pb-3 border border-zinc-700/50 bg-zinc-800/20 gap-2 hover:bg-zinc-800/40 transition-colors cursor-pointer rounded-xl"
                            >
                                <div className="flex justify-between items-start">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-zinc-300 font-mono text-xs">#{t.TicIdTicket} • {new Date(t.TicFechaActualizacion).toLocaleDateString('es-UY')}</span>
                                        <span className="text-zinc-200 font-semibold">{t.TicAsunto}</span>
                                    </div>
                                    <div>{getStatusBadge(t.TicEstado)}</div>
                                </div>
                                <span className="text-zinc-400 text-xs">{t.Departamento || '-'}</span>
                            </div>
                        ))
                    )}
                </div>

            <CreateTicketModal 
                isOpen={isCreateModalOpen} 
                onClose={() => setIsCreateModalOpen(false)} 
                onCreated={() => {
                    setIsCreateModalOpen(false);
                    fetchTickets();
                }}
            />
        </div>
    );
};
