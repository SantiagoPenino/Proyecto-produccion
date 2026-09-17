import React, { useState, useEffect } from 'react';
import { Search, X, FileText, Loader2 } from 'lucide-react';
import api from '../../services/apiClient';
import QuotationEditModal from '../logistics/QuotationEditModal';

// [PRENDAS] Buscador de cotizaciones de CUALQUIER área, para abrirlas desde PRO.
// La bandeja de PRO solo lista los pedidos que tienen una orden PRO; esto es la puerta
// aparte para el resto: se busca por código de orden (DTF-20944), por número de pedido
// (20944), por nombre del cliente o por el trabajo, y se abre el MISMO editor de
// cotización que usa todo el sistema, con todas las líneas del pedido desbloqueadas
// (areaFilter="TODOS"), no solo las de PRO.
const BuscadorCotizacionOtraArea = ({ onClose, currentUser }) => {
    const [texto, setTexto] = useState('');
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const [error, setError] = useState('');
    const [abierta, setAbierta] = useState(null);   // NoDocERP de la cotización abierta

    // Se busca solo, medio segundo después de dejar de tipear (mínimo 2 caracteres).
    useEffect(() => {
        const q = texto.trim();
        if (q.length < 2) { setResultados([]); setError(''); return; }
        let vigente = true;
        setBuscando(true);
        const t = setTimeout(() => {
            api.get('/quotation/list', { params: { q } })
                .then(res => {
                    if (!vigente) return;
                    setResultados(Array.isArray(res.data) ? res.data : []);
                    setError('');
                })
                .catch(err => { if (vigente) setError(err.response?.data?.error || err.message); })
                .finally(() => { if (vigente) setBuscando(false); });
        }, 500);
        return () => { vigente = false; clearTimeout(t); };
    }, [texto]);

    if (abierta) {
        return (
            // z por encima del Navbar (z-[5010], src/components/layout/Navbar.jsx) — con z-[70]
            // la barra de "GESTIÓN DE PRODUCCIÓN" quedaba por encima y tapaba este modal.
            <div className="fixed inset-0 z-[5020] bg-black/50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
                    <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 text-white shrink-0">
                        <span className="text-xs font-bold uppercase tracking-wider">
                            Cotización del pedido {abierta} — abierta desde Producción
                        </span>
                        <button onClick={() => setAbierta(null)} className="text-zinc-300 hover:text-white text-xs font-bold flex items-center gap-1.5">
                            <X size={14} /> Volver al buscador
                        </button>
                    </div>
                    <div className="flex-1 min-h-0">
                        <QuotationEditModal
                            embedded
                            noDocERP={abierta}
                            currentUser={currentUser}
                            // Se edita el pedido COMPLETO, sin importar de qué área sea cada línea.
                            areaFilter="TODOS"
                            permitirReconstruir
                            onSaved={() => { }}
                        />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[5020] bg-black/50 flex items-start justify-center p-4 pt-20" onClick={onClose}>
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-zinc-100 bg-zinc-50 flex items-start justify-between">
                    <div>
                        <h2 className="font-black text-zinc-800 text-sm uppercase tracking-wide flex items-center gap-2">
                            <FileText size={15} className="text-brand-cyan" /> Cotización de otra área
                        </h2>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                            Buscá cualquier pedido del sistema y editá su cotización completa, sea del área que sea.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><X size={18} /></button>
                </div>

                <div className="p-4">
                    <div className="relative">
                        {buscando
                            ? <Loader2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-cyan animate-spin" />
                            : <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />}
                        <input
                            autoFocus
                            type="text"
                            value={texto}
                            onChange={e => setTexto(e.target.value)}
                            placeholder="Código de orden (DTF-20944), número de pedido, cliente o trabajo"
                            className="w-full pl-9 pr-3 py-2.5 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-brand-cyan"
                        />
                    </div>

                    {error && <p className="text-xs text-rose-600 font-bold mt-3">{error}</p>}

                    <div className="mt-3 max-h-[50vh] overflow-y-auto divide-y divide-zinc-100">
                        {texto.trim().length >= 2 && !buscando && resultados.length === 0 && !error && (
                            <p className="text-xs text-zinc-400 py-6 text-center">Ningún pedido coincide con "{texto.trim()}".</p>
                        )}
                        {resultados.map(r => (
                            <button
                                key={r.ID}
                                onClick={() => setAbierta(String(r.NoDocERP || '').trim())}
                                className="w-full text-left px-2 py-2.5 hover:bg-zinc-50 flex items-center gap-3 group"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs font-black text-zinc-700">{String(r.NoDocERP || '').trim()}</span>
                                        {(r.Areas || []).map(a => (
                                            <span key={a} className="text-[9px] font-black uppercase bg-zinc-100 text-zinc-600 border border-zinc-200 px-1.5 py-0.5 rounded">{a}</span>
                                        ))}
                                    </div>
                                    <p className="text-sm font-bold text-zinc-800 truncate">{r.Cliente || 'Sin cliente'}</p>
                                    <p className="text-[11px] text-zinc-500 italic truncate">{r.QR_Trabajo || '—'}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="font-mono text-sm font-black text-zinc-700">
                                        {r.Moneda === 'USD' ? 'USD' : '$'} {Number(r.MontoTotal || 0).toFixed(2)}
                                    </div>
                                    <div className="text-[10px] font-bold uppercase text-zinc-400">{r.EstadoCobro || ''}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BuscadorCotizacionOtraArea;
