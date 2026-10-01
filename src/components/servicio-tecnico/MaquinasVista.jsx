import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Search, Loader2, AlertTriangle, Wrench } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import { estadoEquipo, fmtDia, fmtDuracion, haceCuanto, mensajeError } from './constantes';
import { chip, campoFiltro } from './ui';
import Selector from '../ui/Selector';

// Máquinas de producción (ConfigEquipos) con su resumen de Servicio Técnico. Tocar una abre su ficha.
const MaquinasVista = ({ onAbrirMaquina }) => {
    const [equipos, setEquipos] = useState(null);
    const [q, setQ] = useState('');
    const [area, setArea] = useState('');
    const [soloProblemas, setSoloProblemas] = useState(false);

    const cargar = useCallback(async () => {
        try { setEquipos((await servicioTecnicoService.equipos()).data); }
        catch (e) { toast.error(mensajeError(e, 'No se pudieron cargar las máquinas')); setEquipos([]); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    const avisar = useRecargaConFreno(() => cargar());
    useEffect(() => {
        socket.on('st:updated', avisar);
        socket.on('lotes:updated', avisar);
        return () => { socket.off('st:updated', avisar); socket.off('lotes:updated', avisar); };
    }, [avisar]);

    const areas = useMemo(() => {
        const m = new Map();
        (equipos || []).forEach(e => m.set(e.AreaID, e.AreaNombre || e.AreaID));
        return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    }, [equipos]);

    const grupos = useMemo(() => {
        const t = q.trim().toLowerCase();
        const lista = (equipos || []).filter(e =>
            (!area || e.AreaID === area)
            && (!t || String(e.Nombre).toLowerCase().includes(t))
            && (!soloProblemas || e.Abiertas > 0 || String(e.Estado || '').trim().toUpperCase() === 'MANTENIMIENTO'));
        const g = new Map();
        lista.forEach(e => {
            const k = e.AreaNombre || e.AreaID || 'Sin área';
            if (!g.has(k)) g.set(k, []);
            g.get(k).push(e);
        });
        return [...g.entries()];
    }, [equipos, q, area, soloProblemas]);

    if (!equipos) return <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div>;

    return (
        <div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[180px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar máquina…"
                        className={`${campoFiltro} w-full pl-9`} />
                </div>
                <Selector filtro value={area} onChange={(e) => setArea(e.target.value)}>
                    <option value="">Todas las áreas</option>
                    {areas.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                </Selector>
                <label className="inline-flex items-center gap-2 px-2 text-sm font-bold text-zinc-600">
                    <input type="checkbox" checked={soloProblemas} onChange={(e) => setSoloProblemas(e.target.checked)} className="w-4 h-4 accent-brand-cyan" />
                    Con solicitudes o en mantenimiento
                </label>
            </div>

            {grupos.length === 0 ? (
                <div className="py-16 text-center text-sm text-zinc-400">No hay máquinas con esos filtros.</div>
            ) : grupos.map(([nombreArea, lista]) => (
                <div key={nombreArea} className="mb-5">
                    <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wide mb-2">{nombreArea}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2">
                        {lista.map(e => {
                            const est = estadoEquipo(e.Estado);
                            const enMant = String(e.Estado || '').trim().toUpperCase() === 'MANTENIMIENTO';
                            return (
                                <button key={e.EquipoID} onClick={() => onAbrirMaquina(e.EquipoID)}
                                    className={`text-left rounded-2xl border px-4 py-3 transition-all hover:shadow-sm ${enMant ? 'bg-amber-50/60 border-amber-200 hover:border-amber-300' : 'bg-white border-zinc-200 hover:border-brand-cyan/40'}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="font-black text-zinc-800 leading-tight">{e.Nombre}</span>
                                        <span className={`${chip} ${est.chip}`}>{est.label}</span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                                        {e.Abiertas > 0 ? (
                                            <span className={`inline-flex items-center gap-1 font-bold ${e.AbiertasParada > 0 ? 'text-amber-700' : 'text-brand-cyan'}`}>
                                                <AlertTriangle size={12} /> {e.Abiertas} abierta{e.Abiertas === 1 ? '' : 's'}{e.AbiertasParada > 0 ? ' · parada' : ''}
                                            </span>
                                        ) : <span className="text-emerald-600 font-bold">Sin solicitudes abiertas</span>}
                                        <span>{e.Fallas90} falla{e.Fallas90 === 1 ? '' : 's'} en 90 días</span>
                                        {e.MinutosParada90 > 0 && <span>parada {fmtDuracion(e.MinutosParada90)}</span>}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-zinc-400">
                                        {e.UltimaFalla && <span>Última falla {haceCuanto(e.UltimaFalla)}</span>}
                                        {e.Cambios > 0 && <span className="inline-flex items-center gap-1"><Wrench size={11} />{e.Cambios} cambio{e.Cambios === 1 ? '' : 's'} · último {fmtDia(e.UltimoCambio)}</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default MaquinasVista;
