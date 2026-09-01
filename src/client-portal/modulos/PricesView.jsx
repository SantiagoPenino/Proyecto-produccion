import React, { useState, useEffect, useMemo } from 'react';
import { apiClient } from '../api/apiClient';
import { Search, DollarSign, Filter, Loader2, ChevronDown, ChevronRight, Tag } from 'lucide-react';

export const PricesView = () => {
    const [prices, setPrices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedFamily, setSelectedFamily] = useState('Todas');
    const [collapsed, setCollapsed] = useState({});

    useEffect(() => {
        apiClient.get('/precios-publicos?lista=clientes')
            .then(data => setPrices(data))
            .catch(err => console.error('Error cargando precios:', err))
            .finally(() => setLoading(false));
    }, []);

    const families = useMemo(() => {
        const set = new Set(prices.map(p => p.Familia).filter(Boolean));
        return ['Todas', ...Array.from(set).sort()];
    }, [prices]);

    const filtered = useMemo(() => {
        return prices.filter(p => {
            const matchFamily = selectedFamily === 'Todas' || p.Familia === selectedFamily;
            const matchSearch = !search ||
                (p.Producto || '').toLowerCase().includes(search.toLowerCase()) ||
                (p.Descripcion || '').toLowerCase().includes(search.toLowerCase()) ||
                (p.Familia || '').toLowerCase().includes(search.toLowerCase());
            return matchFamily && matchSearch;
        });
    }, [prices, selectedFamily, search]);

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

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="animate-spin text-custom-cyan" size={36} />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
                <DollarSign size={48} strokeWidth={1} className="text-brand-gold" />
                <div>
                    <h2 className="text-lg font-bold text-zinc-300 uppercase">Lista de <span className="text-custom-cyan">Precios</span></h2>
                    <p className="text-zinc-500 uppercase text-xs">Consultá nuestros precios actualizados.</p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar producto..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-700 bg-brand-dark text-zinc-100 placeholder-zinc-500 focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan outline-none text-sm transition-all"
                    />
                </div>
                <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                    <select
                        value={selectedFamily}
                        onChange={e => setSelectedFamily(e.target.value)}
                        className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-zinc-700 bg-brand-dark text-zinc-100 focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan outline-none text-sm appearance-none cursor-pointer md:min-w-[180px] md:w-auto"
                    >
                        {families.map(f => (
                            <option key={f} value={f}>{f}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Results count */}
            <p className="text-xs text-zinc-500 font-medium uppercase">
                {filtered.length} producto{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
            </p>

            {/* Liste agrupada */}
            {Object.keys(grouped).length === 0 ? (
                <div className="text-center py-16 text-zinc-500">
                    <p className="text-sm font-medium">No se encontraron productos</p>
                    <p className="text-xs mt-1">Probá con otro término de búsqueda</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {Object.entries(grouped).map(([family, items]) => {
                        const isCollapsed = collapsed[family];
                        return (
                            <div key={family} className="overflow-hidden rounded-xl border border-zinc-800 bg-brand-dark">
                                {/* Family header — clickeable */}
                                <button
                                    onClick={() => toggleFamily(family)}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-custom-dark hover:bg-zinc-800/50 transition-colors group"
                                >
                                    <div className="flex items-center gap-2">
                                        <Tag size={14} className="text-custom-cyan shrink-0" />
                                        <span className="font-bold text-xs uppercase tracking-wider text-zinc-200 group-hover:text-custom-cyan transition-colors">
                                            {family}
                                        </span>
                                        <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                                            {items.length}
                                        </span>
                                    </div>
                                    {isCollapsed
                                        ? <ChevronRight size={16} className="text-zinc-500" />
                                        : <ChevronDown size={16} className="text-zinc-500" />
                                    }
                                </button>

                                {/* Rows */}
                                {!isCollapsed && (
                                    <div>
                                        {/* Table header */}
                                        <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_2fr_auto] px-4 py-2 border-t border-zinc-800 border-b border-b-zinc-800">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Producto</span>
                                            <span className="hidden md:block text-[10px] font-bold uppercase tracking-widest text-zinc-500">Descripción</span>
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 text-right">Precio</span>
                                        </div>

                                        {items.map((item, idx) => {
                                            const { symbol, amount } = formatPrice(item);
                                            return (
                                                <div
                                                    key={idx}
                                                    className={`grid grid-cols-[1fr_auto] md:grid-cols-[1fr_2fr_auto] items-center px-4 py-3 gap-3 border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-800/20 transition-colors`}
                                                >
                                                    <p className="text-sm font-semibold text-zinc-100 uppercase truncate">
                                                        {item.Producto}
                                                    </p>
                                                    <p className="hidden md:block text-xs text-zinc-400 truncate uppercase">
                                                        {item.Descripcion || '—'}
                                                    </p>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-sm font-bold text-brand-gold whitespace-nowrap">
                                                            <span className="text-xs text-zinc-400 mr-0.5">{symbol}</span>
                                                            {amount}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
