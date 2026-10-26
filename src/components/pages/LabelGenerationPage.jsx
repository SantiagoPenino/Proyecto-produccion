import React, { useState, useEffect } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import {
    Tags, RefreshCw, Search, Loader2, Ban, AlertTriangle, Info, SlidersHorizontal, Settings2, X, Minus, Plus,
    Check, CheckCircle2, Eye, MousePointerClick, List,
} from 'lucide-react';
import api from '../../services/api';

import { useAuth } from '../../context/AuthContext'; // Import Auth
import { logisticsService } from '../../services/modules/logisticsService';
import DispatchView from '../logistics/DispatchView';
import Selector from '../ui/Selector';
import useConfirmar from '../ui/useConfirmar';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, lista y vista previa en tarjetas blancas con
// borde, íconos Lucide en brand-cyan sin fondo, selects propios (Selector) y confirmación propia (useConfirmar) en vez
// de window.confirm. El color queda para el estado de la orden (bloqueada / pronta / con etiquetas). La lista se dibuja
// de a 50; en el celular va en tarjetas, con un segmentado Órdenes / Vista previa. Las etiquetas que se imprimen
// (vista previa en el iframe y el print del backend) no se tocaron.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const BADGE = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';
const ROTULO = 'text-[10px] font-black uppercase tracking-wide text-zinc-400';
const TH = 'px-3 py-2.5 bg-zinc-50 shadow-[inset_0_-1px_0_#e4e4e7]'; // la sombra hace de borde: queda con el encabezado fijo
const SEGMENTADO = 'inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white';
const segmento = (activo) => `inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
    activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`;

// Color del chip de estado (solo presentación, mismas condiciones que antes): verde si está pronta, rojo si no está en
// producción o está cancelada, brand-cyan el resto.
const claseEstado = (order, notInProd) => (
    (order.Estado === 'Pronto' || order.EstadoenArea === 'Pronto') ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : notInProd ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20'
);

// Lista y vista previa una al lado de la otra desde 1280 px; más angosto, una sola con el segmentado. Tabla desde
// 768 px y tarjetas abajo de eso (se dibuja una sola de las dos vistas).
const MQ_DOS_PANELES = '(min-width: 1280px)';
const MQ_TABLA = '(min-width: 768px)';
function useCoincide(query) {
    const [coincide, setCoincide] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const cambio = () => setCoincide(mq.matches);
        cambio();
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, [query]);
    return coincide;
}

// Filas de a 50 (como useDeAPoco de Reportes): el margen de 600 px se mide contra el contenedor que scrollea de verdad
// (la lista en escritorio, la página en el celular).
const POR_TANDA = 50;
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};

