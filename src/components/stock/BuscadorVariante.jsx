import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import api from '../../services/api';

// Buscador de artículos del stock (variantes). Lo usan /stock y el pedido de insumos de cada área.
export default function BuscadorVariante({ onElegir, placeholder = 'Buscar producto o variante...', autoFocus = false, grande = false }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [abierto, setAbierto] = useState(false);
    const [buscando, setBuscando] = useState(false);
    const [buscado, setBuscado] = useState(false);   // ya volvió una búsqueda para esta q
    const timer = useRef(null);
    useEffect(() => {
        if (q.trim().length < 2) { setRes([]); setBuscado(false); setBuscando(false); return; }
        setBuscando(true); setBuscado(false);
        clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
            try {
                const r = await api.get(`/wms-interno/variantes?q=${encodeURIComponent(q.trim())}`);
                setRes(r.data?.data || []);
                setAbierto(true);
            } catch (e) { setRes([]); }
            finally { setBuscando(false); setBuscado(true); }
        }, 300);
        return () => clearTimeout(timer.current);
    }, [q]);
    return (
        <div className="relative">
            <Search size={grande ? 18 : 15} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${grande ? 'left-4' : 'left-3'}`} />
            <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => q.trim().length >= 2 && setAbierto(true)}
                placeholder={placeholder} autoFocus={autoFocus}
                className={`w-full pr-3 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-sky-200 ${grande
                    ? 'pl-11 py-3.5 text-base border-sky-300'
                    : 'pl-9 py-2.5 text-sm border-slate-200'}`} />
            {buscando && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 animate-spin" />}
            {/* Sin esto el campo queda mudo cuando no hay match y parece que no funciona */}
            {abierto && buscado && res.length === 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-3">
                    <p className="text-xs font-bold text-slate-500">Ningún artículo coincide con “{q.trim()}”.</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Probá con el nombre del producto, la variante o el código.</p>
                </div>
            )}
            {abierto && res.length > 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto">
                    {res.map(v => (
                        <button key={v.VarId} type="button"
                            onClick={() => { onElegir(v); setQ(''); setRes([]); setAbierto(false); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-sky-50 border-b border-slate-50 last:border-b-0">
                            <p className="text-sm font-bold text-slate-700">{v.Producto}</p>
                            <p className="text-xs text-slate-500">
                                {v.NombreVariante}
                                {(v.Talle || v.Color) && <span className="ml-1 text-slate-400">({[v.Talle, v.Color].filter(Boolean).join(' · ')})</span>}
                                {v.CodigoVariante && <span className="ml-1 font-mono text-[10px] text-slate-400">{v.CodigoVariante}</span>}
                            </p>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
