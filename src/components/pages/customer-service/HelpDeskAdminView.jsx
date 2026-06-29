import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient, API_BASE_URL } from '../../../client-portal/api/apiClient';
import { socket } from '../../../services/socketService';
import { GlassCard } from '../../../client-portal/pautas/GlassCard';
import { CustomButton } from '../../../client-portal/pautas/CustomButton';
import { Search, Filter, MessageSquare, Clock, AlertCircle, FileText, Send, Lock, RotateCcw, CheckCircle, Package, ChevronDown, Check, X, Download } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { toast } from 'sonner';
import { Listbox, Transition } from '@headlessui/react';

const CustomSelect = ({ value, onChange, options, className, placeholder = "Seleccionar..." }) => {
    const [open, setOpen] = useState(false);
    const closeTimer = useRef(null);
    const selectedOption = options.find(o => String(o.value) === String(value)) || { label: placeholder, value: '' };

    // Encontrar la opción con el label más largo para auto-dimensionar
    const longestLabel = options.reduce((longest, opt) => {
        const label = opt.label || "";
        return label.length > longest.length ? label : longest;
    }, placeholder);

    const handleMouseEnter = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        setOpen(true);
    };

    const handleMouseLeave = () => {
        closeTimer.current = setTimeout(() => setOpen(false), 80);
    };

    const handleSelect = (optionValue) => {
        onChange(optionValue);
        setOpen(false);
    };

    return (
        <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <button
                type="button"
                className={`relative w-full cursor-pointer text-left focus:outline-none grid grid-cols-1 grid-rows-1 items-center transition-all ${className}`}
                style={{ paddingRight: '2.5rem' }} // Asegura espacio para la flecha
            >
                {/* Texto fantasma invisible que fuerza el ancho al de la opción más ancha */}
                <span className="invisible h-0 col-start-1 row-start-1 select-none pointer-events-none whitespace-nowrap font-medium">
                    {longestLabel}
                </span>

                {/* Texto real seleccionado */}
                <span className="col-start-1 row-start-1 truncate block font-medium">
                    {selectedOption.label}
                </span>

                {/* Icono de flecha */}
                <span className="absolute right-3 pointer-events-none flex items-center shrink-0">
                    <ChevronDown className={`h-4 w-4 opacity-50 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
                </span>
            </button>

            {open && (
                <>
                    {/* Puente invisible que cubre el gap entre el botón y el panel */}
                    <div className="absolute left-0 right-0 h-2 z-[4999]" style={{ top: '100%' }} />
                    <div className="absolute z-[5000] w-full min-w-max rounded-xl bg-white py-1 text-sm shadow-xl ring-1 ring-black/5 font-medium overflow-hidden" style={{ top: 'calc(100% + 4px)' }}>
                        {options.map((option, idx) => {
                            const isSelected = String(option.value) === String(value);
                            return (
                                <div
                                    key={idx}
                                    onClick={() => handleSelect(option.value)}
                                    className={`relative cursor-pointer select-none py-2.5 pl-9 pr-4 transition-colors ${isSelected ? 'bg-brand-cyan/10 text-brand-cyan font-bold' : 'text-zinc-700 hover:bg-zinc-50'}`}
                                >
                                    <span className="block truncate">{option.label}</span>
                                    {isSelected && (
                                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-brand-cyan">
                                            <Check className="h-4 w-4" />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
};

const getStatusBadgeClass = (statusId) => {
    switch (Number(statusId)) {
        case 1: // Abiertos
            return 'bg-emerald-600/10 text-emerald-600 border border-emerald-600/20';
        case 2: // Procesando
            return 'bg-brand-gold/10 text-brand-gold border border-brand-gold/20';
        case 3: // Esperar
            return 'bg-brand-magenta/10 text-brand-magenta border border-brand-magenta/20';
        case 4: // Resuelto
            return 'bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20';
        case 5: // Cerrado
            return 'bg-zinc-600/10 text-zinc-600 border border-zinc-600/20';
        default:
            return 'bg-zinc-600/10 text-zinc-600 border border-zinc-600/20';
    }
};

const getStatusSelectClass = (statusId) => {
    switch (Number(statusId)) {
        case 1:
            return 'bg-emerald-600/10 text-emerald-600 border border-emerald-600/20 hover:bg-emerald-600/20';
        case 2:
            return 'bg-brand-gold/10 text-brand-gold border border-brand-gold/20 hover:bg-brand-gold/20';
        case 3:
            return 'bg-brand-magenta/10 text-brand-magenta border border-brand-magenta/20 hover:bg-brand-magenta/20';
        case 4:
            return 'bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20 hover:bg-brand-cyan/20';
        case 5:
            return 'bg-zinc-600/10 text-zinc-600 border border-zinc-600/20 hover:bg-zinc-600/20';
        default:
            return 'bg-zinc-600/10 text-zinc-600 border border-zinc-600/20 hover:bg-zinc-600/20';
    }
};

export const HelpDeskAdminView = () => {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedTicketId, setSelectedTicketId] = useState(null);
    const [departamentos, setDepartamentos] = useState([]);

    // Filtros inbox
    const [filterDep, setFilterDep] = useState('ALL');
    const [filterEstado, setFilterEstado] = useState('ALL'); // Todos por defecto

    // Auto-seleccionar ticket desde los query params (e.g. ?ticketId=123)
    useEffect(() => {
        const ticketIdParam = searchParams.get('ticketId');
        if (ticketIdParam) {
            setSelectedTicketId(parseInt(ticketIdParam));
        }
    }, [searchParams]);

    useEffect(() => {
        apiClient.get('/tickets/categorias').then(res => {
            if (res.success) setDepartamentos(res.data);
        }).catch(e => console.error(e));

        fetchTickets();

        // Unirse al room de admin para recibir actualizaciones en tiempo real
        socket.emit('join:helpdesk_admin');

        const handleNewTicket = (data) => {
            fetchTickets();
        };

        const handleTicketUpdated = (data) => {
            fetchTickets();
        };

        socket.on('ticket:new', handleNewTicket);
        socket.on('ticket:updated', handleTicketUpdated);

        return () => {
            socket.emit('leave:helpdesk_admin');
            socket.off('ticket:new', handleNewTicket);
            socket.off('ticket:updated', handleTicketUpdated);
        };
    }, []);

    const fetchTickets = async () => {
        try {
            const res = await apiClient.get('/tickets');
            if (res.success) setTickets(res.data || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const displayTickets = tickets.filter(t => {
        let matchDep = filterDep === 'ALL' || t.DepIdDepartamento === parseInt(filterDep);
        // "Todos" omite los estados terminales (Resuelto=4 y Cerrado=5); se ven con su filtro específico.
        let matchEst = filterEstado === 'ALL'
            ? (Number(t.TicEstado) !== 4 && Number(t.TicEstado) !== 5)
            : String(t.TicEstado) === String(filterEstado);
        return matchDep && matchEst;
    });

    const handleSelectTicket = (id) => {
        setSelectedTicketId(id);
    };

    const getStatusText = (statusId) => {
        const m = { 1: 'Abierto', 2: 'Procesando', 3: 'Esperar', 4: 'Resuelto', 5: 'Cerrado' };
        return m[statusId] || 'Desconocido';
    };

    return (
        <div className="flex flex-1 h-full w-full animate-fade-in text-zinc-800">

            {/* INBOX PANEL (Left) */}
            <div className="w-full lg:w-[410px] lg:shrink-0 flex flex-col p-4 bg-white border-r border-zinc-200 z-10">
                <div className="mb-4 space-y-4">
                    <div>
                        <h2 className="text-xl font-bold uppercase tracking-wide flex items-center gap-2">
                            <MessageSquare className="text-brand-cyan" />
                            HelpDesk <span className="text-zinc-500 font-normal">Inbox</span>
                        </h2>
                    </div>

                    <div className="flex gap-2 text-sm">
                        <CustomSelect
                            className="bg-white border border-zinc-300 text-zinc-700 rounded-lg px-3 py-1.5 hover:border-brand-cyan/50"
                            value={filterDep}
                            onChange={setFilterDep}
                            options={[
                                { value: 'ALL', label: 'Todas las Áreas' },
                                ...departamentos.map(d => ({ value: d.ID, label: d.Nombre }))
                            ]}
                        />
                        <CustomSelect
                            className="bg-white border border-zinc-300 text-zinc-700 rounded-lg px-3 py-1.5 hover:border-brand-cyan/50"
                            value={filterEstado}
                            onChange={setFilterEstado}
                            options={[
                                { value: 'ALL', label: 'Todos' },
                                { value: '1', label: 'Abierto' },
                                { value: '2', label: 'Procesando' },
                                { value: '3', label: 'Esperar' },
                                { value: '4', label: 'Resuelto' },
                                { value: '5', label: 'Cerrado' }
                            ]}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {loading && <div className="text-center py-4 text-zinc-500"><Clock className="animate-spin mx-auto mb-2" /> Cargando...</div>}
                    {!loading && displayTickets.length === 0 && <div className="text-center py-4 text-zinc-500">Bandeja limpia ✨</div>}

                    {displayTickets.map(t => (
                        <div
                            key={t.TicIdTicket}
                            onClick={() => handleSelectTicket(t.TicIdTicket)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer ${selectedTicketId === t.TicIdTicket
                                    ? 'bg-brand-cyan/10 border-brand-cyan/30 shadow-[0_0_15px_rgba(30,214,255,0.1)]'
                                    : 'bg-white border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                                }`}
                        >
                            {/* Fila 1: #idticket vs Area */}
                            <div className="flex justify-between items-center text-xs text-zinc-500 font-medium mb-1.5">
                                <span className="text-brand-cyan font-mono font-bold text-xs">#{t.TicIdTicket}</span>
                                <span className="truncate text-zinc-600 font-semibold text-[11px]">{t.Departamento}</span>
                            </div>

                            {/* Fila 2: Asunto vs Estado */}
                            <div className="flex justify-between items-center gap-4">
                                <h4 className="font-semibold text-sm line-clamp-1 text-zinc-800 flex-1 text-left flex items-center gap-2">
                                    {Number(t.TicEstado) === 1 && (
                                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm animate-pulse shrink-0" />
                                    )}
                                    <span>{t.TicAsunto}</span>
                                </h4>
                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full shrink-0 ${getStatusBadgeClass(t.TicEstado)}`}>
                                    {getStatusText(t.TicEstado)}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* MESSAGE THREAD PANEL (Right) */}
            <div className="hidden lg:flex flex-col flex-1 overflow-hidden bg-zinc-50">
                {selectedTicketId ? (
                    <TicketAdminInterface
                        ticketId={selectedTicketId}
                        onUpdate={() => fetchTickets()}
                        departamentos={departamentos}
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                        <MessageSquare size={64} className="text-brand-cyan opacity-30" />
                        <p className="text-lg text-brand-cyan/70 font-medium">Seleccioná un ticket del Inbox para ver los detalles.</p>
                    </div>
                )}
            </div>

            {/* TODO: Implementar version Mobile/Drawer para el Thread si es menor a lg viewport */}
        </div>
    );
};

// ==============================================================================
// COMPONENTE PARA MOSTRAR IMAGEN DE ADJUNTO CON AUTH
// ==============================================================================
const AdjuntoImage = ({ ticketId, filename, displayName, onClick }) => {
    const [blobUrl, setBlobUrl] = React.useState(null);

    React.useEffect(() => {
        const token = localStorage.getItem('auth_token');
        fetch(`${API_BASE_URL}/tickets/adjunto/${ticketId}/${filename}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(r => r.ok ? r.blob() : null)
            .then(blob => blob ? setBlobUrl(URL.createObjectURL(blob)) : null)
            .catch(() => {});

        return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    }, [filename]);

    if (!blobUrl) return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-200 text-zinc-600">
            <FileText size={14} /> {displayName}
        </div>
    );

    const handleImgClick = (e) => {
        if (onClick) {
            onClick(e, blobUrl);
        }
    };

    return <img src={blobUrl} alt={displayName} onClick={handleImgClick} className="max-h-48 max-w-xs object-cover rounded-lg block cursor-pointer hover:opacity-90 transition-opacity" />;
};

