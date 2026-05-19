import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient, API_BASE_URL } from '../../api/apiClient';
import { socket } from '../../../services/socketService';
import { GlassCard } from '../../pautas/GlassCard';
import { CustomButton } from '../../pautas/CustomButton';
import { ArrowLeft, Send, UploadCloud, AlertCircle, FileText, CheckCircle, Image as ImageIcon, Check, X, Download } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

// Componente para previsualizar adjuntos con autenticación (igual que el panel admin)
const AdjuntoCliente = ({ ticketId, filename, onClick }) => {
    const [blobUrl, setBlobUrl] = React.useState(null);
    const [error, setError] = React.useState(false);
    const displayName = filename.replace(/^\d+-/, '');
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);

    React.useEffect(() => {
        const token = localStorage.getItem('auth_token');
        fetch(`${API_BASE_URL}/tickets/adjunto/${ticketId}/${filename}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(r => r.ok ? r.blob() : Promise.reject())
            .then(blob => setBlobUrl(URL.createObjectURL(blob)))
            .catch(() => setError(true));

        return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    }, [filename]);

    if (error) return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-black/20 opacity-60">
            <FileText size={14} /> {displayName}
        </div>
    );

    if (!blobUrl) return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-black/10 animate-pulse">
            <ImageIcon size={14} /> Cargando...
        </div>
    );

    if (isImage) {
        const handleImgClick = (e) => {
            if (onClick) {
                onClick(e, blobUrl, displayName);
            }
        };

        return (
            <img 
                src={blobUrl} 
                alt={displayName} 
                onClick={handleImgClick} 
                className="max-h-48 max-w-xs object-cover rounded-lg hover:opacity-90 transition-opacity cursor-pointer block" 
            />
        );
    }

    return (
        <a href={blobUrl} download={displayName} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-black/20 hover:bg-black/30 transition-opacity">
            <FileText size={14} /> {displayName}
        </a>
    );
};

export const TicketThreadWindow = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    
    const [ticket, setTicket] = useState(null);
    const [mensajes, setMensajes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    
    const [nuevoMensaje, setNuevoMensaje] = useState('');
    const [archivos, setArchivos] = useState([]);
    const [errorMsg, setErrorMsg] = useState('');
    const [modalImage, setModalImage] = useState(null);
    const [modalClosing, setModalClosing] = useState(false);
    const [isZoomed, setIsZoomed] = useState(false);
    
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const fetchDetail = async () => {
        try {
            const res = await apiClient.get(`/tickets/${id}`);
            if (res.success) {
                setTicket(res.ticket);
                setMensajes(res.mensajes);
            } else {
                setErrorMsg(res.error || 'No se pudo cargar el ticket.');
            }
        } catch (error) {
            console.error("Error loaded ticket thread:", error);
            setErrorMsg('Error al conectar con el servidor.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDetail();

        // Unirse al room del ticket para recibir mensajes en tiempo real
        socket.emit('join:ticket', { ticketId: id });

        const handleNewMessage = (data) => {
            // Solo refrescar si el evento es de este ticket y no fue enviado por nosotros
            if (String(data.ticketId) === String(id)) {
                fetchDetail();
            }
        };

        socket.on('ticket:new_message', handleNewMessage);
        socket.on('ticket:updated', handleNewMessage);

        return () => {
            socket.emit('leave:ticket', { ticketId: id });
            socket.off('ticket:new_message', handleNewMessage);
            socket.off('ticket:updated', handleNewMessage);
        };
    }, [id]);

    useEffect(() => {
        scrollToBottom();
    }, [mensajes]);

    const closeModal = () => {
        setModalClosing(true);
        setTimeout(() => {
            setModalImage(null);
            setModalClosing(false);
            setIsZoomed(false);
        }, 200);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') closeModal();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleFileChange = (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 5) {
            setErrorMsg('Máximo 5 archivos por mensaje.');
            return;
        }
        setErrorMsg('');
        setArchivos(files);
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if (!nuevoMensaje.trim() && archivos.length === 0) return;
        
        setSending(true);
        setErrorMsg('');
        
        try {
            const formData = new FormData();
            formData.append('texto', nuevoMensaje);
            archivos.forEach(file => {
                formData.append('evidencia', file);
            });

            const data = await apiClient.postFormData(`/tickets/${id}/responder`, formData);
            if (data.success) {
                setNuevoMensaje('');
                setArchivos([]);
                fetchDetail(); // Reload chat
            } else {
                setErrorMsg(data.error || 'No se pudo enviar el mensaje.');
            }
        } catch (error) {
            console.error('Error reply:', error);
            setErrorMsg('Ups, algo falló al enviar.');
        } finally {
            setSending(false);
        }
    };

    const getStatusText = (statusId) => {
        const m = { 1: 'Abierto', 2: 'Procesando', 3: 'Responder', 4: 'Resuelto', 5: 'Cerrado' };
        return m[statusId] || 'Desconocido';
    };

    if (loading) {
        return <div className="p-10 text-center text-zinc-400">Cargando ticket...</div>;
    }

    if (!ticket) {
        return (
            <div className="p-10 text-center space-y-4">
                <AlertCircle className="mx-auto text-red-500" size={48} />
                <p className="text-zinc-300">Ticket no encontrado o no tienes permisos.</p>
                <CustomButton onClick={() => navigate('/portal/soporte')}>Volver atras</CustomButton>
            </div>
        );
    }

    const isClosed = ticket.TicEstado === 4 || ticket.TicEstado === 5;

    return (
        <div className="animate-fade-in flex flex-col fixed inset-0 z-[10000] bg-[#121212] sm:bg-zinc-900 md:relative md:inset-auto md:z-auto md:bg-transparent h-[100dvh] md:h-[85vh] w-full md:max-w-none md:mx-0">
            
            {/* Header del Ticket */}
            <div className="flex items-center gap-3 bg-zinc-900 border-b md:border border-zinc-700/80 p-3 md:p-6 md:px-8 rounded-none md:rounded-t-2xl shadow-lg shrink-0">
                <button 
                    onClick={() => navigate('/portal/soporte')} 
                    className="w-8 h-8 rounded-full bg-custom-cyan/10 text-custom-cyan hover:bg-custom-cyan/20 border border-custom-cyan/20 flex items-center justify-center transition-colors shrink-0"
                >
                    <ArrowLeft size={18} />
                </button>
                
                {/* ID y Asunto (Centro/Izquierda) */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <h2 className="text-base md:text-lg font-bold text-zinc-200 truncate">Ticket #{ticket.TicIdTicket}</h2>
                    <p className="text-xs md:text-sm text-zinc-500 font-medium truncate mt-0.5">{ticket.TicAsunto}</p>
                </div>

                {/* Departamento y Estado (Derecha) */}
                <div className="shrink-0 flex flex-col items-end justify-center gap-3 pl-3 border-l border-zinc-800/50">
                    <span className="text-brand-cyan font-bold uppercase text-[9px] px-1.5 py-0.5 bg-zinc-800 rounded text-right inline-block" title={ticket.DepNombre}>
                        {ticket.DepNombre}
                    </span>
                    <span className={`inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] md:text-xs font-bold overflow-hidden ${
                        ticket.TicEstado === 1 ? 'bg-emerald-500/5 text-emerald-400/60 border border-emerald-500/20' :
                        ticket.TicEstado === 2 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        ticket.TicEstado === 3 ? 'bg-brand-magenta/10 text-brand-magenta border border-brand-magenta/20' :
                        ticket.TicEstado === 4 ? 'bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20' :
                        'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                    }`}>
                        {getStatusText(ticket.TicEstado)}
                    </span>
                </div>
            </div>

            {/* ZONA DE MENSAJES */}
            <GlassCard className="flex-1 overflow-y-auto !rounded-none md:!rounded-none !border-0 md:!border-x md:!border-zinc-700/50 px-2 py-4 sm:px-3 sm:py-6 space-y-3">
                {mensajes.map((msg, index) => {
                    const isMine = msg.CliIdAutor === user?.id;
                    const operatorName = msg.EmpleadoNombre ? msg.EmpleadoNombre.split(' ')[0] : 'Soporte';
                    const nameLabel = isMine ? 'Tú' : operatorName;
                    const hasText = msg.TMenTexto && msg.TMenTexto.trim() !== '';
                    const hasAdjuntos = msg.adjuntos && msg.adjuntos.length > 0;
                    const hasImage = hasAdjuntos && msg.adjuntos.some(adj => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(adj.TAdjRutaArchivo));
                    
                    const paddingClass = hasImage 
                        ? 'p-1' 
                        : 'px-3 py-1.5';
                    
                    return (
                        <div key={msg.TMenIdMensaje} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                            <div className={`text-xs text-zinc-500 font-semibold mb-1 px-1 flex items-center gap-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                                {nameLabel} • {new Date(msg.TMenFecha).toLocaleString('es-UY', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                                {isMine && <Check size={14} className="text-brand-gold" strokeWidth={3} />}
                            </div>
                            <div className={`max-w-[85%] sm:max-w-[70%] ${paddingClass} ${hasImage ? 'rounded-xl' : 'rounded-2xl'} text-white ${isMine ? 'bg-brand-cyan/10 border border-brand-cyan/50 rounded-tr-sm' : 'bg-brand-magenta/10 border border-brand-magenta/50 rounded-tl-sm'}`}>
                                {hasText && (
                                    <p className={`whitespace-pre-wrap text-sm leading-snug ${hasImage ? 'px-2 pt-0 pb-1' : ''}`}>{msg.TMenTexto.trim()}</p>
                                )}
                                
                                {/* ADJUNTOS */}
                                {hasAdjuntos && (
                                    <div className={`flex flex-wrap gap-2 ${hasText ? 'mt-1' : ''}`}>
                                        {msg.adjuntos.map(adj => (
                                            <AdjuntoCliente
                                                key={adj.TAdjIdAdjunto}
                                                ticketId={ticket.TicIdTicket}
                                                filename={adj.TAdjRutaArchivo}
                                                onClick={(e, blobUrl, displayName) => {
                                                    if (window.innerWidth >= 1024) {
                                                        e.preventDefault();
                                                        setModalImage({ url: blobUrl, name: displayName });
                                                    } else {
                                                        window.open(blobUrl, '_blank');
                                                    }
                                                }}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </GlassCard>

            {/* CAJA DE TEXTO (Input) */}
            <div className="bg-zinc-900 border-t md:border md:border-t-0 border-zinc-700/50 p-4 sm:p-6 rounded-none md:rounded-b-2xl shrink-0 pb-6 md:pb-6">
                {isClosed ? (
                    <div className="text-center py-3 text-zinc-500 font-medium flex justify-center items-center gap-2">
                        <CheckCircle size={18} className="text-emerald-500" />
                        Este ticket ya fue resuelto/cerrado y no admite nuevas respuestas.
                    </div>
                ) : (
                    <form onSubmit={handleSend} className="space-y-2">
                        {errorMsg && <div className="text-red-400 text-xs px-2">{errorMsg}</div>}
                        
                        <div className="flex items-center gap-2">
                            <label className="cursor-pointer p-3 bg-brand-gold/10 hover:bg-brand-gold/20 text-brand-gold rounded-xl transition-colors border border-brand-gold/30 hover:border-brand-gold/50 shadow-[0_0_10px_rgba(245,200,66,0.1)]">
                                <input type="file" multiple accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
                                <UploadCloud size={20} />
                            </label>
                            
                            <textarea 
                                className="flex-1 bg-brand-cyan/5 border border-brand-cyan/30 text-white rounded-xl px-4 py-3 text-sm focus:border-brand-cyan focus:outline-none resize-none placeholder:text-brand-cyan/40 transition-colors"
                                rows={Math.min(4, Math.max(1, nuevoMensaje.split('\n').length))}
                                placeholder="Mensaje..."
                                value={nuevoMensaje}
                                onChange={(e) => setNuevoMensaje(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend(e);
                                    }
                                }}
                            />
                            
                            <button 
                                type="submit"
                                disabled={sending || (!nuevoMensaje.trim() && archivos.length === 0)}
                                className={`p-3 rounded-xl font-bold transition-all border flex items-center justify-center ${
                                    (sending || (!nuevoMensaje.trim() && archivos.length === 0))
                                        ? 'bg-transparent border-brand-cyan/20 text-brand-cyan/30'
                                        : 'bg-brand-cyan/10 border-brand-cyan text-brand-cyan opacity-100 shadow-[0_0_15px_rgba(0,110,151,0.3)] hover:scale-105 active:scale-95'
                                }`}
                            >
                                <Send size={20} />
                            </button>
                        </div>
                        
                        {archivos.length > 0 && (
                            <div className="flex gap-2 px-2 pb-1 overflow-x-auto text-xs text-brand-gold">
                                Adjuntos cargados: {archivos.length} archivo(s).
                            </div>
                        )}
                    </form>
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
                            className={`max-w-[80vw] max-h-[90vh] p-2 bg-zinc-900/40 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex items-center justify-center ${modalClosing ? 'modal-img-exit' : 'modal-img-enter'}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <img 
                                src={modalImage.url} 
                                alt={modalImage.name} 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsZoomed(!isZoomed);
                                }}
                                className={`max-w-full max-h-[85vh] object-contain rounded-xl select-none transition-all duration-300 origin-center ${isZoomed ? 'scale-[1.8] cursor-zoom-out' : 'cursor-zoom-in'}`}
                            />
                        </div>
                    </div>
                </>
            )}

        </div>
    );
};
