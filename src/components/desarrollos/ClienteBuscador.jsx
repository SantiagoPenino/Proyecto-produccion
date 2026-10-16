import { useState, useEffect, useRef } from 'react';
import { Loader2, Check } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import { input as claseInput } from '../servicio-tecnico/ui';

// Cliente de un pedido: se busca en Clientes (al vendedor le salen primero los suyos) o se escribe a
// mano, para un prospecto que todavía no es cliente. value = { id, texto }; escribir borra el id.
const ClienteBuscador = ({ value, onChange, placeholder = 'Para quién es', disabled = false }) => {
    const [abierto, setAbierto] = useState(false);
    const [lista, setLista] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const caja = useRef(null);
    const textoActual = value?.texto || '';

    useEffect(() => {
        if (!abierto || value?.id || textoActual.trim().length < 2) { setLista([]); return undefined; }
        setBuscando(true);
        const t = setTimeout(() => {
            desarrollosService.clientes(textoActual.trim()).then(setLista).catch(() => setLista([])).finally(() => setBuscando(false));
        }, 250);
        return () => clearTimeout(t);
    }, [textoActual, abierto, value?.id]);

    // Tocar afuera cierra la lista
    useEffect(() => {
        if (!abierto) return undefined;
        const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false); };
        document.addEventListener('mousedown', fuera);
        return () => document.removeEventListener('mousedown', fuera);
    }, [abierto]);

    return (
        <div ref={caja} className="relative">
            <input className={`${claseInput} ${value?.id ? 'pr-9' : ''}`} value={textoActual} maxLength={120} disabled={disabled}
                placeholder={placeholder} onFocus={() => setAbierto(true)}
                onChange={(e) => { onChange({ id: null, texto: e.target.value }); setAbierto(true); }} />
            {value?.id && <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-cyan" aria-label="Cliente del sistema" />}
            {abierto && (buscando || lista.length > 0) && (
                <div className="absolute z-[6300] left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
                    {buscando && !lista.length && <div className="px-3 py-2"><Loader2 size={15} className="animate-spin text-zinc-300" /></div>}
                    {lista.map(c => (
                        <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { onChange({ id: c.id, texto: c.nombre }); setAbierto(false); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50">
                            <span className="flex-1 min-w-0 truncate text-zinc-800">
                                {c.nombre}
                                {c.razon && c.razon !== c.nombre && <span className="text-xs text-zinc-400"> · {c.razon}</span>}
                            </span>
                            {c.mio && <span className="text-[10px] font-black uppercase text-brand-cyan">Tuyo</span>}
                            <span className="text-xs text-zinc-400">{c.codigo}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ClienteBuscador;
