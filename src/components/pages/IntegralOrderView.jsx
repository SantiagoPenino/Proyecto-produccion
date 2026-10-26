import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    PackageSearch, Search, Loader2, Package, MapPin, FileText, TriangleAlert,
    CircleCheck, Eye, ListChecks, History, ChevronDown, ChevronUp, Filter,
} from 'lucide-react';
import { ordersService } from '../../services/modules/ordersService';
import OrderRouteTracker, { AREA_NAMES, tonoDeEstado, CHIP_TONO, ordenRecorrido } from '../orders/OrderRouteTracker';
import OrderDetailModal from '../production/components/OrderDetailModal';
import Selector from '../ui/Selector';

// Estética nueva (23/10/2026, como Logística y los paneles de producción): fondo claro, tarjetas blancas
// con borde, íconos de Lucide en brand-cyan sin fondo; el color queda para los estados. Respaldo del
// diseño anterior: scratchpad de la sesión, integral/IntegralOrderView.antes.jsx.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const TITULO = 'text-sm font-black uppercase tracking-wide text-zinc-800 flex items-center gap-2';
const CHIP = 'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap';
const TH = 'px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const SEGMENTADO = 'inline-flex flex-wrap items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white';
const segmento = (activo) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
    activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`;
const TODAS = 'TODAS';
const codArea = (id) => String(id || '').trim().toUpperCase();

// Historial: cuántas entradas se muestran antes de tocar "ver más" (el botón expande a TODAS).
const HISTORIAL_INICIAL = 20;

const nombreArea = (id) => AREA_NAMES[String(id || '').trim().toUpperCase()] || id || '—';
const fecha = (d, conHora) => (d ? new Date(d).toLocaleString('es-UY', conHora
    ? { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

const IntegralOrderView = () => {
    const [searchParams] = useSearchParams();
    const [searchRef, setSearchRef] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [historialCompleto, setHistorialCompleto] = useState(false);
    const [filtroArea, setFiltroArea] = useState(TODAS);

    // Busca solo si viene ?ref= en la URL
    useEffect(() => {
        const ref = searchParams.get('ref');
        if (ref) {
            setSearchRef(ref);
            doSearch(ref);
        }
    }, []);

    const doSearch = async (ref) => {
        if (!ref?.trim()) return;
        setLoading(true);
        setError(null);
        setData(null);
        setHistorialCompleto(false);   // otro pedido → el historial vuelve a arrancar colapsado
        setFiltroArea(TODAS);          // y sin filtro de área
        try {
            const res = await ordersService.getIntegralDetails(ref);
            setData(res);
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || 'Error buscando el pedido');
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e) => {
        e?.preventDefault();
        doSearch(searchRef);
    };

    // Filtro por área (23/10): uno solo para Órdenes e Historial. Solo se ofrecen las áreas que tienen
    // órdenes en este pedido, en el orden del recorrido, con cuántas órdenes tiene cada una.
    const { areas, areaPorOrden } = useMemo(() => {
        if (!data) return { areas: [], areaPorOrden: new Map() };
        const porOrden = new Map(data.ordenes.map(o => [o.OrdenID, codArea(o.AreaID)]));
        const cuenta = new Map();
        data.ordenes.forEach(o => { const a = codArea(o.AreaID); cuenta.set(a, (cuenta.get(a) || 0) + 1); });
        const orden = ordenRecorrido(data.ruta);
        const pos = (a) => (orden.indexOf(a) === -1 ? Infinity : orden.indexOf(a));
        const lista = [...cuenta.keys()]
            .sort((a, b) => pos(a) - pos(b) || nombreArea(a).localeCompare(nombreArea(b)))
            .map(a => ({ id: a, nombre: nombreArea(a), n: cuenta.get(a) }));
        return { areas: lista, areaPorOrden: porOrden };
    }, [data]);
    const filtrando = filtroArea !== TODAS;
    const cambiarFiltro = (a) => { setFiltroArea(a); setHistorialCompleto(false); };

    const ordenes = data ? data.ordenes.filter(o => !filtrando || codArea(o.AreaID) === filtroArea) : [];
    // Una entrada del historial es de un área si su orden es de esa área. Las que no se pueden ubicar
    // (una orden que no vino en la lista) se ven solo con «Todas».
    const historial = data
        ? data.historial.filter(h => !h.Estado.startsWith('SNAPSHOT_') && (!filtrando || areaPorOrden.get(h.OrdenID) === filtroArea))
        : [];
    const historialVisible = historialCompleto ? historial : historial.slice(0, HISTORIAL_INICIAL);
    const completado = data?.header.estadoGlobal === 'COMPLETADO';
    const deTotal = (n, total) => (filtrando ? `${n} de ${total}` : n);

    return (
        // Pegada al borde (23/10, pedido de Santiago): MainAppContent no le agrega margen a esta ruta
        // y acá queda solo un margen chico.
        <div className="flex flex-col min-h-full bg-slate-50 p-3 gap-3 text-zinc-800">
            {/* Encabezado + buscador */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <PackageSearch size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h1 className="text-2xl font-black uppercase text-zinc-800 leading-tight">Búsqueda integral</h1>
                        <p className="text-sm text-zinc-400">Todo el pedido: áreas, órdenes, bultos e historial</p>
                    </div>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2 w-full md:w-auto md:min-w-[360px]">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                        <input
                            type="text"
                            value={searchRef}
                            onChange={(e) => setSearchRef(e.target.value)}
                            placeholder="N° de pedido (ej. 37037, 1055 (1/2))"
                            aria-label="Número de pedido"
                            className="w-full pl-9 pr-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                        />
                    </div>
                    <button type="submit" disabled={loading}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-50">
                        {loading ? <Loader2 size={16} className="animate-spin" /> : 'Buscar'}
                    </button>
                </form>
            </div>

            {error && (
                <div className="px-4 py-3 rounded-xl border border-brand-magenta/20 bg-brand-magenta/5 text-sm font-bold text-brand-magenta">{error}</div>
            )}

            {loading && !data && (
                <div className={`${CARD} py-16 flex flex-col items-center justify-center gap-3`}>
                    <Loader2 size={28} className="animate-spin text-brand-cyan" />
                    <span className="text-sm text-zinc-400">Buscando el pedido…</span>
                </div>
            )}

            {data && (
                <div className="flex flex-col gap-4 animate-fade-in-up">

                    {/* 1. Pedido y avance */}
                    <div className={`${CARD} p-4 md:p-5`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                                <div className="text-[11px] font-black uppercase tracking-wide text-brand-cyan">Pedido {String(data.header.pedidoRef || '').trim()}</div>
                                <h2 className="text-2xl font-black text-zinc-800 truncate">{data.header.cliente}</h2>
                                {data.header.descripcion && <p className="text-sm text-zinc-500 mt-0.5">{data.header.descripcion}</p>}
                            </div>
                            <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1 shrink-0">
                                <div className="text-3xl font-black text-zinc-800 tabular-nums leading-none">{data.header.avance}%</div>
                                <span className={`${CHIP} ${completado ? CHIP_TONO.listo : CHIP_TONO.activo}`}>{data.header.estadoGlobal}</span>
                            </div>
                        </div>
                        <div className="mt-4 h-2 rounded-full bg-zinc-100 overflow-hidden" role="progressbar" aria-valuenow={data.header.avance} aria-valuemin={0} aria-valuemax={100}>
                            <div className={`h-full rounded-full transition-all duration-700 ${completado ? 'bg-emerald-500' : 'bg-brand-cyan'}`} style={{ width: `${data.header.avance}%` }} />
                        </div>
                    </div>

                    {/* 2. Hoja de ruta */}
                    <OrderRouteTracker steps={data.ruta} />

                    {/* 3. Bultos e incidencias */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className={`${CARD} p-4 md:p-5 flex flex-col gap-3`}>
                            <h3 className={TITULO}>
                                <Package size={18} className="text-brand-cyan" aria-hidden="true" /> Bultos
                                <span className="text-xs font-bold text-zinc-400 normal-case tracking-normal">({data.logistica.bultos.length})</span>
                            </h3>
                            {data.logistica.bultos.length === 0 ? (
                                <p className="text-sm text-zinc-400 py-6 text-center">Todavía no hay bultos.</p>
                            ) : (
                                <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                                    {data.logistica.bultos.map(b => (
                                        <div key={b.BultoID} className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl border border-zinc-100 bg-zinc-50">
                                            <div className="min-w-0">
                                                <div className="font-black text-sm text-zinc-800 font-mono truncate">{b.CodigoEtiqueta}</div>
                                                <div className="text-xs text-zinc-500 truncate">{b.CodigoOrden ? `${b.CodigoOrden} · ` : ''}{b.Descripcion}</div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                <span className={`${CHIP} bg-white text-zinc-700 border-zinc-200`}>
                                                    <MapPin size={11} className="text-brand-cyan" aria-hidden="true" /> {b.Ubicacion}
                                                </span>
                                                {b.CodigoRemito && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500">
                                                        <FileText size={10} className="text-brand-cyan" aria-hidden="true" /> {b.CodigoRemito}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className={`${CARD} p-4 md:p-5 flex flex-col gap-3`}>
                            <h3 className={TITULO}>
                                <TriangleAlert size={18} className="text-brand-cyan" aria-hidden="true" /> Incidencias y reposiciones
                                <span className="text-xs font-bold text-zinc-400 normal-case tracking-normal">({data.fallas.length})</span>
                            </h3>
                            {data.fallas.length === 0 ? (
                                <div className="py-6 flex flex-col items-center gap-2 text-sm text-zinc-400">
                                    <CircleCheck size={28} className="text-emerald-300" aria-hidden="true" />
                                    Sin incidencias registradas
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                                    {data.fallas.map(f => (
                                        <div key={f.FallaID} className="px-3 py-2.5 rounded-xl border border-brand-magenta/20 bg-brand-magenta/5">
                                            <div className="flex items-center justify-between gap-2 text-xs font-black text-brand-magenta">
                                                <span className="truncate">{f.TipoFalla}</span>
                                                <span className="shrink-0 tabular-nums font-bold">{fecha(f.FechaFalla)}</span>
                                            </div>
                                            {f.Observaciones && <p className="text-xs text-zinc-600 mt-1">{f.Observaciones}</p>}
                                            <div className="mt-1.5 text-[10px] font-bold text-zinc-500 font-mono">{f.CodigoOrden}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Filtro por área: aplica a Órdenes y a Historial. Con una sola área no hay nada que filtrar. */}
                    {areas.length > 1 && (
                        <div className={`${CARD} px-4 md:px-5 py-3 flex flex-col gap-2 md:flex-row md:items-center md:gap-3`}>
                            <span className="text-[11px] font-black uppercase tracking-wide text-zinc-400 inline-flex items-center gap-1.5 shrink-0">
                                <Filter size={14} className="text-brand-cyan" aria-hidden="true" /> Área
                            </span>
                            <div className={`${SEGMENTADO} hidden md:inline-flex`} role="group" aria-label="Filtrar órdenes e historial por área">
                                <button type="button" onClick={() => cambiarFiltro(TODAS)} className={segmento(!filtrando)}>Todas</button>
                                {areas.map(a => (
                                    <button key={a.id} type="button" onClick={() => cambiarFiltro(a.id)} className={segmento(filtroArea === a.id)}>
                                        {a.nombre}
                                        <span className={`tabular-nums ${filtroArea === a.id ? 'text-white/60' : 'text-zinc-400'}`}>{a.n}</span>
                                    </button>
                                ))}
                            </div>
                            <Selector className="md:hidden w-full" aria-label="Filtrar órdenes e historial por área"
                                value={filtroArea} onChange={(e) => cambiarFiltro(e.target.value)}>
                                <option value={TODAS}>Todas las áreas</option>
                                {areas.map(a => <option key={a.id} value={a.id}>{a.nombre} ({a.n})</option>)}
                            </Selector>
                            <span className="text-xs text-zinc-400 md:ml-auto">Filtra órdenes e historial</span>
                        </div>
                    )}

                    {/* 4. Órdenes del pedido */}
                    <div className={`${CARD} overflow-hidden`}>
                        <div className="px-4 md:px-5 py-3 border-b border-zinc-100">
                            <h3 className={TITULO}>
                                <ListChecks size={18} className="text-brand-cyan" aria-hidden="true" /> Órdenes
                                <span className="text-xs font-bold text-zinc-400 normal-case tracking-normal">({deTotal(ordenes.length, data.ordenes.length)})</span>
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-zinc-50 border-b border-zinc-100">
                                    <tr>
                                        <th className={TH}>Código</th>
                                        <th className={TH}>Área</th>
                                        <th className={TH}>Material</th>
                                        <th className={TH}>Ingreso</th>
                                        <th className={TH}>Estado</th>
                                        <th className={`${TH} text-right`}>Magnitud</th>
                                        <th className={TH}>Próximo</th>
                                        <th className={`${TH} text-center`}>Ver</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {ordenes.map(o => (
                                        <tr key={o.OrdenID} className="hover:bg-zinc-50 transition-colors">
                                            <td className="px-4 py-2.5 font-black text-zinc-800 font-mono whitespace-nowrap">{o.CodigoOrden}</td>
                                            <td className="px-4 py-2.5 text-xs font-bold text-zinc-600 whitespace-nowrap">{nombreArea(o.AreaID)}</td>
                                            <td className="px-4 py-2.5 text-xs text-zinc-500 max-w-[260px] truncate" title={String(o.Material || '').trim()}>{String(o.Material || '').trim() || '—'}</td>
                                            <td className="px-4 py-2.5 text-xs text-zinc-400 tabular-nums whitespace-nowrap">{fecha(o.FechaIngreso)}</td>
                                            <td className="px-4 py-2.5">
                                                <span className={`${CHIP} ${CHIP_TONO[tonoDeEstado(o.Estado)]}`}>{o.Estado}</span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-bold text-zinc-700 tabular-nums whitespace-nowrap">
                                                {o.Magnitud || 0} <span className="text-[10px] font-bold text-zinc-400">{o.AreaUM || ''}</span>
                                            </td>
                                            <td className="px-4 py-2.5 text-xs font-bold text-zinc-500 whitespace-nowrap">{o.ProximoServicio ? nombreArea(o.ProximoServicio) : '—'}</td>
                                            <td className="px-4 py-2.5 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedOrder({ id: o.OrdenID, area: o.AreaID })}
                                                    className="inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
                                                    title={`Ver ${o.CodigoOrden}`}
                                                    aria-label={`Ver ${o.CodigoOrden}`}
                                                >
                                                    <Eye size={16} className="text-brand-cyan" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* 5. Historial */}
                    <div className={`${CARD} overflow-hidden`}>
                        <div className="px-4 md:px-5 py-3 border-b border-zinc-100">
                            <h3 className={TITULO}>
                                <History size={18} className="text-brand-cyan" aria-hidden="true" /> Historial
                                <span className="text-xs font-bold text-zinc-400 normal-case tracking-normal">
                                    ({filtrando ? `${historial.length} de ${data.historial.filter(h => !h.Estado.startsWith('SNAPSHOT_')).length}` : historial.length})
                                </span>
                            </h3>
                        </div>
                        {historial.length === 0 && (
                            <p className="text-sm text-zinc-400 py-6 text-center">Sin movimientos{filtrando ? ' de esta área' : ''}.</p>
                        )}
                        <div className={`overflow-x-auto ${historial.length === 0 ? 'hidden' : ''}`}>
                            <table className="w-full text-xs text-left">
                                <thead className="bg-zinc-50 border-b border-zinc-100">
                                    <tr>
                                        <th className={TH}>Fecha</th>
                                        <th className={TH}>Usuario</th>
                                        <th className={TH}>Orden</th>
                                        <th className={TH}>Estado</th>
                                        <th className={`${TH} w-full`}>Detalle</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {historialVisible.map((h, i) => (
                                        <tr key={h.HistorialID || i} className="hover:bg-zinc-50 transition-colors">
                                            <td className="px-4 py-2 text-zinc-500 tabular-nums whitespace-nowrap">{fecha(h.Fecha, true)}</td>
                                            <td className="px-4 py-2 font-bold text-zinc-700 whitespace-nowrap">{h.NombreUsuario || h.Usuario || 'Sistema'}</td>
                                            <td className="px-4 py-2 font-bold text-brand-cyan font-mono whitespace-nowrap">{h.CodigoOrden}</td>
                                            <td className="px-4 py-2">
                                                <span className={`${CHIP} bg-zinc-50 text-zinc-600 border-zinc-200 max-w-[180px] truncate`} title={h.Estado}>{h.Estado}</span>
                                            </td>
                                            <td className="px-4 py-2 text-zinc-600 max-w-[480px] truncate" title={h.Detalle}>{h.Detalle}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {/* Ver más / ver menos: al expandir se muestra el historial ENTERO. En un pedido con varias
                            órdenes hermanas cada evento se registra por orden, así que un solo "Ingresado" ya ocupa
                            varias filas y el corte inicial se llena enseguida. */}
                        {historial.length > HISTORIAL_INICIAL && (
                            <button
                                type="button"
                                onClick={() => setHistorialCompleto(v => !v)}
                                className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-brand-cyan hover:bg-zinc-50 border-t border-zinc-100 transition-colors"
                            >
                                {historialCompleto
                                    ? <><ChevronUp size={14} /> Ver menos</>
                                    : <><ChevronDown size={14} /> Ver las {historial.length - HISTORIAL_INICIAL} entradas restantes ({historial.length} en total)</>}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {selectedOrder && (
                <OrderDetailModal
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                />
            )}
        </div>
    );
};

export default IntegralOrderView;
