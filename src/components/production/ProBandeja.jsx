import React, { useState } from 'react';
import Swal from 'sweetalert2';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PackageCheck, FlagTriangleRight, RefreshCw, Search, CheckCircle2, Lock, Flame, Package, FileText, StickyNote, Ruler, ExternalLink, DollarSign } from 'lucide-react';
import api from '../../services/apiClient';
import { logisticsService } from '../../services/modules/logisticsService';
import { ordersService } from '../../services/modules/ordersService';
import { createBandejaService } from '../../services/modules/embBoardService';
import OrderRouteTracker, { AREA_NAMES } from '../orders/OrderRouteTracker';
import ReportarFallaModal from './components/ReportarFallaModal';
import PendientesPedidoPanel from './components/PendientesPedidoPanel';
import QuotationEditModal from '../logistics/QuotationEditModal';
import BuscadorCotizacionOtraArea from './BuscadorCotizacionOtraArea';
import { useAuth } from '../../context/AuthContext';

// [PRENDAS] Bandeja de Producción — mismo formato lista + detalle que usan Bordado/Estampado/
// Corte/Costura (EmbBandeja.jsx: columna angosta con las tarjetas a la izquierda, detalle
// completo a la derecha), en vez del grillado propio que tenía antes. Reemplaza el acceso
// "Modificar Flujo" (antes "Gestión de Rutas", sin uso real — ver investigación de esta sesión).
const proFallaService = createBandejaService('/logistics/pro');