// ==============================================================================
// SUB-COMPONENTE INTERFAZ DE ADMINISTRACION DE TICKET INDIVIDUAL
// ==============================================================================
const TicketAdminInterface = ({ ticketId, onUpdate, departamentos }) => {
    const [ticket, setTicket] = useState(null);
    const [mensajes, setMensajes] = useState([]);
    const [loading, setLoading] = useState(true);

    // Reply State
    const [esNotaInterna, setEsNotaInterna] = useState(false);
    const [texto, setTexto] = useState('');
    const [archivos, setArchivos] = useState([]);
    const [sending, setSending] = useState(false);
    const [modalImage, setModalImage] = useState(null);
    const [modalClosing, setModalClosing] = useState(false);
    const [zoomScale, setZoomScale] = useState(1);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const isDragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const lastPan = useRef({ x: 0, y: 0 });
    const imgContainerRef = useRef(null);

    const messagesEndRef = useRef(null);

    const fetchThread = async () => {
        try {
            const res = await apiClient.get(`/tickets/${ticketId}`);
            if (res.success) {
                setTicket(res.ticket);
                setMensajes(res.mensajes);
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    };

    useEffect(() => {
        setLoading(true);
        fetchThread();
        setEsNotaInterna(false);
        setTexto('');
        setArchivos([]);

        // Unirse al room del ticket seleccionado
        socket.emit('join:ticket', { ticketId: ticketId });

        const handleUpdate = (data) => {
            if (String(data.ticketId) === String(ticketId)) fetchThread();
        };
        socket.on('ticket:new_message', handleUpdate);
        socket.on('ticket:updated', handleUpdate);

        return () => {
            socket.emit('leave:ticket', { ticketId: ticketId });
            socket.off('ticket:new_message', handleUpdate);
            socket.off('ticket:updated', handleUpdate);
        };
    }, [ticketId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [mensajes]);

    const closeModal = () => {
        setModalClosing(true);
        setTimeout(() => {
            setModalImage(null);
            setModalClosing(false);
            setZoomScale(1);
            setPanOffset({ x: 0, y: 0 });
        }, 200);
    };

    const handleModalWheel = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        setZoomScale(prev => Math.min(Math.max(prev + delta, 1), 5));
    };

    const handleMouseDown = (e) => {
        if (e.button !== 0) return;
        isDragging.current = true;
        dragStart.current = { x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y };
        e.currentTarget.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e) => {
        if (!isDragging.current) return;
        const newX = e.clientX - dragStart.current.x;
        const newY = e.clientY - dragStart.current.y;
        lastPan.current = { x: newX, y: newY };
        setPanOffset({ x: newX, y: newY });
    };

    const handleMouseUp = (e) => {
        isDragging.current = false;
        e.currentTarget.style.cursor = zoomScale > 1 ? 'grab' : 'default';
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') closeModal();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSend = async () => {
        if (!texto.trim() && archivos.length === 0) return;
        setSending(true);
        try {
            const formData = new FormData();
            formData.append('texto', texto);
            formData.append('esNotaInterna', esNotaInterna);
            archivos.forEach(f => formData.append('evidencia', f));

            const res = await apiClient.postFormData(`/tickets/${ticketId}/responder`, formData);

            if (res.success) {
                toast.success(esNotaInterna ? "Nota Interna Guardada" : "Respuesta al cliente enviada.");
                setTexto('');
                setArchivos([]);
                fetchThread();
                onUpdate();
            } else {
                toast.error(res.error || 'No se pudo enviar la respuesta.');
            }
        } catch (e) {
            toast.error(e?.message || 'Error al enviar.');
        } finally {
            setSending(false);
        }
    };

    const showSuccessToast = (msg) => {
        toast(msg, {
            position: "bottom-right",
            icon: <CheckCircle className="h-4 w-4" style={{ color: '#006E97' }} />,
            style: {
                background: '#ecfeff',
                color: '#006E97',
                border: '1px solid rgba(0, 110, 151, 0.3)',
                borderRadius: '12px',
                padding: '12px 16px',
                fontWeight: '600',
                fontSize: '14px',
                boxShadow: '0 10px 15px -3px rgba(0, 110, 151, 0.15), 0 4px 6px -2px rgba(0, 110, 151, 0.05)'
            }
        });
    };

    const showErrorToast = (msg) => {
        toast.error(msg, {
            position: "bottom-right",
            style: {
                background: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                borderRadius: '12px',
                padding: '12px 16px',
                fontWeight: '600',
                fontSize: '14px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
            }
        });
    };

    const changeStatus = async (nuevoEstado) => {
        try {
            const res = await apiClient.put(`/tickets/${ticketId}/estado`, { nuevoEstado });
            if (res.success) {
                showSuccessToast("Estado actualizado.");
                fetchThread();
                onUpdate();
            }
        } catch (e) { showErrorToast("Error al cambiar estado."); }
    };

    const reasignarDep = async (depId) => {
        try {
            const res = await apiClient.put(`/tickets/${ticketId}/estado`, { departamentoId: depId });
            if (res.success) {
                showSuccessToast("Ticket Reasignado a otra área.");
                fetchThread();
                onUpdate();
            }
        } catch (e) { showErrorToast("Error al reasignar."); }
    };

    if (loading || !ticket) return <div className="p-10 flex justify-center text-zinc-500"><Clock className="animate-spin" /></div>;

    const isClosed = ticket.TicEstado === 4 || ticket.TicEstado === 5;

    return (
        <div className="flex flex-col h-full relative">

            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white border-b border-zinc-200 shrink-0 z-20 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-base font-bold font-mono text-zinc-800">#{ticket.TicIdTicket}</span>
                    <div className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-zinc-100 text-zinc-600 shrink-0">
                        {ticket.DepNombre}
                    </div>
                    <span className="text-sm font-semibold text-zinc-600 truncate">{ticket.TicAsunto}</span>
                    {(ticket.OrdCodigoOrden || ticket.OrdIdOrden) && (
                        <div className="flex items-center gap-1 text-xs text-brand-gold font-medium border-l border-zinc-300 pl-2 shrink-0">
                            <Package size={13} /> {ticket.OrdCodigoOrden || ticket.OrdIdOrden}
                        </div>
                    )}
                    {ticket.ClienteNombre && (
                        <div className="flex items-center gap-1 text-xs font-medium border-l border-zinc-300 pl-2 shrink-0">
                            <span className="uppercase font-bold tracking-wide text-zinc-400">Cliente:</span>
                            <span className="text-brand-magenta">{ticket.ClienteNombre}{ticket.ClienteCelular ? ` (${ticket.ClienteCelular})` : ''}</span>
                        </div>
                    )}
                </div>

                {/* Admin Actions */}
                <div className="flex gap-2 text-sm shrink-0">
                    <CustomSelect
                        className="bg-white border border-zinc-300 text-zinc-700 rounded-lg px-3 py-1.5 hover:border-brand-cyan/50"
                        value={""}
                        onChange={(val) => val && reasignarDep(val)}
                        placeholder="Derivar a..."
                        options={departamentos.map(d => ({ value: d.ID, label: d.Nombre }))}
                    />

                    <CustomSelect
                        className={`border rounded-lg px-3 py-1.5 font-medium ${getStatusSelectClass(ticket.TicEstado)}`}
                        value={ticket.TicEstado}
                        onChange={changeStatus}
                        options={[
                            { value: 1, label: "Abierto" },
                            { value: 2, label: "Procesando" },
                            { value: 3, label: "Esperar" },
                            { value: 4, label: "Resuelto" },
                            { value: 5, label: "Cerrado" }
                        ]}
                    />
                </div>
            </div>

            {/* Chat Thread */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
                {mensajes.map(msg => {
                    const isSystemStaff = msg.UsrIdAutor !== null;
                    const isInternalNote = msg.TMenEsNotaInterna;

                    return (
                        <div key={msg.TMenIdMensaje} className={`flex flex-col ${isSystemStaff ? 'items-end' : 'items-start'}`}>

                            <div className="text-[11px] text-zinc-500 font-bold mb-1 px-1 flex items-center gap-2">
                                {isSystemStaff ? (msg.EmpleadoNombre || 'Soporte') : 'Cliente'}
                                • {new Date(msg.TMenFecha).toLocaleString('es-UY', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                                {isSystemStaff && <Check size={12} className="text-brand-dark" strokeWidth={3} />}
                                {isInternalNote && <span className="text-brand-gold flex items-center gap-1"><Lock size={12} /> Oculto al Cliente</span>}
                            </div>

                            {(() => {
                                const hasText = msg.TMenTexto && msg.TMenTexto.trim() !== '';
                                const hasAdjunto = msg.adjuntos && msg.adjuntos.length > 0;
                                const hasImage = hasAdjunto && msg.adjuntos.some(adj => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(adj.TAdjRutaArchivo));
                                
                                const paddingClass = hasImage
                                    ? 'p-1'
                                    : 'px-3 py-1.5';

                                return (
                                    <div className={`${paddingClass} ${hasImage ? 'rounded-xl' : 'rounded-2xl'} max-w-[70%] text-sm transition-all
                                        ${!isSystemStaff ? 'bg-brand-magenta/10 border border-brand-magenta/20 text-zinc-800 rounded-tl-sm' :
                                            isInternalNote ? 'bg-brand-gold/10 border border-brand-gold/20 text-zinc-800 rounded-tr-sm' :
                                                'bg-brand-cyan/10 border border-brand-cyan/20 text-zinc-800 rounded-tr-sm'}
                                    `}>
                                        {hasText && (
                                            <div className={`whitespace-pre-wrap text-sm leading-snug ${hasImage ? 'px-2 pt-0 pb-1' : ''}`}>{msg.TMenTexto.trim()}</div>
                                        )}

                                        {hasAdjunto && (
                                            <div className={`flex flex-wrap gap-2 ${hasText ? 'mt-1' : ''}`}>
                                                {msg.adjuntos.map(adj => {
                                                    const filename = adj.TAdjRutaArchivo;
                                                    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
                                                    const displayName = filename.replace(/^\d+-/, '');

                                                    const openAdjunto = async (e) => {
                                                        e.preventDefault();
                                                        const token = localStorage.getItem('auth_token');
                                                        try {
                                                            const resp = await fetch(`${API_BASE_URL}/tickets/adjunto/${ticketId}/${filename}`, {
                                                                headers: { 'Authorization': `Bearer ${token}` }
                                                            });
                                                            if (!resp.ok) throw new Error('No se pudo cargar el archivo');
                                                            const blob = await resp.blob();
                                                            const blobUrl = URL.createObjectURL(blob);
                                                            window.open(blobUrl, '_blank');
                                                        } catch (err) {
                                                            toast.error('No se pudo abrir el adjunto');
                                                        }
                                                    };

                                                    return isImage ? (
                                                        <AdjuntoImage 
                                                            key={adj.TAdjIdAdjunto}
                                                            ticketId={ticketId} 
                                                            filename={filename} 
                                                            displayName={displayName} 
                                                            onClick={(e, blobUrl) => {
                                                                if (window.innerWidth >= 1024) {
                                                                    e.preventDefault();
                                                                    setModalImage({ url: blobUrl, name: displayName });
                                                                } else {
                                                                    window.open(blobUrl, '_blank');
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        <a key={adj.TAdjIdAdjunto} href="#" onClick={openAdjunto} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 transition-colors text-zinc-700 cursor-pointer">
                                                            <FileText size={14} /> {displayName}
                                                        </a>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Editor Area */}
            <div className={`border-t border-zinc-200 p-4 shrink-0 transition-colors ${esNotaInterna ? 'bg-brand-gold/5' : 'bg-brand-cyan/5'}`}>
                {isClosed ? (
                    <div className="text-center py-2 text-zinc-500 font-bold flex justify-center gap-2"><CheckCircle size={18} /> TICKET CERRADO</div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <button
                                onClick={() => setEsNotaInterna(false)}
                                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${!esNotaInterna ? 'bg-brand-cyan text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700 border border-zinc-200'}`}
                            >
                                Respuesta Pública
                            </button>
                            <button
                                onClick={() => setEsNotaInterna(true)}
                                className={`px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 transition-all ${esNotaInterna ? 'bg-brand-gold text-white shadow-[0_0_15px_rgba(217,119,6,0.3)]' : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700 border border-zinc-200'}`}
                            >
                                <Lock size={12} /> Nota Interna
                            </button>
                        </div>

                        <div className="flex items-end gap-2">
                            <textarea
                                className={`flex-1 rounded-xl px-4 py-3 text-sm outline-none resize-none transition-colors border ${esNotaInterna ? 'bg-white text-zinc-900 border-brand-gold focus:border-brand-gold placeholder-zinc-400 shadow-sm' : 'bg-white text-zinc-900 border-brand-cyan focus:border-brand-cyan placeholder-zinc-400 shadow-sm'}`}
                                rows={Math.min(5, Math.max(2, texto.split('\n').length))}
                                placeholder={esNotaInterna ? "Esta nota solo la verá el equipo interno..." : "Escribe una respuesta para el cliente..."}
                                value={texto}
                                onChange={(e) => setTexto(e.target.value)}
                            />
                            <button
                                onClick={handleSend}
                                disabled={sending || !texto.trim()}
                                className={`p-4 rounded-xl font-bold transition-all disabled:opacity-50 ${esNotaInterna ? 'bg-brand-gold text-white' : 'bg-brand-cyan text-white'}`}
                            >
                                <Send size={20} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Image Modal Lightbox for Desktop */}
            {modalImage && (
                <>
                    <style>{`
                        @keyframes modalFadeIn {
                            from { opacity: 0; }
                            to { opacity: 1; }
                        }
                        @keyframes modalFadeOut {
                            from { opacity: 1; }
                            to { opacity: 0; }
                        }
                        @keyframes modalZoomIn {
                            from { opacity: 0; transform: scale(0.92); }
                            to { opacity: 1; transform: scale(1); }
                        }
                        @keyframes modalZoomOut {
                            from { opacity: 1; transform: scale(1); }
                            to { opacity: 0; transform: scale(0.92); }
                        }
                        .modal-bg-enter { animation: modalFadeIn 200ms ease-out forwards; }
                        .modal-bg-exit { animation: modalFadeOut 200ms ease-in forwards; }
                        .modal-img-enter { animation: modalZoomIn 200ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
                        .modal-img-exit { animation: modalZoomOut 200ms ease-in forwards; }
                    `}</style>
                    <div 
                        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/90 ${modalClosing ? 'modal-bg-exit' : 'modal-bg-enter'}`}
                        onClick={closeModal}
                    >
                        <div className="absolute top-4 right-4 flex gap-3">
                            <a 
                                href={modalImage.url} 
                                download={modalImage.name}
                                onClick={(e) => e.stopPropagation()}
                                className="p-2.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-700 text-white transition-all cursor-pointer shadow-lg"
                                title="Descargar imagen"
                            >
                                <Download size={20} />
                            </a>
                            <button 
                                onClick={closeModal}
                                className="p-2.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-700 text-white transition-all cursor-pointer shadow-lg"
                                title="Cerrar"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div 
                            ref={imgContainerRef}
                            className={`max-w-[80vw] max-h-[90vh] p-2 bg-zinc-900/40 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex items-center justify-center ${modalClosing ? 'modal-img-exit' : 'modal-img-enter'}`}
                            onClick={(e) => e.stopPropagation()}
                            onWheel={handleModalWheel}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            style={{ cursor: zoomScale > 1 ? 'grab' : 'default' }}
                        >
                            <img 
                                src={modalImage.url} 
                                alt={modalImage.name} 
                                draggable={false}
                                style={{
                                    transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${panOffset.y / zoomScale}px)`,
                                    transition: isDragging.current ? 'none' : 'transform 0.1s ease-out',
                                    transformOrigin: 'center center',
                                }}
                                className="max-w-full max-h-[85vh] object-contain rounded-xl select-none"
                            />
                        </div>
                    </div>
                </>
            )}

        </div>
    );
};
