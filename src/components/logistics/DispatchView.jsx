import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Search, ArrowRight, ArrowLeft, MoveRight, Truck, Loader2, Check, Minus, Printer, Boxes, CircleDot, RefreshCw, X,
    Inbox, FileText, Package, PackageOpen, CheckCircle2, XCircle, History, MapPin, ListChecks, Clock,
} from 'lucide-react';
import { logisticsService, authService } from '../../services/api';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import QRCode from "react-qr-code";
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import Selector from '../ui/Selector';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, tarjetas blancas con borde, íconos de
// Lucide en brand-cyan sin fondo, selects con el Selector propio; el color queda para los estados. El HTML del
// remito que se imprime (#print-detail y #printable-area) quedó como estaba.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';

// En el celular, tarjetas en vez de tablas anchas (una vista sola: no se dibujan las dos ocultando una)
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

// Listas de a 50 (patrón useDeAPoco de Reportes): al acercarse al final se agregan 50 más; vuelve a 50 cuando
// cambia la lista. El margen de 600 px se mide contra el contenedor que scrollea de verdad.
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

const MOTIVOS_PENDIENTE = {
    FALLA_EN_PROCESO: 'Queda una falla en proceso (reposición)',
    RESTO_EN_PRODUCCION: 'El resto sigue en producción',
};

/**
 * Spec 39 — bloque "Envío por orden": dice si el envío es parcial y por qué, deja declarar la
 * cantidad solo cuando se conoce (obligatoria donde se cuentan prendas o unidades) y no permite
 * marcar la orden como completa mientras tenga una reposición abierta.
 */
