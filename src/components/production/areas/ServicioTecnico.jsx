import React, { useState, useEffect } from 'react';
import { failuresService } from '../../../services/api';

const ServicioTecnico = ({ onSwitchTab }) => {
    const [activeTab, setActiveTab] = useState('tickets');
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(false);

    // Cargar tickets al montar
    useEffect(() => {
        if (activeTab === 'tickets') {
            loadTickets();
        }
    }, [activeTab]);

    const loadTickets = async () => {
        setLoading(true);
        try {
            const data = await failuresService.getAll();
            setTickets(data);
        } catch (error) {
            console.error("Error cargando tickets:", error);
        } finally {
            setLoading(false);
        }
    };

    // Función para obtener clase de color según prioridad
    const getPrioClass = (prio) => {
        switch (prio) {
            case 'Alta': case 'Urgente': return "bg-red-50 text-red-600 border-red-200";
            case 'Media': return "bg-amber-50 text-amber-600 border-amber-200";
            default: return "bg-blue-50 text-blue-600 border-blue-200";
        }
    };

    return (
        <div className="flex flex-col h-screen bg-zinc-50 font-sans">
            {/* HEADER TIPO DASHBOARD */}
            <div className="bg-zinc-900 text-white px-6 py-4 flex justify-between items-center shadow-md">
                <div className="flex items-center gap-4">
                    <button
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                        onClick={() => onSwitchTab('dashboard')}
                    >
                        <i className="fa-solid fa-arrow-left"></i>
                    </button>
                    <div>
                        <h1 className="text-xl font-bold m-0">Servicio Técnico</h1>
                        <span className="text-xs text-zinc-400 font-medium">Gestión de Mantenimiento Global</span>
                    </div>
                </div>

                {/* TABS DE NAVEGACIÓN */}
                <div className="flex gap-1 bg-white/10 p-1 rounded-lg">
                    {['tickets', 'machines', 'projects'].map(tab => (
                        <button
                            key={tab}
                            className={`px-4 py-2 rounded-md transition-all text-sm font-bold flex items-center gap-2
                        ${activeTab === tab
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'bg-transparent text-zinc-400 hover:text-white hover:bg-white/5'}
                    `}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab === 'tickets' && <i className="fa-solid fa-ticket"></i>}
                            {tab === 'machines' && <i className="fa-solid fa-screwdriver-wrench"></i>}
                            {tab === 'projects' && <i className="fa-solid fa-clipboard-check"></i>}
                            <span className="capitalize">
                                {tab === 'machines' ? 'Máquinas' : tab === 'projects' ? 'Proyectos' : 'Tickets'}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* CONTENIDO PRINCIPAL */}
            <div className="flex-1 p-6 overflow-y-auto">

                {activeTab === 'tickets' && (
                    <div className="flex flex-col h-full">
                        <div className="flex justify-between items-center mb-5 shrink-0">
                            <h3 className="text-lg font-bold text-zinc-700">Historial de Incidentes</h3>
                            <button
                                className="px-4 py-2 bg-white border border-zinc-200 rounded-lg text-zinc-600 text-sm font-bold hover:bg-zinc-50 hover:text-blue-600 transition-colors shadow-sm active:scale-95"
                                onClick={loadTickets}
                            >
                                <i className="fa-solid fa-rotate-right mr-2"></i> Actualizar
                            </button>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden flex-1 flex flex-col">
                            <div className="overflow-auto custom-scrollbar">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            {['ID', 'Fecha', 'Área', 'Máquina', 'Falla / Título', 'Prioridad', 'Reportado Por', 'Estado', 'Acción'].map((h, i) => (
                                                <th key={i} className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-wider text-[10px] whitespace-nowrap">
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {loading ? (
                                            <tr><td colSpan="9" className="py-10 text-center text-zinc-400 italic">Cargando...</td></tr>
                                        ) : tickets.length === 0 ? (
                                            <tr><td colSpan="9" className="py-10 text-center text-zinc-400 italic">No hay tickets pendientes.</td></tr>
                                        ) : (
                                            tickets.map(t => (
                                                <tr key={t.TicketID} className="hover:bg-zinc-50 transition-colors group">
                                                    <td className="px-4 py-3 font-mono font-bold text-zinc-400 text-xs">{t.TicketID}</td>
                                                    <td className="px-4 py-3 text-zinc-600 text-xs">{new Date(t.FechaReporte).toLocaleDateString()}</td>
                                                    <td className="px-4 py-3">
                                                        <span className="bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded text-[10px] font-bold border border-zinc-200">
                                                            {t.AreaID}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 font-bold text-zinc-700 text-xs">{t.Maquina}</td>
                                                    <td className="px-4 py-3 max-w-xs">
                                                        <div className="font-bold text-zinc-800 text-sm truncate" title={t.Titulo}>{t.Titulo}</div>
                                                        <div className="text-xs text-zinc-400 truncate" title={t.Descripcion}>{t.Descripcion}</div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${getPrioClass(t.Prioridad)}`}>
                                                            {t.Prioridad}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-zinc-600">{t.ReportadoPor}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide
                                                    ${t.Estado === 'Abierto'
                                                                ? 'bg-red-50 text-red-700 border border-red-100'
                                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}
                                                `}>
                                                            {t.Estado}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <button
                                                            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                                            title="Ver Detalles"
                                                        >
                                                            <i className="fa-solid fa-eye"></i>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'machines' && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-4">
                        <div className="w-20 h-20 bg-zinc-100 rounded-full flex items-center justify-center">
                            <i className="fa-solid fa-screwdriver-wrench text-3xl opacity-50"></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-zinc-600 mb-1">Inventario de Máquinas</h3>
                            <p className="text-sm">Aquí irá el listado de todas las máquinas y su estado operativo.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServicioTecnico;