const LabelGenerationPage = ({ initialArea = '' }) => {
    const { user } = useAuth(); // Get user
    // Confirmación con el estilo del sistema (antes window.confirm, la ventana gris del navegador)
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const dosPaneles = useCoincide(MQ_DOS_PANELES);
    const conTabla = useCoincide(MQ_TABLA);
    const [vistaMovil, setVistaMovil] = useState('lista'); // solo presentación: 'lista' | 'previa' (sin los dos paneles)
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [areaFilter, setAreaFilter] = useState(initialArea);
    const [searchFilter, setSearchFilter] = useState('');
    const [batchFilter, setBatchFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('all'); // all, generable, blocked
    const [hideLabeled, setHideLabeled] = useState(true);

    const [selection, setSelection] = useState([]);
    const [generating, setGenerating] = useState(false);
    const [areas, setAreas] = useState([]);

    // Modal State
    const [configOrder, setConfigOrder] = useState(null);
    const [bultosInput, setBultosInput] = useState(1);
    const [pendingServices, setPendingServices] = useState([]);
    const [selectedNextService, setSelectedNextService] = useState('');

    // Remito Modal State
    const [showRemitoModal, setShowRemitoModal] = useState(false);
    const [remitoDestino, setRemitoDestino] = useState('DEPOSITO');
    const [creatingRemito, setCreatingRemito] = useState(false);

    useEffect(() => {
        loadProductiveAreas();
    }, []);

    const loadProductiveAreas = async () => {
        try {
            const res = await api.get('/areas');
            if (Array.isArray(res.data)) {
                // Filtrar solo áreas productivas: Usar flag Productiva (si existe) o Categoria
                let productive = res.data.filter(a =>
                    (a.Productiva === true || a.Productiva === 1 || (a.Categoria || '').toUpperCase().includes('PRODUCC'))
                    && a.Activa !== false
                );

                // FILTER: Only ADMIN sees ALL.
                const isAdmin = user?.rol === 'ADMIN' || user?.rol === 'admin';
                if (!isAdmin && user) {
                    const userArea = (user.areaKey || user.areaId || '').trim();
                    if (userArea) {
                        productive = productive.filter(a => (a.AreaID || '').trim() === userArea);
                    } else {
                        productive = [];
                    }
                }

                setAreas(productive);

                // Preseleccionar área: si viene initialArea (desde producción), usarla directo
                if (initialArea) {
                    setAreaFilter(initialArea);
                } else if (productive.length > 0) {
                    if (productive.length === 1) {
                        setAreaFilter(productive[0].AreaID.trim());
                    } else if (user) {
                        const userArea = (user.areaId || user.areaKey || '').trim();
                        if (userArea && productive.some(a => (a.AreaID || '').trim() === userArea)) {
                            setAreaFilter(userArea);
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Error loading areas", err);
        }
    };

    // Fetch orders on mount or area change
    useEffect(() => {
        fetchOrders();
    }, [areaFilter]);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            // Updated endpoint for Label Dashboard
            const response = await api.get('/production-file-control/ordenes-labels', {
                params: {
                    area: areaFilter || undefined,
                    search: ''
                }
            });
            setOrders(response.data);
        } catch (error) {
            console.error("Error fetching orders:", error);
            toast.error("Error cargando órdenes");
        } finally {
            setLoading(false);
        }
    };

    const handlePrintSelected = () => {
        if (selection.length === 0) return;
        const ids = selection.join(',');
        window.open(`/api/production-file-control/orden/batch/etiquetas/print?ids=${ids}`, '_blank');
    };

    const toggleSelect = (orderId) => {
        setSelection(prev => {
            if (prev.includes(orderId)) return prev.filter(id => id !== orderId);
            return [...prev, orderId];
        });
    };

    // Helper to check validity
    const isOrderBlocked = (order) => {
        // Cantidad de la cotización: si existe y es > 0, la orden tiene productos cargados
        const importeCot = parseFloat(order.ImporteCotizacion) || 0;
        const hasCotizacion = importeCot > 0;

        // Magnitud (metros) como fallback cuando no hay cotización
        let mag = 0;
        if (typeof order.Magnitud === 'number') mag = order.Magnitud;
        else if (order.Magnitud) {
            const clean = order.Magnitud.toString().replace(/[^0-9.]/g, '');
            mag = parseFloat(clean) || 0;
        }

        // Bloqueado si: no tiene cotización Y Magnitud es 0
        const isZero = !hasCotizacion && mag <= 0;
        const hasError = order.ValidacionOBS && order.ValidacionOBS.trim() !== '';

        // REGLA: No en producción o cancelada
        const lowerState = (order.Estado || '').toLowerCase();
        const notInProd = lowerState.includes('presupuesto') || lowerState.includes('pendiente') || lowerState.includes('cargando') || lowerState.includes('cancelada');

        return {
            isBlocked: isZero || hasError || notInProd,
            isZero,
            notInProd,
            message: notInProd
                ? `Orden en estado: ${(order.Estado || 'Desconocido').toUpperCase()}`
                : hasError
                    ? (order.ValidacionOBS || 'Error de validación')
                    : 'Sin cotización ni magnitud registrada'
        };
    };

    // Aplicar Filtros Locales
    const visibleOrders = orders.filter(o => {
        // Orden/Cliente search
        if (searchFilter) {
            const term = searchFilter.toLowerCase();
            const matchCod = o.CodigoOrden && o.CodigoOrden.toLowerCase().includes(term);
            const matchCli = o.Cliente && o.Cliente.toLowerCase().includes(term);
            const matchMat = o.Material && o.Material.toLowerCase().includes(term);
            if (!matchCod && !matchCli && !matchMat) return false;
        }

        // Ocultar etiquetadas
        if (hideLabeled && o.CantidadEtiquetas > 0) return false;

        // Filtro por Rollo (Lotes)
        if (batchFilter) {
            const rollInfo = (o.NombreRollo || o.RolloID || '').toLowerCase();
            if (!rollInfo.includes(batchFilter.toLowerCase())) return false;
        }

        // statusFilter
        if (statusFilter !== 'all') {
            const { isBlocked } = isOrderBlocked(o);
            if (statusFilter === 'generable' && isBlocked) return false;
            if (statusFilter === 'blocked' && !isBlocked) return false;
        }

        return true;
    });

    // Se dibujan de a 50: al acercarse al final se agregan 50 más y vuelve a 50 cuando cambia la lista o un filtro.
    // La selección («seleccionar todas», generar, vista previa) sigue tomando todas las órdenes visibles, no solo las dibujadas.
    const [verFilas, setVerFilas] = useState(POR_TANDA);
    useEffect(() => { setVerFilas(POR_TANDA); }, [orders, searchFilter, batchFilter, statusFilter, hideLabeled]);
    const [centinela, setCentinela] = useState(null);
    const hayMasFilas = visibleOrders.length > verFilas;
    useEffect(() => {
        if (!centinela || !hayMasFilas) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setVerFilas(v => v + POR_TANDA);
        }, { root: contenedorConScroll(centinela), rootMargin: '0px 0px 600px 0px' });
        obs.observe(centinela);
        return () => obs.disconnect();
    }, [centinela, verFilas, hayMasFilas]);

    // Obtener lotes únicos de la vista para el combo basados en el ROLLO
    const availableBatches = [...new Set(orders.map(o => {
        return o.NombreRollo || o.RolloID || null;
    }).filter(Boolean))].sort();

    // Helper to extract a short version if name is too long, or just use the name
    const formatBatchLabel = (b) => {
        if (b.length > 20) return b.substring(0, 18) + '...';
        return b;
    };

    const toggleSelectAll = () => {
        const validOrders = visibleOrders.filter(o => !isOrderBlocked(o).isBlocked);
        const validIds = validOrders.map(o => o.OrdenID);

        // If all VALID visible orders are selected, deselect all. Otherwise, select all VALID visible orders.
        const allValidSelected = validIds.length > 0 && validIds.every(id => selection.includes(id));

        if (allValidSelected) setSelection(selection.filter(id => !validIds.includes(id)));
        else setSelection([...new Set([...selection, ...validIds])]);
    };

    const handleGenerateClick = async () => {
        if (selection.length === 0) return;

        const alreadyFacturadas = visibleOrders.filter(o => selection.includes(o.OrdenID) && o.CantidadEtiquetas > 0);

        let pregunta = {
            titulo: `¿Generar bultos para ${selection.length} órdenes seleccionadas?`,
            texto: 'Se usarán valores automáticos.',
            confirmar: 'Generar',
        };
        if (alreadyFacturadas.length > 0) {
            pregunta = {
                titulo: '¿Desea REGENERAR y sobrescribir los bultos existentes?',
                texto: `ATENCIÓN: ${alreadyFacturadas.length} órdenes seleccionadas YA tienen etiquetas.`,
                confirmar: 'Regenerar',
                peligro: true,
            };
        }

        if (await confirmar(pregunta)) {
            processGenerationBatch(selection, null);
        }
    };

    const openManualConfig = async (order) => {
        let magVal = 0;
        if (order.Magnitud) {
            const m = order.Magnitud.toString().match(/[\d\.]+/);
            if (m) magVal = parseFloat(m[0]);
        }
        const propuesto = magVal > 0 ? Math.ceil(magVal / 60) : 1;
        setBultosInput(propuesto);
        setConfigOrder(order);
        setSelectedNextService(order.ProximoServicio || '');

        // Cargar servicios pendientes para reordenar
        try {
            const res = await api.get(`/production-file-control/orden/${order.OrdenID}/pending-services`);
            setPendingServices(res.data || []);
        } catch (e) {
            console.warn("No se pudieron cargar servicios pendientes");
        }
    };

    const processGenerationBatch = async (ids, fixedQty = null) => {
        setGenerating(true);
        let successCount = 0;
        let failCount = 0;
        let specificError = "";

        // Si es una sola orden desde el modal, aplicamos el cambio de ProximoServicio si existe
        if (ids.length === 1 && configOrder) {
            try {
                await api.post(`/production-file-control/orden/${ids[0]}/next-service`, {
                    nextService: selectedNextService
                });
            } catch (e) { console.warn("Error actualizando próximo servicio"); }
        }

        for (const orderId of ids) {
            try {
                const payload = fixedQty ? { cantidad: fixedQty } : {};
                await api.post(`/production-file-control/regen-labels/${orderId}`, payload);
                successCount++;
            } catch (error) {
                console.error(`Error order ${orderId}:`, error);
                if (error.response?.data?.error) {
                    specificError = error.response.data.error; // Keep last or concatenate
                }
                failCount++;
            }
        }

        setGenerating(false);
        setConfigOrder(null);

        if (failCount === 0) {
            toast.success(`Proceso finalizado.\nGeneradas: ${successCount}`);
        } else {
            toast.error(`Error en generación.\nÉxito: ${successCount} | Fallos: ${failCount}\n${specificError}`, { duration: 5000 });
        }

        // Force refresh of preview
        setPreviewTimestamp(Date.now());
        fetchOrders(); // Reload to update label counts
    };

        // Logic is now delegated to DispatchView's onActionOverride.
        // Old handleCreateRemitoLote logic removed as it's fully handled by the modal.

    const [previewTimestamp, setPreviewTimestamp] = useState(Date.now());

    const getFormattedDispatchOrders = () => {
        return visibleOrders.filter(o => selection.includes(o.OrdenID)).map(o => ({
            id: o.OrdenID,
            code: o.CodigoOrden,
            desc: o.Descripcion || o.Material,
            destino: o.ProximoServicio || 'LOGISTICA', // Will properly trigger the Review Step if LOGISTICA
            bultos: [] // Triggers new bultos or backend auto-fetch
        }));
    };

    // Update preview URL to include timestamp for cache busting/refresh
    const previewUrl = selection.length > 0
        ? `/api/production-file-control/orden/batch/etiquetas/print?ids=${selection.join(',')}&t=${previewTimestamp}`
        : null;

    // ─── Presentación ─────────────────────────────────────────────────────────
    // Mismo cálculo que el checkbox del encabezado de la tabla de antes (todas las generables visibles marcadas).
    const todasMarcadas = visibleOrders.length > 0 && selection.length > 0 &&
        visibleOrders.filter(o => !isOrderBlocked(o).isBlocked).every(o => selection.includes(o.OrdenID));
    const filasDibujadas = visibleOrders.slice(0, verFilas);
    const avisoFaltan = `Mostrando ${verFilas.toLocaleString('es-UY')} de ${visibleOrders.length.toLocaleString('es-UY')}…`;
    const formatoImporte = (v) => parseFloat(v).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const iconoBloqueo = (notInProd, clase = '') => (notInProd
        ? <Ban size={17} className={`text-rose-500 ${clase}`} />
        : <AlertTriangle size={17} className={`text-rose-500 ${clase}`} />);

    const panelLista = (
        // Left Panel: List
        // Lista 3/5 y vista previa 2/5 (antes mitad y mitad: sin nada elegido, media pantalla quedaba vacía)
        <div className={`${CARD} flex flex-col min-w-0 ${dosPaneles ? 'flex-[3_3_0%] min-h-0 overflow-hidden' : ''}`}>
            {/* Encabezado: título, área, filtros y la acción de generar */}
            <div className="p-4 border-b border-zinc-100 space-y-3 shrink-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <Tags size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                        <div className="min-w-0">
                            <h2 className="text-lg font-black text-zinc-800 leading-tight">Órdenes de Producción</h2>
                            <p className="text-sm text-zinc-400">
                                Gestión de Etiquetas
                                {!loading && orders.length > 0 && (
                                    <span className="tabular-nums">
                                        {' · '}{visibleOrders.length.toLocaleString('es-UY')}
                                        {visibleOrders.length !== orders.length ? ` de ${orders.length.toLocaleString('es-UY')}` : ''}
                                        {orders.length === 1 ? ' orden' : ' órdenes'}
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
                        <Selector
                            filtro
                            value={areaFilter}
                            onChange={(e) => setAreaFilter(e.target.value)}
                            aria-label="Área"
                            className="min-w-0 flex-1 sm:flex-none"
                        >
                            <option value="">Todas las áreas</option>
                            {areas.map(area => (
                                <option key={area.AreaID} value={area.AreaID}>{area.Nombre}</option>
                            ))}
                        </Selector>
                        <button type="button" onClick={fetchOrders} className={`${BTN_SECUNDARIO} shrink-0`} title="Actualizar" aria-label="Actualizar">
                            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px]">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Buscar orden, cliente o material…"
                            aria-label="Buscar orden, cliente o material"
                            className={CAMPO}
                            value={searchFilter}
                            onChange={(e) => setSearchFilter(e.target.value)}
                        />
                    </div>
                    <Selector
                        filtro
                        value={batchFilter}
                        onChange={(e) => setBatchFilter(e.target.value)}
                        aria-label="Filtro de lotes"
                        anchoLista={260}
                        className="flex-1 sm:flex-none min-w-0"
                    >
                        <option value="">Todos los lotes</option>
                        {availableBatches.map(b => (
                            <option key={b} value={b}>{formatBatchLabel(b)}</option>
                        ))}
                    </Selector>
                    <Selector
                        filtro
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="Estado"
                        className="flex-1 sm:flex-none min-w-0"
                    >
                        <option value="all">Ver Todas</option>
                        <option value="generable">Generables</option>
                        <option value="blocked">Bloqueadas</option>
                    </Selector>
                    <label
                        htmlFor="hideLabeled"
                        className={`w-full sm:w-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold cursor-pointer select-none transition-colors ${
                            hideLabeled ? 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`}
                    >
                        <input
                            type="checkbox"
                            id="hideLabeled"
                            checked={hideLabeled}
                            onChange={(e) => setHideLabeled(e.target.checked)}
                            className="w-4 h-4 cursor-pointer accent-brand-cyan"
                        />
                        Ocultar ya etiquetadas
                    </label>
                </div>

                {/* Selección y acción principal */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* En tarjetas no hay encabezado de tabla: el «seleccionar todas» va acá */}
                        {!conTabla && (
                            <label className="shrink-0 inline-flex items-center gap-2 text-xs font-bold text-zinc-600 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={todasMarcadas}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 cursor-pointer accent-brand-cyan"
                                />
                                Todas
                            </label>
                        )}
                        <p className="text-sm min-w-0">
                            {selection.length > 0 ? (
                                <>
                                    <span className="font-black text-zinc-800 tabular-nums">{selection.length}</span>{' '}
                                    <span className="text-zinc-500">{selection.length === 1 ? 'orden seleccionada' : 'órdenes seleccionadas'}</span>
                                </>
                            ) : (
                                <span className="text-zinc-400">Marcá órdenes generables para ver sus etiquetas.</span>
                            )}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleGenerateClick}
                        disabled={selection.length === 0 || generating}
                        className={`${BTN_PRINCIPAL} w-full sm:w-auto`}
                    >
                        {generating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                        Generar Etiquetas
                    </button>
                </div>
            </div>

            <div className={dosPaneles ? 'flex-1 min-h-0 overflow-auto' : ''}>
                {loading ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16">
                        <Loader2 size={30} className="animate-spin text-brand-cyan" />
                        <span className="text-sm text-zinc-400">Cargando órdenes…</span>
                    </div>
                ) : visibleOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center">
                        <Tags size={40} className="text-zinc-200" />
                        <p className="font-bold text-zinc-500">No hay órdenes para mostrar</p>
                        <p className="text-sm text-zinc-400">
                            {orders.length === 0 ? 'No hay órdenes en esta área.' : 'Ninguna orden coincide con los filtros.'}
                        </p>
                    </div>
                ) : conTabla ? (
                    <div className={dosPaneles ? '' : 'overflow-x-auto'}>
                        <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 z-10">
                                <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                    <th className={`${TH} w-12 text-center`}>
                                        <input
                                            type="checkbox"
                                            checked={todasMarcadas}
                                            onChange={toggleSelectAll}
                                            title="Seleccionar todas las generables"
                                            aria-label="Seleccionar todas las generables"
                                            className="w-4 h-4 cursor-pointer accent-brand-cyan align-middle"
                                        />
                                    </th>
                                    <th className={TH}>Orden</th>
                                    <th className={TH}>Rollo</th>
                                    <th className={TH}>Detalle</th>
                                    <th className={`${TH} text-right`}>Importe</th>
                                    <th className={`${TH} text-center`}>Bultos</th>
                                    <th className={`${TH} text-center`}>Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {filasDibujadas.map(order => {
                                    const isSelected = selection.includes(order.OrdenID);
                                    const hasLabels = order.CantidadEtiquetas > 0;
                                    const { isBlocked, message, notInProd } = isOrderBlocked(order);

                                    return (
                                        <tr
                                            key={order.OrdenID}
                                            className={`transition-colors ${isBlocked ? 'bg-zinc-50/70 cursor-not-allowed' : isSelected ? 'bg-brand-cyan/5 cursor-pointer' : 'hover:bg-zinc-50 cursor-pointer'}`}
                                            onClick={() => {
                                                if (isBlocked) return;
                                                toggleSelect(order.OrdenID);
                                            }}
                                        >
                                            <td className="relative px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                                                {/* Barra de estado: roja si está bloqueada, brand-cyan si está seleccionada */}
                                                <span className={`absolute left-0 inset-y-0 w-[3px] ${isBlocked ? 'bg-rose-300' : isSelected ? 'bg-brand-cyan' : 'bg-transparent'}`} aria-hidden="true" />
                                                {isBlocked ? (
                                                    <div className="group relative inline-flex justify-center align-middle">
                                                        {iconoBloqueo(notInProd, 'cursor-help')}
                                                        <div className="absolute left-7 -top-1 hidden group-hover:block z-[100] w-max max-w-[220px] bg-white border border-rose-200 text-rose-700 text-xs font-medium rounded-xl shadow-lg shadow-zinc-900/10 px-3 py-2 text-left pointer-events-none">
                                                            <div className="flex items-center gap-1.5 font-black border-b border-rose-100 pb-1 mb-1">
                                                                <Info size={13} className="shrink-0" />
                                                                <span>Acción bloqueada</span>
                                                            </div>
                                                            {message}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleSelect(order.OrdenID)}
                                                        aria-label={`Seleccionar ${order.CodigoOrden}`}
                                                        className="w-4 h-4 cursor-pointer accent-brand-cyan align-middle"
                                                    />
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <div className="font-mono font-black text-zinc-800 whitespace-nowrap">{order.CodigoOrden}</div>
                                                <span className={`${BADGE} inline-block mt-1 whitespace-nowrap ${claseEstado(order, notInProd)}`}>
                                                    {order.Estado}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <span
                                                    className={`${BADGE} inline-block max-w-[160px] truncate align-middle bg-zinc-100 text-zinc-600 border-zinc-200`}
                                                    title={order.NombreRollo || order.RolloID || 'N/A'}
                                                >
                                                    {order.NombreRollo || order.RolloID || 'N/A'}
                                                </span>
                                            </td>
                                            {/* Detalle se queda con el ancho que sobra y corta los textos largos: la tabla entra en el panel */}
                                            <td className="px-3 py-2.5 w-full max-w-0 min-w-[160px]">
                                                <div className="truncate font-bold text-zinc-800" title={order.Cliente}>{order.Cliente}</div>
                                                <div className="truncate text-xs text-zinc-500" title={order.Descripcion || order.Material}>{order.Descripcion || order.Material}</div>
                                                <div className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">Mag: {order.Magnitud || '-'}</div>
                                            </td>
                                            <td className="px-3 py-2.5 text-right">
                                                {order.ImporteCotizacion != null ? (
                                                    <div className="flex flex-col items-end gap-1">
                                                        <span className="font-bold text-zinc-800 tabular-nums whitespace-nowrap">
                                                            {formatoImporte(order.ImporteCotizacion)}
                                                        </span>
                                                        {order.MonedaCotizacion && (
                                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20">{order.MonedaCotizacion}</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-zinc-300 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5 text-center">
                                                {hasLabels ?
                                                    <span className={`${BADGE} bg-emerald-50 text-emerald-700 border-emerald-200 tabular-nums`}>{order.CantidadEtiquetas}</span>
                                                    : <span className="text-zinc-300">-</span>
                                                }
                                            </td>
                                            <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex justify-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => openManualConfig(order)}
                                                        disabled={isBlocked}
                                                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors enabled:hover:text-brand-cyan enabled:hover:border-brand-cyan/30 enabled:hover:bg-brand-cyan/5 disabled:text-zinc-300 disabled:cursor-not-allowed"
                                                        title={isBlocked ? "Bloqueado por validación" : "Configuración Manual"}
                                                        aria-label={isBlocked ? "Bloqueado por validación" : "Configuración Manual"}
                                                    >
                                                        <Settings2 size={15} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {hayMasFilas && (
                                    <tr ref={setCentinela}>
                                        <td colSpan={7} className="px-4 py-3 text-center text-xs text-zinc-400">{avisoFaltan}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    // Celular: una tarjeta por orden (antes la misma tabla de 7 columnas)
                    <div className="p-3 grid grid-cols-1 gap-3">
                        {filasDibujadas.map(order => {
                            const isSelected = selection.includes(order.OrdenID);
                            const hasLabels = order.CantidadEtiquetas > 0;
                            const { isBlocked, message, notInProd } = isOrderBlocked(order);

                            return (
                                <div
                                    key={order.OrdenID}
                                    onClick={() => {
                                        if (isBlocked) return;
                                        toggleSelect(order.OrdenID);
                                    }}
                                    className={`rounded-2xl border p-4 flex flex-col gap-3 transition-colors ${
                                        isBlocked ? 'bg-zinc-50 border-zinc-200 cursor-not-allowed'
                                            : isSelected ? 'border-brand-cyan bg-brand-cyan/5 cursor-pointer'
                                                : 'bg-white border-zinc-200 hover:border-zinc-300 cursor-pointer'}`}
                                >
                                    {/* Selección, código y estado */}
                                    <div className="flex items-start gap-2.5">
                                        <div className="shrink-0 flex h-5 items-center" onClick={(e) => e.stopPropagation()}>
                                            {isBlocked ? iconoBloqueo(notInProd) : (
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelect(order.OrdenID)}
                                                    aria-label={`Seleccionar ${order.CodigoOrden}`}
                                                    className="w-4 h-4 cursor-pointer accent-brand-cyan"
                                                />
                                            )}
                                        </div>
                                        <span className="flex-1 min-w-0 font-mono text-sm font-black text-zinc-800 leading-5 break-words">{order.CodigoOrden}</span>
                                        <span className={`${BADGE} shrink-0 whitespace-nowrap ${claseEstado(order, notInProd)}`}>{order.Estado}</span>
                                    </div>

                                    {/* Cliente y descripción */}
                                    <div className="min-w-0">
                                        <p className="font-bold text-zinc-800 truncate" title={order.Cliente}>{order.Cliente || '-'}</p>
                                        <p className="text-sm text-zinc-500 truncate" title={order.Descripcion || order.Material}>{order.Descripcion || order.Material || '-'}</p>
                                    </div>

                                    {/* Datos */}
                                    <dl className="grid grid-cols-3 gap-x-3 rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5 text-xs">
                                        <div className="min-w-0">
                                            <dt className={ROTULO}>Rollo</dt>
                                            <dd className="font-bold text-zinc-700 truncate" title={order.NombreRollo || order.RolloID || 'N/A'}>{order.NombreRollo || order.RolloID || 'N/A'}</dd>
                                        </div>
                                        <div className="min-w-0">
                                            <dt className={ROTULO}>Magnitud</dt>
                                            <dd className="font-bold text-zinc-700 truncate tabular-nums">{order.Magnitud || '-'}</dd>
                                        </div>
                                        <div className="min-w-0 text-right">
                                            <dt className={ROTULO}>Bultos</dt>
                                            <dd>
                                                {hasLabels
                                                    ? <span className="font-black text-emerald-700 tabular-nums">{order.CantidadEtiquetas}</span>
                                                    : <span className="text-zinc-300">-</span>}
                                            </dd>
                                        </div>
                                    </dl>

                                    {/* Por qué está bloqueada (en escritorio es el globo al pasar el mouse) */}
                                    {isBlocked && (
                                        <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
                                            <Info size={14} className="shrink-0 mt-px" />
                                            <span className="min-w-0 break-words"><span className="font-black">Acción bloqueada:</span> {message}</span>
                                        </div>
                                    )}

                                    {/* Pie: importe y configuración manual */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0 flex items-center gap-1.5">
                                            {order.ImporteCotizacion != null ? (
                                                <>
                                                    <span className="font-bold text-zinc-800 text-sm tabular-nums">{formatoImporte(order.ImporteCotizacion)}</span>
                                                    {order.MonedaCotizacion && (
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20">{order.MonedaCotizacion}</span>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="text-xs text-zinc-400">Sin importe</span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); openManualConfig(order); }}
                                            disabled={isBlocked}
                                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 enabled:hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            title={isBlocked ? "Bloqueado por validación" : "Configuración Manual"}
                                        >
                                            <Settings2 size={13} className="text-brand-cyan" /> Configurar
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {hayMasFilas && (
                            <div ref={setCentinela} className="py-3 text-center text-xs text-zinc-400">{avisoFaltan}</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    const panelVistaPrevia = (
        // Right Panel: Preview
        <div className={`${CARD} flex flex-col min-w-0 overflow-hidden ${dosPaneles ? 'flex-[2_2_0%] min-h-0' : 'h-[75vh] min-h-[460px] shrink-0'}`}>
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-3 shrink-0">
                <span className="flex items-center gap-2 min-w-0 text-sm font-black text-zinc-800">
                    <Eye size={18} className="shrink-0 text-brand-cyan" aria-hidden="true" /> Vista Previa Seleccionada
                </span>
                {selection.length > 0 && (
                    <span className={`${BADGE} shrink-0 bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20 tabular-nums`}>
                        {selection.length} órdenes
                    </span>
                )}
            </div>

            <div className="flex-1 overflow-hidden relative bg-zinc-50">
                {selection.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
                        <MousePointerClick size={40} className="text-zinc-200" />
                        <p className="text-sm text-zinc-400">Selecciona órdenes para ver sus etiquetas</p>
                    </div>
                ) : (
                    <iframe
                        src={previewUrl}
                        className="w-full h-full border-0 bg-white"
                        title="Label Preview"
                    />
                )}
            </div>
        </div>
    );

    return (
        <div className={`h-full bg-slate-50 font-sans text-zinc-800 p-3 md:p-6 ${dosPaneles ? 'flex gap-4 overflow-hidden' : 'flex flex-col gap-3 overflow-y-auto'}`}>
            <Toaster position="top-right" />

            {/* Sin lugar para los dos paneles: segmentado Órdenes / Vista previa */}
            {!dosPaneles && (
                <div className={`${SEGMENTADO} w-full sm:w-fit shrink-0`}>
                    <button type="button" onClick={() => setVistaMovil('lista')} className={`${segmento(vistaMovil === 'lista')} flex-1 sm:flex-none`}>
                        <List size={14} /> Órdenes
                    </button>
                    <button type="button" onClick={() => setVistaMovil('previa')} className={`${segmento(vistaMovil === 'previa')} flex-1 sm:flex-none`}>
                        <Eye size={14} /> Vista previa{selection.length > 0 ? ` (${selection.length})` : ''}
                    </button>
                </div>
            )}

            {(dosPaneles || vistaMovil === 'lista') && panelLista}
            {(dosPaneles || vistaMovil === 'previa') && panelVistaPrevia}

            {/* Configuration Modal */}
            {configOrder && (
                <div className="fixed inset-0 bg-black/40 z-[6000] flex items-stretch sm:items-center justify-center sm:p-4">
                    <div className="bg-white sm:rounded-2xl sm:border sm:border-zinc-200 shadow-xl w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden animate-fade-in-up text-zinc-800">
                        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <SlidersHorizontal size={22} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                                <h3 className="text-lg font-black text-zinc-800 truncate">Configurar Etiquetas</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfigOrder(null)}
                                className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                                title="Cerrar"
                                aria-label="Cerrar"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-6">
                            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                                <div className={ROTULO}>Orden</div>
                                <div className="text-xl font-mono font-black text-zinc-800 break-words mt-0.5">{configOrder.CodigoOrden}</div>
                                <div className="text-sm text-zinc-600">{configOrder.Cliente}</div>
                                <dl className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-zinc-200">
                                    <div className="min-w-0">
                                        <dt className={ROTULO}>Rollo</dt>
                                        <dd className="text-sm font-bold text-zinc-700 break-words">{configOrder.NombreRollo || configOrder.RolloID || 'N/A'}</dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className={ROTULO}>Magnitud Detectada</dt>
                                        <dd className="text-sm font-mono font-bold text-brand-cyan break-words">{configOrder.Magnitud || '0'}</dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className={ROTULO}>Tipo</dt>
                                        <dd className="text-sm font-bold text-zinc-700 break-words">{configOrder.Material}</dd>
                                    </div>
                                </dl>
                            </div>

                            <div>
                                <label htmlFor="lg-bultos" className="block text-sm font-black text-zinc-800 mb-2">Bultos a Generar</label>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setBultosInput(Math.max(1, bultosInput - 1))}
                                        className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition-colors"
                                        title="Un bulto menos"
                                        aria-label="Un bulto menos"
                                    ><Minus size={16} /></button>
                                    <input
                                        id="lg-bultos"
                                        type="number"
                                        min="1"
                                        value={bultosInput}
                                        onChange={(e) => setBultosInput(parseInt(e.target.value) || 1)}
                                        className="flex-1 min-w-0 h-11 text-center bg-white border border-zinc-200 rounded-xl font-black text-lg text-zinc-800 tabular-nums focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setBultosInput(bultosInput + 1)}
                                        className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition-colors"
                                        title="Un bulto más"
                                        aria-label="Un bulto más"
                                    ><Plus size={16} /></button>
                                </div>
                            </div>

                            {/* REORDENAR SERVICES */}
                            <div>
                                <label className="block text-sm font-black text-zinc-800">Próximo Punto de Producción</label>
                                <p className="text-xs text-zinc-400 mt-0.5 mb-3">Define a qué área viajará el bulto después de esta descarga.</p>

                                {pendingServices.length > 0 ? (
                                    <div className="space-y-2">
                                        {pendingServices.map(srv => {
                                            const isSelected = selectedNextService === srv.nombre;
                                            return (
                                                <button
                                                    key={srv.id}
                                                    type="button"
                                                    onClick={() => setSelectedNextService(srv.nombre)}
                                                    className={`w-full px-3.5 py-3 rounded-xl border text-left text-sm font-bold transition-colors flex items-center justify-between gap-2
                                                        ${isSelected
                                                            ? 'border-brand-cyan bg-brand-cyan/5 text-brand-cyan'
                                                            : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600'}
                                                    `}
                                                >
                                                    <span className="min-w-0 break-words">{srv.nombre}</span>
                                                    {isSelected && <CheckCircle2 size={17} className="shrink-0" />}
                                                </button>
                                            )
                                        })}
                                        <button
                                            type="button"
                                            onClick={() => setSelectedNextService('DEPOSITO')}
                                            className={`w-full px-3.5 py-3 rounded-xl border text-left text-sm font-bold transition-colors flex items-center justify-between gap-2
                                                ${selectedNextService === 'DEPOSITO'
                                                    ? 'border-zinc-800 bg-zinc-100 text-zinc-800'
                                                    : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600'}
                                            `}
                                        >
                                            <span>DEPOSITO (Finalizar)</span>
                                            {selectedNextService === 'DEPOSITO' && <CheckCircle2 size={17} className="shrink-0" />}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-xl flex items-center gap-2 font-medium">
                                        <Info size={15} className="shrink-0" />
                                        Sin servicios adicionales. El destino predeterminado es DEPOSITO.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-2 px-5 py-3 bg-zinc-50 border-t border-zinc-100 shrink-0">
                            <button
                                type="button"
                                onClick={() => setConfigOrder(null)}
                                className={`${BTN_SECUNDARIO} flex-1`}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => processGenerationBatch([configOrder.OrdenID], bultosInput)}
                                disabled={generating}
                                className={`${BTN_PRINCIPAL} flex-1`}
                            >
                                {generating ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                                Generar Etiquetas
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Crear Remito usando DispatchView nativo */}
            {showRemitoModal && (
                <div className="fixed inset-0 z-[6000] flex flex-col bg-white overflow-hidden shadow-2xl">
                    <DispatchView
                        selectedOrders={getFormattedDispatchOrders()}
                        areaFilter={areaFilter}
                        originArea={areaFilter}
                        onClose={() => setShowRemitoModal(false)}
                        onSuccess={() => {
                            // Don't auto-close the modal on success because we want them to see the generated Ticket!
                            fetchOrders();
                            setSelection([]);
                        }}
                        mode="create"
                        onActionOverride={async (payload) => {
                            // Call the advanced endpoint that handles orders directly without bultos
                            const res = await logisticsService.createRemitoFromOrders({
                                areaOrigen: areaFilter,
                                areaDestino: payload.areaDestino,
                                usuarioId: payload.usuarioId,
                                orderIds: selection,
                                observations: payload.observations
                            });

                            if (res.success) {
                                return { ...res, createdCount: res.createdCount || 0, itemCount: selection.length };
                            } else {
                                throw new Error(res.error || "Error al crear el remito desde las órdenes");
                            }
                        }}
                    />
                </div>
            )}

            {ventanaConfirmar}
        </div>
    );
};

export default LabelGenerationPage;
