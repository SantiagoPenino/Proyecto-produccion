// SIN USO (13/10): MainAppContent lo importa pero su render está comentado. El backend /api/chat sigue montado. Ver docs/auditoria-limpieza-2026-10-09.md.
import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { API_URL } from '../../services/apiClient';

const ChatWidget = () => {
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [searchMode, setSearchMode] = useState('db'); // 'db' | 'drive'
    const [messages, setMessages] = useState([
        { id: 1, text: "¡Hola! Soy tu asistente de producción. ¿En qué puedo ayudarte?", sender: "bot" }
    ]);
    const [inputValue, setInputValue] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputValue.trim()) return;

        const userMsg = { id: Date.now(), text: inputValue, sender: "user" };
        setMessages(prev => [...prev, userMsg]);
        setInputValue("");
        setIsTyping(true);

        try {
            // Llamada al backend
            const response = await axios.post(`${API_URL}/chat`,
                {
                    message: userMsg.text,
                    userId: user?.id || user?.IdUsuario,
                    mode: searchMode
                },
                {
                    headers: {
                        Authorization: `Bearer ${user?.token}`
                    }
                }
            );

            const botMsg = {
                id: Date.now() + 1,
                text: response.data.reply || "Lo siento, no pude procesar tu solicitud.",
                sender: "bot"
            };
            setMessages(prev => [...prev, botMsg]);

        } catch (error) {
            console.error("Error en chat:", error);
            const errorMsg = {
                id: Date.now() + 1,
                text: "Error de conexión con el asistente. Intente más tarde.",
                sender: "bot",
                isError: true
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-[10001] flex flex-col items-end pointer-events-none">

            {/* VENTANA DE CHAT */}
            {isOpen && (
                <div className={`
                    pointer-events-auto
                    bg-white/95  border border-slate-200 shadow-2xl rounded-2xl
                    w-[380px] h-[500px] mb-4 flex flex-col overflow-hidden
                    transition-all duration-300 origin-bottom-right
                    animate-in slide-in-from-bottom-10 fade-in
                `}>

                    {/* Header */}
                    <div className="bg-slate-900 text-white p-4 flex justify-between items-center bg-gradient-to-r from-slate-900 to-slate-800">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center text-white font-bold shadow-lg shadow-cyan-500/50">
                                <i className="fa-solid fa-robot"></i>
                            </div>
                            <div>
                                <div className="font-bold text-sm">Asistente IA</div>
                                <div className="text-[10px] text-cyan-300 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    En línea
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                            <i className="fa-solid fa-xmark text-lg"></i>
                        </button>
                    </div>

                    {/* Mensajes */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 relative">
                        {/* Fondo decorativo */}
                        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`
                                max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm relative z-10
                                ${msg.sender === 'user'
                                        ? 'bg-blue-600 text-white rounded-br-none'
                                        : 'bg-white border border-slate-200 text-slate-700 rounded-bl-none'}
                                ${msg.isError ? 'bg-red-50 border-red-200 text-red-600' : ''}
                            `}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}

                        {isTyping && (
                            <div className="flex justify-start">
                                <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Selector de Modo */}
                    <div className="px-4 pt-2 pb-0 flex gap-2">
                        <button
                            onClick={() => setSearchMode('db')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-1.5
                            ${searchMode === 'db'
                                    ? 'bg-blue-100 border-blue-200 text-blue-700 shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                        >
                            <i className="fa-solid fa-database"></i> Datos (SQL)
                        </button>
                        <button
                            onClick={() => setSearchMode('drive')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-1.5
                            ${searchMode === 'drive'
                                    ? 'bg-green-100 border-green-200 text-green-700 shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                        >
                            <i className="fa-brands fa-google-drive"></i> Manuales
                        </button>
                    </div>

                    {/* Input */}
                    <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-100 flex gap-2 mt-1">
                        <input
                            type="text"
                            className="flex-1 bg-slate-100 border border-slate-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all font-medium text-slate-700 placeholder:text-slate-400"
                            placeholder={searchMode === 'db' ? "Ej: Pedido 1045, Resumen..." : "Ej: Procedimiento de corte..."}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            autoFocus
                        />
                        <button
                            type="submit"
                            disabled={!inputValue.trim() || isTyping}
                            className={`w-10 h-10 rounded-full text-white flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 shadow-md 
                            ${searchMode === 'db' ? 'bg-blue-600 shadow-blue-200' : 'bg-green-600 shadow-green-200'}`}
                        >
                            <i className="fa-solid fa-paper-plane text-xs"></i>
                        </button>
                    </form>
                </div>
            )}

            {/* BOTÓN FLOTANTE (FAB) */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    pointer-events-auto
                    w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95
                    ${isOpen ? 'bg-slate-700 rotate-90 scale-0 opacity-0' : 'bg-blue-600 hover:bg-blue-500 scale-100 opacity-100'}
                `}
            >
                <i className="fa-solid fa-comment-dots text-2xl text-white"></i>

                {/* Badge de notificacion (opcional) */}
                <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
            </button>

            {/* Botón alternativo para cerrar cuando está abierto (reemplaza al FAB visualmente) */}
            {isOpen && (
                <button
                    onClick={() => setIsOpen(false)}
                    className="pointer-events-auto w-12 h-12 rounded-full bg-slate-200 hover:bg-slate-300 flex items-center justify-center shadow-lg transition-all animate-in zoom-in spin-in-90 duration-300 absolute bottom-0 right-0"
                >
                    <i className="fa-solid fa-chevron-down text-slate-600"></i>
                </button>
            )}
        </div>
    );
};

export default ChatWidget;
