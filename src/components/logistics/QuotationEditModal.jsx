import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import api from '../../services/apiClient';

// Convierte un monto entre monedas usando la cotización del día — mismo criterio que ya
// usa el resto del modal (USD→UYU multiplica, UYU→USD divide).
const convertirMoneda = (monto, monedaOrigen, monedaDestino, cotizacion) => {
    const m = parseFloat(monto) || 0;
    const origen = monedaOrigen || 'UYU';
    const destino = monedaDestino || 'UYU';
    if (origen === destino) return m;
    if (origen === 'USD' && destino === 'UYU') return m * (cotizacion || 40);
    if (origen === 'UYU' && destino === 'USD') return m / (cotizacion || 40);
    return m;
};

// "Comprar y personalizar": recalcula la línea de PRO para que su Subtotal sea "lo suyo
// propio" (lo que tenía al cargar, sin las hermanas) + la suma EN VIVO de las hermanas
// (editables por cada área). `sumaHermanasAlCargar` es la foto de cuánto de PRO eran las
// hermanas al momento de abrir el modal (ver sumaHermanasAlCargarRef). Devuelve null si el
// pedido no tiene línea de PRO (nada que rehornear). Compartido por el total en vivo
// (nuevoTotalConHermanas) y el guardado (handleSave), para que nunca queden desalineados.
function rehornearLineaPro(lineas, cotizacion, fotoHermanas) {
    // [COMBOS] Un combo puede tener VARIAS líneas de área PRO: la "de precio" (factura el
    // combo completo) y una "de retiro" por cada componente (ComboItemID seteado, precio
    // consolidado en 0 — ver esRetiroCombo en erpSyncService.js). Sin excluirlas acá, se
    // "rehornea" cualquiera de las de retiro en vez de la de precio real.
    const proLinea = lineas.find(l => (l.AreaIDInterna || l.AreaID) === 'PRO' && !l.ComboItemID);
    if (!proLinea) return null;
    // Precio de PRO tipeado a mano en esta sesión: es el precio final que decidió el usuario,
    // no se le vuelve a sumar nada encima.
    if (proLinea._precioTipeado) return null;
    const monedaPro = proLinea.Moneda || 'UYU';
    // La foto de las hermanas se guarda por moneda y se convierte ACÁ, con la misma cotización
    // que la suma en vivo: si se convirtiera al abrir (con la cotización todavía en 40 por
    // defecto) o en la moneda vieja de PRO, quedaría una diferencia fantasma en el total
    // (2000 − 68,40 + 69,77 = 2001,37; o 2000 − 1,71 + 69,77 al cambiar PRO de USD a UYU).
    const sumaHermanasAlCargar = fotoHermanas && typeof fotoHermanas === 'object'
        ? Object.entries(fotoHermanas.porMoneda || {}).reduce((acc, [mon, monto]) => acc + convertirMoneda(Number(monto) || 0, mon, monedaPro, cotizacion), 0)
        : (Number(fotoHermanas) || 0);
    const proSubtotalActual = (parseFloat(proLinea.Cantidad) || 0) * (parseFloat(proLinea.PrecioUnitario) || 0);
    const sumaHermanasEnVivo = lineas
        .filter(l => l.EsHermanaConsolidada)
        .reduce((acc, h) => acc + convertirMoneda(
            (parseFloat(h.Cantidad) || 0) * (parseFloat(h.PrecioUnitario) || 0),
            h.Moneda, monedaPro, cotizacion
        ), 0);
    const proBaseSinHermanas = proSubtotalActual - sumaHermanasAlCargar;
    const subtotalRehorneado = proBaseSinHermanas + sumaHermanasEnVivo;
    const cantidad = parseFloat(proLinea.Cantidad) || 0;
    const precioUnitarioRehorneado = cantidad > 0 ? subtotalRehorneado / cantidad : subtotalRehorneado;
    return { tempId: proLinea._tempId, monedaPro, proSubtotalActual, subtotalRehorneado, precioUnitarioRehorneado };
}

const AREA_COLORS = {
    DF: 'bg-blue-100 text-blue-700',
    SB: 'bg-purple-100 text-purple-700',
    EMB: 'bg-orange-100 text-orange-700',
    TWC: 'bg-teal-100 text-teal-700',
    TWT: 'bg-pink-100 text-pink-700',
    ECOUV: 'bg-green-100 text-green-700',
    EST: 'bg-yellow-100 text-yellow-700',
    TPU: 'bg-indigo-100 text-indigo-700',
};