const EnvioPorOrden = ({ orden, info, linea, restantes, onChange }) => {
    if (!info || !linea) return null;
    const abiertas = info.reposicionesAbiertas || [];
    // Spec 39 (extensión "aprobar por tandas"): si la orden madre todavía tiene menos
    // aprobado en Control que su magnitud total, sigue produciéndose — este bulto es una
    // tanda, no puede completarla aunque no tenga ninguna reposición abierta.
    const puedeCompletar = abiertas.length === 0 && !info.siguEnProduccion;
    const um = info.um || '';
    const set = (patch) => onChange({ ...linea, ...patch });
    return (
        <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs">
            <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-2">Envío por orden · {info.codigoMadre}</div>
            {info.esComplemento && (
                <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-brand-cyan/5 border border-brand-cyan/20 text-brand-cyan font-bold">
                    Complemento: este bulto es la reposición {info.codigo} de la orden {info.codigoMadre}.
                </div>
            )}
            {abiertas.length > 0 && (
                <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">
                    <div className="font-bold">Queda en proceso:</div>
                    {abiertas.map((r, i) => <div key={i}>{r.codigo || 'reposición sin orden'} · {r.descripcion}</div>)}
                </div>
            )}
            {abiertas.length === 0 && info.siguEnProduccion && (
                <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-bold">
                    Esto es una tanda: se aprobaron {info.aprobadoBultos} de {info.magnitudMadre} en Control. El resto de {info.codigoMadre} sigue en producción.
                </div>
            )}
            <label className={`flex items-start gap-2 py-1 ${puedeCompletar ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
                <input type="radio" className="mt-0.5 accent-brand-cyan" checked={!!linea.completaOrden} disabled={!puedeCompletar} onChange={() => set({ completaOrden: true })} />
                <span>
                    <span className="font-bold text-zinc-700">Este envío completa la orden {info.codigoMadre}</span>
                    {restantes > 0 && (
                        <span className="block text-amber-700 font-bold">Ojo: quedan {restantes} bultos de esta orden en el área sin seleccionar.</span>
                    )}
                    {!puedeCompletar && abiertas.length > 0 && <span className="block text-amber-700 font-bold">No se puede marcar como completa: hay una reposición abierta.</span>}
                    {!puedeCompletar && abiertas.length === 0 && info.siguEnProduccion && (
                        <span className="block text-amber-700 font-bold">No se puede marcar como completa: en Control se aprobaron {info.aprobadoBultos} de {info.magnitudMadre} — el resto todavía se está produciendo.</span>
                    )}
                </span>
            </label>
            {/* Si ya está todo listo para completar (nada abierto, nada en producción) y no
                queda ningún otro bulto de esta orden en el área para un envío posterior,
                "parcial" no tiene sentido — se deshabilita para no dejarla incompleta sin
                motivo. Cuando SÍ quedan bultos sin seleccionar, sigue siendo una opción válida
                (mandar en varias tandas aunque la producción ya haya terminado). */}
            {(() => {
                const parcialInnecesario = puedeCompletar && restantes === 0;
                return (
                    <label className={`flex items-start gap-2 py-1 ${parcialInnecesario ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input type="radio" className="mt-0.5 accent-brand-cyan" checked={!linea.completaOrden} disabled={parcialInnecesario} onChange={() => set({ completaOrden: false })} />
                        <span>
                            <span className="font-bold text-zinc-700">Envío parcial</span>
                            <span className="block text-zinc-500">{info.codigoMadre} sigue en el área hasta el envío que la complete.</span>
                            {parcialInnecesario && (
                                <span className="block text-amber-700 font-bold">No hace falta: {info.codigoMadre} ya está lista y este es el último bulto — se manda completa.</span>
                            )}
                        </span>
                    </label>
                );
            })()}
            {!linea.completaOrden && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                    <div>
                        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">Motivo del pendiente</div>
                        <Selector className="w-full" aria-label="Motivo del pendiente" value={linea.motivoPendiente || ''} onChange={e => set({ motivoPendiente: e.target.value })}>
                            {Object.entries(MOTIVOS_PENDIENTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Selector>
                    </div>
                    <div>
                        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">
                            Cantidad de este envío {info.cuentaUnidades ? '· obligatoria' : '· opcional, solo si la conocés'}{um ? ` (${um})` : ''}
                        </div>
                        <input type="number" min="0" step="0.01" className="w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-mono font-bold text-zinc-800 placeholder:font-sans placeholder:font-normal placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" placeholder={info.cuentaUnidades ? `p. ej. 40 de ${info.cantidadEsperada ?? '?'}` : 'dejar vacío si no se sabe'} value={linea.cantidad ?? ''} onChange={e => set({ cantidad: e.target.value })} />
                        {info.cuentaUnidades && info.cantidadEsperada != null && (
                            <div className="text-[10px] text-zinc-500 mt-1">Esperado {info.cantidadEsperada} {um}{info.cantidadEnviada != null ? ` · ya salieron ${info.cantidadEnviada}` : ''}.</div>
                        )}
                        {info.cantidadSugerida != null && (
                            <div className="text-[10px] text-emerald-700 font-bold mt-1">Precargado con lo aprobado en Control ({info.aprobadoBultos}) menos lo ya enviado. Corregilo si no coincide con lo que realmente sale.</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const DispatchView = ({ selectedOrders: initialOrders = [], areaFilter, originArea, onClose, onSuccess, mode: viewMode = 'create', onActionOverride, selectedStockItems: extSelectedStockItems, setSelectedStockItems: extSetSelectedStockItems }) => {
    const { user } = useAuth();
    const currentArea = areaFilter || originArea || user?.areaKey || user?.areaId;

    // Creation Steps: 0 = Select Stock, 1 = Quick Confirm/Sign, 2 = Success (Label)
    const [step, setStep] = useState(() => {
        if (initialOrders.length > 0) {
            const hasLogistica = initialOrders.some(o => o.destino === 'LOGISTICA' || !o.destino);
            return hasLogistica ? 1 : 2; // Saltar directo a la firma si no hay destinos ambiguos
        }
        return 0;
    });

    // History Selection (Only used if viewMode === 'history')
    const [selectedHistoryCode, setSelectedHistoryCode] = useState(null);
    const conTabla = useConTabla();
    const [historyDetail, setHistoryDetail] = useState(null);

    // History Search
    const [historySearchQuery, setHistorySearchQuery] = useState('');
    const [historySearchResults, setHistorySearchResults] = useState(null);

    // --- FETCH HISTORY ---
    const { data: outgoingRemitos, isLoading: loadingHistory, refetch: refetchHistory } = useQuery({
        queryKey: ['remitos', 'outgoing', currentArea],
        queryFn: () => logisticsService.getOutgoingRemitos(currentArea),
        enabled: !!currentArea
    });

    // --- CREATION STATE ---
    // Selección: si el padre la controla (para que persista entre tabs) usamos esa; si no, estado interno.
    const [internalSelectedStockItems, setInternalSelectedStockItems] = useState([]); // Flat list of BultoIDs or Items
    const selectedStockItems = extSelectedStockItems ?? internalSelectedStockItems;
    const setSelectedStockItems = extSetSelectedStockItems ?? setInternalSelectedStockItems;
    const [stockSearch, setStockSearch] = useState('');
    const [destinoFilter, setDestinoFilter] = useState('TODOS'); // Filtro por área destino (ProximoServicio)
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState([]);
    const [logs, setLogs] = useState([]);
    const [credentials, setCredentials] = useState({ username: '', password: '' });
    const [targetDestinations, setTargetDestinations] = useState({});

    // --- Spec 39: envío parcial / libro de entregas ---
    const { data: libroConfig } = useQuery({ queryKey: ['libro-config'], queryFn: () => logisticsService.getLibroConfig(), staleTime: 60000 });
    const areaPermiteParcial = !!libroConfig?.areasParcial?.includes(String(currentArea || '').trim().toUpperCase());
    const destPermiteParcial = (dest) => areaPermiteParcial && String(dest || '').trim().toUpperCase() !== 'DEPOSITO';
    const [envioInfo, setEnvioInfo] = useState({}); // ordenId -> info del libro (madre, reposiciones abiertas, unidades)
    const [lineas, setLineas] = useState({});       // madreId -> { completaOrden, cantidad, motivoPendiente }

    // --- QUERY STOCK (Step 0) ---
    const { data: areaStock, isLoading: loadingStock, refetch: refetchStock } = useQuery({
        queryKey: ['stock', currentArea],
        queryFn: () => logisticsService.getAreaStock(currentArea),
        enabled: viewMode === 'create' && step === 0 && !!currentArea && currentArea !== 'TODOS'
    });

    useEffect(() => {
        if (areaStock && areaStock.length > 0) {
            console.log("DEBUG FRONT STOCK ROW 0 KEYS:", Object.keys(areaStock[0]));
            console.log("DEBUG FRONT STOCK ROW 0 DATA:", areaStock[0]);
        }
    }, [areaStock]);

    // Al cargar el stock (p.ej. al volver a Logística), descartar de la selección los bultos que
    // ya no están en stock (despachados por otra vía), para que el contador no quede desfasado.
    useEffect(() => {
        if (!areaStock) return; // aún no cargó: no tocar la selección
        const stockIds = new Set(areaStock.map(item => item.BultoID));
        setSelectedStockItems(prev => {
            const filtered = prev.filter(s => stockIds.has(s.BultoID));
            return filtered.length === prev.length ? prev : filtered;
        });
    }, [areaStock]);

    // --- FLATTENED STOCK VIEW (Vista por Bultos) ---
    const stockRows = useMemo(() => {
        if (!areaStock) return [];

        // Prepare rows with calculated BaseCode for smart selection
        const rows = areaStock.map(item => {
            let baseCode = item.CodigoEtiqueta;
            // Regex to find Base Code (PRE-33 from PRE-33-1)
            const match = baseCode && baseCode.match(/^(PRE-\d+)(-\d+)?$/);
            if (match) baseCode = match[1];
            // Producto terminado: agrupar por PEDIDO + ÁREA (NoDocERP + ubicación) → al marcar uno se
            // seleccionan las órdenes hermanas de ESA área, para que el pedido salga completo del área.
            // Importante: NO agrupar solo por NoDocERP, porque un pedido tiene órdenes en varias áreas.
            else if (item.NoDocERP && item.Tipocontenido === 'PROD_TERMINADO') baseCode = `PED-${String(item.NoDocERP).trim()}-${String(item.UbicacionActual || item.AreaID || '').trim()}`;
            else if (item.OrdenID) baseCode = `ORD-${item.OrdenID}`;

            return {
                ...item,
                rowId: item.BultoID,
                baseCode: baseCode, // Used for auto-selecting siblings
                // Data mapping using the robust fields from backend
                displayCode: item.CodigoEtiqueta,
                orderCode: item.CodigoOrden,
                client: item.Cliente || '-',
                desc: item.DescripcionTrabajo || item.Descripcion,
                // Fallback date check (Reception -> Order -> Creation)
                date: item.FechaIngreso || item.FechaRecepcion || item.FechaCreacion,
                nextService: item.ProximoServicio
            };
        });

        // Ordenar por pedido → orden → bulto, para que las hermanas queden agrupadas visualmente
        rows.sort((a, b) => {
            const pa = String(a.NoDocERP || ''), pb = String(b.NoDocERP || '');
            if (pa !== pb) return pa.localeCompare(pb, undefined, { numeric: true });
            const oa = String(a.orderCode || ''), ob = String(b.orderCode || '');
            if (oa !== ob) return oa.localeCompare(ob, undefined, { numeric: true });
            return (a.BultoID || 0) - (b.BultoID || 0);
        });

        let filtered = rows;

        // Filtro por área destino (ProximoServicio; sin destino = LOGISTICA)
        if (destinoFilter && destinoFilter !== 'TODOS') {
            filtered = filtered.filter(r => (r.nextService || 'LOGISTICA') === destinoFilter);
        }

        if (!stockSearch) return filtered;

        const lowerSearch = stockSearch.toLowerCase();
        return filtered.filter(r =>
            r.displayCode.toLowerCase().includes(lowerSearch) ||
            (r.client && r.client.toLowerCase().includes(lowerSearch)) ||
            (r.desc && r.desc.toLowerCase().includes(lowerSearch))
        );
    }, [areaStock, stockSearch, destinoFilter]);

    // Opciones del filtro: destinos distintos presentes en el stock actual
    const destinoOptions = useMemo(() => {
        if (!areaStock) return [];
        const set = new Set(areaStock.map(item => item.ProximoServicio || 'LOGISTICA'));
        return [...set].sort();
    }, [areaStock]);

    // --- TRANSFORM SELECTION ---
    const selectedOrders = useMemo(() => {
        if (initialOrders.length > 0) return initialOrders;

        // Group selected items back into Order structure for logic
        const grouped = {};

        // selectedStockItems contains the raw Stock Items (bultos)
        selectedStockItems.forEach(item => {
            // We need to keep consistency with the Grouping View Logic
            // But for the Remito creation payload, we might want to respect the OrderID if available
            // OR just group by Destination.

            const orderKey = item.OrdenID || `BULK-${item.BultoID}`;
            if (!grouped[orderKey]) {
                grouped[orderKey] = {
                    id: item.OrdenID,
                    code: item.CodigoOrden || item.CodigoEtiqueta,
                    desc: item.DescripcionTrabajo || item.Descripcion,
                    destino: item.ProximoServicio && item.ProximoServicio !== 'LOGISTICA' ? item.ProximoServicio : 'LOGISTICA',
                    bultos: []
                };
            }

            // FIX: If group has generic destination but current item has specific one, upgrade it!
            if (grouped[orderKey].destino === 'LOGISTICA' && item.ProximoServicio && item.ProximoServicio !== 'LOGISTICA') {
                grouped[orderKey].destino = item.ProximoServicio;
            }

            grouped[orderKey].bultos.push({
                id: item.BultoID,
                code: item.CodigoEtiqueta,
                desc: item.Descripcion
            });
        });
        return Object.values(grouped);
    }, [initialOrders, selectedStockItems]);

    // Dispatch Groups (by Destination)
    const dispatchGroups = useMemo(() => {
        const groups = {};
        if (!Array.isArray(selectedOrders)) return groups;
        selectedOrders.forEach(o => {
            const dest = o.destino || 'LOGISTICA';
            if (!groups[dest]) groups[dest] = [];
            groups[dest].push(o);
        });
        return groups;
    }, [selectedOrders]);

    // Spec 39: al pasar a revisión/confirmación, traer el libro de cada orden seleccionada y
    // proponer la línea por orden (completa si no quedan bultos ni reposiciones abiertas).
    useEffect(() => {
        if (!(step === 1 || step === 2) || !areaPermiteParcial) return;
        const ids = [...new Set(selectedOrders.map(o => o.id).filter(Boolean))];
        if (!ids.length) { setEnvioInfo({}); return; }
        let cancel = false;
        logisticsService.getEnvioInfo(ids, currentArea, null).then(res => {
            if (cancel) return;
            const map = {};
            (res?.ordenes || []).forEach(x => { map[x.ordenId] = x; });
            setEnvioInfo(map);
            setLineas(prev => {
                const next = { ...prev };
                (res?.ordenes || []).forEach(x => {
                    if (next[x.madreId]) return;
                    const restantes = (stockRows || []).filter(r => r.OrdenID === x.ordenId && !selectedStockItems.some(s => s.BultoID === r.BultoID)).length;
                    // Spec 39 (extensión "aprobar por tandas"): si hay una cantidad sugerida
                    // (lo aprobado en Control menos lo ya declarado en remitos anteriores), la
                    // precarga — el operario la ve y la puede corregir, no arranca en blanco.
                    next[x.madreId] = {
                        completaOrden: x.puedeCompletar && restantes === 0,
                        cantidad: x.cantidadSugerida != null ? String(x.cantidadSugerida) : '',
                        motivoPendiente: (x.reposicionesAbiertas || []).length ? 'FALLA_EN_PROCESO' : 'RESTO_EN_PRODUCCION',
                    };
                });
                return next;
            });
        }).catch(e => console.warn('[DispatchView] envio-info', e?.message || e));
        return () => { cancel = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, selectedOrders, areaPermiteParcial, currentArea]);

    // Bultos de la orden que quedan en el área sin seleccionar (para el aviso del bloque)
    // Crear remito: los bultos se dibujan de a 50; «marcar todas» sigue tomando la lista entera
    const [verStock, centinelaStock] = useDeAPoco(stockRows);
    const todasStockMarcadas = stockRows.length > 0 && stockRows.every(r => selectedStockItems.some(s => s.BultoID === r.BultoID));
    const algunaStockMarcada = stockRows.length > 0 && stockRows.some(r => selectedStockItems.some(s => s.BultoID === r.BultoID));
    const alternarTodoElStock = () => {
        if (todasStockMarcadas) {
            setSelectedStockItems([]);
        } else {
            const newItems = stockRows.filter(r => !selectedStockItems.some(s => s.BultoID === r.BultoID));
            setSelectedStockItems(prev => [...prev, ...newItems]);
        }
    };
    const casillaTodas = (
        <div
            onClick={alternarTodoElStock}
            className={`w-5 h-5 rounded border flex items-center justify-center transition-all cursor-pointer mx-auto ${
                todasStockMarcadas
                    ? 'bg-brand-cyan border-brand-cyan text-white'
                    : algunaStockMarcada
                        ? 'bg-white border-brand-cyan text-brand-cyan'
                        : 'bg-white border-zinc-300'}`}
        >
            {todasStockMarcadas
                ? <Check size={12} strokeWidth={3} />
                : algunaStockMarcada
                    ? <Minus size={12} strokeWidth={3} />
                    : null
            }
        </div>
    );

    const restantesDe = (ordenId) => (stockRows || []).filter(r => r.OrdenID === ordenId && !selectedStockItems.some(s => s.BultoID === r.BultoID)).length;

    // Líneas por orden a mandar para un grupo de órdenes (una por orden madre)
    const lineasPara = (orders) => {
        const out = []; const madres = new Set();
        orders.forEach(o => {
            const info = envioInfo[o.id];
            if (!info || madres.has(info.madreId)) return;
            madres.add(info.madreId);
            const l = lineas[info.madreId];
            if (!l) return;
            out.push({ ordenId: info.madreId, completaOrden: !!l.completaOrden, cantidad: l.cantidad === '' || l.cantidad == null ? null : Number(l.cantidad), motivoPendiente: l.completaOrden ? null : l.motivoPendiente, info });
        });
        return out;
    };

    // Texto exacto de lo que va a pasar (claridad máxima)
    const resumenEnvio = useMemo(() => {
        if (!areaPermiteParcial) return [];
        const frases = [];
        Object.keys(dispatchGroups).forEach(key => {
            const dest = targetDestinations[key] || key;
            if (!destPermiteParcial(dest)) return;
            lineasPara(dispatchGroups[key]).forEach(l => {
                const bultos = dispatchGroups[key].filter(o => envioInfo[o.id]?.madreId === l.info.madreId).reduce((s, o) => s + (o.bultos?.length || 0), 0);
                if (l.completaOrden) frases.push(`Este envío completa ${l.info.codigoMadre}: ${bultos} bultos a ${dest}. La orden pasa a En tránsito.`);
                else frases.push(`Vas a mandar ${bultos} bultos de ${l.info.codigoMadre} a ${dest} como envío parcial${l.cantidad != null ? ` (${l.cantidad} ${l.info.um})` : ''}. ${l.info.reposicionesAbiertas?.length ? 'Queda en proceso: ' + l.info.reposicionesAbiertas.map(r => `${r.codigo || 'reposición'} (${r.descripcion})`).join(', ') + '.' : MOTIVOS_PENDIENTE[l.motivoPendiente] + '.'} ${l.info.codigoMadre} no pasa a En tránsito hasta el envío que la complete.`);
            });
        });
        return frases;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dispatchGroups, targetDestinations, envioInfo, lineas, areaPermiteParcial]);


    // --- SMART SELECTION (Scan Logic) ---
    const toggleRow = async (row) => {
        // 1. Hermanos = mismo baseCode (para producto terminado, TODO el pedido / NoDocERP)
        const siblings = stockRows.filter(r => r.baseCode === row.baseCode);
        const siblingIds = siblings.map(r => r.BultoID);

        // 2. Si ya están todos seleccionados → deseleccionar el grupo (sin modal)
        const allSelected = siblingIds.every(id => selectedStockItems.some(s => s.BultoID === id));
        if (allSelected) {
            setSelectedStockItems(prev => prev.filter(s => !siblingIds.includes(s.BultoID)));
            return;
        }

        // 3. Va a seleccionar. Si es un pedido con varios bultos, avisar cuántas órdenes/bultos lleva.
        if (row.NoDocERP && siblings.length > 1) {
            const ordenes = new Set(siblings.map(s => s.OrdenID || s.CodigoOrden)).size;
            const bultos = siblings.length;
            const resp = await Swal.fire({
                icon: 'info',
                title: `Pedido ${row.NoDocERP}`,
                html: `En esta área, el pedido lleva <strong>${ordenes} ${ordenes === 1 ? 'orden' : 'órdenes'}</strong> con <strong>${bultos} ${bultos === 1 ? 'bulto' : 'bultos'}</strong>.<br><br>Se agregan <strong>todos</strong> al remito para que el pedido salga completo del área.`,
                showCancelButton: true,
                confirmButtonText: 'Agregar el pedido completo',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#006E97',
                cancelButtonColor: '#6b7280',
                reverseButtons: true,
            });
            if (!resp.isConfirmed) return;
        }

        // 4. Seleccionar todo el grupo
        const newItems = siblings.filter(s => !selectedStockItems.some(existing => existing.BultoID === s.BultoID));
        setSelectedStockItems(prev => [...prev, ...newItems]);
    };

    // SCANNER LISTENER (Simple version: detects Enter on search or global)
    const handleKeyDown = (e) => {
        // If Enter is pressed and we have text in search, treat as SCAN
        if (e.key === 'Enter' && stockSearch) {
            const exactMatch = stockRows.find(r => r.displayCode.toUpperCase() === stockSearch.toUpperCase().trim());
            if (exactMatch) {
                toggleRow(exactMatch);
                setStockSearch(''); // Clear after scan
                toast.success(`Escaneado: ${exactMatch.displayCode}`);
            }
        }
    };

    const totalSelectedRows = selectedStockItems.length;
    const totalBultos = selectedStockItems.length; // FIX: Define totalBultos for render logic

    // --- ACTIONS ---
    // startNewDispatch removed as mode is controlled by parent prop

    const handleSelectHistory = async (code) => {
        // Mode is already history
        setSelectedHistoryCode(code);
        setLoading(true);
        try {
            const data = await logisticsService.getRemitoByCode(code);
            setHistoryDetail(data);
        } catch (err) {
            toast.error("Error cargando remito");
        } finally {
            setLoading(false);
        }
    };

    const handleSearchHistory = async (e) => {
        if (e) e.preventDefault();
        if (!historySearchQuery.trim()) {
            setHistorySearchResults(null);
            return;
        }
        console.log('[BUSQUEDA] Iniciando búsqueda:', historySearchQuery.trim());
        setLoading(true);
        try {
            const res = await api.get('/logistics/remitos/search', { params: { query: historySearchQuery.trim() } }).then(r => r.data);
            console.log('[BUSQUEDA] Resultado:', res);
            setHistorySearchResults(res);
            if (res.length === 1) {
                handleSelectHistory(res[0].CodigoRemito);
            }
        } catch (err) {
            console.error('[BUSQUEDA] Error completo:', err);
            console.error('[BUSQUEDA] Response data:', err?.response?.data);
            console.error('[BUSQUEDA] Status:', err?.response?.status);
            toast.error(`Error en la búsqueda: ${err?.response?.data?.error || err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateBatch = async (e) => {
        if (e) e.preventDefault();
        setLoading(true);
        setLogs([]);
        const createdParams = [];

        try {
            // Auth: Use current session user directly for speed
            const authUser = user;
            if (!authUser || !authUser.id) {
                toast.error("No hay sesión de usuario activa.");
                setLoading(false);
                return;
            }
            setLogs(prev => [...prev, `✅ Usuario validado: ${authUser.username}`]);

            // Create
            const destinations = Object.keys(dispatchGroups);
            for (const groupKey of destinations) {
                const finalDest = targetDestinations[groupKey] || groupKey;
                const orders = dispatchGroups[groupKey];
                const bultosIds = [];
                const newBultos = [];

                orders.forEach(o => {
                    if (o.bultos) {
                        o.bultos.forEach(b => {
                            if (b.id) bultosIds.push(b.id);
                            else newBultos.push({ ordenId: o.id, descripcion: o.desc });
                        });
                    }
                });

                if (bultosIds.length === 0 && newBultos.length === 0) continue;

                // Spec 39: líneas por orden (solo si el área tiene envío parcial y el destino no es Depósito)
                let lineasOrden = [];
                if (destPermiteParcial(finalDest)) {
                    const ls = lineasPara(orders);
                    const faltaCantidad = ls.find(l => !l.completaOrden && l.info.cuentaUnidades && l.cantidad == null);
                    if (faltaCantidad) {
                        toast.error(`${faltaCantidad.info.codigoMadre}: en ${currentArea} la cantidad del envío parcial es obligatoria (se cuentan ${faltaCantidad.info.um || 'unidades'}).`);
                        setLoading(false);
                        return;
                    }
                    lineasOrden = ls.map(({ info, ...l }) => l);
                }

                const payload = {
                    codigoRemito: 'AUTO',
                    areaOrigen: currentArea || 'PRODUCCION',
                    areaDestino: finalDest,
                    usuarioId: authUser.id,
                    transportista: authUser.username,
                    bultosIds, newBultos,
                    lineasOrden,
                    observations: `Generado por ${authUser.username || authUser.nombre || 'Sistema'}`
                };

                let res;
                if (onActionOverride) {
                    res = await onActionOverride(payload);
                } else {
                    res = await logisticsService.createDispatch(payload);
                }

                // ECOUV → TERMINAC: el backend recibe el remito en el momento (sin Check-in).
                if (res?.recepcionAutomatica?.ok) {
                    toast.success(`${res.dispatchCode} recibido automáticamente en ${finalDest}: ya está en su bandeja.`);
                } else if (res?.recepcionAutomatica) {
                    toast.warning(`${res.dispatchCode} se creó pero no se pudo recibir solo en ${finalDest} (${res.recepcionAutomatica.error}). Hacé el Check-in a mano.`, { duration: 10000 });
                }

                createdParams.push({ ...res, destArea: finalDest, itemCount: res.createdCount || bultosIds.length + newBultos.length });
            }

            setResults(createdParams);
            setStep(3);
            if (onSuccess) onSuccess();
            refetchStock();
            refetchHistory();
            setCredentials({ username: '', password: '' });
            setSelectedStockItems([]); // limpiar selección tras generar el remito (también la elevada al padre)

        } catch (error) {
            // El backend manda el motivo real (ej. candado de "pedido debe salir completo
            // del área") en response.data.error — sin esto se veía el genérico de axios
            // ("Request failed with status code 400"), que no dice qué falta ni por qué.
            const detalle = error.response?.data?.error || error.message;
            toast.error("Error: " + detalle);
            setLogs(prev => [...prev, `❌ Error: ${detalle}`]);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
        const printContent = document.getElementById('print-detail') || document.getElementById('printable-area');
        if (!printContent) {
            window.print();
            return;
        }
        const win = window.open('', '_blank', 'width=800,height=900');
        if (win) {
            win.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Imprimir Remito</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                    <style>
                        @page { margin: 10mm; }
                        body { background: white; color: black; font-family: sans-serif; }
                        #print-detail, #printable-area { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; }
                    </style>
                </head>
                <body>
                    <div style="padding: 20px;">
                        ${printContent.outerHTML}
                    </div>
                    <script>
                        setTimeout(() => { window.print(); window.close(); }, 800);
                    </script>
                </body>
                </html>
            `);
            win.document.close();
        } else {
            window.print();
        }
    };

    const handleDirectSubmit = () => {
        const destinations = Object.keys(dispatchGroups);
        if (destinations.length === 0) return;

        // Si tenemos órdenes con destino 'LOGISTICA', pasamos al Paso 1 para obligar a elegir destino.
        // Si ya están todas mapeadas (ej. DEPOSITO), saltamos la pantalla de Review directamente a Firmar (Paso 2).
        // Spec 39: si el área tiene envío parcial y algún destino no es Depósito, siempre pasa por la
        // revisión, para declarar por orden si el envío es parcial o completa la orden.
        if (destinations.includes('LOGISTICA') || destinations.some(d => destPermiteParcial(d))) {
            setStep(1);
        } else {
            setStep(2);
        }
    };

    // --- RENDERERS ---

    const renderHistoryDetail = () => {
        if (loading) return (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 size={30} className="animate-spin text-brand-cyan" />
                <p className="text-sm text-zinc-400">Cargando detalle...</p>
            </div>
        );
        if (!historyDetail) return (
            <div className="flex flex-col items-center justify-center py-16 gap-2 px-4 text-center">
                <FileText size={40} className="text-zinc-200" />
                <p className="text-sm text-zinc-400">Seleccione un remito para ver detalles</p>
            </div>
        );

        // Bulto que coincide con lo buscado en el historial (se resalta en ámbar)
        const coincideBusqueda = (item) => {
            const q = historySearchQuery.trim().toLowerCase();
            return q && (
                String(item.OrdenID || '').includes(q) ||
                String(item.CodigoOrden || '').toLowerCase().includes(q) ||
                String(item.NoDocERP || '').toLowerCase().includes(q) ||
                (item.CodigoEtiqueta || '').toLowerCase().includes(q) ||
                (item.Cliente || '').toLowerCase().includes(q)
            );
        };
        const claseEstadoBulto = (estado) => (estado === 'EN_TRANSITO' ? 'bg-amber-50 text-amber-700 border-amber-200'
            : estado === 'ENTREGADO' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-600 border-zinc-200');

        const res = {
            dispatchCode: historyDetail.CodigoRemito,
            destArea: historyDetail.AreaDestinoID,
            transportista: historyDetail.UsuarioEmisor,
            itemCount: historyDetail.items?.length || 0,
            date: new Date(historyDetail.FechaSalida).toLocaleString()
        };

        return (
            <div className="flex flex-col gap-3 w-full p-3 md:p-6 print:bg-white print:p-0 h-auto">
                <style>{`
                    @media print {
                        body > *:not(#print-detail) { display: none !important; }
                        #print-detail {
                            position: fixed !important;
                            inset: 0;
                            z-index: 2147483647;
                            background: white;
                            overflow: visible;
                            padding: 20px;
                            display: block !important;
                            visibility: visible !important;
                        }
                        #print-detail * { visibility: visible !important; }
                    }
                `}</style>

                <div className={`${CARD} p-4 flex flex-wrap justify-between items-center gap-3 print:hidden`}>
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-zinc-800 font-mono flex items-center gap-2 break-all">
                            <FileText size={20} className="shrink-0 text-brand-cyan" />
                            {historyDetail.CodigoRemito}
                        </h2>
                        {/* Mismo color que en la lista de la izquierda (antes siempre verde, aunque estuviera esperando retiro) */}
                        <span className={`inline-block mt-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${historyDetail.Estado === 'RECIBIDO_TOTAL' || historyDetail.Estado === 'ENTREGADO' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : historyDetail.Estado?.startsWith('EN_') ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}>{historyDetail.Estado?.replace('_', ' ')}</span>
                    </div>
                    <button onClick={handlePrint} className={BTN_PRINCIPAL}><Printer size={15} /> Imprimir</button>
                </div>

                <div id="print-detail" className="hidden print:flex p-8 flex-col items-center print:p-0">
                    <div className="w-full bg-white p-8 rounded-xl border-dashed border-2 border-slate-300 print:border-none print:shadow-none shadow-sm pb-10">
                        <div className="text-center mb-6 border-b-2 border-black pb-4">
                            <h1 className="text-4xl font-black uppercase tracking-tight">Remito</h1>
                            <div className="flex justify-between mt-4 font-bold text-sm">
                                <span>ORIGEN: {historyDetail.AreaOrigenID}</span>
                                <span>DESTINO: {historyDetail.AreaDestinoID}</span>
                            </div>
                        </div>
                        <div className="flex justify-center mb-6">
                            <QRCode value={res.dispatchCode} size={128} />
                        </div>
                        <div className="text-center font-mono text-2xl font-black mb-6">{res.dispatchCode}</div>

                        <div className="text-center text-xs text-slate-500 mb-6 font-bold">FECHA EMISIÓN: {res.date}</div>

                        {/* ONLY Print Total Count, not the full list */}
                        <div className="text-center border-t-2 border-slate-200 pt-6 mt-4 pb-2">
                            <h3 className="text-xs font-bold uppercase mb-2 text-slate-400">Cantidad Total</h3>
                            <div className="text-5xl font-black text-slate-900">{historyDetail.items?.length || 0}</div>
                            <div className="text-sm font-bold uppercase text-slate-500 mt-1">Bultos</div>
                        </div>
                    </div>
                </div>

                {/* Detailed Item List (Screen Only, NOT printed) */}
                {historyDetail.items && historyDetail.items.length > 0 && (
                    <div className="print:hidden w-full">
                        <div className={`${CARD} overflow-hidden`}>
                            <div className="border-b border-zinc-200 px-4 py-3 flex justify-between items-center">
                                <h3 className="text-sm font-black text-zinc-800 flex items-center gap-2">
                                    <Boxes size={16} className="shrink-0 text-brand-cyan" />
                                    Detalle de Órdenes y Bultos ({historyDetail.items.length})
                                </h3>
                            </div>
                            {!conTabla ? (
                                // Celular: una tarjeta por bulto (código y estado arriba, orden y cliente, el trabajo y el recorrido)
                                <div className="p-3 space-y-2">
                                    {historyDetail.items.map((item, idx) => {
                                        const isMatch = coincideBusqueda(item);
                                        return (
                                            <div key={idx} className={`rounded-xl border p-3 ${isMatch ? 'bg-amber-50 border-amber-300' : 'border-zinc-200'}`}>
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="font-mono font-bold text-sm text-zinc-700 min-w-0 truncate">
                                                        {isMatch && <CircleDot size={12} className="inline-block text-amber-500 mr-1.5 align-[-1px]" />}
                                                        {item.CodigoEtiqueta || item.displayCode || item.BultoID || 'N/A'}
                                                    </span>
                                                    <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase whitespace-nowrap ${claseEstadoBulto(item.BultoEstado)}`}>
                                                        {item.BultoEstado?.replace('_', ' ') || historyDetail.Estado?.replace('_', ' ')}
                                                    </span>
                                                </div>
                                                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 mt-2.5 rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5 text-xs">
                                                    <div className="min-w-0">
                                                        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Orden</dt>
                                                        <dd className={`font-bold truncate ${isMatch ? 'text-amber-700' : 'text-zinc-700'}`}>{item.CodigoOrden || item.NoDocERP || item.RetiroAsociado || '-'}</dd>
                                                        <dd className="text-[10px] text-zinc-400">ID: {item.OrdenID || item.RetiroID || '-'}</dd>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Cliente</dt>
                                                        <dd className="font-bold text-zinc-800 truncate">{item.Cliente || item.ClienteRetiro || item.ReceptorNombre || 'S/D'}</dd>
                                                        {item.IDCliente && <dd className="text-[10px] font-black text-brand-cyan uppercase tracking-wide truncate">{item.IDCliente}</dd>}
                                                    </div>
                                                </dl>
                                                {(item.DescripcionTrabajo || item.Descripcion) && (
                                                    <p className="mt-2 text-xs text-zinc-500 line-clamp-2">{item.DescripcionTrabajo || item.Descripcion}</p>
                                                )}
                                                <div className="mt-2 flex items-center gap-2 text-[11px] font-bold text-zinc-600 min-w-0">
                                                    <span className="uppercase truncate">{historyDetail.AreaOrigenID}</span>
                                                    <ArrowRight size={12} className="shrink-0 text-brand-cyan" />
                                                    <span className="uppercase text-zinc-500 truncate">{historyDetail.AreaDestinoID}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-zinc-50 border-b border-zinc-200">
                                        <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                            <th className="px-4 py-2.5 whitespace-nowrap">Código Bulto</th>
                                            <th className="px-4 py-2.5 whitespace-nowrap">Nro. Orden</th>
                                            <th className="px-4 py-2.5">Cliente</th>
                                            <th className="px-4 py-2.5">Trabajo</th>
                                            <th className="px-4 py-2.5 whitespace-nowrap">Origen / Destino</th>
                                            <th className="px-4 py-2.5 text-right">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {historyDetail.items.map((item, idx) => {
                                            const isMatch = coincideBusqueda(item);
                                            return (
                                            <tr key={idx} className={`transition-colors ${isMatch ? 'bg-amber-50 border-l-4 border-amber-400' : 'hover:bg-zinc-50'}`}>
                                                <td className="px-4 py-3 font-mono font-bold text-zinc-700 whitespace-nowrap">
                                                    {isMatch && <CircleDot size={12} className="inline-block text-amber-500 mr-2 align-[-1px]" />}
                                                    {item.CodigoEtiqueta || item.displayCode || item.BultoID || 'N/A'}
                                                </td>
                                                <td className={`px-4 py-3 font-bold whitespace-nowrap ${isMatch ? 'text-amber-700' : 'text-zinc-700'}`}>
                                                    <div>{item.CodigoOrden || item.NoDocERP || item.RetiroAsociado || '-'}</div>
                                                    <div className="text-[10px] text-zinc-400 font-normal">ID: {item.OrdenID || item.RetiroID || '-'}</div>
                                                </td>
                                                <td className="px-4 py-3 font-bold text-zinc-800 whitespace-nowrap">
                                                    <div>{item.Cliente || item.ClienteRetiro || item.ReceptorNombre || 'S/D'}</div>
                                                    {item.IDCliente && (
                                                        <div className="text-[10px] font-black text-brand-cyan uppercase tracking-wide mt-0.5">{item.IDCliente}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-xs text-zinc-500 max-w-xs truncate" title={item.DescripcionTrabajo || item.Descripcion}>
                                                    {item.DescripcionTrabajo || item.Descripcion || '-'}
                                                </td>
                                                <td className="px-4 py-3 text-xs">
                                                    <div className="flex items-center gap-2 font-bold text-zinc-600 whitespace-nowrap">
                                                        <span className="uppercase">{historyDetail.AreaOrigenID}</span>
                                                        <ArrowRight size={12} className="shrink-0 text-brand-cyan" />
                                                        <span className="uppercase text-zinc-500">{historyDetail.AreaDestinoID}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase whitespace-nowrap ${claseEstadoBulto(item.BultoEstado)}`}>
                                                        {item.BultoEstado?.replace('_', ' ') || historyDetail.Estado?.replace('_', ' ')}
                                                    </span>
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderCreationFlow = () => (
        <>
            {step === 0 && (
                <div className="flex flex-col h-full bg-slate-50">
                    {/* Header with Search and Action */}
                    <div className="px-3 md:px-6 pt-3 md:pt-6 pb-3 shrink-0 space-y-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <Truck size={26} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                            <div className="min-w-0">
                                <h2 className="text-lg font-black text-zinc-800">Generación de Remitos</h2>
                                <p className="text-sm text-zinc-400">Gestiona al inventario físico y despachos de <strong className="text-brand-cyan">{currentArea}</strong></p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <div className="relative flex-1 min-w-[220px]">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                <input
                                    className={CAMPO}
                                    placeholder="Escanear etiqueta o buscar cliente..."
                                    aria-label="Escanear etiqueta o buscar cliente"
                                    value={stockSearch}
                                    onChange={e => setStockSearch(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    autoFocus
                                />
                            </div>
                            <Selector
                                filtro
                                aria-label="Filtrar por área destino"
                                title="Filtrar por área destino"
                                value={destinoFilter}
                                onChange={e => setDestinoFilter(e.target.value)}
                                renderValor={o => (!o || o.value === 'TODOS' ? o?.contenido : `Destino: ${o.texto}`)}
                            >
                                <option value="TODOS">Destino: Todos</option>
                                {destinoOptions.map(d => <option key={d} value={d}>{d}</option>)}
                            </Selector>
                            <button
                                disabled={selectedStockItems.length === 0}
                                onClick={handleDirectSubmit}
                                className={BTN_PRINCIPAL}
                            >
                                <Truck size={15} /> Generar Remito
                                {selectedStockItems.length > 0 && <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs tabular-nums">{selectedStockItems.length}</span>}
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-3 md:px-6 pb-3 md:pb-6">
                        {loadingStock ? (
                            <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-3`}>
                                <Loader2 size={30} className="animate-spin text-brand-cyan" />
                                <p className="text-sm text-zinc-400">Cargando stock...</p>
                            </div>
                        ) : !conTabla ? (
                            // Celular: una tarjeta por bulto (marcar, código y estado arriba, la orden, cliente y destino
                            // en un recuadro, el detalle y la antigüedad). Tocarla marca el bulto y sus hermanos, como la fila.
                            <div className="space-y-2">
                                {stockRows.length > 0 && (
                                    <div className={`${CARD} px-3 py-2.5 flex items-center gap-2.5 text-xs font-bold text-zinc-500`}>
                                        <div className="shrink-0">{casillaTodas}</div>
                                        Marcar todas ({stockRows.length})
                                    </div>
                                )}
                                {stockRows.slice(0, verStock).map(row => {
                                    const isSelected = selectedStockItems.some(s => s.BultoID === row.BultoID);
                                    return (
                                        <div
                                            key={row.rowId}
                                            onClick={() => toggleRow(row)}
                                            className={`${CARD} p-3 cursor-pointer transition-colors ${isSelected ? '!border-brand-cyan/50 bg-brand-cyan/5' : ''}`}
                                        >
                                            <div className="flex items-start gap-2.5">
                                                <div className={`mt-0.5 w-5 h-5 shrink-0 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-brand-cyan border-brand-cyan text-white' : 'bg-white border-zinc-300 text-transparent'}`}>
                                                    <Check size={12} strokeWidth={3} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <span className="font-bold font-mono text-sm text-zinc-800 truncate">{row.displayCode}</span>
                                                        <div className="flex flex-wrap justify-end gap-1 shrink-0">
                                                            {row.EstadoEnvio === 'PARCIAL' && (
                                                                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase bg-amber-50 text-amber-700 border-amber-200" title="Esta orden ya salió en parte: el próximo remito puede completarla">
                                                                    ENVÍO PARCIAL
                                                                </span>
                                                            )}
                                                            <span className={`${row.EsComplemento ? 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20' : 'bg-zinc-100 text-zinc-600 border-zinc-200'} text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase`}>
                                                                {row.EsComplemento ? 'REPOSICIÓN' : 'EN STOCK'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {row.EsComplemento ? (
                                                        <>
                                                            <p className="text-sm font-bold text-brand-cyan truncate">{row.CodigoOrdenMadre || row.orderCode}</p>
                                                            <p className="text-[10px] font-black uppercase text-brand-cyan/80 mt-0.5">Reposición {row.orderCode} · viaja como complemento</p>
                                                        </>
                                                    ) : (
                                                        <p className="text-sm font-bold text-brand-cyan truncate">{row.orderCode || '-'}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <dl className="grid grid-cols-2 gap-x-3 mt-2.5 rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5 text-xs">
                                                <div className="min-w-0">
                                                    <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Cliente</dt>
                                                    {row.IDCliente ? (
                                                        <>
                                                            <dd className="font-bold font-mono text-brand-cyan truncate">{row.IDCliente}</dd>
                                                            {row.client && row.client !== '-' && <dd className="text-[11px] text-zinc-500 uppercase truncate">{row.client}</dd>}
                                                        </>
                                                    ) : (
                                                        <dd className="font-bold text-zinc-600 uppercase truncate">
                                                            {row.client && row.client !== '-' ? row.client : <span className="text-zinc-400 italic font-normal normal-case">S/D</span>}
                                                        </dd>
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Destino</dt>
                                                    <dd className="font-bold truncate">
                                                        {row.nextService && row.nextService !== 'LOGISTICA'
                                                            ? <span className="text-brand-cyan">{row.nextService}</span>
                                                            : <span className="text-zinc-400">LOGISTICA</span>}
                                                    </dd>
                                                </div>
                                            </dl>
                                            {row.desc && <p className="mt-2 text-xs font-bold text-zinc-700 line-clamp-2">{row.desc}</p>}
                                            <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-zinc-400 tabular-nums">
                                                <Clock size={11} className="shrink-0" />
                                                {row.date ? new Date(row.date).toLocaleDateString() : '-'}
                                            </p>
                                        </div>
                                    );
                                })}
                                {verStock < stockRows.length && (
                                    <div ref={centinelaStock} className="py-3 text-center text-xs text-zinc-400">
                                        Mostrando {verStock} de {stockRows.length}…
                                    </div>
                                )}
                                {stockRows.length === 0 && (
                                    <div className={`${CARD} flex flex-col items-center justify-center gap-2 py-16 px-4 text-center`}>
                                        <PackageOpen size={40} className="text-zinc-200" />
                                        <p className="text-sm text-zinc-400">No hay items en stock disponibles para despachar.</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className={`${CARD} overflow-hidden`}>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-zinc-50 border-b border-zinc-200">
                                            <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                                <th className="px-4 py-2.5 w-12 text-center">
                                                    {casillaTodas}
                                                </th>
                                                <th className="px-4 py-2.5">Código</th>
                                                <th className="px-4 py-2.5">Orden</th>
                                                <th className="px-4 py-2.5">Cliente</th>
                                                <th className="px-4 py-2.5">Detalle / Referencias</th>
                                                <th className="px-4 py-2.5">Destino</th>
                                                <th className="px-4 py-2.5">Antigüedad</th>
                                                <th className="px-4 py-2.5 text-right">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 text-sm">
                                            {stockRows.slice(0, verStock).map(row => {
                                                const isSelected = selectedStockItems.some(s => s.BultoID === row.BultoID);
                                                return (
                                                    <tr
                                                        key={row.rowId}
                                                        onClick={() => toggleRow(row)}
                                                        className={`hover:bg-zinc-50 transition-colors cursor-pointer group ${isSelected ? 'bg-brand-cyan/5' : ''}`}
                                                    >
                                                        <td className="px-4 py-3 text-center">
                                                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-brand-cyan border-brand-cyan text-white' : 'bg-white border-zinc-300 text-transparent group-hover:border-brand-cyan/50'}`}>
                                                                <Check size={12} strokeWidth={3} />
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="font-bold font-mono text-zinc-800 whitespace-nowrap">{row.displayCode}</div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {row.EsComplemento ? (
                                                                <>
                                                                    <span className="font-bold text-brand-cyan whitespace-nowrap">{row.CodigoOrdenMadre || row.orderCode}</span>
                                                                    <div className="text-[10px] font-black uppercase text-brand-cyan/80 mt-0.5">Reposición {row.orderCode} · viaja como complemento</div>
                                                                </>
                                                            ) : (
                                                                <span className="font-bold text-brand-cyan whitespace-nowrap">{row.orderCode || '-'}</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {row.IDCliente ? (
                                                                <>
                                                                    <div className="font-bold font-mono text-brand-cyan">{row.IDCliente}</div>
                                                                    {row.client && row.client !== '-' && (
                                                                        <div className="text-[11px] text-zinc-500 uppercase font-medium mt-0.5">{row.client}</div>
                                                                    )}
                                                                </>
                                                            ) : (
                                                                <div className="font-bold text-zinc-600 uppercase">
                                                                    {row.client && row.client !== '-' ? row.client : <span className="text-zinc-400 italic font-normal">S/D</span>}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="font-bold text-zinc-700">{row.desc}</div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {row.nextService && row.nextService !== 'LOGISTICA' ? (
                                                                <div className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20 inline-flex items-center gap-1 whitespace-nowrap">
                                                                    <ArrowRight size={11} /> {row.nextService}
                                                                </div>
                                                            ) : (
                                                                <span className="text-zinc-300 text-xs font-bold">LOGISTICA</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-zinc-500 tabular-nums whitespace-nowrap">
                                                            {row.date ? new Date(row.date).toLocaleDateString() : '-'}
                                                        </td>
                                                        <td className="px-4 py-3 text-right whitespace-nowrap">
                                                            {row.EstadoEnvio === 'PARCIAL' && (
                                                                <span className="mr-1 text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase bg-amber-50 text-amber-700 border-amber-200" title="Esta orden ya salió en parte: el próximo remito puede completarla">
                                                                    ENVÍO PARCIAL
                                                                </span>
                                                            )}
                                                            <span className={`${row.EsComplemento ? 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20' : 'bg-zinc-100 text-zinc-600 border-zinc-200'} text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase`}>
                                                                {row.EsComplemento ? 'REPOSICIÓN' : 'EN STOCK'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {stockRows.length === 0 && (
                                                <tr>
                                                    <td colSpan="8" className="px-4 py-16">
                                                        <div className="flex flex-col items-center justify-center gap-2 text-center">
                                                            <PackageOpen size={40} className="text-zinc-200" />
                                                            <p className="text-sm text-zinc-400">No hay items en stock disponibles para despachar.</p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {verStock < stockRows.length && (
                                    <div ref={centinelaStock} className="py-3 text-center text-xs text-zinc-400 border-t border-zinc-100">
                                        Mostrando {verStock} de {stockRows.length}…
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {step === 1 && (
                <div className="flex flex-col h-full">
                    <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
                        {/* Panel izquierdo - Destinos */}
                        <div className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-zinc-200 bg-white flex flex-col">
                            <div className="px-5 py-4 border-b border-zinc-100">
                                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">Total a Despachar</div>
                                <div className="text-5xl font-black text-zinc-800 leading-none tabular-nums">{totalBultos}</div>
                                <div className="text-xs text-zinc-400 font-bold mt-1 uppercase">Bultos</div>
                            </div>
                            <div className="px-5 py-4 flex-1 md:overflow-y-auto">
                                <div className="flex items-center gap-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-3">
                                    <MapPin size={13} className="shrink-0 text-brand-cyan" /> Destinos
                                </div>
                                <div className="space-y-2">
                                    {Object.keys(dispatchGroups).map(key => (
                                        <div key={key} className="p-3 bg-zinc-50 rounded-xl border border-zinc-200">
                                            <div className="flex justify-between items-center gap-2 mb-2">
                                                <span className="text-xs font-bold text-zinc-600">Grupo: {key}</span>
                                                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-white text-zinc-600 border-zinc-200 whitespace-nowrap">{dispatchGroups[key].length} Ordenes</span>
                                            </div>
                                            {key === 'LOGISTICA' && (
                                                <Selector
                                                    className="w-full"
                                                    aria-label="Destino real"
                                                    value={targetDestinations[key] || ''}
                                                    onChange={e => setTargetDestinations({ ...targetDestinations, [key]: e.target.value })}
                                                >
                                                    <option value="">Seleccionar Destino Real...</option>
                                                    {['CORTE', 'COSTURA', 'ESTAMPADO', 'BORDADO', 'TERMINACION', 'DEPOSITO'].map(a => <option key={a} value={a}>{a}</option>)}
                                                </Selector>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {/* Panel derecho - Review */}
                        <div className="flex-1 min-w-0 flex flex-col md:overflow-hidden bg-slate-50">
                            <div className="px-4 md:px-6 py-3 border-b border-zinc-200 bg-white flex items-center gap-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-wide">
                                <ListChecks size={13} className="shrink-0 text-brand-cyan" /> Review Items
                            </div>
                            <div className="flex-1 md:overflow-y-auto">
                                {selectedOrders.map((o, i) => {
                                    const dest = targetDestinations[o.destino || 'LOGISTICA'] || o.destino || 'LOGISTICA';
                                    const info = envioInfo[o.id];
                                    // Si ya no hay ninguna decisión real que tomar (nada abierto, nada en
                                    // producción, y este es el último bulto) "parcial" no tiene sentido —
                                    // mismo criterio que ya usa el radio de abajo (línea ~90) y el default
                                    // de completaOrden al cargar (línea ~315). Sin nada que elegir, la
                                    // orden se muestra como una fila simple, igual que las que van directo
                                    // a Depósito (que tampoco ofrecen esta elección).
                                    const puedeCompletarInfo = info && (info.reposicionesAbiertas || []).length === 0 && !info.siguEnProduccion;
                                    const parcialInnecesario = puedeCompletarInfo && restantesDe(o.id) === 0;
                                    const conBloque = destPermiteParcial(dest) && info && lineas[info.madreId] && !parcialInnecesario;
                                    return (
                                        <div key={i} className="px-4 md:px-6 py-4 border-b border-zinc-100 bg-white hover:bg-zinc-50 transition-colors">
                                            <div className="flex justify-between items-start gap-3">
                                                <div className="min-w-0">
                                                    <div className="font-bold text-zinc-800 text-sm break-words">{o.code}{info?.esComplemento && <span className="inline-block ml-2 text-[11px] font-bold uppercase text-brand-cyan bg-brand-cyan/5 border border-brand-cyan/20 px-2.5 py-0.5 rounded-full">Reposición de {info.codigoMadre}</span>}</div>
                                                    <div className="text-xs text-zinc-400 mt-0.5">{o.desc}</div>
                                                </div>
                                                <span className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border bg-zinc-50 text-zinc-600 border-zinc-200 whitespace-nowrap">{o.bultos.length} Bultos</span>
                                            </div>
                                            {conBloque && (
                                                <EnvioPorOrden
                                                    orden={o}
                                                    info={info}
                                                    linea={lineas[info.madreId]}
                                                    restantes={restantesDe(o.id)}
                                                    onChange={(l) => setLineas(prev => ({ ...prev, [info.madreId]: l }))}
                                                />
                                            )}
                                            {destPermiteParcial(dest) && !info && (
                                                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400"><Loader2 size={12} className="shrink-0 animate-spin text-brand-cyan" />Cargando el libro de entregas de esta orden...</div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    {/* Footer */}
                    <div className="px-3 md:px-6 py-3 border-t border-zinc-200 bg-white flex flex-wrap justify-end gap-2 shrink-0">
                        <button onClick={() => setStep(0)} className={BTN_SECUNDARIO}><ArrowLeft size={15} /> Atrás</button>
                        <button onClick={handleCreateBatch} disabled={loading} className={BTN_PRINCIPAL}>
                            {loading ? <Loader2 size={15} className="animate-spin" /> : <><Truck size={15} /> Confirmar Salida</>}
                        </button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="flex flex-col h-full bg-slate-50 items-center overflow-y-auto p-3 md:p-6">
                    <div className={`${CARD} w-full max-w-md overflow-hidden my-auto`}>
                        <div className="p-6 md:p-8 pb-4 md:pb-4 text-center">
                            <Truck size={36} className="mx-auto mb-3 text-brand-cyan" aria-hidden="true" />
                            <h2 className="text-2xl font-black text-zinc-800">Confirmar Envío</h2>
                            <p className="text-sm text-zinc-400 mt-1">Autorizar salida de {totalBultos} bultos</p>
                        </div>
                        <div className="px-6 md:px-8 pb-6 md:pb-8 space-y-3">
                            {resumenEnvio.length > 0 && (
                                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-2 text-left">
                                    {resumenEnvio.map((f, i) => <p key={i}>{f}</p>)}
                                </div>
                            )}
                            {/* El texto del log trae un emoji adelante (tilde verde o cruz roja, lo pone handleCreateBatch):
                                acá se muestra con un ícono de Lucide en su lugar, sin tocar el texto que se guarda. */}
                            {logs.length > 0 && (() => {
                                const ultimo = logs[logs.length - 1];
                                const esError = ultimo.startsWith('\u274C');
                                return (
                                    <div className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold text-center ${esError ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                        {esError ? <XCircle size={15} className="shrink-0" /> : <CheckCircle2 size={15} className="shrink-0" />}
                                        <span className="min-w-0 break-words">{ultimo.replace(/^(\u2705|\u274C)\s*/, '')}</span>
                                    </div>
                                );
                            })()}
                            <button onClick={handleCreateBatch} disabled={loading} className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl bg-brand-cyan text-white text-base font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                                {loading ? <Loader2 size={18} className="animate-spin" /> : <><Truck size={18} /> Confirmar Salida</>}
                            </button>
                            <button onClick={() => setStep(step === 2 && initialOrders.length > 0 ? 1 : 1)} disabled={loading} className="w-full inline-flex items-center justify-center gap-1.5 py-3 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50">
                                Volver
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="flex flex-col h-full bg-slate-50 overflow-auto print:bg-white">
                    {/* PRINT STYLES */}
                    <style>{`
                        @media print {
                            body * {
                                visibility: hidden;
                            }
                            #printable-area, #printable-area * {
                                visibility: visible;
                            }
                            #printable-area {
                                position: fixed;
                                left: 0;
                                top: 0;
                                width: 100mm;
                                margin: 0;
                                padding: 0;
                                background: white;
                            }
                            @page {
                                size: 100mm 150mm;
                                margin: 2mm;
                            }
                        }
                    `}</style>

                    <div className="px-3 md:px-6 py-3 bg-white border-b border-zinc-200 flex flex-wrap justify-between items-center gap-3 print:hidden">
                        <h2 className="text-lg font-black text-zinc-800 flex items-center gap-2"><CheckCircle2 size={20} className="shrink-0 text-emerald-500" /> Remitos Generados</h2>
                        <button onClick={handlePrint} className={BTN_PRINCIPAL}><Printer size={15} /> Imprimir</button>
                    </div>

                    <div id="printable-area" className="p-4 flex flex-col items-center gap-4 print:p-0 print:block">
                        {results.map((res, i) => (
                            <div key={i} className="w-full max-w-xs bg-white p-4 rounded-xl border-dashed border-2 border-slate-300 print:border-2 print:border-black print:w-full print:shadow-none shadow-sm relative mx-auto my-2 break-after-page print:m-0">
                                <div className="text-center mb-3 border-b-2 border-black pb-2">
                                    <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Remito</h1>
                                    <div className="flex justify-between mt-2 font-bold text-xs">
                                        <span>ORIGEN: {currentArea || user?.areaKey}</span>
                                        <span>DESTINO: {res.destArea}</span>
                                    </div>
                                </div>
                                <div className="flex justify-center mb-3">
                                    <QRCode value={res.dispatchCode} size={90} />
                                </div>
                                <div className="text-center font-mono text-base font-black mb-3 text-slate-900">{res.dispatchCode}</div>
                                {res.recepcionAutomatica?.ok && (
                                    <div className="text-center text-[10px] font-black uppercase text-emerald-600 mb-3">Recibido automáticamente en {res.destArea}</div>
                                )}

                                <div className="text-center text-[9px] text-slate-500 mb-3">Emisión: {new Date().toLocaleString('es-AR')}</div>

                                <div className="text-center border-t-2 border-slate-200 pt-3 mt-2">
                                    <h3 className="text-[9px] font-bold uppercase mb-1 text-slate-400">Cantidad Total</h3>
                                    <div className="text-4xl font-black text-slate-900">{res.itemCount}</div>
                                    <div className="text-xs font-bold uppercase text-slate-500 mt-1">Bultos</div>
                                </div>

                                <div className="mt-3 text-center text-[9px] text-slate-400">
                                    Transportista: {credentials.username || 'Sistema'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );

    // --- RENDER: HISTORY MODE ---
    if (viewMode === 'history') {
        return (
            <div className="flex flex-col md:flex-row bg-slate-50 font-sans" style={{height: 'calc(100vh - 130px)'}}>
                {/* LIST SIDEBAR */}
                {/* En el celular, lista o detalle (uno a la vez): antes la lista quedaba cortada a la mitad y la otra mitad
                    era el aviso vacío «Seleccione un remito». En escritorio, la lista al costado (más ancha: el buscador
                    cortaba su ejemplo). */}
                <div className={`w-full md:w-96 flex-1 min-h-0 md:flex-none bg-white border-b md:border-b-0 md:border-r border-zinc-200 flex-col overflow-hidden print:hidden ${selectedHistoryCode ? 'hidden md:flex' : 'flex'}`}>
                    <div className="p-4 border-b border-zinc-200 flex flex-col gap-3">
                        <div className="flex justify-between items-center gap-2">
                            <h2 className="text-lg font-black text-zinc-800 flex items-center gap-2">
                                <History size={20} className="shrink-0 text-brand-cyan" /> Historial de Envíos
                            </h2>
                            <button onClick={() => { refetchHistory(); setHistorySearchResults(null); setHistorySearchQuery(''); }} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar">
                                <RefreshCw size={15} className={loadingHistory ? 'animate-spin' : ''} />
                            </button>
                        </div>
                        <form onSubmit={handleSearchHistory} className="relative w-full">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                type="text"
                                value={historySearchQuery}
                                onChange={e => {
                                    setHistorySearchQuery(e.target.value);
                                    if (!e.target.value) setHistorySearchResults(null);
                                }}
                                placeholder="Ej: PRO-1332, REM-045, bulto..."
                                aria-label="Buscar remito, orden o bulto"
                                className="w-full pl-9 pr-24 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                            />
                            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                {historySearchQuery && (
                                    <button type="button" onClick={() => { setHistorySearchQuery(''); setHistorySearchResults(null); }} className="p-1 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Limpiar" aria-label="Limpiar búsqueda">
                                        <X size={14} />
                                    </button>
                                )}
                                <button type="submit" className="bg-brand-cyan hover:bg-brand-cyan/90 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors">
                                    Buscar
                                </button>
                            </div>
                        </form>
                        <p className="text-[11px] text-zinc-400 -mt-1">Buscá una orden para saber en qué remito se fue</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {loadingHistory && !historySearchResults && <div className="flex justify-center p-4"><Loader2 size={24} className="animate-spin text-brand-cyan" /></div>}

                        {historySearchResults && (
                            <div className="mb-3">
                                <div className="flex items-center gap-2 border-b border-zinc-200 pb-2 mb-2">
                                    <Search size={13} className="shrink-0 text-brand-cyan" />
                                    <h3 className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                        {historySearchResults.length === 0
                                            ? 'Sin resultados'
                                            : `${historySearchResults.length} remito${historySearchResults.length > 1 ? 's' : ''} encontrado${historySearchResults.length > 1 ? 's' : ''}`}
                                    </h3>
                                </div>
                                {historySearchResults.length === 0 && (
                                    <div className="flex flex-col items-center gap-2 text-sm text-zinc-400 text-center py-6">
                                        <Inbox size={40} className="text-zinc-200" />
                                        La orden no aparece en ningún remito registrado
                                    </div>
                                )}
                            </div>
                        )}

                        {(!historySearchResults ? outgoingRemitos : historySearchResults)?.map(rem => (
                            <div
                                key={rem.EnvioID || rem.CodigoRemito}
                                onClick={() => handleSelectHistory(rem.CodigoRemito)}
                                className={`p-3.5 rounded-2xl border cursor-pointer transition-colors ${selectedHistoryCode === rem.CodigoRemito ? 'bg-brand-cyan/5 border-brand-cyan ring-1 ring-brand-cyan/30' : 'bg-white border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'}`}
                            >
                                {/* Orden encontrada (solo en resultados de búsqueda) */}
                                {historySearchResults && rem.OrdenEncontrada && (
                                    <div className="flex items-center gap-1.5 mb-2 bg-white border border-brand-cyan/20 rounded-lg px-2 py-1">
                                        <Package size={13} className="shrink-0 text-brand-cyan" />
                                        <span className="text-xs font-bold text-brand-cyan font-mono">{rem.OrdenEncontrada}</span>
                                        <span className="text-[10px] text-zinc-400 ml-auto">en este remito</span>
                                    </div>
                                )}
                                <div className="flex justify-between items-start gap-2 mb-2">
                                    <span className="font-black text-zinc-800 font-mono text-base break-all">{rem.CodigoRemito}</span>
                                    <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase whitespace-nowrap ${rem.Estado === 'RECIBIDO_TOTAL' || rem.Estado === 'ENTREGADO' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : rem.Estado?.startsWith('EN_') ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}>
                                        {rem.Estado?.replace(/_/g, ' ')}
                                    </span>
                                </div>
                                {/* Origen → destino: los códigos largos (LOGISTICA_ENCOMIENDAS) se cortan con «…» en vez de ensanchar la lista */}
                                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2 min-w-0">
                                    {rem.AreaOrigenID && <span className="font-semibold text-zinc-600 truncate min-w-0" title={rem.AreaOrigenID}>{rem.AreaOrigenID.replace(/_/g, ' ')}</span>}
                                    <MoveRight size={14} className="shrink-0 text-brand-cyan" />
                                    <span className="font-bold text-zinc-700 truncate min-w-0" title={rem.AreaDestinoID || ''}>{(rem.AreaDestinoID || 'S/D').replace(/_/g, ' ')}</span>
                                </div>
                                <div className="flex justify-between items-end gap-2 border-t border-zinc-100 pt-2 mt-2">
                                    <div className="text-[11px] text-zinc-400 tabular-nums">{rem.FechaSalida ? new Date(rem.FechaSalida).toLocaleString() : '—'}</div>
                                    <div className="text-[11px] font-bold text-zinc-500 whitespace-nowrap">{rem.TotalItems ?? rem.items?.length ?? 0} bultos</div>
                                </div>
                            </div>
                        ))}

                        {!historySearchResults && outgoingRemitos?.length === 0 && (
                            <div className="flex flex-col items-center gap-2 p-6 text-center">
                                <Inbox size={40} className="text-zinc-200" />
                                <p className="text-sm text-zinc-400">No hay envíos registrados.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* DETAIL VIEW */}
                <div className={`flex-1 min-h-0 min-w-0 flex-col overflow-hidden relative bg-slate-50 ${selectedHistoryCode ? 'flex' : 'hidden md:flex'}`}>
                    {selectedHistoryCode ? (
                        <div className="flex-1 overflow-y-auto">
                            {/* Celular: volver a la lista */}
                            <div className="md:hidden px-3 pt-3 print:hidden">
                                <button type="button" onClick={() => setSelectedHistoryCode(null)} className={BTN_SECUNDARIO}>
                                    <ArrowLeft size={15} /> Volver a la lista
                                </button>
                            </div>
                            {renderHistoryDetail()}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
                            <FileText size={40} className="text-zinc-200" />
                            <p className="text-sm text-zinc-400">Seleccione un remito para ver su detalle</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // --- RENDER: CREATION MODE (Default) ---
    return (
        <div className="flex h-full bg-slate-50 font-sans flex-col">
            {/* Top Close Button for Modal Context (if needed) */}
            {onClose && <div className="absolute top-4 right-4 z-50 print:hidden"><button onClick={onClose} className="p-1.5 rounded-xl text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Cerrar" aria-label="Cerrar"><X size={22} /></button></div>}

            {renderCreationFlow()}
        </div>
    );
};

export default DispatchView;
