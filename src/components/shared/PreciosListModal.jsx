import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, DollarSign, Filter, Loader2, Tag, ChevronDown, ChevronRight, CheckCircle2, MessageCircle } from 'lucide-react';
import { trackAnalyticsEvent } from '../../utils/analytics';
import { toast } from 'sonner';

export default function PreciosListModal({ isOpen, onClose }) {
    const [prices, setPrices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedFamily, setSelectedFamily] = useState('Todas');
    const [collapsed, setCollapsed] = useState({});

    // Fetch prices when modal opens
    useEffect(() => {
        if (!isOpen) return;
        
        const fetchPrices = async () => {
            setLoading(true);
            try {
                // Fetch public prices API from server.js
                // Note: The backend endpoint is relative or fully qualified if needed.
                // Depending on Vite proxy, it usually works with '/api/precios-publicos'.
                const API_URL = import.meta.env.VITE_API_URL || '';
                const response = await fetch(`${API_URL}/api/precios-publicos?lista=publica`);
                if (!response.ok) throw new Error('Error al cargar precios');
                const data = await response.json();
                setPrices(data);
            } catch (error) {
                console.error('Error fetching prices:', error);
                toast.error('Hubo un error cargando la lista de precios.');
            } finally {
                setLoading(false);
            }
        };

        fetchPrices();
    }, [isOpen]);

    // Only keep prices that have 'FiltroLanding' populated (Columna H)
    const landingPrices = useMemo(() => {
        return prices.filter(p => p.FiltroLanding && p.FiltroLanding.trim() !== '');
    }, [prices]);

    const families = useMemo(() => {
        const set = new Set(landingPrices.map(p => p.Familia).filter(Boolean));
        return ['Todas', ...Array.from(set).sort()];
    }, [landingPrices]);

    const filtered = useMemo(() => {
        return landingPrices.filter(p => {
            const matchFamily = selectedFamily === 'Todas' || p.Familia === selectedFamily;
            const matchSearch = !search ||
                (p.Producto || '').toLowerCase().includes(search.toLowerCase()) ||
                (p.Descripcion || '').toLowerCase().includes(search.toLowerCase()) ||
                (p.Familia || '').toLowerCase().includes(search.toLowerCase()) ||
                (p.FiltroLanding || '').toLowerCase().includes(search.toLowerCase());
            return matchFamily && matchSearch;
        });
    }, [landingPrices, selectedFamily, search]);

    const grouped = useMemo(() => {
        const map = {};
        filtered.forEach(p => {
            const key = p.Familia || 'Sin Familia';
            if (!map[key]) map[key] = [];
            map[key].push(p);
        });
        return map;
    }, [filtered]);

    const toggleFamily = (family) => {
        setCollapsed(prev => ({ ...prev, [family]: !prev[family] }));
    };

    const formatPrice = (item) => {
        const isDolar = (item.Moneda || '').toUpperCase().includes('DOLAR') || (item.Moneda || '').toUpperCase().includes('USD');
        const symbol = isDolar ? 'US$' : '$';
        const amount = item.Precio?.toLocaleString('es-UY', { minimumFractionDigits: 2 }) ?? '-';
        return { symbol, amount };
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div 
                className="fixed inset-0 z-[99999] flex items-center justify-center p-0 sm:p-4 bg-black/60"
                onClick={(e) => {
                    if (e.target === e.currentTarget) onClose();
                }}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    className="relative w-full max-w-4xl h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[90vh] bg-custom-dark border-0 sm:border sm:border-zinc-700/50 rounded-none sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
                        <div className="flex items-center gap-3">
                            <DollarSign size={28} className="hidden sm:block text-brand-gold" />
                            <div>
                                <h3 className="text-sm sm:text-lg font-bold text-white uppercase tracking-wider">
                                    Precios de Productos <span className="text-custom-cyan">Destacados</span>
                                </h3>
                                <p className="text-[10px] sm:text-xs text-zinc-400 mt-0.5">Pulsá "Más información..." en la categoría de tu interés para recibir atención personalizada.</p>
                            </div>
                        </div>
                        <button 
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center text-brand-magenta hover:text-brand-magenta/80 transition-colors"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto px-3 pt-3 pb-0 sm:px-5 sm:pt-5 sm:pb-0 flex flex-col gap-6 custom-scrollbar">
                        
                        {loading ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-brand-cyan opacity-80 min-h-[300px]">
                                <Loader2 size={40} className="animate-spin mb-4" />
                                <p className="text-sm font-bold tracking-widest uppercase">Cargando catálogo...</p>
                            </div>
                        ) : landingPrices.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 min-h-[300px] text-center">
                                <DollarSign size={40} className="mb-4 opacity-50" />
                                <p className="text-sm font-bold tracking-widest uppercase">Catálogo no disponible</p>
                                <p className="text-xs mt-2 max-w-sm">Aún no hay productos configurados para mostrar en este catálogo.</p>
                            </div>
                        ) : (
                            <>
                                {/* Listado */}
                                {Object.keys(grouped).length === 0 ? (
                                    <div className="text-center py-16 text-zinc-500 bg-zinc-900/30 rounded-2xl border border-zinc-800 border-dashed">
                                        <p className="text-sm font-bold uppercase tracking-widest">Sin resultados</p>
                                        <p className="text-xs mt-1">Intentá con otra búsqueda o categoría.</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col">
                                        {Object.entries(grouped).map(([family, items]) => {
                                            const isCollapsed = collapsed[family];
                                            return (
                                                <div key={family} className="mb-6 border-b border-zinc-800/50 last:mb-0 last:border-0">
                                                    {/* Header de Familia */}
                                                    <button
                                                        onClick={() => toggleFamily(family)}
                                                        className="w-full flex items-center justify-between px-2 py-3 sm:px-4 sm:py-3 bg-transparent hover:bg-zinc-800/40 transition-colors group"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center transition-colors">
                                                                <Tag size={12} className="text-custom-cyan transition-colors" />
                                                            </div>
                                                            <span className="font-black text-xs sm:text-sm uppercase tracking-widest text-custom-cyan">
                                                                {family}
                                                            </span>
                                                        </div>
                                                        <div className="w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-white transition-colors">
                                                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                        </div>
                                                    </button>

                                                    {/* Filas */}
                                                    {!isCollapsed && (
                                                        <>
                                                            <div className="divide-y divide-zinc-800/50">
                                                                {/* Opcional: Encabezados de columnas */}
                                                            <div className="hidden sm:grid grid-cols-[1.5fr_2fr_auto] px-2 py-2 sm:px-4 bg-zinc-900/30 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                                                                <div>Producto</div>
                                                                <div>Descripción</div>
                                                                <div className="text-right">Precio</div>
                                                            </div>
                                                            {items.map((item, idx) => {
                                                                const { symbol, amount } = formatPrice(item);
                                                                return (
                                                                    <div key={idx} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.5fr_2fr_auto] items-center px-2 py-2 sm:px-4 sm:py-3 gap-4 hover:bg-zinc-800/30 transition-colors">
                                                                        <div className="min-w-0">
                                                                            <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide truncate">
                                                                                {item.Producto}
                                                                            </h4>
                                                                            {item.Descripcion && (
                                                                                <p className="block sm:hidden text-[10px] text-zinc-500 truncate mt-0.5">
                                                                                    {item.Descripcion}
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                        <div className="hidden sm:block min-w-0">
                                                                            <p className="text-xs text-zinc-400 truncate">
                                                                                {item.Descripcion || '—'}
                                                                            </p>
                                                                        </div>
                                                                        <div className="shrink-0 text-right">
                                                                            <p className="text-sm sm:text-lg font-black text-custom-yellow whitespace-nowrap drop-shadow-md">
                                                                                <span className="text-xs text-zinc-400 mr-1 font-semibold">{symbol}</span>
                                                                                {amount}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                            </div>
                                                            {/* Botón de WhatsApp */}
                                                            <div className="px-2 pt-1 pb-3 sm:px-4 flex justify-center sm:justify-end">
                                                                <a
                                                                    href={`https://wa.me/59899956476?text=${encodeURIComponent(`Hola, quiero saber mas sobre ${family.toLowerCase()}`)}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={() => { trackAnalyticsEvent('CTA_CLICK', { categoria: family }); onClose(); }}
                                                                    className="text-xs sm:text-sm font-bold text-[#25D366] hover:text-[#1da851] bg-[#25D366]/10 hover:bg-[#25D366]/20 border border-[#25D366]/30 px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg transition-all flex items-center gap-1.5 sm:gap-2 active:scale-95"
                                                                >
                                                                    <MessageCircle size={16} />
                                                                    Más información...
                                                                </a>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