const ESTADO_INFO = {
    esperando: { texto: 'Esperando en área', className: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
    recibido: { texto: 'Recibido, sin controlar', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const contarFallas = (componentes) => (componentes || []).filter(c => /-[FR]\d/i.test(c.codigoOrden || '')).length;

// URL abrible del archivo, sea de ArchivosOrden (RutaAlmacenamiento) o ArchivosReferencia
// (UbicacionStorage) — mismo fallback que ya usa OrderDetailModal.jsx.
const urlArchivo = (f) => f.link || f.url || f.UbicacionStorage || f.RutaAlmacenamiento || '';
const nombreArchivo = (f) => f.NombreOriginal || f.NombreArchivo || f.nombre || f.Descripcion || 'Archivo sin nombre';
const esBocetoOLogo = (f) => /BOCETO|LOGO|MATRIZ|PREDISENO/i.test(f.TipoArchivo || '');

const ProBandeja = () => {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState(null); // noDocERP
    const [fallaOpen, setFallaOpen] = useState(false);
    const [cotizacionOpen, setCotizacionOpen] = useState(false);
    // Buscador aparte: cotización de un pedido de CUALQUIER área (la bandeja solo lista
    // los pedidos que tienen orden de PRO).
    const [buscadorCotizacionOpen, setBuscadorCotizacionOpen] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['logistica', 'pro', 'pedidos-completos'],
        queryFn: logisticsService.getPedidosCompletosPRO,
        refetchInterval: 15000,
    });
    const pedidos = data?.pedidos || [];
    const q = search.trim().toLowerCase();
    const filtered = q
        ? pedidos.filter(p => `${p.codigoOrden} ${p.cliente} ${p.noDocERP}`.toLowerCase().includes(q))
        : pedidos;
    const recibidos = filtered.filter(p => p.estado === 'recibido');
    const esperando = filtered.filter(p => p.estado === 'esperando');
    const selected = pedidos.find(p => p.noDocERP === selectedId) || null;

    const { data: rutaData, isLoading: cargandoRuta } = useQuery({
        queryKey: ['orders', 'integral', selected?.codigoOrden],
        queryFn: () => ordersService.getIntegralDetails(selected.codigoOrden),
        enabled: !!selected,
    });

    // Costo del pedido: cabecera de PedidosCobranza (mismo dato que muestra la pantalla de
    // Cotización) — visible acá para no tener que ir a buscarlo aparte antes de aprobar.
    const { data: cotizacionData } = useQuery({
        queryKey: ['quotation', selected?.noDocERP],
        queryFn: () => api.get(`/quotation/${encodeURIComponent(selected.noDocERP)}`).then(r => r.data),
        enabled: !!selected,
        retry: false,
    });
    const costoPedido = cotizacionData?.cabecera?.MontoTotal;
    const monedaPedido = cotizacionData?.cabecera?.Moneda;

    // Archivos de TODAS las órdenes del pedido (ya vienen en rutaData para armar el gráfico) —
    // separados en bocetos/logos vs. archivos de impresión/producción, y agrupados por la
    // orden dueña (OrdenCodigoOrden/OrdenAreaID, agregados al join del backend) para poder
    // ver de un vistazo de qué componente viene cada archivo, en vez de una pila suelta.
    const archivosPedido = (rutaData?.archivos || []).filter(f => f.Categoria === 'produccion' || f.Categoria === 'referencia');
    const bocetosYLogos = archivosPedido.filter(esBocetoOLogo);
    const archivosImpresion = archivosPedido.filter(f => !esBocetoOLogo(f));
    const agruparPorOrden = (archivos) => {
        const grupos = new Map();
        archivos.forEach(f => {
            const key = f.OrdenCodigoOrden || 'Sin orden';
            if (!grupos.has(key)) grupos.set(key, { codigoOrden: key, areaId: f.OrdenAreaID, archivos: [] });
            grupos.get(key).archivos.push(f);
        });
        return Array.from(grupos.values());
    };
    const bocetosYLogosPorOrden = agruparPorOrden(bocetosYLogos);
    const archivosImpresionPorOrden = agruparPorOrden(archivosImpresion);
    const notasPedido = rutaData?.header?.notas || [];

    // Cantidad de prendas: el número que manda es la Magnitud de la orden madre PRO (el
    // "campo prendas" real del pedido — ver logisticsController.getPedidosCompletosPRO). El
    // desglose por componente solo tiene sentido en las áreas de bandeja (EMB/EST/TWC/TWT,
    // `esPrendas`) porque ahí la magnitud SÍ está contada en piezas — Sublimación/DTF/TPU
    // miden metros de tela, no prendas, y compararlos daría una alarma falsa (como pasaba
    // antes con dos órdenes de Sublimación en metros).
    const cantidadPrendasPedido = selected?.cantidadPrendas;
    const componentesConCantidad = (selected?.componentes || []).filter(c => c.esPrendas && c.magnitud != null && c.magnitud !== '');
    // El cartel rojo avisa que dos componentes de la MISMA prenda no cuentan lo mismo (ej. se
    // bordaron 10 y se estamparon 9). Se compara por prenda: en un pedido con varias prendas
    // distintas (4 shorts niño bordados + 1 short adulto estampado) que los números difieran es
    // lo normal, no un error. Sin prenda identificada (pedido común) se compara todo junto,
    // como siempre.
    const cantidadesPorPrenda = {};
    componentesConCantidad.forEach(c => {
        const n = Number(c.magnitud);
        if (isNaN(n)) return;
        const clave = c.comboItemId != null ? String(c.comboItemId) : '_';
        (cantidadesPorPrenda[clave] ||= []).push(n);
    });
    const cantidadesNoCoinciden = Object.values(cantidadesPorPrenda).some(ns => ns.length > 1 && new Set(ns).size > 1);

    const aprobarMut = useMutation({
        mutationFn: (noDocERP) => logisticsService.aprobarControlPRO(noDocERP),
        onSuccess: (res) => {
            if (res.remitoCreado) {
                toast.success(`Pedido ${selected?.noDocERP} controlado — etiqueta generada y remito ${res.dispatchCode} enviado a Depósito.`);
            } else {
                toast.warning(res.message || 'Etiqueta generada, pero el remito no se pudo armar solo.');
            }
            queryClient.invalidateQueries({ queryKey: ['logistica', 'pro', 'pedidos-completos'] });
            setSelectedId(null);
        },
        onError: (err) => toast.error('No se pudo aprobar: ' + (err?.response?.data?.error || err.message)),
    });

    const handleAprobar = async () => {
        if (!selected) return;
        if (selected.libroIncompleto) {
            Swal.fire({
                icon: 'warning',
                title: `${selected.codigoOrden || selected.noDocERP} no está completo`,
                html: `Según el libro de entregas todavía falta:<br><br>` +
                    selected.motivosLibro.map(m => `<div style="text-align:left"><strong>${m.codigoOrden}</strong> (${m.areaId}): ${m.motivos.join('; ') || 'incompleta'}</div>`).join('') +
                    `<br>No se puede consolidar en PRO hasta que no quede ninguna reposición ni envío parcial abierto.`,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#4f46e5',
            });
            return;
        }
        const r = await Swal.fire({
            icon: 'question',
            title: `¿Controlar pedido ${selected.codigoOrden || selected.noDocERP}?`,
            html: `Cliente: <strong>${selected.cliente || 'Sin cliente'}</strong><br>
                   ${selected.componentes.length} componente(s) reunido(s) en PRO.<br><br>
                   Al confirmar se genera la etiqueta final y sale un remito hacia Depósito.`,
            showCancelButton: true,
            confirmButtonText: 'Sí, controlado — aprobar',
            cancelButtonText: 'Todavía no',
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#6b7280',
            reverseButtons: true,
        });
        if (!r.isConfirmed) return;
        aprobarMut.mutate(selected.noDocERP);
    };

    const ListaCard = ({ p }) => {
        const isSelected = selectedId === p.noDocERP;
        const fallas = contarFallas(p.componentes);
        const esperandoP = p.estado === 'esperando';
        return (
            <div
                onClick={() => setSelectedId(p.noDocERP)}
                className={`group p-4 rounded-xl border cursor-pointer transition-all duration-200 relative overflow-hidden ${isSelected
                    ? 'bg-brand-cyan/5 border-brand-cyan shadow-md ring-1 ring-brand-cyan'
                    : esperandoP
                        ? 'bg-zinc-50 border-dashed border-zinc-300 opacity-80 hover:border-zinc-400'
                        : 'bg-white border-zinc-200 hover:border-brand-cyan/40 hover:shadow-sm'
                    }`}
            >
                <div className="flex gap-2.5">
                    <div className="w-10 h-10 shrink-0 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center">
                        <Package size={16} className="text-zinc-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-start mb-1">
                            <span className="font-mono text-xs font-bold text-zinc-600">{p.codigoOrden || p.noDocERP}</span>
                            {esperandoP ? <Lock size={12} className="text-zinc-400" /> : fallas > 0 && <Flame size={12} className="text-rose-500" />}
                        </div>
                        <h3 className="font-bold text-zinc-800 text-sm leading-tight mb-1 line-clamp-1">{p.cliente || 'Sin cliente'}</h3>
                        {/* El trabajo (DescripcionTrabajo) es SIEMPRE específico de este pedido;
                            el producto de catálogo suele quedar en un genérico ("Prenda
                            Personalizada (sin catálogo)") que no dice nada — por eso manda acá. */}
                        <p className="text-xs text-zinc-500 line-clamp-1 italic mb-1.5">{p.trabajo || p.producto || 'Producto'}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ESTADO_INFO[p.estado].className}`}>
                            {esperandoP ? `${p.componentes.length} de ${p.totalComponentes} en PRO` : ESTADO_INFO[p.estado].texto}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-[78vh] bg-zinc-100 overflow-hidden rounded-2xl border border-zinc-200">
            {/* IZQUIERDA: LISTA */}
            <div className="w-80 bg-white border-r border-zinc-200 flex flex-col shrink-0">
                <div className="p-4 border-b border-zinc-100 bg-zinc-50">
                    <div className="flex items-center justify-between">
                        <h2 className="font-black text-zinc-700 uppercase tracking-wide text-sm">Bandeja de Producción</h2>
                        <button onClick={() => queryClient.invalidateQueries({ queryKey: ['logistica', 'pro', 'pedidos-completos'] })} disabled={isLoading} className="text-zinc-400 hover:text-brand-cyan transition-colors">
                            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">{pedidos.length} pedidos</p>
                    <button
                        onClick={() => setBuscadorCotizacionOpen(true)}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-zinc-200 bg-white text-[11px] font-bold text-zinc-600 hover:border-brand-cyan hover:text-brand-cyan transition-colors"
                        title="Buscar el pedido de cualquier área y editar su cotización completa"
                    >
                        <DollarSign size={12} /> Cotización de otra área
                    </button>
                    <div className="relative mt-2">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar..."
                            className="w-full pl-8 pr-2 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-brand-cyan"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {isLoading && pedidos.length === 0 && (
                        <div className="text-center py-10 text-zinc-400 text-xs">Cargando...</div>
                    )}
                    {!isLoading && recibidos.length === 0 && esperando.length === 0 && (
                        <div className="text-center py-10 text-zinc-400">
                            <CheckCircle2 size={28} className="mx-auto mb-2 opacity-30" />
                            <p className="text-xs">No hay pedidos en Producción.</p>
                        </div>
                    )}
                    {recibidos.map(p => <ListaCard key={p.noDocERP} p={p} />)}

                    {esperando.length > 0 && (
                        <>
                            <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide pt-2 pb-1 flex items-center gap-1.5">
                                <Lock size={11} /> Esperando componentes ({esperando.length})
                            </div>
                            {esperando.map(p => <ListaCard key={p.noDocERP} p={p} />)}
                        </>
                    )}
                </div>
            </div>

            {/* DERECHA: DETALLE */}
            <div className="flex-1 overflow-y-auto bg-zinc-50/50 p-6">
                {!selected ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-300">
                        <CheckCircle2 size={48} className="mb-3 opacity-40" />
                        <p className="text-sm font-medium">Elegí un pedido de la lista</p>
                    </div>
                ) : (
                    <div className="max-w-2xl">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h2 className="font-mono font-black text-xl text-zinc-800">{selected.codigoOrden || selected.noDocERP}</h2>
                                <p className="text-zinc-600 font-medium">{selected.cliente || 'Sin cliente'}</p>
                                <p className="text-sm text-zinc-400">{selected.trabajo || selected.producto || '-'}</p>
                                <button
                                    onClick={() => setCotizacionOpen(true)}
                                    title="Abrir la cotización del pedido"
                                    className="flex items-center gap-1 mt-1 text-sm font-bold text-emerald-700 hover:text-emerald-800 hover:underline"
                                >
                                    <DollarSign size={14} />
                                    {costoPedido != null ? `${monedaPedido || ''} ${Number(costoPedido).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Ver cotización'}
                                </button>
                            </div>
                            <div className="shrink-0 flex flex-col gap-1.5 items-end">
                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${ESTADO_INFO[selected.estado].className}`}>
                                    {ESTADO_INFO[selected.estado].texto}
                                </span>
                                <button
                                    onClick={() => setFallaOpen(true)}
                                    title="Reportar una falla de esta área o un faltante del insumo que vino de un área anterior"
                                    className="flex items-center gap-1.5 text-xs font-bold text-[#BD0C7E] hover:bg-pink-50 border border-pink-300 rounded-lg px-3 py-2 transition-colors"
                                >
                                    <FlagTriangleRight size={13} /> Reportar falla
                                </button>
                            </div>
                        </div>

                        {cargandoRuta ? (
                            <div className="text-sm text-zinc-400 py-4">Cargando flujo del pedido...</div>
                        ) : (
                            <div className="mb-4">
                                <OrderRouteTracker steps={rutaData?.ruta || []} title="Flujo del pedido" />
                            </div>
                        )}

                        {/* Detalle real por orden — lo que llegó, lo que falta y qué reposición
                            sigue abierta, área por área — mismo panel que usa el resto de las
                            bandejas antes de reportar una falla, no un resumen aparte. */}
                        <PendientesPedidoPanel ordenId={selected.ordenProId} service={proFallaService} area="PRO" />

                        {selected.libroIncompleto && (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-4">
                                <div className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={14} /> Lo que falta según el libro de entregas:</div>
                                {selected.motivosLibro.map((m, i) => (
                                    <div key={i}>{m.codigoOrden} ({AREA_NAMES[m.areaId] || m.areaId}): {m.motivos.join('; ') || 'incompleta'}</div>
                                ))}
                            </div>
                        )}

                        {/* Control: todo lo que hace falta para comprobar que el pedido está OK
                            antes de aprobar — cantidad de prendas, nota del cliente y los
                            archivos de impresión/bocetos, agrupados por la orden que los trajo. */}
                        <div className="bg-white border border-zinc-200 rounded-xl p-4 mb-4 space-y-4">
                            <div className="text-[10px] font-black uppercase text-zinc-400 tracking-wide">Control del pedido</div>

                            <div>
                                <div className="text-xs font-bold text-zinc-600 flex items-center gap-1.5 mb-1.5"><Ruler size={13} /> Cantidad de prendas</div>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-2xl font-mono font-black text-zinc-800">{cantidadPrendasPedido ?? '—'}</span>
                                    <span className="text-xs text-zinc-400">
                                        {(selected?.articulosPedido || 1) > 1
                                            ? `prendas del pedido, en ${selected.articulosPedido} artículos distintos`
                                            : 'prendas del pedido (orden madre PRO)'}
                                    </span>
                                </div>
                                {componentesConCantidad.length > 0 && (
                                    <>
                                        <div className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Por componente contado en piezas</div>
                                        <div className="border border-zinc-100 rounded-lg overflow-hidden">
                                            {componentesConCantidad.map(c => (
                                                <div key={c.ordenId} className="grid grid-cols-[1fr_auto] gap-2 items-center px-3 py-1.5 text-xs border-t border-zinc-100 first:border-t-0 bg-white">
                                                    <span><span className="font-bold text-brand-cyan">{c.codigoOrden}</span> <span className="text-zinc-400">· {AREA_NAMES[c.areaId] || c.areaId}</span>{c.nombreArticulo ? <span className="text-zinc-400"> · {c.nombreArticulo}</span> : null}</span>
                                                    <span className="font-mono font-bold text-zinc-700">{c.magnitud}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {cantidadesNoCoinciden && (
                                            <p className="text-[11px] text-rose-600 font-bold mt-1.5 flex items-center gap-1"><AlertTriangle size={12} /> Las cantidades no coinciden entre componentes — revisar antes de aprobar.</p>
                                        )}
                                    </>
                                )}
                            </div>

                            <div>
                                <div className="text-xs font-bold text-zinc-600 flex items-center gap-1.5 mb-1.5"><StickyNote size={13} /> Nota</div>
                                {notasPedido.length === 0 ? (
                                    <p className="text-xs text-zinc-400">Este pedido no tiene notas.</p>
                                ) : (
                                    <div className="space-y-1.5">
                                        {notasPedido.map((n, i) => (
                                            <div key={i} className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 text-amber-900">
                                                <span className="font-bold text-amber-700">{n.codigoOrden} ({AREA_NAMES[n.areaId] || n.areaId}):</span> {n.nota}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="text-xs font-bold text-zinc-600 flex items-center gap-1.5 mb-1.5"><FileText size={13} /> Bocetos / logos</div>
                                {bocetosYLogosPorOrden.length === 0 ? (
                                    <p className="text-xs text-zinc-400">Sin bocetos ni logos en este pedido.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {bocetosYLogosPorOrden.map(g => (
                                            <div key={g.codigoOrden}>
                                                <div className="text-[11px] font-bold text-zinc-500 mb-1">{g.codigoOrden}{g.areaId ? ` · ${AREA_NAMES[g.areaId] || g.areaId}` : ''}</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {g.archivos.map((f, i) => (
                                                        <a key={f.RefID || f.ArchivoID || i} href={urlArchivo(f)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-bold text-brand-cyan bg-cyan-50 border border-cyan-100 rounded-lg px-2 py-1 hover:bg-cyan-100">
                                                            {nombreArchivo(f)} <ExternalLink size={10} />
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="text-xs font-bold text-zinc-600 flex items-center gap-1.5 mb-1.5"><FileText size={13} /> Archivos de impresión / producción</div>
                                {archivosImpresionPorOrden.length === 0 ? (
                                    <p className="text-xs text-zinc-400">Sin archivos de impresión en este pedido.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {archivosImpresionPorOrden.map(g => (
                                            <div key={g.codigoOrden}>
                                                <div className="text-[11px] font-bold text-zinc-500 mb-1">{g.codigoOrden}{g.areaId ? ` · ${AREA_NAMES[g.areaId] || g.areaId}` : ''}</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {g.archivos.map((f, i) => (
                                                        <a key={f.RefID || f.ArchivoID || i} href={urlArchivo(f)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-bold text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 hover:bg-zinc-100">
                                                            {nombreArchivo(f)} <ExternalLink size={10} />
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end pt-1">
                            {selected.estado === 'esperando' ? (
                                <span className="text-xs font-bold text-zinc-400">Se puede controlar recién cuando lleguen todos los componentes.</span>
                            ) : (
                                <button
                                    onClick={handleAprobar}
                                    disabled={aprobarMut.isPending || selected.libroIncompleto}
                                    title={selected.libroIncompleto ? 'Todavía hay una reposición o envío parcial abierto en una etapa anterior del pedido' : undefined}
                                    className="flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <PackageCheck size={16} /> Aprobar control y generar bulto
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <ReportarFallaModal
                open={fallaOpen}
                onClose={() => setFallaOpen(false)}
                orden={selected ? { OrdenID: selected.ordenProId, CodigoOrden: selected.codigoOrden } : { OrdenID: null, CodigoOrden: '' }}
                area="PRO"
                service={proFallaService}
                onDone={() => {
                    queryClient.invalidateQueries({ queryKey: ['logistica', 'pro', 'pedidos-completos'] });
                    setSelectedId(null);
                }}
            />

            {buscadorCotizacionOpen && (
                <BuscadorCotizacionOtraArea
                    currentUser={user}
                    onClose={() => setBuscadorCotizacionOpen(false)}
                />
            )}

            {cotizacionOpen && selected && (
                <QuotationEditModal
                    noDocERP={selected.noDocERP}
                    currentUser={user}
                    // Desde Producción se ve/edita la cotización del PEDIDO COMPLETO (todas las
                    // áreas), mismo criterio que ya usa OrderDetailModal.jsx para PRO.
                    areaFilter="TODOS"
                    permitirReconstruir
                    onClose={() => setCotizacionOpen(false)}
                    onSaved={() => queryClient.invalidateQueries({ queryKey: ['quotation', selected.noDocERP] })}
                />
            )}
        </div>
    );
};

export default ProBandeja;