// ─── Panel de búsqueda (FUERA de la tabla para evitar clip por overflow) ───
function ProductSearchPanel({ onSelect, onCancel, isAdmin, userArea, forceArea }) {
    const [q, setQ] = useState('');
    const [allItems, setAllItems] = useState([]);
    const [loadingItems, setLoadingItems] = useState(true);
    const [fetchError, setFetchError] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
        api.get('/quotation/search-products')
            .then(r => {
                const items = r.data || [];
                setAllItems(items);
                if (items.length === 0) setFetchError('No se encontraron productos en la tabla Articulos.');
            })
            .catch(err => setFetchError(err.response?.data?.error || err.message))
            .finally(() => setLoadingItems(false));
    }, []);

    const searchFiltered = !q
        ? allItems
        : allItems.filter(p =>
            (p.Descripcion || '').toLowerCase().includes(q.toLowerCase()) ||
            String(p.CodArticulo || '').trim().toLowerCase().includes(q.toLowerCase()) ||
            (p.AreaID || '').toLowerCase().includes(q.toLowerCase())
        );

    // Filtrar por área forzada (editando línea) o por permiso (si no es admin)
    const filtered = searchFiltered.filter(p => {
        if (forceArea) {
            return p.AreaID && p.AreaID.toUpperCase() === forceArea.toUpperCase();
        }
        if (!isAdmin && userArea) {
            return p.AreaID && p.AreaID.toUpperCase() === userArea.toUpperCase();
        }
        return true;
    });

    const grouped = filtered.reduce((acc, p) => {
        const key = p.AreaID || 'Sin Área';
        if (!acc[key]) acc[key] = [];
        acc[key].push(p);
        return acc;
    }, {});

    return (
        <div className="flex flex-col bg-white overflow-hidden w-full h-full">
            {/* Barra de búsqueda */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-100">
                {loadingItems
                    ? <i className="fa-solid fa-spinner fa-spin text-indigo-400 text-sm" />
                    : <i className="fa-solid fa-search text-indigo-400 text-sm" />
                }
                <input
                    ref={inputRef}
                    type="text"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && onCancel()}
                    placeholder={
                        loadingItems ? 'Cargando productos...'
                        : fetchError ? '⚠️ Error al cargar productos'
                        : `Filtrar entre ${allItems.length} productos (ej: DTF, sublimación...)`
                    }
                    className="flex-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 bg-transparent"
                />
                {q && (
                    <button onClick={() => setQ('')} className="text-slate-300 hover:text-slate-500">
                        <i className="fa-solid fa-times text-xs" />
                    </button>
                )}
                <button onClick={onCancel} className="text-slate-300 hover:text-red-500 transition-colors ml-1">
                    <i className="fa-solid fa-xmark" />
                </button>
            </div>

            {/* Lista de resultados */}
            <div className="max-h-56 overflow-y-auto">
                {fetchError && (
                    <div className="px-4 py-3 text-xs text-red-600 bg-red-50 flex items-center gap-2">
                        <i className="fa-solid fa-triangle-exclamation" /> {fetchError}
                    </div>
                )}
                {!fetchError && !loadingItems && Object.keys(grouped).length === 0 && (
                    <div className="px-4 py-4 text-sm text-slate-400 italic text-center">
                        {q ? `Sin resultados para "${q}"` : 'Sin productos disponibles'}
                    </div>
                )}
                {Object.entries(grouped).map(([area, items]) => (
                    <div key={area}>
                        <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-t border-slate-100 flex items-center gap-2 sticky top-0">
                            {area !== 'Sin Área' && (
                                <span className={`px-1.5 py-0.5 rounded font-black text-[9px] ${AREA_COLORS[area] || 'bg-slate-100 text-slate-600'}`}>
                                    {area}
                                </span>
                            )}
                            {area} <span className="font-normal text-slate-300">({items.length})</span>
                        </div>
                        {items.map((p, i) => (
                            <button key={i}
                                onClick={() => onSelect(p)}
                                className="w-full text-left px-4 py-2 hover:bg-indigo-50 border-b border-slate-50 last:border-0 transition-colors flex items-center justify-between gap-3 group">
                                <div className="min-w-0">
                                    <span className="font-semibold text-slate-800 text-sm group-hover:text-indigo-700">
                                        {(p.Descripcion || '').trim()}
                                    </span>
                                    <span className="ml-2 text-[11px] text-slate-400 font-mono">{String(p.CodArticulo || '').trim()}</span>
                                </div>
                                {p.PrecioBase != null && (
                                    <span className="text-xs font-black text-emerald-600 shrink-0">
                                        {p.Moneda} {Number(p.PrecioBase).toFixed(2)}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Fila de datos existente ────────────────────────────────────────────────
// % para mostrar: entero si es entero, si no hasta 2 decimales (36,36 y no "36")
const fmtPctUI = v => { const n = Number(v || 0); return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); };

// Mapea el `desglose` que devuelve /prices/calculate a las columnas de la línea del pedido
// (PrecioLista, Descuento*, Recargo*, DesgloseJSON): es lo que se congela al guardar.
const desgloseALinea = (dg) => {
    if (!dg) return { PrecioLista: null, DescuentoTipo: null, DescuentoPct: null, DescuentoImporte: null, DescuentoOrigen: null, DescuentoPerfilId: null, DescuentoReglaId: null, RecargoPct: null, RecargoImporte: null, RecargoOrigen: null, DesgloseJSON: null };
    const d = dg.descuento || null;
    return {
        PrecioLista: dg.precioLista != null ? Number(dg.precioLista) : null,
        DescuentoTipo: d ? d.tipo : null,
        DescuentoPct: d && d.pct != null ? Number(d.pct) : null,
        DescuentoImporte: d ? Number(d.importeUnitario) : null,
        DescuentoOrigen: d ? (d.texto || d.origen || null) : null,
        DescuentoPerfilId: d && d.perfilId != null ? d.perfilId : null,
        DescuentoReglaId: d && d.reglaId != null ? d.reglaId : null,
        RecargoPct: dg.recargoPct != null ? Number(dg.recargoPct) : null,
        RecargoImporte: dg.recargoImporte != null ? Number(dg.recargoImporte) : null,
        RecargoOrigen: dg.recargoTexto || null,
        DesgloseJSON: dg
    };
};

function LineRow({ line, userArea, isAdmin, areaFilter, modoFacturacion, cotizacion, monedaFinal, onChange, onDelete, onRecalculate, allProducts, onProductChange, showTechnicalData, showOrderColumn, readOnly }) {
    // PRO es el "pilar" que consolida el pedido completo para facturación (precio/factura de
    // TODOS sus componentes) — desde ahí hace falta poder ajustar cualquier línea antes de
    // confirmar la cotización final, a diferencia del resto de las áreas, donde el filtro debe
    // seguir mostrando editable solo lo propio. El permiso real (hasPermission, más abajo) no
    // cambia: un operario no-admin de PRO sigue sin poder tocar líneas de otra área — solo un
    // admin puede, porque isAdmin ya bypasea hasPermission.
    const esVistaConsolidadaPro = areaFilter?.toUpperCase() === 'PRO';
    const isFiltered = areaFilter && areaFilter !== 'TODOS' && !esVistaConsolidadaPro;
    const areaTag = line.AreaIDInterna || line.AreaID || '';
    const currentCod = line.CodArticulo ? String(line.CodArticulo).trim() : '';
    const isLineTargetArea = areaTag.toUpperCase() === areaFilter?.toUpperCase();
    
    // Permission base rule
    const hasPermission = isAdmin || !userArea || areaTag.toUpperCase() === userArea.toUpperCase();
    // Context rule (UX filter override)
    // ONLY allow edit if it's the target area (or no filter) AND user has permission.
    const esHermanaConsolidada = !!line.EsHermanaConsolidada;
    const puedeEditarBase = !readOnly && hasPermission && (!isFiltered || isLineTargetArea);
    // Líneas hermanas ("Comprar y personalizar": EMB/DF/TPU/EST ya sumadas dentro de PRO):
    // el PRODUCTO y el borrado quedan fijos (no tiene sentido cambiar QUÉ personalización
    // es, ni borrarla desde acá) — pero cantidad/dato técnico/precio SÍ son editables:
    // solo el área que hizo el trabajo sabe la producción real (puntadas, bajadas,
    // cantidad real). "Guardar Cotización" recalcula el total de PRO con estos valores.
    // [PRENDAS] En "Precio establecido", el monto se edita ARRIBA (el input al lado del
    // botón de modo) — esta línea (la orden madre PRO) es solo el REFLEJO de ese monto
    // (Cantidad:1 × PrecioUnitario:monto, ver el useEffect de modoFacturacion). Si quedaba
    // editable acá, tocar la Cantidad disparaba un recálculo real contra el precio de lista
    // del artículo (PPERS no tiene uno propio, vale $0) y pisaba el monto pactado con 0 —
    // bug real visto en vivo (14-sep-2026). Se bloquea esta fila específica en este modo;
    // el monto sigue editable arriba, donde corresponde.
    const esProMadreLinea = areaTag.toUpperCase() === 'PRO' && !line.ComboItemID;
    const bloqueadaPorPrecioEstablecido = esProMadreLinea && modoFacturacion === 'PRECIO_ESTABLECIDO';
    // El material de esta línea ya está físicamente en depósito (OrdenesDeposito tiene fila
    // para su orden): cambiar de QUÉ producto se trata mentiría sobre lo que ya llegó, y
    // borrarla dejaría material sin cotización. Cantidad/precio/moneda/importe siguen
    // editables — son términos comerciales, no la descripción del material.
    const bloqueadaProductoPorDeposito = !!line.EnDeposito;
    const puedoEditar = puedeEditarBase && !esHermanaConsolidada && !bloqueadaPorPrecioEstablecido && !bloqueadaProductoPorDeposito;
    const puedoEditarValores = puedeEditarBase && !bloqueadaPorPrecioEstablecido;
    const subtotal = (parseFloat(line.Cantidad) || 0) * (parseFloat(line.PrecioUnitario) || 0);
    const nombreVisible = line.NombreArticulo || line.DescripcionArticulo || line.CodArticulo;
    const timeoutRef = useRef(null);

    const handleDebouncedCalc = (updatedLine) => {
        onChange(updatedLine);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            if (onRecalculate) onRecalculate(updatedLine);
        }, 500);
    };

    const areaProducts = useMemo(() => {
        if (!allProducts) return [];
        const filtered = allProducts.filter(p => p.AreaID && p.AreaID.trim().toUpperCase() === areaTag.trim().toUpperCase());
        console.log(`Line ${line.CodigoOrden} - areaTag: '${areaTag}', allProducts: ${allProducts.length}, filtered: ${filtered.length}`);
        return filtered;
    }, [allProducts, areaTag, line.CodigoOrden]);

    return (
        <tr className={`border-b last:border-0 transition-colors group ${esHermanaConsolidada ? 'bg-amber-50/40' : (puedoEditar ? 'hover:bg-slate-50/80' : 'bg-slate-50/30 opacity-75')}`}>
            {/* Área */}
            <td className="px-3 py-2.5 w-20 text-center">
                {areaTag ? (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase ${AREA_COLORS[areaTag] || 'bg-slate-100 text-slate-600'}`}>
                        {areaTag}
                    </span>
                ) : line.AreaNombre ? (
                    // Combos/insumos del catálogo general (Grupo '2.1'): no son de un área de
                    // producción puntual — etiqueta neutra, no un AreaID real.
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-slate-100 text-slate-500" title={line.AreaNombre}>
                        {line.AreaNombre}
                    </span>
                ) : <span className="text-slate-300">—</span>}
            </td>
            {/* Producto — Select en línea */}
            <td className="px-3 py-2.5 min-w-[200px]">
                {puedoEditar ? (
                    <div className="relative group/prod">
                        <select
                            value={currentCod}
                            onChange={e => {
                                const match = areaProducts.find(p => p.CodArticulo === e.target.value);
                                if (match && match.CodArticulo !== currentCod) {
                                    onProductChange(line._tempId, match);
                                }
                            }}
                            className="w-full text-sm font-semibold text-slate-800 border border-transparent bg-transparent hover:bg-slate-50 hover:border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded-lg px-1 py-1 pr-6 outline-none transition-all truncate cursor-pointer appearance-none"
                            title="Clic para cambiar producto"
                        >
                            {!areaProducts.find(p => p.CodArticulo === currentCod) && (
                                <option value={currentCod} disabled hidden>
                                    {nombreVisible || 'Seleccionar artículo...'}
                                </option>
                            )}
                            {areaProducts.map(p => (
                                <option key={p.CodArticulo} value={p.CodArticulo}>
                                    {p.Descripcion}
                                </option>
                            ))}
                        </select>
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none opacity-50 group-hover/prod:opacity-100 transition-opacity">
                            <i className="fa-solid fa-caret-down text-xs"></i>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 px-2 pointer-events-none">{line.CodArticulo}</div>
                    </div>
                ) : (
                    <div className="px-2 py-1">
                        <div className="flex items-center gap-1.5">
                            <div className="font-semibold text-slate-800 text-sm leading-tight truncate" title={nombreVisible}>
                                {nombreVisible}
                            </div>
                            {esHermanaConsolidada && (
                                <span className="shrink-0 text-[9px] font-black uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded"
                                    title="Ya sumado dentro del total de la línea PRO — solo detalle, no se cobra aparte">
                                    Incluido en PRO
                                </span>
                            )}
                            {!esHermanaConsolidada && bloqueadaProductoPorDeposito && (
                                <span className="shrink-0 text-[9px] font-black uppercase tracking-wide bg-sky-100 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded"
                                    title="El material de esta orden ya está en depósito: no se puede cambiar de producto. Cantidad, precio, moneda e importe siguen editables.">
                                    <i className="fa-solid fa-lock mr-1" />Material en depósito
                                </span>
                            )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">{line.CodArticulo}</div>
                    </div>
                )}
            </td>
            {/* Orden */}
            {showOrderColumn && (
                <td className="px-3 py-2.5">
                    <div className="text-xs font-mono font-bold text-slate-500 whitespace-nowrap">
                        {line.CodigoOrden || line.OrdenID || '-'}
                    </div>
                </td>
            )}
            {/* Cantidad */}
            <td className="px-3 py-2.5 w-24 text-right">
                <input type="number" min="0" step="0.01"
                    disabled={!puedoEditarValores}
                    title={bloqueadaPorPrecioEstablecido ? 'El monto se edita arriba, en "Precio establecido" — esta línea es solo el reflejo' : undefined}
                    value={line.Cantidad}
                    onChange={e => {
                        const newQ = e.target.value;
                        const numQ = parseFloat(newQ) || 0;
                        const puOrig = parseFloat(line.PrecioUnitarioOriginal) || parseFloat(line.PrecioUnitario) || 0;
                        handleDebouncedCalc({ ...line, Cantidad: newQ, SubtotalOriginal: numQ * puOrig, PricingTrace: 'Calculando precio...' });
                    }}
                    className={`w-20 text-right text-sm font-mono border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400
                        ${puedoEditarValores ? 'border-slate-200 bg-white hover:border-indigo-300 group-hover:border-slate-300' : 'border-transparent bg-transparent cursor-not-allowed text-slate-500'}`}
                />
            </td>
            {/* Dato Técnico (Puntadas/Bajadas) */}
            {showTechnicalData && (
                <td className="px-2 py-2.5 w-24 text-right">
                    <input type="number" min="0" step="1"
                        placeholder="Punt."
                        disabled={!puedoEditarValores}
                        value={line.DatoTecnico || ''}
                        onChange={e => handleDebouncedCalc({ ...line, DatoTecnico: e.target.value, PricingTrace: 'Calculando precio...' })}
                        className={`w-20 text-right text-sm font-mono border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400
                            ${puedoEditarValores ? 'border-slate-200 bg-white hover:border-indigo-300' : 'border-transparent bg-transparent cursor-not-allowed text-slate-400'}`}
                    />
                </td>
            )}
            {/* Moneda */}
            <td className="px-2 py-2.5 w-20 text-center">
                {puedoEditarValores ? (
                    <select
                        value={line.Moneda || 'UYU'}
                        title="Moneda de esta línea. Con precio de lista, el motor reconvierte lista, descuento y recargo a la moneda elegida. Con precio tipeado a mano (ej. Precio Establecido), el número queda igual y solo cambia la etiqueta. Sin lista y sin ser manual (ej. la línea de PRO consolidada), se convierte con la cotización del día. El pedido queda en USD si alguna línea FACTURABLE es USD; las incluidas en PRO no deciden."
                        onChange={e => {
                            const m = e.target.value;
                            const esManualMon = /Edici[oó]n manual|Agregado manualmente/i.test(String(line.PricingTrace || '')) || line.PerfilAplicado === 'Manual';
                            const conLista = line.PrecioLista != null && line.PrecioLista !== '' && parseFloat(line.PrecioLista) > 0;
                            if (esManualMon) {
                                // Precio tipeado a mano (ej. "Precio establecido"): el número
                                // es lo que el usuario escribió, se re-etiqueta tal cual.
                                onChange({ ...line, Moneda: m, MonedaOriginal: m });
                            } else if (conLista) {
                                // Tiene lista real: recalcula contra el catálogo en la
                                // moneda nueva (motor de precios).
                                handleDebouncedCalc({ ...line, Moneda: m, MonedaOriginal: m, PricingTrace: 'Calculando precio...' });
                            } else {
                                // Sin lista Y no es manual (ej. la línea de PRO consolidada,
                                // "+ Personalizaciones (Bordado/DTF/TPU/Estampado)"): el
                                // número es real pero no sale de ningún catálogo — no hay
                                // nada que recalcular, pero TAMPOCO hay que dejarlo tal cual
                                // bajo otra moneda (eso convertía, ej., $17,1 UYU en "$17,1
                                // USD" sin tocar el número — 27x más caro sin querer, bug
                                // real 14-sep-2026). Se convierte con la cotización del día.
                                const cant = parseFloat(line.Cantidad) || 0;
                                const nuevoPU = convertirMoneda(line.PrecioUnitario, line.Moneda, m, cotizacion);
                                const nuevoPUOrig = convertirMoneda(line.PrecioUnitarioOriginal, line.Moneda, m, cotizacion);
                                onChange({
                                    ...line, Moneda: m, MonedaOriginal: m,
                                    PrecioUnitario: nuevoPU, PrecioUnitarioOriginal: nuevoPUOrig,
                                    Subtotal: cant * nuevoPU, SubtotalOriginal: cant * nuevoPUOrig,
                                });
                            }
                        }}
                        className="w-full text-xs font-bold text-slate-600 py-1 px-1 border border-slate-200 bg-white rounded focus:outline-none focus:ring-2 focus:ring-indigo-400 hover:border-indigo-300 cursor-pointer"
                    >
                        <option value="UYU">UYU</option>
                        <option value="USD">USD</option>
                    </select>
                ) : (
                    <div className="w-full text-xs font-bold text-slate-500 py-1 border border-transparent select-none bg-slate-50 rounded">
                        {line.Moneda || 'UYU'}
                    </div>
                )}
            </td>
            {/* Desglose: lista / descuento / recargo (congelado en el pedido o recién calculado).
                Si el precio se tipeó a mano, la diferencia contra la lista se muestra como ajuste
                manual (igual que la guarda el backend). */}
            {(() => {
                const r4v = n => Math.round((Number(n || 0) + Number.EPSILON) * 10000) / 10000;
                const r2v = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
                let lista = line.PrecioLista != null && line.PrecioLista !== '' ? parseFloat(line.PrecioLista) : null;
                const pu = parseFloat(line.PrecioUnitario) || 0;
                let descImp = line.DescuentoImporte != null && line.DescuentoImporte !== '' ? (parseFloat(line.DescuentoImporte) || 0) : 0;
                let recImp = line.RecargoImporte != null && line.RecargoImporte !== '' ? (parseFloat(line.RecargoImporte) || 0) : 0;
                let descPct = line.DescuentoPct != null && line.DescuentoPct !== '' ? parseFloat(line.DescuentoPct) : null;
                let recPct = line.RecargoPct != null && line.RecargoPct !== '' ? parseFloat(line.RecargoPct) : null;
                let descTxt = line.DescuentoOrigen && line.DescuentoOrigen !== '-' ? line.DescuentoOrigen : '';
                let recTxt = line.RecargoOrigen && line.RecargoOrigen !== '-' ? line.RecargoOrigen : '';
                const esManual = /Edici[oó]n manual|Agregado manualmente/i.test(String(line.PricingTrace || ''));
                // "lista manual": la lista ES el precio tipeado (línea sin catálogo). Retipear el
                // precio mueve la lista, no genera descuento ni recargo.
                let dj = line.DesgloseJSON;
                if (typeof dj === 'string') { try { dj = JSON.parse(dj); } catch { dj = null; } }
                const listaManual = !!(dj && dj.listaManual);
                if (!(lista > 0) || (listaManual && esManual)) {
                    lista = esManual && pu > 0 ? pu : (lista > 0 ? lista : null); descImp = 0; recImp = 0; descPct = null; recPct = null; descTxt = ''; recTxt = '';
                } else if (esManual) {
                    const diff = r4v(lista + recImp - pu);
                    if (diff >= 0) { descImp = diff; descPct = null; descTxt = diff > 0 ? 'Ajuste manual' : ''; }
                    else { descImp = 0; descPct = null; descTxt = ''; recImp = r4v(recImp - diff); recPct = null; recTxt = 'Ajuste manual'; }
                }
                const fmt2 = n => (Number(n) || 0).toFixed(2);
                const editable = puedoEditarValores && lista > 0;
                // Edición del desglose: la lista queda fija; se cambia descuento y/o recargo (en %
                // sobre la lista o en importe por unidad) y el precio unitario se recalcula:
                // precio = lista − descuento + recargo. El importe del descuento absorbe el redondeo.
                const editarDesglose = (cambios) => {
                    const L = lista;
                    let dPct = cambios.descPct !== undefined ? cambios.descPct : (cambios.descImp !== undefined ? null : descPct);
                    let dImp = cambios.descImp !== undefined ? cambios.descImp : (cambios.descPct !== undefined ? r4v(L * cambios.descPct / 100) : descImp);
                    let rPct = cambios.recPct !== undefined ? cambios.recPct : (cambios.recImp !== undefined ? null : recPct);
                    let rImp = cambios.recImp !== undefined ? cambios.recImp : (cambios.recPct !== undefined ? r4v(L * cambios.recPct / 100) : recImp);
                    dImp = Math.max(0, r4v(dImp)); rImp = Math.max(0, r4v(rImp));
                    if (dPct == null && dImp > 0) dPct = r4v(dImp / L * 100);
                    if (rPct == null && rImp > 0) rPct = r4v(rImp / L * 100);
                    const nuevoPU = Math.max(0, r2v(L - dImp + rImp));
                    if (dImp > 0) dImp = Math.max(0, r4v(L + rImp - nuevoPU)); else rImp = Math.max(0, r4v(nuevoPU - L));
                    const cambioDesc = Math.abs(dImp - descImp) > 0.00005 || (dPct != null && descPct != null && Math.abs(dPct - descPct) > 0.00005);
                    const cambioRec = Math.abs(rImp - recImp) > 0.00005 || (rPct != null && recPct != null && Math.abs(rPct - recPct) > 0.00005);
                    const qty = parseFloat(line.Cantidad) || 0;
                    onChange({
                        ...line,
                        PrecioLista: L,
                        PrecioUnitario: nuevoPU, PrecioUnitarioOriginal: nuevoPU, SubtotalOriginal: qty * nuevoPU, MonedaOriginal: line.Moneda || 'UYU',
                        DescuentoTipo: dImp > 0 ? (dPct != null ? 'PCT' : 'MANUAL') : null,
                        DescuentoPct: dImp > 0 ? dPct : null,
                        DescuentoImporte: dImp > 0 ? dImp : null,
                        DescuentoOrigen: dImp > 0 ? (cambioDesc ? 'Ajuste manual en la cotización' : (line.DescuentoOrigen || null)) : null,
                        DescuentoPerfilId: dImp > 0 && !cambioDesc ? (line.DescuentoPerfilId ?? null) : null,
                        DescuentoReglaId: dImp > 0 && !cambioDesc ? (line.DescuentoReglaId ?? null) : null,
                        RecargoPct: rImp > 0 ? rPct : null,
                        RecargoImporte: rImp > 0 ? rImp : null,
                        RecargoOrigen: rImp > 0 ? (cambioRec ? 'Ajuste manual en la cotización' : (line.RecargoOrigen || null)) : null,
                        DesgloseJSON: listaManual ? { listaManual: true } : (line.DesgloseJSON ?? null),
                        PerfilAplicado: line.PerfilAplicado || 'Manual',
                        PricingTrace: 'Desglose editado a mano',
                        _precioTipeado: true
                    });
                };
                const inCls = "w-14 text-right text-[11px] font-mono border border-slate-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 hover:border-indigo-300";
                // Con permiso: % e importe editables. Sin permiso: solo % e importe (el nombre del
                // perfil/regla va en Origen; el texto que verá el cliente, al pasar el mouse).
                const celda = (imp, pct, txt, color, k) => (editable
                    ? (
                        <div className="flex flex-col items-end gap-0.5" title={txt ? `En la factura: ${txt}` : (k === 'desc' ? 'Descuento sobre la lista: % o importe por unidad' : 'Recargo sobre la lista: % o importe por unidad')}>
                            <div className="flex items-center gap-0.5">
                                <input type="number" min="0" step="any" placeholder="0" value={pct != null && imp > 0.00005 ? fmtPctUI(pct) : ''}
                                    onChange={e => editarDesglose(k === 'desc' ? { descPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) } : { recPct: Math.max(0, parseFloat(e.target.value) || 0) })}
                                    className={`${inCls} ${color}`} />
                                <span className="text-[9px] font-bold text-slate-400 w-3">%</span>
                            </div>
                            <div className="flex items-center gap-0.5">
                                <input type="number" min="0" step="any" placeholder="0" value={imp > 0.00005 ? fmt2(imp) : ''}
                                    onChange={e => editarDesglose(k === 'desc' ? { descImp: parseFloat(e.target.value) || 0 } : { recImp: parseFloat(e.target.value) || 0 })}
                                    className={`${inCls} text-slate-700`} />
                                <span className="text-[9px] font-bold text-slate-400 w-3">$</span>
                            </div>
                        </div>
                    )
                    : (imp > 0.00005
                        ? (
                            <div className="leading-tight" title={txt ? `En la factura: ${txt}` : undefined}>
                                <div className={`text-[10px] font-bold ${color}`}>{pct != null ? `${fmtPctUI(pct)} %` : '—'}</div>
                                <div className="font-mono text-xs text-slate-700">{fmt2(imp)}</div>
                            </div>
                        )
                        : <span className="text-slate-300">{'—'}</span>));
                return (
                    <>
                        <td className="px-2 py-2.5 w-20 text-right font-mono text-xs text-slate-600" title={listaManual ? 'Lista = precio tipeado (línea sin catálogo)' : 'Precio de lista (antes de descuentos y recargos)'}>
                            {lista != null ? fmt2(lista) : <span className="text-slate-300">{'—'}</span>}
                        </td>
                        <td className="px-2 py-2.5 w-24 text-right">{celda(descImp, descPct, descTxt, 'text-emerald-600', 'desc')}</td>
                        <td className="px-2 py-2.5 w-24 text-right">{celda(recImp, recPct, recTxt, 'text-amber-600', 'rec')}</td>
                    </>
                );
            })()}
            {/* Precio Unit. */}
            <td className="px-2 py-2.5 w-24 text-right">
                <input type="number" min="0" step="0.01"
                    disabled={!puedoEditarValores}
                    value={line.PrecioUnitario}
                    onChange={e => {
                        const newP = e.target.value;
                        const numP = parseFloat(newP) || 0;
                        const qty = parseFloat(line.Cantidad) || 0;
                        // el precio tipeado está en la moneda de la línea: el "original" pasa a ser esa moneda.
                        // Una línea que nació en $0 (no facturable por defecto) pasa a facturable al ponerle precio;
                        // una destildada a mano con importe se respeta.
                        const naciaEnCero = ((parseFloat(line.Cantidad) || 0) * (parseFloat(line.PrecioUnitario) || 0)) === 0;
                        const fact = (!esHermanaConsolidada && line.EsFacturable === false && naciaEnCero && qty * numP !== 0) ? { EsFacturable: true } : {};
                        onChange({ ...line, ...fact, PrecioUnitario: newP, PrecioUnitarioOriginal: numP, SubtotalOriginal: qty * numP, MonedaOriginal: line.Moneda || 'UYU', PricingTrace: 'Edición manual', _precioTipeado: true });
                    }}
                    className={`w-full min-w-[72px] text-right text-sm font-mono border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400
                        ${puedoEditarValores ? 'border-slate-200 bg-white hover:border-indigo-300 group-hover:border-slate-300' : 'border-transparent bg-transparent cursor-not-allowed text-slate-500'}`}
                />
            </td>
            {/* Subtotal Original */}
            <td className="px-3 py-2.5 w-24 text-right font-bold font-mono text-slate-600 text-[13px]">
                {/* un precio tipeado está en la moneda de la línea, aunque el artículo tenga otra moneda base */}
                {(/Edici[oó]n manual|Agregado manualmente|Desglose editado/i.test(String(line.PricingTrace || '')) ? line.Moneda : (line.MonedaOriginal || line.Moneda))} {(parseFloat(line.SubtotalOriginal) || subtotal || 0).toFixed(2)}
            </td>
            {/* Subtotal Final */}
            <td className="px-3 py-2.5 w-28 text-right font-black font-mono text-indigo-700 text-sm bg-indigo-50/50">
                {(monedaFinal === 'USD' 
                    ? (line.Moneda === 'UYU' ? subtotal / (cotizacion || 40) : subtotal)
                    : (line.Moneda === 'USD' ? subtotal * (cotizacion || 40) : subtotal)
                ).toFixed(2)}
            </td>
            {/* Perfil & Tracking */}
            <td className="px-3 py-2.5 text-center">
                <div className="flex flex-col items-center justify-center gap-1.5">
                    {line.PerfilAplicado && line.PerfilAplicado !== 'Manual' ? (
                        <span className="text-[10px] uppercase font-bold bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm text-slate-600 leading-none">
                            {line.PerfilAplicado}
                        </span>
                    ) : (
                        <span className="text-[10px] uppercase font-bold text-orange-400">Manual</span>
                    )}
                    
                    {(() => {
                        // Con desglose estructurado ya no hace falta el texto del motor: se muestra
                        // cuántas reglas más compitieron (detalle al pasar el mouse). Sin desglose
                        // (pedidos viejos) se sigue mostrando el texto de siempre.
                        let dj = line.DesgloseJSON;
                        if (typeof dj === 'string') { try { dj = JSON.parse(dj); } catch { dj = null; } }
                        const cands = dj && Array.isArray(dj.candidatos) ? dj.candidatos : null;
                        if (!cands) {
                            return line.PricingTrace ? (
                                <div className="text-[9px] text-slate-500 italic max-w-[140px] leading-tight text-center whitespace-pre-wrap opacity-80"
                                     dangerouslySetInnerHTML={{ __html: line.PricingTrace }}>
                                </div>
                            ) : null;
                        }
                        const perdieron = cands.filter(c => !c.gano);
                        if (!perdieron.length) return null;
                        const tip = 'También aplicaba: ' + perdieron.map(c => `${c.perfil} · ${c.tipo} ${c.valor}${c.minimo > 1 ? ` (mín. ${c.minimo})` : ''}`).join('; ');
                        return <div className="text-[9px] text-slate-400 max-w-[140px] leading-tight text-center cursor-help" title={tip}>{perdieron.length} regla(s) más evaluada(s)</div>;
                    })()}
                </div>
            </td>
            {/* Facturable: si la línea sale o no en la factura/CFE real del cliente — por
                defecto sigue el cálculo automático (no hermana consolidada y subtotal != 0,
                ver erpSyncService.js), pero se puede pisar a mano acá (ej. una línea en $0
                que SÍ se quiere mostrar, o una con importe que NO se quiere facturar). */}
            <td className="px-3 py-2.5 text-center w-16">
                <input
                    type="checkbox"
                    checked={line.EsFacturable != null ? !!line.EsFacturable : (!esHermanaConsolidada && subtotal !== 0)}
                    disabled={!puedeEditarBase}
                    onChange={(e) => onChange({ ...line, EsFacturable: e.target.checked })}
                    title="Si esta línea sale en la factura/CFE del cliente"
                    className="w-4 h-4 accent-indigo-600 disabled:opacity-40"
                />
            </td>
            {/* Eliminar */}
            <td className="px-3 py-2.5 text-center w-10">
                {puedoEditar && (
                    <button onClick={() => onDelete(line._tempId)}
                        className="text-slate-300 hover:text-red-500 bg-transparent hover:bg-red-50 p-1.5 rounded-full transition-all opacity-0 group-hover:opacity-100">
                        <i className="fa-solid fa-trash-can text-xs" />
                    </button>
                )}
            </td>
        </tr>
    );
}

// ─── Modal Principal ────────────────────────────────────────────────────────
// permitirReconstruir: muestra el botón "Reconstruir líneas" (rearma TODAS las líneas del
// pedido desde el origen real). Va APAGADO por defecto: en las bandejas de las áreas no
// tiene por qué estar — es una herramienta de Prendas (PRO), Logística y Administración de
// Órdenes, que son las que lo prenden explícitamente.
export default function QuotationEditModal({ noDocERP, onClose, onSaved, currentUser, areaFilter, embedded = false, readOnly = false, propagarADeposito = false, permitirReconstruir = false }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [cabecera, setCabecera] = useState(null);
    const [lineas, setLineas] = useState([]);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [activeProductSearch, setActiveProductSearch] = useState(null); // null, 'add'
    const [cotizacion, setCotizacion] = useState(40); // Backup default
    const [allProducts, setAllProducts] = useState([]);
    const [recalculating, setRecalculating] = useState(false);
    // "Comprar y personalizar": la línea de PRO trae, tal como vino del server, la suma de
    // las hermanas YA horneada adentro (erpSyncService la consolida ahí). Para poder editar
    // cada hermana con la producción real de su área y que el total de PRO lo refleje, hay
    // que saber cuánto de PRO era "las hermanas" al momento de cargar — este ref guarda esa
    // foto (en la moneda de PRO) y no cambia aunque el usuario edite después.
    const sumaHermanasAlCargarRef = useRef({ porMoneda: {} });
    // [PRENDAS] Modo de facturación del pedido (CONSOLIDADO / POR_AREA / PRECIO_ESTABLECIDO),
    // solo aplica a pedidos con orden madre PRO — ver quotationController.getQuotation.
    const [tieneOrdenMadrePro, setTieneOrdenMadrePro] = useState(false);
    const [modoFacturacion, setModoFacturacion] = useState('CONSOLIDADO');
    const [precioEstMonto, setPrecioEstMonto] = useState('');
    const [precioEstMoneda, setPrecioEstMoneda] = useState('UYU');
    // [PRENDAS] Por defecto la tabla solo muestra las líneas que van a salir en la factura
    // real — las de reposición/falla y las de $0 (Corte/Costura sin precio configurado, la
    // base de Producción) quedan ocultas salvo que se pida verlas, en vez de mezclarlas
    // todas siempre. "Efectiva" porque una línea recién agregada (o nunca guardada) todavía
    // no tiene EsFacturable propio — se calcula igual que el back (!hermana && subtotal!=0).
    const [mostrarTodas, setMostrarTodas] = useState(false);
    const esFacturableEfectiva = (l) => l.EsFacturable != null
        ? !!l.EsFacturable
        : (!l.EsHermanaConsolidada && ((parseFloat(l.Cantidad) || 0) * (parseFloat(l.PrecioUnitario) || 0)) !== 0);

    const userArea = currentUser?.AreaID || null;
    const isAdmin = !userArea || currentUser?.rol === 'ADMIN' || currentUser?.esAdmin;

    // PRO es la vista consolidada del pedido completo (mismo criterio que esVistaConsolidadaPro
    // más abajo) — puede tener líneas hermanas de EMB/EST adentro, así que necesita la columna
    // igual que TODOS. Sin esto, "Editar Cotización" desde el toolbar de PRO (areaFilter='PRO')
    // no tenía dónde cargar puntadas/bajadas para esas líneas.
    const showTechnicalData = areaFilter === 'EMB' || areaFilter === 'EST' || areaFilter === 'TODOS' || areaFilter?.toUpperCase() === 'PRO' || !areaFilter;

    // Carga (o recarga, ej. después de "Reconstruir líneas") la cotización completa desde el
    // mismo endpoint que arma la respuesta entera — factorizado para no duplicar esta lógica.
    const loadQuotation = useCallback(() => {
        if (!noDocERP) return;
        setLoading(true);
        return api.get(`/quotation/${encodeURIComponent(noDocERP)}`)
            .then(res => {
                setCabecera(res.data.cabecera);
                const detalle = res.data.detalle.map((l, i) => ({ ...l, _tempId: i }));
                setLineas(detalle);

                setTieneOrdenMadrePro(!!res.data.tieneOrdenMadrePro);
                if (res.data.modoFacturacion) setModoFacturacion(res.data.modoFacturacion);
                if (res.data.precioEstablecidoMonto != null) setPrecioEstMonto(String(res.data.precioEstablecidoMonto));
                if (res.data.precioEstablecidoMoneda) setPrecioEstMoneda(res.data.precioEstablecidoMoneda);

                // Foto de "cuánto de PRO son las hermanas" al momento de cargar — ver
                // declaración del ref para el porqué. Se guarda por moneda, sin convertir: la
                // conversión la hace rehornearLineaPro con la cotización vigente en cada cálculo
                // (acá la cotización del día puede no haber llegado todavía).
                sumaHermanasAlCargarRef.current = {
                    porMoneda: detalle
                        .filter(l => l.EsHermanaConsolidada)
                        .reduce((acc, h) => {
                            const mon = h.Moneda || 'UYU';
                            acc[mon] = (acc[mon] || 0) + (parseFloat(h.Cantidad) || 0) * (parseFloat(h.PrecioUnitario) || 0);
                            return acc;
                        }, {})
                };
            })
            .catch(err => setError(err.response?.data?.error || err.message))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [noDocERP]);

    // Cargar datos
    useEffect(() => {
        api.get('/quotation/search-products').then(r => setAllProducts(r.data || [])).catch(() => {});
        api.get('/contabilidad/cotizacion-hoy')
            .then(res => { if (res.data?.data?.promedio) setCotizacion(res.data.data.promedio); })
            .catch(err => console.warn('Error fetching cotizacion:', err));

        loadQuotation();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [noDocERP]);

    // [PRENDAS] "Reconstruir líneas" (14-sep-2026): vuelve a armar TODAS las líneas del
    // pedido desde el origen real (Magnitud/puntadas/bajadas de cada orden + motor de
    // precios) en vez de tener que agregarlas a mano adivinando la cantidad — mismo camino
    // que corre solo al despachar/recibir un bulto (ERPSyncService.syncFinalOrderIntegration).
    // Respeta el modo de facturación GUARDADO — si el usuario cambió el modo en la pantalla
    // pero no lo guardó todavía, se avisa antes de reconstruir con el de abajo.
    const [reconstruyendo, setReconstruyendo] = useState(false);
    const handleReconstruir = async () => {
        const confirmar = window.confirm(
            'Esto vuelve a armar TODAS las líneas del pedido desde cero: la cantidad de cada orden (metros, puntadas, piezas) y el precio, recalculados con el motor de precios real.\n\n' +
            'Usa el modo de facturación GUARDADO — si cambiaste el modo arriba y todavía no guardaste, primero guardá o se va a reconstruir con el modo anterior.\n\n' +
            'Cualquier ajuste manual que hayas hecho en una línea (precio tipeado a mano, cantidad corregida) y no hayas guardado se pierde. ¿Continuar?'
        );
        if (!confirmar) return;
        setReconstruyendo(true);
        try {
            await api.post(`/quotation/${encodeURIComponent(noDocERP)}/reconstruir`);
            await loadQuotation();
            toast.success('Líneas reconstruidas desde el origen real.');
        } catch (err) {
            toast.error('No se pudo reconstruir: ' + (err?.response?.data?.error || err.message));
        } finally {
            setReconstruyendo(false);
        }
    };

    const handleChange = useCallback((updated) => {
        setLineas(prev => prev.map(l => l._tempId === updated._tempId ? updated : l));
    }, []);

    // [PRENDAS] "Precio establecido": antes solo guardaba el marcador de texto sin tocar la
    // tabla — el usuario tenía que adivinar cómo poner el monto pactado a mano (cantidad ×
    // precio), y terminaba cobrando de más (30 × 200 = 6000 en vez de 200). Ahora, apenas se
    // activa este modo o cambia el monto/moneda, la línea de Producción se fuerza a
    // Cantidad=1 × PrecioUnitario=monto (Subtotal = monto, sin ambigüedad) y las hermanas
    // quedan marcadas como consolidadas (mismo criterio que erpSyncService.js: "hermanas
    // consolidadas sin sumar") — visible en la tabla, no recién en el próximo resync.
    const HERMANA_AREAS = ['EMB', 'DF', 'TPU', 'EST', 'TWC', 'TWT', 'SB'];
    useEffect(() => {
        if (loading || !tieneOrdenMadrePro) return;
        const monto = parseFloat(precioEstMonto) || 0;
        setLineas(prev => prev.map(l => {
            const area = (l.AreaIDInterna || l.AreaID || '').toString().toUpperCase();
            const esPro = area === 'PRO' && !l.ComboItemID;
            const esHermana = HERMANA_AREAS.includes(area);
            if (modoFacturacion === 'PRECIO_ESTABLECIDO') {
                if (esPro && monto > 0) {
                    return { ...l, Cantidad: 1, PrecioUnitario: monto, Moneda: precioEstMoneda, MonedaOriginal: precioEstMoneda, PrecioUnitarioOriginal: monto, SubtotalOriginal: monto, LogPrecioAplicado: 'Precio establecido al crear el pedido', PerfilAplicado: 'Manual', EsFacturable: true };
                }
                if (esHermana) return { ...l, EsHermanaConsolidada: true, EsFacturable: false };
            } else if (modoFacturacion === 'POR_AREA') {
                // Al volver a "Por área" se restaura la facturabilidad real de cada línea —
                // EsFacturable: null hace que se recalcule sola (backend y frontend, misma
                // regla: !hermana && subtotal!=0), con el precio/descuento que ya tenía
                // guardado de antes (nunca se tocó, solo quedó oculta). Una reposición sin
                // cargo real (subtotal=0) sigue sin facturar — no se fuerza a true a ciegas.
                if (esHermana) return { ...l, EsHermanaConsolidada: false, EsFacturable: null };
            }
            return l;
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modoFacturacion, precioEstMonto, precioEstMoneda, tieneOrdenMadrePro, loading]);

    // [PRENDAS] Freno (14-sep-2026): esta pantalla borra y reinserta TODAS las líneas del
    // pedido en cada guardado (ver sección 33/36 de specs/39) — borrar la ÚLTIMA línea y
    // guardar dejaba el pedido con una cotización vacía (MontoTotal=0, sin nada que
    // facturar) sin ningún aviso. Nunca se permite quedar en 0 líneas desde acá — para
    // vaciar un pedido de verdad hay otro camino (cancelar el pedido), no "Editar Cotización".
    const handleDelete = useCallback((tempId) => {
        setLineas(prev => {
            if (prev.length <= 1) {
                toast.error('No se puede borrar: la cotización tiene que tener al menos una línea. Si el pedido no va más, cancelalo en vez de vaciar la cotización.');
                return prev;
            }
            return prev.filter(l => l._tempId !== tempId);
        });
    }, []);

    const handleRecalculateLine = async (line) => {
        if (!line.CodArticulo) return;
        
        try {
            const res = await api.post('/prices/calculate', {
                codArticulo: line.CodArticulo,
                cantidad: line.Cantidad,
                // la línea conserva su moneda (la del pedido, o la elegida en la columna Moneda);
                // sin esto el motor devolvía la moneda base del artículo y la línea cambiaba sola
                targetCurrency: line.Moneda || undefined,
                clienteId: cabecera?.CliIdCliente || cabecera?.ClienteID || cabecera?.CodCliente,
                areaId: line.AreaIDInterna || line.AreaID,
                datoTecnicoValue: line.DatoTecnico,
                variables: { 
                    isUrgente: line.Prioridad?.toUpperCase() === 'URGENTE',
                    ordenId: line.OrdenID || line.OrdenIDExterna || null
                }
            });
            
            const cotizacionData = res.data;
            if (cotizacionData.precioUnitario !== undefined) {
                setLineas(prev => prev.map(l => {
                    if (l._tempId === line._tempId) {
                        // Evitar sobreescritura de estado si el usuario modificó cantidad o dato técnico en el intermedio
                        if (parseFloat(l.Cantidad) !== parseFloat(line.Cantidad) || parseFloat(l.DatoTecnico || 0) !== parseFloat(line.DatoTecnico || 0)) {
                            console.log(`[QuotationEditModal] Recálculo descartado para línea ${line.CodArticulo} debido a cambio de valores.`);
                            return l;
                        }
                        return {
                            ...l,
                            PrecioUnitario: cotizacionData.precioUnitario,
                            Moneda: cotizacionData.moneda || l.Moneda,
                            PrecioUnitarioOriginal: cotizacionData.precioUnitarioOriginal || cotizacionData.precioUnitario,
                            SubtotalOriginal: cotizacionData.precioTotalOriginal || cotizacionData.precioTotal,
                            MonedaOriginal: cotizacionData.monedaOriginal || cotizacionData.moneda,
                            PerfilAplicado: (cotizacionData.perfilesAplicados && cotizacionData.perfilesAplicados.length > 0) ? cotizacionData.perfilesAplicados.join(', ') : 'Precio Base',
                            PricingTrace: cotizacionData.txt || 'Recalculado automático',
                            ...desgloseALinea(cotizacionData.desglose)
                        };
                    }
                    return l;
                }));
            }
        } catch (err) {
            console.error('Error recalculating line price:', err);
        }
    };

    const handleRecalculateAll = async () => {
        setRecalculating(true);
        setError('');
        try {
            await Promise.all(lineas.map(l => handleRecalculateLine(l)));
            setSuccess('Perfiles de precio recargados y recalculados.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) {
            console.error(e);
            setError('Error al recalcular precios masivamente.');
        } finally {
            setRecalculating(false);
        }
    };

    const handlePickProduct = (product) => {
        // Intentar buscar una línea que pertenezca al área en la que estamos parados
        let targetArea = areaFilter !== 'TODOS' ? areaFilter : (product.AreaID || userArea);
        const baseLine = lineas.find(l => (l.AreaID === targetArea || l.AreaIDInterna === targetArea) && l.OrdenID) || lineas.find(l => l.OrdenID) || {};
        
        const newLine = {
            _tempId: Date.now(),
            OrdenID: baseLine.OrdenID || null,
            CodigoOrden: baseLine.CodigoOrden ? `${baseLine.CodigoOrden} (Extra)` : (cabecera?.NoDocERP ? `${cabecera.NoDocERP} (Extra)` : null),
            Prioridad: baseLine.Prioridad || 'Normal',
            CodArticulo: product.CodArticulo,
            ProIdProducto: product.ProIdProducto,
            NombreArticulo: product.Descripcion,
            DescripcionArticulo: product.Descripcion,
            Cantidad: 1,
            PrecioUnitario: product.PrecioBase || 0,
            Subtotal: product.PrecioBase || 0,
            PrecioUnitarioOriginal: product.PrecioBase || 0,
            SubtotalOriginal: product.PrecioBase || 0,
            MonedaOriginal: product.MonedaOriginal || product.Moneda || cabecera?.Moneda || 'UYU',
            Moneda: product.Moneda || cabecera?.Moneda || 'UYU',
            PerfilAplicado: 'Manual',
            PricingTrace: 'Agregado manualmente',
            AreaID: product.AreaID,
            AreaIDInterna: product.AreaID,
            // Solo para mostrar cuando el producto no tiene un AreaID real (combos/insumos
            // del catálogo general, Grupo '2.1' — no es de ningún área de producción puntual).
            // Nunca se usa como AreaID real, no hay que tratarlo como una encadenada más.
            AreaNombre: product.AreaNombre || null,
            DatoTecnico: 0
        };
        setLineas(prev => [...prev, newLine]);
        setActiveProductSearch(null);
        handleRecalculateLine(newLine);
    };

    const handlePickProductInline = (tempId, product) => {
        const existingLine = lineas.find(l => l._tempId === tempId);
        if (existingLine) {
            const newLine = {
                ...existingLine,
                CodArticulo: product.CodArticulo,
                ProIdProducto: product.ProIdProducto,
                NombreArticulo: product.Descripcion,
                DescripcionArticulo: product.Descripcion,
                AreaID: product.AreaID,
                AreaIDInterna: product.AreaID,
                PrecioUnitario: product.PrecioBase || 0,
                PrecioUnitarioOriginal: product.PrecioBase || 0,
                Moneda: product.Moneda || existingLine.Moneda || 'UYU',
                MonedaOriginal: product.MonedaOriginal || product.Moneda || 'UYU',
                PerfilAplicado: 'Manual',
                PricingTrace: 'Producto cambiado, calculando...'
            };
            handleChange(newLine);
            handleRecalculateLine(newLine);
        }
    };

    const [puntuacionAjustable, setPuntuacionAjustable] = useState({});

    // DETERMINAR MONEDA FINAL
    // USD si alguna línea FACTURABLE es USD (misma regla que el backend al guardar): las
    // hermanas "Incluido en PRO" y las líneas destildadas no se cobran y no deciden la moneda.
    const monedaFinal = useMemo(() => {
        return lineas.some(l => l.Moneda === 'USD' && !l.EsHermanaConsolidada && esFacturableEfectiva(l)) ? 'USD' : 'UYU';
    }, [lineas]);

    // Permisos y estados calculados
    // "Comprar y personalizar": las líneas hermanas (EMB/DF/TPU/EST, EsHermanaConsolidada=1)
    // son solo el DETALLE de lo que ya está sumado dentro de la línea de PRO — sumarlas de
    // nuevo acá duplicaría el total que paga el cliente.
    // Solo las líneas FACTURABLES suman (misma regla que MontoTotal en el backend): las
    // hermanas ya están dentro de PRO y una línea destildada no se le cobra al cliente.
    const totalCalculadoFinal = lineas.reduce((acc, line) => {
        if (line.EsHermanaConsolidada || !esFacturableEfectiva(line)) return acc;
        const sub = (parseFloat(line.Cantidad) || 0) * (parseFloat(line.PrecioUnitario) || 0);
        if (monedaFinal === 'USD') {
            return acc + (line.Moneda === 'UYU' ? sub / (cotizacion || 40) : sub);
        } else {
            return acc + (line.Moneda === 'USD' ? sub * (cotizacion || 40) : sub);
        }
    }, 0);

    // Total real a cobrar, reemplazando el aporte de PRO (que totalCalculadoFinal toma tal
    // cual está guardado, con la foto VIEJA de las hermanas adentro) por PRO recalculado con
    // la suma de hermanas EN VIVO — así una edición en la línea de DTF/TPU/EMB/EST (cantidad,
    // dato técnico, precio) se refleja en el total sin tener que tocar la línea de PRO a mano.
    const nuevoTotalConHermanas = useMemo(() => {
        const rebake = rehornearLineaPro(lineas, cotizacion, sumaHermanasAlCargarRef.current);
        if (!rebake) return totalCalculadoFinal; // pedido sin orden PRO: nada que rehornear
        const proContribActualEnFinal = convertirMoneda(rebake.proSubtotalActual, rebake.monedaPro, monedaFinal, cotizacion);
        const proContribRehorneadaEnFinal = convertirMoneda(rebake.subtotalRehorneado, rebake.monedaPro, monedaFinal, cotizacion);
        return totalCalculadoFinal - proContribActualEnFinal + proContribRehorneadaEnFinal;
    }, [lineas, cotizacion, monedaFinal, totalCalculadoFinal]);

    // We compare with a small epsilon to avoid float matching issues, however we are changing to USD
    // so we will always consider it a change if DB was in UYU. To simplify let's just allow save if valid.
    const hayDiferencia = lineas.length > 0;
    const lineasVisibles = mostrarTodas ? lineas : lineas.filter(esFacturableEfectiva);
    const lineasOcultas = lineas.length - lineasVisibles.length;

    const handleSave = async (forzarConfirmacion = false) => {
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            // Antes de guardar, rehornear PRO con la suma de hermanas EN VIVO — si no,
            // se persistiría el Subtotal viejo de PRO (con la foto de hermanas de cuando
            // se abrió el modal) y los cambios de cantidad/dato técnico/precio en las
            // líneas de área quedarían sin reflejarse en lo que realmente se cobra.
            const rebake = rehornearLineaPro(lineas, cotizacion, sumaHermanasAlCargarRef.current);
            const lineasParaGuardar = rebake
                ? lineas.map(l => l._tempId === rebake.tempId
                    ? { ...l, PrecioUnitario: rebake.precioUnitarioRehorneado, PrecioUnitarioOriginal: rebake.precioUnitarioRehorneado, SubtotalOriginal: rebake.subtotalRehorneado }
                    : l)
                : lineas;
            const payload = lineasParaGuardar.map(l => ({
                OrdenID: l.OrdenID,
                // Desglose (lista / descuento / recargos): vuelve tal cual salió de la base o
                // del motor; el backend lo reinserta (y marca MANUAL si el precio se tipeó).
                PrecioLista: l.PrecioLista ?? null,
                DescuentoTipo: l.DescuentoTipo ?? null,
                DescuentoPct: l.DescuentoPct ?? null,
                DescuentoImporte: l.DescuentoImporte ?? null,
                DescuentoOrigen: l.DescuentoOrigen ?? null,
                DescuentoPerfilId: l.DescuentoPerfilId ?? null,
                DescuentoReglaId: l.DescuentoReglaId ?? null,
                RecargoPct: l.RecargoPct ?? null,
                RecargoImporte: l.RecargoImporte ?? null,
                RecargoOrigen: l.RecargoOrigen ?? null,
                DesgloseJSON: l.DesgloseJSON ?? null,
                CodArticulo: l.CodArticulo,
                ProIdProducto: l.ProIdProducto,
                Cantidad: parseFloat(l.Cantidad) || 0,
                PrecioUnitario: parseFloat(l.PrecioUnitario) || 0,
                LogPrecioAplicado: l.LogPrecioAplicado || 'Manual',
                PerfilAplicado: l.PerfilAplicado || 'Manual',
                PricingTrace: l.PricingTrace || 'Edición manual',
                Moneda: l.Moneda || 'UYU',
                MonedaOriginal: l.MonedaOriginal || l.Moneda || 'UYU',
                PrecioUnitarioOriginal: parseFloat(l.PrecioUnitarioOriginal) || parseFloat(l.PrecioUnitario) || 0,
                SubtotalOriginal: parseFloat(l.SubtotalOriginal) || ((parseFloat(l.Cantidad) || 0) * (parseFloat(l.PrecioUnitarioOriginal) || parseFloat(l.PrecioUnitario) || 0)),
                DatoTecnico: parseFloat(l.DatoTecnico) || null,
                // Esta pantalla borra y re-inserta TODAS las líneas del pedido al guardar —
                // hay que mandar de vuelta el flag tal cual vino, si no el guardado "aplana"
                // la línea hermana a facturable y duplica el total.
                EsHermanaConsolidada: !!l.EsHermanaConsolidada,
                // Facturable: si el usuario la tildó/destildó a mano queda ese valor
                // explícito (true/false); si nunca la tocó (undefined) o si el cambio de
                // modo la puso en null a propósito para que se recalcule sola (ver el
                // useEffect de modoFacturacion, rama POR_AREA), viaja null y el backend
                // aplica el cálculo automático de siempre (!hermana && subtotal != 0).
                // BUG REAL (14-sep-2026): acá se coercionaba null a `!!null` = false, así
                // que volver a "Por área" mandaba TODAS las hermanas como no-facturables de
                // nuevo — la cotización se guardaba vacía (bloqueada recién por el freno
                // nuevo de "al menos una línea facturable", que fue lo que lo hizo visible).
                EsFacturable: (l.EsFacturable === undefined || l.EsFacturable === null) ? null : !!l.EsFacturable
            }));
            const resp = await api.put(`/quotation/${encodeURIComponent(noDocERP)}`, {
                lineas: payload,
                cotizacion,
                confirmado: forzarConfirmacion,
                propagarADeposito,
                ...(tieneOrdenMadrePro ? {
                    modoFacturacion,
                    precioEstablecidoMonto: modoFacturacion === 'PRECIO_ESTABLECIDO' ? (parseFloat(precioEstMonto) || 0) : null,
                    precioEstablecidoMoneda: precioEstMoneda,
                } : {})
            });
            // El backend también baja el precio nuevo a depósito/caja, pero SOLO en las
            // órdenes que ya están en depósito y todavía no se facturaron. Se dice cuál fue
            // el resultado real en vez de dejarlo en "los importes fueron actualizados".
            const dep = resp?.data?.deposito || null;
            const actualizadas = dep?.actualizadas || 0;
            const facturadas = (dep?.detalle || []).filter(d => d.motivo === 'FACTURADA').map(d => d.codigoOrden);
            const entregadas = (dep?.detalle || []).filter(d => d.motivo === 'ENTREGADA').map(d => d.codigoOrden);
            const cobradas = (dep?.detalle || []).filter(d => d.motivo === 'COBRADA').map(d => d.codigoOrden);
            let msg = '✅ Cotización guardada. El QR y los importes fueron actualizados.';
            if (actualizadas > 0) {
                msg += ` También se actualizó el precio en depósito/caja de ${actualizadas} ${actualizadas === 1 ? 'orden' : 'órdenes'}.`;
            }
            if (facturadas.length > 0) {
                msg += ` ${facturadas.join(', ')} ya está${facturadas.length === 1 ? '' : 'n'} facturada${facturadas.length === 1 ? '' : 's'}: ahí el precio de depósito NO se tocó.`;
            }
            // Mismo aviso para entregada/cobrada: sin esto la cotización decía "guardado
            // y actualizado" sin aclarar que el precio de depósito/caja quedó intacto a
            // propósito (freno 14-sep-2026) — el usuario lo probó en vivo con PRO-20938
            // (ya entregada) y no vio ningún aviso de por qué nada cambió ahí.
            if (entregadas.length > 0) {
                msg += ` ${entregadas.join(', ')} ya fue${entregadas.length === 1 ? '' : 'n'} entregada${entregadas.length === 1 ? '' : 's'}: ahí el precio de depósito/caja NO se tocó.`;
            }
            if (cobradas.length > 0) {
                msg += ` ${cobradas.join(', ')} ya fue${cobradas.length === 1 ? '' : 'n'} cobrada${cobradas.length === 1 ? '' : 's'}: ahí el precio de depósito/caja NO se tocó.`;
            }
            setSuccess(msg);
            if (onSaved) onSaved();
        } catch (err) {
            if (err.response?.status === 409 && err.response?.data?.requiereConfirmacion) {
                const advertencias = err.response.data.advertencias || [];
                const detalle = advertencias.map(a => `• ${a.mensaje}`).join('\n');
                setSaving(false);
                const confirmar = window.confirm(
                    `Esta orden ya avanzó de estado:\n\n${detalle}\n\n¿Confirmás modificar la cotización de todas formas? ` +
                    `Se va a actualizar el importe en depósito/retiro/cuenta corriente.`
                );
                if (confirmar) {
                    return handleSave(true);
                }
                setError('Guardado cancelado por el usuario.');
                return;
            }
            setError(err.response?.data?.error || err.message);
        } finally {
            setSaving(false);
        }
    };

    if (embedded) {
        return (
            <div className="flex flex-col h-full w-full bg-white rounded-xl shadow-sm overflow-hidden border border-slate-200">
                {/* Header embedded */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-white shrink-0">
                    <div>
                        <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-file-invoice-dollar text-indigo-600" />
                            Tracking y Edición de Cotización
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5 font-mono font-bold">{noDocERP}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={handleRecalculateAll} 
                            disabled={recalculating || loading}
                            className={`px-3 py-1.5 text-xs font-bold rounded shadow-sm flex items-center gap-1.5 transition-all mt-1 border
                                ${recalculating ? 'text-indigo-600 bg-indigo-50 border-indigo-200 cursor-wait' : 'text-slate-600 hover:text-indigo-600 bg-slate-50 border-slate-200 hover:border-indigo-300'}`}
                            title="Recargar precios según base de datos"
                        >
                            {recalculating ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-cloud-arrow-down" />}
                            {recalculating ? 'Recalculando...' : 'Recargar Precios'}
                        </button>
                        {!readOnly && permitirReconstruir && (
                            <button
                                onClick={handleReconstruir}
                                disabled={reconstruyendo || loading}
                                className={`px-3 py-1.5 text-xs font-bold rounded shadow-sm flex items-center gap-1.5 transition-all mt-1 border
                                    ${reconstruyendo ? 'text-amber-600 bg-amber-50 border-amber-200 cursor-wait' : 'text-slate-600 hover:text-amber-600 bg-slate-50 border-slate-200 hover:border-amber-300'}`}
                                title="Volver a armar TODAS las líneas desde el origen real (cantidad y precio de cada orden), según el modo de facturación guardado"
                            >
                                {reconstruyendo ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-arrows-rotate" />}
                                {reconstruyendo ? 'Reconstruyendo...' : 'Reconstruir líneas'}
                            </button>
                        )}
                        {cabecera && (
                            <div className="text-right border-l pl-4 ml-2 border-slate-200">
                                <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Cotización USD</div>
                                <div className="text-base font-black text-slate-700 font-mono"><span className="text-sm text-slate-400 font-normal mr-1">UYU</span>{cotizacion?.toFixed(2)}</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">

                    {loading && (
                        <div className="flex justify-center items-center py-20">
                            <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-300" />
                        </div>
                    )}

                    {!loading && error && (
                        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg mb-4 font-medium text-sm">
                            ⚠️ {error}
                        </div>
                    )}

                    {!loading && success && (
                        <div className="bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 px-4 py-3 rounded-lg mb-4 font-medium text-sm">
                            {success}
                        </div>
                    )}

                    {/* Aviso de permisos */}
                    {!loading && !isAdmin && userArea && (
                        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
                            <i className="fa-solid fa-shield-halved" />
                            Área <strong>{userArea}</strong> — solo podés modificar las líneas de tu área.
                        </div>
                    )}

                    {!loading && (
                        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                            <table className="w-full text-sm text-left min-w-[800px]">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center w-20">Área</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase">Producto</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase">Orden</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Cantidad</th>
                                        {showTechnicalData && (
                                            <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24 line-clamp-1" title="Dato Técnico">Dato Téc.</th>
                                        )}
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-center w-20" title="Moneda de cada línea (se puede cambiar). El pedido queda en USD si alguna línea FACTURABLE es USD; las incluidas en PRO no deciden.">Moneda</th>
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-20" title="Precio de lista (antes de descuentos y recargos)">P. Lista</th>
                                        <th className="px-2 py-3 text-xs font-bold text-emerald-600 uppercase text-right w-20" title="Descuento aplicado: % e importe por unidad (el nombre del perfil o regla está en Origen)">Descuento</th>
                                        <th className="px-2 py-3 text-xs font-bold text-amber-600 uppercase text-right w-20" title="Recargos aplicados (urgencia, tinta): % e importe por unidad (el nombre del perfil está en Origen)">Recargo</th>
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24" title="Precio neto por unidad = lista − descuento + recargo">Precio U.</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Subtotal</th>
                                        <th className="px-3 py-3 text-xs font-bold text-indigo-500 uppercase text-right w-28 bg-indigo-50/50">En {monedaFinal}</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center" title="Perfil o excepción que fijó el precio">Origen</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center w-16" title="Si la línea sale en la factura/CFE del cliente">Facturable</th>
                                        <th className="px-3 py-3 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineas.map(line => (
                                        <LineRow
                                            key={line._tempId}
                                            line={line}
                                            userArea={userArea}
                                            isAdmin={isAdmin}
                                            areaFilter={areaFilter}
                                            modoFacturacion={modoFacturacion}
                                            cotizacion={cotizacion}
                                            monedaFinal={monedaFinal}
                                            onChange={handleChange}
                                            onDelete={handleDelete}
                                            onRecalculate={handleRecalculateLine}
                                            allProducts={allProducts}
                                            onProductChange={handlePickProductInline}
                                            showTechnicalData={showTechnicalData}
                                            showOrderColumn={true}
                                            readOnly={readOnly}
                                        />
                                    ))}

                                    {/* Botón + Agregar Línea */}
                                    {!readOnly && activeProductSearch === null && (
                                        <tr>
                                            <td colSpan={showTechnicalData ? 9 : 8} className="px-3 py-2 border-t border-dashed border-slate-200">
                                                <button
                                                    onClick={() => setActiveProductSearch('add')}
                                                    className="flex items-center gap-2 text-sm font-semibold text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-all"
                                                >
                                                    <i className="fa-solid fa-plus-circle" />
                                                    Agregar línea
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Modal buscador de producto para nueva línea */}
                    {activeProductSearch === 'add' && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 ">
                            <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden border border-slate-200">
                                <ProductSearchPanel
                                    onSelect={handlePickProduct}
                                    onCancel={() => setActiveProductSearch(null)}
                                    // Sin restricción de área en dos casos: la vista "TODOS" (cotización
                                    // del pedido completo, abierta desde la Bandeja de Producción) y la
                                    // vista "PRO" (misma idea, pero abierta desde el botón "Editar
                                    // Cotización" del área — ver AreaView.jsx → QuotationView → acá,
                                    // mismo criterio que ya usa esVistaConsolidadaPro más abajo para
                                    // EDITAR líneas existentes). Sin esto, "Agregar línea" desde PRO
                                    // filtraba el catálogo a AreaID='PRO' (que no tiene productos
                                    // propios) y siempre daba "Sin productos disponibles".
                                    isAdmin={isAdmin || areaFilter === 'TODOS' || areaFilter?.toUpperCase() === 'PRO'}
                                    userArea={userArea}
                                    forceArea={(areaFilter !== 'TODOS' && areaFilter?.toUpperCase() !== 'PRO') ? areaFilter : null}
                                />
                            </div>
                        </div>
                    )}

                    {/* Total calculado */}
                    {!loading && (
                        <div className="flex flex-col items-end gap-1 mt-3">
                            <div className={`px-5 py-2 rounded-xl border font-bold font-mono text-lg shadow-sm transition-colors text-emerald-800 bg-emerald-50 border-emerald-200`}>
                                Nuevo Total: {monedaFinal} {nuevoTotalConHermanas.toFixed(2)}
                            </div>
                            <p className="text-[10px] text-slate-400 pr-1">
                                Suma solo las líneas facturables.
                                {lineas.some(l => l.EsHermanaConsolidada) && (
                                    lineas.some(l => (l.AreaIDInterna || l.AreaID) === 'PRO' && !l.ComboItemID && l._precioTipeado)
                                        ? ' El precio de Producción lo tipeaste vos: es el precio final, no se le suma nada encima.'
                                        : ' Incluye las personalizaciones (DTF/TPU/EMB/EST) con los valores actuales de cada línea.'
                                )}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-end shrink-0 gap-3">
                    {!readOnly && (
                        <button onClick={() => handleSave()} disabled={saving || loading}
                            className={`px-8 py-2.5 rounded-lg font-bold text-white text-sm transition-all shadow-md flex items-center gap-2
                                ${saving ? 'bg-indigo-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-200 hover:scale-105 active:scale-95'}`}>
                            {saving
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Guardando...</>
                                : <><i className="fa-solid fa-floppy-disk" /> Guardar Cotización</>}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60  p-4">
            <div className="bg-white w-full max-w-[95vw] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-white shrink-0">
                    <div>
                        <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-file-invoice-dollar text-indigo-600" />
                            Confirmación de Cotización
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5 font-mono font-bold">{noDocERP}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={handleRecalculateAll} 
                            disabled={recalculating || loading}
                            className={`px-3 py-1.5 text-xs font-bold rounded shadow-sm flex items-center gap-1.5 transition-all mt-1 border
                                ${recalculating ? 'text-indigo-600 bg-indigo-50 border-indigo-200 cursor-wait' : 'text-slate-600 hover:text-indigo-600 bg-slate-50 border-slate-200 hover:border-indigo-300'}`}
                            title="Recargar precios según base de datos"
                        >
                            {recalculating ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-cloud-arrow-down" />}
                            {recalculating ? 'Recalculando...' : 'Recargar Precios'}
                        </button>
                        {!readOnly && permitirReconstruir && (
                            <button
                                onClick={handleReconstruir}
                                disabled={reconstruyendo || loading}
                                className={`px-3 py-1.5 text-xs font-bold rounded shadow-sm flex items-center gap-1.5 transition-all mt-1 border
                                    ${reconstruyendo ? 'text-amber-600 bg-amber-50 border-amber-200 cursor-wait' : 'text-slate-600 hover:text-amber-600 bg-slate-50 border-slate-200 hover:border-amber-300'}`}
                                title="Volver a armar TODAS las líneas desde el origen real (cantidad y precio de cada orden), según el modo de facturación guardado"
                            >
                                {reconstruyendo ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-arrows-rotate" />}
                                {reconstruyendo ? 'Reconstruyendo...' : 'Reconstruir líneas'}
                            </button>
                        )}
                        {cabecera && (
                            <div className="text-right border-l pl-4 ml-2 border-slate-200">
                                <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Cotización USD</div>
                                <div className="text-base font-black text-slate-700 font-mono"><span className="text-sm text-slate-400 font-normal mr-1">UYU</span>{cotizacion?.toFixed(2)}</div>
                            </div>
                        )}
                        <button onClick={onClose} className="text-slate-400 hover:text-white hover:bg-red-500 bg-slate-100 rounded-full w-9 h-9 flex items-center justify-center transition-all shadow-sm border border-slate-200 border-transparent">
                            <i className="fa-solid fa-times" />
                        </button>
                    </div>
                </div>

                {/* [PRENDAS] Modo de facturación: solo aplica a pedidos con orden madre PRO
                    ("comprar y personalizar") — un pedido normal no tiene "modo", cotiza
                    orden por orden y este selector no tendría nada que hacer. */}
                {tieneOrdenMadrePro && !loading && (
                    <div className="px-6 py-3 border-b bg-slate-50 flex flex-wrap items-center gap-3 shrink-0">
                        <span className="text-xs font-bold text-slate-500 uppercase">Modo de facturación</span>
                        <div className="flex gap-1.5">
                            {[
                                ['CONSOLIDADO', 'Consolidado (un solo total en Producción)'],
                                ['POR_AREA', 'Por área (cada línea cobra la suya)'],
                                ['PRECIO_ESTABLECIDO', 'Precio establecido (monto fijo pactado)'],
                            ].map(([valor, texto]) => (
                                <button
                                    key={valor}
                                    disabled={readOnly}
                                    onClick={() => setModoFacturacion(valor)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${modoFacturacion === valor
                                        ? 'bg-indigo-600 border-indigo-600 text-white'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}`}
                                >
                                    {texto}
                                </button>
                            ))}
                        </div>
                        {modoFacturacion === 'PRECIO_ESTABLECIDO' && (
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="number" min="0" step="0.01"
                                    value={precioEstMonto}
                                    disabled={readOnly}
                                    onChange={(e) => setPrecioEstMonto(e.target.value)}
                                    placeholder="Monto"
                                    className="w-24 px-2 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                                />
                                <select
                                    value={precioEstMoneda}
                                    disabled={readOnly}
                                    onChange={(e) => setPrecioEstMoneda(e.target.value)}
                                    className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg font-bold"
                                >
                                    <option value="UYU">UYU</option>
                                    <option value="USD">USD</option>
                                </select>
                            </div>
                        )}
                    </div>
                )}

                {/* Filtro de líneas: por defecto solo las que van a la factura real — las de
                    reposición/falla y las de $0 quedan afuera salvo que se pidan ver. */}
                {!loading && lineas.length > 0 && (
                    <div className="px-6 py-2 border-b bg-white flex items-center gap-3 shrink-0 text-xs">
                        <label className="flex items-center gap-1.5 font-bold text-slate-600 cursor-pointer">
                            <input type="checkbox" checked={mostrarTodas} onChange={(e) => setMostrarTodas(e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600" />
                            Mostrar todas las líneas
                        </label>
                        {!mostrarTodas && lineasOcultas > 0 && (
                            <span className="text-slate-400">{lineasOcultas} línea(s) sin facturar ocultas (reposición/falla, $0)</span>
                        )}
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">

                    {loading && (
                        <div className="flex justify-center items-center py-20">
                            <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-300" />
                        </div>
                    )}

                    {!loading && error && (
                        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg mb-4 font-medium text-sm">
                            ⚠️ {error}
                        </div>
                    )}

                    {!loading && success && (
                        <div className="bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 px-4 py-3 rounded-lg mb-4 font-medium text-sm">
                            {success}
                        </div>
                    )}

                    {/* Aviso de permisos */}
                    {!loading && !isAdmin && userArea && (
                        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
                            <i className="fa-solid fa-shield-halved" />
                            Área <strong>{userArea}</strong> — solo podés modificar las líneas de tu área.
                        </div>
                    )}

                    {!loading && (
                        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center w-20">Área</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase">Producto</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Cantidad</th>
                                        {showTechnicalData && (
                                            <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24 line-clamp-1" title="Dato Técnico">Dato Téc.</th>
                                        )}
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-center w-20" title="Moneda de cada línea (se puede cambiar). El pedido queda en USD si alguna línea FACTURABLE es USD; las incluidas en PRO no deciden.">Moneda</th>
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-20" title="Precio de lista (antes de descuentos y recargos)">P. Lista</th>
                                        <th className="px-2 py-3 text-xs font-bold text-emerald-600 uppercase text-right w-20" title="Descuento aplicado: % e importe por unidad (el nombre del perfil o regla está en Origen)">Descuento</th>
                                        <th className="px-2 py-3 text-xs font-bold text-amber-600 uppercase text-right w-20" title="Recargos aplicados (urgencia, tinta): % e importe por unidad (el nombre del perfil está en Origen)">Recargo</th>
                                        <th className="px-2 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24" title="Precio neto por unidad = lista − descuento + recargo">Precio U.</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-right w-24">Subtotal</th>
                                        <th className="px-3 py-3 text-xs font-bold text-indigo-500 uppercase text-right w-28 bg-indigo-50/50">En {monedaFinal}</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center" title="Perfil o excepción que fijó el precio">Origen</th>
                                        <th className="px-3 py-3 text-xs font-bold text-slate-400 uppercase text-center w-16" title="Si la línea sale en la factura/CFE del cliente">Facturable</th>
                                        <th className="px-3 py-3 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineasVisibles.map(line => (
                                        <LineRow
                                            key={line._tempId}
                                            line={line}
                                            userArea={userArea}
                                            isAdmin={isAdmin}
                                            areaFilter={areaFilter}
                                            modoFacturacion={modoFacturacion}
                                            cotizacion={cotizacion}
                                            monedaFinal={monedaFinal}
                                            onChange={handleChange}
                                            onDelete={handleDelete}
                                            onRecalculate={handleRecalculateLine}
                                            allProducts={allProducts}
                                            onProductChange={handlePickProductInline}
                                            showTechnicalData={showTechnicalData}
                                            showOrderColumn={false}
                                            readOnly={readOnly}
                                        />
                                    ))}

                                    {/* Botón + Agregar Línea */}
                                    {!readOnly && activeProductSearch === null && (
                                        <tr>
                                            <td colSpan={showTechnicalData ? 9 : 8} className="px-3 py-2 border-t border-dashed border-slate-200">
                                                <button
                                                    onClick={() => setActiveProductSearch('add')}
                                                    className="flex items-center gap-2 text-sm font-semibold text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-all"
                                                >
                                                    <i className="fa-solid fa-plus-circle" />
                                                    Agregar línea
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Modal buscador de producto para nueva línea */}
                    {activeProductSearch === 'add' && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 ">
                            <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden border border-slate-200">
                                <ProductSearchPanel
                                    onSelect={handlePickProduct}
                                    onCancel={() => setActiveProductSearch(null)}
                                    // Sin restricción de área en dos casos: la vista "TODOS" (cotización
                                    // del pedido completo, abierta desde la Bandeja de Producción) y la
                                    // vista "PRO" (misma idea, pero abierta desde el botón "Editar
                                    // Cotización" del área — ver AreaView.jsx → QuotationView → acá,
                                    // mismo criterio que ya usa esVistaConsolidadaPro más abajo para
                                    // EDITAR líneas existentes). Sin esto, "Agregar línea" desde PRO
                                    // filtraba el catálogo a AreaID='PRO' (que no tiene productos
                                    // propios) y siempre daba "Sin productos disponibles".
                                    isAdmin={isAdmin || areaFilter === 'TODOS' || areaFilter?.toUpperCase() === 'PRO'}
                                    userArea={userArea}
                                    forceArea={(areaFilter !== 'TODOS' && areaFilter?.toUpperCase() !== 'PRO') ? areaFilter : null}
                                />
                            </div>
                        </div>
                    )}

                    {/* Total calculado */}
                    {!loading && (
                        <div className="flex flex-col items-end gap-1 mt-3">
                            <div className={`px-5 py-2 rounded-xl border font-bold font-mono text-lg shadow-sm transition-colors text-emerald-800 bg-emerald-50 border-emerald-200`}>
                                Nuevo Total: {monedaFinal} {nuevoTotalConHermanas.toFixed(2)}
                            </div>
                            <p className="text-[10px] text-slate-400 pr-1">
                                Suma solo las líneas facturables.
                                {lineas.some(l => l.EsHermanaConsolidada) && (
                                    lineas.some(l => (l.AreaIDInterna || l.AreaID) === 'PRO' && !l.ComboItemID && l._precioTipeado)
                                        ? ' El precio de Producción lo tipeaste vos: es el precio final, no se le suma nada encima.'
                                        : ' Incluye las personalizaciones (DTF/TPU/EMB/EST) con los valores actuales de cada línea.'
                                )}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-between shrink-0">
                    <button onClick={onClose}
                        className="px-5 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 hover:border-slate-400 rounded-lg transition-all shadow-sm">
                        {readOnly ? 'Cerrar' : 'Cancelar'}
                    </button>
                    {!readOnly && (
                        <button onClick={() => handleSave()} disabled={saving || loading}
                            className={`px-8 py-2.5 rounded-lg font-bold text-white text-sm transition-all shadow-md flex items-center gap-2
                                ${saving ? 'bg-indigo-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-indigo-200 hover:scale-105 active:scale-95'}`}>
                            {saving
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Guardando...</>
                                : <><i className="fa-solid fa-floppy-disk" /> Guardar Confirmación</>}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
