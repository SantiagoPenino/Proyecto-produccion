import React, { useState, useEffect, useRef } from 'react';
import { Boxes, RefreshCw, PackageOpen, Package, ChevronDown, ChevronRight } from 'lucide-react';
import { logisticsService } from '../../services/modules/logisticsService';
import { toast } from 'sonner';
import OrderRequirementsList from './OrderRequirementsList';
import Selector from '../ui/Selector';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, tarjetas blancas con borde, íconos de
// Lucide en brand-cyan sin fondo, el filtro de área con el Selector propio; el color queda para el estado del bulto.
// Los bultos se dibujan de a 50 y en el celular van en tarjetas (la tabla obligaba a scrollear de costado).
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CHIP = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';

// Listas de a 50 (patrón useDeAPoco de Reportes): con cientos de bultos se dibujaban todos de una. Al acercarse al
// final se agregan 50 más; vuelve a 50 cuando cambia la lista. El margen se mide contra el contenedor que scrollea.
const DE_A = 50;
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};
function useDeAPoco(lista) {
    const [cuantos, setCuantos] = useState(DE_A);
    useEffect(() => { setCuantos(DE_A); }, [lista]);
    const centinela = useRef(null);
    const total = lista.length;
    useEffect(() => {
        const el = centinela.current;
        if (!el || cuantos >= total) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setCuantos(c => c + DE_A);
        }, { root: contenedorConScroll(el), rootMargin: '0px 0px 600px 0px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, [cuantos, total]);
    return [Math.min(cuantos, total), centinela];
}

// En el celular, tarjetas en vez de la tabla (una vista sola: no se dibujan las dos ocultando una)
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}

const claseEstado = (estado) => (estado === 'EN_STOCK' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    estado === 'EN_TRANSITO' ? 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20' :
        'bg-zinc-100 text-zinc-500 border-zinc-200');

const StockView = ({ areaFilter }) => {
    const [stock, setStock] = useState([]);
    const [loading, setLoading] = useState(false);

    // If Global Filter exists, use it. Otherwise default to TODOS.
    const [localArea, setLocalArea] = useState('TODOS');

    // Effective Area: Global takes precedence over Local
    const effectiveArea = (areaFilter && areaFilter !== 'TODOS') ? areaFilter : localArea;

    const [expandedBultoId, setExpandedBultoId] = useState(null);
    const [cuantos, centinela] = useDeAPoco(stock);
    const conTabla = useConTabla();
    const alternarRequisitos = (id) => setExpandedBultoId(expandedBultoId === id ? null : id);

    // Mapped Areas (Ideally fetched from backend, but hardcoded for now or use areasService)
    const areas = ['TODOS', 'RECEPCION', 'COSTURA', 'CORTE', 'BORDADO', 'ESTAMPADO', 'TERMINACION', 'DEPOSITO'];

    useEffect(() => {
        loadStock();
    }, [effectiveArea]); // Listen to effectiveArea changes

    const loadStock = async () => {
        setLoading(true);
        try {
            const data = await logisticsService.getAreaStock(effectiveArea);
            setStock(data);
        } catch (error) {
            console.error(error);
            toast.error("Error cargando inventario");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 p-3 md:p-6 gap-3 md:gap-4 text-zinc-800">
            {/* Header / Filter */}
            <div className={`${CARD} p-4 flex flex-wrap justify-between items-center gap-3`}>
                <div className="flex items-center gap-3 min-w-0">
                    <Boxes size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-zinc-800">
                            Inventario de Bultos
                        </h2>
                        <p className="text-sm text-zinc-400">
                            {effectiveArea !== 'TODOS' ? `Stock en ${effectiveArea}` : 'Stock Global'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Only show local filter if NO Global Filter is active */}
                    {(!areaFilter || areaFilter === 'TODOS') && (
                        <>
                            <span className="text-[11px] font-black text-zinc-400 uppercase tracking-wide shrink-0">Filtrar:</span>
                            {/* Selector propio (antes <select> nativo): el valor ya es texto ('TODOS', 'COSTURA'…), no hace falta convertirlo */}
                            <Selector
                                filtro
                                aria-label="Filtrar por área"
                                value={localArea}
                                onChange={e => setLocalArea(e.target.value)}
                            >
                                {areas.map(a => <option key={a} value={a}>{a}</option>)}
                            </Selector>
                        </>
                    )}

                    {/* Refresh Button always visible */}
                    <button
                        onClick={loadStock}
                        className={BTN_SECUNDARIO}
                        title="Actualizar"
                        aria-label="Actualizar"
                    >
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* List */}
            <div className={`${CARD} flex-1 min-h-0 overflow-hidden flex flex-col`}>
                {stock.length === 0 && !loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16 px-4 text-center">
                        <PackageOpen size={40} className="text-zinc-200" />
                        <p className="text-zinc-400 font-medium">No hay bultos en esta ubicación</p>
                    </div>
                ) : !conTabla ? (
                    // Celular: una tarjeta por bulto (código y estado arriba, la descripción, y ubicación / orden abajo)
                    <div className="overflow-auto p-3 space-y-2">
                        {stock.slice(0, cuantos).map((item) => (
                            <div key={item.BultoID} className="rounded-xl border border-zinc-200 p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="flex items-center gap-2 min-w-0 font-mono font-black text-sm text-zinc-800">
                                        <Package size={15} className="shrink-0 text-brand-cyan" />
                                        <span className="truncate">{item.CodigoEtiqueta}</span>
                                    </span>
                                    <span className={`${CHIP} uppercase shrink-0 ${claseEstado(item.Estado)}`}>
                                        {String(item.Estado || '').replace('_', ' ')}
                                    </span>
                                </div>
                                <p className="mt-1.5 text-sm text-zinc-600 leading-snug line-clamp-2">{item.Descripcion || '-'}</p>
                                <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        <span className={`${CHIP} bg-zinc-100 text-zinc-600 border-zinc-200`}>{item.UbicacionActual}</span>
                                        {item.OrdenID && <span className={`${CHIP} whitespace-nowrap bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20`}>Ord: {item.OrdenID}</span>}
                                    </div>
                                    {item.OrdenID && (
                                        <button
                                            type="button"
                                            onClick={() => alternarRequisitos(item.BultoID)}
                                            className="inline-flex items-center gap-1 text-xs font-bold text-brand-cyan"
                                            aria-label="Mostrar u ocultar los requisitos de la orden"
                                        >
                                            {expandedBultoId === item.BultoID ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            Requisitos
                                        </button>
                                    )}
                                </div>
                                {expandedBultoId === item.BultoID && item.OrdenID && (
                                    <div className="mt-2.5 pt-2.5 border-t border-zinc-100">
                                        <OrderRequirementsList ordenId={item.OrdenID} areaId={item.UbicacionActual} />
                                    </div>
                                )}
                            </div>
                        ))}
                        {cuantos < stock.length && (
                            <div ref={centinela} className="py-3 text-center text-xs text-zinc-400">
                                Mostrando {cuantos} de {stock.length}…
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="overflow-auto">
                        <table className="w-full min-w-[600px] text-sm text-left border-collapse">
                            <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0 z-10">
                                <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                    <th className="px-4 py-2.5 border-b border-zinc-200">Código</th>
                                    <th className="px-4 py-2.5 border-b border-zinc-200">Ubicación</th>
                                    <th className="px-4 py-2.5 border-b border-zinc-200">Contenido / Descripción</th>
                                    <th className="px-4 py-2.5 border-b border-zinc-200 text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {stock.slice(0, cuantos).map((item) => (
                                    <React.Fragment key={item.BultoID}>
                                        <tr className="hover:bg-zinc-50 transition-colors">
                                            <td className="px-4 py-2.5 font-mono font-bold text-zinc-800 whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    {item.OrdenID && (
                                                        <button
                                                            onClick={() => alternarRequisitos(item.BultoID)}
                                                            className="text-zinc-400 hover:text-brand-cyan focus:outline-none"
                                                            aria-label="Mostrar u ocultar los requisitos de la orden"
                                                        >
                                                            {expandedBultoId === item.BultoID ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                        </button>
                                                    )}
                                                    <Package size={15} className="shrink-0 text-brand-cyan" />
                                                    {item.CodigoEtiqueta}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 whitespace-nowrap">
                                                <span className={`${CHIP} bg-zinc-100 text-zinc-600 border-zinc-200`}>
                                                    {item.UbicacionActual}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-zinc-600">
                                                {item.Descripcion || '-'}
                                                {item.OrdenID && <span className={`${CHIP} ml-2 whitespace-nowrap bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20`}>Ord: {item.OrdenID}</span>}
                                            </td>
                                            <td className="px-4 py-2.5 text-center whitespace-nowrap">
                                                <span className={`${CHIP} uppercase ${claseEstado(item.Estado)}`}>
                                                    {String(item.Estado || '').replace('_', ' ')}
                                                </span>
                                            </td>
                                        </tr>
                                        {expandedBultoId === item.BultoID && item.OrdenID && (
                                            <tr className="bg-zinc-50/50">
                                                <td colSpan="4" className="p-3 pl-10 border-b border-zinc-100">
                                                    <OrderRequirementsList
                                                        ordenId={item.OrdenID}
                                                        areaId={item.UbicacionActual}
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                        {cuantos < stock.length && (
                            <div ref={centinela} className="py-3 text-center text-xs text-zinc-400 border-t border-zinc-100">
                                Mostrando {cuantos} de {stock.length}…
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer Metrics */}
            <div className={`${CARD} px-4 py-3 flex flex-wrap justify-between items-center gap-2 text-xs font-bold text-zinc-400`}>
                <div>Total Bultos: <span className="text-brand-cyan text-base font-black ml-1">{stock.length}</span></div>
                <div>Ultima Actualización: {new Date().toLocaleTimeString()}</div>
            </div>
        </div>
    );
};

export default StockView;
